/*
 * Intégration Twitch sans réseau : tmi.js est remplacé par un faux client, et les appels HTTP vers Twitch (OAuth) sont simulés.
 */
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { Rules, db } = require('./helpers');

const BOT_ENV = { TWITCH_BOT_USERNAME: 'zlbot', TWITCH_BOT_OAUTH: 'abc123' };
const ENV_KEYS = ['TWITCH_CHANNEL', 'TWITCH_BOT_USERNAME', 'TWITCH_BOT_OAUTH', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'PUBLIC_URL', 'ALLOW_DEV_LINK', 'NODE_ENV'];
for (const k of ENV_KEYS) delete process.env[k];
delete process.env.TWITCH_CHAT_DISABLED;
process.env.ADMIN_PASSWORD = 'test-admin-pass';

// Faux client tmi.js
const clients = [];
class FakeClient extends EventEmitter {
  constructor(opts) { super(); this.opts = opts; this.said = []; clients.push(this); }
  connect() { queueMicrotask(() => this.emit('connected')); return Promise.resolve(); }
  say(channel, message) { this.said.push([channel, message]); return Promise.resolve(); }
}
const tmiPath = require.resolve('tmi.js');
require.cache[tmiPath] = { id: tmiPath, filename: tmiPath, loaded: true, exports: { Client: FakeClient } };

