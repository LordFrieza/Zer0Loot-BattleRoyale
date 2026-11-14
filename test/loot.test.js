const test = require('node:test');
const assert = require('node:assert');
const { Rules, game } = require('./helpers');

test('[LOOT-3] table de loot : valeurs du cahier des charges', () => {
  assert.deepStrictEqual(Rules.lootTable(0), { commun: 90, peu_commun: 6.5, rare: 2.8, epique: 0.65, legendaire: 0.05 });
  assert.deepStrictEqual(Rules.lootTable(40), { commun: 73, peu_commun: 15, rare: 8.75, epique: 2.69, legendaire: 0.56 });
  assert.strictEqual(Rules.LUCK_CAP, 200);
  assert.deepStrictEqual(Rules.lootTable(200), { commun: 5, peu_commun: 49, rare: 32.55, epique: 10.85, legendaire: 2.6 }, 'les taux d\'avant à 85');
  assert.ok(Rules.lootTable(85).legendaire < 2.6, '85 de chance ne suffit plus pour le maximum');
});

test('[LOOT-3] table de loot : total à 100 % et plafond', () => {
  for (const luck of [0, 5, 33, 85, 137, 200, 500]) {
    const sum = Object.values(Rules.lootTable(luck)).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 100) < 1e-6, `luck ${luck} → ${sum}`);
  }
  assert.deepStrictEqual(Rules.lootTable(500), Rules.lootTable(Rules.LUCK_CAP));
});

test('[LOOT-2, LOOT-4] objets : nombre de lignes et bornes selon la rareté', () => {
  assert.deepStrictEqual(Rules.RARITIES.map((r) => [Rules.RARITY_INFO[r].min, Rules.RARITY_INFO[r].max]),
    [[1, 3], [2, 6], [4, 10], [5, 15], [6, 25]], 'fourchettes qui se chevauchent');
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

test('[LOOT-3, NFR-1] tirage réel conforme à la table de loot (chance 0 et 10)', () => {
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

test('[LOOT-5] coffres : une arme sur deux environ est pour sa classe', () => {
  let own = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) if (game.makeItem('commun', 'arme', { cls: 'mage' }).kind === 'baton') own += 1;
  // 50 % pour sa classe + 50 % × 1/5 au hasard = 60 %
  assert.ok(Math.abs(own / N - 0.6) < 0.04, `${own / N}`);
});

test('[STAT-5] chance : les bonus d\'équipement s\'ajoutent (même avec 0 point)', () => {
  assert.strictEqual(Rules.derive({ chance: 0 }, { chance: 1 }).luck, 1);
  assert.strictEqual(Rules.derive({ chance: 5 }, { chance: 10 }).luck, 15);
  assert.strictEqual(Rules.formatLine('chance', 3), '+3 Chance');
  assert.strictEqual(Rules.formatLine('vie', 8), '+8% Vie');
  // Effet réel : table de loot et forge
  const c = game.newCharacter();
  const ring = game.makeItem('commun', 'boucles');
  ring.lines = [{ stat: 'chance', value: 3 }];
  c.inventory.push(ring);
  game.equip(c, ring.id);
  assert.strictEqual(game.derived(c).luck, 3);
  assert.strictEqual(game.publicCharacter({ character: c }).lootTable.commun, 88.72);
  assert.strictEqual(Rules.fuseUpgradeChance('commun', game.derived(c).luck), 41.5);
});
