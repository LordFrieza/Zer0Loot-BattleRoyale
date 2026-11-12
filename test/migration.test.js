/*
 * Migration V1 → V2 : le vrai serveur démarre sur une sauvegarde de la V1 (test/fixtures/db-v1.json)
 * dans un processus à part, et aucune progression ne doit être perdue.
 */
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Rules = require('../shared/rules');

const FIXTURE = path.join(__dirname, 'fixtures', 'db-v1.json');

// Démarre le serveur (chargement + upgrade de chaque personnage), puis renvoie la base réécrite sur le disque.
function migrate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zl-migr-'));
  fs.copyFileSync(FIXTURE, path.join(dir, 'db.json'));
  const script = `
    const { } = require(${JSON.stringify(path.join(__dirname, '..', 'server', 'index'))});
    const db = require(${JSON.stringify(path.join(__dirname, '..', 'server', 'db'))});
    const game = require(${JSON.stringify(path.join(__dirname, '..', 'server', 'game'))});
    for (const u of Object.values(db.state.users)) if (u.character) game.publicCharacter(u);
    db.flush();
    process.exit(0);
  `;
  execFileSync(process.execPath, ['-e', script], { env: { ...process.env, DATA_DIR: dir, ADMIN_PASSWORD: 'migration-test' }, stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
}

test('[DB-8] migration V1 → V2 : toute la progression est conservée, les nouveaux champs sont ajoutés', () => {
  const before = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const after = migrate();
  const KEEP = ['level', 'xp', 'skillPoints', 'cls', 'stats', 'gold', 'chests', 'inventory', 'equipment', 'record', 'lootStats',
    'claimed', 'title', 'owned', 'consumables', 'consumableSlot', 'presets', 'talents'];
  for (const [id, old] of Object.entries(before.users)) {
    const u = after.users[id];
    assert.ok(u, `${old.username} existe toujours`);
    assert.strictEqual(u.username, old.username);
    assert.strictEqual(u.passwordHash, old.passwordHash, 'le mot de passe marche toujours');
    assert.strictEqual(!!u.ghost, !!old.ghost);
    assert.strictEqual(u.twitchLogin, old.twitchLogin);
    const c = u.character;
    const o = old.character;
    for (const k of KEEP) assert.deepStrictEqual(c[k], o[k], `${old.username} : ${k} inchangé`);
    for (const [k, v] of Object.entries(o.counters)) assert.strictEqual(c.counters[k], v, `${old.username} : compteur ${k}`);
    for (const [k, v] of Object.entries(o.look)) assert.strictEqual(c.look[k], v, `${old.username} : apparence ${k}`);
    // Nouveaux champs V2
    assert.deepStrictEqual(c.tactics, Rules.DEFAULT_TACTICS);
    assert.deepStrictEqual(c.techs, []);
    assert.deepStrictEqual([c.drawing, c.drawingVer, c.soloActive], ['', 0, null]);
    assert.deepStrictEqual([c.mail, c.marketLog], [[], []], 'courrier et historique du marché vides');
    assert.strictEqual(c.energy.value, Rules.SOLO.energyMax);
    for (const k of ['alchemy', 'soloTroll', 'soloDragon', 'soloSorcier', 'expeditionBest']) assert.strictEqual(c.counters[k], 0);
    for (const k of ['chest', 'pants', 'gloves', 'belt', 'weapon', 'offhand', 'body', 'drawing']) assert.strictEqual(c.look[k], null);
  }
  // Seul ajout possible : le compte admin créé au démarrage (la sauvegarde n'en contient pas)
  const added = Object.values(after.users).filter((u) => !before.users[u.id]);
  assert.ok(added.every((u) => u.role === 'admin'));
  // La fixture couvre bien des joueurs avancés (sinon le test ne prouverait rien)
  const alpha = Object.values(after.users).find((u) => u.username === 'Alpha').character;
  assert.ok(alpha.level >= 15 && alpha.inventory.length > 0 && Object.keys(alpha.equipment).length > 0 && alpha.talents.length > 0);
});
