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

test('[PWR-1, PWR-2] récompenses équilibrées : puissance, multiplicateur borné, coffres arrondis au hasard', () => {
  assert.strictEqual(Rules.powerScore(10, 168), 26.8);
  assert.strictEqual(Rules.powerScore(1, 0), 1);
  const c = game.newCharacter();
  c.level = 20;
  game.chooseClass(c, 'mage');
  const staff = game.makeItem('legendaire', 'arme', { kind: 'baton' });
  staff.lines = [{ stat: 'force', value: 20 }, { stat: 'vie', value: 10 }];
  c.inventory.push(staff);
  game.equip(c, staff.id);
  assert.strictEqual(game.powerOf(c), 20 + (30 + 7) / 10, 'lignes + bonus de classe (+7 Force)');
  assert.strictEqual(Rules.lookGearTotal({ casque: 'rare', arme: 'commun' }), 3 * 7 + 1 * 2);
  // Multiplicateur : adverse ÷ soi, entre ×0,4 et ×2
  assert.strictEqual(Rules.rewardMultiplier(30, 30), 1);
  assert.strictEqual(Rules.rewardMultiplier(20, 30), 1.5);
  assert.strictEqual(Rules.rewardMultiplier(10, 90), 2, 'plafond ×2');
  assert.strictEqual(Rules.rewardMultiplier(90, 10), 0.4, 'plancher ×0,4');
  assert.strictEqual(Rules.rewardMultiplier(0, 10), 1);
  // Application : XP et golds arrondis, coffres au hasard selon la partie décimale
  assert.deepStrictEqual(Rules.scaleReward({ xp: 300, gold: 30, chests: 1 }, 0.4, () => 0.39), { xp: 120, gold: 12, chests: 1 });
  assert.deepStrictEqual(Rules.scaleReward({ xp: 300, gold: 30, chests: 1 }, 0.4, () => 0.41), { xp: 120, gold: 12, chests: 0 });
  assert.deepStrictEqual(Rules.scaleReward({ xp: 100, gold: 10, chests: 2 }, 1.5, () => 0.99), { xp: 150, gold: 15, chests: 3 });
});
