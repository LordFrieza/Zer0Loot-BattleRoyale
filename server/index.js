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
    if (i <= 0) return;
    const raw = part.slice(i + 1).trim();
    // Un cookie mal encodé (%E0%A4%A…) ne doit jamais faire planter le serveur : on garde la valeur brute.
    let value = raw;
    try { value = decodeURIComponent(raw); } catch { /* valeur brute */ }
    out[part.slice(0, i).trim()] = value;
  });
  return out;
}

function userFromCookie(header) {
  const token = parseCookies(header)[COOKIE];
  const session = token && db.state.sessions[token];
  if (!session || session.expires < Date.now()) return null;
  const user = db.state.users[session.userId];
  return user && !user.banned ? user : null;
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
  if (user.banned) return res.status(403).json({ error: 'Ce compte a été banni' });
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

app.post('/api/look', requirePlayer, action((req) => {
  game.setLook(req.user.character, String(req.body.part || ''), req.body.value === null || req.body.value === undefined ? null : String(req.body.value));
}));

app.post('/api/shop/buy', requirePlayer, action((req) => game.buyCosmetic(req.user.character, String(req.body.id || ''))));

app.post('/api/equip', requirePlayer, action((req) => {
  game.equip(req.user.character, req.body.itemId);
}));

app.post('/api/unequip', requirePlayer, action((req) => {
  game.unequip(req.user.character, req.body.slot);
}));

// ---------- Presets d'équipement ----------

app.post('/api/preset/save', requirePlayer, action((req) => game.savePreset(req.user.character, req.body.name, req.body.id || null)));
app.post('/api/preset/apply', requirePlayer, action((req) => game.applyPreset(req.user.character, String(req.body.id || ''))));
app.post('/api/preset/delete', requirePlayer, action((req) => game.deletePreset(req.user.character, String(req.body.id || ''))));

// ---------- Consommables ----------

app.post('/api/consumable/buy', requirePlayer, action((req) => game.buyConsumable(req.user.character, String(req.body.id || ''), req.body.count)));
app.post('/api/consumable/equip', requirePlayer, action((req) => {
  game.equipConsumable(req.user.character, req.body.id === null || req.body.id === undefined ? null : String(req.body.id));
}));

// ---------- Arbre de compétences ----------

app.post('/api/talent/learn', requirePlayer, action((req) => game.learnTalent(req.user.character, String(req.body.id || ''))));
app.post('/api/talent/reset', requirePlayer, action((req) => game.resetTalents(req.user.character)));

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
  const c = user.character;
  const spec = Rules.specOf(c.cls, c.talents || []);
  return {
    key: 'u' + user.id,
    userId: user.id,
    name: user.twitchDisplayName || user.username,
    level: c.level,
    cls: c.cls || null,
    spec: spec ? { label: spec.spec, icon: spec.icon } : null,
    title: game.titleOf(c),
    app: { ...c.look },
    stats: game.derived(c),
    look: lookOf(user),
    ult: Rules.ultOf(c.cls, c.talents || []), // ultime de l'arbre de compétences (null s'il n'en a pas)
    consumable: c.consumableSlot || null, // potion équipée pour cette partie
  };
}

// Nœuds d'arbre tirés au hasard pour un combattant non humain (bots, mannequins d'entraînement).
function randomTalents(cls, level) {
  const nodes = Rules.talentNodes(cls);
  const owned = [];
  const branch = Math.random() < 0.5 ? 'left' : 'right';
  for (let tier = 0; tier < Rules.TALENT_TIERS.length && owned.length < Rules.talentPoints(level); tier++) {
    const options = nodes.filter((n) => n.branch === branch && n.tier === tier);
    owned.push(options[Math.floor(Math.random() * options.length)].id);
  }
  return owned;
}

