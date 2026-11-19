const test = require('node:test');
const assert = require('node:assert');
const { Rules, game } = require('./helpers');

// ---------- Panoplies ----------

test('[SET-2, SET-3] panoplies : paliers 2 / 4 / 6 / 8 pièces, Fortune doublée', () => {
  const eq = (n, set = 'nosferatu') => Object.fromEntries(Array.from({ length: n }, (_, i) => ['s' + i, { set }]));
  assert.strictEqual(Rules.setBonus(eq(1)).points.force, 0);
  assert.strictEqual(Rules.setBonus(eq(2)).points.force, 2);
  assert.strictEqual(Rules.setBonus(eq(3)).points.vol_de_vie, 2);
  assert.strictEqual(Rules.setBonus(eq(4)).points.force, 4);
  assert.strictEqual(Rules.setBonus(eq(6)).points.force, 7);
  assert.strictEqual(Rules.setBonus(eq(8)).points.force, 10);
  const mixed = Rules.setBonus({ a: { set: 'lynx' }, b: { set: 'lynx' }, c: { set: 'bastion' } });
  assert.deepStrictEqual([mixed.points.precision, mixed.points.critique, mixed.points.defense], [2, 2, 0]);
  // Fortune : points doublés (+4 / +8 / +14 / +20 en Chance et en Esquive)
  assert.deepStrictEqual([2, 3, 4, 6, 8].map((n) => [Rules.setBonus(eq(n, 'fortune')).points.chance, Rules.setBonus(eq(n, 'fortune')).points.esquive]),
    [[4, 4], [4, 4], [8, 8], [14, 14], [20, 20]]);
  assert.deepStrictEqual(Rules.setBonus(eq(5, 'fortune')).sets[0].next, { pieces: 6, points: 14 }, 'prochain palier');
  assert.deepStrictEqual(Rules.setTiers('fortune').map((t) => t.points), [4, 8, 14, 20]);
  assert.strictEqual(Rules.setTiers('lynx'), Rules.SET_TIERS);
});

test('[SET-2] panoplies : le bonus s\'ajoute aux stats du personnage', () => {
  const c = game.newCharacter();
  const base = game.derived(c).damage;
  for (const slot of ['casque', 'gants']) {
    const it = game.makeItem('commun', slot, { set: 'nosferatu' });
    it.lines = [{ stat: 'vie', value: 1 }];
    c.inventory.push(it);
    game.equip(c, it.id);
  }
  assert.strictEqual(game.derived(c).damage, base + 2 * 2); // +2 points de Force = +4 dégâts
  assert.ok(/de Nosferatu$/.test(c.equipment.casque.name));
});

test('[LOOT-6, FRG-4] panoplies : taux d\'apparition et fusion de 3 pièces identiques', () => {
  let n = 0;
  for (let i = 0; i < 5000; i++) if (game.makeItem('legendaire').set) n += 1;
  assert.ok(Math.abs(n / 5000 - Rules.SET_DROP_CHANCE.legendaire) < 0.03, `${n / 5000}`);
  const c = game.newCharacter();
  game.chooseClass(c, 'mage');
  c.gold = 1e6;
  for (let k = 0; k < 20; k++) {
    c.inventory = [0, 1, 2].map(() => game.makeItem('rare', null, { set: 'ouragan' }));
    assert.strictEqual(game.fuse(c, c.inventory.map((i) => i.id)).item.set, 'ouragan');
  }
});
