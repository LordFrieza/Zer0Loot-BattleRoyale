const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zl-test-'));
const Rules = require('../shared/rules');
const game = require('../server/game');

test('table de loot : valeurs du cahier des charges', () => {
  assert.deepStrictEqual(Rules.lootTable(0), { commun: 90, peu_commun: 6, rare: 3, epique: 0.9, legendaire: 0.1 });
  assert.deepStrictEqual(Rules.lootTable(10), { commun: 80, peu_commun: 10, rare: 6, epique: 3, legendaire: 1 });
});

test('table de loot : total à 100 % et plafond', () => {
  for (const luck of [0, 5, 33, 85, 500]) {
    const sum = Object.values(Rules.lootTable(luck)).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 100) < 1e-6, `luck ${luck} → ${sum}`);
  }
  assert.deepStrictEqual(Rules.lootTable(500), Rules.lootTable(Rules.LUCK_CAP));
});

test('objets : nombre de lignes et bornes selon la rareté', () => {
  for (const rarity of Rules.RARITIES) {
    const info = Rules.RARITY_INFO[rarity];
    for (let i = 0; i < 200; i++) {
      const item = game.makeItem(rarity);
      assert.strictEqual(item.lines.length, info.lines);
      assert.strictEqual(new Set(item.lines.map((l) => l.stat)).size, info.lines, 'stats distinctes');
      for (const l of item.lines) assert.ok(l.value >= info.min && l.value <= info.max);
      assert.ok(Rules.SLOTS.includes(item.slot));
    }
  }
});

test('lumières du coffre : blanc, vert (4), bleu (6), violet (11), orange (21)', () => {
  const at = (n) => Rules.chestLightRarity(n);
  assert.strictEqual(at(3), 'commun');
  assert.strictEqual(at(4), 'peu_commun');
  assert.strictEqual(at(6), 'rare');
  assert.strictEqual(at(11), 'epique');
  assert.strictEqual(at(21), 'legendaire');
});

test('ouverture : clics requis = meilleure rareté du coffre', () => {
  const c = game.newCharacter();
  c.chests = 50;
  for (let i = 0; i < 50; i++) {
    const r = game.openChest(c);
    assert.strictEqual(r.items.length, Rules.ITEMS_PER_CHEST);
    assert.strictEqual(r.clicks, Rules.RARITY_INFO[r.bestRarity].clicks);
  }
  assert.strictEqual(c.chests, 0);
  assert.strictEqual(c.inventory.length, 150);
});

test('courbe d\'XP : 300, 500, 700, 900…', () => {
  assert.deepStrictEqual([1, 2, 3, 4].map(Rules.xpToNext), [300, 500, 700, 900]);
});

test('récompenses et niveaux', () => {
  const c = game.newCharacter();
  game.grant(c, Rules.REWARDS.kill); // 100 / 300
  assert.strictEqual(c.level, 1);
  assert.strictEqual(c.xp, 100);
  assert.strictEqual(c.gold, 10);
  assert.strictEqual(c.chests, 1);
  game.grant(c, Rules.REWARDS.win); // 400 XP : 300 pour le niv. 2, reste 100
  assert.strictEqual(c.level, 2);
  assert.strictEqual(c.xp, 100);
  assert.strictEqual(c.skillPoints, 1);
  assert.strictEqual(c.gold, 40);
  game.addXp(c, 400 + 700); // niv. 3 (500) puis niv. 4 (700)
  assert.strictEqual(c.level, 4);
  assert.strictEqual(c.xp, 0);
  assert.strictEqual(c.skillPoints, 3);
});

test('critique : 1 % de base, +2 % par point, bonus d\'équipement, plafond', () => {
  assert.strictEqual(Rules.derive({}).crit, 0.01);
  assert.strictEqual(Rules.derive({ critique: 10 }).crit, 0.21);
  assert.ok(Math.abs(Rules.derive({ critique: 10 }, { critique: 20 }).crit - 0.252) < 1e-9);
  assert.strictEqual(Rules.derive({ critique: 500 }).crit, Rules.CRIT_CAP / 100);
});

test('critique : anciens persos sans la stat', () => {
  const c = game.newCharacter();
  delete c.stats.critique;
  c.skillPoints = 1;
  assert.strictEqual(game.derived(c).crit, 0.01);
  game.allocate(c, 'critique');
  assert.strictEqual(c.stats.critique, 1);
});

