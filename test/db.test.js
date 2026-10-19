/*
 * Persistance (server/db.js) : chargement, écriture différée et atomique, identifiants.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('./helpers');

// Charge une copie neuve de server/db.js pointant sur `dir` (le module lit DATA_DIR à l'import).
function freshDb(dir) {
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  const file = require.resolve('../server/db');
  delete require.cache[file];
  const db = require('../server/db');
  delete require.cache[file];
  process.env.DATA_DIR = previous;
  return db;
}

const tmpDir = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zl-db-')), 'sous', 'dossier');

test('[DB-2, DB-1] chargement : DATA_DIR créé s\'il manque, db.json relu s\'il existe', () => {
  const dir = tmpDir();
  assert.ok(!fs.existsSync(dir));
  const first = freshDb(dir);
  first.load();
  assert.ok(fs.existsSync(dir), 'dossier créé (récursivement)');
  assert.deepStrictEqual(Object.keys(first.state).sort(), ['nextId', 'sessions', 'users']);

  first.state.users['7'] = { id: '7', username: 'zed' };
  first.state.sessions.tok = { userId: '7', expires: 1 };
  first.state.nextId = 8;
  first.state.bets = { list: { 7: { amount: 5 } }, lastResult: null };
  first.flush();

  const second = freshDb(dir);
  second.load();
  assert.strictEqual(second.state.users['7'].username, 'zed');
  assert.strictEqual(second.state.sessions.tok.userId, '7');
  assert.strictEqual(second.state.nextId, 8);
  assert.strictEqual(second.state.bets.list['7'].amount, 5);
});

test('[DB-3, DB-5] save() : écriture différée de 200 ms et regroupée ; flush() écrit tout de suite', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dir = tmpDir();
  const db = freshDb(dir);
  db.load();
  const file = path.join(dir, 'db.json');
  const writes = t.mock.method(fs, 'writeFileSync');

  db.state.nextId = 11;
  db.save();
  db.save();
  db.save();
  t.mock.timers.tick(199);
  assert.strictEqual(writes.mock.callCount(), 0, 'rien avant 200 ms');
  assert.ok(!fs.existsSync(file));
  t.mock.timers.tick(1);
  assert.strictEqual(writes.mock.callCount(), 1, 'un seul écrit pour trois save()');
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).nextId, 11);

  // flush() : immédiat, et annule l'écriture différée en attente
  db.state.nextId = 12;
  db.save();
  db.flush();
  assert.strictEqual(writes.mock.callCount(), 2);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).nextId, 12);
  t.mock.timers.tick(1000);
  assert.strictEqual(writes.mock.callCount(), 2, 'l\'écriture différée a été annulée');
});

test('[DB-4, NFR-2] écriture atomique : fichier temporaire puis renommage', (t) => {
  const dir = tmpDir();
  const db = freshDb(dir);
  db.load();
  const calls = [];
  const realWrite = fs.writeFileSync;
  const realRename = fs.renameSync;
  t.mock.method(fs, 'writeFileSync', (...args) => { calls.push(['write', path.basename(args[0])]); return realWrite(...args); });
  t.mock.method(fs, 'renameSync', (...args) => { calls.push(['rename', path.basename(args[0]), path.basename(args[1])]); return realRename(...args); });
  db.flush();
  assert.deepStrictEqual(calls, [['write', 'db.json.tmp'], ['rename', 'db.json.tmp', 'db.json']]);
  assert.deepStrictEqual(fs.readdirSync(dir), ['db.json'], 'pas de fichier temporaire restant');

  // Si l'écriture du temporaire échoue, db.json existant reste intact
  db.state.nextId = 5;
  db.flush();
  const good = fs.readFileSync(path.join(dir, 'db.json'), 'utf8');
  t.mock.method(fs, 'writeFileSync', () => { throw new Error('disque plein'); });
  db.state.nextId = 99;
  assert.throws(() => db.flush(), /disque plein/);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'), good);
});

test('[DB-6] identifiants : chaînes issues du compteur nextId', () => {
  const db = freshDb(tmpDir());
  db.load();
  db.state.nextId = 41;
  const a = db.newId();
  const b = db.newId();
  assert.deepStrictEqual([a, b], ['41', '42']);
  assert.strictEqual(typeof a, 'string');
  assert.strictEqual(db.state.nextId, 43);
});
