const test = require('node:test');
const assert = require('node:assert');
const { Rules, game } = require('./helpers');

test('[PRG-1] courbe d\'XP : 300, 500, 700, 900…', () => {
  assert.deepStrictEqual([1, 2, 3, 4].map(Rules.xpToNext), [300, 500, 700, 900]);
});

test('[PRG-2, PRG-3, PRG-4, PRG-5] récompenses ×3 des modes PvP et niveaux', () => {
  assert.deepStrictEqual(Rules.REWARDS.kill, { xp: 300, chests: 3, gold: 30 });
  assert.deepStrictEqual(Rules.REWARDS.win, { xp: 900, chests: 3, gold: 90 });
  assert.deepStrictEqual(Rules.REWARDS.participation, { xp: 100, chests: 0, gold: 0 });
  assert.deepStrictEqual(['firstblood', 'double', 'triple', 'massacre'].map((k) => Rules.REWARDS[k].chests), [3, 3, 0, 6]);
  assert.deepStrictEqual(Rules.COOP_PARTICIPATION, { xp: 25, chests: 0, gold: 0 }, 'coopération et Golden Shower : inchangé');
  const c = game.newCharacter();
  game.grant(c, Rules.REWARDS.kill); // 300 XP : niveau 2
  assert.deepStrictEqual([c.level, c.xp, c.gold, c.chests, c.skillPoints], [2, 0, 30, 3, 1]);
  game.grant(c, Rules.REWARDS.win); // 900 XP : 500 pour le niv. 3, reste 400
  assert.deepStrictEqual([c.level, c.xp, c.gold, c.chests], [3, 400, 120, 6]);
  game.addXp(c, 300 + 900); // niv. 4 (700) puis niv. 5 (900)
  assert.deepStrictEqual([c.level, c.xp, c.skillPoints], [5, 0, 4]);
});

test('[PRG-8] admin : don de golds, coffres et XP', () => {
  const c = game.newCharacter();
  const r = game.adminGive(c, { gold: 50, chests: 2, xp: 300 });
  assert.deepStrictEqual([c.gold, c.chests, c.level, r.levels], [50, 2, 2, 1]);
  assert.throws(() => game.adminGive(c, { gold: -5 }), /Rien/);
});

test('[PWR-1, PWR-2] puissance et bonus du plus faible (vie et dégâts), plafonné', () => {
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
  // Bonus du plus faible : √(puissance adverse ÷ la sienne), plafonné à ×1,75 ; jamais de malus pour le plus fort
  assert.strictEqual(Rules.POWER.underdog, 1.75);
  assert.strictEqual(Rules.powerUnderdog(30, 30), 1);
  assert.strictEqual(Rules.powerUnderdog(30, 20), 1.22);
  assert.strictEqual(Rules.powerUnderdog(90, 10), 1.75, 'plafond ×1,75');
  assert.strictEqual(Rules.powerUnderdog(10, 90), 1, 'le plus fort n\'est pas affaibli');
  assert.strictEqual(Rules.powerUnderdog(10, 0), 1);
  assert.strictEqual(Rules.rewardMultiplier, undefined, 'les récompenses ne dépendent plus de la puissance');
});

test('[PRG-9] niveau maximum 100 : plus de niveau ni de point, l\'XP reste à 0', () => {
  assert.strictEqual(Rules.MAX_LEVEL, 100);
  const c = game.newCharacter();
  c.level = 99;
  c.xp = 0;
  const sp = c.skillPoints;
  const levels = game.grant(c, { xp: Rules.xpToNext(99) * 5, gold: 10, chests: 1 });
  assert.strictEqual(levels, 1, 'un seul niveau gagné');
  assert.strictEqual(c.level, 100);
  assert.strictEqual(c.skillPoints, sp + 1);
  assert.strictEqual(c.xp, 0, 'le surplus d\'XP est perdu');
  assert.strictEqual(c.gold >= 10, true, 'les golds et coffres restent crédités');
  assert.strictEqual(game.grant(c, { xp: 1e6, gold: 0, chests: 0 }), 0);
  assert.strictEqual(c.level, 100);
  assert.strictEqual(c.xp, 0);
  // Un personnage déjà au-delà (ancienne sauvegarde) garde son niveau
  const old = game.newCharacter();
  old.level = 104;
  game.grant(old, { xp: 5000, gold: 0, chests: 0 });
  assert.strictEqual(old.level, 104);
  assert.strictEqual(old.xp, 0);
});
