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
  assert.deepStrictEqual(chat.remove(last.id), { deleted: last.id, room: 'general' });
  assert.throws(() => chat.remove(last.id), /introuvable/);
  assert.deepStrictEqual(chat.clear(), { cleared: true, room: null });
  assert.deepStrictEqual(chat.history(), []);
});

test('[TCH-7] salons : Général, Pêche, Strat & builds, Commerce ; historique par salon ; ancienne sauvegarde → Général', () => {
  assert.deepStrictEqual(Rules.CHAT_ROOM_IDS, ['general', 'peche', 'strat', 'commerce']);
  chat.clear();
  const u = player();
  let t = T0 + 1e9;
  const m = chat.send(u, 'qui pêche ?', (t += 5000), 'peche').message;
  assert.strictEqual(m.room, 'peche');
  assert.strictEqual(chat.send(u, 'build archer ?', (t += 5000), 'strat').message.room, 'strat');
  assert.strictEqual(chat.send(u, 'salut', (t += 5000)).message.room, 'general', 'Général par défaut');
  assert.strictEqual(chat.send(u, '/me lance sa ligne', (t += 5000), 'peche').message.room, 'peche');
  assert.throws(() => chat.send(u, 'hop', (t += 5000), 'secret'), /Salon inconnu/);
  assert.deepStrictEqual(chat.history('peche').map((x) => x.text), ['qui pêche ?', 'lance sa ligne']);
  assert.deepStrictEqual(chat.history().map((x) => x.text), ['salut']);
  assert.deepStrictEqual(Object.keys(chat.rooms()), Rules.CHAT_ROOM_IDS);
  // Chaque salon garde ses 120 derniers messages
  for (let i = 0; i < Rules.CHAT.history + 5; i++) chat.system('annonce ' + i, 'info', 'commerce');
  assert.strictEqual(chat.history('commerce').length, Rules.CHAT.history);
  assert.strictEqual(chat.history('peche').length, 2, 'les autres salons ne bougent pas');
  // Suppression (cherchée dans tous les salons) et salon vidé seul
  assert.deepStrictEqual(chat.remove(m.id), { deleted: m.id, room: 'peche' });
  assert.deepStrictEqual(chat.clear('commerce'), { cleared: true, room: 'commerce' });
  assert.deepStrictEqual(chat.history('commerce'), []);
  assert.strictEqual(chat.history().length, 1);
  // Ancienne sauvegarde (un seul salon) : ses messages deviennent le salon Général
  db.state.chat = { messages: [{ id: 1, at: 1, uid: 'x', name: 'Ancien', text: 'vieux message' }], nextId: 2 };
  assert.deepStrictEqual(chat.history().map((x) => [x.text, x.room]), [['vieux message', 'general']]);
  assert.strictEqual(db.state.chat.messages, undefined);
  assert.deepStrictEqual(chat.history('peche'), []);
  assert.strictEqual(chat.system('suite').id, 2, 'la numérotation continue');
});

test('[TCH-8] actions des pêcheurs dans le salon Pêche : pseudo de l\'auteur, gardées seulement si remarquables', () => {
  chat.clear();
  const u = player({ twitchDisplayName: 'Popeye' });
  const eph = chat.activity(u, 'a raté une touche… 💨', 'fishmiss', 'peche');
  assert.deepStrictEqual([eph.sys, eph.act, eph.who, eph.uid, eph.room, eph.eph, eph.kind], [true, true, 'Popeye', u.id, 'peche', true, 'fishmiss']);
  assert.deepStrictEqual(chat.history('peche'), [], 'une action banale est seulement diffusée');
  const keep = chat.activity(u, 'a pêché Kraken (8 m)', 'fishcatch', 'peche', true, { fish: { id: 'kraken', size: 800, rarity: 'legendaire' } });
  assert.strictEqual(keep.eph, undefined);
  assert.deepStrictEqual(chat.history('peche').map((x) => [x.text, x.fish.rarity]), [['a pêché Kraken (8 m)', 'legendaire']]);
  assert.ok(eph.id < keep.id, 'numérotation commune');
});
