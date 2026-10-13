/*
 * Règles du jeu partagées entre le serveur (Node) et le navigateur.
 * Toutes les formules d'équilibrage sont ici : stats, raretés, table de loot, récompenses.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STATS = ['vie', 'force', 'defense', 'vitesse', 'esquive', 'chance'];

  const STAT_INFO = {
    vie: { label: 'Vie', icon: '❤️', desc: 'Augmente la vie maximum du personnage.' },
    force: { label: 'Force', icon: '⚔️', desc: 'Augmente les dégâts infligés à chaque coup.' },
    defense: { label: 'Défense', icon: '🛡️', desc: 'Réduit les dégâts subis.' },
    vitesse: { label: 'Vitesse', icon: '💨', desc: 'Augmente la vitesse de déplacement sur le champ de bataille.' },
    esquive: { label: 'Esquive', icon: '🌀', desc: 'Augmente les chances d\'esquiver complètement une attaque.' },
    chance: { label: 'Chance', icon: '🍀', desc: 'Augmente les chances d\'obtenir des raretés supérieures dans les coffres.' },
  };

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

  // Affinité de chaque emplacement pour chaque stat (poids de tirage des lignes).
  const SLOTS = ['casque', 'plastron', 'gants', 'ceinture', 'pantalon', 'boucles', 'epee', 'bouclier'];

  const SLOT_INFO = {
    casque: { label: 'Casque', icon: '⛑️', names: ['Heaume', 'Casque', 'Capuche', 'Couronne'], weights: { vie: 3, defense: 3, esquive: 1, chance: 1, force: 1, vitesse: 1 } },
    plastron: { label: 'Plastron', icon: '🦺', names: ['Plastron', 'Cuirasse', 'Cotte de mailles', 'Brigandine'], weights: { vie: 4, defense: 4, force: 1, vitesse: 1, esquive: 1, chance: 1 } },
    gants: { label: 'Gants', icon: '🧤', names: ['Gantelets', 'Gants', 'Mitaines', 'Poignes'], weights: { force: 4, esquive: 2, vitesse: 1, chance: 1, vie: 1, defense: 1 } },
    ceinture: { label: 'Ceinture', icon: '🎗️', names: ['Ceinture', 'Ceinturon', 'Sangle', 'Écharpe'], weights: { vie: 3, vitesse: 2, defense: 2, force: 1, esquive: 1, chance: 1 } },
    pantalon: { label: 'Pantalon', icon: '👖', names: ['Jambières', 'Pantalon', 'Cuissardes', 'Grègues'], weights: { defense: 3, vitesse: 3, esquive: 2, vie: 1, force: 1, chance: 1 } },
    boucles: { label: 'Boucles d\'oreilles', icon: '💎', names: ['Boucles', 'Anneaux', 'Pendants', 'Clous'], weights: { chance: 5, esquive: 3, vitesse: 1, vie: 1, force: 1, defense: 1 } },
    epee: { label: 'Épée', icon: '🗡️', names: ['Épée', 'Lame', 'Sabre', 'Glaive'], weights: { force: 5, vitesse: 2, chance: 1, esquive: 1, vie: 1, defense: 1 } },
    bouclier: { label: 'Bouclier', icon: '🛡️', names: ['Bouclier', 'Pavois', 'Rondache', 'Égide'], weights: { defense: 5, vie: 3, esquive: 1, force: 1, vitesse: 1, chance: 1 } },
  };

  const STAT_SUFFIX = {
    vie: 'de Vitalité', force: 'du Colosse', defense: 'du Rempart',
    vitesse: 'du Vent', esquive: 'de l\'Ombre', chance: 'du Trèfle',
  };

  const RARITY_PREFIX = {
    commun: '', peu_commun: 'Solide', rare: 'Raffiné', epique: 'Mythique', legendaire: 'Divin',
  };

  // Récompenses
  const REWARDS = {
    kill: { xp: 100, chests: 1, gold: 10 },
    win: { xp: 300, chests: 1, gold: 30 },
  };
  const CHEST_PRICE = 100;
  const ITEMS_PER_CHEST = 3;

  function xpToNext(level) {
    return 100 * level;
  }

  /*
   * Valeurs dérivées à partir des points de stats et des bonus d'équipement (%).
   * Les % d'équipement multiplient la valeur de la stat.
   */
  function derive(points, gearPct) {
    const p = Object.assign({ vie: 0, force: 0, defense: 0, vitesse: 0, esquive: 0, chance: 0 }, points);
    const g = Object.assign({ vie: 0, force: 0, defense: 0, vitesse: 0, esquive: 0, chance: 0 }, gearPct);
    const mult = (s) => 1 + g[s] / 100;

    const maxHp = Math.round((100 + 10 * p.vie) * mult('vie'));
    const damage = Math.round((10 + 2 * p.force) * mult('force') * 10) / 10;
    const armor = (5 + 3 * p.defense) * mult('defense');
    const reduction = armor / (armor + 100);
    const speed = Math.min(220, (60 + 5 * p.vitesse) * mult('vitesse'));
    const dodgeRating = (5 + 3 * p.esquive) * mult('esquive');
    const dodge = Math.min(0.6, dodgeRating / (dodgeRating + 100));
    const luck = Math.round(p.chance * mult('chance') * 10) / 10;

    return { maxHp, damage, armor, reduction, speed, dodge, luck };
  }

  function describeDerived(stat, d) {
    switch (stat) {
      case 'vie': return d.maxHp + ' PV max';
      case 'force': return d.damage + ' dégâts / coup';
      case 'defense': return '−' + Math.round(d.reduction * 1000) / 10 + ' % dégâts subis';
      case 'vitesse': return Math.round(d.speed) + ' px/s';
      case 'esquive': return Math.round(d.dodge * 1000) / 10 + ' % d\'esquive';
      case 'chance': return d.luck + ' chance effective';
      default: return '';
    }
  }

  return {
    STATS, STAT_INFO, RARITIES, RARITY_INFO, SLOTS, SLOT_INFO, STAT_SUFFIX, RARITY_PREFIX,
    REWARDS, CHEST_PRICE, ITEMS_PER_CHEST, LUCK_CAP, LOOT_BASE, LOOT_PER_LUCK,
    chestLightRarity, lootTable, xpToNext, derive, describeDerived,
  };
});
