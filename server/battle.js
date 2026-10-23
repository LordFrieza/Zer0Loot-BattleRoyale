/*
 * File d'attente (!join) et simulation du combat, calculée côté serveur
 * puis diffusée en temps réel à l'écran de combat.
 *
 * Trois modes (voir Rules.GAME_MODES) :
 *  - br : Battle Royale, chacun pour soi (chaque combattant est sa propre équipe) ;
 *  - boss : tous les combattants (équipe « heroes ») contre le Troll ;
 *  - dungeon : les combattants enchaînent des salles de monstres, sans réapparition.
 */
const EventEmitter = require('events');
const Rules = require('../shared/rules');

const ARENA = { w: 1280, h: 720 };
const TICK_MS = 50;
const RADIUS = 16;
const STORM_START = 45;
const STORM_DURATION = 60;
const STORM_MIN_RADIUS = 70;
const STORM_DPS = 0.05; // fraction de la vie max par seconde
const MAX_DURATION = 300;
// Événements de bataille
const FAST_SPEED_MULT = 5;
const FOG_EVERY = 3; // une nouvelle nappe de brouillard toutes les 3 s
const FOG_MAX = 3;
const FOG_LIFE = 9;
const FOG_SEE_RANGE = 80; // dans le brouillard, on n'est ciblable que de près
const METEOR_EVERY = 1.1;
const METEOR_FALL = 1.4; // délai entre l'alerte au sol et l'impact
const METEOR_RADIUS = 70;
const METEOR_DAMAGE = { flat: 12, ratio: 0.15 }; // 12 + 15 % de la vie max, ignore la défense
// Donjon
const DUNGEON_TOP = 100; // le mur du fond occupe le haut de l'écran
const WALK_SPEED = 240; // entrée / sortie des salles
const HEROES = 'heroes';
const MONSTERS = 'monsters';

class Battle extends EventEmitter {
  constructor() {
    super();
    this.phase = 'idle'; // idle | queue | ready | battle | ended
    this.mode = 'br';
    this.bossId = 'troll'; // boss choisi par l'admin pour le Combat de Boss (voir Rules.BOSSES)
    this.event = null; // événement de la bataille en cours (voir Rules.BATTLE_EVENTS)
    this.fogs = [];
    this.meteors = [];
    this.slams = [];
    this.zones = [];
    this.participants = new Map();
    this.queueEndsAt = null;
    this.queueTimer = null;
    this.fighters = [];
    this.players = [];
    this.boss = null;
    this.dungeon = null;
    this.events = [];
    this.time = 0;
    this.interval = null;
    this.result = null;
  }

  publicQueue() {
    return {
      phase: this.phase,
      mode: this.mode,
      boss: this.mode === 'boss' ? this.bossId : null,
      queueEndsAt: this.queueEndsAt,
      participants: [...this.participants.values()].map((p) => ({
        key: p.key, name: p.name, bot: !!p.bot, level: p.level, cls: p.cls || null, look: p.look, app: p.app || null, title: p.title || null,
      })),
      // L'événement n'est révélé qu'au lancement de la bataille.
      event: this.phase === 'battle' || this.phase === 'ended' ? this.event : null,
      result: this.result,
      poll: this.publicPoll(),
    };
  }

  changed() {
    this.emit('queue', this.publicQueue());
  }

  openQueue(seconds, mode = 'br', bossId = 'troll') {
    if (this.phase === 'battle') throw new Error('Une bataille est en cours');
    if (!Rules.GAME_MODES[mode]) throw new Error('Mode de jeu inconnu');
    if (mode === 'boss' && !Rules.BOSSES[bossId]) throw new Error('Boss inconnu');
    this.bossId = mode === 'boss' ? bossId : 'troll';
    this.stopLoop();
    this.emit('cleared'); // la bataille précédente n'aura pas lieu : paris remboursés
    this.participants.clear();
    this.mode = mode;
    this.event = null;
    this.result = null;
    this.fighters = [];
    this.phase = 'queue';
    this.queueEndsAt = Date.now() + seconds * 1000;
    clearTimeout(this.queueTimer);
    this.queueTimer = setTimeout(() => this.closeQueue(), seconds * 1000);
    this.changed();
  }

  closeQueue() {
    if (this.phase !== 'queue') return;
    clearTimeout(this.queueTimer);
    this.phase = 'ready';
    this.queueEndsAt = null;
    this.changed();
  }

  reset() {
    if (this.phase === 'battle') this.stopLoop();
    clearTimeout(this.queueTimer);
    this.emit('cleared');
    this.event = null;
    this.phase = 'idle';
    this.participants.clear();
    this.queueEndsAt = null;
    this.fighters = [];
    this.players = [];
    this.boss = null;
    this.dungeon = null;
    this.koth = null;
    this.slams = [];
    this.result = null;
    this.changed();
    this.emit('frame', this.frame());
  }

  /*
   * participant = { key, userId, name, bot, level, stats (dérivées), look }
   * Retourne false si déjà inscrit ou si la file est fermée.
   */
  join(participant) {
    if (this.phase !== 'queue') return false;
    if (this.participants.has(participant.key)) return false;
    this.participants.set(participant.key, participant);
    this.changed();
    return true;
  }

  start(refresh, event = null) {
    if (this.phase !== 'queue' && this.phase !== 'ready') throw new Error('Aucune file ouverte');
    const info = Rules.GAME_MODES[this.mode];
    if (this.participants.size < info.minPlayers) {
      throw new Error(info.minPlayers > 1 ? `Il faut au moins ${info.minPlayers} combattants` : 'Il faut au moins 1 combattant');
    }
    clearTimeout(this.queueTimer);
    this.queueEndsAt = null;
    if (this.mode !== 'br') event = null; // les événements ne concernent que le Battle Royale

    const list = [...this.participants.values()].map((p) => (refresh ? refresh(p) : p));
    this.players = list.map((p) => this.makePlayer(p, event));
    this.fighters = [...this.players];
    this.boss = null;
    this.dungeon = null;
    this.koth = null;
    this.firstBlood = false;
    this.event = event;
    this.fogs = [];
    this.meteors = [];
    this.slams = [];
    this.zones = []; // zones des ultimes (météores, flèches, poison)
    this.nextFog = 0;
    this.nextMeteor = 2;
    this.time = 0;
    this.events = [];
    this.result = null;

    if (this.mode === 'br' || this.mode === 'koth') {
      const positions = spawnPositions(this.players.length);
      this.players.forEach((f, i) => Object.assign(f, positions[i]));
      if (this.mode === 'koth') {
        const K = Rules.KOTH;
        this.koth = { hill: { x: ARENA.w / 2, y: ARENA.h / 2, r: K.hill.radius }, next: null, moveAt: K.hill.moveEvery, king: null };
        for (const f of this.players) f.score = 0;
      }
    } else if (this.mode === 'boss') {
      this.setupBoss();
    } else {
      // Écran noir « SALLE 1 », puis les aventuriers entrent par la gauche.
      this.dungeon = {
        room: 0, stage: 'dark', stageT: Rules.DUNGEON.stages.dark * 0.35, fightStart: 0, enraged: false,
        poll: null, lastPoll: null, boons: [], monsterMult: 1, rewardMult: 1, // sondages (voir DUNGEON_POLL)
      };
      this.monsters = [];
      for (const p of this.players) { p.x = -60; p.y = ARENA.h / 2; }
    }

    this.phase = 'battle';
    this.changed();
    this.emit('start', this.fighters);
    this.interval = setInterval(() => this.tick(TICK_MS / 1000), TICK_MS);
  }

  makePlayer(p, event) {
    const combat = Rules.classInfo(p.cls).combat;
    const s = p.stats;
    return fighter({
      key: p.key,
      userId: p.userId || null,
      name: p.name,
      title: p.title || null,
      app: p.app || null,
      cls: p.cls || null,
      look: p.look,
      level: p.level,
      kind: 'player',
      team: Rules.GAME_MODES[this.mode].coop ? HEROES : p.key, // Battle Royale, Roi de la Colline : chacun pour soi
      hp: s.maxHp,
      maxHp: s.maxHp,
      damage: s.damage,
      reduction: s.reduction,
      speed: s.speed * (event === 'fast' ? FAST_SPEED_MULT : 1),
      dodge: s.dodge,
      crit: s.crit || 0,
      cooldown: s.cooldown || Rules.BASE_ATTACK_COOLDOWN,
      lifesteal: s.lifesteal || 0,
      precision: s.precision || 0,
      thorns: s.thorns || 0,
      // Comportement de classe
      range: combat.range || 40,
      taunt: combat.taunt || 1,
      kite: combat.kite || 0,
      hunter: !!combat.hunter,
      regen: combat.regen || 0,
      projectile: combat.projectile || null,
      aoeRadius: combat.aoeRadius || 0,
      aoeRatio: combat.aoeRatio || 0,
      cd: Math.random() * 0.5,
      // Arbre de compétences : spécialisation, ultime et temps de remplissage de la barre de stamina
      spec: p.spec || null,
      ult: p.ult && Rules.ULTS[p.ult.id] ? p.ult : null,
      staminaTime: s.staminaTime || Rules.STAMINA.baseTime.none,
      // Potion équipée pour cette partie (déclenchée au plus une fois)
      consumable: p.consumable && Rules.CONSUMABLES[p.consumable] ? p.consumable : null,
    });
  }

  // ---------- Combat de Boss ----------

