/*
 * Pêche (onglet Pêche) : un mode actif et tranquille, sans mise. Le serveur décide de tout ce qui compte :
 *  - au lancer (`cast`) : ce qui va mordre (poisson 95 % — espèce selon la rareté et l'heure de Paris, taille —
 *    ou trésor 5 %), quand la forme apparaît, les touches et le moment où le bouchon coule ;
 *  - au ferrage (`hook`) : le clic doit tomber après que le bouchon a coulé, dans la fenêtre de la rareté ;
 *  - à la fin de la remontée (`land`) : une prise plus rapide que le minimum possible est refusée ; le poisson rejoint le
 *    Pêchédex (character.fishing.dex), le trésor est tiré avec crypto et crédité.
 * Le navigateur anime la scène et le mini-jeu de la barre (physique de la zone verte, nage du poisson).
 * Les parties en cours restent en mémoire (rien n'est misé : un redémarrage les oublie simplement).
 */
const crypto = require('crypto');
const Rules = require('../shared/rules');
const game = require('./game');

const F = Rules.FISHING;
const sessions = new Map(); // userId → partie en cours

const random = () => crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
const between = (a, b) => a + random() * (b - a);
const randInt = (min, max) => crypto.randomInt(min, max + 1);
function weighted(entries) {
  const total = entries.reduce((a, e) => a + e.weight, 0);
  let r = random() * total;
  for (const e of entries) { r -= e.weight; if (r < 0) return e; }
  return entries[entries.length - 1];
}
const round2 = (x) => Math.round(x * 100) / 100;

// Ce qui mord : un trésor (5 %) ou un poisson qui peut mordre à cette heure-là (rareté pondérée, puis espèce au hasard).
// La taille penche vers le bas de la fourchette (les grands spécimens sont plus rares).
function rollTarget(now) {
  if (random() < F.treasureChance) return { kind: 'treasure' };
  const pool = Rules.fishPool(Rules.fishTime(now));
  const rarities = Object.entries(F.rarities).filter(([r]) => pool[r] && pool[r].length).map(([r, R]) => ({ id: r, weight: R.weight }));
  const rarity = weighted(rarities).id;
  const ids = pool[rarity];
  const fish = Rules.FISH[ids[randInt(0, ids.length - 1)]];
  const size = Math.round((fish.min + (fish.max - fish.min) * random() ** 1.6) * 10) / 10;
  return { kind: 'fish', id: fish.id, size };
}

// Silhouette dans l'eau : la forme de la créature (ou un coffre) et une idée de sa taille.
function sizeClass(target) {
  if (target.kind === 'treasure') return 'moyen';
  return target.size < 20 ? 'petit' : target.size < 60 ? 'moyen' : target.size < 160 ? 'grand' : 'enorme';
}

function cast(user, now = Date.now()) {
  game.upgrade(user.character);
  const target = module.exports.rollTarget(now); // remplaçable dans les tests
  const diff = Rules.fishDifficulty(target);
  const appear = round2(between(F.wait[0], F.wait[1]));
  let t = appear + F.approach;
  const nibbles = [];
  for (let i = randInt(diff.nibbles[0], diff.nibbles[1]); i > 0; i--) {
    nibbles.push(round2(t));
    t += between(F.nibbleGap[0], F.nibbleGap[1]);
  }
  const sink = round2(t);
  const s = { id: crypto.randomBytes(6).toString('hex'), castAt: now, appear, nibbles, sink, window: diff.window, target, diff, hookedAt: null };
  sessions.set(user.id, s); // un nouveau lancer remplace le précédent
  return {
    id: s.id, appear, approach: F.approach, nibbles, sink, window: diff.window,
    shape: target.kind === 'treasure' ? 'tresor' : Rules.FISH[target.id].shape,
    big: sizeClass(target),
  };
}

function current(user, id) {
  const s = sessions.get(user.id);
  if (!s || (id && s.id !== id)) throw new Error('Lance d\'abord ta ligne');
  return s;
}

// Ferrer : seulement une fois le bouchon coulé, dans la fenêtre de la rareté (+ marge réseau). Trop tôt ou trop tard :
// la prise s'échappe.
function hook(user, id, now = Date.now()) {
  const s = current(user, id);
  if (s.hookedAt) throw new Error('Déjà ferré');
  const t = (now - s.castAt) / 1000;
  if (t < s.sink - 0.05) { sessions.delete(user.id); return { escaped: true, reason: 'tot' }; }
  if (t > s.sink + s.window + F.latency) { sessions.delete(user.id); return { escaped: true, reason: 'tard' }; }
  s.hookedAt = now;
  const d = s.diff;
  return { hooked: true, reel: { zone: d.zone, vmax: d.vmax, dart: d.dart, changes: d.changes, fill: d.fill, move: d.move, start: F.reelStart, drain: F.drainRatio } };
}

// Lot d'un trésor (la canne déjà possédée devient un coffre de golds).
function rollTreasure(c) {
  let lot = weighted(F.treasures);
  let replaced = false;
  if (lot.cosmetic && c.owned.includes(lot.cosmetic)) { lot = F.treasures.find((x) => x.id === 'golds'); replaced = true; }
  if (lot.chests) c.chests += lot.chests;
  if (lot.gold) { c.gold += lot.gold; game.addStat(c, 'goldEarned', lot.gold); }
  if (lot.emeralds) { c.emeralds += lot.emeralds; game.addStat(c, 'emeraldsEarned', lot.emeralds); }
  if (lot.keys) game.addKeys(c, lot.keys);
  if (lot.cosmetic) { c.owned.push(lot.cosmetic); game.bump(c, 'fishRod'); }
  game.bump(c, 'fishTreasures');
  return { id: lot.id, label: lot.label, icon: lot.icon, chests: lot.chests, gold: lot.gold, emeralds: lot.emeralds, keys: lot.keys, cosmetic: lot.cosmetic, replaced };
}

// Fin de la remontée : la jauge est pleine (success) ou le poisson s'est échappé.
function land(user, id, success, now = Date.now()) {
  const s = current(user, id);
  if (!s.hookedAt) throw new Error('Ferre d\'abord le poisson');
  sessions.delete(user.id);
  if (!success) return { escaped: true, reason: 'ligne' };
  const elapsed = (now - s.hookedAt) / 1000;
  if (elapsed < Rules.fishMinReel(s.diff) * F.minLandRatio) throw new Error('Remontée trop rapide');
  if (elapsed > F.maxReel) return { escaped: true, reason: 'ligne' };
  const c = user.character;
  game.upgrade(c);
  if (s.target.kind === 'treasure') return { caught: true, kind: 'treasure', lot: rollTreasure(c) };
  const fish = Rules.FISH[s.target.id];
  const dex = c.fishing.dex;
  const before = dex[fish.id];
  const entry = before ? { ...before } : { n: 0, best: 0, first: now };
  entry.n += 1;
  const record = !!before && s.target.size > (before.best || 0);
  entry.best = Math.max(entry.best || 0, s.target.size);
  dex[fish.id] = entry;
  game.bump(c, 'fishCaught');
  c.counters.fishSpecies = Object.keys(dex).length;
  if (fish.rarity === 'legendaire') game.bump(c, 'fishLegend');
  return { caught: true, kind: 'fish', id: fish.id, size: s.target.size, isNew: !before, record, n: entry.n, best: entry.best, species: c.counters.fishSpecies };
}

// Quitter l'onglet : la ligne est remontée (rien à rendre).
function stop(user) {
  sessions.delete(user.id);
  return { stopped: true };
}

module.exports = { cast, hook, land, stop, sessions, rollTarget };
