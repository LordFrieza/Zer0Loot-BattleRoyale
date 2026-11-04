/*
 * Configuration et déploiement : variables d'environnement, Dockerfile, fly.toml, convention des tests.
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

test('[DEP-4] Fly.io : Dockerfile, Paris, HTTPS, sonde /healthz, toujours allumé, volume sur /data', () => {
  const toml = read('fly.toml');
  // Valeur d'une clé dans une section donnée du fichier TOML (sans dépendance : simple lecture ligne à ligne).
  const value = (section, key) => {
    let current = null;
    for (const raw of toml.split('\n')) {
      const line = raw.replace(/#.*$/, '').trim();
      const head = /^\[\[?([^\]]+)\]\]?$/.exec(line);
      if (head) { current = head[1]; continue; }
      const kv = /^(\w+)\s*=\s*(.+)$/.exec(line);
      // Guillemets simples ou doubles (Fly réécrit le fichier avec des simples)
      if (kv && current === section && kv[1] === key) return kv[2].replace(/^(["'])(.*)\1$/, '$2');
    }
    return undefined;
  };
  assert.match(toml, /^primary_region = ["']cdg["']/m);
  assert.strictEqual(value('build', 'dockerfile'), 'Dockerfile');
  assert.strictEqual(value('env', 'DATA_DIR'), '/data');
  assert.strictEqual(value('mounts', 'destination'), '/data');
  assert.strictEqual(value('mounts', 'source'), 'zer0loot_data');
  assert.strictEqual(value('http_service', 'internal_port'), '3000');
  assert.strictEqual(value('http_service', 'force_https'), 'true');
  assert.strictEqual(value('http_service', 'auto_stop_machines'), 'off');
  assert.strictEqual(value('http_service', 'auto_start_machines'), 'true', 'une visite rallume la machine si elle s\'est éteinte');
  assert.strictEqual(value('http_service', 'min_machines_running'), '1');
  assert.strictEqual(value('http_service.concurrency', 'type'), 'connections');
  assert.strictEqual(value('http_service.checks', 'path'), '/healthz');
  assert.strictEqual(value('restart', 'policy'), 'always');
  assert.match(read('server', 'index.js'), /app\.get\('\/healthz'/);
  // Le volume se crée et la machine unique se vérifie à la main (voir DEPLOIEMENT.md).
});

test('[NFR-4] convention : tous les tests portent des identifiants connus de la spécification', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'spec-coverage.js'), '--json'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepStrictEqual(report.untagged, [], 'tests sans identifiant');
  assert.deepStrictEqual(report.unknownTags, [], 'identifiants absents de la spécification');
  assert.ok(report.covered > 0);
});
