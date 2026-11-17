/*
 * Maison : meubles achetés en émeraudes et posés dans la pièce (disposition vérifiée par Rules.houseLayoutError),
 * options de façade et d'intérieur, agrandissement, boîte aux lettres (courrier selon le niveau de décoration),
 * visites et « J'aime » entre joueurs. Tout est sur le personnage (`character.house`).
 */
const crypto = require('crypto');
const Rules = require('../shared/rules');
const db = require('./db');
const game = require('./game');

const random = () => crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;

function houseOf(c) {
  game.upgrade(c);
  return c.house;
}

function levelOf(c) {
  return Rules.houseLevel(Rules.houseDeco(houseOf(c)));
}

// Le record de niveau de décoration (succès) suit le niveau atteint.
function trackLevel(c) {
  const L = levelOf(c);
  c.counters.decoLevel = Math.max(c.counters.decoLevel || 0, L.level);
  return L;
}

function buyFurniture(c, id, count = 1) {
  const H = houseOf(c);
  const F = Rules.FURNITURE[id];
  if (!F) throw new Error('Meuble inconnu');
  const n = Math.max(1, Math.min(10, Math.floor(Number(count)) || 1));
  const cost = F.price * n;
  if (c.emeralds < cost) throw new Error(`Il te faut ${cost.toLocaleString('fr-FR')} émeraudes`);
  c.emeralds -= cost;
  H.owned[id] = (H.owned[id] || 0) + n;
  return { id, count: n, cost };
}

// Enregistre toute la disposition des meubles (éditeur du navigateur).
function saveLayout(c, placed) {
  const H = houseOf(c);
  if (!Array.isArray(placed) || placed.length > 400) throw new Error('Disposition invalide');
  const clean = placed.map((p) => ({ id: String(p && p.id), x: Number(p && p.x), y: Number(p && p.y), flip: !!(p && p.flip) }));
  const err = Rules.houseLayoutError(H, clean);
  if (err) throw new Error(err);
  H.placed = clean;
  return { placed: clean, level: trackLevel(c) };
}

// Option de façade / d'intérieur : achetée une fois, puis gratuite à remettre.
function setStyle(c, part, id) {
  const H = houseOf(c);
  const P = Rules.HOUSE_PARTS[part];
  if (!P || !P.options[id]) throw new Error('Option inconnue');
  const key = `${part}:${id}`;
  const o = P.options[id];
  let cost = 0;
  if (o.price > 0 && !H.opts.includes(key)) {
    if (c.emeralds < o.price) throw new Error(`Il te faut ${o.price.toLocaleString('fr-FR')} émeraudes`);
    c.emeralds -= o.price;
    H.opts.push(key);
    cost = o.price;
  }
  H.style[part] = id;
  return { part, id, cost, level: trackLevel(c) };
}

// Agrandissement : studio → maison → manoir (les meubles restent posés, la pièce grandit vers la droite et le bas).
function upgradeSize(c) {
  const H = houseOf(c);
  const order = Rules.HOUSING.sizeOrder;
  const next = order[order.indexOf(H.size) + 1];
  if (!next) throw new Error('Ta maison est déjà un manoir');
  const price = Rules.HOUSING.sizes[next].price;
  if (c.emeralds < price) throw new Error(`Il te faut ${price.toLocaleString('fr-FR')} émeraudes`);
  c.emeralds -= price;
  H.size = next;
  return { size: next, cost: price, level: trackLevel(c) };
}

