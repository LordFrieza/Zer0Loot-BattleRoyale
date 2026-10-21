/*
 * Catalogues et formules de shared/rules.js : classes, stats, emplacements, noms d'objets, panoplies.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Rules, game } = require('./helpers');

test('[CLS-1] classes : cinq classes, et le Vagaloot neutre sans classe', () => {
  assert.deepStrictEqual(Rules.CLASSES, ['guerrier', 'archer', 'mage', 'assassin', 'pretre']);
  const labels = Rules.CLASSES.map((c) => Rules.CLASS_INFO[c].label);
  assert.deepStrictEqual(labels, ['Guerriloot', 'Archiloot', 'Magiloot', 'Lootassin', 'Saint-Loot']);
  const roles = Rules.CLASSES.map((c) => Rules.CLASS_INFO[c].role);
  assert.deepStrictEqual(roles, ['Guerrier', 'Archer', 'Mage', 'Assassin', 'Prêtre']);
  for (const none of [null, undefined, 'inconnue']) {
    const info = Rules.classInfo(none);
    assert.strictEqual(info.label, 'Vagaloot');
    assert.strictEqual(info.combat.range, 40);
    assert.deepStrictEqual([info.bonus, info.flat], [{}, {}]);
  }
});

test('[STAT-1] stats : douze stats connues, chacune décrite', () => {
  assert.deepStrictEqual(Rules.STATS, [
    'vie', 'force', 'defense', 'vitesse', 'esquive', 'critique', 'vitesse_attaque', 'vol_de_vie', 'precision', 'epines', 'chance', 'stamina',
  ]);
  assert.deepStrictEqual(Object.keys(Rules.emptyStats()), Rules.STATS);
  for (const s of Rules.STATS) assert.ok(Rules.STAT_INFO[s].label);
});

test('[STAT-2, STAT-3] formules : PV, dégâts, armure, vitesse, esquive (avec multiplicateur et plafonds)', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
  const d = Rules.derive({ vie: 5, force: 3, defense: 2, vitesse: 4, esquive: 6 }, {});
  assert.strictEqual(d.maxHp, 150); // 100 + 10×5
  assert.strictEqual(d.damage, 16); // 10 + 2×3
  assert.strictEqual(d.armor, 11); // 5 + 3×2
  near(d.reduction, 11 / 111);
  assert.strictEqual(d.speed, 80); // 60 + 5×4
  near(d.dodge, 23 / 123); // r = 5 + 3×6

  // Multiplicateur = 1 + (équipement% + classe%)/100 : ici vie +50 % (équipement) +30 % (Guerrier) = ×1,8
  const m = Rules.derive({ vie: 5, defense: 2 }, { vie: 50, defense: 20 }, 'guerrier');
  assert.strictEqual(m.maxHp, Math.round(150 * 1.8));
  near(m.armor, 11 * (1 + (20 + 25) / 100));
  // Le multiplicateur ne devient jamais négatif
  assert.strictEqual(Rules.derive({}, { vie: -500 }).maxHp, 0);

  // Plafonds : vitesse 220, esquive 60 %
  assert.strictEqual(Rules.derive({ vitesse: 1000 }, {}).speed, 220);
  assert.strictEqual(Rules.derive({ esquive: 10000 }, {}).dodge, 0.6);
  // Valeurs de base (aucun point)
  const z = Rules.derive({}, {});
  assert.deepStrictEqual([z.maxHp, z.damage, z.armor, z.speed], [100, 10, 5, 60]);
  near(z.dodge, 5 / 105);
});

test('[SYS-5] règles : le fichier shared/rules.js se charge à l\'identique sans module (navigateur)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'rules.js'), 'utf8');
  const sandbox = {};
  sandbox.self = sandbox; // comme `window` / `self` dans un navigateur : pas de `module`
  vm.runInNewContext(src, sandbox);
  assert.ok(sandbox.Rules, 'global Rules défini');
  const clone = (x) => JSON.parse(JSON.stringify(x));
  assert.deepStrictEqual(clone(sandbox.Rules.lootTable(10)), Rules.lootTable(10));
  assert.deepStrictEqual(clone(sandbox.Rules.derive({ vie: 3 }, { vie: 10 }, 'mage')), Rules.derive({ vie: 3 }, { vie: 10 }, 'mage'));
  assert.deepStrictEqual(Object.keys(sandbox.Rules).sort(), Object.keys(Rules).sort());
});

test('[LOOT-1] emplacements : huit emplacements d\'équipement', () => {
  assert.deepStrictEqual(Rules.SLOTS, ['casque', 'plastron', 'gants', 'ceinture', 'pantalon', 'boucles', 'arme', 'secondaire']);
  for (const s of Rules.SLOTS) assert.ok(Rules.SLOT_INFO[s].label);
});

test('[LOOT-7] nom d\'objet : base, préfixe de rareté, puis suffixe de panoplie ou de première stat', () => {
  for (const rarity of Rules.RARITIES) {
    const plain = game.makeItem(rarity, 'casque', { set: null });
    const prefix = Rules.RARITY_PREFIX[rarity];
    const expected = [plain.base, prefix, Rules.STAT_SUFFIX[plain.lines[0].stat]].filter(Boolean).join(' ');
    assert.strictEqual(plain.name, expected);
    assert.ok(!plain.name.includes('  '));

    const set = game.makeItem(rarity, 'casque', { set: 'bastion' });
    assert.strictEqual(set.name, [set.base, prefix, 'du Bastion'].filter(Boolean).join(' '));
  }
  assert.match(game.makeItem('legendaire', 'gants', { set: null }).name, / Divin /);
});

test('[SET-1] panoplies : six panoplies, chacune liée à deux stats distinctes', () => {
  assert.deepStrictEqual(Object.keys(Rules.SETS).sort(), ['bastion', 'fortune', 'lynx', 'nosferatu', 'ouragan', 'ronces']);
  assert.deepStrictEqual(Object.values(Rules.SETS).map((s) => s.label).sort(), ['Bastion', 'Fortune', 'Nosferatu', 'Ouragan', 'Ronces', 'Œil de Lynx']);
  for (const s of Object.values(Rules.SETS)) {
    assert.strictEqual(s.stats.length, 2);
    assert.notStrictEqual(s.stats[0], s.stats[1]);
    for (const st of s.stats) assert.ok(Rules.STATS.includes(st));
  }
});

test('[LOOK-4] cosmétiques : purement visuels, ils ne changent ni les stats ni l\'équipement', () => {
  for (const item of Object.values(Rules.COSMETICS)) {
    assert.ok(Rules.COSMETIC_SLOTS[item.slot]);
    assert.strictEqual(item.lines, undefined, 'aucune ligne de stat');
    assert.strictEqual(item.stats, undefined);
  }
  const c = game.newCharacter();
  c.inventory.push(game.makeItem('epique', 'casque', { set: null }));
  game.equip(c, c.inventory[0].id);
  const before = JSON.stringify(game.derived(c));
  c.gold = 5000;
  game.buyCosmetic(c, 'couronne'); // chapeau porté directement après l'achat
  assert.strictEqual(c.look.hat, 'couronne');
  assert.ok(c.equipment.casque, 'le casque reste équipé');
  assert.strictEqual(JSON.stringify(game.derived(c)), before);
});
