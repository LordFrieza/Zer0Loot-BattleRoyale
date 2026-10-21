/*
 * Modes de jeu coopératifs : Combat de Boss et Raid de Donjon (simulation dans battle.js, valeurs dans rules.js).
 * Les récompenses versées par index.js sont vérifiées dans http.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, game, Battle, base } = require('./helpers');
const { Bets } = require('../server/bets');

// Partie prête à être pilotée à la main (sans minuterie ni boucle).
function coop(mode, players, statsOf = () => Rules.derive({}, {}, 'guerrier')) {
  const b = new Battle();
  b.openQueue(60, mode);
  clearTimeout(b.queueTimer);
  for (let i = 0; i < players; i++) b.join({ key: 'p' + i, name: 'P' + i, level: 1, cls: 'guerrier', stats: statsOf(i), look: {} });
  return b;
}

function started(b, event = null) {
  b.start(null, event);
  b.stopLoop();
  return b;
}

// Joue la partie jusqu'au bout (au plus maxSeconds) et renvoie le résultat coopératif.
function run(b, maxSeconds = 1200) {
  let out = null;
  b.on('coopEnd', (r) => { out = r; });
  started(b, 'meteors');
  for (let i = 0; i < maxSeconds * 20 && !out; i++) b.tick(0.05);
  return out;
}

// Immobilise tout le monde et empêche les attaques normales.
function freeze(b) {
  for (const f of b.fighters) { f.speed = 0; f.cd = 99; f.dodge = 0; }
}

// ---------- Modes ----------

test('[MODE-1, MODE-2] modes : liste, mode par défaut, mode inconnu refusé, mode diffusé dans la file', () => {
  assert.deepStrictEqual(Object.keys(Rules.GAME_MODES), ['br', 'boss', 'dungeon']);
  assert.strictEqual(Rules.GAME_MODES.br.coop, false);
  assert.ok(Rules.GAME_MODES.boss.coop && Rules.GAME_MODES.dungeon.coop);
  const b = new Battle();
  b.openQueue(60);
  clearTimeout(b.queueTimer);
  assert.strictEqual(b.publicQueue().mode, 'br');
  assert.throws(() => b.openQueue(60, 'pique-nique'), /inconnu/);
  b.openQueue(60, 'boss');
  clearTimeout(b.queueTimer);
  assert.strictEqual(b.publicQueue().mode, 'boss');
  b.reset();
  assert.strictEqual(b.mode, 'boss', 'le mode reste jusqu\'à la prochaine ouverture');
});

test('[MODE-3] lancement : 2 combattants en Battle Royale, 1 suffit en coopération', () => {
  const br = new Battle();
  br.openQueue(60, 'br');
  clearTimeout(br.queueTimer);
  br.join({ key: 'p0', name: 'P0', level: 1, stats: base(), look: {} });
  assert.throws(() => br.start(), /au moins 2/);
  for (const mode of ['boss', 'dungeon']) {
    const b = started(coop(mode, 1));
    assert.strictEqual(b.phase, 'battle', mode);
  }
});

test('[MODE-4, MODE-5, BOSS-1] boss : une seule équipe contre le Troll, sans zone, événement ni récompense de kill', () => {
  const b = started(coop('boss', 4), 'meteors');
  assert.strictEqual(b.event, null, 'les événements sont réservés au Battle Royale');
  const st = Rules.bossStats(4);
  assert.strictEqual(b.boss.maxHp, 200 + 300 * 4);
  assert.strictEqual(st.maxHp, b.boss.maxHp);
  assert.strictEqual(b.boss.damage, 6 + 0.2 * 4);
  assert.strictEqual(b.boss.r, 58);
  assert.ok(b.players.every((p) => p.x <= 470), 'combattants dans la partie gauche');
  const keys = new Set(b.players.map((p) => p.key));
  let kills = 0;
  b.on('kill', () => { kills += 1; });
  b.on('streak', () => { kills += 1; });
  b.on('frame', (fr) => {
    assert.strictEqual(fr.storm, null, 'pas de zone');
    for (const e of fr.events) if (e.t === 'hit' && e.from && e.to) assert.ok(!(keys.has(e.from) && keys.has(e.to)), 'pas de coup entre alliés');
  });
  b.time = 100; // bien après le début de la zone en Battle Royale
  for (let i = 0; i < 300; i++) {
    b.tick(0.05);
    for (const f of b.players) if (f.alive && f.targetKey) assert.strictEqual(f.targetKey, 'boss');
  }
  b.boss.hp = 1;
  const p = b.players.find((x) => x.alive);
  b.kill(p, b.boss);
  assert.strictEqual(kills, 0, 'aucune récompense de kill ni de série en coopération');
});

test('[MODE-4] boss : l\'explosion du Mage ne touche pas les alliés', () => {
  const b = started(coop('boss', 3));
  freeze(b);
  const [mage, ally] = b.players;
  Object.assign(mage, { aoeRadius: 75, aoeRatio: 0.6, crit: 0, precision: 0 });
  Object.assign(b.boss, { x: 600, y: 360, dodge: 0 });
  Object.assign(ally, { x: 620, y: 360 });
  const hpAlly = ally.hp;
  b.attack(mage, b.boss);
  assert.ok(b.boss.hp < b.boss.maxHp);
  assert.strictEqual(ally.hp, hpAlly);
});

test('[BOSS-2] boss : le coup de massue touche aussi les voisins de la cible', () => {
  const b = started(coop('boss', 3));
  freeze(b);
  const [target, near, far] = b.players;
  Object.assign(b.boss, { crit: 0 });
  Object.assign(target, { x: 650, y: 360, reduction: 0 });
  Object.assign(near, { x: 700, y: 360, reduction: 0 });
  Object.assign(far, { x: 900, y: 360, reduction: 0 });
  b.events = [];
  b.attack(b.boss, target);
  const hits = b.events.filter((e) => e.t === 'hit');
  const main = hits.find((e) => e.to === target.key);
  const splash = hits.find((e) => e.to === near.key);
  assert.ok(main && splash && splash.splash);
  assert.ok(!hits.some((e) => e.to === far.key));
  assert.ok(Math.abs(splash.dmg - main.dmg * Rules.BOSS.cleaveRatio) <= 1);
});

test('[BOSS-3] boss : onde de choc puis rocher, annoncés avant l\'impact', () => {
  const b = started(coop('boss', 3));
  freeze(b);
  const B = Rules.BOSS;
  const [close, groupA, groupB] = b.players;
  Object.assign(b.boss, { x: 640, y: 360 });
  Object.assign(close, { x: 700, y: 360 }); // dans l'onde de choc
  Object.assign(groupA, { x: 150, y: 150 });
  Object.assign(groupB, { x: 180, y: 160 }); // le plus gros groupe
  b.boss.slamIn = 0;
  b.tick(0.05);
  assert.strictEqual(b.slams.length, 1);
  assert.strictEqual(b.slams[0].kind, 'slam');
  assert.strictEqual(b.slams[0].r, B.slam.radius);
  const hp = b.players.map((p) => p.hp);
  b.tick(B.slam.warn - 0.2);
  assert.deepStrictEqual(b.players.map((p) => p.hp), hp, 'pas de dégâts avant l\'impact');
  b.tick(0.25);
  assert.ok(close.hp < hp[0], 'touché par l\'onde de choc');
  assert.strictEqual(groupA.hp, hp[1]);
  // Attaque suivante : le rocher, sur le groupe
  b.boss.slamIn = 0;
  b.tick(0.05);
  const rock = b.slams.find((s) => s.kind === 'rock');
  assert.ok(rock && rock.r === B.slam.rockRadius);
  assert.ok(Math.hypot(rock.x - 165, rock.y - 155) < 40, 'visé sur le groupe');
  b.tick(B.slam.warn);
  assert.ok(groupA.hp < hp[1] && groupB.hp < hp[2]);
});

test('[BOSS-4] boss : les coches de 66 % et 33 % renforcent le Troll', () => {
  const b = started(coop('boss', 3));
  freeze(b);
  const boss = b.boss;
  const cd = boss.cooldown;
  const every = boss.slamEvery;
  boss.hp = boss.maxHp * 0.6;
  b.tick(0.05);
  assert.strictEqual(boss.phase, 1);
  assert.ok(Math.abs(boss.dmgMult - 1.3) < 1e-9);
  assert.ok(Math.abs(boss.cooldown - cd / 1.35) < 1e-9);
  assert.ok(Math.abs(boss.slamEvery - every * 0.8) < 1e-9);
  boss.hp = boss.maxHp * 0.3;
  const frames = [];
  b.on('frame', (f) => frames.push(...f.events));
  b.tick(0.05);
  assert.strictEqual(boss.phase, 2);
  assert.ok(frames.some((e) => e.t === 'bossPhase' && e.phase === 2));
});

test('[BOSS-5] boss : rage finale à 150 s', () => {
  const b = started(coop('boss', 2));
  freeze(b);
  b.time = Rules.BOSS.enrageAt - 1;
  b.tick(0.05);
  assert.strictEqual(b.boss.enraged, false);
  b.time = Rules.BOSS.enrageAt;
  b.tick(0.05);
  assert.strictEqual(b.boss.enraged, true);
  assert.strictEqual(b.boss.dmgMult, Rules.BOSS.enrageMult);
});

test('[BOSS-6, BOSS-7, MODE-6] boss : victoire commune avec récompense, défaite sans', () => {
  const strong = () => ({ ...Rules.derive({}, {}, 'guerrier'), maxHp: 1e6, damage: 5000 });
  const win = run(coop('boss', 3, strong));
  assert.strictEqual(win.victory, true);
  assert.deepStrictEqual(win.reward, Rules.BOSS.reward);
  assert.deepStrictEqual(win.reward, { xp: 500, gold: 500, chests: 3 });
  assert.strictEqual(win.ranking.length, 3);
  assert.ok(win.ranking[0].dealt >= win.ranking[2].dealt, 'classé par dégâts');

  const weak = () => ({ ...Rules.derive({}, {}, 'guerrier'), maxHp: 5, damage: 0.1 });
  const lose = run(coop('boss', 3, weak));
  assert.strictEqual(lose.victory, false);
  assert.strictEqual(lose.reward, null);

  // Au-delà de 300 s : défaite
  const b = started(coop('boss', 1));
  freeze(b);
  let out = null;
  b.on('coopEnd', (r) => { out = r; });
  b.time = 301;
  b.tick(0.05);
  assert.strictEqual(out.victory, false);
  assert.strictEqual(b.phase, 'ended');
});

// ---------- Donjon ----------

test('[DNG-8] donjon : récompenses par palier de salle atteinte', () => {
  assert.strictEqual(Rules.dungeonReward(4), null);
  assert.deepStrictEqual(Rules.dungeonReward(5), { tier: 5, xp: 50, gold: 50, chests: 0 });
  assert.deepStrictEqual(Rules.dungeonReward(12), { tier: 10, xp: 150, gold: 150, chests: 0 });
  assert.deepStrictEqual(Rules.dungeonReward(15), { tier: 15, xp: 300, gold: 300, chests: 1 });
  assert.deepStrictEqual(Rules.dungeonReward(20), { tier: 20, xp: 500, gold: 500, chests: 2 });
  assert.deepStrictEqual(Rules.dungeonReward(27), { tier: 25, xp: 750, gold: 750, chests: 3 });
  assert.deepStrictEqual(Rules.dungeonReward(30), { tier: 30, xp: 1000, gold: 1000, chests: 4 });
});

test('[DNG-9] donjon : une ambiance toutes les 5 salles', () => {
  assert.deepStrictEqual(Rules.DUNGEON_THEMES.map((t) => t.name), ['Les Cachots', 'La Crypte oubliée', 'Les Forges infernales', 'Les Abysses', 'Le Néant']);
  assert.deepStrictEqual([1, 5, 6, 10, 11, 16, 20, 21, 99].map(Rules.dungeonTheme), [0, 0, 1, 1, 2, 3, 3, 4, 4]);
});

test('[DNG-1, DNG-2] donjon : nombre de monstres, types débloqués, multiplicateurs et chefs', () => {
  for (const room of [1, 3, 10, 40]) {
    const expected = Math.max(2, Math.min(36, Math.round(10 * (0.55 + 0.06 * (room - 1)))));
    assert.strictEqual(Rules.dungeonRoom(room, 10).length, expected, 'salle ' + room);
  }
  assert.strictEqual(Rules.dungeonRoom(1, 1).length, 2, 'minimum 2 monstres');
  for (let i = 0; i < 30; i++) {
    assert.ok(Rules.dungeonRoom(1, 10).every((m) => ['gobelin', 'slime'].includes(m.type)));
    assert.ok(Rules.dungeonRoom(2, 10).every((m) => m.type !== 'squelette'));
  }
  assert.deepStrictEqual(Rules.dungeonMultipliers(1), { hp: 1, damage: 1 });
  const m11 = Rules.dungeonMultipliers(11);
  assert.ok(Math.abs(m11.hp - 1.8) < 1e-9 && Math.abs(m11.damage - 1.6) < 1e-9);
  assert.strictEqual(Rules.dungeonRoom(5, 10).filter((m) => m.elite).length, 1);
  assert.ok(!Rules.dungeonRoom(4, 10).some((m) => m.elite));

  // Statistiques réelles d'un chef créé par le serveur
  const b = started(coop('dungeon', 4));
  b.dungeon.room = 4;
  b.nextRoom();
  const chief = b.monsters.find((m) => m.elite);
  const mult = Rules.dungeonMultipliers(5);
  const M = Rules.MONSTERS[chief.kind];
  assert.strictEqual(chief.maxHp, Math.round(M.hp * mult.hp * 5));
  assert.ok(Math.abs(chief.damage - M.damage * mult.damage * 1.5) < 1e-9);
  assert.strictEqual(chief.scale, 1.9);
  assert.strictEqual(chief.name, Rules.ELITES[chief.kind]);
});

test('[DNG-3, DNG-4, DNG-5, DNG-7, DNG-10] donjon : enchaînement des salles, pas de réapparition, fin du raid', () => {
  const b = coop('dungeon', 6, (i) => ({ ...Rules.derive({}, {}, 'guerrier'), maxHp: 400 + i * 50, damage: 25 }));
  const stages = [];
  const deadForever = new Set();
  let hitsDuringEnter = 0;
  let clears = 0;
  const polls = [];
  b.on('pollEnd', (r) => polls.push(r.id));
  b.on('frame', (fr) => {
    if (fr.dungeon && stages[stages.length - 1] !== fr.dungeon.stage) stages.push(fr.dungeon.stage);
    if (fr.dungeon && fr.dungeon.stage === 'enter') hitsDuringEnter += fr.events.filter((e) => e.t === 'hit').length;
    clears += fr.events.filter((e) => e.t === 'roomClear').length;
    // Seul le bonus « Résurrection » d'un sondage peut ramener un aventurier.
    for (const e of fr.events) if (e.t === 'revive') deadForever.delete(e.to);
    for (const p of b.players) {
      if (!p.alive) deadForever.add(p.key);
      else assert.ok(!deadForever.has(p.key), 'un aventurier tombé ne revient pas');
    }
  });
  const res = run(b);
  assert.ok(res, 'le raid se termine');
  assert.ok(res.room >= 2, 'au moins une salle franchie');
  // « Passage secret » fait sauter 2 salles sans combat.
  const skipped = (b.dungeon.lastPoll && polls.filter((id) => id === 'raccourci').length * 2) || 0;
  assert.strictEqual(clears + skipped, res.room - 1);
  assert.deepStrictEqual(stages.slice(0, 7), ['dark', 'enter', 'fight', 'clear', 'exit', 'dark', 'enter']);
  assert.strictEqual(hitsDuringEnter, 0, 'pas de combat pendant l\'entrée');
  assert.deepStrictEqual(res.reward, Rules.dungeonReward(res.room, b.dungeon.rewardMult));
  assert.ok(b.players.every((p) => !p.alive));
  assert.strictEqual(res.room, b.dungeon.room, 'salle où l\'équipe est tombée');
});

test('[DNG-3, DNG-5] donjon : durées des étapes et soins de 30 % à l\'entrée d\'une salle', () => {
  const S = Rules.DUNGEON.stages;
  const b = started(coop('dungeon', 2));
  assert.strictEqual(b.dungeon.stage, 'dark');
  let t = 0;
  while (b.dungeon.stage === 'dark') { b.tick(0.05); t += 0.05; }
  assert.ok(Math.abs(t - S.dark * 0.65) < 0.11, 'premier écran noir ≈ 1,2 s');
  assert.strictEqual(b.dungeon.room, 1);
  assert.ok(b.players.every((p) => p.x < 0), 'entrée par la gauche');
  t = 0;
  while (b.dungeon.stage === 'enter') { b.tick(0.05); t += 0.05; }
  assert.ok(Math.abs(t - S.enter) < 0.11);
  assert.ok(b.players.every((p) => p.x > 60), 'les aventuriers sont entrés');
  // Salle vidée : pause, puis sortie à droite
  for (const m of b.monsters) b.kill(null, m);
  b.tick(0.05);
  assert.strictEqual(b.dungeon.stage, 'clear');
  const [hurt, dead] = b.players;
  hurt.hp = 10;
  b.kill(null, dead);
  while (b.dungeon.stage !== 'dark') b.tick(0.05);
  assert.ok(hurt.x > 400, 'sortie vers la droite');
  while (b.dungeon.stage === 'dark') b.tick(0.05);
  assert.strictEqual(b.dungeon.room, 2);
  assert.ok(Math.abs(hurt.hp - (10 + hurt.maxHp * 0.3)) < 1e-6, '+30 % de la vie max');
  assert.strictEqual(dead.alive, false, 'pas de réapparition');
  // les soins ne dépassent pas le maximum
  hurt.hp = hurt.maxHp - 1;
  b.nextRoom();
  assert.strictEqual(hurt.hp, hurt.maxHp);
});

test('[DNG-6] donjon : les monstres s\'énervent après 45 s dans la même salle', () => {
  const b = started(coop('dungeon', 2));
  b.dungeon.room = 0;
  b.nextRoom();
  b.setStage('fight');
  freeze(b);
  b.tick(0.05);
  assert.ok(b.monsters.every((m) => m.dmgMult === 1));
  b.time = b.dungeon.fightStart + 50;
  b.tick(0.05);
  assert.strictEqual(b.dungeon.enraged, true);
  for (const m of b.monsters) assert.ok(Math.abs(m.dmgMult - (1 + 0.05 * (50.05 - 45))) < 0.01);
});

test('[ACH-1] donjon : la fusion d\'un fantôme garde la meilleure salle', () => {
  const db = require('../server/db');
  const ghost = game.getOrCreateTwitchUser('fantome_donjon', 'Fantome_Donjon');
  ghost.character.counters.dungeonBest = 7;
  ghost.character.counters.bossWins = 2;
  const user = { id: 'acc_donjon', username: 'acc_donjon', role: 'player', character: game.newCharacter() };
  user.character.counters.dungeonBest = 12;
  user.character.counters.bossWins = 1;
  db.state.users[user.id] = user;
  game.linkTwitch(user, 'fantome_donjon', 'Fantome_Donjon');
  assert.strictEqual(user.character.counters.dungeonBest, 12, 'maximum, pas la somme');
  assert.strictEqual(user.character.counters.bossWins, 3, 'les victoires s\'additionnent');
  assert.ok(Rules.ACHIEVEMENTS.some((a) => a.metric === 'bossWins') && Rules.ACHIEVEMENTS.some((a) => a.metric === 'dungeonBest'));
  assert.strictEqual(Rules.achievementValue(user.character, 'dungeonBest'), 12);
});

test('[BET-1, MODE-5] paris : fermés dans les modes coopératifs', () => {
  for (const [mode, open] of [['br', true], ['boss', false], ['dungeon', false]]) {
    const b = new Battle();
    b.openQueue(60, mode);
    clearTimeout(b.queueTimer);
    assert.strictEqual(new Bets(b).open(), open, mode);
  }
});

// ---------- Sondage du donjon ----------

// Raid arrêté sur le sondage de la salle 5, avec les choix imposés.
function atPoll(options, players = 3) {
  const b = started(coop('dungeon', players));
  b.dungeon.room = 4;
  b.nextRoom();
  b.setStage('fight');
  for (const m of b.monsters) b.kill(null, m);
  b.tick(0.05);
  while (b.dungeon.stage === 'clear') b.tick(0.05);
  if (options) b.dungeon.poll.options = options;
  return b;
}

test('[DNG-10] sondage : après chaque salle de chef, 2 bonus distincts, 60 s, puis sortie', () => {
  assert.strictEqual(Object.keys(Rules.DUNGEON_BOONS).length, 13);
  assert.deepStrictEqual(Rules.DUNGEON_POLL, { every: 5, duration: 60, choices: 2 });
  const cmds = Object.values(Rules.DUNGEON_BOONS).map((x) => x.cmd);
  assert.strictEqual(new Set(cmds).size, cmds.length, 'une commande par bonus');

  // Salle ordinaire : pas de sondage
  const plain = started(coop('dungeon', 2));
  plain.dungeon.room = 2;
  plain.nextRoom();
  plain.setStage('fight');
  for (const m of plain.monsters) plain.kill(null, m);
  plain.tick(0.05);
  while (plain.dungeon.stage === 'clear') plain.tick(0.05);
  assert.strictEqual(plain.dungeon.stage, 'exit');

  const starts = [];
  const b = started(coop('dungeon', 2));
  b.on('pollStart', (p) => starts.push(p));
  b.dungeon.room = 4;
  b.nextRoom();
  b.setStage('fight');
  for (const m of b.monsters) b.kill(null, m);
  b.tick(0.05);
  while (b.dungeon.stage === 'clear') b.tick(0.05);
  assert.strictEqual(b.dungeon.stage, 'poll');
  assert.strictEqual(starts.length, 1);
  const opts = b.dungeon.poll.options;
  assert.strictEqual(opts.length, 2);
  assert.notStrictEqual(opts[0], opts[1]);
  assert.ok(b.publicQueue().poll, 'décompte dans la file');
  assert.ok(b.frame().dungeon.poll.left > 59);
  // Combat en pause : 59 s plus tard, toujours le sondage
  for (let i = 0; i < 59 * 20; i++) b.tick(0.05);
  assert.strictEqual(b.dungeon.stage, 'poll');
  for (let i = 0; i < 25; i++) b.tick(0.05);
  assert.strictEqual(b.dungeon.stage, 'exit', 'fin des 60 s');
  assert.strictEqual(b.publicQueue().poll, null);

  // « Résurrection » seulement si quelqu'un est mort
  const seen = new Set();
  for (let i = 0; i < 300; i++) { b.openPoll(); b.dungeon.poll.options.forEach((id) => seen.add(id)); }
  assert.ok(!seen.has('mort'));
  assert.strictEqual(seen.size, 12, 'tous les autres bonus sortent');
  b.kill(null, b.players[0]);
  let mort = false;
  for (let i = 0; i < 300 && !mort; i++) { b.openPoll(); mort = b.dungeon.poll.options.includes('mort'); }
  assert.ok(mort);
});

test('[DNG-11, DNG-12] sondage : une voix par personne, le dernier vote compte, égalité tirée au sort', () => {
  const b = atPoll(['vie', 'rage']);
  assert.strictEqual(b.vote('t:a', '!vie'), 'vie');
  assert.strictEqual(b.vote('t:b', '!2'), 'rage');
  assert.strictEqual(b.vote('u:7', 'rage'), 'rage', 'identifiant depuis le site');
  assert.strictEqual(b.vote('t:c', '!RAGE'), 'rage', 'majuscules acceptées');
  assert.strictEqual(b.vote('t:d', '!or'), null, 'bonus absent du sondage');
  assert.strictEqual(b.vote('t:d', '!3'), null);
  assert.strictEqual(b.vote('t:c', '!1'), 'vie', 'changement d\'avis');
  assert.deepStrictEqual(b.pollCounts(), [{ id: 'vie', votes: 2 }, { id: 'rage', votes: 2 }]);
  b.vote('t:e', '!vie');
  const ends = [];
  b.on('pollEnd', (r) => ends.push(r));
  const r = b.closePoll();
  assert.strictEqual(r.id, 'vie');
  assert.deepStrictEqual(r.counts, [{ id: 'vie', votes: 3 }, { id: 'rage', votes: 2 }]);
  assert.strictEqual(ends.length, 1);
  assert.strictEqual(b.dungeon.stage, 'exit');
  assert.strictEqual(b.closePoll(), null, 'plus de sondage');
  assert.strictEqual(b.vote('t:f', '!vie'), null, 'vote refusé hors sondage');

  // Égalité (ici aucun vote) : tirage au sort
  const won = new Set();
  for (let i = 0; i < 60; i++) won.add(atPoll(['armure', 'vitesse']).closePoll().id);
  assert.deepStrictEqual([...won].sort(), ['armure', 'vitesse']);

  // Hors donjon : aucun sondage
  const br = started(coop('br', 2));
  assert.strictEqual(br.vote('t:a', '!vie'), null);
  assert.strictEqual(br.publicQueue().poll, null);
});

test('[DNG-13] sondage : effets immédiats (soin, stamina, résurrection, passage secret)', () => {
  const choose = (id, players = 3) => {
    const b = atPoll([id, id === 'vie' ? 'or' : 'vie'], players);
    b.vote('t:x', id);
    return b;
  };
  let b = choose('vie');
  const [p] = b.players;
  p.hp = p.maxHp * 0.2;
  b.closePoll();
  assert.ok(Math.abs(p.hp - p.maxHp * 0.7) < 1e-6);

  b = choose('stamina');
  b.players.forEach((f) => { f.ult = { id: 'rempart', enhanced: false }; f.stamina = 0.1; });
  b.closePoll();
  assert.ok(b.players.every((f) => Math.abs(f.stamina - 0.5) < 1e-9));

  b = choose('mort');
  const dead = b.players[1];
  b.kill(null, dead);
  const r = b.closePoll();
  assert.strictEqual(dead.alive, true);
  assert.strictEqual(dead.hp, Math.round(dead.maxHp * 0.5));
  assert.deepStrictEqual(r.revived, { key: dead.key, name: dead.name });
  assert.strictEqual(dead.diedRoom, null);
  while (b.dungeon.stage !== 'enter') b.tick(0.05);
  assert.ok(b.frame().fighters.some((f) => f.key === dead.key && f.alive), 'il repart avec le groupe');

  b = choose('raccourci');
  b.closePoll();
  while (b.dungeon.stage !== 'enter') b.tick(0.05);
  assert.strictEqual(b.dungeon.room, 8, 'salles 6 et 7 sautées');
});

test('[DNG-13] sondage : bonus jusqu\'au prochain sondage et « Quitte ou double »', () => {
  const b = atPoll(['rage', 'armure']);
  b.vote('t:x', '!rage');
  b.closePoll();
  const [p] = b.players;
  assert.strictEqual(b.buffMult(p, 'damage'), 1.25);
  assert.deepStrictEqual(b.frame().dungeon.boons, ['rage']);
  assert.ok(!(b.frame().fighters[0].fx || []).includes('boon_rage'), 'affiché dans le bandeau, pas sur le perso');
  // Il dure toutes les salles suivantes…
  b.time += 500;
  b.updateBuffs(p, 0.05);
  assert.strictEqual(b.buffMult(p, 'damage'), 1.25);
  // … jusqu'au sondage suivant
  b.openPoll();
  assert.strictEqual(b.buffMult(p, 'damage'), 1);
  assert.deepStrictEqual(b.dungeon.boons, []);

  const mods = { armure: ['taken', 0.75], vitesse: ['speed', 1.2], vampire: ['lifesteal', 0.15], ronces: ['thorns', 0.25] };
  for (const [id, [key, v]] of Object.entries(mods)) {
    const x = atPoll([id, 'vie']);
    x.vote('t:x', id);
    x.closePoll();
    const f = x.players[0];
    const got = key === 'lifesteal' || key === 'thorns' ? x.buffSum(f, key) : x.buffMult(f, key);
    assert.ok(Math.abs(got - v) < 1e-9, id);
    if (id === 'vitesse') assert.strictEqual(x.buffMult(f, 'attackSpeed'), 1.2);
  }

  // Quitte ou double : monstres plus forts pour le reste du raid, récompense ×1,5
  const d = atPoll(['defi', 'vie'], 4);
  d.vote('t:x', '!defi');
  d.closePoll();
  while (d.dungeon.stage !== 'enter') d.tick(0.05);
  const room = d.dungeon.room;
  const mult = Rules.dungeonMultipliers(room);
  const normal = d.monsters.find((m) => !m.elite);
  assert.strictEqual(normal.maxHp, Math.round(Rules.MONSTERS[normal.kind].hp * mult.hp * 1.25));
  let res = null;
  d.on('coopEnd', (r) => { res = r; });
  d.dungeon.room = 12;
  d.setStage('fight');
  for (const f of d.players) d.kill(null, f);
  d.tick(0.05);
  assert.deepStrictEqual(res.reward, { tier: 10, xp: 225, gold: 225, chests: 0 });
  assert.strictEqual(res.rewardMult, 1.5);
  assert.deepStrictEqual(Rules.dungeonReward(15, 1.5), { tier: 15, xp: 450, gold: 450, chests: 2 });
  assert.deepStrictEqual(Rules.dungeonReward(15, 1.5 * 1.5), { tier: 15, xp: 675, gold: 675, chests: 2 });
});

test('[DNG-14] sondage : golds, XP et coffre calculés selon la salle', () => {
  const reward = (id, room) => {
    const b = atPoll([id, 'vie']);
    b.dungeon.room = room;
    b.vote('t:x', id);
    return b.closePoll().reward;
  };
  assert.deepStrictEqual(reward('or', 5), { xp: 0, gold: 50, chests: 0 });
  assert.deepStrictEqual(reward('or', 10), { xp: 0, gold: 100, chests: 0 });
  assert.deepStrictEqual(reward('xp', 5), { xp: 100, gold: 0, chests: 0 });
  assert.deepStrictEqual(reward('coffre', 15), { xp: 0, gold: 0, chests: 1 });
  assert.strictEqual(reward('rage', 5), undefined, 'pas de récompense pour un bonus de combat');
});
