/*
 * Sécurité du compte : adresse e-mail (vérifiée par un lien), mot de passe oublié, lien de réinitialisation.
 * Les jetons envoyés par e-mail ne sont jamais gardés en clair : seule leur empreinte SHA-256 est enregistrée sur le
 * compte (user.emailToken / user.resetToken, avec leur date d'expiration). Un jeton ne sert qu'une fois.
 * Champs du compte (pas du personnage) : email, emailVerified, emailPending, emailToken, resetToken, resetSentAt.
 */
const crypto = require('crypto');
const db = require('./db');

const EMAIL_TTL = 24 * 3600 * 1000; // lien de vérification d'adresse : 24 h
const RESET_TTL = 3600 * 1000; // lien « mot de passe oublié » : 1 h
const ADMIN_RESET_TTL = 48 * 3600 * 1000; // lien donné par l'admin : 48 h
const RESET_EVERY = 5 * 60 * 1000; // au plus un e-mail de réinitialisation toutes les 5 min par compte

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
function makeToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashToken(token) };
}

function normalizeEmail(raw) {
  const e = String(raw == null ? '' : raw).trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e)) throw new Error('Adresse e-mail invalide');
  return e;
}

// « k***n@g***.com » : ce que l'admin voit de l'adresse d'un joueur
function maskEmail(e) {
  if (!e) return null;
  const [name, domain] = e.split('@');
  const dot = domain.lastIndexOf('.');
  const d = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  const m = (s) => (s.length <= 2 ? s[0] + '*' : s[0] + '***' + s[s.length - 1]);
  return `${m(name)}@${m(d)}${tld}`;
}

const players = () => Object.values(db.state.users).filter((u) => u.role === 'player' && !u.ghost);
function emailTaken(email, except) {
  return players().some((u) => u !== except && u.email === email && u.emailVerified);
}

// Nouvelle adresse : en attente jusqu'au clic sur le lien reçu (renvoie le jeton à mettre dans le lien)
function startEmailChange(user, rawEmail, now = Date.now()) {
  const email = normalizeEmail(rawEmail);
  if (emailTaken(email, user)) throw new Error('Cette adresse est déjà liée à un autre compte');
  const { token, hash } = makeToken();
  user.emailPending = email;
  user.emailToken = { hash, exp: now + EMAIL_TTL };
  db.save();
  return token;
}

function verifyEmail(token, now = Date.now()) {
  const hash = hashToken(token);
  const user = players().find((u) => u.emailToken && u.emailToken.hash === hash);
  if (!user || user.emailToken.exp < now || !user.emailPending) throw new Error('Lien expiré ou déjà utilisé');
  if (emailTaken(user.emailPending, user)) throw new Error('Cette adresse est déjà liée à un autre compte');
  user.email = user.emailPending;
  user.emailVerified = true;
  delete user.emailPending;
  delete user.emailToken;
  db.save();
  return user;
}

function removeEmail(user) {
  delete user.email;
  delete user.emailPending;
  delete user.emailToken;
  user.emailVerified = false;
  db.save();
}

// Compte visé par « mot de passe oublié » : par pseudo ou par adresse e-mail vérifiée
function findForForgot(login) {
  const l = String(login || '').trim().toLowerCase();
  if (!l) return null;
  return players().find((u) => u.username.toLowerCase() === l || (u.emailVerified && u.email === l)) || null;
}

// Jeton de réinitialisation. Par e-mail : au plus un toutes les 5 min (null sinon) ; par l'admin : sans limite, 48 h.
function startReset(user, now = Date.now(), { admin = false } = {}) {
  if (!admin && user.resetSentAt && now - user.resetSentAt < RESET_EVERY) return null;
  const { token, hash } = makeToken();
  user.resetToken = { hash, exp: now + (admin ? ADMIN_RESET_TTL : RESET_TTL) };
  if (!admin) user.resetSentAt = now;
  db.save();
  return token;
}

function findByReset(token, now = Date.now()) {
  if (!token) return null;
  const hash = hashToken(token);
  const user = players().find((u) => u.resetToken && u.resetToken.hash === hash);
  return user && user.resetToken.exp >= now ? user : null;
}

function clearReset(user) {
  delete user.resetToken;
  db.save();
}

module.exports = {
  hashToken, normalizeEmail, maskEmail, startEmailChange, verifyEmail, removeEmail, findForForgot, startReset, findByReset, clearReset,
  EMAIL_TTL, RESET_TTL, ADMIN_RESET_TTL, RESET_EVERY,
};
