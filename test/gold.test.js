/*
 * Ruée vers l'or (mode bonus) : pluie de pièces, coffres et bonus, ramassage, jackpot et récompenses.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, Battle, base } = require('./helpers');
const { Bets } = require('../server/bets');

function gold(players = 2, stats = () => base({ speed: 60 })) {
  const b = new Battle();
  b.openQueue(60, 'gold');
  clearTimeout(b.queueTimer);
  for (let i = 0; i < players; i++) b.join({ key: 'p' + i, name: 'P' + i, level: 1, stats: stats(i), look: {}, consumable: 'phenix' });
  return b;
}
function started(b) {
  b.start(null, 'meteors');
  b.stopLoop();
  return b;
}
const tickFor = (b, seconds) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) b.tick(0.05); };
// Les combattants restent sur place (leur destination est toujours leur position), pour piloter le ramassage à la main.
const still = (b) => { b.wanderSpot = (f) => ({ x: f.x, y: f.y }); for (const f of b.players) f.wander = null; };

test('[GOLD-1, MODE-3] ruée vers l\'or : 75 s, sans combat, dès 1 joueur, sans paris', () => {
  assert.strictEqual(Rules.GAME_MODES.gold.minPlayers, 1);
  const b = gold(3);
  assert.strictEqual(new Bets(b).open(), false, 'paris fermés');
  started(b);
  assert.strictEqual(b.event, null);
  const events = [];
  b.on('frame', (f) => events.push(...f.events));
  for (const f of b.players) Object.assign(f, { x: 640, y: 360 }); // tous au même endroit
  tickFor(b, 5);
  assert.ok(!events.some((e) => ['hit', 'kill', 'dodge', 'ult', 'potion'].includes(e.t)), 'aucun combat');
  assert.ok(b.players.every((f) => f.hp === f.maxHp && f.alive));
  let res = null;
  b.on('goldEnd', (r) => { res = r; });
  b.time = 74.96;
  b.tick(0.05);
  assert.strictEqual(res.mode, 'gold');
  assert.strictEqual(b.phase, 'ended');
});

test('[GOLD-2] ruée vers l\'or : débit de pièces, chute, durée au sol, coffres et bonus', () => {
  const b = started(gold(10));
  for (const f of b.players) Object.assign(f, { x: -500, y: -500 }); // hors de portée de tout
  still(b);
  let coins = 0;
  b.on('frame', (f) => { for (const e of f.events) if (e.t === 'coins') coins += e.list.length; });
  tickFor(b, 10);
  assert.ok(Math.abs(coins - 22 * 10) <= 2, `12 + 10 pièces par seconde (${coins})`);
  assert.ok(b.gold.coins.every((c) => Math.abs(c.die - c.land - 4) < 1e-9 && c.v === 1));
  assert.ok(b.gold.chests.length >= 1 && b.gold.items.length >= 1);
  const kinds = new Set();
  for (let i = 0; i < 300; i++) { b.gold.itemIn = 0; b.tick(0.05); }
  for (const it of b.gold.items) kinds.add(it.kind);
  assert.deepStrictEqual([...kinds].sort(), ['aimant', 'etoile', 'sac']);
  // Plafond de 40 pièces par seconde
  assert.strictEqual(started(gold(60)).goldRain(), 40);
});

test('[GOLD-2, GOLD-4] ruée vers l\'or : ramassage une fois au sol, rayon selon la Chance, bonus', () => {
  const b = started(gold(2));
  b.gold.chestIn = b.gold.itemIn = 999;
  const [lucky, plain] = b.players;
  lucky.luck = 20; // 22 + 30 = 52 px
  Object.assign(lucky, { x: 300, y: 300 });
  Object.assign(plain, { x: 900, y: 300 });
  still(b);
  b.gold.coinAcc = -1e9; // plus de pluie aléatoire
  const drop = (x, y, landIn = 0) => b.gold.coins.push({ id: ++b.gold.seq, x, y, land: b.time + landIn, die: b.time + landIn + 4, v: 1 });
  drop(340, 300); // à 40 px : seulement le chanceux
  drop(940, 300); // à 40 px du joueur sans Chance : trop loin (22 px)
  drop(310, 300, 0.5); // encore en train de tomber
  b.tick(0.05);
  assert.strictEqual(lucky.goldGot, 1);
  assert.strictEqual(plain.goldGot, 0);
  tickFor(b, 0.5);
  assert.strictEqual(lucky.goldGot, 2, 'ramassée une fois au sol');
  assert.strictEqual(Rules.goldPickup(100), 60, 'plafond');
  // Coffre et bonus
  b.gold.chests.push({ id: ++b.gold.seq, x: 300, y: 310, land: b.time, die: b.time + 8 });
  b.gold.items.push({ id: ++b.gold.seq, kind: 'sac', x: 905, y: 300, land: b.time, die: b.time + 7 });
  b.gold.items.push({ id: ++b.gold.seq, kind: 'aimant', x: 300, y: 290, land: b.time, die: b.time + 7 });
  b.tick(0.05);
  assert.strictEqual(lucky.chestsGot, 1);
  assert.strictEqual(plain.goldGot, 25, 'sac d\'or');
  assert.strictEqual(b.buffMult(lucky, 'pickup'), 3, 'aimant');
});

test('[GOLD-4] ruée vers l\'or : balade, attirance des coffres, vitesse selon la stat', () => {
  const b = started(gold(1, () => base({ speed: 120 })));
  b.gold.coinAcc = -1e9;
  b.gold.chestIn = b.gold.itemIn = 999;
  const [f] = b.players;
  Object.assign(f, { x: 600, y: 360 });
  b.gold.chests.push({ id: ++b.gold.seq, x: 700, y: 360, land: b.time + 1, die: b.time + 9 });
  b.tick(0.05);
  assert.deepStrictEqual(f.wander, { x: 700, y: 360 }, 'il fonce vers le coffre');
  const x0 = f.x;
  tickFor(b, 0.5);
  assert.ok(Math.abs(f.x - x0 - 95 * 1.6 * 0.5) < 3, 'vitesse plafonnée à ×1,6');
  // Sans rien autour : une destination au hasard, renouvelée
  b.gold.chests = [];
  f.wander = null;
  b.tick(0.05);
  assert.ok(f.wander && f.wanderUntil - b.time <= 3.5 && f.wanderUntil - b.time >= 1.4);
});

test('[GOLD-3] ruée vers l\'or : JACKPOT à 60 s, pluie ×3 et pièces à 2 golds', () => {
  const b = started(gold(10));
  const rate = b.goldRain();
  const events = [];
  b.on('frame', (f) => events.push(...f.events));
  b.time = 60;
  b.tick(0.05);
  assert.ok(events.some((e) => e.t === 'jackpot'));
  assert.strictEqual(b.goldRain(), rate * 3);
  tickFor(b, 1);
  assert.ok(b.gold.coins.length && b.gold.coins.filter((c) => c.land > 60.1).every((c) => c.v === 2));
});

test('[GOLD-5] ruée vers l\'or : classement par golds puis coffres, totaux et meilleur ramasseur', () => {
  const b = started(gold(3));
  const [a, c, d] = b.players;
  Object.assign(a, { goldGot: 40, chestsGot: 1 });
  Object.assign(c, { goldGot: 90, chestsGot: 0 });
  Object.assign(d, { goldGot: 40, chestsGot: 3 });
  let res = null;
  b.on('goldEnd', (r) => { res = r; });
  b.finishGold();
  assert.deepStrictEqual(res.ranking.map((r) => r.key), [c.key, d.key, a.key]);
  assert.deepStrictEqual(res.totals, { gold: 170, chests: 4 });
  assert.deepStrictEqual(res.best, { key: c.key, name: c.name, gold: 90, chests: 0 });
});
