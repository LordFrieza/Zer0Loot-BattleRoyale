/*
 * Tchat du site : messages, émotes, commandes, anti-spam, sourdine, modération, annonces du jeu.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, game, db } = require('./helpers');
const chat = require('../server/chat');

let n = 0;
function player(opts = {}) {
  const c = game.newCharacter();
  game.chooseClass(c, 'mage');
  const u = { id: 'chat' + (++n), username: 'Bavard' + n, role: 'player', character: c, ...opts };
  db.state.users[u.id] = u;
  return u;
}
const T0 = 1e12;

test('[TCH-1] message : auteur (pseudo, classe, couleur choisie, titre), texte nettoyé, 200 caractères au plus, réservé aux joueurs', () => {
  const u = player({ twitchDisplayName: 'Zorglub' });
  u.character.look.color = 'rose';
  u.character.title = Rules.ACHIEVEMENTS[0].id;
  const { message: m } = chat.send(u, '  salut   tout\nle monde  ', T0);
  assert.deepStrictEqual([m.name, m.cls, m.color, m.title, m.text, m.uid], ['Zorglub', 'mage', Rules.APPEARANCE.color.options.rose.hex, Rules.ACHIEVEMENTS[0].name, 'salut tout le monde', u.id]);
  assert.ok(m.id > 0 && m.at > 0);
  assert.strictEqual(chat.send(player(), 'coucou', T0).message.color, null, 'couleur automatique : calculée depuis le pseudo par le navigateur');
  assert.throws(() => chat.send(player(), '   ', T0), /vide/);
  assert.throws(() => chat.send(player(), 'x'.repeat(Rules.CHAT.maxLen + 1), T0), /200 caractères/);
  assert.throws(() => chat.send({ id: 'adm', role: 'admin' }, 'hello', T0), /joueurs/);
  assert.strictEqual(chat.history().at(-1).text, 'coucou');
});

test('[TCH-2] émotes : « :id: » des boss et du jeu, découpage partagé, 8 au plus par message', () => {
  assert.ok(Object.keys(Rules.CHAT_EMOTES).length >= 15);
  for (const b of ['pyrax', 'ether', 'daedra', 'lilith', 'grokk', 'malvorath', 'grignotor', 'givrenoire', 'maexxna']) assert.ok(Rules.CHAT_EMOTES[b].boss, b);
  assert.deepStrictEqual(Rules.chatTokens('gg :pyrax::coffre: :nope:'), [{ t: 'text', v: 'gg ' }, { t: 'emote', id: 'pyrax' }, { t: 'emote', id: 'coffre' }, { t: 'text', v: ' :nope:' }]);
  const u = player();
  assert.strictEqual(chat.send(u, ':gg: '.repeat(8), T0).message.text.trim().split(' ').length, 8);
  assert.throws(() => chat.send(player(), ':gg:'.repeat(9), T0), /8 émotes/);
});

test('[TCH-3] commandes : /me, /roll (dé crypto), /pile, /aide (réponse privée), commande inconnue', () => {
  const u = player();
  let t = T0;
  const next = () => (t += 5000);
  const me = chat.send(u, '/me danse la gigue', next()).message;
  assert.deepStrictEqual([me.me, me.text], [true, 'danse la gigue']);
  for (let i = 0; i < 20; i++) {
    const r = chat.send(u, '/roll 6', next()).message.roll;
    assert.ok(r.max === 6 && r.n >= 1 && r.n <= 6);
  }
  assert.strictEqual(chat.send(u, '/roll', next()).message.roll.max, 100);
  assert.throws(() => chat.send(u, '/roll 1', next()), /2 à 1000/);
  assert.ok(['pile', 'face'].includes(chat.send(u, '/pile', next()).message.flip));
  const before = chat.history().length;
  assert.deepStrictEqual(chat.send(u, '/aide', next()), { private: chat.HELP });
  assert.strictEqual(chat.history().length, before, '/aide ne publie rien');
  assert.throws(() => chat.send(u, '/danse', next()), /Commande inconnue/);
});

test('[TCH-4] anti-spam (1 message / s, 5 par 10 s) et sourdine décidée par l\'admin', () => {
  const u = player();
  chat.send(u, 'un', T0);
  assert.throws(() => chat.send(u, 'deux', T0 + 500), /un message par seconde/);
  for (let i = 1; i <= 4; i++) chat.send(u, 'msg' + i, T0 + i * 1100);
  assert.throws(() => chat.send(u, 'trop', T0 + 5 * 1100), /5 messages/);
  chat.send(u, 'plus tard', T0 + 12000);
  const v = player();
  assert.deepStrictEqual(chat.mute(v, 10, T0), { muted: 10, name: v.username });
  assert.throws(() => chat.send(v, 'hé', T0 + 60000), /sourdine encore 9 min/);
  chat.send(v, 'me revoilà', T0 + 11 * 60000);
  chat.mute(v, 10, T0 + 12 * 60000);
  chat.mute(v, 0, T0 + 12 * 60000);
  chat.send(v, 'levée', T0 + 13 * 60000);
});

test('[TCH-5] historique limité, annonces du jeu, modération (suppression, salon vidé)', () => {
  const s = chat.system('📣 La file est ouverte', 'info');
  assert.deepStrictEqual([s.sys, s.kind, s.text, s.uid], [true, 'info', '📣 La file est ouverte', undefined]);
  for (let i = 0; i < Rules.CHAT.history + 10; i++) chat.system('annonce ' + i);
  assert.strictEqual(chat.history().length, Rules.CHAT.history);
  const last = chat.history().at(-1);
  assert.deepStrictEqual(chat.remove(last.id), { deleted: last.id });
  assert.throws(() => chat.remove(last.id), /introuvable/);
  assert.deepStrictEqual(chat.clear(), { cleared: true });
  assert.deepStrictEqual(chat.history(), []);
});
