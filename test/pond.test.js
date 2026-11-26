/*
 * Pêche sociale : étang partagé (places, étangs, présence, actions, réactions), banc de poissons, concours du jour.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, game, db } = require('./helpers');
const pond = require('../server/pond');
const fishing = require('../server/fishing');

let n = 0;
function angler(name) {
  const c = game.newCharacter();
  game.chooseClass(c, 'mage');
  const u = { id: 'pd' + (++n), username: name || 'Barque' + n, role: 'player', character: c };
  db.state.users[u.id] = u;
  return u;
}
const events = [];
pond.init({ emit: (id, event, data) => events.push({ id, event, data }), describe: (u) => ({ name: u.username, cls: u.character.cls }) });
const T0 = 1e12;

test('[FISH-10] étang partagé : 8 places, la première libre ; étang plein → un nouvel étang ; départ et onglets multiples', () => {
  pond.reset();
  events.length = 0;
  assert.strictEqual(Rules.FISHING.pond.spots, 8);
  const users = Array.from({ length: 9 }, () => angler());
  const joined = users.map((u, i) => pond.join(u, 'sock' + i, T0));
  assert.deepStrictEqual(joined.slice(0, 8).map((r) => r.pond), Array(8).fill(1));
  assert.ok(joined.every((r) => r.arrived));
  assert.strictEqual(joined[8].pond, 2, 'le 9ᵉ ouvre un nouvel étang');
  const v = pond.view(1, T0);
  assert.deepStrictEqual(v.members.map((m) => m.spot), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepStrictEqual([v.spots, v.ponds, v.total], [8, 2, 9]);
  const m = v.members[0];
  assert.deepStrictEqual([m.uid, m.name, m.cls, m.state], [users[0].id, users[0].username, 'mage', 'idle'], 'apparence publique et état');
  assert.ok(events.some((e) => e.event === 'pond' && e.id === 1), 'la liste part à la room de l\'étang');
  // Un 2ᵉ onglet : rien ne change ; il faut fermer les deux pour quitter l'étang
  assert.deepStrictEqual(pond.join(users[2], 'sock2b', T0), { pond: 1, arrived: false });
  assert.deepStrictEqual(pond.leave(users[2].id, 'sock2', T0), { left: false, pond: 1 });
  assert.deepStrictEqual(pond.leave(users[2].id, 'sock2b', T0), { left: true, pond: 1 });
  assert.strictEqual(pond.view(1, T0).members.length, 7);
  // La place libérée (2) est reprise par le suivant
  const late = angler();
  assert.strictEqual(pond.join(late, 'late', T0).pond, 1);
  assert.strictEqual(pond.memberOf(late.id).spot, 2);
  // Un étang vide disparaît
  pond.leave(users[8].id, 'sock8', T0);
  assert.strictEqual(pond.view(2), null);
  assert.deepStrictEqual(pond.leave('inconnu', 'x'), { left: false });
  assert.throws(() => pond.join({ id: 'adm', role: 'admin' }, 's'), /joueurs/);
});

test('[FISH-11] actions des pêcheurs en direct (état de la barque) et réactions rapides', () => {
  pond.reset();
  const a = angler();
  const b = angler();
  pond.join(a, 'a', T0);
  pond.join(b, 'b', T0);
  events.length = 0;
  const states = [];
  for (const k of ['cast', 'reel', 'catch', 'cast', 'escape', 'cast', 'miss', 'cast', 'stop']) {
    pond.act(a.id, k, k === 'catch' ? { fish: { id: 'perche', size: 30 } } : {}, T0);
    states.push(pond.memberOf(a.id).state);
  }
  assert.deepStrictEqual(states, ['wait', 'reel', 'idle', 'wait', 'idle', 'wait', 'idle', 'wait', 'idle']);
  const acts = events.filter((e) => e.event === 'pondAct');
  assert.strictEqual(acts.length, 9);
  assert.deepStrictEqual([acts[2].id, acts[2].data.uid, acts[2].data.k, acts[2].data.fish], [1, a.id, 'catch', { id: 'perche', size: 30 }]);
  assert.strictEqual(pond.act('absent', 'cast'), null, 'rien pour qui ne pêche pas');
  // Réactions : la liste de FISHING.pond.reactions, une toutes les 1,5 s
  assert.deepStrictEqual(Rules.FISHING.pond.reactions.slice(0, 2), ['👋', '🎉']);
  assert.strictEqual(pond.react(b.id, '👋', T0).e, '👋');
  assert.throws(() => pond.react(b.id, '🎉', T0 + 1000), /Doucement/);
  assert.strictEqual(pond.react(b.id, '🎉', T0 + 1600).k, 'react');
  assert.throws(() => pond.react(b.id, '💩', T0 + 5000), /inconnue/);
  assert.throws(() => pond.react('absent', '👋', T0), /ne pêches pas/);
});

test('[FISH-12] banc de poissons : à partir de 2 pêcheurs, toutes les 6 à 14 min, 60 s de raretés hautes ×2', () => {
  pond.reset();
  const S = Rules.FISHING.school;
  assert.deepStrictEqual([S.minFishers, S.every, S.duration, S.mult, S.treasureMult], [2, [360, 840], 60, { rare: 2, epique: 2, legendaire: 2 }, 2]);
  const a = angler();
  const b = angler();
  pond.join(a, 'a', T0);
  assert.deepStrictEqual(pond.tick(T0 + 3600e3), [], 'seul sur l\'étang : jamais de banc');
  pond.join(b, 'b', T0 + 3600e3);
  const at = T0 + 3600e3;
  assert.deepStrictEqual(pond.tick(at + 359e3), [], 'pas avant 6 min');
  const started = pond.tick(at + 841e3);
  assert.strictEqual(started.length, 1);
  assert.deepStrictEqual([started[0].pond, started[0].fishers, started[0].school.until - started[0].school.at], [1, 2, 60e3]);
  const t = started[0].school.at;
  assert.ok(pond.schoolOf(a.id, t + 1000) && pond.schoolOf(b.id, t + 59e3));
  assert.ok(pond.view(1, t + 1000).school);
  assert.ok(!pond.schoolOf(a.id, t + 61e3));
  pond.tick(t + 61e3);
  assert.strictEqual(pond.view(1, t + 61e3).school, null, 'fini au bout de 60 s');
  // Le lancer pendant le banc tire avec les multiplicateurs (raretés hautes et trésors plus fréquents)
  const night = Date.parse('2026-06-15T23:00:00+02:00');
  const share = (school) => {
    let high = 0;
    let treasure = 0;
    for (let i = 0; i < 6000; i++) {
      const r = fishing.rollTarget(night, school);
      if (r.kind === 'treasure') treasure += 1;
      else if (['rare', 'epique', 'legendaire'].includes(Rules.FISH[r.id].rarity)) high += 1;
    }
    return { high: high / 6000, treasure: treasure / 6000 };
  };
  const normal = share(false);
  const boosted = share(true);
  assert.ok(boosted.high > normal.high * 1.3, `raretés hautes : ${normal.high} → ${boosted.high}`);
  assert.ok(boosted.treasure > normal.treasure * 1.3, `trésors : ${normal.treasure} → ${boosted.treasure}`);
  // fishing.cast lit le banc de l'étang du joueur
  const s2 = pond.startSchool(1, T0 + 9e9);
  fishing.calm.delete(a.id);
  let seen = null;
  const real = fishing.rollTarget;
  fishing.rollTarget = (now, school) => { seen = school; return { kind: 'fish', id: 'perche', size: 20 }; };
  try { assert.strictEqual(fishing.cast(a, s2.at + 1000).school, true); } finally { fishing.rollTarget = real; fishing.stop(a, s2.at + 1000); }
  assert.strictEqual(seen, true);
});

test('[FISH-13] concours du jour : espèce tirée d\'après la date, plus grande prise, lots des 3 premiers au changement de jour', () => {
  delete db.state.fishContest;
  const C = Rules.FISHING.contest;
  const day1 = Date.parse('2026-11-26T12:00:00+01:00');
  const sp = Rules.fishContestSpecies('2026-11-26');
  assert.strictEqual(sp, Rules.fishContestSpecies('2026-11-26'), 'la même pour tous');
  const days = Array.from({ length: 40 }, (_, i) => Rules.fishContestSpecies(`2026-12-${String(i % 28 + 1).padStart(2, '0')}`));
  assert.ok(new Set(days).size > 5, 'elle change d\'un jour à l\'autre');
  for (const id of days) assert.ok(!Rules.FISH[id].when && C.rarities.includes(Rules.FISH[id].rarity), id);
  const [a, b, c, d] = [angler('Alpha'), angler('Bravo'), angler('Charlie'), angler('Delta')];
  assert.strictEqual(fishing.contestCatch(a, sp === 'gardon' ? 'perche' : 'gardon', 20, day1), null, 'une autre espèce ne compte pas');
  assert.deepStrictEqual(fishing.contestCatch(a, sp, 10, day1), { rank: 1, size: 10, improved: true, lead: true });
  assert.deepStrictEqual(fishing.contestCatch(b, sp, 12, day1 + 1000), { rank: 1, size: 12, improved: true, lead: true });
  assert.deepStrictEqual(fishing.contestCatch(a, sp, 9, day1 + 2000), { rank: 2, size: 10, improved: false }, 'on garde sa plus grande');
  fishing.contestCatch(c, sp, 11, day1 + 3000);
  fishing.contestCatch(d, sp, 8, day1 + 4000);
  const v = fishing.contestView(day1 + 5000, d.id);
  assert.deepStrictEqual(v.top.map((e) => [e.name, e.size]), [['Bravo', 12], ['Charlie', 11], ['Alpha', 10], ['Delta', 8]]);
  assert.deepStrictEqual([v.species, v.me.rank, v.rewards], [sp, 4, C.rewards]);
  assert.strictEqual(fishing.contestRollover(day1 + 6000), null, 'même jour : rien');
  // Le lendemain : Bravo, Charlie et Alpha reçoivent leur lot (golds, coffres, courrier) ; Bravo compte une victoire
  const before = [b, c, a, d].map((u) => [u.character.gold, u.character.chests]);
  const roll = fishing.contestRollover(day1 + 24 * 3600e3);
  assert.deepStrictEqual(roll.winners.map((w) => [w.name, w.rank, w.reward]), [['Bravo', 1, C.rewards[0]], ['Charlie', 2, C.rewards[1]], ['Alpha', 3, C.rewards[2]]]);
  [b, c, a].forEach((u, i) => {
    assert.deepStrictEqual([u.character.gold, u.character.chests], [before[i][0] + C.rewards[i].gold, before[i][1] + C.rewards[i].chests]);
    assert.match(u.character.mail[0].text, /Concours de pêche/);
  });
  assert.deepStrictEqual([d.character.gold, d.character.chests], before[3], 'le 4ᵉ ne gagne rien');
  assert.strictEqual(b.character.counters.fishContest, 1);
  assert.strictEqual(c.character.counters.fishContest || 0, 0);
  assert.ok(Rules.ACHIEVEMENTS.some((x) => x.metric === 'fishContest' && x.goal === 1) && Rules.ACHIEVEMENTS.some((x) => x.metric === 'fishContest' && x.goal === 10));
  // Nouveau concours, vide, avec l'espèce du jour
  const v2 = fishing.contestView(day1 + 24 * 3600e3 + 1000);
  assert.deepStrictEqual([v2.day, v2.species, v2.top], ['2026-11-27', Rules.fishContestSpecies('2026-11-27'), []]);
});
