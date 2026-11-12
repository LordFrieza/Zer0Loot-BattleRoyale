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

test('[CLS-2, CLS-6, EQP-1] classes : armes réservées, objets incompatibles retirés au changement', () => {
  const c = game.newCharacter();
  game.chooseClass(c, 'mage');
  const sword = game.makeItem('rare', 'arme', { kind: 'epee' });
  const staff = game.makeItem('rare', 'arme', { kind: 'baton' });
  const book = game.makeItem('rare', 'secondaire', { kind: 'grimoire' });
  const helmet = game.makeItem('rare', 'casque');
  c.inventory.push(sword, staff, book, helmet);
  assert.throws(() => game.equip(c, sword.id), /Guerriloot/);
  game.equip(c, staff.id);
  game.equip(c, book.id);
  game.equip(c, helmet.id);
  c.gold = 100;
  assert.deepStrictEqual(game.chooseClass(c, 'guerrier'), { cost: 100, unequipped: 2, talentsReset: 0 });
  assert.deepStrictEqual(Object.keys(c.equipment), ['casque']);
  game.equip(c, sword.id);
  assert.strictEqual(c.equipment.arme.kind, 'epee');
  const noClass = game.newCharacter();
  noClass.inventory.push(game.makeItem('commun', 'arme', { kind: 'arc' }));
  assert.throws(() => game.equip(noClass, noClass.inventory[0].id));
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
