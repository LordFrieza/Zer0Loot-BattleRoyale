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

test('[ACH-4] succès des modes et du Solo : compteurs et migration des victoires contre le Troll', () => {
  for (const [id, metric] of [['dragon1', 'dragonWins'], ['sorcier1', 'sorcierWins'], ['koth1', 'kothWins'], ['clans1', 'clansWins'],
    ['mvp1', 'clansMvp'], ['gold100', 'goldBest'], ['expedition10', 'expeditionBest'], ['relics50', 'relics'],
    ['challenge1', 'challengeWins'], ['hero1', 'heroWins'], ['legend1', 'legendWins'], ['techs1', 'techs'], ['boss1', 'trollWins']]) {
    assert.strictEqual(Rules.achievementById(id).metric, metric, id);
  }
  assert.ok(Rules.MAX_COUNTERS.includes('goldBest'));
  // Ancienne sauvegarde : les victoires de boss deviennent des victoires contre le Troll
  const c = game.newCharacter();
  c.counters.bossWins = 4;
  delete c.counters.trollWins;
  game.upgrade(c);
  assert.strictEqual(c.counters.trollWins, 4);
  assert.strictEqual(Rules.achievementState(c, Rules.achievementById('boss1')).done, true);
  // Technique équipée
  const t = game.newCharacter();
  game.chooseClass(t, 'mage');
  t.level = 5;
  assert.strictEqual(Rules.achievementState(t, Rules.achievementById('techs1')).done, false);
  game.setTechniques(t, ['roulade']);
  assert.strictEqual(Rules.achievementState(t, Rules.achievementById('techs1')).done, true);
});

test('[ACH-4] succès « Technicien » : acquis même si on retire la technique', () => {
  const c = game.newCharacter();
  game.chooseClass(c, 'mage');
  c.level = 5;
  game.setTechniques(c, ['roulade']);
  game.setTechniques(c, []);
  assert.strictEqual(c.counters.techs, 1);
  assert.strictEqual(Rules.achievementState(c, Rules.achievementById('techs1')).done, true, 'reste terminé');
  // Ancienne sauvegarde avec une technique déjà équipée
  const old = game.newCharacter();
  old.techs = ['roulade'];
  delete old.counters.techs;
  game.upgrade(old);
  assert.strictEqual(old.counters.techs, 1);
});
