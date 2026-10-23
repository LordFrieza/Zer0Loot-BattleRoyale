/*
 * Guerre des clans : équipes, cristaux, ciblage, réapparition, mort subite, fin et paris.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, Battle, base, db } = require('./helpers');
const { Bets } = require('../server/bets');

// File de Guerre des clans ; clans = liste des équipes demandées (null = au choix du serveur).
function clans(list) {
  const b = new Battle();
  b.openQueue(60, 'clans');
  clearTimeout(b.queueTimer);
  list.forEach((clan, i) => b.join({ key: 'p' + i, name: 'P' + i, level: 1, stats: base(), look: {}, clan }));
  return b;
}
function started(b) {
  b.start(null, 'meteors');
  b.stopLoop();
  return b;
}
function freeze(b) {
  for (const f of b.fighters) { f.speed = 0; f.cd = 99; f.dodge = 0; }
}
const tickFor = (b, seconds) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) b.tick(0.05); };
const team = (b, clan) => b.players.filter((p) => p.clan === clan);

test('[CLAN-1] clans : équipe demandée, sinon la moins nombreuse ; changement de camp avant la bataille', () => {
  const b = clans(['rouge', 'rouge', 'rouge', null, null]);
  const q = b.publicQueue().participants;
  assert.deepStrictEqual(q.map((p) => p.clan), ['rouge', 'rouge', 'rouge', 'bleu', 'bleu']);
  assert.strictEqual(b.participants.get('p0').clan, 'rouge');
  assert.strictEqual(b.setClan('p0', 'bleu'), true);
  assert.strictEqual(b.participants.get('p0').clan, 'bleu');
  assert.strictEqual(b.setClan('p0', 'bleu'), false, 'déjà dans cette équipe');
  assert.strictEqual(b.setClan('p0', 'vert'), false, 'équipe inconnue');
  b.closeQueue();
  assert.strictEqual(b.setClan('p1', 'bleu'), true, 'encore possible file fermée');
  started(b);
  assert.strictEqual(b.setClan('p1', 'rouge'), false, 'plus pendant la bataille');
  // Hors Guerre des clans : pas d'équipe
  const br = new Battle();
  br.openQueue(60, 'br');
  clearTimeout(br.queueTimer);
  br.join({ key: 'x', name: 'X', level: 1, stats: base(), look: {}, clan: 'rouge' });
  assert.strictEqual(br.publicQueue().participants[0].clan, undefined);
});

test('[CLAN-2, CLAN-3] clans : camps, bonus de l\'équipe la moins nombreuse, cristaux', () => {
  const b = started(clans(['rouge', 'rouge', 'rouge', 'rouge', 'bleu']));
  assert.ok(team(b, 'rouge').every((p) => p.x <= 430 && p.team === 'rouge'));
  assert.ok(team(b, 'bleu').every((p) => p.x >= 850 && p.team === 'bleu'));
  const [blue] = team(b, 'bleu');
  const [red] = team(b, 'rouge');
  assert.strictEqual(red.maxHp, 1000);
  assert.strictEqual(blue.maxHp, Math.round(1000 * 1.5), '√4 = 2, plafonné à 1,5');
  assert.strictEqual(blue.damage, 150);
  const { rouge, bleu } = b.clans.crystals;
  assert.strictEqual(rouge.maxHp, 400 + 60 * 1);
  assert.strictEqual(bleu.maxHp, 400 + 60 * 4);
  assert.deepStrictEqual([rouge.x, bleu.x], [90, 1190]);
  assert.strictEqual(bleu.range, 170);
  // Le cristal ne se laisse pas pousser
  freeze(b);
  Object.assign(red, { x: bleu.x - 10, y: bleu.y });
  b.tick(0.05);
  assert.deepStrictEqual([bleu.x, bleu.y], [1190, 360]);
  // Il tire sur l'ennemi proche
  const events = [];
  b.on('frame', (f) => events.push(...f.events));
  bleu.cd = 0;
  b.tick(0.05);
  assert.ok(events.some((e) => (e.t === 'hit' || e.t === 'dodge') && e.from === bleu.key && e.to === red.key));

  // Tout le monde dans la même équipe : répartition au hasard
  const c = started(clans(['rouge', 'rouge', 'rouge', 'rouge']));
  assert.strictEqual(team(c, 'rouge').length, 2);
  assert.strictEqual(team(c, 'bleu').length, 2);
});

test('[CLAN-4] clans : le cristal adverse attire, on défend le sien et on répond à qui nous colle', () => {
  const b = started(clans(['rouge', 'bleu', 'bleu']));
  freeze(b);
  const [red] = team(b, 'rouge');
  const [b1, b2] = team(b, 'bleu');
  const blueCrystal = b.clans.crystals.bleu;
  // Ennemi à 400 px, cristal adverse à 1000 px : 1000 × 0,35 = 350 < 400 → le cristal
  Object.assign(red, { x: 190, y: 360 });
  Object.assign(b1, { x: 590, y: 360 });
  Object.assign(b2, { x: 1100, y: 100 });
  b.tick(0.05);
  assert.strictEqual(red.targetKey, blueCrystal.key);
  // Un ennemi près de notre cristal passe avant
  Object.assign(b1, { x: 300, y: 360 });
  b.tick(0.05);
  assert.strictEqual(red.targetKey, b1.key);
  // Un ennemi collé à nous aussi
  Object.assign(b1, { x: 600, y: 600 });
  Object.assign(b2, { x: 240, y: 360 });
  b.tick(0.05);
  assert.strictEqual(red.targetKey, b2.key);
});

test('[CLAN-5] clans : réapparition dans son camp, 5 s de plus à chaque mort (30 s au plus)', () => {
  assert.deepStrictEqual([1, 2, 3, 6, 7, 12].map(Rules.clanRespawnDelay), [5, 10, 15, 30, 30, 30]);
  const b = started(clans(['rouge', 'bleu']));
  freeze(b);
  const [red] = team(b, 'rouge');
  const [blue] = team(b, 'bleu');
  b.kill(red, blue);
  assert.strictEqual(b.clans.kills.rouge, 1);
  tickFor(b, 4.9);
  assert.strictEqual(blue.alive, false);
  tickFor(b, 0.2);
  assert.strictEqual(blue.alive, true);
  assert.ok(blue.x >= 850, 'dans son camp');
  assert.ok(blue.protectUntil > b.time);
  b.time = blue.protectUntil + 0.1;
  b.kill(red, blue);
  tickFor(b, 9.9);
  assert.strictEqual(blue.alive, false, '10 s à la deuxième mort');
  tickFor(b, 0.2);
  assert.strictEqual(blue.alive, true);
});

test('[CLAN-6] clans : mort subite à 90 s, cristaux ×3', () => {
  const b = started(clans(['rouge', 'bleu']));
  freeze(b);
  const [red] = team(b, 'rouge');
  const crystal = b.clans.crystals.bleu;
  Object.assign(crystal, { reduction: 0 });
  let hp = crystal.hp;
  b.hit(red, crystal, 10);
  assert.strictEqual(hp - crystal.hp, 10);
  const events = [];
  b.on('frame', (f) => events.push(...f.events));
  b.time = 90;
  b.tick(0.05);
  assert.strictEqual(b.clans.overtime, true);
  assert.ok(events.some((e) => e.t === 'overtime'));
  hp = crystal.hp;
  b.hit(red, crystal, 10);
  assert.strictEqual(hp - crystal.hp, 30);
});

test('[CLAN-7] clans : cristal détruit, ou au temps le cristal le moins entamé', () => {
  const b = started(clans(['rouge', 'rouge', 'bleu']));
  freeze(b);
  let res = null;
  b.on('clansEnd', (r) => { res = r; });
  const [r1] = team(b, 'rouge');
  r1.dealt = 500;
  b.kill(r1, b.clans.crystals.bleu);
  b.tick(0.05);
  assert.strictEqual(res.mode, 'clans');
  assert.strictEqual(res.winner, 'rouge');
  assert.strictEqual(res.teams.bleu.crystal, 0);
  assert.strictEqual(res.teams.rouge.players, 2);
  assert.strictEqual(res.mvp.key, r1.key);
  assert.deepStrictEqual(res.reward, { xp: 200, gold: 40, chests: 1 });
  assert.strictEqual(res.ranking[0].key, r1.key);

  // Au temps : le cristal qui a gardé la plus grande part de sa vie
  const c = started(clans(['rouge', 'bleu']));
  freeze(c);
  let res2 = null;
  c.on('clansEnd', (r) => { res2 = r; });
  c.clans.crystals.rouge.hp = c.clans.crystals.rouge.maxHp * 0.4;
  c.clans.crystals.bleu.hp = c.clans.crystals.bleu.maxHp * 0.6;
  c.time = 179.95;
  c.tick(0.05);
  c.tick(0.05);
  assert.strictEqual(res2.winner, 'bleu');
  // Égalité parfaite : le plus de kills
  const d = started(clans(['rouge', 'bleu']));
  freeze(d);
  let res3 = null;
  d.on('clansEnd', (r) => { res3 = r; });
  d.clans.kills.rouge = 3;
  d.time = 180;
  d.tick(0.05);
  assert.strictEqual(res3.winner, 'rouge');
});

test('[CLAN-9, BET-2] clans : paris sur une équipe seulement', () => {
  const b = clans(['rouge', 'bleu']);
  const bets = new Bets(b);
  const user = { id: 'parieur_clan', character: { gold: 100 } };
  db.state.users[user.id] = user;
  assert.throws(() => bets.place(user, 'p0', 10), /Choisis une équipe/);
  const bet = bets.place(user, 'clan:bleu', 10);
  assert.deepStrictEqual([bet.target, bet.targetName], ['clan:bleu', 'les Bleus']);
  assert.strictEqual(user.character.gold, 90);
  const results = bets.settle('clan:bleu', 'les Bleus');
  assert.deepStrictEqual([results[0].outcome, results[0].payout], ['won', 10], 'seul parieur : sa mise lui revient');
  // Hors Guerre des clans, une équipe n'est pas une cible
  const br = new Battle();
  br.openQueue(60, 'br');
  clearTimeout(br.queueTimer);
  assert.throws(() => new Bets(br).place(user, 'clan:bleu', 10), /ne participe pas/);
});
