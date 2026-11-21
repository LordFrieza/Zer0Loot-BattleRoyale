/*
 * Casino : neuf jeux payants, chacun tenu par un boss en smoking. Tout se décide ici, côté serveur, avec le
 * générateur cryptographique ; le navigateur ne fait que l'animation.
 *  - Machine à sous (Pyrax), Roulette (Grokk), Gobelets (Malvorath), Caisse (Grignotor) : un appel = un tirage.
 *  - Blackjack (Maexxna) et Lac gelé (Givrenoire) : une partie en plusieurs coups, gardée dans
 *    db.state.casino.sessions[userId] (jamais envoyée telle quelle : la carte cachée et les fissures restent secrètes).
 *  - Road to Heaven (Ether) et Chaton Fripon (Lilith) : parties en plusieurs coups (point d'effondrement et
 *    glissades tirés côté serveur, jamais envoyés avant la fin) ; Course de démons (Daedra) : un appel = une course.
 * Un ticket de casino (character.casinoTickets, rapporté par Mini Lilith) paie une mise de 50 golds, sauf à la caisse.
 * La mise est retirée dès le début du coup ; les gains sont crédités à la fin. Les gros gains (≥ 10× la mise, ou un
 * lot incroyable) sont ajoutés au fil du casino (db.state.casino.feed), que index.js diffuse.
 */
const crypto = require('crypto');
const db = require('./db');
const game = require('./game');
const Rules = require('../shared/rules');

const C = Rules.CASINO;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

function state() {
  if (!db.state.casino) db.state.casino = {};
  const s = db.state.casino;
  if (!s.sessions) s.sessions = {};
  if (!Array.isArray(s.feed)) s.feed = [];
  return s;
}

const random = () => crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
const randInt = (min, max) => crypto.randomInt(min, max + 1);
function weightedPick(entries) {
  const total = entries.reduce((a, e) => a + e.weight, 0);
  let r = random() * total;
  for (const e of entries) { r -= e.weight; if (r < 0) return e; }
  return entries[entries.length - 1];
}
const nameOf = (user) => user.twitchDisplayName || user.username;

// Mise d'un coup. Avec un ticket, la mise est de 50 golds (C.ticket), payée par le ticket.
function checkBet(character, bet, ticket = false) {
  if (ticket) {
    if (!(character.casinoTickets > 0)) throw new Error('Tu n\'as plus de ticket de casino');
    return C.ticket;
  }
  const b = Number(bet);
  if (!C.bets.includes(b)) throw new Error(`Mise possible : ${C.bets.join(', ')} golds`);
  if (character.gold < b) throw new Error(`Il te faut ${b} golds pour miser`);
  return b;
}

// Retire la mise (statistiques : parties, mises). Un ticket paie les 50 premiers golds (non comptés comme misés).
function take(character, amount, newGame = true, ticket = false) {
  game.upgrade(character);
  let golds = amount;
  if (ticket) {
    if (!(character.casinoTickets > 0)) throw new Error('Tu n\'as plus de ticket de casino');
    character.casinoTickets -= 1;
    game.bump(character, 'casinoTicketsUsed');
    golds = Math.max(0, amount - C.ticket);
  }
  character.gold -= golds;
  game.addStat(character, 'casinoWagered', golds);
  if (newGame) { game.addStat(character, 'casinoBets'); game.bump(character, 'casinoPlays'); }
}

// Crédite un gain ; un gros gain part dans le fil du casino. Retourne true si le fil a changé.
function pay(user, gameId, bet, payout, text) {
  const c = user.character;
  if (payout > 0) {
    c.gold += payout;
    game.addStat(c, 'casinoWon', payout);
    c.lifetime.casinoBest = Math.max(c.lifetime.casinoBest || 0, payout);
  }
  if (payout > 0 && (payout >= bet * C.bigWin || text)) {
    addFeed({ name: nameOf(user), game: gameId, amount: payout, bet, text: text || null });
    return true;
  }
  return false;
}

function addFeed(entry) {
  const s = state();
  s.feed.unshift({ at: Date.now(), ...entry });
  if (s.feed.length > C.feedMax) s.feed.length = C.feedMax;
}

function feed() {
  return state().feed;
}

