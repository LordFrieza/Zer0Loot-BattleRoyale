/*
 * Zer0Loot Battle Royale — serveur principal.
 */
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const db = require('./db');
const game = require('./game');
const twitch = require('./twitch');
const { Battle } = require('./battle');
const { Bets } = require('./bets');
const Rules = require('../shared/rules');

const PORT = Number(process.env.PORT) || 3000;
const COOKIE = 'zl_session';
const SESSION_TTL = 30 * 24 * 3600 * 1000;

db.load();

// ---------- Comptes & sessions ----------

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function checkPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

const PRODUCTION = process.env.NODE_ENV === 'production';

function ensureAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  // En ligne, jamais de mot de passe « admin » : un mot de passe aléatoire est généré et affiché dans les logs.
  const password = process.env.ADMIN_PASSWORD || (PRODUCTION ? crypto.randomBytes(9).toString('base64url') : 'admin');
  let admin = Object.values(db.state.users).find((u) => u.role === 'admin');
  if (!admin) {
    const id = db.newId();
    admin = { id, username, passwordHash: hashPassword(password), role: 'admin', createdAt: Date.now() };
    db.state.users[id] = admin;
    db.flush();
    console.log(`[admin] compte admin créé : ${username}`);
    if (PRODUCTION && !process.env.ADMIN_PASSWORD) console.log(`[admin] mot de passe généré : ${password} (définissez ADMIN_PASSWORD pour le choisir)`);
  } else if (process.env.ADMIN_PASSWORD) {
    admin.username = username;
    admin.passwordHash = hashPassword(password);
    db.save();
  }
  if (!process.env.ADMIN_PASSWORD && !PRODUCTION) {
    console.log('[admin] ⚠️  mot de passe admin par défaut (admin/admin). Définissez ADMIN_PASSWORD en production.');
  }
}
ensureAdmin();

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function userFromCookie(header) {
  const token = parseCookies(header)[COOKIE];
  const session = token && db.state.sessions[token];
  if (!session || session.expires < Date.now()) return null;
  return db.state.users[session.userId] || null;
}

function createSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  db.state.sessions[token] = { userId: user.id, expires: Date.now() + SESSION_TTL };
  db.save();
  const secure = PRODUCTION ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}${secure}`);
}

// ---------- Application ----------

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const battle = new Battle();
const bets = new Bets(battle);

// Paris restés en cours lors d'un arrêt du serveur : la bataille est perdue, on rembourse.
const leftover = bets.refundAll();
if (leftover.length) console.log(`[paris] ${leftover.length} pari(s) remboursé(s) après redémarrage`);

function queueView() {
  return { ...battle.publicQueue(), bets: bets.summary() };
}

// Derrière l'hébergeur (Railway, Render…), le HTTPS est géré par un proxy.
app.set('trust proxy', 1);
app.use(express.json());

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

app.use((req, res, next) => {
  req.user = userFromCookie(req.headers.cookie);
  next();
});

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Non connecté' });
  next();
}
function requirePlayer(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Non connecté' });
  if (req.user.role !== 'player') return res.status(403).json({ error: 'Réservé aux joueurs' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Réservé à l\'admin' });
  next();
}

// Encapsule une action : erreurs → 400, sauvegarde + notification du joueur.
function action(fn) {
  return (req, res) => {
    try {
      const result = fn(req, res);
      db.save();
      if (req.user && req.user.role === 'player') pushMe(req.user);
      res.json(Object.assign({ ok: true }, result || {}));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
}

function meView(user) {
  const base = {
    id: user.id,
    username: user.username,
    role: user.role,
    twitchLogin: user.twitchLogin || null,
    twitchDisplayName: user.twitchDisplayName || null,
  };
  if (user.role === 'player') {
    base.character = game.publicCharacter(user);
    base.bet = bets.myBet(user.id);
  }
  return base;
}

function pushMe(user) {
  io.to('user:' + user.id).emit('me', meView(user));
}

app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !/^[A-Za-z0-9_\-]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Pseudo invalide (3 à 20 caractères : lettres, chiffres, _ ou -)' });
  }
  if (!password || password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères minimum)' });
  const existing = db.findUserByName(username);
  if (existing && !existing.ghost) return res.status(400).json({ error: 'Ce pseudo est déjà pris' });
  const id = db.newId();
  const user = {
    id, username, passwordHash: hashPassword(password), role: 'player',
    twitchLogin: null, createdAt: Date.now(), character: game.newCharacter(),
  };
  db.state.users[id] = user;
  createSession(res, user);
  res.json({ ok: true, me: meView(user) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = username && Object.values(db.state.users)
    .find((u) => !u.ghost && u.username.toLowerCase() === String(username).toLowerCase());
  if (!user || !checkPassword(String(password || ''), user.passwordHash)) {
    return res.status(400).json({ error: 'Identifiants incorrects' });
  }
  createSession(res, user);
  res.json({ ok: true, me: meView(user) });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) delete db.state.sessions[token];
  db.save();
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => res.json(meView(req.user)));

// Liaison « par pseudo » (sans vérification) : seulement en local, ou si ALLOW_DEV_LINK=1.
// En ligne, elle permettrait de se faire passer pour quelqu'un d'autre et de récupérer son loot.
function devLinkAllowed() {
  if (process.env.ALLOW_DEV_LINK === '1') return true;
  return !PRODUCTION && !twitch.oauthEnabled();
}

app.get('/api/config', (req, res) => {
  res.json({ twitch: twitch.status(), devLink: devLinkAllowed() });
});

// ---------- Personnage ----------

app.post('/api/stats/allocate', requirePlayer, action((req) => {
  game.allocate(req.user.character, req.body.stat);
}));

app.post('/api/chest/buy', requirePlayer, action((req) => {
  game.buyChests(req.user.character, req.body.count);
}));

app.post('/api/chest/open', requirePlayer, action((req) => game.openChest(req.user.character)));

app.post('/api/recycle', requirePlayer, action((req) => game.recycle(req.user.character, req.body.itemIds)));

// ---------- Classe & forge ----------

app.post('/api/class', requirePlayer, action((req) => game.chooseClass(req.user.character, String(req.body.cls || ''))));

app.post('/api/forge/fuse', requirePlayer, action((req) => game.fuse(req.user.character, req.body.itemIds)));

app.post('/api/forge/reroll', requirePlayer, action((req) => game.reroll(req.user.character, req.body.itemId, req.body.line)));

app.post('/api/equip', requirePlayer, action((req) => {
  game.equip(req.user.character, req.body.itemId);
}));

app.post('/api/unequip', requirePlayer, action((req) => {
  game.unequip(req.user.character, req.body.slot);
}));

// ---------- Liaison Twitch ----------

const oauthStates = new Map();

function redirectUri(req) {
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  return base.replace(/\/$/, '') + '/auth/twitch/callback';
}

app.get('/auth/twitch', (req, res) => {
  if (!req.user || req.user.role !== 'player') return res.redirect('/');
  if (!twitch.oauthEnabled()) return res.redirect('/character.html?twitch=disabled');
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, { userId: req.user.id, expires: Date.now() + 10 * 60 * 1000 });
  res.redirect(twitch.authorizeUrl(redirectUri(req), state));
});

app.get('/auth/twitch/callback', async (req, res) => {
  const entry = oauthStates.get(req.query.state);
  oauthStates.delete(req.query.state);
  if (!entry || entry.expires < Date.now() || !req.query.code) return res.redirect('/character.html?twitch=error');
  const user = db.state.users[entry.userId];
  if (!user) return res.redirect('/');
  try {
    const profile = await twitch.exchangeCode(req.query.code, redirectUri(req));
    game.linkTwitch(user, profile.login, profile.displayName, profile.id);
    pushMe(user);
    res.redirect('/character.html?twitch=ok');
  } catch (err) {
    res.redirect('/character.html?twitch=error&msg=' + encodeURIComponent(err.message));
  }
});

// Mode développement : liaison en tapant son pseudo (si l'OAuth Twitch n'est pas configuré).
app.post('/api/twitch/link-dev', requirePlayer, action((req) => {
  if (!devLinkAllowed()) throw new Error('Utilisez la connexion Twitch');
  const login = String(req.body.login || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,25}$/.test(login)) throw new Error('Pseudo Twitch invalide');
  game.linkTwitch(req.user, login, req.body.login.trim());
}));

app.post('/api/twitch/unlink', requirePlayer, action((req) => {
  req.user.twitchLogin = null;
  req.user.twitchDisplayName = null;
  req.user.twitchId = null;
}));

// ---------- File d'attente & bataille ----------

function lookOf(user) {
  const look = {};
  for (const [slot, item] of Object.entries(user.character.equipment)) if (item) look[slot] = item.rarity;
  return look;
}

function participantFromUser(user) {
  return {
    key: 'u' + user.id,
    userId: user.id,
    name: user.twitchDisplayName || user.username,
    level: user.character.level,
    cls: user.character.cls || null,
    stats: game.derived(user.character),
    look: lookOf(user),
  };
}

function refreshParticipant(p) {
  const user = p.userId && db.state.users[p.userId];
  return user ? participantFromUser(user) : p;
}

let botCount = 0;
const BOT_NAMES = ['Gobelin', 'Squelette', 'Slime', 'Orc', 'Bandit', 'Loup', 'Kobold', 'Spectre', 'Troll', 'Golem'];
function makeBot() {
  botCount += 1;
  const level = 1 + Math.floor(Math.random() * 6);
  const points = Rules.emptyStats();
  const combatStats = Rules.STATS.filter((s) => s !== 'chance');
  for (let i = 0; i < level - 1; i++) points[combatStats[Math.floor(Math.random() * combatStats.length)]] += 1;
  const look = {};
  for (const slot of Rules.SLOTS) {
    if (Math.random() < 0.4) look[slot] = game.rollRarity(10);
  }
  const cls = Rules.CLASSES[Math.floor(Math.random() * Rules.CLASSES.length)];
  return {
    key: 'bot' + botCount,
    bot: true,
    name: BOT_NAMES[botCount % BOT_NAMES.length] + '_' + botCount,
    level,
    cls,
    stats: Rules.derive(points, {}, cls),
    look,
  };
}

function joinFromTwitch(login, displayName) {
  if (battle.phase !== 'queue') return { ok: false, reason: 'closed' };
  const user = game.getOrCreateTwitchUser(login, displayName);
  const joined = battle.join(participantFromUser(user));
  return { ok: joined, user };
}

twitch.startChat((command, from) => {
  if (command !== '!join') return;
  const r = joinFromTwitch(from.login, from.displayName);
  if (r.ok) {
    const hint = r.user.ghost ? ' Crée ton compte sur le site et lie ton Twitch pour garder ton loot !' : '';
    twitch.say(`@${from.displayName} rejoint la bataille ⚔️${hint}`);
  }
});

app.post('/api/queue/join', requirePlayer, (req, res) => {
  if (battle.phase !== 'queue') return res.status(400).json({ error: 'La file n\'est pas ouverte' });
  const joined = battle.join(participantFromUser(req.user));
  res.json({ ok: true, joined });
});

app.get('/api/queue', (req, res) => res.json(queueView()));

// ---------- Paris ----------

app.post('/api/bet', requirePlayer, action((req) => {
  const bet = bets.place(req.user, String(req.body.target || ''), req.body.amount);
  io.emit('queue', queueView());
  return { bet };
}));

app.post('/api/bet/cancel', requirePlayer, action((req) => {
  bets.cancel(req.user);
  io.emit('queue', queueView());
}));

function notifyBets(results) {
  for (const r of results) {
    const user = db.state.users[r.userId];
    if (!user) continue;
    pushMe(user);
    io.to('user:' + user.id).emit('bet', r);
  }
}

battle.on('cleared', () => notifyBets(bets.refundAll()));

app.post('/api/admin/queue/open', requireAdmin, action((req) => {
  const seconds = Math.max(10, Math.min(3600, Number(req.body.seconds) || 180));
  battle.openQueue(seconds);
  twitch.say(`⚔️ La file du Battle Royale est ouverte pour ${Math.round(seconds / 60 * 10) / 10} min ! Tapez !join pour participer.`);
}));

app.post('/api/admin/queue/close', requireAdmin, action(() => battle.closeQueue()));

app.post('/api/admin/queue/bots', requireAdmin, action((req) => {
  const count = Math.max(1, Math.min(50, Number(req.body.count) || 5));
  if (battle.phase !== 'queue') throw new Error('Ouvrez la file d\'abord');
  for (let i = 0; i < count; i++) battle.join(makeBot());
}));

app.post('/api/admin/queue/simulate', requireAdmin, action((req) => {
  const login = String(req.body.login || '').trim();
  if (!/^[A-Za-z0-9_]{3,25}$/.test(login)) throw new Error('Pseudo Twitch invalide');
  const r = joinFromTwitch(login.toLowerCase(), login);
  if (r.reason === 'closed') throw new Error('Ouvrez la file d\'abord');
  return { joined: r.ok };
}));

app.post('/api/admin/battle/start', requireAdmin, action(() => {
  battle.start(refreshParticipant);
  twitch.say('🔥 Que le combat commence !');
}));

app.post('/api/admin/battle/reset', requireAdmin, action(() => battle.reset()));

// ---------- Récompenses ----------

battle.on('kill', (killer) => {
  const user = killer.userId && db.state.users[killer.userId];
  if (!user) return;
  const levels = game.grant(user.character, Rules.REWARDS.kill);
  user.character.record.kills += 1;
  db.save();
  pushMe(user);
  io.to('user:' + user.id).emit('reward', { type: 'kill', reward: Rules.REWARDS.kill, levels });
});

// Séries de kills : coffres bonus (premier kill, double kill, massacre).
battle.on('streak', (fighter, kind) => {
  const reward = Rules.REWARDS[kind];
  const user = fighter.userId && db.state.users[fighter.userId];
  if (!user || !reward || !(reward.chests || reward.gold || reward.xp)) return;
  const levels = game.grant(user.character, reward);
  db.save();
  pushMe(user);
  io.to('user:' + user.id).emit('reward', { type: kind, reward, levels });
});

battle.on('end', (winner, fighters) => {
  for (const f of fighters) {
    const user = f.userId && db.state.users[f.userId];
    if (!user) continue;
    user.character.record.battles += 1;
    const participationLevels = game.grant(user.character, Rules.REWARDS.participation);
    io.to('user:' + user.id).emit('reward', { type: 'participation', reward: Rules.REWARDS.participation, levels: participationLevels });
    if (f === winner) {
      const levels = game.grant(user.character, Rules.REWARDS.win);
      user.character.record.wins += 1;
      io.to('user:' + user.id).emit('reward', { type: 'win', reward: Rules.REWARDS.win, levels });
    }
    pushMe(user);
  }
  db.save();
  if (winner) twitch.say(`🏆 ${winner.name} remporte le Battle Royale avec ${winner.kills} kill(s) !`);

  const betResults = bets.settle(winner ? winner.key : null, winner ? winner.name : null);
  notifyBets(betResults);
  const br = bets.summary().lastResult;
  if (br && !br.refund && br.winners) {
    twitch.say(`💰 ${br.winners > 1 ? br.winners + ' parieurs se partagent' : '1 parieur remporte'} ${br.distributed} golds de mises perdues !`);
  }
});

battle.on('queue', () => io.emit('queue', queueView()));
battle.on('frame', (f) => io.emit('frame', f));

// ---------- Temps réel ----------

io.on('connection', (socket) => {
  const user = userFromCookie(socket.request.headers.cookie);
  if (user) socket.join('user:' + user.id);
  socket.emit('queue', queueView());
  socket.emit('frame', battle.frame());
});

setInterval(() => io.emit('twitch', twitch.status()), 5000);

// Nettoyage des sessions expirées.
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of Object.entries(db.state.sessions)) if (s.expires < now) delete db.state.sessions[token];
  db.save();
}, 3600 * 1000);

process.on('SIGINT', () => { db.flush(); process.exit(0); });
process.on('SIGTERM', () => { db.flush(); process.exit(0); });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Zer0Loot Battle Royale → http://localhost:${PORT}`);
});
