/*
 * Bataille : file d'attente, placement, boucle, ciblage, déplacements, zone et fin de bataille.
 * (Les attaques et les séries de kills sont dans battle.test.js, les événements dans events.test.js.)
 */
const test = require('node:test');
const assert = require('node:assert');
const { Battle, testBattle, base } = require('./helpers');

// Rend les combattants immobiles et empêche toute attaque pendant le test.
function still(b) {
  for (const f of b.fighters) { f.speed = 0; f.cd = 99; }
}

const player = (key, extra = {}) => ({ key, name: key, level: 1, look: {}, stats: base(), ...extra });

// ---------- File d'attente ----------

test('[Q-2, Q-3, Q-4, Q-5, Q-6] file : ouverture, fermeture à l\'expiration, clés uniques', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const b = new Battle();
  const cleared = [];
  b.on('cleared', () => cleared.push(1));
  b.openQueue(60);
  assert.strictEqual(b.phase, 'queue');
  assert.strictEqual(b.join(player('a')), true);
  assert.strictEqual(b.join(player('a')), false, 'clé déjà inscrite');
  assert.strictEqual(b.join(player('bot1', { bot: true })), true);
  assert.strictEqual(b.participants.size, 2);

  // L'expiration du minuteur ferme la file mais garde les inscrits.
  t.mock.timers.tick(59000);
  assert.strictEqual(b.phase, 'queue');
  t.mock.timers.tick(1000);
  assert.strictEqual(b.phase, 'ready');
  assert.strictEqual(b.participants.size, 2);
  assert.strictEqual(b.join(player('c')), false, 'file fermée');

  // Rouvrir vide tout et émet « cleared ».
  b.event = 'fog';
  b.result = { winner: null };
  b.openQueue(60);
  assert.strictEqual(b.phase, 'queue');
  assert.strictEqual(b.participants.size, 0);
  assert.strictEqual(b.event, null);
  assert.strictEqual(b.result, null);
  assert.strictEqual(cleared.length, 2);

  // Pendant une bataille, l'ouverture est refusée.
  b.join(player('a'));
  b.join(player('b'));
  b.start();
  assert.throws(() => b.openQueue(60), /en cours/);
  assert.strictEqual(b.phase, 'battle');
  b.stopLoop();

  // Fermeture manuelle (admin) : « ready » sans effacer les inscrits.
  const c = new Battle();
  c.openQueue(60);
  c.join(player('a'));
  c.closeQueue();
  assert.strictEqual(c.phase, 'ready');
  assert.strictEqual(c.participants.size, 1);
});

test('[Q-8] lancement : les stats des humains sont rafraîchies, pas celles des bots', () => {
  const b = new Battle();
  b.openQueue(60); clearTimeout(b.queueTimer);
  b.join(player('u1', { userId: '1', stats: base({ maxHp: 100 }) }));
  b.join(player('bot1', { bot: true, stats: base({ maxHp: 100 }) }));
  const refresh = (p) => (p.userId ? { ...p, stats: base({ maxHp: 777 }), level: 9 } : p);
  b.start(refresh); b.stopLoop();
  const [h, bot] = b.fighters;
  assert.deepStrictEqual([h.maxHp, h.hp, h.level], [777, 777, 9]);
  assert.strictEqual(bot.maxHp, 100);
});

test('[Q-12] file : l\'événement n\'est révélé qu\'à partir de la bataille', () => {
  const b = new Battle();
  b.openQueue(60); clearTimeout(b.queueTimer);
  b.join(player('a'));
  b.join(player('b'));
  b.event = 'fog';
  assert.strictEqual(b.publicQueue().event, null, 'masqué en phase « queue »');
  b.start(null, 'meteors'); b.stopLoop();
  assert.strictEqual(b.publicQueue().event, 'meteors');
  b.finish(b.fighters[0]);
  assert.strictEqual(b.phase, 'ended');
  assert.strictEqual(b.publicQueue().event, 'meteors');
  b.openQueue(60); clearTimeout(b.queueTimer);
  assert.strictEqual(b.publicQueue().event, null);
});

// ---------- Placement et boucle ----------

