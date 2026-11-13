const test = require('node:test');
const assert = require('node:assert');
const { Rules, game } = require('./helpers');

test('[CLS-3, CLS-4, CLS-5] classes : première classe gratuite, changement à 100 golds', () => {
  const c = game.newCharacter();
  assert.strictEqual(c.cls, null);
  assert.deepStrictEqual(game.chooseClass(c, 'mage'), { cost: 0, unequipped: 0, talentsReset: 0 });
  assert.throws(() => game.chooseClass(c, 'mage'), /déjà/);
  assert.throws(() => game.chooseClass(c, 'archer'), /100 golds/);
  assert.throws(() => game.chooseClass(c, 'ninja'), /inconnue/);
  c.gold = 150;
  assert.strictEqual(game.chooseClass(c, 'archer').cost, 100);
  assert.strictEqual(c.gold, 50);
  assert.strictEqual(c.cls, 'archer');
});

test('[CLS-2, CLS-6, CLS-8, EQP-1] classes : tout est équipable, bonus de classe sur les armes et objets secondaires', () => {
  assert.deepStrictEqual(Rules.CLASS_ITEM_BONUS.stat, { guerrier: 'defense', archer: 'precision', mage: 'force', assassin: 'critique', pretre: 'vie' });
  assert.deepStrictEqual(Rules.RARITIES.map((r) => Rules.CLASS_ITEM_BONUS.value[r]), [2, 3, 4, 5, 7]);
  const c = game.newCharacter();
  game.chooseClass(c, 'mage');
  const sword = game.makeItem('rare', 'arme', { kind: 'epee' });
  const staff = game.makeItem('epique', 'arme', { kind: 'baton' });
  const book = game.makeItem('rare', 'secondaire', { kind: 'grimoire' });
  const helmet = game.makeItem('rare', 'casque');
  for (const it of [sword, staff, book, helmet]) it.lines = [{ stat: 'vie', value: 5 }];
  c.inventory.push(sword, staff, book, helmet);
  game.equip(c, sword.id); // une épée de Guerrier sur un Mage : autorisé, sans bonus
  assert.strictEqual(game.gearBonus(c).force, 0);
  game.equip(c, staff.id); // bâton de Mage Épique : Force +5
  game.equip(c, book.id); // grimoire Rare : Force +4
  game.equip(c, helmet.id);
  assert.strictEqual(game.gearBonus(c).force, 9);
  assert.deepStrictEqual(Rules.classBonusOf(staff), { cls: 'mage', stat: 'force', value: 5 });
  assert.strictEqual(Rules.itemClassBonus(staff, 'guerrier'), null);
  assert.strictEqual(Rules.classBonusOf(helmet), null, 'pas de classe sur un casque');
  // Changement de classe : tout reste équipé, le bonus suit la classe
  c.gold = 100;
  assert.deepStrictEqual(game.chooseClass(c, 'guerrier'), { cost: 100, unequipped: 0, talentsReset: 0 });
  assert.deepStrictEqual(Object.keys(c.equipment).sort(), ['arme', 'casque', 'secondaire']);
  assert.strictEqual(game.gearBonus(c).force, 0);
  game.equip(c, sword.id);
  assert.strictEqual(game.gearBonus(c).defense, 4, 'épée Rare de Guerrier : Défense +4');
  const noClass = game.newCharacter();
  noClass.inventory.push(game.makeItem('commun', 'arme', { kind: 'arc' }));
  game.equip(noClass, noClass.inventory[0].id);
  assert.strictEqual(noClass.equipment.arme.kind, 'arc');
});

test('[DB-7] classes : anciennes épées / boucliers migrés en objets de Guerrier', () => {
  const c = game.newCharacter();
  delete c.cls;
  delete c.migratedSlots;
  c.inventory.push({ id: 'old1', slot: 'epee', rarity: 'rare', name: 'Lame', lines: [{ stat: 'force', value: 8 }] });
  c.equipment.bouclier = { id: 'old2', slot: 'bouclier', rarity: 'commun', name: 'Pavois', lines: [{ stat: 'vie', value: 2 }] };
  game.upgrade(c);
  assert.strictEqual(c.cls, null);
  assert.deepStrictEqual([c.inventory[0].slot, c.inventory[0].kind], ['arme', 'epee']);
  assert.strictEqual(c.equipment.bouclier, undefined);
  assert.deepStrictEqual([c.equipment.secondaire.slot, c.equipment.secondaire.kind], ['secondaire', 'bouclier']);
});

test('[CLS-2, STAT-2] classes : bonus de stats', () => {
  assert.strictEqual(Rules.derive({}, {}, 'guerrier').maxHp, 130);
  assert.strictEqual(Rules.derive({}, {}, 'mage').maxHp, 85);
  assert.strictEqual(Rules.derive({}, {}, 'mage').damage, 12.5);
  assert.ok(Math.abs(Rules.derive({}, {}, 'assassin').crit - 0.11) < 1e-9);
  // Lootassin : +15 pts de Précision et +1 pt de Vol de vie (bonus plats, comme la Précision de l'Archer)
  const as = Rules.derive({}, {}, 'assassin');
  assert.ok(Math.abs(as.precision - 0.20) < 1e-9, '5 % de base + 15');
  assert.ok(Math.abs(as.lifesteal - 0.03) < 1e-9, '2 % de base + 1');
  assert.strictEqual(as.maxHp, 90, '−10 % de Vie');
  assert.ok(Rules.CLASS_INFO.assassin.perks.includes('+15 % Précision') && Rules.CLASS_INFO.assassin.perks.includes('+1 % Vol de vie'));
  assert.ok(Math.abs(Rules.derive({}, {}, 'guerrier').lifesteal - 0.02) < 1e-9, 'les autres classes ne changent pas');
  assert.ok(Math.abs(Rules.derive({}, {}, 'mage').cooldown - 1.35) < 1e-9);
  assert.ok(Math.abs(Rules.derive({}, {}, 'archer').precision - 0.20) < 1e-9);
});
