/*
 * Tests d'intégration : vraies requêtes HTTP sur le serveur Express (port aléatoire), sans chat Twitch.
 * Les tests s'exécutent dans l'ordre et partagent l'état (comptes, file, bataille).
 */
const test = require('node:test');
const assert = require('node:assert');
const { before, after } = test;
const { Rules, db } = require('./helpers');

process.env.ADMIN_PASSWORD = 'test-admin-pass';
const { server, io, battle } = require('../server/index');

let base = '';

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

after(() => {
  battle.reset();
  io.close();
});

// Client HTTP avec son propre cookie de session.
function client() {
  let cookie = '';
  async function call(method, url, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const set = res.headers.getSetCookie();
    if (set.length) {
      const pair = set[0].split(';')[0];
      cookie = pair.endsWith('=') ? '' : pair;
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, headers: res.headers, setCookie: set };
  }
  return { get: (url) => call('GET', url), post: (url, body = {}) => call('POST', url, body) };
}

const admin = client();
const alice = client();

async function register(c, username) {
  const r = await c.post('/api/register', { username, password: 'secret1' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  return r.data.me;
}
const meOf = async (c) => (await c.get('/api/me')).data;
const give = (id, gift) => admin.post(`/api/admin/players/${id}/give`, gift);
const players = async () => (await admin.get('/api/admin/players')).data;

test('[SYS-1, SYS-2] /healthz et fichiers partagés', async () => {
  const health = await client().get('/healthz');
  assert.deepStrictEqual(health.data, { ok: true });
  const rules = await fetch(base + '/shared/rules.js');
  assert.strictEqual(rules.status, 200);
  assert.ok((await rules.text()).includes('lootTable'));
});

test('[ACC-1] inscription : pseudo et mot de passe validés', async () => {
  const c = client();
  assert.strictEqual((await c.post('/api/register', { username: 'ab', password: 'secret1' })).status, 400);
  assert.strictEqual((await c.post('/api/register', { username: 'pseudo invalide', password: 'secret1' })).status, 400);
  assert.strictEqual((await c.post('/api/register', { username: 'alice', password: '123' })).status, 400);
});

test('[ACC-3, ACC-8] inscription : joueur créé, cookie de session HttpOnly', async () => {
  const me = await register(alice, 'alice');
  assert.strictEqual(me.role, 'player');
  assert.strictEqual(me.character.level, 1);
  const r = await client().post('/api/register', { username: 'cookie_test', password: 'secret1' });
  const cookie = r.setCookie[0];
  assert.match(cookie, /^zl_session=[0-9a-f]{64};/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.ok(!/Secure/.test(cookie), 'pas de Secure hors production');
});

test('[ACC-2] inscription : pseudo déjà pris (sans tenir compte de la casse)', async () => {
  const r = await client().post('/api/register', { username: 'ALICE', password: 'secret1' });
  assert.strictEqual(r.status, 400);
  assert.match(r.data.error, /déjà pris/);
});

test('[ACC-4] mot de passe stocké sous la forme sel:scrypt', async () => {
  const alice = Object.values(db.state.users).find((u) => u.username === 'alice');
  assert.match(alice.passwordHash, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
});

test('[ACC-5, ACC-6] connexion : insensible à la casse, mauvais mot de passe refusé', async () => {
  const c = client();
  const bad = await c.post('/api/login', { username: 'alice', password: 'faux' });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.data.error, /Identifiants incorrects/);
  assert.strictEqual((await c.post('/api/login', { username: 'ALICE', password: 'secret1' })).status, 200);
  assert.strictEqual((await meOf(c)).username, 'alice');
});

test('[ACC-12] rôles : 401 sans session, 403 pour un joueur sur une route admin', async () => {
  const anon = client();
  assert.strictEqual((await anon.get('/api/me')).status, 401);
  assert.strictEqual((await anon.post('/api/chest/buy', { count: 1 })).status, 401);
  assert.strictEqual((await anon.post('/api/admin/queue/open', {})).status, 403);
  assert.strictEqual((await alice.post('/api/admin/queue/open', {})).status, 403);
  assert.strictEqual((await alice.get('/api/admin/players')).status, 403);
});

test('[ACC-13, ACC-14] compte admin créé avec ADMIN_PASSWORD', async () => {
  const bad = await client().post('/api/login', { username: 'admin', password: 'admin' });
  assert.strictEqual(bad.status, 400);
  const ok = await admin.post('/api/login', { username: 'admin', password: 'test-admin-pass' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.data.me.role, 'admin');
  assert.strictEqual((await admin.get('/api/admin/state')).status, 200);
  // Un admin n'est pas un joueur
  assert.strictEqual((await admin.post('/api/chest/buy', { count: 1 })).status, 403);
});

test('[ACC-10] déconnexion : la session est supprimée', async () => {
  const c = client();
  await c.post('/api/login', { username: 'alice', password: 'secret1' });
  assert.strictEqual((await c.get('/api/me')).status, 200);
  await c.post('/api/logout');
  assert.strictEqual((await c.get('/api/me')).status, 401);
});

test('[ACC-16, PRG-8, CHEST-1] actions joueur : erreur → 400, succès → ok et état à jour', async () => {
  const id = (await meOf(alice)).id;
  const none = await alice.post('/api/stats/allocate', { stat: 'vie' });
  assert.strictEqual(none.status, 400);
  assert.match(none.data.error, /point de compétence/);
  const poor = await alice.post('/api/chest/buy', { count: 1 });
  assert.strictEqual(poor.status, 400);
  assert.match(poor.data.error, /Pas assez de golds/);

  assert.strictEqual((await give(id, { gold: 500 })).status, 200);
  assert.strictEqual((await give(id, {})).status, 400, 'rien à donner');
  assert.strictEqual((await give('9999', { gold: 5 })).status, 400, 'joueur introuvable');
  const buy = await alice.post('/api/chest/buy', { count: 1 });
  assert.strictEqual(buy.data.ok, true);
  const c = (await meOf(alice)).character;
  assert.deepStrictEqual([c.gold, c.chests], [400, 1]);
});

test('[Q-1, Q-6, Q-11] file : ouverture bornée, inscription refusée si fermée, pas de doublon', async () => {
  const closed = await alice.post('/api/queue/join');
  assert.strictEqual(closed.status, 400);
  assert.match(closed.data.error, /pas ouverte/);

  await admin.post('/api/admin/queue/open', { seconds: 1 }); // borné à 10 s minimum
  const q = (await alice.get('/api/queue')).data;
  assert.strictEqual(q.phase, 'queue');
  const left = q.queueEndsAt - Date.now();
  assert.ok(left > 8000 && left <= 10000, `durée ${left} ms`);

  assert.strictEqual((await alice.post('/api/queue/join')).data.joined, true);
  assert.strictEqual((await alice.post('/api/queue/join')).data.joined, false);
  assert.strictEqual((await alice.get('/api/queue')).data.participants.length, 1);
});

test('[Q-10, CHAT-4, CHAT-6] !join simulé : fantôme créé, pseudo validé, banni refusé', async () => {
  assert.strictEqual((await admin.post('/api/admin/queue/simulate', { login: 'x!' })).status, 400);
  const r = await admin.post('/api/admin/queue/simulate', { login: 'Ghost_One' });
  assert.strictEqual(r.data.joined, true);
  const ghost = (await players()).find((p) => p.twitch === 'ghost_one');
  assert.ok(ghost && ghost.ghost, 'fantôme créé');
  const q = (await alice.get('/api/queue')).data;
  assert.ok(q.participants.some((p) => p.key === 'u' + ghost.id));
});

test('[BET-2, BET-3, BET-5, BET-6] paris via l\'API', async () => {
  const ghost = (await players()).find((p) => p.twitch === 'ghost_one');
  const aliceId = (await meOf(alice)).id;
  const self = await alice.post('/api/bet', { target: 'u' + aliceId, amount: 10 });
  assert.match(self.data.error, /toi-même/);
  const bet = await alice.post('/api/bet', { target: 'u' + ghost.id, amount: 100 });
  assert.strictEqual(bet.data.ok, true);
  assert.strictEqual((await meOf(alice)).character.gold, 300);
  const summary = (await alice.get('/api/queue')).data.bets;
  assert.deepStrictEqual([summary.pool, summary.bettors], [100, 1]);
  assert.ok(!JSON.stringify(summary).includes('alice'), 'ne révèle pas qui a parié');

  await alice.post('/api/bet/cancel');
  assert.strictEqual((await meOf(alice)).character.gold, 400);
  assert.strictEqual((await alice.post('/api/bet/cancel')).status, 400);
});

test('[ADM-4, BET-9, CHAT-6, ADM-5] bannir un inscrit : retiré de la file, paris sur lui remboursés', async () => {
  const ghost = (await players()).find((p) => p.twitch === 'ghost_one');
  await alice.post('/api/bet', { target: 'u' + ghost.id, amount: 100 });
  assert.strictEqual((await meOf(alice)).character.gold, 300);

  assert.strictEqual((await admin.post('/api/admin/players/9999/ban', { banned: true })).status, 400);
  assert.strictEqual((await admin.post(`/api/admin/players/${ghost.id}/ban`, { banned: true })).data.banned, true);

  assert.strictEqual((await meOf(alice)).character.gold, 400, 'mise remboursée');
  assert.ok(!(await alice.get('/api/queue')).data.participants.some((p) => p.key === 'u' + ghost.id));
  const again = await admin.post('/api/admin/queue/simulate', { login: 'ghost_one' });
  assert.strictEqual(again.data.joined, false, 'un banni ne peut plus rejoindre');
});

test('[CHAT-10, CHAT-11] sub : 300 golds au fantôme, rien pour un banni', async () => {
  assert.strictEqual((await admin.post('/api/admin/simulate-sub', { login: 'subber' })).status, 200);
  const subber = (await players()).find((p) => p.twitch === 'subber');
  assert.strictEqual(subber.gold, Rules.SUB_REWARD_GOLD);
  const banned = await admin.post('/api/admin/simulate-sub', { login: 'ghost_one' });
  assert.strictEqual(banned.status, 400);
  assert.match(banned.data.error, /banni/);
});

test('[TWL-6, TWL-8, TWL-7, TWL-9] liaison Twitch : fantôme absorbé, doublon refusé, déliaison', async () => {
  const redirect = await alice.get('/auth/twitch');
  assert.strictEqual(redirect.status, 302);
  assert.strictEqual(redirect.headers.get('location'), '/character.html?twitch=disabled', 'OAuth non configuré');

  assert.strictEqual((await alice.post('/api/twitch/link-dev', { login: 'x!' })).status, 400);
  assert.strictEqual((await alice.post('/api/twitch/link-dev', { login: 'Subber' })).status, 200);
  const me = await meOf(alice);
  assert.strictEqual(me.twitchLogin, 'subber');
  assert.strictEqual(me.character.gold, 400 + Rules.SUB_REWARD_GOLD, 'golds du fantôme récupérés');
  assert.ok(!(await players()).some((p) => p.ghost && p.twitch === 'subber'), 'fantôme supprimé');

  const other = client();
  await register(other, 'pl_other');
  const dup = await other.post('/api/twitch/link-dev', { login: 'subber' });
  assert.strictEqual(dup.status, 400);
  assert.match(dup.data.error, /déjà lié/);

  await alice.post('/api/twitch/unlink');
  assert.strictEqual((await meOf(alice)).twitchLogin, null);
});

test('[ACC-7, ACC-9] compte banni : session invalidée et connexion refusée', async () => {
  const other = client();
  await other.post('/api/login', { username: 'pl_other', password: 'secret1' });
  const id = (await meOf(other)).id;
  await admin.post(`/api/admin/players/${id}/ban`, { banned: true });
  assert.strictEqual((await other.get('/api/me')).status, 401);
  const login = await client().post('/api/login', { username: 'pl_other', password: 'secret1' });
  assert.strictEqual(login.status, 403);
});

test('[B-1, B-4] lancement : 2 combattants minimum ; réinitialisation de l\'arène', async () => {
  await admin.post('/api/admin/battle/reset');
  assert.strictEqual((await alice.get('/api/queue')).data.phase, 'idle');
  await admin.post('/api/admin/queue/open', { seconds: 600 });
  const few = await admin.post('/api/admin/battle/start');
  assert.strictEqual(few.status, 400);
  assert.match(few.data.error, /au moins 2/);
  assert.strictEqual((await admin.post('/api/admin/queue/bots', { count: 3 })).data.ok, true);
  assert.strictEqual((await alice.get('/api/queue')).data.participants.length, 3);
  await admin.post('/api/admin/battle/reset');
});

test('[PRG-3, PRG-4, PRG-5, BET-1, BET-7, BET-10, B-26, LB-1] bataille complète : récompenses, paris, classement', async () => {
  const win = client();
  const lose = client();
  const bettorWin = client();
  const bettorLose = client();
  const ids = {};
  for (const [c, name] of [[win, 'pl_win'], [lose, 'pl_lose'], [bettorWin, 'pl_bet1'], [bettorLose, 'pl_bet2']]) {
    ids[name] = (await register(c, name)).id;
  }
  await give(ids.pl_bet1, { gold: 100 });
  await give(ids.pl_bet2, { gold: 100 });

  await admin.post('/api/admin/queue/open', { seconds: 600 });
  assert.strictEqual((await win.post('/api/queue/join')).data.joined, true);
  assert.strictEqual((await lose.post('/api/queue/join')).data.joined, true);

  // pl_bet1 mise 30 sur le futur vainqueur, pl_bet2 mise 50 sur le perdant : le gagnant récupère 30 + 50.
  assert.strictEqual((await bettorWin.post('/api/bet', { target: 'u' + ids.pl_win, amount: 30 })).data.ok, true);
  assert.strictEqual((await bettorLose.post('/api/bet', { target: 'u' + ids.pl_lose, amount: 50 })).data.ok, true);

  assert.strictEqual((await admin.post('/api/admin/battle/start')).data.ok, true);
  battle.stopLoop(); // la suite est pilotée à la main
  battle.fighters.forEach((f) => { f.speed = 0; });
  assert.strictEqual(battle.phase, 'battle');
  const late = await bettorWin.post('/api/bet', { target: 'u' + ids.pl_win, amount: 1 });
  assert.match(late.data.error, /fermés/);

  const winner = battle.fighters.find((f) => f.userId === ids.pl_win);
  const loser = battle.fighters.find((f) => f.userId === ids.pl_lose);
  battle.kill(winner, loser);
  battle.finish(winner);

  const q = (await alice.get('/api/queue')).data;
  assert.strictEqual(q.phase, 'ended');
  assert.strictEqual(q.result.winner.key, 'u' + ids.pl_win);

  const w = (await meOf(win)).character;
  assert.deepStrictEqual(w.record, { battles: 1, kills: 1, wins: 1 });
  assert.strictEqual(w.chests, 3, 'kill + premier kill + victoire');
  assert.strictEqual(w.gold, 40, 'kill 10 + victoire 30');
  assert.deepStrictEqual([w.level, w.xp], [2, 125], '100 + 25 + 300 XP');

  const l = (await meOf(lose)).character;
  assert.deepStrictEqual(l.record, { battles: 1, kills: 0, wins: 0 });
  assert.strictEqual(l.xp, 25, 'participation seule');

  const bw = (await meOf(bettorWin)).character;
  assert.strictEqual(bw.gold, 100 - 30 + 80, 'mise + mises perdues');
  assert.strictEqual(bw.counters.betsWon, 1);
  assert.strictEqual((await meOf(bettorLose)).character.gold, 50);

  const board = (await alice.get('/api/leaderboard')).data;
  assert.strictEqual(board.wins[0].name, 'pl_win');
});

test('[MODE-2, MODE-3, MODE-5, ADM-1, BET-1] modes coopératifs : choix du mode, 1 combattant, pas de paris, événement en attente', async () => {
  await admin.post('/api/admin/battle/reset');
  const bad = await admin.post('/api/admin/queue/open', { seconds: 600, mode: 'pique-nique' });
  assert.strictEqual(bad.status, 400);
  const solo = client();
  const bettor = client();
  const id = (await register(solo, 'pl_solo')).id;
  const bid = (await register(bettor, 'pl_bettor_coop')).id;
  await give(bid, { gold: 50 });
  await admin.post('/api/admin/event', { event: 'fog' });
  await admin.post('/api/admin/queue/open', { seconds: 600, mode: 'boss' });
  assert.strictEqual((await alice.get('/api/queue')).data.mode, 'boss');
  assert.strictEqual((await solo.post('/api/queue/join')).data.joined, true);
  const bet = await bettor.post('/api/bet', { target: 'u' + id, amount: 10 });
  assert.match(bet.data.error, /fermés/);
  assert.strictEqual((await meOf(bettor)).character.gold, 50);
  const r = await admin.post('/api/admin/battle/start');
  battle.stopLoop();
  assert.strictEqual(r.data.ok, true, 'un seul combattant suffit');
  assert.strictEqual(battle.event, null);
  assert.strictEqual(r.data.pendingEvent, 'fog', 'l\'événement attend la prochaine bataille royale');
  await admin.post('/api/admin/event', { event: null });
  await admin.post('/api/admin/battle/reset');
});

test('[BOSS-6, BOSS-7, MODE-5, MODE-6, ACH-1] Combat de Boss : récompense commune pour tous, morts compris', async () => {
  const a = client();
  const b = client();
  const ida = (await register(a, 'pl_boss_a')).id;
  const idb = (await register(b, 'pl_boss_b')).id;
  await admin.post('/api/admin/queue/open', { seconds: 600, mode: 'boss' });
  await a.post('/api/queue/join');
  await b.post('/api/queue/join');
  await admin.post('/api/admin/battle/start');
  battle.stopLoop();
  const fa = battle.players.find((f) => f.userId === ida);
  const fb = battle.players.find((f) => f.userId === idb);
  battle.kill(battle.boss, fb); // pl_boss_b tombe avant la fin
  battle.kill(fa, battle.boss);
  battle.tick(0.05);
  const q = (await alice.get('/api/queue')).data;
  assert.strictEqual(q.phase, 'ended');
  assert.strictEqual(q.result.mode, 'boss');
  assert.strictEqual(q.result.victory, true);
  for (const c of [a, b]) {
    const ch = (await meOf(c)).character;
    assert.strictEqual(ch.chests, 3);
    assert.strictEqual(ch.gold, 500);
    assert.deepStrictEqual([ch.level, ch.xp], [2, 225], '25 + 500 XP');
    assert.deepStrictEqual(ch.record, { battles: 1, kills: 0, wins: 0 }, 'tuer le Troll ne compte pas comme un kill');
    assert.strictEqual(ch.counters.bossWins, 1);
  }

  // Défaite : seulement la participation
  await admin.post('/api/admin/queue/open', { seconds: 600, mode: 'boss' });
  await a.post('/api/queue/join');
  await admin.post('/api/admin/battle/start');
  battle.stopLoop();
  battle.kill(battle.boss, battle.players[0]);
  battle.tick(0.05);
  assert.strictEqual(battle.result.victory, false);
  const after = (await meOf(a)).character;
  assert.strictEqual(after.gold, 500);
  assert.strictEqual(after.xp, 250);
  assert.strictEqual(after.counters.bossWins, 1);
  await admin.post('/api/admin/battle/reset');
});

test('[DNG-7, DNG-8, MODE-6, ACH-1] Raid de Donjon : récompense selon la salle atteinte, record de salle', async () => {
  const a = client();
  const ida = (await register(a, 'pl_dungeon')).id;
  await admin.post('/api/admin/queue/open', { seconds: 600, mode: 'dungeon' });
  await a.post('/api/queue/join');
  await admin.post('/api/admin/battle/start');
  battle.stopLoop();
  battle.dungeon.room = 11;
  battle.setStage('fight');
  battle.kill(null, battle.players.find((f) => f.userId === ida));
  battle.tick(0.05);
  const q = (await alice.get('/api/queue')).data;
  assert.strictEqual(q.result.mode, 'dungeon');
  assert.strictEqual(q.result.room, 11);
  const ch = (await meOf(a)).character;
  assert.strictEqual(ch.gold, 150, 'palier 10');
  assert.strictEqual(ch.xp, 175, '25 + 150 XP');
  assert.strictEqual(ch.chests, 0);
  assert.strictEqual(ch.counters.dungeonBest, 11);
  assert.deepStrictEqual(ch.record, { battles: 1, kills: 0, wins: 0 });

  // Un raid moins bon ne fait pas baisser le record
  await admin.post('/api/admin/queue/open', { seconds: 600, mode: 'dungeon' });
  await a.post('/api/queue/join');
  await admin.post('/api/admin/battle/start');
  battle.stopLoop();
  battle.dungeon.room = 2;
  battle.setStage('fight');
  battle.kill(null, battle.players[0]);
  battle.tick(0.05);
  const after = (await meOf(a)).character;
  assert.strictEqual(after.counters.dungeonBest, 11);
  assert.strictEqual(after.gold, 150, 'salle 2 : pas de récompense');
  await admin.post('/api/admin/battle/reset');
});

test('[ACC-9] cookie mal encodé : traité comme une session inconnue, le serveur ne plante pas', async () => {
  const bad = { Cookie: 'zl_session=%E0%A4%A; autre=%' };
  // Routes HTTP : pas de session, donc 401 (et surtout pas de 500)
  assert.strictEqual((await fetch(base + '/api/me', { headers: bad })).status, 401);
  assert.strictEqual((await fetch(base + '/api/queue', { headers: bad })).status, 200);
  // Connexion Socket.IO (la poignée de main lit le cookie) : le processus doit survivre
  const hs = await fetch(base + '/socket.io/?EIO=4&transport=polling', { headers: bad });
  assert.strictEqual(hs.status, 200);
  assert.strictEqual((await client().get('/healthz')).status, 200);
});
