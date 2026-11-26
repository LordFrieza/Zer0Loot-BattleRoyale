/*
 * Tchat du site, en plusieurs salons (Rules.CHAT_ROOMS : Général, Pêche, Strat & builds, Commerce), affichés dans le lieu
 * « Taverne » de la carte (onglets), la bulle flottante de la page joueur, sous l'étang de pêche (salon Pêche par défaut)
 * et dans l'incrustation transparente de l'arène en direct (Général seulement).
 *  - Un message porte le pseudo, la classe, la couleur du personnage (choisie dans l'apparence, sinon calculée depuis le
 *    pseudo par le navigateur) et le titre du joueur ; le texte peut contenir des émotes « :pyrax: » (Rules.CHAT_EMOTES).
 *  - Commandes : /me (action), /roll [max] (dé, crypto), /pile (pile ou face), /aide.
 *  - Anti-spam (Rules.CHAT) et modération par l'admin : suppression d'un message, sourdine d'un joueur, salon vidé.
 *  - Annonces du jeu (file ouverte, vainqueurs, boss vaincus, gros gains du casino, poisson légendaire…) : `system()`.
 *  - Actions des pêcheurs dans le salon Pêche : `activity()` (les plus banales ne sont pas gardées : `eph`).
 * Les derniers messages de chaque salon sont gardés dans db.state.chat.rooms ; index.js diffuse l'événement socket `chat`
 * à chaque changement (chaque message porte son salon, `room`).
 */
const crypto = require('crypto');
const Rules = require('../shared/rules');
const db = require('./db');
const game = require('./game');

const C = Rules.CHAT;
const recent = new Map(); // userId → instants (ms) de ses derniers messages, pour l'anti-spam

// État : un tableau de messages par salon. Une ancienne sauvegarde (un seul salon, `messages`) devient le salon Général.
function state() {
  if (!db.state.chat) db.state.chat = { rooms: {}, nextId: 1 };
  const s = db.state.chat;
  if (!s.rooms) s.rooms = {};
  if (Array.isArray(s.messages)) {
    s.rooms.general = [...(s.rooms.general || []), ...s.messages.map((m) => ({ ...m, room: 'general' }))];
    delete s.messages;
  }
  for (const r of Rules.CHAT_ROOM_IDS) if (!s.rooms[r]) s.rooms[r] = [];
  return s;
}

function roomOf(room) {
  if (room == null || room === '') return 'general';
  if (!Rules.CHAT_ROOMS[room]) throw new Error('Salon inconnu');
  return room;
}

// Ajoute un message à son salon (`eph` : diffusé mais pas gardé, pour les actions banales des pêcheurs).
function push(msg, room = 'general', eph = false) {
  const s = state();
  const m = { id: s.nextId++, at: Date.now(), room, ...msg };
  if (eph) { m.eph = true; return m; }
  const list = s.rooms[room];
  list.push(m);
  if (list.length > C.history) list.splice(0, list.length - C.history);
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

// Un message d'un joueur dans un salon (Général par défaut). Renvoie { message } (à diffuser) ou { private } (réponse
// pour lui seul, ex. /aide).
function send(user, raw, now = Date.now(), roomId = 'general') {
  if (!user || user.role !== 'player' || !user.character) throw new Error('Réservé aux joueurs');
  const room = roomOf(roomId);
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
        return { message: push({ ...base, text: arg, me: true }, room) };
      }
      case 'roll': case 'de': case 'dé': {
        const max = arg ? Math.floor(Number(arg)) : 100;
        if (!Number.isFinite(max) || max < 2 || max > C.rollMax) throw new Error(`/roll : un nombre de 2 à ${C.rollMax}`);
        checkRate(user, now);
        const n = crypto.randomInt(1, max + 1);
        return { message: push({ ...base, text: '', roll: { n, max } }, room) };
      }
      case 'pile': case 'flip': {
        checkRate(user, now);
        return { message: push({ ...base, text: '', flip: crypto.randomInt(0, 2) ? 'pile' : 'face' }, room) };
      }
      default: throw new Error(`Commande inconnue : /${cmd} (tape /aide)`);
    }
  }
  if (Rules.chatTokens(text).filter((t) => t.t === 'emote').length > C.maxEmotes) throw new Error(`${C.maxEmotes} émotes au plus par message`);
  checkRate(user, now);
  return { message: push({ ...base, text }, room) };
}

// Annonce du jeu (sans auteur), dans le salon Général sauf indication contraire.
function system(text, kind = 'info', room = 'general') {
  return push({ sys: true, kind, text: String(text).slice(0, 300) }, roomOf(room));
}

// Action d'un joueur annoncée dans un salon (pêche : prise, trésor, poisson raté…) : sans auteur mais avec son pseudo
// (`who`) et son identifiant. `keep` : gardée dans l'historique (prises remarquables), sinon seulement diffusée.
function activity(user, text, kind, room, keep = false, extra = {}) {
  const name = user.twitchDisplayName || user.username;
  return push({ sys: true, act: true, kind, who: name, uid: user.id, text: String(text).slice(0, 300), ...extra }, roomOf(room), !keep);
}

function history(room = 'general') {
  return state().rooms[roomOf(room)];
}
// Tous les salons (chargement de la page)
function rooms() {
  const s = state();
  return Object.fromEntries(Rules.CHAT_ROOM_IDS.map((r) => [r, s.rooms[r]]));
}

// Modération (admin)
function remove(id) {
  const s = state();
  for (const r of Rules.CHAT_ROOM_IDS) {
    const i = s.rooms[r].findIndex((m) => m.id === Number(id));
    if (i < 0) continue;
    s.rooms[r].splice(i, 1);
    db.save();
    return { deleted: Number(id), room: r };
  }
  throw new Error('Message introuvable');
}
// Vide un salon (ou tous, sans salon)
function clear(room) {
  const s = state();
  const list = room ? [roomOf(room)] : Rules.CHAT_ROOM_IDS;
  for (const r of list) s.rooms[r] = [];
  db.save();
  return { cleared: true, room: room || null };
}
function mute(user, minutes, now = Date.now()) {
  if (!user || user.role !== 'player') throw new Error('Joueur introuvable');
  const m = Math.max(0, Math.min(7 * 24 * 60, Math.floor(Number(minutes) || 0)));
  user.chatMuteUntil = m ? now + m * 60000 : 0;
  db.save();
  return { muted: m, name: user.twitchDisplayName || user.username };
}

module.exports = { send, system, activity, history, rooms, remove, clear, mute, recent, HELP };
