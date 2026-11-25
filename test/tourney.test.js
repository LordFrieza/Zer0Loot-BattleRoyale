/*
 * Tournoi : arbre (appariement par puissance, 1v1v1), déroulé des matchs, fin et récompenses (rules.js, battle.js).
 * Les récompenses, l'historique et les paris versés par index.js sont vérifiés dans http.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, Battle, base } = require('./helpers');

// Tournoi prêt à être piloté à la main ; powers[i] = puissance du combattant i.
function tourney(powers, stats = () => base({ maxHp: 300, damage: 60, speed: 120 })) {
  const b = new Battle();
  b.openQueue(60, 'tourney');
  clearTimeout(b.queueTimer);
  powers.forEach((pw, i) => b.join({ key: 'p' + i, name: 'P' + i, level: 1, power: pw, stats: stats(i), look: {} }));
  return b;
}
function started(b) {
  b.start(null, 'meteors');
  b.stopLoop();
  return b;
}
// Avance jusqu'à l'étape voulue (au plus maxSeconds de jeu).
function until(b, pred, maxSeconds = 600) {
  for (let i = 0; i < maxSeconds * 20 && !pred(); i++) b.tick(0.05);
  assert.ok(pred(), 'étape atteinte');
}
const shape = (n) => Rules.tourneyBracket(Array.from({ length: n }, (_, i) => ({ key: 'k' + i, power: i })))
  .rounds.map((r) => r.map((m) => m.slots.length));

test('[TRN-2] arbre : les forts avec les forts, 1v1v1 des plus faibles si le nombre est impair', () => {
  const b = Rules.tourneyBracket([{ key: 'a', power: 5 }, { key: 'b', power: 50 }, { key: 'c', power: 20 }, { key: 'd', power: 30 }, { key: 'e', power: 1 }]);
  assert.deepStrictEqual(b.rounds[0].map((m) => m.slots), [['b', 'd'], ['c', 'a', 'e']]);
  assert.deepStrictEqual(b.rounds[1].map((m) => ({ slots: m.slots, from: m.from })), [{ slots: [null, null], from: ['r0m0', 'r0m1'] }]);
  // Égalité de puissance : ordre d'inscription
  assert.deepStrictEqual(Rules.tourneyBracket([{ key: 'x', power: 3 }, { key: 'y', power: 3 }]).rounds[0][0].slots, ['x', 'y']);
  assert.deepStrictEqual(shape(2), [[2]]);
  assert.deepStrictEqual(shape(3), [[3]]);
  assert.deepStrictEqual(shape(4), [[2, 2], [2]]);
  assert.deepStrictEqual(shape(5), [[2, 3], [2]]);
  assert.deepStrictEqual(shape(6), [[2, 2, 2], [3]]);
  assert.deepStrictEqual(shape(7), [[2, 2, 3], [3]]);
  assert.deepStrictEqual(shape(8), [[2, 2, 2, 2], [2, 2], [2]]);
  assert.deepStrictEqual(shape(11), [[2, 2, 2, 2, 3], [2, 3], [2]]);
  // Chaque joueur est placé une seule fois, le dernier tour est une finale unique
  for (let n = 2; n <= 32; n++) {
    const r = Rules.tourneyBracket(Array.from({ length: n }, (_, i) => ({ key: 'k' + i, power: (i * 7) % 13 }))).rounds;
    assert.strictEqual(new Set(r[0].flatMap((m) => m.slots)).size, n);
    assert.strictEqual(r[r.length - 1].length, 1);
    assert.ok(r.flat().every((m) => m.slots.length === 2 || m.slots.length === 3));
  }
});

test('[TRN-1, MODE-3] tournoi : 2 combattants au moins, 32 au plus', () => {
  const one = tourney([1]);
  assert.throws(() => one.start(), /au moins 2/);
  const b = tourney(Array.from({ length: 32 }, (_, i) => i + 1));
  assert.strictEqual(b.participants.size, 32);
  assert.strictEqual(b.join({ key: 'p99', name: 'Trop', level: 1, stats: base(), look: {} }), false, 'tableau complet');
  assert.strictEqual(b.participants.size, 32);
});

test('[TRN-3, TRN-5] déroulé : arbre, puis un match à la fois, à pleine vie, le plus faible renforcé', () => {
  const b = started(tourney([10, 40, 20, 30]));
  assert.strictEqual(b.event, null, 'pas d\'événement de bataille');
  assert.strictEqual(b.tourney.stage, 'bracket');
  assert.strictEqual(b.fighters.length, 0, 'arène vide pendant l\'arbre');
  const q = b.publicQueue().tourney;
  assert.deepStrictEqual(q.rounds[0].map((m) => m.slots), [['p1', 'p3'], ['p2', 'p0']]);
  assert.strictEqual(q.match, 'r0m1', 'on commence par le match le plus faible');
  assert.strictEqual(b.frame().tourney.stage, 'bracket');
  // Premier affichage : 8 s
  let events = [];
  b.on('frame', (f) => { events = events.concat(f.events); });
  for (let i = 0; i < 20 * (Rules.TOURNEY.firstBracketTime - 0.2); i++) b.tick(0.05);
  assert.strictEqual(b.tourney.stage, 'bracket');
  until(b, () => b.tourney.stage === 'fight');
  assert.ok(events.some((e) => e.t === 'tourneyMatch' && e.id === 'r0m1'));
  assert.deepStrictEqual(b.fighters.map((f) => f.key), ['p2', 'p0']);
  const [p2, p0] = b.fighters;
  assert.strictEqual(p2.hp, p2.maxHp);
  assert.strictEqual(p0.boost, Rules.powerUnderdog(20, 10), 'le plus faible du match est renforcé');
  assert.strictEqual(p0.maxHp, Math.round(300 * p0.boost));
  assert.strictEqual(p2.boost, undefined);
});

test('[TRN-4, TRN-6] tournoi complet : le gagnant monte, le perdant est éliminé, champion et classement', () => {
  const b = started(tourney([10, 40, 20, 30, 5]));
  const matches = [];
  b.on('tourneyMatch', (m) => matches.push(m));
  let end = null;
  b.on('tourneyEnd', (r, fighters) => { end = { r, fighters }; });
  until(b, () => b.phase === 'ended', 1200);
  assert.strictEqual(matches.length, 3, 'un duel et un 1v1v1, puis la finale');
  assert.deepStrictEqual(matches.map((m) => m.final), [false, false, true]);
  const T = b.tourney;
  // Les vainqueurs du premier tour sont dans la finale, les perdants éliminés
  const final = T.rounds[1][0];
  assert.deepStrictEqual(final.slots, [T.rounds[0][0].winner, T.rounds[0][1].winner]);
  assert.strictEqual(T.rounds[0][1].out.length, 2, '1v1v1 : deux éliminés');
  assert.ok(matches.every((m) => m.out.every((f) => f.outRound === m.round)));
  // Résultat
  assert.ok(end);
  const r = end.r;
  assert.strictEqual(r.mode, 'tourney');
  assert.strictEqual(r.winner.key, final.winner);
  assert.strictEqual(r.winner.wins, 2);
  assert.strictEqual(r.rounds, 2);
  assert.strictEqual(r.ranking[0].key, final.winner);
  assert.strictEqual(r.ranking.length, 5);
  assert.ok(r.ranking.every((x, i) => i === 0 || x.wins <= r.ranking[i - 1].wins || i === 1));
  assert.strictEqual(end.fighters.length, 5);
  assert.strictEqual(b.fighters.length, 1, 'le champion reste seul pour la photo');
});

test('[TRN-4] match : morts simultanées, zone, et fin au temps (le plus en forme gagne)', () => {
  const b = started(tourney([10, 20]));
  until(b, () => b.tourney.stage === 'fight');
  const [a, c] = b.fighters;
  const freeze = () => { for (const f of b.fighters) { f.speed = 0; f.cd = 99; f.dodge = 0; f.x = f.key === a.key ? 300 : 1000; } };
  freeze();
  // La zone n'est pas active avant 30 s, elle l'est après
  assert.strictEqual(b.frame().storm.active, false);
  b.time = b.tourney.matchStart + Rules.TOURNEY.zone.at + 1;
  assert.strictEqual(b.tourneyStorm().active, true);
  assert.ok(b.tourneyStorm().r < Math.hypot(1280, 720) / 2);
  // Fin du temps
  a.hp = a.maxHp * 0.5;
  c.hp = c.maxHp * 0.8;
  b.time = b.tourney.matchStart + Rules.TOURNEY.maxDuration;
  b.tick(0.05);
  assert.strictEqual(b.tourney.stage, 'result');
  assert.strictEqual(b.tourney.rounds[0][0].winner, c.key);
  assert.strictEqual(a.alive, false, 'le perdant quitte le tableau');
  // Morts simultanées : le dernier tombé gagne à 1 PV
  const d = started(tourney([10, 20]));
  until(d, () => d.tourney.stage === 'fight');
  const [x, y] = d.fighters;
  Object.assign(x, { alive: false, hp: 0, diedAt: 5 });
  Object.assign(y, { alive: false, hp: 0, diedAt: 6 });
  d.checkTourneyMatchEnd();
  assert.strictEqual(d.tourney.last.winner, y.key);
  assert.strictEqual(y.hp, 1);
});

test('[TRN-6] tournoi : aucune récompense de kill ni de série', () => {
  const b = started(tourney([10, 20, 30, 40]));
  let kills = 0;
  b.on('kill', () => { kills += 1; });
  b.on('streak', () => { kills += 1; });
  until(b, () => b.phase === 'ended', 1200);
  assert.strictEqual(kills, 0);
  assert.ok(b.result.ranking.some((x) => x.kills > 0), 'les kills sont tout de même comptés');
});

test('[TRN-6, TRN-5] gains par match gagné, bonus du champion, noms des tours', () => {
  assert.deepStrictEqual(Rules.tourneyReward(0), { xp: 0, gold: 0, chests: 0 });
  assert.deepStrictEqual(Rules.tourneyReward(1), { xp: 120, gold: 15, chests: 1 });
  assert.deepStrictEqual(Rules.tourneyReward(2), { xp: 120 + 180, gold: 15 + 25, chests: 2 });
  assert.deepStrictEqual(Rules.tourneyReward(4, true), { xp: 840 + 600, gold: 120 + 100, chests: 4 + 3 });
  // Plus on monte, plus on gagne
  for (let w = 1; w < 5; w++) assert.ok(Rules.tourneyReward(w + 1).xp - Rules.tourneyReward(w).xp > Rules.tourneyReward(w).xp - Rules.tourneyReward(w - 1).xp);
  assert.deepStrictEqual([1, 2, 3, 4, 5, 8, 9, 16].map(Rules.tourneyRoundName),
    ['Finale', 'Demi-finales', 'Quarts de finale', 'Quarts de finale', 'Huitièmes de finale', 'Huitièmes de finale', 'Seizièmes de finale', 'Seizièmes de finale']);
  assert.ok(Rules.COUNTERS.includes('tourneyWins') && Rules.MAX_COUNTERS.includes('tourneyBest'));
  assert.ok(Rules.ACHIEVEMENTS.some((a) => a.metric === 'tourneyWins' && a.goal === 1));
});
