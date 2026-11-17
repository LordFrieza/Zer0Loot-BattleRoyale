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
  // 1.2.1 : victoires contre le Troll — on reprend les victoires de boss d'avant (le Troll était le boss principal).
  if (character.counters.trollWins == null) character.counters.trollWins = character.counters.bossWins || 0;
  for (const k of Rules.COUNTERS) if (character.counters[k] == null) character.counters[k] = 0;
  if (!character.claimed) character.claimed = [];
  character.look = Object.assign({}, Rules.DEFAULT_LOOK, character.look);
  if (!character.owned) character.owned = []; // cosmétiques achetés
  if (character.title === undefined) character.title = null;
  if (!character.consumables) character.consumables = {}; // stock de potions : { id: quantité }
  if (character.consumableSlot === undefined) character.consumableSlot = null; // potion prête pour la prochaine partie
  if (!character.presets) character.presets = []; // presets d'équipement
  if (!character.talents) character.talents = []; // nœuds appris dans l'arbre de compétences (dans l'ordre)
  // V2 : style de combat (tactique + techniques)
  character.tactics = Object.assign({}, Rules.DEFAULT_TACTICS, character.tactics);
  if (!Array.isArray(character.techs)) character.techs = [];
  character.counters.techs = Math.max(character.counters.techs || 0, character.techs.length);
  // V2 : visage dessiné (grille de pixels) et sa version (pour le cache des clients)
  if (typeof character.drawing !== 'string') character.drawing = '';
  if (!character.drawingVer) character.drawingVer = 0;
  // V2 : énergie du mode Solo (pleine pour les anciens personnages) et partie solo en cours
  if (!character.energy || !Number.isFinite(character.energy.value)) character.energy = { value: Rules.SOLO.energyMax, at: Date.now() };
  if (character.soloActive === undefined) character.soloActive = null;
  // 1.4 : Clés de boss (une offerte aux anciens personnages, qui pouvaient jusqu'ici défier les boss avec l'énergie)
  if (!Number.isFinite(character.bossKeys)) character.bossKeys = Rules.SOLO.startKeys;
  // 1.5 : familiers (enclos vide pour les anciens personnages)
  if (!character.pets || !Array.isArray(character.pets.list)) character.pets = newPets();
  if (!character.pets.food) character.pets.food = {};
  if (!Array.isArray(character.pets.enclos)) character.pets.enclos = [];
  if (character.pets.active === undefined) character.pets.active = null;
  if (character.pets.follow === undefined) character.pets.follow = null;
  // 2.0 : émeraudes, Survivor et Maison (tout neufs pour les anciens personnages)
  if (!Number.isFinite(character.emeralds)) character.emeralds = 0;
  if (!character.survivor) character.survivor = newSurvivor();
  for (const [k, v] of Object.entries(newSurvivor())) if (character.survivor[k] === undefined) character.survivor[k] = v;
  if (character.survivorActive === undefined) character.survivorActive = null;
  if (!character.house) character.house = newHouse();
  const freshHouse = newHouse();
  for (const [k, v] of Object.entries(freshHouse)) if (character.house[k] === undefined) character.house[k] = v;
  for (const [part, id] of Object.entries(freshHouse.style)) if (!character.house.style[part]) character.house.style[part] = id;
  // 1.9 : journal des trouvailles des familiers (vide pour les anciens personnages)
  if (!Array.isArray(character.pets.log)) character.pets.log = [];
  if (!character.pets.totals) character.pets.totals = newPetTotals();
  for (const [k, v] of Object.entries(newPetTotals())) if (!Number.isFinite(character.pets.totals[k])) character.pets.totals[k] = v;
  // 1.6 : historique des parties et statistiques détaillées (elles démarrent à zéro pour les anciens personnages)
  if (!Array.isArray(character.history)) character.history = [];
  if (!character.lifetime) character.lifetime = newLifetime();
  for (const k of Rules.PLAYER_STAT_KEYS) if (!Number.isFinite(character.lifetime[k])) character.lifetime[k] = 0; // complété en place
  if (!character.lifetime.modes) character.lifetime.modes = {};
  for (const m of Object.keys(Rules.GAME_MODES)) if (!character.lifetime.modes[m]) character.lifetime.modes[m] = { games: 0, wins: 0 };
  if (!character.lifetimeSince) character.lifetimeSince = Date.now();
  // 1.3 : courrier (ventes, expirations) et historique du marché
  if (!Array.isArray(character.mail)) character.mail = [];
  if (!Array.isArray(character.marketLog)) character.marketLog = [];
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
    tactics: { ...Rules.DEFAULT_TACTICS }, // style de combat : posture, cible préférée, distance de recul
    techs: [], // techniques signature choisies (1 emplacement au niveau 5, 2 au niveau 15)
    drawing: '', // visage dessiné : une couleur de Rules.DRAWING.palette par case (0 = transparent)
    drawingVer: 0, // version du dessin (les clients le gardent en cache)
    energy: { value: Rules.SOLO.energyMax, at: Date.now() }, // énergie du mode Solo (voir Rules.energyState)
    soloActive: null, // partie solo en cours : { kind, startedAt } (remboursée si le serveur redémarre)
    bossKeys: Rules.SOLO.startKeys, // Clés de boss (Défi des boss), sans limite, trouvées dans l'Expédition
    pets: newPets(), // familiers (onglet Familier)
    emeralds: 0, // émeraudes (Survivor → méta-progression et Maison)
    survivor: newSurvivor(), // Survivor : méta-progression, déblocages, record, récompense du jour
    survivorActive: null, // partie de Survivor en cours (golds rendus si le serveur redémarre)
    house: newHouse(), // Maison : meubles, disposition, façade, boîte aux lettres
    history: [], // historique des parties (stream et solo), la plus récente en premier
    lifetime: newLifetime(), // statistiques cumulées (onglet Statistiques)
    lifetimeSince: Date.now(), // date de début des statistiques détaillées
    mail: [], // courrier : [{ id, at, text, read, kind }] (ventes au marché, objets revenus…)
    marketLog: [], // historique du marché : [{ at, kind: listed|sold|bought|cancelled|expired, item, price, … }]
  };
}

