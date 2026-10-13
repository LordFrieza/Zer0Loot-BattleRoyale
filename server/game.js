/*
 * Logique des personnages : progression, coffres, équipement.
 */
const crypto = require('crypto');
const Rules = require('../shared/rules');
const db = require('./db');

function emptyLootStats() {
  return { commun: 0, peu_commun: 0, rare: 0, epique: 0, legendaire: 0 };
}

// Anciennes armes (avant les classes) : l'épée et le bouclier deviennent des objets de Guerrier.
const LEGACY_SLOTS = { epee: { slot: 'arme', kind: 'epee' }, bouclier: { slot: 'secondaire', kind: 'bouclier' } };

function migrateItem(item) {
  const legacy = item && LEGACY_SLOTS[item.slot];
  if (legacy) Object.assign(item, legacy);
  return item;
}

// Anciennes sauvegardes : ajoute les champs apparus depuis.
function upgrade(character) {
  if (!character.lootStats) character.lootStats = emptyLootStats();
  // Stats ajoutées après la création du personnage (Critique, Vitesse d'attaque…).
  character.stats = Object.assign(Rules.emptyStats(), character.stats);
  if (character.cls === undefined) character.cls = null;
  if (character.migratedSlots !== 2) {
    character.inventory.forEach(migrateItem);
    for (const [slot, item] of Object.entries(character.equipment)) {
      if (!item) continue;
      migrateItem(item);
      if (item.slot !== slot) {
        delete character.equipment[slot];
        character.equipment[item.slot] = item;
      }
    }
    character.migratedSlots = 2;
  }
  return character;
}

function newCharacter() {
  return {
    level: 1,
    xp: 0,
    skillPoints: 0,
    cls: null, // classe choisie à la première visite
    stats: Rules.emptyStats(),
    gold: 0,
    chests: 0,
    inventory: [],
    equipment: {},
    record: { battles: 0, kills: 0, wins: 0 },
    lootStats: emptyLootStats(),
  };
}

function gearBonus(character) {
  const pct = Rules.emptyStats();
  for (const item of Object.values(character.equipment)) {
    if (!item) continue;
    for (const line of item.lines) pct[line.stat] += line.value;
  }
  return pct;
}

function derived(character) {
  upgrade(character);
  return Rules.derive(character.stats, gearBonus(character), character.cls);
}

function addXp(character, amount) {
  character.xp += amount;
  let levels = 0;
  while (character.xp >= Rules.xpToNext(character.level)) {
    character.xp -= Rules.xpToNext(character.level);
    character.level += 1;
    character.skillPoints += 1;
    levels += 1;
  }
  return levels;
}

function grant(character, reward) {
  const levels = addXp(character, reward.xp);
  character.gold += reward.gold;
  character.chests += reward.chests;
  return levels;
}

function allocate(character, stat) {
  if (!Rules.STATS.includes(stat)) throw new Error('Stat inconnue');
  if (character.skillPoints <= 0) throw new Error('Aucun point de compétence disponible');
  upgrade(character);
  character.skillPoints -= 1;
  character.stats[stat] += 1;
}

// Générateur cryptographique : tirages équitables et imprévisibles.
function random() {
  return crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

function rand(min, max) {
  return crypto.randomInt(min, max + 1);
}

function rollRarity(luck) {
  const table = Rules.lootTable(luck);
  let r = random() * 100;
  for (const rarity of Rules.RARITIES) {
    r -= table[rarity];
    if (r < 0) return rarity;
  }
  return 'commun';
}

function weightedPick(weights) {
  const entries = Object.entries(weights);
  let r = random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [key, w] of entries) {
    r -= w;
    if (r < 0) return key;
  }
  return entries[entries.length - 1][0];
}

function pick(list) {
  return list[rand(0, list.length - 1)];
}

/*
 * Crée un objet. Pour une arme / un objet secondaire, le type (épée, arc…) décide de la classe
 * qui peut l'équiper : `kind` l'impose, sinon il est tiré au hasard, avec 1 chance sur 2
 * (OWN_CLASS_KIND_CHANCE) d'être pour la classe `cls` du joueur.
 */
function makeItem(rarity, slot, opts = {}) {
  slot = slot || pick(Rules.SLOTS);
  let kind = null;
  if (Rules.KINDS_BY_SLOT[slot]) {
    const own = opts.cls && Rules.CLASS_INFO[opts.cls] && (slot === 'arme' ? Rules.CLASS_INFO[opts.cls].weapon : Rules.CLASS_INFO[opts.cls].offhand);
    kind = opts.kind || (own && random() < (opts.ownChance ?? Rules.OWN_CLASS_KIND_CHANCE) ? own : pick(Rules.KINDS_BY_SLOT[slot]));
  }
  const info = Rules.RARITY_INFO[rarity];
  const item = { id: crypto.randomUUID(), slot, rarity, lines: [] };
  if (kind) item.kind = kind;
  const weights = Object.assign({}, Rules.itemWeights(item));
  for (let i = 0; i < info.lines; i++) {
    const stat = weightedPick(weights);
    delete weights[stat];
    item.lines.push({ stat, value: rand(info.min, info.max) });
  }
  item.base = pick(kind ? Rules.KINDS[kind].names : Rules.SLOT_INFO[slot].names);
  item.name = itemName(item);
  return item;
}

