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
  assert.deepStrictEqual(Object.keys(Rules.BOSSES), ['troll', 'dragon', 'sorcier']);
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
  assert.strictEqual(b.boss.maxHp, 200 + 370 * 10);
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
  assert.strictEqual(warrior.targetKey, 'boss');
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
