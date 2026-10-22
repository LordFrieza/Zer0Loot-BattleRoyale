/*
 * Paris sur le vainqueur d'une bataille.
 *  - Les paris sont ouverts tant que la file est ouverte / fermée, et se ferment au lancement du combat.
 *  - Un seul pari par joueur (modifiable ou annulable avant la fermeture), jamais sur soi-même.
 *  - La mise est retirée tout de suite (et sauvegardée) pour qu'on ne puisse pas la dépenser deux fois.
 *  - Si le combattant choisi gagne : on récupère sa mise + une part des mises perdues,
 *    au prorata de ce qu'on a misé parmi les gagnants.
 *  - Si personne n'a parié sur le gagnant, ou si la bataille est annulée : tout le monde est remboursé.
 */
const db = require('./db');
const Rules = require('../shared/rules');

function state() {
  if (!db.state.bets) db.state.bets = { list: {}, lastResult: null };
  return db.state.bets;
}

/*
 * Calcul des gains (fonction pure, testée).
 * bets : [{ userId, target, amount }]
 * Retourne { payouts: { userId: golds rendus }, refund: bool, pool, winnersStake }
 */
function computePayouts(bets, winnerKey) {
  const pool = bets.reduce((s, b) => s + b.amount, 0);
  const winners = bets.filter((b) => b.target === winnerKey);
  const payouts = {};
  if (winners.length === 0) {
    for (const b of bets) payouts[b.userId] = b.amount;
    return { payouts, refund: true, pool, winnersStake: 0 };
  }
  const winnersStake = winners.reduce((s, b) => s + b.amount, 0);
  const lost = pool - winnersStake;
  // Répartition entière des mises perdues : méthode du plus fort reste (aucun gold ne se perd).
  const shares = winners.map((b) => {
    const exact = (lost * b.amount) / winnersStake;
    return { b, base: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = lost - shares.reduce((s, x) => s + x.base, 0);
  shares
    .slice()
    .sort((x, y) => y.rest - x.rest || y.b.amount - x.b.amount)
    .forEach((x) => { if (left > 0) { x.base += 1; left -= 1; } });
  for (const b of bets) payouts[b.userId] = 0;
  for (const x of shares) payouts[x.b.userId] = x.b.amount + x.base;
  return { payouts, refund: false, pool, winnersStake };
}

class Bets {
  constructor(battle) {
    this.battle = battle;
  }

  get list() {
    return state().list;
  }

  // Paris seulement dans les modes à gagnant unique (Battle Royale, Roi de la Colline), jamais en coopération.
  open() {
    return (this.battle.phase === 'queue' || this.battle.phase === 'ready') && !Rules.GAME_MODES[this.battle.mode].coop;
  }

  myBet(userId) {
    return this.list[userId] || null;
  }

  place(user, targetKey, amount) {
    if (!this.open()) throw new Error('Les paris sont fermés');
    amount = Math.floor(Number(amount));
    if (!Number.isFinite(amount) || amount < 1) throw new Error('Mise invalide (1 gold minimum)');
    const target = this.battle.participants.get(targetKey);
    if (!target) throw new Error('Ce combattant ne participe pas à la bataille');
    if (target.userId === user.id) throw new Error('Tu ne peux pas parier sur toi-même');
    const c = user.character;
    const previous = this.list[user.id];
    const available = c.gold + (previous ? previous.amount : 0);
    if (amount > available) throw new Error('Pas assez de golds');
    c.gold = available - amount;
    this.list[user.id] = { userId: user.id, target: targetKey, targetName: target.name, amount };
    db.save();
    return this.list[user.id];
  }

  cancel(user) {
    if (!this.open()) throw new Error('Les paris sont fermés');
    const bet = this.list[user.id];
    if (!bet) throw new Error('Aucun pari en cours');
    user.character.gold += bet.amount;
    delete this.list[user.id];
    db.save();
  }

  /*
   * Résume les paris pour l'affichage public (sans révéler qui a parié quoi).
   */
  summary() {
    const targets = {};
    let pool = 0;
    for (const b of Object.values(this.list)) {
      pool += b.amount;
      if (!targets[b.target]) targets[b.target] = { total: 0, bettors: 0 };
      targets[b.target].total += b.amount;
      targets[b.target].bettors += 1;
    }
    return { open: this.open(), pool, bettors: Object.keys(this.list).length, targets, lastResult: state().lastResult };
  }

  /*
   * Fin de bataille : verse les gains. Retourne la liste des résultats par joueur.
   */
  settle(winnerKey, winnerName) {
    const bets = Object.values(this.list);
    const results = [];
    if (bets.length) {
      const { payouts, refund, pool } = computePayouts(bets, winnerKey);
      for (const b of bets) {
        const user = db.state.users[b.userId];
        const payout = payouts[b.userId] || 0;
        if (user) user.character.gold += payout;
        results.push({
          userId: b.userId,
          target: b.target,
          targetName: b.targetName,
          amount: b.amount,
          payout,
          outcome: refund ? 'refund' : payout > 0 ? 'won' : 'lost',
        });
      }
      const winners = results.filter((r) => r.outcome === 'won');
      state().lastResult = {
        winnerName: winnerName || null,
        pool,
        refund,
        winners: winners.length,
        bettors: bets.length,
        distributed: winners.reduce((s, r) => s + r.payout - r.amount, 0),
      };
    } else {
      state().lastResult = null;
    }
    state().list = {};
    db.save();
    return results;
  }

  // Bataille annulée, file rouverte ou serveur redémarré : remboursement intégral.
  refundAll() {
    const results = [];
    for (const b of Object.values(this.list)) {
      const user = db.state.users[b.userId];
      if (user) user.character.gold += b.amount;
      results.push({ ...b, payout: b.amount, outcome: 'refund' });
    }
    state().list = {};
    state().lastResult = null;
    db.save();
    return results;
  }

  clearResult() {
    state().lastResult = null;
  }
}

module.exports = { Bets, computePayouts };
