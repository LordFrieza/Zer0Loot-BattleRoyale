/*
 * Étang partagé de la Pêche : on voit les autres joueurs qui pêchent en même temps que soi, chacun dans sa barque.
 *  - Un étang a `FISHING.pond.spots` places (8) : un joueur qui ouvre l'onglet Pêche (socket `fish:join`) prend la première
 *    place libre du premier étang qui en a une ; tous pleins, un nouvel étang s'ouvre. Il la quitte en fermant l'onglet
 *    (`fish:leave`) ou en se déconnectant (plusieurs onglets ouverts : il reste tant qu'il en reste un). Un étang vide
 *    disparaît.
 *  - Chaque pêcheur a une description publique (pseudo, classe, apparence, familier principal, canne) et un état
 *    (`idle` : ligne rentrée, `wait` : ligne à l'eau, `reel` : remontée en cours) mis à jour par les routes de la pêche.
 *  - Les changements partent à la room socket `pond:<id>` : la liste complète (`pond`) à chaque arrivée ou départ, et les
 *    actions (`pondAct` : lancer, remontée, prise, poisson perdu, réaction) au moment où elles arrivent.
 *  - Banc de poissons (FISHING.school) : à partir de 2 pêcheurs sur l'étang, un banc passe de temps en temps pendant 60 s ;
 *    les prises rares mordent plus souvent pour tous ceux qui lancent leur ligne pendant ce temps (`schoolOf()` lu par
 *    fishing.js au lancer).
 * Tout est en mémoire (rien n'est misé : un redémarrage vide simplement les étangs, les pages se réinscrivent).
 */
const crypto = require('crypto');
const Rules = require('../shared/rules');

const P = Rules.FISHING.pond;
const SC = Rules.FISHING.school;
const ponds = new Map(); // id → { id, members: Map(userId → membre), school: { at, until } | null, nextSchool }
const where = new Map(); // userId → { pond, sockets: Set }
const lastReact = new Map(); // userId → instant (ms) de sa dernière réaction
let nextId = 1;

// Branchements d'index.js : `emit(pondId, event, data)` vers la room socket, `describe(user)` → apparence publique.
let emit = () => {};
let describe = (user) => ({ name: user.twitchDisplayName || user.username });
function init(o = {}) {
  if (o.emit) emit = o.emit;
  if (o.describe) describe = o.describe;
}

const between = (a, b) => a + (crypto.randomInt(0, 1e6) / 1e6) * (b - a);

function publicMember(m) {
  return { uid: m.uid, spot: m.spot, since: m.since, state: m.state, stateAt: m.stateAt, ...m.info };
}
// Vue publique d'un étang : ses pêcheurs (place, état, apparence) et le banc de poissons en cours.
function view(id, now = Date.now()) {
  const p = ponds.get(id);
  if (!p) return null;
  return {
    id: p.id,
    now, // heure du serveur : le navigateur en déduit le temps restant du banc de poissons
    spots: P.spots,
    ponds: ponds.size,
    total: where.size,
    members: [...p.members.values()].map(publicMember).sort((a, b) => a.spot - b.spot),
    school: p.school && p.school.until > now ? { ...p.school } : null,
  };
}
function broadcast(id, now) {
  const v = view(id, now);
  if (v) emit(id, 'pond', v);
}

function freeSpot(p) {
  for (let i = 0; i < P.spots; i++) if (![...p.members.values()].some((m) => m.spot === i)) return i;
  return -1;
}

// Un onglet Pêche s'ouvre. Renvoie l'étang du joueur et s'il vient d'arriver (sinon : un onglet de plus).
function join(user, socketId, now = Date.now()) {
  if (!user || user.role !== 'player' || !user.character) throw new Error('Réservé aux joueurs');
  const at = where.get(user.id);
  if (at) {
    at.sockets.add(socketId);
    const m = ponds.get(at.pond).members.get(user.id);
    m.info = describe(user); // apparence à jour (changée depuis un autre onglet)
    return { pond: at.pond, arrived: false };
  }
  let p = [...ponds.values()].sort((a, b) => a.id - b.id).find((x) => x.members.size < P.spots);
  if (!p) {
    p = { id: nextId++, members: new Map(), school: null, nextSchool: 0 };
    ponds.set(p.id, p);
  }
  const m = { uid: user.id, spot: freeSpot(p), since: now, state: 'idle', stateAt: now, info: describe(user) };
  p.members.set(user.id, m);
  where.set(user.id, { pond: p.id, sockets: new Set([socketId]) });
  planSchool(p, now);
  broadcast(p.id, now);
  return { pond: p.id, arrived: true };
}

