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

test('[FISH-2] lancer : poisson (95 %) ou trésor (5 %), selon l\'heure ; temps des touches ; seuls les temps et la silhouette sont envoyés', () => {
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
  const r = rig({ kind: 'fish', id: 'perche', size: 30 }, () => fishing.cast(u, 1000));
  assert.ok(r.appear >= 3 && r.appear <= 15);
  assert.ok(r.nibbles.every((x) => x >= r.appear + Rules.FISHING.approach));
  assert.ok(r.sink >= r.appear + Rules.FISHING.approach);
  assert.strictEqual(r.window, Rules.FISHING.rarities.commun.window);
  assert.deepStrictEqual([r.shape, r.big], ['poisson', 'moyen']);
  assert.strictEqual(r.id.length, 12);
  assert.ok(!('target' in r) && !JSON.stringify(r).includes('perche'), 'l\'espèce reste secrète');
});

test('[FISH-3] ferrer : seulement quand le bouchon coule, dans la fenêtre de la rareté', () => {
  const u = angler();
  // Trop tôt
  let c = rig({ kind: 'fish', id: 'gardon', size: 12 }, () => fishing.cast(u, 0));
  assert.deepStrictEqual(fishing.hook(u, c.id, (c.sink - 0.5) * 1000), { escaped: true, reason: 'tot' });
  assert.throws(() => fishing.hook(u, c.id, c.sink * 1000), /Lance d'abord/);
  // Trop tard
  c = rig({ kind: 'fish', id: 'kraken', size: 700 }, () => fishing.cast(u, 0));
  assert.strictEqual(c.window, 0.5);
  assert.strictEqual(fishing.hook(u, c.id, (c.sink + 0.5 + 0.35 + 0.1) * 1000).reason, 'tard');
  // Dans la fenêtre : paramètres de la remontée
  c = rig({ kind: 'fish', id: 'kraken', size: 700 }, () => fishing.cast(u, 0));
  const h = fishing.hook(u, c.id, (c.sink + 0.2) * 1000);
  assert.strictEqual(h.hooked, true);
  assert.deepStrictEqual(h.reel, { zone: 0.2, vmax: 0.68, dart: 1.18, changes: 2.2, fill: 9, move: 'mixte', start: 0.3, drain: 0.85 });
  assert.ok(Object.values(Rules.FISHING.rarities).every((r) => r.dart < 1.6), 'un départ soudain reste plus lent que la zone verte (toujours rattrapable)');
  assert.throws(() => fishing.hook(u, c.id, (c.sink + 0.3) * 1000), /Déjà ferré/);
  // Trésor : comme un objet lourd
  c = rig({ kind: 'treasure' }, () => fishing.cast(u, 0));
  assert.strictEqual(c.shape, 'tresor');
  assert.strictEqual(fishing.hook(u, c.id, (c.sink + 0.1) * 1000).reel.move, 'coulant');
});

test('[FISH-4] remontée : durée minimale vérifiée, poisson au Pêchédex (nouvelle espèce, record), ni golds ni XP', () => {
  const u = angler();
  const ch = u.character;
  const catchFish = (id, size, reelSeconds = 20, success = true) => {
    const c = rig({ kind: 'fish', id, size }, () => fishing.cast(u, 0));
    fishing.hook(u, c.id, (c.sink + 0.1) * 1000);
    return fishing.land(u, c.id, success, (c.sink + 0.1 + reelSeconds) * 1000);
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
  // Trop rapide : refusé (commun : 3,5 × 0,7 × 0,85 ≈ 2,1 s)
  assert.strictEqual(Rules.fishMinReel(Rules.FISHING.rarities.commun), 3.5 * 0.7);
  assert.throws(() => catchFish('gardon', 15, 1.5), /trop rapide/);
  // Échec : il s'échappe, rien n'est ajouté
  assert.deepStrictEqual(catchFish('gardon', 15, 10, false), { escaped: true, reason: 'ligne' });
  assert.strictEqual(ch.fishing.dex.gardon, undefined);
  // Légendaire
  catchFish('leviathan', 900, 30);
  assert.deepStrictEqual([ch.counters.fishCaught, ch.counters.fishSpecies, ch.counters.fishLegend], [4, 2, 1]);
  assert.throws(() => fishing.land(u, 'x', true), /Lance d'abord/);
  // Ferrer avant de remonter
  const c = rig({ kind: 'fish', id: 'gardon', size: 12 }, () => fishing.cast(u, 0));
  assert.throws(() => fishing.land(u, c.id, true, 99999), /Ferre d'abord/);
  assert.deepStrictEqual(fishing.stop(u), { stopped: true });
});

test('[FISH-5] trésors : coffres, golds, émeraudes, Clé de boss ou canne légendaire (une seule fois)', () => {
  assert.deepStrictEqual(Rules.FISHING.treasures.map((t) => [t.id, t.weight]), [['coffres', 70], ['golds', 10], ['emeraudes', 9], ['cle', 9], ['canne', 2]]);
  const u = angler();
  const ch = u.character;
  const seen = new Set();
  let rods = 0;
  const before = { chests: ch.chests, gold: ch.gold, emeralds: ch.emeralds, keys: ch.bossKeys };
  let got = { chests: 0, gold: 0, emeralds: 0, keys: 0 };
  for (let i = 0; i < 400; i++) {
    const c = rig({ kind: 'treasure' }, () => fishing.cast(u, 0));
    fishing.hook(u, c.id, (c.sink + 0.1) * 1000);
    const r = fishing.land(u, c.id, true, (c.sink + 10) * 1000);
    assert.strictEqual(r.kind, 'treasure');
    seen.add(r.lot.id);
    if (r.lot.cosmetic) rods += 1;
    got = { chests: got.chests + (r.lot.chests || 0), gold: got.gold + (r.lot.gold || 0), emeralds: got.emeralds + (r.lot.emeralds || 0), keys: got.keys + (r.lot.keys || 0) };
  }
  assert.deepStrictEqual([ch.chests - before.chests, ch.gold - before.gold, ch.emeralds - before.emeralds, ch.bossKeys - before.keys], [got.chests, got.gold, got.emeralds, got.keys]);
  assert.ok(['coffres', 'golds', 'emeraudes', 'cle'].every((id) => seen.has(id)));
  assert.ok(rods <= 1, 'la canne n\'est donnée qu\'une fois');
  assert.strictEqual(ch.counters.fishTreasures, 400);
  // Canne déjà possédée : coffre de golds à la place
  const v = angler();
  v.character.owned.push('canne_legendaire');
  const real = Rules.FISHING.treasures.slice();
  Rules.FISHING.treasures.splice(0, Rules.FISHING.treasures.length, { id: 'canne', weight: 1, label: 'Canne', icon: '🎣', cosmetic: 'canne_legendaire' }, ...real.filter((t) => t.id === 'golds').map((t) => ({ ...t, weight: 0 })));
  try {
    const c = rig({ kind: 'treasure' }, () => fishing.cast(v, 0));
    fishing.hook(v, c.id, (c.sink + 0.1) * 1000);
    const r = fishing.land(v, c.id, true, (c.sink + 10) * 1000);
    assert.deepStrictEqual([r.lot.id, r.lot.gold, r.lot.replaced], ['golds', 1000, true]);
  } finally { Rules.FISHING.treasures.splice(0, Rules.FISHING.treasures.length, ...real); }
  // Première canne : ajoutée aux articles possédés et comptée
  const w = angler();
  Rules.FISHING.treasures.splice(0, Rules.FISHING.treasures.length, { id: 'canne', weight: 1, label: 'Canne', icon: '🎣', cosmetic: 'canne_legendaire' });
  try {
    const c = rig({ kind: 'treasure' }, () => fishing.cast(w, 0));
    fishing.hook(w, c.id, (c.sink + 0.1) * 1000);
    fishing.land(w, c.id, true, (c.sink + 10) * 1000);
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
