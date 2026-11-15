/*
 * Historique des parties et statistiques cumulées.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, game, db, Battle, testBattle, base } = require('./helpers');

test('[HIST-1, HIST-2] historique : une ligne par partie, photo du personnage, 50 au plus', () => {
  const c = game.newCharacter();
  c.cls = 'mage';
  const it = game.makeItem('epique', 'casque');
  c.inventory.push(it);
  game.equip(c, it.id);
  const e = game.recordActivity(c, { mode: 'br', outcome: 'win', rank: 1, total: 8, kills: 3, deaths: 0, dealt: 812, taken: 140, duration: 61, gains: { xp: 400, gold: 40, chests: 2 }, details: {} }, 1000);
  assert.strictEqual(c.history[0], e);
  assert.deepStrictEqual([e.mode, e.outcome, e.rank, e.total, e.kills, e.dealt, e.taken, e.at], ['br', 'win', 1, 8, 3, 812, 140, 1000]);
  assert.deepStrictEqual([e.level, e.cls], [1, 'mage']);
  assert.ok(e.power > 0);
  assert.deepStrictEqual(e.gear.casque, { name: it.name, rarity: 'epique', set: it.set || undefined });
  const d = game.derived(c);
  assert.strictEqual(e.stats.maxHp, Math.round(d.maxHp));
  for (const k of ['damage', 'attackSpeed', 'reduction', 'dodge', 'crit', 'speed', 'precision', 'lifesteal', 'thorns', 'luck']) assert.ok(k in e.stats, k);
  for (let i = 0; i < 60; i++) game.recordActivity(c, { mode: 'expedition', outcome: 'end', details: { depth: i } }, 2000 + i);
  assert.strictEqual(c.history.length, Rules.HISTORY.max);
  assert.strictEqual(c.history[0].details.depth, 59, 'la plus récente en premier');
});

test('[HIST-3] bataille : dégâts subis, dégâts sur les boss, morts et temps sur la colline', () => {
  const b = testBattle([{ key: 'a', name: 'A', stats: base() }, { key: 'b', name: 'B', stats: base({ maxHp: 2000 }) }]);
  const [a, bb] = b.players;
  b.hit(a, bb, 100);
  b.tick(0.05);
  assert.strictEqual(bb.taken, 100);
  assert.strictEqual(a.taken, 0);
  b.kill(a, bb);
  assert.strictEqual(bb.deaths, 1);
  // Dégâts sur un boss
  const boss = new Battle();
  boss.openQueue(60, 'boss', 'troll');
  clearTimeout(boss.queueTimer);
  boss.join({ key: 'p', name: 'P', level: 1, cls: 'guerrier', stats: Rules.derive({}, {}, 'guerrier'), look: {} });
  boss.start(null, null);
  boss.stopLoop();
  const p = boss.players[0];
  boss.hit(p, boss.boss, 50);
  boss.tick(0.05);
  assert.ok(p.bossDealt >= Math.round(50 * (1 - boss.boss.reduction)));
  // Roi de la Colline : temps sur la colline
  const k = new Battle();
  k.openQueue(60, 'koth');
  clearTimeout(k.queueTimer);
  for (const key of ['x', 'y']) k.join({ key, name: key, level: 1, stats: base({ speed: 0 }), look: {} });
  k.start(null, null);
  k.stopLoop();
  const x = k.players[0];
  x.x = k.koth.hill.x; x.y = k.koth.hill.y;
  k.players[1].x = 30; k.players[1].y = 30;
  for (const f of k.fighters) { f.cd = 99; }
  for (let i = 0; i < 20; i++) k.tick(0.05);
  assert.ok(Math.abs(x.hillTime - 1) < 0.06, `${x.hillTime}`);
});

test('[LIFE-1] statistiques cumulées : par mode, records, golds gagnés, objets, fusion d\'un fantôme', () => {
  const old = game.newCharacter();
  delete old.lifetime; delete old.lifetimeSince;
  game.upgrade(old);
  assert.strictEqual(old.lifetime.damageDealt, 0);
  assert.deepStrictEqual(old.lifetime.modes.br, { games: 0, wins: 0 });
  assert.ok(old.lifetimeSince > 0);
  assert.ok(old.stats && 'force' in old.stats, 'les points de caractéristiques ne sont pas touchés');
  const c = game.newCharacter();
  game.recordActivity(c, { mode: 'br', outcome: 'win', kills: 4, deaths: 0, dealt: 900, taken: 100, duration: 60 });
  game.recordActivity(c, { mode: 'koth', outcome: 'loss', kills: 1, deaths: 3, dealt: 300, taken: 500, duration: 150, details: { hillTime: 42 } });
  game.recordActivity(c, { mode: 'boss', outcome: 'win', kills: 0, dealt: 2000, taken: 300, bossDealt: 1800, duration: 80 });
  game.recordActivity(c, { mode: 'expedition', outcome: 'end', dealt: 500, duration: 200, details: { depth: 12 } });
  game.recordActivity(c, { mode: 'challenge', outcome: 'loss', dealt: 400, duration: 50 });
  game.recordActivity(c, { mode: 'rush', outcome: 'win', duration: 300, details: { killed: 3 } });
  game.recordActivity(c, { mode: 'dungeon', outcome: 'end', duration: 100, details: { room: 9 } });
  game.recordActivity(c, { mode: 'gold', outcome: 'end', duration: 75, details: { gold: 80 } });
  const L = c.lifetime;
  assert.deepStrictEqual(L.modes.br, { games: 1, wins: 1 });
  assert.deepStrictEqual(L.modes.koth, { games: 1, wins: 0 });
  assert.deepStrictEqual([L.losses, L.deaths, L.damageDealt, L.damageTaken, L.bossDamage], [1, 3, 4100, 900, 1800]);
  assert.deepStrictEqual([L.maxKills, L.maxDamage, L.hillTime, L.playTime], [4, 2000, 42, 1015]);
  assert.deepStrictEqual([L.expeditions, L.expeditionFloors, L.challenges, L.rushBosses, L.dungeonRooms, L.goldShower], [1, 12, 1, 3, 9, 80]);
  // Golds gagnés (pas les cadeaux de l'admin), objets obtenus
  game.grant(c, { xp: 0, gold: 120, chests: 0 });
  game.adminGive(c, { gold: 5000 });
  assert.strictEqual(L.goldEarned, 120);
  c.chests = 1;
  game.openChest(c);
  assert.strictEqual(L.itemsObtained, Rules.ITEMS_PER_CHEST);
  // Fusion d'un fantôme : additionnés, records au maximum, historiques réunis
  const ghost = game.newCharacter();
  game.recordActivity(ghost, { mode: 'br', outcome: 'loss', kills: 9, dealt: 100, duration: 30 }, 1);
  db.state.users.hg = { id: 'hg', ghost: true, twitchLogin: 'ghost_hist', role: 'player', character: ghost };
  const owner = { id: 'ho', username: 'ho', role: 'player', character: c };
  db.state.users.ho = owner;
  game.linkTwitch(owner, 'ghost_hist', 'G');
  assert.deepStrictEqual(owner.character.lifetime.modes.br, { games: 2, wins: 1 });
  assert.strictEqual(owner.character.lifetime.maxKills, 9);
  assert.strictEqual(owner.character.lifetime.damageDealt, 4200);
  assert.strictEqual(owner.character.history.length, 9);
  assert.strictEqual(owner.character.history[8].at, 1, 'triés du plus récent au plus ancien');
});
