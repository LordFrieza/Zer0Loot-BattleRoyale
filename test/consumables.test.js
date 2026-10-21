/*
 * Potions et consommables : boutique, emplacement, déclenchements et effets en combat.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, game, db, testBattle, base } = require('./helpers');

const player = (key, extra = {}) => ({ key, name: key, level: 1, look: {}, stats: base(), ...extra });

test('[CON-1] potions : catalogue, prix et déclencheurs', () => {
  const C = Rules.CONSUMABLES;
  assert.deepStrictEqual(Object.keys(C), ['vie', 'berserker', 'defense', 'celerite', 'teleportation', 'invisibilite', 'ronces', 'endurance', 'phenix']);
  assert.deepStrictEqual(Object.values(C).map((c) => c.price), [60, 80, 80, 70, 90, 100, 70, 120, 250]);
  assert.deepStrictEqual(Object.values(C).map((c) => c.trigger), ['hp50', 'hp50', 'hp50', 'engage', 'hp20', 'hp20', 'hp50', 'start', 'death']);
  assert.deepStrictEqual(C.vie.effect, { regen: 0.04, duration: 6 });
  assert.deepStrictEqual(C.berserker.effect, { damage: 1.5, duration: 8 });
  assert.deepStrictEqual(C.defense.effect, { taken: 0.4, duration: 4 });
  assert.deepStrictEqual(C.celerite.effect, { speed: 1.4, attackSpeed: 1.4, duration: 10 });
  assert.deepStrictEqual(C.invisibilite.effect, { invisible: true, duration: 5 });
  assert.deepStrictEqual(C.ronces.effect, { thorns: 0.4, duration: 8 });
  assert.deepStrictEqual(C.endurance.effect, { stamina: 0.5 });
  assert.deepStrictEqual(C.phenix.effect, { revive: 0.3 });
  for (const c of Object.values(C)) assert.ok(Rules.CONSUMABLE_TRIGGERS[c.trigger]);
});

test('[CON-2] potions : achat, quantité bornée, stock maximum', () => {
  const c = game.newCharacter();
  assert.throws(() => game.buyConsumable(c, 'vie'), /60 golds/);
  c.gold = 10000;
  assert.deepStrictEqual(game.buyConsumable(c, 'vie', 3), { price: 180, count: 3 });
  assert.strictEqual(c.gold, 10000 - 180);
  assert.strictEqual(c.consumables.vie, 3);
  assert.deepStrictEqual(game.buyConsumable(c, 'phenix', 0), { price: 250, count: 1 }, 'quantité au moins 1');
  assert.throws(() => game.buyConsumable(c, 'inconnue'), /inconnu/);
  c.gold = 1e6;
  game.buyConsumable(c, 'vie', 96);
  assert.strictEqual(c.consumables.vie, 99);
  assert.throws(() => game.buyConsumable(c, 'vie', 1), /99 exemplaires maximum/);
});

test('[CON-3] potions : un seul emplacement, l\'ancienne potion retourne au stock', () => {
  const c = game.newCharacter();
  assert.throws(() => game.equipConsumable(c, 'vie'), /achète-la/);
  c.consumables = { vie: 1, phenix: 2 };
  game.equipConsumable(c, 'vie');
  assert.strictEqual(c.consumableSlot, 'vie');
  assert.strictEqual(c.consumables.vie, undefined);
  game.equipConsumable(c, 'phenix');
  assert.strictEqual(c.consumableSlot, 'phenix');
  assert.deepStrictEqual(c.consumables, { vie: 1, phenix: 1 });
  game.equipConsumable(c, null);
  assert.strictEqual(c.consumableSlot, null);
  assert.deepStrictEqual(c.consumables, { vie: 1, phenix: 2 });
  assert.throws(() => game.equipConsumable(c, 'nope'), /inconnu/);
});

test('[CON-5, CON-1] potions : déclenchement unique selon la vie, effets temporaires', () => {
  const b = testBattle([player('a', { consumable: 'berserker' }), player('b')]);
  const [a, foe] = b.fighters;
  a.speed = 0; foe.speed = 0; a.cd = 99; foe.cd = 99;
  b.tick(0.05);
  assert.strictEqual(a.potionUsed, false);
  a.hp = a.maxHp * 0.45;
  b.tick(0.05);
  assert.strictEqual(a.potionUsed, true);
  assert.strictEqual(b.buffMult(a, 'damage'), 1.5);
  // Effet limité dans le temps, puis plus rien (une seule fois)
  for (let i = 0; i < 170; i++) b.tick(0.05);
  assert.strictEqual(b.buffMult(a, 'damage'), 1);
  a.hp = a.maxHp * 0.1;
  b.tick(0.05);
  assert.strictEqual(b.buffMult(a, 'damage'), 1);

  // Défense : dégâts subis ×0,4
  const d = testBattle([player('a', { consumable: 'defense' }), player('b')]);
  const [x, y] = d.fighters;
  x.hp = x.maxHp * 0.4;
  d.checkHpPotion(x);
  const hp = x.hp;
  d.hit(y, x, 100);
  assert.strictEqual(hp - x.hp, 40);

  // Célérité : au premier ennemi à portée ; Endurance : au début du combat
  const e = testBattle([player('a', { consumable: 'celerite' }), player('b', { consumable: 'endurance', ult: { id: 'rempart', enhanced: false } })]);
  const [fast, tank] = e.fighters;
  Object.assign(fast, { x: 100, y: 100, speed: 0 });
  Object.assign(tank, { x: 600, y: 100, speed: 0 });
  e.tick(0.05);
  assert.strictEqual(fast.potionUsed, false);
  assert.ok(tank.stamina >= 0.5, 'élixir d\'endurance au début du combat');
  tank.x = 130;
  e.tick(0.05);
  assert.strictEqual(fast.potionUsed, true);
  assert.ok(Math.abs(e.buffMult(fast, 'speed') - 1.4) < 1e-9 && Math.abs(e.buffMult(fast, 'attackSpeed') - 1.4) < 1e-9);
});

test('[CON-6] potions : invisibilité (plus ciblable) et téléportation loin des ennemis', () => {
  const b = testBattle([player('a', { consumable: 'invisibilite' }), player('b')]);
  const [ghost, hunter] = b.fighters;
  Object.assign(ghost, { x: 400, y: 300 });
  Object.assign(hunter, { x: 450, y: 300 });
  ghost.hp = ghost.maxHp * 0.15;
  b.tick(0.05);
  assert.ok(b.isInvisible(ghost));
  b.tick(0.05);
  assert.strictEqual(hunter.targetKey, null, 'personne ne peut le cibler');
  // les dégâts de zone le touchent toujours
  b.zones.push({ kind: 'meteor', owner: hunter, x: 400, y: 300, r: 80, t: 0.01, warn: 0.01, dmg: 10 });
  const hp = ghost.hp;
  b.tick(0.05);
  assert.ok(ghost.hp < hp);

  const t = testBattle([player('a', { consumable: 'teleportation' }), player('b'), player('c')]);
  const [runner, e1, e2] = t.fighters;
  Object.assign(runner, { x: 640, y: 360 });
  Object.assign(e1, { x: 660, y: 360 });
  Object.assign(e2, { x: 620, y: 360 });
  runner.hp = runner.maxHp * 0.1;
  t.checkHpPotion(runner);
  assert.ok(Math.hypot(runner.x - 640, runner.y - 360) > 250, 'téléporté loin du groupe');
});

test('[CON-7] potions : la Plume de phénix évite la mort une fois, sans kill', () => {
  const kills = [];
  const b = testBattle([player('a', { consumable: 'phenix' }), player('b')]);
  b.on('kill', (k, v) => kills.push(v.key));
  const [bird, foe] = b.fighters;
  b.hit(foe, bird, 5000);
  assert.strictEqual(bird.alive, true);
  assert.strictEqual(bird.hp, Math.round(bird.maxHp * 0.3));
  assert.deepStrictEqual(kills, []);
  b.hit(foe, bird, 5000);
  assert.strictEqual(bird.alive, false, 'une seule fois');
  assert.deepStrictEqual(kills, ['a']);
});

test('[CON-8] potions : le stock d\'un fantôme rejoint le compte', () => {
  const ghost = game.getOrCreateTwitchUser('fantome_potion', 'Fantome_Potion');
  ghost.character.consumables = { vie: 2 };
  ghost.character.consumableSlot = 'phenix';
  const user = { id: 'acc_potion', username: 'acc_potion', role: 'player', character: game.newCharacter() };
  user.character.consumables = { vie: 1 };
  db.state.users[user.id] = user;
  game.linkTwitch(user, 'fantome_potion', 'Fantome_Potion');
  assert.deepStrictEqual(user.character.consumables, { vie: 3, phenix: 1 });
});