test('[B-2] placement : dans l\'arène avec marge de 60 px et distance minimale', () => {
  for (let run = 0; run < 30; run++) {
    const b = testBattle(['a', 'b', 'c', 'd'].map((k) => ({ key: k, name: k, stats: base() })));
    for (const f of b.fighters) {
      assert.ok(f.x >= 60 && f.x <= 1280 - 60 && f.y >= 60 && f.y <= 720 - 60, `${f.x},${f.y}`);
    }
    // 4 combattants : √(1280×720/4)×0,6 ≈ 288 → plafonné à 140
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const d = Math.hypot(b.fighters[i].x - b.fighters[j].x, b.fighters[i].y - b.fighters[j].y);
        assert.ok(d >= 140, `distance ${d}`);
      }
    }
  }
  const b = new Battle();
  let started = null;
  b.on('start', (fighters) => { started = fighters; });
  b.openQueue(60); clearTimeout(b.queueTimer);
  b.join(player('a'));
  b.join(player('b'));
  b.start(); b.stopLoop();
  assert.strictEqual(started, b.fighters, '« start » émis avec les combattants');
});

test('[B-3] boucle : un tick et un frame toutes les 50 ms', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const b = new Battle();
  b.openQueue(60);
  b.join(player('a'));
  b.join(player('b'));
  b.start();
  still(b);
  const frames = [];
  b.on('frame', (f) => frames.push(f));
  t.mock.timers.tick(49);
  assert.strictEqual(frames.length, 0);
  t.mock.timers.tick(1);
  assert.strictEqual(frames.length, 1);
  t.mock.timers.tick(150);
  assert.strictEqual(frames.length, 4);
  assert.ok(Math.abs(b.time - 0.2) < 1e-9);
  assert.strictEqual(frames[3].phase, 'battle');
  b.stopLoop();
  t.mock.timers.tick(500);
  assert.strictEqual(frames.length, 4, 'boucle arrêtée');
});

// ---------- Comportement des combattants ----------

test('[B-6] ciblage : le plus proche, le Guerrier paraît plus proche (taunt 0,7)', () => {
  const scene = (cls) => {
    const b = testBattle([
      { key: 'a', name: 'A', stats: base() },
      { key: 'near', name: 'N', stats: base() },
      { key: 'w', name: 'W', cls, stats: base() },
    ]);
    still(b);
    const [a, near, w] = b.fighters;
    Object.assign(a, { x: 300, y: 300 }); Object.assign(near, { x: 380, y: 600 }); Object.assign(w, { x: 400, y: 600 });
    b.tick(0.05);
    return a;
  };
  // near est à ≈ 310 px, w à ≈ 316 px
  assert.strictEqual(scene(null).targetKey, 'near');
  assert.strictEqual(scene('guerrier').targetKey, 'w'); // 316 × 0,7 ≈ 221 < 310
});

test('[B-7] ciblage : l\'Assassin vise le meilleur ratio PV × (1 + distance/500)', () => {
  const b = testBattle([
    { key: 'ass', name: 'S', cls: 'assassin', stats: base() },
    { key: 'close', name: 'C', stats: base() },
    { key: 'weak', name: 'W', stats: base() },
  ]);
  still(b);
  const [s, close, weak] = b.fighters;
  Object.assign(s, { x: 300, y: 300 });
  Object.assign(close, { x: 350, y: 300, hp: 1000 }); // 1000 × 1,1 = 1100
  Object.assign(weak, { x: 700, y: 300, hp: 100 }); // 100 × 1,8 = 180
  b.tick(0.05);
  assert.strictEqual(s.targetKey, 'weak');
  weak.hp = 700; // 700 × 1,8 = 1260 > 1100
  b.tick(0.05);
  assert.strictEqual(s.targetKey, 'close');
});

test('[B-9, B-10, B-11] déplacement, recul de l\'Archer et attaque à portée', () => {
  const duel = (cls) => {
    const b = testBattle([{ key: 'a', name: 'A', cls, stats: base() }, { key: 't', name: 'T', stats: base() }]);
    still(b);
    return b;
  };
  // B-9 : avance à sa vitesse, sans dépasser sa portée (40 px)
  let b = duel(null);
  let [a, t] = b.fighters;
  Object.assign(a, { x: 100, y: 300, speed: 100 }); Object.assign(t, { x: 400, y: 300 });
  b.tick(0.5);
  assert.ok(Math.abs(a.x - 150) < 1e-6, `avance de 50 px (x=${a.x})`);
  Object.assign(a, { x: 100, y: 300, speed: 10000 }); Object.assign(t, { x: 300, y: 300 });
  b.tick(0.5);
  const d = Math.hypot(a.x - t.x, a.y - t.y);
  assert.ok(d <= 40 && d > 30, `s'arrête à portée (${d})`);

  // B-10 : l'Archer recule à 80 % de sa vitesse si la cible est à moins de 110 px
  b = duel('archer');
  [a, t] = b.fighters;
  Object.assign(a, { x: 600, y: 300, speed: 100 }); Object.assign(t, { x: 700, y: 300 });
  b.tick(0.5);
  assert.ok(Math.abs(a.x - 560) < 1e-6, `recule de 40 px (x=${a.x})`);
  Object.assign(a, { x: 600, y: 300, speed: 100 }); Object.assign(t, { x: 750, y: 300 });
  b.tick(0.5);
  assert.strictEqual(a.x, 600, 'à 150 px : ni avance ni recul (portée 230)');

  // B-11 : attaque seulement quand le délai de recharge est écoulé
  b = duel(null);
  [a, t] = b.fighters;
  Object.assign(a, { x: 300, y: 300, cooldown: 1, cd: 0.2 }); Object.assign(t, { x: 330, y: 300 });
  const hits = [];
  b.on('frame', (f) => hits.push(...f.events.filter((e) => e.t === 'hit' && e.from === 'a')));
  b.tick(0.05);
  assert.strictEqual(hits.length, 0, 'recharge en cours');
  a.cd = 0.01;
  b.tick(0.05);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(a.cd, 1, 'recharge relancée');
  // Délai initial aléatoire entre 0 et 0,5 s
  const c = testBattle(Array.from({ length: 12 }, (_, i) => ({ key: 'k' + i, name: 'K', stats: base() })));
  assert.ok(c.fighters.every((f) => f.cd >= 0 && f.cd < 0.5));
});

