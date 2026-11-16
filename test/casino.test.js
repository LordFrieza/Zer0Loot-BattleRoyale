/*
 * Casino : six jeux tenus par les boss en smoking, mises, gains, parties en cours, fil des gros gains.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { Rules, game, db } = require('./helpers');
const casino = require('../server/casino');

let n = 0;
function player(gold = 10000) {
  const id = 'cas' + (++n);
  const c = game.newCharacter();
  game.chooseClass(c, 'archer');
  c.gold = gold;
  const user = { id, username: 'Joueur' + n, role: 'player', character: c };
  db.state.users[id] = user;
  return user;
}
// Remplace crypto.randomInt le temps d'un appel (résultats imposés, dans l'ordre).
function rigged(values, fn) {
  const real = crypto.randomInt;
  const queue = [...values];
  crypto.randomInt = (min, max) => (queue.length ? queue.shift() : real(min, max));
  try { return fn(); } finally { crypto.randomInt = real; }
}

test('[CAS-1] casino : mises autorisées, mise retirée avant le tirage, statistiques et compteur de parties', () => {
  const C = Rules.CASINO;
  assert.deepStrictEqual(C.bets, [10, 25, 50, 100, 250, 500]);
  assert.deepStrictEqual(Object.fromEntries(Object.entries(C.games).map(([k, g]) => [k, g.croupier])),
    { slots: 'dragon', blackjack: 'maexxna', roulette: 'troll', caisse: 'mimic', glace: 'liche', gobelets: 'sorcier' }, 'un boss croupier par jeu');
  const u = player(40);
  assert.throws(() => casino.slots(u, 30), /Mise possible/);
  assert.throws(() => casino.slots(u, 50), /Il te faut 50 golds/);
  assert.strictEqual(u.character.gold, 40);
  const r = casino.gobelets(u, 25, 1);
  assert.strictEqual(u.character.gold, 40 - 25 + r.payout);
  const L = u.character.lifetime;
  assert.deepStrictEqual([L.casinoBets, L.casinoWagered, L.casinoWon], [1, 25, r.payout]);
  assert.strictEqual(u.character.counters.casinoPlays, 1);
  assert.ok(Rules.PLAYER_STAT_MAX.includes('casinoBest'));
  // Anciennes sauvegardes : statistiques à zéro
  const old = game.newCharacter();
  for (const k of ['casinoBets', 'casinoWagered', 'casinoWon', 'casinoBest']) delete old.lifetime[k];
  game.upgrade(old);
  assert.deepStrictEqual([old.lifetime.casinoBets, old.lifetime.casinoBest], [0, 0]);
});

test('[CAS-2] machine à sous de Pyrax : trois identiques × table, deux cerises ×2, jackpot, taux de retour ≈ 94,6 %', () => {
  assert.deepStrictEqual(Rules.slotsPayout(['sept', 'sept', 'sept']), { mult: 150, kind: 'jackpot', symbol: 'sept' });
  assert.deepStrictEqual(Rules.slotsPayout(['citron', 'citron', 'citron']), { mult: 10, kind: 'triple', symbol: 'citron' });
  assert.deepStrictEqual(Rules.slotsPayout(['cerise', 'sept', 'cerise']), { mult: 2, kind: 'cerises', symbol: 'cerise' });
  assert.strictEqual(Rules.slotsPayout(['cerise', 'sept', 'citron']).mult, 0);
  assert.ok(Math.abs(Rules.slotsRtp() - 0.9465) < 0.001);
  const u = player();
  let won = 0;
  let paid = 0;
  for (let i = 0; i < 400; i++) {
    const r = casino.slots(u, 10);
    assert.strictEqual(r.reels.length, 3);
    assert.ok(r.reels.every((s) => Rules.CASINO.slots.symbols[s]));
    assert.strictEqual(r.payout, 10 * Rules.slotsPayout(r.reels).mult);
    won += r.payout; paid += 10;
  }
  assert.strictEqual(u.character.gold, 10000 - paid + won);
  // Jackpot : compteur du succès et fil des gros gains
  const before = casino.feed().length;
  const jackpots = u.character.counters.jackpots || 0;
  const sept = Object.keys(Rules.CASINO.slots.symbols).indexOf('sept');
  const real = crypto.randomBytes;
  crypto.randomBytes = (k) => { const b = Buffer.alloc(k); b.writeUIntBE(Math.floor(((sept + 0.5) / 6) * 0 + 0.98 * 2 ** 48), 0, 6); return b; };
  let jr;
  try { jr = casino.slots(u, 100); } finally { crypto.randomBytes = real; }
  assert.deepStrictEqual(jr.reels, ['sept', 'sept', 'sept']);
  assert.strictEqual(jr.payout, 15000);
  assert.strictEqual(u.character.counters.jackpots, jackpots + 1);
  assert.strictEqual(jr.feed, true);
  assert.strictEqual(casino.feed().length, Math.min(Rules.CASINO.feedMax, before + 1));
  assert.deepStrictEqual([casino.feed()[0].game, casino.feed()[0].amount, casino.feed()[0].text], ['slots', 15000, 'JACKPOT !']);
  assert.ok(u.character.lifetime.casinoBest >= 15000);
  assert.ok(Rules.achievementById('jackpot1'));
});

test('[CAS-3] roulette de Grokk : paris valides, gains selon le numéro (×36, ×3, ×2), zéro', () => {
  assert.strictEqual(Rules.rouletteColor(0), 'vert');
  assert.strictEqual(Rules.rouletteColor(1), 'rouge');
  assert.strictEqual(Rules.rouletteColor(2), 'noir');
  assert.strictEqual(Rules.CASINO.roulette.red.length, 18);
  assert.deepStrictEqual(['n:17', 'rouge', 'd2', 'c3', 'n:37', 'bleu'].map(Rules.rouletteReturn), [36, 2, 3, 3, null, null]);
  assert.ok(Rules.rouletteWins('d2', 13) && !Rules.rouletteWins('d2', 25));
  assert.ok(Rules.rouletteWins('c1', 34) && Rules.rouletteWins('c3', 36));
  assert.ok(Rules.rouletteWins('manque', 18) && Rules.rouletteWins('passe', 19));
  assert.ok(!['rouge', 'noir', 'pair', 'impair', 'manque', 'passe', 'd1', 'c1'].some((on) => Rules.rouletteWins(on, 0)), 'le zéro fait perdre les chances simples');
  const u = player(1000);
  assert.throws(() => casino.roulette(u, []), /au moins un jeton/);
  assert.throws(() => casino.roulette(u, [{ on: 'violet', amount: 10 }]), /Pari inconnu/);
  assert.throws(() => casino.roulette(u, [{ on: 'rouge', amount: 30 }]), /Jetons possibles/);
  assert.throws(() => casino.roulette(u, Array.from({ length: 6 }, () => ({ on: 'rouge', amount: 100 }))), /500 golds au plus/);
  assert.strictEqual(u.character.gold, 1000);
  const r = rigged([17], () => casino.roulette(u, [{ on: 'n:17', amount: 10 }, { on: 'noir', amount: 50 }, { on: 'd1', amount: 25 }, { on: 'pair', amount: 10 }]));
  assert.deepStrictEqual([r.number, r.color], [17, 'noir']);
  assert.deepStrictEqual(r.wins.sort(), ['n:17', 'noir'].sort());
  assert.strictEqual(r.payout, 360 + 100);
  assert.strictEqual(u.character.gold, 1000 - 95 + 460);
  const z = rigged([0], () => casino.roulette(u, [{ on: 'rouge', amount: 100 }, { on: 'n:0', amount: 10 }]));
  assert.deepStrictEqual([z.number, z.payout], [0, 360]);
});

test('[CAS-4] blackjack de Maexxna : valeur des mains, banque à 17, doubler, blackjack 3 pour 2, carte cachée', () => {
  const v = (...r) => Rules.bjValue(r.map((x) => ({ r: x })));
  assert.deepStrictEqual(v('A', 'K'), { total: 21, soft: true, blackjack: true });
  assert.deepStrictEqual(v('A', 'A', '9'), { total: 21, soft: true, blackjack: false });
  assert.deepStrictEqual(v('K', '6', 'A'), { total: 17, soft: false, blackjack: false });
  assert.strictEqual(v('K', 'Q', '5').total, 25);
  const u = player(1000);
  const S = () => casino.state().sessions[u.id];
  // Donne : la carte cachée de la banque n'est jamais envoyée
  const d = rigged([9, 0, 6, 1, 4, 2, 9, 3], () => casino.bjDeal(u, 100)); // 10♠ 7♥ (joueur), 5♦ 10♣ (banque)
  assert.deepStrictEqual(d.player.map((c) => c.r), ['10', '7']);
  assert.deepStrictEqual(d.dealer[1], { hidden: true });
  assert.strictEqual(d.dealerValue.total, 5);
  assert.strictEqual(u.character.gold, 900);
  assert.throws(() => casino.bjDeal(u, 100), /Termine d'abord/);
  assert.deepStrictEqual(casino.sessionsOf(u).blackjack.dealer[1], { hidden: true });
  // Rester : la banque (15) tire jusqu'à 17 au moins
  const st = rigged([5, 0], () => casino.bjStand(u)); // 6 → 21
  assert.strictEqual(st.dealerValue.total, 21);
  assert.deepStrictEqual([st.outcome, st.payout], ['lose', 0]);
  assert.strictEqual(S().bj, undefined);
  // Victoire simple ×2 ; banque qui dépasse ; égalité remboursée
  S().bj = { bet: 50, player: [{ r: 'K', s: '♠' }, { r: '9', s: '♠' }], dealer: [{ r: '10', s: '♥' }, { r: '8', s: '♥' }], doubled: false };
  assert.deepStrictEqual([casino.bjStand(u).outcome, u.character.gold], ['win', 900 + 100]);
  S().bj = { bet: 50, player: [{ r: 'K', s: '♠' }, { r: '8', s: '♠' }], dealer: [{ r: '10', s: '♥' }, { r: '8', s: '♥' }], doubled: false };
  assert.deepStrictEqual([casino.bjStand(u).outcome, u.character.gold], ['push', 1050]);
  S().bj = { bet: 50, player: [{ r: 'K', s: '♠' }, { r: '2', s: '♠' }], dealer: [{ r: '10', s: '♥' }, { r: '6', s: '♥' }], doubled: false };
  const bust = rigged([9, 0], () => casino.bjStand(u)); // banque 26
  assert.deepStrictEqual([bust.outcome, bust.payout], ['win', 100]);
  // Tirer au-delà de 21 : perdu
  S().bj = { bet: 50, player: [{ r: 'K', s: '♠' }, { r: '6', s: '♠' }], dealer: [{ r: '10', s: '♥' }, { r: '7', s: '♥' }], doubled: false };
  assert.strictEqual(rigged([12, 0], () => casino.bjHit(u)).outcome, 'bust');
  // Doubler : mise ×2, une seule carte, puis la banque joue
  const gold = u.character.gold;
  S().bj = { bet: 100, player: [{ r: '6', s: '♠' }, { r: '5', s: '♠' }], dealer: [{ r: '10', s: '♥' }, { r: '7', s: '♥' }], doubled: false };
  const dbl = rigged([9, 0], () => casino.bjDouble(u));
  assert.strictEqual(dbl.player.length, 3);
  assert.deepStrictEqual([dbl.bet, dbl.doubled, dbl.outcome, dbl.payout], [200, true, 'win', 400]);
  assert.strictEqual(u.character.gold, gold - 100 + 400);
  // Blackjack d'entrée : payé 3 pour 2 tout de suite
  const bj = rigged([0, 0, 12, 0, 4, 1, 6, 1], () => casino.bjDeal(u, 100)); // A K / 5 7
  assert.deepStrictEqual([bj.outcome, bj.payout], ['blackjack', 250]);
  assert.throws(() => casino.bjHit(u), /Aucune main/);
});

test('[CAS-5] caisse de Grignotor : 100 golds, lots pondérés (1 % d\'incroyables), armes pour sa classe, clé, familier', () => {
  const K = Rules.CASINO.caisse;
  assert.strictEqual(K.price, 100);
  const total = K.loot.reduce((a, l) => a + l.weight, 0);
  const tier = (t) => K.loot.filter((l) => l.tier === t).reduce((a, l) => a + l.weight, 0) / total;
  assert.strictEqual(total, 10000);
  assert.deepStrictEqual([tier('mauvais'), tier('correct'), tier('incroyable')], [0.8, 0.19, 0.01]);
  const u = player(100000);
  const seen = {};
  for (let i = 0; i < 300; i++) {
    const r = casino.caisse(u);
    seen[r.lot.id] = (seen[r.lot.id] || 0) + 1;
    if (r.item) {
      assert.strictEqual(r.item.slot, 'arme');
      assert.strictEqual(Rules.itemClass(r.item), 'archer');
      assert.strictEqual(r.item.rarity, r.lot.id);
      assert.ok(u.character.inventory.some((x) => x.id === r.item.id && x.isNew));
    }
    if (r.gold) assert.ok(r.gold >= 20 && r.gold <= 60);
  }
  assert.ok(seen.golds && seen.commun && seen.peu_commun);
  // Lots forcés : clé de boss, familier, arme légendaire (fil des gros gains, succès)
  const force = (id, fn) => {
    const real = crypto.randomBytes;
    let acc = 0;
    for (const l of K.loot) { if (l.id === id) break; acc += l.weight; }
    const target = (acc + 0.5) / total;
    crypto.randomBytes = (k) => { const b = Buffer.alloc(k); b.writeUIntBE(Math.floor(target * 2 ** 48), 0, 6); return b; };
    try { return fn(); } finally { crypto.randomBytes = real; }
  };
  const keys = u.character.bossKeys;
  const legends = u.character.counters.casinoLegend || 0;
  assert.strictEqual(force('cle', () => casino.caisse(u)).keys, 1);
  assert.strictEqual(u.character.bossKeys, keys + 1);
  const pet = force('familier', () => casino.caisse(u));
  assert.ok(Rules.PETS[pet.pet.species]);
  assert.ok(u.character.pets.list.some((p) => p.species === pet.pet.species));
  const leg = force('legendaire', () => casino.caisse(u));
  assert.strictEqual(leg.item.rarity, 'legendaire');
  assert.strictEqual(leg.feed, true);
  assert.match(casino.feed()[0].text, /Légendaire/);
  assert.strictEqual(u.character.counters.casinoLegend, legends + 2);
  const poor = player(99);
  assert.throws(() => casino.caisse(poor), /100 golds/);
});

test('[CAS-6] lac gelé de Givrenoire : fissures secrètes, gain qui monte case par case, encaisser ou tout perdre', () => {
  assert.strictEqual(Rules.glaceMult(3, 0), 1);
  assert.strictEqual(Rules.glaceMult(3, 1), Math.floor((0.97 / (22 / 25)) * 100) / 100);
  assert.ok(Rules.glaceMult(10, 3) > Rules.glaceMult(3, 3), 'plus de fissures, plus de gain');
  const u = player(1000);
  assert.throws(() => casino.glaceStart(u, 100, 4), /fissures possible/);
  const g = casino.glaceStart(u, 100, 3);
  assert.strictEqual(u.character.gold, 900);
  assert.strictEqual(g.cracks, null, 'fissures jamais envoyées pendant la partie');
  assert.strictEqual(casino.sessionsOf(u).glace.cracks, null);
  assert.throws(() => casino.glaceCash(u), /au moins une case/);
  const cracks = casino.state().sessions[u.id].glace.cracks;
  assert.strictEqual(cracks.length, 3);
  const safe = Array.from({ length: 25 }, (_, i) => i).filter((i) => !cracks.includes(i));
  let v = casino.glacePick(u, safe[0]);
  assert.deepStrictEqual([v.revealed, v.mult, v.next], [[safe[0]], Rules.glaceMult(3, 1), Rules.glaceMult(3, 2)]);
  assert.throws(() => casino.glacePick(u, safe[0]), /déjà brisée/);
  v = casino.glacePick(u, safe[1]);
  const cash = casino.glaceCash(u);
  assert.deepStrictEqual([cash.outcome, cash.payout], ['cash', Math.floor(100 * Rules.glaceMult(3, 2))]);
  assert.deepStrictEqual(cash.cracks, cracks, 'fissures révélées à la fin');
  assert.strictEqual(u.character.gold, 900 + cash.payout);
  // Fissure : tout est perdu
  casino.glaceStart(u, 50, 15);
  const c2 = casino.state().sessions[u.id].glace.cracks;
  const boom = casino.glacePick(u, c2[0]);
  assert.deepStrictEqual([boom.outcome, boom.payout, boom.boom], ['boom', 0, c2[0]]);
  assert.throws(() => casino.glacePick(u, 0), /Aucune partie/);
  // Tout le lac brisé : encaissé d'office
  casino.glaceStart(u, 10, 15);
  const c3 = casino.state().sessions[u.id].glace.cracks;
  let last;
  for (const i of Array.from({ length: 25 }, (_, k) => k).filter((k) => !c3.includes(k))) last = casino.glacePick(u, i);
  assert.deepStrictEqual([last.outcome, last.payout], ['cash', Math.floor(10 * Rules.glaceMult(15, 10))]);
});

test('[CAS-7] gobelets de Malvorath : un gobelet sur trois, 2,85 × la mise', () => {
  const u = player(1000);
  assert.throws(() => casino.gobelets(u, 10, 3), /Choisis un gobelet/);
  const win = rigged([2], () => casino.gobelets(u, 100, 2));
  assert.deepStrictEqual([win.ball, win.win, win.payout], [2, true, 285]);
  const lose = rigged([0], () => casino.gobelets(u, 100, 1));
  assert.deepStrictEqual([lose.win, lose.payout], [false, 0]);
  assert.strictEqual(u.character.gold, 1000 - 200 + 285);
});
