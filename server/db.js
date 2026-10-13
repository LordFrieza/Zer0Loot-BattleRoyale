/*
 * Stockage JSON minimaliste (prototype) : tout est en mémoire et sauvegardé
 * dans data/db.json avec une écriture atomique différée.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const state = { users: {}, sessions: {}, nextId: 1 };

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    Object.assign(state, JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  }
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(flush, 200);
}

function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, DB_FILE);
}

function newId() {
  return String(state.nextId++);
}

function findUserByName(username) {
  const u = username.toLowerCase();
  return Object.values(state.users).find((x) => x.username.toLowerCase() === u) || null;
}

function findUserByTwitch(login) {
  const l = login.toLowerCase();
  return Object.values(state.users).find((x) => x.twitchLogin === l) || null;
}

module.exports = { state, load, save, flush, newId, findUserByName, findUserByTwitch };
