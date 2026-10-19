const test = require('node:test');
const assert = require('node:assert');
const { Rules, game } = require('./helpers');

test('[CHEST-3] lumières du coffre : blanc, vert (4), bleu (6), violet (11), orange (21)', () => {
  const at = (n) => Rules.chestLightRarity(n);
  assert.strictEqual(at(3), 'commun');
  assert.strictEqual(at(4), 'peu_commun');
  assert.strictEqual(at(6), 'rare');
  assert.strictEqual(at(11), 'epique');
  assert.strictEqual(at(21), 'legendaire');
});

test('[CHEST-2] ouverture : clics requis = meilleure rareté du coffre', () => {
  const c = game.newCharacter();
  c.chests = 50;
  for (let i = 0; i < 50; i++) {
    const r = game.openChest(c);
    assert.strictEqual(r.items.length, Rules.ITEMS_PER_CHEST);
    assert.strictEqual(r.clicks, Rules.RARITY_INFO[r.bestRarity].clicks);
  }
  assert.strictEqual(c.chests, 0);
  assert.strictEqual(c.inventory.length, 150);
});

test('[CHEST-1] achat de coffre : 100 golds', () => {
  const c = game.newCharacter();
  c.gold = 250;
  game.buyChests(c, 2);
  assert.strictEqual(c.gold, 50);
  assert.strictEqual(c.chests, 2);
  assert.throws(() => game.buyChests(c, 1));
});

test('[EQP-1, EQP-2] équiper / retirer', () => {
  const c = game.newCharacter();
  const a = game.makeItem('rare', 'casque');
  const b = game.makeItem('commun', 'casque');
  c.inventory.push(a, b);
  game.equip(c, a.id);
  game.equip(c, b.id);
  assert.strictEqual(c.equipment.casque.id, b.id);
  assert.deepStrictEqual(c.inventory.map((i) => i.id), [a.id]);
  game.unequip(c, 'casque');
  assert.strictEqual(c.inventory.length, 2);
});

test('[CHEST-2] ouverture : lootStats mis à jour à chaque ouverture', () => {
  const c = game.newCharacter();
  c.chests = 10;
  for (let i = 0; i < 10; i++) game.openChest(c);
  const total = Object.values(c.lootStats).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 10 * Rules.ITEMS_PER_CHEST);
});

test('[EQP-3] recyclage : 3 golds par objet, quelle que soit la rareté', () => {
  const c = game.newCharacter();
  const items = ['commun', 'rare', 'legendaire'].map((r) => game.makeItem(r));
  const kept = game.makeItem('epique');
  c.inventory.push(...items, kept);
  const r = game.recycle(c, items.map((i) => i.id));
  assert.deepStrictEqual(r, { recycled: 3, gold: 9 });
  assert.strictEqual(c.gold, 9);
  assert.deepStrictEqual(c.inventory.map((i) => i.id), [kept.id]);
  assert.throws(() => game.recycle(c, []));
  assert.throws(() => game.recycle(c, ['inconnu']));
});

test('[EQP-3] recyclage : un objet équipé ne peut pas être recyclé', () => {
  const c = game.newCharacter();
  const item = game.makeItem('rare', 'ceinture');
  c.inventory.push(item);
  game.equip(c, item.id);
  assert.throws(() => game.recycle(c, [item.id]));
  assert.strictEqual(c.equipment.ceinture.id, item.id);
  assert.strictEqual(c.gold, 0);
});
