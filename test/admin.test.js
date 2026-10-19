/*
 * Administration, récompenses de bataille et temps réel : requêtes HTTP réelles sur le serveur Express.
 * Les événements Socket.IO sont observés en espionnant `io.to()` / `io.emit()`, et par un vrai client (long polling).
 */
const test = require('node:test');
const assert = require('node:assert');
const { before, after } = test;
const { Rules, db } = require('./helpers');

process.env.ADMIN_PASSWORD = 'test-admin-pass';
const { server, io, battle } = require('../server/index');

let base = '';
const emitted = []; // { room, event, data }

before(async () => {
  const realTo = io.to.bind(io);
  const realEmit = io.emit.bind(io);
  io.to = (room) => {
    const op = realTo(room);
    return { emit: (event, data) => { emitted.push({ room, event, data }); return op.emit(event, data); } };
  };
  io.emit = (event, data) => { emitted.push({ room: null, event, data }); return realEmit(event, data); };
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

after(() => {
  battle.reset();
  io.close();
});

function client() {
  let cookie = '';
  async function call(method, url, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = set[0].split(';')[0];
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }
  return { get: (url) => call('GET', url), post: (url, body = {}) => call('POST', url, body), cookie: () => cookie };
}

const admin = client();
const post = (url, body) => admin.post(url, body);

async function register(name) {
  const c = client();
  const r = await c.post('/api/register', { username: name, password: 'secret1' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  return { c, id: r.data.me.id };
}

const since = (mark) => emitted.slice(mark);
const toUser = (list, id, event) => list.filter((e) => e.room === 'user:' + id && e.event === event).map((e) => e.data);
const broadcast = (list, event) => list.filter((e) => e.room === null && e.event === event).map((e) => e.data);

// Lance une bataille avec des joueurs (clés `u<id>`) et des bots ; la boucle est arrêtée, tout est piloté à la main.
async function launch({ humans, bots = 0, event = null }) {
  await post('/api/admin/queue/open', { seconds: 600 });
  for (const h of humans) assert.strictEqual((await h.c.post('/api/queue/join')).data.joined, true);
  if (bots) await post('/api/admin/queue/bots', { count: bots });
  if (event) assert.strictEqual((await post('/api/admin/event', { event })).status, 200);
  const started = await post('/api/admin/battle/start');
  assert.strictEqual(started.status, 200, JSON.stringify(started.data));
  battle.stopLoop();
  for (const f of battle.fighters) f.speed = 0;
  return started.data;
}

const fighterOf = (id) => battle.fighters.find((f) => f.userId === id);

test('[ADM-1, ADM-2, ADM-5] admin : contrôles de la file, choix de l\'événement, liste des joueurs', async () => {
  await post('/api/login', { username: 'admin', password: 'test-admin-pass' });
  const alice = await register('adm_alice');

  assert.deepStrictEqual((await admin.get('/api/admin/state')).data, { pendingEvent: null });
  for (const ev of ['random', 'double', 'fog', 'fast', 'meteors', null]) {
    const r = await post('/api/admin/event', { event: ev });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await admin.get('/api/admin/state')).data.pendingEvent, ev);
  }
  assert.strictEqual((await post('/api/admin/event', { event: 'tsunami' })).status, 400);

  const list = (await admin.get('/api/admin/players')).data;
  const me = list.find((p) => p.id === alice.id);
  assert.deepStrictEqual(Object.keys(me).sort(), ['banned', 'chests', 'cls', 'ghost', 'gold', 'id', 'level', 'name', 'record', 'title', 'twitch', 'username']);
  assert.ok(!list.some((p) => p.username === 'admin'), 'l\'admin n\'est pas un joueur');

  // La file : ouvrir, fermer (les inscrits restent), lancer, réinitialiser
  await post('/api/admin/queue/open', { seconds: 600 });
  await alice.c.post('/api/queue/join');
  assert.strictEqual((await post('/api/admin/queue/close')).status, 200);
  const q = (await alice.c.get('/api/queue')).data;
  assert.strictEqual(q.phase, 'ready');
  assert.strictEqual(q.participants.length, 1);
  assert.strictEqual((await post('/api/admin/battle/reset')).status, 200);
  assert.strictEqual((await alice.c.get('/api/queue')).data.phase, 'idle');

  // ADM-5 : joueur introuvable (inconnu, ou compte admin)
  const adminId = Object.values(db.state.users).find((u) => u.role === 'admin').id;
  for (const route of ['give', 'ban']) {
    for (const id of ['424242', adminId]) {
      const r = await post(`/api/admin/players/${id}/${route}`, { gold: 5, banned: true });
      assert.strictEqual(r.status, 400);
      assert.match(r.data.error, /Joueur introuvable/);
    }
  }
});

test('[Q-2, Q-3, Q-9, Q-5, Q-7, Q-12] file : bots, capture du joueur, réouverture, refus pendant la bataille', async () => {
  const { c, id } = await register('queue_bob');
  await post(`/api/admin/players/${id}/give`, { gold: 100 });
  await c.post('/api/class', { cls: 'mage' });
  await c.post('/api/twitch/link-dev', { login: 'BobTwitch' });
  const character = db.state.users[id].character;
  character.level = 4;
  character.stats.vie = 3;
  character.equipment.casque = { id: 'x', slot: 'casque', rarity: 'epique', lines: [{ stat: 'vie', value: 10 }], name: 'Test' };
  character.equipment.arme = { id: 'y', slot: 'arme', kind: 'baton', rarity: 'rare', lines: [{ stat: 'force', value: 5 }], name: 'Test' };
  character.look.hat = 'couronne';

  await post('/api/admin/queue/open', { seconds: 600 });
  assert.strictEqual((await post('/api/admin/queue/bots', { count: 'x' })).status, 200); // 5 par défaut
  assert.strictEqual(battle.participants.size, 5);
  await post('/api/admin/queue/bots', { count: 1000 }); // borné à 50
  assert.strictEqual(battle.participants.size, 55);
  await post('/api/admin/queue/bots', { count: -4 }); // au moins 1
  assert.strictEqual(battle.participants.size, 56);

  const usersBefore = Object.keys(db.state.users).length;
  const bots = [...battle.participants.values()].filter((p) => p.bot);
  assert.strictEqual(bots.length, 56);
  for (const bot of bots) {
    assert.match(bot.key, /^bot\d+$/);
    assert.ok(bot.level >= 1 && bot.level <= 6);
    assert.ok(Rules.CLASSES.includes(bot.cls));
    assert.strictEqual(bot.userId, undefined);
    assert.ok(Object.keys(bot.look).every((s) => Rules.SLOTS.includes(s) && Rules.RARITIES.includes(bot.look[s])));
    for (const part of Object.keys(Rules.APPEARANCE)) assert.ok(Rules.APPEARANCE[part].options[bot.app[part]], `${part} : ${bot.app[part]}`);
    assert.ok(bot.stats.maxHp > 0);
  }
  assert.strictEqual(Object.keys(db.state.users).length, usersBefore, 'les bots ne sont pas sauvegardés');
  assert.ok(new Set(bots.map((b) => b.key)).size === bots.length, 'clés uniques');
  // Statistiquement : l'équipement visuel tourne autour de 40 % par slot
  const slots = bots.reduce((n, b) => n + Object.keys(b.look).length, 0);
  const p = 0.4;
  const n = bots.length * Rules.SLOTS.length;
  assert.ok(Math.abs(slots / n - p) <= 5 * Math.sqrt((p * (1 - p)) / n), `${slots / n}`);

  // Q-7 : ce qui est capturé à l'inscription
  assert.strictEqual((await c.post('/api/queue/join')).data.joined, true);
  const p1 = battle.participants.get('u' + id);
  assert.strictEqual(p1.key, 'u' + id);
  assert.strictEqual(p1.userId, id);
  assert.strictEqual(p1.name, 'BobTwitch', 'nom Twitch s\'il est lié');
  assert.strictEqual(p1.level, 4);
  assert.strictEqual(p1.cls, 'mage');
  assert.deepStrictEqual(p1.look, { casque: 'epique', arme: 'rare' });
  assert.strictEqual(p1.app.hat, 'couronne');
  assert.strictEqual(p1.stats.maxHp, Math.round(130 * 1.0 * (1 + (10 - 15) / 100)));
  assert.strictEqual(p1.title, null);

  // Q-12 : l'événement choisi n'apparaît pas dans la file
  await post('/api/admin/event', { event: 'fog' });
  assert.strictEqual((await c.get('/api/queue')).data.event, null);

  // Q-3 : réouverture = tout est vidé, paris remboursés (émission de « cleared »)
  const mark = emitted.length;
  let cleared = 0;
  battle.once('cleared', () => { cleared += 1; });
  await post('/api/admin/queue/open', { seconds: 600 });
  assert.strictEqual(cleared, 1);
  assert.strictEqual(battle.participants.size, 0);
  assert.strictEqual(broadcast(since(mark), 'queue').at(-1).participants.length, 0);

  // Q-2 : refus pendant une bataille
  await post('/api/admin/queue/bots', { count: 2 });
  assert.strictEqual((await post('/api/admin/battle/start')).status, 200);
  battle.stopLoop();
  const refused = await post('/api/admin/queue/open', { seconds: 600 });
  assert.strictEqual(refused.status, 400);
  assert.match(refused.data.error, /bataille est en cours/);
  assert.strictEqual(battle.phase, 'battle');
  assert.strictEqual((await c.get('/api/queue')).data.event, 'fog', 'révélé pendant la bataille');
  await post('/api/admin/battle/reset');
});

test('[Q-8, B-5] lancement : stats rafraîchies depuis la base, événement aléatoire valable une seule fois', async () => {
  const { c, id } = await register('queue_refresh');
  await post('/api/admin/queue/open', { seconds: 600 });
  await c.post('/api/queue/join');
  await post('/api/admin/queue/bots', { count: 1 });
  const before = battle.participants.get('u' + id).stats.maxHp;
  db.state.users[id].character.stats.vie = 10; // changement pendant la file
  await post('/api/admin/event', { event: 'random' });
  const started = await post('/api/admin/battle/start');
  battle.stopLoop();
  assert.strictEqual(fighterOf(id).maxHp, before + 100);
  assert.ok(Object.keys(Rules.BATTLE_EVENTS).includes(started.data.event), `événement tiré : ${started.data.event}`);
  assert.strictEqual(battle.event, started.data.event);
  assert.strictEqual(started.data.pendingEvent, null);
  assert.deepStrictEqual((await admin.get('/api/admin/state')).data, { pendingEvent: null });

  // Bataille suivante sans nouveau choix : aucun événement
  await post('/api/admin/battle/reset');
  await post('/api/admin/queue/open', { seconds: 600 });
  await post('/api/admin/queue/bots', { count: 2 });
  const next = await post('/api/admin/battle/start');
  battle.stopLoop();
  assert.strictEqual(next.data.event, null);
  assert.strictEqual(battle.event, null);
  await post('/api/admin/battle/reset');
});

test('[EVT-1, PRG-7, LB-2, RT-2, RT-3] Loot double : récompenses ×2, événements « reward » et « leaderboard »', async () => {
  const winner = await register('evt_winner');
  const loser = await register('evt_loser');
  await launch({ humans: [winner, loser], event: 'double' });
  const mark = emitted.length;
  const w = fighterOf(winner.id);
  battle.kill(w, fighterOf(loser.id));
  battle.finish(w);

  const rewards = toUser(since(mark), winner.id, 'reward');
  assert.deepStrictEqual(rewards.map((r) => r.type), ['kill', 'firstblood', 'participation', 'win']);
  assert.deepStrictEqual(rewards[0].reward, { xp: 200, gold: 20, chests: 2 });
  assert.deepStrictEqual(rewards[1].reward, { xp: 0, gold: 0, chests: 2 });
  assert.deepStrictEqual(rewards[2].reward, { xp: 50, gold: 0, chests: 0 });
  assert.deepStrictEqual(rewards[3].reward, { xp: 600, gold: 60, chests: 2 });
  assert.deepStrictEqual(rewards.map((r) => r.levels), [0, 0, 0, 2], 'niveaux gagnés : 300 XP puis 500 XP');
  const c = (await winner.c.get('/api/me')).data.character;
  assert.deepStrictEqual([c.chests, c.gold, c.level, c.xp], [6, 80, 3, 50]);
  assert.deepStrictEqual(c.record, { battles: 1, kills: 1, wins: 1 });
  const l = (await loser.c.get('/api/me')).data.character;
  assert.deepStrictEqual([l.xp, l.gold, l.chests], [50, 0, 0], 'participation doublée seulement');

  // RT-3 : « me » poussé à chaque joueur ; RT-2 : « leaderboard » diffusé à tous en fin de bataille
  assert.ok(toUser(since(mark), winner.id, 'me').length >= 1);
  assert.strictEqual(toUser(since(mark), winner.id, 'me').at(-1).character.level, 3);
  assert.strictEqual(broadcast(since(mark), 'leaderboard').length, 1);
  assert.ok(broadcast(since(mark), 'queue').length >= 1);
  await post('/api/admin/battle/reset');
});

test('[PRG-6] bots : aucune récompense, et aucun joueur créé', async () => {
  const human = await register('prg_human');
  await launch({ humans: [human], bots: 2 });
  const [bot1, bot2] = battle.fighters.filter((f) => f.key.startsWith('bot'));
  assert.ok(bot1 && bot2 && bot1.userId === null);
  const users = Object.keys(db.state.users).length;
  const mark = emitted.length;
  const h = fighterOf(human.id);
  battle.kill(bot1, h);
  battle.kill(bot1, bot2); // 2 kills d'affilée : « double » pour un bot
  battle.finish(bot1);
  assert.strictEqual(Object.keys(db.state.users).length, users);
  const rewards = toUser(since(mark), human.id, 'reward');
  assert.deepStrictEqual(rewards.map((r) => r.type), ['participation'], 'le joueur ne reçoit que la participation');
  assert.ok(since(mark).filter((e) => e.event === 'reward').every((e) => e.room === 'user:' + human.id), 'aucune récompense pour un bot');
  const c = (await human.c.get('/api/me')).data.character;
  assert.deepStrictEqual(c.record, { battles: 1, kills: 0, wins: 0 });
  await post('/api/admin/battle/reset');
});

test('[ADM-3, PRG-8, RT-3] don de ressources : appliqué et notifié au joueur', async () => {
  const { c, id } = await register('adm_gift');
  const mark = emitted.length;
  const r = await post(`/api/admin/players/${id}/give`, { gold: 10, chests: 2, xp: 350 });
  assert.strictEqual(r.status, 200);
  const me = (await c.get('/api/me')).data.character;
  assert.deepStrictEqual([me.gold, me.chests, me.level, me.xp], [10, 2, 2, 50]);
  const gifts = toUser(since(mark), id, 'reward');
  assert.deepStrictEqual(gifts, [{ type: 'gift', reward: { gold: 10, chests: 2, xp: 350 }, levels: 1 }]);
  assert.ok(toUser(since(mark), id, 'me').length >= 1);
});

test('[LB-2, ADM-4, RT-3] bannissement et titre : « leaderboard » diffusé, « banned » envoyé au joueur', async () => {
  const { c, id } = await register('adm_ban');
  let mark = emitted.length;
  assert.strictEqual((await c.post('/api/title', { id: null })).status, 200);
  assert.strictEqual(broadcast(since(mark), 'leaderboard').length, 1, 'changement de titre');

  mark = emitted.length;
  assert.strictEqual((await post(`/api/admin/players/${id}/ban`, { banned: true })).data.banned, true);
  assert.strictEqual(broadcast(since(mark), 'leaderboard').length, 1, 'bannissement');
  assert.strictEqual(toUser(since(mark), id, 'banned').length, 1);
  mark = emitted.length;
  await post(`/api/admin/players/${id}/ban`, { banned: false });
  assert.strictEqual(broadcast(since(mark), 'leaderboard').length, 1, 'débannissement');
  assert.strictEqual(toUser(since(mark), id, 'banned').length, 0);
});

// ---------- Temps réel : vrai client Socket.IO (Engine.IO en long polling, sans dépendance) ----------

async function socketClient(cookie) {
  const headers = cookie ? { Cookie: cookie } : {};
  const open = await (await fetch(`${base}/socket.io/?EIO=4&transport=polling`, { headers })).text();
  const sid = JSON.parse(open.slice(1)).sid;
  const url = `${base}/socket.io/?EIO=4&transport=polling&sid=${sid}`;
  const posted = await fetch(url, { method: 'POST', body: '40', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
  assert.strictEqual(posted.status, 200);
  async function poll(ms = 3000) {
    const text = await (await fetch(url, { signal: AbortSignal.timeout(ms) })).text();
    return text.split('\x1e').filter((p) => p.startsWith('42')).map((p) => JSON.parse(p.slice(2)));
  }
  const close = () => fetch(url, { method: 'POST', body: '1', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(() => {});
  return { poll, close };
}

test('[RT-1, RT-2, RT-3] connexion Socket.IO : file + frame à l\'arrivée, room du joueur pour « me » et « reward »', async () => {
  const { c, id } = await register('rt_user');
  const member = await socketClient(c.cookie());
  const anonymous = await socketClient('');
  try {
    const initial = await member.poll();
    assert.deepStrictEqual(initial.map(([event]) => event), ['queue', 'frame']);
    assert.ok(['idle', 'queue', 'ready', 'battle', 'ended'].includes(initial[0][1].phase));
    assert.deepStrictEqual(initial[1][1].arena, { w: 1280, h: 720 });
    assert.deepStrictEqual((await anonymous.poll()).map(([event]) => event), ['queue', 'frame']);

    await post(`/api/admin/players/${id}/give`, { gold: 42 });
    const received = await member.poll();
    const byEvent = Object.fromEntries(received.map(([event, data]) => [event, data]));
    assert.strictEqual(byEvent.me.character.gold, 42, 'vue complète du personnage');
    assert.strictEqual(byEvent.reward.type, 'gift');

    // Le visiteur sans session n'est dans aucune room : il ne reçoit rien (la requête reste en attente)
    await assert.rejects(anonymous.poll(400), /abort|timeout/i);
  } finally {
    await member.close();
    await anonymous.close();
  }
});

test('[NFR-3, BET-3, BET-4] paris : une mise engagée ne peut pas être dépensée une seconde fois', async () => {
  const target = await register('nfr_target');
  const bettor = await register('nfr_bettor');
  await post(`/api/admin/players/${bettor.id}/give`, { gold: 100 });
  await post('/api/admin/queue/open', { seconds: 600 });
  await target.c.post('/api/queue/join');
  const golds = async () => (await bettor.c.get('/api/me')).data.character.gold;

  assert.strictEqual((await bettor.c.post('/api/bet', { target: 'u' + target.id, amount: 100 })).status, 200);
  assert.strictEqual(await golds(), 0, 'mise retirée tout de suite');
  assert.strictEqual((await bettor.c.post('/api/chest/buy', { count: 1 })).status, 400, 'pas de coffre avec des golds engagés');
  assert.strictEqual((await bettor.c.post('/api/shop/buy', { id: 'chat' })).status, 400);
  assert.strictEqual((await bettor.c.post('/api/bet', { target: 'u' + target.id, amount: 101 })).status, 400, 'plus que la mise précédente + golds libres');
  assert.strictEqual(await golds(), 0);

  // Modifier le pari rend l'ancienne mise avant de débiter la nouvelle
  assert.strictEqual((await bettor.c.post('/api/bet', { target: 'u' + target.id, amount: 60 })).status, 200);
  assert.strictEqual(await golds(), 40);
  assert.strictEqual((await bettor.c.post('/api/chest/buy', { count: 1 })).status, 400);
  await bettor.c.post('/api/bet/cancel');
  assert.strictEqual(await golds(), 100);
  assert.strictEqual((await bettor.c.post('/api/chest/buy', { count: 1 })).status, 200);
  await post('/api/admin/battle/reset');
});
