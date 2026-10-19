const test = require('node:test');
const assert = require('node:assert');
const { Rules, game } = require('./helpers');

test('[STAT-4] critique : 1 % de base, +2 % par point, bonus d\'équipement, plafond', () => {
  assert.strictEqual(Rules.derive({}).crit, 0.01);
  assert.strictEqual(Rules.derive({ critique: 10 }).crit, 0.21);
  assert.ok(Math.abs(Rules.derive({ critique: 10 }, { critique: 20 }).crit - 0.252) < 1e-9);
  assert.strictEqual(Rules.derive({ critique: 500 }).crit, Rules.CRIT_CAP / 100);
});

test('[DB-7, STAT-6] critique : anciens persos sans la stat', () => {
  const c = game.newCharacter();
  delete c.stats.critique;
  c.skillPoints = 1;
  assert.strictEqual(game.derived(c).crit, 0.01);
  game.allocate(c, 'critique');
  assert.strictEqual(c.stats.critique, 1);
});

test('[STAT-4] nouvelles stats : valeurs de base, points, plafonds', () => {
  const d0 = Rules.derive({});
  assert.strictEqual(d0.cooldown, 1);
  assert.strictEqual(d0.lifesteal, 0.02);
  assert.strictEqual(d0.precision, 0.05);
  assert.strictEqual(d0.thorns, 0.02);
  const d = Rules.derive({ vitesse_attaque: 10, vol_de_vie: 10, precision: 10, epines: 10 });
  assert.ok(Math.abs(d.cooldown - 1 / 1.5) < 1e-9);
  assert.ok(Math.abs(d.lifesteal - 0.17) < 1e-9);
  assert.ok(Math.abs(d.precision - 0.35) < 1e-9);
  assert.ok(Math.abs(d.thorns - 0.22) < 1e-9);
  const max = Rules.derive({ vitesse_attaque: 999, vol_de_vie: 999, precision: 999, epines: 999 });
  assert.deepStrictEqual([max.cooldown, max.lifesteal, max.precision, max.thorns], [0.4, 0.4, 0.8, 0.5]);
  for (const stat of Rules.STATS) assert.ok(Rules.describeDerived(stat, d));
});
