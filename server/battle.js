/*
 * File d'attente (!join) et simulation du combat, calculée côté serveur
 * puis diffusée en temps réel à l'écran de combat.
 */
const EventEmitter = require('events');
const { CRIT_MULTIPLIER } = require('../shared/rules');

const ARENA = { w: 1280, h: 720 };
const TICK_MS = 50;
const RADIUS = 16;
const ATTACK_RANGE = RADIUS * 2 + 8;
const ATTACK_COOLDOWN = 1.0;
const STORM_START = 45;
const STORM_DURATION = 60;
const STORM_MIN_RADIUS = 70;
const STORM_DPS = 0.05; // fraction de la vie max par seconde
const SHIELD_TAUNT = 0.75; // un porteur de bouclier « paraît » plus proche : il attire l'aggro
const MAX_DURATION = 300;

class Battle extends EventEmitter {
  constructor() {
    super();
    this.phase = 'idle'; // idle | queue | ready | battle | ended
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
        key: p.key, name: p.name, bot: !!p.bot, level: p.level, look: p.look,
      })),
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

  start(refresh) {
    if (this.phase !== 'queue' && this.phase !== 'ready') throw new Error('Aucune file ouverte');
    if (this.participants.size < 2) throw new Error('Il faut au moins 2 combattants');
    clearTimeout(this.queueTimer);
    this.queueEndsAt = null;

    const list = [...this.participants.values()].map((p) => (refresh ? refresh(p) : p));
    const positions = spawnPositions(list.length);
    this.fighters = list.map((p, i) => ({
      key: p.key,
      userId: p.userId || null,
      name: p.name,
      look: p.look,
      level: p.level,
      x: positions[i].x,
      y: positions[i].y,
      hp: p.stats.maxHp,
      maxHp: p.stats.maxHp,
      damage: p.stats.damage,
      reduction: p.stats.reduction,
      speed: p.stats.speed,
      dodge: p.stats.dodge,
      crit: p.stats.crit || 0,
      shield: !!(p.look && p.look.bouclier),
      cd: Math.random() * 0.5,
      targetKey: null,
      alive: true,
      kills: 0,
      diedAt: null,
    }));
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

    for (const f of alive) {
      if (!f.alive) continue;
      // Aggro : l'ennemi le plus proche (les boucliers attirent davantage).
      let best = null;
      let bestScore = Infinity;
      for (const o of alive) {
        if (o === f || !o.alive) continue;
        const score = Math.hypot(o.x - f.x, o.y - f.y) * (o.shield ? SHIELD_TAUNT : 1);
        if (score < bestScore) { bestScore = score; best = o; }
      }
      if (!best) continue;
      f.targetKey = best.key;

      const dx = best.x - f.x;
      const dy = best.y - f.y;
      const dist = Math.hypot(dx, dy) || 1;
      f.cd -= dt;

      if (dist > ATTACK_RANGE) {
        const step = Math.min(f.speed * dt, dist - ATTACK_RANGE + 1);
        f.x += (dx / dist) * step;
        f.y += (dy / dist) * step;
      } else if (f.cd <= 0) {
        f.cd = ATTACK_COOLDOWN;
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

    const remaining = this.fighters.filter((f) => f.alive);
    if (remaining.length <= 1 || this.time > MAX_DURATION) {
      const winner = remaining.length === 1
        ? remaining[0]
        : remaining.sort((a, b) => b.hp / b.maxHp - a.hp / a.maxHp)[0];
      this.finish(winner);
    }

    this.emit('frame', this.frame());
    this.events = [];
  }

  attack(attacker, target) {
    if (Math.random() < target.dodge) {
      this.events.push({ t: 'dodge', from: attacker.key, to: target.key });
      return;
    }
    const crit = Math.random() < attacker.crit;
    const raw = attacker.damage * (0.85 + Math.random() * 0.3) * (crit ? CRIT_MULTIPLIER : 1);
    const dmg = Math.max(1, Math.round(raw * (1 - target.reduction)));
    target.hp -= dmg;
    this.events.push({ t: 'hit', from: attacker.key, to: target.key, dmg, crit });
    if (target.hp <= 0) this.kill(attacker, target);
  }

  kill(killer, victim) {
    victim.alive = false;
    victim.hp = 0;
    victim.diedAt = this.time;
    this.events.push({ t: 'kill', from: killer ? killer.key : null, to: victim.key });
    if (killer) {
      killer.kills += 1;
      this.emit('kill', killer, victim);
    }
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
      fighters: this.fighters.map((f) => ({
        key: f.key, name: f.name, look: f.look, level: f.level,
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
