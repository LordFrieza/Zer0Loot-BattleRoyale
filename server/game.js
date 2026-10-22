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
  if (!character.counters) {
    // Compteurs des succès : on reprend ce qui est connu des anciennes sauvegardes.
    const looted = Object.values(character.lootStats).reduce((a, b) => a + b, 0);
    character.counters = Object.fromEntries(Rules.COUNTERS.map((k) => [k, 0]));
    character.counters.chests = Math.floor(looted / Rules.ITEMS_PER_CHEST);
    character.counters.legendary = character.lootStats.legendaire || 0;
  }
  for (const k of Rules.COUNTERS) if (character.counters[k] == null) character.counters[k] = 0;
  if (!character.claimed) character.claimed = [];
  character.look = Object.assign({}, Rules.DEFAULT_LOOK, character.look);
  if (!character.owned) character.owned = []; // cosmétiques achetés
  if (character.title === undefined) character.title = null;
  if (!character.consumables) character.consumables = {}; // stock de potions : { id: quantité }
  if (character.consumableSlot === undefined) character.consumableSlot = null; // potion prête pour la prochaine partie
  if (!character.presets) character.presets = []; // presets d'équipement
  if (!character.talents) character.talents = []; // nœuds appris dans l'arbre de compétences (dans l'ordre)
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
    counters: Object.fromEntries(Rules.COUNTERS.map((k) => [k, 0])), // pour les succès
    claimed: [], // succès dont la récompense a été récupérée
    title: null, // id du succès affiché comme titre
    look: { ...Rules.DEFAULT_LOOK }, // apparence : couleur, yeux, sourcils, bouche + cosmétiques portés
    owned: [], // cosmétiques achetés à la boutique
    consumables: {}, // stock de potions : { id: quantité }
    consumableSlot: null, // potion équipée pour la prochaine partie
    presets: [], // presets d'équipement : [{ id, name, items: { slot: itemId | null } }]
    talents: [], // arbre de compétences : nœuds appris, dans l'ordre
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
  // Les panoplies et l'arbre de compétences donnent des points bonus, qui s'ajoutent aux points de compétence.
  const setPoints = Rules.setBonus(character.equipment).points;
  const talentPoints = Rules.talentBonus(character.cls, character.talents);
  const points = Object.fromEntries(Rules.STATS.map((st) => [st, (character.stats[st] || 0) + setPoints[st] + talentPoints[st]]));
  return Rules.derive(points, gearBonus(character), character.cls);
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

// Remise à zéro des caractéristiques : tous les points placés redeviennent des points à répartir.
function resetStats(character) {
  upgrade(character);
  const placed = Rules.STATS.reduce((sum, st) => sum + (character.stats[st] || 0), 0);
  if (!placed) throw new Error('Aucun point de caractéristique à remettre à zéro');
  const price = Rules.statResetPrice(placed);
  if (character.gold < price) throw new Error(`La remise à zéro coûte ${price} golds`);
  character.gold -= price;
  for (const st of Rules.STATS) character.stats[st] = 0;
  character.skillPoints += placed;
  return { price, refunded: placed };
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
  // Panoplie : imposée (fusion de 3 pièces de la même panoplie) ou tirée au hasard selon la rareté.
  const set = opts.set !== undefined ? opts.set : random() < Rules.SET_DROP_CHANCE[rarity] ? pick(Object.keys(Rules.SETS)) : null;
  if (set) item.set = set;
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
  const suffix = item.set ? Rules.SETS[item.set].of : Rules.STAT_SUFFIX[item.lines[0].stat];
  return [item.base, Rules.RARITY_PREFIX[item.rarity], suffix].filter(Boolean).join(' ');
}

// Incrémente un compteur de succès.
function bump(character, key, n = 1) {
  upgrade(character);
  character.counters[key] = (character.counters[key] || 0) + n;
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
  bump(character, 'chests');
  bump(character, 'legendary', items.filter((it) => it.rarity === 'legendaire').length);
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
  upgrade(character);
  const ids = new Set(itemIds);
  const locked = protectedIds(character);
  if (itemIds.some((id) => locked.has(id))) throw new Error('Un objet protégé par un preset ne peut pas être recyclé');
  const before = character.inventory.length;
  character.inventory = character.inventory.filter((i) => !ids.has(i.id));
  const count = before - character.inventory.length;
  if (count === 0) throw new Error('Objets introuvables');
  character.gold += count * Rules.RECYCLE_GOLD;
  bump(character, 'recycled', count);
  return { recycled: count, gold: count * Rules.RECYCLE_GOLD };
}

