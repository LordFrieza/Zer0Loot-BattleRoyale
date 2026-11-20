/*
 * Survivor : partie simulée côté serveur, vagues, boss, armes et objets, fin de partie, émeraudes, méta-progression.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, game, db } = require('./helpers');
const sv = require('../server/survivor');

const SV = Rules.SURVIVOR;
let n = 0;
function player(gold = 2000) {
  const id = 'sv' + (++n);
  const c = game.newCharacter();
  c.gold = gold;
  const user = { id, username: 'Survivant' + n, role: 'player', character: c };
  db.state.users[id] = user;
  return user;
}
const tickFor = (run, s) => { for (let i = 0; i < Math.round(s / 0.05); i++) { if (run.pending) run.choose(0, run.pending.id); run.tick(0.05); } };

test('[SV-1] survivor : 300 golds la partie, stats du personnage ignorées, golds rendus après un redémarrage', () => {
  const u = player(299);
  assert.throws(() => sv.start(u), /300 golds/);
  u.character.gold = 1000;
  u.character.stats.vie = 50; // les stats habituelles ne comptent pas
  assert.throws(() => sv.start(u, 'hache'), /pas débloquée/);
  const run = sv.start(u);
  assert.strictEqual(u.character.gold, 700);
  assert.ok(u.character.survivorActive);
  assert.throws(() => sv.start(u), /déjà en cours/);
  assert.strictEqual(run.stats.maxHp, SV.player.maxHp);
  assert.strictEqual(run.hp, 120);
  assert.deepStrictEqual(run.weapons.map((w) => w.id), ['epee']);
  // Méta-progression : seules ses stats améliorent la base
  const s = Rules.survivorStats({ vitalite: 3, celerite: 2 }, { coeur: 1, bottes: 1 });
  assert.strictEqual(s.maxHp, 120 + 30 + 20);
  assert.ok(Math.abs(s.speed - 150 * (1 + 0.08 + 0.08)) < 1e-9);
  // Redémarrage : la partie interrompue rend ses golds
  sv.runs.delete(u.id);
  assert.strictEqual(sv.refundActive(), 1);
  assert.deepStrictEqual([u.character.gold, u.character.survivorActive], [1000, null]);
});

test('[SV-2] survivor : lieux-dits, position bornée à la vitesse et à la carte', () => {
  assert.strictEqual(Object.keys(Rules.SURVIVOR_ZONES).length, 9);
  assert.deepStrictEqual([SV.map.w, SV.map.h], [10800, 10800]);
  assert.strictEqual(Rules.survivorZone(5400, 5400), 'village');
  assert.strictEqual(Rules.survivorZone(675, 675), 'foret');
  assert.strictEqual(Rules.survivorZone(10125, 10125), 'volcan');
  const run = new sv.SurvivorRun({});
  const ground = Rules.survivorGround(5400, 5400); // place du village : départ de toutes les routes (+10 %)
  assert.strictEqual(ground, 1 + SV.roadSpeed);
  run.setPos(5400 + 1000, 5400, 1, 0, 0.1); // téléportation : bornée
  assert.ok(Math.abs(run.p.x - (5400 + 150 * ground * 0.1 * SV.moveSlack + 4)) < 1e-6);
  run.setPos(run.p.x + 10, run.p.y + 10, 0, 1, 0.1);
  assert.ok(run.p.y > 5400 && run.p.fy === 1);
  run.setPos(-500, -500, 0, 0, 10); // temps limité à 0,25 s et bords de la carte
  assert.ok(run.p.x >= 20 && run.p.y >= 20);
  const x = run.p.x;
  run.pending = { id: 1, options: [] };
  run.setPos(x + 30, run.p.y, 1, 0, 0.2);
  assert.strictEqual(run.p.x, x, 'ignorée pendant un choix');
});

test('[SV-2] survivor : effets des lieux-dits (village, forêt, cimetière, volcan…), bénédiction combinée', () => {
  const Z = Rules.SURVIVOR_ZONES;
  assert.ok(Object.values(Z).every((z) => z.bonus && z.icon && z.desc && z.fx));
  assert.deepStrictEqual(Rules.survivorZoneFx('village'), { regen: 1, xp: -0.25 });
  // Frontières naturelles : centre (et autel) dans son lieu-dit, voisin cohérent, résultat stable
  for (const [id, z] of Object.entries(Z)) {
    assert.strictEqual(Rules.survivorZone(z.x, z.y), id);
    for (let a = 0; a < 8; a++) assert.strictEqual(Rules.survivorZone(z.x + Math.cos(a) * 100, z.y + Math.sin(a) * 100), id, `${id} autour de l'autel`);
  }
  const near = Rules.survivorZoneNear(1700, 1700);
  assert.ok(near.a !== near.b && near.da <= near.db);
  assert.deepStrictEqual(Rules.survivorZoneNear(1700, 1700), near);
  const counts = {};
  for (let y = 0; y < SV.map.h; y += 135) for (let x = 0; x < SV.map.w; x += 135) { const k = Rules.survivorZone(x, y); counts[k] = (counts[k] || 0) + 1; }
  assert.strictEqual(Object.keys(counts).length, 9);
  assert.ok(Object.values(counts).every((c) => c > 0.06 * 6400), 'chaque lieu-dit garde une bonne place');
  // Bénédiction : les effets positifs du lieu-dit béni × 1,5, sans ses contreparties
  const fx = Rules.survivorZoneFx('volcan', 'champs');
  assert.deepStrictEqual([fx.damage, fx.burn], [0.3, 1.5]);
  assert.ok(Math.abs(fx.speed - 0.225) < 1e-9 && Math.abs(fx.magnet - 0.45) < 1e-9);
  const f2 = Rules.survivorZoneFx('village', 'foret');
  assert.ok(Math.abs(f2.xp - 0.2) < 1e-9);
  assert.strictEqual(f2.enemyHp, undefined, 'la vie des ennemis ne vient pas avec la bénédiction');
  const f3 = Rules.survivorZoneFx('marais', 'marais');
  assert.strictEqual(f3.speed, -0.1, 'les malus ne sont pas amplifiés');
  assert.ok(Math.abs(f3.area - 0.625) < 1e-9);
  assert.strictEqual(Rules.survivorZoneFx('volcan', 'volcan').burn, 1.5);

  const run = new sv.SurvivorRun({});
  // Village : régénération
  run.hp = 50;
  tickFor(run, 1);
  assert.strictEqual(run.zone, 'village');
  assert.ok(run.hp > 50.9 && run.hp < 51.1, `régénération : ${run.hp}`);
  // Champs : vitesse
  Object.assign(run.p, { x: Z.champs.x, y: Z.champs.y });
  run.tick(0.05);
  assert.strictEqual(run.zone, 'champs');
  assert.ok(Math.abs(run.baseSpeed() - run.stats.speed * 1.15) < 1e-9);
  // Volcan : brûle, mais jamais jusqu'à la mort
  Object.assign(run.p, { x: Z.volcan.x + 250, y: Z.volcan.y + 250 }); // loin de l'autel (il soignerait)
  run.hp = 2;
  tickFor(run, 2);
  assert.strictEqual(run.zone, 'volcan');
  assert.strictEqual(run.hp, 1);
  assert.ok(!run.over);
  // Forêt et cimetière : ennemis plus solides selon le lieu d'apparition ; gemmes ×2 au cimetière
  const e1 = run.spawnEnemy('slime', { x: Z.village.x, y: Z.village.y });
  const e2 = run.spawnEnemy('slime', { x: Z.foret.x, y: Z.foret.y });
  assert.ok(Math.abs(e2.maxHp - e1.maxHp * 1.2) < 1e-6);
  Object.assign(run.p, { x: Z.cimetiere.x, y: Z.cimetiere.y });
  run.tick(0.05);
  run.gems = [];
  run.kill(e1);
  assert.strictEqual(run.gems[0].v, e1.xp * 2);
});

test('[SV-3] survivor : vagues de 30 s, ennemis selon la vague et le lieu-dit, élite, boss toutes les 5 vagues', () => {
  assert.deepStrictEqual(Rules.survivorWave(1).hp, 1);
  assert.ok(Rules.survivorWave(20).hp > Rules.survivorWave(10).hp && Rules.survivorWave(20).target <= SV.maxEnemies);
  assert.strictEqual(Rules.survivorBoss(4), null);
  assert.deepStrictEqual(Rules.SURVIVOR_BOSS_ORDER, ['troll', 'maexxna', 'mimic', 'dragon', 'liche', 'sorcier']);
  assert.strictEqual(Rules.survivorBoss(5).kind, 'troll');
  assert.strictEqual(Rules.survivorBoss(30).kind, 'sorcier');
  assert.strictEqual(Rules.survivorBoss(35).kind, 'troll');
  assert.ok(Rules.survivorBoss(35).hp > Rules.survivorBoss(5).hp * 2, 'le cycle reprend plus fort');
  const run = new sv.SurvivorRun({ meta: { vitalite: 10, carapace: 5 } });
  run.hp = 1e9;
  tickFor(run, 2);
  assert.ok(run.enemies.length > 0);
  assert.ok(run.enemies.every((e) => Rules.SURVIVOR_ENEMIES[e.kind].from <= 1), 'seulement les ennemis de la vague 1');
  // Lieu-dit : ses ennemis favoris sortent bien plus souvent
  const counts = {};
  for (let i = 0; i < 2000; i++) { const k = run.pickKind(Rules.SURVIVOR_ZONES.marais.x, Rules.SURVIVOR_ZONES.marais.y); counts[k] = (counts[k] || 0) + 1; }
  assert.ok((counts.rat || 0) > (counts.gobelin || 0) * 2, 'marais : les rats d\'abord');
  // Élite toutes les 50 s
  run.eliteT = 0.01;
  run.tick(0.05);
  const elite = run.enemies.find((e) => e.elite);
  assert.ok(elite && elite.maxHp >= Rules.SURVIVOR_ENEMIES[elite.kind].hp * SV.elite.hp * 0.99);
  run.kill(elite);
  assert.ok(run.pickups.some((k) => k.type === 'chest' && k.count === 1));
  // Vague 5 : le boss arrive
  run.waveT = SV.waveSeconds * 4 - 0.01;
  run.tick(0.05);
  assert.strictEqual(run.wave, 5);
  assert.ok(run.boss && run.boss.kind === 'troll');
  run.kill(run.boss);
  assert.strictEqual(run.bosses, 1);
  assert.ok(run.pickups.some((k) => k.type === 'chest' && k.count === 3));
});

test('[SV-4] survivor : gemmes d\'XP, pause pendant le choix, armes jusqu\'au niveau 8, objets, coffres, relances', () => {
  assert.strictEqual(Rules.survivorXpToNext(1), 4);
  assert.deepStrictEqual(Rules.survivorWeaponStats('epee', 2).amount, 2);
  assert.deepStrictEqual([Rules.survivorWeaponStats('dagues', 1).amount, Rules.survivorWeaponStats('dagues', 8).amount], [3, 10]);
  assert.deepStrictEqual(Object.values(Rules.SURVIVOR_BOSSES).map((b) => b.speed), [87, 99, 93, 96, 87, 93], 'boss ×1,5 plus rapides');
  // Dagues : une volée tout autour du joueur
  const dr = new sv.SurvivorRun({});
  dr.weapons = [];
  dr.addWeapon('dagues');
  dr.weapons[0].cd = 0;
  dr.fireWeapons(0.05);
  const angles = dr.shots.map((s) => Math.atan2(s.vy, s.vx)).sort((a, b) => a - b);
  assert.strictEqual(angles.length, 3);
  assert.ok(Math.abs(angles[1] - angles[0] - (2 * Math.PI) / 3) < 1e-6 && Math.abs(angles[2] - angles[1] - (2 * Math.PI) / 3) < 1e-6, 'espacées de 120°');
  assert.match(Rules.survivorLevelText('dagues', 2), /\+1 projectile/);
  const run = new sv.SurvivorRun({ weapons: ['epee', 'dagues', 'baguette'], passives: ['coeur', 'bottes'] });
  run.gems.push({ x: run.p.x, y: run.p.y, v: 10, pull: true });
  run.tick(0.05);
  assert.ok(run.level >= 2 && run.pending, 'montée de niveau : choix ouvert');
  const t = run.t;
  run.tick(0.05);
  assert.strictEqual(run.t, t, 'la partie est en pause pendant le choix');
  const opts = run.pending.options;
  assert.ok(opts.length >= 3 && opts.every((o) => ['weapon', 'passive'].includes(o.type)));
  assert.throws(() => run.choose(0, run.pending.id + 1), /déjà été fait/);
  // Objet : son effet s'ajoute à chaque exemplaire
  run.pending.options = [{ type: 'passive', id: 'coeur', level: 1 }];
  run.choose(0, run.pending.id);
  assert.strictEqual(run.stats.maxHp, 140);
  run.apply({ type: 'passive', id: 'coeur', level: 2 });
  assert.strictEqual(run.stats.maxHp, 160);
  // Arme : jusqu'au niveau 8, puis plus proposée
  for (let i = 0; i < 10; i++) run.apply({ type: 'weapon', id: 'epee' });
  assert.strictEqual(run.weapons[0].level, 8);
  assert.ok(!run.options(20).some((o) => o.type === 'weapon' && o.id === 'epee'));
  // Rien à proposer : poulet rôti ou éclat d'émeraude
  const full = new sv.SurvivorRun({ weapons: ['epee'], passives: [] });
  full.weapons[0].level = 8;
  assert.deepStrictEqual(full.options(3).map((o) => o.type), ['heal', 'emerald']);
  // Coffre : améliorations appliquées tout de suite
  const before = run.weapons.length + Object.keys(run.passives).length;
  run.openChest(3);
  assert.ok(run.events.some((e) => e.k === 'chest' && e.items.length === 3));
  assert.ok(run.weapons.length + Object.keys(run.passives).length >= before);
  // Relances (méta-progression)
  const rr = new sv.SurvivorRun({ meta: { relance: 2 } });
  assert.strictEqual(rr.rerolls, 2);
  rr.openChoice();
  rr.reroll();
  assert.strictEqual(rr.rerolls, 1);
  assert.throws(() => new sv.SurvivorRun({}).reroll(), /Aucun choix/);
});

test('[SV-5] survivor : seconde vie, mort, abandon, pause automatique et fin après 10 min', () => {
  const run = new sv.SurvivorRun({ meta: { resurrection: 1 } });
  run.spawnEnemy('gobelin', { x: run.p.x + 100, y: run.p.y });
  run.hp = 0;
  run.tick(0.05);
  assert.ok(!run.over && run.hp === run.stats.maxHp * 0.5 && run.revivals === 0, 'seconde vie à 50 %');
  run.hp = 0;
  run.tick(0.05);
  assert.ok(run.over && run.over.score === Rules.survivorScore(run.over));
  // Pause automatique sans nouvelles du joueur, fin après 10 min de pause
  const u = player();
  sv.start(u);
  const r = sv.runs.get(u.id);
  const now = Date.now();
  let ended = null;
  sv.tickAll(null, (id, res) => { ended = res; }, 2, now + SV.idlePause * 1000 + 100);
  assert.strictEqual(r.run.paused, true);
  sv.input(u.id, { x: r.run.p.x, y: r.run.p.y, fx: 1, fy: 0 });
  assert.strictEqual(r.run.paused, false, 'le joueur revient : la partie reprend');
  sv.setPause(u.id, true);
  sv.tickAll(null, (id, res) => { ended = res; }, 2, Date.now() + SV.abandonAfter * 1000 + 2000);
  assert.ok(ended && !sv.runs.has(u.id));
  // Abandon
  const v = player();
  sv.start(v);
  const res = sv.abandon(v.id);
  assert.ok(res && !sv.runs.has(v.id) && v.character.survivorActive === null);
});

test('[SV-6] survivor : émeraudes, récompense du jour à la vague 30, record, historique et statistiques', () => {
  assert.strictEqual(Rules.survivorEmeralds({ wave: 1 }), 0);
  assert.strictEqual(Rules.survivorEmeralds({ wave: 10, bosses: 2, kills: 450 }), Math.floor((9 * 18) / 4) + 20 + 4);
  assert.strictEqual(Rules.survivorScore({ time: 61.7, kills: 12, bosses: 1 }), 610 + 12 + 1000);
  const u = player();
  u.character.survivor.meta.avidite = 2;
  sv.start(u);
  const run = sv.runs.get(u.id).run;
  Object.assign(run, { t: 30 * 29 + 5, wave: 30, kills: 1234, bosses: 5, bonusEmeralds: 4 });
  run.passives.bourse = 1; // Bourse de gemmes : +6 % en plus de l'Avidité
  run.recompute();
  const now = Date.UTC(2026, 10, 17, 12);
  const r = sv.finish(u.id, now);
  const expected = Math.round(Rules.survivorEmeralds(r) * 1.26) + 4 + Rules.SURVIVOR_CHALLENGE_REWARD * r.challenges.length; // + défis du jour réussis
  assert.strictEqual(r.emeralds, expected);
  assert.strictEqual(u.character.emeralds, expected);
  assert.deepStrictEqual(r.daily, { chests: 10, keys: 3 });
  assert.strictEqual(u.character.survivor.dailyDate, Rules.parisDay(now));
  assert.ok(r.record && u.character.survivor.best.score === r.score);
  assert.deepStrictEqual([u.character.counters.svBestWave, u.character.counters.svBosses], [30, 5]);
  assert.strictEqual(u.character.history[0].mode, 'survivor');
  assert.deepStrictEqual([u.character.lifetime.survivorRuns, u.character.lifetime.survivorKills, u.character.lifetime.emeraldsEarned], [1, 1234, expected]);
  // Le même jour : pas de deuxième récompense
  const chests = u.character.chests;
  sv.start(u);
  Object.assign(sv.runs.get(u.id).run, { t: 900, wave: 31 });
  assert.strictEqual(sv.finish(u.id, now + 3600 * 1000).daily, null);
  assert.strictEqual(u.character.chests, chests);
  assert.ok(Rules.achievementById('sv30') && Rules.achievementById('svBoss10'));
});

test('[SV-7] survivor : méta-progression, déblocages, arme de départ', () => {
  assert.strictEqual(Rules.survivorMetaCost('vitalite', 0), 120);
  assert.strictEqual(Rules.survivorMetaCost('vitalite', 1), 210);
  assert.strictEqual(Rules.survivorMetaCost('resurrection', 1), null);
  const u = player();
  const c = u.character;
  assert.throws(() => sv.buyMeta(c, 'vitalite'), /120 émeraudes/);
  c.emeralds = 100000;
  assert.deepStrictEqual(sv.buyMeta(c, 'vitalite'), { id: 'vitalite', level: 1, cost: 120 });
  assert.throws(() => sv.buyMeta(c, 'pouvoir'), /inconnue/);
  assert.deepStrictEqual(sv.unlockedWeapons(c), ['epee', 'dagues', 'baguette']);
  assert.deepStrictEqual(sv.starters(c), ['epee']);
  assert.throws(() => sv.buyUnlock(c, 'starter', 'hache'), /Débloque d'abord/);
  sv.buyUnlock(c, 'weapon', 'hache');
  assert.throws(() => sv.buyUnlock(c, 'weapon', 'hache'), /Déjà/);
  sv.buyUnlock(c, 'starter', 'hache');
  sv.buyUnlock(c, 'passive', 'armure');
  assert.ok(sv.unlockedWeapons(c).includes('hache') && sv.starters(c).includes('hache') && sv.unlockedPassives(c).includes('armure'));
  assert.deepStrictEqual(sv.setStarter(c, 'hache'), { starter: 'hache' });
  assert.throws(() => sv.setStarter(c, 'foudre'), /pas débloquée/);
  const run = sv.start(u);
  assert.deepStrictEqual(run.weapons.map((w) => w.id), ['hache']);
  assert.ok(run.pool.weapons.includes('hache') && run.pool.passives.includes('armure'));
  assert.strictEqual(run.stats.maxHp, 130);
  sv.abandon(u.id);
});

test('[SV-10] survivor : autels et bénédictions, éclats d\'émeraude, trésors gardés', () => {
  const X = Rules.SURVIVOR_EXPLORE;
  const Z = Rules.SURVIVOR_ZONES;
  assert.deepStrictEqual([X.altar.charge, X.altar.duration, X.altar.cooldown, X.altar.mult], [2, 40, 150, 1.5]);
  const run = new sv.SurvivorRun({});
  assert.strictEqual(run.altars.length, 8);
  assert.ok(!run.altars.some((a) => a.zone === 'village'));
  // Autel de la forêt : 2 s dessus
  run.treasureT = 1e9;
  run.shardT = 1e9;
  Object.assign(run.p, { x: Z.foret.x + 20, y: Z.foret.y });
  run.hp = 50;
  tickFor(run, 1.9);
  assert.strictEqual(run.blessing, null);
  run.events = [];
  tickFor(run, 0.2);
  assert.strictEqual(run.blessing.zone, 'foret');
  assert.ok(Math.abs(run.blessing.until - (run.t + 40)) < 0.2);
  assert.ok(run.hp >= 50 + run.stats.maxHp * X.altar.heal - 1, 'rend 25 % des PV');
  assert.strictEqual(run.found.altars, 1);
  assert.ok(run.events.some((e) => e.k === 'bless' && e.zone === 'foret'));
  const A = run.altars.find((a) => a.zone === 'foret');
  assert.ok(Math.abs(A.readyAt - (run.t + 150)) < 0.2);
  tickFor(run, 3);
  assert.strictEqual(run.found.altars, 1, 'en recharge');
  // La bénédiction suit le joueur partout
  Object.assign(run.p, { x: Z.village.x, y: Z.village.y });
  run.tick(0.05);
  assert.ok(Math.abs(run.fx.xp - (-0.25 + 0.45)) < 1e-9);
  run.t = run.blessing.until;
  run.events = [];
  run.tick(0.05);
  assert.strictEqual(run.blessing, null);
  assert.ok(run.events.some((e) => e.k === 'blessEnd'));
  // Éclats d'émeraude : loin du joueur, jamais au village, 4 au plus
  for (let i = 0; i < 6; i++) { run.shardT = 0; run.tick(0.05); }
  assert.strictEqual(run.shards.length, X.shard.max);
  for (const s of run.shards) {
    assert.notStrictEqual(Rules.survivorZone(s.x, s.y), 'village');
    const d = Math.hypot(s.x - run.p.x, s.y - run.p.y);
    assert.ok(d >= X.shard.dist[0] - 1 && d <= X.shard.dist[1] + 1, `distance ${d}`);
  }
  run.shardT = 1e9;
  Object.assign(run.p, { x: run.shards[0].x, y: run.shards[0].y });
  run.tick(0.05);
  assert.deepStrictEqual([run.shards.length, run.bonusEmeralds, run.found.shards], [X.shard.max - 1, 1, 1]);
  // Trésor gardé : ni au village ni dans le lieu-dit du joueur, avec une élite pour le garder
  Object.assign(run.p, { x: Z.village.x, y: Z.village.y });
  run.enemies = [];
  run.treasureT = 0;
  run.tick(0.05);
  const T = run.treasure;
  assert.ok(T && T.zone !== 'village');
  assert.ok(run.enemies.some((e) => e.elite && Math.hypot(e.x - T.x, e.y - T.y) < 120));
  assert.strictEqual(run.enemies.filter((e) => e.guard).length, 1 + X.treasure.guards);
  assert.ok(run.enemies.every((e) => Rules.SURVIVOR_ENEMIES[e.kind].from <= run.wave), 'monstres de la vague en cours');
  tickFor(run, 5); // le joueur est loin : les gardiens restent au trésor
  assert.ok(run.enemies.filter((e) => e.guard).every((e) => Math.hypot(e.x - T.x, e.y - T.y) < 160));
  run.treasureT = 0;
  run.tick(0.05);
  assert.strictEqual(run.treasure, T, 'un seul à la fois');
  const before = run.weapons.reduce((a, w) => a + w.level, 0) + Object.values(run.passives).reduce((a, l) => a + l, 0);
  run.enemies = [];
  Object.assign(run.p, { x: T.x, y: T.y });
  run.events = [];
  run.tick(0.05);
  assert.strictEqual(run.treasure, null);
  assert.deepStrictEqual([run.bonusEmeralds, run.found.treasures], [4, 1]);
  assert.strictEqual(run.events.find((e) => e.k === 'chest').items.length, 2);
  const after = run.weapons.reduce((a, w) => a + w.level, 0) + Object.values(run.passives).reduce((a, l) => a + l, 0);
  assert.ok(after >= before + 1, 'les améliorations sont appliquées');
  assert.deepStrictEqual(run.finish().found, { shards: 1, altars: 1, treasures: 1, evos: [], legends: [], carts: 0, nights: 0, bombs: 0 });
  // L'image envoie l'état de l'exploration
  const f = run.frame();
  assert.ok(['zone', 'alt', 'sh', 'em'].every((k) => k in f), Object.keys(f).join());
});

test('[SV-8] survivor : projectiles envoyés avec identifiant, position et vitesse', () => {
  const run = new sv.SurvivorRun({});
  run.eshots.push({ x: run.p.x + 100, y: run.p.y, vx: -120, vy: 30, r: 8, damage: 1, life: 3, kind: 'bone' });
  run.shots.push({ id: 999, x: run.p.x - 50, y: run.p.y, vx: 200, vy: 0, homing: true, life: 2, r: 10, pierce: 1, hit: new Set() });
  const f = run.frame();
  assert.strictEqual(f.es.length, 6);
  const [id, x, , kind, vx, vy] = f.es;
  assert.ok(id > 0);
  assert.deepStrictEqual([x, kind, vx, vy], [Math.round(run.p.x + 100), 0, -120, 30]);
  assert.strictEqual(run.frame().es[0], id, 'même identifiant d\'une image à l\'autre');
  assert.deepStrictEqual(f.bo, [999, Math.round(run.p.x - 50), Math.round(run.p.y), 200, 0]);
  // Gemmes : [id, x, y, taille, vitesse d'attraction]
  run.gems = [];
  run.dropGem(run.p.x + 300, run.p.y, 5);
  run.dropGem(run.p.x + 30, run.p.y, 25);
  run.gems[1].pull = true;
  run.gems[1].sp = 400;
  const g = run.frame().g;
  assert.strictEqual(g.length, 10);
  assert.deepStrictEqual([g[3], g[4], g[8], g[9]], [1, 0, 2, 400]);
  assert.ok(g[0] > 0 && g[5] > g[0]);
});

test('[SV-11] survivor : carte agrandie, eau qui ralentit joueur et ennemis, ponts', () => {
  const M = Rules.survivorMap();
  assert.strictEqual(SV.mapScale, 2.25);
  assert.ok(M.bridges.length >= 2, 'des ponts là où les routes croisent la rivière');
  const mid = M.river[Math.floor(M.river.length / 2)];
  assert.strictEqual(Rules.survivorWater(mid[0], mid[1]), true, 'rivière');
  const L = M.lake.reduce((a, p) => [a[0] + p[0] / M.lake.length, a[1] + p[1] / M.lake.length], [0, 0]);
  assert.strictEqual(Rules.survivorWater(L[0], L[1]), true, 'lac gelé');
  for (const b of M.bridges) assert.strictEqual(Rules.survivorWater(b.x, b.y), false, 'sur un pont, on passe normalement');
  for (const r of M.roads) assert.ok(r.every(([x, y]) => !Rules.survivorWater(x, y)), 'les routes restent au sec');
  for (const z of Object.values(Rules.SURVIVOR_ZONES)) assert.strictEqual(Rules.survivorWater(z.x, z.y), false, `autel ${z.label} au sec`);
  // Joueur : vitesse ×0,5 dans l'eau, et la position envoyée est bornée en conséquence
  const run = new sv.SurvivorRun({});
  const dry = run.baseSpeed();
  Object.assign(run.p, { x: mid[0], y: mid[1] });
  assert.ok(Math.abs(run.speedNow() - dry * SV.waterSlow) < 1e-9);
  assert.strictEqual(run.frame().spd, Math.round(dry), 'le navigateur reçoit la vitesse hors eau et applique lui-même l\'eau');
  const dir = [M.river[Math.floor(M.river.length / 2) + 1][0] - mid[0], M.river[Math.floor(M.river.length / 2) + 1][1] - mid[1]];
  const len = Math.hypot(dir[0], dir[1]);
  run.setPos(mid[0] + (dir[0] / len) * 500, mid[1] + (dir[1] / len) * 500, 1, 0, 0.1);
  const moved = Math.hypot(run.p.x - mid[0], run.p.y - mid[1]);
  assert.ok(moved <= dry * SV.waterSlow * 0.1 * SV.moveSlack + 4 + 1e-6, `ralenti dans l'eau (${moved})`);
  // Ennemis : ralentis aussi
  run.enemies = [];
  Object.assign(run.p, { x: mid[0], y: mid[1] + 300 });
  const e = run.spawnEnemy('rat', { x: mid[0], y: mid[1] });
  const side = [300, -300, 0].find((dx) => !Rules.survivorWater(run.p.x + dx, run.p.y + (dx ? 0 : 300)));
  const f = run.spawnEnemy('rat', { x: run.p.x + side, y: run.p.y + (side ? 0 : 300) });
  assert.deepStrictEqual([Rules.survivorWater(e.x, e.y), Rules.survivorWater(f.x, f.y)], [true, false]);
  const [ex, ey, fx, fy] = [e.x, e.y, f.x, f.y];
  run.buildGrid();
  run.updateEnemies(0.1);
  const de = Math.hypot(e.x - ex, e.y - ey);
  const df = Math.hypot(f.x - fx, f.y - fy);
  assert.ok(Math.abs(de - df * SV.waterSlow) < 0.5, `rat dans l'eau ${de} / au sec ${df}`);
});

test('[SV-12] survivor : 25 objets, nouveaux effets (esquive, bouclier, épines, vampire, sablier, plume, faucon, cor, gourde, talisman, givre, boussole, tome)', () => {
  const P = Rules.SURVIVOR_PASSIVES;
  assert.strictEqual(Object.keys(P).length, 25);
  assert.ok(Object.keys(P).every((id) => id in Rules.SURVIVOR_UNLOCKS.passives), 'chaque objet a un prix de déblocage');
  assert.ok(['cape', 'epines', 'croc', 'sablier', 'plume', 'oeil', 'bouclier', 'bourse', 'boussole', 'cor', 'gourde', 'talisman', 'givre', 'tome'].every((id) => Rules.SURVIVOR_UNLOCKS.passives[id] >= 6000));
  assert.strictEqual(Rules.survivorStats({}, { cape: 20 }).dodge, 0.4, 'esquive plafonnée à 40 %');
  const mk = (passives) => { const r = new sv.SurvivorRun({ random: () => 0.5 }); r.passives = passives; r.recompute(); r.enemies = []; return r; };
  // Esquive
  let r = mk({ cape: 5 });
  r.rand = () => 0.1;
  assert.strictEqual(r.hurt(50), false);
  assert.strictEqual(r.hp, r.stats.maxHp);
  // Bouclier runique : bloque un coup, puis 15 s de recharge au niveau 1
  r = mk({ bouclier: 1 });
  assert.strictEqual(r.hurt(30), false);
  assert.strictEqual(r.hurt(30), true);
  assert.strictEqual(r.shieldAt, 15);
  // Épines : l'ennemi au contact prend des dégâts
  r = mk({ epines: 2 });
  const e = r.spawnEnemy('slime', { x: r.p.x + 5, y: r.p.y });
  const hp = e.hp;
  r.buildGrid();
  r.updateEnemies(0.05);
  assert.ok(Math.abs(hp - e.hp - 24) < 1e-6, `épines ${hp - e.hp}`);
  // Croc de vampire + Gourde de soin
  r = mk({ croc: 5, gourde: 5 });
  r.hp = 50;
  r.kill(r.spawnEnemy('rat', { x: r.p.x + 400, y: r.p.y }));
  assert.ok(Math.abs(r.hp - (50 + 1.5 * 2)) < 1e-9);
  // Œil de faucon et Cor de guerre
  r = mk({ oeil: 2, cor: 1, trefle: 0 });
  r.rand = () => 0;
  r.stats.crit = 1;
  const boss = r.spawnEnemy('rat', { x: r.p.x + 600, y: r.p.y, elite: true });
  const before = boss.hp;
  r.damage(boss, 10, null, 0);
  assert.ok(Math.abs(before - boss.hp - 10 * 2.5 * 1.12) < 1e-6);
  // Rune de givre : ralenti 1 s ; Talisman : recul plus fort
  r = mk({ givre: 5, talisman: 3 });
  const g = r.spawnEnemy('rat', { x: r.p.x + 300, y: r.p.y });
  r.damage(g, 1, null, 100);
  assert.deepStrictEqual([g.chill, g.chillUntil], [0.4, 1]);
  assert.ok(Math.abs(g.kx - 100 * 2.05) < 1e-6);
  // Sablier et Plume du vent : durée et vitesse des dagues
  r = mk({ sablier: 5, plume: 5 });
  r.weapons = [];
  r.addWeapon('dagues');
  r.weapons[0].cd = 0;
  r.fireWeapons(0.05);
  const shot = r.shots[0];
  const W = r.weapons[0].s;
  assert.ok(Math.abs(shot.life - W.duration * 1.6) < 1e-9 && Math.abs(Math.hypot(shot.vx, shot.vy) - W.speed * 1.6) < 1e-6);
  // Boussole : bénédiction plus longue, autel rechargé plus vite
  r = mk({ boussole: 2 });
  const A = r.altars[0];
  Object.assign(r.p, { x: A.x, y: A.y });
  r.treasureT = 1e9;
  r.shardT = 1e9;
  tickFor(r, 2.2);
  assert.ok(Math.abs(r.blessing.until - r.t - 40 * 1.5) < 0.35);
  assert.ok(Math.abs(A.readyAt - r.t - 150 * 0.7) < 0.35);
  // Tome des possibles : une relance de plus à la prise
  r = mk({});
  const rr = r.rerolls;
  r.apply({ type: 'passive', id: 'tome' });
  assert.strictEqual(r.rerolls, rr + 1);
});

test('[SV-13] survivor : vague de boss bloquée tant que le boss vit, rage au bout de 3 min', () => {
  const run = new sv.SurvivorRun({ meta: { vitalite: 10, carapace: 5 } });
  run.hurt = () => false; // invulnérable pour le test
  run.waveT = SV.waveSeconds * 4 - 0.01;
  run.tick(0.05);
  const boss = run.boss;
  assert.ok(boss && run.wave === 5);
  boss.hp = boss.maxHp = 1e12; // increvable pour le test
  // Fin de la vague 5 : on reste bloqué en vague 5 tant que le boss vit, les monstres continuent d'arriver
  tickFor(run, SV.waveSeconds + 5);
  assert.strictEqual(run.wave, 5);
  assert.ok(run.held);
  assert.strictEqual(run.frame().hold, true);
  assert.strictEqual(run.boss, boss, 'le boss reste (il n\'est pas remplacé)');
  const count = run.enemies.filter((e) => !e.boss).length;
  run.enemies = run.enemies.filter((e) => e.boss);
  tickFor(run, 3);
  assert.ok(count > 0 && run.enemies.some((e) => !e.boss), 'les monstres continuent d\'apparaître');
  // Rage : 3 min après son apparition, vitesse et dégâts ×1,5, attaques plus fréquentes
  assert.strictEqual(boss.rage, false);
  const [speed, damage] = [boss.speed, boss.damage];
  run.events = [];
  boss.spawnT = run.t - SV.bossRage.after;
  run.tick(0.05);
  assert.strictEqual(boss.rage, true);
  assert.ok(run.events.some((e) => e.k === 'bossRage'));
  assert.deepStrictEqual([boss.speed, boss.damage], [speed * 1.5, damage * 1.5]);
  assert.strictEqual(run.frame().b.rage, true);
  boss.special = 0;
  run.tick(0.05);
  assert.ok(Math.abs(boss.special - Rules.SURVIVOR_BOSSES[boss.kind].every * SV.bossRage.special) < 0.06);
  // Boss vaincu : la vague 6 arrive
  run.kill(boss);
  tickFor(run, 0.2);
  assert.strictEqual(run.wave, 6);
  assert.ok(!run.held);
});

// ---------- Lot 1 : routes, montre et bombe, évolutions, gardiens, sanctuaires, chariot, jour/nuit, armes secrètes, défis ----------

const fresh = (o = {}) => { const r = new sv.SurvivorRun({ random: o.random }); r.enemies = []; r.lairs = []; r.shrines = []; r.cartT = 1e9; r.treasureT = 1e9; r.shardT = 1e9; r.eliteT = 1e9; r.spawnAcc = -1e9; return r; };

test('[SV-11, SV-2] survivor : carte de 10 800 px, 16 routes au sec, +10 % de vitesse sur la route', () => {
  const M = Rules.survivorMap();
  assert.strictEqual(M.roads.length, 16, '8 routes depuis le village et une boucle de 8 tronçons');
  const inPoly = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i]; const [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  for (const r of M.roads) assert.ok(r.every(([x, y]) => !inPoly(x, y, M.lake) && !inPoly(x, y, M.pond) && Math.hypot(x - M.crater.x, y - M.crater.y) >= M.crater.r), 'les routes contournent lac, mare et cratère');
  const onRoad = M.roads[10][Math.floor(M.roads[10].length / 2)];
  assert.strictEqual(Rules.survivorRoad(onRoad[0], onRoad[1]), true);
  assert.strictEqual(Rules.survivorGround(onRoad[0], onRoad[1]), 1.1);
  for (const b of M.bridges) assert.strictEqual(Rules.survivorRoad(b.x, b.y), true, 'les ponts comptent comme la route');
  const run = fresh();
  Object.assign(run.p, { x: onRoad[0], y: onRoad[1] });
  assert.ok(Math.abs(run.speedNow() - run.baseSpeed() * 1.1) < 1e-9);
  const z = Rules.SURVIVOR_ZONES.foret;
  Object.assign(run.p, { x: z.x, y: z.y + 40 });
  if (!Rules.survivorRoad(run.p.x, run.p.y) && !Rules.survivorWater(run.p.x, run.p.y)) assert.ok(Math.abs(run.speedNow() - run.baseSpeed()) < 1e-9, 'hors route : vitesse normale');
});

test('[SV-14] survivor : la Montre ralentit monstres et projectiles ennemis, la Bombe pulvérise les monstres à l\'écran', () => {
  assert.deepStrictEqual(SV.drops, { chicken: 0.004, magnet: 0.0015, watch: 0.0012, bomb: 0.0006 });
  // Tirage unique : chaque bonus tombe dans sa tranche
  const drop = (r) => { const run = fresh({ random: () => r }); const e = run.spawnEnemy('rat', { x: run.p.x + 300, y: run.p.y }); run.kill(e); return run.pickups.map((k) => k.type); };
  assert.deepStrictEqual([drop(0.003), drop(0.005), drop(0.0063), drop(0.0072), drop(0.5)], [['chicken'], ['magnet'], ['watch'], ['bomb'], []]);
  // Montre
  const run = fresh();
  run.pickups.push({ type: 'watch', x: run.p.x, y: run.p.y });
  run.tick(0.05);
  assert.ok(Math.abs(run.slowUntil - (run.t + 10)) < 0.06);
  assert.ok(run.events.some((e) => e.k === 'watch'));
  const P = run.p;
  const rat = run.spawnEnemy('rat', { x: P.x + 400, y: P.y });
  run.spawnBoss({ kind: 'troll', hp: 1e6, damage: 1 });
  const boss = run.boss;
  Object.assign(boss, { x: P.x - 400, y: P.y });
  const shot = { x: P.x, y: P.y - 300, vx: 0, vy: 200, r: 8, damage: 1, life: 3, kind: 'bone' };
  run.eshots.push(shot);
  const [rx, bx, sy] = [rat.x, boss.x, shot.y];
  run.buildGrid();
  run.updateEnemies(0.1);
  run.updateEnemyShots(0.1);
  const W = Rules.survivorWave(run.wave);
  assert.ok(Math.abs((rx - rat.x) - rat.speed * 0.35 * 0.1) < 0.5, 'monstre ×0,35');
  assert.ok(Math.abs((boss.x - bx) - boss.speed * 0.7 * 0.1) < 0.5, 'boss ×0,7');
  assert.ok(Math.abs((shot.y - sy) - 200 * 0.35 * 0.1) < 1e-6, 'projectile ×0,35');
  const f = run.frame();
  assert.ok(f.slow > 9 && f.slow <= 10);
  assert.ok(W.hp > 0);
  run.t = run.slowUntil;
  assert.strictEqual(run.timeMult(rat), 1, 'fin du ralenti');
  // Bombe : monstres normaux à l'écran tués, élite et chariot à moitié, boss et monstres hors écran épargnés
  const b = fresh();
  const Q = b.p;
  const near = [0, 1, 2, 3].map((i) => b.spawnEnemy('gobelin', { x: Q.x + 100 + i * 30, y: Q.y }));
  const far = b.spawnEnemy('gobelin', { x: Q.x + 2000, y: Q.y });
  const elite = b.spawnEnemy('gobelin', { x: Q.x - 120, y: Q.y, elite: true });
  b.spawnBoss({ kind: 'troll', hp: 5000, damage: 1 });
  Object.assign(b.boss, { x: Q.x, y: Q.y + 150 });
  b.pickups.push({ type: 'bomb', x: Q.x, y: Q.y });
  b.updatePickups(0.05);
  assert.ok(near.every((e) => e.dead) && !far.dead);
  assert.ok(!elite.dead && Math.abs(elite.hp - elite.maxHp * 0.5) < 1e-6);
  assert.strictEqual(b.boss.hp, 5000);
  assert.strictEqual(b.kills, 4);
  assert.strictEqual(b.found.bombs, 1);
  assert.ok(b.events.some((e) => e.k === 'bomb' && e.n === 5));
  assert.ok(b.gems.length >= 4, 'les monstres pulvérisés lâchent leurs gemmes');
});

test('[SV-15] survivor : évolutions d\'armes (niveau 8 + objet, au prochain coffre), cinématique et nouveaux comportements', () => {
  const E = Rules.SURVIVOR_EVOLUTIONS;
  assert.deepStrictEqual(Object.keys(E).sort(), ['aura', 'baguette', 'dagues', 'epee', 'fiole', 'foudre', 'hache', 'orbes']);
  for (const [id, ev] of Object.entries(E)) assert.ok(Rules.SURVIVOR_PASSIVES[ev.passive] && ev.label && ev.stats.damage > Rules.survivorWeaponStats(id, 8).damage, `${id} : objet lié, plus fort qu'au niveau 8`);
  assert.deepStrictEqual(Rules.survivorEvoReady([{ id: 'epee', level: 8 }, { id: 'dagues', level: 7 }], { gant: 1, bottes: 2 }), ['epee']);
  assert.deepStrictEqual(Rules.survivorEvoReady([{ id: 'epee', level: 8, evo: true }], { gant: 1 }), []);
  const run = fresh();
  const w = run.weapons[0];
  w.level = 8; w.s = run.weaponStats(w);
  run.openChest(1);
  assert.ok(!w.evo, 'sans son objet : pas d\'évolution');
  run.passives.gant = 1;
  run.recompute();
  run.events = [];
  run.openChest(3);
  assert.ok(w.evo);
  assert.deepStrictEqual(w.s, E.epee.stats);
  const chest = run.events.find((e) => e.k === 'chest');
  assert.deepStrictEqual([chest.items.length, chest.items[0]], [3, { type: 'evo', id: 'epee' }]);
  assert.ok(run.events.some((e) => e.k === 'evolve' && e.id === 'epee'));
  assert.deepStrictEqual(run.found.evos, ['epee']);
  // Cinématique : le jeu s'arrête 2,6 s
  const t0 = run.t;
  const x0 = run.p.x;
  run.setPos(x0 + 10, run.p.y, 1, 0, 0.1);
  assert.strictEqual(run.p.x, x0, 'position ignorée pendant la cinématique');
  assert.ok(run.frame().cine);
  tickFor(run, 2.5);
  assert.strictEqual(run.t, t0);
  tickFor(run, 0.2);
  assert.ok(run.t > t0);
  run.recompute();
  assert.deepStrictEqual(w.s, E.epee.stats, 'l\'évolution survit à un recalcul');
  // Lame du Héros : tout autour
  run.events = [];
  const behind = run.spawnEnemy('slime', { x: run.p.x - 80, y: run.p.y + 60 });
  w.cd = 0;
  run.buildGrid();
  run.fireWeapons(0.05);
  assert.ok(behind.hp < behind.maxHp && run.events.some((e) => e.k === 'spin'));
  // Tempête de lames : les dagues reviennent et peuvent retoucher
  const d = fresh();
  d.weapons = [];
  const dw = d.addWeapon('dagues'); dw.evo = true; dw.level = 8; dw.s = d.weaponStats(dw); dw.cd = 0;
  d.buildGrid();
  d.fireWeapons(0.05);
  assert.ok(d.shots.length >= 12 && d.shots.every((s) => s.ret));
  const s0 = d.shots[0];
  const vx = s0.vx;
  for (let i = 0; i < 14; i++) { d.buildGrid(); d.updateShots(0.05); }
  assert.ok(s0.back && Math.sign(s0.vx) === -Math.sign(vx), 'demi-tour à mi-course');
  // Sanctuaire ardent : soigne selon les ennemis brûlés
  const a = fresh();
  a.weapons = [];
  const aw = a.addWeapon('aura'); aw.evo = true; aw.level = 8; aw.s = a.weaponStats(aw); aw.cd = 0;
  for (let i = 0; i < 4; i++) a.spawnEnemy('slime', { x: a.p.x + 30 + i * 10, y: a.p.y });
  a.hp = 50;
  a.buildGrid();
  a.fireWeapons(0.05);
  assert.ok(Math.abs(a.hp - (50 + 4 * 0.6)) < 1e-6);
  // Couronne d'orage : rebonds
  const z = fresh({ random: () => 0 });
  z.weapons = [];
  const zw = z.addWeapon('foudre'); zw.evo = true; zw.level = 8; zw.s = z.weaponStats(zw); zw.cd = 0;
  for (let i = 0; i < 6; i++) z.spawnEnemy('slime', { x: z.p.x + 200 + i * 150, y: z.p.y });
  z.buildGrid();
  z.fireWeapons(0.05);
  assert.ok(z.events.some((e) => e.k === 'zap' && e.chain && e.chain.length >= 1));
  // Anneau éternel : toujours actif, deux anneaux
  const o = fresh();
  o.weapons = [];
  const ow = o.addWeapon('orbes'); ow.evo = true; ow.level = 8; ow.s = o.weaponStats(ow);
  o.buildGrid();
  o.fireWeapons(0.05);
  assert.ok(ow.on);
  o.t += 100;
  o.fireWeapons(0.05);
  assert.ok(ow.on, 'ne s\'arrête jamais');
  assert.strictEqual(o.frame().orb.rings.length, 2);
  // Marée d'acide : flaque sous le joueur, qui ralentit
  const m = fresh();
  m.weapons = [];
  const mw = m.addWeapon('fiole'); mw.evo = true; mw.level = 8; mw.s = m.weaponStats(mw); mw.cd = 0;
  m.buildGrid();
  m.fireWeapons(0.05);
  assert.ok(m.areas.some((ar) => ar.k === 'acid' && ar.slow && ar.x === m.p.x && ar.y === m.p.y));
  const slimy = m.spawnEnemy('slime', { x: m.p.x + 5, y: m.p.y });
  m.buildGrid();
  m.updateAreas(0.05);
  assert.ok(slimy.chillUntil > m.t && slimy.chill >= 0.4);
});

test('[SV-16] survivor : gardiens légendaires (2 ou 3 au hasard, réveil sur le sceau, un seul à la fois, retour au sommeil, récompense)', () => {
  const GD = Rules.SURVIVOR_GUARDIAN;
  assert.deepStrictEqual(Object.keys(Rules.SURVIVOR_GUARDIANS).sort(), Object.keys(Rules.SURVIVOR_ZONES).filter((z) => z !== 'village').sort());
  const counts = new Set();
  for (let k = 0; k < 20; k++) {
    const r = new sv.SurvivorRun({});
    counts.add(r.lairs.length);
    assert.strictEqual(new Set(r.lairs.map((l) => l.zone)).size, r.lairs.length, 'lieux-dits différents');
    assert.ok(r.lairs.every((l) => l.zone !== 'village' && !Rules.survivorWater(l.x, l.y) && !Rules.survivorWater(l.sx, l.sy)));
  }
  assert.ok([...counts].every((c) => c === 2 || c === 3));
  const run = new sv.SurvivorRun({});
  Object.assign(run, { treasureT: 1e9, shardT: 1e9, eliteT: 1e9, cartT: 1e9 });
  run.spawnAcc = -1e9;
  run.shrines = [];
  run.hurt = () => false;
  assert.ok(!run.enemies.some((e) => e.legend), 'endormis : pas des cibles');
  const [l1, l2] = run.lairs;
  Object.assign(run.p, { x: l1.sx, y: l1.sy });
  tickFor(run, 2.9);
  assert.strictEqual(l1.state, 'sleep');
  tickFor(run, 0.2);
  assert.strictEqual(l1.state, 'awake');
  const e = run.enemies.find((x) => x.legend);
  assert.strictEqual(e.zone, l1.zone);
  assert.strictEqual(e.maxHp, Math.round(GD.hp * Rules.survivorWave(run.wave).hp));
  assert.ok(run.events.some((ev) => ev.k === 'legendWake'));
  assert.ok(run.frame().lb && run.frame().lg.length === run.lairs.length);
  // Un seul éveillé : le sceau d'un autre ne charge pas (sceau rapproché pour le test)
  const [sx, sy] = [l2.sx, l2.sy];
  Object.assign(l2, { sx: l1.x + 400, sy: l1.y });
  Object.assign(run.p, { x: l2.sx, y: l2.sy });
  tickFor(run, 4);
  assert.deepStrictEqual([l1.state, l2.state, l2.charge], ['awake', 'sleep', 0]);
  // Trop loin de son antre : il retourne dormir
  Object.assign(l2, { sx, sy });
  Object.assign(run.p, { x: l1.x + GD.leash + 50, y: l1.y });
  run.tick(0.05);
  assert.strictEqual(l1.state, 'sleep');
  assert.ok(e.dead && !run.enemies.includes(e));
  assert.ok(run.events.some((ev) => ev.k === 'legendSleep'));
  // Ses attaques
  Object.assign(run.p, { x: l1.sx, y: l1.sy });
  tickFor(run, 3.1);
  const g = run.enemies.find((x) => x.legend);
  run.events = [];
  g.special = 0;
  tickFor(run, 0.05);
  assert.ok(run.events.some((ev) => ev.k === 'legendAtk' && ev.zone === l1.zone));
  // Bombe et recul : sans effet
  const hp = g.hp;
  run.bomb();
  assert.strictEqual(g.hp, hp);
  run.damage(g, 1, null, 500);
  assert.strictEqual(g.kx, 0);
  // Vaincu : émeraudes, coffre de 3, lieu-dit compté
  run.kill(g);
  assert.strictEqual(l1.state, 'done');
  assert.deepStrictEqual([run.bonusEmeralds, run.found.legends], [GD.emeralds, [l1.zone]]);
  assert.ok(run.pickups.some((k) => k.type === 'chest' && k.count === GD.chest));
  assert.deepStrictEqual(run.finish().legends, [l1.zone]);
});

test('[SV-17] survivor : sanctuaires maudits cumulables, encerclement, chariot doré', () => {
  const CU = Rules.SURVIVOR_CURSE;
  const run = new sv.SurvivorRun({});
  assert.strictEqual(run.shrines.length, CU.count);
  for (const s of run.shrines) {
    assert.ok(!Rules.survivorWater(s.x, s.y) && !Rules.survivorRoad(s.x, s.y));
    assert.ok(Math.hypot(s.x - SV.map.w / 2, s.y - SV.map.h / 2) >= CU.minVillage);
  }
  Object.assign(run, { treasureT: 1e9, shardT: 1e9, eliteT: 1e9, cartT: 1e9 });
  run.spawnAcc = -1e9;
  run.lairs = [];
  for (const s of run.shrines.slice(0, 2)) { Object.assign(run.p, { x: s.x, y: s.y }); tickFor(run, 2.1); }
  assert.strictEqual(run.curses, 2);
  assert.ok(run.events.some((e) => e.k === 'curse'));
  tickFor(run, 3);
  assert.strictEqual(run.curses, 2, 'un sanctuaire ne compte qu\'une fois');
  // Monstres plus rapides et plus forts
  run.enemies = [];
  const rat = run.spawnEnemy('rat', { x: run.p.x + 400, y: run.p.y });
  const x0 = rat.x;
  run.buildGrid();
  run.updateEnemies(0.1);
  assert.ok(Math.abs((x0 - rat.x) - rat.speed * 1.2 * 0.1 * (Rules.survivorWater(rat.x, rat.y) ? SV.waterSlow : 1)) < 0.5);
  const hp = run.hp;
  run.hurt(10);
  assert.strictEqual(run.hp, hp - 12);
  // Émeraudes ×1,2 en fin de partie
  const u = player();
  const r2 = sv.start(u);
  Object.assign(r2, { wave: 10, curses: 2, bonusEmeralds: 5 });
  u.character.survivor.challenges = { day: Rules.parisDay(), done: Rules.survivorChallengesOf(Rules.parisDay()) };
  const res = sv.finish(u.id);
  assert.strictEqual(res.emeralds, Math.round((Rules.survivorEmeralds(res) + 5) * 1.2));
  assert.strictEqual(res.curseMult, 1.2);
  // Encerclement toutes les 4 vagues, jamais avec un boss
  const ring = fresh();
  ring.waveT = 3 * SV.waveSeconds - 0.01;
  ring.tick(0.05);
  assert.strictEqual(ring.wave, 4);
  const n = Math.min(90, 40 + 3 * 4);
  assert.strictEqual(ring.enemies.length, n);
  assert.ok(ring.enemies.every((e) => Math.abs(Math.hypot(e.x - ring.p.x, e.y - ring.p.y) - Rules.SURVIVOR_RING.radius) < 15));
  assert.ok(ring.events.some((e) => e.k === 'ring' && e.n === n));
  const r20 = fresh();
  r20.wave = 19;
  r20.waveT = 19 * SV.waveSeconds - 0.01;
  r20.tick(0.05);
  assert.ok(r20.boss && !r20.enemies.some((e) => !e.boss), 'vague de boss : pas d\'encerclement');
  // Chariot doré : fuit, s'enfuit, ou lâche gemmes et émeraudes
  const c = fresh();
  c.cartT = 0;
  c.tick(0.05);
  const cart = c.cart;
  assert.ok(cart && cart.cart && c.events.some((e) => e.k === 'cart'));
  assert.ok(Math.abs(Math.hypot(cart.x - c.p.x, cart.y - c.p.y) - Rules.SURVIVOR_CART.dist) < 10);
  const d0 = Math.hypot(cart.x - c.p.x, cart.y - c.p.y);
  const hpBefore = c.hp;
  tickFor(c, 1);
  assert.ok(Math.hypot(cart.x - c.p.x, cart.y - c.p.y) > d0, 'il fuit');
  assert.strictEqual(c.hp >= hpBefore, true);
  assert.ok(c.frame().ct);
  c.kill(cart);
  assert.deepStrictEqual([c.cart, c.found.carts, c.bonusEmeralds], [null, 1, Rules.SURVIVOR_CART.emeralds]);
  assert.strictEqual(c.gems.length, Rules.SURVIVOR_CART.gems);
  const c2 = fresh();
  c2.cartT = 0;
  c2.tick(0.05);
  c2.t = c2.cart.until;
  c2.tick(0.05);
  assert.ok(!c2.cart && c2.events.some((e) => e.k === 'cartGone'));
});

test('[SV-18] survivor : cycle de 5 min avec 1 min de nuit, soir doré, aube, nuits survécues', () => {
  const D = Rules.SURVIVOR_DAY;
  assert.strictEqual(D.cycle, 300);
  const phases = {};
  for (let t = 0; t < 300; t++) { const p = Rules.survivorDaylight(t).phase; phases[p] = (phases[p] || 0) + 1; }
  assert.deepStrictEqual(phases, { day: 170, evening: 50, night: 60, dawn: 20 });
  assert.strictEqual(Rules.survivorDaylight(0).phase, 'day', 'la partie commence de jour');
  assert.ok(Rules.survivorDaylight(250).dark > 0.6 && Rules.survivorDaylight(100).dark === 0);
  assert.ok(Rules.survivorDaylight(190).warm > 0.5, 'soir doré');
  assert.ok(Rules.survivorDaylight(290).pink > 0.5, 'aube rose');
  assert.deepStrictEqual(Rules.survivorDaylight(30), Rules.survivorDaylight(330), 'cycle');
  const run = fresh();
  run.hurt = () => false;
  const seen = [];
  for (let i = 0; i < 300 / 0.25; i++) { run.tick(0.25); for (const e of run.events) if (['dusk', 'night', 'dawn'].includes(e.k)) seen.push([e.k, Math.round(run.t)]); run.events = []; run.enemies = []; run.pending = null; run.queued = 0; }
  assert.deepStrictEqual(seen, [['dusk', 205], ['night', 220], ['dawn', 280]]);
  assert.strictEqual(run.found.nights, 1);
});

test('[SV-19] survivor : armes secrètes débloquées par des objectifs sur plusieurs parties', () => {
  const SE = Rules.SURVIVOR_SECRETS;
  assert.deepStrictEqual(Object.keys(SE), ['boomerang', 'faux', 'etoiles']);
  for (const id of Object.keys(SE)) {
    assert.ok(Rules.SURVIVOR_WEAPONS[id].secret);
    assert.strictEqual(Rules.SURVIVOR_UNLOCKS.weapons[id].price, null);
  }
  const u = player(50000);
  const c = u.character;
  c.emeralds = 1e6;
  assert.deepStrictEqual([SE.boomerang.goal, SE.faux.goal, SE.etoiles.goal], [15, 30, 50]);
  assert.throws(() => sv.buyUnlock(c, 'weapon', 'faux'), /Arme secrète : détruire 30 chariots dorés/);
  assert.ok(!sv.unlockedWeapons(c).includes('faux'));
  // Deux parties : 20 puis 10 chariots → la Faux est débloquée
  for (const carts of [20, 10]) {
    const run = sv.start(u);
    run.found.carts = carts;
    const res = sv.finish(u.id);
    assert.deepStrictEqual(res.secrets, carts === 10 ? ['faux'] : []);
  }
  assert.strictEqual(c.survivor.secrets.carts, 30);
  assert.ok(sv.unlockedWeapons(c).includes('faux'));
  assert.ok(sv.stateOf(u).secrets.faux.unlocked);
  // Gardiens : comptés au total (un même gardien compte à chaque victoire)
  for (const legends of [['foret', 'lac'], ['lac']]) {
    const run = sv.start(u);
    run.found.legends = legends;
    sv.finish(u.id);
  }
  assert.deepStrictEqual([c.survivor.secrets.legendKills, c.survivor.secrets.legends], [3, ['foret', 'lac']]);
  assert.strictEqual(sv.stateOf(u).secrets.boomerang.progress, 3);
  // Ancienne sauvegarde (gardiens différents seulement) : le compte repart de là
  delete c.survivor.secrets.legendKills;
  game.upgrade(c);
  assert.strictEqual(c.survivor.secrets.legendKills, 2);
  // Arme de départ ensuite (20 000 émeraudes)
  sv.buyUnlock(c, 'starter', 'faux');
  assert.ok(sv.starters(c).includes('faux'));
  // Leurs effets
  for (const id of Object.keys(SE)) {
    const r = fresh();
    r.weapons = [];
    r.addWeapon(id);
    for (let i = 0; i < 6; i++) r.spawnEnemy('slime', { x: r.p.x + 90 + i * 12, y: r.p.y + 20 });
    for (let i = 0; i < 60; i++) { r.buildGrid(); r.fireWeapons(0.05); r.updateShots(0.05); r.updateAreas(0.05); r.t += 0.05; }
    assert.ok(r.enemies.some((e) => e.hp < e.maxHp || e.dead), `${id} fait des dégâts`);
  }
});

test('[SV-20] survivor : 3 défis du jour, 10 émeraudes chacun, une fois par jour', () => {
  const day = '2026-11-20';
  const ids = Rules.survivorChallengesOf(day);
  assert.strictEqual(new Set(ids).size, 3);
  assert.ok(ids.every((id) => Rules.SURVIVOR_CHALLENGES[id]));
  assert.deepStrictEqual(Rules.survivorChallengesOf(day), ids, 'les mêmes pour tout le monde');
  assert.strictEqual(Rules.survivorMetric({ found: { carts: 2 } }, 'carts'), 2);
  assert.strictEqual(Rules.survivorMetric({ legends: ['lac'] }, 'legends'), 1);
  assert.strictEqual(Rules.survivorMetric({ wave: 12 }, 'wave'), 12);
  const now = Date.UTC(2026, 10, 20, 12);
  const u = player(50000);
  // Une partie qui réussit tout
  const fill = (run) => Object.assign(run, { wave: 16, kills: 600, bosses: 3, level: 25, curses: 2 }) && Object.assign(run.found, { treasures: 2, shards: 4, altars: 3, carts: 1, nights: 1, bombs: 1, evos: ['epee'], legends: ['lac'] });
  fill(sv.start(u));
  const res = sv.finish(u.id, now);
  assert.deepStrictEqual(res.challenges.slice().sort(), ids.slice().sort());
  const base = Math.round(Math.round(Rules.survivorEmeralds(res)) * 1.2);
  assert.strictEqual(res.emeralds, base + 30);
  assert.deepStrictEqual(sv.stateOf(u, now).challenges.map((c) => c.done), [true, true, true]);
  // Le même jour : plus rien
  fill(sv.start(u));
  assert.deepStrictEqual(sv.finish(u.id, now).challenges, []);
  // Le lendemain : nouveaux défis
  const next = now + 86400000;
  assert.deepStrictEqual(sv.stateOf(u, next).challenges.map((c) => c.done), [false, false, false]);
});
