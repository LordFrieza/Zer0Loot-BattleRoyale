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
const market = require('./market');
const casino = require('./casino');
const survivor = require('./survivor');
const housing = require('./housing');
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

// Mode Solo : une partie interrompue par un redémarrage rend son énergie (ou sa Clé de boss).
function refundSoloRuns() {
  let n = 0;
  for (const u of Object.values(db.state.users)) {
    const c = u.character;
    if (!c || !c.soloActive) continue;
    if (c.soloActive.kind === 'boss') game.addKeys(c, Rules.SOLO.keyCost);
    else game.addEnergy(c, 1);
    c.soloActive = null;
    n += 1;
  }
  if (n) { db.save(); console.log(`[solo] ${n} partie(s) solo interrompue(s) : énergie rendue`); }
  return n;
}
refundSoloRuns();
// Survivor : une partie interrompue par un redémarrage rend ses golds.
{
  const n = survivor.refundActive();
  if (n) console.log(`[survivor] ${n} partie(s) interrompue(s) : golds rendus`);
}

function queueView() {
  return { ...battle.publicQueue(), bets: bets.summary() };
}

// Derrière l'hébergeur (Fly.io…), le HTTPS est géré par un proxy.
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
app.post('/api/forge/batch', requirePlayer, action((req) => game.fuseBatch(req.user.character, req.body.rarity, req.body.count)));

// ---------- Casino ----------
// Un coup de casino : le résultat est décidé ici ; un gros gain met à jour le fil diffusé à tous.
function casinoAction(fn) {
  return action((req) => {
    const r = fn(req);
    if (r && r.feed) io.emit('casino', { feed: casino.feed() });
    return r;
  });
}
// La salle : quelques joueurs (dont soi) qui se promènent entre les tables, le fil des gros gains et ses parties en cours.
let crowdCache = { at: 0, ids: [] };
app.get('/api/casino', requirePlayer, (req, res) => {
  if (Date.now() - crowdCache.at > 60 * 1000) {
    const pool = Object.values(db.state.users).filter((u) => u.character && !u.banned && u.role === 'player' && (!u.ghost || u.character.record.battles > 0));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    crowdCache = { at: Date.now(), ids: pool.slice(0, Rules.CASINO.crowdMax).map((u) => u.id) };
  }
  const ids = [req.user.id, ...crowdCache.ids.filter((id) => id !== req.user.id)].slice(0, Rules.CASINO.crowdMax);
  const crowd = ids.map((id) => db.state.users[id]).filter((u) => u && u.character).map((u) => ({
    id: u.id, me: u.id === req.user.id, name: u.twitchDisplayName || u.username, cls: u.character.cls || null, look: lookOf(u), app: appOf(u),
  }));
  res.json({ crowd, feed: casino.feed(), sessions: casino.sessionsOf(req.user) });
});
app.post('/api/casino/slots', requirePlayer, casinoAction((req) => casino.slots(req.user, req.body.bet)));
app.post('/api/casino/roulette', requirePlayer, casinoAction((req) => casino.roulette(req.user, req.body.bets)));
app.post('/api/casino/gobelets', requirePlayer, casinoAction((req) => casino.gobelets(req.user, req.body.bet, req.body.cup)));
app.post('/api/casino/caisse', requirePlayer, casinoAction((req) => casino.caisse(req.user)));
app.post('/api/casino/blackjack/deal', requirePlayer, casinoAction((req) => casino.bjDeal(req.user, req.body.bet)));
app.post('/api/casino/blackjack/hit', requirePlayer, casinoAction((req) => casino.bjHit(req.user)));
app.post('/api/casino/blackjack/stand', requirePlayer, casinoAction((req) => casino.bjStand(req.user)));
app.post('/api/casino/blackjack/double', requirePlayer, casinoAction((req) => casino.bjDouble(req.user)));
app.post('/api/casino/glace/start', requirePlayer, casinoAction((req) => casino.glaceStart(req.user, req.body.bet, req.body.mines)));
app.post('/api/casino/glace/pick', requirePlayer, casinoAction((req) => casino.glacePick(req.user, req.body.index)));
app.post('/api/casino/glace/cash', requirePlayer, casinoAction((req) => casino.glaceCash(req.user)));