test('[B-12] séparation : les combattants qui se chevauchent sont écartés, et restent dans l\'arène', () => {
  const b = testBattle([{ key: 'a', name: 'A', stats: base() }, { key: 'b', name: 'B', stats: base() }, { key: 'c', name: 'C', stats: base() }]);
  still(b);
  const [a, bb, c] = b.fighters;
  Object.assign(a, { x: 400, y: 300 }); Object.assign(bb, { x: 410, y: 300 }); Object.assign(c, { x: -50, y: 900 });
  b.tick(0.05);
  assert.ok(Math.hypot(a.x - bb.x, a.y - bb.y) >= 32 - 1e-6);
  assert.deepStrictEqual([c.x, c.y], [16, 720 - 16]);
  Object.assign(c, { x: 5000, y: -10 });
  b.tick(0.05);
  assert.deepStrictEqual([c.x, c.y], [1280 - 16, 16]);
});

test('[B-13] Prêtre : régénère 1,5 % de sa vie max par seconde', () => {
  const b = testBattle([
    { key: 'p', name: 'P', cls: 'pretre', stats: base() },
    { key: 'o', name: 'O', stats: base() },
  ]);
  still(b);
  const [p, o] = b.fighters;
  Object.assign(p, { x: 100, y: 100, hp: 500 }); Object.assign(o, { x: 1000, y: 600, hp: 500 });
  b.tick(1);
  assert.ok(Math.abs(p.hp - 515) < 1e-9, `${p.hp}`);
  assert.strictEqual(o.hp, 500);
  p.hp = 999;
  b.tick(1);
  assert.strictEqual(p.hp, 1000, 'plafonné à la vie max');
});

test('[B-16] dégâts : max(1, round(brut × (1 − réduction)))', () => {
  const b = testBattle([
    { key: 'a', name: 'A', stats: base() },
    { key: 't', name: 'T', stats: base({ reduction: 0.5 }) },
    { key: 'u', name: 'U', stats: base({ reduction: 0.99 }) },
  ]);
  const [a, t, u] = b.fighters;
  b.hit(a, t, 101);
  assert.strictEqual(b.events.find((e) => e.to === 't').dmg, 51); // round(50,5)
  assert.strictEqual(t.hp, 1000 - 51);
  b.hit(a, u, 10);
  assert.strictEqual(u.hp, 999, 'au moins 1 dégât');
});

test('[B-20] mort : instant enregistré, « kill » émis seulement si un tueur est connu', () => {
  const b = testBattle([
    { key: 'a', name: 'A', stats: base({ damage: 1e6 }) },
    { key: 'v', name: 'V', stats: base() },
    { key: 'w', name: 'W', stats: base() },
  ]);
  const [a, v, w] = b.fighters;
  const kills = [];
  b.on('kill', (killer, victim) => kills.push([killer.key, victim.key]));
  b.time = 12.5;
  b.attack(a, v);
  assert.deepStrictEqual([v.alive, v.hp, v.diedAt], [false, 0, 12.5]);
  assert.deepStrictEqual(kills, [['a', 'v']]);
  assert.ok(b.events.some((e) => e.t === 'kill' && e.from === 'a' && e.to === 'v'));
  b.events = [];
  b.time = 20;
  b.kill(null, w);
  assert.strictEqual(w.diedAt, 20);
  assert.strictEqual(kills.length, 1, 'pas de « kill » sans tueur');
  assert.ok(b.events.some((e) => e.t === 'kill' && e.from === null && e.to === 'w'));
});

