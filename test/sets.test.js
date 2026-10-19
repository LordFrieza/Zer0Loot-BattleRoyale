const test = require('node:test');
const assert = require('node:assert');
const { Rules, game } = require('./helpers');

// ---------- Panoplies ----------

test('[SET-2] panoplies : paliers 2 / 4 / 6 / 8 pièces', () => {
  const eq = (n, set = 'nosferatu') => Object.fromEntries(Array.from({ length: n }, (_, i) => ['s' + i, { set }]));
  assert.strictEqual(Rules.setBonus(eq(1)).points.force, 0);
  assert.strictEqual(Rules.setBonus(eq(2)).points.force, 2);
  assert.strictEqual(Rules.setBonus(eq(3)).points.vol_de_vie, 2);
  assert.strictEqual(Rules.setBonus(eq(4)).points.force, 4);
  assert.strictEqual(Rules.setBonus(eq(6)).points.force, 7);
  assert.strictEqual(Rules.setBonus(eq(8)).points.force, 10);
  const mixed = Rules.setBonus({ a: { set: 'lynx' }, b: { set: 'lynx' }, c: { set: 'bastion' } });
  assert.deepStrictEqual([mixed.points.precision, mixed.points.critique, mixed.points.defense], [2, 2, 0]);
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
  for (let k = 0; k < 20; k++) {
    c.inventory = [0, 1, 2].map(() => game.makeItem('rare', null, { set: 'ouragan' }));
    assert.strictEqual(game.fuse(c, c.inventory.map((i) => i.id)).item.set, 'ouragan');
  }
});