function itemName(item) {
  return [item.base, Rules.RARITY_PREFIX[item.rarity], Rules.STAT_SUFFIX[item.lines[0].stat]].filter(Boolean).join(' ');
}

function openChest(character) {
  if (character.chests <= 0) throw new Error('Aucun coffre à ouvrir');
  character.chests -= 1;
  const luck = derived(character).luck;
  const items = [];
  for (let i = 0; i < Rules.ITEMS_PER_CHEST; i++) items.push(makeItem(rollRarity(luck), null, { cls: character.cls }));
  character.inventory.push(...items);
  upgrade(character);
  for (const it of items) character.lootStats[it.rarity] += 1;
  const best = items.reduce((b, it) => Math.max(b, Rules.RARITIES.indexOf(it.rarity)), 0);
  const bestRarity = Rules.RARITIES[best];
  return { items, bestRarity, clicks: Rules.RARITY_INFO[bestRarity].clicks };
}

function buyChests(character, count) {
  count = Math.max(1, Math.floor(count || 1));
  const cost = count * Rules.CHEST_PRICE;
  if (character.gold < cost) throw new Error('Pas assez de golds');
  character.gold -= cost;
  character.chests += count;
}

// Recyclage : chaque objet du coffre personnel rapporte Rules.RECYCLE_GOLD, quelle que soit sa rareté.
function recycle(character, itemIds) {
  if (!Array.isArray(itemIds) || itemIds.length === 0) throw new Error('Aucun objet sélectionné');
  const ids = new Set(itemIds);
  const before = character.inventory.length;
  character.inventory = character.inventory.filter((i) => !ids.has(i.id));
  const count = before - character.inventory.length;
  if (count === 0) throw new Error('Objets introuvables');
  character.gold += count * Rules.RECYCLE_GOLD;
  return { recycled: count, gold: count * Rules.RECYCLE_GOLD };
}

function equip(character, itemId) {
  upgrade(character);
  const idx = character.inventory.findIndex((i) => i.id === itemId);
  if (idx < 0) throw new Error('Objet introuvable');
  const item = character.inventory[idx];
  if (!Rules.canEquip(item, character.cls)) {
    throw new Error(`Réservé à la classe ${Rules.CLASS_INFO[Rules.itemClass(item)].label}`);
  }
  character.inventory.splice(idx, 1);
  const previous = character.equipment[item.slot];
  if (previous) character.inventory.push(previous);
  character.equipment[item.slot] = item;
}

// ---------- Classes ----------

// Première classe gratuite, puis changement payant. Les objets incompatibles retournent au coffre.
function chooseClass(character, cls) {
  upgrade(character);
  if (!Rules.CLASSES.includes(cls)) throw new Error('Classe inconnue');
  if (character.cls === cls) throw new Error('Tu as déjà cette classe');
  const cost = character.cls ? Rules.CLASS_CHANGE_PRICE : 0;
  if (character.gold < cost) throw new Error(`Changer de classe coûte ${cost} golds`);
  character.gold -= cost;
  character.cls = cls;
  let unequipped = 0;
  for (const [slot, item] of Object.entries(character.equipment)) {
    if (item && !Rules.canEquip(item, cls)) {
      delete character.equipment[slot];
      character.inventory.push(item);
      unequipped += 1;
    }
  }
  return { cost, unequipped };
}

// ---------- Forge ----------

/*
 * Fusion : détruit 3 objets de même rareté du coffre personnel et crée un nouvel objet
 * (arme / secondaire toujours pour la classe du joueur). Il peut monter d'une rareté
 * selon Rules.fuseUpgradeChance (rareté + chance du joueur).
 */
function fuse(character, itemIds) {
  upgrade(character);
  const ids = [...new Set(Array.isArray(itemIds) ? itemIds : [])];
  if (ids.length !== Rules.FUSE_COUNT) throw new Error(`Sélectionne exactement ${Rules.FUSE_COUNT} objets`);
  const items = ids.map((id) => character.inventory.find((i) => i.id === id));
  if (items.some((i) => !i)) throw new Error('Objets introuvables dans ton coffre personnel');
  const rarity = items[0].rarity;
  if (items.some((i) => i.rarity !== rarity)) throw new Error('Les 3 objets doivent être de la même rareté');
  const chance = Rules.fuseUpgradeChance(rarity, derived(character).luck);
  const upgraded = random() * 100 < chance;
  const resultRarity = upgraded ? Rules.RARITIES[Rules.RARITIES.indexOf(rarity) + 1] : rarity;
  character.inventory = character.inventory.filter((i) => !ids.includes(i.id));
  const item = makeItem(resultRarity, null, { cls: character.cls, ownChance: 1 });
  character.inventory.push(item);
  return { item, upgraded, chance, from: rarity };
}