// Combattant non humain (jamais sauvegardé) : points, arbre et équipement visuel aléatoires selon le niveau.
function makeNpc(key, name, level, cls) {
  const points = Rules.emptyStats();
  const combatStats = Rules.STATS.filter((s) => s !== 'chance');
  for (let i = 0; i < level - 1; i++) points[combatStats[Math.floor(Math.random() * combatStats.length)]] += 1;
  const talents = randomTalents(cls, level);
  const bonus = Rules.talentBonus(cls, talents);
  for (const st of Rules.STATS) points[st] += bonus[st];
  const look = {};
  for (const slot of Rules.SLOTS) {
    if (Math.random() < 0.4) look[slot] = game.rollRarity(10);
  }
  // Apparence aléatoire (et parfois un cosmétique) pour varier les bots
  const anyOf = (obj) => { const k = Object.keys(obj); return k[Math.floor(Math.random() * k.length)]; };
  const app = { ...Rules.DEFAULT_LOOK };
  for (const part of Object.keys(Rules.APPEARANCE)) app[part] = anyOf(Rules.APPEARANCE[part].options);
  if (Math.random() < 0.35) { const id = anyOf(Rules.COSMETICS); app[Rules.COSMETICS[id].slot] = id; }
  const spec = Rules.specOf(cls, talents);
  return {
    app,
    key,
    bot: true,
    name,
    level,
    cls,
    spec: spec ? { label: spec.spec, icon: spec.icon } : null,
    stats: Rules.derive(points, {}, cls),
    look,
    ult: Rules.ultOf(cls, talents),
    consumable: Math.random() < 0.3 ? anyOf(Rules.CONSUMABLES) : null,
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
  const cls = Rules.CLASSES[Math.floor(Math.random() * Rules.CLASSES.length)];
  return makeNpc('bot' + botCount, BOT_NAMES[botCount % BOT_NAMES.length] + '_' + botCount, level, cls);
}

function joinFromTwitch(login, displayName) {
  if (battle.phase !== 'queue') return { ok: false, reason: 'closed' };
  const user = game.getOrCreateTwitchUser(login, displayName);
  if (user.banned) return { ok: false, reason: 'banned', user };
  const joined = battle.join(participantFromUser(user));
  return { ok: joined, user };
}

// ---------- Abonnements Twitch : 300 golds pour celui qui s'abonne / offre l'abonnement ----------

function rewardSub(login, displayName, kind) {
  const user = game.getOrCreateTwitchUser(login, displayName);
  if (user.banned) return null;
  const reward = { xp: 0, chests: 0, gold: Rules.SUB_REWARD_GOLD };
  game.grant(user.character, reward);
  game.bump(user.character, 'subs');
  db.save();
  pushMe(user);
  io.to('user:' + user.id).emit('reward', { type: 'sub', reward, levels: 0 });
  const what = kind === 'gift' ? 'ton sub offert' : 'ton abonnement';
  twitch.say(`💜 Merci @${displayName} pour ${what} ! +${Rules.SUB_REWARD_GOLD} golds sur ton perso Zer0Loot.`);
  console.log(`[twitch] sub (${kind}) de ${login} : +${Rules.SUB_REWARD_GOLD} golds`);
  return user;
}

// Commandes du chat Twitch : !join, et les votes du sondage du donjon (!vie, !or… ou !1 / !2).
function chatCommand(command, from) {
  if (command === '!join') {
    const r = joinFromTwitch(from.login, from.displayName);
    if (r.ok) {
      const hint = r.user.ghost ? ' Crée ton compte sur le site et lie ton Twitch pour garder ton loot !' : '';
      twitch.say(`@${from.displayName} rejoint la bataille ⚔️${hint}`);
    }
    return;
  }
  const login = String(from.login || '').toLowerCase();
  const user = login && db.findUserByTwitch(login);
  if (user && user.banned) return;
  battle.vote('t:' + login, command);
}

// Branché dans start() : l'import de ce module (tests) ne doit pas ouvrir de connexion au chat.
function startTwitch() {
  twitch.startChat(chatCommand, (sub) => rewardSub(sub.login, sub.displayName, sub.kind));
}

app.post('/api/queue/join', requirePlayer, (req, res) => {
  if (battle.phase !== 'queue') return res.status(400).json({ error: 'La file n\'est pas ouverte' });
  const joined = battle.join(participantFromUser(req.user));
  res.json({ ok: true, joined });
});

app.get('/api/queue', (req, res) => res.json(queueView()));

// Vote au sondage du donjon depuis le site : une seule voix par personne, partagée avec le chat si le Twitch est lié.
app.post('/api/poll/vote', requirePlayer, (req, res) => {
  const voter = req.user.twitchLogin ? 't:' + req.user.twitchLogin : 'u:' + req.user.id;
  const id = battle.vote(voter, String(req.body.choice || ''));
  if (!id) return res.status(400).json({ error: 'Aucun sondage en cours pour ce choix' });
  res.json({ ok: true, choice: id });
});

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
    if (r.outcome === 'won') game.bump(user.character, 'betsWon');
    pushMe(user);
    io.to('user:' + user.id).emit('bet', r);
  }
}