// ---------- Machine à sous (Pyrax) ----------
function slots(user, bet, ticket) {
  const c = user.character;
  const b = checkBet(c, bet, ticket);
  take(c, b, true, ticket);
  const symbols = Object.entries(C.slots.symbols).map(([id, s]) => ({ id, weight: s.weight }));
  const reels = [0, 1, 2].map(() => weightedPick(symbols).id);
  const res = Rules.slotsPayout(reels);
  const payout = b * res.mult;
  if (res.kind === 'jackpot') game.bump(c, 'jackpots');
  const big = pay(user, 'slots', b, payout, res.kind === 'jackpot' ? 'JACKPOT !' : null);
  return { reels, mult: res.mult, kind: res.kind, payout, bet: b, feed: big };
}

// ---------- Roulette (Grokk) ----------
function roulette(user, bets, ticket = false) {
  const c = user.character;
  const R = C.roulette;
  if (!Array.isArray(bets) || !bets.length) throw new Error('Place au moins un jeton');
  if (bets.length > R.maxBets) throw new Error(`${R.maxBets} paris au plus par lancer`);
  const clean = bets.map((x) => ({ on: String(x && x.on), amount: Number(x && x.amount) }));
  for (const x of clean) {
    if (Rules.rouletteReturn(x.on) === null) throw new Error('Pari inconnu');
    if (!R.chips.includes(x.amount)) throw new Error(`Jetons possibles : ${R.chips.join(', ')} golds`);
  }
  const total = clean.reduce((a, x) => a + x.amount, 0);
  if (total > C.maxBet) throw new Error(`Mise totale de ${C.maxBet} golds au plus par lancer`);
  if (ticket && !(c.casinoTickets > 0)) throw new Error('Tu n\'as plus de ticket de casino');
  if (ticket && total < C.ticket) throw new Error(`Avec un ticket, mise au moins ${C.ticket} golds de jetons`);
  const golds = ticket ? total - C.ticket : total;
  if (c.gold < golds) throw new Error(`Il te faut ${golds} golds pour ces paris`);
  take(c, total, true, ticket);
  const number = randInt(0, 36);
  let payout = 0;
  const wins = [];
  for (const x of clean) {
    if (Rules.rouletteWins(x.on, number)) { payout += x.amount * Rules.rouletteReturn(x.on); wins.push(x.on); }
  }
  const big = pay(user, 'roulette', total, payout, payout >= total * C.bigWin ? `le ${number} !` : null);
  return { number, color: Rules.rouletteColor(number), wins, payout, bet: total, feed: big };
}

// ---------- Gobelets du mage (Malvorath) ----------
function gobelets(user, bet, cup, ticket) {
  const c = user.character;
  const k = Number(cup);
  if (!Number.isInteger(k) || k < 0 || k >= C.gobelets.cups) throw new Error('Choisis un gobelet');
  const b = checkBet(c, bet, ticket);
  take(c, b, true, ticket);
  const ball = randInt(0, C.gobelets.cups - 1);
  const payout = ball === k ? Math.floor(b * C.gobelets.pays) : 0;
  pay(user, 'gobelets', b, payout);
  return { ball, cup: k, win: ball === k, payout, bet: b };
}

// ---------- Caisse de Grignotor ----------
function caisse(user) {
  const c = user.character;
  const price = C.caisse.price;
  if (c.gold < price) throw new Error(`Une caisse coûte ${price} golds`);
  take(c, price);
  const lot = weightedPick(C.caisse.loot);
  const out = { lot: { id: lot.id, tier: lot.tier, label: lot.label, icon: lot.icon }, price };
  let payout = 0;
  if (lot.gold) {
    payout = randInt(lot.gold[0], lot.gold[1]);
    out.gold = payout;
  } else if (lot.rarity) {
    const item = game.makeItem(lot.rarity, 'arme', { cls: c.cls, ownChance: 1 });
    item.isNew = true;
    c.inventory.push(item);
    game.addStat(c, 'itemsObtained');
    if (item.rarity === 'legendaire') game.bump(c, 'legendary');
    out.item = item;
  } else if (lot.keys) {
    game.addKeys(c, lot.keys);
    out.keys = lot.keys;
  } else if (lot.pet) {
    const species = Object.keys(Rules.PETS);
    const r = game.addPet(c, species[randInt(0, species.length - 1)]);
    out.pet = { species: r.pet.species, name: r.pet.name, duplicate: r.duplicate };
  }
  if (lot.tier === 'incroyable') game.bump(c, 'casinoLegend');
  let big = pay(user, 'caisse', price, payout);
  if (lot.tier === 'incroyable') {
    addFeed({ name: nameOf(user), game: 'caisse', amount: 0, bet: price, text: out.item ? `${out.item.name} (Légendaire)` : `un ${out.pet.name}` });
    big = true;
  }
  return { ...out, payout, feed: big };
}

