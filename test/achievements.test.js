const test = require('node:test');
const assert = require('node:assert');
const { Rules, game } = require('./helpers');

// ---------- Succès ----------

test('[ACH-2, ACH-3] succès : progression, récupération, titre', () => {
  const c = game.newCharacter();
  const a = Rules.achievementById('chests1');
  assert.deepStrictEqual(Rules.achievementState(c, a), { value: 0, done: false, claimed: false });
  assert.throws(() => game.claimAchievement(c, 'chests1'), /pas encore/);
  assert.throws(() => game.setTitle(c, 'chests1'), /Termine/);
  c.chests = 1;
  game.openChest(c);
  assert.strictEqual(Rules.achievementState(c, a).done, true);
  assert.deepStrictEqual(game.claimAchievement(c, 'chests1'), { gold: a.gold });
  assert.strictEqual(c.gold, a.gold);
  assert.throws(() => game.claimAchievement(c, 'chests1'), /déjà/);
  game.setTitle(c, 'chests1');
  assert.strictEqual(game.titleOf(c), 'Curieux');
  game.setTitle(c, null);
  assert.strictEqual(game.titleOf(c), null);
});

test('[ACH-1, DB-7] succès : compteurs (recyclage, forge, relance, légendaires) et reprise des anciennes sauvegardes', () => {
  const c = game.newCharacter();
  c.gold = 1000;
  c.inventory = [0, 1, 2, 3].map(() => game.makeItem('commun'));
  game.recycle(c, [c.inventory[3].id]);
  game.fuse(c, c.inventory.map((i) => i.id));
  game.reroll(c, c.inventory[0].id, 0);
  assert.deepStrictEqual([c.counters.recycled, c.counters.fused, c.counters.rerolled], [1, 1, 1]);
  const old = game.newCharacter();
  delete old.counters; delete old.claimed; delete old.title;
  old.lootStats = { commun: 25, peu_commun: 3, rare: 1, epique: 0, legendaire: 1 };
  game.upgrade(old);
  assert.deepStrictEqual([old.counters.chests, old.counters.legendary, old.claimed.length, old.title], [10, 1, 0, null]);
});
