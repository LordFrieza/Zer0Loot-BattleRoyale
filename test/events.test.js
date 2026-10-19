const test = require('node:test');
const assert = require('node:assert');
const { Battle, testBattle, base } = require('./helpers');

// ---------- Événements de bataille ----------

test('[EVT-3, EVT-4, B-23] événements : zone rapide (×5) et météores', () => {
  const b = testBattle([
    { key: 'a', name: 'A', stats: base({ speed: 60 }) },
    { key: 'b', name: 'B', stats: base({ speed: 60 }) },
  ]);
  assert.strictEqual(b.fighters[0].speed, 60);
  const { Battle } = require('../server/battle');
  const fast = new Battle();
  fast.openQueue(60); clearTimeout(fast.queueTimer);
  fast.join({ key: 'a', name: 'A', level: 1, look: {}, stats: base({ speed: 60 }) });
  fast.join({ key: 'b', name: 'B', level: 1, look: {}, stats: base({ speed: 60 }) });
  fast.start(null, 'fast'); fast.stopLoop();
  assert.strictEqual(fast.fighters[0].speed, 300);
  assert.strictEqual(fast.publicQueue().event, 'fast');
  // Météore : 12 + 15 % de la vie max, sans tuer le dernier survivant
  const [a, t] = b.fighters;
  Object.assign(a, { x: 100, y: 100 }); Object.assign(t, { x: 900, y: 600 });
  b.meteorImpact({ x: 100, y: 100, r: 70 });
  assert.strictEqual(a.hp, 1000 - (12 + 150));
  assert.strictEqual(t.hp, 1000);
});

test('[EVT-2, B-8] événements : brouillard, on ne cible un ennemi caché que de près', () => {
  const { Battle } = require('../server/battle');
  const b = new Battle();
  b.openQueue(60); clearTimeout(b.queueTimer);
  for (const k of ['a', 'near', 'hidden']) b.join({ key: k, name: k, level: 1, look: {}, stats: base({ speed: 0, damage: 0 }) });
  b.start(null, 'fog'); b.stopLoop();
  const [a, near, hidden] = b.fighters;
  Object.assign(a, { x: 300, y: 300 }); Object.assign(hidden, { x: 400, y: 300 }); Object.assign(near, { x: 600, y: 300 });
  b.fogs = [{ x: 400, y: 300, r: 60, age: 5, a: 1 }];
  b.nextFog = 99;
  b.tick(0.05);
  assert.strictEqual(a.targetKey, 'near'); // le plus proche est caché dans le brouillard
  b.fogs = [];
  b.tick(0.05);
  assert.strictEqual(a.targetKey, 'hidden');
});