// ---------- Blackjack (Maexxna) ----------
const card = () => ({ r: RANKS[randInt(0, 12)], s: SUITS[randInt(0, 3)] });

function bjView(bj) {
  const done = !!bj.outcome;
  return {
    bet: bj.bet,
    doubled: bj.doubled,
    player: bj.player,
    dealer: done ? bj.dealer : [bj.dealer[0], { hidden: true }],
    playerValue: Rules.bjValue(bj.player),
    dealerValue: done ? Rules.bjValue(bj.dealer) : Rules.bjValue([bj.dealer[0]]),
    outcome: bj.outcome || null,
    payout: bj.payout || 0,
    canDouble: !done && bj.player.length === 2 && !bj.doubled,
  };
}

function session(user) {
  const s = state().sessions;
  if (!s[user.id]) s[user.id] = {};
  return s[user.id];
}

function bjFinish(user, bj) {
  const pv = Rules.bjValue(bj.player);
  const dv = Rules.bjValue(bj.dealer);
  let mult = 0;
  if (pv.total > 21) bj.outcome = 'bust';
  else if (pv.blackjack && !dv.blackjack) { bj.outcome = 'blackjack'; mult = C.blackjack.blackjackPays; }
  else if (dv.total > 21) { bj.outcome = 'win'; mult = 2; }
  else if (pv.total > dv.total && !dv.blackjack) { bj.outcome = 'win'; mult = 2; }
  else if (pv.total === dv.total && pv.blackjack === dv.blackjack) { bj.outcome = 'push'; mult = 1; }
  else bj.outcome = 'lose';
  bj.payout = Math.floor(bj.bet * mult);
  const feedChanged = pay(user, 'blackjack', bj.bet, bj.payout);
  delete session(user).bj;
  return { ...bjView(bj), feed: feedChanged };
}

// La banque tire jusqu'à 17 (elle reste aussi sur 17 souple).
function dealerPlay(bj) {
  while (Rules.bjValue(bj.dealer).total < C.blackjack.dealerStand) bj.dealer.push(card());
}

function bjDeal(user, bet, ticket) {
  const c = user.character;
  const S = session(user);
  if (S.bj) throw new Error('Termine d\'abord ta main en cours');
  const b = checkBet(c, bet, ticket);
  take(c, b, true, ticket);
  const bj = { bet: b, player: [card(), card()], dealer: [card(), card()], doubled: false };
  S.bj = bj;
  // Blackjack d'entrée (joueur ou banque) : la main se règle tout de suite.
  if (Rules.bjValue(bj.player).blackjack || Rules.bjValue(bj.dealer).blackjack) return bjFinish(user, bj);
  return bjView(bj);
}

function current(user) {
  const bj = session(user).bj;
  if (!bj) throw new Error('Aucune main en cours : mise d\'abord');
  return bj;
}

function bjHit(user) {
  const bj = current(user);
  bj.player.push(card());
  const v = Rules.bjValue(bj.player).total;
  if (v > 21) return bjFinish(user, bj);
  if (v === 21) { dealerPlay(bj); return bjFinish(user, bj); }
  return bjView(bj);
}

function bjStand(user) {
  const bj = current(user);
  dealerPlay(bj);
  return bjFinish(user, bj);
}

function bjDouble(user) {
  const bj = current(user);
  const c = user.character;
  if (bj.player.length !== 2 || bj.doubled) throw new Error('On ne double que sur les deux premières cartes');
  if (c.gold < bj.bet) throw new Error(`Il te faut ${bj.bet} golds de plus pour doubler`);
  take(c, bj.bet, false);
  bj.bet *= 2;
  bj.doubled = true;
  bj.player.push(card());
  if (Rules.bjValue(bj.player).total <= 21) dealerPlay(bj);
  return bjFinish(user, bj);
}

// ---------- Lac gelé (Givrenoire) ----------
function glaceView(g) {
  const done = !!g.outcome;
  const safe = g.revealed.length;
  return {
    bet: g.bet,
    mines: g.mines,
    revealed: g.revealed,
    mult: Rules.glaceMult(g.mines, safe),
    next: safe < C.glace.size - g.mines ? Rules.glaceMult(g.mines, safe + 1) : null,
    cashable: !done && safe > 0,
    cracks: done ? g.cracks : null,
    boom: g.boom == null ? null : g.boom,
    outcome: g.outcome || null,
    payout: g.payout || 0,
  };
}

