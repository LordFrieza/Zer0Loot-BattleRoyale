/*
 * Règles du jeu partagées entre le serveur (Node) et le navigateur.
 * Toutes les formules d'équilibrage sont ici : stats, classes, raretés, table de loot, forge, récompenses.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STATS = [
    'vie', 'force', 'defense', 'vitesse', 'esquive', 'critique',
    'vitesse_attaque', 'vol_de_vie', 'precision', 'epines', 'chance', 'stamina',
  ];

  const STAT_INFO = {
    vie: { label: 'Vie', icon: '❤️', desc: 'Augmente la vie maximum du personnage.' },
    force: { label: 'Force', icon: '⚔️', desc: 'Augmente les dégâts infligés à chaque coup.' },
    defense: { label: 'Défense', icon: '🛡️', desc: 'Réduit les dégâts subis.' },
    vitesse: { label: 'Vitesse', icon: '💨', desc: 'Augmente la vitesse de déplacement sur le champ de bataille.' },
    esquive: { label: 'Esquive', icon: '🌀', desc: 'Augmente les chances d\'esquiver complètement une attaque.' },
    critique: { label: 'Critique', icon: '💥', desc: 'Chance de porter un coup critique qui inflige le double de dégâts.' },
    vitesse_attaque: { label: 'Vitesse d\'attaque', icon: '⚡', desc: 'Augmente le nombre d\'attaques par seconde.' },
    vol_de_vie: { label: 'Vol de vie', icon: '🩸', desc: 'Rend une partie des dégâts infligés sous forme de vie.' },
    precision: { label: 'Précision', icon: '🎯', desc: 'Réduit les chances de l\'adversaire d\'esquiver tes attaques.' },
    epines: { label: 'Épines', icon: '🌵', desc: 'Renvoie une partie des dégâts reçus à l\'attaquant.' },
    chance: { label: 'Chance', icon: '🍀', desc: 'Augmente les chances d\'obtenir des raretés supérieures (coffres et forge).' },
    stamina: { label: 'Stamina', icon: '🔋', desc: 'Accélère le remplissage de la barre de stamina, qui déclenche ton ultime (arbre de compétences).' },
  };

  // ---------- Classes ----------
  /*
   * bonus : % ajoutés aux bonus d'équipement (multiplient la stat).
   * flat  : ajouts directs aux valeurs dérivées (ex. +10 % de critique).
   * combat : comportement sur le champ de bataille.
   */
  const CLASS_CHANGE_PRICE = 100;
  const CLASSES = ['guerrier', 'archer', 'mage', 'assassin', 'pretre'];
  const CLASS_INFO = {
    guerrier: {
      label: 'Guerriloot', role: 'Guerrier', icon: '⚔️', color: '#ff6b4a',
      desc: 'Robuste combattant au corps à corps. Il attire l\'attention des ennemis sur lui.',
      perks: ['+30 % Vie', '+25 % Défense', 'Attire l\'aggro des ennemis proches'],
      weapon: 'epee', offhand: 'bouclier',
      bonus: { vie: 30, defense: 25 }, flat: {},
      combat: { range: 40, taunt: 0.7, recovery: 0.3 },
    },
    archer: {
      label: 'Archiloot', role: 'Archer', icon: '🏹', color: '#3ddc5a',
      desc: 'Tire de loin et recule quand un ennemi s\'approche trop près.',
      perks: ['Attaque à distance', 'Recule face aux ennemis proches (sans se coincer contre les bords)', '+15 % Précision', 'S\'immobilise un instant après chaque tir', '−10 % Vie', '−15 % Dégâts'],
      weapon: 'arc', offhand: 'carquois',
      bonus: { vie: -10, force: -15 }, flat: { precision: 0.15 },
      combat: { range: 230, kite: 110, projectile: 'arrow', recovery: 0.6 },
    },
    mage: {
      label: 'Magiloot', role: 'Mage', icon: '🔮', color: '#b14dff',
      desc: 'Lance des boules de feu qui explosent et touchent aussi les ennemis autour de la cible.',
      perks: ['Attaque à distance', 'Explosion : 60 % des dégâts autour de la cible', '+25 % Dégâts', '−15 % Vie', 'Attaque 35 % plus lente'],
      weapon: 'baton', offhand: 'grimoire',
      bonus: { vie: -15, force: 25 }, flat: {},
      combat: { range: 170, projectile: 'fire', aoeRadius: 75, aoeRatio: 0.6, cooldownMult: 1.35, recovery: 0.5 },
    },
    assassin: {
      label: 'Lootassin', role: 'Assassin', icon: '🗡️', color: '#ffd23f',
      desc: 'Rapide et mortel : il traque l\'ennemi le plus affaibli du champ de bataille.',
      perks: ['Cible l\'ennemi le plus faible', '+10 % Critique', '+25 % Vitesse d\'attaque', '+15 % Précision', '+1 % Vol de vie', 'Récupère presque aussitôt après un coup', '−10 % Vie'],
      weapon: 'dagues', offhand: 'dague',
      bonus: { vie: -10, vitesse_attaque: 25 }, flat: { crit: 0.10, precision: 0.15, lifesteal: 0.01 },
      combat: { range: 36, hunter: true, recovery: 0.05 },
    },
    pretre: {
      label: 'Saint-Loot', role: 'Prêtre', icon: '✨', color: '#5fd3ff',
      desc: 'Combattant béni qui régénère sa vie tout au long du combat.',
      perks: ['Régénère 1,5 % de sa vie par seconde', '+10 % Vie', '+10 % Défense', '−10 % Dégâts'],
      weapon: 'masse', offhand: 'relique',
      bonus: { vie: 10, defense: 10, force: -10 }, flat: {},
      combat: { range: 40, regen: 0.015, recovery: 0.3 },
    },
  };
  // Personnage sans classe (viewer qui a tapé !join sans compte) : combattant neutre.
  const NO_CLASS = { label: 'Vagaloot', role: 'Vagabond', icon: '🧳', bonus: {}, flat: {}, combat: { range: 40, recovery: 0.3 } };

  function classInfo(cls) {
    return CLASS_INFO[cls] || NO_CLASS;
  }

  // ---------- Raretés & loot ----------
  const RARITIES = ['commun', 'peu_commun', 'rare', 'epique', 'legendaire'];

  const RARITY_INFO = {
    commun: { label: 'Commun', color: '#e8e8e8', lines: 1, min: 1, max: 3, clicks: 3 },
    // Fourchettes larges qui se chevauchent : un bon objet Rare peut valoir mieux qu'un Épique moyen (et la relance a un intérêt).
    peu_commun: { label: 'Peu commun', color: '#3ddc5a', lines: 2, min: 2, max: 6, clicks: 5 },
    rare: { label: 'Rare', color: '#3b8bff', lines: 3, min: 4, max: 10, clicks: 10 },
    epique: { label: 'Épique', color: '#b14dff', lines: 4, min: 5, max: 15, clicks: 20 },
    legendaire: { label: 'Légendaire', color: '#ff9a1f', lines: 5, min: 6, max: 25, clicks: 30 },
  };

  // Couleur des lumières du coffre selon le nombre de clics déjà donnés.
  function chestLightRarity(clicks) {
    if (clicks >= 21) return 'legendaire';
    if (clicks >= 11) return 'epique';
    if (clicks >= 6) return 'rare';
    if (clicks >= 4) return 'peu_commun';
    return 'commun';
  }

  /*
   * Table de loot. Les probabilités évoluent linéairement de la chance 0 au plafond (200 depuis la 1.3 : les mêmes
   * taux qu'avant à 85, atteints plus progressivement).
   * Chance 0   : 90 / 6,5 / 2,8 / 0,65 / 0,05
   * Chance 40  : 73 / 15 / 8,75 / 2,69 / 0,56
   * Chance 200 : 5 / 49 / 32,55 / 10,85 / 2,6
   */
  const LOOT_BASE = [90, 6.5, 2.8, 0.65, 0.05];
  const LUCK_CAP = 200;
  const LOOT_AT_CAP = [5, 49, 32.55, 10.85, 2.6]; // taux au plafond de chance
  const LOOT_PER_LUCK = LOOT_BASE.map((b, i) => (LOOT_AT_CAP[i] - b) / LUCK_CAP); // par point de chance

  function lootTable(luck) {
    const l = Math.max(0, Math.min(LUCK_CAP, luck || 0));
    const table = { [RARITIES[0]]: 0 };
    let rest = 100;
    RARITIES.forEach((r, i) => {
      if (i === 0) return;
      table[r] = Math.round((LOOT_BASE[i] + (LOOT_AT_CAP[i] - LOOT_BASE[i]) * l / LUCK_CAP) * 100) / 100;
      rest -= table[r];
    });
    table[RARITIES[0]] = Math.round(rest * 100) / 100; // Commun = le reste : total de 100 % pile
    return table;
  }

  // ---------- Équipement ----------
  // Poids de tirage des lignes de stats : 1 par défaut, plus pour les stats « de prédilection ».
  // La Stamina ne sort pas sur les objets (points de caractéristique et arbre de compétences seulement).
  const w = (favored) => Object.assign(Object.fromEntries(STATS.filter((s) => s !== 'stamina').map((s) => [s, 1])), favored);

  const SLOTS = ['casque', 'plastron', 'gants', 'ceinture', 'pantalon', 'boucles', 'arme', 'secondaire'];

  const SLOT_INFO = {
    casque: { label: 'Casque', icon: '⛑️', names: ['Heaume', 'Casque', 'Capuche', 'Couronne'], weights: w({ vie: 3, defense: 3 }) },
    plastron: { label: 'Plastron', icon: '🦺', names: ['Plastron', 'Cuirasse', 'Cotte de mailles', 'Brigandine'], weights: w({ vie: 4, defense: 4, epines: 2 }) },
    gants: { label: 'Gants', icon: '🧤', names: ['Gantelets', 'Gants', 'Mitaines', 'Poignes'], weights: w({ force: 3, critique: 3, vitesse_attaque: 3 }) },
    ceinture: { label: 'Ceinture', icon: '🎗️', names: ['Ceinture', 'Ceinturon', 'Sangle', 'Écharpe'], weights: w({ vie: 3, vitesse: 2, defense: 2, vol_de_vie: 2 }) },
    pantalon: { label: 'Pantalon', icon: '👖', names: ['Jambières', 'Pantalon', 'Cuissardes', 'Grègues'], weights: w({ defense: 3, vitesse: 3, esquive: 2 }) },
    boucles: { label: 'Boucles d\'oreilles', icon: '💎', names: ['Boucles', 'Anneaux', 'Pendants', 'Clous'], weights: w({ chance: 5, esquive: 2, precision: 2 }) },
    arme: { label: 'Arme', icon: '🗡️' },
    secondaire: { label: 'Main secondaire', icon: '🛡️' },
  };

  // Types d'armes et d'objets secondaires : chacun est réservé à une classe.
  const KINDS = {
    epee: { label: 'Épée', slot: 'arme', cls: 'guerrier', icon: '🗡️', names: ['Épée', 'Lame', 'Sabre', 'Glaive'], weights: w({ force: 4, critique: 2, vol_de_vie: 2 }) },
    arc: { label: 'Arc', slot: 'arme', cls: 'archer', icon: '🏹', names: ['Arc', 'Arc long', 'Arbalète', 'Arc court'], weights: w({ precision: 4, vitesse_attaque: 3, critique: 2 }) },
    baton: { label: 'Bâton', slot: 'arme', cls: 'mage', icon: '🪄', names: ['Bâton', 'Sceptre', 'Baguette', 'Canne'], weights: w({ force: 4, critique: 3 }) },
    dagues: { label: 'Dagues', slot: 'arme', cls: 'assassin', icon: '🔪', names: ['Dagues', 'Stylets', 'Kriss', 'Lames jumelles'], weights: w({ critique: 4, vitesse_attaque: 4 }) },
    masse: { label: 'Masse', slot: 'arme', cls: 'pretre', icon: '🔨', names: ['Masse', 'Marteau', 'Fléau', 'Étoile du matin'], weights: w({ force: 3, vie: 2, vol_de_vie: 3 }) },
    bouclier: { label: 'Bouclier', slot: 'secondaire', cls: 'guerrier', icon: '🛡️', names: ['Bouclier', 'Pavois', 'Rondache', 'Égide'], weights: w({ defense: 5, vie: 3, epines: 3 }) },
    carquois: { label: 'Carquois', slot: 'secondaire', cls: 'archer', icon: '🎯', names: ['Carquois', 'Faisceau', 'Étui', 'Carquois runique'], weights: w({ vitesse_attaque: 4, precision: 3 }) },
    grimoire: { label: 'Grimoire', slot: 'secondaire', cls: 'mage', icon: '📖', names: ['Grimoire', 'Orbe', 'Tome', 'Codex'], weights: w({ force: 3, critique: 3, chance: 2 }) },
    dague: { label: 'Dague de parade', slot: 'secondaire', cls: 'assassin', icon: '🗡️', names: ['Main-gauche', 'Dague de parade', 'Surin', 'Couteau'], weights: w({ esquive: 3, critique: 3, vitesse_attaque: 2 }) },
    relique: { label: 'Relique', slot: 'secondaire', cls: 'pretre', icon: '📿', names: ['Relique', 'Reliquaire', 'Talisman', 'Icône'], weights: w({ vie: 4, vol_de_vie: 3, defense: 2 }) },
  };
  const KINDS_BY_SLOT = {
    arme: Object.keys(KINDS).filter((k) => KINDS[k].slot === 'arme'),
    secondaire: Object.keys(KINDS).filter((k) => KINDS[k].slot === 'secondaire'),
  };
  // Dans les coffres, une arme / un objet secondaire est pour ta classe 1 fois sur 2 (sinon une classe au hasard).
  const OWN_CLASS_KIND_CHANCE = 0.5;

  function itemWeights(item) {
    return item.kind ? KINDS[item.kind].weights : SLOT_INFO[item.slot].weights;
  }

  // Classe requise pour équiper l'objet (null = toutes les classes).
  function itemClass(item) {
    return item.kind ? KINDS[item.kind].cls : null;
  }

  // Depuis la 1.3, tout le monde peut équiper tous les objets : la classe d'une arme ou d'un objet secondaire donne
  // seulement un bonus (voir itemClassBonus). Gardé pour la compatibilité des appels existants.
  function canEquip() {
    return true;
  }

  /*
   * Bonus de classe : une arme ou un objet secondaire de sa propre classe donne un bonus en % dans la stat de
   * prédilection de la classe, selon la rareté de l'objet (ex. Saint-Loot : Vie +5 % sur un objet Épique).
   */
  const CLASS_ITEM_BONUS = {
    stat: { guerrier: 'defense', archer: 'precision', mage: 'force', assassin: 'critique', pretre: 'vie' },
    value: { commun: 2, peu_commun: 3, rare: 4, epique: 5, legendaire: 7 },
  };
  // Bonus que l'objet donne à sa classe : { cls, stat, value } (null pour un objet sans classe).
  function classBonusOf(item) {
    const cls = itemClass(item);
    if (!cls) return null;
    return { cls, stat: CLASS_ITEM_BONUS.stat[cls], value: CLASS_ITEM_BONUS.value[item.rarity] || 0 };
  }
  // Bonus réellement obtenu par un joueur de classe `cls` (null si l'objet n'est pas de sa classe).
  function itemClassBonus(item, cls) {
    const b = classBonusOf(item);
    return b && b.cls === cls ? b : null;
  }

  const STAT_SUFFIX = {
    vie: 'de Vitalité', force: 'du Colosse', defense: 'du Rempart', vitesse: 'du Vent', esquive: 'de l\'Ombre',
    critique: 'du Bourreau', vitesse_attaque: 'de la Tempête', vol_de_vie: 'du Vampire', precision: 'du Faucon',
    epines: 'du Hérisson', chance: 'du Trèfle', stamina: 'de l\'Endurance',
  };

  const RARITY_PREFIX = {
    commun: '', peu_commun: 'Solide', rare: 'Raffiné', epique: 'Mythique', legendaire: 'Divin',
  };

  // ---------- Récompenses ----------
  const REWARDS = {
    kill: { xp: 100, chests: 1, gold: 10 },
    win: { xp: 300, chests: 1, gold: 30 },
    participation: { xp: 25, chests: 0, gold: 0 }, // chaque combattant à la fin d'une bataille
    firstblood: { xp: 0, chests: 1, gold: 0 }, // premier kill de la bataille
    double: { xp: 0, chests: 1, gold: 0 }, // 2 kills d'affilée en moins de STREAK_WINDOW secondes
    triple: { xp: 0, chests: 0, gold: 0 }, // annonce seulement
    massacre: { xp: 0, chests: 2, gold: 0 }, // 5 kills dans la même bataille
  };
  const STREAK_WINDOW = 8;
  const MASSACRE_KILLS = 5;

  /*
   * Récompenses équilibrées des modes où l'on s'affronte (Battle Royale, Roi de la Colline, Guerre des clans).
   * Puissance d'un combattant = niveau + (total des % de son équipement, bonus de classe compris) / 10.
   * Les récompenses de victoire, de kill et de série sont multipliées par
   *   (puissance des adversaires ÷ ta puissance), borné entre ×0,4 et ×2 :
   * battre plus fort que soi rapporte plus, écraser plus faible rapporte moins. La participation ne change pas.
   */
  const POWER = { gearDivisor: 10, minMult: 0.4, maxMult: 2 };
  function powerScore(level, gearTotal) {
    return Math.round(((level || 1) + (gearTotal || 0) / POWER.gearDivisor) * 10) / 10;
  }
  function rewardMultiplier(mine, theirs) {
    if (!(mine > 0) || !(theirs > 0)) return 1;
    return Math.round(Math.min(POWER.maxMult, Math.max(POWER.minMult, theirs / mine)) * 100) / 100;
  }
  // Applique le multiplicateur : XP et golds arrondis, coffres arrondis au hasard (0,4 coffre = 40 % de chance d'en avoir 1).
  function scaleReward(reward, mult, rnd = Math.random) {
    const c = (reward.chests || 0) * mult;
    const chests = Math.floor(c) + (rnd() < c - Math.floor(c) ? 1 : 0);
    return { xp: Math.round((reward.xp || 0) * mult), gold: Math.round((reward.gold || 0) * mult), chests };
  }
  // Équipement estimé d'un bot à partir de l'apparence de ses pièces (rareté par emplacement) : valeur moyenne des lignes.
  function lookGearTotal(look) {
    let total = 0;
    for (const r of Object.values(look || {})) {
      const info = RARITY_INFO[r];
      if (info) total += info.lines * (info.min + info.max) / 2;
    }
    return total;
  }
  const STREAK_INFO = {
    firstblood: { label: 'PREMIER KILL !', color: '#ff4d6d' },
    double: { label: 'DOUBLE KILL !', color: '#ffb000' },
    triple: { label: 'TRIPLE KILL !', color: '#ff7a00' },
    massacre: { label: 'MASSACRE !', color: '#b14dff' },
  };

  const CHEST_PRICE = 100;
  const ITEMS_PER_CHEST = 3;
  const RECYCLE_GOLD = 3; // golds par objet recyclé, quelle que soit la rareté

  // ---------- Forge ----------
  /*
   * Fusion : 3 objets de même rareté → 1 nouvel objet pour ta classe, contre quelques golds (FUSE_PRICE).
   * Chance de monter d'une rareté : FUSE_UPGRADE[rareté] + 0,5 % par point de chance effective (bonus max +20 %,
   * réduit de moitié pour passer d'Épique à Légendaire). Sinon : un nouvel objet de même rareté.
   * 3 légendaires → un nouveau légendaire.
   */
  const FUSE_COUNT = 3;
  const FUSE_BATCH_MAX = 30; // forge en série : 30 fusions au plus d'un coup
  const FUSE_UPGRADE = { commun: 40, peu_commun: 30, rare: 15, epique: 5, legendaire: 0 };
  const FUSE_LUCK_BONUS = 0.5;
  const FUSE_LUCK_BONUS_CAP = 20;
  const FUSE_PRICE = { commun: 10, peu_commun: 20, rare: 40, epique: 80, legendaire: 150 };
  // Échec à la forge : +1 % de réussite à la prochaine fusion de cette rareté (remis à 0 à la réussite)
  const FUSE_PITY = 1;
  // pity : nombre d'échecs d'affilée pour cette rareté (character.forgePity[rareté])
  function fuseUpgradeChance(rarity, luck, pity = 0) {
    if (!FUSE_UPGRADE[rarity]) return 0;
    const bonus = Math.min(FUSE_LUCK_BONUS_CAP, (luck || 0) * FUSE_LUCK_BONUS);
    return Math.min(100, FUSE_UPGRADE[rarity] + (rarity === 'epique' ? bonus / 2 : bonus) + FUSE_PITY * Math.max(0, pity || 0));
  }
  // Relance d'une ligne : prix en golds selon la rareté de l'objet.
  const REROLL_PRICE = { commun: 10, peu_commun: 20, rare: 40, epique: 80, legendaire: 150 };

  /*
   * Alchimie noire : on sacrifie un objet de même rareté (et des golds) pour augmenter la valeur
   * d'une ligne choisie d'un autre objet, sans jamais changer sa stat. La ligne peut dépasser le
   * maximum normal de la rareté, jusqu'à un plafond (`capMult` × maximum).
   */
  const ALCHEMY = {
    price: { commun: 15, peu_commun: 30, rare: 60, epique: 120, legendaire: 250 },
    gain: { commun: [1, 1], peu_commun: [1, 2], rare: [1, 2], epique: [1, 3], legendaire: [2, 4] },
    capMult: 1.4,
  };
  function alchemyCap(rarity) {
    const info = RARITY_INFO[rarity];
    return info ? Math.round(info.max * ALCHEMY.capMult) : 0;
  }

  // ---------- Panoplies ----------
  /*
   * Un objet peut appartenir à une panoplie. Équiper plusieurs pièces de la même panoplie donne
   * des points bonus (comme des points de compétence) dans ses deux stats.
   */
  const SETS = {
    nosferatu: { label: 'Nosferatu', icon: '🧛', of: 'de Nosferatu', color: '#e0405f', stats: ['vol_de_vie', 'force'] },
    bastion: { label: 'Bastion', icon: '🏰', of: 'du Bastion', color: '#9aa4b8', stats: ['defense', 'vie'] },
    ouragan: { label: 'Ouragan', icon: '🌪️', of: 'de l\'Ouragan', color: '#5fd3ff', stats: ['vitesse_attaque', 'vitesse'] },
    lynx: { label: 'Œil de Lynx', icon: '🦅', of: 'de l\'Œil de Lynx', color: '#ffd23f', stats: ['precision', 'critique'] },
    // Fortune : points doublés à chaque palier (la Chance et l'Esquive rapportent peu point par point)
    fortune: { label: 'Fortune', icon: '🍀', of: 'de Fortune', color: '#3ddc5a', stats: ['chance', 'esquive'], points: [4, 8, 14, 20] },
    ronces: { label: 'Ronces', icon: '🌹', of: 'des Ronces', color: '#b14dff', stats: ['epines', 'vie'] },
  };
  // Paliers : nombre de pièces équipées → points bonus dans CHAQUE stat de la panoplie.
  const SET_TIERS = [{ pieces: 2, points: 2 }, { pieces: 4, points: 4 }, { pieces: 6, points: 7 }, { pieces: 8, points: 10 }];
  // Chance qu'un objet tiré (coffre / forge) appartienne à une panoplie, selon sa rareté.
  const SET_DROP_CHANCE = { commun: 0.05, peu_commun: 0.08, rare: 0.12, epique: 0.18, legendaire: 0.25 };

  // Paliers d'une panoplie : ceux de SET_TIERS, ou ses propres points par palier (`points`, ex. Fortune).
  function setTiers(key) {
    const own = SETS[key] && SETS[key].points;
    return own ? SET_TIERS.map((t, i) => ({ pieces: t.pieces, points: own[i] })) : SET_TIERS;
  }

  function setTier(pieces, key) {
    let tier = null;
    for (const t of setTiers(key)) if (pieces >= t.pieces) tier = t;
    return tier;
  }

  // Bonus des panoplies pour un équipement : { points: {stat: n}, sets: [{ key, pieces, tier, next }] }
  function setBonus(equipment) {
    const counts = {};
    for (const item of Object.values(equipment || {})) if (item && item.set && SETS[item.set]) counts[item.set] = (counts[item.set] || 0) + 1;
    const points = emptyStats();
    const sets = [];
    for (const [key, pieces] of Object.entries(counts)) {
      const tier = setTier(pieces, key);
      if (tier) for (const st of SETS[key].stats) points[st] += tier.points;
      sets.push({ key, pieces, tier, next: setTiers(key).find((t) => t.pieces > pieces) || null });
    }
    sets.sort((a, b) => b.pieces - a.pieces);
    return { points, sets };
  }

  // ---------- Succès ----------
  /*
   * metric : compteur suivi (voir achievementValue). Le nom du succès devient un titre affichable.
   */
  const ACHIEVEMENTS = [
    { id: 'battles1', metric: 'battles', goal: 1, name: 'Recrue', desc: 'Participer à 1 bataille', gold: 10 },
    { id: 'battles10', metric: 'battles', goal: 10, name: 'Habitué de l\'arène', desc: 'Participer à 10 batailles', gold: 50 },
    { id: 'battles100', metric: 'battles', goal: 100, name: 'Vétéran', desc: 'Participer à 100 batailles', gold: 300 },
    { id: 'battles500', metric: 'battles', goal: 500, name: 'Légende de l\'arène', desc: 'Participer à 500 batailles', gold: 1000 },
    { id: 'kills1', metric: 'kills', goal: 1, name: 'Premier sang', desc: 'Faire 1 kill', gold: 10 },
    { id: 'kills10', metric: 'kills', goal: 10, name: 'Chasseur', desc: 'Faire 10 kills', gold: 50 },
    { id: 'kills100', metric: 'kills', goal: 100, name: 'Tueur', desc: 'Faire 100 kills', gold: 300 },
    { id: 'kills500', metric: 'kills', goal: 500, name: 'Faucheuse', desc: 'Faire 500 kills', gold: 1000 },
    { id: 'wins1', metric: 'wins', goal: 1, name: 'Champion', desc: 'Remporter 1 bataille', gold: 50 },
    { id: 'wins10', metric: 'wins', goal: 10, name: 'Conquérant', desc: 'Remporter 10 batailles', gold: 300 },
    { id: 'wins50', metric: 'wins', goal: 50, name: 'Invaincu', desc: 'Remporter 50 batailles', gold: 1000 },
    { id: 'firstblood1', metric: 'firstblood', goal: 1, name: 'Prompt', desc: 'Faire le premier kill d\'une bataille', gold: 30 },
    { id: 'double5', metric: 'double', goal: 5, name: 'Enchaîneur', desc: 'Réussir 5 double kills', gold: 100 },
    { id: 'massacre1', metric: 'massacre', goal: 1, name: 'Massacreur', desc: 'Réussir 1 massacre (5 kills dans une bataille)', gold: 150 },
    { id: 'level5', metric: 'level', goal: 5, name: 'Aguerri', desc: 'Atteindre le niveau 5', gold: 50 },
    { id: 'level10', metric: 'level', goal: 10, name: 'Héros', desc: 'Atteindre le niveau 10', gold: 200 },
    { id: 'level25', metric: 'level', goal: 25, name: 'Mythe', desc: 'Atteindre le niveau 25', gold: 1000 },
    { id: 'chests1', metric: 'chests', goal: 1, name: 'Curieux', desc: 'Ouvrir 1 coffre', gold: 10 },
    { id: 'chests25', metric: 'chests', goal: 25, name: 'Pilleur', desc: 'Ouvrir 25 coffres', gold: 100 },
    { id: 'chests100', metric: 'chests', goal: 100, name: 'Collectionneur', desc: 'Ouvrir 100 coffres', gold: 300 },
    { id: 'chests500', metric: 'chests', goal: 500, name: 'Roi du loot', desc: 'Ouvrir 500 coffres', gold: 1000 },
    { id: 'legendary1', metric: 'legendary', goal: 1, name: 'Élu des dieux', desc: 'Obtenir 1 objet Légendaire (coffre ou forge)', gold: 200 },
    { id: 'legendary10', metric: 'legendary', goal: 10, name: 'Divin', desc: 'Obtenir 10 objets Légendaires', gold: 1000 },
    { id: 'recycled10', metric: 'recycled', goal: 10, name: 'Recycleur', desc: 'Recycler 10 objets', gold: 20 },
    { id: 'recycled100', metric: 'recycled', goal: 100, name: 'Écolo', desc: 'Recycler 100 objets', gold: 100 },
    { id: 'recycled500', metric: 'recycled', goal: 500, name: 'Broyeur', desc: 'Recycler 500 objets', gold: 300 },
    { id: 'fused1', metric: 'fused', goal: 1, name: 'Apprenti forgeron', desc: 'Fusionner 1 fois à la forge', gold: 20 },
    { id: 'fused25', metric: 'fused', goal: 25, name: 'Forgeron', desc: 'Fusionner 25 fois à la forge', gold: 150 },
    { id: 'fused100', metric: 'fused', goal: 100, name: 'Maître forgeron', desc: 'Fusionner 100 fois à la forge', gold: 500 },
    { id: 'rerolled10', metric: 'rerolled', goal: 10, name: 'Alchimiste', desc: 'Relancer 10 lignes à la forge', gold: 100 },
    { id: 'alchemy10', metric: 'alchemy', goal: 10, name: 'Alchimiste noir', desc: 'Réussir 10 transmutations d\'Alchimie noire', gold: 150 },
    { id: 'betsWon1', metric: 'betsWon', goal: 1, name: 'Parieur', desc: 'Gagner 1 pari', gold: 20 },
    { id: 'betsWon10', metric: 'betsWon', goal: 10, name: 'Bookmaker', desc: 'Gagner 10 paris', gold: 150 },
    { id: 'betsWon50', metric: 'betsWon', goal: 50, name: 'Oracle', desc: 'Gagner 50 paris', gold: 500 },
    { id: 'sets2', metric: 'setPieces', goal: 2, name: 'Assorti', desc: 'Équiper 2 pièces d\'une même panoplie', gold: 50 },
    { id: 'cosmetics1', metric: 'cosmetics', goal: 1, name: 'Coquet', desc: 'Acheter 1 article à la boutique', gold: 20 },
    { id: 'cosmetics10', metric: 'cosmetics', goal: 10, name: 'Icône de mode', desc: 'Posséder 10 articles de la boutique', gold: 300 },
    { id: 'sets6', metric: 'setPieces', goal: 6, name: 'Tiré à quatre épingles', desc: 'Équiper 6 pièces d\'une même panoplie', gold: 500 },
    { id: 'boss1', metric: 'trollWins', goal: 1, name: 'Tueur de troll', desc: 'Vaincre le Troll (Combat de Boss ou Défi des boss)', gold: 100 },
    { id: 'boss10', metric: 'trollWins', goal: 10, name: 'Fléau des trolls', desc: 'Vaincre le Troll 10 fois', gold: 500 },
    { id: 'dragon1', metric: 'dragonWins', goal: 1, name: 'Pourfendeur de dragon', desc: 'Vaincre le Dragon (Combat de Boss ou Défi des boss)', gold: 150 },
    { id: 'dragon10', metric: 'dragonWins', goal: 10, name: 'Fléau des dragons', desc: 'Vaincre le Dragon 10 fois', gold: 500 },
    { id: 'sorcier1', metric: 'sorcierWins', goal: 1, name: 'Briseur de sortilèges', desc: 'Vaincre le Magicien des ténèbres (Combat de Boss ou Défi des boss)', gold: 150 },
    { id: 'sorcier10', metric: 'sorcierWins', goal: 10, name: 'Exorciste', desc: 'Vaincre le Magicien des ténèbres 10 fois', gold: 500 },
    { id: 'koth1', metric: 'kothWins', goal: 1, name: 'Prince de la colline', desc: 'Gagner 1 partie de Roi de la Colline', gold: 50 },
    { id: 'koth10', metric: 'kothWins', goal: 10, name: 'Roi de la montagne', desc: 'Gagner 10 parties de Roi de la Colline', gold: 300 },
    { id: 'clans1', metric: 'clansWins', goal: 1, name: 'Soldat du clan', desc: 'Gagner 1 Guerre des clans avec ton équipe', gold: 30 },
    { id: 'clans10', metric: 'clansWins', goal: 10, name: 'Général', desc: 'Gagner 10 Guerres des clans avec ton équipe', gold: 200 },
    { id: 'mvp1', metric: 'clansMvp', goal: 1, name: 'MVP', desc: 'Être le MVP d\'une Guerre des clans', gold: 100 },
    { id: 'gold100', metric: 'goldBest', goal: 100, name: 'Chercheur d\'or', desc: 'Ramasser 100 golds en un seul Golden Shower', gold: 50 },
    { id: 'gold200', metric: 'goldBest', goal: 200, name: 'Roi du butin', desc: 'Ramasser 200 golds en un seul Golden Shower', gold: 200 },
    { id: 'dungeon5', metric: 'dungeonBest', goal: 5, name: 'Explorateur', desc: 'Atteindre la salle 5 du Raid de Donjon', gold: 50 },
    { id: 'dungeon10', metric: 'dungeonBest', goal: 10, name: 'Aventurier', desc: 'Atteindre la salle 10 du Raid de Donjon', gold: 200 },
    { id: 'dungeon20', metric: 'dungeonBest', goal: 20, name: 'Seigneur du donjon', desc: 'Atteindre la salle 20 du Raid de Donjon', gold: 1000 },
    { id: 'expedition10', metric: 'expeditionBest', goal: 10, name: 'Spéléologue', desc: 'Atteindre la profondeur 10 en Expédition (mode Solo)', gold: 100 },
    { id: 'expedition20', metric: 'expeditionBest', goal: 20, name: 'Explorateur des abysses', desc: 'Atteindre la profondeur 20 en Expédition', gold: 300 },
    { id: 'expedition40', metric: 'expeditionBest', goal: 40, name: 'Seigneur des profondeurs', desc: 'Atteindre la profondeur 40 en Expédition', gold: 1000 },
    { id: 'relics50', metric: 'relics', goal: 50, name: 'Collectionneur de reliques', desc: 'Choisir 50 reliques en Expédition', gold: 200 },
    { id: 'challenge1', metric: 'challengeWins', goal: 1, name: 'Duelliste', desc: 'Réussir 1 Défi des boss (mode Solo)', gold: 50 },
    { id: 'hero1', metric: 'heroWins', goal: 1, name: 'Héroïque', desc: 'Réussir un Défi des boss en Héroïque (ou plus)', gold: 200 },
    { id: 'legend1', metric: 'legendWins', goal: 1, name: 'Légende vivante', desc: 'Réussir un Défi des boss en Légendaire (ou plus)', gold: 500 },
    { id: 'sold1', metric: 'sold', goal: 1, name: 'Marchand', desc: 'Vendre 1 objet au marché', gold: 30 },
    { id: 'sold10', metric: 'sold', goal: 10, name: 'Négociant', desc: 'Vendre 10 objets au marché', gold: 200 },
    { id: 'bought1', metric: 'bought', goal: 1, name: 'Client', desc: 'Acheter 1 objet au marché', gold: 20 },
    { id: 'techs1', metric: 'techs', goal: 1, name: 'Technicien', desc: 'Équiper une technique (onglet Style de combat)', gold: 30 },
    { id: 'mimic1', metric: 'mimicWins', goal: 1, name: 'Briseur de coffres', desc: 'Vaincre le Mimic (Combat de Boss, Boss Rush ou Défi des boss)', gold: 150 },
    { id: 'liche1', metric: 'licheWins', goal: 1, name: 'Dégel', desc: 'Vaincre la Liche de glace', gold: 150 },
    { id: 'maexxna1', metric: 'maexxnaWins', goal: 1, name: 'Arachnophobe', desc: 'Vaincre Maexxna la Veuve noire', gold: 150 },
    { id: 'ether1', metric: 'etherWins', goal: 1, name: 'Exorciste', desc: 'Vaincre Ether le Fantôme', gold: 200 },
    { id: 'lilith1', metric: 'lilithWins', goal: 1, name: 'Dresseur de chats', desc: 'Vaincre Lilith le Chat', gold: 200 },
    { id: 'daedra1', metric: 'daedraWins', goal: 1, name: 'Briseur de chaînes', desc: 'Vaincre Daedra la Succube', gold: 200 },
    { id: 'fabuleux1', metric: 'fabuleuxWins', goal: 1, name: 'Fabuleux', desc: 'Réussir un Défi des boss en Fabuleux (ou plus)', gold: 3000 },
    { id: 'mythique1', metric: 'mythiqueWins', goal: 1, name: 'Mythique', desc: 'Réussir un Défi des boss en Mythique (ou plus)', gold: 8000 },
    { id: 'divin1', metric: 'divinWins', goal: 1, name: 'Divin', desc: 'Réussir un Défi des boss en Divin', gold: 20000 },
    { id: 'rush3', metric: 'rushBest', goal: 3, name: 'Enchaîneur', desc: 'Vaincre 3 boss dans une même partie de Boss Rush', gold: 150 },
    { id: 'rush6', metric: 'rushBest', goal: 6, name: 'Marathonien des boss', desc: 'Vaincre 6 boss dans une même partie de Boss Rush', gold: 600 },
    { id: 'pet1', metric: 'pets', goal: 1, name: 'Ami des bêtes', desc: 'Obtenir un familier (5 % de chance par boss vaincu)', gold: 100 },
    { id: 'pet3', metric: 'pets', goal: 3, name: 'Ménagerie', desc: 'Posséder 3 familiers différents', gold: 400 },
    { id: 'petFollow1', metric: 'petFollowers', goal: 1, name: 'Inséparables', desc: 'Débloquer un compagnon de combat (3 jours de bonheur au-dessus de 80 %)', gold: 300 },
    { id: 'petFinds20', metric: 'petFinds', goal: 20, name: 'Bon chien-chien', desc: 'Récupérer 20 trouvailles de ton familier', gold: 200 },
    { id: 'casino25', metric: 'casinoPlays', goal: 25, name: 'Faites vos jeux', desc: 'Jouer 25 parties au casino', gold: 100 },
    { id: 'jackpot1', metric: 'jackpots', goal: 1, name: 'JACKPOT !', desc: 'Aligner trois 7 à la machine à sous de Pyrax', gold: 1000 },
    { id: 'sv10', metric: 'svBestWave', goal: 10, name: 'Survivant', desc: 'Atteindre la vague 10 au Survivor', gold: 200 },
    { id: 'sv30', metric: 'svBestWave', goal: 30, name: 'Increvable', desc: 'Atteindre la vague 30 au Survivor', gold: 1500 },
    { id: 'svBoss10', metric: 'svBosses', goal: 10, name: 'Chasseur de boss', desc: 'Vaincre 10 boss au Survivor', gold: 500 },
    { id: 'deco5', metric: 'decoLevel', goal: 5, name: 'Petit nid douillet', desc: 'Atteindre le niveau de décoration 5', gold: 300 },
    { id: 'deco15', metric: 'decoLevel', goal: 15, name: 'Palais des merveilles', desc: 'Atteindre le niveau de décoration 15', gold: 2000 },
    { id: 'casinoLegend1', metric: 'casinoLegend', goal: 1, name: 'Coup de chance incroyable', desc: 'Gagner un lot incroyable dans la caisse de Grignotor', gold: 500 },
  ];
  const COUNTERS = ['chests', 'legendary', 'recycled', 'fused', 'rerolled', 'betsWon', 'firstblood', 'double', 'massacre', 'subs', 'bossWins', 'dungeonBest', 'alchemy', 'soloTroll', 'soloDragon', 'soloSorcier', 'expeditionBest',
    'trollWins', 'dragonWins', 'sorcierWins', 'kothWins', 'clansWins', 'clansMvp', 'goldBest', 'relics', 'challengeWins', 'heroWins',
    'legendWins', 'heroTroll', 'heroDragon', 'heroSorcier', 'techs', 'sold', 'bought',
    'mimicWins', 'licheWins', 'maexxnaWins', 'soloMimic', 'soloLiche', 'soloMaexxna', 'heroMimic', 'heroLiche', 'heroMaexxna', 'rushBest', 'pets', 'petFollowers', 'petFinds',
    'casinoPlays', 'jackpots', 'casinoLegend', 'svBestWave', 'svBosses', 'decoLevel',
    'legendTroll', 'legendDragon', 'legendSorcier', 'legendMimic', 'legendLiche', 'legendMaexxna', 'goldPeak',
    'etherWins', 'lilithWins', 'daedraWins', 'soloEther', 'soloLilith', 'soloDaedra', 'heroEther', 'heroLilith', 'heroDaedra',
    'legendEther', 'legendLilith', 'legendDaedra', 'fabuleuxWins', 'mythiqueWins', 'divinWins'];
  // Compteurs de record : la fusion d'un fantôme garde le maximum au lieu d'additionner.
  const MAX_COUNTERS = ['dungeonBest', 'expeditionBest', 'goldBest', 'techs', 'rushBest', 'pets', 'petFollowers', 'svBestWave', 'decoLevel', 'goldPeak'];
  // Exploit « vaincre ce boss seul » : compteur incrémenté par boss.
  const SOLO_BOSS_COUNTER = { troll: 'soloTroll', dragon: 'soloDragon', sorcier: 'soloSorcier', mimic: 'soloMimic', liche: 'soloLiche', maexxna: 'soloMaexxna', ether: 'soloEther', lilith: 'soloLilith', daedra: 'soloDaedra' };
  // Victoires contre chaque boss (Combat de Boss et Défi des boss confondus).
  const BOSS_WIN_COUNTER = { troll: 'trollWins', dragon: 'dragonWins', sorcier: 'sorcierWins', mimic: 'mimicWins', liche: 'licheWins', maexxna: 'maexxnaWins', ether: 'etherWins', lilith: 'lilithWins', daedra: 'daedraWins' };
  // Défi des boss réussi en Héroïque ou plus : débloque la peau légendaire du boss.
  const HERO_BOSS_COUNTER = { troll: 'heroTroll', dragon: 'heroDragon', sorcier: 'heroSorcier', mimic: 'heroMimic', liche: 'heroLiche', maexxna: 'heroMaexxna', ether: 'heroEther', lilith: 'heroLilith', daedra: 'heroDaedra' };
  // Défi des boss réussi en Légendaire ou plus, par boss (skins d'exploit à 100 victoires).
  const LEGEND_BOSS_COUNTER = { troll: 'legendTroll', dragon: 'legendDragon', sorcier: 'legendSorcier', mimic: 'legendMimic', liche: 'legendLiche', maexxna: 'legendMaexxna', ether: 'legendEther', lilith: 'legendLilith', daedra: 'legendDaedra' };

  function achievementValue(character, metric) {
    if (metric === 'battles' || metric === 'kills' || metric === 'wins') return (character.record && character.record[metric]) || 0;
    if (metric === 'level') return character.level || 1;
    if (metric === 'cosmetics') return (character.owned || []).filter((id) => !(COSMETICS[id] && COSMETICS[id].empty)).length; // les articles « Vide » ne comptent pas
    if (metric === 'setPieces') return Math.max(0, ...setBonus(character.equipment).sets.map((x) => x.pieces));
    return (character.counters && character.counters[metric]) || 0;
  }

  function achievementState(character, a) {
    const value = achievementValue(character, a.metric);
    const done = value >= a.goal;
    const claimed = !!(character.claimed && character.claimed.includes(a.id));
    return { value: Math.min(value, a.goal), done, claimed };
  }

  function achievementById(id) {
    return ACHIEVEMENTS.find((a) => a.id === id) || null;
  }

  // ---------- Événements de bataille (choisis par l'admin) ----------
  const BATTLE_EVENTS = {
    double: { label: 'Loot double', icon: '💰', color: '#ffb000', desc: 'Toute l\'XP, les golds et les coffres gagnés pendant la bataille sont doublés.' },
    fog: { label: 'Brouillard', icon: '🌫️', color: '#cfd8e3', desc: 'Des nappes de brouillard apparaissent et disparaissent : on ne peut y être ciblé que de très près.' },
    fast: { label: 'Zone rapide', icon: '⚡', color: '#5fd3ff', desc: 'Tous les combattants se déplacent 5 fois plus vite.' },
    meteors: { label: 'Pluie de météores', icon: '☄️', color: '#ff6b2a', desc: 'Des météores de feu s\'écrasent au hasard sur l\'arène et font très mal.' },
  };

  // ---------- Modes de jeu (choisis par l'admin avant d'ouvrir la file) ----------
  const GAME_MODES = {
    br: {
      label: 'Battle Royale', icon: '⚔️', color: '#ffb000', coop: false, minPlayers: 2,
      desc: 'Chacun pour soi : le dernier debout l\'emporte.',
    },
    boss: {
      label: 'Combat de Boss', icon: '👹', color: '#7ccf6a', coop: true, minPlayers: 1,
      desc: 'Tout le monde s\'allie contre un boss géant (Troll, Dragon, Magicien, Mimic, Liche de glace, Maexxna, Fantôme, Chat ou Succube). On gagne ensemble… ou on perd ensemble.',
    },
    dungeon: {
      label: 'Raid de Donjon', icon: '🏰', color: '#5fd3ff', coop: true, minPlayers: 1,
      desc: 'Salle après salle, les aventuriers affrontent des monstres de plus en plus forts. Pas de réapparition !',
    },
    koth: {
      label: 'Roi de la Colline', icon: '👑', color: '#ffd23f', coop: false, minPlayers: 2,
      desc: 'Chacun pour soi, mais personne n\'est éliminé : tenez la colline pour marquer des points. Les morts reviennent au combat.',
    },
    clans: {
      label: 'Guerre des clans', icon: '⚔️', color: '#ff6b9a', coop: false, minPlayers: 2,
      desc: 'Rouges contre Bleus (!rouge ou !bleu) : détruisez le cristal adverse et protégez le vôtre. Les morts reviennent, de plus en plus tard.',
    },
    rush: {
      label: 'Boss Rush', icon: '💀', color: '#ff4d6d', coop: true, minPlayers: 1,
      desc: 'Les boss s\'enchaînent, de plus en plus forts ! Entre deux boss, le chat vote : bonus, résurrection ou quitte ou double. Jusqu\'où irez-vous ?',
    },
    gold: {
      label: 'Golden Shower', icon: '🪙', color: '#ffd23f', coop: false, bonus: true, minPlayers: 1,
      desc: 'Mode bonus, sans combat : une pluie de pièces d\'or et de coffres s\'abat sur l\'arène. Chacun garde ce qu\'il ramasse !',
    },
  };

  /*
   * Roi de la Colline : 2 min 30 de combat, chacun pour soi. Une grande colline (cercle au sol) change de place toutes
   * les 30 s (annoncée 5 s avant). Chaque seconde passée dessus rapporte 2 points à chacun, 5 points si l'on y est SEUL
   * (le Roi) ; un kill rapporte 2 points. Les combattants hors de la colline y retournent dès qu'ils n'ont personne à portée. Les morts reviennent au bord de l'arène au bout de 4 s, protégés 1,5 s.
   * Le meilleur score gagne (égalité : le plus de kills, puis au hasard).
   */
  /*
   * Guerre des clans : deux équipes (choisies avec !rouge / !bleu, sinon dans la plus petite), chacune protège son
   * cristal. Le cristal se défend (il tire sur les ennemis proches). Les morts reviennent dans leur camp au bout de
   * 5 s, puis 5 s de plus à chaque nouvelle mort (30 s au plus). L'équipe la moins nombreuse est renforcée.
   * Fin : cristal détruit, ou au bout de 3 min le cristal le plus entamé perd (dès 1 min 30, les cristaux prennent ×3).
   */
  const CLANS = {
    teams: {
      rouge: { label: 'Rouges', icon: '🔴', color: '#ff4d6d', cmd: '!rouge' },
      bleu: { label: 'Bleus', icon: '🔵', color: '#3fa0ff', cmd: '!bleu' },
    },
    duration: 180,
    overtimeAt: 90, // « mort subite » : les cristaux subissent ×3
    overtimeMult: 3,
    crystal: { hpBase: 400, hpPerEnemy: 60, radius: 34, damage: 10, cooldown: 1.2, range: 170 },
    respawn: { base: 5, step: 5, max: 30 },
    protect: 1.5,
    underdog: 1.75, // bonus max (vie et dégâts) de l'équipe la plus faible : √(puissance forte / puissance faible)
    // Ciblage : un cristal « paraît » plus proche ; un ennemi près de notre cristal ou collé à nous passe avant.
    aggro: { crystal: 0.35, defendRadius: 260, defend: 0.5, selfDefense: 90, close: 0.3 },
    reward: { xp: 200, gold: 40, chests: 1 }, // pour chaque humain de l'équipe gagnante
    mvpChests: 1, // + 1 coffre pour le meilleur combattant (le plus de dégâts)
  };
  // `big` / `small` : puissance totale (somme des puissances, PWR-1) de l'équipe forte et de l'équipe faible.
  function clanUnderdog(big, small) {
    if (!small || !big || small >= big) return 1;
    return Math.min(CLANS.underdog, Math.sqrt(big / small));
  }
  function clanRespawnDelay(deaths) {
    const R = CLANS.respawn;
    return Math.min(R.max, R.base + R.step * Math.max(0, deaths - 1));
  }

  /*
   * Ruée vers l'or (mode bonus) : pas de combat. Pendant 75 s, les combattants se baladent au hasard et ramassent ce
   * qui tombe du ciel : pièces (1 gold, 2 pendant le Jackpot), coffres (plus rares), sacs d'or et bonus. Ils foncent
   * vers un coffre ou un bonus tout proche. La Chance agrandit le rayon de ramassage (l'aimant naturel).
   * Les 15 dernières secondes : JACKPOT, pluie ×3 et pièces doublées.
   */
  const GOLD = {
    duration: 75,
    jackpotAt: 60,
    jackpot: { rain: 3, value: 2 },
    coins: { base: 12, perPlayer: 1, max: 40, fall: 0.7, life: 4 }, // pièces par seconde ; chute et durée au sol (s)
    chests: { every: 6, perPlayers: 15, fall: 1.4, life: 8 }, // 1 coffre toutes les 6 s (+1 par tranche de 15 joueurs)
    items: {
      every: 5, fall: 1, life: 7,
      kinds: {
        sac: { icon: '💰', label: 'Sac d\'or', gold: 25 },
        aimant: { icon: '🧲', label: 'Aimant', duration: 8, pickupMult: 3 },
        etoile: { icon: '⭐', label: 'Étoile', duration: 6, speedMult: 1.7 },
      },
    },
    pickup: 22, // rayon de ramassage (px)…
    luckPickup: 1.5, // … +1,5 px par point de Chance, 60 px au plus
    pickupMax: 60,
    speed: 95, // vitesse de balade, proportionnelle à la Vitesse du personnage (×1,6 au plus)
    lure: 160, // un coffre ou un bonus à moins de 160 px attire
    bestChests: 1, // + 1 coffre pour le meilleur ramasseur (Roi du butin)
  };
  function goldPickup(luck) {
    return Math.min(GOLD.pickupMax, GOLD.pickup + GOLD.luckPickup * Math.max(0, luck || 0));
  }

  const KOTH = {
    duration: 150,
    hill: { radius: 170, moveEvery: 30, warn: 5, margin: 220, minJump: 320 },
    points: { hill: 2, king: 5, kill: 2 },
    respawn: 4,
    protect: 1.5,
  };

  /*
   * Combat de Boss : la vie et les dégâts du Troll dépendent du nombre de combattants au lancement.
   * À 66 % puis 33 % de vie, il passe une phase : plus de dégâts et d'attaques par seconde.
   */
  const BOSS = {
    id: 'troll',
    kind: 'troll',
    name: 'Grokk le Troll',
    short: 'Grokk',
    icon: '👹',
    color: '#7ccf6a',
    desc: 'Une brute : coups de massue qui balaient, onde de choc et rochers lancés sur les groupes.',
    marks: [0.66, 0.33], // coches de la barre de vie
    hpBase: 200,
    hpPerPlayer: 300,
    damageBase: 6,
    damagePerPlayer: 0.2,
    cooldown: 1.5, // secondes entre deux coups de massue
    speed: 62,
    radius: 58, // taille au sol (les combattants font 16)
    reduction: 0.15,
    precision: 0.2,
    dodge: 0.02,
    cleaveRadius: 75, // le coup de massue touche aussi les combattants proches de la cible…
    cleaveRatio: 0.5, // … à 50 % des dégâts
    // Attaques spéciales en alternance, annoncées au sol 1,3 s avant l'impact :
    // onde de choc autour du Troll, puis rocher lancé sur le plus gros groupe de combattants.
    slam: { every: 6.5, warn: 1.3, radius: 150, rockRadius: 100, ratio: 1.1 },
    phases: [
      { at: 0.66, damageMult: 1.3, attackSpeedMult: 1.35, label: 'LE TROLL S\'ÉNERVE !' },
      { at: 0.33, damageMult: 1.3, attackSpeedMult: 1.35, label: 'LE TROLL EST FURIEUX !' },
    ],
    enrageAt: 150, // au-delà de 2 min 30, rage finale : dégâts ×3
    enrageMult: 3,
    reward: { xp: 500, gold: 500, chests: 3 }, // pour TOUS les participants si le Troll est vaincu
  };

  /*
   * Pyrax le Dragon : souffle de feu en cône et coup de queue ; à 75 % et 30 % il s'envole (seuls les combattants
   * à distance peuvent le toucher) et bombarde le sol ; à 50 % il s'enfuit pondre des œufs qu'il faut détruire
   * avant l'éclosion (sinon : dragonnets).
   */
  const DRAGON = {
    id: 'dragon',
    kind: 'dragon',
    name: 'Pyrax le Dragon',
    short: 'Pyrax',
    icon: '🐉',
    color: '#ff6b2a',
    desc: 'Crache le feu, s\'envole hors de portée du corps à corps et pond des œufs à détruire avant l\'éclosion.',
    marks: [0.75, 0.5, 0.3],
    hpBase: 200,
    hpPerPlayer: 400,
    damageBase: 6,
    damagePerPlayer: 0.2,
    cooldown: 1.6, // coups de griffes
    speed: 70,
    radius: 60,
    reduction: 0.15,
    precision: 0.2,
    dodge: 0.02,
    range: 45,
    cleaveRadius: 70,
    cleaveRatio: 0.4,
    specialEvery: 7, // en alternance : souffle de feu, puis coup de queue
    breath: { warn: 1.4, length: 340, angle: 0.5, ratio: 1.2 }, // cône (demi-angle en radians) vers le plus gros groupe
    tail: { warn: 1.1, radius: 140, ratio: 0.9 },
    // En vol : intouchable au corps à corps (portée < minRange), boules de feu sur des combattants au hasard,
    // puis atterrissage brutal sur le plus gros groupe.
    flight: { at: [0.75, 0.3], duration: 12, minRange: 150, fireballEvery: 1.2, fireballRadius: 70, fireballWarn: 1.2, fireballRatio: 0.8, landWarn: 1.4, landRadius: 160, landRatio: 1.1 },
    // Pendant l'envol, des flammèches (morceaux de son feu) tombent au sol : le travail du corps à corps.
    // Chacune abattue brûle le dragon (1 % de sa vie max) et le fait atterrir 1 s plus tôt ; elles s'éteignent à l'atterrissage.
    sprites: { per: 3, min: 2, max: 8, every: 3, hpBase: 40, hpPerPlayer: 5, damageRatio: 0.35, speed: 80, radius: 14, cooldown: 1.2, range: 26, burn: 0.01, shorten: 1 },
    // Le nid : le dragon quitte l'arène et laisse 1 œuf pour 4 combattants (3 à 10) ; ceux qui restent à son retour
    // éclosent en dragonnets. S'ils sont tous détruits, il revient plus tôt.
    // À son retour du nid, il est furieux : dégâts ×1,25 et attaques ×1,2.
    nest: { at: 0.5, duration: 16, eggsPer: 4, eggsMin: 3, eggsMax: 10, eggHpBase: 60, eggHpPerPlayer: 8, returnDamageMult: 1.25, returnAttackSpeedMult: 1.2 },
    whelp: { hpBase: 80, hpPerPlayer: 6, damageRatio: 0.6, speed: 95, radius: 18, cooldown: 1.1, range: 30 },
    phases: [],
    enrageAt: 150,
    enrageMult: 3,
    reward: { xp: 500, gold: 500, chests: 3 },
  };

  /*
   * Malvorath le Magicien des ténèbres : attaque de loin et se téléporte ; maudit des combattants (un Prêtre proche
   * les purifie) et fait tomber des zones d'ombre ; à 70 % et 20 % il se protège derrière un bouclier tant que ses
   * cristaux tiennent ; à 45 % il se dédouble en illusions fragiles.
   */
  const SORCIER = {
    id: 'sorcier',
    kind: 'sorcier',
    name: 'Malvorath le Magicien des ténèbres',
    short: 'Malvorath',
    icon: '🧙',
    color: '#9b59ff',
    desc: 'Se téléporte, maudit les héros (les Prêtres purifient), se cache derrière des cristaux et se dédouble.',
    marks: [0.7, 0.45, 0.2],
    hpBase: 180,
    hpPerPlayer: 200,
    damageBase: 7,
    damagePerPlayer: 0.2,
    cooldown: 1.3, // traits d'ombre
    speed: 55,
    radius: 30,
    reduction: 0.1,
    precision: 0.25,
    dodge: 0.05,
    range: 260,
    projectile: 'shadow',
    blinkEvery: 15, // se téléporte à un endroit au hasard de l'arène
    specialEvery: 8, // en alternance : malédiction, puis zones d'ombre
    curse: { perPlayers: 5, duration: 8, dps: 0.025, purifyRadius: 120 }, // 2,5 % de la vie max par seconde
    void: { base: 2, perPlayers: 10, max: 4, radius: 75, warn: 1.5, ratio: 0.9 },
    shield: { at: [0.7, 0.2], crystals: 4, crystalHpBase: 60, crystalHpPerPlayer: 10, regen: 0.0015 }, // soin par cristal et par seconde
    clones: { at: 0.45, count: 3, hpRatio: 0.05, damageRatio: 0.5 },
    phases: [],
    enrageAt: 150,
    enrageMult: 3,
    reward: { xp: 500, gold: 500, chests: 3 },
  };

  /*
   * Grignotor le Mimic : un coffre aux dents acérées. À 75 %, 50 % et 25 % de vie, il « copie » un héros au hasard
   * (2, puis 4, puis 6 copies de niveau 1) qui le protègent : tant que ses copies sont debout, il subit moitié moins
   * de dégâts. Il vomit le contenu de son ventre (armes, os, bile, pièces : effets différents) et bondit sur les héros.
   */
  const MIMIC = {
    id: 'mimic',
    kind: 'mimic',
    name: 'Grignotor le Mimic',
    short: 'Grignotor',
    icon: '🧰',
    color: '#d9a441',
    desc: 'Un coffre affamé : il copie les héros (2, 4 puis 6 copies), vomit armes, os, bile et pièces, et bondit sur sa proie.',
    marks: [0.75, 0.5, 0.25],
    hpBase: 200,
    hpPerPlayer: 280,
    damageBase: 5.5,
    damagePerPlayer: 0.2,
    cooldown: 1.5, // morsures
    speed: 66,
    radius: 50,
    reduction: 0.2,
    precision: 0.2,
    dodge: 0.02,
    range: 40,
    cleaveRadius: 70,
    cleaveRatio: 0.5,
    specialEvery: 6.5, // en alternance : vomi (cône vers le plus gros groupe), puis bond sur le héros le plus éloigné
    // Contenu du vomi, tiré au hasard : dégâts directs, saignement, poison + ralentissement, ou assommé.
    vomit: {
      warn: 1.3, length: 330, angle: 0.45,
      loot: {
        armes: { label: 'Armes rouillées', icon: '🗡️', color: '#c9ccd6', ratio: 1.1 },
        os: { label: 'Os pointus', icon: '🦴', color: '#efe6cf', ratio: 0.5, bleed: 0.03, duration: 5 },
        bile: { label: 'Bile acide', icon: '🤢', color: '#8fe04a', ratio: 0.35, poison: 0.025, duration: 5, slow: 0.5 },
        pieces: { label: 'Pièces maudites', icon: '🪙', color: '#ffd23f', ratio: 0.6, stun: 1.2 },
      },
    },
    leap: { warn: 1.2, radius: 110, ratio: 0.8 },
    // Copies de niveau 1 d'un héros (stats de sa classe sans équipement), un peu renforcées avec le niveau moyen.
    copies: { at: [0.75, 0.5, 0.25], counts: [2, 4, 6], hpMult: 1, damageMult: 0.5, guard: 0.6 },
    phases: [],
    enrageAt: 150,
    enrageMult: 3,
    reward: { xp: 500, gold: 500, chests: 3 },
  };

  /*
   * Givrenoire la Liche de glace : un squelette mage qui attaque de loin. Elle gèle des héros (5 s, puis de nouveau
   * 10 s plus tard) : un héros gelé subit 1 dégât par seconde, ne peut plus être ciblé, ne bouge plus, n'attaque plus
   * et ne remplit plus sa stamina, mais peut être soigné. Phase 1 : 1 puis 1 héros ; phase 2 (66 %) : 2 puis 2 ;
   * phase 3 (33 %) : elle relève tous les héros morts depuis le début (serviteurs qui meurent avec elle), sinon 3 puis 2.
   * Elle fait aussi jaillir des pics de glace sous les héros et souffle une nova de givre autour d'elle.
   */
  const LICHE = {
    id: 'liche',
    kind: 'liche',
    name: 'Givrenoire la Liche de glace',
    short: 'Givrenoire',
    icon: '❄️',
    color: '#7fd8ff',
    desc: 'Attaque de loin et se téléporte quand on l\'approche, gèle les héros (1, 2 puis 3 à la fois), lance de givre, pics de glace, et relève les morts pour se défendre.',
    marks: [0.66, 0.33],
    hpBase: 220,
    hpPerPlayer: 330,
    damageBase: 8,
    damagePerPlayer: 0.2,
    cooldown: 1.25, // éclats de glace
    speed: 50,
    radius: 32,
    reduction: 0.12,
    precision: 0.25,
    dodge: 0.04,
    range: 280,
    projectile: 'ice',
    blinkEvery: 20,
    // Elle garde ses distances : un héros à moins de 90 px → elle se téléporte 240 px plus loin (toutes les 9 s au plus),
    // en laissant une explosion de givre là où elle était (annoncée 0,8 s avant).
    escape: { radius: 90, cooldown: 9, hop: 240, trapRadius: 110, trapWarn: 0.8, trapRatio: 0.7, trapSlow: 0.7, trapSlowFor: 2 },
    specialEvery: 6.5, // en rotation : pics de glace sous des héros, lance de givre, nova de givre autour d'elle
    // dps : part de la vie max perdue par seconde dans la glace (soloDps : seul, en Défi des boss ou en Boss Rush solo)
    freeze: { first: 6, duration: 5, gap: 10, dps: 0.015, soloDps: 0.05, pattern: [[1, 1], [2, 2], [3, 2]] },
    spikes: { base: 2, perPlayers: 8, max: 5, radius: 70, warn: 1.4, ratio: 0.9, slow: 0.75, slowFor: 2 },
    nova: { radius: 170, warn: 1.2, ratio: 0.8, slow: 0.65, slowFor: 3 },
    lance: { length: 620, width: 64, warn: 1.3, ratio: 1.3, slow: 0.6, slowFor: 2 }, // ligne droite vers le héros le plus éloigné
    raise: { at: 0.33, hpRatio: 0.6, damageRatio: 0.6 }, // serviteurs : héros morts relevés avec 60 % de leurs stats
    phases: [],
    enrageAt: 150,
    enrageMult: 3,
    reward: { xp: 500, gold: 500, chests: 3 },
  };

  /*
   * Maexxna la Veuve noire : araignée géante au venin puissant. Elle tisse des toiles partout (les héros y sont très
   * ralentis), crache sa toile et du venin, et appelle des nuées d'araignées. À 70 % et 20 %, elle enferme des héros
   * dans des cocons (à briser pour les libérer) ; à 45 %, elle remonte au plafond, fait pleuvoir toiles et venin et
   * lâche une nuée, puis redescend en frénésie.
   */
  const MAEXXNA = {
    id: 'maexxna',
    kind: 'maexxna',
    name: 'Maexxna la Veuve noire',
    short: 'Maexxna',
    icon: '🕷️',
    color: '#c0203a',
    desc: 'Tisse des toiles qui ralentissent, empoisonne, appelle des nuées d\'araignées, enferme des héros dans des cocons.',
    marks: [0.7, 0.45, 0.2],
    hpBase: 200,
    hpPerPlayer: 280,
    damageBase: 5,
    damagePerPlayer: 0.2,
    cooldown: 1.3, // morsures venimeuses
    speed: 74,
    radius: 54,
    reduction: 0.15,
    precision: 0.2,
    dodge: 0.03,
    range: 45,
    poison: { dot: 0.012, duration: 4 }, // chaque morsure empoisonne (1,2 % de la vie max par seconde)
    specialEvery: 7, // en alternance : jet de toile (dégâts + toile au sol), puis crachat de venin en cône
    webs: { max: 8, life: 14, radius: 95, slow: 0.35, dropEvery: 5 },
    webShot: { warn: 1.2, radius: 90, ratio: 0.6 },
    spray: { warn: 1.3, length: 300, angle: 0.5, ratio: 0.45, poison: 0.02, duration: 5 },
    spiders: { every: 14, per: 3, min: 2, max: 10, alive: 14, hpBase: 30, hpPerPlayer: 4, damageRatio: 0.25, speed: 118, radius: 11, cooldown: 0.9, range: 26, poison: { dot: 0.008, duration: 3 } },
    cocoon: { at: [0.7, 0.2], base: 1, perPlayers: 6, max: 4, hpBase: 60, hpPerPlayer: 8, dps: 0.015, hold: 10 },
    ceiling: { at: 0.45, duration: 12, rainEvery: 1.5, rainRadius: 80, rainWarn: 1.2, rainRatio: 0.5, rainPoison: 0.02, spiderWave: 2, returnAttackSpeedMult: 1.2 },
    frenzy: { at: 0.2, attackSpeedMult: 1.2, speedMult: 1.2 },
    phases: [],
    enrageAt: 150,
    enrageMult: 3,
    reward: { xp: 500, gold: 500, chests: 3 },
  };

  /*
   * Ether le Fantôme : un gros fantôme insaisissable. Il esquive une grande partie des coups (et riposte aussitôt),
   * hurle, enchaîne les héros avec des chaînes spectrales et moissonne leurs âmes pour se soigner. À 70 % et 35 %, il
   * devient intangible (aucun coup ne le touche) et fait jaillir des mains spectrales qui agrippent les héros : chaque
   * main détruite le fait revenir plus tôt. À 50 %, des feux follets errants le rejoignent ; à 15 %, il devient furieux.
   */
  const ETHER = {
    id: 'ether',
    kind: 'ether',
    name: 'Ether le Fantôme',
    short: 'Ether',
    icon: '👻',
    color: '#b8c8ff',
    desc: 'Insaisissable : esquive et riposte, devient intangible en invoquant des mains spectrales, enchaîne les héros et dévore leurs âmes.',
    marks: [0.7, 0.5, 0.35, 0.15],
    hpBase: 200,
    hpPerPlayer: 300,
    damageBase: 6.5,
    damagePerPlayer: 0.2,
    cooldown: 1.25, // toucher glacial
    speed: 68,
    radius: 52,
    reduction: 0.1,
    precision: 0.25,
    dodge: 0.35, // très difficile à toucher (la Précision des héros réduit son esquive)
    counter: 0.35, // après une esquive, 35 % de chances de riposter aussitôt
    range: 70,
    specialEvery: 6.5, // en rotation : hurlement, chaînes spectrales, moisson d'âmes
    wail: { warn: 1.3, radius: 190, ratio: 0.85, slow: 0.55, slowFor: 2.5 },
    chains: { base: 2, perPlayers: 6, max: 5, warn: 1.3, width: 46, ratio: 1, stun: 1 },
    souls: { base: 2, perPlayers: 6, max: 5, radius: 75, warn: 1.4, ratio: 0.8, drain: 0.5 }, // soigne Ether de 50 % des dégâts
    intangible: { at: [0.7, 0.35], duration: 14, shorten: 1.2, wailEvery: 4, handEvery: 3.5,
      hands: { per: 3, min: 3, max: 10, hpBase: 55, hpPerPlayer: 7, damageRatio: 0.45, cooldown: 1.6, range: 70, grab: 1 } },
    wisps: { at: 0.5, base: 4, perPlayers: 4, max: 12, hpBase: 30, hpPerPlayer: 4, speed: 78, radius: 12, blast: 70, ratio: 1.2, life: 18 },
    fury: { at: 0.15, dodge: 0.15, attackSpeedMult: 1.25 },
    phases: [],
    enrageAt: 150,
    enrageMult: 3,
    reward: { xp: 500, gold: 500, chests: 3 },
  };

  /*
   * Lilith le Chat : une chatte espiègle au sourire immense. Elle bondit, lance des éventails de cartes tranchantes,
   * disparaît (seul son sourire flotte) pour frapper dans le dos, et joue au bonneteau avec les héros (ils échangent
   * leurs places). À 75 % et 40 %, elle se multiplie en illusions indiscernables : les briser toutes l'étourdit,
   * sinon elles explosent. À 50 %, un chapeau magique fait sortir des chatons ; à 10 %, sa neuvième vie la relève.
   */
  const LILITH = {
    id: 'lilith',
    kind: 'lilith',
    name: 'Lilith le Chat',
    short: 'Lilith',
    icon: '😼',
    color: '#c8925a',
    desc: 'Illusions indiscernables, disparitions, bonneteau qui échange les héros de place, chapeau à chatons et neuf vies.',
    marks: [0.75, 0.5, 0.4, 0.1],
    hpBase: 200,
    hpPerPlayer: 290,
    damageBase: 6,
    damagePerPlayer: 0.2,
    cooldown: 0.95, // coups de griffes
    speed: 92,
    radius: 46,
    reduction: 0.12,
    precision: 0.3,
    dodge: 0.12,
    range: 46,
    cleaveRadius: 60,
    cleaveRatio: 0.45,
    specialEvery: 6, // en rotation : bond, cartes, disparition, bonneteau
    pounce: { warn: 1, radius: 110, ratio: 0.9 },
    cards: { warn: 1.1, length: 320, angle: 0.55, ratio: 0.75, bleed: 0.02, duration: 4 },
    vanish: { hide: 1.4, warn: 0.7, radius: 95, ratio: 1.25 },
    shuffle: { warn: 1.6, ratio: 0.3, stun: 0.6 },
    illusions: { at: [0.75, 0.4], counts: [3, 5], duration: 14, hpRatio: 0.03, damageRatio: 0.4, blastRadius: 110, blastWarn: 1, blastRatio: 1.1, dazed: 5, dazedTaken: 1.5 },
    hat: { at: 0.5, hpBase: 140, hpPerPlayer: 16, every: 4, per: 2, alive: 12,
      kitten: { hpBase: 26, hpPerPlayer: 3, damageRatio: 0.22, speed: 125, radius: 10, cooldown: 0.8, range: 24 } },
    ninelives: { at: 0.1, heal: 0.2, attackSpeedMult: 1.25, speedMult: 1.2 },
    phases: [],
    enrageAt: 150,
    enrageMult: 3,
    reward: { xp: 500, gold: 500, chests: 3 },
  };

  /*
   * Daedra la Succube : son fouet de feu frappe de très loin et brûle. Ses colonnes de feu traversent l'arène et
   * séparent les héros (on ne peut pas les franchir, elles brûlent), ses cercles infernaux enferment un héros avant
   * d'exploser, et elle appelle des démons de feu. À 66 %, trois portails infernaux la protègent (dégâts réduits) et
   * crachent des démons ; à 33 %, elle s'élève et embrase l'arène ; à 15 %, elle entre en furie.
   */
  const DAEDRA = {
    id: 'daedra',
    kind: 'daedra',
    name: 'Daedra la Succube',
    short: 'Daedra',
    icon: '😈',
    color: '#ff3b5c',
    desc: 'Fouet de feu à longue portée, colonnes de flammes infranchissables, cercles infernaux, portails et nuées de démons de feu.',
    marks: [0.66, 0.33, 0.15],
    hpBase: 220,
    hpPerPlayer: 280,
    damageBase: 7,
    damagePerPlayer: 0.22,
    cooldown: 1.15, // coups de fouet
    speed: 64,
    radius: 44,
    reduction: 0.15,
    precision: 0.3,
    dodge: 0.06,
    range: 175,
    projectile: 'whip',
    poison: { dot: 0.012, duration: 3 }, // chaque coup de fouet brûle (1,2 % de la vie max par seconde)
    specialEvery: 6.5, // en rotation : colonnes de feu, fouet infernal, cercle infernal
    pillars: { warn: 1.4, width: 56, ratio: 1.2, life: 8, burn: 0.01 }, // burn : part de la vie max perdue par seconde collé au mur
    lash: { warn: 1, length: 290, angle: 0.8, ratio: 1 },
    ring: { warn: 1.2, radius: 130, width: 40, life: 5, ratio: 0.6, blastWarn: 1.2, blastRatio: 1.1 },
    demons: { every: 14, per: 4, min: 2, max: 6, alive: 10, hpBase: 30, hpPerPlayer: 4, damageRatio: 0.25, speed: 105, radius: 14, cooldown: 1, range: 28, poison: { dot: 0.008, duration: 3 } },
    portals: { at: 0.66, count: 3, hpBase: 110, hpPerPlayer: 12, every: 6, guard: 0.6, dist: 190 }, // autour d'elle ; tant qu'ils tiennent : dégâts subis ×0,6, un démon par portail toutes les 6 s (et pas d'autres démons)
    inferno: { at: 0.33, duration: 12, wallEvery: 1.6, rainEvery: 1.1, rainRadius: 85, rainWarn: 1.1, rainRatio: 0.8 },
    fury: { at: 0.15, attackSpeedMult: 1.3, range: 40, demonEvery: 6 },
    phases: [],
    enrageAt: 150,
    enrageMult: 3,
    reward: { xp: 500, gold: 500, chests: 3 },
  };

  const BOSSES = { troll: BOSS, dragon: DRAGON, sorcier: SORCIER, mimic: MIMIC, liche: LICHE, maexxna: MAEXXNA, ether: ETHER, lilith: LILITH, daedra: DAEDRA };

  /*
   * V2 : les boss sont plus résistants (×1,25), et encore plus face à des combattants expérimentés :
   * +3,5 % de vie par niveau moyen au-dessus de 1 (×2,2 au plus pour cette partie).
   */
  const BOSS_SCALE = { hpMult: 1, perLevel: 0.06, levelCap: 2.5 };
  function bossLevelScale(avgLevel) {
    return Math.min(BOSS_SCALE.levelCap, 1 + BOSS_SCALE.perLevel * Math.max(0, (avgLevel || 1) - 1));
  }
  function bossStats(players, id = 'troll', avgLevel = 1) {
    const B = BOSSES[id] || BOSS;
    const n = Math.max(1, players);
    return {
      maxHp: Math.round((B.hpBase + B.hpPerPlayer * n) * BOSS_SCALE.hpMult * bossLevelScale(avgLevel)),
      damage: Math.round((B.damageBase + B.damagePerPlayer * n) * 10) / 10,
    };
  }

  /*
   * Boss Rush : les boss s'enchaînent au hasard (jamais deux fois le même d'affilée), de plus en plus forts.
   * Après chaque boss vaincu, le chat vote (40 s) : un bonus aléatoire pour la suite de la run, ressusciter un héros
   * au hasard (ou un grand soin si personne n'est tombé), ou « Quitte ou double » (boss suivants +25 % de puissance,
   * golds et XP tout de suite pour tous). La run s'arrête quand tous les héros sont tombés.
   */
  const RUSH = {
    hpPerRound: 0.3, // boss n°k : vie × (1 + 0,3 × (k − 1))…
    damagePerRound: 0.3, // … et dégâts × (1 + 0,3 × (k − 1)) × 1,08^(k − 1) : la montée s'accélère
    damageGrowth: 1.08,
    boonMax: 2, // un même bonus permanent se prend 2 fois au plus par run
    healBetween: 0.3, // les survivants récupèrent 30 % de leur vie entre deux boss
    stages: { intro: 3.2, down: 3.5 }, // arrivée du boss, puis mort du boss (avant le vote)
    poll: { duration: 40 },
    defiMult: 1.25, // « Quitte ou double » : boss suivants ×1,25 (cumulable)
    defiGold: 40, // … et tout de suite 40 golds et 50 XP par boss vaincu, pour tous
    defiXp: 50,
    revive: 0.6, // ressuscité avec 60 % de sa vie
    perBoss: { xp: 150, gold: 150, chests: 1, growth: 50 }, // récompense du boss n°k : 150 + 50 × (k − 1) XP et golds, 1 coffre
  };
  // Bonus aléatoires du vote (permanents jusqu'à la fin de la run, cumulables).
  const RUSH_BOONS = {
    rage: { icon: '😡', label: 'Fureur', color: '#ff3c28', desc: 'Dégâts des héros ×1,2 pour le reste de la run.', effect: { damage: 1.2 } },
    armure: { icon: '🛡️', label: 'Peau de pierre', color: '#5fd3ff', desc: 'Dégâts subis ×0,8 pour le reste de la run.', effect: { taken: 0.8 } },
    vitesse: { icon: '⚡', label: 'Adrénaline', color: '#ffe63c', desc: 'Vitesse et vitesse d\'attaque ×1,15 pour le reste de la run.', effect: { speed: 1.15, attackSpeed: 1.15 } },
    vampire: { icon: '🧛', label: 'Soif de sang', color: '#c0102c', desc: '+10 % de vol de vie pour le reste de la run.', effect: { lifesteal: 0.1 } },
    ronces: { icon: '🌵', label: 'Armure de ronces', color: '#3ddc5a', desc: 'Les héros renvoient 20 % des dégâts reçus pour le reste de la run.', effect: { thorns: 0.2 } },
    vigueur: { icon: '❤️', label: 'Vigueur', color: '#ff4d6d', desc: 'Vie max +25 % et soin complet des survivants.', effect: { maxHp: 1.25, heal: 1 } },
    regen: { icon: '🌿', label: 'Sève de vie', color: '#7ccf6a', desc: 'Les héros régénèrent 0,8 % de leur vie par seconde pour le reste de la run.', effect: { regen: 0.008 } },
    stamina: { icon: '🔋', label: 'Second souffle', color: '#ffe066', desc: 'La barre d\'ultime des survivants se remplit entièrement.', effect: { stamina: 1 }, unlimited: true },
  };
  // Les trois choix du vote : !1 / !2 / !3, ou leur commande.
  const RUSH_CHOICES = {
    bonus: { cmd: '!bonus', icon: '🎲', label: 'Bonus', color: '#ffc21a' },
    resu: { cmd: '!resu', icon: '👼', label: 'Résurrection', color: '#fff2a8', desc: 'Un héros tombé, tiré au hasard, revient à la vie avec 60 % de sa vie.' },
    soin: { cmd: '!resu', icon: '💖', label: 'Grand soin', color: '#ff8fb8', desc: 'Personne n\'est tombé : les survivants sont soignés à 100 %.' },
    defi: { cmd: '!defi', icon: '💀', label: 'Quitte ou double', color: '#9b59ff' },
  };
  function rushChoiceFromCommand(command, options) {
    const n = /^!(\d)$/.exec(command);
    if (n) return options[Number(n[1]) - 1] || null;
    return options.find((id) => RUSH_CHOICES[id] && RUSH_CHOICES[id].cmd === command) || null;
  }
  // Puissance du boss n°k (vie, dégâts), × le multiplicateur « Quitte ou double ».
  function rushScale(round, mult = 1) {
    const k = Math.max(1, round) - 1;
    return { hp: (1 + RUSH.hpPerRound * k) * mult, damage: (1 + RUSH.damagePerRound * k) * Math.pow(RUSH.damageGrowth, k) * mult };
  }
  // Bonus que le vote peut encore proposer : un bonus permanent déjà pris `boonMax` fois sort du tirage
  // (« Second souffle », effet immédiat, reste toujours possible).
  function rushBoonPool(taken = []) {
    return Object.keys(RUSH_BOONS).filter((id) => RUSH_BOONS[id].unlimited || taken.filter((b) => b === id).length < RUSH.boonMax);
  }
  // Récompense de fin de run pour `killed` boss vaincus (null si aucun).
  function rushReward(killed) {
    const n = Math.max(0, Math.floor(killed || 0));
    if (!n) return null;
    const P = RUSH.perBoss;
    const each = (k) => P.xp + P.growth * (k - 1);
    let xp = 0;
    for (let k = 1; k <= n; k++) xp += each(k);
    return { bosses: n, xp, gold: xp, chests: P.chests * n };
  }
  // « Quitte ou double » : golds et XP versés tout de suite après le boss n°k.
  function rushDefiReward(killed) {
    return { xp: RUSH.defiXp * killed, gold: RUSH.defiGold * killed, chests: 0 };
  }

  // ---------- Raid de Donjon ----------
  const MONSTERS = {
    gobelin: { label: 'Gobelin', icon: '👺', hp: 40, damage: 6, speed: 78, cooldown: 0.95, range: 36, radius: 13, reduction: 0.05, dodge: 0.08, from: 1 },
    slime: { label: 'Slime', icon: '🟢', hp: 80, damage: 6, speed: 42, cooldown: 1.25, range: 34, radius: 15, reduction: 0.2, dodge: 0, from: 1 },
    chauve_souris: { label: 'Chauve-souris', icon: '🦇', hp: 24, damage: 4, speed: 135, cooldown: 0.65, range: 30, radius: 11, reduction: 0, dodge: 0.25, from: 2 },
    // Leurs coups empoisonnent : `poison.dot` de la vie max par seconde pendant `poison.duration` s (×1,5 pour un chef).
    rat: { label: 'Rat pestiféré', icon: '🐀', hp: 20, damage: 3, speed: 120, cooldown: 0.7, range: 30, radius: 10, reduction: 0, dodge: 0.15, from: 2, poison: { dot: 0.012, duration: 3 } },
    gobelin_violet: { label: 'Gobelin violet', icon: '🟣', hp: 46, damage: 5, speed: 82, cooldown: 1, range: 36, radius: 13, reduction: 0.05, dodge: 0.1, from: 4, poison: { dot: 0.02, duration: 3 } },
    squelette: { label: 'Squelette archer', icon: '💀', hp: 42, damage: 7, speed: 55, cooldown: 1.4, range: 210, kite: 100, recovery: 0.6, projectile: 'bone', radius: 13, reduction: 0.1, dodge: 0.05, from: 3 },
  };
  // Toutes les 5 salles, un chef bien plus costaud accompagne les monstres.
  const ELITES = {
    gobelin: 'Roi des gobelins', slime: 'Slime géant', chauve_souris: 'Chauve-souris vampire', squelette: 'Seigneur squelette',
    rat: 'Roi des rats', gobelin_violet: 'Chaman gobelin',
  };
  const ELITE = { every: 5, hpMult: 5, damageMult: 1.5, scale: 1.9 };
  const DUNGEON = {
    countBase: 0.55, // monstres par aventurier dans la salle 1…
    countPerRoom: 0.06, // … puis +0,06 par salle
    hpPerRoom: 0.08, // +8 % de vie des monstres par salle
    damagePerRoom: 0.06, // +6 % de dégâts par salle
    healBetweenRooms: 0.3, // les survivants récupèrent 30 % de leur vie entre deux salles
    enrageAt: 45, // au-delà de 45 s dans une salle, les monstres s'énervent…
    enrageRate: 0.05, // … +5 % de dégâts par seconde
    maxMonsters: 36,
    stages: { enter: 2, clear: 1.3, exit: 2, dark: 1.8 }, // durées des transitions (s)
  };

  // Monstres d'une salle : [{ type, elite }]
  function dungeonRoom(room, players) {
    const n = Math.max(1, players);
    const types = Object.keys(MONSTERS).filter((t) => MONSTERS[t].from <= room);
    const count = Math.max(2, Math.min(DUNGEON.maxMonsters, Math.round(n * (DUNGEON.countBase + DUNGEON.countPerRoom * (room - 1)))));
    const list = [];
    if (room % ELITE.every === 0) list.push({ type: types[Math.floor(Math.random() * types.length)], elite: true });
    while (list.length < count) list.push({ type: types[Math.floor(Math.random() * types.length)], elite: false });
    return list;
  }

  function dungeonMultipliers(room) {
    return { hp: 1 + DUNGEON.hpPerRoom * (room - 1), damage: 1 + DUNGEON.damagePerRoom * (room - 1) };
  }

  /*
   * Récompenses selon la salle atteinte (palier de 5 en 5), pour TOUS les participants, morts ou vivants.
   * 5 : 50 XP / 50 golds · 10 : 150 / 150 · 15 : 1 coffre, 300 / 300 · 20 : 2 coffres, 500 / 500
   * puis +1 coffre et +250 XP / golds tous les 5 salles.
   */
  const DUNGEON_TIERS = [
    { room: 5, xp: 50, gold: 50, chests: 0 },
    { room: 10, xp: 150, gold: 150, chests: 0 },
    { room: 15, xp: 300, gold: 300, chests: 1 },
    { room: 20, xp: 500, gold: 500, chests: 2 },
  ];
  // `mult` : multiplicateur « Quitte ou double » voté pendant le raid (arrondi à l'unité).
  function dungeonReward(room, mult = 1) {
    const tier = Math.floor(room / 5) * 5;
    if (tier < 5) return null;
    const known = DUNGEON_TIERS.find((t) => t.room === tier);
    const extra = (tier - 20) / 5;
    const r = known || { xp: 500 + 250 * extra, gold: 500 + 250 * extra, chests: 2 + extra };
    const m = (v) => Math.round(v * mult);
    return { tier, xp: m(r.xp), gold: m(r.gold), chests: m(r.chests) };
  }

  /*
   * Sondage du donjon : après chaque salle de chef (toutes les 5 salles), le combat se met en pause et le chat
   * vote pendant 60 s entre deux bonus tirés au hasard (une commande par bonus, ou !1 / !2).
   * Les bonus « jusqu'au prochain sondage » durent les 5 salles suivantes.
   */
  const DUNGEON_POLL = { every: ELITE.every, duration: 60, choices: 2 };
  const DUNGEON_BOONS = {
    vie: {
      cmd: '!vie', icon: '❤️', label: 'Grand soin', color: '#ff4d6d',
      desc: 'Les survivants regagnent 50 % de leur vie max.', effect: { heal: 0.5 },
    },
    or: {
      cmd: '!or', icon: '💰', label: 'Pluie d\'or', color: '#ffc21a',
      desc: 'Tous les participants gagnent tout de suite 10 golds par salle franchie (50 en salle 5, 100 en salle 10…).', effect: { goldPerRoom: 10 },
    },
    xp: {
      cmd: '!xp', icon: '📚', label: 'Savoir ancien', color: '#29e7ff',
      desc: 'Tous les participants gagnent tout de suite 20 XP par salle franchie (100 en salle 5…).', effect: { xpPerRoom: 20 },
    },
    coffre: {
      cmd: '!coffre', icon: '🎁', label: 'Coffre au trésor', color: '#b83cff',
      desc: 'Tous les participants reçoivent tout de suite 1 coffre.', effect: { chests: 1 },
    },
    stamina: {
      cmd: '!stamina', icon: '🔋', label: 'Second souffle', color: '#ffe066',
      desc: 'La barre de stamina des survivants se remplit de 40 % (ultime plus tôt).', effect: { stamina: 0.4 },
    },
    mort: {
      cmd: '!mort', icon: '👼', label: 'Résurrection', color: '#fff2a8', needsDead: true,
      desc: 'Un aventurier tombé, tiré au hasard, revient à la vie avec 50 % de sa vie.', effect: { revive: 0.5 },
    },
    rage: {
      cmd: '!rage', icon: '😡', label: 'Fureur', color: '#ff3c28',
      desc: 'Dégâts des survivants ×1,25 jusqu\'au prochain sondage.', effect: { damage: 1.25 },
    },
    armure: {
      cmd: '!armure', icon: '🛡️', label: 'Peau de pierre', color: '#5fd3ff',
      desc: 'Dégâts subis par les survivants ×0,75 jusqu\'au prochain sondage.', effect: { taken: 0.75 },
    },
    vitesse: {
      cmd: '!vitesse', icon: '⚡', label: 'Adrénaline', color: '#ffe63c',
      desc: 'Vitesse de déplacement et d\'attaque ×1,2 jusqu\'au prochain sondage.', effect: { speed: 1.2, attackSpeed: 1.2 },
    },
    vampire: {
      cmd: '!vampire', icon: '🧛', label: 'Soif de sang', color: '#c0102c',
      desc: '+15 % de vol de vie pour les survivants jusqu\'au prochain sondage.', effect: { lifesteal: 0.15 },
    },
    ronces: {
      cmd: '!ronces', icon: '🌵', label: 'Armure de ronces', color: '#3ddc5a',
      desc: 'Les survivants renvoient 25 % des dégâts reçus jusqu\'au prochain sondage.', effect: { thorns: 0.25 },
    },
    defi: {
      cmd: '!defi', icon: '💀', label: 'Quitte ou double', color: '#9b59ff',
      desc: 'Monstres +25 % de vie et de dégâts pour le reste du raid, mais la récompense finale est ×1,5.', effect: { monsters: 1.25, reward: 1.5 },
    },
    raccourci: {
      cmd: '!raccourci', icon: '🗝️', label: 'Passage secret', color: '#c8a2ff',
      desc: 'Le groupe saute 2 salles (elles comptent pour la récompense).', effect: { skip: 2 },
    },
  };
  // Commande de chat → bonus ; !1 / !2 désignent le premier / second choix du sondage en cours.
  function boonFromCommand(command, options) {
    const n = /^!(\d)$/.exec(command);
    if (n) return options[Number(n[1]) - 1] || null;
    return options.find((id) => DUNGEON_BOONS[id].cmd === command) || null;
  }


  // ---------- Consommables (boutique) ----------
  /*
   * Une potion s'équipe dans l'emplacement de consommable de la fiche ; elle est consommée au lancement de la
   * prochaine partie (tous les modes), qu'elle se déclenche ou non. Elle se déclenche au plus une fois.
   * Déclencheurs : start (début du combat), engage (premier ennemi à portée), hp50 / hp20 (vie sous 50 / 20 %),
   * death (au moment de tomber).
   */
  const CONSUMABLES = {
    vie: {
      label: 'Potion de vie', icon: '🧪', color: '#ff4d6d', price: 90, trigger: 'hp50',
      desc: 'Sous 50 % de vie : régénère 4 % de ta vie max par seconde pendant 6 s.',
      effect: { regen: 0.04, duration: 6 },
    },
    berserker: {
      label: 'Potion de berserker', icon: '🍷', color: '#ff6b2a', price: 120, trigger: 'hp50',
      desc: 'Sous 50 % de vie : +50 % de dégâts pendant 8 s.',
      effect: { damage: 1.5, duration: 8 },
    },
    defense: {
      label: 'Potion de défense', icon: '🧴', color: '#5fd3ff', price: 120, trigger: 'hp50',
      desc: 'Sous 50 % de vie : −60 % de dégâts subis pendant 4 s.',
      effect: { taken: 0.4, duration: 4 },
    },
    celerite: {
      label: 'Potion de célérité', icon: '💨', color: '#ffd23f', price: 105, trigger: 'engage',
      desc: 'Dès que le premier ennemi est à portée : +40 % de vitesse et de vitesse d\'attaque pendant 10 s.',
      effect: { speed: 1.4, attackSpeed: 1.4, duration: 10 },
    },
    teleportation: {
      label: 'Potion de téléportation d\'urgence', icon: '🌀', color: '#b14dff', price: 135, trigger: 'hp20',
      desc: 'Sous 20 % de vie : téléportation à un endroit aléatoire de l\'arène, le plus loin possible des ennemis.',
      effect: { teleport: true },
    },
    invisibilite: {
      label: 'Potion d\'invisibilité', icon: '👻', color: '#cfd8e3', price: 150, trigger: 'hp20',
      desc: 'Sous 20 % de vie : invisible pendant 5 s. Les ennemis te perdent de vue, mais les attaques de zone te touchent toujours.',
      effect: { invisible: true, duration: 5 },
    },
    ronces: {
      label: 'Potion de ronces', icon: '🌹', color: '#b14dff', price: 105, trigger: 'hp50',
      desc: 'Sous 50 % de vie : +40 % d\'épines (dégâts renvoyés) pendant 8 s.',
      effect: { thorns: 0.4, duration: 8 },
    },
    endurance: {
      label: 'Élixir d\'endurance', icon: '🔋', color: '#29e7ff', price: 180, trigger: 'start',
      desc: 'La barre de stamina démarre à moitié remplie : ton ultime arrive bien plus tôt (il faut avoir un ultime).',
      effect: { stamina: 0.5 },
    },
    phenix: {
      label: 'Plume de phénix', icon: '🪶', color: '#ff9a1f', price: 375, trigger: 'death',
      desc: 'Quand tu tombes, tu renais aussitôt avec 30 % de ta vie (une seule fois).',
      effect: { revive: 0.3 },
    },
  };
  const CONSUMABLE_TRIGGERS = {
    start: 'Au début du combat', engage: 'Premier ennemi à portée', hp50: 'Vie sous 50 %', hp20: 'Vie sous 20 %', death: 'En tombant',
  };
  const CONSUMABLE_STACK_MAX = 99; // stock maximum par potion

  // ---------- Presets d'équipement ----------
  // Les objets d'un preset sont protégés : ni recyclage, ni fusion à la forge.
  const PRESET_MAX = 5;
  const PRESET_NAME_MAX = 24;

  // ---------- Stamina, arbre de compétences et ultimes ----------
  // Temps de remplissage de la barre de stamina (secondes, sans bonus) : TRÈS long, mais les ultimes frappent fort.
  const STAMINA = {
    baseTime: { guerrier: 40, archer: 38, mage: 42, assassin: 36, pretre: 40, none: 40 },
    perPoint: 0.05, // +5 % de vitesse de remplissage par point de Stamina
    cap: 2.5,
  };
  const TALENT_EVERY = 3; // 1 point de compétence d'arbre tous les 3 niveaux : niveaux 4, 7, 10, 13…
  const TALENT_RESET_PRICE = 250;

  // Remise à zéro des points de caractéristiques : 50 golds par point placé, jamais plus de 500 golds.
  // Répartition des points : chaque point retiré d'une caractéristique (pour le replacer ailleurs) coûte 50 golds,
  // 500 golds au plus pour une même validation. Placer des points libres est gratuit.
  const STAT_RESET = { perPoint: 50, max: 500 };
  function statResetPrice(points) {
    return Math.min(STAT_RESET.max, STAT_RESET.perPoint * points);
  }
  // Points retirés entre deux répartitions (from → to, { stat: points })
  function statPointsMoved(from, to) {
    return STATS.reduce((sum, st) => sum + Math.max(0, (from[st] || 0) - (to[st] || 0)), 0);
  }

  function talentPoints(level) {
    return Math.max(0, Math.floor(((level || 1) - 1) / TALENT_EVERY));
  }

  /*
   * Ultimes : lancés automatiquement quand la barre de stamina est pleine.
   * `plus` : version améliorée, débloquée avec la spécialisation au bout de la branche.
   */
  const ULTS = {
    rempart: {
      label: 'Rempart sacré', icon: '🛡️', color: '#ffd23f',
      desc: 'Pendant 5 s, −60 % de dégâts subis ; soigne 25 % de la vie max.',
      descPlus: 'Pendant 8 s ; soigne aussi les alliés proches de 20 % et réduit leurs dégâts subis de 30 %.',
      base: { duration: 5, taken: 0.4, heal: 0.25 },
      plus: { duration: 8, taken: 0.4, heal: 0.25, allyHeal: 0.2, allyTaken: 0.7, radius: 220 },
    },
    tourbillon: {
      label: 'Tourbillon', icon: '🌪️', color: '#ff4d6d',
      desc: 'Tourne sur lui-même 3 s : toutes les 0,5 s, 70 % des dégâts aux ennemis à moins de 90 px.',
      descPlus: 'Pendant 5 s, rayon 120 px, et rend 30 % des dégâts du tourbillon en vie.',
      base: { duration: 3, every: 0.5, ratio: 0.7, radius: 90, lifesteal: 0 },
      plus: { duration: 5, every: 0.5, ratio: 0.7, radius: 120, lifesteal: 0.3 },
    },
    perforante: {
      label: 'Flèche perforante', icon: '🏹', color: '#3ddc5a',
      desc: 'Une énorme flèche traverse tout l\'écran vers la cible : 300 % des dégâts à chaque ennemi sur sa trajectoire.',
      descPlus: 'Flèche plus grosse (400 %), qui rebondit 2 fois sur les bords de l\'écran avant de disparaître.',
      base: { ratio: 3, width: 24, bounces: 0 },
      plus: { ratio: 4, width: 38, bounces: 2 },
    },
    pluie: {
      label: 'Pluie de flèches', icon: '🌧️', color: '#9be564',
      desc: '14 flèches tombent en 2 s autour de la cible (rayon 150 px) : 60 % des dégâts par flèche.',
      descPlus: '28 flèches en 2,5 s sur un rayon de 190 px.',
      base: { arrows: 14, duration: 2, radius: 150, impact: 40, ratio: 0.6 },
      plus: { arrows: 28, duration: 2.5, radius: 190, impact: 40, ratio: 0.6 },
    },
    meteore: {
      label: 'Météore', icon: '☄️', color: '#ff6b2a',
      desc: 'Un météore s\'écrase sur le plus gros groupe d\'ennemis après 1 s : 350 % des dégâts (rayon 110 px).',
      descPlus: 'Trois météores, sur trois groupes différents (rayon 120 px).',
      base: { count: 1, warn: 1, radius: 110, ratio: 3.5 },
      plus: { count: 3, warn: 1, radius: 120, ratio: 3.5 },
    },
    blizzard: {
      label: 'Blizzard', icon: '❄️', color: '#7fd8ff',
      desc: 'Vague de glace autour de la cible (rayon 150 px) : 100 % des dégâts et gèle les ennemis 2 s.',
      descPlus: 'Rayon 210 px, 150 % des dégâts et gel de 3,5 s.',
      base: { radius: 150, ratio: 1, stun: 2 },
      plus: { radius: 210, ratio: 1.5, stun: 3.5 },
    },
    execution: {
      label: 'Exécution', icon: '🗡️', color: '#ffd23f',
      desc: 'Se téléporte derrière l\'ennemi le plus affaibli et frappe à 350 % des dégâts.',
      descPlus: 'Enchaîne sur 3 ennemis affaiblis, l\'un après l\'autre.',
      base: { targets: 1, ratio: 3.5 },
      plus: { targets: 3, ratio: 3.5 },
    },
    poison: {
      label: 'Nuage toxique', icon: '☠️', color: '#7ccf6a',
      desc: 'Nuage de poison autour de soi pendant 5 s (rayon 120 px) : 120 % des dégâts par seconde aux ennemis dedans.',
      descPlus: 'Pendant 8 s, rayon 170 px, et le nuage suit l\'assassin.',
      base: { duration: 5, radius: 120, ratio: 1.2, follow: false },
      plus: { duration: 8, radius: 170, ratio: 1.2, follow: true },
    },
    priere: {
      label: 'Prière', icon: '🙏', color: '#fff3a0',
      desc: 'Soigne 40 % de sa vie max et 30 % aux alliés proches (220 px).',
      descPlus: 'Soigne 40 % à tous les alliés de l\'arène et réduit leurs dégâts subis de 30 % pendant 4 s.',
      base: { self: 0.4, ally: 0.3, radius: 220, taken: 1, duration: 0 },
      plus: { self: 0.4, ally: 0.4, radius: 9999, taken: 0.7, duration: 4 },
    },
    chatiment: {
      label: 'Châtiment', icon: '⚡', color: '#ffe27a',
      desc: 'Des rayons sacrés frappent les 3 ennemis les plus proches : 220 % des dégâts chacun.',
      descPlus: '5 ennemis, 280 % des dégâts et étourdissement de 1 s.',
      base: { targets: 3, ratio: 2.2, stun: 0 },
      plus: { targets: 5, ratio: 2.8, stun: 1 },
    },
  };

  /*
   * Arbre de compétences : deux branches par classe (gauche / droite), chacune donnant au bout une spécialisation.
   * Paliers d'une branche, du centre vers l'extérieur :
   *   ult (rouge) → g1 → a (3 choix) → g2 → b (3 choix) → g3 → spec (bleu)
   * Choisir une branche bloque l'autre ; dans un palier à 3 choix, en prendre un bloque les deux autres.
   * Seule une remise à zéro (payante) débloque les chemins abandonnés.
   */
  const TALENT_TIERS = ['ult', 'g1', 'a', 'g2', 'b', 'g3', 'spec'];
  const TALENT_TREES = {
    guerrier: {
      left: { spec: 'Paladin', icon: '🛡️', color: '#ffd23f', ult: 'rempart', stats: ['vie', 'defense', 'epines'], desc: 'Tank sacré : vie, défense et protection.' },
      right: { spec: 'Berserker', icon: '🪓', color: '#ff4d6d', ult: 'tourbillon', stats: ['force', 'critique', 'vol_de_vie'], desc: 'Furie : dégâts, critiques et vol de vie.' },
    },
    archer: {
      left: { spec: 'Tireur d\'élite', icon: '🎯', color: '#3ddc5a', ult: 'perforante', stats: ['force', 'critique', 'precision'], desc: 'Un tir, un mort : dégâts et critiques.' },
      right: { spec: 'Spammeur', icon: '🌧️', color: '#9be564', ult: 'pluie', stats: ['vitesse_attaque', 'precision', 'vitesse'], desc: 'Des flèches partout : vitesse d\'attaque et précision.' },
    },
    mage: {
      left: { spec: 'Pyromancien', icon: '🔥', color: '#ff6b2a', ult: 'meteore', stats: ['force', 'critique', 'vitesse_attaque'], desc: 'Tout brûler : dégâts de zone massifs.' },
      right: { spec: 'Cryomancien', icon: '❄️', color: '#7fd8ff', ult: 'blizzard', stats: ['precision', 'vie', 'defense'], desc: 'Contrôle : geler les ennemis et tenir la ligne.' },
    },
    assassin: {
      left: { spec: 'Ombre', icon: '🌑', color: '#ffd23f', ult: 'execution', stats: ['critique', 'vitesse', 'esquive'], desc: 'Frapper vite et disparaître : critiques et esquive.' },
      right: { spec: 'Venimeux', icon: '🐍', color: '#7ccf6a', ult: 'poison', stats: ['vitesse_attaque', 'vol_de_vie', 'critique'], desc: 'Empoisonner tout ce qui bouge : vitesse d\'attaque et vol de vie.' },
    },
    pretre: {
      left: { spec: 'Saint', icon: '😇', color: '#fff3a0', ult: 'priere', stats: ['vie', 'defense', 'stamina'], desc: 'Soigneur : vie, défense et ultime plus fréquent.' },
      right: { spec: 'Inquisiteur', icon: '⚖️', color: '#ffe27a', ult: 'chatiment', stats: ['force', 'precision', 'critique'], desc: 'Justice divine : dégâts sacrés à distance.' },
    },
  };

  // Liste des nœuds d'un arbre : { id, branch, tier, option, type ('ult' | 'stat' | 'spec'), points }.
  function talentNodes(cls) {
    const tree = TALENT_TREES[cls];
    if (!tree) return [];
    const out = [];
    for (const branch of ['left', 'right']) {
      const [s1, s2, s3] = tree[branch].stats;
      const pts = (pairs) => Object.fromEntries(pairs.filter(([k]) => k));
      out.push({ id: branch + '.ult', branch, tier: 0, option: 0, type: 'ult', points: {} });
      out.push({ id: branch + '.g1', branch, tier: 1, option: 0, type: 'stat', points: pts([[s1, 3], [s2, 3]]) });
      [[[s1, 6]], [[s2, 6]], [[s3, 6]]].forEach((p, i) => out.push({ id: `${branch}.a${i + 1}`, branch, tier: 2, option: i, type: 'stat', points: pts(p) }));
      out.push({ id: branch + '.g2', branch, tier: 3, option: 0, type: 'stat', points: pts([[s1, 3], ['stamina', 3]]) });
      [[[s1, 4], [s2, 4]], [[s1, 4], [s3, 4]], [[s2, 4], [s3, 4]]].forEach((p, i) => out.push({ id: `${branch}.b${i + 1}`, branch, tier: 4, option: i, type: 'stat', points: pts(p) }));
      out.push({ id: branch + '.g3', branch, tier: 5, option: 0, type: 'stat', points: pts([[s1, 4], [s2, 4]]) });
      out.push({ id: branch + '.spec', branch, tier: 6, option: 0, type: 'spec', points: {} });
    }
    return out;
  }

  // Raison pour laquelle un nœud ne peut pas être appris (null s'il peut l'être).
  function talentBlocker(cls, owned, id, available) {
    const nodes = talentNodes(cls);
    const node = nodes.find((n) => n.id === id);
    if (!node) return 'Compétence inconnue';
    owned = owned || [];
    if (owned.includes(id)) return 'Déjà apprise';
    const ownedNodes = nodes.filter((n) => owned.includes(n.id));
    if (ownedNodes.some((n) => n.branch !== node.branch)) return 'Tu as choisi l\'autre chemin (remise à zéro pour changer)';
    if (ownedNodes.some((n) => n.tier === node.tier)) return 'Chemin bloqué : tu as pris une autre compétence à ce palier';
    if (node.tier > 0 && !ownedNodes.some((n) => n.tier === node.tier - 1)) return 'Apprends d\'abord la compétence précédente';
    if (available !== undefined && available <= 0) return 'Aucun point de compétence d\'arbre disponible';
    return null;
  }

  // Points de stats donnés par les nœuds appris (et les nœuds bonus pris après la spécialisation).
  function talentBonus(cls, owned, extra) {
    const points = emptyStats();
    for (const n of talentNodes(cls)) {
      if ((owned || []).includes(n.id) || (extra || []).includes(n.id)) for (const [st, v] of Object.entries(n.points)) points[st] += v;
    }
    return points;
  }
  // Branche terminée (spécialisation apprise) : les autres choix de la même branche s'achètent avec des points
  // d'arbre (TALENT_EXTRA_COST chacun). available : points d'arbre disponibles. Raison du refus, ou null.
  const TALENT_EXTRA_COST = 5;
  function talentExtraBlocker(cls, owned, extra, id, available) {
    const node = talentNodes(cls).find((n) => n.id === id);
    if (!node) return 'Compétence inconnue';
    owned = owned || [];
    extra = extra || [];
    if (owned.includes(id) || extra.includes(id)) return 'Déjà apprise';
    const branch = talentBranch(owned);
    if (!branch || !owned.includes(branch + '.spec')) return 'Termine d\'abord ta branche jusqu\'à la spécialisation';
    if (node.branch !== branch) return 'Seulement dans la branche que tu as choisie';
    if (node.type !== 'stat') return 'Compétence impossible à prendre en bonus';
    if (available != null && available < TALENT_EXTRA_COST) return `Il faut ${TALENT_EXTRA_COST} points d'arbre`;
    return null;
  }

  // Branche choisie (left / right) ou null.
  function talentBranch(owned) {
    const first = (owned || [])[0];
    return first ? first.split('.')[0] : null;
  }

  // Ultime du personnage : { id, enhanced } ou null (il faut le nœud rouge ; la spécialisation l'améliore).
  function ultOf(cls, owned) {
    const tree = TALENT_TREES[cls];
    const branch = talentBranch(owned);
    if (!tree || !branch || !owned.includes(branch + '.ult')) return null;
    return { id: tree[branch].ult, enhanced: owned.includes(branch + '.spec') };
  }

  // Spécialisation obtenue (au bout de la branche) ou null.
  function specOf(cls, owned) {
    const tree = TALENT_TREES[cls];
    const branch = talentBranch(owned);
    return tree && branch && owned.includes(branch + '.spec') ? tree[branch] : null;
  }

  // ---------- Mode entraînement ----------
  // ---------- Style de combat : tactique et techniques (V2) ----------
  /*
   * Récupération : après chaque attaque, un combattant reste immobile un court instant (secondes, voir
   * CLASS_INFO.combat.recovery), divisé par sa vitesse d'attaque. L'Assassin récupère presque tout de suite.
   * Fuite : un combattant qui recule évite les bords de l'arène (il glisse le long des murs au lieu de s'y coincer).
   */
  const COMBAT_AI = { wallMargin: 110, fleeHp: 0.3, fleeRange: 130, prudentKite: 1.4 };

  // Tactique réglable sur la fiche : posture, cible préférée et distance de recul (classes à distance).
  const TACTICS = {
    stance: {
      equilibre: { label: 'Équilibré', icon: '⚖️', desc: 'Le comportement normal de ta classe.' },
      agressif: { label: 'Agressif', icon: '🔥', desc: 'Ne recule jamais, même à distance : colle à sa cible.' },
      prudent: { label: 'Prudent', icon: '🛡️', desc: 'Garde plus de distance (classes à distance) et fuit quand sa vie passe sous 30 %.' },
    },
    target: {
      auto: { label: 'Selon ma classe', icon: '🎯', desc: 'Le plus proche (sauf le Lootassin : le plus faible, si cette option est choisie).' },
      proche: { label: 'Le plus proche', icon: '📍', desc: 'Attaque l\'ennemi le plus proche.' },
      faible: { label: 'Le plus faible', icon: '🩸', desc: 'Traque l\'ennemi qui a le moins de vie.' },
      menace: { label: 'Le plus dangereux', icon: '☠️', desc: 'Vise l\'ennemi qui frappe le plus fort.' },
    },
    kiteMin: 0, // distance de recul réglable de 0 à (portée − 30) px pour les classes à distance
  };
  const DEFAULT_TACTICS = { stance: 'equilibre', target: 'auto', kite: null };
  function tacticsKiteMax(cls) {
    const c = classInfo(cls).combat;
    return c.projectile ? Math.max(0, c.range - 30) : 0;
  }

  /*
   * Techniques : compétences signature (en plus de l'ultime), qui se déclenchent toutes seules en combat.
   * Un emplacement au niveau 5, un second au niveau 15. Chaque technique a un niveau requis ; certaines sont
   * réservées à une classe (cls), d'autres aux combattants au corps à corps (melee).
   */
  const TECH_SLOTS = [5, 15];
  const TECHNIQUES = {
    roulade: { label: 'Roulade', icon: '🌀', level: 5, cd: 9, dist: 130, desc: 'Sous 70 % de vie, quand un ennemi est au contact : roulade de 130 px hors de portée, intouchable 0,35 s.' },
    charge: { label: 'Charge', icon: '🐗', level: 5, cd: 15, melee: true, desc: 'Fonce sur sa cible entre 120 et 320 px, l\'étourdit 0,6 s et frappe à 60 %.' },
    second_souffle: { label: 'Second souffle', icon: '💨', level: 10, desc: 'Une fois par partie, sous 25 % de vie : récupère 25 % de sa vie max.' },
    frenesie: { label: 'Frénésie', icon: '😤', level: 15, desc: 'Après chaque kill : vitesse d\'attaque ×1,4 pendant 5 s.' },
    cri_guerre: { label: 'Cri de guerre', icon: '📯', level: 10, cd: 12, cls: 'guerrier', desc: 'Entouré d\'au moins 2 ennemis : dégâts subis ×0,75 pendant 4 s.' },
    coup_bouclier: { label: 'Coup de bouclier', icon: '🛡️', level: 15, cd: 8, cls: 'guerrier', desc: 'Toutes les 8 s, sa prochaine attaque étourdit la cible 1 s.' },
    fleche_recul: { label: 'Flèche repoussante', icon: '🏹', level: 10, cd: 7, cls: 'archer', desc: 'Toutes les 7 s, sa flèche repousse de 90 px une cible trop proche (moins de 130 px).' },
    tir_rapide: { label: 'Tir rapide', icon: '⚡', level: 15, cd: 12, cls: 'archer', desc: 'Au contact d\'une cible à portée : vitesse d\'attaque ×2,5 et aucune récupération pendant 1,5 s.' },
    clignement: { label: 'Clignement', icon: '✨', level: 10, cd: 8, cls: 'mage', desc: 'Un ennemi à moins de 70 px : se téléporte 170 px plus loin.' },
    nova_givre: { label: 'Nova de givre', icon: '❄️', level: 15, cd: 11, cls: 'mage', desc: 'Un ennemi à moins de 90 px : ralentit de moitié les ennemis à moins de 130 px pendant 3 s.' },
    pas_ombre: { label: 'Pas de l\'ombre', icon: '👤', level: 10, cd: 9, cls: 'assassin', desc: 'Se téléporte dans le dos de sa cible (jusqu\'à 320 px) : la prochaine attaque est critique.' },
    lame_poison: { label: 'Lame empoisonnée', icon: '🧪', level: 15, cls: 'assassin', desc: 'Ses coups empoisonnent : 1,5 % de la vie max par seconde pendant 4 s.' },
    priere_soin: { label: 'Prière de soin', icon: '💖', level: 10, cd: 14, cls: 'pretre', desc: 'Sous 50 % de vie : récupère 20 % de sa vie max.' },
    lumiere: { label: 'Lumière aveuglante', icon: '🌟', level: 15, cd: 12, cls: 'pretre', desc: 'Des ennemis à moins de 100 px : tous étourdis 0,8 s.' },
  };
  function techSlots(level) {
    return TECH_SLOTS.filter((l) => (level || 1) >= l).length;
  }
  // Raison pour laquelle un personnage ne peut pas prendre une technique, ou null.
  function techBlocker(cls, level, id) {
    const t = TECHNIQUES[id];
    if (!t) return 'Technique inconnue';
    if (t.cls && t.cls !== cls) return `Réservée à la classe ${CLASS_INFO[t.cls].role}`;
    if (t.melee && classInfo(cls).combat.projectile) return 'Réservée aux combattants au corps à corps';
    if ((level || 1) < t.level) return `Disponible au niveau ${t.level}`;
    return null;
  }


  // ---------- Marché entre joueurs ----------
  /*
   * Un joueur met en vente un objet de son coffre personnel à un prix en golds. Il paie tout de suite une taxe
   * (20 % du prix, arrondie au-dessus), jamais remboursée. L'ordre dure 96 h ; au-delà, l'objet lui revient.
   * L'acheteur paie le prix, sans taxe, et le vendeur reçoit tout de suite la somme (et un courrier).
   */
  const MARKET = {
    maxOrders: 5,
    durationMs: 96 * 3600 * 1000,
    taxRate: 0.2,
    minPrice: 5,
    maxPrice: 1000000,
    mailMax: 50, tradesMax: 1000, // courriers gardés par joueur (les plus anciens partent)
    historyMax: 40, // lignes d'historique du marché gardées par joueur
  };
  function marketTax(price) {
    return Math.max(1, Math.ceil(price * MARKET.taxRate));
  }

  // ---------- Mode Solo (V2) ----------
  /*
   * Énergie : 3 au maximum, +1 toutes les 10 h ; une Expédition coûte 1 énergie (le Défi des boss, 1 Clé de boss).
   * Les parties solo sont simulées à part (comme l'entraînement), sans potion, et ne sont vues que par le joueur.
   */
  const SOLO = {
    energyMax: 3,
    energyEveryMs: 10 * 3600 * 1000,
    maxConcurrent: 30,
    speeds: [1, 2],
    maxDuration: 20 * 60, // garde-fou (s) : au-delà, l'expédition s'arrête avec ses gains
    // 1.4 : Clés de boss, sans limite. Le Défi des boss coûte 1 clé (pas d'énergie). On les trouve dans les choix
    // de reliques de l'Expédition (relique « Clé de boss », proposée au hasard) ; chaque personnage en reçoit une au départ.
    keyCost: 1,
    startKeys: 1,
    keyChance: 0.1, // chance qu'un choix de reliques propose une Clé de boss
  };

  // Énergie après recharge : { value, at } → { value, at, nextAt } (at = début de la recharge en cours).
  function energyState(energy, now) {
    const e = energy && Number.isFinite(energy.value) ? energy : { value: SOLO.energyMax, at: now };
    let value = Math.max(0, Math.min(SOLO.energyMax, e.value));
    let at = Number.isFinite(e.at) ? Math.min(e.at, now) : now;
    if (value >= SOLO.energyMax) return { value: SOLO.energyMax, at: now, nextAt: null };
    const gained = Math.floor((now - at) / SOLO.energyEveryMs);
    value = Math.min(SOLO.energyMax, value + gained);
    at += gained * SOLO.energyEveryMs;
    if (value >= SOLO.energyMax) return { value, at: now, nextAt: null };
    return { value, at, nextAt: at + SOLO.energyEveryMs };
  }

  /*
   * Expédition : descente sans fin dans les profondeurs, seul. Les monstres se renforcent à chaque étage
   * (et un peu avec le niveau du joueur) ; toutes les 3 profondeurs, le joueur choisit une relique parmi 3,
   * qui reste active jusqu'à la fin de l'expédition. Récompense selon le nombre d'étages nettoyés.
   */
  const EXPEDITION = {
    baseHp: 0.55, // vie et dégâts des monstres à la profondeur 1 (× les stats de Rules.MONSTERS)
    baseDamage: 0.5,
    countBase: 2, // monstres à la profondeur 1…
    countPerFloor: 0.14, // … puis +0,14 par profondeur
    maxMonsters: 12,
    hpGrowth: 1.1, // vie des monstres × 1,1 à chaque profondeur (croissance exponentielle : chacun finit par tomber)
    damageGrowth: 1.07,
    levelHp: 0.006, // +0,6 % de vie des monstres par niveau du joueur au-delà du 1…
    levelDamage: 0.004, // … et +0,4 % de dégâts
    levelCap: 2.6, // multiplicateur de niveau plafonné
    healBetweenFloors: 0.35,
    stages: { enter: 1.2, clear: 0.9, exit: 1.2, dark: 1.1 }, // transitions plus courtes que le Raid de Donjon
    relicEvery: 3,
    relicChoices: 3,
    relicTimeout: 30, // s : passé ce délai, une relique est choisie au hasard
    rewardScale: 2 / 3, // XP et golds de fin d'expédition
    // Seul face aux monstres, le corps à corps est désavantagé (pas de groupe pour encaisser) : vie et dégâts
    // ajustés par classe pendant l'Expédition, pour que chaque classe descende à peu près aussi loin.
    classMult: {
      guerrier: { hp: 1.25, damage: 1.35 }, archer: { hp: 1, damage: 1 }, mage: { hp: 1, damage: 1 },
      assassin: { hp: 1.6, damage: 1.4 }, pretre: { hp: 1.25, damage: 1.4 }, none: { hp: 1, damage: 1 },
    },
  };
  function expeditionRoom(depth) {
    const types = Object.keys(MONSTERS).filter((t) => MONSTERS[t].from <= depth);
    const count = Math.min(EXPEDITION.maxMonsters, Math.round(EXPEDITION.countBase + EXPEDITION.countPerFloor * (depth - 1)));
    const list = [];
    if (depth % ELITE.every === 0) list.push({ type: types[Math.floor(Math.random() * types.length)], elite: true });
    while (list.length < count) list.push({ type: types[Math.floor(Math.random() * types.length)], elite: false });
    return list;
  }
  function expeditionMultipliers(depth, level = 1) {
    const lv = Math.max(0, (level || 1) - 1);
    return {
        hp: EXPEDITION.baseHp * EXPEDITION.hpGrowth ** (depth - 1) * Math.min(EXPEDITION.levelCap, 1 + EXPEDITION.levelHp * lv),
      damage: EXPEDITION.baseDamage * EXPEDITION.damageGrowth ** (depth - 1) * Math.min(EXPEDITION.levelCap, 1 + EXPEDITION.levelDamage * lv),
    };
  }
  // Récompense pour `floors` étages nettoyés (× `mult` avec la relique Trésor) : 1 coffre tous les 5 étages.
  // XP et golds × EXPEDITION.rewardScale (2/3 depuis la 1.3 : l'Expédition rapportait trop).
  function expeditionReward(floors, mult = 1) {
    const n = Math.max(0, Math.floor(floors || 0));
    if (!n) return null;
    const k = mult * EXPEDITION.rewardScale;
    return {
      floors: n,
      xp: Math.round((25 * n + 2 * n * n) * k),
      gold: Math.round((20 * n + 1.5 * n * n) * k),
      chests: Math.floor(n / 5),
    };
  }
  /*
   * Reliques de l'Expédition (permanentes jusqu'à la fin de l'expédition, cumulables).
   * effect : damage / taken / speed / attackSpeed (multiplicateurs), lifesteal / thorns / regen / crit (ajouts),
   * heal (soin immédiat, part de la vie max), stamina (barre d'ultime), life (une vie en plus), reward (gains ×).
   */
  const RELICS = {
    lame_runique: { label: 'Lame runique', icon: '🗡️', desc: '+15 % de dégâts', effect: { damage: 1.15 } },
    peau_pierre: { label: 'Peau de pierre', icon: '🪨', desc: '−12 % de dégâts subis', effect: { taken: 0.88 } },
    bottes_vent: { label: 'Bottes du vent', icon: '🌪️', desc: '+15 % de vitesse', effect: { speed: 1.15 } },
    sablier: { label: 'Sablier fêlé', icon: '⏳', desc: '+15 % de vitesse d\'attaque', effect: { attackSpeed: 1.15 } },
    calice: { label: 'Calice de sang', icon: '🍷', desc: '+6 % de vol de vie', effect: { lifesteal: 0.06 } },
    ronces: { label: 'Couronne de ronces', icon: '🌹', desc: 'Renvoie 15 % des dégâts subis', effect: { thorns: 0.15 } },
    coeur_troll: { label: 'Cœur de troll', icon: '💚', desc: 'Régénère 1 % de vie par seconde', effect: { regen: 0.01 } },
    oeil_aigle: { label: 'Œil d\'aigle', icon: '🦅', desc: '+8 % de chances de critique', effect: { crit: 0.08 } },
    fiole: { label: 'Grande fiole', icon: '🧪', desc: 'Soigne 60 % de ta vie tout de suite', effect: { heal: 0.6 } },
    braise: { label: 'Braise éternelle', icon: '🔥', desc: 'Remplit la moitié de ta barre d\'ultime', effect: { stamina: 0.5 }, needsUlt: true },
    pacte: { label: 'Pacte sanglant', icon: '🩸', desc: '+30 % de dégâts, mais +15 % de dégâts subis', effect: { damage: 1.3, taken: 1.15 } },
    plume: { label: 'Plume de phénix', icon: '🪶', desc: 'Une vie en plus (renaît à 50 %)', effect: { life: 0.5 } },
    tresor: { label: 'Carte au trésor', icon: '🗺️', desc: '+25 % d\'XP et de golds à la fin', effect: { reward: 1.25 } },
    // Rare : jamais tirée avec les autres, elle remplace une des propositions (SOLO.keyChance). Gardée même en cas de défaite.
    cle_boss: { label: 'Clé de boss', icon: '🗝️', desc: '+1 Clé de boss à la fin de l\'expédition (pour le Défi des boss)', effect: { key: 1 }, rare: true },
  };

  /*
   * Défi des boss : un boss au choix contre le joueur seul, calculé pour son niveau (Rules.bossStats pour 1 joueur),
   * renforcé selon la difficulté. Une victoire compte pour l'exploit « vaincre ce boss seul ».
   */
  // Les boss sont pensés pour un groupe : seul, leur vie et leurs dégâts de base sont réduits (puis la difficulté).
  const BOSS_SOLO_SCALE = {
    troll: { hp: 1.1, damage: 2.1 }, dragon: { hp: 1.1, damage: 2.4 }, sorcier: { hp: 0.6, damage: 1.1 },
    mimic: { hp: 0.55, damage: 1.45 }, liche: { hp: 0.55, damage: 1.4 }, maexxna: { hp: 0.6, damage: 1.3 },
    ether: { hp: 0.6, damage: 1.3 }, lilith: { hp: 1.1, damage: 1.3 }, daedra: { hp: 0.6, damage: 1.2 },
  };
  // Seul face au boss, les classes fragiles à distance sont désavantagées : vie et dégâts du joueur ajustés par classe.
  const BOSS_SOLO_CLASS = {
    guerrier: { hp: 1, damage: 1 }, archer: { hp: 2, damage: 1.5 }, mage: { hp: 1.6, damage: 1.3 },
    assassin: { hp: 1.3, damage: 1.15 }, pretre: { hp: 1, damage: 1, regen: 0.4 }, none: { hp: 1, damage: 1 },
  };
  /*
   * Difficultés du Défi des boss. Au-delà de Légendaire (défis ultimes) : bien plus de vie et de dégâts, et en plus
   * special (attaques spéciales plus fréquentes), attackSpeed (coups plus rapides), enrageAt (la rage finale, dégâts ×3,
   * arrive plus tôt : un vrai chrono) et healTaken (soins et vol de vie du héros réduits). Les créatures du boss n'y prennent
   * que la racine carrée du multiplicateur de vie (et dégâts^0,7), sinon elles seraient indestructibles.
   */
  const BOSS_CHALLENGE = {
    normal: { label: 'Normal', icon: '⭐', hp: 0.7, damage: 0.7, reward: { xp: 450, gold: 375, chests: 2 } },
    heroique: { label: 'Héroïque', icon: '⭐⭐', hp: 1.4, damage: 1.25, reward: { xp: 900, gold: 750, chests: 3 } },
    legendaire: { label: 'Légendaire', icon: '⭐⭐⭐', hp: 2.4, damage: 1.6, reward: { xp: 1500, gold: 1350, chests: 6 } },
    fabuleux: { label: 'Fabuleux', icon: '🌟', ultimate: true, hp: 38, damage: 5.5, special: 1.6, attackSpeed: 1.35, enrageAt: 100, healTaken: 0.45, reward: { xp: 3000, gold: 3500, chests: 10, keys: 1 } },
    mythique: { label: 'Mythique', icon: '🌟🌟', ultimate: true, hp: 65, damage: 8, special: 1.9, attackSpeed: 1.55, enrageAt: 85, healTaken: 0.25, reward: { xp: 5000, gold: 7000, chests: 16, keys: 2 } },
    divin: { label: 'Divin', icon: '👑', ultimate: true, hp: 82, damage: 9.5, special: 2, attackSpeed: 1.65, enrageAt: 80, healTaken: 0.2, reward: { xp: 8000, gold: 15000, chests: 25, keys: 3 } },
  };
  const BOSS_CHALLENGE_ORDER = ['normal', 'heroique', 'legendaire', 'fabuleux', 'mythique', 'divin'];
  // Rang d'une difficulté (0 = Normal) : « Héroïque ou plus », « Légendaire ou plus »…
  function challengeRank(d) {
    return Math.max(0, BOSS_CHALLENGE_ORDER.indexOf(d));
  }
  const SOLO_MODES = {
    expedition: { label: 'Expédition', icon: '🕳️', desc: 'Descends le plus profond possible, choisis tes reliques, rapporte le butin.' },
    boss: { label: 'Défi des boss', icon: '👹', desc: 'Affronte seul un boss à ton niveau, en Normal, Héroïque ou Légendaire. Coûte 1 Clé de boss (trouvée dans l\'Expédition).' },
  };

  // ---------- Familiers (onglet Familier) ----------
  /*
   * Un boss vaincu (Combat de Boss, Boss Rush, Défi des boss) a 5 % de chance de laisser sa version miniature à chaque
   * héros humain. Le familier vit dans l'enclos ; seul le familier principal a des besoins (Faim, Soif, Joie, de 0 à
   * 100, qui baissent avec le temps) et ramène des trouvailles : toutes les quelques heures, si sa satisfaction
   * (moyenne des besoins) est d'au moins 50 %, il rapporte un cadeau selon son espèce (3 en attente au plus).
   * Les autres familiers se reposent (leurs besoins ne baissent pas). S'occuper de lui (nourrir, abreuver, caresser,
   * jouer) lui donne de l'expérience : ses niveaux raccourcissent l'attente et grossissent les trouvailles.
   * 3 jours d'affilée au-dessus de 80 % : il devient un compagnon de combat (il te suit dans l'arène, purement cosmétique).
   */
  const PET = {
    dropChance: 0.05,
    needs: ['faim', 'soif', 'joie'],
    decay: { faim: 2, soif: 2.5, joie: 1.5 }, // points perdus par heure (avant les objets de l'enclos)
    start: { faim: 80, soif: 80, joie: 80 },
    findThreshold: 50, // satisfaction minimum pour ramener une trouvaille
    findEveryH: 4, // heures entre deux trouvailles au niveau 1…
    findLevelCut: 0.025, // … −2,5 % par niveau (×0,5 au plus)
    maxFinds: 3,
    followThreshold: 80,
    followDays: 3,
    maxLevel: 20,
    nameMax: 16,
    logMax: 40, // trouvailles gardées dans le journal de l'enclos (les plus récentes)
    duplicateXp: 150, // familier déjà obtenu : il gagne 150 XP (et un Festin royal)
    stepMs: 10 * 60 * 1000, // pas de la simulation des besoins
    actions: {
      caresser: { label: 'Caresser', icon: '🤚', cooldownMs: 30 * 60 * 1000, joie: 10, xp: 5 },
      jouer: { label: 'Jouer', icon: '🎾', cooldownMs: 2 * 3600 * 1000, joie: 25, faim: -8, soif: -8, xp: 15 },
    },
    favoriteMult: 1.5, // plat préféré de l'espèce : effet ×1,5
  };
  const PET_FOODS = {
    croquettes: { label: 'Croquettes', icon: '🍪', kind: 'food', price: 36, faim: 30, xp: 6 },
    gigot: { label: 'Gigot', icon: '🍖', kind: 'food', price: 105, faim: 65, joie: 5, xp: 12 },
    festin: { label: 'Festin royal', icon: '🍱', kind: 'food', price: 270, faim: 100, soif: 10, joie: 20, xp: 25 },
    eau: { label: 'Eau fraîche', icon: '💧', kind: 'drink', price: 18, soif: 40, xp: 4 },
    jus: { label: 'Jus de baies', icon: '🧃', kind: 'drink', price: 90, soif: 100, joie: 5, xp: 10 },
  };
  const PET_FOOD_MAX = 99;
  // Objets de l'enclos (achetés une fois) : besoins qui baissent moins vite, trouvailles plus fréquentes ou plus grosses.
  const PET_ENCLOS = {
    fleurs: { label: 'Parterre de fleurs', icon: '🌷', price: 600, desc: 'Joie −10 % moins vite. Ça sent bon !', effect: { joie: 0.9 } },
    lanternes: { label: 'Lanternes féeriques', icon: '🏮', price: 1200, desc: 'Les caresses donnent +5 de Joie. Elles brillent la nuit.', effect: { caress: 5 } },
    gamelle: { label: 'Gamelle automatique', icon: '🥣', price: 2400, desc: 'Faim −35 % moins vite.', effect: { faim: 0.65 } },
    fontaine: { label: 'Fontaine enchantée', icon: '⛲', price: 2400, desc: 'Soif −35 % moins vite.', effect: { soif: 0.65 } },
    jouets: { label: 'Coffre à jouets', icon: '🧸', price: 3000, desc: 'Joie −30 % moins vite, et jouer donne +10 de Joie.', effect: { joie: 0.7, play: 10 } },
    mare: { label: 'Petite mare', icon: '🪷', price: 3600, desc: 'Soif −20 % et Joie −10 % moins vite.', effect: { soif: 0.8, joie: 0.9 } },
    niche: { label: 'Niche douillette', icon: '🏠', price: 4800, desc: 'Trouvailles 15 % plus fréquentes.', effect: { find: 0.85 } },
    statue: { label: 'Statue dorée', icon: '🗿', price: 10000, desc: 'Trouvailles de golds et d\'XP +25 %.', effect: { reward: 1.25 } },
  };
  // Espèces (une par boss) : plat préféré et trouvaille rapportée.
  const PETS = {
    troll: { name: 'Mini Grokk', favorite: 'gigot', find: 'arme', findLabel: 'une arme au hasard', color: '#7ccf6a' },
    dragon: { name: 'Mini Pyrax', favorite: 'festin', find: 'gold', findLabel: 'des golds', color: '#ff6b2a' },
    sorcier: { name: 'Mini Malvorath', favorite: 'jus', find: 'xp', findLabel: 'de l\'XP', color: '#9b59ff' },
    mimic: { name: 'Mini Grignotor', favorite: 'croquettes', find: 'chest', findLabel: 'un coffre de loot', color: '#d9a441' },
    liche: { name: 'Mini Givrenoire', favorite: 'eau', find: 'potion', findLabel: 'une potion (et parfois une Clé de boss)', color: '#7fd8ff' },
    maexxna: { name: 'Mini Maexxna', favorite: 'gigot', find: 'armure', findLabel: 'une pièce d\'armure ou un bijou', color: '#c0203a' },
    ether: { name: 'Mini Ether', favorite: 'jus', find: 'emerald', findLabel: 'des émeraudes', color: '#b8c8ff' },
    lilith: { name: 'Mini Lilith', favorite: 'croquettes', find: 'ticket', findLabel: 'un ticket de casino (une partie gratuite à 50 golds, hors caisse)', color: '#c8925a' },
    daedra: { name: 'Mini Daedra', favorite: 'festin', find: 'random', findLabel: 'une surprise : potion, coffre, XP, équipement ou golds', color: '#ff3b5c' },
  };
  // Mini Daedra : une trouvaille d'un autre familier, au hasard (même niveau)
  const PET_RANDOM_FINDS = ['potion', 'chest', 'xp', 'arme', 'armure', 'gold'];
  function petXpToNext(level) {
    return 40 + 20 * Math.max(1, level);
  }
  // Effets cumulés des objets de l'enclos : { faim, soif, joie (multiplicateurs de baisse), find, reward, caress, play }
  function petEnclosEffects(owned) {
    const out = { faim: 1, soif: 1, joie: 1, find: 1, reward: 1, caress: 0, play: 0 };
    for (const id of owned || []) {
      const e = PET_ENCLOS[id] && PET_ENCLOS[id].effect;
      if (!e) continue;
      for (const k of ['faim', 'soif', 'joie', 'find', 'reward']) if (e[k]) out[k] *= e[k];
      if (e.caress) out.caress += e.caress;
      if (e.play) out.play += e.play;
    }
    return out;
  }
  function petSatisfaction(needs) {
    return Math.round(((needs.faim || 0) + (needs.soif || 0) + (needs.joie || 0)) / 3 * 10) / 10;
  }
  // Intervalle entre deux trouvailles (ms), selon le niveau et la niche.
  function petFindEvery(level, effects) {
    const cut = Math.max(0.5, 1 - PET.findLevelCut * (Math.max(1, level) - 1));
    return PET.findEveryH * 3600 * 1000 * cut * (effects ? effects.find : 1);
  }
  /*
   * Fait vivre un familier de pet.at jusqu'à `now` (fonction pure, la même côté serveur et navigateur).
   * Familier principal : besoins qui baissent, trouvailles (si satisfaction ≥ 50 %), série au-dessus de 80 %.
   * Familier au repos : rien ne bouge (son horloge avance seulement).
   * Retourne une copie mise à jour + { found, unlocked } (trouvailles gagnées, compagnon débloqué pendant ce laps).
   */
  function petAdvance(pet, enclos, now, active) {
    const out = JSON.parse(JSON.stringify(pet));
    const res = { pet: out, found: 0, unlocked: false };
    const at = Number.isFinite(out.at) ? out.at : now;
    if (now <= at) { out.at = Math.max(at, Math.min(now, at)); return res; }
    const fx = petEnclosEffects(enclos);
    const every = petFindEvery(out.level, fx);
    if (!active) {
      out.at = now;
      if (Number.isFinite(out.findAt)) out.findAt += now - at; // l'attente reprend où elle s'était arrêtée
      if (out.streakAt != null) out.streakAt += now - at;
      return res;
    }
    if (!Number.isFinite(out.findAt)) out.findAt = at + every;
    let t = at;
    const maxSpan = 40 * 24 * 3600 * 1000; // au-delà, plus rien ne change (besoins à zéro)
    if (now - t > maxSpan) {
      t = now - maxSpan;
      if (out.findAt < t) out.findAt = t + every;
    }
    while (t < now) {
      const t2 = Math.min(now, t + PET.stepMs);
      const h = (t2 - t) / 3600000;
      for (const k of PET.needs) out.needs[k] = Math.max(0, Math.min(100, (out.needs[k] || 0) - PET.decay[k] * fx[k] * h));
      const sat = petSatisfaction(out.needs);
      while (out.findAt <= t2) {
        if (sat >= PET.findThreshold && (out.finds || 0) < PET.maxFinds) { out.finds = (out.finds || 0) + 1; res.found += 1; }
        out.findAt += every;
      }
      if (sat >= PET.followThreshold) {
        if (out.streakAt == null) out.streakAt = t;
        if (!out.follower && t2 - out.streakAt >= PET.followDays * 24 * 3600 * 1000) { out.follower = true; res.unlocked = true; }
      } else out.streakAt = null;
      t = t2;
    }
    for (const k of PET.needs) out.needs[k] = Math.round(out.needs[k] * 100) / 100;
    out.at = now;
    return res;
  }
  // Valeur d'une trouvaille (golds / XP) selon l'espèce et le niveau.
  function petFindValue(species, level, effects, as = null) {
    const L = Math.max(1, level);
    const r = effects ? effects.reward : 1;
    const find = as || (PETS[species] && PETS[species].find);
    if (find === 'gold') return Math.round((50 + 15 * L) * r);
    if (find === 'xp') return Math.round((80 + 25 * L) * r);
    if (find === 'emerald') return Math.round((8 + 3 * L) * r);
    return 0;
  }

  // ---------- Casino ----------
  // Six jeux, chacun tenu par un boss en smoking (croupier = identifiant du boss). Tous les tirages se font côté serveur.
  const CASINO = {
    bets: [10, 25, 50, 100, 250, 500], // mises proposées
    maxBet: 500,
    bigWin: 10, // gain ≥ 10× la mise (ou lot incroyable) : annoncé dans les gros gains du casino
    feedMax: 15,
    crowdMax: 18, // joueurs qui se promènent dans la salle
    games: {
      slots: { label: 'Machine à sous', icon: '🎰', croupier: 'dragon', color: '#ff6b2a', desc: 'Trois rouleaux : aligne trois symboles identiques. Deux cerises remboursent le double !' },
      blackjack: { label: 'Blackjack', icon: '🃏', croupier: 'maexxna', color: '#3ddc5a', desc: 'Approche-toi de 21 sans dépasser et bats la banque. Blackjack payé 3 pour 2.' },
      roulette: { label: 'Roulette', icon: '🎡', croupier: 'troll', color: '#e33', desc: 'Mise sur un numéro, une couleur, la parité ou une douzaine, puis Grokk lance la bille.' },
      caisse: { label: 'Caisse de Grignotor', icon: '🎁', croupier: 'mimic', color: '#d9a441', desc: 'Un défilé de lots, un seul gagnant : du petit lot au légendaire (1 % de lots incroyables).' },
      glace: { label: 'Lac gelé', icon: '🧊', croupier: 'liche', color: '#7fd4ff', desc: 'Brise la glace case par case : chaque case sûre fait monter le gain. Une fissure et tout est perdu !' },
      gobelets: { label: 'Gobelets du mage', icon: '🔮', croupier: 'sorcier', color: '#9b59ff', desc: 'Malvorath cache une bille sous un gobelet et les mélange. Trouve-la !' },
    },
    // Machine à sous : même tirage pondéré sur les trois rouleaux ; trois identiques → × mise ; deux cerises → ×2.
    slots: {
      symbols: {
        cerise: { icon: '🍒', weight: 30, pays: 5 },
        citron: { icon: '🍋', weight: 24, pays: 10 },
        cloche: { icon: '🔔', weight: 18, pays: 20 },
        trefle: { icon: '🍀', weight: 13, pays: 40 },
        diamant: { icon: '💎', weight: 9, pays: 80 },
        sept: { icon: '7️⃣', weight: 6, pays: 150 }, // JACKPOT
      },
      cherries: 2,
    },
    // Roulette européenne : 37 cases (0 vert). Retour total (mise comprise) selon le pari.
    roulette: {
      red: [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36],
      maxBets: 12,
      chips: [10, 25, 50, 100],
    },
    // Blackjack : sabot infini, la banque tire jusqu'à 17 (et reste sur 17 souple), doubler sur les 2 premières cartes.
    blackjack: { blackjackPays: 2.5, dealerStand: 17 },
    // Lac gelé : 25 cases dont `mines` fissures ; le gain suit la probabilité de survie (avantage de la maison 3 %).
    glace: { size: 25, mines: [3, 5, 10, 15], edge: 0.97 },
    // Gobelets : 3 gobelets, la bille sous l'un d'eux ; gagner rend 2,85 × la mise.
    gobelets: { cups: 3, pays: 2.85 },
    // Caisse : prix fixe, poids sur 10 000.
    caisse: {
      price: 100,
      tiers: {
        mauvais: { label: 'Petit lot', color: '#9aa4b2' },
        correct: { label: 'Bon lot', color: '#4f8cff' },
        incroyable: { label: 'Lot incroyable', color: '#ffb000' },
      },
      loot: [
        { id: 'golds', tier: 'mauvais', weight: 3500, label: 'Quelques golds', icon: '🪙', gold: [20, 60] },
        { id: 'commun', tier: 'mauvais', weight: 2500, label: 'Arme commune', icon: '🗡️', rarity: 'commun' },
        { id: 'peu_commun', tier: 'mauvais', weight: 2000, label: 'Arme peu commune', icon: '🗡️', rarity: 'peu_commun' },
        { id: 'rare', tier: 'correct', weight: 1200, label: 'Arme rare', icon: '⚔️', rarity: 'rare' },
        { id: 'epique', tier: 'correct', weight: 500, label: 'Arme épique', icon: '⚔️', rarity: 'epique' },
        { id: 'cle', tier: 'correct', weight: 200, label: 'Clé de boss', icon: '🗝️', keys: 1 },
        { id: 'legendaire', tier: 'incroyable', weight: 70, label: 'Arme légendaire', icon: '🌟', rarity: 'legendaire' },
        { id: 'familier', tier: 'incroyable', weight: 30, label: 'Familier au hasard', icon: '🐾', pet: true },
      ],
    },
  };
  // Machine à sous : multiplicateur d'une combinaison de 3 symboles.
  function slotsPayout(reels) {
    const S = CASINO.slots.symbols;
    if (reels.length === 3 && reels.every((r) => r === reels[0]) && S[reels[0]]) return { mult: S[reels[0]].pays, kind: reels[0] === 'sept' ? 'jackpot' : 'triple', symbol: reels[0] };
    if (reels.filter((r) => r === 'cerise').length === 2) return { mult: CASINO.slots.cherries, kind: 'cerises', symbol: 'cerise' };
    return { mult: 0, kind: null, symbol: null };
  }
  // Taux de retour théorique de la machine à sous (≈ 94,6 %).
  function slotsRtp() {
    const S = CASINO.slots.symbols;
    const W = Object.values(S).reduce((a, s) => a + s.weight, 0);
    const pc = S.cerise.weight / W;
    return Object.values(S).reduce((a, s) => a + Math.pow(s.weight / W, 3) * s.pays, 0) + 3 * pc * pc * (1 - pc) * CASINO.slots.cherries;
  }
  // Roulette : couleur d'un numéro.
  function rouletteColor(n) {
    if (n === 0) return 'vert';
    return CASINO.roulette.red.includes(n) ? 'rouge' : 'noir';
  }
  // Paris de la roulette : 'n:17', rouge, noir, pair, impair, manque (1-18), passe (19-36), d1/d2/d3 (douzaines), c1/c2/c3 (colonnes).
  // Retour total (mise comprise) ; null si le pari est inconnu.
  function rouletteReturn(on) {
    if (/^n:(\d|[12]\d|3[0-6])$/.test(on)) return 36;
    if (['rouge', 'noir', 'pair', 'impair', 'manque', 'passe'].includes(on)) return 2;
    if (['d1', 'd2', 'd3', 'c1', 'c2', 'c3'].includes(on)) return 3;
    return null;
  }
  function rouletteWins(on, n) {
    if (on.startsWith('n:')) return Number(on.slice(2)) === n;
    if (n === 0) return false;
    switch (on) {
      case 'rouge': return rouletteColor(n) === 'rouge';
      case 'noir': return rouletteColor(n) === 'noir';
      case 'pair': return n % 2 === 0;
      case 'impair': return n % 2 === 1;
      case 'manque': return n <= 18;
      case 'passe': return n >= 19;
      case 'd1': case 'd2': case 'd3': return Math.ceil(n / 12) === Number(on[1]);
      case 'c1': case 'c2': case 'c3': return ((n - 1) % 3) + 1 === Number(on[1]);
      default: return false;
    }
  }
  // Blackjack : valeur d'une main ({ r: 'A'|'2'…'10'|'J'|'Q'|'K' }), as à 11 tant que ça ne dépasse pas 21.
  function bjValue(cards) {
    let total = 0;
    let aces = 0;
    for (const c of cards) {
      if (c.r === 'A') { total += 11; aces += 1; } else if (['J', 'Q', 'K'].includes(c.r)) total += 10; else total += Number(c.r);
    }
    while (total > 21 && aces) { total -= 10; aces -= 1; }
    return { total, soft: aces > 0, blackjack: cards.length === 2 && total === 21 };
  }
  // Lac gelé : multiplicateur après `safe` cases sûres avec `mines` fissures (arrondi au centième inférieur).
  function glaceMult(mines, safe) {
    const N = CASINO.glace.size;
    let p = 1;
    for (let i = 0; i < safe; i++) p *= (N - mines - i) / (N - i);
    if (safe === 0) return 1;
    return Math.floor((CASINO.glace.edge / p) * 100) / 100;
  }

  // ---------- Survivor ----------
  // Mode à part : on se déplace (ZQSD) sur une grande carte et on survit à des vagues d'ennemis. Les stats
  // habituelles du personnage ne comptent pas : tout le monde part du même pied, seule la méta-progression
  // (payée en émeraudes) améliore les stats de départ. Simulation côté serveur (server/survivor.js).
  const SURVIVOR = {
    price: 300, // golds la partie
    map: { w: 10800, h: 10800 },
    mapScale: 2.25, // la carte dessinée sur une base de 4 800 px, agrandie ×2,25 (lieux-dits, rivière, lac…)
    roadSpeed: 0.1, // sur les routes (et les ponts) : +10 % de vitesse
    waterSlow: 0.5, // dans l'eau (rivière, lac, mare) hors des ponts : vitesse ×0,5, joueur comme ennemis
    waveSeconds: 30,
    bossEvery: 5,
    // Vague de boss : la suivante n'arrive pas tant que le boss vit ; ignoré 3 min, il s'enrage (vitesse et dégâts ×1,5, attaques plus fréquentes)
    bossRage: { after: 180, speed: 1.5, damage: 1.5, special: 0.6 },
    dailyWave: 30, // atteindre la vague 30 : 10 coffres et 3 Clés de boss, une fois par jour (heure de Paris)
    daily: { chests: 10, keys: 3 },
    maxEnemies: 240,
    spawnDist: [720, 860],
    view: { w: 1280, h: 720 },
    player: { radius: 14, maxHp: 120, speed: 150, magnet: 70, regen: 0, armor: 0, damage: 1, area: 1, cooldown: 1, amount: 0, luck: 0, xp: 1, crit: 0, revivals: 0, rerolls: 0, greed: 0,
      dodge: 0, thorns: 0, lifeKill: 0, duration: 1, shotSpeed: 1, critMult: 2, shield: 0, explore: 0, bossDmg: 0, healMult: 1, knockback: 1, chill: 0 },
    hitCooldown: 1, // un même ennemi ne frappe qu'une fois par seconde
    moveSlack: 1.35, // tolérance sur la position envoyée par le navigateur (vitesse × temps × 1,35)
    idlePause: 20, // s sans nouvelles du joueur : pause automatique
    abandonAfter: 600, // s en pause sans joueur : la partie se termine
    maxWeapons: 6,
    maxPassives: 6,
    gems: [{ v: 1, color: '#4fa8ff' }, { v: 5, color: '#3ddc5a' }, { v: 25, color: '#ff4d6d' }], // petite, moyenne, grosse
    maxGems: 320,
    drops: { chicken: 0.004, magnet: 0.0015, watch: 0.0012, bomb: 0.0006 }, // par monstre tué
    // Montre : le temps ralentit pour les ennemis et leurs projectiles (pas pour le joueur ni ses armes)
    watch: { duration: 10, enemy: 0.35, boss: 0.7 },
    // Bombe : tue les monstres normaux à l'écran ; élites, gardiens et chariot perdent la moitié de leur vie ; boss épargnés
    bomb: { tough: 0.5 },
    evoPause: 2.6, // s : le jeu s'arrête le temps de la cinématique d'évolution
    eliteEvery: 50, // s : un ennemi d'élite (coffre d'une amélioration)
    elite: { hp: 9, damage: 1.5, scale: 1.7, xp: 25 },
  };
  // Lieux-dits : la carte est partagée entre les zones les plus proches de ces points (et leurs ennemis favoris).
  // Lieux-dits : la carte est partagée entre les zones les plus proches de ces points. Chacune a ses ennemis favoris
  // et un effet tant que le joueur s'y trouve (fx) : xp, regen (PV/s), gems (gemmes ×(1+gems)), slow (ralentit les
  // ennemis), speed, magnet, damage, burn (PV perdus par seconde), crit, area, enemyHp (vie des ennemis qui y apparaissent).
  const SURVIVOR_ZONES = {
    village: { label: 'Village', x: 2400, y: 2400, size: 0.8, ground: '#78b35e', enemies: ['gobelin', 'rat'], bonus: 'Refuge', icon: '🏡', fx: { regen: 1, xp: -0.25 }, desc: '+1 PV/s, mais −25 % d\'expérience' },
    foret: { label: 'Forêt sombre', x: 950, y: 1100, size: 1.2, ground: '#2f6a39', enemies: ['araignee', 'gobelin'], bonus: 'Gibier', icon: '🌲', fx: { xp: 0.3, enemyHp: 0.2 }, desc: '+30 % d\'expérience, ennemis +20 % de vie' },
    lac: { label: 'Lac gelé', x: 2300, y: 780, size: 1.0, ground: '#cfe7f2', enemies: ['chauve_souris', 'squelette'], bonus: 'Glace', icon: '❄️', fx: { slow: 0.25 }, desc: 'ennemis ralentis de 25 %' },
    cimetiere: { label: 'Cimetière', x: 3800, y: 1150, size: 0.95, ground: '#5a6150', enemies: ['squelette', 'chauve_souris'], bonus: 'Âmes', icon: '🪦', fx: { gems: 1, enemyHp: 0.15 }, desc: 'gemmes d\'expérience ×2, ennemis +15 % de vie' },
    champs: { label: 'Champs de blé', x: 3950, y: 2350, size: 1.05, ground: '#c8b356', enemies: ['rat', 'gobelin'], bonus: 'Vent', icon: '🌾', fx: { speed: 0.15, magnet: 0.3 }, desc: '+15 % de vitesse, +30 % de rayon de ramassage' },
    volcan: { label: 'Volcan', x: 3900, y: 3850, size: 1.05, ground: '#5a2c22', enemies: ['dragonnet', 'flammeche'], bonus: 'Fournaise', icon: '🌋', fx: { damage: 0.3, burn: 1.5 }, desc: '+30 % de dégâts, mais −1,5 PV/s' },
    ruines: { label: 'Ruines', x: 2750, y: 4050, size: 0.9, ground: '#a59c88', enemies: ['gobelin_violet', 'squelette'], bonus: 'Reliques', icon: '🏛️', fx: { crit: 0.15 }, desc: '+15 % de coups critiques' },
    marais: { label: 'Marais', x: 1150, y: 3650, size: 1.05, ground: '#4c5d38', enemies: ['slime', 'rat'], bonus: 'Brume', icon: '🐸', fx: { area: 0.25, speed: -0.1 }, desc: '+25 % de zone, −10 % de vitesse' },
    prairie: { label: 'Prairie fleurie', x: 800, y: 2350, size: 1.0, ground: '#8ec46b', enemies: ['slime', 'chauve_souris'], bonus: 'Pollen', icon: '🌸', fx: { magnet: 0.5, regen: 0.5 }, desc: '+50 % de rayon de ramassage, +0,5 PV/s' },
  };
  // Coordonnées données sur la base de 4 800 px : agrandies ici à la taille de la carte
  for (const z of Object.values(SURVIVOR_ZONES)) { z.x *= SURVIVOR.mapScale; z.y *= SURVIVOR.mapScale; }
  // Raisons d'explorer : autels (bénédiction d'un lieu-dit), éclats d'émeraude, trésors gardés.
  const SURVIVOR_EXPLORE = {
    altar: { radius: 70, charge: 2, duration: 40, cooldown: 150, mult: 1.5, heal: 0.25 }, // un autel par lieu-dit (sauf le village)
    shard: { every: 30, max: 4, dist: [2000, 3800], radius: 34, emeralds: 1 }, // éclats d'émeraude, jamais au village
    treasure: { first: 90, every: 150, upgrades: 2, emeralds: 3, guards: 6, radius: 42, aggro: 450 }, // les gardiens restent au trésor tant que le joueur est à plus de 450 px
  };
  // Sanctuaires maudits (placés au hasard à chaque partie, cumulables) : chacun activé donne aux monstres +10 % de
  // dégâts et de vitesse, et au joueur +10 % d'émeraudes en fin de partie.
  const SURVIVOR_CURSE = { count: 6, charge: 2, radius: 56, enemy: 0.1, emeralds: 0.1, minVillage: 1100 };
  // Encerclement : toutes les 4 vagues (sauf les vagues de boss), un anneau de monstres se referme sur le joueur.
  const SURVIVOR_RING = { every: 4, min: 40, max: 90, perWave: 3, radius: 540 };
  // Chariot doré : il apparaît de temps en temps et fuit le joueur ; détruit, il fait pleuvoir gemmes et émeraudes.
  const SURVIVOR_CART = { first: 100, every: [120, 170], life: 32, hp: 240, speed: 132, radius: 28, gems: 24, gemValue: 5, emeralds: 3, dist: 700 };
  // Jour et nuit : un cycle de 5 min avec 1 min de nuit (vision réduite), un soir doré et une aube rose.
  const SURVIVOR_DAY = { cycle: 300, offset: 20, dawn: 20, eveningAt: 190, nightAt: 240, warnBefore: 15 };
  // Lumière à l'instant t (s) : dark (obscurité 0 à 1), warm (lumière dorée du soir), pink (aube), phase
  function survivorDaylight(t) {
    const D = SURVIVOR_DAY;
    const c = (((t + D.offset) % D.cycle) + D.cycle) % D.cycle;
    const smooth = (k) => k * k * (3 - 2 * k);
    if (c < D.dawn) { const k = c / D.dawn; return { phase: 'dawn', dark: 0.78 * Math.pow(1 - k, 1.6), warm: 0, pink: Math.sin(Math.PI * Math.min(1, k * 1.2)) * 0.9, c }; }
    if (c < D.eveningAt) return { phase: 'day', dark: 0, warm: 0, pink: 0, c };
    if (c < D.nightAt) { const k = (c - D.eveningAt) / (D.nightAt - D.eveningAt); return { phase: 'evening', dark: 0.7 * smooth(Math.max(0, (k - 0.35) / 0.65)), warm: Math.sin(Math.PI * Math.min(1, k * 1.15)), pink: 0, c }; }
    return { phase: 'night', dark: 0.7 + 0.08 * Math.min(1, (c - D.nightAt) / 4), warm: 0, pink: 0, c };
  }
  // Effet de zone (fx) en jeu : celui du lieu-dit où l'on est, plus la bénédiction d'autel en cours (parties positives × 1,5).
  function survivorZoneFx(zone, blessing) {
    const fx = { ...((SURVIVOR_ZONES[zone] || {}).fx || {}) };
    const B = blessing && SURVIVOR_ZONES[blessing];
    if (B) for (const [k, v] of Object.entries(B.fx)) if (v > 0 && k !== 'enemyHp' && k !== 'burn') fx[k] = (fx[k] || 0) + v * SURVIVOR_EXPLORE.altar.mult;
    return fx;
  }
  // Lieux-dits aux frontières naturelles : diagramme de Voronoï pondéré (`size`) sur une position déformée par
  // des ondulations régulières (même résultat côté serveur et navigateur, sans hasard).
  function survivorWarp(X, Y) {
    const k = SURVIVOR.mapScale;
    const x = X / k;
    const y = Y / k;
    const w = [
      x + Math.sin(y * 0.0021 + 1.3) * 160 + Math.sin((x + y) * 0.0047 + 0.7) * 70 + Math.sin(x * 0.011 - y * 0.008 + 2.1) * 22,
      y + Math.sin(x * 0.0019 + 4.1) * 160 + Math.sin((x - y) * 0.0043 + 2.3) * 70 + Math.sin(y * 0.012 + x * 0.007 + 0.4) * 22,
    ];
    return [w[0] * k, w[1] * k];
  }
  // ---- Géographie de la carte (routes, rivière, lac, mare, cratère), la même pour le serveur et le navigateur ----
  // Tracée sur la base de 4 800 px puis agrandie ×mapScale. L'eau ralentit (SURVIVOR.waterSlow), sauf sur les ponts.
  function survivorHash(x, y, s = 0) {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function svNoise(x, y, s) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = x - xi;
    const v = y - yi;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    const a = survivorHash(xi, yi, s);
    const b = survivorHash(xi + 1, yi, s);
    const c = survivorHash(xi, yi + 1, s);
    const d = survivorHash(xi + 1, yi + 1, s);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  }
  function svCatmull(pts, steps = 10) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function svInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function svSegDist(x, y, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
  }
  let svMapCache = null;
  function survivorMap() {
    if (svMapCache) return svMapCache;
    const K = SURVIVOR.mapScale;
    const S = (pts) => pts.map(([x, y]) => [x * K, y * K]);
    const Z = (id) => [SURVIVOR_ZONES[id].x, SURVIVOR_ZONES[id].y];
    // Route sinueuse : une grande courbe et de petites ondulations
    const winding = (a, b, seed, wide = 1) => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      const nx = -dy / len;
      const ny = dx / len;
      const amp = (110 + survivorHash(seed, 1, 7) * 120) * K * wide * (survivorHash(seed, 2, 7) < 0.5 ? -1 : 1);
      const ph = survivorHash(seed, 3, 7) * Math.PI * 2;
      const pts = [];
      const n = Math.max(4, Math.round(len / (260 * K)));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const w = Math.sin(t * Math.PI) * (amp + (Math.sin(t * Math.PI * 3 + ph) * 35 + (survivorHash(seed, i, 8) - 0.5) * 30) * K);
        pts.push([a[0] + dx * t + nx * w, a[1] + dy * t + ny * w]);
      }
      return svCatmull(pts, 8);
    };
    const blob = (cx, cy, r, seed, n = 28) => Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const k = 1 + (svNoise(i * 0.7, 0, seed) - 0.5) * 0.45;
      return [(cx + Math.cos(a) * r * k) * K, (cy + Math.sin(a) * r * 0.72 * k) * K];
    });
    // Routes : du village vers chaque lieu-dit, puis une grande boucle qui relie les lieux-dits voisins
    const outer = Object.keys(SURVIVOR_ZONES).filter((id) => id !== 'village');
    const roads = outer.map((id, i) => winding(Z('village'), Z(id), i + 1));
    const ring = outer.slice().sort((a, b) => Math.atan2(SURVIVOR_ZONES[a].y - Z('village')[1], SURVIVOR_ZONES[a].x - Z('village')[0]) - Math.atan2(SURVIVOR_ZONES[b].y - Z('village')[1], SURVIVOR_ZONES[b].x - Z('village')[0]));

    const river = svCatmull(S([[2130, 640], [2030, 1000], [1820, 1380], [1640, 1720], [1580, 2080], [1440, 2420], [1470, 2800], [1340, 3150], [1150, 3360]]), 12);
    const lake = blob(2250, 400, 320, 21);
    const pond = blob(1060, 3440, 150, 44, 22);
    const crater = { x: 4330 * K, y: 4330 * K, r: 260 * K };
    const lava = blob(4330, 4330, 150, 33, 22);
    // Boucle : pour chaque tronçon, la première courbe qui évite le lac, la mare et la lave
    const wet = (pts) => pts.some(([x, y]) => svInPoly(x, y, lake) || svInPoly(x, y, pond) || Math.hypot(x - crater.x, y - crater.y) < crater.r);
    ring.forEach((id, i) => {
      let best = null;
      for (let k = 0; k < 12 && !best; k++) { const r = winding(Z(id), Z(ring[(i + 1) % ring.length]), 40 + i + k * 8, 0.55 + k * 0.15); if (!wet(r)) best = r; }
      roads.push(best || winding(Z(id), Z(ring[(i + 1) % ring.length]), 40 + i, 0.15));
    });
    const width = { river: 44 * K, road: 46 * K, bridge: [84 * K, 54 * K] };
    // Ponts : là où une route croise la rivière
    const bridges = [];
    for (const road of roads) {
      for (let i = 0; i < road.length - 1; i++) {
        for (let j = 0; j < river.length - 1; j++) {
          const [p, q] = [road[i], road[i + 1]];
          const [r, t] = [river[j], river[j + 1]];
          const d = (q[0] - p[0]) * (t[1] - r[1]) - (q[1] - p[1]) * (t[0] - r[0]);
          if (!d) continue;
          const a = ((r[0] - p[0]) * (t[1] - r[1]) - (r[1] - p[1]) * (t[0] - r[0])) / d;
          const b = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
          if (a >= 0 && a <= 1 && b >= 0 && b <= 1) bridges.push({ x: p[0] + (q[0] - p[0]) * a, y: p[1] + (q[1] - p[1]) * a, a: Math.atan2(q[1] - p[1], q[0] - p[0]) });
        }
      }
    }
    // Grille du sol (cases de 16 px) : 1 = eau, 2 = route ou pont, 0 = terre ferme
    const C = 16;
    const cols = Math.ceil(SURVIVOR.map.w / C);
    const rows = Math.ceil(SURVIVOR.map.h / C);
    const grid = new Uint8Array(cols * rows);
    const mark = (x0, y0, x1, y1, test, v) => {
      for (let gy = Math.max(0, Math.floor(y0 / C)); gy <= Math.min(rows - 1, Math.floor(y1 / C)); gy++) {
        for (let gx = Math.max(0, Math.floor(x0 / C)); gx <= Math.min(cols - 1, Math.floor(x1 / C)); gx++) if (test(gx * C + C / 2, gy * C + C / 2)) grid[gy * cols + gx] = v;
      }
    };
    // Routes (2), puis l'eau par-dessus (1), puis les ponts (2 : on y va aussi vite que sur la route)
    const rh = width.road / 2 + 4;
    for (const road of roads) {
      for (let i = 0; i < road.length - 1; i++) {
        const [ax, ay] = road[i];
        const [bx, by] = road[i + 1];
        mark(Math.min(ax, bx) - rh, Math.min(ay, by) - rh, Math.max(ax, bx) + rh, Math.max(ay, by) + rh, (x, y) => svSegDist(x, y, ax, ay, bx, by) <= rh, 2);
      }
    }
    const half = width.river / 2;
    for (let i = 0; i < river.length - 1; i++) {
      const [ax, ay] = river[i];
      const [bx, by] = river[i + 1];
      mark(Math.min(ax, bx) - half, Math.min(ay, by) - half, Math.max(ax, bx) + half, Math.max(ay, by) + half, (x, y) => svSegDist(x, y, ax, ay, bx, by) <= half, 1);
    }
    for (const poly of [lake, pond]) {
      const xs = poly.map((p) => p[0]);
      const ys = poly.map((p) => p[1]);
      mark(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (x, y) => svInPoly(x, y, poly), 1);
    }
    for (const b of bridges) {
      const [L, Wd] = width.bridge;
      const c = Math.cos(b.a);
      const s = Math.sin(b.a);
      const R = Math.hypot(L, Wd) / 2;
      mark(b.x - R, b.y - R, b.x + R, b.y + R, (x, y) => { const dx = x - b.x; const dy = y - b.y; return Math.abs(dx * c + dy * s) <= L / 2 && Math.abs(-dx * s + dy * c) <= Wd / 2; }, 2);
    }
    svMapCache = { roads, river, lake, pond, crater, lava, bridges, width, grid, cell: C, cols, rows };
    return svMapCache;
  }
  // Ce point est-il dans l'eau (hors des ponts) ?
  function survivorWater(x, y) {
    const M = survivorMap();
    const gx = Math.floor(x / M.cell);
    const gy = Math.floor(y / M.cell);
    if (gx < 0 || gy < 0 || gx >= M.cols || gy >= M.rows) return false;
    return M.grid[gy * M.cols + gx] === 1;
  }
  // Ce point est-il sur une route (ou un pont) ? On y va SURVIVOR.roadSpeed plus vite.
  function survivorRoad(x, y) {
    const M = survivorMap();
    const gx = Math.floor(x / M.cell);
    const gy = Math.floor(y / M.cell);
    if (gx < 0 || gy < 0 || gx >= M.cols || gy >= M.rows) return false;
    return M.grid[gy * M.cols + gx] === 2;
  }
  // Multiplicateur de vitesse du terrain : eau (lente), route (rapide), sinon 1
  function survivorGround(x, y) {
    return survivorWater(x, y) ? SURVIVOR.waterSlow : survivorRoad(x, y) ? 1 + SURVIVOR.roadSpeed : 1;
  }

  // Les deux lieux-dits les plus proches et leurs distances pondérées (pour fondre les sols à la frontière).
  function survivorZoneNear(x, y) {
    const [qx, qy] = survivorWarp(x, y);
    let a = null;
    let b = null;
    let da = Infinity;
    let db = Infinity;
    for (const id in SURVIVOR_ZONES) {
      const z = SURVIVOR_ZONES[id];
      const d = Math.hypot(qx - z.x, qy - z.y) / (z.size || 1);
      if (d < da) { b = a; db = da; a = id; da = d; } else if (d < db) { b = id; db = d; }
    }
    return { a, b, da, db };
  }
  function survivorZone(x, y) {
    return survivorZoneNear(x, y).a;
  }

  // Ennemis (dessins des monstres du donjon) : vie, vitesse, dégâts au contact, XP laissée, vague d'apparition.
  const SURVIVOR_ENEMIES = {
    rat: { hp: 7, speed: 88, damage: 4, xp: 1, radius: 10, from: 1 },
    gobelin: { hp: 11, speed: 66, damage: 5, xp: 1, radius: 12, from: 1 },
    chauve_souris: { hp: 6, speed: 108, damage: 3, xp: 1, radius: 10, from: 1, erratic: true },
    slime: { hp: 30, speed: 44, damage: 7, xp: 2, radius: 15, from: 3 },
    araignee: { hp: 13, speed: 96, damage: 5, xp: 1, radius: 12, from: 3 },
    gobelin_violet: { hp: 24, speed: 72, damage: 7, xp: 2, radius: 13, from: 6 },
    squelette: { hp: 26, speed: 52, damage: 6, xp: 2, radius: 13, from: 6, shoot: { every: 3.4, speed: 230, damage: 7 } },
    dragonnet: { hp: 36, speed: 82, damage: 9, xp: 3, radius: 14, from: 9 },
    flammeche: { hp: 11, speed: 124, damage: 6, xp: 1, radius: 10, from: 9 },
  };
  const SURVIVOR_ENEMY_KINDS = Object.keys(SURVIVOR_ENEMIES);
  // Boss toutes les 5 vagues, dans cet ordre (puis le cycle reprend, plus fort).
  // Vitesses ×1,5 (avant 58 à 66) : les boss sortent plus vite de la foule des monstres, on peut les frapper.
  const SURVIVOR_BOSSES = {
    troll: { hp: 380, speed: 87, damage: 15, radius: 34, every: 4.5, label: 'Grokk' },
    maexxna: { hp: 480, speed: 99, damage: 15, radius: 32, every: 5, label: 'Maexxna' },
    mimic: { hp: 560, speed: 93, damage: 17, radius: 30, every: 4.5, label: 'Grignotor' },
    dragon: { hp: 640, speed: 96, damage: 17, radius: 34, every: 3.8, label: 'Pyrax' },
    liche: { hp: 720, speed: 87, damage: 17, radius: 28, every: 4.2, label: 'Givrenoire' },
    sorcier: { hp: 800, speed: 93, damage: 18, radius: 26, every: 5, label: 'Malvorath' },
    // Les trois boss suivants (vagues 35, 40, 45) ont plusieurs attaques, jouées à tour de rôle (attacks).
    // Ether : esquive une partie des coups (dodge), devient intangible en invoquant des mains spectrales.
    ether: { hp: 900, speed: 96, damage: 18, radius: 30, every: 4.2, label: 'Ether', dodge: 0.3, attacks: ['hands', 'wail', 'chains'], ghost: 3.5 },
    // Lilith : illusions indiscernables (decoys) qui explosent si on ne les brise pas, disparition puis bond, cartes.
    lilith: { hp: 980, speed: 108, damage: 18, radius: 26, every: 4, label: 'Lilith', attacks: ['illusions', 'pounce', 'cards'], decoys: 3, decoyHp: 0.05, decoyLife: 8 },
    // Daedra : colonnes de feu infranchissables (walls), fouet à longue portée, démons de feu.
    daedra: { hp: 1060, speed: 90, damage: 19, radius: 28, every: 3.8, label: 'Daedra', attacks: ['pillars', 'whip', 'demons'], wallLife: 5, wallWidth: 34 },
  };
  const SURVIVOR_BOSS_ORDER = ['troll', 'maexxna', 'mimic', 'dragon', 'liche', 'sorcier', 'ether', 'lilith', 'daedra'];
  // Colonnes de feu de Daedra : un pas de (x0, y0) à (x1, y1) qui traverse l'une d'elles est refusé (serveur et navigateur).
  function survivorWallBlock(x0, y0, x1, y1, walls) {
    const side = (ax, ay, bx, by, px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    for (const w of walls || []) {
      const d1 = side(w.x, w.y, w.x2, w.y2, x0, y0);
      const d2 = side(w.x, w.y, w.x2, w.y2, x1, y1);
      const d3 = side(x0, y0, x1, y1, w.x, w.y);
      const d4 = side(x0, y0, x1, y1, w.x2, w.y2);
      if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    }
    return false;
  }
  /*
   * Gardiens légendaires : un par lieu-dit (sauf le village), seuls 2 ou 3 d'entre eux (au hasard) dorment sur la
   * carte à chaque partie. On les réveille exprès en restant `wake` secondes sur leur sceau ; un seul éveillé à la fois.
   * Ils sont bien plus forts qu'un boss de vague (vie × la difficulté de la vague au réveil) et retournent dormir si
   * on s'éloigne trop de leur antre. draw : dessin réutilisé (boss ou monstre), hue : teinte, attacks : leurs attaques.
   */
  const SURVIVOR_GUARDIAN = { count: [2, 3], wake: 3, sealRadius: 62, lairDist: 270, leash: 1500, every: 3.4, hp: 2000, damage: 16, emeralds: 15, chest: 3 };
  const SURVIVOR_GUARDIANS = {
    foret: { label: 'Reine sylvestre', icon: '🕷️', draw: 'maexxna', scale: 1.25, hue: 70, speed: 92, radius: 42, attacks: ['web', 'spiders', 'spit'] },
    lac: { label: 'Seigneur de l\'Hiver', icon: '❄️', draw: 'liche', scale: 1.35, hue: 0, speed: 84, radius: 36, attacks: ['nova', 'frost', 'nova'] },
    cimetiere: { label: 'Roi des morts', icon: '💀', draw: 'sorcier', scale: 1.35, hue: -150, speed: 88, radius: 34, attacks: ['blink', 'raise'] },
    champs: { label: 'Grignotor doré', icon: '💰', draw: 'mimic', scale: 1.4, hue: 15, speed: 96, radius: 40, attacks: ['leap', 'coins', 'leap'] },
    volcan: { label: 'Pyrax l\'Ancien', icon: '🔥', draw: 'dragon', scale: 1.2, hue: -25, speed: 92, radius: 44, attacks: ['fan', 'meteor'] },
    ruines: { label: 'Colosse des ruines', icon: '🗿', draw: 'troll', scale: 1.4, hue: 0, gray: true, speed: 78, radius: 46, attacks: ['quake', 'rocks'] },
    marais: { label: 'Roi des marais', icon: '🐸', draw: 'slime', scale: 3.4, hue: 0, speed: 70, radius: 50, attacks: ['split', 'bog'] },
    prairie: { label: 'Roi gobelin', icon: '👑', draw: 'gobelin_violet', scale: 2.8, hue: 0, speed: 98, radius: 40, attacks: ['charge', 'summon', 'charge'] },
  };
  // Difficulté de la vague n (1, 2, …) : vie et dégâts des ennemis, nombre d'ennemis à l'écran.
  function survivorWave(n) {
    const k = Math.max(0, n - 1);
    return {
      hp: 1 + 0.2 * k + 0.014 * k * k,
      damage: 0.8 + 0.08 * k,
      target: Math.min(SURVIVOR.maxEnemies, Math.round(12 + 7 * k + 0.32 * k * k)),
      spawnPerSec: 2.5 + 1 * k,
    };
  }
  function survivorBoss(n) {
    if (n % SURVIVOR.bossEvery) return null;
    const i = n / SURVIVOR.bossEvery - 1;
    const kind = SURVIVOR_BOSS_ORDER[i % SURVIVOR_BOSS_ORDER.length];
    const cycle = Math.floor(i / SURVIVOR_BOSS_ORDER.length);
    const w = survivorWave(n);
    return { kind, hp: Math.round(SURVIVOR_BOSSES[kind].hp * w.hp * (1 + cycle)), damage: SURVIVOR_BOSSES[kind].damage * w.damage };
  }
  // XP pour passer du niveau L au suivant.
  function survivorXpToNext(level) {
    return Math.round(4 + (level - 1) * 3.5 + Math.pow(Math.max(0, level - 12), 1.6) * 3);
  }
  // Armes : stats de base puis ce que chaque niveau ajoute (niveau 1 à 8).
  // damage, cooldown (s), area (×), amount (projectiles), pierce, speed (px/s), duration (s), range (px).
  const SURVIVOR_WEAPONS = {
    epee: {
      label: 'Épée', icon: '⚔️', color: '#e8e8f0', desc: 'Taillade devant toi à courte portée.',
      base: { damage: 15, cooldown: 1.15, area: 1, amount: 1, range: 125, width: 72 },
      levels: [{ amount: 1 }, { damage: 6 }, { area: 0.15 }, { damage: 6 }, { area: 0.15 }, { damage: 8 }, { damage: 10, cooldown: -0.2 }],
    },
    dagues: {
      label: 'Dagues', icon: '🗡️', color: '#cfd8e8', desc: 'Lance une volée de dagues tout autour de toi.',
      // Renforcées : 3 dagues dès le niveau 1 (10 au niveau 8), lancées en cercle autour du joueur
      base: { damage: 9, cooldown: 1, amount: 3, pierce: 1, speed: 620, duration: 1.1 },
      levels: [{ amount: 1 }, { damage: 4 }, { amount: 2 }, { pierce: 1 }, { amount: 2 }, { damage: 5 }, { amount: 2, pierce: 1 }],
    },
    baguette: {
      label: 'Baguette magique', icon: '🪄', color: '#b98cff', desc: 'Un trait magique vers l\'ennemi le plus proche.',
      base: { damage: 11, cooldown: 1.2, amount: 1, pierce: 1, speed: 400, duration: 2.2 },
      levels: [{ amount: 1 }, { cooldown: -0.2 }, { amount: 1 }, { damage: 6 }, { amount: 1 }, { pierce: 1 }, { damage: 8 }],
    },
    aura: {
      label: 'Aura de feu', icon: '🔥', color: '#ff7a1f', desc: 'Brûle les ennemis tout autour de toi.',
      base: { damage: 5, cooldown: 0.55, area: 1, range: 72 },
      levels: [{ area: 0.2 }, { damage: 2 }, { cooldown: -0.08 }, { area: 0.2 }, { damage: 3 }, { area: 0.2 }, { damage: 4 }],
    },
    hache: {
      label: 'Hache', icon: '🪓', color: '#c8a070', desc: 'Lancée en l\'air, elle retombe en traversant tout.',
      base: { damage: 24, cooldown: 1.7, amount: 1, area: 1, speed: 520, duration: 1.6 },
      levels: [{ amount: 1 }, { damage: 10 }, { area: 0.2 }, { amount: 1 }, { damage: 10 }, { cooldown: -0.3 }, { amount: 1, damage: 12 }],
    },
    foudre: {
      label: 'Foudre', icon: '⚡', color: '#ffe63c', desc: 'Frappe des ennemis au hasard autour de toi.',
      base: { damage: 26, cooldown: 2.4, amount: 2, area: 1, range: 52 },
      levels: [{ amount: 1 }, { damage: 10 }, { area: 0.25 }, { amount: 1 }, { cooldown: -0.4 }, { damage: 14 }, { amount: 2 }],
    },
    orbes: {
      label: 'Orbes gardiens', icon: '🔮', color: '#5fd3ff', desc: 'Des orbes tournent autour de toi un moment.',
      base: { damage: 10, cooldown: 3.2, amount: 2, area: 1, speed: 3.2, duration: 3, range: 92 },
      levels: [{ amount: 1 }, { speed: 0.6, damage: 4 }, { duration: 0.8 }, { amount: 1 }, { damage: 6 }, { area: 0.25, duration: 0.8 }, { amount: 1, damage: 6 }],
    },
    fiole: {
      label: 'Fiole d\'acide', icon: '🧪', color: '#7cff4f', desc: 'Une flaque d\'acide qui ronge ceux qui marchent dedans.',
      base: { damage: 7, cooldown: 3, amount: 1, area: 1, duration: 2.6, range: 64 },
      levels: [{ amount: 1 }, { damage: 3 }, { area: 0.2 }, { duration: 0.8 }, { amount: 1 }, { damage: 4 }, { area: 0.25, amount: 1 }],
    },
    // Armes secrètes : elles ne s'achètent pas, elles se débloquent en remplissant un objectif sur plusieurs parties (SURVIVOR_SECRETS)
    boomerang: {
      label: 'Boomerang', icon: '🪃', color: '#e0a060', desc: 'Lancé vers l\'ennemi le plus proche, il revient en traversant tout.', secret: true,
      base: { damage: 18, cooldown: 1.5, amount: 1, area: 1, pierce: 99, speed: 540, duration: 1.4 },
      levels: [{ amount: 1 }, { damage: 7 }, { area: 0.2 }, { amount: 1 }, { damage: 8 }, { cooldown: -0.3 }, { amount: 1, damage: 10 }],
    },
    faux: {
      label: 'Faux lunaire', icon: '🌙', color: '#d8d0ff', desc: 'Des faux spectrales fauchent tout autour de toi en un éclair.', secret: true,
      base: { damage: 30, cooldown: 2.4, amount: 1, area: 1, speed: 7, duration: 0.9, range: 150 },
      levels: [{ amount: 1 }, { damage: 10 }, { area: 0.2 }, { duration: 0.3 }, { damage: 12 }, { cooldown: -0.4 }, { amount: 1, damage: 14 }],
    },
    etoiles: {
      label: 'Pluie d\'étoiles', icon: '🌠', color: '#ffe680', desc: 'Des étoiles filantes s\'écrasent sur les ennemis autour de toi.', secret: true,
      base: { damage: 34, cooldown: 2.2, amount: 3, area: 1, range: 70 },
      levels: [{ amount: 1 }, { damage: 10 }, { area: 0.2 }, { amount: 1 }, { damage: 12 }, { cooldown: -0.4 }, { amount: 2 }],
    },
  };
  // Armes secrètes : objectif cumulé sur toutes les parties (progression dans character.survivor.secrets)
  const SURVIVOR_SECRETS = {
    boomerang: { goal: 15, metric: 'legends', text: 'Vaincre 15 gardiens légendaires' },
    faux: { goal: 30, metric: 'carts', text: 'Détruire 30 chariots dorés' },
    etoiles: { goal: 50, metric: 'curses', text: 'Activer 50 sanctuaires maudits' },
  };
  // Défis du jour : 3 tirés chaque jour (heure de Paris, les mêmes pour tout le monde), à réussir en une seule partie.
  const SURVIVOR_CHALLENGE_REWARD = 10; // émeraudes par défi réussi
  const SURVIVOR_CHALLENGES = {
    kills500: { text: 'Vaincre 500 monstres', metric: 'kills', goal: 500 },
    wave10: { text: 'Atteindre la vague 10', metric: 'wave', goal: 10 },
    wave15: { text: 'Atteindre la vague 15', metric: 'wave', goal: 15 },
    boss2: { text: 'Vaincre 2 boss', metric: 'bosses', goal: 2 },
    treasure2: { text: 'Ouvrir 2 trésors gardés', metric: 'treasures', goal: 2 },
    shards4: { text: 'Ramasser 4 éclats d\'émeraude', metric: 'shards', goal: 4 },
    altars3: { text: 'Recevoir 3 bénédictions d\'autel', metric: 'altars', goal: 3 },
    curse2: { text: 'Activer 2 sanctuaires maudits', metric: 'curses', goal: 2 },
    cart1: { text: 'Détruire un chariot doré', metric: 'carts', goal: 1 },
    legend1: { text: 'Vaincre un gardien légendaire', metric: 'legends', goal: 1 },
    evo1: { text: 'Faire évoluer une arme', metric: 'evos', goal: 1 },
    night1: { text: 'Survivre à une nuit entière', metric: 'nights', goal: 1 },
    level20: { text: 'Atteindre le niveau 20', metric: 'level', goal: 20 },
    bomb1: { text: 'Faire exploser une bombe', metric: 'bombs', goal: 1 },
  };
  // Les 3 défis d'un jour (« AAAA-MM-JJ ») : tirage fixe à partir de la date
  function survivorChallengesOf(day) {
    const ids = Object.keys(SURVIVOR_CHALLENGES);
    let seed = 0;
    for (const ch of String(day)) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
    const out = [];
    for (let k = 0; out.length < 3 && k < 50; k++) {
      const id = ids[Math.floor(survivorHash(seed, k, 91) * ids.length)];
      if (!out.includes(id)) out.push(id);
    }
    return out;
  }
  // Valeur d'une mesure (défis du jour, armes secrètes) pour un résultat de partie
  function survivorMetric(r, metric) {
    const f = r.found || {};
    switch (metric) {
      case 'legends': return (r.legends || []).length;
      case 'evos': return (r.evos || []).length;
      case 'treasures': case 'shards': case 'altars': case 'carts': case 'nights': case 'bombs': return f[metric] || 0;
      case 'curses': return r.curses || 0;
      default: return r[metric] || 0;
    }
  }
  const SURVIVOR_WEAPON_MAX = 8;
  // Stats d'une arme à un niveau donné.
  function survivorWeaponStats(id, level) {
    const W = SURVIVOR_WEAPONS[id];
    const s = { ...W.base };
    for (let i = 0; i < Math.min(level, SURVIVOR_WEAPON_MAX) - 1; i++) {
      for (const [k, v] of Object.entries(W.levels[i])) s[k] = Math.round(((s[k] || 0) + v) * 1000) / 1000;
    }
    return s;
  }
  // Évolutions : une arme au niveau 8 + l'objet indiqué → au prochain coffre (élite, boss, trésor, gardien), elle se
  // transforme en version surpuissante (stats fixes, nouveau comportement). Les stats du joueur (zone, projectiles…) s'appliquent toujours.
  const SURVIVOR_EVOLUTIONS = {
    epee: { label: 'Lame du Héros', passive: 'gant', color: '#ffd34a', desc: 'Une taillade dorée tout autour de toi, qui repousse tout.',
      stats: { damage: 60, cooldown: 0.85, area: 1, amount: 1, range: 165 } },
    dagues: { label: 'Tempête de lames', passive: 'bottes', color: '#9fe8ff', desc: '12 dagues qui partent en cercle et reviennent en traversant tout.',
      stats: { damage: 22, cooldown: 0.75, amount: 12, pierce: 6, speed: 700, duration: 1.2 } },
    baguette: { label: 'Sceptre des arcanes', passive: 'grimoire', color: '#c79bff', desc: 'Des traits qui explosent à chaque impact.',
      stats: { damage: 30, cooldown: 0.75, amount: 5, pierce: 2, speed: 520, duration: 2.4, blast: 85 } },
    aura: { label: 'Sanctuaire ardent', passive: 'coeur', color: '#fff0a0', desc: 'Une aura sacrée, plus grande, qui te soigne à chaque ennemi brûlé.',
      stats: { damage: 18, cooldown: 0.4, area: 1, range: 155, heal: 0.6 } },
    hache: { label: 'Hache du Titan', passive: 'armure', color: '#ff8a3d', desc: 'D\'énormes haches en éventail qui font trembler le sol en retombant.',
      stats: { damage: 70, cooldown: 1.3, amount: 4, area: 1.8, speed: 600, duration: 1.7, quake: 115 } },
    foudre: { label: 'Couronne d\'orage', passive: 'couronne', color: '#fff36b', desc: 'Chaque éclair rebondit sur 3 ennemis voisins.',
      stats: { damage: 55, cooldown: 1.5, amount: 6, area: 1, range: 80, chain: 3 } },
    orbes: { label: 'Anneau éternel', passive: 'sablier', color: '#a8f0ff', desc: 'Deux anneaux d\'orbes qui ne s\'arrêtent jamais de tourner.',
      stats: { damage: 30, cooldown: 1, amount: 6, area: 1.3, speed: 3.6, duration: 1, range: 100, always: true } },
    fiole: { label: 'Marée d\'acide', passive: 'cristal', color: '#4fffc0', desc: 'Des flaques géantes qui ralentissent, et une traînée d\'acide derrière toi.',
      stats: { damage: 15, cooldown: 1.6, amount: 3, area: 1.6, duration: 5, range: 64, slow: 0.4 } },
  };
  function survivorEvoReady(weapons, passives) {
    return weapons.filter((w) => !w.evo && w.level >= SURVIVOR_WEAPON_MAX && SURVIVOR_EVOLUTIONS[w.id] && (passives[SURVIVOR_EVOLUTIONS[w.id].passive] || 0) > 0).map((w) => w.id);
  }
  // Ce que gagne une arme en passant au niveau `level` (2 à 8), en texte.
  const SV_STAT_TEXT = {
    damage: (v) => `+${v} dégâts`, cooldown: (v) => `${String(v).replace('.', ',')} s de recharge`, area: (v) => `+${Math.round(v * 100)} % de zone`,
    amount: (v) => `+${v} projectile${v > 1 ? 's' : ''}`, pierce: (v) => `+${v} perforation`, speed: (v) => `+${v} de vitesse`,
    duration: (v) => `+${String(v).replace('.', ',')} s de durée`,
  };
  function survivorLevelText(id, level) {
    const W = SURVIVOR_WEAPONS[id];
    if (level <= 1) return W.desc;
    return Object.entries(W.levels[level - 2]).map(([k, v]) => (SV_STAT_TEXT[k] ? SV_STAT_TEXT[k](v) : '')).join(', ');
  }
  // Objets passifs : chaque exemplaire ajoute son effet (5 au plus, 2 pour le Duplicateur).
  const SURVIVOR_PASSIVES = {
    coeur: { label: 'Cœur robuste', icon: '❤️', max: 5, add: { maxHp: 20 }, desc: '+20 PV max' },
    armure: { label: 'Armure', icon: '🛡️', max: 5, add: { armor: 1 }, desc: '−1 dégât subi par coup' },
    bottes: { label: 'Bottes ailées', icon: '👢', max: 5, add: { speed: 0.08 }, desc: '+8 % de vitesse', mult: ['speed'] },
    gant: { label: 'Gantelet de force', icon: '🥊', max: 5, add: { damage: 0.1 }, desc: '+10 % de dégâts' },
    grimoire: { label: 'Grimoire', icon: '📕', max: 5, add: { cooldown: -0.07 }, desc: '−7 % de recharge' },
    cristal: { label: 'Cristal d\'envergure', icon: '💠', max: 5, add: { area: 0.1 }, desc: '+10 % de zone' },
    aimant: { label: 'Aimant', icon: '🧲', max: 5, add: { magnet: 0.3 }, desc: '+30 % de rayon de ramassage', mult: ['magnet'] },
    trefle: { label: 'Trèfle', icon: '🍀', max: 5, add: { crit: 0.05, luck: 10 }, desc: '+5 % de coups critiques (×2), plus de choix' },
    couronne: { label: 'Couronne', icon: '👑', max: 5, add: { xp: 0.08 }, desc: '+8 % d\'expérience' },
    pomme: { label: 'Pomme dorée', icon: '🍎', max: 5, add: { regen: 0.4 }, desc: '+0,4 PV par seconde' },
    duplicateur: { label: 'Duplicateur', icon: '➕', max: 2, add: { amount: 1 }, desc: '+1 projectile pour toutes les armes' },
    cape: { label: 'Cape d\'ombre', icon: '🧥', max: 5, add: { dodge: 0.05 }, desc: '+5 % de chances d\'esquiver un coup' },
    epines: { label: 'Armure d\'épines', icon: '🌵', max: 5, add: { thorns: 12 }, desc: 'renvoie 12 dégâts à l\'ennemi qui te touche' },
    croc: { label: 'Croc de vampire', icon: '🦷', max: 5, add: { lifeKill: 0.3 }, desc: '+0,3 PV par monstre tué' },
    sablier: { label: 'Sablier', icon: '⏳', max: 5, add: { duration: 0.12 }, desc: '+12 % de durée des projectiles, orbes et flaques' },
    plume: { label: 'Plume du vent', icon: '🪶', max: 5, add: { shotSpeed: 0.12 }, desc: '+12 % de vitesse des projectiles' },
    oeil: { label: 'Œil de faucon', icon: '👁️', max: 5, add: { critMult: 0.25 }, desc: 'coups critiques +25 % plus forts' },
    bouclier: { label: 'Bouclier runique', icon: '🔰', max: 5, add: { shield: 1 }, desc: 'bloque un coup, puis se recharge (15 s, −2 s par niveau)' },
    bourse: { label: 'Bourse de gemmes', icon: '💰', max: 5, add: { greed: 0.06 }, desc: '+6 % d\'émeraudes en fin de partie' },
    boussole: { label: 'Boussole', icon: '🧭', max: 3, add: { explore: 1 }, desc: 'bénédictions d\'autel +25 % plus longues, autels rechargés 15 % plus vite' },
    cor: { label: 'Cor de guerre', icon: '📯', max: 5, add: { bossDmg: 0.12 }, desc: '+12 % de dégâts contre les élites et les boss' },
    gourde: { label: 'Gourde de soin', icon: '🧪', max: 5, add: { healMult: 0.2 }, desc: '+20 % de soins (régénération, poulet, autels, croc)' },
    talisman: { label: 'Talisman du vent', icon: '🌀', max: 3, add: { knockback: 0.35 }, desc: '+35 % de recul des ennemis touchés' },
    givre: { label: 'Rune de givre', icon: '🧊', max: 5, add: { chill: 0.08 }, desc: 'les ennemis touchés sont ralentis de 8 % pendant 1 s' },
    tome: { label: 'Tome des possibles', icon: '📘', max: 3, add: { rerolls: 1 }, desc: '+1 relance des choix de niveau' },
  };
  // Méta-progression (émeraudes) : améliorations permanentes des stats de départ du Survivor uniquement.
  // Prix du niveau L+1 : arrondi(base × hausse^L), arrondi à la dizaine.
  const SURVIVOR_META = {
    vitalite: { label: 'Vitalité', icon: '❤️', max: 10, add: { maxHp: 10 }, desc: '+10 PV max', base: 120, growth: 1.75 },
    puissance: { label: 'Puissance', icon: '💪', max: 10, add: { damage: 0.05 }, desc: '+5 % de dégâts', base: 150, growth: 1.75 },
    carapace: { label: 'Carapace', icon: '🛡️', max: 5, add: { armor: 1 }, desc: '−1 dégât subi par coup', base: 400, growth: 2.2 },
    hate: { label: 'Hâte', icon: '⏱️', max: 5, add: { cooldown: -0.03 }, desc: '−3 % de recharge', base: 350, growth: 2.1 },
    celerite: { label: 'Célérité', icon: '👟', max: 5, add: { speed: 0.04 }, desc: '+4 % de vitesse', base: 250, growth: 2 },
    envergure: { label: 'Envergure', icon: '💠', max: 5, add: { area: 0.05 }, desc: '+5 % de zone', base: 300, growth: 2 },
    attraction: { label: 'Attraction', icon: '🧲', max: 5, add: { magnet: 0.15 }, desc: '+15 % de rayon de ramassage', base: 150, growth: 1.9 },
    croissance: { label: 'Croissance', icon: '📈', max: 5, add: { xp: 0.05 }, desc: '+5 % d\'expérience', base: 300, growth: 2.1 },
    recuperation: { label: 'Récupération', icon: '🍎', max: 5, add: { regen: 0.15 }, desc: '+0,15 PV par seconde', base: 300, growth: 2.1 },
    fortune: { label: 'Fortune', icon: '🍀', max: 5, add: { crit: 0.02, luck: 5 }, desc: '+2 % de critiques, plus de choix', base: 300, growth: 2.1 },
    avidite: { label: 'Avidité', icon: '💎', max: 5, add: { greed: 0.1 }, desc: '+10 % d\'émeraudes gagnées', base: 600, growth: 2.3 },
    relance: { label: 'Relance', icon: '🎲', max: 3, add: { rerolls: 1 }, desc: '+1 relance des choix par partie', base: 2500, growth: 3 },
    resurrection: { label: 'Seconde vie', icon: '👼', max: 1, add: { revivals: 1 }, desc: 'Une résurrection par partie (50 % de vie)', base: 40000, growth: 1 },
  };
  function survivorMetaCost(id, level) {
    const M = SURVIVOR_META[id];
    if (!M || level >= M.max) return null;
    return Math.round((M.base * Math.pow(M.growth, level)) / 10) * 10;
  }
  // Armes et objets à débloquer (émeraudes). Sans déblocage, ils ne sortent pas dans les choix de montée de niveau.
  // `starter` : prix pour pouvoir commencer la partie avec cette arme (une fois débloquée).
  const SURVIVOR_UNLOCKS = {
    weapons: {
      epee: { price: 0, starter: 0 },
      dagues: { price: 0, starter: 2500 },
      baguette: { price: 0, starter: 4000 },
      aura: { price: 3000, starter: 8000 },
      hache: { price: 6000, starter: 12000 },
      foudre: { price: 10000, starter: 18000 },
      orbes: { price: 15000, starter: 25000 },
      fiole: { price: 22000, starter: 35000 },
      // Armes secrètes : pas de prix, l'objectif les débloque (puis on peut payer pour commencer avec)
      boomerang: { price: null, starter: 20000 },
      faux: { price: null, starter: 20000 },
      etoiles: { price: null, starter: 20000 },
    },
    passives: {
      coeur: 0, bottes: 0, gant: 0, aimant: 0, pomme: 0,
      armure: 1500, trefle: 2500, cristal: 3000, grimoire: 4000, couronne: 5000, duplicateur: 30000,
      talisman: 6000, cape: 7000, gourde: 7500, croc: 8500, epines: 9000, plume: 9500, sablier: 10000, boussole: 11000,
      cor: 13000, oeil: 15000, bouclier: 17000, givre: 19000, bourse: 22000, tome: 26000,
    },
  };
  // Stats d'une partie : base + méta-progression + objets ramassés.
  function survivorStats(meta = {}, passives = {}) {
    const s = { ...SURVIVOR.player };
    const add = (fx, n) => { for (const [k, v] of Object.entries(fx)) s[k] = (s[k] || 0) + v * n; };
    const pct = { speed: 0, magnet: 0 }; // en % de la base
    for (const [id, n] of Object.entries(meta)) {
      const M = SURVIVOR_META[id];
      if (!M || !n) continue;
      for (const [k, v] of Object.entries(M.add)) { if (k in pct) pct[k] += v * n; else s[k] += v * n; }
    }
    for (const [id, n] of Object.entries(passives)) {
      const P = SURVIVOR_PASSIVES[id];
      if (!P || !n) continue;
      for (const [k, v] of Object.entries(P.add)) { if (k in pct) pct[k] += v * n; else add({ [k]: v }, n); }
    }
    s.speed = SURVIVOR.player.speed * (1 + pct.speed);
    s.magnet = SURVIVOR.player.magnet * (1 + pct.magnet);
    s.cooldown = Math.max(0.4, s.cooldown);
    s.dodge = Math.min(0.4, s.dodge);
    return s;
  }
  // Score : temps de survie, monstres et boss tués.
  function survivorScore(r) {
    return Math.floor(r.time) * 10 + (r.kills || 0) + (r.bosses || 0) * 1000;
  }
  // Émeraudes gagnées à la fin d'une partie (avant le bonus d'Avidité).
  function survivorEmeralds(r) {
    const w = Math.max(0, (r.wave || 1) - 1);
    return Math.floor((w * (w + 9)) / 4) + (r.bosses || 0) * 10 + Math.floor((r.kills || 0) / 100);
  }
  // Jour (heure de Paris, « AAAA-MM-JJ ») : la récompense de la vague 30 revient chaque jour.
  function parisDay(ts = Date.now()) {
    try { return new Date(ts).toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' }); } catch (e) { return new Date(ts).toISOString().slice(0, 10); }
  }

  // ---------- Maison (Housing) ----------
  // Chaque joueur a sa maison : une façade à personnaliser et une pièce où il place ses meubles (payés en émeraudes).
  // Le niveau de décoration (points de déco des meubles posés et des options) remplit la boîte aux lettres.
  const HOUSING = {
    sizes: {
      studio: { label: 'Studio', cols: 9, rows: 6, price: 0 },
      maison: { label: 'Maison', cols: 13, rows: 8, price: 12000 },
      manoir: { label: 'Manoir', cols: 17, rows: 10, price: 90000 },
    },
    sizeOrder: ['studio', 'maison', 'manoir'],
    mailLogMax: 30, // ouvertures de la boîte aux lettres gardées dans l'historique
    maxLevel: 20,
    mailbox: { everyH: 6, max: 4 },
    listMax: 40,
  };
  // Meubles : cat, prix (émeraudes), taille en cases (w × h), points de déco ; wall : accroché au mur ; rug : tapis (sous les meubles).
  const FURNITURE_CATS = {
    assises: 'Assises', tables: 'Tables', lits: 'Lits', rangements: 'Rangements', lumieres: 'Lumières', plantes: 'Plantes',
    tapis: 'Tapis', mural: 'Décoration murale', loisirs: 'Loisirs', prestige: 'Prestige',
  };
  const FURNITURE = {
    tabouret: { label: 'Tabouret', cat: 'assises', price: 250, w: 1, h: 1, deco: 1 },
    chaise: { label: 'Chaise en bois', cat: 'assises', price: 450, w: 1, h: 1, deco: 2 },
    pouf: { label: 'Pouf moelleux', cat: 'assises', price: 800, w: 1, h: 1, deco: 3 },
    fauteuil: { label: 'Fauteuil club', cat: 'assises', price: 1800, w: 1, h: 1, deco: 6 },
    canape: { label: 'Canapé', cat: 'assises', price: 4200, w: 2, h: 1, deco: 13 },
    trone: { label: 'Trône royal', cat: 'assises', price: 45000, w: 1, h: 1, deco: 85 },
    table_basse: { label: 'Table basse', cat: 'tables', price: 1000, w: 2, h: 1, deco: 4 },
    table_ronde: { label: 'Guéridon', cat: 'tables', price: 1400, w: 1, h: 1, deco: 5 },
    table: { label: 'Grande table', cat: 'tables', price: 2200, w: 2, h: 1, deco: 8 },
    bureau: { label: 'Bureau d\'aventurier', cat: 'tables', price: 3400, w: 2, h: 1, deco: 11 },
    lit: { label: 'Lit simple', cat: 'lits', price: 3000, w: 1, h: 2, deco: 10 },
    lit_double: { label: 'Lit double', cat: 'lits', price: 7500, w: 2, h: 2, deco: 20 },
    lit_baldaquin: { label: 'Lit à baldaquin', cat: 'lits', price: 24000, w: 2, h: 2, deco: 50 },
    coffre: { label: 'Coffre en bois', cat: 'rangements', price: 1100, w: 1, h: 1, deco: 4 },
    commode: { label: 'Commode', cat: 'rangements', price: 2600, w: 1, h: 1, deco: 9 },
    armoire: { label: 'Armoire', cat: 'rangements', price: 4200, w: 1, h: 1, deco: 13 },
    bibliotheque: { label: 'Bibliothèque', cat: 'rangements', price: 6000, w: 2, h: 1, deco: 17 },
    coffre_or: { label: 'Coffre au trésor', cat: 'rangements', price: 30000, w: 1, h: 1, deco: 60 },
    bougeoir: { label: 'Bougeoir', cat: 'lumieres', price: 400, w: 1, h: 1, deco: 2 },
    lampe: { label: 'Lampe de chevet', cat: 'lumieres', price: 1500, w: 1, h: 1, deco: 5 },
    lampadaire: { label: 'Lampadaire', cat: 'lumieres', price: 2800, w: 1, h: 1, deco: 9 },
    brasero: { label: 'Brasero', cat: 'lumieres', price: 7000, w: 1, h: 1, deco: 18 },
    plante: { label: 'Plante en pot', cat: 'plantes', price: 600, w: 1, h: 1, deco: 2 },
    cactus: { label: 'Cactus', cat: 'plantes', price: 850, w: 1, h: 1, deco: 3 },
    bonsai: { label: 'Bonsaï', cat: 'plantes', price: 3800, w: 1, h: 1, deco: 11 },
    palmier: { label: 'Palmier', cat: 'plantes', price: 8000, w: 1, h: 1, deco: 19 },
    cerisier: { label: 'Cerisier en fleurs', cat: 'plantes', price: 22000, w: 2, h: 2, deco: 45 },
    tapis: { label: 'Tapis', cat: 'tapis', price: 1400, w: 2, h: 1, deco: 4, rug: true },
    tapis_rond: { label: 'Tapis rond', cat: 'tapis', price: 3000, w: 2, h: 2, deco: 9, rug: true },
    tapis_royal: { label: 'Tapis royal', cat: 'tapis', price: 14000, w: 3, h: 2, deco: 30, rug: true },
    tableau: { label: 'Tableau', cat: 'mural', price: 1800, w: 1, h: 1, deco: 6, wall: true },
    etagere: { label: 'Étagère', cat: 'mural', price: 1900, w: 1, h: 1, deco: 6, wall: true },
    horloge: { label: 'Horloge', cat: 'mural', price: 3000, w: 1, h: 1, deco: 9, wall: true },
    banniere: { label: 'Bannière Zer0Loot', cat: 'mural', price: 2800, w: 1, h: 1, deco: 8, wall: true },
    miroir: { label: 'Miroir doré', cat: 'mural', price: 3800, w: 1, h: 1, deco: 11, wall: true },
    cheminee: { label: 'Cheminée', cat: 'mural', price: 11000, w: 2, h: 1, deco: 25, wall: true },
    vitrail: { label: 'Vitrail', cat: 'mural', price: 10000, w: 2, h: 1, deco: 24, wall: true },
    trophee: { label: 'Trophée de dragon', cat: 'mural', price: 18000, w: 1, h: 1, deco: 36, wall: true },
    aquarium: { label: 'Aquarium', cat: 'loisirs', price: 9500, w: 2, h: 1, deco: 22 },
    jukebox: { label: 'Juke-box', cat: 'loisirs', price: 12000, w: 1, h: 1, deco: 26 },
    arcade: { label: 'Borne d\'arcade', cat: 'loisirs', price: 14000, w: 1, h: 1, deco: 28 },
    machine_sous: { label: 'Machine à sous de Pyrax', cat: 'loisirs', price: 19000, w: 1, h: 1, deco: 36 },
    billard: { label: 'Billard', cat: 'loisirs', price: 26000, w: 3, h: 2, deco: 48 },
    piano: { label: 'Piano à queue', cat: 'prestige', price: 40000, w: 2, h: 2, deco: 75 },
    statue_troll: { label: 'Statue de Grokk', cat: 'prestige', price: 35000, w: 1, h: 1, deco: 65 },
    fontaine: { label: 'Fontaine', cat: 'prestige', price: 60000, w: 2, h: 2, deco: 100 },
    statue_dragon: { label: 'Statue dorée de Pyrax', cat: 'prestige', price: 75000, w: 2, h: 2, deco: 120 },
  };
  // Façade et intérieur : options par partie (la première est gratuite) ; deco = points de déco.
  const HOUSE_PARTS = {
    murs: { label: 'Murs', zone: 'ext', options: {
      blanc: { label: 'Crépi blanc', price: 0, color: '#efe9dc' }, creme: { label: 'Crème', price: 900, color: '#f3dfb4' },
      rose: { label: 'Rose bonbon', price: 2500, color: '#f2b6c6' }, bleu: { label: 'Bleu lagon', price: 2500, color: '#a9d4ec' },
      bois: { label: 'Rondins', price: 4500, color: '#a46a3b' }, brique: { label: 'Briques', price: 3500, color: '#b4553c' },
      pierre: { label: 'Pierre', price: 7000, color: '#9a9690' }, marbre: { label: 'Marbre', price: 30000, color: '#f4f2ef' } } },
    toit: { label: 'Toit', zone: 'ext', options: {
      tuiles: { label: 'Tuiles', price: 0, color: '#b8452e' }, ardoise: { label: 'Ardoise', price: 3500, color: '#4a5263' },
      chaume: { label: 'Chaume', price: 3000, color: '#c9a24e' }, vert: { label: 'Tuiles vertes', price: 4000, color: '#3e8a55' },
      cuivre: { label: 'Cuivre', price: 12000, color: '#3fa58f' }, pagode: { label: 'Pagode', price: 22000, color: '#b11e2e' },
      or: { label: 'Toit doré', price: 60000, color: '#e8b923' } } },
    fenetres: { label: 'Fenêtres', zone: 'ext', options: {
      simples: { label: 'Simples', price: 0 }, volets: { label: 'À volets', price: 1800 }, rondes: { label: 'Rondes', price: 4500 },
      fleuries: { label: 'Jardinières', price: 6000 }, vitraux: { label: 'Vitraux', price: 15000 } } },
    porte: { label: 'Porte', zone: 'ext', options: {
      bois: { label: 'Bois', price: 0, color: '#7a4a24' }, rouge: { label: 'Rouge', price: 1500, color: '#b3262e' },
      bleue: { label: 'Bleue', price: 1500, color: '#2f5fa8' }, arche: { label: 'En arche', price: 9000, color: '#5a3416' },
      doree: { label: 'Dorée', price: 35000, color: '#e8b923' } } },
    jardin: { label: 'Jardin', zone: 'ext', options: {
      aucun: { label: 'Pelouse', price: 0 }, fleurs: { label: 'Parterre de fleurs', price: 1800 }, haie: { label: 'Haie taillée', price: 3500 },
      lanternes: { label: 'Lanternes', price: 7000 }, cerisier: { label: 'Cerisier', price: 18000 }, fontaine: { label: 'Fontaine', price: 25000 } } },
    papier: { label: 'Papier peint', zone: 'int', options: {
      beige: { label: 'Beige', price: 0, color: '#e9dcc2' }, rayures: { label: 'Rayures', price: 1400, color: '#d8c3e8' },
      fleurs: { label: 'Fleuri', price: 2800, color: '#f2d7d7' }, bois: { label: 'Lambris', price: 4000, color: '#a67547' },
      pierre: { label: 'Pierre', price: 5500, color: '#9c9890' }, etoiles: { label: 'Nuit étoilée', price: 10000, color: '#26214a' },
      royal: { label: 'Royal', price: 18000, color: '#7a1f3d' } } },
    sol: { label: 'Sol', zone: 'int', options: {
      parquet: { label: 'Parquet', price: 0, color: '#b98a5a' }, carrelage: { label: 'Carrelage', price: 1800, color: '#e6e2da' },
      moquette: { label: 'Moquette', price: 3000, color: '#6a5a9a' }, damier: { label: 'Damier', price: 3500, color: '#f0f0f0' },
      herbe: { label: 'Gazon', price: 5000, color: '#6bb35a' }, marbre: { label: 'Marbre', price: 15000, color: '#efeae4' } } },
  };
  const partDeco = (price) => Math.round(price / 350);
  // Points de déco : meubles posés + options choisies.
  function houseDeco(house) {
    let pts = 0;
    for (const p of (house && house.placed) || []) pts += (FURNITURE[p.id] && FURNITURE[p.id].deco) || 0;
    for (const [part, id] of Object.entries((house && house.style) || {})) {
      const o = HOUSE_PARTS[part] && HOUSE_PARTS[part].options[id];
      if (o) pts += partDeco(o.price);
    }
    pts += { studio: 0, maison: 40, manoir: 160 }[(house && house.size) || 'studio'] || 0;
    return pts;
  }
  // Points nécessaires pour le niveau n : 20 × n^1,7 (arrondi à 5).
  const houseLevelPoints = (n) => (n <= 0 ? 0 : Math.round((20 * Math.pow(n, 1.7)) / 5) * 5);
  function houseLevel(points) {
    let level = 0;
    while (level < HOUSING.maxLevel && points >= houseLevelPoints(level + 1)) level += 1;
    return { level, points, cur: houseLevelPoints(level), next: level < HOUSING.maxLevel ? houseLevelPoints(level + 1) : null };
  }
  // Boîte aux lettres : un courrier toutes les 6 h (4 en attente au plus), contenu selon le niveau de déco.
  function houseMailDue(mailAt, now = Date.now()) {
    return Math.max(0, Math.min(HOUSING.mailbox.max, Math.floor((now - mailAt) / (HOUSING.mailbox.everyH * 3600 * 1000))));
  }
  // Contenu d'un courrier selon le niveau de décoration. chests : coffres en moyenne (partie entière garantie,
  // le reste est une chance) ; keyChance / potionChance : chances d'une Clé de boss / d'une potion.
  function houseMailContent(level) {
    return {
      gold: 180 + 120 * level,
      chests: Math.round(0.12 * level * 100) / 100,
      keyChance: level >= 3 ? Math.min(0.6, Math.round(0.03 * (level - 2) * 100) / 100) : 0,
      emeralds: 6 * level,
      potionChance: 0.5,
    };
  }
  // Disposition valide ? Meubles dans la pièce, sur le mur pour la décoration murale, sans chevauchement
  // (les tapis ont leur propre couche), et pas plus d'exemplaires que possédés. Retourne un message ou null.
  function houseLayoutError(house, placed) {
    const size = HOUSING.sizes[house.size] || HOUSING.sizes.studio;
    const used = {};
    const cells = { floor: new Set(), rug: new Set(), wall: new Set() };
    for (const p of placed) {
      const F = FURNITURE[p && p.id];
      if (!F) return 'Meuble inconnu';
      used[p.id] = (used[p.id] || 0) + 1;
      if (used[p.id] > ((house.owned || {})[p.id] || 0)) return `Tu n'as pas assez de « ${F.label} »`;
      const x = Number(p.x);
      const y = Number(p.y);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x + F.w > size.cols) return `« ${F.label} » dépasse de la pièce`;
      if (F.wall ? y !== -1 : (y < 0 || y + F.h > size.rows)) return F.wall ? `« ${F.label} » s'accroche au mur` : `« ${F.label} » dépasse de la pièce`;
      const layer = F.wall ? cells.wall : F.rug ? cells.rug : cells.floor;
      for (let i = 0; i < F.w; i++) {
        for (let j = 0; j < (F.wall ? 1 : F.h); j++) {
          const k = `${x + i},${y + j}`;
          if (layer.has(k)) return `« ${F.label} » chevauche un autre meuble`;
          layer.add(k);
        }
      }
    }
    return null;
  }

  // ---------- Historique et statistiques ----------
  const HISTORY = { max: 50 }; // parties gardées par personnage (les plus récentes)
  // Types de partie de l'historique : les modes du stream, plus le contenu solo.
  const HISTORY_KINDS = {
    expedition: { label: 'Expédition', icon: '🕳️', color: '#b98cff' },
    challenge: { label: 'Défi des boss', icon: '👹', color: '#ff8fa3' },
    survivor: { label: 'Survivor', icon: '🧟', color: '#7cff4f' },
  };
  // Statistiques cumulées (character.lifetime ; character.stats, ce sont les points de caractéristiques) ; les records (PLAYER_STAT_MAX) gardent le maximum.
  const PLAYER_STAT_KEYS = ['losses', 'deaths', 'damageDealt', 'damageTaken', 'bossDamage', 'hillTime', 'playTime', 'maxKills', 'maxDamage',
    'expeditions', 'expeditionFloors', 'challenges', 'rushBosses', 'dungeonRooms', 'goldShower',
    'goldEarned', 'itemsObtained', 'potionsUsed', 'betGold', 'casinoBets', 'casinoWagered', 'casinoWon', 'casinoBest',
    'survivorRuns', 'survivorKills', 'emeraldsEarned'];
  const PLAYER_STAT_MAX = ['maxKills', 'maxDamage', 'casinoBest'];

  const TRAINING = { maxLevel: 50, maxConcurrent: 20, maxDuration: 150, soloMaxDuration: 600 }; // soloMaxDuration : répétition du mode Solo (s)

  // ---------- Raid de Donjon : ambiance qui change toutes les 5 salles ----------
  const DUNGEON_THEMES = [
    { name: 'Les Cachots', desc: 'Pierres humides et torches.' },
    { name: 'La Crypte oubliée', desc: 'Ossements, toiles d\'araignée et flammes vertes.' },
    { name: 'Les Forges infernales', desc: 'Roche brûlante et coulées de lave.' },
    { name: 'Les Abysses', desc: 'Ténèbres glacées, des yeux brillent dans le noir.' },
    { name: 'Le Néant', desc: 'Il n\'y a plus de murs. Seulement le vide…' },
  ];
  function dungeonTheme(room) {
    return Math.min(DUNGEON_THEMES.length - 1, Math.floor((Math.max(1, room) - 1) / 5));
  }

  // ---------- Apparence (gratuite) ----------
  const APPEARANCE = {
    color: {
      label: 'Couleur',
      options: {
        violet: { label: 'Violet', hex: '#a77bdb' }, rose: { label: 'Rose', hex: '#f08cb4' }, rouge: { label: 'Rouge', hex: '#e8665a' },
        orange: { label: 'Orange', hex: '#f0a050' }, jaune: { label: 'Jaune', hex: '#e8d060' }, vert: { label: 'Vert', hex: '#7ccf6a' },
        menthe: { label: 'Menthe', hex: '#6fd6b4' }, cyan: { label: 'Cyan', hex: '#62c8e0' }, bleu: { label: 'Bleu', hex: '#6c8ee8' },
        peau1: { label: 'Clair', hex: '#f5d3b8' }, peau2: { label: 'Hâlé', hex: '#d9a47a' }, peau3: { label: 'Mat', hex: '#a8714a' },
        peau4: { label: 'Foncé', hex: '#6e4630' }, gris: { label: 'Gris', hex: '#a4a8b4' }, zombie: { label: 'Zombie', hex: '#9cbf7a' },
      },
    },
    eyes: {
      label: 'Yeux',
      options: {
        aucun: { label: 'Invisibles' }, points: { label: 'Points' }, ronds: { label: 'Ronds' }, malicieux: { label: 'Malicieux' }, endormis: { label: 'Endormis' },
        colere: { label: 'En colère' }, etoiles: { label: 'Étoiles' }, croix: { label: 'K.O.' },
      },
    },
    brows: {
      label: 'Sourcils',
      options: { aucun: { label: 'Invisibles' }, droits: { label: 'Droits' }, fronces: { label: 'Froncés' }, inquiets: { label: 'Inquiets' }, epais: { label: 'Épais' } },
    },
    mouth: {
      label: 'Bouche',
      options: {
        aucune: { label: 'Invisible' }, sourire: { label: 'Sourire' }, grand: { label: 'Grand sourire' }, neutre: { label: 'Neutre' },
        surprise: { label: 'Surprise' }, grimace: { label: 'Grimace' }, langue: { label: 'Langue' }, crocs: { label: 'Crocs' },
      },
    },
  };
  const DEFAULT_LOOK = {
    color: null, eyes: 'points', brows: 'aucun', mouth: 'aucune', hat: null, cape: null, shoes: null, aura: null, face: null,
    chest: null, pants: null, gloves: null, belt: null, weapon: null, offhand: null, body: null, drawing: null,
  };

  // ---------- Boutique de cosmétiques (achetés avec des golds, purement visuels) ----------
  /*
   * Un chapeau remplace l'affichage du casque (et un masque celui des yeux couverts) : les stats de
   * l'équipement restent actives, seul le visuel change.
   */
  const COSMETIC_SLOTS = {
    hat: { label: 'Chapeau', plural: 'Chapeaux', icon: '🎩', note: 'Remplace l\'apparence du casque' },
    face: { label: 'Accessoire', plural: 'Accessoires', icon: '🕶️' },
    drawing: { label: 'Visage dessiné', plural: 'Visage dessiné', icon: '🎨', note: 'Remplace les yeux, les sourcils et la bouche' },
    cape: { label: 'Cape', plural: 'Capes', icon: '🧣' },
    chest: { label: 'Plastron', plural: 'Plastrons', icon: '🦺', note: 'Remplace l\'apparence du plastron' },
    pants: { label: 'Pantalon', plural: 'Pantalons', icon: '👖', note: 'Remplace l\'apparence du pantalon' },
    gloves: { label: 'Gants', plural: 'Gants', icon: '🧤', note: 'Remplace l\'apparence des gants' },
    belt: { label: 'Ceinture', plural: 'Ceintures', icon: '🎗️', note: 'Remplace l\'apparence de la ceinture' },
    shoes: { label: 'Chaussures', plural: 'Chaussures', icon: '👢' },
    weapon: { label: 'Arme', plural: 'Armes', icon: '⚔️', note: 'Réservée à une classe' },
    offhand: { label: 'Objet secondaire', plural: 'Objets secondaires', icon: '🛡️', note: 'Réservé à une classe' },
    body: { label: 'Peau', plural: 'Peaux légendaires', icon: '🧌', note: 'Change tout le corps' },
    aura: { label: 'Aura', plural: 'Auras', icon: '✨' },
  };
  /*
   * `cls` : skin réservé à une classe (armes et objets secondaires). `unlock` : cosmétique d'exploit, visible
   * mais verrouillé dans la boutique tant que l'exploit (une métrique de succès) n'est pas accompli ;
   * il se récupère alors gratuitement.
   */
  const COSMETICS = {
    // « Vide » : cache la pièce d'équipement portée (aucun casque, aucun plastron…), sans toucher à ses stats.
    vide_hat: { slot: 'hat', label: 'Vide (aucun casque)', price: 100, empty: true, color: '#8a8a96' },
    vide_chest: { slot: 'chest', label: 'Vide (aucun plastron)', price: 100, empty: true, color: '#8a8a96' },
    vide_pants: { slot: 'pants', label: 'Vide (aucun pantalon)', price: 100, empty: true, color: '#8a8a96' },
    vide_gloves: { slot: 'gloves', label: 'Vide (aucuns gants)', price: 100, empty: true, color: '#8a8a96' },
    vide_belt: { slot: 'belt', label: 'Vide (aucune ceinture)', price: 100, empty: true, color: '#8a8a96' },
    vide_weapon: { slot: 'weapon', label: 'Vide (aucune arme)', price: 100, empty: true, color: '#8a8a96' },
    vide_offhand: { slot: 'offhand', label: 'Vide (aucun objet secondaire)', price: 100, empty: true, color: '#8a8a96' },
    // Chapeaux
    sorcier: { slot: 'hat', label: 'Chapeau de sorcier', price: 300, color: '#5b3fd1' },
    pirate: { slot: 'hat', label: 'Tricorne de pirate', price: 350, color: '#2b2233' },
    haut_de_forme: { slot: 'hat', label: 'Haut-de-forme', price: 400, color: '#1c1a24' },
    viking: { slot: 'hat', label: 'Casque à cornes', price: 450, color: '#9aa0b5' },
    couronne: { slot: 'hat', label: 'Couronne royale', price: 1200, color: '#ffc93a' },
    aureole: { slot: 'hat', label: 'Auréole', price: 900, color: '#fff3a0' },
    chat: { slot: 'hat', label: 'Oreilles de chat', price: 250, color: '#f08cb4' },
    couronne_os: { slot: 'hat', label: 'Couronne d\'os', price: 0, color: '#efe6cf', unlock: { metric: 'dungeonBest', goal: 30, desc: 'Atteindre la salle 30 du Raid de Donjon' } },
    // Capes
    cape_rouge: { slot: 'cape', label: 'Cape écarlate', price: 300, color: '#c8323c' },
    cape_bleue: { slot: 'cape', label: 'Cape azur', price: 300, color: '#2f63c8' },
    cape_noire: { slot: 'cape', label: 'Cape de l\'ombre', price: 450, color: '#1a1622' },
    cape_royale: { slot: 'cape', label: 'Cape royale', price: 800, color: '#7a2fc0', trim: '#ffc93a' },
    cape_guerre: { slot: 'cape', label: 'Étendard des mille batailles', price: 0, color: '#7a1218', trim: '#e8d9a8', unlock: { metric: 'kills', goal: 500, desc: 'Éliminer 500 adversaires' } },
    // Chaussures
    bottes: { slot: 'shoes', label: 'Bottes de cuir', price: 150, color: '#6b4426' },
    baskets: { slot: 'shoes', label: 'Baskets', price: 200, color: '#f2f2f2', trim: '#e8434f' },
    dorees: { slot: 'shoes', label: 'Bottes dorées', price: 600, color: '#ffc93a' },
    flammes: { slot: 'shoes', label: 'Bottes de feu', price: 700, color: '#ff6b2a', trim: '#ffd23f' },
    bottes_legende: { slot: 'shoes', label: 'Bottes de légende', price: 0, color: '#ff9a1f', trim: '#fff3a0', unlock: { metric: 'legendary', goal: 10, desc: 'Obtenir 10 objets légendaires' } },
    // Accessoires de visage
    lunettes: { slot: 'face', label: 'Lunettes de soleil', price: 200, color: '#111' },
    monocle: { slot: 'face', label: 'Monocle', price: 250, color: '#ffc93a' },
    bandeau: { slot: 'face', label: 'Bandeau de pirate', price: 200, color: '#111' },
    moustache: { slot: 'face', label: 'Moustache', price: 150, color: '#4a2e1c' },
    masque: { slot: 'face', label: 'Masque de ninja', price: 350, color: '#22202c' },
    masque_abysses: { slot: 'face', label: 'Masque des abysses', price: 0, color: '#1b2a4a', unlock: { metric: 'expeditionBest', goal: 25, desc: 'Atteindre la profondeur 25 en Expédition (mode Solo)' } },
    // Visage dessiné (le dessin lui-même est dans character.drawing)
    dessin: { slot: 'drawing', label: 'Visage à dessiner', price: 1500, color: '#ffffff' },
    // Plastrons
    plastron_dore: { slot: 'chest', label: 'Armure dorée', price: 700, color: '#e8b830', trim: '#fff0a8' },
    robe_etoilee: { slot: 'chest', label: 'Robe étoilée', price: 500, color: '#2a2f7a', trim: '#ffe68a' },
    tenue_ninja: { slot: 'chest', label: 'Tenue de ninja', price: 450, color: '#23202c', trim: '#c8323c' },
    tunique_foret: { slot: 'chest', label: 'Tunique sylvestre', price: 400, color: '#3f7a3a', trim: '#a8d86a' },
    smoking: { slot: 'chest', label: 'Smoking', price: 600, color: '#15131c', trim: '#f2f2f2' },
    // Pantalons
    kilt: { slot: 'pants', label: 'Kilt écossais', price: 300, color: '#b8323c', trim: '#1f4a2a' },
    jambieres: { slot: 'pants', label: 'Jambières d\'acier', price: 450, color: '#a4a9bb', trim: '#5c6074' },
    pantalon_ninja: { slot: 'pants', label: 'Pantalon de ninja', price: 300, color: '#23202c', trim: '#c8323c' },
    pantalon_smoking: { slot: 'pants', label: 'Pantalon de smoking', price: 450, color: '#15131c', trim: '#3a3550' }, // va avec le Smoking
    // Gants
    gants_dores: { slot: 'gloves', label: 'Gantelets dorés', price: 400, color: '#ffc93a' },
    gants_feu: { slot: 'gloves', label: 'Poings de feu', price: 650, color: '#ff6b2a', trim: '#ffd23f' },
    griffes: { slot: 'gloves', label: 'Griffes', price: 500, color: '#4a3a5a', trim: '#f2f2f2' },
    // Ceintures
    ceinture_champion: { slot: 'belt', label: 'Ceinture de champion', price: 800, color: '#c8323c', trim: '#ffc93a' },
    ceinture_crane: { slot: 'belt', label: 'Ceinture à crâne', price: 400, color: '#2b2233', trim: '#efe6cf' },
    ceinture_cuir: { slot: 'belt', label: 'Ceinture d\'aventurier', price: 200, color: '#7a4a26', trim: '#c9b48a' },
    // Armes (réservées à une classe)
    epee_feu: { slot: 'weapon', cls: 'guerrier', label: 'Lame de feu', price: 900, color: '#ff6b2a', trim: '#ffd23f' },
    hache: { slot: 'weapon', cls: 'guerrier', label: 'Hache de guerre', price: 700, color: '#b8bccb', trim: '#6b4a2b' },
    arc_elfique: { slot: 'weapon', cls: 'archer', label: 'Arc elfique', price: 800, color: '#7fd86a', trim: '#e8f8c8' },
    arc_os: { slot: 'weapon', cls: 'archer', label: 'Arc en os', price: 700, color: '#efe6cf', trim: '#8a2a2a' },
    baton_lune: { slot: 'weapon', cls: 'mage', label: 'Bâton lunaire', price: 850, color: '#b8d8ff', trim: '#7a5cff' },
    baton_crane: { slot: 'weapon', cls: 'mage', label: 'Bâton nécromant', price: 750, color: '#5dff9b', trim: '#efe6cf' },
    katana: { slot: 'weapon', cls: 'assassin', label: 'Katana', price: 850, color: '#e8eef8', trim: '#c8323c' },
    dagues_ombre: { slot: 'weapon', cls: 'assassin', label: 'Crocs de l\'ombre', price: 700, color: '#8a4dff', trim: '#1a1622' },
    masse_soleil: { slot: 'weapon', cls: 'pretre', label: 'Masse solaire', price: 850, color: '#ffd23f', trim: '#fff6c8' },
    marteau: { slot: 'weapon', cls: 'pretre', label: 'Marteau sacré', price: 700, color: '#c9ced8', trim: '#ffc93a' },
    // Objets secondaires (réservés à une classe)
    bouclier_dragon: { slot: 'offhand', cls: 'guerrier', label: 'Bouclier du dragon', price: 700, color: '#c8423a', trim: '#ffc93a' },
    carquois_feu: { slot: 'offhand', cls: 'archer', label: 'Carquois ardent', price: 600, color: '#7a2a18', trim: '#ff6b2a' },
    grimoire_maudit: { slot: 'offhand', cls: 'mage', label: 'Grimoire maudit', price: 600, color: '#2a1a3a', trim: '#5dff9b' },
    dague_poison: { slot: 'offhand', cls: 'assassin', label: 'Dague empoisonnée', price: 600, color: '#5dff9b', trim: '#1a1622' },
    relique_lune: { slot: 'offhand', cls: 'pretre', label: 'Relique lunaire', price: 600, color: '#b8d8ff', trim: '#fff6c8' },
    // Peaux légendaires (exploits uniquement)
    peau_ogre: { slot: 'body', label: 'Peau d\'ogre', price: 0, color: '#7fae4f', unlock: { metric: 'heroTroll', goal: 1, desc: 'Vaincre le Troll en Défi des boss, en Héroïque ou Légendaire' } },
    peau_dragon: { slot: 'body', label: 'Écailles de dragon', price: 0, color: '#c8423a', unlock: { metric: 'heroDragon', goal: 1, desc: 'Vaincre le Dragon en Défi des boss, en Héroïque ou Légendaire' } },
    peau_spectre: { slot: 'body', label: 'Forme spectrale', price: 0, color: '#b8d8ff', unlock: { metric: 'heroSorcier', goal: 1, desc: 'Vaincre le Magicien des ténèbres en Défi des boss, en Héroïque ou Légendaire' } },
    peau_mimic: { slot: 'body', label: 'Gueule de mimic', price: 0, color: '#b9813f', unlock: { metric: 'heroMimic', goal: 1, desc: 'Vaincre le Mimic en Défi des boss, en Héroïque ou Légendaire' } },
    peau_liche: { slot: 'body', label: 'Liche glaciaire', price: 0, color: '#d6ebf3', unlock: { metric: 'heroLiche', goal: 1, desc: 'Vaincre la Liche de glace en Défi des boss, en Héroïque ou Légendaire' } },
    peau_maexxna: { slot: 'body', label: 'Carapace de veuve noire', price: 0, color: '#2a2433', unlock: { metric: 'heroMaexxna', goal: 1, desc: 'Vaincre Maexxna en Défi des boss, en Héroïque ou Légendaire' } },
    peau_ether: { slot: 'body', label: 'Ectoplasme d\'Ether', price: 0, color: '#c9d4ff', unlock: { metric: 'heroEther', goal: 1, desc: 'Vaincre Ether le Fantôme en Défi des boss, en Héroïque ou plus' } },
    peau_lilith: { slot: 'body', label: 'Pelage de Lilith', price: 0, color: '#a8743f', unlock: { metric: 'heroLilith', goal: 1, desc: 'Vaincre Lilith le Chat en Défi des boss, en Héroïque ou plus' } },
    peau_daedra: { slot: 'body', label: 'Peau de succube', price: 0, color: '#c8303e', unlock: { metric: 'heroDaedra', goal: 1, desc: 'Vaincre Daedra la Succube en Défi des boss, en Héroïque ou plus' } },
    // Auras
    aura_feu: { slot: 'aura', label: 'Aura de feu', price: 1000, color: '#ff6b2a' },
    aura_glace: { slot: 'aura', label: 'Aura de glace', price: 1000, color: '#7fd8ff' },
    aura_foudre: { slot: 'aura', label: 'Aura de foudre', price: 1200, color: '#ffe14a' },
    aura_ombre: { slot: 'aura', label: 'Aura de l\'ombre', price: 1200, color: '#8a4dff' },
    aura_arcenciel: { slot: 'aura', label: 'Aura arc-en-ciel', price: 2000, color: '#ff5fd2' },
    aura_champion: { slot: 'aura', label: 'Aura du champion', price: 0, color: '#ffc93a', unlock: { metric: 'wins', goal: 100, desc: 'Gagner 100 parties' } },
    // Légendes : exploits très longs à réussir (legend: true, mis en avant dans la boutique)
    casque_grokk: { slot: 'hat', label: 'Casque du Seigneur Grokk', price: 0, legend: true, color: '#6f8f3a', trim: '#f2e6c4', unlock: { metric: 'legendTroll', goal: 100, desc: 'Vaincre Grokk (Troll) 100 fois en Défi des boss Légendaire' } },
    ailes_pyrax: { slot: 'cape', label: 'Ailes de Pyrax', price: 0, legend: true, color: '#b8322a', trim: '#ffb347', unlock: { metric: 'legendDragon', goal: 100, desc: 'Vaincre Pyrax (Dragon) 100 fois en Défi des boss Légendaire' } },
    aura_malvorath: { slot: 'aura', label: 'Runes de Malvorath', price: 0, legend: true, color: '#9a5cff', unlock: { metric: 'legendSorcier', goal: 100, desc: 'Vaincre Malvorath (Magicien) 100 fois en Défi des boss Légendaire' } },
    pattes_maexxna: { slot: 'cape', label: 'Pattes de Maexxna', price: 0, legend: true, color: '#241e2c', trim: '#c4122f', unlock: { metric: 'legendMaexxna', goal: 100, desc: 'Vaincre Maexxna 100 fois en Défi des boss Légendaire' } },
    armure_grignotor: { slot: 'chest', label: 'Armure-coffre de Grignotor', price: 0, legend: true, color: '#9a6a32', trim: '#ffd34a', unlock: { metric: 'legendMimic', goal: 100, desc: 'Vaincre Grignotor (Mimic) 100 fois en Défi des boss Légendaire' } },
    couronne_givre: { slot: 'hat', label: 'Couronne de Givrenoire', price: 0, legend: true, color: '#bfe8ff', trim: '#5ad8ff', unlock: { metric: 'legendLiche', goal: 100, desc: 'Vaincre Givrenoire (Liche) 100 fois en Défi des boss Légendaire' } },
    aura_ether: { slot: 'aura', label: 'Brume d\'Ether', price: 0, legend: true, color: '#b8c8ff', unlock: { metric: 'legendEther', goal: 100, desc: 'Vaincre Ether (Fantôme) 100 fois en Défi des boss Légendaire ou plus' } },
    sourire_lilith: { slot: 'face', label: 'Sourire de Lilith', price: 0, legend: true, color: '#fff6d8', trim: '#ff5fd2', unlock: { metric: 'legendLilith', goal: 100, desc: 'Vaincre Lilith (Chat) 100 fois en Défi des boss Légendaire ou plus' } },
    ailes_daedra: { slot: 'cape', label: 'Ailes de Daedra', price: 0, legend: true, color: '#2a0a12', trim: '#ff4a2a', unlock: { metric: 'legendDaedra', goal: 100, desc: 'Vaincre Daedra (Succube) 100 fois en Défi des boss Légendaire ou plus' } },
    manteau_abysses: { slot: 'cape', label: 'Manteau des profondeurs', price: 0, legend: true, color: '#0e1a3a', trim: '#5ad8ff', unlock: { metric: 'expeditionBest', goal: 100, desc: 'Atteindre la salle 100 en Expédition (mode Solo)' } },
    aura_immortel: { slot: 'aura', label: 'Aura de l\'immortel', price: 0, legend: true, color: '#5dff9a', unlock: { metric: 'svBestWave', goal: 100, desc: 'Atteindre la vague 100 au Survivor' } },
    aura_or: { slot: 'aura', label: 'Pluie d\'or', price: 0, legend: true, color: '#ffd34a', unlock: { metric: 'goldPeak', goal: 1000000, desc: 'Posséder 1 000 000 de golds en même temps' } },
    aureole_celeste: { slot: 'hat', label: 'Auréole céleste', price: 0, legend: true, color: '#ffe680', trim: '#ffffff', unlock: { metric: 'level', goal: 100, desc: 'Atteindre le niveau 100' } },
    cape_conquerant: { slot: 'cape', label: 'Cape du conquérant', price: 0, legend: true, color: '#4a1a7a', trim: '#ffd34a', unlock: { metric: 'wins', goal: 1000, desc: 'Gagner 1 000 parties' } },
    gants_massacre: { slot: 'gloves', label: 'Gantelets du carnage', price: 0, legend: true, color: '#3a0d10', trim: '#ff3b3b', unlock: { metric: 'kills', goal: 10000, desc: 'Éliminer 10 000 adversaires' } },
    ceinture_tresor: { slot: 'belt', label: 'Ceinture du chasseur de trésors', price: 0, legend: true, color: '#8a5a1e', trim: '#ffd34a', unlock: { metric: 'chests', goal: 5000, desc: 'Ouvrir 5 000 coffres' } },
    lunettes_flambeur: { slot: 'face', label: 'Lunettes du flambeur', price: 0, legend: true, color: '#ffd34a', unlock: { metric: 'jackpots', goal: 25, desc: 'Décrocher 25 jackpots au casino' } },
    chaussons_palais: { slot: 'shoes', label: 'Chaussons du palais', price: 0, legend: true, color: '#7a1f6a', trim: '#ffd34a', unlock: { metric: 'decoLevel', goal: 20, desc: 'Atteindre le niveau de décoration 20 (le maximum) dans sa maison' } },
  };
  // Visage dessiné : grille de pixels (chaque caractère = une couleur de la palette, 0 = transparent).
  const DRAWING = {
    size: 12,
    palette: ['#1a1626', '#ffffff', '#e8434f', '#ffc93a', '#3ddc5a', '#3b8bff', '#f08cb4', '#7a4a26'],
  };
  function cosmeticLocked(character, id) {
    const it = COSMETICS[id];
    return !!(it && it.unlock && achievementValue(character, it.unlock.metric) < it.unlock.goal);
  }

  // ---------- Planification des parties (admin) ----------
  // Créneaux hebdomadaires en heure de Paris : { id, days: [1..7] (1 = lundi), time: 'HH:MM', mode, boss }.
  // À l'heure dite, la file s'ouvre pour SCHEDULE.queueSeconds, puis la partie se lance toute seule.
  const SCHEDULE = { queueSeconds: 300, maxItems: 40, lateMinutes: 15, horizonDays: 7, days: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] };
  const PARIS_DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  // Date et heure de Paris d'un instant : { y, m, d, h, min, dow (1 = lundi) }.
  function parisParts(ts) {
    const parts = {};
    for (const p of new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' }).formatToParts(new Date(ts))) parts[p.type] = p.value;
    return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour % 24, min: +parts.minute, dow: PARIS_DOW[parts.weekday] };
  }
  // Instant (ms) correspondant à une date et une heure de Paris (heure d'été comprise).
  function parisToTs(y, m, d, h, min) {
    const guess = Date.UTC(y, m - 1, d, h, min);
    const off = (ts) => { const p = parisParts(ts); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ts / 60000) * 60000; };
    let ts = guess - off(guess);
    ts = guess - off(ts); // second passage : bon décalage autour des changements d'heure
    return ts;
  }
  function scheduleTimeValid(time) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ''));
  }
  // Prochaines parties planifiées (de `now` - lateMinutes à `now` + horizonDays), triées : [{ id, at, mode, boss, dow, time }].
  function scheduleUpcoming(items, now, days = SCHEDULE.horizonDays) {
    const out = [];
    const today = parisParts(now);
    const base = Date.UTC(today.y, today.m - 1, today.d);
    for (let k = -1; k <= days; k++) {
      const day = new Date(base + k * 86400000);
      const y = day.getUTCFullYear();
      const m = day.getUTCMonth() + 1;
      const d = day.getUTCDate();
      const dow = ((today.dow - 1 + k) % 7 + 7) % 7 + 1;
      for (const it of items || []) {
        if (it.enabled === false || !(it.days || []).includes(dow) || !scheduleTimeValid(it.time)) continue;
        const [h, min] = it.time.split(':').map(Number);
        const at = parisToTs(y, m, d, h, min);
        if (at < now - SCHEDULE.lateMinutes * 60000 || at > now + days * 86400000) continue;
        out.push({ id: it.id, at, mode: it.mode, boss: it.boss || null, dow, time: it.time });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  // ---------- Twitch ----------
  const SUB_REWARD_GOLD = 5000; // par abonnement (sub, resub ou sub offert : au donateur)

  // ---------- Progression ----------
  /*
   * XP pour passer au niveau suivant : 300, 500, 700, 900… (+200 à chaque niveau).
   */
  const XP_BASE = 300;
  const XP_STEP = 200;
  function xpToNext(level) {
    return XP_BASE + XP_STEP * (level - 1);
  }

  // ---------- Combat ----------
  const BASE_ATTACK_COOLDOWN = 1.0; // secondes entre deux attaques
  // Coup critique : 1 % de base, +2 % par point, multiplié par les bonus d'équipement, plafonné.
  const CRIT_BASE = 1;
  const CRIT_PER_POINT = 2;
  const CRIT_CAP = 60;
  const CRIT_MULTIPLIER = 2;

  function emptyStats() {
    return Object.fromEntries(STATS.map((s) => [s, 0]));
  }

  /*
   * Valeurs dérivées à partir des points de stats, des bonus d'équipement (%) et de la classe.
   * Les % (équipement + classe) multiplient la valeur de la stat.
   */
  function derive(points, gearPct, cls) {
    const ci = classInfo(cls);
    const p = Object.assign(emptyStats(), points);
    const g = Object.assign(emptyStats(), gearPct);
    for (const [s, v] of Object.entries(ci.bonus)) g[s] += v;
    const mult = (s) => Math.max(0, 1 + g[s] / 100);
    const flat = ci.flat;

    const maxHp = Math.round((100 + 10 * p.vie) * mult('vie'));
    const damage = Math.round((10 + 2 * p.force) * mult('force') * 10) / 10;
    const armor = (5 + 3 * p.defense) * mult('defense');
    const reduction = armor / (armor + 100);
    const speed = Math.min(220, (60 + 5 * p.vitesse) * mult('vitesse'));
    const dodgeRating = (5 + 3 * p.esquive) * mult('esquive');
    const dodge = Math.min(0.6, dodgeRating / (dodgeRating + 100));
    const crit = Math.min(CRIT_CAP / 100, ((CRIT_BASE + CRIT_PER_POINT * p.critique) * mult('critique')) / 100 + (flat.crit || 0));
    // Vitesse d'attaque : ×1 de base, +5 % par point, plafond ×2,5.
    const attackSpeed = Math.min(2.5, (1 + 0.05 * p.vitesse_attaque) * mult('vitesse_attaque'));
    const cooldown = (BASE_ATTACK_COOLDOWN * (ci.combat.cooldownMult || 1)) / attackSpeed;
    // Vol de vie : 2 % de base, +1,5 % par point, plafond 40 %.
    const lifesteal = Math.min(0.4, ((2 + 1.5 * p.vol_de_vie) * mult('vol_de_vie')) / 100 + (flat.lifesteal || 0));
    // Précision : 5 % de base, +3 % par point → réduit l'esquive adverse d'autant (plafond 80 %).
    const precision = Math.min(0.8, ((5 + 3 * p.precision) * mult('precision')) / 100 + (flat.precision || 0));
    // Épines : 2 % de base, +2 % par point des dégâts reçus renvoyés, plafond 50 %.
    const thorns = Math.min(0.5, ((2 + 2 * p.epines) * mult('epines')) / 100);
    // Chance : les bonus d'équipement s'AJOUTENT aux points (une stat sans valeur de base ne peut pas être multipliée).
    const luck = Math.round((p.chance + g.chance) * 10) / 10;
    // Stamina : la barre se remplit en STAMINA.baseTime[classe] secondes, +5 % de vitesse par point (plafond ×2,5).
    const staminaSpeed = Math.min(STAMINA.cap, (1 + STAMINA.perPoint * p.stamina) * mult('stamina'));
    const staminaTime = Math.round((STAMINA.baseTime[cls] || STAMINA.baseTime.none) / staminaSpeed * 10) / 10;

    return { maxHp, damage, armor, reduction, speed, dodge, crit, attackSpeed, cooldown, lifesteal, precision, thorns, luck, staminaSpeed, staminaTime };
  }

  const pct = (x) => Math.round(x * 1000) / 10 + ' %';

  // Unité d'un bonus d'objet : « % » pour toutes les stats sauf la Chance (bonus en points).
  function statUnit(stat) {
    return stat === 'chance' ? '' : '%';
  }

  // « +8% Vie », « +3 Chance »
  function formatLine(stat, value) {
    return `${value >= 0 ? '+' : ''}${value}${statUnit(stat)} ${STAT_INFO[stat].label}`;
  }

  function describeDerived(stat, d) {
    switch (stat) {
      case 'vie': return d.maxHp + ' PV max';
      case 'force': return d.damage + ' dégâts / coup';
      case 'defense': return '−' + pct(d.reduction) + ' dégâts subis';
      case 'vitesse': return Math.round(d.speed) + ' px/s';
      case 'esquive': return pct(d.dodge) + ' d\'esquive';
      case 'critique': return pct(d.crit) + ' de critiques (×' + CRIT_MULTIPLIER + ')';
      case 'vitesse_attaque': return Math.round((1 / d.cooldown) * 100) / 100 + ' attaque(s) / s';
      case 'vol_de_vie': return pct(d.lifesteal) + ' des dégâts rendus';
      case 'precision': return '−' + pct(d.precision) + ' d\'esquive adverse';
      case 'epines': return pct(d.thorns) + ' des dégâts renvoyés';
      case 'chance': return d.luck + ' chance effective';
      case 'stamina': return 'barre pleine en ' + String(d.staminaTime).replace('.', ',') + ' s';
      default: return '';
    }
  }

  /*
   * Détail d'une caractéristique pour la bulle « ? » de la fiche : effet d'un point et plafond.
   * `key` = valeur dérivée plafonnée (voir derive()), `max` = son plafond ; sans `key`, la stat n'a pas de plafond.
   */
  const STAT_DETAILS = {
    vie: { per: '+10 PV max de base par point', cap: null, note: 'Aucun plafond.' },
    force: { per: '+2 dégâts de base par coup et par point', cap: null, note: 'Aucun plafond.' },
    defense: { per: '+3 d\'armure par point ; réduction = armure / (armure + 100)', cap: null, note: 'Pas de plafond, mais chaque point rapporte un peu moins que le précédent.' },
    vitesse: { per: '+5 px/s par point (60 px/s de base)', key: 'speed', max: 220, cap: '220 px/s' },
    esquive: { per: '+3 d\'indice d\'esquive par point ; esquive = indice / (indice + 100)', key: 'dodge', max: 0.6, cap: '60 % d\'esquive' },
    critique: { per: `+${CRIT_PER_POINT} % de critiques par point (${CRIT_BASE} % de base)`, key: 'crit', max: CRIT_CAP / 100, cap: `${CRIT_CAP} % de critiques` },
    vitesse_attaque: { per: '+5 % d\'attaques par seconde par point', key: 'attackSpeed', max: 2.5, cap: '×2,5 attaques par seconde' },
    vol_de_vie: { per: '+1,5 % de vol de vie par point (2 % de base)', key: 'lifesteal', max: 0.4, cap: '40 % des dégâts rendus' },
    precision: { per: '+3 % de précision par point (5 % de base)', key: 'precision', max: 0.8, cap: '80 % d\'esquive adverse annulée' },
    epines: { per: '+2 % des dégâts renvoyés par point (2 % de base)', key: 'thorns', max: 0.5, cap: '50 % des dégâts renvoyés' },
    chance: { per: '+1 de chance effective par point (les bonus d\'équipement s\'ajoutent en points)', key: 'luck', max: LUCK_CAP, cap: `${LUCK_CAP} de chance effective (table de loot)`,
      note: `À la forge, le bonus de chance est déjà au maximum dès ${FUSE_LUCK_BONUS_CAP / FUSE_LUCK_BONUS} de chance.` },
    stamina: { per: `+${Math.round(STAMINA.perPoint * 100)} % de vitesse de remplissage de la barre par point`, key: 'staminaSpeed', max: STAMINA.cap, cap: `barre ×${String(STAMINA.cap).replace('.', ',')} plus rapide` },
  };

  /*
   * Nombre de points (total : compétences + panoplies + arbre) à partir duquel la stat atteint son plafond,
   * avec l'équipement et la classe donnés. null : pas de plafond, ou plafond inaccessible (multiplicateur nul).
   */
  function statCapAt(stat, points, gearPct, cls) {
    const info = STAT_DETAILS[stat];
    if (!info || !info.key) return null;
    const p = Object.assign(emptyStats(), points);
    const reached = (n) => derive(Object.assign({}, p, { [stat]: n }), gearPct, cls)[info.key] >= info.max - 1e-9;
    let hi = 1;
    while (!reached(hi)) { hi *= 2; if (hi > 4096) return null; }
    let lo = 0;
    if (reached(0)) return 0;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (reached(mid)) hi = mid; else lo = mid; }
    return hi;
  }

  return {
    STAT_DETAILS, statCapAt,
    STATS, STAT_INFO, CLASSES, CLASS_INFO, NO_CLASS, CLASS_CHANGE_PRICE, RARITIES, RARITY_INFO,
    SLOTS, SLOT_INFO, KINDS, KINDS_BY_SLOT, OWN_CLASS_KIND_CHANCE, STAT_SUFFIX, RARITY_PREFIX,
    REWARDS, STREAK_WINDOW, MASSACRE_KILLS, POWER, powerScore, rewardMultiplier, scaleReward, lookGearTotal, STREAK_INFO, CHEST_PRICE, ITEMS_PER_CHEST, RECYCLE_GOLD,
    FUSE_COUNT, FUSE_BATCH_MAX, FUSE_UPGRADE, FUSE_LUCK_BONUS, FUSE_LUCK_BONUS_CAP, FUSE_PITY, FUSE_PRICE, REROLL_PRICE, ALCHEMY, alchemyCap,
    LUCK_CAP, LOOT_BASE, LOOT_AT_CAP, LOOT_PER_LUCK, XP_BASE, XP_STEP, BASE_ATTACK_COOLDOWN,
    CRIT_BASE, CRIT_PER_POINT, CRIT_CAP, CRIT_MULTIPLIER,
    classInfo, chestLightRarity, lootTable, itemWeights, itemClass, canEquip, CLASS_ITEM_BONUS, classBonusOf, itemClassBonus, fuseUpgradeChance,
    xpToNext, emptyStats, derive, describeDerived, statUnit, formatLine,
    SETS, SET_TIERS, SET_DROP_CHANCE, setTiers, setTier, setBonus,
    ACHIEVEMENTS, COUNTERS, MAX_COUNTERS, SOLO_BOSS_COUNTER, BOSS_WIN_COUNTER, HERO_BOSS_COUNTER, LEGEND_BOSS_COUNTER, achievementValue, achievementState, achievementById,
    SCHEDULE, parisParts, parisToTs, scheduleTimeValid, scheduleUpcoming, BATTLE_EVENTS, GAME_MODES, KOTH, CLANS, GOLD, goldPickup, clanUnderdog, clanRespawnDelay, BOSS, BOSSES, BOSS_SCALE, bossLevelScale, bossStats, MONSTERS, ELITES, ELITE, DUNGEON, DUNGEON_TIERS,
    dungeonRoom, dungeonMultipliers, dungeonReward, DUNGEON_POLL, DUNGEON_BOONS, boonFromCommand, SUB_REWARD_GOLD, APPEARANCE,
    CONSUMABLES, CONSUMABLE_TRIGGERS, CONSUMABLE_STACK_MAX, PRESET_MAX, PRESET_NAME_MAX,
    STAMINA, TALENT_EVERY, TALENT_RESET_PRICE, STAT_RESET, statResetPrice, statPointsMoved, talentPoints, ULTS, TALENT_TIERS, TALENT_TREES,
    MIMIC, LICHE, MAEXXNA, ETHER, LILITH, DAEDRA, RUSH, RUSH_BOONS, RUSH_CHOICES, rushChoiceFromCommand, rushScale, rushBoonPool, rushReward, rushDefiReward,
    CASINO, slotsPayout, slotsRtp, rouletteColor, rouletteReturn, rouletteWins, bjValue, glaceMult,
    SURVIVOR, SURVIVOR_ZONES, SURVIVOR_EXPLORE, survivorZoneFx, SURVIVOR_CURSE, SURVIVOR_RING, SURVIVOR_CART, SURVIVOR_DAY, survivorDaylight, survivorZone, survivorZoneNear, survivorWarp, survivorMap, survivorWater, survivorRoad, survivorGround, survivorHash, SURVIVOR_ENEMIES, SURVIVOR_ENEMY_KINDS, SURVIVOR_BOSSES, SURVIVOR_BOSS_ORDER, survivorWallBlock, SURVIVOR_GUARDIAN, SURVIVOR_GUARDIANS, survivorWave, survivorBoss,
    survivorXpToNext, SURVIVOR_WEAPONS, SURVIVOR_WEAPON_MAX, survivorWeaponStats, survivorLevelText, SURVIVOR_PASSIVES, SURVIVOR_META, survivorMetaCost,
    SURVIVOR_UNLOCKS, SURVIVOR_EVOLUTIONS, survivorEvoReady, SURVIVOR_SECRETS, SURVIVOR_CHALLENGES, SURVIVOR_CHALLENGE_REWARD, survivorChallengesOf, survivorMetric, survivorStats, survivorScore, survivorEmeralds, parisDay,
    HOUSING, FURNITURE_CATS, FURNITURE, HOUSE_PARTS, houseDeco, houseLevelPoints, houseLevel, houseMailDue, houseMailContent, houseLayoutError,
    HISTORY, HISTORY_KINDS, PLAYER_STAT_KEYS, PLAYER_STAT_MAX,
    PET, PET_FOODS, PET_FOOD_MAX, PET_ENCLOS, PETS, PET_RANDOM_FINDS, petXpToNext, petEnclosEffects, petSatisfaction, petFindEvery, petAdvance, petFindValue,
    talentNodes, talentBlocker, talentBonus, talentExtraBlocker, TALENT_EXTRA_COST, talentBranch, ultOf, specOf, MARKET, marketTax, SOLO, energyState, EXPEDITION, expeditionRoom, expeditionMultipliers, expeditionReward, RELICS, BOSS_CHALLENGE, BOSS_CHALLENGE_ORDER, challengeRank, BOSS_SOLO_SCALE, BOSS_SOLO_CLASS, SOLO_MODES, COMBAT_AI, TACTICS, DEFAULT_TACTICS, tacticsKiteMax, TECH_SLOTS, TECHNIQUES, techSlots, techBlocker, TRAINING, DUNGEON_THEMES, dungeonTheme, DEFAULT_LOOK, COSMETIC_SLOTS, COSMETICS, DRAWING, cosmeticLocked,
  };
});
