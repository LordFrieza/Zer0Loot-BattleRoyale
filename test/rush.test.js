/*
 * Boss Rush : enchaînement des boss, vote entre deux boss, bonus de la run, fin et récompenses.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, Battle } = require('./helpers');

function rush(players = 3) {
  const b = new Battle();
  b.openQueue(60, 'rush');
  clearTimeout(b.queueTimer);
  for (let i = 0; i < players; i++) b.join({ key: 'u' + i, userId: i + 1, name: 'P' + i, level: 1, cls: 'guerrier', stats: Rules.derive({}, {}, 'guerrier'), look: {} });
  b.start(null, null);
  b.stopLoop();
  return b;
}
const tickFor = (b, seconds) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) b.tick(0.05); };
// Le boss en cours tombe ; on attend l'ouverture du vote.
function downBoss(b) {
  if (b.rush.stage === 'intro') tickFor(b, Rules.RUSH.stages.intro - b.rush.stageT + 0.1);
  b.kill(b.players.find((p) => p.alive), b.boss);
  tickFor(b, Rules.RUSH.stages.down + 0.2);
}

test('[RUSH-1] Boss Rush : boss tirés au hasard (tous avant de revenir, jamais deux fois de suite), de plus en plus forts', () => {
  assert.strictEqual(Rules.GAME_MODES.rush.coop, true);
  assert.deepStrictEqual(Rules.rushScale(1), { hp: 1, damage: 1 });
  const s3 = Rules.rushScale(3, 1.25);
  assert.ok(Math.abs(s3.hp - 1.6 * 1.25) < 1e-9 && Math.abs(s3.damage - 1.6 * 1.08 * 1.08 * 1.25) < 1e-9);
  // Les dégâts s'accélèrent : bien plus que la vie au fil des boss
  assert.ok(Math.abs(Rules.rushScale(10).damage - 3.7 * Math.pow(1.08, 9)) < 1e-9);
  assert.ok(Rules.rushScale(15).damage > 15);
  const b = rush(3);
  const events = [];
  b.on('frame', (f) => events.push(...f.events));
  assert.strictEqual(b.rush.stage, 'intro');
  assert.strictEqual(b.publicQueue().boss, b.bossId, 'la file publique indique le boss en cours');
  // Intro : personne ne combat
  const hp = b.boss.hp;
  const x = b.players[0].x;
  tickFor(b, Rules.RUSH.stages.intro - 0.2);
  assert.strictEqual(b.boss.hp, hp);
  assert.strictEqual(b.players[0].x, x);
  tickFor(b, 0.4);
  assert.strictEqual(b.rush.stage, 'fight');
  // Six boss différents sur les six premiers combats, puis le cycle reprend sans répétition immédiate
  const seen = [b.bossId];
  const first = Rules.bossStats(3, b.bossId, 1).maxHp;
  assert.strictEqual(b.boss.maxHp, first);
  for (let k = 2; k <= 9; k++) {
    downBoss(b);
    b.closePoll();
    seen.push(b.bossId);
    const sc = Rules.rushScale(k, b.rush.mult);
    assert.strictEqual(b.boss.maxHp, Math.round(Rules.bossStats(3, b.bossId, 1).maxHp * sc.hp), `boss n°${k} renforcé`);
    assert.strictEqual(b.rush.round, k);
  }
  assert.strictEqual(new Set(seen.slice(0, 6)).size, 6);
  for (let i = 1; i < seen.length; i++) assert.notStrictEqual(seen[i], seen[i - 1]);
  assert.ok(events.some((e) => e.t === 'rushBoss' && e.round === 2));
});

test('[RUSH-2, RUSH-3] Boss Rush : à la chute du boss, créatures effacées, rushBossDown, puis vote à trois choix', () => {
  const b = rush(3);
  tickFor(b, Rules.RUSH.stages.intro + 0.1);
  const add = b.addMonster({ kind: 'araignee', name: 'x', x: 100, y: 100, hp: 10 });
  b.players[1].iceUntil = b.time + 5;
  b.players[2].cocooned = 'a99';
  let down = null;
  b.on('rushBossDown', (info, fighters) => { down = { info, n: fighters.length }; });
  const bossId = b.bossId;
  b.kill(b.players[0], b.boss);
  b.tick(0.05);
  assert.strictEqual(add.alive, false);
  assert.deepStrictEqual([b.players[1].iceUntil, b.players[2].cocooned], [0, null], 'gel et cocons levés');
  assert.deepStrictEqual(down, { info: { boss: bossId, killed: 1, round: 1 }, n: 3 });
  assert.strictEqual(b.rush.stage, 'down');
  assert.strictEqual(b.publicPoll(), null);
  tickFor(b, Rules.RUSH.stages.down + 0.1);
  const poll = b.publicPoll();
  assert.ok(poll && poll.rush);
  assert.deepStrictEqual(poll.options.map((o) => o.id), ['bonus', 'soin', 'defi'], 'personne n\'est tombé : grand soin');
  assert.ok(poll.options.every((o) => o.label && o.desc && o.icon));
  assert.ok(Rules.RUSH_BOONS[b.rush.poll.boon]);
  // Un bonus permanent déjà pris 2 fois n'est plus tiré ; « Second souffle » reste toujours possible
  assert.deepStrictEqual(Rules.rushBoonPool([]), Object.keys(Rules.RUSH_BOONS));
  const pool = Rules.rushBoonPool(['rage', 'rage', 'armure', 'stamina', 'stamina']);
  assert.ok(!pool.includes('rage') && pool.includes('armure') && pool.includes('stamina'));
  const all = Object.keys(Rules.RUSH_BOONS).flatMap((id) => [id, id]);
  assert.deepStrictEqual(Rules.rushBoonPool(all), ['stamina']);
  b.rush.boons = ['rage', 'rage'];
  for (let i = 0; i < 30; i++) { b.openRushPoll(); assert.notStrictEqual(b.rush.poll.boon, 'rage'); }
  // Votes : !1/!2/!3, commandes, une voix par personne (la dernière compte)
  assert.strictEqual(b.vote('t:a', '!3'), 'defi');
  assert.strictEqual(b.vote('t:b', '!bonus'), 'bonus');
  assert.strictEqual(b.vote('t:b', '!defi'), 'defi');
  assert.strictEqual(b.vote('t:c', '!vie'), null, 'commande du donjon refusée');
  assert.deepStrictEqual(b.pollCounts().map((o) => o.votes), [0, 0, 2]);
  // Quelqu'un est tombé : résurrection proposée
  const c = rush(3);
  tickFor(c, Rules.RUSH.stages.intro + 0.1);
  c.kill(c.boss, c.players[2]);
  downBoss(c);
  assert.deepStrictEqual(c.publicPoll().options.map((o) => o.id), ['bonus', 'resu', 'defi']);
});

test('[RUSH-3] Boss Rush : quitte ou double, bonus permanents, résurrection, soin entre deux boss', () => {
  const b = rush(3);
  tickFor(b, Rules.RUSH.stages.intro + 0.1);
  downBoss(b);
  let end = null;
  b.on('pollEnd', (r) => { end = r; });
  b.vote('t:a', 'defi');
  b.closePoll();
  assert.strictEqual(end.id, 'defi');
  assert.deepStrictEqual(end.reward, Rules.rushDefiReward(1));
  assert.deepStrictEqual(end.reward, { xp: 50, gold: 40, chests: 0 });
  assert.strictEqual(b.rush.mult, Rules.RUSH.defiMult);
  assert.strictEqual(b.rush.stage, 'intro');
  // Bonus : appliqué aux survivants pour le reste de la run
  tickFor(b, Rules.RUSH.stages.intro + 0.1);
  const dead = b.players[2];
  b.kill(b.boss, dead);
  downBoss(b);
  b.rush.poll.boon = 'rage';
  b.vote('t:a', '!1');
  b.closePoll();
  assert.deepStrictEqual(b.rush.boons, ['rage']);
  assert.strictEqual(b.buffMult(b.players[0], 'damage'), 1.2);
  // Résurrection : 60 % de la vie, avec les bonus de la run
  tickFor(b, Rules.RUSH.stages.intro + 0.1);
  downBoss(b);
  b.vote('t:a', 'resu');
  const r = b.closePoll();
  assert.deepStrictEqual(r.revived, { key: dead.key, name: dead.name });
  assert.strictEqual(dead.alive, true);
  assert.ok(dead.hp >= Math.round(dead.maxHp * Rules.RUSH.revive));
  assert.strictEqual(b.buffMult(dead, 'damage'), 1.2, 'il retrouve le bonus de la run');
  // Vigueur : vie max +25 % ; soin de 30 % entre deux boss
  tickFor(b, Rules.RUSH.stages.intro + 0.1);
  downBoss(b);
  const p = b.players[0];
  const max = p.maxHp;
  b.rush.poll.boon = 'vigueur';
  b.vote('t:a', 'bonus');
  b.closePoll();
  assert.strictEqual(p.maxHp, Math.round(max * 1.25));
  p.hp = 1;
  tickFor(b, Rules.RUSH.stages.intro + 0.1);
  downBoss(b);
  b.vote('t:a', 'soin');
  b.closePoll();
  assert.strictEqual(p.hp, p.maxHp, 'grand soin');
  p.hp = 10;
  tickFor(b, Rules.RUSH.stages.intro + 0.1);
  downBoss(b);
  b.rush.poll.boon = 'rage';
  b.closePoll();
  assert.ok(p.hp >= 10 + p.maxHp * Rules.RUSH.healBetween - 1, 'soin de 30 % avant le boss suivant');
});

test('[RUSH-4] Boss Rush : fin quand tout le monde tombe, récompense selon les boss vaincus', () => {
  assert.strictEqual(Rules.rushReward(0), null);
  assert.deepStrictEqual(Rules.rushReward(1), { bosses: 1, xp: 150, gold: 150, chests: 1 });
  assert.deepStrictEqual(Rules.rushReward(3), { bosses: 3, xp: 600, gold: 600, chests: 3 });
  const b = rush(2);
  let res = null;
  b.on('coopEnd', (r) => { res = r; });
  tickFor(b, Rules.RUSH.stages.intro + 0.1);
  const first = b.bossId;
  downBoss(b);
  b.rush.poll.boon = 'armure';
  b.vote('t:a', 'bonus');
  b.closePoll();
  tickFor(b, Rules.RUSH.stages.intro + 0.1);
  for (const p of b.players) b.kill(b.boss, p);
  b.tick(0.05);
  assert.strictEqual(b.phase, 'ended');
  assert.deepStrictEqual([res.mode, res.victory, res.rush.killed, res.rush.defeated, res.rush.boons], ['rush', true, 1, [first], ['armure']]);
  assert.deepStrictEqual(res.reward, Rules.rushReward(1));
  assert.ok(Rules.MAX_COUNTERS.includes('rushBest'));
  // Aucun boss vaincu : pas de récompense
  const c = rush(1);
  let r2 = null;
  c.on('coopEnd', (r) => { r2 = r; });
  tickFor(c, Rules.RUSH.stages.intro + 0.1);
  c.kill(c.boss, c.players[0]);
  c.tick(0.05);
  assert.deepStrictEqual([r2.victory, r2.reward], [false, null]);
  // Un boss qui tient 300 s met fin à la run
  const d = rush(1);
  tickFor(d, Rules.RUSH.stages.intro + 0.1);
  d.players[0].hp = 1e9; d.players[0].maxHp = 1e9;
  d.boss.bornAt = d.time - 301;
  d.tick(0.05);
  assert.strictEqual(d.phase, 'ended');
});
