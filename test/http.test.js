/*
 * Tests d'intégration : vraies requêtes HTTP sur le serveur Express (port aléatoire), sans chat Twitch.
 * Les tests s'exécutent dans l'ordre et partagent l'état (comptes, file, bataille).
 */
const test = require('node:test');
const assert = require('node:assert');
const { before, after } = test;
const { Rules, db, game } = require('./helpers');

process.env.ADMIN_PASSWORD = 'test-admin-pass';
const { server, io, battle, chatCommand, solos, refundSoloRuns, trainings } = require('../server/index');

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

test('[CHAT-10, CHAT-11] sub : 5 000 golds au fantôme, rien pour un banni', async () => {
  assert.strictEqual(Rules.SUB_REWARD_GOLD, 5000);
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
  assert.strictEqual(w.chests, 9, 'kill + premier kill + victoire : 3 coffres chacun');
  assert.strictEqual(w.gold, 120, 'kill 30 + victoire 90');
  assert.deepStrictEqual([w.level, w.xp], [3, 500], '300 + 100 + 900 XP');

  const l = (await meOf(lose)).character;
  assert.deepStrictEqual(l.record, { battles: 1, kills: 0, wins: 0 });
  assert.strictEqual(l.xp, 100, 'participation seule (100 XP)');

  const bw = (await meOf(bettorWin)).character;
  assert.strictEqual(bw.gold, 100 - 30 + 80, 'mise + mises perdues');
  assert.strictEqual(bw.counters.betsWon, 1);
  assert.strictEqual((await meOf(bettorLose)).character.gold, 50);

  const board = (await alice.get('/api/leaderboard')).data;
  assert.strictEqual(board.wins[0].name, 'pl_win');
  assert.deepStrictEqual(Object.keys(board), ['wins', 'kills', 'battles', 'expedition', 'dungeon', 'chests', 'legendary', 'survivor', 'fish', 'jackpots', 'casino', 'casinoLoss', 'gold']);
  // Pêcheurs : nombre de poissons pêchés (fishCaught)
  const fisher = Object.values(db.state.users).find((u) => u.username === 'pl_win');
  fisher.character.counters.fishCaught = 7;
  const fishBoard = (await alice.get('/api/leaderboard')).data.fish;
  assert.deepStrictEqual([fishBoard[0].name, fishBoard[0].value], ['pl_win', 7]);
  // Les plus riches : golds possédés en ce moment ; les autres classements suivent leurs compteurs
  const richest = board.gold[0];
  const all = Object.values(db.state.users).filter((u) => u.role === 'player' && u.character && !u.banned);
  assert.strictEqual(richest.value, Math.max(...all.map((u) => u.character.gold)));
  assert.ok(board.gold.every((p, i, l) => i === 0 || l[i - 1].value >= p.value), 'triés du plus riche au moins riche');
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
    assert.strictEqual(ch.counters.soloTroll, 0, 'à deux, ce n\'est pas un exploit solo');
    assert.strictEqual(ch.counters.trollWins, 1);
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

test('[BOSS-8, BOSS-7, LOOK-7] Combat de Boss : l\'admin choisit le boss (Dragon, Magicien), même récompense', async () => {
  await admin.post('/api/admin/battle/reset');
  assert.strictEqual((await admin.post('/api/admin/queue/open', { seconds: 600, mode: 'boss', boss: 'licorne' })).status, 400);
  const r = await admin.post('/api/admin/queue/open', { seconds: 600, mode: 'boss', boss: 'dragon' });
  assert.strictEqual(r.data.boss, 'dragon');
  assert.strictEqual((await alice.get('/api/queue')).data.boss, 'dragon');
  const a = client();
  const ida = (await register(a, 'pl_dragon')).id;
  await a.post('/api/queue/join');
  await admin.post('/api/admin/battle/start');
  battle.stopLoop();
  assert.strictEqual(battle.boss.kind, 'dragon');
  battle.kill(battle.players.find((f) => f.userId === ida), battle.boss);
  battle.tick(0.05);
  assert.strictEqual(battle.result.boss.id, 'dragon');
  const ch = (await meOf(a)).character;
  assert.deepStrictEqual([ch.chests, ch.gold, ch.counters.bossWins], [3, 500, 1]);
  assert.deepStrictEqual([ch.counters.soloDragon, ch.counters.soloTroll], [1, 0], 'Dragon vaincu seul');
  assert.deepStrictEqual([ch.counters.dragonWins, ch.counters.heroDragon], [1, 0], 'victoire comptée, mais pas la peau (pas en Défi Héroïque)');
  // Le Magicien des ténèbres
  await admin.post('/api/admin/queue/open', { seconds: 600, mode: 'boss', boss: 'sorcier' });
  assert.strictEqual((await alice.get('/api/queue')).data.boss, 'sorcier');
  await admin.post('/api/admin/battle/reset');
});

test('[KOTH-6, BET-1, PRG-4, ACH-4] Roi de la Colline : paris ouverts, récompense de victoire au meilleur score', async () => {
  await admin.post('/api/admin/battle/reset');
  const a = client();
  const b = client();
  const ida = (await register(a, 'pl_koth_a')).id;
  const idb = (await register(b, 'pl_koth_b')).id;
  await give(ida, { gold: 100 });
  await give(idb, { gold: 100 });
  await admin.post('/api/admin/queue/open', { seconds: 600, mode: 'koth' });
  await a.post('/api/queue/join');
  await b.post('/api/queue/join');
  assert.strictEqual((await b.post('/api/bet', { target: 'u' + ida, amount: 10 })).status, 200, 'paris ouverts');
  await admin.post('/api/admin/battle/start');
  battle.stopLoop();
  const fa = battle.players.find((f) => f.userId === ida);
  fa.score = 50;
  battle.time = Rules.KOTH.duration;
  battle.tick(0.05);
  assert.strictEqual(battle.result.mode, 'koth');
  assert.strictEqual(battle.result.winner.key, fa.key);
  const ch = (await meOf(a)).character;
  assert.strictEqual(ch.record.wins, 1);
  assert.strictEqual(ch.counters.kothWins, 1);
  assert.strictEqual((await meOf(b)).character.counters.kothWins, 0);
  assert.strictEqual(ch.gold, 100 + Rules.REWARDS.win.gold);
  await admin.post('/api/admin/battle/reset');
});

test('[TRN-1, TRN-6, TRN-7, TRN-8, BET-1] Tournoi : tableau complet, gains par tour, champion, paris et arbre dans l\'historique', async () => {
  await admin.post('/api/admin/battle/reset');
  const a = client();
  const b = client();
  const c = client();
  const ida = (await register(a, 'pl_trn_a')).id;
  const idb = (await register(b, 'pl_trn_b')).id;
  const idc = (await register(c, 'pl_trn_c')).id;
  await give(idc, { gold: 100 });
  await admin.post('/api/admin/queue/open', { seconds: 600, mode: 'tourney' });
  await a.post('/api/queue/join');
  await b.post('/api/queue/join');
  await admin.post('/api/admin/queue/bots', { count: 2 });
  assert.strictEqual((await c.post('/api/bet', { target: 'u' + ida, amount: 40 })).status, 200, 'paris ouverts (sur le champion)');
  // Tableau complet : 32 au plus
  await admin.post('/api/admin/queue/bots', { count: 28 });
  const full = await c.post('/api/queue/join');
  assert.strictEqual(full.status, 400);
  assert.match(full.data.error, /complet/);
  for (const k of [...battle.participants.keys()].filter((k) => k.startsWith('bot')).slice(2)) battle.participants.delete(k);
  assert.strictEqual(battle.participants.size, 4);
  const before = { a: (await meOf(a)).character, b: (await meOf(b)).character };
  await admin.post('/api/admin/battle/start');
  battle.stopLoop();
  assert.strictEqual(battle.tourney.rounds.length, 2);
  // a gagne tous ses matchs ; b perd le sien s'il ne croise pas a
  const fa = battle.players.find((f) => f.userId === ida);
  const fb = battle.players.find((f) => f.userId === idb);
  for (const f of battle.players) if (f !== fa) { f.damage = 0.001; f.lifesteal = 0; f.thorns = 0; f.baseDamage = 0.001; f.baseHp = 50; }
  fa.baseDamage = 1000;
  fa.baseHp = 100000;
  for (let i = 0; i < 20 * 900 && battle.phase === 'battle'; i++) battle.tick(0.05);
  assert.strictEqual(battle.phase, 'ended');
  assert.strictEqual(battle.result.mode, 'tourney');
  assert.strictEqual(battle.result.winner.key, fa.key);
  const ca = (await meOf(a)).character;
  const cb = (await meOf(b)).character;
  const win = Rules.tourneyReward(2, true);
  assert.strictEqual(ca.gold, before.a.gold + win.gold);
  assert.strictEqual(ca.chests, before.a.chests + win.chests);
  assert.strictEqual(ca.record.wins, before.a.record.wins + 1);
  assert.strictEqual(ca.counters.tourneyWins, 1);
  assert.strictEqual(ca.counters.tourneyBest, 2);
  assert.strictEqual(cb.gold, before.b.gold + Rules.tourneyReward(fb.wins).gold, 'b est payé selon les matchs gagnés');
  assert.strictEqual(cb.counters.tourneyWins, 0);
  // Historique : arbre compact, place du joueur
  const h = ca.history[0];
  assert.strictEqual(h.mode, 'tourney');
  assert.strictEqual(h.outcome, 'win');
  assert.strictEqual(h.details.wins, 2);
  assert.strictEqual(h.details.bracket.players.length, 4);
  assert.strictEqual(h.details.bracket.players[h.details.bracket.me].n, 'pl_trn_a');
  assert.strictEqual(h.details.bracket.rounds[1][0][1], h.details.bracket.me, 'le joueur a gagné la finale');
  assert.strictEqual(cb.history[0].outcome, 'loss');
  assert.strictEqual(ca.lifetime.modes.tourney.wins, 1);
  // Paris : seul parieur, sur le champion → remboursé (personne d'autre n'a misé)
  assert.strictEqual((await meOf(c)).character.gold, 100);
  await admin.post('/api/admin/battle/reset');
});

test('[CLAN-1, CLAN-8, CLAN-9, ACH-4] Guerre des clans : !rouge / !bleu, changement de camp, récompenses et paris d\'équipe', async () => {
  await admin.post('/api/admin/battle/reset');
  const a = client();
  const b = client();
  const ida = (await register(a, 'pl_clan_a')).id;
  const idb = (await register(b, 'pl_clan_b')).id;
  await give(idb, { gold: 100 });
  await admin.post('/api/admin/queue/open', { seconds: 600, mode: 'clans' });
  // Site : on choisit son équipe, puis on change d'avis
  assert.strictEqual((await a.post('/api/queue/join', { clan: 'bleu' })).data.clan, 'bleu');
  assert.strictEqual((await a.post('/api/queue/join', { clan: 'rouge' })).data.switched, true);
  await b.post('/api/queue/join', { clan: 'bleu' });
  // Chat : !rouge inscrit chez les Rouges, !bleu fait changer de camp
  chatCommand('!rouge', { login: 'clan_viewer', displayName: 'Clan_Viewer' });
  const viewer = db.findUserByTwitch('clan_viewer');
  assert.strictEqual(battle.participants.get('u' + viewer.id).clan, 'rouge');
  chatCommand('!bleu', { login: 'clan_viewer', displayName: 'Clan_Viewer' });
  assert.strictEqual(battle.participants.get('u' + viewer.id).clan, 'bleu');
  const q = (await alice.get('/api/queue')).data;
  assert.strictEqual(q.participants.find((p) => p.key === 'u' + ida).clan, 'rouge');
  // Paris : sur une équipe
  assert.strictEqual((await b.post('/api/bet', { target: 'u' + ida, amount: 10 })).status, 400);
  assert.strictEqual((await b.post('/api/bet', { target: 'clan:rouge', amount: 10 })).status, 200);
  await admin.post('/api/admin/battle/start');
  battle.stopLoop();
  const fa = battle.players.find((f) => f.userId === ida);
  assert.strictEqual(fa.clan, 'rouge', 'l\'équipe choisie survit au recalcul des stats du lancement');
  fa.dealt = 9999; // MVP
  battle.kill(fa, battle.clans.crystals.bleu);
  battle.tick(0.05);
  assert.strictEqual(battle.result.winner, 'rouge');
  const ca = (await meOf(a)).character;
  assert.strictEqual(ca.gold, Rules.CLANS.reward.gold);
  assert.strictEqual(ca.chests, Rules.CLANS.reward.chests + Rules.CLANS.mvpChests, 'victoire + MVP');
  assert.strictEqual(ca.record.wins, 1);
  assert.deepStrictEqual([ca.counters.clansWins, ca.counters.clansMvp], [1, 1]);
  const cb = (await meOf(b)).character;
  assert.deepStrictEqual([cb.counters.clansWins, cb.counters.clansMvp], [0, 0]);
  assert.strictEqual(cb.chests, 0, 'perdant : pas de coffre');
  assert.strictEqual(cb.gold, 100, 'pari gagné : sa mise lui revient (seul parieur)');
  assert.strictEqual(cb.record.battles, 1);
  await admin.post('/api/admin/battle/reset');
});

test('[GOLD-5, GOLD-1, ACH-4] Ruée vers l\'or : chacun garde son butin, +1 coffre au meilleur, potion gardée', async () => {
  await admin.post('/api/admin/battle/reset');
  const a = client();
  const b = client();
  const ida = (await register(a, 'pl_gold_a')).id;
  const idb = (await register(b, 'pl_gold_b')).id;
  await give(ida, { gold: 90 });
  await a.post('/api/consumable/buy', { id: 'vie' });
  await a.post('/api/consumable/equip', { id: 'vie' });
  await admin.post('/api/admin/queue/open', { seconds: 600, mode: 'gold' });
  await a.post('/api/queue/join');
  await b.post('/api/queue/join');
  assert.strictEqual((await b.post('/api/bet', { target: 'u' + ida, amount: 1 })).status, 400, 'pas de paris');
  await admin.post('/api/admin/battle/start');
  battle.stopLoop();
  const fa = battle.players.find((f) => f.userId === ida);
  const fb = battle.players.find((f) => f.userId === idb);
  Object.assign(fa, { goldGot: 120, chestsGot: 2 });
  Object.assign(fb, { goldGot: 30, chestsGot: 0 });
  battle.finishGold();
  const ca = (await meOf(a)).character;
  assert.strictEqual(ca.gold, 120);
  assert.strictEqual(ca.chests, 3, '2 ramassés + 1 pour le meilleur');
  assert.strictEqual(ca.consumableSlot, 'vie', 'la potion n\'est pas consommée');
  assert.strictEqual(ca.counters.goldBest, 120, 'record de butin en un Golden Shower');
  const cb = (await meOf(b)).character;
  assert.deepStrictEqual([cb.gold, cb.chests, cb.xp, cb.record.battles], [30, 0, 25, 1]);
  await admin.post('/api/admin/battle/reset');
});

test('[DNG-7, DNG-8, MODE-6, ACH-1, LB-1] Raid de Donjon : récompense selon la salle atteinte, record de salle', async () => {
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
  assert.ok((await a.get('/api/leaderboard')).data.dungeon.some((p) => p.value === 11), 'classement Raid de Donjon');
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

test('[DNG-11, DNG-12, DNG-14] sondage du donjon : votes du chat et du site, clôture admin, golds pour tous', async () => {
  await admin.post('/api/admin/battle/reset');
  const a = client();
  const b = client();
  const ida = (await register(a, 'pl_poll_a')).id;
  const idb = (await register(b, 'pl_poll_b')).id;
  await a.post('/api/twitch/link-dev', { login: 'poll_a' });
  await admin.post('/api/admin/queue/open', { seconds: 600, mode: 'dungeon' });
  await a.post('/api/queue/join');
  await b.post('/api/queue/join');
  await admin.post('/api/admin/battle/start');
  battle.stopLoop();
  // Hors sondage : refusé
  assert.strictEqual((await a.post('/api/poll/vote', { choice: 'or' })).status, 400);
  assert.strictEqual((await admin.post('/api/admin/poll/close')).status, 400);
  battle.dungeon.room = 4;
  battle.nextRoom();
  battle.setStage('fight');
  for (const m of battle.monsters) battle.kill(null, m);
  battle.tick(0.05);
  while (battle.dungeon.stage === 'clear') battle.tick(0.05);
  assert.strictEqual(battle.dungeon.stage, 'poll');
  battle.dungeon.poll.options = ['or', 'rage'];
  // Le joueur B est mort : il touchera quand même les golds
  battle.kill(null, battle.players.find((f) => f.userId === idb));

  chatCommand('!rage', { login: 'Viewer1', displayName: 'Viewer1' });
  chatCommand('!2', { login: 'viewer2', displayName: 'viewer2' });
  chatCommand('!rage', { login: 'poll_a', displayName: 'poll_a' });
  // Le site et le chat partagent la voix d'un compte lié : ce vote remplace son !rage
  assert.deepStrictEqual((await a.post('/api/poll/vote', { choice: 'or' })).data, { ok: true, choice: 'or' });
  assert.deepStrictEqual((await b.post('/api/poll/vote', { choice: 'or' })).data, { ok: true, choice: 'or' });
  assert.strictEqual((await b.post('/api/poll/vote', { choice: 'vie' })).status, 400, 'pas dans ce sondage');
  // Un compte banni ne vote pas ; un spectateur sans compte, si
  const banned = game.getOrCreateTwitchUser('poll_banni', 'poll_banni');
  await admin.post(`/api/admin/players/${banned.id}/ban`, { banned: true });
  chatCommand('!rage', { login: 'poll_banni', displayName: 'poll_banni' });
  chatCommand('!or', { login: 'viewer3', displayName: 'viewer3' });
  battle.tick(2); // décompte renvoyé aux pages
  const q = (await alice.get('/api/queue')).data;
  assert.deepStrictEqual(q.poll.options, [{ id: 'or', votes: 3 }, { id: 'rage', votes: 2 }]);
  assert.ok(q.poll.endsAt > Date.now());

  assert.strictEqual((await admin.post('/api/admin/poll/close')).status, 200);
  assert.strictEqual(battle.dungeon.stage, 'exit');
  assert.strictEqual((await meOf(a)).character.gold, 50);
  assert.strictEqual((await meOf(b)).character.gold, 50, 'mort, mais participant');
  await admin.post('/api/admin/battle/reset');
});

test('[CON-4, Q-7] potions : la potion équipée est consommée au lancement, même sans se déclencher', async () => {
  await admin.post('/api/admin/battle/reset');
  const c = client();
  const id = (await register(c, 'pl_potion')).id;
  await give(id, { gold: 500, xp: 1500 }); // 300 + 500 + 700 XP : niveau 4, un point d'arbre
  assert.strictEqual((await c.post('/api/class', { cls: 'guerrier' })).status, 200);
  assert.strictEqual((await c.post('/api/talent/learn', { id: 'left.ult' })).status, 200);
  assert.strictEqual((await c.post('/api/consumable/buy', { id: 'phenix', count: 1 })).status, 200);
  assert.strictEqual((await c.post('/api/consumable/equip', { id: 'phenix' })).status, 200);
  assert.strictEqual((await meOf(c)).character.consumableSlot, 'phenix');
  await admin.post('/api/admin/queue/open', { seconds: 600, mode: 'boss' });
  await c.post('/api/queue/join');
  await admin.post('/api/admin/battle/start');
  battle.stopLoop();
  const f = battle.players.find((x) => x.userId === id);
  assert.strictEqual(f.consumable, 'phenix');
  assert.deepStrictEqual(f.ult, { id: 'rempart', enhanced: false });
  const ch = (await meOf(c)).character;
  assert.strictEqual(ch.consumableSlot, null, 'consommée au lancement');
  assert.deepStrictEqual(ch.consumables, {});
  await admin.post('/api/admin/battle/reset');
});

test('[TRN-1, TRN-2, TRN-3, TRN-4, TAL-6] entraînement : duel privé contre un mannequin ou un fantôme, sans récompense', async () => {
  const { trainings } = require('../server/index');
  const c = client();
  const other = client();
  const id = (await register(c, 'pl_train')).id;
  const otherId = (await register(other, 'pl_ghost')).id;
  assert.match((await c.post('/api/training/start', { opponent: 'bot', level: 5 })).data.error, /classe/);
  await c.post('/api/class', { cls: 'archer' });
  await other.post('/api/class', { cls: 'mage' });
  await give(id, { gold: 100 });
  await c.post('/api/consumable/buy', { id: 'vie' });
  await c.post('/api/consumable/equip', { id: 'vie' });

  // Mannequin de niveau 30 : arbre complet, ultime amélioré, niveau borné à 50
  const r = await c.post('/api/training/start', { opponent: 'bot', cls: 'pretre', level: 30 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(r.data.opponent.cls, 'pretre');
  const b = trainings.get(id);
  assert.ok(b && b !== battle, 'bataille séparée de celle du stream');
  b.stopLoop();
  const [me, bot] = b.fighters;
  assert.strictEqual(me.consumable, 'vie', 'potion active en entraînement');
  assert.ok(bot.ult && bot.ult.enhanced, 'mannequin avec un arbre complet');
  assert.strictEqual(bot.consumable, null);
  assert.strictEqual((await c.post('/api/training/start', { opponent: 'bot', level: 999 })).data.opponent.level, 50);
  assert.notStrictEqual(trainings.get(id), b, 'relancer remplace le duel précédent');

  // Fantôme d'un autre joueur ; refus de soi-même et d'un inconnu
  assert.match((await c.post('/api/training/start', { opponent: 'player', id })).data.error, /autre joueur/);
  assert.match((await c.post('/api/training/start', { opponent: 'player', id: 'inconnu' })).data.error, /introuvable/);
  const opponents = (await c.get('/api/training/opponents')).data;
  assert.ok(opponents.some((p) => p.id === otherId) && !opponents.some((p) => p.id === id));
  assert.strictEqual((await c.post('/api/training/start', { opponent: 'player', id: otherId })).status, 200);
  const duel = trainings.get(id);
  duel.stopLoop();
  const ghost = duel.fighters[1];
  assert.strictEqual(ghost.cls, 'mage');
  assert.strictEqual(ghost.userId, null, 'le fantôme ne gagne rien');

  // Fin du duel : aucune récompense, aucun compteur, potion toujours équipée
  const before = (await meOf(c)).character;
  duel.kill(duel.fighters[0], ghost);
  duel.finish(duel.fighters[0]);
  const after = (await meOf(c)).character;
  assert.deepStrictEqual(after.record, before.record);
  assert.strictEqual(after.xp, before.xp);
  assert.strictEqual(after.consumableSlot, 'vie', 'potion non consommée');
  assert.ok(!trainings.has(id), 'entraînement terminé');

  // Arrêt manuel
  await c.post('/api/training/start', { opponent: 'bot', level: 3 });
  assert.ok(trainings.has(id));
  await c.post('/api/training/stop');
  assert.ok(!trainings.has(id));
  assert.strictEqual(Rules.TRAINING.maxDuration, 150);
  assert.strictEqual(Rules.TRAINING.maxConcurrent, 20);
});

test('[LOOK-5, LOOK-8] bots sans skin interdit ; visage dessiné : enregistrement, lecture publique, modération', async () => {
  await admin.post('/api/admin/battle/reset');
  await admin.post('/api/admin/queue/open', { seconds: 600 });
  await admin.post('/api/admin/queue/bots', { count: 60 });
  for (const p of battle.participants.values()) {
    for (const [slot, id] of Object.entries(p.app)) {
      const it = Rules.COSMETICS[id];
      if (!Rules.COSMETIC_SLOTS[slot] || !it) continue;
      assert.ok(!it.unlock && it.slot !== 'drawing' && (!it.cls || it.cls === p.cls), `${p.name} : ${id}`);
    }
  }
  await admin.post('/api/admin/battle/reset');

  const d = client();
  const id = (await register(d, 'pl_dessin')).id;
  const pixels = '0'.repeat(30) + '1111' + '0'.repeat(110);
  assert.strictEqual((await d.post('/api/drawing', { pixels })).status, 400, 'il faut acheter l\'article');
  await give(id, { gold: 1500 });
  assert.strictEqual((await d.post('/api/shop/buy', { id: 'dessin' })).status, 200);
  assert.match((await d.post('/api/drawing', { pixels: '0'.repeat(144) })).data.error, /vide/);
  assert.match((await d.post('/api/drawing', { pixels: '9'.repeat(144) })).data.error, /invalide/);
  assert.match((await d.post('/api/drawing', { pixels: '1'.repeat(10) })).data.error, /invalide/);
  const r = await d.post('/api/drawing', { pixels });
  assert.strictEqual(r.data.ver, 1);
  const pub = await client().get('/api/drawing/' + id);
  assert.deepStrictEqual(pub.data, { pixels, ver: 1 });
  // Dans la file : seulement une référence id.version
  await admin.post('/api/admin/queue/open', { seconds: 600 });
  await d.post('/api/queue/join');
  const q = (await d.get('/api/queue')).data;
  const me = q.participants.find((p) => p.key === 'u' + id);
  assert.strictEqual(me.app.drawing, `${id}.1`);
  assert.ok(!JSON.stringify(q).includes(pixels), 'le dessin n\'est pas diffusé dans la file');
  await admin.post('/api/admin/battle/reset');
  // Modération
  assert.strictEqual((await players()).find((p) => p.id === id).drawing, pixels);
  assert.strictEqual((await admin.post(`/api/admin/players/${id}/drawing/clear`)).status, 200);
  assert.strictEqual((await client().get('/api/drawing/' + id)).status, 404);
  const ch = (await meOf(d)).character;
  assert.deepStrictEqual([ch.drawing, ch.look.drawing, ch.owned.includes('dessin')], ['', null, true]);
});

test('[SOLO-1, SOLO-2, SOLO-5, SOLO-6, SOLO-7, SOLO-9, LOOK-7, ACH-4, ADM-3] mode Solo via l\'API : énergie, clés, expédition, défi, redémarrage', async () => {
  const s = client();
  const id = (await register(s, 'pl_solo_v2')).id;
  assert.match((await s.post('/api/solo/start', { kind: 'expedition' })).data.error, /classe/);
  await s.post('/api/class', { cls: 'mage' });
  assert.match((await s.post('/api/solo/start', { kind: 'nage' })).data.error, /inconnu/);
  assert.match((await s.post('/api/solo/start', { kind: 'boss', boss: 'licorne' })).data.error, /Boss inconnu/);
  assert.match((await s.post('/api/solo/start', { kind: 'boss', difficulty: 'facile' })).data.error, /Difficulté inconnue/);
  assert.strictEqual((await meOf(s)).character.energyState.value, 3);

  // Expédition : potion gardée, vitesse, abandon avec le butin des profondeurs nettoyées
  const user = db.state.users[id];
  user.character.consumables = { vie: 1 };
  user.character.consumableSlot = 'vie';
  const r = await s.post('/api/solo/start', { kind: 'expedition', speed: 2 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(r.data.energy.value, 2);
  const b = solos.get(id);
  b.stopLoop();
  assert.strictEqual(b.speed, 2);
  assert.strictEqual(b.players[0].consumable, null);
  assert.match((await s.post('/api/solo/start', { kind: 'expedition' })).data.error, /déjà/);
  assert.match((await s.post('/api/solo/relic', { id: 'fiole' })).data.error, /pas proposée/);
  assert.strictEqual((await s.post('/api/solo/speed', { speed: 3 })).status, 400);
  assert.strictEqual((await s.post('/api/solo/speed', { speed: 1 })).data.speed, 1);
  const st = (await s.get('/api/solo/state')).data;
  assert.strictEqual(st.queue.solo.kind, 'expedition');
  for (let i = 0; i < 20 * 120 && b.dungeon.cleared < 2; i++) {
    if (b.dungeon.stage === 'fight') for (const m of b.monsters) if (m.alive) b.kill(b.players[0], m);
    if (b.dungeon.stage === 'relic') b.chooseRelic(b.dungeon.relicChoice[0]);
    b.tick(0.05);
  }
  b.dungeon.keys = 2; // deux Clés de boss ramassées dans les reliques
  const before = (await meOf(s)).character;
  assert.ok(before.soloActive);
  assert.strictEqual((await s.post('/api/solo/abandon')).status, 200);
  let ch = (await meOf(s)).character;
  const rw = Rules.expeditionReward(2);
  assert.strictEqual(ch.gold, before.gold + rw.gold);
  assert.deepStrictEqual([ch.counters.expeditionBest, ch.soloActive, ch.consumableSlot], [2, null, 'vie'], 'record, partie terminée, potion intacte');
  assert.strictEqual(ch.counters.relics, b.dungeon.relics.length, 'reliques choisies comptées');
  assert.strictEqual(ch.bossKeys, before.bossKeys + 2, 'clés de l\'expédition gardées');
  assert.strictEqual(ch.bossKeys, 3, 'une clé de départ + deux trouvées');
  const board = (await s.get('/api/leaderboard')).data;
  assert.ok(board.expedition.some((p) => p.id === id && p.value === 2), 'classement Expédition');
  assert.strictEqual(solos.has(id), false);
  assert.strictEqual((await s.post('/api/solo/abandon')).status, 400);

  // Défi des boss : le Magicien vaincu seul → exploit et butin
  assert.strictEqual((await s.post('/api/solo/start', { kind: 'boss', boss: 'sorcier', difficulty: 'normal' })).status, 200);
  const bb = solos.get(id);
  bb.stopLoop();
  bb.kill(bb.players[0], bb.boss);
  bb.tick(0.05);
  ch = (await meOf(s)).character;
  assert.deepStrictEqual([ch.counters.soloSorcier, ch.gold, ch.energyState.value, ch.bossKeys], [1, before.gold + rw.gold + Rules.BOSS_CHALLENGE.normal.reward.gold, 2, 2],
    'le défi coûte une clé, pas d\'énergie');
  assert.deepStrictEqual([ch.counters.sorcierWins, ch.counters.challengeWins, ch.counters.heroWins, ch.counters.heroSorcier], [1, 1, 0, 0],
    'Normal : pas de peau légendaire');
  assert.strictEqual((await s.post('/api/solo/start', { kind: 'boss', boss: 'sorcier', difficulty: 'legendaire' })).status, 200);
  const bh = solos.get(id);
  bh.stopLoop();
  bh.kill(bh.players[0], bh.boss);
  bh.tick(0.05);
  ch = (await meOf(s)).character;
  assert.deepStrictEqual([ch.counters.heroSorcier, ch.counters.heroWins, ch.counters.legendWins, ch.counters.challengeWins], [1, 1, 1, 2]);
  assert.strictEqual(Rules.cosmeticLocked(ch, 'peau_spectre'), false, 'Légendaire : peau débloquée');
  // Redémarrage pendant un défi : la clé est rendue
  assert.strictEqual((await s.post('/api/solo/start', { kind: 'boss', boss: 'troll' })).status, 200);
  assert.strictEqual(user.character.bossKeys, 0);
  assert.match((await s.post('/api/solo/start', { kind: 'boss', boss: 'troll' })).data.error, /déjà/);
  const rb = solos.get(id);
  rb.stopLoop();
  rb.removeAllListeners();
  solos.delete(id);
  assert.strictEqual(refundSoloRuns(), 1);
  assert.deepStrictEqual([user.character.bossKeys, game.energyOf(user.character).value], [1, 2], 'clé rendue, énergie intacte');
  user.character.bossKeys = 0;
  assert.match((await s.post('/api/solo/start', { kind: 'boss', boss: 'troll' })).data.error, /Il te faut une Clé de boss/);
  assert.strictEqual((await give(id, { keys: 2 })).status, 200);
  assert.strictEqual((await meOf(s)).character.bossKeys, 2, 'l\'admin peut donner des clés');
  user.character.energy.value = 1;

  // Redémarrage pendant une partie : énergie rendue
  assert.strictEqual((await s.post('/api/solo/start', { kind: 'expedition' })).status, 200);
  const run = solos.get(id);
  run.stopLoop();
  run.removeAllListeners();
  solos.delete(id);
  assert.strictEqual(game.energyOf(user.character).value, 0);
  assert.match((await s.post('/api/solo/start', { kind: 'expedition' })).data.error, /déjà/, 'partie encore marquée en cours');
  assert.strictEqual(refundSoloRuns(), 1);
  ch = (await meOf(s)).character;
  assert.deepStrictEqual([ch.energyState.value, ch.soloActive], [1, null]);
  // Sans énergie
  assert.strictEqual((await s.post('/api/solo/start', { kind: 'expedition' })).status, 200);
  const last = solos.get(id);
  last.stopLoop();
  last.abandon();
  assert.match((await s.post('/api/solo/start', { kind: 'expedition' })).data.error, /Plus d'énergie/);
  // L'admin peut rendre de l'énergie (sans dépasser le maximum)
  assert.strictEqual((await give(id, { energy: 9 })).status, 200);
  assert.strictEqual((await meOf(s)).character.energyState.value, 3);
});

test('[TRN-5] entraînement : répéter l\'Expédition et le Défi des boss sans énergie ni récompense', async () => {
  const t = client();
  const id = (await register(t, 'pl_trn_solo')).id;
  await t.post('/api/class', { cls: 'guerrier' });
  const before = (await meOf(t)).character;
  assert.strictEqual(before.energyState.value, 3);
  assert.match((await t.post('/api/training/start', { opponent: 'boss', boss: 'licorne' })).data.error, /Boss inconnu/);
  assert.match((await t.post('/api/training/start', { opponent: 'boss', difficulty: 'facile' })).data.error, /Difficulté inconnue/);
  assert.strictEqual((await t.post('/api/training/relic', { id: 'fiole' })).status, 400, 'aucun entraînement solo en cours');

  // Expédition : reliques et vitesse, puis abandon
  const r = await t.post('/api/training/start', { opponent: 'expedition', speed: 2 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const b = trainings.get(id);
  b.stopLoop();
  assert.deepStrictEqual([b.solo.kind, b.solo.training, b.speed, b.players[0].consumable], ['expedition', true, 2, null]);
  assert.strictEqual(solos.has(id), false, 'pas une vraie partie solo');
  assert.strictEqual((await t.post('/api/training/speed', { speed: 1 })).data.speed, 1);
  for (let i = 0; i < 20 * 120 && b.dungeon.stage !== 'relic'; i++) {
    if (b.dungeon.stage === 'fight') for (const m of b.monsters) if (m.alive) b.kill(b.players[0], m);
    b.tick(0.05);
  }
  const pick = b.dungeon.relicChoice[0];
  assert.strictEqual((await t.post('/api/training/relic', { id: pick })).data.id, pick);
  b.abandon();
  assert.strictEqual(b.result.training, true);
  assert.strictEqual(b.result.depth, 3);
  let ch = (await meOf(t)).character;
  assert.deepStrictEqual([ch.energyState.value, ch.gold, ch.xp, ch.chests, ch.counters.expeditionBest, ch.counters.relics, ch.soloActive],
    [3, before.gold, before.xp, before.chests, 0, 0, null], 'ni énergie dépensée, ni gains, ni record');

  // Défi des boss en Légendaire : victoire sans récompense ni exploit
  assert.strictEqual((await t.post('/api/training/start', { opponent: 'boss', boss: 'troll', difficulty: 'legendaire' })).status, 200);
  const bb = trainings.get(id);
  bb.stopLoop();
  assert.strictEqual(bb.boss.maxHp, Math.round(Rules.bossStats(1, 'troll', 1).maxHp * Rules.BOSS_SOLO_SCALE.troll.hp * Rules.BOSS_CHALLENGE.legendaire.hp));
  bb.kill(bb.players[0], bb.boss);
  bb.tick(0.05);
  assert.deepStrictEqual([bb.result.victory, bb.result.training], [true, true]);
  ch = (await meOf(t)).character;
  assert.deepStrictEqual([ch.energyState.value, ch.gold, ch.chests, ch.counters.heroTroll, ch.counters.trollWins, ch.counters.challengeWins, ch.record.battles],
    [3, before.gold, before.chests, 0, 0, 0, 0]);
  assert.strictEqual(trainings.has(id), false, 'terminé');
});

test('[MKT-1, MKT-2, MKT-3, MKT-4, MKT-5] marché via l\'API : vendre, lister, acheter, retirer, courrier', async () => {
  const sel = client();
  const buyer = client();
  const ids = (await register(sel, 'pl_vendeur')).id;
  const idb = (await register(buyer, 'pl_acheteur')).id;
  await give(ids, { gold: 100 });
  await give(idb, { gold: 500 });
  const seller = db.state.users[ids];
  const item = game.makeItem('rare');
  seller.character.inventory.push(item);
  const events = [];
  const onEmit = io.emit.bind(io);
  io.emit = (ev, ...args) => { events.push(ev); return onEmit(ev, ...args); };
  const r = await sel.post('/api/market/sell', { itemId: item.id, price: 150 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(r.data.tax, 30);
  assert.strictEqual((await meOf(sel)).character.gold, 70);
  const listed = (await buyer.get('/api/market')).data;
  const order = listed.orders.find((o) => o.item.id === item.id);
  assert.ok(order, 'listé');
  assert.deepStrictEqual([order.price, order.seller, listed.mine], [150, 'pl_vendeur', 0]);
  assert.strictEqual((await sel.get('/api/market')).data.mine, 1);
  assert.match((await sel.post('/api/market/buy', { orderId: order.id })).data.error, /propre objet/);
  const bought = await buyer.post('/api/market/buy', { orderId: order.id });
  assert.strictEqual(bought.status, 200);
  const cb = (await meOf(buyer)).character;
  assert.ok(cb.inventory.some((i) => i.id === item.id));
  assert.strictEqual(cb.gold, 350);
  let cs = (await meOf(sel)).character;
  assert.strictEqual(cs.gold, 220);
  assert.ok(cs.mail[0].text.includes('pl_acheteur') && !cs.mail[0].read);
  assert.strictEqual((await sel.post('/api/mail/read')).status, 200);
  cs = (await meOf(sel)).character;
  assert.ok(cs.mail.every((m) => m.read));
  // Retrait
  const it2 = game.makeItem('commun');
  seller.character.inventory.push(it2);
  const o2 = (await sel.post('/api/market/sell', { itemId: it2.id, price: 10 })).data.orderId;
  assert.strictEqual((await buyer.post('/api/market/cancel', { orderId: o2 })).status, 400);
  assert.strictEqual((await sel.post('/api/market/cancel', { orderId: o2 })).status, 200);
  assert.ok((await meOf(sel)).character.inventory.some((i) => i.id === it2.id));
  io.emit = onEmit;
  assert.ok(events.filter((e) => e === 'market').length >= 3, 'diffusion « market »');
});

test('[PWR-1, PWR-2, PWR-3] Battle Royale : le plus faible est renforcé au lancement, mêmes récompenses pour tous', async () => {
  await admin.post('/api/admin/battle/reset');
  const strong = client();
  const weak = client();
  const ids = (await register(strong, 'pl_fort')).id;
  const idw = (await register(weak, 'pl_faible')).id;
  db.state.users[ids].character.level = 20; // puissance 20 (sans équipement) contre 1
  const events = [];
  const sock = io.to.bind(io);
  io.to = (room) => { const r = sock(room); return { emit: (ev, data) => { if (room === 'user:' + idw && ev === 'reward') events.push(data); return r.emit(ev, data); } }; };
  const play = async (winnerId, loserId) => {
    await admin.post('/api/admin/queue/open', { seconds: 600 });
    await strong.post('/api/queue/join');
    await weak.post('/api/queue/join');
    await admin.post('/api/admin/battle/start');
    battle.stopLoop();
    const S = battle.players.find((f) => f.userId === ids);
    const W = battle.players.find((f) => f.userId === idw);
    assert.deepStrictEqual([S.power, W.power], [20, 1]);
    // Bonus du plus faible : √(20 / 1) plafonné à ×1,75 ; le fort n'est pas affaibli
    assert.deepStrictEqual([S.boost, W.boost], [undefined, 1.75]);
    assert.strictEqual(W.maxHp, Math.round(battle.participants.get('u' + idw).stats.maxHp * 1.75), 'vie ×1,75');
    const w = battle.players.find((f) => f.userId === winnerId);
    const l = battle.players.find((f) => f.userId === loserId);
    battle.kill(w, l);
    battle.tick(0.05);
  };
  // Le fort bat le faible, puis le faible bat le fort : mêmes gains (kill 30 + victoire 90, 3 coffres chacun)
  const goldS = (await meOf(strong)).character.gold;
  await play(ids, idw);
  assert.strictEqual((await meOf(strong)).character.gold - goldS, 30 + 90);
  const before = (await meOf(weak)).character;
  await play(idw, ids);
  const after = (await meOf(weak)).character;
  assert.strictEqual(after.gold - before.gold, 30 + 90);
  assert.strictEqual(after.chests - before.chests, 3 + 3 + 3, 'kill, premier kill et victoire : 3 coffres chacun');
  io.to = sock;
  assert.ok(events.every((e) => e.mult === undefined), 'plus de multiplicateur de puissance');
  assert.ok(events.some((e) => e.type === 'participation' && e.reward.xp === 100), 'participation : 100 XP');
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

test('[CHEST-4] badge « Nouveau ! » : objets de coffre marqués, retirés par /api/items/seen', async () => {
  const n = client();
  const id = (await register(n, 'pl_new_badge')).id;
  await give(id, { chests: 1 });
  const open = await n.post('/api/chest/open', {});
  assert.strictEqual(open.status, 200, JSON.stringify(open.data));
  let inv = (await meOf(n)).character.inventory;
  assert.strictEqual(inv.filter((i) => i.isNew).length, Rules.ITEMS_PER_CHEST);
  assert.strictEqual((await n.post('/api/items/seen', { ids: 'x' })).status, 400);
  const r = await n.post('/api/items/seen', { ids: [inv[0].id, inv[1].id] });
  assert.deepStrictEqual(r.data, { ok: true, seen: 2 });
  inv = (await meOf(n)).character.inventory;
  assert.strictEqual(inv.filter((i) => i.isNew).length, Rules.ITEMS_PER_CHEST - 2);
  assert.strictEqual(db.state.users[id].character.inventory.find((i) => i.id === inv[0].id).isNew, undefined, 'sauvegardé');
});

test('[PET-1, PET-5, PET-7, PET-8, RUSH-2, RUSH-4] familiers et Boss Rush via l\'API', async () => {
  const s = client();
  const id = (await register(s, 'pl_pets')).id;
  await s.post('/api/class', { cls: 'guerrier' });
  assert.match((await s.post('/api/pet/action', { kind: 'caresser' })).data.error, /pas encore de familier/);
  // L'admin donne un familier
  assert.strictEqual((await give(id, { pet: 'dragon' })).status, 200);
  let ch = (await meOf(s)).character;
  assert.deepStrictEqual([ch.pets.list.length, ch.pets.active], [1, 'dragon']);
  assert.strictEqual((await s.post('/api/pet/action', { kind: 'caresser' })).status, 200);
  assert.match((await s.post('/api/pet/action', { kind: 'caresser' })).data.error, /repos/);
  await give(id, { gold: 1500 });
  assert.strictEqual((await s.post('/api/pet/food/buy', { food: 'festin', count: 2 })).status, 200);
  const fed = await s.post('/api/pet/feed', { food: 'festin' });
  assert.deepStrictEqual([fed.status, fed.data.favorite], [200, true], 'le festin est le plat préféré du dragon');
  assert.strictEqual((await s.post('/api/pet/enclos/buy', { item: 'fleurs' })).status, 200);
  assert.strictEqual((await s.post('/api/pet/rename', { id: 'dragon', name: '  Braisou<b>  ' })).data.name, 'Braisoub');
  assert.match((await s.post('/api/pet/collect')).data.error, /Aucune trouvaille/);
  assert.match((await s.post('/api/pet/follow', { id: 'dragon' })).data.error, /pas encore prêt/);
  // Trouvailles en attente puis récupération
  const pet = db.state.users[id].character.pets.list[0];
  pet.finds = 2;
  const gold = (await meOf(s)).character.gold;
  const col = await s.post('/api/pet/collect');
  assert.strictEqual(col.data.gifts.length, 2);
  assert.strictEqual((await meOf(s)).character.gold, gold + 2 * Rules.petFindValue('dragon', pet.level));
  // Compagnon de combat débloqué : il suit le héros dans les parties
  pet.follower = true;
  assert.strictEqual((await s.post('/api/pet/follow', { id: 'dragon' })).data.follow, 'dragon');
  // Boss Rush : un boss vaincu compte tout de suite, puis récompense de fin selon les boss vaincus
  await admin.post('/api/admin/battle/reset');
  assert.strictEqual((await admin.post('/api/admin/queue/open', { seconds: 60, mode: 'rush' })).status, 200);
  assert.strictEqual((await s.post('/api/queue/join')).status, 200);
  assert.strictEqual((await admin.post('/api/admin/battle/start')).status, 200);
  battle.stopLoop();
  assert.strictEqual(battle.players[0].pet, 'dragon', 'le compagnon suit son héros');
  for (let i = 0; i < 70; i++) battle.tick(0.05);
  const first = battle.bossId;
  const before = (await meOf(s)).character;
  battle.kill(battle.players[0], battle.boss);
  battle.tick(0.05);
  ch = (await meOf(s)).character;
  assert.strictEqual(ch.counters.bossWins, before.counters.bossWins + 1);
  assert.strictEqual(ch.counters[Rules.BOSS_WIN_COUNTER[first]], (before.counters[Rules.BOSS_WIN_COUNTER[first]] || 0) + 1);
  for (let i = 0; i < 80; i++) battle.tick(0.05);
  assert.ok(battle.publicPoll() && battle.publicPoll().rush);
  assert.strictEqual((await s.post('/api/poll/vote', { choice: 'defi' })).data.choice, 'defi');
  battle.closePoll();
  ch = (await meOf(s)).character;
  assert.strictEqual(ch.gold, before.gold + Rules.RUSH.defiGold, 'quitte ou double : golds tout de suite');
  for (let i = 0; i < 70; i++) battle.tick(0.05);
  battle.kill(battle.boss, battle.players[0]);
  battle.tick(0.05);
  assert.strictEqual(battle.phase, 'ended');
  ch = (await meOf(s)).character;
  assert.strictEqual(ch.counters.rushBest, 1);
  assert.strictEqual(ch.gold, before.gold + Rules.RUSH.defiGold + Rules.rushReward(1).gold);
  await admin.post('/api/admin/battle/reset');
});

test('[HIST-1, HIST-4, LIFE-1, RUSH-5] historique et statistiques via l\'API, vues admin, Boss Rush d\'entraînement', async () => {
  const s = client();
  const id = (await register(s, 'pl_hist')).id;
  await s.post('/api/class', { cls: 'guerrier' });
  // Une partie de Battle Royale contre un bot : ligne d'historique avec les gains de la partie
  await admin.post('/api/admin/battle/reset');
  await admin.post('/api/admin/queue/open', { seconds: 60, mode: 'br' });
  await s.post('/api/queue/join');
  await admin.post('/api/admin/queue/bots', { count: 1 });
  assert.strictEqual((await admin.post('/api/admin/battle/start')).status, 200);
  battle.stopLoop();
  const me = battle.players.find((p) => p.userId === id);
  const bot = battle.players.find((p) => p.key.startsWith('bot'));
  battle.hit(bot, me, 30);
  battle.tick(0.05);
  battle.kill(me, bot);
  battle.tick(0.05);
  assert.strictEqual(battle.phase, 'ended');
  let ch = (await meOf(s)).character;
  const e = ch.history[0];
  assert.deepStrictEqual([e.mode, e.outcome, e.rank, e.total, e.kills], ['br', 'win', 1, 2, 1]);
  assert.ok(e.taken >= 1 && e.dealt >= 1);
  const kill = Rules.REWARDS.kill;
  assert.ok(e.gains.gold >= Rules.REWARDS.win.gold + kill.gold, 'gains de la partie (participation, kill, victoire)');
  assert.ok(e.gear && e.stats && e.level === ch.level);
  assert.deepStrictEqual(ch.lifetime.modes.br, { games: 1, wins: 1 });
  assert.ok(ch.lifetime.goldEarned >= e.gains.gold);
  // Solo : l'expédition abandonnée est aussi enregistrée
  assert.strictEqual((await s.post('/api/solo/start', { kind: 'expedition' })).status, 200);
  solos.get(id).stopLoop();
  await s.post('/api/solo/abandon');
  ch = (await meOf(s)).character;
  assert.deepStrictEqual([ch.history[0].mode, ch.history[0].details.depth, ch.history[0].details.abandoned], ['expedition', 0, true]);
  assert.strictEqual(ch.lifetime.expeditions, 1);
  // Admin : historique de tous les joueurs, filtrable
  assert.strictEqual((await s.get('/api/admin/history')).status, 403);
  const all = (await admin.get('/api/admin/history?q=pl_hist')).data;
  assert.ok(all.length >= 2 && all.every((r) => r.name === 'pl_hist'));
  assert.ok((await admin.get('/api/admin/history?mode=expedition&q=pl_hist')).data.every((r) => r.mode === 'expedition'));
  // Admin : échanges du marché et signaux suspects
  const buyer = client();
  const buyerId = (await register(buyer, 'pl_hist_buy')).id;
  await give(buyerId, { gold: 1000 });
  await give(id, { gold: 1000 });
  for (let i = 0; i < 3; i++) {
    const item = game.makeItem(i === 0 ? 'legendaire' : 'commun');
    db.state.users[id].character.inventory.push(item);
    const r = await s.post('/api/market/sell', { itemId: item.id, price: Rules.MARKET.minPrice });
    assert.strictEqual((await buyer.post('/api/market/buy', { orderId: r.data.orderId })).status, 200, JSON.stringify(r.data));
  }
  const trades = (await admin.get('/api/admin/market/trades?q=pl_hist')).data;
  assert.strictEqual(trades.length, 3);
  assert.ok(trades.every((t) => t.flags.includes('pair') && t.seller === 'pl_hist' && t.buyer === 'pl_hist_buy'));
  assert.ok(trades.find((t) => t.rarity === 'legendaire').flags.includes('cheap'));
  assert.strictEqual((await meOf(buyer)).character.lifetime.itemsObtained, 3);
  // Boss Rush d'entraînement : le choix se fait en cliquant
  assert.strictEqual((await s.post('/api/training/start', { opponent: 'rush', difficulty: 'normal' })).data.opponent.name, 'Boss Rush');
  const tb = trainings.get(id);
  tb.stopLoop();
  assert.strictEqual(tb.mode, 'rush');
  for (let i = 0; i < 70; i++) tb.tick(0.05);
  assert.match((await s.post('/api/training/rush', { id: 'bonus' })).data.error, /pas proposé/);
  tb.kill(tb.players[0], tb.boss);
  for (let i = 0; i < 80; i++) tb.tick(0.05);
  assert.deepStrictEqual(tb.publicPoll().options.map((o) => o.id), ['bonus', 'soin', 'defi'], 'pas de résurrection en solo');
  assert.strictEqual((await s.post('/api/training/rush', { id: 'defi' })).data.id, 'defi');
  assert.deepStrictEqual([tb.rush.stage, tb.rush.round, tb.rush.mult], ['intro', 2, Rules.RUSH.defiMult]);
  const goldBefore = (await meOf(s)).character.gold;
  tb.kill(tb.boss, tb.players[0]);
  tb.tick(0.05);
  ch = (await meOf(s)).character;
  assert.strictEqual(ch.gold, goldBefore, 'entraînement : rien n\'est gagné');
  assert.strictEqual(ch.history[0].mode, 'expedition', 'ni enregistré dans l\'historique');
  await s.post('/api/training/stop');
  await admin.post('/api/admin/battle/reset');
});

test('[CAS-1, CAS-4, CAS-6, CAS-8, LB-1] casino via l\'API : salle, parties en cours sans secret, mises', async () => {
  const s = client();
  const id = (await register(s, 'pl_casino')).id;
  await s.post('/api/class', { cls: 'mage' });
  assert.strictEqual((await client().get('/api/casino')).status, 401, 'réservé aux joueurs connectés');
  // Salle : soi-même en premier, avec son apparence ; fil des gros gains
  let room = (await s.get('/api/casino')).data;
  assert.ok(room.crowd.length >= 1 && room.crowd.length <= Rules.CASINO.crowdMax);
  assert.deepStrictEqual([room.crowd[0].id, room.crowd[0].me, room.crowd[0].name], [id, true, 'pl_casino']);
  assert.ok(room.crowd[0].look && room.crowd[0].app);
  assert.ok(Array.isArray(room.feed));
  assert.deepStrictEqual(room.sessions, { blackjack: null, glace: null, heaven: null, chaton: null });
  // Pas assez de golds : refusé
  assert.match((await s.post('/api/casino/slots', { bet: 500 })).data.error, /Il te faut 500 golds/);
  await give(id, { gold: 2000 });
  const spin = await s.post('/api/casino/slots', { bet: 10 });
  assert.strictEqual(spin.status, 200);
  assert.strictEqual(spin.data.reels.length, 3);
  // Parties en cours : la carte cachée de la banque et les fissures ne sont jamais envoyées
  const deal = (await s.post('/api/casino/blackjack/deal', { bet: 50 })).data;
  if (!deal.outcome) {
    room = (await s.get('/api/casino')).data;
    assert.deepStrictEqual(room.sessions.blackjack.dealer[1], { hidden: true });
    assert.ok(!JSON.stringify(room).includes('"cracks":['));
    assert.strictEqual((await s.post('/api/casino/blackjack/stand')).status, 200);
  }
  await s.post('/api/casino/glace/start', { bet: 10, mines: 3 });
  room = (await s.get('/api/casino')).data;
  assert.strictEqual(room.sessions.glace.cracks, null);
  const me = (await meOf(s)).character;
  assert.ok(!JSON.stringify(me).includes('cracks'), 'les parties en cours ne sont pas dans le personnage');
  assert.ok(me.lifetime.casinoBets >= 3);
  assert.strictEqual(me.counters.casinoPlays, me.lifetime.casinoBets);
  // Classements du casino : gagnants (gagné − misé > 0) et poissards (misé − gagné > 0, le plus gros perdant en haut)
  const mk = async (n, wagered, won) => {
    const uid = (await register(client(), n)).id;
    Object.assign(db.state.users[uid].character.lifetime, { casinoWagered: wagered, casinoWon: won });
    return uid;
  };
  const winner = await mk('pl_cas_win', 1000, 4000);
  const loser = await mk('pl_cas_lose', 9000, 1000);
  const unlucky = await mk('pl_cas_lose2', 3000, 2500);
  const lb = (await s.get('/api/leaderboard')).data;
  assert.ok(lb.casino.some((p) => p.id === winner && p.value === 3000));
  assert.ok(!lb.casino.some((p) => p.id === loser || p.id === unlucky), 'pas de perdant chez les gagnants');
  const losers = lb.casinoLoss.filter((p) => p.id === loser || p.id === unlucky);
  assert.deepStrictEqual(losers.map((p) => [p.id, p.value]), [[loser, 8000], [unlucky, 500]], 'le plus gros perdant en premier');
  assert.ok(!lb.casinoLoss.some((p) => p.id === winner), 'pas de gagnant chez les poissards');
  for (let i = 1; i < lb.casinoLoss.length; i++) assert.ok(lb.casinoLoss[i - 1].value >= lb.casinoLoss[i].value);
});

test('[SV-1, SV-6, SV-8, HOUSE-1, HOUSE-2, HOUSE-6] survivor et maison via l\'API', async () => {
  const survivor = require('../server/survivor');
  const s = client();
  const id = (await register(s, 'pl_surv')).id;
  await s.post('/api/class', { cls: 'guerrier' });
  assert.strictEqual((await client().get('/api/survivor')).status, 401);
  let st = (await s.get('/api/survivor')).data;
  assert.deepStrictEqual([st.emeralds, st.starter, st.playing, st.dailyDone, st.best], [0, 'epee', false, false, null]);
  assert.deepStrictEqual(st.starters, ['epee']);
  assert.ok(st.board && Array.isArray(st.board.top));
  assert.match((await s.post('/api/survivor/start', {})).data.error, /300 golds/);
  const gave = await give(id, { gold: 1000 });
  assert.strictEqual(gave.status, 200, JSON.stringify(gave.data));
  const start = await s.post('/api/survivor/start', {});
  assert.strictEqual(start.status, 200, JSON.stringify(start.data));
  assert.ok(start.data.frame && start.data.frame.hp === 120 && Array.isArray(start.data.frame.e));
  st = (await s.get('/api/survivor')).data;
  assert.strictEqual(st.playing, true);
  // Une montée de niveau : choix (un numéro périmé est refusé)
  const run = survivor.runs.get(id).run;
  run.gems.push({ x: run.p.x, y: run.p.y, v: 10, pull: true });
  run.tick(0.05);
  assert.ok(run.pending);
  assert.match((await s.post('/api/survivor/choose', { index: 0, id: run.pending.id + 5 })).data.error, /déjà été fait/);
  const ch = await s.post('/api/survivor/choose', { index: 0, id: run.pending.id });
  assert.strictEqual(ch.status, 200);
  assert.ok(ch.data.chosen && ch.data.frame);
  // Abandon : émeraudes et record
  Object.assign(run, { t: 300, wave: 11, kills: 400, bosses: 2 });
  const ab = await s.post('/api/survivor/abandon', {});
  assert.strictEqual(ab.status, 200);
  assert.ok(ab.data.result.emeralds > 0 && ab.data.result.record);
  st = (await s.get('/api/survivor')).data;
  assert.deepStrictEqual([st.playing, st.best.wave], [false, 11]);
  assert.ok(st.board.top.some((r) => r.id === id));
  assert.ok(st.emeralds === ab.data.result.emeralds);
  // Méta-progression
  db.state.users[id].character.emeralds = 200;
  assert.strictEqual((await s.post('/api/survivor/meta', { id: 'vitalite' })).status, 200);
  assert.match((await s.post('/api/survivor/unlock', { kind: 'weapon', id: 'orbes' })).data.error, /émeraudes/);
  // Maison
  db.state.users[id].character.emeralds = 50000;
  let h = (await s.get('/api/house')).data;
  assert.deepStrictEqual([h.house.size, h.house.placed, h.house.mine, h.mailDue], ['studio', [], true, 0]);
  assert.strictEqual((await s.post('/api/house/buy', { id: 'canape' })).status, 200);
  assert.match((await s.post('/api/house/layout', { placed: [{ id: 'canape', x: 8, y: 0 }] })).data.error, /dépasse/);
  const lay = await s.post('/api/house/layout', { placed: [{ id: 'canape', x: 1, y: 1 }] });
  assert.strictEqual(lay.status, 200);
  assert.strictEqual((await s.post('/api/house/style', { part: 'murs', id: 'rose' })).status, 200);
  h = (await s.get('/api/house')).data;
  assert.deepStrictEqual([h.house.placed.length, h.house.style.murs, h.house.level.points], [1, 'rose', 13 + Math.round(2500 / 350)]);
  // Visite et « J'aime » par un autre joueur
  const v = client();
  await register(v, 'pl_visit');
  const list = (await v.get('/api/houses')).data.houses;
  assert.ok(list.some((x) => x.id === id));
  const seen = (await v.get(`/api/house/${id}`)).data.house;
  assert.deepStrictEqual([seen.name, seen.mine, seen.placed.length], ['pl_surv', false, 1]);
  assert.strictEqual((await v.post(`/api/house/${id}/like`, {})).data.likes, 1);
  assert.strictEqual((await v.get('/api/house/inconnu')).status, 404);
  assert.match((await s.post('/api/house/mail', {})).data.error, /vide/);
});

test('[TCH-6] tchat par HTTP : lecture publique, écriture des joueurs, diffusion, annonces de la file, modération admin', async () => {
  const anon = client();
  const p = client();
  const me = await register(p, 'pl_tchat');
  const sent = await p.post('/api/chat', { text: 'Bonjour :pyrax:' });
  assert.strictEqual(sent.status, 200, JSON.stringify(sent.data));
  const list = (await anon.get('/api/chat')).data;
  const mine = list.messages.find((m) => m.id === sent.data.message.id);
  assert.deepStrictEqual([mine.name, mine.text, mine.uid], ['pl_tchat', 'Bonjour :pyrax:', me.id]);
  assert.ok(typeof list.online.n === 'number' && Array.isArray(list.online.names));
  assert.strictEqual((await anon.post('/api/chat', { text: 'coucou' })).status, 401);
  assert.match((await p.post('/api/chat', { text: '/danse' })).data.error, /Commande inconnue/);
  // Les annonces du jeu arrivent aussi dans le tchat
  await admin.post('/api/admin/battle/reset');
  await admin.post('/api/admin/queue/open', { seconds: 60, mode: 'br' });
  assert.ok((await anon.get('/api/chat')).data.messages.some((m) => m.sys && /est ouverte/.test(m.text)));
  await admin.post('/api/admin/battle/reset');
  // Modération
  assert.strictEqual((await p.post('/api/admin/chat/delete', { id: mine.id })).status, 403);
  assert.strictEqual((await admin.post('/api/admin/chat/delete', { id: mine.id })).status, 200);
  assert.ok(!(await anon.get('/api/chat')).data.messages.some((m) => m.id === mine.id));
  assert.strictEqual((await admin.post('/api/admin/chat/mute', { userId: me.id, minutes: 5 })).status, 200);
  assert.match((await p.post('/api/chat', { text: 'hé' })).data.error, /sourdine/);
  assert.strictEqual((await admin.post('/api/admin/chat/clear', {})).status, 200);
  assert.deepStrictEqual((await anon.get('/api/chat')).data.messages, []);
});

test('[ACC-17, ACC-18, ACC-19, ACC-20, ACC-21] compte : e-mail confirmé par lien, mot de passe oublié, lien admin, changement de mot de passe, Twitch', async () => {
  const mailer = require('../server/mailer');
  const { twitchAccount } = require('../server/index');
  const p = client();
  const me = await register(p, 'pl_mail');
  assert.strictEqual((await client().get('/api/config')).data.mail, true, 'hors production : mode log');
  // Lier une adresse : mot de passe demandé, puis lien reçu
  assert.match((await p.post('/api/account/email', { email: 'pl@mail.fr', password: 'faux' })).data.error, /Mot de passe incorrect/);
  const set = await p.post('/api/account/email', { email: 'PL@mail.fr', password: 'secret1' });
  assert.deepStrictEqual([set.status, set.data.pending], [200, 'pl@mail.fr']);
  let mail = mailer.outbox.at(-1);
  assert.strictEqual(mail.to, 'pl@mail.fr');
  const verify = mail.text.match(/\/account\/verify\?token=([0-9a-f]{64})/);
  assert.ok(verify, mail.text);
  assert.strictEqual((await p.get('/api/me')).data.emailVerified, false);
  const r = await fetch(base + '/account/verify?token=' + verify[1], { redirect: 'manual' });
  assert.match(r.headers.get('location'), /email=ok/);
  const after = (await p.get('/api/me')).data;
  assert.deepStrictEqual([after.email, after.emailVerified, after.emailPending], ['pl@mail.fr', true, null]);
  // Mot de passe oublié : même réponse pour un compte inconnu ; lien d'1 h à l'adresse confirmée
  const anon = client();
  const unknown = await anon.post('/api/password/forgot', { login: 'personne_ici' });
  const known = await anon.post('/api/password/forgot', { login: 'pl@mail.fr' });
  assert.strictEqual(unknown.data.message, known.data.message);
  mail = mailer.outbox.at(-1);
  assert.strictEqual(mail.to, 'pl@mail.fr');
  const reset = mail.text.match(/\?reset=([0-9a-f]{64})/)[1];
  assert.match((await anon.post('/api/password/reset', { token: reset, password: '123' })).data.error, /trop court/);
  const done = await anon.post('/api/password/reset', { token: reset, password: 'nouveau1' });
  assert.deepStrictEqual([done.status, done.data.me.id], [200, me.id]);
  assert.strictEqual((await p.get('/api/me')).status, 401, 'les anciennes sessions sont fermées');
  assert.strictEqual((await anon.get('/api/me')).data.id, me.id, 'connecté avec le lien');
  assert.match((await anon.post('/api/password/reset', { token: reset, password: 'encore12' })).data.error, /expiré ou déjà utilisé/);
  assert.strictEqual((await client().post('/api/login', { username: 'pl_mail', password: 'nouveau1' })).status, 200);
  // Lien donné par l'admin (sans e-mail), adresse masquée dans la liste
  const link = await admin.post(`/api/admin/players/${me.id}/reset-link`, {});
  assert.strictEqual(link.data.hours, 48);
  const adminToken = link.data.url.match(/\?reset=([0-9a-f]{64})/)[1];
  assert.strictEqual((await anon.post(`/api/admin/players/${me.id}/reset-link`, {})).status, 403);
  assert.strictEqual((await client().post('/api/password/reset', { token: adminToken, password: 'parlAdmin' })).status, 200);
  const row = (await players()).find((x) => x.id === me.id);
  assert.deepStrictEqual([row.email, row.emailVerified], ['p*@m***l.fr', true]);
  // Changer son mot de passe une fois connecté
  const q = client();
  await q.post('/api/login', { username: 'pl_mail', password: 'parlAdmin' });
  assert.match((await q.post('/api/account/password', { current: 'faux', password: 'abcdef' })).data.error, /actuel incorrect/);
  assert.strictEqual((await q.post('/api/account/password', { current: 'parlAdmin', password: 'final123' })).status, 200);
  assert.strictEqual((await q.get('/api/me')).status, 200, 'la session courante reste ouverte');
  // Retirer l'adresse
  assert.strictEqual((await q.post('/api/account/email', { email: '', password: 'final123' })).data.removed, true);
  assert.strictEqual((await q.get('/api/me')).data.email, null);
  // Connexion avec Twitch : seulement un vrai compte dont le Twitch est lié
  const u = db.state.users[me.id];
  u.twitchLogin = 'pl_twitch'; u.twitchId = 't-42';
  assert.strictEqual(twitchAccount({ id: 't-42', login: 'PL_Twitch' }), u);
  assert.strictEqual(twitchAccount({ id: 'autre', login: 'pl_twitch' }), u, 'par pseudo Twitch aussi');
  assert.strictEqual(twitchAccount({ id: 'zzz', login: 'inconnu' }), null);
});
