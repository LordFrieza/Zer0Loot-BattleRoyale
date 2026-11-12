/*
 * Marché entre joueurs : mise en vente (taxe), achat, retrait, expiration, courrier et historique.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, game, db } = require('./helpers');
const market = require('../server/market');

let seq = 0;
function player(gold = 1000) {
  seq += 1;
  const id = 'mk' + seq;
  const user = { id, username: 'marchand' + seq, role: 'player', character: game.newCharacter() };
  user.character.gold = gold;
  db.state.users[id] = user;
  return user;
}
const give = (user, rarity = 'rare') => { const it = game.makeItem(rarity); user.character.inventory.push(it); return it; };

test('[MKT-1] mise en vente : objet du coffre, prix borné, taxe de 20 % non remboursée, 5 ventes au plus', () => {
  assert.deepStrictEqual([Rules.marketTax(100), Rules.marketTax(7), Rules.marketTax(1001)], [20, 2, 201]);
  const s = player(1000);
  const it = give(s);
  assert.throws(() => market.sell(s, it.id, 4), /entre 5 et/);
  assert.throws(() => market.sell(s, it.id, 10.5), /entier/);
  assert.throws(() => market.sell(s, 'nope', 100), /introuvable/);
  const { order, tax } = market.sell(s, it.id, 100);
  assert.strictEqual(tax, 20);
  assert.strictEqual(s.character.gold, 980);
  assert.ok(!s.character.inventory.some((i) => i.id === it.id), 'l\'objet quitte le coffre');
  assert.strictEqual(order.expiresAt - order.createdAt, 96 * 3600 * 1000);
  assert.strictEqual(s.character.marketLog[0].kind, 'listed');
  // Objet équipé ou protégé : refusé
  const prot = give(s);
  s.character.presets.push({ id: 'p', name: 'p', items: { anneau: prot.id } });
  assert.throws(() => market.sell(s, prot.id, 50), /protégé/);
  s.character.presets = [];
  // Pas assez pour la taxe
  const poor = player(10);
  const pi = give(poor);
  assert.throws(() => market.sell(poor, pi.id, 100), /20 golds de taxe/);
  assert.strictEqual(poor.character.gold, 10);
  // 5 ventes au plus
  for (let i = 0; i < 4; i++) market.sell(s, give(s).id, 10);
  assert.strictEqual(market.ordersOf(s.id).length, 5);
  assert.throws(() => market.sell(s, give(s).id, 10), /déjà 5 objets en vente/);
});

test('[MKT-2] achat : prix sans taxe, objet à l\'acheteur, golds et courrier au vendeur', () => {
  const s = player(100);
  const b = player(500);
  const it = give(s, 'epique');
  const { order } = market.sell(s, it.id, 200);
  assert.strictEqual(s.character.gold, 60);
  assert.throws(() => market.buy(s, order.id), /propre objet/);
  const broke = player(50);
  assert.throws(() => market.buy(broke, order.id), /200 golds/);
  const r = market.buy(b, order.id);
  assert.strictEqual(r.price, 200);
  assert.strictEqual(b.character.gold, 300, 'pas de taxe à l\'achat');
  assert.ok(b.character.inventory.some((i) => i.id === it.id));
  assert.strictEqual(s.character.gold, 260, 'le vendeur reçoit tout le prix');
  assert.deepStrictEqual([s.character.counters.sold, b.character.counters.bought], [1, 1]);
  assert.match(s.character.mail[0].text, /a acheté ton objet/);
  assert.strictEqual(s.character.mail[0].read, false);
  assert.deepStrictEqual([s.character.marketLog[0].kind, b.character.marketLog[0].kind], ['sold', 'bought']);
  assert.throws(() => market.buy(b, order.id), /plus en vente/);
  // Vendeur banni : invisible et invendable
  const banned = player(100);
  const o2 = market.sell(banned, give(banned).id, 50).order;
  banned.banned = true;
  assert.ok(!market.list().some((o) => o.id === o2.id));
  assert.throws(() => market.buy(b, o2.id), /plus en vente/);
  assert.ok(Rules.ACHIEVEMENTS.some((a) => a.id === 'sold1') && Rules.ACHIEVEMENTS.some((a) => a.id === 'bought1'));
});

test('[MKT-3] retrait (taxe perdue) et expiration au bout de 96 h', () => {
  const s = player(100);
  const it = give(s);
  const t0 = Date.now();
  const { order } = market.sell(s, it.id, 50, t0);
  const b = player(100);
  assert.throws(() => market.cancel(b, order.id), /introuvable/, 'seulement le vendeur');
  market.cancel(s, order.id);
  assert.ok(s.character.inventory.some((i) => i.id === it.id));
  assert.strictEqual(s.character.gold, 90, 'taxe non remboursée');
  assert.strictEqual(s.character.marketLog[0].kind, 'cancelled');
  // Expiration
  const o2 = market.sell(s, it.id, 50, t0).order;
  assert.ok(!market.sweep(t0 + 95 * 3600 * 1000).some((u) => u.id === s.id), 'pas encore expiré');
  assert.ok(market.list(t0 + 95 * 3600 * 1000).some((o) => o.id === o2.id));
  const touched = market.sweep(t0 + 96 * 3600 * 1000 + 1);
  assert.ok(touched.some((u) => u.id === s.id), 'le vendeur est prévenu');
  assert.ok(s.character.inventory.some((i) => i.id === it.id), 'objet rendu');
  assert.match(s.character.mail[0].text, /expiré/);
  assert.strictEqual(s.character.marketLog[0].kind, 'expired');
  assert.ok(!market.list(t0 + 97 * 3600 * 1000).some((o) => o.id === o2.id));
});

test('[MKT-5] courrier et historique : limités, lus, et ajoutés aux anciennes sauvegardes', () => {
  const s = player(1e6);
  for (let i = 0; i < 60; i++) {
    const { order } = market.sell(s, give(s).id, 5);
    market.buy(player(10), order.id);
  }
  assert.strictEqual(s.character.mail.length, Rules.MARKET.mailMax);
  assert.strictEqual(s.character.marketLog.length, Rules.MARKET.historyMax);
  market.readMail(s);
  assert.ok(s.character.mail.every((m) => m.read));
  const old = game.newCharacter();
  delete old.mail; delete old.marketLog;
  game.upgrade(old);
  assert.deepStrictEqual([old.mail, old.marketLog], [[], []]);
});
