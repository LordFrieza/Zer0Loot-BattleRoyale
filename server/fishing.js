/*
 * Pêche (onglet Pêche) : un mode actif et tranquille, sans mise. Le serveur décide de tout ce qui compte, et le
 * navigateur n'apprend chaque chose qu'au moment où elle arrive :
 *  - au lancer (`cast`) : ce qui va mordre (poisson 95 % — espèce selon la rareté et l'heure de Paris, taille —
 *    ou trésor 5 %), quand la forme apparaît, les touches et le moment où le bouchon coule. Le lancer ne renvoie que
 *    son identifiant ; chaque étape (`appear` avec la silhouette, `nibble`, `sink`, `miss`) est envoyée en direct par
 *    le socket (événement `fishing`, via `setNotify`) ;
 *  - au ferrage (`hook`) : le clic doit tomber après que le bouchon a coulé, dans la fenêtre de la rareté ;
 *  - à la fin de la remontée (`land`) : le navigateur envoie ses appuis (numéros de pas) et le serveur rejoue la
 *    remontée avec la même physique et la même graine (`Rules.fishReelReplay`) : c'est ce rejeu qui décide de la prise.
 *    Le poisson rejoint le Pêchédex (character.fishing.dex), le trésor est tiré avec crypto et crédité.
 * Une prise vue puis laissée (ligne rentrée ou relancée, ferrage trop tôt ou raté) effraie les poissons : il faut
 * attendre `FISHING.scare` s avant de relancer (sinon on relancerait en boucle jusqu'à voir passer un trésor).
 * Les parties en cours restent en mémoire (rien n'est misé : un redémarrage les oublie simplement).
 */
const crypto = require('crypto');
const Rules = require('../shared/rules');
const game = require('./game');

const F = Rules.FISHING;
const sessions = new Map(); // userId → partie en cours
const calm = new Map(); // userId → instant (ms) à partir duquel on peut relancer

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

// Envoi des étapes en direct (branché par index.js sur la room socket du joueur). Sans lui (tests), rien n'est planifié.
let notify = null;
function setNotify(fn) { notify = fn; }

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

function clearTimers(s) {
  for (const t of s.timers || []) clearTimeout(t);
  s.timers = [];
}
// Fin d'une partie sans prise : si la silhouette était déjà visible, les poissons se méfient un moment.
function endSession(user, s, now) {
  clearTimers(s);
  if (sessions.get(user.id) === s) sessions.delete(user.id);
  if (!s.hookedAt && now >= s.castAt + s.appear * 1000) {
    calm.set(user.id, now + F.scare * 1000);
    return F.scare;
  }
  return 0;
}
// Étapes envoyées au navigateur au moment où elles arrivent ; la dernière (`miss`) clôt une touche non ferrée.
function schedule(user, s) {
  if (!notify) return;
  const at = (sec, fn) => {
    const t = module.exports.timer(fn, Math.max(0, s.castAt + sec * 1000 - Date.now()));
    if (t && t.unref) t.unref();
    s.timers.push(t);
  };
  const send = (ev) => () => { if (sessions.get(user.id) === s && !s.hookedAt) notify(user.id, { id: s.id, ...ev }); };
  at(s.appear, send({ k: 'appear', shape: s.shape, big: s.big }));
  for (const n of s.nibbles) at(n, send({ k: 'nibble' }));
  at(s.sink, send({ k: 'sink' }));
  at(s.sink + s.window + F.latency, () => {
    if (sessions.get(user.id) !== s || s.hookedAt) return;
    const wait = endSession(user, s, s.castAt + (s.sink + s.window + F.latency) * 1000); // instant prévu de la fin de la touche
    notify(user.id, { id: s.id, k: 'miss', wait });
  });
}

