const test = require('node:test');
const assert = require('node:assert');
const { Rules, game } = require('./helpers');

// ---------- Forge ----------

test('[FRG-1, FRG-3] forge : fusion de 3 objets de même rareté', () => {
  const c = game.newCharacter();
  game.chooseClass(c, 'archer');
  const items = [0, 1, 2].map(() => game.makeItem('rare'));
  const other = game.makeItem('commun');
  c.inventory.push(...items, other);
  assert.throws(() => game.fuse(c, [items[0].id, items[1].id]), /exactement 3/);
  assert.throws(() => game.fuse(c, [items[0].id, items[1].id, other.id]), /même rareté/);
  assert.throws(() => game.fuse(c, [items[0].id, items[1].id, 'x']), /introuvables/);
  const r = game.fuse(c, items.map((i) => i.id));
  assert.ok(['rare', 'epique'].includes(r.item.rarity));
  assert.strictEqual(r.upgraded, r.item.rarity === 'epique');
  assert.strictEqual(r.chance, 20);
  assert.deepStrictEqual(c.inventory.map((i) => i.id).sort(), [other.id, r.item.id].sort());
  if (r.item.kind) assert.strictEqual(Rules.itemClass(r.item), 'archer');
});

test('[FRG-2] forge : taux d\'amélioration selon la rareté et la chance', () => {
  assert.strictEqual(Rules.fuseUpgradeChance('commun', 0), 40);
  assert.strictEqual(Rules.fuseUpgradeChance('epique', 20), 20);
  assert.strictEqual(Rules.fuseUpgradeChance('rare', 999), 45);
  assert.strictEqual(Rules.fuseUpgradeChance('legendaire', 85), 0);
  const c = game.newCharacter();
  let up = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const items = [0, 1, 2].map(() => game.makeItem('commun'));
    c.inventory = items;
    if (game.fuse(c, items.map((x) => x.id)).upgraded) up += 1;
  }
  assert.ok(Math.abs(up / N - 0.4) < 0.04, `${up / N}`);
  c.inventory = [0, 1, 2].map(() => game.makeItem('legendaire'));
  const r = game.fuse(c, c.inventory.map((x) => x.id));
  assert.strictEqual(r.item.rarity, 'legendaire');
  assert.strictEqual(r.upgraded, false);
});

test('[FRG-5, FRG-6] forge : relance d\'une ligne', () => {
  const c = game.newCharacter();
  const item = game.makeItem('epique', 'gants');
  c.inventory.push(item);
  assert.throws(() => game.reroll(c, item.id, 0), /80 golds/);
  c.gold = 200;
  assert.throws(() => game.reroll(c, item.id, 9), /Ligne/);
  const before = item.lines.map((l) => l.stat);
  const r = game.reroll(c, item.id, 2);
  assert.strictEqual(c.gold, 120);
  assert.ok(!before.includes(r.line.stat), 'nouvelle stat différente de toutes les lignes');
  assert.strictEqual(new Set(item.lines.map((l) => l.stat)).size, 4);
  assert.ok(r.line.value >= 11 && r.line.value <= 15);
  // Fonctionne aussi sur un objet équipé
  game.equip(c, item.id);
  game.reroll(c, item.id, 0);
  assert.strictEqual(c.gold, 40);
});
