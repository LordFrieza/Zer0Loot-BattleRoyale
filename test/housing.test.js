/*
 * Maison : meubles, disposition, styles, agrandissement, niveau de décoration, boîte aux lettres, visites et « J'aime ».
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, game, db } = require('./helpers');
const housing = require('../server/housing');

let n = 0;
function player(emeralds = 0) {
  const id = 'ho' + (++n);
  const c = game.newCharacter();
  c.emeralds = emeralds;
  const user = { id, username: 'Habitant' + n, role: 'player', character: c };
  db.state.users[id] = user;
  return user;
}

test('[HOUSE-1] maison : 47 meubles en 10 catégories, achetés en émeraudes', () => {
  assert.strictEqual(Object.keys(Rules.FURNITURE).length, 47);
  assert.strictEqual(Object.keys(Rules.FURNITURE_CATS).length, 10);
  assert.ok(Object.values(Rules.FURNITURE).every((F) => Rules.FURNITURE_CATS[F.cat] && F.price > 0 && F.deco > 0 && F.w >= 1 && F.h >= 1));
  const u = player(1000);
  const c = u.character;
  assert.throws(() => housing.buyFurniture(c, 'canape'), /4.200 émeraudes/);
  assert.throws(() => housing.buyFurniture(c, 'licorne'), /inconnu/);
  assert.deepStrictEqual(housing.buyFurniture(c, 'chaise', 2), { id: 'chaise', count: 2, cost: 900 });
  assert.deepStrictEqual([c.emeralds, c.house.owned.chaise], [100, 2]);
  c.emeralds = 1e6;
  assert.strictEqual(housing.buyFurniture(c, 'tabouret', 99).count, 10, '10 au plus d\'un coup');
});

test('[HOUSE-2] maison : disposition vérifiée (pièce, mur, tapis, chevauchements, exemplaires possédés)', () => {
  const u = player(1e6);
  const c = u.character;
  for (const id of ['canape', 'tapis', 'tableau', 'chaise', 'lit_double']) housing.buyFurniture(c, id);
  housing.buyFurniture(c, 'chaise');
  const H = c.house;
  const err = (placed) => Rules.houseLayoutError(H, placed);
  assert.strictEqual(err([{ id: 'canape', x: 0, y: 0 }, { id: 'tapis', x: 0, y: 0 }, { id: 'tableau', x: 3, y: -1 }]), null, 'un tapis passe sous un meuble');
  assert.match(err([{ id: 'canape', x: 8, y: 0 }]), /dépasse/);
  assert.match(err([{ id: 'lit_double', x: 0, y: 5 }]), /dépasse/);
  assert.match(err([{ id: 'tableau', x: 0, y: 2 }]), /mur/);
  assert.match(err([{ id: 'chaise', x: 0, y: -1 }]), /dépasse/);
  assert.match(err([{ id: 'canape', x: 0, y: 0 }, { id: 'chaise', x: 1, y: 0 }]), /chevauche/);
  assert.match(err([{ id: 'chaise', x: 0, y: 0 }, { id: 'chaise', x: 1, y: 0 }, { id: 'chaise', x: 2, y: 0 }]), /pas assez/);
  assert.match(err([{ id: 'trone', x: 0, y: 0 }]), /pas assez/);
  assert.throws(() => housing.saveLayout(c, [{ id: 'canape', x: 8, y: 0 }]), /dépasse/);
  assert.deepStrictEqual(H.placed, []);
  const r = housing.saveLayout(c, [{ id: 'canape', x: 0, y: 0, flip: true }, { id: 'tapis', x: 0, y: 0 }]);
  assert.strictEqual(r.placed.length, 2);
  assert.strictEqual(H.placed[0].flip, true);
});

test('[HOUSE-3] maison : options achetées une fois, agrandissement studio → maison → manoir', () => {
  const u = player(20000);
  const c = u.character;
  assert.strictEqual(c.house.style.murs, 'blanc');
  assert.strictEqual(housing.setStyle(c, 'murs', 'brique').cost, 3500);
  assert.strictEqual(c.emeralds, 16500);
  housing.setStyle(c, 'murs', 'blanc');
  assert.strictEqual(housing.setStyle(c, 'murs', 'brique').cost, 0, 'déjà achetée : gratuite');
  assert.throws(() => housing.setStyle(c, 'toit', 'licorne'), /inconnue/);
  assert.throws(() => housing.setStyle(c, 'toit', 'or'), /60.000 émeraudes/);
  assert.deepStrictEqual(housing.upgradeSize(c).size, 'maison');
  assert.strictEqual(c.emeralds, 4500);
  assert.throws(() => housing.upgradeSize(c), /90.000/);
  c.emeralds = 90000;
  housing.upgradeSize(c);
  assert.throws(() => housing.upgradeSize(c), /déjà un manoir/);
  assert.deepStrictEqual([Rules.HOUSING.sizes.manoir.cols, Rules.HOUSING.sizes.manoir.rows], [17, 10]);
});

test('[HOUSE-4] maison : points de déco et niveaux, record de niveau', () => {
  assert.deepStrictEqual([1, 2, 5, 10, 20].map(Rules.houseLevelPoints), [20, 65, 310, 1000, 3255]);
  assert.deepStrictEqual(Rules.houseLevel(0), { level: 0, points: 0, cur: 0, next: 20 });
  assert.strictEqual(Rules.houseLevel(320).level, 5);
  assert.strictEqual(Rules.houseLevel(99999).level, Rules.HOUSING.maxLevel);
  const u = player(1e6);
  const c = u.character;
  housing.buyFurniture(c, 'trone');
  housing.saveLayout(c, [{ id: 'trone', x: 0, y: 0 }]);
  housing.setStyle(c, 'murs', 'brique');
  housing.upgradeSize(c);
  assert.strictEqual(Rules.houseDeco(c.house), 85 + Math.round(3500 / 350) + 40);
  const L = housing.levelOf(c);
  assert.strictEqual(L.level, Rules.houseLevel(135).level);
  assert.strictEqual(c.counters.decoLevel, L.level);
  assert.ok(Rules.MAX_COUNTERS.includes('decoLevel') && Rules.achievementById('deco15'));
});

test('[HOUSE-5] maison : boîte aux lettres (toutes les 6 h, 4 au plus, contenu selon le niveau)', () => {
  const H = 3600 * 1000;
  assert.strictEqual(Rules.houseMailDue(0, 5 * H), 0);
  assert.strictEqual(Rules.houseMailDue(0, 13 * H), 2);
  assert.strictEqual(Rules.houseMailDue(0, 100 * H), 4);
  assert.deepStrictEqual(Rules.houseMailContent(0), { gold: 180, chests: 0, keyChance: 0, emeralds: 0, potionChance: 0.5 });
  assert.deepStrictEqual(Rules.houseMailContent(5), { gold: 780, chests: 0.6, keyChance: 0.09, emeralds: 30, potionChance: 0.5 });
  assert.deepStrictEqual(Rules.houseMailContent(20), { gold: 2580, chests: 2.4, keyChance: 0.54, emeralds: 120, potionChance: 0.5 });
  assert.strictEqual(Rules.houseMailContent(2).keyChance, 0, 'clés dès le niveau 3');
  const u = player();
  const c = u.character;
  c.house.mailAt = 1000;
  assert.throws(() => housing.collectMail(c, 1000 + 5 * H), /vide/);
  const gold = c.gold;
  const r = housing.collectMail(c, 1000 + 13 * H);
  assert.strictEqual(r.letters, 2);
  assert.strictEqual(c.gold, gold + 2 * 180);
  assert.strictEqual(c.house.mailAt, 1000 + 12 * H, 'l\'heure entamée vers le courrier suivant est gardée');
  // Après une longue absence : 4 courriers, et pas de nouveau tout de suite
  c.house.mailAt = 0;
  const now = 200 * H;
  assert.strictEqual(housing.collectMail(c, now).letters, 4);
  assert.strictEqual(Rules.houseMailDue(c.house.mailAt, now), 0);
  // Maison très décorée : la partie entière des coffres est garantie à chaque courrier
  const rich = player(1e8).character;
  rich.house.size = 'manoir';
  const ids = Object.keys(Rules.FURNITURE).filter((id) => !Rules.FURNITURE[id].wall);
  for (const id of ids) housing.buyFurniture(rich, id);
  const L = housing.levelOf(rich).level;
  rich.house.mailAt = 0;
  const M = Rules.houseMailContent(L);
  const before = rich.chests;
  const got = housing.collectMail(rich, 200 * H);
  assert.ok(rich.chests - before >= Math.floor(M.chests) * got.letters, `niveau ${L} : ${rich.chests - before} coffres`);
  assert.strictEqual(got.emeralds, M.emeralds * got.letters);
});

test('[HOUSE-6] maison : liste des maisons, visites, « J\'aime »', () => {
  const a = player(1e6);
  const b = player();
  housing.buyFurniture(a.character, 'fontaine');
  housing.saveLayout(a.character, [{ id: 'fontaine', x: 0, y: 0 }]);
  const list = housing.listHouses();
  assert.ok(list.findIndex((h) => h.id === a.id) < list.findIndex((h) => h.id === b.id), 'les plus décorées d\'abord');
  assert.deepStrictEqual(housing.listHouses(a.username).map((h) => h.id), [a.id]);
  const withLook = housing.listHouses(a.username, () => ({ color: 'rouge' }), () => ({ arme: 'rare' }))[0];
  assert.deepStrictEqual([withLook.cls, withLook.app, withLook.look], [a.character.cls, { color: 'rouge' }, { arme: 'rare' }], 'apparence pour les passants');
  const ghost = player();
  ghost.ghost = true;
  assert.ok(!housing.listHouses().some((h) => h.id === ghost.id), 'sans les fantômes');
  housing.visit(a, b);
  housing.visit(a, a);
  assert.strictEqual(a.character.house.visits, 1, 'sa propre visite ne compte pas');
  const view = housing.publicHouse(a, b, () => ({}), () => ({}));
  assert.deepStrictEqual([view.name, view.placed.length, view.mine, view.liked], [a.username, 1, false, false]);
  assert.deepStrictEqual(housing.toggleLike(b, a.id), { liked: true, likes: 1 });
  assert.deepStrictEqual(housing.toggleLike(b, a.id), { liked: false, likes: 0 });
  assert.throws(() => housing.toggleLike(a, a.id), /propre maison/);
  assert.throws(() => housing.toggleLike(b, 'personne'), /introuvable/);
});