  setupBoss() {
    const B = Rules.BOSSES[this.bossId];
    const st = Rules.bossStats(this.players.length, B.id);
    const positions = spawnPositions(this.players.length, { x0: 60, y0: 70, x1: 470, y1: ARENA.h - 60 });
    this.players.forEach((f, i) => Object.assign(f, positions[i]));
    this.boss = fighter({
      key: 'boss',
      name: B.name,
      kind: B.kind,
      isBoss: true,
      bossId: B.id,
      team: MONSTERS,
      x: ARENA.w * 0.72,
      y: ARENA.h / 2 + 20,
      r: B.radius,
      hp: st.maxHp,
      maxHp: st.maxHp,
      damage: st.damage,
      reduction: B.reduction,
      speed: B.speed,
      dodge: B.dodge,
      crit: 0.05,
      cooldown: B.cooldown,
      precision: B.precision,
      range: B.range || 40,
      kite: B.kite || 0,
      projectile: B.projectile || null,
      cleave: B.cleaveRadius ? { r: B.cleaveRadius, ratio: B.cleaveRatio } : false,
      cd: 1,
    });
    const every = B.specialEvery || B.slam.every;
    Object.assign(this.boss, {
      phase: 0,
      enraged: false,
      flying: false, // Dragon en vol : intouchable au corps à corps
      away: false, // Dragon parti au nid : intouchable
      shielded: false, // Magicien derrière son bouclier : intouchable
      flyMinRange: B.flight ? B.flight.minRange : 0,
      slamEvery: every, // attaques spéciales (le nom vient du Troll)
      slamIn: every * 0.7,
      nextSpecial: 0,
      blinkIn: B.blinkEvery || 0,
      script: [], // grandes étapes à franchir selon la vie (vol, nid, bouclier, illusions)
      stage: null, // étape en cours : { kind, until, … }
    });
    if (B.flight) for (const at of B.flight.at) this.boss.script.push({ at, kind: 'flight' });
    if (B.nest) this.boss.script.push({ at: B.nest.at, kind: 'nest' });
    if (B.shield) for (const at of B.shield.at) this.boss.script.push({ at, kind: 'shield' });
    if (B.clones) this.boss.script.push({ at: B.clones.at, kind: 'clones' });
    this.boss.script.sort((a, c) => c.at - a.at);
    this.adds = []; // œufs, dragonnets, cristaux, illusions
    this.addSeq = 0;
    this.fighters.push(this.boss);
  }

  // Intouchable pour cet attaquant ? (Dragon en vol ou parti, Magicien protégé par son bouclier)
  immune(target, attacker) {
    if (target.away || target.shielded || target.protectUntil > this.time) return true;
    return !!(target.flying && attacker && attacker.range < target.flyMinRange);
  }

  updateBoss(dt) {
    const b = this.boss;
    const B = Rules.BOSSES[b.bossId];
    if (b.alive) {
      // Phases du Troll à 66 % et 33 % de vie
      while (b.phase < B.phases.length && b.hp / b.maxHp <= B.phases[b.phase].at) {
        const ph = B.phases[b.phase];
        b.phase += 1;
        b.dmgMult *= ph.damageMult;
        b.cooldown /= ph.attackSpeedMult;
        b.slamEvery *= 0.8;
        this.events.push({ t: 'bossPhase', phase: b.phase, label: ph.label });
      }
      if (!b.enraged && this.time >= B.enrageAt) {
        b.enraged = true;
        b.dmgMult *= B.enrageMult;
        this.events.push({ t: 'bossEnrage' });
      }
      // Grandes étapes (une à la fois) quand la vie passe sous un seuil
      if (!b.stage && b.script.length && b.hp / b.maxHp <= b.script[0].at) {
        const step = b.script.shift();
        b.phase += 1;
        if (step.kind === 'flight') this.startFlight(B);
        else if (step.kind === 'nest') this.startNest(B);
        else if (step.kind === 'shield') this.startShield(B);
        else this.splitClones(B);
      }
      if (b.stage) this.updateStage(dt, B);
      else this.bossSpecials(dt, B);
      if (b.bossId === 'sorcier') this.updateCurses(B);
    }
    this.resolveSlams(dt);
  }

  // Attaques spéciales au sol, annoncées avant l'impact.
  bossSpecials(dt, B) {
    const b = this.boss;
    const heroes = this.players.filter((p) => p.alive);
    if (!heroes.length) return;
    if (B.blinkEvery) {
      b.blinkIn -= dt;
      if (b.blinkIn <= 0) {
        b.blinkIn = B.blinkEvery;
        this.blink(b, { x: 220 + Math.random() * (ARENA.w - 440), y: 230 + Math.random() * (ARENA.h - 320) });
      }
    }
    b.slamIn -= dt;
    if (b.slamIn > 0) return;
    b.slamIn = b.slamEvery;
    const n = b.nextSpecial;
    b.nextSpecial = 1 - n;
    if (B.id === 'troll') {
      // Onde de choc autour de lui, puis rocher sur le plus gros groupe
      if (n === 0) this.slams.push({ kind: 'slam', x: b.x, y: b.y, r: B.slam.radius, t: B.slam.warn, warn: B.slam.warn, ratio: B.slam.ratio });
      else {
        const spot = densestSpot(heroes, B.slam.rockRadius);
        this.slams.push({ kind: 'rock', x: spot.x, y: spot.y, r: B.slam.rockRadius, t: B.slam.warn, warn: B.slam.warn, ratio: B.slam.ratio, fx: b.x, fy: b.y - 60 });
      }
    } else if (B.id === 'dragon') {
      // Souffle de feu en cône vers le plus gros groupe, puis coup de queue autour de lui
      if (n === 0) {
        const spot = densestSpot(heroes, 120);
        const angle = Math.atan2(spot.y - b.y, spot.x - b.x);
        this.slams.push({ kind: 'cone', x: b.x, y: b.y, r: B.breath.length, angle, half: B.breath.angle, t: B.breath.warn, warn: B.breath.warn, ratio: B.breath.ratio });
      } else {
        this.slams.push({ kind: 'tail', x: b.x, y: b.y, r: B.tail.radius, t: B.tail.warn, warn: B.tail.warn, ratio: B.tail.ratio });
      }
    } else {
      // Malédiction sur quelques combattants, puis zones d'ombre sous leurs pieds
      if (n === 0) this.castCurse(B, heroes);
      else {
        const V = B.void;
        const count = Math.min(V.max, V.base + Math.floor(heroes.length / V.perPlayers));
        const shuffled = [...heroes].sort(() => Math.random() - 0.5).slice(0, count);
        for (const h of shuffled) this.slams.push({ kind: 'void', x: h.x, y: h.y, r: V.radius, t: V.warn, warn: V.warn, ratio: V.ratio });
      }
    }
    this.events.push({ t: 'slamWarn', boss: B.id });
  }

  // Impact des attaques annoncées (cercles, cône du souffle, atterrissage).
  resolveSlams(dt) {
    const b = this.boss;
    for (const s of this.slams) {
      s.t -= dt;
      if (s.t > 0) continue;
      this.events.push({ t: 'slam', kind: s.kind, x: Math.round(s.x), y: Math.round(s.y), r: s.r });
      if (s.kind === 'land') this.land(s);
      if (!b.alive) continue;
      const raw = b.damage * b.dmgMult * s.ratio;
      for (const f of this.players) {
        if (f.alive && inSlam(s, f)) this.hit(b, f, raw * (0.9 + Math.random() * 0.2), { splash: true });
      }
    }
    this.slams = this.slams.filter((s) => s.t > 0);
  }

