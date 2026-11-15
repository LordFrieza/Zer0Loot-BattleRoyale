/*
 * Familiers : obtention (5 % par boss), enclos, besoins, trouvailles, soins, niveaux, épicerie, compagnon de combat.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, game, Battle } = require('./helpers');

const H = 3600 * 1000;
const D = 24 * H;

function withPet(species = 'dragon', at = 0) {
  const c = game.newCharacter();
  game.addPet(c, species, at);
  return c;
}

test('[PET-1] familier : 5 % de chance par boss vaincu, doublon = XP et festin', () => {
  assert.strictEqual(Rules.PET.dropChance, 0.05);
  assert.deepStrictEqual(Object.keys(Rules.PETS), Object.keys(Rules.BOSSES), 'une espèce par boss');
  const c = game.newCharacter();
  assert.strictEqual(game.rollPetDrop(c, 'troll', 0), null, 'tirage raté');
  assert.strictEqual(c.pets.list.length, 0);
  const r = game.rollPetDrop(c, 'troll', 1);
  assert.deepStrictEqual([r.duplicate, r.pet.species, r.pet.name, r.pet.level], [false, 'troll', 'Mini Grokk', 1]);
  assert.strictEqual(c.pets.active, 'troll', 'le premier devient principal');
  assert.strictEqual(c.counters.pets, 1);
  const again = game.rollPetDrop(c, 'troll', 1);
  assert.strictEqual(again.duplicate, true);
  assert.strictEqual(c.pets.list.length, 1);
  assert.strictEqual(c.pets.food.festin, 1);
  assert.ok(c.pets.list[0].level > 1 || c.pets.list[0].xp === Rules.PET.duplicateXp, '+150 XP');
  assert.strictEqual(game.rollPetDrop(c, 'licorne', 1), null);
  // Sur 20 000 tirages, environ 5 %
  let n = 0;
  for (let i = 0; i < 20000; i++) { const x = game.newCharacter(); if (game.rollPetDrop(x, 'dragon')) n++; }
  assert.ok(Math.abs(n / 20000 - 0.05) < 0.01, `${n}`);
  // L'admin peut en donner un
  const g = game.newCharacter();
  assert.strictEqual(game.adminGive(g, { pet: 'liche' }).pet, 'liche');
  assert.strictEqual(game.adminGive(g, { pet: 'random' }).duplicate, false, 'une espèce pas encore obtenue');
});

test('[PET-2] enclos : anciennes sauvegardes, familier principal, fusion d\'un fantôme', () => {
  const old = game.newCharacter();
  delete old.pets;
  game.upgrade(old);
  assert.deepStrictEqual(old.pets, { list: [], active: null, follow: null, food: {}, enclos: [] });
  const c = withPet('troll');
  game.addPet(c, 'mimic');
  assert.strictEqual(c.pets.active, 'troll');
  game.setActivePet(c, 'mimic');
  assert.strictEqual(c.pets.active, 'mimic');
  assert.throws(() => game.setActivePet(c, 'dragon'), /introuvable/);
  // Fusion d'un fantôme : espèces réunies (la plus avancée en cas de doublon), provisions et objets réunis
  const db = require('../server/db');
  const ghost = withPet('troll');
  ghost.pets.list[0].level = 7;
  game.addPet(ghost, 'liche');
  ghost.pets.food = { eau: 2, gigot: 1 };
  ghost.pets.enclos = ['niche'];
  db.state.users.gx = { id: 'gx', ghost: true, twitchLogin: 'ghost_gx', role: 'player', character: ghost };
  const owner = { id: 'ox', username: 'ox', role: 'player', character: withPet('troll') };
  owner.character.pets.food = { eau: 3 };
  db.state.users.ox = owner;
  game.linkTwitch(owner, 'ghost_gx', 'Ghost');
  assert.deepStrictEqual(owner.character.pets.list.map((p) => [p.species, p.level]).sort(), [['liche', 1], ['troll', 7]]);
  assert.deepStrictEqual(owner.character.pets.food, { eau: 5, gigot: 1 });
  assert.deepStrictEqual(owner.character.pets.enclos, ['niche']);
  assert.strictEqual(owner.character.pets.active, 'troll');
});

test('[PET-3] besoins : le principal a faim, soif et envie de jouer ; les autres se reposent', () => {
  const c = withPet('dragon', 0);
  game.addPet(c, 'troll', 0);
  game.petsTick(c, 10 * H);
  const [dragon, troll] = c.pets.list;
  assert.deepStrictEqual(dragon.needs, { faim: 80 - 20, soif: 80 - 25, joie: 80 - 15 });
  assert.deepStrictEqual(troll.needs, Rules.PET.start, 'au repos : rien ne bouge');
  assert.strictEqual(Rules.petSatisfaction(dragon.needs), 60);
  // Objets d'enclos : la baisse ralentit
  const d = withPet('dragon', 0);
  d.pets.enclos = ['gamelle', 'fontaine'];
  game.petsTick(d, 10 * H);
  assert.deepStrictEqual(d.pets.list[0].needs, { faim: 80 - 20 * 0.65, soif: 80 - 25 * 0.65, joie: 80 - 15 });
  // Jamais sous zéro ; la même fonction pure côté navigateur
  const r = Rules.petAdvance({ level: 1, needs: { faim: 10, soif: 10, joie: 10 }, at: 0, finds: 0 }, [], 100 * H, true);
  assert.deepStrictEqual(r.pet.needs, { faim: 0, soif: 0, joie: 0 });
  // Un familier au repos reprend son attente là où elle s'était arrêtée
  const rest = Rules.petAdvance({ level: 1, needs: { faim: 50, soif: 50, joie: 50 }, at: 0, findAt: 2 * H, finds: 0 }, [], 5 * H, false);
  assert.strictEqual(rest.pet.findAt, 7 * H);
});

test('[PET-4] trouvailles : toutes les 4 h si satisfait (3 au plus), selon l\'espèce', () => {
  assert.strictEqual(Rules.petFindEvery(1), 4 * H);
  assert.strictEqual(Rules.petFindEvery(11), 4 * H * 0.75);
  assert.strictEqual(Rules.petFindEvery(40), 4 * H * 0.5, '×0,5 au plus');
  assert.strictEqual(Rules.petFindEvery(1, Rules.petEnclosEffects(['niche'])), 4 * H * 0.85);
  const c = withPet('dragon', 0);
  game.petsTick(c, 8.5 * H);
  assert.strictEqual(c.pets.list[0].finds, 2);
  game.petsTick(c, 40 * H);
  assert.strictEqual(c.pets.list[0].finds, Rules.PET.maxFinds, '3 en attente au plus');
  // Trop malheureux : rien
  const sad = Rules.petAdvance({ level: 1, needs: { faim: 20, soif: 20, joie: 20 }, at: 0, finds: 0 }, [], 9 * H, true);
  assert.strictEqual(sad.pet.finds, 0);
  // Récupération : golds du dragon (50 + 15 × niveau, ×1,25 avec la statue)
  const gold = c.gold;
  const r = game.collectFinds(c, 40 * H);
  assert.strictEqual(r.gifts.length, 3);
  assert.strictEqual(c.gold - gold, 3 * Rules.petFindValue('dragon', 1));
  assert.strictEqual(Rules.petFindValue('dragon', 1, Rules.petEnclosEffects(['statue'])), Math.round(65 * 1.25));
  assert.strictEqual(c.counters.petFinds, 3);
  assert.throws(() => game.collectFinds(c, 40 * H), /Aucune trouvaille/);
  // Chaque espèce
  const kinds = {};
  for (const sp of Object.keys(Rules.PETS)) {
    const x = withPet(sp, 0);
    x.pets.list[0].finds = 1;
    x.pets.list[0].at = Date.now();
    kinds[sp] = game.collectFinds(x).gifts[0];
  }
  assert.strictEqual(kinds.troll.kind, 'item');
  assert.strictEqual(kinds.troll.item.slot, 'arme');
  assert.strictEqual(kinds.troll.item.isNew, true);
  assert.strictEqual(kinds.dragon.kind, 'gold');
  assert.strictEqual(kinds.sorcier.kind, 'xp');
  assert.strictEqual(kinds.sorcier.xp, Rules.petFindValue('sorcier', 1));
  assert.ok(kinds.mimic.kind === 'chest' && kinds.mimic.chests >= 1);
  assert.ok(kinds.liche.kind === 'potion' && Rules.CONSUMABLES[kinds.liche.potion]);
  assert.ok(kinds.maexxna.kind === 'item' && !['arme', 'secondaire'].includes(kinds.maexxna.item.slot));
});

test('[PET-5, PET-6] soins : caresser, jouer (recharges), nourrir (plat préféré) ; niveaux', () => {
  const t0 = 1e12;
  const c = withPet('troll', t0);
  const pet = c.pets.list[0];
  const r = game.petAction(c, 'caresser', t0);
  assert.strictEqual(pet.needs.joie, 90);
  assert.strictEqual(pet.xp, 5);
  assert.strictEqual(r.levels, 0);
  assert.throws(() => game.petAction(c, 'caresser', t0 + 10 * 60000), /réessaie dans 20 min/);
  game.petAction(c, 'caresser', t0 + 31 * 60000);
  game.petAction(c, 'jouer', t0 + 31 * 60000);
  assert.ok(pet.needs.joie === 100 && pet.needs.faim < 80 - 8 + 0.1);
  assert.throws(() => game.petAction(c, 'jouer', t0 + 60 * 60000), /1 h/);
  assert.throws(() => game.petAction(c, 'danser', t0), /inconnue/);
  // Lanternes : caresse +5
  const d = withPet('troll', t0);
  d.pets.enclos.push('lanternes');
  d.pets.list[0].needs.joie = 50;
  game.petAction(d, 'caresser', t0);
  assert.strictEqual(d.pets.list[0].needs.joie, 65);
  // Nourrir : stock obligatoire, plat préféré ×1,5
  assert.throws(() => game.feedPet(c, 'gigot', t0 + 32 * 60000), /Plus de Gigot/);
  c.pets.food = { gigot: 1, croquettes: 1 };
  pet.needs.faim = 0;
  const f = game.feedPet(c, 'gigot', t0 + 32 * 60000);
  assert.strictEqual(f.favorite, true, 'le gigot est le plat préféré du Troll');
  assert.ok(Math.abs(pet.needs.faim - 65 * 1.5) < 0.2);
  assert.strictEqual(c.pets.food.gigot, 0);
  pet.needs.faim = 10;
  assert.strictEqual(game.feedPet(c, 'croquettes', t0 + 32 * 60000).favorite, false);
  assert.ok(Math.abs(pet.needs.faim - 40) < 0.2);
  // Sans familier
  assert.throws(() => game.petAction(game.newCharacter(), 'caresser'), /pas encore de familier/);
  // Niveaux : 40 + 20 × niveau XP, 20 au plus
  assert.strictEqual(Rules.petXpToNext(1), 60);
  const p = { level: 1, xp: 0 };
  assert.strictEqual(game.petGainXp(p, 60 + 80 + 10), 2);
  assert.deepStrictEqual(p, { level: 3, xp: 10 });
  game.petGainXp(p, 1e6);
  assert.deepStrictEqual(p, { level: Rules.PET.maxLevel, xp: 0 });
});

test('[PET-7] épicerie et objets d\'enclos', () => {
  const c = withPet('troll');
  assert.deepStrictEqual(Object.values(Rules.PET_FOODS).map((f) => f.price), [36, 105, 270, 18, 90]);
  assert.deepStrictEqual(Object.values(Rules.PET_ENCLOS).map((e) => e.price), [600, 1200, 2400, 2400, 3000, 3600, 4800, 10000]);
  c.gold = 300;
  assert.deepStrictEqual(game.buyPetFood(c, 'croquettes', 5), { food: 'croquettes', count: 5, cost: 180 });
  assert.strictEqual(c.gold, 120);
  assert.throws(() => game.buyPetFood(c, 'festin', 2), /540 golds/);
  assert.throws(() => game.buyPetFood(c, 'caviar'), /inconnu/);
  c.pets.food.eau = 98;
  assert.throws(() => game.buyPetFood(c, 'eau', 2), /99 au plus/);
  c.gold = 2500;
  game.buyEnclos(c, 'gamelle');
  assert.deepStrictEqual([c.gold, c.pets.enclos], [100, ['gamelle']]);
  assert.throws(() => game.buyEnclos(c, 'gamelle'), /déjà/);
  assert.throws(() => game.buyEnclos(c, 'statue'), /10000 golds/);
  assert.deepStrictEqual(Rules.petEnclosEffects(['gamelle', 'jouets', 'lanternes']), { faim: 0.65, soif: 1, joie: 0.7, find: 1, reward: 1, caress: 5, play: 10 });
});

test('[PET-8] compagnon de combat : 3 jours au-dessus de 80 %, puis il suit son héros dans l\'arène', () => {
  const c = withPet('mimic', 0);
  c.pets.enclos = ['gamelle', 'fontaine', 'jouets', 'mare', 'fleurs'];
  const pet = c.pets.list[0];
  pet.needs = { faim: 100, soif: 100, joie: 100 };
  assert.throws(() => game.setPetFollow(withPet('mimic'), 'mimic'), /pas encore prêt/);
  // Soins réguliers pendant 3 jours (toutes les 6 h on remet tout à 100)
  for (let t = 6 * H; t <= 3 * D + 6 * H; t += 6 * H) {
    game.petsTick(c, t);
    pet.needs = { faim: 100, soif: 100, joie: 100 };
  }
  assert.strictEqual(c.pets.list[0].follower, true);
  assert.strictEqual(c.counters.petFollowers, 1);
  game.setPetFollow(c, 'mimic');
  assert.strictEqual(c.pets.follow, 'mimic');
  game.setPetFollow(c, null);
  assert.strictEqual(c.pets.follow, null);
  // Une chute sous 80 % remet la série à zéro
  const r = Rules.petAdvance({ level: 1, needs: { faim: 85, soif: 85, joie: 85 }, at: 0, finds: 0, streakAt: 0 }, [], 2 * D, true);
  assert.strictEqual(r.pet.streakAt, null);
  assert.strictEqual(r.pet.follower, undefined);
  // Le compagnon apparaît dans les frames (cosmétique)
  const b = new Battle();
  b.openQueue(60, 'boss');
  clearTimeout(b.queueTimer);
  b.join({ key: 'u1', name: 'A', level: 1, cls: 'guerrier', stats: Rules.derive({}, {}, 'guerrier'), look: {}, pet: 'mimic' });
  b.start(null, null);
  b.stopLoop();
  assert.strictEqual(b.frame().fighters.find((f) => f.key === 'u1').pet, 'mimic');
});