// ---------- Survivor ----------
// La partie tourne côté serveur (survivor.tickAll, branché dans start()) ; la position arrive par socket (`sv:pos`).
app.get('/api/survivor', requirePlayer, (req, res) => {
  res.json({ ...survivor.stateOf(req.user), board: survivor.leaderboard(req.user.id) });
});
app.post('/api/survivor/start', requirePlayer, action((req) => {
  const run = survivor.start(req.user, req.body.starter);
  return { frame: run.frame() };
}));
app.post('/api/survivor/choose', requirePlayer, (req, res) => {
  try {
    const r = survivor.current(req.user.id);
    const o = r.run.choose(req.body.index, req.body.id);
    r.seen = Date.now();
    res.json({ ok: true, chosen: o, frame: r.run.frame() });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/survivor/reroll', requirePlayer, (req, res) => {
  try {
    const r = survivor.current(req.user.id);
    r.run.reroll();
    res.json({ ok: true, frame: r.run.frame() });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/survivor/pause', requirePlayer, (req, res) => {
  try {
    survivor.setPause(req.user.id, !!req.body.on);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/survivor/abandon', requirePlayer, action((req) => ({ result: survivor.abandon(req.user.id) })));
app.post('/api/survivor/meta', requirePlayer, action((req) => survivor.buyMeta(req.user.character, String(req.body.id || ''))));
app.post('/api/survivor/unlock', requirePlayer, action((req) => survivor.buyUnlock(req.user.character, String(req.body.kind || ''), String(req.body.id || ''))));
app.post('/api/survivor/starter', requirePlayer, action((req) => survivor.setStarter(req.user.character, String(req.body.id || ''))));
// ---------- Maison ----------
app.get('/api/house', requirePlayer, (req, res) => {
  const H = req.user.character.house;
  res.json({ house: housing.publicHouse(req.user, req.user, appOf, lookOf), owned: H.owned, opts: H.opts, mailDue: Rules.houseMailDue(H.mailAt), mailAt: H.mailAt, emeralds: req.user.character.emeralds });
});
app.get('/api/houses', requirePlayer, (req, res) => res.json({ houses: housing.listHouses(req.query.q, appOf, lookOf) }));
app.get('/api/house/:id', requirePlayer, (req, res) => {
  const owner = db.state.users[req.params.id];
  if (!owner || !owner.character || owner.banned || owner.role !== 'player') return res.status(404).json({ error: 'Maison introuvable' });
  housing.visit(owner, req.user);
  db.save();
  res.json({ house: housing.publicHouse(owner, req.user, appOf, lookOf) });
});
app.post('/api/house/buy', requirePlayer, action((req) => housing.buyFurniture(req.user.character, String(req.body.id || ''), req.body.count)));
app.post('/api/house/layout', requirePlayer, action((req) => housing.saveLayout(req.user.character, req.body.placed)));
app.post('/api/house/style', requirePlayer, action((req) => housing.setStyle(req.user.character, String(req.body.part || ''), String(req.body.id || ''))));
app.post('/api/house/upgrade', requirePlayer, action((req) => housing.upgradeSize(req.user.character)));
app.post('/api/house/mail', requirePlayer, action((req) => housing.collectMail(req.user.character)));
app.post('/api/house/:id/like', requirePlayer, action((req) => housing.toggleLike(req.user, req.params.id)));

// Images et fin de partie, envoyées à la room du joueur.
function survivorTick() {
  survivor.tickAll(
    (userId, frame) => io.to('user:' + userId).emit('svFrame', frame),
    (userId, result) => {
      const user = db.state.users[userId];
      io.to('user:' + userId).emit('svEnd', result);
      if (user) pushMe(user);
      io.emit('svBoard');
    },
  );
}

app.post('/api/forge/reroll', requirePlayer, action((req) => game.reroll(req.user.character, req.body.itemId, req.body.line)));
app.post('/api/forge/alchemy', requirePlayer, action((req) => game.alchemy(req.user.character, req.body.itemId, req.body.line, req.body.sacrificeId)));

app.post('/api/look', requirePlayer, action((req) => {
  game.setLook(req.user.character, String(req.body.part || ''), req.body.value === null || req.body.value === undefined ? null : String(req.body.value));
}));

app.post('/api/shop/buy', requirePlayer, action((req) => game.buyCosmetic(req.user.character, String(req.body.id || ''))));
app.post('/api/drawing', requirePlayer, action((req) => game.setDrawing(req.user.character, req.body.pixels)));

// Visage dessiné d'un joueur (public : l'arène le récupère une fois puis le garde en cache).
app.get('/api/drawing/:id', (req, res) => {
  const user = db.state.users[req.params.id];
  const c = user && user.character;
  if (!c || !c.drawing || user.banned) return res.status(404).json({ error: 'Aucun dessin' });
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ pixels: c.drawing, ver: c.drawingVer });
});

app.post('/api/equip', requirePlayer, action((req) => {
  game.equip(req.user.character, req.body.itemId);
}));

app.post('/api/item/lock', requirePlayer, action((req) => game.toggleLock(req.user.character, String(req.body.itemId || ''))));

// ---------- Familiers (onglet Familier) ----------
app.post('/api/pet/active', requirePlayer, action((req) => game.setActivePet(req.user.character, String(req.body.id || ''))));
app.post('/api/pet/action', requirePlayer, action((req) => game.petAction(req.user.character, String(req.body.kind || ''))));
app.post('/api/pet/feed', requirePlayer, action((req) => game.feedPet(req.user.character, String(req.body.food || ''))));
app.post('/api/pet/food/buy', requirePlayer, action((req) => game.buyPetFood(req.user.character, String(req.body.food || ''), req.body.count)));
app.post('/api/pet/enclos/buy', requirePlayer, action((req) => game.buyEnclos(req.user.character, String(req.body.item || ''))));
app.post('/api/pet/collect', requirePlayer, action((req) => game.collectFinds(req.user.character)));
app.post('/api/pet/rename', requirePlayer, action((req) => game.renamePet(req.user.character, String(req.body.id || ''), req.body.name)));
app.post('/api/pet/follow', requirePlayer, action((req) => game.setPetFollow(req.user.character, req.body.id ? String(req.body.id) : null)));

// Badge « Nouveau ! » vu (survol) : sauvegardé sans renvoyer la fiche (le client a déjà retiré le badge).
app.post('/api/items/seen', requirePlayer, (req, res) => {
  try {
    const seen = game.markSeen(req.user.character, req.body.ids);
    if (seen) db.save();
    res.json({ ok: true, seen });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

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
app.post('/api/talent/extra', requirePlayer, action((req) => game.learnTalentExtra(req.user.character, String(req.body.id || ''))));
app.post('/api/tactics', requirePlayer, action((req) => game.setTactics(req.user.character, req.body || {})));
app.post('/api/techs', requirePlayer, action((req) => game.setTechniques(req.user.character, req.body.techs)));
app.post('/api/stats/reset', requirePlayer, action((req) => game.resetStats(req.user.character)));
app.post('/api/stats/respec', requirePlayer, action((req) => game.respecStats(req.user.character, req.body.stats)));
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

/*
 * Apparence envoyée aux clients : le dessin n'est pas envoyé à chaque frame, seulement une référence
 * « id.version » que l'arène résout une fois via /api/drawing/:id.
 */
function appOf(user) {
  const c = user.character;
  const app = { ...c.look };
  app.drawing = c.look.drawing && c.drawing ? `${user.id}.${c.drawingVer}` : null;
  return app;
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
    app: appOf(user),
    stats: game.derived(c),
    power: game.powerOf(c), // puissance : récompenses équilibrées des modes PvP
    look: lookOf(user),
    ult: Rules.ultOf(c.cls, c.talents || []), // ultime de l'arbre de compétences (null s'il n'en a pas)
    consumable: c.consumableSlot || null, // potion équipée pour cette partie
    tactics: c.tactics || null, // style de combat (posture, cible, recul)
    techs: c.techs || [], // techniques signature
    pet: petFollowOf(c), // compagnon de combat (familier débloqué) : purement cosmétique
  };
}

function petFollowOf(c) {
  const P = c.pets;
  if (!P || !P.follow) return null;
  const pet = P.list.find((x) => x.id === P.follow && x.follower);
  return pet ? pet.species : null;
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
  if (Math.random() < 0.35) {
    // Jamais de cosmétique d'exploit, de dessin, d'article « Vide » ni de skin d'une autre classe sur un bot
    const pool = Object.fromEntries(Object.entries(Rules.COSMETICS).filter(([, it]) => !it.unlock && !it.empty && it.slot !== 'drawing' && (!it.cls || it.cls === cls)));
    const id = anyOf(pool);
    app[Rules.COSMETICS[id].slot] = id;
  }
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
    power: Rules.powerScore(level, Rules.lookGearTotal(look)),
    look,
    ult: Rules.ultOf(cls, talents),
    consumable: Math.random() < 0.3 ? anyOf(Rules.CONSUMABLES) : null,
    techs: randomTechs(cls, level),
  };
}

// Techniques tirées au hasard parmi celles accessibles (bots, mannequins d'entraînement).
function randomTechs(cls, level) {
  const pool = Object.keys(Rules.TECHNIQUES).filter((id) => !Rules.techBlocker(cls, level, id)).sort(() => Math.random() - 0.5);
  return pool.slice(0, Rules.techSlots(level));
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

// clan : équipe demandée en Guerre des clans (!rouge / !bleu) ; un inscrit qui la redemande change d'équipe.
function joinFromTwitch(login, displayName, clan = null) {
  if (battle.phase !== 'queue' && !(clan && battle.phase === 'ready')) return { ok: false, reason: 'closed' };
  const user = game.getOrCreateTwitchUser(login, displayName);
  if (user.banned) return { ok: false, reason: 'banned', user };
  if (clan && battle.participants.has('u' + user.id)) return { ok: false, switched: battle.setClan('u' + user.id, clan), user };
  if (battle.phase !== 'queue') return { ok: false, reason: 'closed', user };
  const joined = battle.join({ ...participantFromUser(user), clan });
  return { ok: joined, user };
}

const clanText = (clan) => `${Rules.CLANS.teams[clan].icon} ${Rules.CLANS.teams[clan].label}`;

// ---------- Abonnements Twitch : Rules.SUB_REWARD_GOLD golds pour celui qui s'abonne / offre l'abonnement ----------

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
  const clan = battle.mode === 'clans' && Object.keys(Rules.CLANS.teams).find((c) => Rules.CLANS.teams[c].cmd === command);
  if (command === '!join' || clan) {
    const r = joinFromTwitch(from.login, from.displayName, clan || null);
    const p = r.user && battle.participants.get('u' + r.user.id);
    if (r.ok) {
      const hint = r.user.ghost ? ' Crée ton compte sur le site et lie ton Twitch pour garder ton loot !' : '';
      twitch.say(`@${from.displayName} rejoint ${p && p.clan ? 'les ' + clanText(p.clan) : 'la bataille'} ⚔️${hint}`);
    } else if (r.switched) twitch.say(`@${from.displayName} passe chez les ${clanText(p.clan)} !`);
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
  const clan = battle.mode === 'clans' && Rules.CLANS.teams[req.body.clan] ? req.body.clan : null;
  const key = 'u' + req.user.id;
  // Guerre des clans : un inscrit peut changer d'équipe tant que la bataille n'a pas commencé.
  if (clan && battle.participants.has(key) && (battle.phase === 'queue' || battle.phase === 'ready')) {
    return res.json({ ok: true, joined: false, switched: battle.setClan(key, clan), clan });
  }
  if (battle.phase !== 'queue') return res.status(400).json({ error: 'La file n\'est pas ouverte' });
  const joined = battle.join({ ...participantFromUser(req.user), clan });
  const p = battle.participants.get(key);
  res.json({ ok: true, joined, clan: p && p.clan });
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
    if (r.outcome === 'won') {
      game.bump(user.character, 'betsWon');
      const profit = Math.max(0, (r.payout || 0) - (r.amount || 0));
      game.addStat(user.character, 'betGold', profit);
      game.addStat(user.character, 'goldEarned', profit);
    }
    pushMe(user);
    io.to('user:' + user.id).emit('bet', r);
  }
}

battle.on('cleared', () => notifyBets(bets.refundAll()));

app.post('/api/admin/queue/open', requireAdmin, action((req) => {
  const seconds = Math.max(10, Math.min(3600, Number(req.body.seconds) || 180));
  const mode = req.body.mode || 'br';
  battle.openQueue(seconds, mode, req.body.boss || 'troll');
  const m = Rules.GAME_MODES[mode];
  const against = mode === 'boss' ? ` contre ${Rules.BOSSES[battle.bossId].icon} ${Rules.BOSSES[battle.bossId].name}`
    : mode === 'rush' ? ' (les boss s\'enchaînent, de plus en plus forts !)' : '';
  twitch.say(`${m.icon} La file du ${m.label}${against} est ouverte pour ${Math.round(seconds / 60 * 10) / 10} min ! Tapez !join pour participer.`);
  return { boss: mode === 'boss' ? battle.bossId : null };
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
    const B = Rules.BOSSES[battle.bossId];
    twitch.say(battle.mode === 'boss' ? `${B.icon} ${B.name} débarque ! Tous ensemble contre lui !`
      : battle.mode === 'rush' ? `💀 BOSS RUSH ! Premier boss : ${B.icon} ${B.name}. Entre chaque boss, le chat vote : !1, !2 ou !3 !`
      : battle.mode === 'gold' ? `🪙 RUÉE VERS L'OR ! Il pleut des pièces et des coffres pendant ${Rules.GOLD.duration} s : chacun garde ce qu'il ramasse !`
      : battle.mode === 'clans' ? '⚔️ Guerre des clans : détruisez le cristal adverse ! 🔴 Rouges contre 🔵 Bleus !'
      : battle.mode === 'koth' ? `👑 Roi de la Colline : tenez la colline pendant ${Math.round(Rules.KOTH.duration / 60 * 10) / 10} min ! Les morts reviennent au combat.`
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

// Gains de la partie en cours (pour l'historique) : ce qui a été crédité à chaque joueur pendant la partie.
const battleGains = new Map(); // userId → { xp, gold, chests }
function grantBattle(user, reward) {
  const g = battleGains.get(user.id) || { xp: 0, gold: 0, chests: 0 };
  g.xp += reward.xp || 0;
  g.gold += reward.gold || 0;
  g.chests += reward.chests || 0;
  battleGains.set(user.id, g);
  return game.grant(user.character, reward);
}

// Historique : une ligne par participant humain à la fin d'une partie du stream.
function recordBattle(f, user, outcome, details = {}) {
  const ranking = (battle.result && battle.result.ranking) || [];
  const rank = ranking.findIndex((r) => r.key === f.key) + 1;
  game.recordActivity(user.character, {
    mode: battle.mode, outcome, rank: rank || undefined, total: ranking.length || undefined,
    kills: f.kills, deaths: f.deaths || (f.alive ? 0 : 1), dealt: Math.round(f.dealt), taken: Math.round(f.taken),
    bossDealt: Math.round(f.bossDealt || 0), duration: Math.round(battle.time),
    gains: battleGains.get(user.id) || { xp: 0, gold: 0, chests: 0 }, details,
  });
}

// Événement « Loot double » : XP, golds et coffres ×2 pendant la bataille.
function scaled(reward) {
  const m = battle.event === 'double' ? 2 : 1;
  return { xp: reward.xp * m, gold: reward.gold * m, chests: reward.chests * m };
}

// Récompenses équilibrées (modes PvP) : puissance moyenne des adversaires d'un combattant.
function opponentsPower(f, fighters) {
  const foes = fighters.filter((o) => o !== f && o.kind === 'player' && (!f.clan || o.clan !== f.clan));
  if (!foes.length) return f.power;
  return foes.reduce((a, o) => a + (o.power || 1), 0) / foes.length;
}
// Récompense de base × événement (Loot double) × multiplicateur de puissance.
function balanced(base, mult) {
  return Rules.scaleReward(scaled(base), mult);
}

battle.on('kill', (killer, victim) => {
  const user = killer.userId && db.state.users[killer.userId];
  if (!user) return;
  // Tuer plus fort que soi rapporte plus, tuer plus faible rapporte moins.
  const mult = Rules.rewardMultiplier(killer.power, victim && victim.power);
  const reward = balanced(Rules.REWARDS.kill, mult);
  const levels = grantBattle(user, reward);
  user.character.record.kills += 1;
  db.save();
  pushMe(user);
  io.to('user:' + user.id).emit('reward', { type: 'kill', reward, levels, mult });
});

// Séries de kills : coffres bonus (premier kill, double kill, massacre).
battle.on('streak', (fighter, kind) => {
  const user = fighter.userId && db.state.users[fighter.userId];
  if (!user) return;
  if (kind !== 'triple') game.bump(user.character, kind);
  const mult = Rules.rewardMultiplier(fighter.power, opponentsPower(fighter, battle.players));
  const reward = Rules.REWARDS[kind] && balanced(Rules.REWARDS[kind], mult);
  if (!reward || !(reward.chests || reward.gold || reward.xp)) { db.save(); pushMe(user); return; }
  const levels = grantBattle(user, reward);
  db.save();
  pushMe(user);
  io.to('user:' + user.id).emit('reward', { type: kind, reward, levels, mult });
});

battle.on('end', (winner, fighters) => {
  for (const f of fighters) {
    const user = f.userId && db.state.users[f.userId];
    if (!user) continue;
    user.character.record.battles += 1;
    const participation = scaled(Rules.REWARDS.participation);
    const participationLevels = grantBattle(user, participation);
    io.to('user:' + user.id).emit('reward', { type: 'participation', reward: participation, levels: participationLevels });
    if (f === winner) {
      const mult = Rules.rewardMultiplier(f.power, opponentsPower(f, battle.players));
      const win = balanced(Rules.REWARDS.win, mult);
      const levels = grantBattle(user, win);
      user.character.record.wins += 1;
      if (battle.mode === 'koth') game.bump(user.character, 'kothWins');
      io.to('user:' + user.id).emit('reward', { type: 'win', reward: win, levels, mult });
    }
    recordBattle(f, user, f === winner ? 'win' : 'loss', battle.mode === 'koth' ? { score: Math.floor(f.score || 0), hillTime: Math.round(f.hillTime || 0) } : {});
    pushMe(user);
  }
  db.save();
  if (winner && battle.mode === 'koth') twitch.say(`👑 ${winner.name} est le Roi de la Colline avec ${Math.floor(winner.score)} points (${winner.kills} kill(s)) !`);
  else if (winner) twitch.say(`🏆 ${winner.name} remporte le Battle Royale avec ${winner.kills} kill(s) !`);

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
    const participationLevels = grantBattle(user, participation);
    io.to('user:' + user.id).emit('reward', { type: 'participation', reward: participation, levels: participationLevels });
    if (result.mode === 'boss' && result.victory) {
      game.bump(user.character, 'bossWins');
      if (Rules.BOSS_WIN_COUNTER[result.boss.id]) game.bump(user.character, Rules.BOSS_WIN_COUNTER[result.boss.id]);
      // Exploit : boss vaincu seul (aucun autre combattant, bot compris) → débloque sa peau légendaire
      if (fighters.length === 1 && Rules.SOLO_BOSS_COUNTER[result.boss.id]) game.bump(user.character, Rules.SOLO_BOSS_COUNTER[result.boss.id]);
      petDrop(user, result.boss.id);
    }
    if (result.mode === 'rush' && result.rush) user.character.counters.rushBest = Math.max(user.character.counters.rushBest || 0, result.rush.killed);
    if (result.mode === 'dungeon') user.character.counters.dungeonBest = Math.max(user.character.counters.dungeonBest || 0, result.room);
    if (result.reward) {
      const reward = { xp: result.reward.xp, gold: result.reward.gold, chests: result.reward.chests };
      const levels = grantBattle(user, reward);
      io.to('user:' + user.id).emit('reward', { type: result.mode, reward, levels, room: result.room });
    }
    const details = result.mode === 'dungeon' ? { room: result.room }
      : result.mode === 'rush' ? { killed: result.rush.killed, defeated: result.rush.defeated, boss: result.boss.id }
        : { boss: result.boss.id, bossHp: Math.round((result.boss.hp / result.boss.maxHp) * 100) };
    recordBattle(f, user, result.mode === 'dungeon' ? 'end' : result.victory ? 'win' : 'loss', details);
    pushMe(user);
  }
  db.save();
  if (result.mode === 'rush') {
    const r = result.reward;
    twitch.say(`💀 Fin du Boss Rush : ${result.rush.killed} boss vaincu${result.rush.killed > 1 ? 's' : ''} !${r ? ` Tous les héros gagnent ${r.chests} coffres, ${r.xp} XP et ${r.gold} golds.` : ' Aucun boss vaincu cette fois…'}`);
  } else if (result.mode === 'boss') {
    twitch.say(result.victory
      ? `🏆 ${result.boss.name} est vaincu ! Tous les participants gagnent ${result.reward.chests} coffres, ${result.reward.xp} XP et ${result.reward.gold} golds !`
      : `💀 ${result.boss.name} a écrasé tout le monde… Retentez votre chance !`);
  } else {
    const r = result.reward;
    twitch.say(`🏰 Le raid s'arrête en salle ${result.room} !${r ? ` Tous les aventuriers gagnent ${[r.chests ? r.chests + ' coffre(s)' : '', r.xp + ' XP', r.gold + ' golds'].filter(Boolean).join(', ')}.` : ' Il faut atteindre la salle 5 pour une récompense.'}`);
  }
  notifyBets(bets.refundAll());
  io.emit('leaderboard', leaderboard());
});

// ---------- Familiers : 5 % de chance par boss vaincu ----------

function petDrop(user, bossId) {
  const r = game.rollPetDrop(user.character, bossId);
  if (!r) return null;
  const name = user.twitchDisplayName || user.username;
  io.to('user:' + user.id).emit('pet', { species: r.pet.species, duplicate: r.duplicate, levels: r.levels });
  if (!r.duplicate) twitch.say(`🐾 Incroyable ! ${name} a obtenu le familier ${Rules.PETS[bossId].name} ! Il l'attend dans son enclos.`);
  return r;
}

// Boss Rush : chaque boss vaincu compte (victoires, familier) dès sa chute.
battle.on('rushBossDown', (info, fighters) => {
  for (const f of fighters) {
    const user = f.userId && db.state.users[f.userId];
    if (!user) continue;
    game.upgrade(user.character);
    game.bump(user.character, 'bossWins');
    if (Rules.BOSS_WIN_COUNTER[info.boss]) game.bump(user.character, Rules.BOSS_WIN_COUNTER[info.boss]);
    petDrop(user, info.boss);
    pushMe(user);
  }
  db.save();
  const B = Rules.BOSSES[info.boss];
  twitch.say(`💥 ${B.icon} ${B.name} est vaincu ! (${info.killed} boss) Votez pour la suite : !1, !2 ou !3`);
});

// ---------- Ruée vers l'or ----------

// Chacun garde ce qu'il a ramassé (golds, coffres) ; le meilleur ramasseur gagne un coffre de plus.
battle.on('goldEnd', (result, fighters) => {
  for (const f of fighters) {
    const user = f.userId && db.state.users[f.userId];
    if (!user) continue;
    user.character.record.battles += 1;
    const best = result.best && result.best.key === f.key ? Rules.GOLD.bestChests : 0;
    const reward = { xp: Rules.REWARDS.participation.xp, gold: f.goldGot, chests: f.chestsGot + best };
    game.upgrade(user.character);
    user.character.counters.goldBest = Math.max(user.character.counters.goldBest || 0, f.goldGot);
    const levels = grantBattle(user, reward);
    io.to('user:' + user.id).emit('reward', { type: 'gold', reward, levels, best: !!best });
    recordBattle(f, user, best ? 'win' : 'end', { gold: f.goldGot, chests: f.chestsGot, best: !!best });
    pushMe(user);
  }
  db.save();
  const b = result.best;
  twitch.say(`🪙 Fin du Golden Shower : ${result.totals.gold} golds et ${result.totals.chests} coffre(s) ramassés !${b ? ` Roi du butin : ${b.name} avec ${b.gold} golds (+1 coffre).` : ''}`);
  notifyBets(bets.refundAll());
  io.emit('leaderboard', leaderboard());
});

// ---------- Guerre des clans ----------

// Participation pour tous ; l'équipe gagnante est récompensée, le meilleur combattant gagne un coffre de plus.
battle.on('clansEnd', (result, fighters) => {
  for (const f of fighters) {
    const user = f.userId && db.state.users[f.userId];
    if (!user) continue;
    user.character.record.battles += 1;
    const participation = { ...Rules.REWARDS.participation };
    const pl = grantBattle(user, participation);
    io.to('user:' + user.id).emit('reward', { type: 'participation', reward: participation, levels: pl });
    // Récompenses équilibrées : puissance moyenne de l'équipe adverse ÷ la sienne.
    const mult = Rules.rewardMultiplier(f.power, opponentsPower(f, fighters));
    if (f.clan === result.winner) {
      user.character.record.wins += 1;
      game.bump(user.character, 'clansWins');
      const reward = Rules.scaleReward(result.reward, mult);
      const levels = grantBattle(user, reward);
      io.to('user:' + user.id).emit('reward', { type: 'clans', reward, levels, clan: result.winner, mult });
    }
    if (result.mvp && result.mvp.key === f.key) {
      game.bump(user.character, 'clansMvp');
      const mvp = Rules.scaleReward({ xp: 0, gold: 0, chests: Rules.CLANS.mvpChests }, mult);
      grantBattle(user, mvp);
      io.to('user:' + user.id).emit('reward', { type: 'mvp', reward: mvp, levels: 0, mult });
    }
    recordBattle(f, user, f.clan === result.winner ? 'win' : 'loss', { clan: f.clan, mvp: !!(result.mvp && result.mvp.key === f.key) });
    pushMe(user);
  }
  db.save();
  const T = Rules.CLANS.teams[result.winner];
  twitch.say(`${T.icon} Victoire des ${T.label} ! Chaque membre gagne ${result.reward.xp} XP, ${result.reward.gold} golds et ${result.reward.chests} coffre.${result.mvp ? ` MVP : ${result.mvp.name} (+1 coffre).` : ''}`);
  notifyBets(bets.settle('clan:' + result.winner, `les ${T.label}`));
  const br = bets.summary().lastResult;
  if (br && !br.refund && br.winners) twitch.say(`💰 ${br.winners > 1 ? br.winners + ' parieurs se partagent' : '1 parieur remporte'} ${br.distributed} golds de mises perdues !`);
  db.save();
  io.emit('leaderboard', leaderboard());
});

// ---------- Sondage du donjon ----------

const boonText = (id) => { const b = Rules.DUNGEON_BOONS[id]; return `${b.icon} ${b.label} (${b.cmd})`; };

battle.on('pollStart', (poll) => {
  if (poll.rush) {
    twitch.say(`🗳️ Boss vaincu ! Votez pendant ${Rules.RUSH.poll.duration} s : ${poll.options.map((o, i) => `!${i + 1} ${o.icon} ${o.label}`).join(' · ')}`);
    return;
  }
  twitch.say(`🗳️ Salle ${poll.room} franchie ! Votez dans le chat pendant ${Rules.DUNGEON_POLL.duration} s : ${poll.options.map((o) => boonText(o.id)).join(' OU ')}`);
});

// Bonus immédiat (golds, XP, coffre) : pour TOUS les participants humains, morts compris.
battle.on('pollEnd', (result, fighters) => {
  const b = result.info || Rules.DUNGEON_BOONS[result.id]; // Boss Rush : description calculée par la bataille
  if (result.reward) {
    for (const f of fighters) {
      const user = f.userId && db.state.users[f.userId];
      if (!user) continue;
      const levels = grantBattle(user, result.reward);
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
    expedition: (u.character.counters && u.character.counters.expeditionBest) || 0, // record de profondeur (mode Solo)
    dungeon: (u.character.counters && u.character.counters.dungeonBest) || 0, // record de salle (Raid de Donjon)
  }));
  const top = (key) => list.filter((p) => p[key] > 0).sort((a, b) => b[key] - a[key] || b.level - a.level).slice(0, BOARD_SIZE)
    .map((p) => ({ ...p, value: p[key] }));
  return { wins: top('wins'), kills: top('kills'), battles: top('battles'), expedition: top('expedition'), dungeon: top('dungeon') };
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
      drawing: u.character.drawing || null, // visage dessiné (modération)
    };
  }));
});

// Historique global : les parties de tous les joueurs (filtres : joueur, mode), les plus récentes d'abord.
app.get('/api/admin/history', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const mode = String(req.query.mode || '');
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));
  const rows = [];
  for (const u of players()) {
    const name = u.twitchDisplayName || u.username;
    if (q && !name.toLowerCase().includes(q) && !(u.twitchLogin || '').includes(q)) continue;
    for (const e of u.character.history || []) {
      if (mode && e.mode !== mode) continue;
      rows.push({ ...e, userId: u.id, name });
    }
  }
  rows.sort((a, b) => b.at - a.at);
  res.json(rows.slice(0, limit));
});