  updateStage(dt, B) {
    const b = this.boss;
    const st = b.stage;
    const heroes = this.players.filter((p) => p.alive);
    if (st.kind === 'flight') {
      // Il plane au-dessus de l'arène et bombarde des combattants au hasard.
      const dx = st.tx - b.x;
      const dy = st.ty - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 20 || this.time >= st.retarget) {
        // (assez bas pour que le dragon, dessiné haut dans le ciel, reste à l'écran)
        st.tx = 200 + Math.random() * (ARENA.w - 400);
        st.ty = 300 + Math.random() * (ARENA.h - 400);
        st.retarget = this.time + 3;
      } else {
        const step = Math.min(dist, 150 * dt);
        b.x += (dx / dist) * step;
        b.y += (dy / dist) * step;
      }
      if (st.landing) return;
      // Une flammèche de plus toutes les 3 s
      st.spriteIn -= dt;
      if (st.spriteIn <= 0) { st.spriteIn = B.sprites.every; this.spawnSprites(B, 1); }
      st.fireIn -= dt;
      if (st.fireIn <= 0 && heroes.length) {
        st.fireIn = st.fireEvery;
        const h = heroes[Math.floor(Math.random() * heroes.length)];
        const F = B.flight;
        this.slams.push({ kind: 'fireball', x: h.x, y: h.y, r: F.fireballRadius, t: F.fireballWarn, warn: F.fireballWarn, ratio: F.fireballRatio, fx: b.x, fy: b.y - 120 });
      }
      if (this.time >= st.until && heroes.length) {
        // Atterrissage brutal sur le plus gros groupe
        const spot = densestSpot(heroes, B.flight.landRadius);
        st.landing = true;
        st.tx = spot.x;
        st.ty = spot.y;
        this.slams.push({ kind: 'land', x: spot.x, y: spot.y, r: B.flight.landRadius, t: B.flight.landWarn, warn: B.flight.landWarn, ratio: B.flight.landRatio });
        this.events.push({ t: 'slamWarn', boss: B.id });
      }
    } else if (st.kind === 'nest') {
      const eggs = this.adds.filter((a) => a.kind === 'oeuf' && a.alive);
      if (this.time >= st.until || !eggs.length) {
        // Les œufs restants éclosent ; le dragon revient, furieux, et atterrit sur le plus gros groupe.
        for (const egg of eggs) this.hatch(egg, B);
        b.away = false;
        b.dmgMult *= B.nest.returnDamageMult;
        b.cooldown /= B.nest.returnAttackSpeedMult;
        this.events.push({ t: 'bossReturn', hatched: eggs.length, label: 'PYRAX REVIENT, FOU DE RAGE !' });
        b.x = ARENA.w - 160;
        b.y = 180;
        this.startFlight(B, true);
      }
    } else if (st.kind === 'shield') {
      const crystals = this.adds.filter((a) => a.kind === 'cristal' && a.alive);
      // Chaque cristal encore debout soigne le Magicien.
      this.heal(b, b.maxHp * B.shield.regen * crystals.length * dt);
      if (!crystals.length) {
        b.shielded = false;
        b.stage = null;
        this.events.push({ t: 'shieldDown' });
      } else this.bossSpecials(dt, B);
    }
  }

  startFlight(B, landingOnly = false) {
    const b = this.boss;
    const F = B.flight;
    const flights = F.at.length - b.script.filter((s) => s.kind === 'flight').length;
    b.flying = true;
    b.targetKey = null;
    b.stage = {
      kind: 'flight', until: landingOnly ? this.time : this.time + F.duration,
      fireIn: 0.8, fireEvery: F.fireballEvery * (flights > 1 ? 0.75 : 1), tx: b.x, ty: b.y, retarget: 0, landing: false,
    };
    if (!landingOnly) {
      this.events.push({ t: 'bossFly', duration: F.duration });
      const S = B.sprites;
      b.stage.spriteIn = S.every;
      this.spawnSprites(B, Math.max(S.min, Math.min(S.max, Math.ceil(this.players.length / S.per))));
    } else b.stage.spriteIn = Infinity;
  }

  spawnSprites(B, count) {
    const S = B.sprites;
    const pos = spawnPositions(count, { x0: 220, y0: 160, x1: ARENA.w - 220, y1: ARENA.h - 80 });
    for (const p of pos) {
      this.addMonster({
        kind: 'flammeche', name: 'Flammèche', x: p.x, y: p.y, r: S.radius,
        hp: Math.round(S.hpBase + S.hpPerPlayer * this.players.length), damage: this.boss.damage * S.damageRatio,
        speed: S.speed, cooldown: S.cooldown, range: S.range,
      });
    }
  }

  land(s) {
    const b = this.boss;
    if (!b.stage || b.stage.kind !== 'flight') return;
    // Les flammèches restantes s'éteignent quand le dragon se pose.
    for (const a of this.adds) if (a.kind === 'flammeche' && a.alive) { a.alive = false; a.hp = 0; this.events.push({ t: 'vanish', to: a.key }); }
    b.flying = false;
    b.stage = null;
    b.x = s.x;
    b.y = s.y;
    b.slamIn = b.slamEvery * 0.6;
  }

  startNest(B) {
    const b = this.boss;
    const N = B.nest;
    const n = this.players.length;
    const count = Math.max(N.eggsMin, Math.min(N.eggsMax, Math.ceil(n / N.eggsPer)));
    b.away = true;
    b.targetKey = null;
    b.x = ARENA.w + 220; // hors de l'arène
    b.y = 160;
    b.stage = { kind: 'nest', until: this.time + N.duration };
    const pos = spawnPositions(count, { x0: 520, y0: 110, x1: ARENA.w - 120, y1: ARENA.h - 80 });
    const hp = Math.round(N.eggHpBase + N.eggHpPerPlayer * n);
    for (const p of pos) this.addMonster({ kind: 'oeuf', name: 'Œuf de dragon', x: p.x, y: p.y, r: 18, hp, inert: true });
    this.events.push({ t: 'bossAway', eggs: count, duration: N.duration });
  }

  hatch(egg, B) {
    const W = B.whelp;
    egg.alive = false;
    egg.hp = 0;
    this.events.push({ t: 'hatch', to: egg.key, x: Math.round(egg.x), y: Math.round(egg.y) });
    this.addMonster({
      kind: 'dragonnet', name: 'Dragonnet', x: egg.x, y: egg.y, r: W.radius,
      hp: Math.round(W.hpBase + W.hpPerPlayer * this.players.length),
      damage: this.boss.damage * W.damageRatio, speed: W.speed, cooldown: W.cooldown, range: W.range,
    });
  }

  startShield(B) {
    const b = this.boss;
    const S = B.shield;
    b.shielded = true;
    b.stage = { kind: 'shield' };
    this.blink(b, { x: ARENA.w / 2, y: ARENA.h / 2 });
    const spots = [[190, 240], [ARENA.w - 190, 240], [190, ARENA.h - 100], [ARENA.w - 190, ARENA.h - 100]].slice(0, S.crystals);
    const hp = Math.round(S.crystalHpBase + S.crystalHpPerPlayer * this.players.length);
    for (const [x, y] of spots) this.addMonster({ kind: 'cristal', name: 'Cristal d\'ombre', x, y, r: 20, hp, inert: true });
    this.events.push({ t: 'shieldUp', crystals: spots.length });
  }

  // Le Magicien se dédouble : des illusions fragiles qui attaquent aussi (moins fort).
  splitClones(B) {
    const b = this.boss;
    const C = B.clones;
    const spots = spawnPositions(C.count + 1, { x0: 300, y0: 230, x1: ARENA.w - 100, y1: ARENA.h - 70 }).sort(() => Math.random() - 0.5);
    this.blink(b, spots[0]);
    for (let i = 1; i <= C.count; i++) {
      this.addMonster({
        kind: 'sorcier', name: b.name, clone: true, x: spots[i].x, y: spots[i].y, r: b.r,
        hp: Math.round(b.maxHp * C.hpRatio), damage: b.damage * C.damageRatio, speed: b.speed, cooldown: b.cooldown,
        range: b.range, kite: b.kite, projectile: b.projectile, dodge: b.dodge, precision: b.precision,
      });
    }
    this.events.push({ t: 'clones', count: C.count });
  }

  addMonster(o) {
    this.addSeq += 1;
    const m = fighter(Object.assign({
      key: `a${this.addSeq}`, team: MONSTERS, maxHp: o.hp, damage: 0, reduction: 0, speed: 0, dodge: 0, crit: 0.05,
      cooldown: 1, precision: 0.1, range: 30, cd: 0.6 + Math.random() * 0.6,
    }, o));
    if (o.inert) { m.cd = Infinity; m.damage = 0; } // œufs et cristaux : n'attaquent pas
    this.adds.push(m);
    this.fighters.push(m);
    return m;
  }

  // Téléportation du Magicien (vers un point donné, ou loin des combattants).
  blink(f, to = null) {
    const fx = Math.round(f.x);
    const fy = Math.round(f.y);
    if (to) { f.x = to.x; f.y = to.y; } else this.teleportAway(f);
    f.targetKey = null;
    this.events.push({ t: 'blink', to: f.key, fx, fy, x: Math.round(f.x), y: Math.round(f.y) });
  }

  castCurse(B, heroes) {
    const C = B.curse;
    const free = heroes.filter((h) => !h.buffs.some((x) => x.curse));
    const count = Math.max(1, Math.ceil(heroes.length / C.perPlayers));
    for (const h of free.sort(() => Math.random() - 0.5).slice(0, count)) {
      this.addBuff(h, 'curse', C.duration, { curse: true, dot: C.dps, tick: this.time + 0.5 });
      this.events.push({ t: 'curse', to: h.key });
    }
  }

  // Malédictions : dégâts chaque demi-seconde ; un Prêtre (lui compris) tout proche les purifie.
  updateCurses(B) {
    const priests = this.players.filter((p) => p.alive && p.cls === 'pretre');
    for (const h of this.players) {
      if (!h.alive) continue;
      const curse = h.buffs.find((x) => x.curse);
      if (!curse) continue;
      const priest = priests.find((p) => Math.hypot(p.x - h.x, p.y - h.y) <= B.curse.purifyRadius);
      if (priest) {
        h.buffs = h.buffs.filter((x) => x !== curse);
        this.events.push({ t: 'purify', to: h.key, from: priest.key });
        continue;
      }
      if (this.time < curse.tick) continue;
      curse.tick += 0.5;
      const dmg = Math.max(1, Math.round(h.maxHp * curse.dot * 0.5));
      h.hp -= dmg;
      this.events.push({ t: 'hit', from: this.boss.key, to: h.key, dmg, curse: true });
      if (h.hp <= 0) this.kill(this.boss, h);
    }
  }

  // ---------- Raid de Donjon ----------

  nextRoom() {
    const d = this.dungeon;
    d.room += 1;
    const heroes = this.players.filter((p) => p.alive);
    const slots = spawnPositions(heroes.length, { x0: 80, y0: DUNGEON_TOP + 40, x1: 380, y1: ARENA.h - 50 });
    heroes.forEach((p, i) => {
      if (d.room > 1) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * Rules.DUNGEON.healBetweenRooms);
      p.slot = slots[i];
      p.x = -30 - Math.random() * 90;
      p.y = slots[i].y;
      p.cd = 0.3 + Math.random() * 0.5;
      p.targetKey = null;
    });
    // Le nombre de monstres dépend du nombre d'aventuriers au départ du raid.
    const base = Rules.dungeonMultipliers(d.room);
    const mult = { hp: base.hp * d.monsterMult, damage: base.damage * d.monsterMult }; // « Quitte ou double »
    const spec = Rules.dungeonRoom(d.room, this.players.length);
    const pos = spawnPositions(spec.length, { x0: 720, y0: DUNGEON_TOP + 40, x1: ARENA.w - 80, y1: ARENA.h - 50 });
    this.monsters = spec.map((s, i) => this.makeMonster(s.type, s.elite, mult, pos[i], i));
    this.fighters = this.players.concat(this.monsters);
    this.zones = [];
    d.stage = 'enter';
    d.stageT = 0;
    d.enraged = false;
    this.events.push({ t: 'room', room: d.room });
  }

  makeMonster(type, elite, mult, pos, idx) {
    const m = Rules.MONSTERS[type];
    const E = Rules.ELITE;
    const maxHp = Math.round(m.hp * mult.hp * (elite ? E.hpMult : 1));
    return fighter({
      key: `m${this.dungeon.room}_${idx}`,
      name: elite ? Rules.ELITES[type] : m.label,
      kind: type,
      elite,
      scale: elite ? E.scale : 1,
      team: MONSTERS,
      x: pos.x,
      y: pos.y,
      r: Math.round(m.radius * (elite ? E.scale : 1)),
      hp: maxHp,
      maxHp,
      damage: m.damage * mult.damage * (elite ? E.damageMult : 1),
      reduction: m.reduction,
      speed: m.speed * (elite ? 0.85 : 1),
      dodge: m.dodge,
      crit: 0.05,
      cooldown: m.cooldown * (elite ? 1.15 : 1),
      precision: 0.1,
      range: m.range,
      kite: m.kite || 0,
      projectile: m.projectile || null,
      cd: 0.4 + Math.random() * 0.8,
    });
  }

  // Entrée dans la salle, pause après la victoire, sortie à droite, écran noir.
  tickDungeonStage(dt) {
    const d = this.dungeon;
    const S = Rules.DUNGEON.stages;
    d.stageT += dt;
    const heroes = this.players.filter((p) => p.alive);
    if (d.stage === 'enter') {
      for (const p of heroes) {
        const dx = p.slot.x - p.x;
        const dy = p.slot.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1) {
          const step = Math.min(dist, WALK_SPEED * dt);
          p.x += (dx / dist) * step;
          p.y += (dy / dist) * step;
        }
      }
      if (d.stageT >= S.enter) this.setStage('fight');
    } else if (d.stage === 'clear') {
      for (const p of heroes) if (p.regen) this.heal(p, p.maxHp * p.regen * dt);
      if (d.stageT >= S.clear) {
        if (d.room % Rules.DUNGEON_POLL.every === 0) this.openPoll();
        else this.setStage('exit');
      }
    } else if (d.stage === 'poll') {
      // Les votes sont renvoyés aux pages au plus une fois par seconde.
      if (d.poll.dirty && this.time >= d.poll.pushAt) {
        d.poll.dirty = false;
        d.poll.pushAt = this.time + 1;
        this.changed();
      }
      if (d.stageT >= Rules.DUNGEON_POLL.duration) this.closePoll();
    } else if (d.stage === 'exit') {
      for (const p of heroes) {
        p.x += WALK_SPEED * dt;
        p.y += (ARENA.h / 2 + 20 - p.y) * Math.min(1, dt * 1.5);
        p.targetKey = null;
      }
      if (d.stageT >= S.exit) this.setStage('dark');
    } else if (d.stage === 'dark' && d.stageT >= S.dark) {
      this.nextRoom();
    }
  }

  setStage(stage) {
    this.dungeon.stage = stage;
    this.dungeon.stageT = 0;
    if (stage === 'fight') this.dungeon.fightStart = this.time;
  }

  // ---------- Sondage du donjon (toutes les 5 salles) ----------

  openPoll() {
    const d = this.dungeon;
    // Les bonus du sondage précédent s'arrêtent ici.
    for (const p of this.players) p.buffs = p.buffs.filter((b) => !b.boon);
    d.boons = [];
    const someoneDead = this.players.some((p) => !p.alive);
    const pool = Object.keys(Rules.DUNGEON_BOONS).filter((id) => !Rules.DUNGEON_BOONS[id].needsDead || someoneDead);
    const options = [];
    while (options.length < Rules.DUNGEON_POLL.choices && pool.length) options.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    d.poll = { room: d.room, options, votes: new Map(), dirty: false, pushAt: 0 };
    this.setStage('poll');
    this.events.push({ t: 'poll', options });
    this.emit('pollStart', this.publicPoll());
    this.changed();
  }

  pollCounts() {
    const poll = this.dungeon.poll;
    const votes = [...poll.votes.values()];
    return poll.options.map((id) => ({ id, votes: votes.filter((v) => v === id).length }));
  }

  publicPoll() {
    const d = this.dungeon;
    if (this.phase !== 'battle' || !d || d.stage !== 'poll') return null;
    const left = Math.max(0, Rules.DUNGEON_POLL.duration - d.stageT);
    return { room: d.room, options: this.pollCounts(), endsAt: Date.now() + Math.round(left * 1000) };
  }

  /*
   * Vote d'un spectateur (une voix par personne, le dernier vote compte).
   * `choice` : identifiant du bonus (site) ou commande de chat (!vie, !1…). Retourne le bonus choisi, ou null.
   */
  vote(voter, choice) {
    const d = this.dungeon;
    if (this.phase !== 'battle' || !d || d.stage !== 'poll') return null;
    const options = d.poll.options;
    const id = options.includes(choice) ? choice : Rules.boonFromCommand(String(choice || '').toLowerCase(), options);
    if (!id) return null;
    d.poll.votes.set(voter, id);
    d.poll.dirty = true;
    return id;
  }

  // Fin du sondage (minuteur ou admin) : le bonus le plus voté l'emporte, égalité tirée au sort.
  closePoll() {
    const d = this.dungeon;
    if (this.phase !== 'battle' || !d || d.stage !== 'poll') return null;
    const counts = this.pollCounts();
    const top = Math.max(...counts.map((c) => c.votes));
    const best = counts.filter((c) => c.votes === top);
    const id = best[Math.floor(Math.random() * best.length)].id;
    const outcome = this.applyBoon(id);
    d.lastPoll = { room: d.room, id, counts, ...outcome };
    d.poll = null;
    this.events.push({ t: 'pollEnd', id, counts, revived: outcome.revived ? outcome.revived.key : undefined });
    this.emit('pollEnd', d.lastPoll, this.players);
    this.setStage('exit');
    this.changed();
    return d.lastPoll;
  }

  applyBoon(id) {
    const d = this.dungeon;
    const e = Rules.DUNGEON_BOONS[id].effect;
    const heroes = this.players.filter((p) => p.alive);
    const out = {};
    if (e.heal) for (const p of heroes) this.heal(p, p.maxHp * e.heal);
    if (e.stamina) for (const p of heroes) if (p.ult) p.stamina = Math.min(1, p.stamina + e.stamina);
    if (e.revive) {
      const dead = this.players.filter((p) => !p.alive);
      const p = dead[Math.floor(Math.random() * dead.length)];
      if (p) {
        const near = heroes.length ? heroes.reduce((a, h) => a + h.x, 0) / heroes.length : 200;
        Object.assign(p, {
          alive: true, hp: Math.round(p.maxHp * e.revive), diedAt: null, diedRoom: null, buffs: [], stunUntil: 0, targetKey: null,
          x: Math.max(40, near - 40), y: DUNGEON_TOP + 60 + Math.random() * (ARENA.h - DUNGEON_TOP - 120),
        });
        this.events.push({ t: 'revive', to: p.key });
        out.revived = { key: p.key, name: p.name };
      }
    }
    const mods = { damage: e.damage, taken: e.taken, speed: e.speed, attackSpeed: e.attackSpeed, lifesteal: e.lifesteal, thorns: e.thorns };
    if (Object.values(mods).some((v) => v)) {
      for (const p of heroes) this.addBuff(p, 'boon_' + id, Infinity, { boon: true, ...mods });
      d.boons.push(id);
    }
    if (e.monsters) d.monsterMult *= e.monsters;
    if (e.reward) d.rewardMult *= e.reward;
    if (e.skip) d.room += e.skip;
    // Récompenses immédiates, créditées par index.js à tous les participants humains (morts compris).
    const reward = { xp: (e.xpPerRoom || 0) * d.room, gold: (e.goldPerRoom || 0) * d.room, chests: e.chests || 0 };
    if (reward.xp || reward.gold || reward.chests) out.reward = reward;
    return out;
  }

  // Au-delà de DUNGEON.enrageAt secondes dans une salle, les monstres frappent de plus en plus fort.
  updateDungeonEnrage() {
    const d = this.dungeon;
    const over = this.time - d.fightStart - Rules.DUNGEON.enrageAt;
    if (over <= 0) return;
    if (!d.enraged) {
      d.enraged = true;
      this.events.push({ t: 'enrage' });
    }
    for (const m of this.monsters) m.dmgMult = 1 + Rules.DUNGEON.enrageRate * over;
  }

  // ---------- Boucle ----------

  stopLoop() {
    clearInterval(this.interval);
    this.interval = null;
  }

  storm() {
    const maxR = Math.hypot(ARENA.w, ARENA.h) / 2;
    if (this.time < STORM_START) return { x: ARENA.w / 2, y: ARENA.h / 2, r: maxR, active: false };
    const t = Math.min(1, (this.time - STORM_START) / STORM_DURATION);
    return { x: ARENA.w / 2, y: ARENA.h / 2, r: maxR - (maxR - STORM_MIN_RADIUS) * t, active: true };
  }

  tick(dt) {
    this.time += dt;
    if (this.mode === 'dungeon' && this.dungeon.stage !== 'fight') this.tickDungeonStage(dt);
    else this.tickFight(dt);
    this.emit('frame', this.frame());
    this.events = [];
  }

  tickFight(dt) {
    const alive = this.fighters.filter((f) => f.alive);
    const storm = this.mode === 'br' ? this.storm() : null;

    this.updateEvent(dt, alive);
    if (this.boss) this.updateBoss(dt);
    if (this.dungeon) this.updateDungeonEnrage();
    for (const f of alive) this.updateBuffs(f, dt);
    this.updateZones(dt);

    for (const f of alive) {
      if (!f.alive) continue;
      // Régénération (Prêtre)
      if (f.regen) this.heal(f, f.maxHp * f.regen * dt);
      // Potions déclenchées au début du combat ou selon la vie restante
      if (!f.started) { f.started = true; this.triggerPotion(f, 'start'); }
      this.checkHpPotion(f);
      // Barre de stamina (ultime de l'arbre de compétences)
      if (f.ult) f.stamina = Math.min(1, f.stamina + dt / f.staminaTime);
      // Gelé (Blizzard, Châtiment) : ne fait rien ; le Dragon en vol ou au nid suit son propre script.
      if (this.time < f.stunUntil || f.flying || f.away) continue;

      /*
       * Aggro : l'ennemi le plus proche ; un Guerrier « paraît » plus proche (il attire l'aggro).
       * L'Assassin, lui, traque l'ennemi qui a le moins de vie (en préférant les plus proches).
       */
      let best = null;
      let bestScore = Infinity;
      let fallback = null;
      let fallbackScore = Infinity;
      for (const o of alive) {
        // Un ennemi invisible (potion) ne peut pas être ciblé.
        if (o.team === f.team || !o.alive || this.isInvisible(o) || this.immune(o, f)) continue;
        const d = Math.hypot(o.x - f.x, o.y - f.y);
        let score = f.hunter ? o.hp * (1 + d / 500) : d * o.taunt;
        // Roi de la Colline : on se bat de préférence pour la colline.
        if (this.koth) score += Math.hypot(o.x - this.koth.hill.x, o.y - this.koth.hill.y) * (f.hunter ? 3 : 1.5);
        if (score < fallbackScore) { fallbackScore = score; fallback = o; }
        // Brouillard : un ennemi caché n'est visible que de près.
        if (d > FOG_SEE_RANGE && this.inFog(o)) continue;
        if (score < bestScore) { bestScore = score; best = o; }
      }
      best = best || fallback;
      if (!best) {
        f.targetKey = null;
        if (this.koth) this.walkTo(f, this.koth.hill, dt);
        continue;
      }
      f.targetKey = best.key;

      // Barre de stamina pleine : l'ultime part tout seul.
      if (f.ult && f.stamina >= 1) {
        f.stamina = 0;
        this.castUlt(f, best);
        if (!f.alive) continue;
      }

      const dx = best.x - f.x;
      const dy = best.y - f.y;
      const dist = Math.hypot(dx, dy) || 1;
      // Distance « bord à bord » : les gros (Troll, chefs) se touchent de plus loin.
      const reach = dist - (best.r + f.r - 2 * RADIUS);
      const speed = f.speed * this.buffMult(f, 'speed');
      f.cd -= dt;
      if (reach <= f.range && !f.engaged) { f.engaged = true; this.triggerPotion(f, 'engage'); }

      // Roi de la Colline : hors de la colline et personne à portée → on y retourne au lieu de courir après les autres.
      const toHill = this.koth && reach > f.range
        && Math.hypot(f.x - this.koth.hill.x, f.y - this.koth.hill.y) > this.koth.hill.r * 0.8
        && Math.hypot(best.x - this.koth.hill.x, best.y - this.koth.hill.y) > this.koth.hill.r;
      if (toHill) {
        this.walkTo(f, this.koth.hill, dt);
      } else if (reach > f.range) {
        const step = Math.min(speed * dt, reach - f.range + 1);
        f.x += (dx / dist) * step;
        f.y += (dy / dist) * step;
      } else if (f.kite && reach < f.kite) {
        // Archer : recule quand l'ennemi est trop près.
        const step = speed * 0.8 * dt;
        f.x -= (dx / dist) * step;
        f.y -= (dy / dist) * step;
      }
      if (reach <= f.range && f.cd <= 0) {
        f.cd = f.cooldown / this.buffMult(f, 'attackSpeed');
        this.attack(f, best);
      }
    }

    // Séparation pour éviter que les persos se superposent (les plus gros poussent les petits).
    const living = this.fighters.filter((f) => f.alive && !f.flying && !f.away);
    for (let i = 0; i < living.length; i++) {
      for (let j = i + 1; j < living.length; j++) {
        const a = living[i];
        const b = living[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = a.r + b.r;
        if (d < min) {
          const overlap = min - d;
          const ma = a.r * a.r;
          const mb = b.r * b.r;
          a.x -= (dx / d) * overlap * (mb / (ma + mb)); a.y -= (dy / d) * overlap * (mb / (ma + mb));
          b.x += (dx / d) * overlap * (ma / (ma + mb)); b.y += (dy / d) * overlap * (ma / (ma + mb));
        }
      }
    }
    const top = this.mode === 'dungeon' ? DUNGEON_TOP : 0;
    for (const f of living) {
      f.x = Math.max(f.r, Math.min(ARENA.w - f.r, f.x));
      f.y = Math.max(top + f.r, Math.min(ARENA.h - f.r, f.y));
    }

    // Zone (tempête) qui rétrécit pour forcer la fin du combat.
    if (storm && storm.active) {
      for (const f of this.fighters) {
        if (!f.alive) continue;
        if (Math.hypot(f.x - storm.x, f.y - storm.y) > storm.r) {
          const dmg = Math.max(1, f.maxHp * STORM_DPS * dt);
          const aliveCount = this.fighters.filter((x) => x.alive).length;
          if (f.hp - dmg <= 0 && aliveCount <= 1) continue;
          f.hp -= dmg;
          if (f.hp <= 0) this.kill(null, f);
        }
      }
    }

    if (this.koth) this.updateKoth(dt);

    if (this.mode === 'br') this.checkBrEnd();
    else if (this.mode === 'koth') this.checkKothEnd();
    else if (this.mode === 'boss') this.checkBossEnd();
    else this.checkDungeonEnd();
  }

  // ---------- Roi de la Colline ----------

  walkTo(f, p, dt) {
    const dx = p.x - f.x;
    const dy = p.y - f.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) return;
    const step = Math.min(dist, f.speed * this.buffMult(f, 'speed') * dt);
    f.x += (dx / dist) * step;
    f.y += (dy / dist) * step;
  }

  updateKoth(dt) {
    const K = Rules.KOTH;
    const k = this.koth;
    // Réapparition au bord de l'arène, protégé un court instant
    for (const f of this.players) {
      if (f.alive || f.respawnAt == null || this.time < f.respawnAt) continue;
      const side = Math.floor(Math.random() * 4);
      const along = Math.random();
      const x = side === 0 ? 50 : side === 1 ? ARENA.w - 50 : 60 + along * (ARENA.w - 120);
      const y = side === 2 ? 50 : side === 3 ? ARENA.h - 50 : 60 + along * (ARENA.h - 120);
      Object.assign(f, {
        alive: true, hp: f.maxHp, x, y, buffs: [], stunUntil: 0, targetKey: null, cd: 0.5,
        respawnAt: null, diedAt: null, protectUntil: this.time + K.protect,
      });
      this.events.push({ t: 'respawn', to: f.key, x: Math.round(x), y: Math.round(y) });
    }
    // La colline change de place (annoncée quelques secondes avant)
    if (!k.next && this.time >= k.moveAt - K.hill.warn) {
      let spot = null;
      for (let i = 0; i < 20 && !spot; i++) {
        const c = { x: K.hill.margin + Math.random() * (ARENA.w - 2 * K.hill.margin), y: K.hill.margin * 0.75 + Math.random() * (ARENA.h - 1.5 * K.hill.margin) };
        if (Math.hypot(c.x - k.hill.x, c.y - k.hill.y) >= K.hill.minJump) spot = c;
      }
      k.next = spot || { x: ARENA.w - k.hill.x, y: ARENA.h - k.hill.y };
      this.events.push({ t: 'hillWarn', x: Math.round(k.next.x), y: Math.round(k.next.y) });
    }
    if (this.time >= k.moveAt) {
      k.hill.x = k.next.x;
      k.hill.y = k.next.y;
      k.next = null;
      k.moveAt += K.hill.moveEvery;
      this.events.push({ t: 'hillMove', x: Math.round(k.hill.x), y: Math.round(k.hill.y) });
    }
    // Points : 1 par seconde sur la colline, 3 si l'on y est seul (le Roi)
    const inside = this.players.filter((f) => f.alive && Math.hypot(f.x - k.hill.x, f.y - k.hill.y) <= k.hill.r);
    const king = inside.length === 1 ? inside[0] : null;
    for (const f of inside) f.score += (king ? K.points.king : K.points.hill) * dt;
    const kingKey = king ? king.key : null;
    if (kingKey !== k.king) {
      k.king = kingKey;
      if (king) this.events.push({ t: 'king', to: king.key });
    }
  }

  // Fin du temps : le meilleur score gagne (égalité : le plus de kills, puis au hasard).
  checkKothEnd() {
    if (this.time < Rules.KOTH.duration) return;
    const sorted = [...this.players].sort((a, b) => Math.floor(b.score) - Math.floor(a.score) || b.kills - a.kills || Math.random() - 0.5);
    const winner = sorted[0];
    if (!winner.alive) { winner.alive = true; winner.hp = winner.maxHp; } // le vainqueur est debout pour la photo
    this.finish(winner);
  }

  checkBrEnd() {
    let remaining = this.fighters.filter((f) => f.alive);
    if (remaining.length === 0 && this.fighters.length) {
      // Morts simultanées (ex. épines) : le dernier tombé est déclaré vainqueur.
      const last = [...this.fighters].sort((a, b) => b.diedAt - a.diedAt)[0];
      last.alive = true;
      last.hp = 1;
      remaining = [last];
    }
    if (remaining.length <= 1 || this.time > MAX_DURATION) {
      const winner = remaining.length === 1
        ? remaining[0]
        : remaining.sort((a, b) => b.hp / b.maxHp - a.hp / a.maxHp)[0];
      this.finish(winner);
    }
  }

  checkBossEnd() {
    if (!this.boss.alive) {
      // Les œufs, dragonnets, cristaux et illusions disparaissent avec leur maître.
      for (const a of this.adds) if (a.alive) { a.alive = false; a.hp = 0; this.events.push({ t: 'vanish', to: a.key }); }
      this.finishCoop(true);
    } else if (!this.players.some((p) => p.alive) || this.time > MAX_DURATION) this.finishCoop(false);
  }

  checkDungeonEnd() {
    if (!this.players.some((p) => p.alive)) this.finishCoop(false);
    else if (!this.monsters.some((m) => m.alive)) {
      this.events.push({ t: 'roomClear', room: this.dungeon.room });
      this.setStage('clear');
    }
  }


  // ---------- Effets temporaires (potions, ultimes) ----------

  addBuff(f, kind, duration, mods = {}) {
    f.buffs = f.buffs.filter((b) => b.kind !== kind);
    f.buffs.push(Object.assign({ kind, until: this.time + duration }, mods));
  }

  // Produit des multiplicateurs actifs (damage, taken, speed, attackSpeed).
  buffMult(f, key) {
    let m = 1;
    for (const b of f.buffs) if (b[key]) m *= b[key];
    return m;
  }

  // Somme des bonus actifs (regen, thorns, lifesteal).
  buffSum(f, key) {
    let total = 0;
    for (const b of f.buffs) if (b[key]) total += b[key];
    return total;
  }

  isInvisible(f) {
    return f.buffs.some((b) => b.invisible);
  }

  updateBuffs(f, dt) {
    f.buffs = f.buffs.filter((b) => b.until > this.time);
    const regen = this.buffSum(f, 'regen');
    if (regen) this.heal(f, f.maxHp * regen * dt);
    // Tourbillon : frappe tous les ennemis autour à intervalle régulier.
    const spin = f.buffs.find((b) => b.spin);
    if (spin && this.time >= spin.next) {
      spin.next = this.time + spin.every;
      for (const o of this.fighters) {
        if (!o.alive || o.team === f.team || Math.hypot(o.x - f.x, o.y - f.y) > spin.radius + o.r) continue;
        const crit = Math.random() < f.crit;
        this.hit(f, o, f.damage * f.dmgMult * this.buffMult(f, 'damage') * spin.ratio * (crit ? Rules.CRIT_MULTIPLIER : 1), { crit, splash: true, ult: true });
      }
    }
  }

  // ---------- Potions ----------

  triggerPotion(f, trigger) {
    const c = f.consumable && !f.potionUsed && Rules.CONSUMABLES[f.consumable];
    if (!c || c.trigger !== trigger) return;
    f.potionUsed = true;
    const e = c.effect;
    const ev = { t: 'potion', to: f.key, id: f.consumable };
    if (e.duration) {
      this.addBuff(f, 'potion_' + f.consumable, e.duration, {
        damage: e.damage, taken: e.taken, speed: e.speed, attackSpeed: e.attackSpeed, regen: e.regen, thorns: e.thorns, invisible: e.invisible,
      });
    }
    if (e.stamina && f.ult) f.stamina = Math.max(f.stamina, e.stamina);
    if (e.teleport) {
      ev.fx = Math.round(f.x);
      ev.fy = Math.round(f.y);
      this.teleportAway(f);
    }
    this.events.push(ev);
  }

  checkHpPotion(f) {
    if (!f.alive || !f.consumable || f.potionUsed) return;
    const ratio = f.hp / f.maxHp;
    if (ratio < 0.5) this.triggerPotion(f, 'hp50');
    if (ratio < 0.2) this.triggerPotion(f, 'hp20');
  }

  // Téléportation d'urgence : le point (parmi 30 tirés au hasard) le plus éloigné des ennemis.
  teleportAway(f) {
    const top = this.mode === 'dungeon' ? DUNGEON_TOP : 0;
    const enemies = this.fighters.filter((o) => o.alive && o.team !== f.team);
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < 30; i++) {
      const p = { x: 40 + Math.random() * (ARENA.w - 80), y: top + 40 + Math.random() * (ARENA.h - top - 80) };
      const score = enemies.length ? Math.min(...enemies.map((o) => Math.hypot(o.x - p.x, o.y - p.y))) : Math.random();
      if (score > bestScore) { bestScore = score; best = p; }
    }
    f.x = best.x;
    f.y = best.y;
  }

  // ---------- Ultimes (arbre de compétences) ----------

  castUlt(f, target) {
    const U = Rules.ULTS[f.ult.id];
    const P = f.ult.enhanced ? U.plus : U.base;
    const ev = { t: 'ult', from: f.key, id: f.ult.id, enhanced: !!f.ult.enhanced, x: Math.round(f.x), y: Math.round(f.y) };
    const enemies = this.fighters.filter((o) => o.alive && o.team !== f.team);
    const allies = this.fighters.filter((o) => o.alive && o.team === f.team);
    const dmg = f.damage * f.dmgMult * this.buffMult(f, 'damage');
    const near = (a, b, r) => Math.hypot(a.x - b.x, a.y - b.y) <= r + (b.r || 0);
    switch (f.ult.id) {
      case 'rempart':
        this.addBuff(f, 'rempart', P.duration, { taken: P.taken });
        this.heal(f, f.maxHp * P.heal);
        if (P.allyHeal) {
          ev.targets = [];
          for (const a of allies) {
            if (a === f || !near(f, a, P.radius)) continue;
            this.heal(a, a.maxHp * P.allyHeal);
            this.addBuff(a, 'rempart', P.duration, { taken: P.allyTaken });
            ev.targets.push(a.key);
          }
          ev.r = P.radius;
        }
        break;
      case 'tourbillon':
        this.addBuff(f, 'tourbillon', P.duration, { spin: true, every: P.every, next: this.time, radius: P.radius, ratio: P.ratio, lifesteal: P.lifesteal });
        ev.r = P.radius;
        break;
      case 'perforante': {
        const top = this.mode === 'dungeon' ? DUNGEON_TOP : 0;
        const path = rayPath(f.x, f.y, target.x - f.x, target.y - f.y, P.bounces, { x0: 0, y0: top, x1: ARENA.w, y1: ARENA.h });
        for (let i = 1; i < path.length; i++) {
          for (const o of enemies) {
            if (o.alive && distToSegment(o, path[i - 1], path[i]) <= P.width / 2 + o.r) this.hit(f, o, dmg * P.ratio, { ult: true });
          }
        }
        ev.path = path.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
        ev.width = P.width;
        break;
      }
      case 'pluie':
        for (let i = 0; i < P.arrows; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * P.radius;
          this.zones.push({
            kind: 'arrow', owner: f, x: target.x + Math.cos(a) * r, y: target.y + Math.sin(a) * r, r: P.impact,
            t: 0.4 + (i / P.arrows) * P.duration, warn: 0.4, dmg: dmg * P.ratio,
          });
        }
        ev.tx = Math.round(target.x);
        ev.ty = Math.round(target.y);
        ev.r = P.radius;
        break;
      case 'meteore': {
        let pool = enemies.slice();
        for (let i = 0; i < P.count && pool.length; i++) {
          const spot = densestSpot(pool, P.radius);
          this.zones.push({ kind: 'meteor', owner: f, x: spot.x, y: spot.y, r: P.radius, t: P.warn, warn: P.warn, dmg: dmg * P.ratio });
          pool = pool.filter((o) => Math.hypot(o.x - spot.x, o.y - spot.y) > P.radius);
        }
        break;
      }
      case 'blizzard':
        ev.tx = Math.round(target.x);
        ev.ty = Math.round(target.y);
        ev.r = P.radius;
        for (const o of enemies) {
          if (!near(target, o, P.radius)) continue;
          this.hit(f, o, dmg * P.ratio, { splash: true, ult: true });
          // Les boss résistent : gel réduit de moitié.
          o.stunUntil = Math.max(o.stunUntil, this.time + P.stun * (o.isBoss ? 0.5 : 1));
        }
        break;
      case 'execution': {
        const victims = enemies.slice().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp).slice(0, P.targets);
        ev.hops = [];
        for (const v of victims) {
          if (!v.alive) continue;
          const side = f.x <= v.x ? -1 : 1;
          ev.hops.push({ fx: Math.round(f.x), fy: Math.round(f.y), x: Math.round(v.x + side * (v.r + f.r)), y: Math.round(v.y), to: v.key });
          f.x = v.x + side * (v.r + f.r);
          f.y = v.y;
          this.hit(f, v, dmg * P.ratio, { crit: true, ult: true });
          if (!f.alive) break;
        }
        break;
      }
      case 'poison':
        this.zones.push({ kind: 'poison', owner: f, x: f.x, y: f.y, r: P.radius, t: P.duration, life: P.duration, tick: 0, dps: dmg * P.ratio, follow: P.follow });
        ev.r = P.radius;
        break;
      case 'priere':
        this.heal(f, f.maxHp * P.self);
        ev.targets = [f.key];
        for (const a of allies) {
          if (a === f || !near(f, a, P.radius)) continue;
          this.heal(a, a.maxHp * P.ally);
          if (P.duration) this.addBuff(a, 'priere', P.duration, { taken: P.taken });
          ev.targets.push(a.key);
        }
        if (P.duration) this.addBuff(f, 'priere', P.duration, { taken: P.taken });
        break;
      case 'chatiment': {
        const victims = enemies.slice().sort((a, b) => Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y)).slice(0, P.targets);
        ev.targets = victims.map((v) => v.key);
        for (const v of victims) {
          this.hit(f, v, dmg * P.ratio, { ult: true });
          if (P.stun) v.stunUntil = Math.max(v.stunUntil, this.time + P.stun * (v.isBoss ? 0.5 : 1));
        }
        break;
      }
      default:
    }
    this.events.push(ev);
  }

  // Zones des ultimes : impacts différés (météores, pluie de flèches) et nuage de poison.
  updateZones(dt) {
    for (const z of this.zones) {
      z.t -= dt;
      if (z.kind === 'poison') {
        if (z.follow && z.owner.alive) { z.x = z.owner.x; z.y = z.owner.y; }
        z.tick -= dt;
        if (z.tick > 0) continue;
        z.tick += 0.5;
        for (const o of this.fighters) {
          if (o.alive && o.team !== z.owner.team && Math.hypot(o.x - z.x, o.y - z.y) <= z.r + o.r) this.hit(z.owner, o, z.dps * 0.5, { splash: true, ult: true });
        }
      } else if (z.t <= 0) {
        this.events.push({ t: 'zoneHit', kind: z.kind, x: Math.round(z.x), y: Math.round(z.y), r: z.r });
        for (const o of this.fighters) {
          if (o.alive && o.team !== z.owner.team && Math.hypot(o.x - z.x, o.y - z.y) <= z.r + o.r) this.hit(z.owner, o, z.dmg, { splash: true, ult: true });
        }
      }
    }
    this.zones = this.zones.filter((z) => z.t > 0);
  }

  // ---------- Événements ----------

  inFog(f) {
    return this.fogs.some((z) => z.a > 0.35 && Math.hypot(f.x - z.x, f.y - z.y) < z.r);
  }

  updateEvent(dt, alive) {
    if (this.event === 'fog') {
      this.nextFog -= dt;
      if (this.nextFog <= 0 && this.fogs.length < FOG_MAX) {
        this.nextFog = FOG_EVERY;
        this.fogs.push({ x: 100 + Math.random() * (ARENA.w - 200), y: 90 + Math.random() * (ARENA.h - 180), r: 130 + Math.random() * 90, age: 0 });
      }
      for (const z of this.fogs) {
        z.age += dt;
        // apparition 1 s, disparition progressive sur les 3 dernières secondes
        z.a = Math.max(0, Math.min(1, z.age / 1, (FOG_LIFE - z.age) / 3));
      }
      this.fogs = this.fogs.filter((z) => z.age < FOG_LIFE);
    } else if (this.event === 'meteors') {
      this.nextMeteor -= dt;
      if (this.nextMeteor <= 0) {
        this.nextMeteor = METEOR_EVERY;
        // Souvent près d'un combattant (plus spectaculaire), sinon au hasard.
        const near = alive.length && Math.random() < 0.6 ? alive[Math.floor(Math.random() * alive.length)] : null;
        const x = near ? near.x + (Math.random() - 0.5) * 120 : 80 + Math.random() * (ARENA.w - 160);
        const y = near ? near.y + (Math.random() - 0.5) * 120 : 80 + Math.random() * (ARENA.h - 160);
        this.meteors.push({ x: Math.max(30, Math.min(ARENA.w - 30, x)), y: Math.max(30, Math.min(ARENA.h - 30, y)), r: METEOR_RADIUS, t: METEOR_FALL });
      }
      for (const m of this.meteors) {
        m.t -= dt;
        if (m.t <= 0) this.meteorImpact(m);
      }
      this.meteors = this.meteors.filter((m) => m.t > 0);
    }
  }

  meteorImpact(m) {
    this.events.push({ t: 'meteor', x: Math.round(m.x), y: Math.round(m.y), r: m.r });
    for (const f of this.fighters) {
      if (!f.alive || Math.hypot(f.x - m.x, f.y - m.y) > m.r) continue;
      const dmg = Math.round(METEOR_DAMAGE.flat + f.maxHp * METEOR_DAMAGE.ratio);
      const aliveCount = this.fighters.filter((x) => x.alive).length;
      // Comme la zone, un météore ne peut pas tuer le dernier survivant.
      if (f.hp - dmg <= 0 && aliveCount <= 1) continue;
      f.hp -= dmg;
      this.events.push({ t: 'hit', from: null, to: f.key, dmg, meteor: true });
      if (f.hp <= 0) this.kill(null, f);
    }
  }

  attack(attacker, target) {
    const proj = attacker.projectile || undefined;
    // La précision de l'attaquant réduit l'esquive de la cible.
    if (Math.random() < target.dodge * (1 - attacker.precision)) {
      this.events.push({ t: 'dodge', from: attacker.key, to: target.key, proj });
      return;
    }
    const crit = Math.random() < attacker.crit;
    const raw = attacker.damage * attacker.dmgMult * this.buffMult(attacker, 'damage') * (0.85 + Math.random() * 0.3) * (crit ? Rules.CRIT_MULTIPLIER : 1);
    const tx = target.x;
    const ty = target.y;
    this.hit(attacker, target, raw, { crit, proj });
    // Mage : explosion autour de la cible. Troll : son coup de massue balaie les combattants proches.
    const splash = attacker.aoeRadius
      ? { r: attacker.aoeRadius, ratio: attacker.aoeRatio }
      : attacker.cleave ? { r: attacker.cleave.r, ratio: attacker.cleave.ratio } : null;
    if (splash) {
      this.events.push({ t: 'aoe', from: attacker.key, x: Math.round(tx), y: Math.round(ty), r: splash.r, cleave: attacker.cleave ? true : undefined });
      for (const o of this.fighters) {
        if (!o.alive || o === target || o.team === attacker.team) continue;
        if (Math.hypot(o.x - tx, o.y - ty) <= splash.r) {
          this.hit(attacker, o, raw * splash.ratio, { crit, splash: true });
        }
      }
    }
  }

  // Applique des dégâts (après défense), puis vol de vie et épines.
  hit(attacker, target, raw, opts = {}) {
    if (!target.alive || this.immune(target, attacker)) return;
    const dmg = Math.max(1, Math.round(raw * (1 - target.reduction) * this.buffMult(target, 'taken')));
    target.hp -= dmg;
    attacker.dealt += dmg;
    this.events.push({ t: 'hit', from: attacker.key, to: target.key, dmg, crit: !!opts.crit, proj: opts.proj, splash: opts.splash || undefined, ult: opts.ult || undefined });
    const lifesteal = attacker.lifesteal + this.buffSum(attacker, 'lifesteal');
    if (lifesteal && attacker.alive) this.heal(attacker, dmg * lifesteal);
    if (target.hp <= 0) this.kill(attacker, target);
    else this.checkHpPotion(target);
    // Épines : une partie des dégâts reçus est renvoyée à l'attaquant.
    const reflected = Math.round(dmg * (target.thorns + this.buffSum(target, 'thorns')));
    if (reflected >= 1 && attacker.alive && !this.immune(attacker, target)) {
      attacker.hp -= reflected;
      target.dealt += reflected;
      this.events.push({ t: 'thorns', from: target.key, to: attacker.key, dmg: reflected });
      if (attacker.hp <= 0) this.kill(target, attacker);
    }
  }

  heal(f, amount) {
    if (!f.alive || amount <= 0) return;
    const before = f.hp;
    f.hp = Math.min(f.maxHp, f.hp + amount);
    f.healAcc += f.hp - before;
    if (f.healAcc >= 4) {
      this.events.push({ t: 'heal', to: f.key, amount: Math.round(f.healAcc) });
      f.healAcc = 0;
    }
  }

  kill(killer, victim) {
    if (!victim.alive) return;
    // Plume de phénix : renaît une fois au lieu de tomber.
    const potion = victim.consumable && !victim.potionUsed && Rules.CONSUMABLES[victim.consumable];
    if (potion && potion.trigger === 'death') {
      victim.potionUsed = true;
      victim.hp = Math.max(1, Math.round(victim.maxHp * potion.effect.revive));
      this.events.push({ t: 'potion', to: victim.key, id: victim.consumable });
      return;
    }
    victim.alive = false;
    victim.hp = 0;
    victim.diedAt = this.time;
    if (this.dungeon) victim.diedRoom = this.dungeon.room;
    this.events.push({ t: 'kill', from: killer ? killer.key : null, to: victim.key });
    if (this.koth) {
      victim.respawnAt = this.time + Rules.KOTH.respawn;
      if (killer && killer.team !== victim.team) killer.score += Rules.KOTH.points.kill;
    }
    if (victim === this.boss) this.events.push({ t: 'bossDown', x: Math.round(victim.x), y: Math.round(victim.y) });
    // Flammèche abattue pendant l'envol : le dragon brûle et devra se poser plus tôt.
    if (victim.kind === 'flammeche' && this.boss && this.boss.alive && this.boss.flying && this.boss.stage) {
      const S = Rules.BOSSES.dragon.sprites;
      this.boss.hp = Math.max(1, this.boss.hp - this.boss.maxHp * S.burn);
      if (!this.boss.stage.landing) this.boss.stage.until -= S.shorten;
      this.events.push({ t: 'spriteDown', x: Math.round(victim.x), y: Math.round(victim.y), to: 'boss' });
    }
    if (!killer) return;
    killer.kills += 1;
    // Récompenses de kill et séries : seulement en Battle Royale (les monstres ne rapportent rien en eux-mêmes).
    if (this.mode !== 'br') return;
    this.emit('kill', killer, victim);
    // Séries : premier kill, double / triple kill (enchaînés en moins de STREAK_WINDOW s), massacre.
    if (!this.firstBlood) {
      this.firstBlood = true;
      this.streak(killer, 'firstblood');
    }
    killer.chain = this.time - killer.lastKillAt <= Rules.STREAK_WINDOW ? killer.chain + 1 : 1;
    killer.lastKillAt = this.time;
    if (killer.chain === 2) this.streak(killer, 'double');
    else if (killer.chain === 3) this.streak(killer, 'triple');
    if (killer.kills === Rules.MASSACRE_KILLS) this.streak(killer, 'massacre');
  }

  streak(fighter, kind) {
    this.events.push({ t: 'streak', kind, to: fighter.key });
    this.emit('streak', fighter, kind);
  }

  finish(winner) {
    this.stopLoop();
    this.phase = 'ended';
    const koth = this.mode === 'koth';
    const ranking = [...this.fighters].sort((a, b) => {
      if (a === winner) return -1;
      if (b === winner) return 1;
      if (koth) return Math.floor(b.score) - Math.floor(a.score) || b.kills - a.kills;
      return (b.diedAt || 0) - (a.diedAt || 0);
    });
    const score = (f) => (koth ? { score: Math.floor(f.score) } : {});
    this.result = {
      mode: koth ? 'koth' : 'br',
      winner: winner ? { key: winner.key, name: winner.name, kills: winner.kills, ...score(winner) } : null,
      ranking: ranking.map((f, i) => ({ rank: i + 1, key: f.key, name: f.name, kills: f.kills, ...score(f) })),
      duration: Math.round(this.time),
    };
    if (winner) this.events.push({ t: 'win', to: winner.key });
    this.emit('end', winner, this.fighters);
    this.changed();
  }

  // Fin d'un mode coopératif : tout le monde gagne (ou perd) ensemble.
  finishCoop(victory) {
    this.stopLoop();
    this.phase = 'ended';
    const ranking = [...this.players].sort((a, b) => b.dealt - a.dealt);
    this.result = {
      mode: this.mode,
      victory,
      ranking: ranking.map((f, i) => ({ rank: i + 1, key: f.key, name: f.name, kills: f.kills, dealt: Math.round(f.dealt), alive: f.alive })),
      duration: Math.round(this.time),
    };
    if (this.mode === 'boss') {
      this.result.boss = { id: this.boss.bossId, name: this.boss.name, hp: Math.max(0, Math.round(this.boss.hp)), maxHp: this.boss.maxHp };
      this.result.reward = victory ? { ...Rules.BOSSES[this.boss.bossId].reward } : null;
    } else {
      this.result.room = this.dungeon.room;
      this.result.reward = Rules.dungeonReward(this.dungeon.room, this.dungeon.rewardMult);
      if (this.dungeon.rewardMult !== 1) this.result.rewardMult = Math.round(this.dungeon.rewardMult * 1000) / 1000;
    }
    this.emit('coopEnd', this.result, this.players);
    this.changed();
  }

  frame() {
    const d = this.dungeon;
    // Dans le donjon, les aventuriers tombés dans une salle précédente ne sont plus affichés.
    const shown = d ? this.fighters.filter((f) => f.team !== HEROES || f.alive || f.diedRoom === d.room) : this.fighters;
    const b = this.boss;
    return {
      phase: this.phase,
      mode: this.mode,
      time: Math.round(this.time * 100) / 100,
      arena: ARENA,
      storm: this.phase === 'battle' && this.mode === 'br' ? this.storm() : null,
      event: this.event || null,
      fogs: (this.fogs || []).map((z) => ({ x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r), a: Math.round(z.a * 100) / 100 })),
      meteors: (this.meteors || []).map((m) => ({ x: Math.round(m.x), y: Math.round(m.y), r: m.r, p: Math.round((1 - m.t / METEOR_FALL) * 100) / 100 })),
      boss: b ? {
        key: b.key, id: b.bossId, name: b.name, hp: Math.max(0, Math.round(b.hp)), maxHp: b.maxHp, phase: b.phase, enraged: b.enraged, alive: b.alive,
        flying: b.flying || undefined, away: b.away || undefined, shielded: b.shielded || undefined,
        // Compte à rebours de l'étape en cours (vol, nid), pour la barre du boss
        timer: b.stage && b.stage.until > this.time ? { kind: b.stage.kind, left: Math.round((b.stage.until - this.time) * 10) / 10 } : undefined,
      } : null,
      slams: this.slams.map((s) => ({
        kind: s.kind, x: Math.round(s.x), y: Math.round(s.y), r: s.r, p: Math.round((1 - s.t / s.warn) * 100) / 100, w: s.warn,
        fx: s.fx && Math.round(s.fx), fy: s.fy && Math.round(s.fy),
        a: s.angle !== undefined ? Math.round(s.angle * 1000) / 1000 : undefined, half: s.half,
      })),
      koth: this.koth ? {
        hill: { x: Math.round(this.koth.hill.x), y: Math.round(this.koth.hill.y), r: this.koth.hill.r },
        next: this.koth.next ? { x: Math.round(this.koth.next.x), y: Math.round(this.koth.next.y) } : null,
        moveIn: Math.round((this.koth.moveAt - this.time) * 10) / 10,
        left: Math.max(0, Math.round((Rules.KOTH.duration - this.time) * 10) / 10),
        king: this.koth.king,
      } : null,
      dungeon: d ? {
        room: d.room, stage: d.stage, stageT: Math.round(d.stageT * 100) / 100, enraged: d.enraged,
        poll: d.poll ? { options: this.pollCounts(), left: Math.max(0, Math.round((Rules.DUNGEON_POLL.duration - d.stageT) * 10) / 10) } : null,
        boons: d.boons, monsterMult: d.monsterMult, rewardMult: d.rewardMult,
      } : null,
      zones: (this.zones || []).map((z) => ({
        kind: z.kind, x: Math.round(z.x), y: Math.round(z.y), r: z.r,
        p: z.kind === 'poison' ? Math.round((z.t / z.life) * 100) / 100 : Math.round((1 - z.t / z.warn) * 100) / 100,
      })),
      fighters: shown.map((f) => ({
        key: f.key, name: f.name, title: f.title, cls: f.cls, look: f.look, app: f.app, level: f.level,
        kind: f.kind, elite: f.elite || undefined, clone: f.clone || undefined, r: f.r, scale: f.scale,
        hidden: this.event === 'fog' && f.alive && this.inFog(f),
        x: Math.round(f.x), y: Math.round(f.y),
        hp: Math.max(0, Math.round(f.hp)), maxHp: f.maxHp,
        alive: f.alive, kills: f.kills, target: f.targetKey,
        spec: f.spec || undefined,
        ult: f.ult ? f.ult.id : undefined,
        st: f.ult ? Math.round(f.stamina * 100) / 100 : undefined, // barre de stamina (0 à 1)
        potion: f.consumable && !f.potionUsed ? f.consumable : undefined,
        score: this.koth && f.score !== undefined ? Math.floor(f.score) : undefined, // Roi de la Colline
        respawn: !f.alive && f.respawnAt != null ? Math.max(0, Math.round((f.respawnAt - this.time) * 10) / 10) : undefined,
        protect: f.protectUntil > this.time || undefined,
        fx: fxOf(f, this.time),
      })),
      events: this.events,
    };
  }
}

