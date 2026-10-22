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

test('[STAT-9] remise à zéro des caractéristiques : 50 golds par point, 500 au maximum', () => {
  assert.deepStrictEqual([0, 1, 5, 10, 11, 40].map(Rules.statResetPrice), [0, 50, 250, 500, 500, 500]);
  const c = game.newCharacter();
  assert.throws(() => game.resetStats(c), /Aucun point/);
  c.skillPoints = 5;
  for (const st of ['force', 'force', 'vie', 'chance', 'stamina']) game.allocate(c, st);
  assert.strictEqual(c.skillPoints, 0);
  c.gold = 249;
  assert.throws(() => game.resetStats(c), /250 golds/);
  c.gold = 300;
  assert.deepStrictEqual(game.resetStats(c), { price: 250, refunded: 5 });
  assert.strictEqual(c.gold, 50);
  assert.strictEqual(c.skillPoints, 5);
  assert.ok(Rules.STATS.every((st) => c.stats[st] === 0));
  // Au-delà de 10 points, le prix reste plafonné
  c.skillPoints = 30;
  for (let i = 0; i < 30; i++) game.allocate(c, 'vie');
  c.gold = 600;
  assert.deepStrictEqual(game.resetStats(c), { price: 500, refunded: 30 });
  assert.strictEqual(c.gold, 100);
});