// Un onglet se ferme (ou la connexion tombe) ; sans `socketId`, le joueur quitte l'étang quoi qu'il arrive.
function leave(userId, socketId, now = Date.now()) {
  const at = where.get(userId);
  if (!at) return { left: false };
  if (socketId != null) {
    at.sockets.delete(socketId);
    if (at.sockets.size) return { left: false, pond: at.pond };
  }
  where.delete(userId);
  const p = ponds.get(at.pond);
  p.members.delete(userId);
  if (!p.members.size) ponds.delete(p.id);
  else { planSchool(p, now); broadcast(p.id, now); }
  return { left: true, pond: at.pond };
}

const pondOf = (userId) => (where.get(userId) || {}).pond || null;
const memberOf = (userId) => {
  const id = pondOf(userId);
  return id ? ponds.get(id).members.get(userId) : null;
};

// Action d'un pêcheur (lancer, remontée, prise…) : son état change et l'étang la voit en direct.
// k : 'cast' → wait, 'reel' → reel, 'catch' / 'escape' / 'miss' / 'stop' → idle.
const STATE_OF = { cast: 'wait', reel: 'reel', catch: 'idle', escape: 'idle', miss: 'idle', stop: 'idle' };
function act(userId, k, data = {}, now = Date.now()) {
  const m = memberOf(userId);
  if (!m) return null;
  if (STATE_OF[k]) { m.state = STATE_OF[k]; m.stateAt = now; }
  const ev = { uid: userId, k, at: now, ...data };
  emit(pondOf(userId), 'pondAct', ev);
  return ev;
}

// Réaction rapide (émoji de la liste FISHING.pond.reactions), une toutes les 1,5 s au plus.
function react(userId, e, now = Date.now()) {
  if (!memberOf(userId)) throw new Error('Tu ne pêches pas en ce moment');
  if (!P.reactions.includes(e)) throw new Error('Réaction inconnue');
  if (now - (lastReact.get(userId) || 0) < P.reactCooldown * 1000) throw new Error('Doucement…');
  lastReact.set(userId, now);
  return act(userId, 'react', { e }, now);
}

// ---------- Banc de poissons ----------
// Prévu tant qu'il y a au moins 2 pêcheurs sur l'étang (oublié en dessous) ; `tick()` le fait passer à l'heure dite.
function planSchool(p, now) {
  if (p.members.size < SC.minFishers) { p.nextSchool = 0; return; }
  if (!p.nextSchool) p.nextSchool = now + between(SC.every[0], SC.every[1]) * 1000;
}
function startSchool(p, now) {
  p.school = { at: now, until: now + SC.duration * 1000, x: between(0.3, 0.8) };
  p.nextSchool = now + SC.duration * 1000 + between(SC.every[0], SC.every[1]) * 1000;
  broadcast(p.id, now);
  return p.school;
}
// Appelé régulièrement (index.js) : renvoie les étangs où un banc vient d'arriver (pour l'annoncer dans le salon Pêche).
function tick(now = Date.now()) {
  const started = [];
  for (const p of ponds.values()) {
    if (p.school && p.school.until <= now) { p.school = null; broadcast(p.id, now); }
    planSchool(p, now);
    if (p.nextSchool && now >= p.nextSchool && p.members.size >= SC.minFishers && !p.school) started.push({ pond: p.id, school: startSchool(p, now), fishers: p.members.size });
  }
  return started;
}
// Banc en cours sur l'étang du joueur (au moment de son lancer) ?
function schoolOf(userId, now = Date.now()) {
  const id = pondOf(userId);
  const p = id && ponds.get(id);
  return !!(p && p.school && p.school.at <= now && p.school.until > now);
}

function reset() {
  ponds.clear();
  where.clear();
  lastReact.clear();
  nextId = 1;
}

module.exports = { init, join, leave, act, react, tick, view, pondOf, memberOf, schoolOf, describe: (user) => describe(user), startSchool: (id, now = Date.now()) => startSchool(ponds.get(id), now), ponds, reset };
