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
  c.gold = 39;
  assert.throws(() => game.fuse(c, items.map((i) => i.id)), /40 golds/, 'la fusion est payante');
  c.gold = 100;
  assert.throws(() => game.fuse(c, [items[0].id, items[1].id]), /exactement 3/);
  assert.throws(() => game.fuse(c, [items[0].id, items[1].id, other.id]), /même rareté/);
  assert.throws(() => game.fuse(c, [items[0].id, items[1].id, 'x']), /introuvables/);
  const r = game.fuse(c, items.map((i) => i.id));
  assert.ok(['rare', 'epique'].includes(r.item.rarity));
  assert.strictEqual(r.upgraded, r.item.rarity === 'epique');
  assert.strictEqual(r.chance, 15);
  assert.strictEqual(r.price, 40);
  assert.strictEqual(c.gold, 60);
  assert.deepStrictEqual(c.inventory.map((i) => i.id).sort(), [other.id, r.item.id].sort());
  if (r.item.kind) assert.strictEqual(Rules.itemClass(r.item), 'archer');
});

test('[FRG-2] forge : taux d\'amélioration selon la rareté et la chance', () => {
  assert.strictEqual(Rules.fuseUpgradeChance('commun', 0), 40);
  assert.strictEqual(Rules.fuseUpgradeChance('epique', 20), 10, 'bonus de chance réduit de moitié vers Légendaire');
  assert.strictEqual(Rules.fuseUpgradeChance('epique', 999), 15);
  assert.strictEqual(Rules.fuseUpgradeChance('rare', 999), 35);
  assert.strictEqual(Rules.fuseUpgradeChance('legendaire', 85), 0);
  assert.deepStrictEqual(Rules.FUSE_PRICE, { commun: 10, peu_commun: 20, rare: 40, epique: 80, legendaire: 150 });
  const c = game.newCharacter();
  c.gold = 1e9;
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

// ---------- Alchimie noire ----------

test('[FRG-7] alchimie noire : sacrifie un objet de même rareté pour renforcer une ligne', () => {
  assert.deepStrictEqual(Rules.RARITIES.map((r) => Rules.ALCHEMY.price[r]), [15, 30, 60, 120, 250]);
  const c = game.newCharacter();
  game.chooseClass(c, 'guerrier');
  const target = game.makeItem('epique');
  target.lines[1].value = 11;
  const sac = game.makeItem('epique');
  c.inventory.push(target, sac);
  c.gold = 500;
  const stat = target.lines[1].stat;
  const r = game.alchemy(c, target.id, 1, sac.id);
  assert.strictEqual(target.lines[1].stat, stat, 'la stat ne change pas');
  assert.ok(r.gain >= 1 && r.gain <= 3);
  assert.strictEqual(target.lines[1].value, 11 + r.gain);
  assert.strictEqual(target.lines[1].alch, 1);
  assert.strictEqual(c.gold, 380);
  assert.ok(!c.inventory.some((i) => i.id === sac.id), 'objet sacrifié détruit');
  assert.strictEqual(c.counters.alchemy, 1);
  // Sur un objet équipé aussi
  const sword = game.makeItem('commun', 'arme', { cls: 'guerrier', ownChance: 1 });
  sword.lines[0].value = 1;
  c.inventory.push(sword, game.makeItem('commun'));
  game.equip(c, sword.id);
  const fodder = c.inventory.find((i) => i.rarity === 'commun');
  game.alchemy(c, sword.id, 0, fodder.id);
  assert.strictEqual(c.equipment.arme.lines[0].value, 2, '+1 pour un Commun');
  assert.ok(Rules.ACHIEVEMENTS.some((a) => a.id === 'alchemy10' && a.metric === 'alchemy' && a.goal === 10));
});

test('[FRG-8] alchimie noire : plafond et refus sans rien perdre', () => {
  assert.deepStrictEqual(Rules.RARITIES.map(Rules.alchemyCap), [4, 8, 14, 21, 35]);
  const c = game.newCharacter();
  game.chooseClass(c, 'mage');
  const target = game.makeItem('legendaire');
  target.lines[0].value = 34;
  const sacs = [game.makeItem('legendaire'), game.makeItem('legendaire')];
  const rare = game.makeItem('rare');
  c.inventory.push(target, ...sacs, rare);
  c.gold = 1000;
  const snapshot = () => JSON.stringify([c.gold, c.inventory.map((i) => i.id), target.lines]);
  const before = snapshot();
  assert.throws(() => game.alchemy(c, target.id, 0, rare.id), /même rareté/);
  assert.throws(() => game.alchemy(c, target.id, 0, target.id), /lui-même/);
  assert.throws(() => game.alchemy(c, target.id, 9, sacs[0].id), /Ligne introuvable/);
  assert.throws(() => game.alchemy(c, 'nope', 0, sacs[0].id), /Objet introuvable/);
  assert.throws(() => game.alchemy(c, target.id, 0, 'nope'), /sacrifier/);
  c.presets.push({ name: 'p', items: { anneau: sacs[0].id } });
  assert.throws(() => game.alchemy(c, target.id, 0, sacs[0].id), /protégé/);
  c.presets = [];
  c.gold = 249;
  assert.throws(() => game.alchemy(c, target.id, 0, sacs[0].id), /250 golds/);
  c.gold = 1000;
  assert.strictEqual(snapshot(), before, 'rien débité ni détruit');
  game.alchemy(c, target.id, 0, sacs[0].id);
  assert.strictEqual(target.lines[0].value, 35, 'plafonnée à 35');
  assert.throws(() => game.alchemy(c, target.id, 0, sacs[1].id), /maximum de l'alchimie \(35\)/);
  assert.strictEqual(c.gold, 750);
});
