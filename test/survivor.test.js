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
  assert.strictEqual(Rules.survivorZone(2400, 2400), 'village');
  assert.strictEqual(Rules.survivorZone(300, 300), 'foret');
  assert.strictEqual(Rules.survivorZone(4500, 4500), 'volcan');
  const run = new sv.SurvivorRun({});
  run.setPos(2400 + 1000, 2400, 1, 0, 0.1); // téléportation : bornée
  assert.ok(Math.abs(run.p.x - (2400 + 150 * 0.1 * SV.moveSlack + 4)) < 1e-6);
  run.setPos(run.p.x + 10, run.p.y + 10, 0, 1, 0.1);
  assert.ok(run.p.y > 2400 && run.p.fy === 1);
  run.setPos(-500, -500, 0, 0, 10); // temps limité à 0,25 s et bords de la carte
  assert.ok(run.p.x >= 20 && run.p.y >= 20);
  const x = run.p.x;
  run.pending = { id: 1, options: [] };
  run.setPos(x + 30, run.p.y, 1, 0, 0.2);
  assert.strictEqual(run.p.x, x, 'ignorée pendant un choix');
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
  for (let i = 0; i < 2000; i++) { const k = run.pickKind(1050, 3750); counts[k] = (counts[k] || 0) + 1; }
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
  const now = Date.UTC(2026, 10, 17, 12);
  const r = sv.finish(u.id, now);
  const expected = Math.round(Rules.survivorEmeralds(r) * 1.2) + 4;
  assert.strictEqual(r.emeralds, expected);
  assert.strictEqual(u.character.emeralds, expected);
  assert.deepStrictEqual(r.daily, { chests: 3, keys: 1 });
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
