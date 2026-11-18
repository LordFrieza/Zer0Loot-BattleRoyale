/*
 * Planification des parties : créneaux hebdomadaires choisis par l'admin (heure de Paris).
 * À l'heure dite, la file du mode s'ouvre pour SCHEDULE.queueSeconds (5 min), puis la partie se lance toute seule.
 * L'état est dans db.state.schedule = { items: [...], fired: { "id@instant": quand } }.
 * check() est appelé régulièrement par index.js (start()) ; ctl fait le lien avec la bataille (ouvrir, lancer, annuler).
 */
const crypto = require('crypto');
const Rules = require('../shared/rules');
const db = require('./db');

const S = Rules.SCHEDULE;
let current = null; // partie planifiée en cours : { key, id, mode, boss, startAt }

function state() {
  if (!db.state.schedule) db.state.schedule = { items: [], fired: {} };
  const st = db.state.schedule;
  if (!Array.isArray(st.items)) st.items = [];
  if (!st.fired) st.fired = {};
  return st;
}

function clean(body) {
  const days = [...new Set((Array.isArray(body.days) ? body.days : []).map(Number))].filter((d) => d >= 1 && d <= 7).sort();
  if (!days.length) throw new Error('Choisis au moins un jour');
  const time = String(body.time || '');
  if (!Rules.scheduleTimeValid(time)) throw new Error('Heure invalide (format HH:MM)');
  const mode = String(body.mode || '');
  if (!Rules.GAME_MODES[mode]) throw new Error('Mode de jeu inconnu');
  const boss = mode === 'boss' ? String(body.boss || 'troll') : null;
  if (boss && !Rules.BOSSES[boss]) throw new Error('Boss inconnu');
  return { days, time, mode, boss };
}

function add(body) {
  const st = state();
  if (st.items.length >= S.maxItems) throw new Error(`${S.maxItems} créneaux au plus`);
  const item = { id: crypto.randomBytes(5).toString('hex'), ...clean(body), enabled: true };
  st.items.push(item);
  db.save();
  return item;
}

function update(id, body) {
  const st = state();
  const item = st.items.find((x) => x.id === id);
  if (!item) throw new Error('Créneau introuvable');
  if (body.enabled !== undefined && Object.keys(body).length === 1) item.enabled = !!body.enabled;
  else Object.assign(item, clean(body), body.enabled !== undefined ? { enabled: !!body.enabled } : {});
  db.save();
  return item;
}

function remove(id) {
  const st = state();
  const n = st.items.length;
  st.items = st.items.filter((x) => x.id !== id);
  if (st.items.length === n) throw new Error('Créneau introuvable');
  db.save();
  return { removed: id };
}

// Ce que voient les joueurs : le planning, les prochaines parties et celle dont la file est ouverte.
function publicView(now = Date.now()) {
  const st = state();
  return {
    items: st.items.slice().sort((a, b) => a.time.localeCompare(b.time)),
    next: Rules.scheduleUpcoming(st.items, now).filter((o) => o.at >= now).slice(0, 20),
    live: current ? { mode: current.mode, boss: current.boss, startAt: current.startAt } : null,
    queueSeconds: S.queueSeconds,
  };
}

/*
 * Vérification périodique. ctl = {
 *   phase() : phase de la bataille, open(mode, boss, seconds), start() (lance la partie, lève une erreur s'il manque
 *   des joueurs), cancel(reason) (file annulée), changed() (planning à rediffuser)
 * }. Retourne ce qui s'est passé ('opened', 'started', 'cancelled' ou null).
 */
function check(ctl, now = Date.now()) {
  const st = state();
  // Partie planifiée en cours : lancement automatique à la fin de la file
  if (current) {
    const phase = ctl.phase();
    if (phase === 'ready' || (phase === 'queue' && now >= current.startAt)) {
      const c = current;
      current = null;
      try {
        ctl.start();
        ctl.changed();
        return 'started';
      } catch (e) {
        ctl.cancel(e.message, c);
        ctl.changed();
        return 'cancelled';
      }
    }
    if (phase !== 'queue') { current = null; ctl.changed(); } // l'admin a repris la main (réinitialisation…)
    return null;
  }
  // Créneau atteint (jusqu'à lateMinutes de retard si une partie était déjà en cours) : on ouvre la file
  for (const o of Rules.scheduleUpcoming(st.items, now)) {
    if (o.at > now) break;
    const key = `${o.id}@${o.at}`;
    if (st.fired[key]) continue;
    const phase = ctl.phase();
    if (phase !== 'idle' && phase !== 'ended') continue; // une partie est en cours : on réessaie au prochain passage
    st.fired[key] = now;
    for (const [k, t] of Object.entries(st.fired)) if (now - t > 3 * 86400000) delete st.fired[k];
    db.save();
    ctl.open(o.mode, o.boss, S.queueSeconds);
    current = { key, id: o.id, mode: o.mode, boss: o.boss, startAt: now + S.queueSeconds * 1000 };
    ctl.changed();
    return 'opened';
  }
  return null;
}

function reset() {
  current = null;
}

module.exports = { state, add, update, remove, publicView, check, reset, get current() { return current; } };