battle.on('cleared', () => notifyBets(bets.refundAll()));

app.post('/api/admin/queue/open', requireAdmin, action((req) => {
  const seconds = Math.max(10, Math.min(3600, Number(req.body.seconds) || 180));
  const mode = req.body.mode || 'br';
  battle.openQueue(seconds, mode);
  const m = Rules.GAME_MODES[mode];
  twitch.say(`${m.icon} La file du ${m.label} est ouverte pour ${Math.round(seconds / 60 * 10) / 10} min ! Tapez !join pour participer.`);
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

// Événement de la prochaine bataille, choisi par l'admin (« random » = tiré au lancement).
let pendingEvent = null;

app.get('/api/admin/state', requireAdmin, (req, res) => res.json({ pendingEvent }));

app.post('/api/admin/event', requireAdmin, action((req) => {
  const ev = req.body.event || null;
  if (ev !== null && ev !== 'random' && !Rules.BATTLE_EVENTS[ev]) throw new Error('Événement inconnu');
  pendingEvent = ev;
  return { pendingEvent };
}));

app.post('/api/admin/battle/start', requireAdmin, action(() => {
  if (battle.mode !== 'br') {
    // Les événements ne concernent que le Battle Royale : celui choisi attend la prochaine bataille royale.
    battle.start(refreshParticipant, null);
    twitch.say(battle.mode === 'boss'
      ? `👹 ${Rules.BOSS.name} débarque ! Tous ensemble contre lui !`
      : '🏰 Les aventuriers entrent dans le donjon… Jusqu\'où irez-vous ?');
    return { event: null, pendingEvent };
  }
  const keys = Object.keys(Rules.BATTLE_EVENTS);
  const ev = pendingEvent === 'random' ? keys[Math.floor(Math.random() * keys.length)] : pendingEvent;
  battle.start(refreshParticipant, ev);
  pendingEvent = null; // un événement ne vaut que pour une bataille
  const info = ev && Rules.BATTLE_EVENTS[ev];
  twitch.say(info ? `🔥 Que le combat commence ! Événement : ${info.icon} ${info.label} !` : '🔥 Que le combat commence !');
  return { event: ev, pendingEvent };
}));

app.post('/api/admin/poll/close', requireAdmin, action(() => {
  if (!battle.closePoll()) throw new Error('Aucun sondage en cours');
}));

app.post('/api/admin/battle/reset', requireAdmin, action(() => battle.reset()));

// ---------- Récompenses ----------

// Événement « Loot double » : XP, golds et coffres ×2 pendant la bataille.
function scaled(reward) {
  const m = battle.event === 'double' ? 2 : 1;
  return { xp: reward.xp * m, gold: reward.gold * m, chests: reward.chests * m };
}

battle.on('kill', (killer) => {
  const user = killer.userId && db.state.users[killer.userId];
  if (!user) return;
  const reward = scaled(Rules.REWARDS.kill);
  const levels = game.grant(user.character, reward);
  user.character.record.kills += 1;
  db.save();
  pushMe(user);
  io.to('user:' + user.id).emit('reward', { type: 'kill', reward, levels });
});

// Séries de kills : coffres bonus (premier kill, double kill, massacre).
battle.on('streak', (fighter, kind) => {
  const user = fighter.userId && db.state.users[fighter.userId];
  if (!user) return;
  if (kind !== 'triple') game.bump(user.character, kind);
  const reward = Rules.REWARDS[kind] && scaled(Rules.REWARDS[kind]);
  if (!reward || !(reward.chests || reward.gold || reward.xp)) { db.save(); pushMe(user); return; }
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
    const participation = scaled(Rules.REWARDS.participation);
    const participationLevels = game.grant(user.character, participation);
    io.to('user:' + user.id).emit('reward', { type: 'participation', reward: participation, levels: participationLevels });
    if (f === winner) {
      const win = scaled(Rules.REWARDS.win);
      const levels = game.grant(user.character, win);
      user.character.record.wins += 1;
      io.to('user:' + user.id).emit('reward', { type: 'win', reward: win, levels });
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
  db.save();
  io.emit('leaderboard', leaderboard());
});

/*
 * Fin d'un mode coopératif : XP de participation pour tous, plus la récompense commune
 * (Troll vaincu, ou palier de salle atteint dans le donjon) pour TOUS les participants, morts ou vivants.
 */
battle.on('coopEnd', (result, fighters) => {
  for (const f of fighters) {
    const user = f.userId && db.state.users[f.userId];
    if (!user) continue;
    game.upgrade(user.character);
    user.character.record.battles += 1;
    const participation = { ...Rules.REWARDS.participation };
    const participationLevels = game.grant(user.character, participation);
    io.to('user:' + user.id).emit('reward', { type: 'participation', reward: participation, levels: participationLevels });
    if (result.mode === 'boss' && result.victory) game.bump(user.character, 'bossWins');
    if (result.mode === 'dungeon') user.character.counters.dungeonBest = Math.max(user.character.counters.dungeonBest || 0, result.room);
    if (result.reward) {
      const reward = { xp: result.reward.xp, gold: result.reward.gold, chests: result.reward.chests };
      const levels = game.grant(user.character, reward);
      io.to('user:' + user.id).emit('reward', { type: result.mode, reward, levels, room: result.room });
    }
    pushMe(user);
  }
  db.save();
  if (result.mode === 'boss') {
    twitch.say(result.victory
      ? `🏆 ${Rules.BOSS.name} est vaincu ! Tous les participants gagnent ${Rules.BOSS.reward.chests} coffres, ${Rules.BOSS.reward.xp} XP et ${Rules.BOSS.reward.gold} golds !`
      : `💀 ${Rules.BOSS.name} a écrasé tout le monde… Retentez votre chance !`);
  } else {
    const r = result.reward;
    twitch.say(`🏰 Le raid s'arrête en salle ${result.room} !${r ? ` Tous les aventuriers gagnent ${[r.chests ? r.chests + ' coffre(s)' : '', r.xp + ' XP', r.gold + ' golds'].filter(Boolean).join(', ')}.` : ' Il faut atteindre la salle 5 pour une récompense.'}`);
  }
  notifyBets(bets.refundAll());
  io.emit('leaderboard', leaderboard());
});

// ---------- Sondage du donjon ----------

const boonText = (id) => { const b = Rules.DUNGEON_BOONS[id]; return `${b.icon} ${b.label} (${b.cmd})`; };

battle.on('pollStart', (poll) => {
  twitch.say(`🗳️ Salle ${poll.room} franchie ! Votez dans le chat pendant ${Rules.DUNGEON_POLL.duration} s : ${poll.options.map((o) => boonText(o.id)).join(' OU ')}`);
});

// Bonus immédiat (golds, XP, coffre) : pour TOUS les participants humains, morts compris.
battle.on('pollEnd', (result, fighters) => {
  const b = Rules.DUNGEON_BOONS[result.id];
  if (result.reward) {
    for (const f of fighters) {
      const user = f.userId && db.state.users[f.userId];
      if (!user) continue;
      const levels = game.grant(user.character, result.reward);
      io.to('user:' + user.id).emit('reward', { type: 'poll', reward: result.reward, levels, boon: result.id });
      pushMe(user);
    }
    db.save();
  }
  const total = result.counts.reduce((a, c) => a + c.votes, 0);
  const extra = result.revived ? ` ${result.revived.name} revient à la vie !` : '';
  twitch.say(`🗳️ Le chat a choisi ${b.icon} ${b.label} (${total} vote${total > 1 ? 's' : ''}) : ${b.desc}${extra}`);
});

// ---------- Classements ----------

const BOARD_SIZE = 10;

function players() {
  return Object.values(db.state.users).filter((u) => u.role === 'player' && u.character);
}

function leaderboard() {
  const list = players().filter((u) => !u.banned).map((u) => ({
    id: u.id,
    name: u.twitchDisplayName || u.username,
    cls: u.character.cls || null,
    level: u.character.level,
    title: game.titleOf(u.character),
    wins: u.character.record.wins,
    kills: u.character.record.kills,
    battles: u.character.record.battles,
  }));
  const top = (key) => list.filter((p) => p[key] > 0).sort((a, b) => b[key] - a[key] || b.level - a.level).slice(0, BOARD_SIZE)
    .map((p) => ({ ...p, value: p[key] }));
  return { wins: top('wins'), kills: top('kills'), battles: top('battles') };
}

app.get('/api/leaderboard', (req, res) => res.json(leaderboard()));

// ---------- Succès & titres ----------

app.post('/api/achievements/claim', requirePlayer, action((req) => game.claimAchievement(req.user.character, String(req.body.id || ''))));

app.post('/api/title', requirePlayer, action((req) => {
  game.setTitle(req.user.character, req.body.id || null);
  io.emit('leaderboard', leaderboard());
}));

// ---------- Outils admin : joueurs ----------

app.get('/api/admin/players', requireAdmin, (req, res) => {
  res.json(players().map((u) => {
    game.upgrade(u.character);
    return {
      id: u.id,
      name: u.twitchDisplayName || u.username,
      username: u.username,
      twitch: u.twitchLogin || null,
      ghost: !!u.ghost,
      banned: !!u.banned,
      cls: u.character.cls,
      level: u.character.level,
      gold: u.character.gold,
      chests: u.character.chests,
      record: u.character.record,
      title: game.titleOf(u.character),
    };
  }));
});

function adminTarget(req) {
  const user = db.state.users[req.params.id];
  if (!user || user.role !== 'player' || !user.character) throw new Error('Joueur introuvable');
  return user;
}

app.post('/api/admin/players/:id/give', requireAdmin, action((req) => {
  const user = adminTarget(req);
  const r = game.adminGive(user.character, req.body || {});
  pushMe(user);
  io.to('user:' + user.id).emit('reward', { type: 'gift', reward: r.reward, levels: r.levels });
  return r;
}));

app.post('/api/admin/players/:id/ban', requireAdmin, action((req) => {
  const user = adminTarget(req);
  user.banned = !!req.body.banned;
  if (user.banned) {
    // Déconnexion immédiate et retrait de la file en cours.
    for (const [token, sess] of Object.entries(db.state.sessions)) if (sess.userId === user.id) delete db.state.sessions[token];
    io.to('user:' + user.id).emit('banned');
    if (battle.phase === 'queue' || battle.phase === 'ready') {
      // Son pari et les paris placés sur lui sont remboursés.
      for (const b of Object.values(bets.list)) {
        const bettor = db.state.users[b.userId];
        if (bettor && (b.userId === user.id || b.target === 'u' + user.id)) {
          bets.cancel(bettor);
          pushMe(bettor);
          io.to('user:' + bettor.id).emit('bet', { ...b, payout: b.amount, outcome: 'refund' });
        }
      }
      battle.participants.delete('u' + user.id);
      battle.changed();
    }
  }
  io.emit('leaderboard', leaderboard());
  return { banned: user.banned };
}));

app.post('/api/admin/simulate-sub', requireAdmin, action((req) => {
  const login = String(req.body.login || '').trim();
  if (!/^[A-Za-z0-9_]{3,25}$/.test(login)) throw new Error('Pseudo Twitch invalide');
  if (!rewardSub(login.toLowerCase(), login, 'sub')) throw new Error('Ce joueur est banni');
}));

battle.on('queue', () => io.emit('queue', queueView()));
battle.on('frame', (f) => io.emit('frame', f));

// Au lancement d'une partie, la potion équipée par chaque joueur est utilisée (elle quitte son emplacement).
battle.on('start', (fighters) => {
  for (const f of fighters) {
    const user = f.userId && db.state.users[f.userId];
    if (!user || !f.consumable) continue;
    game.useConsumable(user.character);
    pushMe(user);
  }
  db.save();
});

// ---------- Mode entraînement ----------
/*
 * Duel privé contre un mannequin (classe et niveau au choix) ou contre le « fantôme » d'un autre joueur (son build et
 * son équipement actuels). Simulé sur une Battle à part, diffusé seulement au joueur ; aucune récompense, la potion
 * équipée est utilisée sans être consommée.
 */
const trainings = new Map(); // userId → Battle

function stopTraining(userId) {
  const b = trainings.get(userId);
  if (!b) return;
  b.stopLoop();
  clearTimeout(b.trainingTimer);
  b.removeAllListeners();
  trainings.delete(userId);
}

app.get('/api/training/opponents', requirePlayer, (req, res) => {
  res.json(players()
    .filter((u) => !u.banned && u.id !== req.user.id && u.character.cls)
    .map((u) => ({ id: u.id, name: u.twitchDisplayName || u.username, cls: u.character.cls, level: u.character.level, ghost: !!u.ghost }))
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
    .slice(0, 300));
});

app.post('/api/training/start', requirePlayer, (req, res) => {
  try {
    const user = req.user;
    if (!user.character.cls) throw new Error('Choisis d\'abord une classe');
    stopTraining(user.id);
    if (trainings.size >= Rules.TRAINING.maxConcurrent) throw new Error('Trop d\'entraînements en cours, réessaie dans un instant');
    let opponent;
    if (req.body.opponent === 'player') {
      const other = db.state.users[req.body.id];
      if (!other || other.role !== 'player' || !other.character || other.banned) throw new Error('Joueur introuvable');
      if (other.id === user.id) throw new Error('Choisis un autre joueur que toi');
      game.upgrade(other.character);
      opponent = { ...participantFromUser(other), key: 'g' + other.id, userId: null, bot: true };
    } else {
      const level = Math.max(1, Math.min(Rules.TRAINING.maxLevel, Math.floor(Number(req.body.level) || 1)));
      const cls = Rules.CLASSES.includes(req.body.cls) ? req.body.cls : Rules.CLASSES[Math.floor(Math.random() * Rules.CLASSES.length)];
      opponent = makeNpc('mannequin', `Mannequin ${Rules.CLASS_INFO[cls].label}`, level, cls);
      opponent.consumable = null;
    }
    const b = new Battle();
    b.openQueue(60, 'br');
    clearTimeout(b.queueTimer);
    b.join(participantFromUser(user));
    b.join(opponent);
    const room = 'user:' + user.id;
    b.on('queue', (q) => io.to(room).emit('trainingQueue', { ...q, training: true }));
    b.on('frame', (f) => io.to(room).emit('trainingFrame', f));
    b.on('end', () => { clearTimeout(b.trainingTimer); trainings.delete(user.id); });
    b.start(null, null);
    trainings.set(user.id, b);
    // Garde-fou : un entraînement ne dure jamais plus de TRAINING.maxDuration secondes.
    b.trainingTimer = setTimeout(() => {
      if (b.phase !== 'battle') return;
      const alive = b.fighters.filter((f) => f.alive).sort((x, y) => y.hp / y.maxHp - x.hp / x.maxHp);
      b.finish(alive[0] || null);
    }, Rules.TRAINING.maxDuration * 1000);
    res.json({ ok: true, opponent: { name: opponent.name, cls: opponent.cls, level: opponent.level } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/training/stop', requirePlayer, (req, res) => {
  stopTraining(req.user.id);
  io.to('user:' + req.user.id).emit('trainingQueue', { phase: 'idle', mode: 'br', training: true, participants: [], result: null });
  res.json({ ok: true });
});

// ---------- Temps réel ----------

io.on('connection', (socket) => {
  const user = userFromCookie(socket.request.headers.cookie);
  if (user) socket.join('user:' + user.id);
  socket.emit('queue', queueView());
  socket.emit('frame', battle.frame());
});

// ---------- Démarrage ----------

// Tout ce qui a des effets de bord permanents (port, chat Twitch, minuteurs, signaux) est ici,
// pour que `require('./index')` reste sans effet dans les tests.
function start(port = PORT) {
  startTwitch();
  setInterval(() => io.emit('twitch', twitch.status()), 5000);

  // Nettoyage des sessions expirées.
  setInterval(() => {
    const now = Date.now();
    for (const [token, s] of Object.entries(db.state.sessions)) if (s.expires < now) delete db.state.sessions[token];
    db.save();
  }, 3600 * 1000);

  process.on('SIGINT', () => { db.flush(); process.exit(0); });
  process.on('SIGTERM', () => { db.flush(); process.exit(0); });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Zer0Loot Battle Royale → http://localhost:${port}`);
  });
}

if (require.main === module) start();

module.exports = { app, server, io, battle, bets, start, trainings, chatCommand };
