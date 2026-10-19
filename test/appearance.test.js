const test = require('node:test');
const assert = require('node:assert');
const { Rules, game } = require('./helpers');

// ---------- Apparence & boutique ----------

test('[LOOK-1, LOOK-2, LOOK-3] apparence : options gratuites, cosmétiques à acheter', () => {
  const c = game.newCharacter();
  game.setLook(c, 'color', 'cyan');
  game.setLook(c, 'eyes', 'etoiles');
  game.setLook(c, 'color', null);
  assert.strictEqual(c.look.color, null);
  assert.throws(() => game.setLook(c, 'eyes', 'laser'), /inconnue/);
  assert.throws(() => game.setLook(c, 'nez', 'x'), /inconnue/);
  assert.throws(() => game.setLook(c, 'hat', 'couronne'), /Achète/);
  assert.throws(() => game.setLook(c, 'hat', 'bottes'), /inconnu/);
  assert.throws(() => game.buyCosmetic(c, 'couronne'), /1200 golds/);
  c.gold = 1300;
  assert.deepStrictEqual(game.buyCosmetic(c, 'couronne'), { price: 1200 });
  assert.strictEqual(c.gold, 100);
  assert.strictEqual(c.look.hat, 'couronne'); // porté directement
  assert.throws(() => game.buyCosmetic(c, 'couronne'), /déjà/);
  game.setLook(c, 'hat', null);
  game.setLook(c, 'hat', 'couronne');
  assert.strictEqual(Rules.achievementState(c, Rules.achievementById('cosmetics1')).done, true);
});

test('[DB-7] apparence : anciennes sauvegardes', () => {
  const c = game.newCharacter();
  delete c.look; delete c.owned;
  game.upgrade(c);
  assert.deepStrictEqual(c.look, Rules.DEFAULT_LOOK);
  assert.deepStrictEqual(c.owned, []);
});