function gearBonus(character) {
  const pct = Rules.emptyStats();
  for (const item of Object.values(character.equipment)) {
    if (!item) continue;
    for (const line of item.lines) pct[line.stat] += line.value;
    // Arme / objet secondaire de sa classe : bonus dans la stat de prédilection de la classe
    const cb = Rules.itemClassBonus(item, character.cls);
    if (cb) pct[cb.stat] += cb.value;
  }
  return pct;
}

// Puissance (récompenses équilibrées des modes PvP) : niveau + total des % de l'équipement / 10.
function powerOf(character) {
  const total = Object.values(gearBonus(character)).reduce((a, b) => a + b, 0);
  return Rules.powerScore(character.level, total);
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

// track : compté dans les statistiques (golds gagnés) ; pas pour les cadeaux de l'admin.
function grant(character, reward, track = true) {
  const levels = addXp(character, reward.xp);
  character.gold += reward.gold;
  character.chests += reward.chests;
  if (track && reward.gold > 0) addStat(character, 'goldEarned', reward.gold);
  return levels;
}

// ---------- Statistiques et historique ----------

function newLifetime() {
  const stats = Object.fromEntries(Rules.PLAYER_STAT_KEYS.map((k) => [k, 0]));
  stats.modes = Object.fromEntries(Object.keys(Rules.GAME_MODES).map((m) => [m, { games: 0, wins: 0 }]));
  return stats;
}

function addStat(character, key, n = 1) {
  if (!character.lifetime) character.lifetime = newLifetime();
  character.lifetime[key] = (character.lifetime[key] || 0) + n;
}

// Photo du personnage au moment de la partie : niveau, classe, puissance, stats et équipement (nom + rareté).
function snapshot(character) {
  const d = derived(character);
  const gear = {};
  for (const [slot, item] of Object.entries(character.equipment)) if (item) gear[slot] = { name: item.name, rarity: item.rarity, set: item.set || undefined };
  return {
    level: character.level, cls: character.cls || null, power: powerOf(character),
    stats: {
      maxHp: Math.round(d.maxHp), damage: Math.round(d.damage * 10) / 10, reduction: Math.round(d.reduction * 1000) / 10,
      dodge: Math.round(d.dodge * 1000) / 10, crit: Math.round((d.crit || 0) * 1000) / 10, speed: Math.round(d.speed),
      attackSpeed: Math.round((d.attackSpeed || 1) * 100) / 100, lifesteal: Math.round((d.lifesteal || 0) * 1000) / 10,
      precision: Math.round((d.precision || 0) * 1000) / 10, thorns: Math.round((d.thorns || 0) * 1000) / 10, luck: d.luck || 0,
    },
    gear,
  };
}

/*
 * Ligne d'historique d'une partie (stream ou solo) et mise à jour des statistiques cumulées.
 * entry = { mode, outcome: win|loss|end, rank, total, kills, deaths, dealt, taken, bossDealt, duration, gains, details }
 */
function recordActivity(character, entry, now = Date.now()) {
  upgrade(character);
  const e = { id: crypto.randomUUID(), at: now, ...entry, ...snapshot(character) };
  character.history.unshift(e);
  if (character.history.length > Rules.HISTORY.max) character.history.length = Rules.HISTORY.max;
  const S = character.lifetime;
  const online = !!Rules.GAME_MODES[e.mode];
  if (online) {
    S.modes[e.mode].games += 1;
    if (e.outcome === 'win') S.modes[e.mode].wins += 1;
    if (e.outcome === 'loss') S.losses += 1;
  }
  S.deaths += e.deaths || 0;
  S.damageDealt += e.dealt || 0;
  S.damageTaken += e.taken || 0;
  S.bossDamage += e.bossDealt || 0;
  S.playTime += e.duration || 0;
  S.maxKills = Math.max(S.maxKills, e.kills || 0);
  S.maxDamage = Math.max(S.maxDamage, e.dealt || 0);
  const d = e.details || {};
  if (e.mode === 'koth') S.hillTime += d.hillTime || 0;
  if (e.mode === 'dungeon') S.dungeonRooms += d.room || 0;
  if (e.mode === 'rush') S.rushBosses += d.killed || 0;
  if (e.mode === 'gold') S.goldShower += d.gold || 0;
  if (e.mode === 'expedition') { S.expeditions += 1; S.expeditionFloors += d.depth || 0; }
  if (e.mode === 'challenge') S.challenges += 1;
  return e;
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

/*
 * Nouvelle répartition des points de caractéristiques, validée d'un coup : `target` = { stat: points }.
 * Le total ne peut pas dépasser les points placés + les points libres ; chaque point retiré d'une
 * caractéristique coûte Rules.STAT_RESET.perPoint golds (Rules.STAT_RESET.max au plus).
 */
function respecStats(character, target) {
  upgrade(character);
  if (!target || typeof target !== 'object') throw new Error('Répartition invalide');
  const next = {};
  for (const st of Rules.STATS) {
    const v = target[st] === undefined ? character.stats[st] || 0 : Number(target[st]);
    if (!Number.isInteger(v) || v < 0) throw new Error('Répartition invalide');
    next[st] = v;
  }
  if (Object.keys(target).some((k) => !Rules.STATS.includes(k))) throw new Error('Stat inconnue');
  const placed = Rules.STATS.reduce((sum, st) => sum + (character.stats[st] || 0), 0);
  const total = placed + character.skillPoints;
  const wanted = Rules.STATS.reduce((sum, st) => sum + next[st], 0);
  if (wanted > total) throw new Error(`Tu n'as que ${total} point(s) à répartir`);
  const moved = Rules.statPointsMoved(character.stats, next);
  const price = Rules.statResetPrice(moved);
  if (!moved && wanted === placed) throw new Error('Aucun changement à valider');
  if (character.gold < price) throw new Error(`Cette répartition coûte ${price} golds`);
  character.gold -= price;
  for (const st of Rules.STATS) character.stats[st] = next[st];
  character.skillPoints = total - wanted;
  return { price, moved, skillPoints: character.skillPoints };
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
  for (const it of items) it.isNew = true; // badge « Nouveau ! » jusqu'à ce que le joueur le survole (markSeen)
  addStat(character, 'itemsObtained', items.length);
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
  if (itemIds.some((id) => locked.has(id))) throw new Error('Un objet protégé (verrouillé ou dans un preset) ne peut pas être recyclé');
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
  delete item.isNew;
  character.inventory.splice(idx, 1);
  const previous = character.equipment[item.slot];
  if (previous) character.inventory.push(previous);
  character.equipment[item.slot] = item;
}

// ---------- Classes ----------

// Première classe gratuite, puis changement payant. L'équipement reste en place (le bonus de classe suit la nouvelle classe).
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
  character.techs = character.techs.filter((id) => !Rules.techBlocker(cls, character.level, id)); // techniques d'une autre classe retirées
  if (character.tactics.kite !== null) character.tactics.kite = Math.min(character.tactics.kite, Rules.tacticsKiteMax(cls)) || null;
  for (const slot of ['weapon', 'offhand']) { // skins d'arme d'une autre classe : retirés (mais gardés)
    const skin = Rules.COSMETICS[character.look[slot]];
    if (skin && skin.cls !== cls) character.look[slot] = null;
  }
  return { cost, unequipped: 0, talentsReset };
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
  if (ids.some((id) => locked.has(id))) throw new Error('Un objet protégé (verrouillé ou dans un preset) ne peut pas être fusionné');
  const rarity = items[0].rarity;
  if (items.some((i) => i.rarity !== rarity)) throw new Error('Les 3 objets doivent être de la même rareté');
  const price = Rules.FUSE_PRICE[rarity];
  if (character.gold < price) throw new Error(`La fusion coûte ${price} golds`);
  character.gold -= price;
  const chance = Rules.fuseUpgradeChance(rarity, derived(character).luck);
  const upgraded = random() * 100 < chance;
  const resultRarity = upgraded ? Rules.RARITIES[Rules.RARITIES.indexOf(rarity) + 1] : rarity;
  character.inventory = character.inventory.filter((i) => !ids.includes(i.id));
  // 3 pièces de la même panoplie → le résultat fait partie de cette panoplie.
  const sameSet = items[0].set && items.every((i) => i.set === items[0].set) ? items[0].set : undefined;
  const item = makeItem(resultRarity, null, { cls: character.cls, ownChance: 1, set: sameSet });
  item.isNew = true; // badge « Nouveau ! », comme un objet de coffre
  character.inventory.push(item);
  addStat(character, 'itemsObtained');
  bump(character, 'fused');
  if (item.rarity === 'legendaire') bump(character, 'legendary');
  return { item, upgraded, chance, from: rarity, price };
}

/*
 * Forge en série : `count` fusions d'un coup avec des objets de la rareté choisie, tirés au hasard
 * dans le coffre personnel (jamais un objet protégé, ni un objet forgé pendant la série).
 * Tout est vérifié avant la première fusion : assez d'objets et assez de golds pour toute la série.
 */
function fuseBatch(character, rarity, count) {
  upgrade(character);
  if (!Rules.RARITIES.includes(rarity)) throw new Error('Rareté inconnue');
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) throw new Error('Choisis au moins une fusion');
  if (n > Rules.FUSE_BATCH_MAX) throw new Error(`${Rules.FUSE_BATCH_MAX} fusions au plus d'un coup`);
  const locked = protectedIds(character);
  const pool = character.inventory.filter((i) => i.rarity === rarity && !locked.has(i.id));
  if (pool.length < Rules.FUSE_COUNT * n) {
    throw new Error(`Il faut ${Rules.FUSE_COUNT * n} objets ${Rules.RARITY_INFO[rarity].label.toLowerCase()}s non protégés pour ${n} fusion${n > 1 ? 's' : ''} (tu en as ${pool.length})`);
  }
  const total = Rules.FUSE_PRICE[rarity] * n;
  if (character.gold < total) throw new Error(`${n} fusion${n > 1 ? 's coûtent' : ' coûte'} ${total} golds`);
  // Mélange équitable (Fisher-Yates avec le générateur cryptographique)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const results = [];
  for (let k = 0; k < n; k++) {
    const ids = pool.slice(k * Rules.FUSE_COUNT, (k + 1) * Rules.FUSE_COUNT).map((i) => i.id);
    results.push(fuse(character, ids));
  }
  return { results, price: total, upgraded: results.filter((r) => r.upgraded).length, from: rarity };
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

/*
 * Alchimie noire : sacrifie un objet du coffre de même rareté que la cible (+ golds) pour augmenter
 * la valeur d'une ligne de la cible (équipée ou non), sans changer sa stat, jusqu'à Rules.alchemyCap.
 */
function alchemy(character, itemId, lineIndex, sacrificeId) {
  upgrade(character);
  const item = findItem(character, itemId);
  if (!item) throw new Error('Objet introuvable');
  const index = Number(lineIndex);
  if (!Number.isInteger(index) || !item.lines[index]) throw new Error('Ligne introuvable');
  const sacrifice = character.inventory.find((i) => i.id === sacrificeId);
  if (!sacrifice) throw new Error('Choisis un objet à sacrifier dans ton coffre personnel');
  if (sacrifice.id === item.id) throw new Error('Un objet ne peut pas se sacrifier lui-même');
  if (protectedIds(character).has(sacrifice.id)) throw new Error('Un objet protégé (verrouillé ou dans un preset) ne peut pas être sacrifié');
  if (sacrifice.rarity !== item.rarity) throw new Error('L\'objet sacrifié doit être de la même rareté');
  const cap = Rules.alchemyCap(item.rarity);
  const line = item.lines[index];
  if (line.value >= cap) throw new Error(`Cette ligne est déjà au maximum de l'alchimie (${cap})`);
  const price = Rules.ALCHEMY.price[item.rarity];
  if (character.gold < price) throw new Error(`L'alchimie noire coûte ${price} golds`);
  character.gold -= price;
  character.inventory = character.inventory.filter((i) => i.id !== sacrifice.id);
  const [min, max] = Rules.ALCHEMY.gain[item.rarity];
  const old = line.value;
  line.value = Math.min(cap, old + rand(min, max));
  line.alch = (line.alch || 0) + 1;
  bump(character, 'alchemy');
  return { item, index, line, old, gain: line.value - old, cap, price, sacrifice };
}

// ---------- Presets d'équipement ----------

// Identifiants des objets enregistrés dans au moins un preset (protégés du recyclage et de la forge).
// Objets protégés de la forge, de l'alchimie (sacrifice), du recyclage et du marché : ceux d'un preset et ceux verrouillés.
function protectedIds(character) {
  const ids = new Set();
  for (const p of character.presets || []) for (const id of Object.values(p.items)) if (id) ids.add(id);
  for (const item of (character.inventory || []).concat(Object.values(character.equipment || {}))) if (item && item.locked) ids.add(item.id);
  return ids;
}

// Verrou d'un objet (coffre ou équipé) : il ne peut plus être fusionné, sacrifié, recyclé ni vendu par mégarde.
function toggleLock(character, itemId) {
  upgrade(character);
  const item = findItem(character, itemId);
  if (!item) throw new Error('Objet introuvable');
  if (item.locked) delete item.locked;
  else item.locked = true;
  return { locked: !!item.locked };
}

// Objets « Nouveau ! » vus (survolés) : le badge disparaît. Retourne le nombre d'objets mis à jour.
function markSeen(character, itemIds) {
  upgrade(character);
  if (!Array.isArray(itemIds)) throw new Error('Liste d\'objets invalide');
  const ids = new Set(itemIds.slice(0, 500).map(String));
  let n = 0;
  for (const item of character.inventory.concat(Object.values(character.equipment).filter(Boolean))) {
    if (item.isNew && ids.has(item.id)) { delete item.isNew; n += 1; }
  }
  return n;
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

// ---------- Style de combat : tactique et techniques (V2) ----------

function setTactics(character, tactics) {
  upgrade(character);
  const t = tactics || {};
  const next = { ...character.tactics };
  if (t.stance !== undefined) {
    if (!Rules.TACTICS.stance[t.stance]) throw new Error('Posture inconnue');
    next.stance = t.stance;
  }
  if (t.target !== undefined) {
    if (!Rules.TACTICS.target[t.target]) throw new Error('Cible inconnue');
    next.target = t.target;
  }
  if (t.kite !== undefined) {
    const max = Rules.tacticsKiteMax(character.cls);
    if (t.kite === null) next.kite = null;
    else {
      if (!max) throw new Error('La distance de recul ne concerne que les classes à distance');
      const v = Math.round(Number(t.kite));
      if (!Number.isFinite(v)) throw new Error('Distance invalide');
      next.kite = Math.max(Rules.TACTICS.kiteMin, Math.min(max, v));
    }
  }
  character.tactics = next;
  return { tactics: next };
}

// Remplace les techniques choisies (dans l'ordre des emplacements).
function setTechniques(character, ids) {
  upgrade(character);
  const list = Array.isArray(ids) ? [...new Set(ids.map(String))] : [];
  const slots = Rules.techSlots(character.level);
  if (!slots && list.length) throw new Error(`Les techniques se débloquent au niveau ${Rules.TECH_SLOTS[0]}`);
  if (list.length > slots) throw new Error(`Tu n'as que ${slots} emplacement${slots > 1 ? 's' : ''} de technique`);
  for (const id of list) {
    const why = Rules.techBlocker(character.cls, character.level, id);
    if (why) throw new Error(why);
  }
  character.techs = list;
  // Succès « Technicien » : la progression reste acquise même si on retire ensuite la technique
  character.counters.techs = Math.max(character.counters.techs || 0, list.length);
  return { techs: list };
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
      if (item.cls && item.cls !== character.cls) throw new Error(`Ce skin est réservé à la classe ${Rules.CLASS_INFO[item.cls].label}`);
    }
  } else {
    throw new Error('Partie inconnue');
  }
  character.look[part] = value;
  // Choisir des yeux, des sourcils ou une bouche retire le visage dessiné (qui les cache).
  if (part === 'eyes' || part === 'brows' || part === 'mouth') character.look.drawing = null;
}