function glaceStart(user, bet, mines, ticket) {
  const c = user.character;
  const S = session(user);
  if (S.glace) throw new Error('Termine d\'abord ta partie en cours');
  const m = Number(mines);
  if (!C.glace.mines.includes(m)) throw new Error(`Nombre de fissures possible : ${C.glace.mines.join(', ')}`);
  const b = checkBet(c, bet, ticket);
  take(c, b, true, ticket);
  const cells = Array.from({ length: C.glace.size }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) { const j = randInt(0, i); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  S.glace = { bet: b, mines: m, cracks: cells.slice(0, m).sort((x, y) => x - y), revealed: [] };
  return glaceView(S.glace);
}

function glaceCurrent(user) {
  const g = session(user).glace;
  if (!g) throw new Error('Aucune partie en cours : mise d\'abord');
  return g;
}

function glaceEnd(user, g, outcome) {
  g.outcome = outcome;
  g.payout = outcome === 'cash' ? Math.floor(g.bet * Rules.glaceMult(g.mines, g.revealed.length)) : 0;
  const big = pay(user, 'glace', g.bet, g.payout);
  delete session(user).glace;
  return { ...glaceView(g), feed: big };
}

function glacePick(user, index) {
  const g = glaceCurrent(user);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= C.glace.size) throw new Error('Case inconnue');
  if (g.revealed.includes(i)) throw new Error('Case déjà brisée');
  if (g.cracks.includes(i)) { g.boom = i; return glaceEnd(user, g, 'boom'); }
  g.revealed.push(i);
  if (g.revealed.length === C.glace.size - g.mines) return glaceEnd(user, g, 'cash'); // tout le lac : encaissé d'office
  return glaceView(g);
}

function glaceCash(user) {
  const g = glaceCurrent(user);
  if (!g.revealed.length) throw new Error('Brise au moins une case avant d\'encaisser');
  return glaceEnd(user, g, 'cash');
}

// ---------- Road to Heaven (Ether) ----------
// La ligne part à ×1 et monte en exp(speed × t). Le point d'effondrement est tiré au départ et reste secret ;
// le temps est celui du serveur (now). Encaissement automatique possible à un multiplicateur choisi d'avance.
function heavenView(h, now) {
  const done = !!h.outcome;
  const t = (now - h.start) / 1000;
  return {
    bet: h.bet,
    auto: h.auto || null,
    t: Math.round(Math.max(0, t) * 1000) / 1000,
    mult: done ? h.mult : Rules.heavenMult(t),
    crash: done ? h.crashAt : null,
    outcome: h.outcome || null,
    payout: h.payout || 0,
  };
}

function heavenStart(user, bet, auto, ticket, now = Date.now()) {
  const c = user.character;
  const S = session(user);
  if (S.heaven) throw new Error('Termine d\'abord ta montée en cours');
  let a = null;
  if (auto != null && auto !== '' && auto !== 0) {
    a = Math.floor(Number(auto) * 100) / 100;
    if (!Number.isFinite(a) || a < C.heaven.autoMin || a > C.heaven.max) throw new Error(`Encaissement auto entre ×${C.heaven.autoMin} et ×${C.heaven.max}`);
  }
  const b = checkBet(c, bet, ticket);
  take(c, b, true, ticket);
  S.heaven = { bet: b, crashAt: Rules.heavenCrash(random()), start: now, auto: a };
  return heavenView(S.heaven, now);
}

function heavenEnd(user, h, outcome, mult, now) {
  h.outcome = outcome;
  h.mult = mult;
  h.payout = outcome === 'cash' ? Math.floor(h.bet * mult) : 0;
  const big = pay(user, 'heaven', h.bet, h.payout, h.payout >= h.bet * 50 ? `×${String(mult).replace('.', ',')} au paradis !` : null);
  delete session(user).heaven;
  return { ...heavenView(h, now), feed: big };
}

// Où en est la ligne ? Effondrée, encaissée automatiquement, ou encore en train de monter.
function heavenSettle(user, h, now) {
  const m = Rules.heavenMult((now - h.start) / 1000);
  if (h.auto && h.auto < h.crashAt && m >= h.auto) return heavenEnd(user, h, 'cash', h.auto, now);
  if (m >= h.crashAt) return heavenEnd(user, h, 'crash', h.crashAt, now);
  return null;
}

