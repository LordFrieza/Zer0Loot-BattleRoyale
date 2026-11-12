/*
 * Style de combat (V2) : récupération après une attaque, recul qui évite les bords, tactique et techniques.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, game, testBattle, base } = require('./helpers');

const player = (key, extra = {}) => Object.assign({ key, name: key, level: 20, look: {}, stats: base({ speed: 100 }) }, extra);
const tickFor = (b, seconds) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) b.tick(0.05); };
const hold = (...fs) => { for (const f of fs) { f.speed = 0; f.cd = 99; } };

test('[AI-1] récupération : immobile juste après une attaque, moins longtemps avec la vitesse d\'attaque', () => {
  assert.deepStrictEqual(Rules.CLASSES.map((c) => Rules.CLASS_INFO[c].combat.recovery), [0.3, 0.6, 0.5, 0.05, 0.3]);
  const b = testBattle([player('a', { cls: 'guerrier', stats: base({ speed: 100, attackSpeed: 1.5 }) }), player('b')]);
  const [a, foe] = b.fighters;
  assert.ok(Math.abs(a.recovery - 0.3 / 1.5) < 1e-9, 'divisée par la vitesse d\'attaque');
  hold(foe);
  Object.assign(a, { x: 300, y: 300, cd: 0 });
  Object.assign(foe, { x: 340, y: 300 });
  b.tick(0.05); // attaque
  assert.ok(a.recoverUntil > b.time);
  // L'ennemi s'écarte : pendant la récupération, l'attaquant ne bouge pas
  foe.x = 600;
  const x0 = a.x;
  b.tick(0.05);
  assert.strictEqual(a.x, x0);
  tickFor(b, 0.3);
  assert.ok(a.x > x0, 'puis il repart');
});

test('[AI-2] recul : un Archer acculé dans un coin longe le mur au lieu de rester coincé', () => {
  const b = testBattle([player('archer', { cls: 'archer' }), player('melee')]);
  const [archer, melee] = b.fighters;
  archer.cd = 99;
  archer.recovery = 0;
  Object.assign(archer, { x: 30, y: 30 });
  Object.assign(melee, { x: 90, y: 90, speed: 0, cd: 99 });
  tickFor(b, 2);
  const moved = Math.hypot(archer.x - 30, archer.y - 30);
  assert.ok(moved > 40, `il s'est dégagé (${moved.toFixed(0)} px)`);
  assert.ok(Math.hypot(archer.x - melee.x, archer.y - melee.y) > Math.hypot(30 - 90, 30 - 90), 'et s\'est éloigné de l\'ennemi');
});

test('[TAC-1] tactique : posture, cible, distance de recul (classes à distance seulement)', () => {
  const c = game.newCharacter();
  game.chooseClass(c, 'guerrier');
  assert.deepStrictEqual(c.tactics, Rules.DEFAULT_TACTICS);
  game.setTactics(c, { stance: 'agressif', target: 'menace' });
  assert.deepStrictEqual(c.tactics, { stance: 'agressif', target: 'menace', kite: null });
  assert.throws(() => game.setTactics(c, { stance: 'fou' }), /Posture inconnue/);
  assert.throws(() => game.setTactics(c, { target: 'nul' }), /Cible inconnue/);
  assert.throws(() => game.setTactics(c, { kite: 50 }), /classes à distance/);
  c.gold = 1e6;
  game.chooseClass(c, 'archer');
  game.setTactics(c, { kite: 9999 });
  assert.strictEqual(c.tactics.kite, 200, 'portée 230 − 30');
  game.setTactics(c, { kite: -5 });
  assert.strictEqual(c.tactics.kite, 0);
  game.setTactics(c, { kite: null });
  assert.strictEqual(c.tactics.kite, null);
});

test('[TAC-2] tactique en combat : recul selon la posture, fuite prudente, cible préférée', () => {
  const kite = (cls, tactics) => testBattle([player('a', { cls, tactics }), player('b')]).fighters[0].kite;
  assert.strictEqual(kite('archer', null), 110);
  assert.strictEqual(kite('archer', { stance: 'agressif', kite: 150 }), 0);
  assert.strictEqual(kite('archer', { stance: 'prudent' }), 154);
  assert.strictEqual(kite('archer', { stance: 'equilibre', kite: 40 }), 40);
  assert.strictEqual(kite('mage', { stance: 'prudent' }), 84);
  assert.strictEqual(kite('guerrier', { stance: 'prudent', kite: 80 }), 0, 'pas de recul au corps à corps');

  // Fuite prudente sous 30 % de vie
  const b = testBattle([player('a', { cls: 'guerrier', tactics: { stance: 'prudent' } }), player('b')]);
  const [a, foe] = b.fighters;
  hold(foe);
  a.cd = 99;
  Object.assign(a, { x: 600, y: 360, hp: a.maxHp * 0.25 });
  Object.assign(foe, { x: 680, y: 360 });
  tickFor(b, 0.5);
  assert.ok(a.x < 600, 'il fuit');

  // Cible préférée
  const pick = (target) => {
    const t = testBattle([player('me', { tactics: { target } }), player('near'), player('weak'), player('strong', { stats: base({ damage: 400 }) })]);
    const [me, near, weak, strong] = t.fighters;
    hold(me, near, weak, strong);
    Object.assign(me, { x: 400, y: 360 });
    Object.assign(near, { x: 450, y: 360 });
    Object.assign(weak, { x: 650, y: 360, hp: 50 });
    Object.assign(strong, { x: 520, y: 360 });
    t.tick(0.05);
    return me.targetKey;
  };
  assert.strictEqual(pick('proche'), 'near');
  assert.strictEqual(pick('faible'), 'weak');
  assert.strictEqual(pick('menace'), 'strong');
  assert.strictEqual(pick('auto'), 'near');
});

test('[TECH-1] techniques : emplacements, niveaux, classes, corps à corps', () => {
  assert.strictEqual(Object.keys(Rules.TECHNIQUES).length, 14);
  assert.deepStrictEqual([1, 4, 5, 14, 15, 60].map(Rules.techSlots), [0, 0, 1, 1, 2, 2]);
  const c = game.newCharacter();
  game.chooseClass(c, 'mage');
  assert.throws(() => game.setTechniques(c, ['roulade']), /niveau 5/);
  c.level = 12;
  assert.throws(() => game.setTechniques(c, ['roulade', 'clignement']), /1 emplacement/);
  assert.throws(() => game.setTechniques(c, ['charge']), /corps à corps/);
  assert.throws(() => game.setTechniques(c, ['cri_guerre']), /Guerrier/);
  assert.throws(() => game.setTechniques(c, ['nova_givre']), /niveau 15/);
  game.setTechniques(c, ['clignement']);
  assert.deepStrictEqual(c.techs, ['clignement']);
  c.level = 15;
  game.setTechniques(c, ['clignement', 'nova_givre', 'clignement']);
  assert.deepStrictEqual(c.techs, ['clignement', 'nova_givre'], 'sans doublon');
  // Changement de classe : les techniques de mage partent
  c.gold = 1e6;
  game.setTechniques(c, ['roulade', 'nova_givre']);
  game.chooseClass(c, 'guerrier');
  assert.deepStrictEqual(c.techs, ['roulade']);
});

test('[TECH-2] techniques communes : Roulade, Charge, Second souffle, Frénésie', () => {
  // Roulade
  let b = testBattle([player('a', { techs: ['roulade'] }), player('b')]);
  let [a, foe] = b.fighters;
  hold(a, foe);
  Object.assign(a, { x: 600, y: 360, hp: a.maxHp * 0.6 });
  Object.assign(foe, { x: 630, y: 360 });
  b.tick(0.05);
  assert.ok(Math.hypot(a.x - foe.x, a.y - foe.y) > 100, 'hors de portée');
  assert.ok(a.protectUntil > b.time, 'intouchable un instant');
  assert.ok(a.techCd.roulade > b.time + 8);

  // Charge (corps à corps)
  b = testBattle([player('a', { cls: 'guerrier', techs: ['charge'] }), player('b')]);
  [a, foe] = b.fighters;
  hold(a, foe);
  Object.assign(a, { x: 300, y: 360 });
  Object.assign(foe, { x: 550, y: 360 });
  const hp = foe.hp;
  b.tick(0.05);
  assert.ok(Math.hypot(a.x - foe.x, a.y - foe.y) < 40, 'au contact');
  assert.ok(foe.hp < hp && foe.stunUntil > b.time);
  assert.ok(testBattle([player('m', { cls: 'mage', techs: ['charge'] }), player('x')]).fighters[0].techs.length === 0, 'pas pour les classes à distance');

  // Second souffle : une seule fois
  b = testBattle([player('a', { techs: ['second_souffle'] }), player('b')]);
  [a, foe] = b.fighters;
  hold(a, foe);
  Object.assign(foe, { x: 1000 });
  a.hp = a.maxHp * 0.2;
  b.tick(0.05);
  assert.ok(Math.abs(a.hp - a.maxHp * 0.45) < 1);
  a.hp = a.maxHp * 0.2;
  b.tick(0.05);
  assert.ok(a.hp < a.maxHp * 0.25);

  // Frénésie
  b = testBattle([player('a', { techs: ['frenesie'] }), player('b'), player('c')]);
  [a, foe] = b.fighters;
  b.kill(a, foe);
  assert.strictEqual(b.buffMult(a, 'attackSpeed'), 1.4);
});

test('[TECH-3] techniques de classe', () => {
  const duel = (cls, tech, setup) => {
    const b = testBattle([player('a', { cls, techs: [tech] }), player('b')]);
    const [a, foe] = b.fighters;
    hold(a, foe);
    setup(a, foe, b);
    return { b, a, foe };
  };
  // Cri de guerre
  let { b, a } = (() => {
    const t = testBattle([player('a', { cls: 'guerrier', techs: ['cri_guerre'] }), player('b'), player('c')]);
    const [x, y, z] = t.fighters;
    hold(x, y, z);
    Object.assign(x, { x: 500, y: 360 });
    Object.assign(y, { x: 560, y: 360 });
    Object.assign(z, { x: 440, y: 360 });
    t.tick(0.05);
    return { b: t, a: x };
  })();
  assert.strictEqual(b.buffMult(a, 'taken'), 0.75);

  // Coup de bouclier : l'attaque étourdit 1 s
  let r = duel('guerrier', 'coup_bouclier', (x, y) => { Object.assign(x, { x: 500, y: 360 }); Object.assign(y, { x: 530, y: 360, dodge: 0 }); });
  r.a.precision = 1;
  r.b.attack(r.a, r.foe);
  assert.ok(r.foe.stunUntil >= r.b.time + 0.99);

  // Flèche repoussante
  r = duel('archer', 'fleche_recul', (x, y) => { Object.assign(x, { x: 500, y: 360 }); Object.assign(y, { x: 560, y: 360, dodge: 0 }); });
  r.a.precision = 1;
  r.b.attack(r.a, r.foe);
  assert.ok(Math.abs(r.foe.x - 650) < 1, 'repoussée de 90 px');

  // Tir rapide
  r = duel('archer', 'tir_rapide', (x, y) => { Object.assign(x, { x: 500, y: 360 }); Object.assign(y, { x: 650, y: 360 }); });
  r.b.tick(0.05);
  assert.strictEqual(r.b.buffMult(r.a, 'attackSpeed'), 2.5);
  assert.ok(r.a.buffs.some((x) => x.noRecovery));

  // Clignement
  r = duel('mage', 'clignement', (x, y) => { Object.assign(x, { x: 600, y: 360 }); Object.assign(y, { x: 640, y: 360 }); });
  r.b.tick(0.05);
  assert.ok(Math.hypot(r.a.x - 600, r.a.y - 360) > 150);

  // Nova de givre
  r = duel('mage', 'nova_givre', (x, y) => { Object.assign(x, { x: 600, y: 360 }); Object.assign(y, { x: 660, y: 360 }); });
  r.b.tick(0.05);
  assert.strictEqual(r.b.buffMult(r.foe, 'speed'), 0.5);

  // Pas de l'ombre : dans le dos de la cible, attaque suivante critique
  r = duel('assassin', 'pas_ombre', (x, y) => { Object.assign(x, { x: 300, y: 360 }); Object.assign(y, { x: 550, y: 360 }); });
  r.b.tick(0.05);
  assert.ok(r.a.x > r.foe.x, 'de l\'autre côté');
  assert.strictEqual(r.a.nextCrit, true);
  const events = [];
  r.b.on('frame', (f) => events.push(...f.events));
  r.foe.dodge = 0;
  r.a.precision = 1;
  r.b.attack(r.a, r.foe);
  r.b.tick(0.05);
  assert.ok(events.some((e) => e.t === 'hit' && e.from === 'a' && e.crit));

  // Lame empoisonnée : poison crédité à l'Assassin
  r = duel('assassin', 'lame_poison', (x, y) => { Object.assign(x, { x: 500, y: 360 }); Object.assign(y, { x: 530, y: 360, dodge: 0 }); });
  r.a.precision = 1;
  r.b.attack(r.a, r.foe);
  const hp = r.foe.hp;
  const dealt = r.a.dealt;
  tickFor(r.b, 2);
  assert.ok(Math.abs(hp - r.foe.hp - r.foe.maxHp * 0.015 * 2) <= 4, '1,5 % par seconde');
  assert.ok(r.a.dealt > dealt);

  // Prière de soin
  r = duel('pretre', 'priere_soin', (x, y) => { x.hp = x.maxHp * 0.4; Object.assign(y, { x: 1100 }); });
  r.b.tick(0.05);
  assert.ok(r.a.hp >= r.a.maxHp * 0.6 - 1);

  // Lumière aveuglante, moitié moins longue sur un boss
  r = duel('pretre', 'lumiere', (x, y) => { Object.assign(x, { x: 500, y: 360 }); Object.assign(y, { x: 560, y: 360 }); });
  r.b.tick(0.05);
  assert.ok(Math.abs(r.foe.stunUntil - r.b.time - 0.8) < 0.06);
  r.foe.stunUntil = 0;
  r.foe.isBoss = true;
  r.b.stun(r.foe, 0.8);
  assert.ok(Math.abs(r.foe.stunUntil - r.b.time - 0.4) < 1e-9);
});