/*
 * Achat d'un cosmétique. Un cosmétique d'exploit (`unlock`) reste verrouillé tant que l'exploit n'est pas
 * accompli, puis se récupère gratuitement. Un skin de classe n'est porté directement que par cette classe.
 */
function buyCosmetic(character, id) {
  upgrade(character);
  const item = Rules.COSMETICS[id];
  if (!item) throw new Error('Article inconnu');
  if (character.owned.includes(id)) throw new Error('Tu possèdes déjà cet article');
  if (Rules.cosmeticLocked(character, id)) throw new Error(`Exploit requis : ${item.unlock.desc}`);
  if (character.gold < item.price) throw new Error(`Il te faut ${item.price} golds`);
  character.gold -= item.price;
  character.owned.push(id);
  const worn = !item.cls || item.cls === character.cls;
  if (worn) character.look[item.slot] = id; // porté directement après l'achat
  return { price: item.price, worn };
}

/*
 * Visage dessiné : Rules.DRAWING.size² caractères, chacun « 0 » (transparent) ou l'index + 1 d'une couleur
 * de la palette. Il faut avoir acheté l'article « dessin » ; le dessin est porté dès qu'il est enregistré.
 */
function setDrawing(character, pixels) {
  upgrade(character);
  if (!character.owned.includes('dessin')) throw new Error('Achète d\'abord le visage à dessiner à la boutique');
  const n = Rules.DRAWING.size * Rules.DRAWING.size;
  const max = Rules.DRAWING.palette.length;
  if (typeof pixels !== 'string' || pixels.length !== n || ![...pixels].every((ch) => ch >= '0' && ch <= String(max))) {
    throw new Error('Dessin invalide');
  }
  if (!/[1-9]/.test(pixels)) throw new Error('Ton dessin est vide');
  character.drawing = pixels;
  character.drawingVer += 1;
  character.look.drawing = 'dessin';
  return { ver: character.drawingVer };
}

