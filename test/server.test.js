/*
 * Démarrage du serveur : port, proxy, minuteurs, signaux, et mode production (processus séparé).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { once } = require('events');
const { spawn } = require('child_process');
const { db } = require('./helpers');

const ROOT = path.join(__dirname, '..');

test('[SYS-3, SYS-4, SYS-7, ACC-11, CHAT-2, CHAT-12] start() : port, proxy, nettoyage horaire, état Twitch, signaux', async (t) => {
  process.env.TWITCH_CHAT_DISABLED = '1';
  process.env.ADMIN_PASSWORD = 'test-admin-pass';
  const logs = [];
  t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
  const { app, server, io, start } = require('../server/index');
  assert.strictEqual(app.get('trust proxy'), 1);

  t.mock.timers.enable({ apis: ['setInterval'] }); // les minuteurs de start() sont pilotés à la main
  const emitted = [];
  const realEmit = io.emit.bind(io);
  t.mock.method(io, 'emit', (event, data) => { emitted.push([event, data]); return realEmit(event, data); });
  const sigterm = process.listenerCount('SIGTERM');
  const sigint = process.listenerCount('SIGINT');
  start(0);
  await once(server, 'listening');
  t.after(() => { io.close(); });

  // SYS-3 : toutes les interfaces
  assert.strictEqual(server.address().address, '0.0.0.0');
  assert.ok(server.address().port > 0);

  // CHAT-2 : pas de connexion au chat
  assert.ok(logs.some((l) => l.includes('TWITCH_CHAT_DISABLED=1')));
  assert.strictEqual(require('../server/twitch').status().chatConnected, false);

  // CHAT-12 : diffusion de l'état Twitch toutes les 5 s
  t.mock.timers.tick(4999);
  assert.ok(!emitted.some(([e]) => e === 'twitch'));
  t.mock.timers.tick(1);
  const twitch = emitted.find(([e]) => e === 'twitch');
  assert.ok(twitch, 'événement « twitch » diffusé');
  assert.deepStrictEqual(Object.keys(twitch[1]).sort(), ['botCanSpeak', 'channel', 'chatConnected', 'oauth']);

  // ACC-11 : purge des sessions expirées toutes les heures
  const now = Date.now();
  db.state.sessions.expired = { userId: '1', expires: now - 1000 };
  db.state.sessions.valid = { userId: '1', expires: now + 10 * 3600 * 1000 };
  t.mock.timers.tick(3600 * 1000 - 5000); // 5 s ont déjà été comptées plus haut : on atteint pile 1 h
  assert.strictEqual(db.state.sessions.expired, undefined);
  assert.ok(db.state.sessions.valid);

  // SYS-7 : SIGINT / SIGTERM → écriture immédiate puis arrêt
  assert.strictEqual(process.listenerCount('SIGTERM'), sigterm + 1);
  assert.strictEqual(process.listenerCount('SIGINT'), sigint + 1);
  for (const [signal, count] of [['SIGTERM', sigterm], ['SIGINT', sigint]]) {
    const handler = process.listeners(signal)[count];
    const exit = t.mock.method(process, 'exit', () => {});
    db.state.users['sig-' + signal] = { id: 'sig-' + signal, username: signal };
    db.save(); // écriture différée en attente : le signal doit la forcer
    handler();
    const saved = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'db.json'), 'utf8'));
    assert.ok(saved.users['sig-' + signal], `${signal} : base écrite sur disque`);
    assert.deepStrictEqual(exit.mock.calls.map((c) => c.arguments), [[0]]);
    exit.mock.restore();
  }
  for (const [signal, count] of [['SIGTERM', sigterm], ['SIGINT', sigint]]) process.removeListener(signal, process.listeners(signal)[count]);
});

// Lance le serveur dans un processus à part, en mode production et sans ADMIN_PASSWORD.
function startProduction() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zl-prod-'));
  const env = { ...process.env, NODE_ENV: 'production', DATA_DIR: dir, TWITCH_CHAT_DISABLED: '1' };
  delete env.ADMIN_PASSWORD;
  delete env.ALLOW_DEV_LINK;
  delete env.TWITCH_CLIENT_ID;
  delete env.TWITCH_CLIENT_SECRET;
  const script = `const s = require(${JSON.stringify(path.join(ROOT, 'server', 'index'))});
    s.server.listen(0, '127.0.0.1', () => console.log('LISTEN ' + s.server.address().port));`;
  const child = spawn(process.execPath, ['-e', script], { env, cwd: ROOT });
  let out = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('le serveur de production ne démarre pas : ' + out)), 15000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/LISTEN (\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.on('exit', () => { clearTimeout(timer); reject(new Error('arrêt prématuré : ' + out)); });
  });
  return { child, ready, logs: () => out };
}

test('[ACC-15, DEP-2] production : mot de passe admin aléatoire (jamais « admin »), cookie Secure, pas de liaison par pseudo', async () => {
  const prod = startProduction();
  try {
    const port = await prod.ready;
    const url = (p) => `http://127.0.0.1:${port}${p}`;
    const post = (p, body) => fetch(url(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    const m = prod.logs().match(/mot de passe généré : (\S+)/);
    assert.ok(m, 'mot de passe affiché dans les logs : ' + prod.logs());
    assert.notStrictEqual(m[1], 'admin');
    assert.ok(m[1].length >= 12);
    assert.ok(!/admin\/admin/.test(prod.logs()), 'pas d\'avertissement « admin/admin » en production');

    assert.strictEqual((await post('/api/login', { username: 'admin', password: 'admin' })).status, 400);
    const ok = await post('/api/login', { username: 'admin', password: m[1] });
    assert.strictEqual(ok.status, 200);
    assert.match(ok.headers.getSetCookie()[0], /; Secure/);

    const reg = await post('/api/register', { username: 'prod_user', password: 'secret1' });
    assert.match(reg.headers.getSetCookie()[0], /HttpOnly.*; Secure|Secure.*HttpOnly/);
    const cookie = reg.headers.getSetCookie()[0].split(';')[0];
    const config = await (await fetch(url('/api/config'))).json();
    assert.strictEqual(config.devLink, false);
    const link = await fetch(url('/api/twitch/link-dev'), { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ login: 'someone' }) });
    assert.strictEqual(link.status, 400);
  } finally {
    prod.child.kill();
  }
});
