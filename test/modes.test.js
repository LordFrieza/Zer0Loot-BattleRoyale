const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zl-test-modes-'));
const Rules = require('../shared/rules');
const { Battle } = require('../server/battle');
const { Bets } = require('../server/bets');

// Bataille prête à être pilotée à la main (sans minuterie).
function setup(mode, players, statsOf = () => Rules.derive({}, {}, 'guerrier')) {
  const b = new Battle();
  b.openQueue(60, mode);
  clearTimeout(b.queueTimer);
  for (let i = 0; i < players; i++) b.join({ key: 'p' + i, name: 'P' + i, level: 1, cls: 'guerrier', stats: statsOf(i), look: {} });
  return b;
}

function run(b, maxSeconds = 1200) {
  let out = null;
  b.on('coopEnd', (r) => { out = r; });
  b.start(null, 'meteors');
  b.stopLoop();
  for (let i = 0; i < maxSeconds * 20 && !out; i++) b.tick(0.05);
  return out;
}

test('modes : liste et mode inconnu refusé', () => {
  assert.deepStrictEqual(Object.keys(Rules.GAME_MODES), ['br', 'boss', 'dungeon']);
  const b = new Battle();
  assert.throws(() => b.openQueue(60, 'pique-nique'), /inconnu/);
  b.openQueue(60, 'boss');
  clearTimeout(b.queueTimer);
  assert.strictEqual(b.publicQueue().mode, 'boss');
});

test('boss : vie et dégâts selon le nombre de combattants', () => {
  const s1 = Rules.bossStats(1);
  const s10 = Rules.bossStats(10);
  assert.strictEqual(s10.maxHp, Rules.BOSS.hpBase + 10 * Rules.BOSS.hpPerPlayer);
  assert.ok(s10.maxHp > s1.maxHp && s10.damage > s1.damage);
});

test('boss : un seul combattant suffit, personne ne se tape dessus, pas d\'événement', () => {
  const b = setup('boss', 4);
  b.start(null, 'meteors');
  b.stopLoop();
  assert.strictEqual(b.event, null, 'les événements sont réservés au Battle Royale');
  assert.ok(b.boss && b.fighters.includes(b.boss));
  for (let i = 0; i < 100; i++) {
    b.tick(0.05);
    for (const f of b.players) assert.strictEqual(f.targetKey === null || f.targetKey === 'boss', true);
  }
  const playerKeys = new Set(b.players.map((p) => p.key));
  // Aucun coup entre combattants
  b.on('frame', (fr) => fr.events.forEach((e) => {
    if (e.t === 'hit' && e.from && e.to) assert.ok(!(playerKeys.has(e.from) && playerKeys.has(e.to)));
  }));
  for (let i = 0; i < 200; i++) b.tick(0.05);
});

test('boss : les coches de 66 % et 33 % renforcent le Troll', () => {
  const b = setup('boss', 3);
  b.start();
  b.stopLoop();
  const boss = b.boss;
  const cd = boss.cooldown;
  boss.hp = boss.maxHp * 0.6;
  b.tick(0.05);
  assert.strictEqual(boss.phase, 1);
  assert.ok(boss.dmgMult > 1 && boss.cooldown < cd);
  boss.hp = boss.maxHp * 0.3;
  b.tick(0.05);
  assert.strictEqual(boss.phase, 2);
});

test('boss : victoire = récompense pour tous, défaite = rien', () => {
  const strong = () => ({ ...Rules.derive({}, {}, 'guerrier'), maxHp: 1e6, damage: 5000 });
  const win = run(setup('boss', 3, strong));
  assert.strictEqual(win.victory, true);
  assert.deepStrictEqual(win.reward, Rules.BOSS.reward);
  assert.strictEqual(win.ranking.length, 3);

  const weak = () => ({ ...Rules.derive({}, {}, 'guerrier'), maxHp: 5, damage: 0.1 });
  const lose = run(setup('boss', 3, weak));
  assert.strictEqual(lose.victory, false);
  assert.strictEqual(lose.reward, null);
});

test('donjon : récompenses par palier de salle atteinte', () => {
  assert.strictEqual(Rules.dungeonReward(4), null);
  assert.deepStrictEqual(Rules.dungeonReward(5), { tier: 5, xp: 50, gold: 50, chests: 0 });
  assert.deepStrictEqual(Rules.dungeonReward(12), { tier: 10, xp: 150, gold: 150, chests: 0 });
  assert.deepStrictEqual(Rules.dungeonReward(15), { tier: 15, xp: 300, gold: 300, chests: 1 });
  assert.deepStrictEqual(Rules.dungeonReward(20), { tier: 20, xp: 500, gold: 500, chests: 2 });
  assert.deepStrictEqual(Rules.dungeonReward(27), { tier: 25, xp: 750, gold: 750, chests: 3 });
});

test('donjon : salles de plus en plus peuplées, un chef toutes les 5 salles', () => {
  const avg = (room) => {
    let n = 0;
    for (let i = 0; i < 50; i++) n += Rules.dungeonRoom(room, 10).length;
    return n / 50;
  };
  assert.ok(avg(10) > avg(1));
  assert.ok(Rules.dungeonRoom(5, 10).some((m) => m.elite));
  assert.ok(!Rules.dungeonRoom(4, 10).some((m) => m.elite));
  assert.ok(Rules.dungeonRoom(1, 10).every((m) => Rules.MONSTERS[m.type].from <= 1));
});

test('donjon : les aventuriers enchaînent les salles, sans réapparition', () => {
  const b = setup('dungeon', 6, (i) => ({ ...Rules.derive({}, {}, 'guerrier'), maxHp: 400 + i * 50, damage: 25 }));
  const rooms = new Set();
  const deadForever = new Set();
  b.on('frame', (fr) => {
    if (fr.dungeon) rooms.add(fr.dungeon.room);
    for (const p of b.players) {
      if (!p.alive) deadForever.add(p.key);
      else assert.ok(!deadForever.has(p.key), 'un aventurier tombé ne revient pas');
    }
  });
  const res = run(b);
  assert.ok(res, 'le raid se termine');
  assert.ok(res.room >= 2, 'au moins une salle franchie');
  assert.ok(rooms.has(res.room) && rooms.has(1));
  assert.deepStrictEqual(res.reward, Rules.dungeonReward(res.room));
  assert.ok(b.players.every((p) => !p.alive));
});

test('paris : fermés dans les modes coopératifs', () => {
  for (const [mode, open] of [['br', true], ['boss', false], ['dungeon', false]]) {
    const b = new Battle();
    b.openQueue(60, mode);
    clearTimeout(b.queueTimer);
    assert.strictEqual(new Bets(b).open(), open, mode);
  }
});
