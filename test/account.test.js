/*
 * Sécurité du compte : adresse e-mail vérifiée, jetons (empreinte seulement), mot de passe oublié, adresse masquée.
 */
const test = require('node:test');
const assert = require('node:assert');
const { db } = require('./helpers');
const account = require('../server/account');

let n = 0;
function user(extra = {}) {
  const u = { id: 'acc' + (++n), username: 'Compte' + n, role: 'player', passwordHash: 'x:y', ...extra };
  db.state.users[u.id] = u;
  return u;
}

test('[ACC-17] e-mail : adresse validée, en attente jusqu\'au lien (24 h, une fois), jeton jamais gardé en clair, doublon refusé', () => {
  assert.throws(() => account.normalizeEmail('pas-une-adresse'), /invalide/);
  assert.strictEqual(account.normalizeEmail('  Kevin.Dupont@Mail.FR '), 'kevin.dupont@mail.fr');
  const u = user();
  const token = account.startEmailChange(u, 'Joueur@Exemple.fr', 1000);
  assert.strictEqual(u.emailPending, 'joueur@exemple.fr');
  assert.ok(!u.email && !u.emailVerified, 'pas encore liée');
  assert.notStrictEqual(u.emailToken.hash, token, 'seule l\'empreinte est gardée');
  assert.strictEqual(u.emailToken.hash, account.hashToken(token));
  assert.strictEqual(u.emailToken.exp, 1000 + account.EMAIL_TTL);
  assert.throws(() => account.verifyEmail(token, 1000 + account.EMAIL_TTL + 1), /expiré/);
  assert.strictEqual(account.verifyEmail(token, 2000), u);
  assert.deepStrictEqual([u.email, u.emailVerified, u.emailPending, u.emailToken], ['joueur@exemple.fr', true, undefined, undefined]);
  assert.throws(() => account.verifyEmail(token, 2000), /déjà utilisé/);
  // Adresse déjà confirmée ailleurs
  assert.throws(() => account.startEmailChange(user(), 'joueur@exemple.fr'), /déjà liée/);
  account.removeEmail(u);
  assert.deepStrictEqual([u.email, u.emailVerified], [undefined, false]);
});

test('[ACC-18, ACC-19] mot de passe oublié : par pseudo ou adresse confirmée, 1 h, un e-mail / 5 min ; lien admin 48 h ; adresse masquée', () => {
  const u = user({ email: 'retrouve@moi.fr', emailVerified: true });
  user({ email: 'pasconfirme@moi.fr', emailVerified: false });
  assert.strictEqual(account.findForForgot(u.username.toUpperCase()), u);
  assert.strictEqual(account.findForForgot('retrouve@moi.fr'), u);
  assert.strictEqual(account.findForForgot('pasconfirme@moi.fr'), null, 'adresse non confirmée : rien');
  assert.strictEqual(account.findForForgot('inconnu'), null);
  const t = account.startReset(u, 10000);
  assert.strictEqual(account.findByReset(t, 10000 + account.RESET_TTL), u);
  assert.strictEqual(account.findByReset(t, 10000 + account.RESET_TTL + 1), null, 'expiré');
  assert.strictEqual(account.startReset(u, 10000 + 60000), null, 'un e-mail toutes les 5 min au plus');
  const t2 = account.startReset(u, 10000 + account.RESET_EVERY);
  assert.strictEqual(account.findByReset(t, 10000 + account.RESET_EVERY), null, 'un nouveau lien remplace l\'ancien');
  assert.strictEqual(account.findByReset(t2, 10000 + account.RESET_EVERY), u);
  account.clearReset(u);
  assert.strictEqual(account.findByReset(t2, 10000 + account.RESET_EVERY), null, 'une seule fois');
  const ta = account.startReset(u, 20000, { admin: true });
  assert.strictEqual(account.findByReset(ta, 20000 + 47 * 3600000), u, 'lien admin : 48 h');
  assert.strictEqual(account.maskEmail('kevin@gmail.com'), 'k***n@g***l.com');
  assert.strictEqual(account.maskEmail('ab@x.fr'), 'a*@x*.fr');
  assert.strictEqual(account.maskEmail(null), null);
});