// Modération : efface le dessin d'un joueur (l'article reste acheté, il peut redessiner).
function clearDrawing(character) {
  upgrade(character);
  character.drawing = '';
  character.drawingVer += 1;
  character.look.drawing = null;
}

// ---------- Admin ----------

function adminGive(character, { gold = 0, chests = 0, xp = 0, energy = 0, keys = 0, pet = null }) {
  // Familier (pour tester l'enclos) : l'espèce demandée, ou une espèce pas encore obtenue
  if (pet) {
    upgrade(character);
    const missing = Object.keys(Rules.PETS).filter((sp) => !character.pets.list.some((p) => p.species === sp));
    const species = Rules.PETS[pet] ? pet : missing[rand(0, Math.max(0, missing.length - 1))] || Object.keys(Rules.PETS)[0];
    const r = addPet(character, species);
    return { pet: r.pet.id, duplicate: r.duplicate };
  }
  const clean = (v) => Math.max(0, Math.min(1e7, Math.floor(Number(v) || 0)));
  const reward = { gold: clean(gold), chests: clean(chests), xp: clean(xp) };
  const extra = clean(energy);
  const extraKeys = Math.min(1000, clean(keys));
  if (!reward.gold && !reward.chests && !reward.xp && !extra && !extraKeys) throw new Error('Rien à donner');
  if (extra) addEnergy(character, extra);
  if (extraKeys) addKeys(character, extraKeys);
  const levels = grant(character, reward, false); // cadeau : pas compté dans les golds gagnés
  return { reward, levels, energy: extra || undefined, keys: extraKeys || undefined };
}