test('combat : les critiques doublent les dégâts', () => {
  const { Battle } = require('../server/battle');
  const stats = (crit) => ({ maxHp: 1e9, damage: 100, reduction: 0, speed: 0, dodge: 0, crit });
  const b = new Battle();
  b.openQueue(60);
  b.join({ key: 'a', name: 'A', level: 1, stats: stats(1), look: {} });
  b.join({ key: 'b', name: 'B', level: 1, stats: stats(0), look: {} });
  b.start();
  b.stopLoop();
  clearTimeout(b.queueTimer);
  const [a, bb] = b.fighters;
  const hits = [];
  for (let i = 0; i < 200; i++) { b.events = []; b.attack(a, bb); b.attack(bb, a); hits.push(...b.events); }
  const fromA = hits.filter((e) => e.from === 'a');
  const fromB = hits.filter((e) => e.from === 'b');
  assert.ok(fromA.every((e) => e.crit && e.dmg >= 170 && e.dmg <= 230));
  assert.ok(fromB.every((e) => !e.crit && e.dmg >= 85 && e.dmg <= 115));
});

test('achat de coffre : 100 golds', () => {
  const c = game.newCharacter();
  c.gold = 250;
  game.buyChests(c, 2);
  assert.strictEqual(c.gold, 50);
  assert.strictEqual(c.chests, 2);
  assert.throws(() => game.buyChests(c, 1));
});

test('équiper / retirer', () => {
  const c = game.newCharacter();
  const a = game.makeItem('rare', 'casque');
  const b = game.makeItem('commun', 'casque');
  c.inventory.push(a, b);
  game.equip(c, a.id);
  game.equip(c, b.id);
  assert.strictEqual(c.equipment.casque.id, b.id);
  assert.deepStrictEqual(c.inventory.map((i) => i.id), [a.id]);
  game.unequip(c, 'casque');
  assert.strictEqual(c.inventory.length, 2);
});

test('tirage réel conforme à la table de loot (chance 0 et 10)', () => {
  const N = 400000;
  for (const luck of [0, 10]) {
    const expected = Rules.lootTable(luck);
    const counts = Object.fromEntries(Rules.RARITIES.map((r) => [r, 0]));
    for (let i = 0; i < N; i++) counts[game.rollRarity(luck)] += 1;
    for (const r of Rules.RARITIES) {
      const p = expected[r] / 100;
      const observed = counts[r] / N;
      const tolerance = 5 * Math.sqrt((p * (1 - p)) / N); // 5 écarts-types
      assert.ok(Math.abs(observed - p) <= tolerance, `chance ${luck}, ${r} : ${(observed * 100).toFixed(3)} % au lieu de ${expected[r]} %`);
    }
  }
});

test('historique des tirages enregistré à chaque ouverture', () => {
  const c = game.newCharacter();
  c.chests = 10;
  for (let i = 0; i < 10; i++) game.openChest(c);
  const total = Object.values(c.lootStats).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 10 * Rules.ITEMS_PER_CHEST);
});

test('recyclage : 3 golds par objet, quelle que soit la rareté', () => {
  const c = game.newCharacter();
  const items = ['commun', 'rare', 'legendaire'].map((r) => game.makeItem(r));
  const kept = game.makeItem('epique');
  c.inventory.push(...items, kept);
  const r = game.recycle(c, items.map((i) => i.id));
  assert.deepStrictEqual(r, { recycled: 3, gold: 9 });
  assert.strictEqual(c.gold, 9);
  assert.deepStrictEqual(c.inventory.map((i) => i.id), [kept.id]);
  assert.throws(() => game.recycle(c, []));
  assert.throws(() => game.recycle(c, ['inconnu']));
});

test('recyclage : un objet équipé ne peut pas être recyclé', () => {
  const c = game.newCharacter();
  const item = game.makeItem('rare', 'ceinture');
  c.inventory.push(item);
  game.equip(c, item.id);
  assert.throws(() => game.recycle(c, [item.id]));
  assert.strictEqual(c.equipment.ceinture.id, item.id);
  assert.strictEqual(c.gold, 0);
});

// ---------- Paris ----------
const { computePayouts, Bets } = require('../server/bets');

