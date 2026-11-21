/*
 * Combat de Boss : choix du boss, Pyrax le Dragon et Malvorath le Magicien des ténèbres
 * (le Troll est couvert par modes.test.js).
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, Battle } = require('./helpers');

// Combat prêt à être piloté à la main ; classes réparties pour avoir du corps à corps et de la distance.
function fight(bossId, players = 4, classes = ['guerrier', 'archer', 'mage', 'pretre', 'assassin']) {
  const b = new Battle();
  b.openQueue(60, 'boss', bossId);
  clearTimeout(b.queueTimer);
  for (let i = 0; i < players; i++) {
    const cls = classes[i % classes.length];
    b.join({ key: 'p' + i, name: 'P' + i, level: 1, cls, stats: Rules.derive({}, {}, cls), look: {} });
  }
  b.start(null, null);
  b.stopLoop();
  return b;
}

// Tout le monde reste sur place et n'attaque pas (le boss non plus), sauf avis contraire.
function freeze(b) {
  for (const f of b.fighters) { f.speed = 0; f.cd = 99; f.dodge = 0; }
}

const tickFor = (b, seconds) => { for (let i = 0; i < Math.round(seconds / 0.05); i++) b.tick(0.05); };
const byCls = (b, cls) => b.players.find((p) => p.cls === cls);

test('[BOSS-8] boss : choix du boss à l\'ouverture de la file, Troll par défaut', () => {
  assert.deepStrictEqual(Object.keys(Rules.BOSSES), ['troll', 'dragon', 'sorcier', 'mimic', 'liche', 'maexxna', 'ether', 'lilith', 'daedra']);
  const b = new Battle();
  b.openQueue(60, 'boss');
  clearTimeout(b.queueTimer);
  assert.strictEqual(b.publicQueue().boss, 'troll');
  b.openQueue(60, 'boss', 'dragon');
  clearTimeout(b.queueTimer);
  assert.strictEqual(b.publicQueue().boss, 'dragon');
  assert.throws(() => b.openQueue(60, 'boss', 'licorne'), /Boss inconnu/);
  b.openQueue(60, 'br', 'dragon');
  clearTimeout(b.queueTimer);
  assert.strictEqual(b.publicQueue().boss, null, 'pas de boss hors Combat de Boss');
  for (const id of ['dragon', 'sorcier']) {
    const f = fight(id, 2);
    assert.strictEqual(f.boss.kind, Rules.BOSSES[id].kind);
    assert.strictEqual(f.boss.name, Rules.BOSSES[id].name);
    assert.strictEqual(f.frame().boss.id, id);
  }
});

test('[DRG-1] dragon : statistiques et coups de griffes', () => {
  const b = fight('dragon', 10);
  assert.strictEqual(b.boss.maxHp, 200 + 400 * 10); // combattants de niveau 1 : pas de bonus de niveau (BOSS-10)
  assert.strictEqual(b.boss.damage, 6 + 0.2 * 10);
  assert.strictEqual(b.boss.r, 60);
  assert.strictEqual(b.boss.cooldown, 1.6);
  freeze(b);
  const [target, near] = b.players;
  Object.assign(b.boss, { crit: 0 });
  Object.assign(target, { x: 650, y: 360, reduction: 0 });
  Object.assign(near, { x: 700, y: 360, reduction: 0 });
  b.events = [];
  b.attack(b.boss, target);
  const hits = b.events.filter((e) => e.t === 'hit');
  const main = hits.find((e) => e.to === target.key);
  const splash = hits.find((e) => e.to === near.key);
  assert.ok(Math.abs(splash.dmg - main.dmg * 0.4) <= 1);
});

test('[DRG-2] dragon : souffle de feu en cône vers le groupe, puis coup de queue', () => {
  const b = fight('dragon', 4);
  freeze(b);
  const [front1, front2, behind, side] = b.players;
  Object.assign(b.boss, { x: 640, y: 360 });
  Object.assign(front1, { x: 400, y: 360 });
  Object.assign(front2, { x: 420, y: 370 }); // le groupe, à gauche du dragon
  Object.assign(behind, { x: 900, y: 360 });
  Object.assign(side, { x: 640, y: 120 }); // hors du cône
  b.boss.slamIn = 0;
  b.tick(0.05);
  const cone = b.slams[0];
  assert.strictEqual(cone.kind, 'cone');
  assert.strictEqual(cone.r, 340);
  assert.ok(Math.abs(Math.cos(cone.angle) + 1) < 0.05, 'tourné vers le groupe');
  const hp = b.players.map((p) => p.hp);
  tickFor(b, 1.3);
  assert.deepStrictEqual(b.players.map((p) => p.hp), hp, 'rien avant l\'impact (1,4 s)');
  tickFor(b, 0.15);
  assert.ok(front1.hp < hp[0] && front2.hp < hp[1]);
  assert.strictEqual(behind.hp, hp[2]);
  assert.strictEqual(side.hp, hp[3]);
  // Coup de queue : tout autour de lui
  Object.assign(behind, { x: 740, y: 360 });
  b.boss.slamIn = 0;
  b.tick(0.05);
  const tail = b.slams.find((s) => s.kind === 'tail');
  assert.ok(tail && tail.r === 140);
  tickFor(b, 1.1);
  assert.ok(behind.hp < hp[2]);
});

test('[DRG-3, BOSS-9] dragon : envol à 75 %, intouchable au corps à corps, boules de feu, atterrissage', () => {
  const b = fight('dragon', 5);
  const warrior = byCls(b, 'guerrier');
  const archer = byCls(b, 'archer');
  freeze(b);
  b.boss.hp = b.boss.maxHp * 0.74;
  b.tick(0.05);
  assert.strictEqual(b.boss.flying, true);
  assert.ok(b.frame().boss.flying);
  // Ciblage : le Guerrier ne peut plus le viser (il s'occupe des flammèches, DRG-5), l'Archer si
  b.tick(0.05);
  assert.strictEqual(b.immune(b.boss, warrior), true);
  assert.strictEqual(b.immune(b.boss, archer), false);
  assert.notStrictEqual(warrior.targetKey, 'boss');
  assert.strictEqual(b.fighters.find((f) => f.key === warrior.targetKey).kind, 'flammeche');
  const hp = b.boss.hp;
  b.hit(warrior, b.boss, 100);
  assert.strictEqual(b.boss.hp, hp, 'les coups au corps à corps ne le touchent pas');
  b.hit(archer, b.boss, 100);
  assert.ok(b.boss.hp < hp);
  // Épines d'un combattant au corps à corps : pas de renvoi sur le dragon en vol
  warrior.thorns = 0.5;
  const before = b.boss.hp;
  b.hit(b.boss, warrior, 50);
  assert.strictEqual(b.boss.hp, before);
  // Boules de feu sur des combattants au hasard
  tickFor(b, 3);
  const fireballs = [];
  b.on('frame', (f) => fireballs.push(...f.events.filter((e) => e.t === 'slam' && e.kind === 'fireball')));
  tickFor(b, 9);
  assert.ok(fireballs.length >= 6, 'environ une toutes les 1,2 s');
  // Atterrissage annoncé, puis il redevient vulnérable
  const land = b.slams.find((s) => s.kind === 'land');
  assert.ok(land && land.r === 160);
  tickFor(b, 1.5);
  assert.strictEqual(b.boss.flying, false);
  assert.ok(Math.hypot(b.boss.x - land.x, b.boss.y - land.y) < land.r, 'posé dans la zone annoncée (les combattants le poussent un peu)');
  b.tick(0.05);
  // De nouveau touchable au corps à corps (le ciblage exact dépend des flammèches encore en vie et des recharges)
  assert.strictEqual(b.immune(b.boss, warrior), false);
  const hp2 = b.boss.hp;
  b.hit(warrior, b.boss, 100);
  assert.ok(b.boss.hp < hp2, 'les coups au corps à corps le touchent de nouveau');
});

test('[DRG-5] dragon : les flammèches de l\'envol, à abattre pour le faire tomber plus tôt', () => {
  const b = fight('dragon', 10);
  freeze(b);
  b.boss.script = b.boss.script.filter((s) => s.kind === 'flight');
  b.boss.hp = b.boss.maxHp * 0.74;
  b.tick(0.05);
  const sprites = () => b.adds.filter((a) => a.kind === 'flammeche' && a.alive);
  assert.strictEqual(sprites().length, 4, '⌈10 / 3⌉');
  const s0 = sprites()[0];
  assert.strictEqual(s0.maxHp, 40 + 5 * 10);
  assert.ok(Math.abs(s0.damage - b.boss.damage * 0.35) < 1e-9);
  assert.strictEqual(s0.range, 26);
  tickFor(b, 3);
  assert.strictEqual(sprites().length, 5, 'une de plus toutes les 3 s');
  // Une flammèche abattue : le dragon brûle et atterrira 1 s plus tôt
  const until = b.boss.stage.until;
  const hp = b.boss.hp;
  const warrior = byCls(b, 'guerrier');
  const events = [];
  b.on('frame', (f) => events.push(...f.events));
  b.kill(warrior, sprites()[0]);
  assert.ok(Math.abs(hp - b.boss.hp - b.boss.maxHp * 0.01) < 1e-6);
  assert.strictEqual(b.boss.stage.until, until - 1);
  b.tick(0.05);
  assert.ok(events.some((e) => e.t === 'spriteDown'));
  // À l'atterrissage, les flammèches restantes s'éteignent
  while (b.boss.flying) b.tick(0.05);
  assert.strictEqual(sprites().length, 0);
  // Jamais sous 1 PV
  b.boss.hp = 2;
  b.boss.flying = true;
  b.boss.stage = { kind: 'flight', until: b.time + 5, landing: false };
  const extra = b.addMonster({ kind: 'flammeche', name: 'Flammèche', x: 100, y: 100, r: 14, hp: 10 });
  b.kill(warrior, extra);
  assert.strictEqual(b.boss.hp, 1);
  assert.strictEqual(b.boss.alive, true);
});

test('[DRG-4, BOSS-9] dragon : le nid, les œufs, l\'éclosion et le retour furieux', () => {
  const b = fight('dragon', 10);
  freeze(b);
  b.boss.script = b.boss.script.filter((s) => s.kind === 'nest');
  b.boss.hp = b.boss.maxHp * 0.49;
  b.tick(0.05);
  assert.strictEqual(b.boss.away, true);
  const eggs = b.adds.filter((a) => a.kind === 'oeuf');
  assert.strictEqual(eggs.length, 3, '⌈10 / 4⌉ = 3');
  assert.ok(eggs.every((e) => e.maxHp === 60 + 8 * 10));
  const archer = byCls(b, 'archer');
  const hp = b.boss.hp;
  b.hit(archer, b.boss, 100);
  assert.strictEqual(b.boss.hp, hp, 'intouchable au nid');
  b.tick(0.05);
  assert.ok(b.players.every((p) => p.targetKey !== 'boss'));
  // Un œuf détruit, les autres éclosent au bout de 16 s
  b.kill(archer, eggs[0]);
  const hatched = [];
  b.on('frame', (f) => hatched.push(...f.events.filter((e) => e.t === 'hatch')));
  tickFor(b, 16);
  assert.strictEqual(hatched.length, 2);
  const whelps = b.adds.filter((a) => a.kind === 'dragonnet');
  assert.strictEqual(whelps.length, 2);
  assert.strictEqual(whelps[0].maxHp, 80 + 6 * 10);
  assert.ok(Math.abs(whelps[0].damage - b.boss.damage * 0.6) < 1e-9);
  assert.strictEqual(b.boss.away, false);
  assert.strictEqual(b.boss.flying, true, 'il revient en volant');
  assert.ok(Math.abs(b.boss.dmgMult - 1.25) < 1e-9);
  assert.ok(b.slams.some((s) => s.kind === 'land'));

  // Tous les œufs détruits : retour anticipé, sans dragonnet
  const c = fight('dragon', 4);
  freeze(c);
  c.boss.script = c.boss.script.filter((s) => s.kind === 'nest');
  c.boss.hp = c.boss.maxHp * 0.49;
  c.tick(0.05);
  for (const egg of c.adds) c.kill(c.players[0], egg);
  c.tick(0.05);
  assert.strictEqual(c.boss.away, false);
  assert.ok(!c.adds.some((a) => a.kind === 'dragonnet'));
});

test('[SRC-1] magicien : statistiques, attaque à distance et téléportation', () => {
  const b = fight('sorcier', 10);
  assert.strictEqual(b.boss.maxHp, 180 + 200 * 10);
  assert.strictEqual(b.boss.damage, 7 + 0.2 * 10);
  assert.strictEqual(b.boss.range, 260);
  assert.strictEqual(b.boss.projectile, 'shadow');
  freeze(b);
  b.boss.slamIn = 999;
  const blinks = [];
  b.on('frame', (f) => blinks.push(...f.events.filter((e) => e.t === 'blink')));
  tickFor(b, 14.9);
  assert.strictEqual(blinks.length, 0);
  tickFor(b, 0.2);
  assert.strictEqual(blinks.length, 1);
  assert.strictEqual(blinks[0].to, 'boss');
  assert.ok(b.boss.x >= 220 && b.boss.x <= 1280 - 220 && b.boss.y >= 230, 'loin des bords et sous la barre de vie');
});

test('[SRC-2, SRC-3] magicien : malédictions (purifiées près d\'un Prêtre) et zones d\'ombre', () => {
  const b = fight('sorcier', 10, ['guerrier', 'archer', 'mage', 'assassin', 'guerrier', 'archer', 'mage', 'assassin', 'guerrier', 'pretre']);
  freeze(b);
  b.boss.blinkIn = 999;
  const priest = byCls(b, 'pretre');
  b.players.forEach((p, i) => Object.assign(p, { x: 100 + i * 100, y: 600 }));
  Object.assign(priest, { x: 100, y: 120 }); // loin de tout le monde
  // Le Prêtre n'est jamais maudit longtemps : il se purifie lui-même.
  priest.alive = false;
  b.boss.slamIn = 0;
  b.tick(0.05);
  const cursed = b.players.filter((p) => p.buffs.some((x) => x.curse));
  assert.strictEqual(cursed.length, 2, '⌈9 vivants / 5⌉');
  priest.alive = true;
  const victim = cursed[0];
  const hp = victim.hp;
  tickFor(b, 2);
  const lost = hp - victim.hp;
  assert.ok(Math.abs(lost - victim.maxHp * 0.025 * 2) <= 4, '2,5 % de la vie max par seconde');
  // Un Prêtre s'approche : purification
  const events = [];
  b.on('frame', (f) => events.push(...f.events));
  Object.assign(priest, { x: victim.x + 100, y: victim.y });
  b.tick(0.05);
  assert.ok(!victim.buffs.some((x) => x.curse));
  assert.ok(events.some((e) => e.t === 'purify' && e.to === victim.key && e.from === priest.key));
  // Zones d'ombre : min(4, 2 + ⌊10 vivants / 10⌋) = 3
  b.boss.slamIn = 0;
  b.tick(0.05);
  const voids = b.slams.filter((s) => s.kind === 'void');
  assert.strictEqual(voids.length, 3);
  assert.ok(voids.every((s) => s.r === 75));
});

test('[SRC-4, BOSS-9] magicien : bouclier tant que les cristaux tiennent', () => {
  const b = fight('sorcier', 4);
  freeze(b);
  b.boss.blinkIn = 999;
  b.boss.slamIn = 999;
  b.boss.hp = b.boss.maxHp * 0.69;
  b.tick(0.05);
  assert.strictEqual(b.boss.shielded, true);
  assert.deepStrictEqual([b.boss.x, b.boss.y], [640, 360], 'au centre');
  const crystals = b.adds.filter((a) => a.kind === 'cristal');
  assert.strictEqual(crystals.length, 4);
  assert.ok(crystals.every((c) => c.maxHp === 60 + 10 * 4));
  const archer = byCls(b, 'archer');
  const hp = b.boss.hp;
  b.hit(archer, b.boss, 100);
  assert.strictEqual(b.boss.hp, hp, 'intouchable');
  tickFor(b, 1);
  assert.ok(Math.abs(b.boss.hp - (hp + b.boss.maxHp * 0.0015 * 4 * 1)) < b.boss.maxHp * 0.0003, '0,15 % par cristal et par seconde');
  // Les combattants se tournent vers les cristaux
  assert.ok(b.players.every((p) => p.targetKey !== 'boss'));
  for (const c of crystals) b.kill(archer, c);
  b.tick(0.05);
  assert.strictEqual(b.boss.shielded, false);
  b.hit(archer, b.boss, 100);
  assert.ok(b.boss.hp < hp + b.boss.maxHp * 0.01);
});

test('[SRC-5, BOSS-9] magicien : illusions fragiles, qui disparaissent avec lui', () => {
  const b = fight('sorcier', 10);
  freeze(b);
  b.boss.script = b.boss.script.filter((s) => s.kind === 'clones');
  b.boss.hp = b.boss.maxHp * 0.44;
  b.tick(0.05);
  const clones = b.adds.filter((a) => a.clone);
  assert.strictEqual(clones.length, 3);
  for (const c of clones) {
    assert.strictEqual(c.kind, 'sorcier');
    assert.strictEqual(c.name, b.boss.name);
    assert.strictEqual(c.maxHp, Math.round(b.boss.maxHp * 0.05));
    assert.ok(Math.abs(c.damage - b.boss.damage * 0.5) < 1e-9);
    assert.strictEqual(c.projectile, 'shadow');
  }
  const spots = new Set([b.boss, ...clones].map((f) => `${Math.round(f.x)},${Math.round(f.y)}`));
  assert.strictEqual(spots.size, 4, 'chacun à un endroit différent');
  // Victoire : les illusions disparaissent
  let out = null;
  b.on('coopEnd', (r) => { out = r; });
  b.kill(b.players[0], b.boss);
  b.tick(0.05);
  assert.strictEqual(out.victory, true);
  assert.deepStrictEqual(out.reward, Rules.BOSSES.sorcier.reward);
  assert.strictEqual(out.boss.id, 'sorcier');
  assert.ok(b.adds.every((a) => !a.alive));
});

test('[BOSS-10] boss : plus de vie face à des combattants expérimentés', () => {
  assert.strictEqual(Rules.bossLevelScale(1), 1);
  assert.ok(Math.abs(Rules.bossLevelScale(11) - 1.6) < 1e-9);
  assert.strictEqual(Rules.bossLevelScale(60), 2.5, 'plafond');
  for (const [id, perPlayer] of [['troll', 300], ['dragon', 400], ['sorcier', 200]]) {
    const b = new Battle();
    b.openQueue(60, 'boss', id);
    clearTimeout(b.queueTimer);
    // 2 combattants de niveau 6 et 2 de niveau 16 : niveau moyen 11
    [6, 6, 16, 16].forEach((level, i) => b.join({ key: 'p' + i, name: 'P' + i, level, cls: 'guerrier', stats: Rules.derive({}, {}, 'guerrier'), look: {} }));
    b.start(null, null);
    b.stopLoop();
    const base = Rules.BOSSES[id].hpBase + perPlayer * 4;
    assert.strictEqual(b.boss.maxHp, Math.round(base * 1.6), id);
  }
});

// ---------- Grignotor le Mimic ----------

test('[MIM-1, MIM-2] Mimic : stats, vomi (contenu au hasard et effets) et bond', () => {
  const b = fight('mimic', 4);
  freeze(b);
  const M = Rules.BOSSES.mimic;
  const st = Rules.bossStats(4, 'mimic', 1);
  assert.strictEqual(st.maxHp, M.hpBase + M.hpPerPlayer * 4);
  assert.deepStrictEqual([b.boss.maxHp, b.boss.r, b.boss.reduction, b.boss.cleave.ratio], [st.maxHp, 50, 0.2, 0.5]);
  // Vomi de bile : poison + ralentissement sur les combattants du cône
  const h = b.players[0];
  h.x = b.boss.x - 100; h.y = b.boss.y;
  b.slams.push({ kind: 'vomit', cone: true, loot: 'bile', x: b.boss.x, y: b.boss.y, r: 330, angle: Math.PI, half: 0.45, t: 0.01, warn: 1, ratio: 0.35, poison: 0.025, duration: 5, slow: 0.5 });
  const hp = h.hp;
  b.resolveSlams(0.05);
  assert.ok(h.hp < hp, 'dégâts du vomi');
  assert.ok(h.buffs.some((x) => x.kind === 'venin' && x.poison === 0.025));
  assert.strictEqual(b.buffMult(h, 'speed'), 0.5);
  // Os : saignement ; pièces : assommé
  b.slams.push({ kind: 'vomit', cone: true, loot: 'os', x: b.boss.x, y: b.boss.y, r: 330, angle: Math.PI, half: 0.45, t: 0.01, warn: 1, ratio: 0, bleed: 0.03, duration: 5 });
  b.slams.push({ kind: 'vomit', cone: true, loot: 'pieces', x: b.boss.x, y: b.boss.y, r: 330, angle: Math.PI, half: 0.45, t: 0.01, warn: 1, ratio: 0, stun: 1.2 });
  b.resolveSlams(0.05);
  assert.ok(h.buffs.some((x) => x.kind === 'saignement'));
  assert.ok(h.stunUntil > b.time);
  // Attaques spéciales en alternance : vomi (contenu connu), puis bond
  b.boss.slamIn = 0;
  b.bossSpecials(0.05, M);
  const v = b.slams[b.slams.length - 1];
  assert.ok(v.kind === 'vomit' && Object.keys(M.vomit.loot).includes(v.loot));
  b.boss.slamIn = 0;
  b.bossSpecials(0.05, M);
  const leap = b.slams[b.slams.length - 1];
  assert.strictEqual(leap.kind, 'leap');
  assert.strictEqual(b.boss.leaping, true, 'ne frappe pas pendant le saut');
  b.slams = [leap];
  leap.t = 0.01;
  b.resolveSlams(0.05);
  assert.deepStrictEqual([b.boss.leaping, b.boss.x, b.boss.y], [false, leap.x, leap.y], 'il atterrit au point d\'impact');
});

test('[MIM-3, MIM-4] Mimic : copies de niveau 1 (2, 4 puis 6) qui le protègent', () => {
  const b = fight('mimic', 3, ['archer', 'mage', 'guerrier']);
  freeze(b);
  const counts = [];
  for (const ratio of [0.74, 0.49, 0.24]) {
    b.boss.hp = b.boss.maxHp * ratio;
    const before = b.adds.length;
    b.updateBoss(0.05);
    const wave = b.adds.slice(before);
    counts.push(wave.length);
    const of = b.players.find((p) => p.key === wave[0].copyOf);
    const lvl1 = Rules.derive(Rules.emptyStats(), {}, of.cls);
    assert.ok(wave.every((c) => c.kind === 'copie' && c.cls === of.cls && c.level === 1 && c.team === b.boss.team));
    assert.strictEqual(wave[0].maxHp, Math.round(lvl1.maxHp * Rules.MIMIC.copies.hpMult * b.boss.addScale.hp));
  }
  assert.deepStrictEqual(counts, [2, 4, 6]);
  assert.strictEqual(new Set(b.boss.copied).size, 3, 'trois héros différents copiés');
  // Protégé tant qu'une copie est debout
  assert.strictEqual(b.boss.guarded, true);
  const hp = b.boss.hp;
  b.hit(b.players[0], b.boss, 100);
  assert.strictEqual(hp - b.boss.hp, Math.round(100 * (1 - b.boss.reduction) * Rules.MIMIC.copies.guard));
  for (const c of b.adds) if (c.alive) b.kill(b.players[0], c);
  b.updateBoss(0.05);
  assert.strictEqual(b.boss.guarded, false);
  // Les copies disparaissent avec lui
  b.updateBoss(0.05);
  b.boss.hp = b.boss.maxHp * 0.1;
  b.kill(b.players[0], b.boss);
  b.checkBossEnd();
  assert.ok(b.adds.every((a) => !a.alive));
});

// ---------- Givrenoire la Liche de glace ----------

test('[LCH-1, LCH-2, LCH-3] Liche : gel de 1, puis 2 héros ; un héros gelé ne fait rien, ne peut pas être touché et perd une part de sa vie max', () => {
  const b = fight('liche', 4);
  freeze(b);
  const L = Rules.BOSSES.liche;
  assert.deepStrictEqual([b.boss.range, b.boss.projectile], [280, 'ice']);
  assert.strictEqual(b.boss.maxHp, L.hpBase + L.hpPerPlayer * 4);
  b.boss.slamIn = 999;
  b.boss.blinkIn = 999;
  tickFor(b, L.freeze.first + 0.1);
  const iced = () => b.players.filter((p) => p.iceUntil > b.time);
  assert.strictEqual(iced().length, 1, 'phase 1 : un héros gelé');
  const first = iced()[0];
  first.regen = 0; // (un Prêtre se régénère : on l'ignore ici)
  first.buffs = [];
  // Gelé : ni cible, ni dégâts ; 1 PV par seconde ; soignable ; pas de stamina
  assert.strictEqual(b.immune(first, b.boss), true);
  const hp = first.hp;
  b.hit(b.boss, first, 500);
  assert.strictEqual(first.hp, hp);
  first.ult = { id: 'test' };
  first.stamina = 0;
  first.staminaTime = 1;
  tickFor(b, 2);
  assert.strictEqual(first.stamina, 0, 'pas de stamina');
  first.ult = null;
  const perSec = Math.max(1, Math.round(first.maxHp * L.freeze.dps));
  assert.ok(first.hp <= hp - perSec && first.hp >= hp - 3 * perSec, `environ ${perSec} PV (1,5 % de la vie max) par seconde`);
  first.hp -= 10;
  b.heal(first, 5);
  assert.ok(first.hp > hp - 15, 'peut être soigné');
  // Fin du gel, puis 10 s d'attente avant le suivant (un autre héros)
  tickFor(b, L.freeze.duration - 2 + 0.1);
  assert.strictEqual(iced().length, 0);
  tickFor(b, L.freeze.gap);
  assert.strictEqual(iced().length, 1);
  assert.notStrictEqual(iced()[0], first, 'un autre héros');
  // Phase 2 (66 %) : 2 héros à la fois
  b.boss.hp = b.boss.maxHp * 0.6;
  b.updateBoss(0.05);
  for (const p of b.players) p.iceUntil = 0;
  b.boss.ice.next = b.time;
  b.updateBoss(0.05);
  assert.strictEqual(iced().length, 2);
});

test('[LCH-4, LCH-5] Liche : pics, lance et nova de givre ; à 33 %, les morts se relèvent (ou 3 héros gelés)', () => {
  const b = fight('liche', 5);
  freeze(b);
  const L = Rules.BOSSES.liche;
  b.boss.slamIn = 0;
  b.bossSpecials(0.05, L);
  const spikes = b.slams.filter((s) => s.kind === 'spike');
  assert.strictEqual(spikes.length, Math.min(L.spikes.max, L.spikes.base + Math.floor(5 / L.spikes.perPlayers)));
  b.boss.slamIn = 0;
  b.bossSpecials(0.05, L);
  assert.ok(b.slams.some((s) => s.kind === 'lance' && s.line && s.w === L.lance.width), 'puis la lance de givre');
  b.boss.slamIn = 0;
  b.bossSpecials(0.05, L);
  assert.ok(b.slams.some((s) => s.kind === 'nova' && s.r === L.nova.radius), 'puis la nova');
  // Deux héros tombés : relevés en serviteurs à 33 %
  const dead = b.players.slice(0, 2);
  for (const p of dead) b.kill(b.boss, p);
  b.slams = [];
  b.boss.hp = b.boss.maxHp * 0.6;
  b.updateBoss(0.05);
  b.boss.hp = b.boss.maxHp * 0.3;
  b.updateBoss(0.05);
  const minions = b.adds.filter((a) => a.kind === 'serviteur');
  assert.strictEqual(minions.length, 2);
  assert.deepStrictEqual(minions.map((m) => m.raisedFrom).sort(), dead.map((p) => p.key).sort());
  assert.strictEqual(minions[0].maxHp, Math.round(dead.find((p) => p.key === minions[0].raisedFrom).maxHp * L.raise.hpRatio));
  assert.strictEqual(b.boss.ice, null, 'elle cesse de geler');
  b.kill(b.players[3], b.boss);
  b.checkBossEnd();
  assert.ok(minions.every((m) => !m.alive), 'ils meurent avec elle');
  // Personne n'est tombé : 3 puis 2 héros gelés
  const c = fight('liche', 5);
  freeze(c);
  c.boss.slamIn = 999;
  c.boss.hp = c.boss.maxHp * 0.3;
  c.updateBoss(0.05);
  c.updateBoss(0.05);
  assert.strictEqual(c.boss.ice.level, 2);
  c.boss.ice.next = c.time;
  c.updateBoss(0.05);
  assert.strictEqual(c.players.filter((p) => p.iceUntil > c.time).length, 3);
});

// ---------- Maexxna la Veuve noire ----------

test('[MXN-1, MXN-2, MXN-3] Maexxna : morsures venimeuses, toiles qui ralentissent, nuées d\'araignées', () => {
  const b = fight('maexxna', 6);
  freeze(b);
  const X = Rules.BOSSES.maexxna;
  assert.strictEqual(b.boss.maxHp, X.hpBase + X.hpPerPlayer * 6);
  // Morsure : poison
  const h = b.players[0];
  b.boss.precision = 1;
  b.attack(b.boss, h);
  assert.ok(h.buffs.some((x) => x.kind === 'poison' && x.poison === X.poison.dot));
  // Toile sous un héros : très ralenti
  b.addWeb(h.x, h.y);
  b.updateWebs(0.05, X);
  assert.strictEqual(b.buffMult(h, 'speed'), X.webs.slow);
  for (let i = 0; i < 12; i++) b.addWeb(100 + i * 10, 300);
  assert.strictEqual(b.webs.length, X.webs.max);
  b.webs = [];
  // Jet de toile : une toile reste au sol ; crachat de venin en cône
  b.boss.slamIn = 0;
  b.bossSpecials(0.05, X);
  const shot = b.slams.find((s) => s.kind === 'webshot');
  shot.t = 0.01;
  b.resolveSlams(0.05);
  assert.strictEqual(b.webs.length, 1);
  b.boss.slamIn = 0;
  b.bossSpecials(0.05, X);
  assert.ok(b.slams.some((s) => s.kind === 'spray' && s.cone && s.poison === X.spray.poison));
  // Araignées : clamp(⌈6/3⌉, 2, 10) par nuée, jamais plus de 14 vivantes
  b.spawnSpiders(X, 1);
  const spiders = () => b.adds.filter((a) => a.kind === 'araignee' && a.alive);
  assert.strictEqual(spiders().length, 2);
  assert.ok(spiders()[0].poison && spiders()[0].poison.dot === X.spiders.poison.dot);
  for (let i = 0; i < 20; i++) b.spawnSpiders(X, 1);
  assert.strictEqual(spiders().length, X.spiders.alive);
});

test('[MXN-4, MXN-5] Maexxna : cocons à briser, plafond puis frénésie', () => {
  const b = fight('maexxna', 6);
  freeze(b);
  const X = Rules.BOSSES.maexxna;
  b.boss.slamIn = 999;
  b.boss.hp = b.boss.maxHp * 0.69;
  b.updateBoss(0.05);
  const cocoons = b.adds.filter((a) => a.kind === 'cocon');
  assert.strictEqual(cocoons.length, Math.min(X.cocoon.max, X.cocoon.base + Math.floor(6 / X.cocoon.perPlayers)));
  const held = b.players.find((p) => p.key === cocoons[0].holds);
  assert.strictEqual(held.cocooned, cocoons[0].key);
  assert.strictEqual(b.immune(held, b.boss), true, 'prisonnier : ni ciblé ni blessé');
  const hp = held.hp;
  tickFor(b, 1);
  assert.ok(held.hp < hp, 'il souffre dans le cocon');
  // Briser le cocon le libère
  b.kill(b.players.find((p) => !p.cocooned), cocoons[0]);
  assert.strictEqual(held.cocooned, null);
  // Le cocon cède seul au bout de 10 s
  const other = b.players.find((p) => p.cocooned);
  if (other) { tickFor(b, X.cocoon.hold + 0.2); assert.strictEqual(other.cocooned, null); }
  // Plafond à 45 % : intouchable, nuée, pluie de toiles ; retour plus rapide
  const cd = b.boss.cooldown;
  b.boss.hp = b.boss.maxHp * 0.44;
  b.updateBoss(0.05);
  assert.strictEqual(b.boss.away, true);
  assert.strictEqual(b.immune(b.boss, b.players[0]), true);
  tickFor(b, X.ceiling.duration + 0.2);
  assert.strictEqual(b.boss.away, false);
  assert.ok(Math.abs(b.boss.cooldown - cd / X.ceiling.returnAttackSpeedMult) < 1e-9);
  // Frénésie à 20 %
  const speed = b.boss.speed;
  b.boss.hp = b.boss.maxHp * 0.19;
  b.updateBoss(0.05);
  b.updateBoss(0.05);
  assert.ok(Math.abs(b.boss.speed - speed * X.frenzy.speedMult) < 1e-9);
});

test('[LCH-6] Liche : elle garde ses distances (saut et piège de givre) ; la lance touche toute la ligne', () => {
  const b = fight('liche', 3);
  freeze(b);
  const L = Rules.BOSSES.liche;
  b.boss.slamIn = 999;
  b.boss.blinkIn = 999;
  const h = b.players[0];
  h.x = b.boss.x - b.boss.r - h.r - 20; h.y = b.boss.y;
  const from = { x: b.boss.x, y: b.boss.y };
  b.updateBoss(0.05);
  const moved = Math.hypot(b.boss.x - from.x, b.boss.y - from.y);
  assert.ok(moved > L.escape.hop * 0.5 && moved <= L.escape.hop + 1, `saut court (${Math.round(moved)} px)`);
  const trap = b.slams.find((s) => s.kind === 'frosttrap');
  assert.ok(trap && trap.x === from.x && trap.r === L.escape.trapRadius, 'explosion de givre là où elle était');
  // Pas de nouveau saut avant la fin de la recharge
  h.x = b.boss.x - b.boss.r - h.r - 10; h.y = b.boss.y;
  const pos = { x: b.boss.x, y: b.boss.y };
  b.updateBoss(0.05);
  assert.deepStrictEqual({ x: b.boss.x, y: b.boss.y }, pos);
  // Lance : un héros sur la ligne est touché et ralenti, un héros à côté non
  b.slams = [];
  const [p1, p2] = [b.players[1], b.players[2]];
  p1.x = b.boss.x + 300; p1.y = b.boss.y;
  p2.x = b.boss.x + 300; p2.y = b.boss.y + 200;
  const hp1 = p1.hp;
  const hp2 = p2.hp;
  b.slams.push({ kind: 'lance', line: true, x: b.boss.x, y: b.boss.y, tx: b.boss.x + 620, ty: b.boss.y, w: 64, r: 620, t: 0.01, warn: 1, ratio: L.lance.ratio, slow: L.lance.slow, duration: 2 });
  b.resolveSlams(0.05);
  assert.ok(p1.hp < hp1 && b.buffMult(p1, 'speed') === L.lance.slow);
  assert.strictEqual(p2.hp, hp2);
});

test('[LCH-3] Liche : seul (Défi des boss), la glace ronge 5 % de la vie max par seconde', () => {
  const b = new Battle({ solo: { kind: 'boss', level: 1, difficulty: 'normal' } });
  b.openQueue(60, 'boss', 'liche');
  clearTimeout(b.queueTimer);
  b.join({ key: 'u1', userId: 1, name: 'S', level: 1, cls: 'guerrier', stats: Rules.derive({}, {}, 'guerrier'), look: {} });
  b.start(null, null);
  b.stopLoop();
  freeze(b);
  b.boss.slamIn = 999;
  b.boss.blinkIn = 999;
  b.boss.escapeIn = 999;
  const p = b.players[0];
  p.regen = 0;
  p.iceUntil = b.time + 5;
  const hp = p.hp;
  tickFor(b, 3.01);
  assert.strictEqual(hp - p.hp, 3 * Math.max(1, Math.round(p.maxHp * Rules.BOSSES.liche.freeze.soloDps)));
});

test('[ETH-1, ETH-2] Ether : esquive et riposte ; hurlement, chaînes spectrales, moisson d\'âmes qui le soigne', () => {
  const b = fight('ether', 6);
  const E = Rules.BOSSES.ether;
  assert.deepStrictEqual([b.boss.dodge, b.boss.counter], [E.dodge, E.counter]);
  freeze(b);
  assert.strictEqual(b.boss.maxHp, E.hpBase + E.hpPerPlayer * 6);
  // Esquive (précision nulle, esquive totale) puis riposte immédiate
  const h = b.players[0];
  h.precision = 0;
  b.boss.dodge = 1;
  b.boss.counter = 1;
  b.boss.cd = 5;
  b.events = [];
  b.attack(h, b.boss);
  assert.ok(b.events.some((e) => e.t === 'counter'));
  assert.ok(b.boss.cd <= 0.05, 'il riposte aussitôt');
  // Rotation des attaques spéciales
  b.boss.slamIn = 0; b.bossSpecials(0.05, E);
  assert.ok(b.slams.some((s) => s.kind === 'wail' && s.slow === E.wail.slow && s.follow));
  b.boss.slamIn = 0; b.bossSpecials(0.05, E);
  const chains = b.slams.filter((s) => s.kind === 'chain');
  assert.strictEqual(chains.length, Math.min(E.chains.max, E.chains.base + Math.floor(6 / E.chains.perPlayers)));
  assert.ok(chains.every((s) => s.line && s.stun === E.chains.stun));
  b.boss.slamIn = 0; b.bossSpecials(0.05, E);
  const souls = b.slams.filter((s) => s.kind === 'soul');
  assert.ok(souls.length >= E.souls.base && souls.every((s) => s.drain === E.souls.drain));
  // Moisson d'âmes : Ether se soigne d'une partie des dégâts
  b.slams = [souls[0]];
  const v = b.players.find((p) => Math.hypot(p.x - souls[0].x, p.y - souls[0].y) < 5);
  b.boss.hp = b.boss.maxHp * 0.8;
  const hp = b.boss.hp;
  souls[0].t = 0.01;
  b.resolveSlams(0.05);
  if (v) assert.ok(b.boss.hp > hp, 'il dévore les âmes');
});

test('[ETH-3, ETH-4] Ether : intangible avec mains spectrales (chaque main détruite l\'abrège), feux follets, furie', () => {
  const b = fight('ether', 6);
  freeze(b);
  const E = Rules.BOSSES.ether;
  b.boss.slamIn = 999;
  b.boss.hp = b.boss.maxHp * 0.69;
  b.updateBoss(0.05);
  assert.strictEqual(b.boss.intangible, true);
  assert.strictEqual(b.immune(b.boss, b.players[0]), true, 'plus rien ne le touche');
  const hands = b.adds.filter((a) => a.kind === 'main' && a.alive);
  assert.strictEqual(hands.length, Math.max(E.intangible.hands.min, Math.min(E.intangible.hands.max, Math.ceil(6 / E.intangible.hands.per))));
  assert.strictEqual(hands[0].speed, 0);
  // Une main agrippe (étourdit) le héros qu'elle frappe
  hands[0].precision = 1;
  b.attack(hands[0], b.players[0]);
  assert.ok(b.players[0].stunUntil > b.time || b.players[0].buffs.some((x) => x.kind === 'stun' || x.stun));
  const until = b.boss.stage.until;
  b.kill(b.players[1], hands[1]);
  assert.ok(Math.abs(b.boss.stage.until - (until - E.intangible.shorten)) < 1e-9);
  // Il reprend forme à la fin ; les mains restantes disparaissent
  b.time = b.boss.stage.until + 0.01;
  b.events = [];
  b.updateBoss(0.05);
  assert.strictEqual(b.boss.intangible, false);
  const back = b.events.find((e) => e.t === 'bossReturn');
  assert.ok(back && back.sub && !/œuf/.test(back.sub), 'son propre texte de retour (pas celui des œufs de Pyrax)');
  assert.ok(!b.adds.some((a) => a.kind === 'main' && a.alive));
  // Feux follets à 50 % : ils explosent au contact
  b.boss.hp = b.boss.maxHp * 0.49;
  b.updateBoss(0.05);
  const wisps = b.adds.filter((a) => a.kind === 'feu_follet' && a.alive);
  assert.ok(wisps.length >= E.wisps.base && wisps[0].kamikaze);
  const target = b.players[2];
  wisps[0].x = target.x; wisps[0].y = target.y;
  const hp = target.hp;
  b.attack(wisps[0], target);
  assert.ok(!wisps[0].alive && target.hp < hp);
  // Intangible à 35 %, puis furie à 15 % : plus d'esquive et coups plus rapides
  b.boss.hp = b.boss.maxHp * 0.34;
  b.updateBoss(0.05);
  b.time = b.boss.stage.until + 0.01;
  b.updateBoss(0.05);
  const dodge = b.boss.dodge;
  const cd = b.boss.cooldown;
  b.boss.hp = b.boss.maxHp * 0.14;
  b.updateBoss(0.05);
  assert.ok(Math.abs(b.boss.dodge - (dodge + E.fury.dodge)) < 1e-9);
  assert.ok(Math.abs(b.boss.cooldown - cd / E.fury.attackSpeedMult) < 1e-9);
});

test('[LIL-1, LIL-2] Lilith : bond, cartes qui font saigner, disparition puis griffes dans le dos, bonneteau', () => {
  const b = fight('lilith', 5);
  freeze(b);
  const L = Rules.BOSSES.lilith;
  assert.strictEqual(b.boss.maxHp, L.hpBase + L.hpPerPlayer * 5);
  b.boss.slamIn = 0; b.bossSpecials(0.05, L);
  assert.ok(b.slams.some((s) => s.leap && s.r === L.pounce.radius));
  b.boss.slamIn = 0; b.bossSpecials(0.05, L);
  assert.ok(b.slams.some((s) => s.kind === 'cards' && s.cone && s.bleed === L.cards.bleed));
  b.boss.slamIn = 0; b.bossSpecials(0.05, L);
  assert.ok(b.boss.vanish && b.boss.away, 'disparue : intouchable');
  assert.strictEqual(b.immune(b.boss, b.players[0]), true);
  b.time = b.boss.vanish.until + 0.01;
  b.updateVanish(L);
  assert.strictEqual(b.boss.away, false);
  assert.ok(b.slams.some((s) => s.kind === 'claw'));
  // Bonneteau : les héros échangent leurs places et restent sonnés
  b.slams = [];
  b.boss.slamIn = 0; b.bossSpecials(0.05, L);
  assert.ok(b.boss.shuffleAt > 0);
  const before = b.players.map((p) => `${p.x},${p.y}`);
  b.doShuffle(L);
  const after = b.players.map((p) => `${p.x},${p.y}`);
  assert.deepStrictEqual([...after].sort(), [...before].sort(), 'mêmes places, redistribuées');
  assert.notDeepStrictEqual(after, before);
});

test('[LIL-3, LIL-4] Lilith : illusions indiscernables (étourdie si toutes brisées, sinon elles explosent), chapeau, neuvième vie', () => {
  const b = fight('lilith', 5);
  freeze(b);
  const L = Rules.BOSSES.lilith;
  b.boss.slamIn = 999;
  b.boss.hp = b.boss.maxHp * 0.74;
  b.updateBoss(0.05);
  let ill = b.adds.filter((a) => a.illusion && a.alive);
  assert.strictEqual(ill.length, L.illusions.counts[0]);
  assert.ok(ill.every((a) => a.kind === 'lilith' && a.name === b.boss.name && a.r === b.boss.r), 'indiscernables');
  for (const a of ill) b.kill(b.players[0], a);
  b.updateBoss(0.05);
  assert.ok(b.boss.dazedUntil > b.time, 'toutes brisées : étourdie');
  // Étourdie : elle subit +50 % de dégâts
  const t = b.boss;
  t.hp = t.maxHp * 0.6;
  // Deuxième vague (à 40 %) : on laisse les illusions tenir, elles explosent
  b.boss.hp = b.boss.maxHp * 0.39;
  b.updateBoss(0.05); // chapeau (50 %) puis illusions (40 %), une étape par appel
  b.updateBoss(0.05);
  assert.ok(b.adds.some((a) => a.kind === 'chapeau' && a.alive), 'chapeau magique à 50 %');
  ill = b.adds.filter((a) => a.illusion && a.alive);
  assert.strictEqual(ill.length, L.illusions.counts[1]);
  b.time = b.boss.stage.until + 0.01;
  b.updateBoss(0.05);
  assert.strictEqual(b.slams.filter((s) => s.kind === 'pop').length, L.illusions.counts[1]);
  assert.ok(!b.adds.some((a) => a.illusion && a.alive));
  // Le chapeau fait sortir des chatons
  b.boss.hatIn = 0;
  b.updateHat(0.05, L);
  assert.ok(b.adds.some((a) => a.kind === 'chaton' && a.alive));
  // Neuvième vie à 10 %
  b.boss.hp = b.boss.maxHp * 0.09;
  const hp = b.boss.hp;
  b.updateBoss(0.05);
  assert.ok(Math.abs(b.boss.hp - (hp + b.boss.maxHp * L.ninelives.heal)) < 1e-6);
});

test('[DAE-1, DAE-2] Daedra : fouet de feu à longue portée, colonnes de feu infranchissables, cercle infernal', () => {
  const b = fight('daedra', 6);
  freeze(b);
  const D = Rules.BOSSES.daedra;
  assert.strictEqual(b.boss.maxHp, D.hpBase + D.hpPerPlayer * 6);
  assert.strictEqual(b.boss.range, D.range);
  // Colonne de feu : annoncée, puis elle reste au sol
  b.boss.slamIn = 0; b.bossSpecials(0.05, D);
  const pillar = b.slams.find((s) => s.kind === 'pillar');
  assert.ok(pillar && pillar.wall && pillar.line);
  pillar.t = 0.01;
  b.resolveSlams(0.05);
  assert.strictEqual(b.firewalls.length, 1);
  // Infranchissable : un héros poussé au travers d'un mur (ici horizontal, y = 350) est renvoyé de son côté
  b.firewalls = [{ id: 7, x1: -1000, y1: 350, x2: 2000, y2: 350, w: D.pillars.width, until: b.time + 5, burn: D.pillars.burn }];
  const h = b.players[0];
  h.x = 500; h.y = 280;
  b.updateFirewalls(0.05);
  h.y = 360; // il tente de passer de l'autre côté
  b.updateFirewalls(0.05);
  assert.ok(h.y <= 350 - D.pillars.width / 2 - h.r + 1e-6, 'repoussé du côté d\'où il venait');
  // Il brûle s'il s'y colle
  const hp = h.hp;
  for (let i = 0; i < 12; i++) { h.y = 350 - D.pillars.width / 2 - h.r + 2; b.updateFirewalls(0.05); }
  assert.ok(h.hp < hp);
  // Fouet infernal en cône, cercle infernal autour d'un héros puis explosion programmée
  b.boss.slamIn = 0; b.bossSpecials(0.05, D);
  assert.ok(b.slams.some((s) => s.kind === 'lash' && s.cone));
  b.boss.slamIn = 0; b.bossSpecials(0.05, D);
  const ring = b.slams.find((s) => s.kind === 'firering');
  assert.ok(ring && ring.band === D.ring.width && ring.ringWall);
  assert.ok(b.slams.some((s) => s.kind === 'ringblast' && s.delay > 0));
  // Daedra vaincue (Boss Rush : boss suivant) → les murs s'éteignent
  assert.ok(b.firewalls.length >= 1);
});

test('[DAE-3, DAE-4] Daedra : démons de feu réguliers, portails qui la protègent, embrasement, furie', () => {
  const b = fight('daedra', 6);
  freeze(b);
  const D = Rules.BOSSES.daedra;
  b.boss.slamIn = 999;
  b.boss.demonIn = 0;
  b.updateDemons(0.05, D);
  const demons = () => b.adds.filter((a) => a.kind === 'demon' && a.alive);
  assert.strictEqual(demons().length, Math.max(D.demons.min, Math.min(D.demons.max, Math.ceil(6 / D.demons.per))));
  // Portails à 66 % : -40 % de dégâts subis tant qu'ils tiennent ; pas de démons réguliers pendant ce temps
  b.boss.hp = b.boss.maxHp * 0.65;
  b.updateBoss(0.05);
  const portals = b.adds.filter((a) => a.kind === 'portail' && a.alive);
  assert.strictEqual(portals.length, D.portals.count);
  assert.strictEqual(b.boss.guarded, true);
  assert.strictEqual(b.boss.guardMult, D.portals.guard);
  for (const p of portals) b.kill(b.players[0], p);
  b.updateBoss(0.05);
  assert.strictEqual(b.boss.guarded, false);
  // Embrasement à 33 % : elle s'élève (intouchable), murs de feu et pluie de flammes, puis redescend
  b.boss.hp = b.boss.maxHp * 0.32;
  b.updateBoss(0.05);
  assert.strictEqual(b.boss.away, true);
  tickFor(b, 3);
  assert.ok(b.firewalls.length > 0 || b.slams.some((s) => s.kind === 'pillar' || s.kind === 'hellfire'));
  b.time = b.boss.stage.until + 0.01;
  b.updateBoss(0.05);
  assert.strictEqual(b.boss.away, false);
  // Furie à 15 % : fouet plus long et plus rapide
  const range = b.boss.range;
  b.boss.hp = b.boss.maxHp * 0.14;
  b.updateBoss(0.05);
  assert.strictEqual(b.boss.range, range + D.fury.range);
  assert.strictEqual(b.boss.demonEvery, D.fury.demonEvery);
  // Boss Rush : les murs de feu s'éteignent au boss suivant
  b.firewalls.push({ id: 99, x1: 0, y1: 0, x2: 10, y2: 10, w: 10, until: b.time + 99, burn: 0 });
  assert.ok(b.firewalls.length);
});
