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
  assert.deepStrictEqual([SV.map.w, SV.map.h], [7200, 7200]);
  assert.strictEqual(Rules.survivorZone(3600, 3600), 'village');
  assert.strictEqual(Rules.survivorZone(450, 450), 'foret');
  assert.strictEqual(Rules.survivorZone(6750, 6750), 'volcan');
  const run = new sv.SurvivorRun({});
  run.setPos(3600 + 1000, 3600, 1, 0, 0.1); // téléportation : bornée
  assert.ok(Math.abs(run.p.x - (3600 + 150 * 0.1 * SV.moveSlack + 4)) < 1e-6);
  run.setPos(run.p.x + 10, run.p.y + 10, 0, 1, 0.1);
  assert.ok(run.p.y > 3600 && run.p.fy === 1);
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
  for (let y = 0; y < 7200; y += 90) for (let x = 0; x < 7200; x += 90) { const k = Rules.survivorZone(x, y); counts[k] = (counts[k] || 0) + 1; }
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
  assert.ok(Math.abs(run.speedNow() - run.stats.speed * 1.15) < 1e-9);
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
  run.t = SV.waveSeconds * 4 - 0.01;
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
  assert.strictEqual(Rules.survivorWeaponStats('dagues', 8).amount, 5);
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
  const expected = Math.round(Rules.survivorEmeralds(r) * 1.26) + 4;
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
  // Éclats d'émeraude : loin du joueur, jamais au village, 3 au plus
  for (let i = 0; i < 5; i++) { run.shardT = 0; run.tick(0.05); }
  assert.strictEqual(run.shards.length, 3);
  for (const s of run.shards) {
    assert.notStrictEqual(Rules.survivorZone(s.x, s.y), 'village');
    const d = Math.hypot(s.x - run.p.x, s.y - run.p.y);
    assert.ok(d >= 1349 && d <= 2551, `distance ${d}`);
  }
  run.shardT = 1e9;
  Object.assign(run.p, { x: run.shards[0].x, y: run.shards[0].y });
  run.tick(0.05);
  assert.deepStrictEqual([run.shards.length, run.bonusEmeralds, run.found.shards], [2, 1, 1]);
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
  assert.deepStrictEqual(run.finish().found, { shards: 1, altars: 1, treasures: 1 });
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
});

test('[SV-11] survivor : carte agrandie, eau qui ralentit joueur et ennemis, ponts', () => {
  const M = Rules.survivorMap();
  assert.strictEqual(SV.mapScale, 1.5);
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
  const dry = run.speedNow();
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