test('paris : exemple du cahier des charges (1 et 9 golds sur le gagnant)', () => {
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

test('paris : aucun gold créé ni perdu (arrondis)', () => {
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

test('paris : personne sur le gagnant → remboursement', () => {
  const r = computePayouts([{ userId: 'a', target: 'X', amount: 5 }, { userId: 'b', target: 'Y', amount: 7 }], 'Z');
  assert.strictEqual(r.refund, true);
  assert.deepStrictEqual(r.payouts, { a: 5, b: 7 });
});

test('paris : règles de mise, modification, annulation, fermeture', () => {
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

test('paris : bataille annulée → tout le monde est remboursé', () => {
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


// ---------- Classes ----------

test('classes : première classe gratuite, changement à 100 golds', () => {
  const c = game.newCharacter();
  assert.strictEqual(c.cls, null);
  assert.deepStrictEqual(game.chooseClass(c, 'mage'), { cost: 0, unequipped: 0 });
  assert.throws(() => game.chooseClass(c, 'mage'), /déjà/);
  assert.throws(() => game.chooseClass(c, 'archer'), /100 golds/);
  assert.throws(() => game.chooseClass(c, 'ninja'), /inconnue/);
  c.gold = 150;
  assert.strictEqual(game.chooseClass(c, 'archer').cost, 100);
  assert.strictEqual(c.gold, 50);
  assert.strictEqual(c.cls, 'archer');
});

test('classes : armes réservées, objets incompatibles retirés au changement', () => {
  const c = game.newCharacter();
  game.chooseClass(c, 'mage');
  const sword = game.makeItem('rare', 'arme', { kind: 'epee' });
  const staff = game.makeItem('rare', 'arme', { kind: 'baton' });
  const book = game.makeItem('rare', 'secondaire', { kind: 'grimoire' });
  const helmet = game.makeItem('rare', 'casque');
  c.inventory.push(sword, staff, book, helmet);
  assert.throws(() => game.equip(c, sword.id), /Guerrier/);
  game.equip(c, staff.id);
  game.equip(c, book.id);
  game.equip(c, helmet.id);
  c.gold = 100;
  assert.deepStrictEqual(game.chooseClass(c, 'guerrier'), { cost: 100, unequipped: 2 });
  assert.deepStrictEqual(Object.keys(c.equipment), ['casque']);
  game.equip(c, sword.id);
  assert.strictEqual(c.equipment.arme.kind, 'epee');
  const noClass = game.newCharacter();
  noClass.inventory.push(game.makeItem('commun', 'arme', { kind: 'arc' }));
  assert.throws(() => game.equip(noClass, noClass.inventory[0].id));
});

test('classes : anciennes épées / boucliers migrés en objets de Guerrier', () => {
  const c = game.newCharacter();
  delete c.cls;
  delete c.migratedSlots;
  c.inventory.push({ id: 'old1', slot: 'epee', rarity: 'rare', name: 'Lame', lines: [{ stat: 'force', value: 8 }] });
  c.equipment.bouclier = { id: 'old2', slot: 'bouclier', rarity: 'commun', name: 'Pavois', lines: [{ stat: 'vie', value: 2 }] };
  game.upgrade(c);
  assert.strictEqual(c.cls, null);
  assert.deepStrictEqual([c.inventory[0].slot, c.inventory[0].kind], ['arme', 'epee']);
  assert.strictEqual(c.equipment.bouclier, undefined);
  assert.deepStrictEqual([c.equipment.secondaire.slot, c.equipment.secondaire.kind], ['secondaire', 'bouclier']);
});

test('classes : bonus de stats', () => {
  assert.strictEqual(Rules.derive({}, {}, 'guerrier').maxHp, 130);
  assert.strictEqual(Rules.derive({}, {}, 'mage').maxHp, 85);
  assert.strictEqual(Rules.derive({}, {}, 'mage').damage, 12.5);
  assert.ok(Math.abs(Rules.derive({}, {}, 'assassin').crit - 0.11) < 1e-9);
  assert.ok(Math.abs(Rules.derive({}, {}, 'mage').cooldown - 1.35) < 1e-9);
  assert.ok(Math.abs(Rules.derive({}, {}, 'archer').precision - 0.20) < 1e-9);
});

test('nouvelles stats : valeurs de base, points, plafonds', () => {
  const d0 = Rules.derive({});
  assert.strictEqual(d0.cooldown, 1);
  assert.strictEqual(d0.lifesteal, 0.02);
  assert.strictEqual(d0.precision, 0.05);
  assert.strictEqual(d0.thorns, 0.02);
  const d = Rules.derive({ vitesse_attaque: 10, vol_de_vie: 10, precision: 10, epines: 10 });
  assert.ok(Math.abs(d.cooldown - 1 / 1.5) < 1e-9);
  assert.ok(Math.abs(d.lifesteal - 0.17) < 1e-9);
  assert.ok(Math.abs(d.precision - 0.35) < 1e-9);
  assert.ok(Math.abs(d.thorns - 0.22) < 1e-9);
  const max = Rules.derive({ vitesse_attaque: 999, vol_de_vie: 999, precision: 999, epines: 999 });
  assert.deepStrictEqual([max.cooldown, max.lifesteal, max.precision, max.thorns], [0.4, 0.4, 0.8, 0.5]);
  for (const stat of Rules.STATS) assert.ok(Rules.describeDerived(stat, d));
});

test('coffres : une arme sur deux environ est pour sa classe', () => {
  let own = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) if (game.makeItem('commun', 'arme', { cls: 'mage' }).kind === 'baton') own += 1;
  // 50 % pour sa classe + 50 % × 1/5 au hasard = 60 %
  assert.ok(Math.abs(own / N - 0.6) < 0.04, `${own / N}`);
});

// ---------- Forge ----------

test('forge : fusion de 3 objets de même rareté', () => {
  const c = game.newCharacter();
  game.chooseClass(c, 'archer');
  const items = [0, 1, 2].map(() => game.makeItem('rare'));
  const other = game.makeItem('commun');
  c.inventory.push(...items, other);
  assert.throws(() => game.fuse(c, [items[0].id, items[1].id]), /exactement 3/);
  assert.throws(() => game.fuse(c, [items[0].id, items[1].id, other.id]), /même rareté/);
  assert.throws(() => game.fuse(c, [items[0].id, items[1].id, 'x']), /introuvables/);
  const r = game.fuse(c, items.map((i) => i.id));
  assert.ok(['rare', 'epique'].includes(r.item.rarity));
  assert.strictEqual(r.upgraded, r.item.rarity === 'epique');
  assert.strictEqual(r.chance, 20);
  assert.deepStrictEqual(c.inventory.map((i) => i.id).sort(), [other.id, r.item.id].sort());
  if (r.item.kind) assert.strictEqual(Rules.itemClass(r.item), 'archer');
});

test('forge : taux d\'amélioration selon la rareté et la chance', () => {
  assert.strictEqual(Rules.fuseUpgradeChance('commun', 0), 40);
  assert.strictEqual(Rules.fuseUpgradeChance('epique', 20), 20);
  assert.strictEqual(Rules.fuseUpgradeChance('rare', 999), 45);
  assert.strictEqual(Rules.fuseUpgradeChance('legendaire', 85), 0);
  const c = game.newCharacter();
  let up = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const items = [0, 1, 2].map(() => game.makeItem('commun'));
    c.inventory = items;
    if (game.fuse(c, items.map((x) => x.id)).upgraded) up += 1;
  }
  assert.ok(Math.abs(up / N - 0.4) < 0.04, `${up / N}`);
  c.inventory = [0, 1, 2].map(() => game.makeItem('legendaire'));
  const r = game.fuse(c, c.inventory.map((x) => x.id));
  assert.strictEqual(r.item.rarity, 'legendaire');
  assert.strictEqual(r.upgraded, false);
});

test('forge : relance d\'une ligne', () => {
  const c = game.newCharacter();
  const item = game.makeItem('epique', 'gants');
  c.inventory.push(item);
  assert.throws(() => game.reroll(c, item.id, 0), /80 golds/);
  c.gold = 200;
  assert.throws(() => game.reroll(c, item.id, 9), /Ligne/);
  const before = item.lines.map((l) => l.stat);
  const r = game.reroll(c, item.id, 2);
  assert.strictEqual(c.gold, 120);
  assert.ok(!before.includes(r.line.stat), 'nouvelle stat différente de toutes les lignes');
  assert.strictEqual(new Set(item.lines.map((l) => l.stat)).size, 4);
  assert.ok(r.line.value >= 11 && r.line.value <= 15);
  // Fonctionne aussi sur un objet équipé
  game.equip(c, item.id);
  game.reroll(c, item.id, 0);
  assert.strictEqual(c.gold, 40);
});

// ---------- Combat : nouvelles mécaniques ----------

function testBattle(fighters) {
  const { Battle } = require('../server/battle');
  const b = new Battle();
  b.openQueue(60);
  clearTimeout(b.queueTimer);
  for (const f of fighters) b.join(Object.assign({ level: 1, look: {} }, f));
  b.start();
  b.stopLoop();
  return b;
}
const base = (o = {}) => Object.assign({ maxHp: 1000, damage: 100, reduction: 0, speed: 0, dodge: 0, crit: 0, cooldown: 1, lifesteal: 0, precision: 0, thorns: 0 }, o);

test('combat : vol de vie, épines, précision', () => {
  const b = testBattle([
    { key: 'a', name: 'A', stats: base({ lifesteal: 0.5, precision: 1 }) },
    { key: 'b', name: 'B', stats: base({ thorns: 0.5, dodge: 1 }) },
  ]);
  const [a, t] = b.fighters;
  a.hp = 500;
  b.attack(a, t);
  const hit = b.events.find((e) => e.t === 'hit');
  assert.ok(hit, 'précision 100 % : jamais esquivé');
  // a reçoit 50 % des dégâts en vol de vie puis 50 % en épines : il revient à 500
  const thorns = b.events.find((e) => e.t === 'thorns');
  assert.strictEqual(thorns.dmg, Math.round(hit.dmg * 0.5));
  assert.ok(Math.abs(a.hp - (500 + hit.dmg * 0.5 - thorns.dmg)) < 1e-9);
});

test('combat : explosion du mage', () => {
  const b = testBattle([
    { key: 'm', name: 'M', cls: 'mage', stats: base() },
    { key: 't', name: 'T', stats: base() },
    { key: 'n', name: 'N', stats: base() },
    { key: 'far', name: 'F', stats: base() },
  ]);
  const [m, t, n, far] = b.fighters;
  Object.assign(t, { x: 500, y: 300 });
  Object.assign(n, { x: 540, y: 300 });
  Object.assign(far, { x: 900, y: 300 });
  b.attack(m, t);
  const hits = b.events.filter((e) => e.t === 'hit');
  assert.deepStrictEqual(hits.map((h) => h.to).sort(), ['n', 't']);
  assert.ok(b.events.some((e) => e.t === 'aoe'));
});

test('combat : premier kill, double kill, massacre', () => {
  const fighters = [{ key: 'k', name: 'K', userId: null, stats: base({ damage: 1e6 }) }];
  for (let i = 0; i < 6; i++) fighters.push({ key: 'v' + i, name: 'V' + i, stats: base() });
  const b = testBattle(fighters);
  const streaks = [];
  b.on('streak', (f, kind) => streaks.push(kind));
  const [k, ...victims] = b.fighters;
  b.time = 1; b.attack(k, victims[0]);
  b.time = 3; b.attack(k, victims[1]);
  b.time = 4; b.attack(k, victims[2]);
  b.time = 30; b.attack(k, victims[3]);
  b.time = 60; b.attack(k, victims[4]);
  assert.deepStrictEqual(streaks, ['firstblood', 'double', 'triple', 'massacre']);
  assert.strictEqual(k.kills, 5);
});

test('chance : les bonus d\'équipement s\'ajoutent (même avec 0 point)', () => {
  assert.strictEqual(Rules.derive({ chance: 0 }, { chance: 1 }).luck, 1);
  assert.strictEqual(Rules.derive({ chance: 5 }, { chance: 10 }).luck, 15);
  assert.strictEqual(Rules.formatLine('chance', 3), '+3 Chance');
  assert.strictEqual(Rules.formatLine('vie', 8), '+8% Vie');
  // Effet réel : table de loot et forge
  const c = game.newCharacter();
  const ring = game.makeItem('commun', 'boucles');
  ring.lines = [{ stat: 'chance', value: 3 }];
  c.inventory.push(ring);
  game.equip(c, ring.id);
  assert.strictEqual(game.derived(c).luck, 3);
  assert.strictEqual(game.publicCharacter({ character: c }).lootTable.commun, 87);
  assert.strictEqual(Rules.fuseUpgradeChance('commun', game.derived(c).luck), 41.5);
});
