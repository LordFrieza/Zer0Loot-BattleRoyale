/*
 * Stamina, arbre de compétences et ultimes.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, game, testBattle, base } = require('./helpers');

const player = (key, extra = {}) => ({ key, name: key, level: 1, look: {}, stats: base(), ...extra });
const ult = (id, enhanced = false) => ({ id, enhanced });

// ---------- Stamina ----------

test('[STAT-7] stamina : temps de remplissage selon la classe et les points', () => {
  const t = (cls, pts = 0) => Rules.derive({ stamina: pts }, {}, cls).staminaTime;
  assert.deepStrictEqual(Rules.CLASSES.map((c) => t(c)), [40, 38, 42, 36, 40]);
  assert.strictEqual(t(null), 40);
  assert.strictEqual(t('guerrier', 10), Math.round((40 / 1.5) * 10) / 10);
  assert.strictEqual(t('guerrier', 100), 16, 'plafond ×2,5');
});

test('[LOOT-8] stamina : jamais sur les objets', () => {
  for (const slot of Rules.SLOTS) {
    for (let i = 0; i < 40; i++) {
      const item = game.makeItem('legendaire', slot);
      assert.ok(item.lines.every((l) => l.stat !== 'stamina'));
    }
  }
  assert.strictEqual(Rules.itemWeights({ slot: 'casque' }).stamina, undefined);
});

// ---------- Arbre ----------

test('[TAL-1] arbre : un point tous les 3 niveaux, à partir du niveau 4', () => {
  assert.deepStrictEqual([1, 3, 4, 6, 7, 10, 22].map(Rules.talentPoints), [0, 0, 1, 1, 2, 3, 7]);
});

test('[TAL-2] arbre : deux branches et leurs spécialisations, paliers et choix', () => {
  const specs = Object.fromEntries(Rules.CLASSES.map((c) => [c, [Rules.TALENT_TREES[c].left.spec, Rules.TALENT_TREES[c].right.spec]]));
  assert.deepStrictEqual(specs, {
    guerrier: ['Paladin', 'Berserker'], archer: ['Tireur d\'élite', 'Spammeur'], mage: ['Pyromancien', 'Cryomancien'],
    assassin: ['Ombre', 'Venimeux'], pretre: ['Saint', 'Inquisiteur'],
  });
  for (const cls of Rules.CLASSES) {
    const nodes = Rules.talentNodes(cls);
    assert.strictEqual(nodes.length, 22);
    for (const branch of ['left', 'right']) {
      const types = Rules.TALENT_TIERS.map((_, tier) => nodes.filter((n) => n.branch === branch && n.tier === tier));
      assert.deepStrictEqual(types.map((x) => x.length), [1, 1, 3, 1, 3, 1, 1]);
      assert.strictEqual(types[0][0].type, 'ult');
      assert.strictEqual(types[6][0].type, 'spec');
      assert.strictEqual(types[3][0].points.stamina, 3, '+3 Stamina au milieu de la branche');
      assert.ok(Rules.ULTS[Rules.TALENT_TREES[cls][branch].ult]);
    }
  }
});

test('[TAL-3] arbre : prérequis, chemins bloqués et points disponibles', () => {
  const c = game.newCharacter();
  assert.throws(() => game.learnTalent(c, 'left.ult'), /classe/);
  game.chooseClass(c, 'archer');
  assert.throws(() => game.learnTalent(c, 'left.ult'), /Aucun point/);
  c.level = 22; // 7 points
  assert.throws(() => game.learnTalent(c, 'left.g1'), /précédente/);
  game.learnTalent(c, 'left.ult');
  assert.throws(() => game.learnTalent(c, 'right.ult'), /autre chemin/);
  game.learnTalent(c, 'left.g1');
  game.learnTalent(c, 'left.a2');
  assert.throws(() => game.learnTalent(c, 'left.a1'), /bloqué/);
  assert.throws(() => game.learnTalent(c, 'left.a2'), /Déjà/);
  assert.throws(() => game.learnTalent(c, 'nope'), /inconnue/);
  for (const id of ['left.g2', 'left.b3', 'left.g3']) game.learnTalent(c, id);
  assert.deepStrictEqual(game.learnTalent(c, 'left.spec'), { spec: 'Tireur d\'élite' });
  assert.deepStrictEqual(game.talentState(c), { total: 7, spent: 7, available: 0 });
});

test('[TAL-4] arbre : remise à zéro payante', () => {
  const c = game.newCharacter();
  game.chooseClass(c, 'mage');
  assert.throws(() => game.resetTalents(c), /vierge/);
  c.level = 10;
  game.learnTalent(c, 'right.ult');
  game.learnTalent(c, 'right.g1');
  assert.throws(() => game.resetTalents(c), /250 golds/);
  c.gold = 300;
  assert.deepStrictEqual(game.resetTalents(c), { price: 250, refunded: 2 });
  assert.strictEqual(c.gold, 50);
  assert.deepStrictEqual(c.talents, []);
  game.learnTalent(c, 'left.ult'); // l'autre chemin est de nouveau ouvert
});

test('[CLS-7] classes : changer de classe remet l\'arbre à zéro gratuitement', () => {
  const c = game.newCharacter();
  game.chooseClass(c, 'guerrier');
  c.level = 7;
  c.gold = 100;
  game.learnTalent(c, 'left.ult');
  game.learnTalent(c, 'left.g1');
  assert.deepStrictEqual(game.chooseClass(c, 'pretre'), { cost: 100, unequipped: 0, talentsReset: 2 });
  assert.deepStrictEqual(c.talents, []);
});

test('[TAL-5, STAT-8] arbre : ultime, spécialisation et points bonus dans les stats', () => {
  const c = game.newCharacter();
  game.chooseClass(c, 'guerrier');
  c.level = 22;
  const before = game.derived(c);
  for (const id of ['left.ult', 'left.g1', 'left.a1']) game.learnTalent(c, id);
  assert.deepStrictEqual(Rules.ultOf(c.cls, c.talents), { id: 'rempart', enhanced: false });
  assert.strictEqual(Rules.specOf(c.cls, c.talents), null);
  const after = game.derived(c);
  // g1 : +3 Vie +3 Défense ; a1 : +6 Vie → 9 points de Vie
  assert.strictEqual(game.publicCharacter({ character: c }).talentPoints.vie, 9);
  assert.ok(after.maxHp > before.maxHp && after.reduction > before.reduction);
  for (const id of ['left.g2', 'left.b1', 'left.g3', 'left.spec']) game.learnTalent(c, id);
  assert.deepStrictEqual(Rules.ultOf(c.cls, c.talents), { id: 'rempart', enhanced: true });
  assert.strictEqual(game.publicCharacter({ character: c }).spec.spec, 'Paladin');
  assert.ok(game.derived(c).staminaTime < 40, '+3 Stamina du milieu de branche');
});

// ---------- Ultimes en combat ----------

test('[ULT-1, ULT-2] stamina : la barre se remplit puis lance l\'ultime', () => {
  const b = testBattle([player('a', { ult: ult('rempart'), stats: base({ staminaTime: 2 }) }), player('b')]);
  const [a, foe] = b.fighters;
  Object.assign(a, { speed: 0, cd: 99 });
  Object.assign(foe, { speed: 0, cd: 99 });
  assert.strictEqual(foe.ult, null);
  const ults = [];
  b.on('frame', (f) => ults.push(...f.events.filter((e) => e.t === 'ult')));
  for (let i = 0; i < 20; i++) b.tick(0.05);
  assert.ok(a.stamina > 0.45 && a.stamina < 0.55);
  assert.strictEqual(ults.length, 0);
  for (let i = 0; i < 25; i++) b.tick(0.05);
  assert.strictEqual(ults.length, 1);
  assert.strictEqual(ults[0].id, 'rempart');
  assert.ok(a.stamina < 0.3, 'barre remise à zéro');
  assert.strictEqual(foe.stamina, 0, 'pas d\'ultime, pas de barre');
});

// Prépare un duel où `a` lance son ultime tout de suite.
function cast(id, enhanced, opts = {}) {
  const fighters = [player('a', { ult: ult(id, enhanced) })];
  for (let i = 0; i < (opts.foes || 1); i++) fighters.push(player('e' + i, { stats: base({ maxHp: 100000 }) }));
  const b = testBattle(fighters);
  for (const f of b.fighters) Object.assign(f, { speed: 0, cd: 99, dodge: 0 });
  return b;
}

test('[ULT-3] Rempart sacré : réduction des dégâts et soin', () => {
  const b = cast('rempart', false);
  const [a, foe] = b.fighters;
  a.hp = 100;
  b.castUlt(a, foe);
  assert.strictEqual(a.hp, 100 + a.maxHp * 0.25);
  assert.strictEqual(b.buffMult(a, 'taken'), 0.4);
  const p = Rules.ULTS.rempart.plus;
  assert.deepStrictEqual([p.duration, p.allyHeal, p.allyTaken, p.radius], [8, 0.2, 0.7, 220]);
});

test('[ULT-4] Tourbillon : frappe autour toutes les 0,5 s', () => {
  const b = cast('tourbillon', false, { foes: 2 });
  const [a, near, far] = b.fighters;
  Object.assign(a, { x: 500, y: 300, crit: 0 });
  Object.assign(near, { x: 560, y: 300 });
  Object.assign(far, { x: 900, y: 300 });
  b.castUlt(a, near);
  let hitsNear = 0;
  b.on('frame', (f) => { hitsNear += f.events.filter((e) => e.t === 'hit' && e.to === near.key && e.ult).length; });
  for (let i = 0; i < 70; i++) b.tick(0.05); // 3,5 s
  assert.strictEqual(hitsNear, 6, '3 s, une frappe toutes les 0,5 s');
  assert.strictEqual(far.hp, far.maxHp);
});

test('[ULT-5] Flèche perforante : tous les ennemis de la trajectoire, rebonds en version améliorée', () => {
  const b = cast('perforante', false, { foes: 3 });
  const [a, e1, e2, off] = b.fighters;
  Object.assign(a, { x: 100, y: 300 });
  Object.assign(e1, { x: 400, y: 305 });
  Object.assign(e2, { x: 1100, y: 290 });
  Object.assign(off, { x: 600, y: 600 });
  const events = [];
  b.castUlt(a, e1);
  for (const e of b.events) events.push(e);
  const hit = new Set(events.filter((e) => e.t === 'hit').map((e) => e.to));
  assert.ok(hit.has(e1.key) && hit.has(e2.key) && !hit.has(off.key));
  const dmg = events.find((e) => e.t === 'hit' && e.to === e1.key).dmg;
  assert.strictEqual(dmg, Math.round(a.damage * 3));
  const ev = events.find((e) => e.t === 'ult');
  assert.strictEqual(ev.path.length, 2);
  const plus = cast('perforante', true);
  plus.castUlt(plus.fighters[0], plus.fighters[1]);
  assert.strictEqual(plus.events.find((e) => e.t === 'ult').path.length, 4, '2 rebonds');
});

test('[ULT-6, ULT-7] Pluie de flèches et Météore : impacts différés', () => {
  const b = cast('pluie', false);
  const [a, foe] = b.fighters;
  b.castUlt(a, foe);
  assert.strictEqual(b.zones.filter((z) => z.kind === 'arrow').length, 14);
  assert.ok(b.zones.every((z) => Math.hypot(z.x - foe.x, z.y - foe.y) <= 150 + 1));
  const plus = cast('pluie', true);
  plus.castUlt(plus.fighters[0], plus.fighters[1]);
  assert.strictEqual(plus.zones.length, 28);

  const m = cast('meteore', true, { foes: 3 });
  const [mage, ...foes] = m.fighters;
  foes.forEach((f, i) => Object.assign(f, { x: 200 + i * 400, y: 300 }));
  m.castUlt(mage, foes[0]);
  assert.strictEqual(m.zones.length, 3, '3 météores sur 3 groupes');
  const hp = foes[1].hp;
  for (let i = 0; i < 25; i++) m.tick(0.05);
  assert.ok(foes[1].hp < hp, 'impact après 1 s');
});

test('[ULT-8] Blizzard : gel des ennemis, réduit de moitié sur le Troll', () => {
  const b = cast('blizzard', false, { foes: 2 });
  const [a, foe, far] = b.fighters;
  Object.assign(foe, { x: 300, y: 300 });
  Object.assign(far, { x: 1000, y: 300 });
  b.castUlt(a, foe);
  assert.ok(Math.abs(foe.stunUntil - (b.time + 2)) < 1e-9);
  assert.strictEqual(far.stunUntil, 0);
  // gelé : ne bouge pas, n'attaque pas
  Object.assign(foe, { speed: 100, cd: 0 });
  const x = foe.x;
  b.tick(0.05);
  assert.strictEqual(foe.x, x);
  assert.ok(foe.cd <= 0);
  foe.kind = 'troll';
  foe.stunUntil = 0;
  b.castUlt(a, foe);
  assert.ok(Math.abs(foe.stunUntil - (b.time + 1)) < 1e-9);
});

test('[ULT-9] Exécution : téléportation sur le plus affaibli, enchaînement en version améliorée', () => {
  const b = cast('execution', true, { foes: 4 });
  const [a, ...foes] = b.fighters;
  foes.forEach((f, i) => { Object.assign(f, { x: 200 + i * 250, y: 300 }); f.hp = f.maxHp * (0.2 + i * 0.2); });
  b.castUlt(a, foes[3]);
  const ev = b.events.find((e) => e.t === 'ult');
  assert.deepStrictEqual(ev.hops.map((h) => h.to), [foes[0].key, foes[1].key, foes[2].key]);
  assert.ok(Math.abs(a.x - foes[2].x) <= a.r + foes[2].r + 1);
});

test('[ULT-10] Nuage toxique : dégâts réguliers dans la zone, qui suit l\'assassin en version améliorée', () => {
  const b = cast('poison', true, { foes: 1 });
  const [a, foe] = b.fighters;
  Object.assign(a, { x: 300, y: 300 });
  Object.assign(foe, { x: 360, y: 300 });
  b.castUlt(a, foe);
  const hp = foe.hp;
  for (let i = 0; i < 21; i++) b.tick(0.05);
  assert.ok(foe.hp < hp);
  a.x = 800;
  b.tick(0.05);
  assert.strictEqual(b.zones[0].x, 800, 'le nuage suit l\'assassin');
  for (let i = 0; i < 200; i++) b.tick(0.05);
  assert.strictEqual(b.zones.length, 0, 'disparu après 8 s');
});

test('[ULT-11, ULT-12] Prière et Châtiment', () => {
  const b = cast('priere', false);
  const [a, foe] = b.fighters;
  a.hp = 100;
  b.castUlt(a, foe);
  assert.strictEqual(a.hp, 100 + a.maxHp * 0.4);
  assert.deepStrictEqual(Rules.ULTS.priere.plus, { self: 0.4, ally: 0.4, radius: 9999, taken: 0.7, duration: 4 });

  const c = cast('chatiment', true, { foes: 6 });
  const [p, ...foes] = c.fighters;
  Object.assign(p, { x: 0, y: 300 });
  foes.forEach((f, i) => Object.assign(f, { x: 100 + i * 100, y: 300 }));
  c.castUlt(p, foes[0]);
  const ev = c.events.find((e) => e.t === 'ult');
  assert.deepStrictEqual(ev.targets, foes.slice(0, 5).map((f) => f.key), '5 ennemis les plus proches');
  assert.ok(foes[0].stunUntil > c.time && foes[5].stunUntil === 0);
});