// ---------- Énergie du mode Solo ----------

// Met à jour la recharge et renvoie { value, at, nextAt }.
function energyOf(character, now = Date.now()) {
  upgrade(character);
  const st = Rules.energyState(character.energy, now);
  character.energy = { value: st.value, at: st.at };
  return st;
}

function spendEnergy(character, now = Date.now()) {
  const st = energyOf(character, now);
  if (st.value < 1) {
    const h = Math.ceil((st.nextAt - now) / 3600000);
    throw new Error(`Plus d'énergie : la prochaine revient dans ${h} h`);
  }
  character.energy.value -= 1;
  if (st.value === Rules.SOLO.energyMax) character.energy.at = now; // la recharge démarre maintenant
}

// ---------- Familiers (onglet Familier) ----------

function newSurvivor() {
  return { meta: {}, unlocks: [], starters: [], starter: 'epee', best: null, dailyDate: '', runs: 0 };
}

function newHouse(now = Date.now()) {
  const style = {};
  for (const [part, P] of Object.entries(Rules.HOUSE_PARTS)) style[part] = Object.keys(P.options)[0];
  return { size: 'studio', owned: {}, placed: [], style, opts: [], mailAt: now, likes: [], visits: 0 };
}

function newPets() {
  return { list: [], active: null, follow: null, food: {}, enclos: [], log: [], totals: newPetTotals() };
}

