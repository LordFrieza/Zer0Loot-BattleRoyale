/*
 * File d'attente (!join) et simulation du combat, calculée côté serveur
 * puis diffusée en temps réel à l'écran de combat.
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

class Battle extends EventEmitter {
  constructor() {
    super();
    this.phase = 'idle'; // idle | queue | ready | battle | ended
    this.event = null; // événement de la bataille en cours (voir Rules.BATTLE_EVENTS)
    this.fogs = [];
    this.meteors = [];
    this.participants = new Map();
    this.queueEndsAt = null;
    this.queueTimer = null;
    this.fighters = [];
    this.events = [];
    this.time = 0;
    this.interval = null;
    this.result = null;
  }

  publicQueue() {
    return {
      phase: this.phase,
      queueEndsAt: this.queueEndsAt,
      participants: [...this.participants.values()].map((p) => ({
        key: p.key, name: p.name, bot: !!p.bot, level: p.level, cls: p.cls || null, look: p.look, title: p.title || null,
      })),
      // L'événement n'est révélé qu'au lancement de la bataille.
      event: this.phase === 'battle' || this.phase === 'ended' ? this.event : null,
      result: this.result,
    };
  }

  changed() {
    this.emit('queue', this.publicQueue());
  }

  openQueue(seconds) {
    if (this.phase === 'battle') throw new Error('Une bataille est en cours');
    this.stopLoop();
    this.emit('cleared'); // la bataille précédente n'aura pas lieu : paris remboursés
    this.participants.clear();
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
    if (this.participants.size < 2) throw new Error('Il faut au moins 2 combattants');
    clearTimeout(this.queueTimer);
    this.queueEndsAt = null;

    const list = [...this.participants.values()].map((p) => (refresh ? refresh(p) : p));
    const positions = spawnPositions(list.length);
    this.fighters = list.map((p, i) => {
      const combat = Rules.classInfo(p.cls).combat;
      const s = p.stats;
      return {
        key: p.key,
        userId: p.userId || null,
        name: p.name,
        title: p.title || null,
        cls: p.cls || null,
        look: p.look,
        level: p.level,
        x: positions[i].x,
        y: positions[i].y,
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
        targetKey: null,
        alive: true,
        kills: 0,
        chain: 0,
        lastKillAt: -Infinity,
        healAcc: 0,
        diedAt: null,
      };
    });
    this.firstBlood = false;
    this.event = event;
    this.fogs = [];
    this.meteors = [];
    this.nextFog = 0;
    this.nextMeteor = 2;
    this.time = 0;
    this.events = [];
    this.result = null;
    this.phase = 'battle';
    this.changed();
    this.emit('start', this.fighters);
    this.interval = setInterval(() => this.tick(TICK_MS / 1000), TICK_MS);
  }

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
    const alive = this.fighters.filter((f) => f.alive);
    const storm = this.storm();

    this.updateEvent(dt, alive);

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
        if (o === f || !o.alive) continue;
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
      f.cd -= dt;

      if (dist > f.range) {
        const step = Math.min(f.speed * dt, dist - f.range + 1);
        f.x += (dx / dist) * step;
        f.y += (dy / dist) * step;
      } else if (f.kite && dist < f.kite) {
        // Archer : recule quand l'ennemi est trop près.
        const step = f.speed * 0.8 * dt;
        f.x -= (dx / dist) * step;
        f.y -= (dy / dist) * step;
      }
      if (dist <= f.range && f.cd <= 0) {
        f.cd = f.cooldown;
        this.attack(f, best);
      }
    }

    // Séparation pour éviter que les persos se superposent.
    const living = this.fighters.filter((f) => f.alive);
    for (let i = 0; i < living.length; i++) {
      for (let j = i + 1; j < living.length; j++) {
        const a = living[i];
        const b = living[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < RADIUS * 2) {
          const push = (RADIUS * 2 - d) / 2;
          a.x -= (dx / d) * push; a.y -= (dy / d) * push;
          b.x += (dx / d) * push; b.y += (dy / d) * push;
        }
      }
    }
    for (const f of living) {
      f.x = Math.max(RADIUS, Math.min(ARENA.w - RADIUS, f.x));
      f.y = Math.max(RADIUS, Math.min(ARENA.h - RADIUS, f.y));
    }

    // Zone (tempête) qui rétrécit pour forcer la fin du combat.
    if (storm.active) {
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

    this.emit('frame', this.frame());
    this.events = [];
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
    const raw = attacker.damage * (0.85 + Math.random() * 0.3) * (crit ? Rules.CRIT_MULTIPLIER : 1);
    const tx = target.x;
    const ty = target.y;
    this.hit(attacker, target, raw, { crit, proj });
    // Mage : explosion autour de la cible.
    if (attacker.aoeRadius) {
      this.events.push({ t: 'aoe', from: attacker.key, x: Math.round(tx), y: Math.round(ty), r: attacker.aoeRadius });
      for (const o of this.fighters) {
        if (!o.alive || o === target || o === attacker) continue;
        if (Math.hypot(o.x - tx, o.y - ty) <= attacker.aoeRadius) {
          this.hit(attacker, o, raw * attacker.aoeRatio, { crit, splash: true });
        }
      }
    }
  }

  // Applique des dégâts (après défense), puis vol de vie et épines.
  hit(attacker, target, raw, opts = {}) {
    if (!target.alive) return;
    const dmg = Math.max(1, Math.round(raw * (1 - target.reduction)));
    target.hp -= dmg;
    this.events.push({ t: 'hit', from: attacker.key, to: target.key, dmg, crit: !!opts.crit, proj: opts.proj, splash: opts.splash || undefined });
    if (attacker.lifesteal && attacker.alive) this.heal(attacker, dmg * attacker.lifesteal);
    if (target.hp <= 0) this.kill(attacker, target);
    // Épines : une partie des dégâts reçus est renvoyée à l'attaquant.
    const reflected = Math.round(dmg * target.thorns);
    if (reflected >= 1 && attacker.alive) {
      attacker.hp -= reflected;
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
    this.events.push({ t: 'kill', from: killer ? killer.key : null, to: victim.key });
    if (killer) {
      killer.kills += 1;
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
      winner: winner ? { key: winner.key, name: winner.name, kills: winner.kills } : null,
      ranking: ranking.map((f, i) => ({ rank: i + 1, key: f.key, name: f.name, kills: f.kills })),
      duration: Math.round(this.time),
    };
    if (winner) this.events.push({ t: 'win', to: winner.key });
    this.emit('end', winner, this.fighters);
    this.changed();
  }

  frame() {
    return {
      phase: this.phase,
      time: Math.round(this.time * 100) / 100,
      arena: ARENA,
      storm: this.phase === 'battle' ? this.storm() : null,
      event: this.event || null,
      fogs: (this.fogs || []).map((z) => ({ x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r), a: Math.round(z.a * 100) / 100 })),
      meteors: (this.meteors || []).map((m) => ({ x: Math.round(m.x), y: Math.round(m.y), r: m.r, p: Math.round((1 - m.t / METEOR_FALL) * 100) / 100 })),
      fighters: this.fighters.map((f) => ({
        key: f.key, name: f.name, title: f.title, cls: f.cls, look: f.look, level: f.level, hidden: this.event === 'fog' && f.alive && this.inFog(f),
        x: Math.round(f.x), y: Math.round(f.y),
        hp: Math.max(0, Math.round(f.hp)), maxHp: f.maxHp,
        alive: f.alive, kills: f.kills, target: f.targetKey,
      })),
      events: this.events,
    };
  }
}

function spawnPositions(n) {
  const margin = 60;
  const minDist = Math.max(40, Math.min(140, Math.sqrt((ARENA.w * ARENA.h) / n) * 0.6));
  const out = [];
  for (let i = 0; i < n; i++) {
    let p;
    for (let tries = 0; tries < 60; tries++) {
      p = {
        x: margin + Math.random() * (ARENA.w - margin * 2),
        y: margin + Math.random() * (ARENA.h - margin * 2),
      };
      if (out.every((o) => Math.hypot(o.x - p.x, o.y - p.y) >= minDist)) break;
    }
    out.push(p);
  }
  return out;
}

module.exports = { Battle, ARENA };
