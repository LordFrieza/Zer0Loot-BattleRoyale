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
    this.event = null; // événement de la bataille en cours (voir Rules.BATTLE_EVENTS)
    this.fogs = [];
    this.meteors = [];
    this.slams = [];
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
      queueEndsAt: this.queueEndsAt,
      participants: [...this.participants.values()].map((p) => ({
        key: p.key, name: p.name, bot: !!p.bot, level: p.level, cls: p.cls || null, look: p.look, app: p.app || null, title: p.title || null,
      })),
      // L'événement n'est révélé qu'au lancement de la bataille.
      event: this.phase === 'battle' || this.phase === 'ended' ? this.event : null,
      result: this.result,
    };
  }

  changed() {
    this.emit('queue', this.publicQueue());
  }

  openQueue(seconds, mode = 'br') {
    if (this.phase === 'battle') throw new Error('Une bataille est en cours');
    if (!Rules.GAME_MODES[mode]) throw new Error('Mode de jeu inconnu');
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
    this.firstBlood = false;
    this.event = event;
    this.fogs = [];
    this.meteors = [];
    this.slams = [];
    this.nextFog = 0;
    this.nextMeteor = 2;
    this.time = 0;
    this.events = [];
    this.result = null;

    if (this.mode === 'br') {
      const positions = spawnPositions(this.players.length);
      this.players.forEach((f, i) => Object.assign(f, positions[i]));
    } else if (this.mode === 'boss') {
      this.setupBoss();
    } else {
      // Écran noir « SALLE 1 », puis les aventuriers entrent par la gauche.
      this.dungeon = { room: 0, stage: 'dark', stageT: Rules.DUNGEON.stages.dark * 0.35, fightStart: 0, enraged: false };
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
      team: this.mode === 'br' ? p.key : HEROES,
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
    });
  }

  // ---------- Combat de Boss ----------

  setupBoss() {
    const B = Rules.BOSS;
    const st = Rules.bossStats(this.players.length);
    const positions = spawnPositions(this.players.length, { x0: 60, y0: 70, x1: 470, y1: ARENA.h - 60 });
    this.players.forEach((f, i) => Object.assign(f, positions[i]));
    this.boss = fighter({
      key: 'boss',
      name: B.name,
      kind: 'troll',
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
      range: 40,
      cleave: true,
      cd: 1,
    });
    this.boss.phase = 0;
    this.boss.enraged = false;
    this.boss.slamEvery = B.slam.every;
    this.boss.slamIn = B.slam.every * 0.7;
    this.boss.nextSpecial = 'slam';
    this.fighters.push(this.boss);
  }

  updateBoss(dt) {
    const b = this.boss;
    const B = Rules.BOSS;
    if (b.alive) {
      // Phases à 66 % et 33 % de vie
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
      // Attaques spéciales : onde de choc autour de lui, puis rocher sur le plus gros groupe.
      b.slamIn -= dt;
      const heroes = this.players.filter((p) => p.alive);
      if (b.slamIn <= 0 && heroes.length) {
        b.slamIn = b.slamEvery;
        if (b.nextSpecial === 'slam') {
          this.slams.push({ kind: 'slam', x: b.x, y: b.y, r: B.slam.radius, t: B.slam.warn });
          b.nextSpecial = 'rock';
        } else {
          const spot = densestSpot(heroes, B.slam.rockRadius);
          this.slams.push({ kind: 'rock', x: spot.x, y: spot.y, r: B.slam.rockRadius, t: B.slam.warn, fx: b.x, fy: b.y - 60 });
          b.nextSpecial = 'slam';
        }
        this.events.push({ t: 'slamWarn' });
      }
    }
    for (const s of this.slams) {
      s.t -= dt;
      if (s.t > 0) continue;
      this.events.push({ t: 'slam', kind: s.kind, x: Math.round(s.x), y: Math.round(s.y), r: s.r });
      if (!b.alive) continue;
      const raw = b.damage * b.dmgMult * B.slam.ratio;
      for (const f of this.players) {
        if (f.alive && Math.hypot(f.x - s.x, f.y - s.y) <= s.r) this.hit(b, f, raw * (0.9 + Math.random() * 0.2), { splash: true });
      }
    }
    this.slams = this.slams.filter((s) => s.t > 0);
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
    const mult = Rules.dungeonMultipliers(d.room);
    const spec = Rules.dungeonRoom(d.room, this.players.length);
    const pos = spawnPositions(spec.length, { x0: 720, y0: DUNGEON_TOP + 40, x1: ARENA.w - 80, y1: ARENA.h - 50 });
    this.monsters = spec.map((s, i) => this.makeMonster(s.type, s.elite, mult, pos[i], i));
    this.fighters = this.players.concat(this.monsters);
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
      if (d.stageT >= S.clear) this.setStage('exit');
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

    for (const f of alive) {
      if (!f.alive) continue;
      // Régénération (Prêtre)
      if (f.regen) this.heal(f, f.maxHp * f.regen * dt);

      /*
       * Aggro : l'ennemi le plus proche ; un Guerrier « paraît » plus proche (il attire l'aggro).
       * L'Assassin, lui, traque l'ennemi qui a le moins de vie (en préférant les plus proches).
       */
      let best = null;
      let bestScore = Infinity;
      let fallback = null;
      let fallbackScore = Infinity;
      for (const o of alive) {
        if (o.team === f.team || !o.alive) continue;
        const d = Math.hypot(o.x - f.x, o.y - f.y);
        const score = f.hunter ? o.hp * (1 + d / 500) : d * o.taunt;
        if (score < fallbackScore) { fallbackScore = score; fallback = o; }
        // Brouillard : un ennemi caché n'est visible que de près.
        if (d > FOG_SEE_RANGE && this.inFog(o)) continue;
        if (score < bestScore) { bestScore = score; best = o; }
      }
      best = best || fallback;
      if (!best) continue;
      f.targetKey = best.key;

      const dx = best.x - f.x;
      const dy = best.y - f.y;
      const dist = Math.hypot(dx, dy) || 1;
      // Distance « bord à bord » : les gros (Troll, chefs) se touchent de plus loin.
      const reach = dist - (best.r + f.r - 2 * RADIUS);
      f.cd -= dt;

      if (reach > f.range) {
        const step = Math.min(f.speed * dt, reach - f.range + 1);
        f.x += (dx / dist) * step;
        f.y += (dy / dist) * step;
      } else if (f.kite && reach < f.kite) {
        // Archer : recule quand l'ennemi est trop près.
        const step = f.speed * 0.8 * dt;
        f.x -= (dx / dist) * step;
        f.y -= (dy / dist) * step;
      }
      if (reach <= f.range && f.cd <= 0) {
        f.cd = f.cooldown;
        this.attack(f, best);
      }
    }

    // Séparation pour éviter que les persos se superposent (les plus gros poussent les petits).
    const living = this.fighters.filter((f) => f.alive);
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

    if (this.mode === 'br') this.checkBrEnd();
    else if (this.mode === 'boss') this.checkBossEnd();
    else this.checkDungeonEnd();
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
    if (!this.boss.alive) this.finishCoop(true);
    else if (!this.players.some((p) => p.alive) || this.time > MAX_DURATION) this.finishCoop(false);
  }

  checkDungeonEnd() {
    if (!this.players.some((p) => p.alive)) this.finishCoop(false);
    else if (!this.monsters.some((m) => m.alive)) {
      this.events.push({ t: 'roomClear', room: this.dungeon.room });
      this.setStage('clear');
    }
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
    const raw = attacker.damage * attacker.dmgMult * (0.85 + Math.random() * 0.3) * (crit ? Rules.CRIT_MULTIPLIER : 1);
    const tx = target.x;
    const ty = target.y;
    this.hit(attacker, target, raw, { crit, proj });
    // Mage : explosion autour de la cible. Troll : son coup de massue balaie les combattants proches.
    const splash = attacker.aoeRadius
      ? { r: attacker.aoeRadius, ratio: attacker.aoeRatio }
      : attacker.cleave ? { r: Rules.BOSS.cleaveRadius, ratio: Rules.BOSS.cleaveRatio } : null;
    if (splash) {
      this.events.push({ t: 'aoe', from: attacker.key, x: Math.round(tx), y: Math.round(ty), r: splash.r, cleave: attacker.cleave || undefined });
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
    if (!target.alive) return;
    const dmg = Math.max(1, Math.round(raw * (1 - target.reduction)));
    target.hp -= dmg;
    attacker.dealt += dmg;
    this.events.push({ t: 'hit', from: attacker.key, to: target.key, dmg, crit: !!opts.crit, proj: opts.proj, splash: opts.splash || undefined });
    if (attacker.lifesteal && attacker.alive) this.heal(attacker, dmg * attacker.lifesteal);
    if (target.hp <= 0) this.kill(attacker, target);
    // Épines : une partie des dégâts reçus est renvoyée à l'attaquant.
    const reflected = Math.round(dmg * target.thorns);
    if (reflected >= 1 && attacker.alive) {
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
    victim.alive = false;
    victim.hp = 0;
    victim.diedAt = this.time;
    if (this.dungeon) victim.diedRoom = this.dungeon.room;
    this.events.push({ t: 'kill', from: killer ? killer.key : null, to: victim.key });
    if (victim === this.boss) this.events.push({ t: 'bossDown', x: Math.round(victim.x), y: Math.round(victim.y) });
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
    const ranking = [...this.fighters].sort((a, b) => {
      if (a === winner) return -1;
      if (b === winner) return 1;
      return (b.diedAt || 0) - (a.diedAt || 0);
    });
    this.result = {
      mode: 'br',
      winner: winner ? { key: winner.key, name: winner.name, kills: winner.kills } : null,
      ranking: ranking.map((f, i) => ({ rank: i + 1, key: f.key, name: f.name, kills: f.kills })),
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
      this.result.boss = { name: this.boss.name, hp: Math.max(0, Math.round(this.boss.hp)), maxHp: this.boss.maxHp };
      this.result.reward = victory ? { ...Rules.BOSS.reward } : null;
    } else {
      this.result.room = this.dungeon.room;
      this.result.reward = Rules.dungeonReward(this.dungeon.room);
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
      boss: b ? { key: b.key, name: b.name, hp: Math.max(0, Math.round(b.hp)), maxHp: b.maxHp, phase: b.phase, enraged: b.enraged, alive: b.alive } : null,
      slams: this.slams.map((s) => ({
        kind: s.kind, x: Math.round(s.x), y: Math.round(s.y), r: s.r, p: Math.round((1 - s.t / Rules.BOSS.slam.warn) * 100) / 100,
        fx: s.fx && Math.round(s.fx), fy: s.fy && Math.round(s.fy),
      })),
      dungeon: d ? { room: d.room, stage: d.stage, stageT: Math.round(d.stageT * 100) / 100, enraged: d.enraged } : null,
      fighters: shown.map((f) => ({
        key: f.key, name: f.name, title: f.title, cls: f.cls, look: f.look, app: f.app, level: f.level,
        kind: f.kind, elite: f.elite || undefined, r: f.r, scale: f.scale,
        hidden: this.event === 'fog' && f.alive && this.inFog(f),
        x: Math.round(f.x), y: Math.round(f.y),
        hp: Math.max(0, Math.round(f.hp)), maxHp: f.maxHp,
        alive: f.alive, kills: f.kills, target: f.targetKey,
      })),
      events: this.events,
    };
  }
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
  }, fields);
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