// Total de tout ce que les familiers ont rapporté (le journal, lui, ne garde que les dernières trouvailles).
function newPetTotals() {
  return { finds: 0, gold: 0, xp: 0, chests: 0, potions: 0, keys: 0, items: 0 };
}

function findPet(character, id) {
  const pet = character.pets.list.find((p) => p.id === id);
  if (!pet) throw new Error('Familier introuvable');
  return pet;
}

/*
 * Fait vivre tous les familiers jusqu'à maintenant (besoins, trouvailles, série de bonheur).
 * Retourne { found, unlocked: [ids] } pour prévenir le joueur.
 */
function petsTick(character, now = Date.now()) {
  upgrade(character);
  const P = character.pets;
  const out = { found: 0, unlocked: [] };
  for (const pet of P.list) {
    const r = Rules.petAdvance(pet, P.enclos, now, pet.id === P.active);
    Object.assign(pet, r.pet); // mis à jour en place (les références restent valables)
    out.found += r.found;
    if (r.unlocked) out.unlocked.push(pet.id);
  }
  const followers = P.list.filter((p) => p.follower).length;
  character.counters.petFollowers = Math.max(character.counters.petFollowers || 0, followers);
  return out;
}

// Expérience d'un familier : niveaux gagnés (20 au plus).
function petGainXp(pet, xp) {
  let levels = 0;
  pet.xp = (pet.xp || 0) + Math.max(0, Math.round(xp));
  while (pet.level < Rules.PET.maxLevel && pet.xp >= Rules.petXpToNext(pet.level)) {
    pet.xp -= Rules.petXpToNext(pet.level);
    pet.level += 1;
    levels += 1;
  }
  if (pet.level >= Rules.PET.maxLevel) pet.xp = 0;
  return levels;
}

/*
 * Nouveau familier d'espèce `species` (une par boss). Déjà obtenu : il gagne de l'XP et un Festin royal.
 * Retourne { pet, duplicate, levels }.
 */
function addPet(character, species, now = Date.now()) {
  if (!Rules.PETS[species]) throw new Error('Familier inconnu');
  petsTick(character, now);
  const P = character.pets;
  const have = P.list.find((p) => p.species === species);
  if (have) {
    const levels = petGainXp(have, Rules.PET.duplicateXp);
    P.food.festin = Math.min(Rules.PET_FOOD_MAX, (P.food.festin || 0) + 1);
    return { pet: have, duplicate: true, levels };
  }
  const pet = {
    id: species, species, name: Rules.PETS[species].name, level: 1, xp: 0,
    needs: { ...Rules.PET.start }, at: now, findAt: null, finds: 0, streakAt: null, follower: false,
    caressAt: 0, playAt: 0, obtainedAt: now,
  };
  P.list.push(pet);
  if (!P.active) P.active = pet.id;
  character.counters.pets = Math.max(character.counters.pets || 0, P.list.length);
  return { pet, duplicate: false, levels: 0 };
}

// Tirage du familier après un boss vaincu (5 % par héros). Retourne le résultat d'addPet, ou null.
function rollPetDrop(character, bossId, chance = Rules.PET.dropChance) {
  if (!Rules.PETS[bossId] || random() >= chance) return null;
  return addPet(character, bossId);
}

function setActivePet(character, id) {
  petsTick(character);
  findPet(character, id);
  character.pets.active = id;
}

const ACTION_FIELDS = ['faim', 'soif', 'joie'];
function applyNeeds(pet, gains, mult = 1) {
  for (const k of ACTION_FIELDS) if (gains[k]) pet.needs[k] = Math.max(0, Math.min(100, pet.needs[k] + gains[k] * (gains[k] > 0 ? mult : 1)));
}

// Caresser / jouer (gratuit, avec un temps de recharge). Seulement le familier principal.
function petAction(character, kind, now = Date.now()) {
  const A = Rules.PET.actions[kind];
  if (!A) throw new Error('Action inconnue');
  petsTick(character, now);
  const P = character.pets;
  if (!P.active) throw new Error('Tu n\'as pas encore de familier');
  const pet = findPet(character, P.active);
  const key = kind === 'caresser' ? 'caressAt' : 'playAt';
  const wait = (pet[key] || 0) + A.cooldownMs - now;
  if (wait > 0) {
    const m = Math.ceil(wait / 60000);
    throw new Error(`${pet.name} a besoin d'un peu de repos : réessaie dans ${m >= 60 ? Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') : m + ' min'}`);
  }
  const fx = Rules.petEnclosEffects(P.enclos);
  const extra = kind === 'caresser' ? fx.caress : fx.play;
  applyNeeds(pet, { joie: A.joie + extra, faim: A.faim, soif: A.soif });
  pet[key] = now;
  const levels = petGainXp(pet, A.xp);
  return { pet: pet.id, kind, levels };
}

// Nourrir / abreuver le familier principal avec un aliment du garde-manger.
function feedPet(character, foodId, now = Date.now()) {
  const F = Rules.PET_FOODS[foodId];
  if (!F) throw new Error('Aliment inconnu');
  petsTick(character, now);
  const P = character.pets;
  if (!P.active) throw new Error('Tu n\'as pas encore de familier');
  if (!(P.food[foodId] > 0)) throw new Error(`Plus de ${F.label} : achète-en à l'épicerie de l'enclos`);
  const pet = findPet(character, P.active);
  const favorite = Rules.PETS[pet.species].favorite === foodId;
  applyNeeds(pet, F, favorite ? Rules.PET.favoriteMult : 1);
  P.food[foodId] -= 1;
  const levels = petGainXp(pet, F.xp * (favorite ? Rules.PET.favoriteMult : 1));
  return { pet: pet.id, food: foodId, favorite, levels };
}

