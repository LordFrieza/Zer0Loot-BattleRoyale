/*
 * Logique des personnages : progression, coffres, équipement.
 */
const crypto = require('crypto');
const Rules = require('../shared/rules');
const db = require('./db');

function emptyLootStats() {
  return { commun: 0, peu_commun: 0, rare: 0, epique: 0, legendaire: 0 };
}

// Anciennes sauvegardes : ajoute les champs apparus depuis.
function upgrade(character) {
  if (!character.lootStats) character.lootStats = emptyLootStats();
  // Stats ajoutées après la création du personnage (ex. Critique).
  character.stats = Object.assign(Rules.emptyStats(), character.stats);
  return character;
}

function newCharacter() {
  return {
    level: 1,
    xp: 0,
    skillPoints: 0,
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
  return Rules.derive(character.stats, gearBonus(character));
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

function makeItem(rarity, slot) {
  slot = slot || Rules.SLOTS[rand(0, Rules.SLOTS.length - 1)];
  const info = Rules.RARITY_INFO[rarity];
  const weights = Object.assign({}, Rules.SLOT_INFO[slot].weights);
  const lines = [];
  for (let i = 0; i < info.lines; i++) {
    const stat = weightedPick(weights);
    delete weights[stat];
    lines.push({ stat, value: rand(info.min, info.max) });
  }
  const names = Rules.SLOT_INFO[slot].names;
  const prefix = Rules.RARITY_PREFIX[rarity];
  const name = [names[rand(0, names.length - 1)], prefix, Rules.STAT_SUFFIX[lines[0].stat]]
    .filter(Boolean).join(' ');
  return { id: crypto.randomUUID(), slot, rarity, name, lines };
}

function openChest(character) {
  if (character.chests <= 0) throw new Error('Aucun coffre à ouvrir');
  character.chests -= 1;
  const luck = derived(character).luck;
  const items = [];
  for (let i = 0; i < Rules.ITEMS_PER_CHEST; i++) items.push(makeItem(rollRarity(luck)));
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
  const idx = character.inventory.findIndex((i) => i.id === itemId);
  if (idx < 0) throw new Error('Objet introuvable');
  const [item] = character.inventory.splice(idx, 1);
  const previous = character.equipment[item.slot];
  if (previous) character.inventory.push(previous);
  character.equipment[item.slot] = item;
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
    xpToNext: Rules.xpToNext(c.level),
    gear: gearBonus(c),
    derived: d,
    lootTable: Rules.lootTable(d.luck),
  };
}

module.exports = {
  newCharacter, gearBonus, derived, addXp, grant, allocate, rollRarity, makeItem,
  openChest, buyChests, recycle, equip, unequip, getOrCreateTwitchUser, linkTwitch, publicCharacter,
};
