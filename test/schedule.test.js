/*
 * Planification des parties : créneaux hebdomadaires (heure de Paris), file ouverte automatiquement 5 min,
 * lancement automatique, annulation faute de joueurs, planning public.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, db } = require('./helpers');
const schedule = require('../server/schedule');

const S = Rules.SCHEDULE;
// Mercredi 18 novembre 2026, 20:58 à Paris (hiver : UTC+1)
const NOW = Date.UTC(2026, 10, 18, 19, 58);

function fakeCtl() {
  const log = [];
  const ctl = {
    phaseValue: 'idle',
    players: 0,
    phase: () => ctl.phaseValue,
    open: (mode, boss, seconds) => { log.push(['open', mode, boss, seconds]); ctl.phaseValue = 'queue'; },
    start: () => { if (ctl.players < 1) throw new Error('Il faut au moins 1 combattant'); log.push(['start']); ctl.phaseValue = 'battle'; },
    cancel: (reason) => { log.push(['cancel', reason]); ctl.phaseValue = 'idle'; },
    changed: () => log.push(['changed']),
  };
  return { ctl, log };
}

test('[SCH-1] planification : heure de Paris (été et hiver), jours de la semaine, prochaines parties', () => {
  assert.deepStrictEqual(Rules.parisParts(NOW), { y: 2026, m: 11, d: 18, h: 20, min: 58, dow: 3 });
  assert.strictEqual(new Date(Rules.parisToTs(2026, 11, 18, 21, 0)).toISOString(), '2026-11-18T20:00:00.000Z', 'hiver : UTC+1');
  assert.strictEqual(new Date(Rules.parisToTs(2026, 7, 1, 21, 0)).toISOString(), '2026-07-01T19:00:00.000Z', 'été : UTC+2');
  assert.ok(Rules.scheduleTimeValid('21:00') && !Rules.scheduleTimeValid('24:00') && !Rules.scheduleTimeValid('9h'));
  const items = [{ id: 'a', days: [3, 5], time: '21:00', mode: 'boss', boss: 'troll' }, { id: 'b', days: [1], time: '12:30', mode: 'br', enabled: false }];
  const up = Rules.scheduleUpcoming(items, NOW);
  assert.deepStrictEqual(up.map((o) => [o.id, o.dow, new Date(o.at).toISOString()]),
    [['a', 3, '2026-11-18T20:00:00.000Z'], ['a', 5, '2026-11-20T20:00:00.000Z']], 'créneau désactivé ignoré, 7 jours au plus');
});

test('[SCH-2] planification : créneaux ajoutés, modifiés, supprimés par l\'admin (vérifiés)', () => {
  db.state.schedule = { items: [], fired: {} };
  assert.throws(() => schedule.add({ days: [], time: '21:00', mode: 'br' }), /au moins un jour/);
  assert.throws(() => schedule.add({ days: [1], time: '25:00', mode: 'br' }), /Heure invalide/);
  assert.throws(() => schedule.add({ days: [1], time: '21:00', mode: 'pique-nique' }), /Mode de jeu inconnu/);
  assert.throws(() => schedule.add({ days: [1], time: '21:00', mode: 'boss', boss: 'licorne' }), /Boss inconnu/);
  const it = schedule.add({ days: [5, 3, 3, 9], time: '21:00', mode: 'boss', boss: 'dragon' });
  assert.deepStrictEqual([it.days, it.time, it.mode, it.boss, it.enabled], [[3, 5], '21:00', 'boss', 'dragon', true]);
  const br = schedule.add({ days: [6], time: '18:30', mode: 'br', boss: 'dragon' });
  assert.strictEqual(br.boss, null, 'boss seulement en Combat de Boss');
  schedule.update(br.id, { enabled: false });
  assert.strictEqual(db.state.schedule.items.find((x) => x.id === br.id).enabled, false);
  schedule.update(br.id, { days: [7], time: '17:00', mode: 'rush', enabled: true });
  assert.deepStrictEqual(db.state.schedule.items.find((x) => x.id === br.id).days, [7]);
  schedule.remove(br.id);
  assert.throws(() => schedule.remove(br.id), /introuvable/);
  const view = schedule.publicView(NOW);
  assert.deepStrictEqual([view.items.length, view.queueSeconds, view.live], [1, 300, null]);
  assert.strictEqual(view.next[0].at, Date.UTC(2026, 10, 18, 20, 0));
});

test('[SCH-3] planification : file ouverte à l\'heure dite pour 5 min, puis lancement automatique', () => {
  db.state.schedule = { items: [], fired: {} };
  schedule.reset();
  schedule.add({ days: [3], time: '21:00', mode: 'dungeon' });
  const { ctl, log } = fakeCtl();
  assert.strictEqual(schedule.check(ctl, NOW), null, 'pas encore l\'heure');
  const at = Date.UTC(2026, 10, 18, 20, 0);
  assert.strictEqual(schedule.check(ctl, at + 2000), 'opened');
  assert.deepStrictEqual(log[0], ['open', 'dungeon', null, S.queueSeconds]);
  assert.deepStrictEqual(schedule.publicView(at + 3000).live, { mode: 'dungeon', boss: null, startAt: at + 2000 + 300000 });
  assert.strictEqual(schedule.check(ctl, at + 60000), null, 'la file reste ouverte 5 min');
  ctl.players = 3;
  ctl.phaseValue = 'ready'; // la file s'est fermée toute seule
  assert.strictEqual(schedule.check(ctl, at + 302000), 'started');
  assert.ok(log.some((l) => l[0] === 'start'));
  ctl.phaseValue = 'ended';
  assert.strictEqual(schedule.check(ctl, at + 400000), null, 'un créneau ne s\'ouvre qu\'une fois');
});

test('[SCH-4] planification : annulée sans joueurs, reportée si une partie est en cours, abandonnée si l\'admin reprend la main', () => {
  db.state.schedule = { items: [], fired: {} };
  schedule.reset();
  schedule.add({ days: [3], time: '21:00', mode: 'boss', boss: 'liche' });
  const at = Date.UTC(2026, 10, 18, 20, 0);
  // Une bataille est en cours à l'heure dite : on attend (jusqu'à 15 min de retard)
  let { ctl, log } = fakeCtl();
  ctl.phaseValue = 'battle';
  assert.strictEqual(schedule.check(ctl, at + 1000), null);
  ctl.phaseValue = 'ended';
  assert.strictEqual(schedule.check(ctl, at + 5 * 60000), 'opened', 'ouverte dès la fin de la bataille');
  // Personne dans la file : annulée
  ctl.phaseValue = 'ready';
  assert.strictEqual(schedule.check(ctl, at + 11 * 60000), 'cancelled');
  assert.match(log.find((l) => l[0] === 'cancel')[1], /au moins 1 combattant/);
  // Trop tard (plus de 15 min) : le créneau est sauté
  db.state.schedule.fired = {};
  ({ ctl, log } = fakeCtl());
  assert.strictEqual(schedule.check(ctl, at + (S.lateMinutes + 1) * 60000), null);
  // L'admin réinitialise pendant la file : plus de lancement automatique
  db.state.schedule.fired = {};
  ({ ctl, log } = fakeCtl());
  schedule.check(ctl, at + 1000);
  ctl.phaseValue = 'idle';
  assert.strictEqual(schedule.check(ctl, at + 2000), null);
  assert.strictEqual(schedule.current, null);
  assert.ok(!log.some((l) => l[0] === 'start'));
});
