const test = require('node:test');
const assert = require('node:assert');
const { Battle, testBattle, base } = require('./helpers');

test('[B-15] combat : les critiques doublent les dégâts', () => {
  const { Battle } = require('../server/battle');
  const stats = (crit) => ({ maxHp: 1e9, damage: 100, reduction: 0, speed: 0, dodge: 0, crit });
  const b = new Battle();
  b.openQueue(60);
  b.join({ key: 'a', name: 'A', level: 1, stats: stats(1), look: {} });
  b.join({ key: 'b', name: 'B', level: 1, stats: stats(0), look: {} });
  b.start();
  b.stopLoop();
  clearTimeout(b.queueTimer);
  const [a, bb] = b.fighters;
  const hits = [];
  for (let i = 0; i < 200; i++) { b.events = []; b.attack(a, bb); b.attack(bb, a); hits.push(...b.events); }
  const fromA = hits.filter((e) => e.from === 'a');
  const fromB = hits.filter((e) => e.from === 'b');
  assert.ok(fromA.every((e) => e.crit && e.dmg >= 170 && e.dmg <= 230));
  assert.ok(fromB.every((e) => !e.crit && e.dmg >= 85 && e.dmg <= 115));
});


test('[B-14, B-17, B-18] combat : vol de vie, épines, précision', () => {
  const b = testBattle([
    { key: 'a', name: 'A', stats: base({ lifesteal: 0.5, precision: 1 }) },
    { key: 'b', name: 'B', stats: base({ thorns: 0.5, dodge: 1 }) },
  ]);
  const [a, t] = b.fighters;
  a.hp = 500;
  b.attack(a, t);
  const hit = b.events.find((e) => e.t === 'hit');
  assert.ok(hit, 'précision 100 % : jamais esquivé');
  // a reçoit 50 % des dégâts en vol de vie puis 50 % en épines : il revient à 500
  const thorns = b.events.find((e) => e.t === 'thorns');
  assert.strictEqual(thorns.dmg, Math.round(hit.dmg * 0.5));
  assert.ok(Math.abs(a.hp - (500 + hit.dmg * 0.5 - thorns.dmg)) < 1e-9);
});

test('[B-19] combat : explosion du mage', () => {
  const b = testBattle([
    { key: 'm', name: 'M', cls: 'mage', stats: base() },
    { key: 't', name: 'T', stats: base() },
    { key: 'n', name: 'N', stats: base() },
    { key: 'far', name: 'F', stats: base() },
  ]);
  const [m, t, n, far] = b.fighters;
  Object.assign(t, { x: 500, y: 300 });
  Object.assign(n, { x: 540, y: 300 });
  Object.assign(far, { x: 900, y: 300 });
  b.attack(m, t);
  const hits = b.events.filter((e) => e.t === 'hit');
  assert.deepStrictEqual(hits.map((h) => h.to).sort(), ['n', 't']);
  assert.ok(b.events.some((e) => e.t === 'aoe'));
});

test('[STK-1, STK-2, STK-3] combat : premier kill, double kill, massacre', () => {
  const fighters = [{ key: 'k', name: 'K', userId: null, stats: base({ damage: 1e6 }) }];
  for (let i = 0; i < 6; i++) fighters.push({ key: 'v' + i, name: 'V' + i, stats: base() });
  const b = testBattle(fighters);
  const streaks = [];
  b.on('streak', (f, kind) => streaks.push(kind));
  const [k, ...victims] = b.fighters;
  b.time = 1; b.attack(k, victims[0]);
  b.time = 3; b.attack(k, victims[1]);
  b.time = 4; b.attack(k, victims[2]);
  b.time = 30; b.attack(k, victims[3]);
  b.time = 60; b.attack(k, victims[4]);
  assert.deepStrictEqual(streaks, ['firstblood', 'double', 'triple', 'massacre']);
  assert.strictEqual(k.kills, 5);
});