function cast(user, now = Date.now()) {
  const until = calm.get(user.id) || 0;
  if (now < until) throw new Error(`Les poissons se méfient encore… relance dans ${Math.ceil((until - now) / 1000)} s`);
  const prev = sessions.get(user.id);
  if (prev) {
    // Un nouveau lancer remplace le précédent : laisser filer une prise déjà vue effraie les poissons
    if (endSession(user, prev, now)) throw new Error(`Les poissons se méfient encore… relance dans ${F.scare} s`);
  }
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
  const s = {
    id: crypto.randomBytes(6).toString('hex'), castAt: now, appear, nibbles, sink, window: diff.window, target, diff, hookedAt: null, timers: [],
    shape: target.kind === 'treasure' ? 'tresor' : Rules.FISH[target.id].shape, big: sizeClass(target),
  };
  sessions.set(user.id, s);
  schedule(user, s);
  // Rien de ce qui va se passer n'est révélé : ni les temps, ni la fenêtre (qui trahirait la rareté), ni la silhouette
  return { id: s.id, approach: F.approach };
}

function current(user, id) {
  const s = sessions.get(user.id);
  if (!s || (id && s.id !== id)) throw new Error('Lance d\'abord ta ligne');
  return s;
}

// Ferrer : seulement une fois le bouchon coulé, dans la fenêtre de la rareté (+ marge réseau). Trop tôt ou trop tard :
// la prise s'échappe. La remontée reçoit une graine neuve (nage du poisson) que le serveur garde pour la rejouer.
function hook(user, id, now = Date.now()) {
  const s = current(user, id);
  if (s.hookedAt) throw new Error('Déjà ferré');
  const t = (now - s.castAt) / 1000;
  if (t < s.sink - 0.05) return { escaped: true, reason: 'tot', wait: endSession(user, s, now) };
  if (t > s.sink + s.window + F.latency) return { escaped: true, reason: 'tard', wait: endSession(user, s, now) };
  clearTimers(s);
  s.hookedAt = now;
  const d = s.diff;
  s.reel = { zone: d.zone, vmax: d.vmax, dart: d.dart, changes: d.changes, fill: d.fill, move: d.move, start: F.reelStart, drain: F.drainRatio, seed: crypto.randomInt(0, 2 ** 31) };
  return { hooked: true, reel: { ...s.reel } };
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

// Appuis d'une remontée : numéros de pas entiers, croissants, en nombre limité.
function checkToggles(toggles) {
  if (!Array.isArray(toggles) || toggles.length > F.maxToggles) throw new Error('Remontée invalide');
  let last = -1;
  for (const x of toggles) {
    if (!Number.isInteger(x) || x < last || x < 0) throw new Error('Remontée invalide');
    last = x;
  }
  return toggles;
}

// Fin de la remontée : le serveur rejoue les appuis du joueur et décide. Une remontée qui aurait duré plus longtemps
// que le temps réellement écoulé depuis le ferrage est refusée (appuis calculés d'avance puis envoyés trop tôt).
function land(user, id, toggles, now = Date.now()) {
  const s = current(user, id);
  if (!s.hookedAt) throw new Error('Ferre d\'abord le poisson');
  checkToggles(toggles);
  sessions.delete(user.id);
  const R = Rules.fishReelReplay(s.reel, toggles);
  const simulated = R.step * F.reelDt;
  const elapsed = (now - s.hookedAt) / 1000;
  if (elapsed < simulated * F.realTimeRatio - 0.25) throw new Error('Remontée trop rapide');
  if (!R.won) return { escaped: true, reason: 'ligne' };
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

// Quitter l'onglet ou rentrer la ligne. Si la silhouette était déjà visible, les poissons se méfient (`wait` s).
function stop(user, now = Date.now()) {
  const s = sessions.get(user.id);
  const wait = s ? endSession(user, s, now) : 0;
  return { stopped: true, wait };
}

module.exports = { cast, hook, land, stop, sessions, calm, rollTarget, setNotify, timer: (fn, ms) => setTimeout(fn, ms) };
