/*
 * Tchat du site : tous les joueurs discutent dans un seul salon (lieu « Taverne » de la carte, bulle flottante de la page
 * joueur, incrustation transparente dans l'arène en direct).
 *  - Un message porte le pseudo, la classe, la couleur du personnage (choisie dans l'apparence, sinon calculée depuis le
 *    pseudo par le navigateur) et le titre du joueur ; le texte peut contenir des émotes « :pyrax: » (Rules.CHAT_EMOTES).
 *  - Commandes : /me (action), /roll [max] (dé, crypto), /pile (pile ou face), /aide.
 *  - Anti-spam (Rules.CHAT) et modération par l'admin : suppression d'un message, sourdine d'un joueur, salon vidé.
 *  - Annonces du jeu (file ouverte, vainqueurs, boss vaincus, gros gains du casino, poisson légendaire…) : `system()`.
 * Les derniers messages sont gardés dans db.state.chat ; index.js diffuse l'événement socket `chat` à chaque changement.
 */
const crypto = require('crypto');
const Rules = require('../shared/rules');
const db = require('./db');
const game = require('./game');

const C = Rules.CHAT;
const recent = new Map(); // userId → instants (ms) de ses derniers messages, pour l'anti-spam

function state() {
  if (!db.state.chat) db.state.chat = { messages: [], nextId: 1 };
  return db.state.chat;
}

function push(msg) {
  const s = state();
  const m = { id: s.nextId++, at: Date.now(), ...msg };
  s.messages.push(m);
  if (s.messages.length > C.history) s.messages.splice(0, s.messages.length - C.history);
  db.save();
  return m;
}

// Qui parle : pseudo affiché, classe, couleur choisie dans l'apparence (null : couleur selon le pseudo), titre.
function author(user) {
  const c = user.character;
  const color = c && c.look && c.look.color && Rules.APPEARANCE.color.options[c.look.color];
  return {
    uid: user.id,
    name: user.twitchDisplayName || user.username,
    cls: (c && c.cls) || null,
    color: color ? color.hex : null,
    title: (c && game.titleOf(c)) || null,
  };
}

function checkRate(user, now) {
  const list = (recent.get(user.id) || []).filter((t) => now - t < C.burstWindow * 1000);
  if (list.length && now - list[list.length - 1] < C.cooldown * 1000) throw new Error('Doucement… un message par seconde');
  if (list.length >= C.burst) throw new Error(`Doucement… ${C.burst} messages par tranche de ${C.burstWindow} s au plus`);
  list.push(now);
  recent.set(user.id, list);
}

const HELP = '/me <action> · /roll [max] : lance un dé · /pile : pile ou face · :pyrax: et les autres émotes avec le bouton 😀';

// Un message d'un joueur. Renvoie { message } (à diffuser) ou { private } (réponse pour lui seul, ex. /aide).
function send(user, raw, now = Date.now()) {
  if (!user || user.role !== 'player' || !user.character) throw new Error('Réservé aux joueurs');
  if (user.chatMuteUntil && user.chatMuteUntil > now) {
    throw new Error(`Tu es en sourdine encore ${Math.ceil((user.chatMuteUntil - now) / 60000)} min`);
  }
  const text = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Message vide');
  if (text.length > C.maxLen) throw new Error(`${C.maxLen} caractères au plus`);
  const base = author(user);
  if (text.startsWith('/')) {
    const [cmd, ...rest] = text.slice(1).split(' ');
    const arg = rest.join(' ').trim();
    switch (cmd.toLowerCase()) {
      case 'aide': case 'help': return { private: HELP };
      case 'me': {
        if (!arg) throw new Error('/me <ce que tu fais>');
        checkRate(user, now);
        return { message: push({ ...base, text: arg, me: true }) };
      }
      case 'roll': case 'de': case 'dé': {
        const max = arg ? Math.floor(Number(arg)) : 100;
        if (!Number.isFinite(max) || max < 2 || max > C.rollMax) throw new Error(`/roll : un nombre de 2 à ${C.rollMax}`);
        checkRate(user, now);
        const n = crypto.randomInt(1, max + 1);
        return { message: push({ ...base, text: '', roll: { n, max } }) };
      }
      case 'pile': case 'flip': {
        checkRate(user, now);
        return { message: push({ ...base, text: '', flip: crypto.randomInt(0, 2) ? 'pile' : 'face' }) };
      }
      default: throw new Error(`Commande inconnue : /${cmd} (tape /aide)`);
    }
  }
  if (Rules.chatTokens(text).filter((t) => t.t === 'emote').length > C.maxEmotes) throw new Error(`${C.maxEmotes} émotes au plus par message`);
  checkRate(user, now);
  return { message: push({ ...base, text }) };
}

// Annonce du jeu (sans auteur).
function system(text, kind = 'info') {
  return push({ sys: true, kind, text: String(text).slice(0, 300) });
}

function history() {
  return state().messages;
}

// Modération (admin)
function remove(id) {
  const s = state();
  const before = s.messages.length;
  s.messages = s.messages.filter((m) => m.id !== Number(id));
  if (s.messages.length === before) throw new Error('Message introuvable');
  db.save();
  return { deleted: Number(id) };
}
function clear() {
  state().messages = [];
  db.save();
  return { cleared: true };
}
function mute(user, minutes, now = Date.now()) {
  if (!user || user.role !== 'player') throw new Error('Joueur introuvable');
  const m = Math.max(0, Math.min(7 * 24 * 60, Math.floor(Number(minutes) || 0)));
  user.chatMuteUntil = m ? now + m * 60000 : 0;
  db.save();
  return { muted: m, name: user.twitchDisplayName || user.username };
}

module.exports = { send, system, history, remove, clear, mute, recent, HELP };
