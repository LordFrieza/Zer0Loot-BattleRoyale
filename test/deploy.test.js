/*
 * Configuration et déploiement : variables d'environnement, Dockerfile, railway.json, convention des tests.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('[DEP-1] configuration : chaque variable d\'environnement de la spécification est lue par le serveur', () => {
  const code = ['index.js', 'twitch.js', 'db.js'].map((f) => read('server', f)).join('\n');
  const vars = ['PORT', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'TWITCH_CHANNEL', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'PUBLIC_URL',
    'TWITCH_BOT_USERNAME', 'TWITCH_BOT_OAUTH', 'ALLOW_DEV_LINK', 'TWITCH_CHAT_DISABLED', 'DATA_DIR', 'NODE_ENV'];
  for (const v of vars) assert.match(code, new RegExp(`process\\.env\\.${v}\\b`), `${v} n'est pas lue`);
});

test('[DEP-3] Dockerfile : Node 22 Alpine, production, /data, sans dépendances de développement', () => {
  const docker = read('Dockerfile');
  assert.match(docker, /^FROM node:22-alpine$/m);
  assert.match(docker, /NODE_ENV=production/);
  assert.match(docker, /DATA_DIR=\/data/);
  assert.match(docker, /npm ci --omit=dev/);
  for (const dir of ['server', 'shared', 'public']) assert.match(docker, new RegExp(`^COPY ${dir} \\./${dir}$`, 'm'));
  assert.doesNotMatch(docker, /COPY test/);
});

test('[DEP-4] Railway : sonde /healthz, redémarrage sur échec, une seule réplique', () => {
  const cfg = JSON.parse(read('railway.json'));
  assert.strictEqual(cfg.build.builder, 'DOCKERFILE');
  assert.strictEqual(cfg.deploy.healthcheckPath, '/healthz');
  assert.strictEqual(cfg.deploy.restartPolicyType, 'ON_FAILURE');
  assert.strictEqual(cfg.deploy.numReplicas, 1);
  // Le volume sur /data se règle dans l'interface Railway : à vérifier à la main (voir DEPLOIEMENT.md).
});

test('[NFR-4] convention : tous les tests portent des identifiants connus de la spécification', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'spec-coverage.js'), '--json'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepStrictEqual(report.untagged, [], 'tests sans identifiant');
  assert.deepStrictEqual(report.unknownTags, [], 'identifiants absents de la spécification');
  assert.ok(report.covered > 0);
});