// Boîte aux lettres : récupère les courriers arrivés (un toutes les 6 h, 4 au plus).
function collectMail(c, now = Date.now()) {
  const H = houseOf(c);
  const due = Rules.houseMailDue(H.mailAt, now);
  if (!due) throw new Error('Ta boîte aux lettres est vide pour l\'instant');
  const L = levelOf(c);
  const M = Rules.houseMailContent(L.level);
  const got = { gold: 0, chests: 0, keys: 0, emeralds: 0, potions: [] };
  for (let i = 0; i < due; i++) {
    got.gold += M.gold;
    got.emeralds += M.emeralds;
    got.chests += Math.floor(M.chests) + (random() < M.chests % 1 ? 1 : 0);
    if (random() < M.keyChance) got.keys += 1;
    if (random() < M.potionChance) {
      const ids = Object.keys(Rules.CONSUMABLES);
      const p = ids[crypto.randomInt(0, ids.length)];
      c.consumables[p] = Math.min(Rules.CONSUMABLE_STACK_MAX, (c.consumables[p] || 0) + 1);
      got.potions.push(p);
    }
  }
  c.gold += got.gold;
  game.addStat(c, 'goldEarned', got.gold);
  c.chests += got.chests;
  if (got.keys) game.addKeys(c, got.keys);
  c.emeralds += got.emeralds;
  // Le temps entamé vers le courrier suivant est conservé (au-delà de 4 courriers en attente, il est perdu)
  const period = Rules.HOUSING.mailbox.everyH * 3600 * 1000;
  H.mailAt = Math.max(H.mailAt + due * period, now - period + 1);
  return { letters: due, ...got, level: L.level };
}

// « J'aime » sur la maison d'un autre joueur (une fois ; un second clic le retire).
function toggleLike(user, ownerId) {
  const owner = db.state.users[ownerId];
  if (!owner || !owner.character || owner.banned) throw new Error('Maison introuvable');
  if (owner.id === user.id) throw new Error('Tu ne peux pas aimer ta propre maison');
  const H = houseOf(owner.character);
  const i = H.likes.indexOf(user.id);
  if (i >= 0) H.likes.splice(i, 1); else H.likes.push(user.id);
  return { liked: i < 0, likes: H.likes.length };
}

function ownerName(u) {
  return u.twitchDisplayName || u.username;
}

// Vue publique d'une maison (visite) : disposition, style, niveau, apparence du propriétaire.
function publicHouse(owner, viewer, appOf, lookOf) {
  const c = owner.character;
  const H = houseOf(c);
  return {
    id: owner.id,
    name: ownerName(owner),
    cls: c.cls || null,
    app: appOf(owner),
    look: lookOf(owner),
    size: H.size,
    placed: H.placed,
    style: H.style,
    level: levelOf(c),
    likes: H.likes.length,
    liked: viewer ? H.likes.includes(viewer.id) : false,
    visits: H.visits,
    mine: viewer ? viewer.id === owner.id : false,
  };
}

function visit(owner, viewer) {
  const H = houseOf(owner.character);
  if (!viewer || viewer.id !== owner.id) H.visits += 1;
}

// Liste des maisons à visiter : les plus décorées (puis les plus aimées), ou par nom.
// appOf / lookOf (facultatifs) : apparence des propriétaires, pour les passants devant la maison.
function listHouses(query, appOf, lookOf) {
  const q = String(query || '').trim().toLowerCase();
  return Object.values(db.state.users)
    .filter((u) => u.character && u.role === 'player' && !u.banned && !u.ghost && (!q || ownerName(u).toLowerCase().includes(q)))
    .map((u) => {
      const H = houseOf(u.character);
      const L = levelOf(u.character);
      const out = { id: u.id, name: ownerName(u), level: L.level, points: L.points, likes: H.likes.length, size: H.size, furniture: H.placed.length, cls: u.character.cls || null };
      if (appOf) out.app = appOf(u);
      if (lookOf) out.look = lookOf(u);
      return out;
    })
    .sort((a, b) => b.points - a.points || b.likes - a.likes)
    .slice(0, Rules.HOUSING.listMax);
}

module.exports = { buyFurniture, saveLayout, setStyle, upgradeSize, collectMail, toggleLike, publicHouse, visit, listHouses, levelOf, trackLevel };