function findItem(character, itemId) {
  return character.inventory.find((i) => i.id === itemId)
    || Object.values(character.equipment).find((i) => i && i.id === itemId)
    || null;
}

/*
 * Relance : remplace une ligne de l'objet par une autre stat au hasard (différente de toutes
 * les lignes de l'objet), avec une nouvelle valeur dans la fourchette de sa rareté.
 */
function reroll(character, itemId, lineIndex) {
  upgrade(character);
  const item = findItem(character, itemId);
  if (!item) throw new Error('Objet introuvable');
  const index = Number(lineIndex);
  if (!Number.isInteger(index) || !item.lines[index]) throw new Error('Ligne introuvable');
  const price = Rules.REROLL_PRICE[item.rarity];
  if (character.gold < price) throw new Error(`La relance coûte ${price} golds`);
  const weights = Object.assign({}, Rules.itemWeights(item));
  for (const l of item.lines) delete weights[l.stat];
  if (!Object.keys(weights).length) throw new Error('Aucune autre stat possible');
  character.gold -= price;
  const info = Rules.RARITY_INFO[item.rarity];
  const old = item.lines[index];
  const line = { stat: weightedPick(weights), value: rand(info.min, info.max) };
  item.lines[index] = line;
  if (index === 0 && item.base) item.name = itemName(item);
  return { item, line, old, price };
}

function unequip(character, slot) {
  const item = character.equipment[slot];
  if (!item) throw new Error('Rien d\'équipé à cet emplacement');
  delete character.equipment[slot];
  character.inventory.push(item);
}

/*
 * Un viewer qui tape !join sans compte sur le site obtient un personnage
 * « fantôme » rattaché à son pseudo Twitch. Il le récupère en liant son compte.
 */
function getOrCreateTwitchUser(login, displayName) {
  login = login.toLowerCase();
  let user = db.findUserByTwitch(login);
  if (!user) {
    const id = db.newId();
    user = {
      id,
      username: displayName || login,
      passwordHash: null,
      role: 'player',
      ghost: true,
      twitchLogin: login,
      twitchDisplayName: displayName || login,
      createdAt: Date.now(),
      character: newCharacter(),
    };
    db.state.users[id] = user;
    db.save();
  }
  return user;
}

// Rattache un personnage fantôme à un vrai compte (gains cumulés).
function absorbGhost(user, ghost) {
  const c = user.character;
  const g = ghost.character;
  const totalXp = g.xp + Array.from({ length: g.level - 1 }, (_, i) => Rules.xpToNext(i + 1)).reduce((a, b) => a + b, 0);
  addXp(c, totalXp);
  c.gold += g.gold;
  c.chests += g.chests;
  upgrade(g);
  c.inventory.push(...g.inventory, ...Object.values(g.equipment));
  c.record.battles += g.record.battles;
  c.record.kills += g.record.kills;
  c.record.wins += g.record.wins;
  upgrade(c);
  upgrade(g);
  for (const r of Object.keys(c.lootStats)) c.lootStats[r] += g.lootStats[r];
  delete db.state.users[ghost.id];
}

function linkTwitch(user, login, displayName, twitchId) {
  login = login.toLowerCase();
  const existing = db.findUserByTwitch(login);
  if (existing && existing.id !== user.id) {
    if (!existing.ghost) throw new Error('Ce compte Twitch est déjà lié à un autre compte');
    absorbGhost(user, existing);
  }
  user.twitchLogin = login;
  user.twitchDisplayName = displayName || login;
  if (twitchId) user.twitchId = twitchId;
  db.save();
}

function publicCharacter(user) {
  const c = upgrade(user.character);
  const d = derived(c);
  return {
    ...c,
    classInfo: c.cls ? Rules.CLASS_INFO[c.cls] : null,
    xpToNext: Rules.xpToNext(c.level),
    gear: gearBonus(c),
    derived: d,
    lootTable: Rules.lootTable(d.luck),
  };
}

module.exports = {
  newCharacter, upgrade, gearBonus, derived, addXp, grant, allocate, rollRarity, makeItem,
  openChest, buyChests, recycle, equip, unequip, chooseClass, fuse, reroll,
  getOrCreateTwitchUser, linkTwitch, publicCharacter,
};