// ---------- Zone et fin de bataille ----------

test('[B-21] zone : fixe puis rétrécit de √(w²+h²)/2 à 70 px entre 45 s et 105 s', () => {
  const b = testBattle([{ key: 'a', name: 'A', stats: base() }, { key: 'b', name: 'B', stats: base() }]);
  const max = Math.hypot(1280, 720) / 2;
  b.time = 44.9;
  assert.deepStrictEqual(b.storm(), { x: 640, y: 360, r: max, active: false });
  b.time = 45;
  assert.strictEqual(b.storm().active, true);
  assert.ok(Math.abs(b.storm().r - max) < 1e-9);
  b.time = 75;
  assert.ok(Math.abs(b.storm().r - (max + 70) / 2) < 1e-9);
  b.time = 105;
  assert.ok(Math.abs(b.storm().r - 70) < 1e-9);
  b.time = 250;
  assert.ok(Math.abs(b.storm().r - 70) < 1e-9);
  assert.strictEqual(b.frame().storm.r, b.storm().r);
});

test('[B-22] zone : hors zone, 5 % de la vie max par seconde (minimum 1), sans tueur', () => {
  const b = testBattle([
    { key: 'in', name: 'I', stats: base() },
    { key: 'out', name: 'O', stats: base() },
    { key: 'tiny', name: 'T', stats: base({ maxHp: 10 }) },
  ]);
  still(b);
  const [inside, out, tiny] = b.fighters;
  Object.assign(inside, { x: 640, y: 360 }); Object.assign(out, { x: 100, y: 100 }); Object.assign(tiny, { x: 1100, y: 600 });
  b.time = 105;
  const kills = [];
  b.on('kill', () => kills.push(1));
  b.tick(0.1);
  assert.strictEqual(inside.hp, 1000);
  assert.ok(Math.abs(out.hp - 995) < 1e-9, `${out.hp}`); // 1000 × 5 % × 0,1
  assert.ok(Math.abs(tiny.hp - 9) < 1e-9, 'minimum 1 dégât'); // 10 × 5 % × 0,1 = 0,05 → 1
  tiny.hp = 1;
  b.tick(0.1);
  assert.strictEqual(tiny.alive, false);
  assert.strictEqual(kills.length, 0, 'mort sans tueur');
});

test('[B-24] morts simultanées : le dernier tombé est ressuscité avec 1 PV et gagne', () => {
  const b = testBattle([{ key: 'a', name: 'A', stats: base() }, { key: 'b', name: 'B', stats: base() }]);
  still(b);
  const [a, bb] = b.fighters;
  b.time = 5; b.kill(null, a);
  b.time = 6; b.kill(null, bb);
  b.tick(0.05);
  assert.strictEqual(b.phase, 'ended');
  assert.strictEqual(bb.alive, true);
  assert.strictEqual(bb.hp, 1);
  assert.strictEqual(b.result.winner.key, 'b');
  assert.strictEqual(a.alive, false);
});

test('[B-25] fin : un seul survivant, ou 300 s écoulées (meilleur ratio PV / PV max)', () => {
  const b = testBattle([{ key: 'a', name: 'A', stats: base() }, { key: 'b', name: 'B', stats: base() }, { key: 'c', name: 'C', stats: base() }]);
  still(b);
  const [a, , c] = b.fighters;
  b.kill(null, a);
  b.tick(0.05);
  assert.strictEqual(b.phase, 'battle', 'deux survivants : on continue');
  b.kill(null, c);
  b.tick(0.05);
  assert.strictEqual(b.phase, 'ended');
  assert.strictEqual(b.result.winner.key, 'b');

  const t = testBattle([{ key: 'a', name: 'A', stats: base() }, { key: 'b', name: 'B', stats: base() }, { key: 'c', name: 'C', stats: base({ maxHp: 200 }) }]);
  still(t);
  const [x, y, z] = t.fighters;
  // Tous près du centre, donc dans la zone minimale (70 px) : pas de dégâts de zone.
  Object.assign(x, { x: 640, y: 360, hp: 500 }); Object.assign(y, { x: 670, y: 360, hp: 900 }); Object.assign(z, { x: 640, y: 390, hp: 190 });
  t.time = 299.9;
  t.tick(0.05);
  assert.strictEqual(t.phase, 'battle', 'pas encore 300 s');
  t.tick(0.1);
  assert.strictEqual(t.phase, 'ended');
  assert.strictEqual(t.result.winner.key, 'c','190/200 = 0,95 > 0,9');
  assert.strictEqual(t.result.duration, 300);
});