function buyPetFood(character, foodId, count = 1) {
  const F = Rules.PET_FOODS[foodId];
  if (!F) throw new Error('Aliment inconnu');
  upgrade(character);
  count = Math.max(1, Math.min(Rules.PET_FOOD_MAX, Math.floor(Number(count) || 1)));
  const have = character.pets.food[foodId] || 0;
  if (have + count > Rules.PET_FOOD_MAX) throw new Error(`Ton garde-manger contient déjà ${have} ${F.label} (${Rules.PET_FOOD_MAX} au plus)`);
  const cost = F.price * count;
  if (character.gold < cost) throw new Error(`Il te faut ${cost} golds`);
  character.gold -= cost;
  character.pets.food[foodId] = have + count;
  return { food: foodId, count, cost };
}

function buyEnclos(character, itemId) {
  const E = Rules.PET_ENCLOS[itemId];
  if (!E) throw new Error('Objet d\'enclos inconnu');
  petsTick(character); // les besoins baissent à l'ancien rythme jusqu'à maintenant
  if (character.pets.enclos.includes(itemId)) throw new Error('Tu as déjà cet objet dans ton enclos');
  if (character.gold < E.price) throw new Error(`Il te faut ${E.price} golds`);
  character.gold -= E.price;
  character.pets.enclos.push(itemId);
  return { item: itemId };
}

// Une trouvaille, selon l'espèce et le niveau du familier.
function petFind(character, pet, fx) {
  const L = pet.level;
  const find = Rules.PETS[pet.species].find;
  const luck = 10 + 4 * L;
  if (find === 'gold') { const gold = Rules.petFindValue(pet.species, L, fx); character.gold += gold; addStat(character, 'goldEarned', gold); return { kind: 'gold', gold }; }
  if (find === 'xp') { const xp = Rules.petFindValue(pet.species, L, fx); const levels = addXp(character, xp); return { kind: 'xp', xp, levels }; }
  if (find === 'chest') {
    const chests = 1 + (random() < 0.03 * L ? 1 : 0);
    character.chests += chests;
    return { kind: 'chest', chests };
  }
  if (find === 'potion') {
    const ids = Object.keys(Rules.CONSUMABLES);
    const id = ids[rand(0, ids.length - 1)];
    character.consumables[id] = Math.min(Rules.CONSUMABLE_STACK_MAX, (character.consumables[id] || 0) + 1);
    const out = { kind: 'potion', potion: id };
    if (L >= 10 && random() < 0.04) { addKeys(character, 1); out.key = 1; }
    return out;
  }
  // Arme (Troll) ou pièce d'armure / bijou (Maexxna)
  const slots = find === 'arme' ? ['arme'] : Rules.SLOTS.filter((s) => s !== 'arme' && s !== 'secondaire');
  const item = makeItem(rollRarity(luck), slots[rand(0, slots.length - 1)], { cls: character.cls });
  item.isNew = true;
  character.inventory.push(item);
  addStat(character, 'itemsObtained');
  return { kind: 'item', item };
}

// Récupérer les trouvailles en attente de tous ses familiers.
function collectFinds(character, now = Date.now()) {
  petsTick(character, now);
  const P = character.pets;
  const fx = Rules.petEnclosEffects(P.enclos);
  const gifts = [];
  for (const pet of P.list) {
    while (pet.finds > 0) {
      pet.finds -= 1;
      gifts.push({ pet: pet.id, ...petFind(character, pet, fx) });
    }
  }
  if (!gifts.length) throw new Error('Aucune trouvaille à récupérer pour l\'instant');
  bump(character, 'petFinds', gifts.length);
  logFinds(character, gifts, now);
  return { gifts };
}

// Journal de l'enclos : une ligne par trouvaille (la plus récente en premier) et les totaux.
function logFinds(character, gifts, now) {
  const P = character.pets;
  const T = P.totals;
  for (const g of gifts) {
    const pet = P.list.find((p) => p.id === g.pet);
    const entry = { at: now, pet: g.pet, name: pet ? pet.name : '?', species: pet ? pet.species : null, kind: g.kind };
    T.finds += 1;
    if (g.kind === 'gold') { entry.gold = g.gold; T.gold += g.gold; }
    if (g.kind === 'xp') { entry.xp = g.xp; T.xp += g.xp; }
    if (g.kind === 'chest') { entry.chests = g.chests; T.chests += g.chests; }
    if (g.kind === 'potion') { entry.potion = g.potion; T.potions += 1; if (g.key) { entry.key = g.key; T.keys += g.key; } }
    if (g.kind === 'item') { entry.item = { name: g.item.name, rarity: g.item.rarity, slot: g.item.slot }; T.items += 1; }
    P.log.unshift(entry);
  }
  P.log.length = Math.min(P.log.length, Rules.PET.logMax);
}

function renamePet(character, id, name) {
  upgrade(character);
  const pet = findPet(character, id);
  const clean = String(name || '').replace(/[<>]/g, '').trim().slice(0, Rules.PET.nameMax);
  if (!clean) throw new Error('Donne-lui un nom');
  pet.name = clean;
  return { name: clean };
}