/*
 * Échanges du marché (tous les joueurs), avec des signaux de comportement suspect :
 *  - pair : le même vendeur a vendu au moins 3 fois au même acheteur ;
 *  - cheap : objet épique ou légendaire vendu au prix minimum (cadeau déguisé ?) ;
 *  - pricey : prix au moins 10 fois au-dessus du prix médian de sa rareté.
 */
app.get('/api/admin/market/trades', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const all = market.trades();
  const pairs = {};
  const byRarity = {};
  for (const t of all) {
    pairs[t.sellerId + '>' + t.buyerId] = (pairs[t.sellerId + '>' + t.buyerId] || 0) + 1;
    (byRarity[t.rarity] = byRarity[t.rarity] || []).push(t.price);
  }
  const median = {};
  for (const [r, list] of Object.entries(byRarity)) { const sorted = [...list].sort((a, b) => a - b); median[r] = sorted[Math.floor(sorted.length / 2)]; }
  const rows = all
    .filter((t) => !q || t.seller.toLowerCase().includes(q) || t.buyer.toLowerCase().includes(q) || t.item.toLowerCase().includes(q))
    .map((t) => {
      const flags = [];
      if (pairs[t.sellerId + '>' + t.buyerId] >= 3) flags.push('pair');
      if ((t.rarity === 'epique' || t.rarity === 'legendaire') && t.price <= Rules.MARKET.minPrice) flags.push('cheap');
      if (median[t.rarity] && byRarity[t.rarity].length >= 5 && t.price >= median[t.rarity] * 10) flags.push('pricey');
      return { ...t, flags, pairCount: pairs[t.sellerId + '>' + t.buyerId] };
    });
  res.json(rows.slice(0, 300));
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
  if (r.pet) io.to('user:' + user.id).emit('pet', { species: r.pet, duplicate: r.duplicate, from: 'admin' });
  else io.to('user:' + user.id).emit('reward', { type: 'gift', reward: r.reward, levels: r.levels });
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

// Modération : efface le visage dessiné d'un joueur.
app.post('/api/admin/players/:id/drawing/clear', requireAdmin, action((req) => {
  const user = adminTarget(req);
  game.clearDrawing(user.character);
  pushMe(user);
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
  battleGains.clear();
  if (battle.mode === 'gold') return; // pas de combat dans le mode bonus : la potion reste pour la prochaine partie
  for (const f of fighters) {
    const user = f.userId && db.state.users[f.userId];
    if (!user || !f.consumable) continue;
    game.useConsumable(user.character);
    game.addStat(user.character, 'potionsUsed');
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
    // Répétition du mode Solo (Expédition, Défi des boss) ou Boss Rush en solo : sans énergie, sans récompense,
    // rien n'est compté.
    if (req.body.opponent === 'expedition' || req.body.opponent === 'boss' || req.body.opponent === 'rush') {
      const kind = req.body.opponent;
      const bossId = kind === 'boss' ? String(req.body.boss || 'troll') : 'troll';
      if (!Rules.BOSSES[bossId]) throw new Error('Boss inconnu');
      const difficulty = kind !== 'expedition' ? String(req.body.difficulty || 'normal') : null;
      if (kind !== 'expedition' && !Rules.BOSS_CHALLENGE[difficulty]) throw new Error('Difficulté inconnue');
      const b = new Battle({ solo: { kind, level: user.character.level, difficulty, training: true } });
      b.openQueue(60, kind === 'boss' ? 'boss' : kind === 'rush' ? 'rush' : 'dungeon', bossId);
      clearTimeout(b.queueTimer);
      b.join({ ...participantFromUser(user), consumable: null });
      const room = 'user:' + user.id;
      b.on('queue', (q) => io.to(room).emit('trainingQueue', { ...q, training: true }));
      b.on('frame', (f) => io.to(room).emit('trainingFrame', f));
      b.on('coopEnd', () => { clearTimeout(b.trainingTimer); trainings.delete(user.id); });
      b.setSpeed(Rules.SOLO.speeds.includes(Number(req.body.speed)) ? Number(req.body.speed) : 1);
      b.start(null, null);
      trainings.set(user.id, b);
      b.trainingTimer = setTimeout(() => b.abandon(), Rules.TRAINING.soloMaxDuration * 1000);
      b.trainingTimer.unref();
      const B = Rules.BOSSES[bossId];
      res.json({ ok: true, opponent: kind === 'boss'
        ? { name: B.name, level: user.character.level, difficulty }
        : kind === 'rush' ? { name: 'Boss Rush', level: user.character.level, difficulty }
          : { name: 'Expédition', level: user.character.level } });
      return;
    }
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

// Entraînement en mode Solo : choix de la relique et vitesse, comme une vraie partie solo.
function trainingSolo(req) {
  const b = trainings.get(req.user.id);
  if (!b || !b.solo || b.phase !== 'battle') throw new Error('Aucun entraînement solo en cours');
  return b;
}
app.post('/api/training/relic', requirePlayer, action((req) => {
  const id = trainingSolo(req).chooseRelic(String(req.body.id || ''));
  if (!id) throw new Error('Cette relique n\'est pas proposée');
  return { id };
}));
// Boss Rush d'entraînement : le choix entre deux boss se fait en cliquant (pas de vote du chat).
app.post('/api/training/rush', requirePlayer, action((req) => {
  const id = trainingSolo(req).chooseRush(String(req.body.id || ''));
  if (!id) throw new Error('Ce choix n\'est pas proposé');
  return { id };
}));
app.post('/api/training/speed', requirePlayer, action((req) => {
  const speed = Number(req.body.speed);
  if (!Rules.SOLO.speeds.includes(speed)) throw new Error('Vitesse inconnue');
  trainingSolo(req).setSpeed(speed);
  return { speed };
}));

app.post('/api/training/stop', requirePlayer, (req, res) => {
  stopTraining(req.user.id);
  io.to('user:' + req.user.id).emit('trainingQueue', { phase: 'idle', mode: 'br', training: true, participants: [], result: null });
  res.json({ ok: true });
});


// ---------- Marché entre joueurs ----------

// Prévient un joueur (en direct) qu'il a du courrier, et rafraîchit sa fiche.
function notifyMail(user) {
  pushMe(user);
  const last = user.character.mail[0];
  if (last) io.to('user:' + user.id).emit('mail', last);
}

// Ventes expirées : objets rendus et vendeurs prévenus (avant chaque lecture ou action sur le marché).
function sweepMarket() {
  const touched = market.sweep();
  for (const u of touched) notifyMail(u);
  return touched.length;
}

app.get('/api/market', requirePlayer, (req, res) => {
  sweepMarket();
  const orders = market.list();
  res.json({ orders, mine: orders.filter((o) => o.sellerId === req.user.id).length });
});

app.post('/api/market/sell', requirePlayer, action((req) => {
  sweepMarket();
  const r = market.sell(req.user, String(req.body.itemId || ''), req.body.price);
  io.emit('market');
  return { tax: r.tax, orderId: r.order.id };
}));

app.post('/api/market/buy', requirePlayer, action((req) => {
  sweepMarket();
  const r = market.buy(req.user, String(req.body.orderId || ''));
  notifyMail(r.seller);
  io.emit('market');
  return { item: r.item, price: r.price };
}));

app.post('/api/market/cancel', requirePlayer, action((req) => {
  sweepMarket();
  const r = market.cancel(req.user, String(req.body.orderId || ''));
  io.emit('market');
  return { item: r.item };
}));

app.post('/api/mail/read', requirePlayer, action((req) => market.readMail(req.user)));

// ---------- Mode Solo (V2) ----------
/*
 * Expédition (profondeurs + reliques) ou Défi des boss, contre 1 énergie. Simulé sur une Battle à part, diffusé
 * seulement au joueur (« soloQueue » / « soloFrame »), sans potion. Les gains sont crédités à la fin.
 */
const solos = new Map(); // userId → Battle

function soloIdle() {
  return { phase: 'idle', mode: 'dungeon', solo: null, participants: [], result: null };
}

function endSolo(userId) {
  const b = solos.get(userId);
  if (!b) return;
  b.stopLoop();
  clearTimeout(b.soloTimer);
  b.removeAllListeners();
  solos.delete(userId);
}

function soloRewards(user, result, f = null) {
  const c = user.character;
  game.upgrade(c);
  c.soloActive = null;
  let levels = 0;
  // Clés de boss trouvées dans l'Expédition (jamais en répétition) : gardées même en cas de défaite
  const keys = result.solo === 'expedition' && !result.training ? Math.max(0, result.keys || 0) : 0;
  if (keys) game.addKeys(c, keys);
  if (result.reward) {
    const reward = { xp: result.reward.xp, gold: result.reward.gold, chests: result.reward.chests };
    levels = game.grant(c, reward);
    io.to('user:' + user.id).emit('reward', { type: 'solo_' + result.solo, reward, levels, depth: result.depth, keys: keys || undefined });
  }
  if (result.solo === 'expedition') {
    c.counters.expeditionBest = Math.max(c.counters.expeditionBest || 0, result.depth || 0);
    if (result.relics && result.relics.length) game.bump(c, 'relics', result.relics.length);
  }
  if (result.solo === 'boss' && result.victory) {
    const id = result.boss.id;
    petDrop(user, id);
    game.bump(c, 'challengeWins');
    if (Rules.SOLO_BOSS_COUNTER[id]) game.bump(c, Rules.SOLO_BOSS_COUNTER[id]);
    if (Rules.BOSS_WIN_COUNTER[id]) game.bump(c, Rules.BOSS_WIN_COUNTER[id]);
    // Héroïque ou Légendaire : débloque la peau légendaire du boss
    if (result.difficulty === 'heroique' || result.difficulty === 'legendaire') {
      game.bump(c, 'heroWins');
      if (Rules.HERO_BOSS_COUNTER[id]) game.bump(c, Rules.HERO_BOSS_COUNTER[id]);
    }
    if (result.difficulty === 'legendaire') {
      game.bump(c, 'legendWins');
      if (Rules.LEGEND_BOSS_COUNTER[id]) game.bump(c, Rules.LEGEND_BOSS_COUNTER[id]); // skins d'exploit (100 victoires)
    }
  }
  // Historique : expédition (profondeur) ou défi (vie restante du boss)
  game.recordActivity(c, {
    mode: result.solo === 'expedition' ? 'expedition' : 'challenge',
    outcome: result.solo === 'expedition' ? 'end' : result.victory ? 'win' : 'loss',
    kills: f ? f.kills : 0, deaths: f && !f.alive ? 1 : 0, dealt: f ? Math.round(f.dealt) : 0, taken: f ? Math.round(f.taken) : 0,
    bossDealt: f ? Math.round(f.bossDealt || 0) : 0, duration: result.duration,
    gains: { xp: result.reward ? result.reward.xp : 0, gold: result.reward ? result.reward.gold : 0, chests: result.reward ? result.reward.chests : 0, keys: keys || undefined },
    details: result.solo === 'expedition'
      ? { depth: result.depth || 0, relics: (result.relics || []).length, abandoned: !!result.abandoned }
      : { boss: result.boss.id, difficulty: result.difficulty, bossHp: Math.round((result.boss.hp / result.boss.maxHp) * 100), abandoned: !!result.abandoned },
  });
  db.save();
  pushMe(user);
}

app.post('/api/solo/start', requirePlayer, (req, res) => {
  try {
    const user = req.user;
    const c = user.character;
    if (!c.cls) throw new Error('Choisis d\'abord une classe');
    if (solos.has(user.id) || c.soloActive) throw new Error('Tu as déjà une partie solo en cours');
    const kind = String(req.body.kind || '');
    if (!Rules.SOLO_MODES[kind]) throw new Error('Mode solo inconnu');
    const bossId = kind === 'boss' ? String(req.body.boss || 'troll') : null;
    if (kind === 'boss' && !Rules.BOSSES[bossId]) throw new Error('Boss inconnu');
    const difficulty = kind === 'boss' ? String(req.body.difficulty || 'normal') : null;
    if (kind === 'boss' && !Rules.BOSS_CHALLENGE[difficulty]) throw new Error('Difficulté inconnue');
    if (solos.size >= Rules.SOLO.maxConcurrent) throw new Error('Trop de parties solo en cours, réessaie dans un instant');
    if (kind === 'boss') game.spendKey(c);
    else game.spendEnergy(c);
    c.soloActive = { kind, startedAt: Date.now() };
    db.save();

    const b = new Battle({ solo: { kind, level: c.level, difficulty } });
    b.openQueue(60, kind === 'boss' ? 'boss' : 'dungeon', bossId || 'troll');
    clearTimeout(b.queueTimer);
    b.join({ ...participantFromUser(user), consumable: null });
    const room = 'user:' + user.id;
    b.on('queue', (q) => io.to(room).emit('soloQueue', q));
    b.on('frame', (f) => io.to(room).emit('soloFrame', f));
    b.on('coopEnd', (result, players) => {
      clearTimeout(b.soloTimer);
      soloRewards(user, result, players[0]);
      // La partie reste affichée (résultat) jusqu'à la suivante ; plus rien ne tourne.
      setImmediate(() => { if (solos.get(user.id) === b) { b.removeAllListeners(); solos.delete(user.id); } });
    });
    b.setSpeed(Rules.SOLO.speeds.includes(Number(req.body.speed)) ? Number(req.body.speed) : 1);
    b.start(null, null);
    solos.set(user.id, b);
    // Garde-fou : au-delà de SOLO.maxDuration, la partie s'arrête (l'Expédition garde ses étages).
    b.soloTimer = setTimeout(() => b.abandon(), Rules.SOLO.maxDuration * 1000);
    b.soloTimer.unref(); // n'empêche jamais le processus de s'arrêter
    pushMe(user);
    res.json({ ok: true, energy: game.energyOf(c), bossKeys: c.bossKeys });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function soloOf(req) {
  const b = solos.get(req.user.id);
  if (!b || b.phase !== 'battle') throw new Error('Aucune partie solo en cours');
  return b;
}

app.post('/api/solo/relic', requirePlayer, action((req) => {
  const id = soloOf(req).chooseRelic(String(req.body.id || ''));
  if (!id) throw new Error('Cette relique n\'est pas proposée');
  return { id };
}));

app.post('/api/solo/speed', requirePlayer, action((req) => {
  const b = soloOf(req);
  const speed = Number(req.body.speed);
  if (!Rules.SOLO.speeds.includes(speed)) throw new Error('Vitesse inconnue');
  b.setSpeed(speed);
  return { speed };
}));

app.post('/api/solo/abandon', requirePlayer, action((req) => {
  soloOf(req).abandon();
}));

app.get('/api/solo/state', requirePlayer, (req, res) => {
  const b = solos.get(req.user.id);
  res.json(b ? { queue: b.publicQueue(), frame: b.frame() } : { queue: soloIdle(), frame: null });
});

// ---------- Temps réel ----------

io.on('connection', (socket) => {
  const user = userFromCookie(socket.request.headers.cookie);
  if (user) socket.join('user:' + user.id);
  // Survivor : position du joueur (ZQSD), jusqu'à 30 fois par seconde
  if (user) socket.on('sv:pos', (msg) => survivor.input(user.id, msg));
  socket.emit('queue', queueView());
  socket.emit('frame', battle.frame());
});

// ---------- Démarrage ----------

// Tout ce qui a des effets de bord permanents (port, chat Twitch, minuteurs, signaux) est ici,
// pour que `require('./index')` reste sans effet dans les tests.
function start(port = PORT) {
  startTwitch();
  setInterval(() => io.emit('twitch', twitch.status()), 5000);
  // Marché : les ventes expirées rendent leurs objets (et préviennent les vendeurs), même si personne n'ouvre le marché.
  setInterval(() => { if (sweepMarket()) io.emit('market'); }, 5 * 60 * 1000);
  // Survivor : 20 pas de simulation par seconde pour toutes les parties en cours.
  setInterval(survivorTick, 50);

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

module.exports = {
  survivorTick, app, server, io, battle, bets, start, trainings, solos, refundSoloRuns, chatCommand };