// Copie neuve de server/twitch.js avec un environnement donné (le module lit l'environnement à l'import).
function freshTwitch(env = {}) {
  const file = require.resolve('../server/twitch');
  const saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  delete require.cache[file];
  const twitch = require('../server/twitch');
  delete require.cache[file];
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  return twitch;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('[CHAT-1, CHAT-3] chat : canal par défaut, connexion sécurisée, anonyme ; commandes transmises en minuscules', async () => {
  const twitch = freshTwitch();
  const commands = [];
  twitch.startChat((command, from) => commands.push([command, from]));
  const client = clients.at(-1);
  assert.deepStrictEqual(client.opts.channels, ['zer0loot']);
  assert.strictEqual(twitch.CHANNEL, 'zer0loot');
  assert.deepStrictEqual(client.opts.connection, { reconnect: true, secure: true });
  assert.strictEqual(client.opts.identity, undefined, 'anonyme par défaut');

  client.emit('message', '#zer0loot', { username: 'viewer', 'display-name': 'Viewer', 'user-id': '12' }, '  !JOIN  maintenant ', false);
  client.emit('message', '#zer0loot', { username: 'viewer', 'display-name': 'Viewer', 'user-id': '12' }, 'bonjour !join', false);
  client.emit('message', '#zer0loot', { username: 'bot', 'display-name': 'Bot' }, '!join', true);
  client.emit('message', '#zer0loot', { username: 'nodisplay' }, '!Other', false);
  assert.deepStrictEqual(commands, [
    ['!join', { login: 'viewer', displayName: 'Viewer', id: '12' }],
    ['!other', { login: 'nodisplay', displayName: 'nodisplay', id: undefined }],
  ]);

  // Autre chaîne via TWITCH_CHANNEL
  const other = freshTwitch({ TWITCH_CHANNEL: 'MaChaine' });
  other.startChat(() => {});
  assert.deepStrictEqual(clients.at(-1).opts.channels, ['machaine']);
});

test('[CHAT-7] bot : identité avec TWITCH_BOT_USERNAME et TWITCH_BOT_OAUTH, écriture seulement si le jeton est défini et le chat connecté', async () => {
  const quiet = freshTwitch();
  quiet.startChat(() => {});
  const anon = clients.at(-1);
  await tick();
  quiet.say('ignoré');
  assert.deepStrictEqual(anon.said, [], 'sans bot : say() ne fait rien');
  assert.strictEqual(quiet.status().botCanSpeak, false);

  const bot = freshTwitch(BOT_ENV);
  bot.startChat(() => {});
  const client = clients.at(-1);
  assert.deepStrictEqual(client.opts.identity, { username: 'zlbot', password: 'oauth:abc123' });
  assert.strictEqual(bot.status().botCanSpeak, false, 'pas avant la connexion');
  await tick();
  bot.say('bonjour');
  assert.deepStrictEqual(client.said, [['zer0loot', 'bonjour']]);
  assert.strictEqual(bot.status().botCanSpeak, true);
  assert.strictEqual(bot.status().chatConnected, true);
});

// ---------- Serveur complet avec bot et OAuth ----------

test('[CHAT-5, CHAT-8, CHAT-9, TWL-1, TWL-2, TWL-3, TWL-4, TWL-5] serveur : annonces du bot, !join et liaison OAuth', async (t) => {
  Object.assign(process.env, BOT_ENV, { TWITCH_CLIENT_ID: 'cid', TWITCH_CLIENT_SECRET: 'csecret', ALLOW_DEV_LINK: '1' });
  const { server, io, battle, start } = require('../server/index');
  t.mock.timers.enable({ apis: ['setInterval'] });
  start(0);
  await new Promise((resolve) => server.listening ? resolve() : server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(() => { battle.reset(); io.close(); });
  await tick();
  const bot = clients.at(-1);
  assert.deepStrictEqual(bot.opts.identity, { username: 'zlbot', password: 'oauth:abc123' });
  const said = () => bot.said.map((s) => s[1]);

  function client() {
    let cookie = '';
    return {
      async call(method, url, body) {
        const headers = { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) };
        const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
        const set = res.headers.getSetCookie();
        if (set.length) cookie = set[0].split(';')[0];
        return { status: res.status, data: await res.json().catch(() => ({})), location: res.headers.get('location') };
      },
    };
  }
  const admin = client();
  const post = (url, body = {}) => admin.call('POST', url, body);
  await post('/api/login', { username: 'admin', password: 'test-admin-pass' });
  const chat = (login, display, text = '!join') => bot.emit('message', '#zer0loot', { username: login, 'display-name': display, 'user-id': login }, text, false);

  // CHAT-5 : file fermée → !join ignoré, sans réponse ni compte fantôme
  chat('early_bird', 'Early_Bird');
  assert.deepStrictEqual(said(), []);
  assert.strictEqual(db.findUserByTwitch('early_bird'), null);

  // CHAT-9 : ouverture de la file annoncée avec sa durée
  await post('/api/admin/queue/open', { seconds: 90 });
  assert.deepStrictEqual(said(), ['⚔️ La file du Battle Royale est ouverte pour 1.5 min ! Tapez !join pour participer.']);

  // CHAT-8 : confirmation, avec l'invitation à créer un compte pour un fantôme
  chat('ghost_a', 'Ghost_A');
  assert.strictEqual(said().at(-1), '@Ghost_A rejoint la bataille ⚔️ Crée ton compte sur le site et lie ton Twitch pour garder ton loot !');
  chat('ghost_a', 'Ghost_A');
  assert.strictEqual(said().length, 2, 'doublon : pas de réponse');
  chat('ghost_b', 'Ghost_B');
  const real = client();
  const reg = await real.call('POST', '/api/register', { username: 'real_viewer', password: 'secret1' });
  assert.strictEqual((await real.call('POST', '/api/twitch/link-dev', { login: 'Real_Viewer' })).status, 200);
  chat('real_viewer', 'Real_Viewer');
  assert.strictEqual(said().at(-1), '@Real_Viewer rejoint la bataille ⚔️', 'pas d\'invitation pour un compte réel');
  chat('ghost_a', 'Ghost_A', 'bonjour');
  assert.strictEqual(said().length, 4, 'ce n\'est pas une commande');

  // CHAT-9 : lancement (sans, puis avec événement)
  const ghostA = db.findUserByTwitch('ghost_a');
  const ghostB = db.findUserByTwitch('ghost_b');
  const bettorA = client();
  const bettorB = client();
  for (const [c, name, target, amount] of [[bettorA, 'bettor_a', ghostA, 50], [bettorB, 'bettor_b', ghostB, 30]]) {
    const r = await c.call('POST', '/api/register', { username: name, password: 'secret1' });
    await post(`/api/admin/players/${r.data.me.id}/give`, { gold: 100 });
    assert.strictEqual((await c.call('POST', '/api/bet', { target: 'u' + target.id, amount })).status, 200);
  }
  await post('/api/admin/event', { event: 'fog' });
  await post('/api/admin/battle/start');
  battle.stopLoop();
  assert.strictEqual(said().at(-1), `🔥 Que le combat commence ! Événement : ${Rules.BATTLE_EVENTS.fog.icon} Brouillard !`);

  // Fin : le vainqueur et ses kills, puis la cagnotte redistribuée
  const winner = battle.fighters.find((f) => f.userId === ghostA.id);
  battle.kill(winner, battle.fighters.find((f) => f.userId === ghostB.id));
  battle.finish(winner);
  assert.deepStrictEqual(said().slice(-2), [
    '🏆 Ghost_A remporte le Battle Royale avec 1 kill(s) !',
    '💰 1 parieur remporte 30 golds de mises perdues !',
  ]);

  await post('/api/admin/battle/reset');
  await post('/api/admin/queue/open', { seconds: 60 });
  await post('/api/admin/queue/bots', { count: 2 });
  await post('/api/admin/battle/start');
  battle.stopLoop();
  assert.strictEqual(said().at(-1), '🔥 Que le combat commence !');
  await post('/api/admin/battle/reset');

  // ---------- Liaison OAuth Twitch ----------
  const me = reg.data.me;
  assert.strictEqual((await client().call('GET', '/auth/twitch')).location, '/', 'sans session : retour à l\'accueil');
  const config = (await client().call('GET', '/api/config')).data;
  assert.strictEqual(config.twitch.oauth, true);
  assert.strictEqual(config.devLink, true, 'ALLOW_DEV_LINK=1 autorise la liaison par pseudo malgré l\'OAuth');

  // TWL-5 : URL de retour = PUBLIC_URL si défini (sans « / » final), sinon protocole://hôte de la requête
  const authorize = async (c) => {
    const r = await c.call('GET', '/auth/twitch');
    assert.strictEqual(r.status, 302);
    return new URL(r.location);
  };
  const noPublic = await authorize(real);
  assert.strictEqual(noPublic.origin + noPublic.pathname, 'https://id.twitch.tv/oauth2/authorize');
  assert.strictEqual(noPublic.searchParams.get('redirect_uri'), `${base}/auth/twitch/callback`);
  process.env.PUBLIC_URL = 'https://jeu.example.com/';
  const withPublic = await authorize(real);
  assert.strictEqual(withPublic.searchParams.get('redirect_uri'), 'https://jeu.example.com/auth/twitch/callback');

  // TWL-1, TWL-2 : paramètres OAuth, state aléatoire à chaque demande, scope vide
  assert.strictEqual(withPublic.searchParams.get('client_id'), 'cid');
  assert.strictEqual(withPublic.searchParams.get('response_type'), 'code');
  assert.strictEqual(withPublic.searchParams.get('scope'), '');
  assert.match(withPublic.searchParams.get('state'), /^[0-9a-f]{32}$/);
  assert.notStrictEqual(noPublic.searchParams.get('state'), withPublic.searchParams.get('state'));

  // TWL-3 : state inconnu, code manquant, state expiré (10 min)
  const failed = '/character.html?twitch=error';
  assert.strictEqual((await real.call('GET', '/auth/twitch/callback?state=nimporte&code=c')).location, failed);
  assert.strictEqual((await real.call('GET', `/auth/twitch/callback?state=${withPublic.searchParams.get('state')}`)).location, failed, 'code manquant');
  const stale = await authorize(real);
  const realNow = Date.now();
  const now = t.mock.method(Date, 'now', () => realNow + 10 * 60 * 1000 + 1000);
  assert.strictEqual((await real.call('GET', `/auth/twitch/callback?state=${stale.searchParams.get('state')}&code=c`)).location, failed, 'state expiré');
  now.mock.restore();

  // TWL-4 : échange du code, lecture du profil, liaison
  const realFetch = globalThis.fetch;
  const twitchCalls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const href = String(url);
    if (href.startsWith('https://id.twitch.tv/oauth2/token')) {
      twitchCalls.push(['token', Object.fromEntries(new URLSearchParams(String(init.body)))]);
      return { ok: true, json: async () => ({ access_token: 'tok' }) };
    }
    if (href.startsWith('https://api.twitch.tv/helix/users')) {
      twitchCalls.push(['users', init.headers]);
      return { ok: true, json: async () => ({ data: [{ id: '777', login: 'real_twitch', display_name: 'RealTwitch' }] }) };
    }
    return realFetch(url, init);
  });
  const valid = await authorize(real);
  const ok = await real.call('GET', `/auth/twitch/callback?state=${valid.searchParams.get('state')}&code=thecode`);
  assert.strictEqual(ok.location, '/character.html?twitch=ok');
  assert.deepStrictEqual(twitchCalls[0][1], {
    client_id: 'cid', client_secret: 'csecret', code: 'thecode', grant_type: 'authorization_code', redirect_uri: 'https://jeu.example.com/auth/twitch/callback',
  });
  assert.deepStrictEqual(twitchCalls[1][1], { Authorization: 'Bearer tok', 'Client-Id': 'cid' });
  const user = db.state.users[me.id];
  assert.deepStrictEqual([user.twitchLogin, user.twitchDisplayName, user.twitchId], ['real_twitch', 'RealTwitch', '777']);
  const replay = await real.call('GET', `/auth/twitch/callback?state=${valid.searchParams.get('state')}&code=thecode`);
  assert.strictEqual(replay.location, failed, 'le state ne sert qu\'une fois');
});
