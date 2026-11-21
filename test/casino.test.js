/*
 * Casino : neuf jeux tenus par les boss en smoking, mises, gains, parties en cours, fil des gros gains.
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
    { slots: 'dragon', blackjack: 'maexxna', roulette: 'troll', caisse: 'mimic', glace: 'liche', gobelets: 'sorcier', heaven: 'ether', chaton: 'lilith', course: 'daedra' }, 'un boss croupier par jeu');
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

// Remplace le tirage crypto.randomBytes (random() de casino.js) : valeurs imposées dans [0, 1[, dans l'ordre.
function riggedRandom(values, fn) {
  const real = crypto.randomBytes;
  const queue = [...values];
  crypto.randomBytes = (size) => {
    if (size !== 6 || !queue.length) return real(size);
    const b = Buffer.alloc(6);
    b.writeUIntBE(Math.floor(queue.shift() * 2 ** 48), 0, 6);
    return b;
  };
  try { return fn(); } finally { crypto.randomBytes = real; }
}

test('[CAS-10] Road to Heaven d\'Ether : la ligne monte en exp(0,16 t), effondrement secret, STOP, encaissement automatique', () => {
  const H = Rules.CASINO.heaven;
  assert.strictEqual(Rules.heavenMult(0), 1);
  assert.ok(Math.abs(Rules.heavenMult(10) - Math.exp(1.6)) < 0.01);
  assert.ok(Math.abs(Rules.heavenTime(2) - Math.log(2) / H.speed) < 1e-9);
  assert.strictEqual(Rules.heavenCrash(0), 1, 'effondrement immédiat possible');
  assert.strictEqual(Rules.heavenCrash(0.5), 1.94);
  assert.strictEqual(Rules.heavenCrash(0.9999999), H.max);
  // P(atteindre m) = 0,97 / m : la maison garde 3 %
  for (const m of [1.5, 2, 10]) assert.ok(Math.abs((1 - (1 - H.edge / m)) * m - H.edge) < 1e-9);
  const u = player(1000);
  const t0 = 1_000_000;
  const r = riggedRandom([0.5], () => casino.heavenStart(u, 100, null, false, t0));
  assert.strictEqual(u.character.gold, 900);
  assert.strictEqual(r.crash, null, 'le point d\'effondrement reste secret');
  assert.throws(() => casino.heavenStart(u, 100, null, false, t0), /montée en cours/);
  assert.strictEqual(casino.sessionsOf(u, t0 + 1000).heaven.crash, null);
  // Encore en train de monter à 2 s (×1,37), on encaisse à 3 s (×1,61)
  assert.strictEqual(casino.heavenCheck(u, t0 + 2000).outcome, null);
  const c = casino.heavenCash(u, t0 + 3000);
  assert.strictEqual(c.outcome, 'cash');
  assert.strictEqual(c.mult, Rules.heavenMult(3));
  assert.strictEqual(c.payout, Math.floor(100 * Rules.heavenMult(3)));
  assert.strictEqual(c.crash, 1.94, 'révélé à la fin');
  assert.strictEqual(u.character.gold, 900 + c.payout);
  // Effondrée : trop tard pour encaisser
  riggedRandom([0.5], () => casino.heavenStart(u, 100, null, false, t0));
  const late = casino.heavenCash(u, t0 + Rules.heavenTime(1.94) * 1000 + 50);
  assert.deepStrictEqual([late.outcome, late.payout], ['crash', 0]);
  assert.throws(() => casino.heavenCheck(u), /Aucune montée/);
  // Encaissement automatique à ×1,5 (sous l'effondrement à ×1,94) : réglé dès que la ligne l'atteint
  assert.throws(() => casino.heavenStart(u, 100, 1.05, false, t0), /Encaissement auto/);
  riggedRandom([0.5], () => casino.heavenStart(u, 100, 1.5, false, t0));
  const auto = casino.heavenCheck(u, t0 + 10_000);
  assert.deepStrictEqual([auto.outcome, auto.mult, auto.payout], ['cash', 1.5, 150]);
  // … mais pas au-dessus de l'effondrement
  riggedRandom([0.5], () => casino.heavenStart(u, 100, 3, false, t0));
  assert.strictEqual(casino.heavenCheck(u, t0 + 10_000).outcome, 'crash');
});

test('[CAS-11] Chaton Fripon de Lilith : 10 toits, risque de glisser croissant, gain = 0,97 / chance de survie', () => {
  const K = Rules.CASINO.chaton;
  assert.strictEqual(K.slip.length, 10);
  assert.ok(K.slip.every((s, i) => i === 0 || s > K.slip[i - 1]), 'de plus en plus glissant');
  assert.strictEqual(Rules.chatonMult(1), 1.05);
  assert.strictEqual(Rules.chatonMult(10), 12.12);
  const u = player(1000);
  const s = casino.chatonStart(u, 100);
  assert.deepStrictEqual([s.roof, s.next, s.risk, s.cashable], [0, 1.05, K.slip[0], false]);
  assert.throws(() => casino.chatonCash(u), /au moins une fois/);
  // Deux sauts réussis puis encaisser
  riggedRandom([0.99, 0.99], () => { casino.chatonJump(u); casino.chatonJump(u); });
  const c = casino.chatonCash(u);
  assert.deepStrictEqual([c.outcome, c.roof, c.payout], ['cash', 2, Math.floor(100 * Rules.chatonMult(2))]);
  // Glissade sur le 2ᵉ toit : tout est perdu
  casino.chatonStart(u, 100);
  const slip = riggedRandom([0.99, 0.01], () => { casino.chatonJump(u); return casino.chatonJump(u); });
  assert.deepStrictEqual([slip.outcome, slip.payout, slip.slipAt], ['slip', 0, 2]);
  assert.throws(() => casino.chatonJump(u), /Aucune partie/);
  // Les 10 toits : encaissé d'office
  casino.chatonStart(u, 10);
  const all = riggedRandom(Array(10).fill(0.999), () => { let r; for (let i = 0; i < 10; i++) r = casino.chatonJump(u); return r; });
  assert.deepStrictEqual([all.outcome, all.roof, all.payout], ['cash', 10, 121]);
});

test('[CAS-12] course de démons de Daedra : six démons, chances ∝ 1 / cote (retour ≈ 95 %), ordre d\'arrivée', () => {
  const D = Rules.CASINO.course.demons;
  assert.strictEqual(D.length, 6);
  const ch = Rules.courseChances();
  assert.ok(Math.abs(Object.values(ch).reduce((a, x) => a + x, 0) - 1) < 1e-9);
  for (const d of D) assert.ok(Math.abs(ch[d.id] * d.pays - 0.952) < 0.002, 'même retour pour chaque démon');
  const u = player(1000);
  assert.throws(() => casino.course(u, 100, 'inconnu'), /Choisis un démon/);
  // Premier tirage ≈ 0 : le premier démon (Brasier) gagne
  const r = riggedRandom([0, 0, 0, 0, 0, 0], () => casino.course(u, 100, 'brasier'));
  assert.strictEqual(r.order.length, 6);
  assert.strictEqual(new Set(r.order).size, 6);
  assert.deepStrictEqual([r.winner, r.win, r.payout], ['brasier', true, 290]);
  const lose = riggedRandom([0, 0, 0, 0, 0, 0], () => casino.course(u, 100, 'lucifiot'));
  assert.deepStrictEqual([lose.win, lose.payout], [false, 0]);
  assert.strictEqual(u.character.gold, 1000 - 200 + 290);
});

test('[CAS-13] tickets de casino : une mise gratuite de 50 golds dans tous les jeux sauf la caisse', () => {
  const u = player(0);
  const c = u.character;
  assert.throws(() => casino.slots(u, 50, true), /plus de ticket/);
  c.casinoTickets = 3;
  const r = casino.gobelets(u, 500, 0, true);
  assert.strictEqual(r.bet, 50, 'la mise d\'un ticket vaut 50 golds');
  assert.strictEqual(c.casinoTickets, 2);
  assert.strictEqual(c.gold, r.payout, 'aucun gold retiré');
  assert.strictEqual(c.lifetime.casinoWagered, 0, 'un ticket ne compte pas comme une mise');
  assert.strictEqual(c.counters.casinoTicketsUsed, 1);
  // Roulette : le ticket paie les 50 premiers golds de jetons
  c.gold = 100;
  assert.throws(() => casino.roulette(u, [{ on: 'rouge', amount: 25 }], true), /au moins 50/);
  rigged([0], () => casino.roulette(u, [{ on: 'rouge', amount: 50 }, { on: 'noir', amount: 25 }], true));
  assert.strictEqual(c.gold, 75, 'seuls les 25 golds au-delà du ticket sont payés (le 0 sort)');
  assert.strictEqual(c.casinoTickets, 1);
  const k = casino.chatonStart(u, 10, true);
  assert.strictEqual(k.bet, 50);
  assert.strictEqual(c.casinoTickets, 0);
});
