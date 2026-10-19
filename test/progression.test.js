const test = require('node:test');
const assert = require('node:assert');
const { Rules, game } = require('./helpers');

test('[PRG-1] courbe d\'XP : 300, 500, 700, 900…', () => {
  assert.deepStrictEqual([1, 2, 3, 4].map(Rules.xpToNext), [300, 500, 700, 900]);
});

test('[PRG-2, PRG-3] récompenses et niveaux', () => {
  const c = game.newCharacter();
  game.grant(c, Rules.REWARDS.kill); // 100 / 300
  assert.strictEqual(c.level, 1);
  assert.strictEqual(c.xp, 100);
  assert.strictEqual(c.gold, 10);
  assert.strictEqual(c.chests, 1);
  game.grant(c, Rules.REWARDS.win); // 400 XP : 300 pour le niv. 2, reste 100
  assert.strictEqual(c.level, 2);
  assert.strictEqual(c.xp, 100);
  assert.strictEqual(c.skillPoints, 1);
  assert.strictEqual(c.gold, 40);
  game.addXp(c, 400 + 700); // niv. 3 (500) puis niv. 4 (700)
  assert.strictEqual(c.level, 4);
  assert.strictEqual(c.xp, 0);
  assert.strictEqual(c.skillPoints, 3);
});

test('[PRG-8] admin : don de golds, coffres et XP', () => {
  const c = game.newCharacter();
  const r = game.adminGive(c, { gold: 50, chests: 2, xp: 300 });
  assert.deepStrictEqual([c.gold, c.chests, c.level, r.levels], [50, 2, 2, 1]);
  assert.throws(() => game.adminGive(c, { gold: -5 }), /Rien/);
});
