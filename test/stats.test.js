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

test('[STAT-10] répartition en direct : déplacer des points, validation payante au point retiré', () => {
  const c = game.newCharacter();
  c.stats = { ...Rules.emptyStats(), force: 5, vie: 3 };
  c.skillPoints = 2;
  c.gold = 1000;
  // Placer ses points libres : gratuit
  assert.deepStrictEqual(game.respecStats(c, { esquive: 2 }), { price: 0, moved: 0, skillPoints: 0 });
  assert.strictEqual(c.stats.esquive, 2);
  // Déplacer 3 points de force vers la vitesse : 150 golds
  assert.deepStrictEqual(game.respecStats(c, { force: 2, vitesse: 3 }), { price: 150, moved: 3, skillPoints: 0 });
  assert.deepStrictEqual([c.stats.force, c.stats.vitesse, c.gold], [2, 3, 850]);
  // Retirer des points sans tout replacer : ils redeviennent libres (et c'est payant)
  assert.deepStrictEqual(game.respecStats(c, { vie: 0 }), { price: 150, moved: 3, skillPoints: 3 });
  // Plafond de 500 golds
  c.stats = { ...Rules.emptyStats(), force: 30 };
  c.skillPoints = 0;
  assert.strictEqual(game.respecStats(c, { force: 0, vie: 30 }).price, Rules.STAT_RESET.max);
  // Refus
  assert.throws(() => game.respecStats(c, { vie: 31 }), /que 30 point/);
  assert.throws(() => game.respecStats(c, { vie: -1, force: 31 }), /invalide/);
  assert.throws(() => game.respecStats(c, { vie: 1.5 }), /invalide/);
  assert.throws(() => game.respecStats(c, { magie: 1 }), /inconnue/);
  assert.throws(() => game.respecStats(c, {}), /Aucun changement/);
  c.gold = 10;
  assert.throws(() => game.respecStats(c, { vie: 29, force: 1 }), /50 golds/);
  assert.strictEqual(Rules.statPointsMoved({ force: 5, vie: 1 }, { force: 2, vie: 4 }), 3);
});

test('[STAT-11] plafonds : nombre de points à partir duquel une stat ne progresse plus (équipement et classe compris)', () => {
  for (const s of Rules.STATS) assert.ok(Rules.STAT_DETAILS[s] && Rules.STAT_DETAILS[s].per, `détail de ${s}`);
  for (const s of ['vie', 'force', 'defense']) assert.strictEqual(Rules.statCapAt(s, {}, {}, 'guerrier'), null, `${s} sans plafond`);
  // Sans bonus : vitesse 220 px/s à 32 points, critique 60 % à 30 points, chance 200
  assert.strictEqual(Rules.statCapAt('vitesse', {}, {}, 'guerrier'), 32);
  assert.strictEqual(Rules.statCapAt('critique', {}, {}, 'guerrier'), 30);
  assert.strictEqual(Rules.statCapAt('chance', {}, {}, 'guerrier'), Rules.LUCK_CAP);
  assert.strictEqual(Rules.statCapAt('chance', {}, { chance: 50 }, 'guerrier'), Rules.LUCK_CAP - 50, 'les bonus de Chance s\'ajoutent');
  // Les bonus d'équipement font atteindre le plafond plus tôt
  assert.ok(Rules.statCapAt('critique', {}, { critique: 50 }, 'guerrier') < 30);
  for (const s of Rules.STATS) {
    const at = Rules.statCapAt(s, {}, { critique: 20, esquive: 10 }, 'archer');
    if (at === null) continue;
    const key = Rules.STAT_DETAILS[s].key;
    const d = (n) => Rules.derive({ [s]: n }, { critique: 20, esquive: 10 }, 'archer')[key];
    assert.ok(d(at) >= Rules.STAT_DETAILS[s].max - 1e-9, `${s} plafonné à ${at}`);
    if (at > 0) assert.ok(d(at - 1) < d(at), `${s} progresse encore juste avant`);
    if (s === 'chance') assert.deepStrictEqual(Rules.lootTable(d(at + 5)), Rules.lootTable(d(at)), 'table de loot au plafond');
    else assert.strictEqual(d(at + 5), d(at), `${s} : un point de plus ne change rien`);
  }
});
