/*
 * Mode Solo (V2) : énergie, Expédition (profondeurs, reliques, butin) et Défi des boss.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, game, Battle, base } = require('./helpers');

const H = 3600 * 1000;

function soloBattle(kind, extra = {}, opts = {}) {
  const b = new Battle({ solo: { kind, level: opts.level || 1, difficulty: opts.difficulty || null } });
  b.openQueue(60, kind === 'boss' ? 'boss' : 'dungeon', opts.boss || 'troll');
  clearTimeout(b.queueTimer);
  b.join(Object.assign({ key: 'u1', userId: 1, name: 'Solo', level: opts.level || 1, cls: 'mage', look: {}, stats: base({ maxHp: 1000, speed: 100 }) }, extra));
  b.start(null, null);
  b.stopLoop();
  return b;
}

// Avance jusqu'à l'étape voulue du donjon (en tuant les monstres pour aller vite).
function runUntil(b, pred, max = 20 * 120) {
  for (let i = 0; i < max && b.phase === 'battle' && !pred(b); i++) {
    if (b.dungeon && b.dungeon.stage === 'fight') for (const m of b.monsters) if (m.alive) b.kill(b.players[0], m);
    b.tick(0.05);
  }
}

test('[SOLO-1] énergie : 3 au maximum, +1 toutes les 10 h, une tentative coûte 1', () => {
  assert.deepStrictEqual(Rules.energyState({ value: 3, at: 0 }, 5 * H), { value: 3, at: 5 * H, nextAt: null });
  assert.deepStrictEqual(Rules.energyState({ value: 0, at: 0 }, 9 * H), { value: 0, at: 0, nextAt: 10 * H });
  assert.deepStrictEqual(Rules.energyState({ value: 0, at: 0 }, 25 * H), { value: 2, at: 20 * H, nextAt: 30 * H });
  assert.deepStrictEqual(Rules.energyState({ value: 1, at: 0 }, 99 * H), { value: 3, at: 99 * H, nextAt: null });
  const c = game.newCharacter();
  const t0 = Date.now();
  assert.strictEqual(game.energyOf(c, t0).value, 3);
  game.spendEnergy(c, t0);
  game.spendEnergy(c, t0 + H);
  assert.deepStrictEqual(c.energy, { value: 1, at: t0 }, 'la recharge démarre à la première dépense');
  game.spendEnergy(c, t0 + 2 * H);
  assert.throws(() => game.spendEnergy(c, t0 + 3 * H), /Plus d'énergie : la prochaine revient dans 7 h/);
  assert.strictEqual(game.energyOf(c, t0 + 10 * H).value, 1);
  game.addEnergy(c, 5, t0 + 10 * H);
  assert.strictEqual(c.energy.value, 3, 'jamais au-delà du maximum');
  assert.deepStrictEqual(game.adminGive(c, { energy: 2 }).energy, 2);
  // Ancienne sauvegarde : énergie pleine
  const old = game.newCharacter();
  delete old.energy; delete old.soloActive;
  game.upgrade(old);
  assert.strictEqual(old.energy.value, 3);
  assert.strictEqual(old.soloActive, null);
});

test('[SOLO-2] partie solo : un seul joueur, sans potion, vitesse ×1 / ×2, abandon', () => {
  const b = soloBattle('expedition', { consumable: 'vie' });
  assert.strictEqual(b.players.length, 1);
  assert.strictEqual(b.players[0].consumable, null, 'pas de potion en solo');
  assert.strictEqual(b.speed, 1);
  b.setSpeed(2);
  assert.strictEqual(b.speed, 2);
  b.setSpeed(5);
  assert.strictEqual(b.speed, 1, 'vitesse inconnue → ×1');
  assert.strictEqual(b.frame().solo.kind, 'expedition');
  assert.strictEqual(b.publicQueue().solo.kind, 'expedition');
  let res = null;
  b.on('coopEnd', (r) => { res = r; });
  assert.strictEqual(b.abandon(), true);
  assert.strictEqual(b.phase, 'ended');
  assert.deepStrictEqual([res.solo, res.abandoned, res.depth, res.reward], ['expedition', true, 0, null]);
  assert.strictEqual(b.abandon(), false);
  // ×2 : deux pas de simulation par intervalle
  const fast = soloBattle('expedition');
  fast.setSpeed(2);
  let frames = 0;
  fast.on('frame', () => { frames += 1; });
  const t0 = fast.time;
  fast.loopStep();
  assert.strictEqual(frames, 2);
  assert.ok(Math.abs(fast.time - t0 - 0.1) < 1e-9);
});

test('[SOLO-3] expédition : monstres de plus en plus nombreux et forts, ajustement par classe', () => {
  assert.strictEqual(Rules.expeditionRoom(1).length, 2);
  assert.strictEqual(Rules.expeditionRoom(30).length, 6);
  assert.strictEqual(Rules.expeditionRoom(200).length, 12);
  assert.ok(Rules.expeditionRoom(5).some((m) => m.elite), 'un chef toutes les 5 profondeurs');
  assert.ok(!Rules.expeditionRoom(4).some((m) => m.elite));
  const m1 = Rules.expeditionMultipliers(1, 1);
  assert.deepStrictEqual([m1.hp, m1.damage], [0.55, 0.5]);
  const m11 = Rules.expeditionMultipliers(11, 1);
  assert.ok(Math.abs(m11.hp - 0.55 * 1.1 ** 10) < 1e-9);
  assert.ok(Math.abs(m11.damage - 0.5 * 1.07 ** 10) < 1e-9);
  assert.ok(Math.abs(Rules.expeditionMultipliers(1, 11).hp - 0.55 * 1.06) < 1e-9, '+0,6 % par niveau');
  // Classe : un Guerrier a plus de vie et de dégâts pendant l'Expédition
  const g = soloBattle('expedition', { cls: 'guerrier' }).players[0];
  assert.deepStrictEqual([g.maxHp, g.hp, g.damage], [1250, 1250, 135]);
  assert.strictEqual(soloBattle('expedition', { cls: 'archer' }).players[0].maxHp, 1000);
  // Profondeur 1 : 2 monstres affaiblis ; soin de 35 % entre deux profondeurs
  const b = soloBattle('expedition');
  runUntil(b, (x) => x.dungeon.room === 1 && x.dungeon.stage === 'fight');
  assert.strictEqual(b.monsters.length, 2);
  for (const m of b.monsters) assert.strictEqual(m.maxHp, Math.round(Rules.MONSTERS[m.kind].hp * 0.55));
  runUntil(b, (x) => x.dungeon.stage === 'clear');
  assert.strictEqual(b.dungeon.cleared, 1);
  b.players[0].hp = 100;
  runUntil(b, (x) => x.dungeon.room === 2);
  assert.strictEqual(b.players[0].hp, 450);
});

test('[SOLO-4] reliques : 3 au choix toutes les 3 profondeurs, cumulables', () => {
  const b = soloBattle('expedition');
  runUntil(b, (x) => x.dungeon.stage === 'relic');
  assert.strictEqual(b.dungeon.room, 3);
  const opts = b.dungeon.relicChoice;
  assert.strictEqual(opts.length, 3);
  assert.strictEqual(new Set(opts).size, 3);
  assert.ok(!opts.includes('braise'), 'pas de Braise sans ultime');
  assert.strictEqual(b.frame().dungeon.relicChoice.options.length, 3);
  const other = Object.keys(Rules.RELICS).find((id) => !opts.includes(id));
  assert.strictEqual(b.chooseRelic(other), null, 'relique non proposée');
  // Effets appliqués à la main (cumul)
  const p = b.players[0];
  b.dungeon.relicChoice = ['lame_runique'];
  assert.strictEqual(b.chooseRelic('lame_runique'), 'lame_runique');
  assert.strictEqual(b.dungeon.stage, 'exit');
  b.applyRelic('lame_runique'); b.dungeon.relics.push('lame_runique');
  assert.ok(Math.abs(b.buffMult(p, 'damage') - 1.15 * 1.15) < 1e-9, 'cumulables');
  b.applyRelic('pacte');
  assert.ok(Math.abs(b.buffMult(p, 'taken') - 1.15) < 1e-9);
  const crit = p.crit;
  b.applyRelic('oeil_aigle');
  assert.ok(Math.abs(p.crit - crit - 0.08) < 1e-9);
  b.applyRelic('calice');
  assert.ok(Math.abs(b.buffSum(p, 'lifesteal') - 0.06) < 1e-9);
  p.hp = 100;
  b.applyRelic('fiole');
  assert.strictEqual(p.hp, 700);
  b.applyRelic('tresor');
  assert.strictEqual(b.dungeon.rewardMult, 1.25);
  // Plume de phénix : une vie en plus
  b.applyRelic('plume');
  b.kill(null, p);
  assert.deepStrictEqual([p.alive, p.hp, p.extraLives], [true, 500, 0]);
  // Délai écoulé : relique au hasard
  const c = soloBattle('expedition');
  runUntil(c, (x) => x.dungeon.stage === 'relic');
  const choice = c.dungeon.relicChoice;
  for (let i = 0; i < 20 * 31 && c.dungeon.stage === 'relic'; i++) c.tick(0.05);
  assert.strictEqual(c.dungeon.relics.length, 1);
  assert.ok(choice.includes(c.dungeon.relics[0]));
});

test('[SOLO-5] expédition : butin selon les profondeurs nettoyées', () => {
  assert.strictEqual(Rules.expeditionReward(0), null);
  assert.deepStrictEqual(Rules.expeditionReward(1), { floors: 1, xp: 27, gold: 22, chests: 0 });
  assert.deepStrictEqual(Rules.expeditionReward(10), { floors: 10, xp: 450, gold: 350, chests: 2 });
  assert.deepStrictEqual(Rules.expeditionReward(20, 1.25), { floors: 20, xp: 1625, gold: 1250, chests: 4 });
  const b = soloBattle('expedition');
  let res = null;
  b.on('coopEnd', (r) => { res = r; });
  runUntil(b, (x) => x.dungeon.room === 2 && x.dungeon.stage === 'fight');
  b.kill(b.monsters[0], b.players[0]);
  b.tick(0.05);
  assert.deepStrictEqual([res.solo, res.victory, res.room, res.depth], ['expedition', false, 2, 1]);
  assert.deepStrictEqual(res.reward, Rules.expeditionReward(1));
  // Record : la fusion d'un fantôme garde le maximum
  assert.ok(Rules.MAX_COUNTERS.includes('expeditionBest'));
});

test('[SOLO-6] défi des boss : boss à ta mesure, renforcé selon la difficulté, butin si victoire', () => {
  assert.deepStrictEqual(Object.keys(Rules.BOSS_CHALLENGE), ['normal', 'heroique', 'legendaire']);
  const st = Rules.bossStats(1, 'troll', 10);
  const normal = soloBattle('boss', { level: 10 }, { boss: 'troll', difficulty: 'normal', level: 10 });
  assert.strictEqual(normal.boss.maxHp, Math.round(st.maxHp * 0.5));
  assert.strictEqual(normal.boss.damage, Math.round(st.damage * 0.7 * 10) / 10);
  const leg = soloBattle('boss', { level: 10 }, { boss: 'troll', difficulty: 'legendaire', level: 10 });
  assert.strictEqual(leg.boss.maxHp, Math.round(st.maxHp * 0.5 * 4.2));
  const sorc = soloBattle('boss', {}, { boss: 'sorcier', difficulty: 'heroique' });
  assert.strictEqual(sorc.boss.maxHp, Math.round(Rules.bossStats(1, 'sorcier', 1).maxHp * 0.25 * 2.2));
  let res = null;
  leg.on('coopEnd', (r) => { res = r; });
  leg.kill(leg.players[0], leg.boss);
  leg.tick(0.05);
  assert.deepStrictEqual([res.solo, res.victory, res.difficulty, res.boss.id], ['boss', true, 'legendaire', 'troll']);
  assert.deepStrictEqual(res.reward, { xp: 1000, gold: 900, chests: 4 });
  normal.on('coopEnd', (r) => { res = r; });
  normal.kill(normal.boss, normal.players[0]);
  normal.tick(0.05);
  assert.deepStrictEqual([res.victory, res.reward], [false, null]);
});
