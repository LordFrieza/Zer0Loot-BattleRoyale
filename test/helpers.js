/*
 * Utilitaires communs aux tests. À importer EN PREMIER : il isole la base dans un dossier temporaire
 * (DATA_DIR) avant que `server/db.js` ne soit chargé.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zl-test-'));

const Rules = require('../shared/rules');
const game = require('../server/game');
const db = require('../server/db');
const { Battle } = require('../server/battle');

// Bataille prête à l'emploi, boucle de simulation arrêtée : les tests appellent attack() / tick() à la main.
function testBattle(fighters) {
  const b = new Battle();
  b.openQueue(60);
  clearTimeout(b.queueTimer);
  for (const f of fighters) b.join(Object.assign({ level: 1, look: {} }, f));
  b.start();
  b.stopLoop();
  return b;
}

// Stats dérivées neutres pour un combattant de test.
const base = (o = {}) => Object.assign({ maxHp: 1000, damage: 100, reduction: 0, speed: 0, dodge: 0, crit: 0, cooldown: 1, lifesteal: 0, precision: 0, thorns: 0 }, o);

module.exports = { Rules, game, db, Battle, testBattle, base };