// Un combattant est-il dans la zone d'une attaque annoncée ? (cercle, ou cône pour le souffle du Dragon)
function inSlam(s, f) {
  const dx = f.x - s.x;
  const dy = f.y - s.y;
  const dist = Math.hypot(dx, dy);
  if (s.kind !== 'cone') return dist <= s.r;
  if (dist > s.r + f.r) return false;
  let diff = Math.abs(Math.atan2(dy, dx) - s.angle);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return dist < f.r * 2 || diff <= s.half;
}

// Combattant avec les valeurs par défaut.
function fighter(fields) {
  return Object.assign({
    title: null, app: null, cls: null, look: {}, level: 1, userId: null,
    x: 0, y: 0, r: RADIUS, scale: 1, elite: false,
    reduction: 0, dodge: 0, crit: 0, lifesteal: 0, precision: 0, thorns: 0,
    range: 40, taunt: 1, kite: 0, hunter: false, regen: 0, projectile: null, aoeRadius: 0, aoeRatio: 0, cleave: false,
    cd: 0, dmgMult: 1, targetKey: null, alive: true, kills: 0, dealt: 0,
    chain: 0, lastKillAt: -Infinity, healAcc: 0, diedAt: null, diedRoom: null,
    spec: null, ult: null, staminaTime: 0, stamina: 0, consumable: null, potionUsed: false, started: false, engaged: false,
    buffs: [], stunUntil: 0,
  }, fields);
}

