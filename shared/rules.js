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
      perks: ['Cible l\'ennemi le plus faible', '+10 % Critique', '+25 % Vitesse d\'attaque', 'Récupère presque aussitôt après un coup', '−10 % Vie'],
      weapon: 'dagues', offhand: 'dague',
      bonus: { vie: -10, vitesse_attaque: 25 }, flat: { crit: 0.10 },
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
   * Table de loot (V2 : Épique et Légendaire plus rares, surtout pour les gros chanceux).
   * Chance 0  : 90 / 6,5 / 2,8 / 0,65 / 0,05
   * Chance 10 : 80 / 11,5 / 6,3 / 1,85 / 0,35
   * Chance 85 : 5 / 49 / 32,55 / 10,85 / 2,6
   * Chaque point de chance déplace linéairement les probabilités (−1 % commun,
   * +0,5 % peu commun, +0,35 % rare, +0,12 % épique, +0,03 % légendaire).
   * Plafond à 85 de chance effective pour garder un minimum de communs.
   */
  const LOOT_BASE = [90, 6.5, 2.8, 0.65, 0.05];
  const LOOT_PER_LUCK = [-1, 0.5, 0.35, 0.12, 0.03];
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

  function canEquip(item, cls) {
    const req = itemClass(item);
    return !req || req === cls;
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
  const FUSE_UPGRADE = { commun: 40, peu_commun: 30, rare: 15, epique: 5, legendaire: 0 };
  const FUSE_LUCK_BONUS = 0.5;
  const FUSE_LUCK_BONUS_CAP = 20;
  const FUSE_PRICE = { commun: 10, peu_commun: 20, rare: 40, epique: 80, legendaire: 150 };
  function fuseUpgradeChance(rarity, luck) {
    if (!FUSE_UPGRADE[rarity]) return 0;
    const bonus = Math.min(FUSE_LUCK_BONUS_CAP, (luck || 0) * FUSE_LUCK_BONUS);
    return FUSE_UPGRADE[rarity] + (rarity === 'epique' ? bonus / 2 : bonus);
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
    fortune: { label: 'Fortune', icon: '🍀', of: 'de Fortune', color: '#3ddc5a', stats: ['chance', 'esquive'] },
    ronces: { label: 'Ronces', icon: '🌹', of: 'des Ronces', color: '#b14dff', stats: ['epines', 'vie'] },
  };
  // Paliers : nombre de pièces équipées → points bonus dans CHAQUE stat de la panoplie.
  const SET_TIERS = [{ pieces: 2, points: 2 }, { pieces: 4, points: 4 }, { pieces: 6, points: 7 }, { pieces: 8, points: 10 }];
  // Chance qu'un objet tiré (coffre / forge) appartienne à une panoplie, selon sa rareté.
  const SET_DROP_CHANCE = { commun: 0.05, peu_commun: 0.08, rare: 0.12, epique: 0.18, legendaire: 0.25 };

  function setTier(pieces) {
    let tier = null;
    for (const t of SET_TIERS) if (pieces >= t.pieces) tier = t;
    return tier;
  }

  // Bonus des panoplies pour un équipement : { points: {stat: n}, sets: [{ key, pieces, tier, next }] }
  function setBonus(equipment) {
    const counts = {};
    for (const item of Object.values(equipment || {})) if (item && item.set && SETS[item.set]) counts[item.set] = (counts[item.set] || 0) + 1;
    const points = emptyStats();
    const sets = [];
    for (const [key, pieces] of Object.entries(counts)) {
      const tier = setTier(pieces);
      if (tier) for (const st of SETS[key].stats) points[st] += tier.points;
      sets.push({ key, pieces, tier, next: SET_TIERS.find((t) => t.pieces > pieces) || null });
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
    { id: 'hero1', metric: 'heroWins', goal: 1, name: 'Héroïque', desc: 'Réussir un Défi des boss en Héroïque ou Légendaire', gold: 200 },
    { id: 'legend1', metric: 'legendWins', goal: 1, name: 'Légende vivante', desc: 'Réussir un Défi des boss en Légendaire', gold: 500 },
    { id: 'techs1', metric: 'techs', goal: 1, name: 'Technicien', desc: 'Équiper une technique (onglet Style de combat)', gold: 30 },
  ];
  const COUNTERS = ['chests', 'legendary', 'recycled', 'fused', 'rerolled', 'betsWon', 'firstblood', 'double', 'massacre', 'subs', 'bossWins', 'dungeonBest', 'alchemy', 'soloTroll', 'soloDragon', 'soloSorcier', 'expeditionBest',
    'trollWins', 'dragonWins', 'sorcierWins', 'kothWins', 'clansWins', 'clansMvp', 'goldBest', 'relics', 'challengeWins', 'heroWins',
    'legendWins', 'heroTroll', 'heroDragon', 'heroSorcier', 'techs'];
  // Compteurs de record : la fusion d'un fantôme garde le maximum au lieu d'additionner.
  const MAX_COUNTERS = ['dungeonBest', 'expeditionBest', 'goldBest', 'techs'];
  // Exploit « vaincre ce boss seul » : compteur incrémenté par boss.
  const SOLO_BOSS_COUNTER = { troll: 'soloTroll', dragon: 'soloDragon', sorcier: 'soloSorcier' };
  // Victoires contre chaque boss (Combat de Boss et Défi des boss confondus).
  const BOSS_WIN_COUNTER = { troll: 'trollWins', dragon: 'dragonWins', sorcier: 'sorcierWins' };
  // Défi des boss réussi en Héroïque ou Légendaire : débloque la peau légendaire du boss.
  const HERO_BOSS_COUNTER = { troll: 'heroTroll', dragon: 'heroDragon', sorcier: 'heroSorcier' };

  function achievementValue(character, metric) {
    if (metric === 'battles' || metric === 'kills' || metric === 'wins') return (character.record && character.record[metric]) || 0;
    if (metric === 'level') return character.level || 1;
    if (metric === 'cosmetics') return (character.owned || []).length;
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
      desc: 'Tout le monde s\'allie contre un boss géant (Troll, Dragon ou Magicien des ténèbres). On gagne ensemble… ou on perd ensemble.',
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
    underdog: 1.5, // bonus max (vie et dégâts) de l'équipe la moins nombreuse : √(grande / petite)
    // Ciblage : un cristal « paraît » plus proche ; un ennemi près de notre cristal ou collé à nous passe avant.
    aggro: { crystal: 0.35, defendRadius: 260, defend: 0.5, selfDefense: 90, close: 0.3 },
    reward: { xp: 200, gold: 40, chests: 1 }, // pour chaque humain de l'équipe gagnante
    mvpChests: 1, // + 1 coffre pour le meilleur combattant (le plus de dégâts)
  };
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

  const BOSSES = { troll: BOSS, dragon: DRAGON, sorcier: SORCIER };

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

  // ---------- Raid de Donjon ----------
  const MONSTERS = {
    gobelin: { label: 'Gobelin', icon: '👺', hp: 40, damage: 6, speed: 78, cooldown: 0.95, range: 36, radius: 13, reduction: 0.05, dodge: 0.08, from: 1 },
    slime: { label: 'Slime', icon: '🟢', hp: 80, damage: 6, speed: 42, cooldown: 1.25, range: 34, radius: 15, reduction: 0.2, dodge: 0, from: 1 },
    chauve_souris: { label: 'Chauve-souris', icon: '🦇', hp: 24, damage: 4, speed: 135, cooldown: 0.65, range: 30, radius: 11, reduction: 0, dodge: 0.25, from: 2 },
    squelette: { label: 'Squelette archer', icon: '💀', hp: 42, damage: 7, speed: 55, cooldown: 1.4, range: 210, kite: 100, recovery: 0.6, projectile: 'bone', radius: 13, reduction: 0.1, dodge: 0.05, from: 3 },
  };
  // Toutes les 5 salles, un chef bien plus costaud accompagne les monstres.
  const ELITES = {
    gobelin: 'Roi des gobelins', slime: 'Slime géant', chauve_souris: 'Chauve-souris vampire', squelette: 'Seigneur squelette',
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
  const STAT_RESET = { perPoint: 50, max: 500 };
  function statResetPrice(points) {
    return Math.min(STAT_RESET.max, STAT_RESET.perPoint * points);
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

  // Points de stats donnés par les nœuds appris.
  function talentBonus(cls, owned) {
    const points = emptyStats();
    for (const n of talentNodes(cls)) {
      if ((owned || []).includes(n.id)) for (const [st, v] of Object.entries(n.points)) points[st] += v;
    }
    return points;
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


  // ---------- Mode Solo (V2) ----------
  /*
   * Énergie : 3 au maximum, +1 toutes les 10 h ; une tentative (Expédition ou Défi des boss) coûte 1 énergie.
   * Les parties solo sont simulées à part (comme l'entraînement), sans potion, et ne sont vues que par le joueur.
   */
  const SOLO = {
    energyMax: 3,
    energyEveryMs: 10 * 3600 * 1000,
    maxConcurrent: 30,
    speeds: [1, 2],
    maxDuration: 20 * 60, // garde-fou (s) : au-delà, l'expédition s'arrête avec ses gains
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
  function expeditionReward(floors, mult = 1) {
    const n = Math.max(0, Math.floor(floors || 0));
    if (!n) return null;
    return {
      floors: n,
      xp: Math.round((25 * n + 2 * n * n) * mult),
      gold: Math.round((20 * n + 1.5 * n * n) * mult),
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
  };

  /*
   * Défi des boss : un boss au choix contre le joueur seul, calculé pour son niveau (Rules.bossStats pour 1 joueur),
   * renforcé selon la difficulté. Une victoire compte pour l'exploit « vaincre ce boss seul ».
   */
  // Les boss sont pensés pour un groupe : seul, leur vie et leurs dégâts de base sont réduits (puis la difficulté).
  const BOSS_SOLO_SCALE = { troll: { hp: 0.5, damage: 0.7 }, dragon: { hp: 0.5, damage: 0.75 }, sorcier: { hp: 0.25, damage: 0.4 } };
  const BOSS_CHALLENGE = {
    normal: { label: 'Normal', icon: '⭐', hp: 1, damage: 1, reward: { xp: 300, gold: 250, chests: 1 } },
    heroique: { label: 'Héroïque', icon: '⭐⭐', hp: 2.2, damage: 1.4, reward: { xp: 600, gold: 500, chests: 2 } },
    legendaire: { label: 'Légendaire', icon: '⭐⭐⭐', hp: 4.2, damage: 2, reward: { xp: 1000, gold: 900, chests: 4 } },
  };
  const SOLO_MODES = {
    expedition: { label: 'Expédition', icon: '🕳️', desc: 'Descends le plus profond possible, choisis tes reliques, rapporte le butin.' },
    boss: { label: 'Défi des boss', icon: '👹', desc: 'Affronte seul un boss à ton niveau, en Normal, Héroïque ou Légendaire.' },
  };

  const TRAINING = { maxLevel: 50, maxConcurrent: 20, maxDuration: 150 };

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
        points: { label: 'Points' }, ronds: { label: 'Ronds' }, malicieux: { label: 'Malicieux' }, endormis: { label: 'Endormis' },
        colere: { label: 'En colère' }, etoiles: { label: 'Étoiles' }, croix: { label: 'K.O.' },
      },
    },
    brows: {
      label: 'Sourcils',
      options: { aucun: { label: 'Aucun' }, droits: { label: 'Droits' }, fronces: { label: 'Froncés' }, inquiets: { label: 'Inquiets' }, epais: { label: 'Épais' } },
    },
    mouth: {
      label: 'Bouche',
      options: {
        aucune: { label: 'Aucune' }, sourire: { label: 'Sourire' }, grand: { label: 'Grand sourire' }, neutre: { label: 'Neutre' },
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
    // Auras
    aura_feu: { slot: 'aura', label: 'Aura de feu', price: 1000, color: '#ff6b2a' },
    aura_glace: { slot: 'aura', label: 'Aura de glace', price: 1000, color: '#7fd8ff' },
    aura_foudre: { slot: 'aura', label: 'Aura de foudre', price: 1200, color: '#ffe14a' },
    aura_ombre: { slot: 'aura', label: 'Aura de l\'ombre', price: 1200, color: '#8a4dff' },
    aura_arcenciel: { slot: 'aura', label: 'Aura arc-en-ciel', price: 2000, color: '#ff5fd2' },
    aura_champion: { slot: 'aura', label: 'Aura du champion', price: 0, color: '#ffc93a', unlock: { metric: 'wins', goal: 100, desc: 'Gagner 100 parties' } },
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

  // ---------- Twitch ----------
  const SUB_REWARD_GOLD = 300; // par abonnement (sub, resub ou sub offert : au donateur)

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

  return {
    STATS, STAT_INFO, CLASSES, CLASS_INFO, NO_CLASS, CLASS_CHANGE_PRICE, RARITIES, RARITY_INFO,
    SLOTS, SLOT_INFO, KINDS, KINDS_BY_SLOT, OWN_CLASS_KIND_CHANCE, STAT_SUFFIX, RARITY_PREFIX,
    REWARDS, STREAK_WINDOW, MASSACRE_KILLS, STREAK_INFO, CHEST_PRICE, ITEMS_PER_CHEST, RECYCLE_GOLD,
    FUSE_COUNT, FUSE_UPGRADE, FUSE_LUCK_BONUS, FUSE_LUCK_BONUS_CAP, FUSE_PRICE, REROLL_PRICE, ALCHEMY, alchemyCap,
    LUCK_CAP, LOOT_BASE, LOOT_PER_LUCK, XP_BASE, XP_STEP, BASE_ATTACK_COOLDOWN,
    CRIT_BASE, CRIT_PER_POINT, CRIT_CAP, CRIT_MULTIPLIER,
    classInfo, chestLightRarity, lootTable, itemWeights, itemClass, canEquip, fuseUpgradeChance,
    xpToNext, emptyStats, derive, describeDerived, statUnit, formatLine,
    SETS, SET_TIERS, SET_DROP_CHANCE, setTier, setBonus,
    ACHIEVEMENTS, COUNTERS, MAX_COUNTERS, SOLO_BOSS_COUNTER, BOSS_WIN_COUNTER, HERO_BOSS_COUNTER, achievementValue, achievementState, achievementById,
    BATTLE_EVENTS, GAME_MODES, KOTH, CLANS, GOLD, goldPickup, clanUnderdog, clanRespawnDelay, BOSS, BOSSES, BOSS_SCALE, bossLevelScale, bossStats, MONSTERS, ELITES, ELITE, DUNGEON, DUNGEON_TIERS,
    dungeonRoom, dungeonMultipliers, dungeonReward, DUNGEON_POLL, DUNGEON_BOONS, boonFromCommand, SUB_REWARD_GOLD, APPEARANCE,
    CONSUMABLES, CONSUMABLE_TRIGGERS, CONSUMABLE_STACK_MAX, PRESET_MAX, PRESET_NAME_MAX,
    STAMINA, TALENT_EVERY, TALENT_RESET_PRICE, STAT_RESET, statResetPrice, talentPoints, ULTS, TALENT_TIERS, TALENT_TREES,
    talentNodes, talentBlocker, talentBonus, talentBranch, ultOf, specOf, SOLO, energyState, EXPEDITION, expeditionRoom, expeditionMultipliers, expeditionReward, RELICS, BOSS_CHALLENGE, BOSS_SOLO_SCALE, SOLO_MODES, COMBAT_AI, TACTICS, DEFAULT_TACTICS, tacticsKiteMax, TECH_SLOTS, TECHNIQUES, techSlots, techBlocker, TRAINING, DUNGEON_THEMES, dungeonTheme, DEFAULT_LOOK, COSMETIC_SLOTS, COSMETICS, DRAWING, cosmeticLocked,
  };
});
