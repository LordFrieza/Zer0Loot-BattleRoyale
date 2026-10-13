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
    'vitesse_attaque', 'vol_de_vie', 'precision', 'epines', 'chance',
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
      label: 'Guerrier', icon: '⚔️', color: '#ff6b4a',
      desc: 'Robuste combattant au corps à corps. Il attire l\'attention des ennemis sur lui.',
      perks: ['+30 % Vie', '+25 % Défense', 'Attire l\'aggro des ennemis proches'],
      weapon: 'epee', offhand: 'bouclier',
      bonus: { vie: 30, defense: 25 }, flat: {},
      combat: { range: 40, taunt: 0.7 },
    },
    archer: {
      label: 'Archer', icon: '🏹', color: '#3ddc5a',
      desc: 'Tire de loin et recule quand un ennemi s\'approche trop près.',
      perks: ['Attaque à distance', 'Recule face aux ennemis proches', '+15 % Précision', '−10 % Vie', '−15 % Dégâts'],
      weapon: 'arc', offhand: 'carquois',
      bonus: { vie: -10, force: -15 }, flat: { precision: 0.15 },
      combat: { range: 230, kite: 110, projectile: 'arrow' },
    },
    mage: {
      label: 'Mage', icon: '🔮', color: '#b14dff',
      desc: 'Lance des boules de feu qui explosent et touchent aussi les ennemis autour de la cible.',
      perks: ['Attaque à distance', 'Explosion : 60 % des dégâts autour de la cible', '+25 % Dégâts', '−15 % Vie', 'Attaque 35 % plus lente'],
      weapon: 'baton', offhand: 'grimoire',
      bonus: { vie: -15, force: 25 }, flat: {},
      combat: { range: 170, projectile: 'fire', aoeRadius: 75, aoeRatio: 0.6, cooldownMult: 1.35 },
    },
    assassin: {
      label: 'Assassin', icon: '🗡️', color: '#ffd23f',
      desc: 'Rapide et mortel : il traque l\'ennemi le plus affaibli du champ de bataille.',
      perks: ['Cible l\'ennemi le plus faible', '+10 % Critique', '+25 % Vitesse d\'attaque', '−15 % Vie'],
      weapon: 'dagues', offhand: 'dague',
      bonus: { vie: -15, vitesse_attaque: 25 }, flat: { crit: 0.10 },
      combat: { range: 36, hunter: true },
    },
    pretre: {
      label: 'Prêtre', icon: '✨', color: '#5fd3ff',
      desc: 'Combattant béni qui régénère sa vie tout au long du combat.',
      perks: ['Régénère 1,5 % de sa vie par seconde', '+10 % Vie', '+10 % Défense', '−10 % Dégâts'],
      weapon: 'masse', offhand: 'relique',
      bonus: { vie: 10, defense: 10, force: -10 }, flat: {},
      combat: { range: 40, regen: 0.015 },
    },
  };
  // Personnage sans classe (viewer qui a tapé !join sans compte) : combattant neutre.
  const NO_CLASS = { label: 'Vagabond', icon: '🧳', bonus: {}, flat: {}, combat: { range: 40 } };

  function classInfo(cls) {
    return CLASS_INFO[cls] || NO_CLASS;
  }

  // ---------- Raretés & loot ----------
  const RARITIES = ['commun', 'peu_commun', 'rare', 'epique', 'legendaire'];

  const RARITY_INFO = {
    commun: { label: 'Commun', color: '#e8e8e8', lines: 1, min: 1, max: 3, clicks: 3 },
    peu_commun: { label: 'Peu commun', color: '#3ddc5a', lines: 2, min: 4, max: 6, clicks: 5 },
    rare: { label: 'Rare', color: '#3b8bff', lines: 3, min: 7, max: 10, clicks: 10 },
    epique: { label: 'Épique', color: '#b14dff', lines: 4, min: 11, max: 15, clicks: 20 },
    legendaire: { label: 'Légendaire', color: '#ff9a1f', lines: 5, min: 15, max: 25, clicks: 30 },
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
   * Table de loot.
   * Chance 0  : 90 / 6 / 3 / 0.9 / 0.1
   * Chance 10 : 80 / 10 / 6 / 3 / 1
   * Chaque point de chance déplace linéairement les probabilités (−1 % commun,
   * +0.4 % peu commun, +0.3 % rare, +0.21 % épique, +0.09 % légendaire).
   * Plafond à 85 de chance effective pour garder un minimum de communs.
   */
  const LOOT_BASE = [90, 6, 3, 0.9, 0.1];
  const LOOT_PER_LUCK = [-1, 0.4, 0.3, 0.21, 0.09];
  const LUCK_CAP = 85;

  function lootTable(luck) {
    const l = Math.max(0, Math.min(LUCK_CAP, luck || 0));
    const table = {};
    RARITIES.forEach((r, i) => {
      table[r] = Math.round((LOOT_BASE[i] + LOOT_PER_LUCK[i] * l) * 100) / 100;
    });
    return table;
  }

  // ---------- Équipement ----------
  // Poids de tirage des lignes de stats : 1 par défaut, plus pour les stats « de prédilection ».
  const w = (favored) => Object.assign(Object.fromEntries(STATS.map((s) => [s, 1])), favored);

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

  function canEquip(item, cls) {
    const req = itemClass(item);
    return !req || req === cls;
  }

  const STAT_SUFFIX = {
    vie: 'de Vitalité', force: 'du Colosse', defense: 'du Rempart', vitesse: 'du Vent', esquive: 'de l\'Ombre',
    critique: 'du Bourreau', vitesse_attaque: 'de la Tempête', vol_de_vie: 'du Vampire', precision: 'du Faucon',
    epines: 'du Hérisson', chance: 'du Trèfle',
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
   * Fusion : 3 objets de même rareté → 1 nouvel objet pour ta classe.
   * Chance de monter d'une rareté : FUSE_UPGRADE[rareté] + 0,5 % par point de chance effective (bonus max +25 %).
   * Sinon : un nouvel objet de même rareté. 3 légendaires → un nouveau légendaire.
   */
  const FUSE_COUNT = 3;
  const FUSE_UPGRADE = { commun: 40, peu_commun: 30, rare: 20, epique: 10, legendaire: 0 };
  const FUSE_LUCK_BONUS = 0.5;
  const FUSE_LUCK_BONUS_CAP = 25;
  function fuseUpgradeChance(rarity, luck) {
    if (!FUSE_UPGRADE[rarity]) return 0;
    return FUSE_UPGRADE[rarity] + Math.min(FUSE_LUCK_BONUS_CAP, (luck || 0) * FUSE_LUCK_BONUS);
  }
  // Relance d'une ligne : prix en golds selon la rareté de l'objet.
  const REROLL_PRICE = { commun: 10, peu_commun: 20, rare: 40, epique: 80, legendaire: 150 };

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
    const lifesteal = Math.min(0.4, ((2 + 1.5 * p.vol_de_vie) * mult('vol_de_vie')) / 100);
    // Précision : 5 % de base, +3 % par point → réduit l'esquive adverse d'autant (plafond 80 %).
    const precision = Math.min(0.8, ((5 + 3 * p.precision) * mult('precision')) / 100 + (flat.precision || 0));
    // Épines : 2 % de base, +2 % par point des dégâts reçus renvoyés, plafond 50 %.
    const thorns = Math.min(0.5, ((2 + 2 * p.epines) * mult('epines')) / 100);
    const luck = Math.round(p.chance * mult('chance') * 10) / 10;

    return { maxHp, damage, armor, reduction, speed, dodge, crit, attackSpeed, cooldown, lifesteal, precision, thorns, luck };
  }

  const pct = (x) => Math.round(x * 1000) / 10 + ' %';

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
      default: return '';
    }
  }

  return {
    STATS, STAT_INFO, CLASSES, CLASS_INFO, NO_CLASS, CLASS_CHANGE_PRICE, RARITIES, RARITY_INFO,
    SLOTS, SLOT_INFO, KINDS, KINDS_BY_SLOT, OWN_CLASS_KIND_CHANCE, STAT_SUFFIX, RARITY_PREFIX,
    REWARDS, STREAK_WINDOW, MASSACRE_KILLS, STREAK_INFO, CHEST_PRICE, ITEMS_PER_CHEST, RECYCLE_GOLD,
    FUSE_COUNT, FUSE_UPGRADE, FUSE_LUCK_BONUS, FUSE_LUCK_BONUS_CAP, REROLL_PRICE,
    LUCK_CAP, LOOT_BASE, LOOT_PER_LUCK, XP_BASE, XP_STEP, BASE_ATTACK_COOLDOWN,
    CRIT_BASE, CRIT_PER_POINT, CRIT_CAP, CRIT_MULTIPLIER,
    classInfo, chestLightRarity, lootTable, itemWeights, itemClass, canEquip, fuseUpgradeChance,
    xpToNext, emptyStats, derive, describeDerived,
  };
});
