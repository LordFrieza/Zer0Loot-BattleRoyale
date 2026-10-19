const test = require('node:test');
const assert = require('node:assert');
const { Rules, game, db, Battle } = require('./helpers');

// ---------- Paris ----------
const { computePayouts, Bets } = require('../server/bets');

test('[BET-7] paris : exemple du cahier des charges (1 et 9 golds sur le gagnant)', () => {
  const r = computePayouts([
    { userId: 'moi', target: 'W', amount: 1 },
    { userId: 'autre', target: 'W', amount: 9 },
    { userId: 'p1', target: 'L', amount: 50 },
    { userId: 'p2', target: 'L2', amount: 50 },
  ], 'W');
  assert.strictEqual(r.refund, false);
  assert.strictEqual(r.payouts.moi, 1 + 10); // mise + 10 % des 100 perdus
  assert.strictEqual(r.payouts.autre, 9 + 90); // mise + 90 %
  assert.strictEqual(r.payouts.p1, 0);
  assert.strictEqual(r.payouts.p2, 0);
});

test('[BET-7] paris : aucun gold créé ni perdu (arrondis)', () => {
  for (let k = 0; k < 300; k++) {
    const bets = Array.from({ length: 2 + (k % 9) }, (_, i) => ({
      userId: 'u' + i, target: ['A', 'B', 'C'][(i * 7 + k) % 3], amount: 1 + ((i * 13 + k * 7) % 97),
    }));
    const r = computePayouts(bets, 'A');
    const total = Object.values(r.payouts).reduce((a, b) => a + b, 0);
    assert.strictEqual(total, r.pool);
    for (const b of bets) {
      assert.ok(Number.isInteger(r.payouts[b.userId]));
      if (!r.refund && b.target === 'A') assert.ok(r.payouts[b.userId] >= b.amount);
    }
  }
});

test('[BET-8] paris : personne sur le gagnant → remboursement', () => {
  const r = computePayouts([{ userId: 'a', target: 'X', amount: 5 }, { userId: 'b', target: 'Y', amount: 7 }], 'Z');
  assert.strictEqual(r.refund, true);
  assert.deepStrictEqual(r.payouts, { a: 5, b: 7 });
});

test('[BET-1, BET-2, BET-3, BET-4, BET-5, BET-6, BET-7, BET-11] paris : règles de mise, modification, annulation, fermeture', () => {
  const db = require('../server/db');
  const { Battle } = require('../server/battle');
  const b = new Battle();
  const bets = new Bets(b);
  const user = (id, gold) => {
    const u = { id, username: id, role: 'player', character: Object.assign(game.newCharacter(), { gold }) };
    db.state.users[id] = u;
    return u;
  };
  const alice = user('alice', 100);
  const bob = user('bob', 20);
  assert.throws(() => bets.place(alice, 'u_bob', 10), /fermés/);
  b.openQueue(60);
  clearTimeout(b.queueTimer);
  b.join({ key: 'u_alice', userId: 'alice', name: 'Alice', level: 1, stats: Rules.derive({}), look: {} });
  b.join({ key: 'u_bob', userId: 'bob', name: 'Bob', level: 1, stats: Rules.derive({}), look: {} });
  assert.throws(() => bets.place(alice, 'u_alice', 10), /toi-même/);
  assert.throws(() => bets.place(alice, 'inconnu', 10), /participe pas/);
  assert.throws(() => bets.place(bob, 'u_alice', 21), /Pas assez/);
  assert.throws(() => bets.place(bob, 'u_alice', 0), /invalide/);
  bets.place(alice, 'u_bob', 30);
  assert.strictEqual(alice.character.gold, 70);
  bets.place(alice, 'u_bob', 100); // modification : l'ancienne mise est rendue d'abord
  assert.strictEqual(alice.character.gold, 0);
  bets.cancel(alice);
  assert.strictEqual(alice.character.gold, 100);
  bets.place(alice, 'u_bob', 40);
  bets.place(bob, 'u_alice', 20);
  assert.deepStrictEqual(bets.summary().targets, { u_bob: { total: 40, bettors: 1 }, u_alice: { total: 20, bettors: 1 } });
  b.start();
  b.stopLoop();
  assert.throws(() => bets.place(bob, 'u_alice', 1), /fermés/);
  // Bob gagne : Alice récupère 40 + 20 = 60
  const results = bets.settle('u_bob', 'Bob');
  assert.strictEqual(alice.character.gold, 120);
  assert.strictEqual(bob.character.gold, 0);
  assert.deepStrictEqual(results.map((r) => r.outcome).sort(), ['lost', 'won']);
  assert.strictEqual(bets.summary().pool, 0);
  assert.deepStrictEqual(
    { winners: bets.summary().lastResult.winners, distributed: bets.summary().lastResult.distributed },
    { winners: 1, distributed: 20 },
  );
});

test('[BET-9] paris : bataille annulée → tout le monde est remboursé', () => {
  const db = require('../server/db');
  const { Battle } = require('../server/battle');
  const b = new Battle();
  const bets = new Bets(b);
  const u = { id: 'carol', username: 'carol', role: 'player', character: Object.assign(game.newCharacter(), { gold: 50 }) };
  db.state.users.carol = u;
  b.on('cleared', () => bets.refundAll());
  b.openQueue(60);
  clearTimeout(b.queueTimer);
  b.join({ key: 'x', name: 'X', level: 1, stats: Rules.derive({}), look: {} });
  bets.place(u, 'x', 50);
  assert.strictEqual(u.character.gold, 0);
  b.reset();
  assert.strictEqual(u.character.gold, 50);
});
