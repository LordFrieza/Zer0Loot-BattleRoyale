/*
 * Pêche : Pêchédex de 100 espèces, tirage de ce qui mord, ferrage, remontée, trésors, panoplie, migration.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, game } = require('./helpers');
const fishing = require('../server/fishing');

let n = 0;
function angler() {
  const c = game.newCharacter();
  game.chooseClass(c, 'mage');
  return { id: 'fish' + (++n), username: 'Pecheur' + n, role: 'player', character: c };
}
// Force la prochaine prise (poisson ou trésor)
function rig(target, fn) {
  const real = fishing.rollTarget;
  fishing.rollTarget = () => target;
  try { return fn(); } finally { fishing.rollTarget = real; }
}

test('[FISH-1] Pêchédex : 100 espèces, 5 raretés, 18 formes, poissons du jour et de la nuit', () => {
  const all = Object.values(Rules.FISH);
  assert.strictEqual(all.length, 100);
  assert.strictEqual(new Set(Rules.FISH_IDS).size, 100);
  const count = {};
  for (const f of all) count[f.rarity] = (count[f.rarity] || 0) + 1;
  assert.deepStrictEqual(count, { commun: 40, peu_commun: 28, rare: 18, epique: 10, legendaire: 4 });
  assert.ok(all.every((f) => Rules.FISHING.shapes.includes(f.shape) && f.min > 0 && f.max > f.min && Rules.FISHING.moves[f.move]));
  assert.strictEqual(new Set(all.map((f) => f.shape)).size, 18);
  assert.ok(all.some((f) => f.when === 'nuit') && all.some((f) => f.when === 'jour'));
  // Heure de Paris : nuit de 20 h 30 à 6 h
  assert.strictEqual(Rules.fishTime(Date.parse('2026-06-15T12:00:00+02:00')), 'jour');
  assert.strictEqual(Rules.fishTime(Date.parse('2026-06-15T23:00:00+02:00')), 'nuit');
  assert.strictEqual(Rules.fishTime(Date.parse('2026-06-15T20:45:00+02:00')), 'nuit');
  const day = Rules.fishPool('jour');
  assert.ok(!Object.values(day).flat().some((id) => Rules.FISH[id].when === 'nuit'), 'pas de poisson de nuit le jour');
  assert.ok(Object.values(Rules.fishPool('nuit')).flat().includes('kraken'));
});

// Lance la ligne avec une prise forcée ; renvoie la réponse et la partie gardée par le serveur (temps secrets)
function castFor(u, target, now = 0) {
  fishing.calm.delete(u.id);
  fishing.sessions.delete(u.id);
  const r = rig(target, () => fishing.cast(u, now));
  return { r, s: fishing.sessions.get(u.id) };
}
// Joue la remontée comme un très bon joueur : tient le clic quand le poisson est au-dessus du milieu de la zone verte,
// en anticipant son élan (good = false : fait exprès de le perdre). Renvoie les appuis (numéros de pas) et le résultat.
function play(reel, good = true) {
  const R = Rules.fishReelNew(reel);
  const toggles = [];
  let holding = false;
  while (!R.done && R.step < 10800) {
    const ahead = R.fy - (R.pos + R.zone / 2) - R.vel * 0.3;
    const want = good ? ahead > 0 : ahead < 0;
    if (want !== holding) { toggles.push(R.step); holding = want; }
    Rules.fishReelStep(R, holding);
  }
  return { toggles, R, seconds: R.step * Rules.FISHING.reelDt };
}

test('[FISH-2] lancer : poisson (95 %) ou trésor (5 %), selon l\'heure ; rien n\'est révélé au lancer, chaque étape arrive en direct', () => {
  assert.strictEqual(Rules.FISHING.treasureChance, 0.05);
  assert.deepStrictEqual(Object.values(Rules.FISHING.rarities).map((r) => r.weight), [52, 27, 13, 6, 2]);
  const night = Date.parse('2026-06-15T23:00:00+02:00');
  const kinds = { fish: 0, treasure: 0 };
  for (let i = 0; i < 3000; i++) {
    const t = fishing.rollTarget(night);
    kinds[t.kind] += 1;
    if (t.kind === 'fish') {
      const f = Rules.FISH[t.id];
      assert.ok(f.when !== 'jour', 'pas de poisson de jour la nuit');
      assert.ok(t.size >= f.min && t.size <= f.max);
    }
  }
  assert.ok(kinds.treasure > 60 && kinds.treasure < 260, `≈ 5 % de trésors (${kinds.treasure})`);
  const u = angler();
  const { r, s } = castFor(u, { kind: 'fish', id: 'perche', size: 30 }, 1000);
  assert.deepStrictEqual(Object.keys(r).sort(), ['approach', 'id', 'school'], 'ni temps, ni fenêtre, ni silhouette au lancer (seulement le banc de poissons, visible de tous)');
  assert.strictEqual(r.id.length, 12);
  assert.ok(s.appear >= 3 && s.appear <= 15);
  assert.ok(s.nibbles.every((x) => x >= s.appear + Rules.FISHING.approach - 0.006), 'temps arrondis au centième');
  assert.ok(s.sink >= s.appear + Rules.FISHING.approach - 0.006);
  assert.deepStrictEqual([s.shape, s.big, s.window], ['poisson', 'moyen', Rules.FISHING.rarities.commun.window]);
  // En direct : la silhouette à l'apparition, les touches, le bouchon qui coule, puis la prise ratée (et les poissons qui se méfient)
  const sent = [];
  const timers = [];
  const realTimer = fishing.timer;
  fishing.setNotify((userId, ev) => sent.push([userId, ev]));
  fishing.timer = (fn, ms) => { timers.push({ fn, ms }); return null; };
  try {
    const now = Date.now();
    const { r: r2, s: s2 } = castFor(u, { kind: 'treasure' }, now);
    assert.strictEqual(timers.length, 3 + s2.nibbles.length);
    assert.ok(Math.abs(timers[0].ms - s2.appear * 1000) < 50);
    assert.ok(Math.abs(timers[timers.length - 1].ms - (s2.sink + s2.window + Rules.FISHING.latency) * 1000) < 50);
    for (const t of timers) t.fn();
    assert.deepStrictEqual(sent.map(([id, ev]) => [id, ev.id, ev.k]), [
      [u.id, r2.id, 'appear'], ...s2.nibbles.map(() => [u.id, r2.id, 'nibble']), [u.id, r2.id, 'sink'], [u.id, r2.id, 'miss'],
    ]);
    assert.deepStrictEqual([sent[0][1].shape, sent[0][1].big], ['tresor', 'moyen']);
    assert.strictEqual(sent[sent.length - 1][1].wait, Rules.FISHING.scare);
    assert.ok(!fishing.sessions.has(u.id), 'ratée : la partie est close');
  } finally { fishing.setNotify(null); fishing.timer = realTimer; }
});

test('[FISH-3] ferrer : seulement quand le bouchon coule, dans la fenêtre de la rareté ; graine de la remontée', () => {
  const u = angler();
  // Trop tôt
  let { r: c, s } = castFor(u, { kind: 'fish', id: 'gardon', size: 12 });
  const early = fishing.hook(u, c.id, (s.sink - 0.5) * 1000);
  assert.deepStrictEqual([early.escaped, early.reason], [true, 'tot']);
  assert.throws(() => fishing.hook(u, c.id, s.sink * 1000), /Lance d'abord/);
  // Trop tard (légendaire : 0,5 s + 0,45 s de marge réseau)
  ({ r: c, s } = castFor(u, { kind: 'fish', id: 'kraken', size: 700 }));
  assert.strictEqual(s.window, 0.5);
  assert.strictEqual(fishing.hook(u, c.id, (s.sink + 0.5 + 0.45 + 0.1) * 1000).reason, 'tard');
  // Dans la fenêtre : paramètres de la remontée et sa graine
  ({ r: c, s } = castFor(u, { kind: 'fish', id: 'kraken', size: 700 }));
  const h = fishing.hook(u, c.id, (s.sink + 0.4) * 1000);
  assert.strictEqual(h.hooked, true);
  assert.ok(Number.isInteger(h.reel.seed));
  assert.deepStrictEqual({ ...h.reel, seed: 0 }, { zone: 0.2, vmax: 0.68, dart: 1.18, changes: 2.2, fill: 9, move: 'mixte', start: 0.3, drain: 0.85, seed: 0 });
  assert.ok(Object.values(Rules.FISHING.rarities).every((r) => r.dart < 1.6), 'un départ soudain reste plus lent que la zone verte (toujours rattrapable)');
  assert.throws(() => fishing.hook(u, c.id, (s.sink + 0.3) * 1000), /Déjà ferré/);
  // Trésor : comme un objet lourd
  ({ r: c, s } = castFor(u, { kind: 'treasure' }));
  assert.strictEqual(s.shape, 'tresor');
  assert.strictEqual(fishing.hook(u, c.id, (s.sink + 0.1) * 1000).reel.move, 'coulant');
  // Même graine, mêmes appuis : même remontée (navigateur et serveur)
  const a = Rules.fishReelReplay(h.reel, [10, 50, 90]);
  const b = Rules.fishReelReplay(h.reel, [10, 50, 90]);
  assert.deepStrictEqual([a.step, a.won, a.fy], [b.step, b.won, b.fy]);
});

test('[FISH-9] une prise vue puis laissée effraie les poissons : 8 s avant de relancer (pas de relance en boucle jusqu\'au trésor)', () => {
  const u = angler();
  const scare = Rules.FISHING.scare;
  assert.strictEqual(scare, 8);
  // Ligne rentrée avant que la silhouette n'apparaisse : rien
  let { s } = castFor(u, { kind: 'fish', id: 'gardon', size: 12 }, 0);
  assert.deepStrictEqual(fishing.stop(u, (s.appear - 1) * 1000), { stopped: true, wait: 0 });
  rig({ kind: 'fish', id: 'gardon', size: 12 }, () => fishing.cast(u, s.appear * 1000));
  // Silhouette vue puis ligne rentrée : 8 s
  s = fishing.sessions.get(u.id);
  const t0 = s.castAt + (s.appear + 1) * 1000;
  assert.deepStrictEqual(fishing.stop(u, t0), { stopped: true, wait: scare });
  assert.throws(() => fishing.cast(u, t0 + 2000), /se méfient encore… relance dans 6 s/);
  rig({ kind: 'treasure' }, () => fishing.cast(u, t0 + scare * 1000));
  // Relancer par-dessus une silhouette visible : refusé, et la ligne est rentrée
  s = fishing.sessions.get(u.id);
  const t1 = s.castAt + (s.appear + 0.5) * 1000;
  assert.throws(() => rig({ kind: 'treasure' }, () => fishing.cast(u, t1)), /se méfient/);
  assert.ok(!fishing.sessions.has(u.id));
  assert.throws(() => fishing.cast(u, t1 + 1000), /se méfient/);
  // Ferrer trop tôt après l'avoir vue : 8 s aussi
  ({ s } = castFor(u, { kind: 'treasure' }, 0));
  assert.strictEqual(fishing.hook(u, s.id, (s.appear + 0.2) * 1000).wait, scare);
  // Ferrage réussi : aucune attente
  ({ s } = castFor(u, { kind: 'treasure' }, 0));
  fishing.hook(u, s.id, (s.sink + 0.1) * 1000);
  assert.strictEqual(fishing.stop(u, (s.sink + 2) * 1000).wait, 0);
});

test('[FISH-4] remontée rejouée par le serveur (appuis du joueur), poisson au Pêchédex (nouvelle espèce, record), ni golds ni XP', () => {
  const u = angler();
  const ch = u.character;
  // (le robot gagne presque toujours ; pour un test stable, on reprend les rares remontées où il n'obtient pas ce qu'on veut)
  const catchFish = (id, size, good = true, extra = 0.2) => {
    for (;;) {
      const { r: c, s } = castFor(u, { kind: 'fish', id, size });
      const h = fishing.hook(u, c.id, (s.sink + 0.1) * 1000);
      const p = play(h.reel, good);
      if (p.R.won !== good) { fishing.stop(u); continue; }
      return fishing.land(u, c.id, p.toggles, (s.sink + 0.1 + p.seconds + extra) * 1000);
    }
  };
  const gold = ch.gold;
  const xp = ch.xp;
  const r1 = catchFish('perche', 25);
  assert.deepStrictEqual([r1.caught, r1.kind, r1.id, r1.isNew, r1.record, r1.n, r1.best], [true, 'fish', 'perche', true, false, 1, 25]);
  assert.deepStrictEqual([ch.gold, ch.xp], [gold, xp], 'un poisson ne rapporte ni golds ni XP');
  const r2 = catchFish('perche', 31.5);
  assert.deepStrictEqual([r2.isNew, r2.record, r2.n, r2.best], [false, true, 2, 31.5]);
  const r3 = catchFish('perche', 20);
  assert.deepStrictEqual([r3.record, r3.best], [false, 31.5]);
  assert.strictEqual(ch.fishing.dex.perche.n, 3);
  // Le navigateur ne peut plus annoncer « réussi » : c'est le rejeu de ses appuis qui décide
  assert.deepStrictEqual(catchFish('gardon', 15, false), { escaped: true, reason: 'ligne', lost: 'commun' });
  assert.strictEqual(ch.fishing.dex.gardon, undefined);
  {
    let c;
    let s;
    for (;;) {
      ({ r: c, s } = castFor(u, { kind: 'fish', id: 'leviathan', size: 900 }));
      const h = fishing.hook(u, c.id, (s.sink + 0.1) * 1000);
      if (!Rules.fishReelReplay(h.reel, []).won) break;
      fishing.stop(u);
    }
    assert.deepStrictEqual(fishing.land(u, c.id, [], (s.sink + 200) * 1000), { escaped: true, reason: 'ligne', lost: 'legendaire' }, 'sans rien faire, un légendaire s\'échappe');
  }
  // Appuis envoyés avant d'avoir eu le temps de jouer : refusés (90 % du temps simulé)
  assert.throws(() => catchFish('gardon', 15, true, -3), /trop rapide/);
  // Appuis invalides
  for (const bad of ['x', [3, 1], [1.5], new Array(Rules.FISHING.maxToggles + 1).fill(1)]) {
    const { r: c, s } = castFor(u, { kind: 'fish', id: 'gardon', size: 15 });
    fishing.hook(u, c.id, (s.sink + 0.1) * 1000);
    assert.throws(() => fishing.land(u, c.id, bad, (s.sink + 30) * 1000), /Remontée invalide/);
  }
  // Légendaire bien joué
  assert.strictEqual(catchFish('leviathan', 900).caught, true);
  assert.deepStrictEqual([ch.counters.fishCaught, ch.counters.fishSpecies, ch.counters.fishLegend], [4, 2, 1]);
  assert.throws(() => fishing.land(u, 'x', []), /Lance d'abord/);
  // Ferrer avant de remonter
  const { r: c } = castFor(u, { kind: 'fish', id: 'gardon', size: 12 });
  assert.throws(() => fishing.land(u, c.id, [], 99999), /Ferre d'abord/);
  assert.strictEqual(fishing.stop(u, 0).stopped, true);
});

test('[FISH-5] trésors : coffres, golds, émeraudes, Clé de boss ou canne légendaire (une seule fois)', () => {
  assert.deepStrictEqual(Rules.FISHING.treasures.map((t) => [t.id, t.weight]), [['coffres', 70], ['golds', 10], ['emeraudes', 9], ['cle', 9], ['canne', 2]]);
  const haul = (u) => {
    const { r: c, s } = castFor(u, { kind: 'treasure' });
    const h = fishing.hook(u, c.id, (s.sink + 0.1) * 1000);
    const p = play(h.reel);
    return fishing.land(u, c.id, p.toggles, (s.sink + 1 + p.seconds) * 1000);
  };
  const u = angler();
  const ch = u.character;
  const seen = new Set();
  let rods = 0;
  let landed = 0;
  const before = { chests: ch.chests, gold: ch.gold, emeralds: ch.emeralds, keys: ch.bossKeys };
  let got = { chests: 0, gold: 0, emeralds: 0, keys: 0 };
  for (let i = 0; i < 400; i++) {
    const r = haul(u);
    if (!r.caught) continue;
    landed += 1;
    assert.strictEqual(r.kind, 'treasure');
    seen.add(r.lot.id);
    if (r.lot.cosmetic) rods += 1;
    got = { chests: got.chests + (r.lot.chests || 0), gold: got.gold + (r.lot.gold || 0), emeralds: got.emeralds + (r.lot.emeralds || 0), keys: got.keys + (r.lot.keys || 0) };
  }
  assert.ok(landed > 300, `le robot remonte presque tous les trésors (${landed})`);
  assert.deepStrictEqual([ch.chests - before.chests, ch.gold - before.gold, ch.emeralds - before.emeralds, ch.bossKeys - before.keys], [got.chests, got.gold, got.emeralds, got.keys]);
  assert.ok(['coffres', 'golds', 'emeraudes', 'cle'].every((id) => seen.has(id)));
  assert.ok(rods <= 1, 'la canne n\'est donnée qu\'une fois');
  assert.strictEqual(ch.counters.fishTreasures, landed);
  // Canne déjà possédée : coffre de golds à la place
  const real = Rules.FISHING.treasures.slice();
  const onlyRod = (extra = []) => Rules.FISHING.treasures.splice(0, Rules.FISHING.treasures.length, { id: 'canne', weight: 1, label: 'Canne', icon: '🎣', cosmetic: 'canne_legendaire' }, ...extra);
  const v = angler();
  v.character.owned.push('canne_legendaire');
  onlyRod(real.filter((t) => t.id === 'golds').map((t) => ({ ...t, weight: 0 })));
  try {
    let r;
    do r = haul(v); while (!r.caught);
    assert.deepStrictEqual([r.lot.id, r.lot.gold, r.lot.replaced], ['golds', 1000, true]);
  } finally { Rules.FISHING.treasures.splice(0, Rules.FISHING.treasures.length, ...real); }
  // Première canne : ajoutée aux articles possédés et comptée
  const w = angler();
  onlyRod();
  try {
    let r;
    do r = haul(w); while (!r.caught);
  } finally { Rules.FISHING.treasures.splice(0, Rules.FISHING.treasures.length, ...real); }
  assert.ok(w.character.owned.includes('canne_legendaire'));
  assert.strictEqual(w.character.counters.fishRod, 1);
  assert.strictEqual(Rules.cosmeticLocked(w.character, 'canne_legendaire'), false);
  assert.strictEqual(Rules.COSMETICS.canne_legendaire.cls, undefined, 'pour toutes les classes');
});

test('[FISH-6] panoplie du pêcheur après le Pêchédex complet ; succès de pêche', () => {
  const set = ['chapeau_pecheur', 'gilet_pecheur', 'salopette_pecheur', 'bottes_pecheur'];
  assert.deepStrictEqual(set.map((id) => Rules.COSMETICS[id].slot), ['hat', 'chest', 'pants', 'shoes']);
  const c = game.newCharacter();
  c.gold = 20000;
  assert.throws(() => game.buyCosmetic(c, 'gilet_pecheur'), /Exploit requis : Compléter le Pêchédex/);
  c.counters.fishSpecies = 100;
  game.buyCosmetic(c, 'gilet_pecheur');
  assert.strictEqual(c.gold, 20000 - 2500);
  assert.ok(c.owned.includes('gilet_pecheur'));
  const ach = Rules.ACHIEVEMENTS.filter((a) => /^fish|^species|^treasure/.test(a.id)).map((a) => [a.metric, a.goal]);
  assert.deepStrictEqual(ach, [['fishCaught', 1], ['fishCaught', 10], ['fishCaught', 100], ['fishCaught', 500], ['fishSpecies', 25], ['fishSpecies', 50], ['fishSpecies', 100], ['fishLegend', 1], ['fishTreasures', 1], ['fishTreasures', 10]]);
});

test('[FISH-7] migration : Pêchédex ajouté aux anciennes sauvegardes, fusion d\'un fantôme', () => {
  const old = game.newCharacter();
  delete old.fishing;
  game.upgrade(old);
  assert.deepStrictEqual(old.fishing, { dex: {} });
  // Fusion : prises additionnées, record et première date gardés, espèces recomptées
  const { db } = require('./helpers');
  const user = { id: 'fishmain', username: 'Main', role: 'player', character: game.newCharacter() };
  const ghost = { id: 'fishghost', username: 'fantome', ghost: true, role: 'player', twitchLogin: 'pecheurfantome', character: game.newCharacter() };
  db.state.users[user.id] = user;
  db.state.users[ghost.id] = ghost;
  user.character.fishing.dex = { perche: { n: 2, best: 30, first: 500 } };
  ghost.character.fishing.dex = { perche: { n: 1, best: 35, first: 100 }, gardon: { n: 4, best: 20, first: 300 } };
  game.linkTwitch(user, 'pecheurfantome', 'PecheurFantome');
  assert.deepStrictEqual(user.character.fishing.dex, { perche: { n: 3, best: 35, first: 100 }, gardon: { n: 4, best: 20, first: 300 } });
  assert.strictEqual(user.character.counters.fishSpecies, 2);
});