// Compagnon de combat : un familier débloqué (3 jours au-dessus de 80 %) te suit dans l'arène. null : aucun.
function setPetFollow(character, id) {
  petsTick(character);
  if (id === null || id === '') { character.pets.follow = null; return { follow: null }; }
  const pet = findPet(character, id);
  if (!pet.follower) throw new Error(`${pet.name} n'est pas encore prêt : garde sa satisfaction au-dessus de ${Rules.PET.followThreshold} % pendant ${Rules.PET.followDays} jours`);
  character.pets.follow = id;
  return { follow: id };
}

// Fusion d'un fantôme : on garde chaque espèce (la plus avancée en cas de doublon) et on additionne les provisions.
function mergePets(c, g) {
  if (!g.pets) return;
  for (const pet of g.pets.list || []) {
    const mine = c.pets.list.find((p) => p.species === pet.species);
    if (!mine) c.pets.list.push(pet);
    else if (pet.level > mine.level || (pet.level === mine.level && pet.xp > mine.xp)) Object.assign(mine, pet);
  }
  for (const [id, n] of Object.entries(g.pets.food || {})) c.pets.food[id] = Math.min(Rules.PET_FOOD_MAX, (c.pets.food[id] || 0) + n);
  for (const id of g.pets.enclos || []) if (!c.pets.enclos.includes(id)) c.pets.enclos.push(id);
  c.pets.log = c.pets.log.concat(g.pets.log || []).sort((a, b) => b.at - a.at).slice(0, Rules.PET.logMax);
  for (const k of Object.keys(c.pets.totals)) c.pets.totals[k] += (g.pets.totals && g.pets.totals[k]) || 0;
  if (!c.pets.active && c.pets.list.length) c.pets.active = c.pets.list[0].id;
}

// ---------- Clés de boss (Défi des boss) ----------

function spendKey(character) {
  upgrade(character);
  if (character.bossKeys < Rules.SOLO.keyCost) throw new Error('Il te faut une Clé de boss : trouve-en dans les reliques de l\'Expédition');
  character.bossKeys -= Rules.SOLO.keyCost;
}

function addKeys(character, n = 1) {
  upgrade(character);
  character.bossKeys += Math.max(0, Math.floor(n) || 0);
}

// Rend de l'énergie (remboursement, cadeau de l'admin), sans dépasser le maximum.
function addEnergy(character, n = 1, now = Date.now()) {
  energyOf(character, now);
  character.energy.value = Math.min(Rules.SOLO.energyMax, character.energy.value + n);
  if (character.energy.value >= Rules.SOLO.energyMax) character.energy.at = now;
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
  mergePets(c, g);
  // Émeraudes, Survivor et Maison du fantôme (il ne peut pas y jouer sans compte, mais au cas où)
  c.emeralds += g.emeralds || 0;
  if (g.survivor && g.survivor.best && (!c.survivor.best || g.survivor.best.score > c.survivor.best.score)) c.survivor.best = g.survivor.best;
  for (const [id, n] of Object.entries((g.house && g.house.owned) || {})) c.house.owned[id] = (c.house.owned[id] || 0) + n;
  // Historique et statistiques du fantôme : réunis (records au maximum)
  c.history = c.history.concat(g.history || []).sort((x, y) => y.at - x.at).slice(0, Rules.HISTORY.max);
  for (const k of Rules.PLAYER_STAT_KEYS) c.lifetime[k] = Rules.PLAYER_STAT_MAX.includes(k) ? Math.max(c.lifetime[k], g.lifetime[k] || 0) : c.lifetime[k] + (g.lifetime[k] || 0);
  for (const [m, v] of Object.entries(g.lifetime.modes || {})) { const mine = c.lifetime.modes[m] || (c.lifetime.modes[m] = { games: 0, wins: 0 }); mine.games += v.games || 0; mine.wins += v.wins || 0; }
  c.lifetimeSince = Math.min(c.lifetimeSince, g.lifetimeSince || c.lifetimeSince);
  for (const k of Rules.COUNTERS) {
    // record de salle : on garde le meilleur des deux, les autres compteurs s'additionnent
    c.counters[k] = Rules.MAX_COUNTERS.includes(k) ? Math.max(c.counters[k], g.counters[k] || 0) : c.counters[k] + (g.counters[k] || 0);
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
  petsTick(c);
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
    power: powerOf(c),
    energyState: energyOf(c),
  };
}

module.exports = {
  newCharacter, upgrade, gearBonus, powerOf, derived, addXp, grant, allocate, resetStats, rollRarity, makeItem, setTactics, setTechniques,
  openChest, buyChests, recycle, equip, unequip, chooseClass, fuse, fuseBatch, reroll, alchemy,
  bump, claimAchievement, setTitle, titleOf, adminGive, setLook, buyCosmetic, setDrawing, clearDrawing, energyOf, spendEnergy, addEnergy, spendKey, addKeys,
  newLifetime, addStat, snapshot, recordActivity, respecStats,
  newPets, newSurvivor, newHouse, petsTick, addPet, rollPetDrop, setActivePet, petAction, feedPet, buyPetFood, buyEnclos, collectFinds, renamePet, setPetFollow, petGainXp,
  getOrCreateTwitchUser, linkTwitch, publicCharacter,
  protectedIds, toggleLock, markSeen, savePreset, applyPreset, deletePreset,
  buyConsumable, equipConsumable, useConsumable,
  talentState, learnTalent, resetTalents,
};