// Effets visibles d'un combattant (pour l'affichage) : potions, ultimes, gel, invisibilité.
function fxOf(f, time) {
  if (!f.alive) return undefined;
  const fx = f.buffs.filter((b) => !b.boon).map((b) => b.kind); // les bonus de sondage s'affichent dans le bandeau du donjon
  if (time < f.stunUntil) fx.push('frozen');
  if (f.buffs.some((b) => b.invisible)) fx.push('invisible');
  return fx.length ? fx : undefined;
}

// Trajectoire d'une flèche qui part de (x, y) dans la direction (dx, dy) jusqu'au bord, avec `bounces` rebonds.
function rayPath(x, y, dx, dy, bounces, b) {
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const pts = [{ x, y }];
  for (let i = 0; i <= bounces; i++) {
    const tx = dx > 0 ? (b.x1 - x) / dx : dx < 0 ? (b.x0 - x) / dx : Infinity;
    const ty = dy > 0 ? (b.y1 - y) / dy : dy < 0 ? (b.y0 - y) / dy : Infinity;
    const t = Math.min(tx, ty);
    x += dx * t;
    y += dy * t;
    pts.push({ x, y });
    if (tx < ty) dx = -dx; else dy = -dy;
  }
  return pts;
}

// Distance d'un point au segment [a, b].
function distToSegment(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const l2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

// Point où sont regroupés le plus de combattants (cible du rocher du Troll).
function densestSpot(list, radius) {
  let best = list[0];
  let bestCount = -1;
  for (const a of list) {
    const count = list.filter((b) => Math.hypot(a.x - b.x, a.y - b.y) <= radius).length;
    if (count > bestCount) { bestCount = count; best = a; }
  }
  return { x: best.x, y: best.y };
}

function spawnPositions(n, rect = { x0: 60, y0: 60, x1: ARENA.w - 60, y1: ARENA.h - 60 }) {
  const w = rect.x1 - rect.x0;
  const h = rect.y1 - rect.y0;
  const minDist = Math.max(34, Math.min(140, Math.sqrt((w * h) / Math.max(1, n)) * 0.6));
  const out = [];
  for (let i = 0; i < n; i++) {
    let p;
    for (let tries = 0; tries < 60; tries++) {
      p = { x: rect.x0 + Math.random() * w, y: rect.y0 + Math.random() * h };
      if (out.every((o) => Math.hypot(o.x - p.x, o.y - p.y) >= minDist)) break;
    }
    out.push(p);
  }
  return out;
}

module.exports = { Battle, ARENA };