function heavenCurrent(user) {
  const h = session(user).heaven;
  if (!h) throw new Error('Aucune montée en cours : mise d\'abord');
  return h;
}

function heavenCheck(user, now = Date.now()) {
  const h = heavenCurrent(user);
  return heavenSettle(user, h, now) || heavenView(h, now);
}

function heavenCash(user, now = Date.now()) {
  const h = heavenCurrent(user);
  return heavenSettle(user, h, now) || heavenEnd(user, h, 'cash', Rules.heavenMult((now - h.start) / 1000), now);
}

// ---------- Chaton Fripon (Lilith) ----------
function chatonView(k) {
  const roofs = C.chaton.slip.length;
  return {
    bet: k.bet,
    roof: k.roof,
    mult: Rules.chatonMult(k.roof),
    next: k.roof < roofs ? Rules.chatonMult(k.roof + 1) : null,
    risk: k.roof < roofs ? C.chaton.slip[k.roof] : null,
    cashable: !k.outcome && k.roof > 0,
    outcome: k.outcome || null,
    payout: k.payout || 0,
  };
}

function chatonStart(user, bet, ticket) {
  const c = user.character;
  const S = session(user);
  if (S.chaton) throw new Error('Termine d\'abord ta partie en cours');
  const b = checkBet(c, bet, ticket);
  take(c, b, true, ticket);
  S.chaton = { bet: b, roof: 0 };
  return chatonView(S.chaton);
}

function chatonCurrent(user) {
  const k = session(user).chaton;
  if (!k) throw new Error('Aucune partie en cours : mise d\'abord');
  return k;
}

function chatonEnd(user, k, outcome) {
  k.outcome = outcome;
  k.payout = outcome === 'cash' ? Math.floor(k.bet * Rules.chatonMult(k.roof)) : 0;
  const big = pay(user, 'chaton', k.bet, k.payout, outcome === 'cash' && k.roof === C.chaton.slip.length ? 'les 10 toits !' : null);
  delete session(user).chaton;
  return { ...chatonView(k), feed: big };
}

function chatonJump(user) {
  const k = chatonCurrent(user);
  if (random() < C.chaton.slip[k.roof]) { k.slipAt = k.roof + 1; const r = chatonEnd(user, k, 'slip'); return { ...r, slipAt: k.slipAt }; }
  k.roof += 1;
  if (k.roof === C.chaton.slip.length) return chatonEnd(user, k, 'cash'); // dernier toit : encaissé d'office
  return chatonView(k);
}

function chatonCash(user) {
  const k = chatonCurrent(user);
  if (!k.roof) throw new Error('Fais sauter le chaton au moins une fois avant d\'encaisser');
  return chatonEnd(user, k, 'cash');
}

// ---------- Course de démons (Daedra) ----------
function course(user, bet, demon, ticket) {
  const c = user.character;
  const D = C.course.demons;
  const pick = D.find((d) => d.id === demon);
  if (!pick) throw new Error('Choisis un démon');
  const b = checkBet(c, bet, ticket);
  take(c, b, true, ticket);
  const chances = Rules.courseChances();
  // Ordre d'arrivée : tirage pondéré par les chances, sans remise (le premier est le vainqueur)
  const left = D.map((d) => ({ id: d.id, weight: chances[d.id] }));
  const order = [];
  while (left.length) {
    const e = weightedPick(left);
    order.push(e.id);
    left.splice(left.indexOf(e), 1);
  }
  const win = order[0] === pick.id;
  const payout = win ? Math.floor(b * pick.pays) : 0;
  const big = pay(user, 'course', b, payout, win && pick.pays >= 10 ? `${pick.name} l'outsider !` : null);
  return { order, winner: order[0], pick: pick.id, win, payout, bet: b, feed: big };
}

// Parties en cours (rechargement de la page) : vues publiques, sans secret.
function sessionsOf(user, now = Date.now()) {
  const S = state().sessions[user.id] || {};
  return {
    blackjack: S.bj ? bjView(S.bj) : null,
    glace: S.glace ? glaceView(S.glace) : null,
    heaven: S.heaven ? heavenView(S.heaven, now) : null,
    chaton: S.chaton ? chatonView(S.chaton) : null,
  };
}

module.exports = {
  state, feed, slots, roulette, gobelets, caisse, bjDeal, bjHit, bjStand, bjDouble, glaceStart, glacePick, glaceCash,
  heavenStart, heavenCheck, heavenCash, chatonStart, chatonJump, chatonCash, course, sessionsOf,
};