function equip(character, itemId) {
  upgrade(character);
  const idx = character.inventory.findIndex((i) => i.id === itemId);
  if (idx < 0) throw new Error('Objet introuvable');
  const item = character.inventory[idx];
  if (!Rules.canEquip(item, character.cls)) {
    const ci = Rules.CLASS_INFO[Rules.itemClass(item)];
    throw new Error(`Réservé à la classe ${ci.label}`);
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
  const talentsReset = character.talents.length;
  character.talents = []; // l'arbre dépend de la classe : remis à zéro gratuitement
  let unequipped = 0;
  for (const [slot, item] of Object.entries(character.equipment)) {
    if (item && !Rules.canEquip(item, cls)) {
      delete character.equipment[slot];
      character.inventory.push(item);
      unequipped += 1;
    }
  }
  return { cost, unequipped, talentsReset };
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
  const locked = protectedIds(character);
  if (ids.some((id) => locked.has(id))) throw new Error('Un objet protégé par un preset ne peut pas être fusionné');
  const rarity = items[0].rarity;
  if (items.some((i) => i.rarity !== rarity)) throw new Error('Les 3 objets doivent être de la même rareté');
  const chance = Rules.fuseUpgradeChance(rarity, derived(character).luck);
  const upgraded = random() * 100 < chance;
  const resultRarity = upgraded ? Rules.RARITIES[Rules.RARITIES.indexOf(rarity) + 1] : rarity;
  character.inventory = character.inventory.filter((i) => !ids.includes(i.id));
  // 3 pièces de la même panoplie → le résultat fait partie de cette panoplie.
  const sameSet = items[0].set && items.every((i) => i.set === items[0].set) ? items[0].set : undefined;
  const item = makeItem(resultRarity, null, { cls: character.cls, ownChance: 1, set: sameSet });
  character.inventory.push(item);
  bump(character, 'fused');
  if (item.rarity === 'legendaire') bump(character, 'legendary');
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
  bump(character, 'rerolled');
  return { item, line, old, price };
}


// ---------- Presets d'équipement ----------

// Identifiants des objets enregistrés dans au moins un preset (protégés du recyclage et de la forge).
function protectedIds(character) {
  const ids = new Set();
  for (const p of character.presets || []) for (const id of Object.values(p.items)) if (id) ids.add(id);
  return ids;
}

// Enregistre l'équipement actuel dans un nouveau preset, ou remplace un preset existant (id).
function savePreset(character, name, id) {
  upgrade(character);
  name = String(name || '').trim().slice(0, Rules.PRESET_NAME_MAX);
  if (!name) throw new Error('Donne un nom à ton preset');
  const items = Object.fromEntries(Rules.SLOTS.map((slot) => [slot, character.equipment[slot] ? character.equipment[slot].id : null]));
  if (!Object.values(items).some(Boolean)) throw new Error('Équipe au moins un objet avant de sauvegarder');
  if (id) {
    const preset = character.presets.find((p) => p.id === id);
    if (!preset) throw new Error('Preset introuvable');
    Object.assign(preset, { name, items });
    return { preset };
  }
  if (character.presets.length >= Rules.PRESET_MAX) throw new Error(`${Rules.PRESET_MAX} presets maximum`);
  const preset = { id: crypto.randomUUID(), name, items };
  character.presets.push(preset);
  return { preset };
}

// Remet exactement l'équipement du preset (un emplacement vide dans le preset est vidé).
function applyPreset(character, id) {
  upgrade(character);
  const preset = character.presets.find((p) => p.id === id);
  if (!preset) throw new Error('Preset introuvable');
  let changed = 0;
  let missing = 0;
  let locked = 0;
  for (const slot of Rules.SLOTS) {
    const wanted = preset.items[slot] || null;
    const current = character.equipment[slot];
    if ((current ? current.id : null) === wanted) continue;
    if (!wanted) { unequip(character, slot); changed += 1; continue; }
    const item = character.inventory.find((i) => i.id === wanted);
    if (!item) { missing += 1; continue; }
    if (!Rules.canEquip(item, character.cls)) { locked += 1; continue; }
    equip(character, wanted);
    changed += 1;
  }
  return { changed, missing, locked, name: preset.name };
}

function deletePreset(character, id) {
  upgrade(character);
  const before = character.presets.length;
  character.presets = character.presets.filter((p) => p.id !== id);
  if (character.presets.length === before) throw new Error('Preset introuvable');
}

// ---------- Consommables ----------

function buyConsumable(character, id, count = 1) {
  upgrade(character);
  const c = Rules.CONSUMABLES[id];
  if (!c) throw new Error('Consommable inconnu');
  count = Math.max(1, Math.min(Rules.CONSUMABLE_STACK_MAX, Math.floor(Number(count) || 1)));
  const have = character.consumables[id] || 0;
  if (have + count + (character.consumableSlot === id ? 1 : 0) > Rules.CONSUMABLE_STACK_MAX) throw new Error(`${Rules.CONSUMABLE_STACK_MAX} exemplaires maximum`);
  const cost = c.price * count;
  if (character.gold < cost) throw new Error(`Il te faut ${cost} golds`);
  character.gold -= cost;
  character.consumables[id] = have + count;
  return { price: cost, count };
}

// Place une potion du stock dans l'emplacement (celle qui y était retourne au stock) ; null pour la retirer.
function equipConsumable(character, id) {
  upgrade(character);
  if (id !== null && !Rules.CONSUMABLES[id]) throw new Error('Consommable inconnu');
  if (id !== null && !(character.consumables[id] > 0)) throw new Error('Tu n\'as pas cette potion : achète-la à la boutique');
  if (character.consumableSlot) {
    const prev = character.consumableSlot;
    character.consumables[prev] = (character.consumables[prev] || 0) + 1;
    character.consumableSlot = null;
  }
  if (id !== null) {
    character.consumables[id] -= 1;
    if (!character.consumables[id]) delete character.consumables[id];
    character.consumableSlot = id;
  }
}

// Au lancement d'une partie : la potion équipée est utilisée (elle disparaît, qu'elle se déclenche ou non).
function useConsumable(character) {
  upgrade(character);
  const id = character.consumableSlot;
  character.consumableSlot = null;
  return id;
}

// ---------- Arbre de compétences ----------

function talentState(character) {
  const total = Rules.talentPoints(character.level);
  return { total, spent: character.talents.length, available: total - character.talents.length };
}

function learnTalent(character, id) {
  upgrade(character);
  if (!character.cls) throw new Error('Choisis d\'abord une classe');
  const st = talentState(character);
  const blocker = Rules.talentBlocker(character.cls, character.talents, id, st.available);
  if (blocker) throw new Error(blocker);
  character.talents.push(id);
  return { spec: id.endsWith('.spec') ? Rules.specOf(character.cls, character.talents).spec : null };
}

// Remise à zéro payante : tous les points reviennent, tous les chemins se débloquent.
function resetTalents(character) {
  upgrade(character);
  if (!character.talents.length) throw new Error('Ton arbre est déjà vierge');
  if (character.gold < Rules.TALENT_RESET_PRICE) throw new Error(`La remise à zéro coûte ${Rules.TALENT_RESET_PRICE} golds`);
  character.gold -= Rules.TALENT_RESET_PRICE;
  const refunded = character.talents.length;
  character.talents = [];
  return { price: Rules.TALENT_RESET_PRICE, refunded };
}

// ---------- Succès & titres ----------

function claimAchievement(character, id) {
  upgrade(character);
  const a = Rules.achievementById(id);
  if (!a) throw new Error('Succès inconnu');
  const st = Rules.achievementState(character, a);
  if (!st.done) throw new Error('Succès pas encore terminé');
  if (st.claimed) throw new Error('Récompense déjà récupérée');
  character.claimed.push(id);
  character.gold += a.gold;
  return { gold: a.gold };
}

// Titre affiché sous le pseudo : le nom d'un succès terminé (null pour aucun).
function setTitle(character, id) {
  upgrade(character);
  if (id === null || id === '') { character.title = null; return; }
  const a = Rules.achievementById(id);
  if (!a || !Rules.achievementState(character, a).done) throw new Error('Termine ce succès pour porter ce titre');
  character.title = id;
}

function titleOf(character) {
  const a = character && character.title && Rules.achievementById(character.title);
  return a ? a.name : null;
}

// ---------- Apparence & boutique ----------

// Change une partie de l'apparence. Les parties gratuites prennent une option du catalogue ;
// les cosmétiques doivent avoir été achetés (null pour les retirer).
function setLook(character, part, value) {
  upgrade(character);
  if (Rules.APPEARANCE[part]) {
    if (!(part === 'color' && value === null) && !Rules.APPEARANCE[part].options[value]) throw new Error('Option inconnue');
  } else if (Rules.COSMETIC_SLOTS[part]) {
    if (value !== null) {
      const item = Rules.COSMETICS[value];
      if (!item || item.slot !== part) throw new Error('Cosmétique inconnu');
      if (!character.owned.includes(value)) throw new Error('Achète d\'abord cet article à la boutique');
    }
  } else {
    throw new Error('Partie inconnue');
  }
  character.look[part] = value;
}

function buyCosmetic(character, id) {
  upgrade(character);
  const item = Rules.COSMETICS[id];
  if (!item) throw new Error('Article inconnu');
  if (character.owned.includes(id)) throw new Error('Tu possèdes déjà cet article');
  if (character.gold < item.price) throw new Error(`Il te faut ${item.price} golds`);
  character.gold -= item.price;
  character.owned.push(id);
  character.look[item.slot] = id; // porté directement après l'achat
  return { price: item.price };
}

// ---------- Admin ----------

function adminGive(character, { gold = 0, chests = 0, xp = 0 }) {
  const clean = (v) => Math.max(0, Math.min(1e7, Math.floor(Number(v) || 0)));
  const reward = { gold: clean(gold), chests: clean(chests), xp: clean(xp) };
  if (!reward.gold && !reward.chests && !reward.xp) throw new Error('Rien à donner');
  const levels = grant(character, reward);
  return { reward, levels };
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
  for (const [id, n] of Object.entries(g.consumables || {})) c.consumables[id] = (c.consumables[id] || 0) + n;
  if (g.consumableSlot) c.consumables[g.consumableSlot] = (c.consumables[g.consumableSlot] || 0) + 1;
  for (const k of Rules.COUNTERS) {
    // record de salle : on garde le meilleur des deux, les autres compteurs s'additionnent
    c.counters[k] = k === 'dungeonBest' ? Math.max(c.counters[k], g.counters[k] || 0) : c.counters[k] + (g.counters[k] || 0);
  }
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
    titleName: titleOf(c),
    sets: Rules.setBonus(c.equipment),
    classInfo: c.cls ? Rules.CLASS_INFO[c.cls] : null,
    xpToNext: Rules.xpToNext(c.level),
    gear: gearBonus(c),
    derived: d,
    lootTable: Rules.lootTable(d.luck),
    talentState: talentState(c),
    talentPoints: Rules.talentBonus(c.cls, c.talents),
    ult: Rules.ultOf(c.cls, c.talents),
    spec: Rules.specOf(c.cls, c.talents),
    protectedIds: [...protectedIds(c)],
  };
}

module.exports = {
  newCharacter, upgrade, gearBonus, derived, addXp, grant, allocate, resetStats, rollRarity, makeItem,
  openChest, buyChests, recycle, equip, unequip, chooseClass, fuse, reroll,
  bump, claimAchievement, setTitle, titleOf, adminGive, setLook, buyCosmetic,
  getOrCreateTwitchUser, linkTwitch, publicCharacter,
  protectedIds, savePreset, applyPreset, deletePreset,
  buyConsumable, equipConsumable, useConsumable,
  talentState, learnTalent, resetTalents,
};
