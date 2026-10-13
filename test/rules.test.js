const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zl-test-'));
const Rules = require('../shared/rules');
const game = require('../server/game');

test('table de loot : valeurs du cahier des charges', () => {
  assert.deepStrictEqual(Rules.lootTable(0), { commun: 90, peu_commun: 6, rare: 3, epique: 0.9, legendaire: 0.1 });
  assert.deepStrictEqual(Rules.lootTable(10), { commun: 80, peu_commun: 10, rare: 6, epique: 3, legendaire: 1 });
});

test('table de loot : total à 100 % et plafond', () => {
  for (const luck of [0, 5, 33, 85, 500]) {
    const sum = Object.values(Rules.lootTable(luck)).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 100) < 1e-6, `luck ${luck} → ${sum}`);
  }
  assert.deepStrictEqual(Rules.lootTable(500), Rules.lootTable(Rules.LUCK_CAP));
});

test('objets : nombre de lignes et bornes selon la rareté', () => {
  for (const rarity of Rules.RARITIES) {
    const info = Rules.RARITY_INFO[rarity];
    for (let i = 0; i < 200; i++) {
      const item = game.makeItem(rarity);
      assert.strictEqual(item.lines.length, info.lines);
      assert.strictEqual(new Set(item.lines.map((l) => l.stat)).size, info.lines, 'stats distinctes');
      for (const l of item.lines) assert.ok(l.value >= info.min && l.value <= info.max);
      assert.ok(Rules.SLOTS.includes(item.slot));
    }
  }
});

test('lumières du coffre : blanc, vert (4), bleu (6), violet (11), orange (21)', () => {
  const at = (n) => Rules.chestLightRarity(n);
  assert.strictEqual(at(3), 'commun');
  assert.strictEqual(at(4), 'peu_commun');
  assert.strictEqual(at(6), 'rare');
  assert.strictEqual(at(11), 'epique');
  assert.strictEqual(at(21), 'legendaire');
});

test('ouverture : clics requis = meilleure rareté du coffre', () => {
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

test('courbe d\'XP : 300, 500, 700, 900…', () => {
  assert.deepStrictEqual([1, 2, 3, 4].map(Rules.xpToNext), [300, 500, 700, 900]);
});

test('récompenses et niveaux', () => {
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

test('critique : 1 % de base, +2 % par point, bonus d\'équipement, plafond', () => {
  assert.strictEqual(Rules.derive({}).crit, 0.01);
  assert.strictEqual(Rules.derive({ critique: 10 }).crit, 0.21);
  assert.ok(Math.abs(Rules.derive({ critique: 10 }, { critique: 20 }).crit - 0.252) < 1e-9);
  assert.strictEqual(Rules.derive({ critique: 500 }).crit, Rules.CRIT_CAP / 100);
});

test('critique : anciens persos sans la stat', () => {
  const c = game.newCharacter();
  delete c.stats.critique;
  c.skillPoints = 1;
  assert.strictEqual(game.derived(c).crit, 0.01);
  game.allocate(c, 'critique');
  assert.strictEqual(c.stats.critique, 1);
});

test('combat : les critiques doublent les dégâts', () => {
  const { Battle } = require('../server/battle');
  const stats = (crit) => ({ maxHp: 1e9, damage: 100, reduction: 0, speed: 0, dodge: 0, crit });
  const b = new Battle();
  b.openQueue(60);
  b.join({ key: 'a', name: 'A', level: 1, stats: stats(1), look: {} });
  b.join({ key: 'b', name: 'B', level: 1, stats: stats(0), look: {} });
  b.start();
  b.stopLoop();
  clearTimeout(b.queueTimer);
  const [a, bb] = b.fighters;
  const hits = [];
  for (let i = 0; i < 200; i++) { b.events = []; b.attack(a, bb); b.attack(bb, a); hits.push(...b.events); }
  const fromA = hits.filter((e) => e.from === 'a');
  const fromB = hits.filter((e) => e.from === 'b');
  assert.ok(fromA.every((e) => e.crit && e.dmg >= 170 && e.dmg <= 230));
  assert.ok(fromB.every((e) => !e.crit && e.dmg >= 85 && e.dmg <= 115));
});

test('achat de coffre : 100 golds', () => {
  const c = game.newCharacter();
  c.gold = 250;
  game.buyChests(c, 2);
  assert.strictEqual(c.gold, 50);
  assert.strictEqual(c.chests, 2);
  assert.throws(() => game.buyChests(c, 1));
});

test('équiper / retirer', () => {
  const c = game.newCharacter();
  const a = game.makeItem('rare', 'epee');
  const b = game.makeItem('commun', 'epee');
  c.inventory.push(a, b);
  game.equip(c, a.id);
  game.equip(c, b.id);
  assert.strictEqual(c.equipment.epee.id, b.id);
  assert.deepStrictEqual(c.inventory.map((i) => i.id), [a.id]);
  game.unequip(c, 'epee');
  assert.strictEqual(c.inventory.length, 2);
});

test('tirage réel conforme à la table de loot (chance 0 et 10)', () => {
  const N = 400000;
  for (const luck of [0, 10]) {
    const expected = Rules.lootTable(luck);
    const counts = Object.fromEntries(Rules.RARITIES.map((r) => [r, 0]));
    for (let i = 0; i < N; i++) counts[game.rollRarity(luck)] += 1;
    for (const r of Rules.RARITIES) {
      const p = expected[r] / 100;
      const observed = counts[r] / N;
      const tolerance = 5 * Math.sqrt((p * (1 - p)) / N); // 5 écarts-types
      assert.ok(Math.abs(observed - p) <= tolerance, `chance ${luck}, ${r} : ${(observed * 100).toFixed(3)} % au lieu de ${expected[r]} %`);
    }
  }
});

test('historique des tirages enregistré à chaque ouverture', () => {
  const c = game.newCharacter();
  c.chests = 10;
  for (let i = 0; i < 10; i++) game.openChest(c);
  const total = Object.values(c.lootStats).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 10 * Rules.ITEMS_PER_CHEST);
});

test('recyclage : 1 gold par objet, quelle que soit la rareté', () => {
  const c = game.newCharacter();
  const items = ['commun', 'rare', 'legendaire'].map((r) => game.makeItem(r));
  const kept = game.makeItem('epique');
  c.inventory.push(...items, kept);
  const r = game.recycle(c, items.map((i) => i.id));
  assert.deepStrictEqual(r, { recycled: 3, gold: 3 });
  assert.strictEqual(c.gold, 3);
  assert.deepStrictEqual(c.inventory.map((i) => i.id), [kept.id]);
  assert.throws(() => game.recycle(c, []));
  assert.throws(() => game.recycle(c, ['inconnu']));
});

test('recyclage : un objet équipé ne peut pas être recyclé', () => {
  const c = game.newCharacter();
  const item = game.makeItem('rare', 'epee');
  c.inventory.push(item);
  game.equip(c, item.id);
  assert.throws(() => game.recycle(c, [item.id]));
  assert.strictEqual(c.equipment.epee.id, item.id);
  assert.strictEqual(c.gold, 0);
});
