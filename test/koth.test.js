/*
 * Roi de la Colline : colline mobile, points, réapparition, fin au temps et paris.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, Battle, base } = require('./helpers');
const { Bets } = require('../server/bets');

function koth(players = 3) {
  const b = new Battle();
  b.openQueue(60, 'koth');
  clearTimeout(b.queueTimer);
  for (let i = 0; i < players; i++) b.join({ key: 'p' + i, name: 'P' + i, level: 1, stats: base(), look: {} });
  return b;
}
function started(b) {
  b.start(null, 'meteors');
  b.stopLoop();
  return b;
}
// Personne ne bouge ni n'attaque.
function freeze(b) {
  for (const f of b.players) { f.speed = 0; f.cd = 99; f.dodge = 0; }
}
const tickFor = (b, seconds) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) b.tick(0.05); };

test('[KOTH-1, MODE-3] roi de la colline : 150 s, chacun pour soi, colline au centre, sans zone ni événement', () => {
  assert.deepStrictEqual(Rules.KOTH.points, { hill: 1, king: 3, kill: 3 });
  const solo = koth(1);
  assert.throws(() => solo.start(), /au moins 2/);
  const b = started(koth(3));
  assert.strictEqual(b.event, null);
  assert.deepStrictEqual(b.koth.hill, { x: 640, y: 360, r: 120 });
  assert.strictEqual(new Set(b.players.map((p) => p.team)).size, 3, 'chacun son équipe');
  assert.ok(b.players.every((p) => p.score === 0));
  const fr = b.frame();
  assert.strictEqual(fr.storm, null);
  assert.strictEqual(fr.koth.left, 150);
  assert.ok(fr.fighters.every((f) => f.score === 0));
});

test('[KOTH-3] roi de la colline : 1 point par seconde sur la colline, 3 si l\'on est seul', () => {
  const b = started(koth(3));
  freeze(b);
  const [a, c, out] = b.players;
  Object.assign(a, { x: 640, y: 360 });
  Object.assign(c, { x: 1100, y: 600 });
  Object.assign(out, { x: 100, y: 100 });
  const kings = [];
  b.on('frame', (f) => kings.push(...f.events.filter((e) => e.t === 'king')));
  tickFor(b, 2);
  assert.ok(Math.abs(a.score - 6) < 0.2, 'seul : 3 points par seconde');
  assert.strictEqual(b.koth.king, a.key);
  assert.strictEqual(kings.length, 1);
  Object.assign(c, { x: 660, y: 380 });
  const before = a.score;
  tickFor(b, 2);
  assert.ok(Math.abs(a.score - before - 2) < 0.2, 'à deux : 1 point par seconde chacun');
  assert.ok(Math.abs(c.score - 2) < 0.2);
  assert.strictEqual(b.koth.king, null);
  assert.strictEqual(out.score, 0);
});

test('[KOTH-3, KOTH-4] roi de la colline : un kill rapporte 3 points, réapparition au bord après 4 s, protégé 1,5 s', () => {
  const b = started(koth(2));
  freeze(b);
  const [killer, victim] = b.players;
  Object.assign(killer, { x: 100, y: 100 });
  Object.assign(victim, { x: 200, y: 100 });
  let rewards = 0;
  b.on('kill', () => { rewards += 1; });
  b.on('streak', () => { rewards += 1; });
  b.kill(killer, victim);
  assert.strictEqual(killer.score, 3);
  assert.strictEqual(killer.kills, 1);
  assert.strictEqual(rewards, 0, 'pas de récompense de kill ni de série');
  tickFor(b, 3.9);
  assert.strictEqual(victim.alive, false);
  assert.ok(b.frame().fighters.find((f) => f.key === victim.key).respawn > 0);
  tickFor(b, 0.2);
  assert.strictEqual(victim.alive, true);
  assert.strictEqual(victim.hp, victim.maxHp);
  const edge = Math.min(victim.x, 1280 - victim.x, victim.y, 720 - victim.y);
  assert.ok(edge <= 60, 'au bord de l\'arène');
  // Protégé : ni blessé, ni ciblé
  const hp = victim.hp;
  b.hit(killer, victim, 100);
  assert.strictEqual(victim.hp, hp);
  killer.cd = 0;
  b.tick(0.05);
  assert.strictEqual(killer.targetKey, null);
  tickFor(b, 1.5);
  b.hit(killer, victim, 100);
  assert.ok(victim.hp < hp);
});

test('[KOTH-2] roi de la colline : la colline change de place toutes les 30 s, annoncée 5 s avant', () => {
  const b = started(koth(2));
  freeze(b);
  const events = [];
  b.on('frame', (f) => events.push(...f.events.filter((e) => e.t === 'hillWarn' || e.t === 'hillMove')));
  tickFor(b, 24.9);
  assert.strictEqual(events.length, 0);
  tickFor(b, 0.2);
  assert.strictEqual(events[0].t, 'hillWarn');
  const next = b.koth.next;
  assert.ok(Math.hypot(next.x - 640, next.y - 360) >= 300);
  assert.ok(next.x >= 200 && next.x <= 1080 && next.y >= 150 && next.y <= 570);
  assert.deepStrictEqual(b.frame().koth.next, { x: Math.round(next.x), y: Math.round(next.y) });
  tickFor(b, 5);
  assert.strictEqual(events[1].t, 'hillMove');
  assert.deepStrictEqual([b.koth.hill.x, b.koth.hill.y], [next.x, next.y]);
  assert.strictEqual(b.koth.next, null);
});

test('[KOTH-5] roi de la colline : on vise les ennemis proches de la colline, et on y marche sinon', () => {
  const b = started(koth(3));
  const [me, nearMe, onHill] = b.players;
  for (const f of b.players) { f.cd = 99; f.speed = 0; }
  Object.assign(me, { x: 400, y: 360 });
  Object.assign(nearMe, { x: 300, y: 600 }); // plus près de moi, mais loin de la colline
  Object.assign(onHill, { x: 640, y: 360 }); // sur la colline
  b.tick(0.05);
  assert.strictEqual(me.targetKey, onHill.key);
  // Personne à viser (les autres sont protégés) : il marche vers la colline
  me.speed = 100;
  nearMe.protectUntil = onHill.protectUntil = b.time + 10;
  const d0 = Math.hypot(me.x - 640, me.y - 360);
  tickFor(b, 1);
  assert.strictEqual(me.targetKey, null);
  assert.ok(Math.hypot(me.x - 640, me.y - 360) < d0 - 50);
});

test('[KOTH-6, BET-1] roi de la colline : le meilleur score gagne à 150 s, classement par score, paris ouverts', () => {
  const b = koth(3);
  const bets = new Bets(b);
  assert.strictEqual(bets.open(), true, 'paris ouverts : il y a un gagnant unique');
  started(b);
  freeze(b);
  const [a, c, d] = b.players;
  for (const f of b.players) Object.assign(f, { x: 100, y: 100 });
  a.score = 10; c.score = 25; d.score = 25; c.kills = 1; d.kills = 3;
  let winner = null;
  b.on('end', (w) => { winner = w; });
  b.time = 149.9;
  b.tick(0.05);
  assert.strictEqual(winner, null);
  b.tick(0.1);
  assert.strictEqual(winner, d, 'égalité de points : le plus de kills');
  assert.strictEqual(b.result.mode, 'koth');
  assert.deepStrictEqual(b.result.winner, { key: d.key, name: d.name, kills: 3, score: 25 });
  assert.deepStrictEqual(b.result.ranking.map((r) => [r.key, r.score]), [[d.key, 25], [c.key, 25], [a.key, 10]]);
});
