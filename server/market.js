/*
 * Marché entre joueurs : ordres de vente d'objets, achats, courrier et historique.
 *  - Un joueur met en vente un objet de son coffre personnel (pas équipé, pas protégé par un preset) : l'objet quitte
 *    son coffre et il paie la taxe (Rules.marketTax), jamais remboursée. 5 ordres au plus en même temps.
 *  - Un ordre dure Rules.MARKET.durationMs (96 h) ; à l'expiration, l'objet revient au vendeur (avec un courrier).
 *  - L'acheteur paie le prix (pas de taxe) ; le vendeur reçoit tout de suite la somme, même hors ligne, et un courrier.
 *  - Le vendeur peut retirer son ordre (objet rendu, taxe perdue).
 * Tout est dans db.state.market ; le courrier (`mail`) et l'historique (`marketLog`) sont sur chaque personnage.
 */
const crypto = require('crypto');
const db = require('./db');
const game = require('./game');
const Rules = require('../shared/rules');

const M = Rules.MARKET;

function state() {
  if (!db.state.market) db.state.market = { orders: [] };
  return db.state.market;
}

function nameOf(user) {
  return user ? user.twitchDisplayName || user.username : '???';
}

function push(list, entry, max) {
  list.unshift(entry);
  if (list.length > max) list.length = max;
}

// Courrier (en haut de l'écran) et historique (onglet Marché).
function mail(user, text, extra = {}) {
  game.upgrade(user.character);
  push(user.character.mail, { id: crypto.randomUUID(), at: extra.at || Date.now(), text, read: false, ...extra }, M.mailMax);
}
function log(user, entry) {
  game.upgrade(user.character);
  push(user.character.marketLog, entry, M.historyMax);
}

const itemLabel = (item) => `${item.name} (${Rules.RARITY_INFO[item.rarity].label})`;

/*
 * Ordres expirés : l'objet revient au vendeur. Appelé avant chaque lecture ou action (et régulièrement par index.js).
 * Retourne la liste des utilisateurs touchés (pour les prévenir en direct).
 */
function sweep(now = Date.now()) {
  const st = state();
  const touched = [];
  st.orders = st.orders.filter((o) => {
    if (o.expiresAt > now) return true;
    const seller = db.state.users[o.sellerId];
    if (seller && seller.character) {
      game.upgrade(seller.character);
      seller.character.inventory.push(o.item);
      log(seller, { at: now, kind: 'expired', item: itemLabel(o.item), rarity: o.item.rarity, price: o.price });
      mail(seller, `⌛ Ta vente de « ${itemLabel(o.item)} » a expiré sans acheteur : l'objet est revenu dans ton coffre.`, { at: now, kind: 'expired' });
      touched.push(seller);
    }
    return false;
  });
  if (touched.length) db.save();
  return touched;
}

// Ordres visibles (vendeurs non bannis), du plus récent au plus ancien.
function list(now = Date.now()) {
  sweep(now);
  return state().orders
    .filter((o) => { const u = db.state.users[o.sellerId]; return u && !u.banned; })
    .map((o) => ({ id: o.id, item: o.item, price: o.price, sellerId: o.sellerId, seller: nameOf(db.state.users[o.sellerId]), createdAt: o.createdAt, expiresAt: o.expiresAt }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function ordersOf(userId) {
  return state().orders.filter((o) => o.sellerId === userId);
}

function sell(user, itemId, price, now = Date.now()) {
  sweep(now);
  const c = user.character;
  game.upgrade(c);
  price = Number(price);
  if (!Number.isInteger(price) || price < M.minPrice || price > M.maxPrice) {
    throw new Error(`Le prix doit être un nombre entier entre ${M.minPrice} et ${M.maxPrice.toLocaleString('fr-FR')} golds`);
  }
  if (ordersOf(user.id).length >= M.maxOrders) throw new Error(`Tu as déjà ${M.maxOrders} objets en vente : attends une vente ou retire un ordre`);
  const item = c.inventory.find((i) => i.id === itemId);
  if (!item) throw new Error('Objet introuvable dans ton coffre personnel (retire-le d\'abord s\'il est équipé)');
  if (game.protectedIds(c).has(item.id)) throw new Error('Un objet protégé (verrouillé ou dans un preset) ne peut pas être vendu');
  const tax = Rules.marketTax(price);
  if (c.gold < tax) throw new Error(`Mettre en vente à ce prix coûte ${tax} golds de taxe`);
  c.gold -= tax;
  c.inventory = c.inventory.filter((i) => i.id !== item.id);
  delete item.isNew;
  const order = { id: crypto.randomUUID(), sellerId: user.id, item, price, createdAt: now, expiresAt: now + M.durationMs };
  state().orders.push(order);
  log(user, { at: now, kind: 'listed', item: itemLabel(item), rarity: item.rarity, price, tax });
  return { order, tax };
}

function buy(user, orderId, now = Date.now()) {
  sweep(now);
  const st = state();
  const order = st.orders.find((o) => o.id === orderId);
  if (!order) throw new Error('Cet objet n\'est plus en vente');
  if (order.sellerId === user.id) throw new Error('Tu ne peux pas acheter ton propre objet (retire plutôt ton ordre)');
  const seller = db.state.users[order.sellerId];
  if (!seller || seller.banned || !seller.character) throw new Error('Cet objet n\'est plus en vente');
  const c = user.character;
  game.upgrade(c);
  if (c.gold < order.price) throw new Error(`Il te faut ${order.price} golds`);
  c.gold -= order.price;
  c.inventory.push(order.item);
  st.orders = st.orders.filter((o) => o !== order);
  game.upgrade(seller.character);
  seller.character.gold += order.price;
  game.bump(seller.character, 'sold');
  game.bump(c, 'bought');
  const label = itemLabel(order.item);
  log(user, { at: now, kind: 'bought', item: label, rarity: order.item.rarity, price: order.price, other: nameOf(seller) });
  log(seller, { at: now, kind: 'sold', item: label, rarity: order.item.rarity, price: order.price, other: nameOf(user) });
  mail(seller, `💰 ${nameOf(user)} a acheté ton objet « ${label} » pour ${order.price} golds !`, { at: now, kind: 'sold', gold: order.price });
  return { item: order.item, price: order.price, seller };
}

function cancel(user, orderId, now = Date.now()) {
  sweep(now);
  const st = state();
  const order = st.orders.find((o) => o.id === orderId && o.sellerId === user.id);
  if (!order) throw new Error('Ordre introuvable');
  st.orders = st.orders.filter((o) => o !== order);
  game.upgrade(user.character);
  user.character.inventory.push(order.item);
  log(user, { at: now, kind: 'cancelled', item: itemLabel(order.item), rarity: order.item.rarity, price: order.price });
  return { item: order.item };
}

function readMail(user) {
  game.upgrade(user.character);
  for (const m of user.character.mail) m.read = true;
}

module.exports = { state, sweep, list, ordersOf, sell, buy, cancel, readMail };
