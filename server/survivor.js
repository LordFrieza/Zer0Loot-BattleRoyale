/*
 * Survivor : un jeu de survie par vagues sur une grande carte, simulé ici (20 pas par seconde).
 *  - Le navigateur envoie la position du joueur (ZQSD) ; le serveur la borne à la vitesse permise (pas de téléportation).
 *  - Ennemis, armes, dégâts, gemmes d'XP, montées de niveau (pause pendant le choix), boss toutes les 5 vagues.
 *  - Les stats du personnage ne comptent pas : base commune + méta-progression du Survivor (émeraudes).
 * Le gestionnaire (en bas) lance / termine les parties et crédite émeraudes, récompense du jour et record.
 */
const crypto = require('crypto');
const Rules = require('../shared/rules');
const db = require('./db');
const game = require('./game');

const SV = Rules.SURVIVOR;
const TICK = 0.05;
const CELL = 90;
const KIND_INDEX = Object.fromEntries(Rules.SURVIVOR_ENEMY_KINDS.map((k, i) => [k, i]));
const SHOT_KINDS = ['bone', 'fire', 'ice', 'orb'];
const PICKUPS = ['chicken', 'magnet', 'chest'];
const VIEW_W = SV.view.w / 2 + 80;
const VIEW_H = SV.view.h / 2 + 80;

const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class SurvivorRun {
  /*
   * o = { meta, weapons (débloquées), passives (débloquées), starter, random }
   */
  constructor(o = {}) {
    this.rand = o.random || Math.random;
    this.meta = o.meta || {};
    this.pool = { weapons: o.weapons || ['epee'], passives: o.passives || [] };
    this.t = 0;
    this.wave = 1;
    this.kills = 0;
    this.bosses = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNext = Rules.survivorXpToNext(1);
    this.passives = {};
    this.weapons = [];
    this.stats = Rules.survivorStats(this.meta, this.passives);
    this.hp = this.stats.maxHp;
    this.rerolls = this.stats.rerolls;
    this.revivals = this.stats.revivals;
    this.bonusEmeralds = 0;
    // Exploration : effet du lieu-dit, autels, éclats d'émeraude, trésor gardé
    const X = Rules.SURVIVOR_EXPLORE;
    this.zone = 'village';
    this.fx = Rules.survivorZoneFx('village');
    this.blessing = null; // { zone, until }
    this.altars = Object.entries(Rules.SURVIVOR_ZONES).filter(([id]) => id !== 'village').map(([id, z]) => ({ zone: id, x: z.x, y: z.y, readyAt: 0, charge: 0 }));
    this.shards = [];
    this.shardT = X.shard.every * 0.5;
    this.treasure = null;
    this.treasureT = X.treasure.first;
    this.found = { shards: 0, altars: 0, treasures: 0 };
    this.p = { x: SV.map.w / 2, y: SV.map.h / 2, fx: 1, fy: 0, slowUntil: 0 };
    this.enemies = [];
    this.gems = [];
    this.pickups = [];
    this.shots = []; // projectiles du joueur
    this.eshots = []; // projectiles ennemis
    this.areas = []; // flaques d'acide, toiles, attaques annoncées
    this.events = [];
    this.pending = null; // choix de montée de niveau en cours (la partie est en pause)
    this.queued = 0;
    this.paused = false;
    this.over = null;
    this.nextId = 1;
    this.spawnAcc = 0;
    this.eliteT = SV.eliteEvery;
    this.boss = null;
    this.addWeapon(o.starter || 'epee');
  }

  // ---------- Joueur ----------
  recompute() {
    const before = this.stats.maxHp;
    this.stats = Rules.survivorStats(this.meta, this.passives);
    if (this.stats.maxHp > before) this.hp += this.stats.maxHp - before;
    for (const w of this.weapons) w.s = Rules.survivorWeaponStats(w.id, w.level);
  }

  speedNow() {
    return this.baseSpeed() * (Rules.survivorWater(this.p.x, this.p.y) ? SV.waterSlow : 1);
  }

  // Vitesse sans l'effet de l'eau (le navigateur applique lui-même le ralentissement de l'eau selon sa position)
  baseSpeed() {
    const inWeb = this.areas.some((a) => a.k === 'web' && dist2(a.x, a.y, this.p.x, this.p.y) < a.r * a.r);
    return this.stats.speed * (1 + (this.fx.speed || 0)) * (inWeb ? 0.55 : 1) * (this.p.slowUntil > this.t ? 0.6 : 1);
  }

  // Position envoyée par le navigateur : bornée à ce que la vitesse permet depuis le dernier message.
  setPos(x, y, fx, fy, elapsed) {
    if (this.over || this.pending || this.paused) return;
    if (![x, y].every(Number.isFinite)) return;
    const max = this.speedNow() * clamp(elapsed, 0, 0.25) * SV.moveSlack + 4; // dans l'eau : ralenti
    let dx = x - this.p.x;
    let dy = y - this.p.y;
    const d = Math.hypot(dx, dy);
    if (d > max) { dx *= max / d; dy *= max / d; }
    this.p.x = clamp(this.p.x + dx, 20, SV.map.w - 20);
    this.p.y = clamp(this.p.y + dy, 20, SV.map.h - 20);
    const fl = Math.hypot(fx, fy);
    if (Number.isFinite(fl) && fl > 0.1) { this.p.fx = fx / fl; this.p.fy = fy / fl; }
  }

  // Coup reçu : esquive (Cape d'ombre), bouclier runique, puis armure. Renvoie vrai si le coup a porté.
  hurt(amount) {
    if (this.stats.dodge && this.rand() < this.stats.dodge) { this.events.push({ k: 'dodge' }); return false; }
    if (this.stats.shield && this.t >= (this.shieldAt || 0)) {
      this.shieldAt = this.t + Math.max(5, 17 - 2 * this.stats.shield);
      this.events.push({ k: 'block' });
      return false;
    }
    const dmg = Math.max(1, Math.round(amount - this.stats.armor));
    this.hp -= dmg;
    this.events.push({ k: 'hurt', v: dmg });
    return true;
  }
  heal(v) {
    this.hp = Math.min(this.stats.maxHp, this.hp + v * this.stats.healMult);
  }

  // ---------- Armes et objets ----------
  addWeapon(id) {
    const w = { id, level: 1, cd: 0.3, side: 1, s: Rules.survivorWeaponStats(id, 1), on: false, until: 0, t0: 0 };
    this.weapons.push(w);
    return w;
  }

  // Les choix d'une montée de niveau : améliorer une arme / un objet, ou en prendre un nouveau.
  options(n) {
    const c = [];
    for (const w of this.weapons) if (w.level < Rules.SURVIVOR_WEAPON_MAX) c.push({ type: 'weapon', id: w.id, level: w.level + 1, weight: 1.2 });
    for (const [id, lv] of Object.entries(this.passives)) if (lv < Rules.SURVIVOR_PASSIVES[id].max) c.push({ type: 'passive', id, level: lv + 1, weight: 1 });
    if (this.weapons.length < SV.maxWeapons) {
      for (const id of this.pool.weapons) if (!this.weapons.some((w) => w.id === id)) c.push({ type: 'weapon', id, level: 1, weight: 0.9 });
    }
    if (Object.keys(this.passives).length < SV.maxPassives) {
      for (const id of this.pool.passives) if (!this.passives[id]) c.push({ type: 'passive', id, level: 1, weight: 0.9 });
    }
    const out = [];
    while (out.length < n && c.length) {
      const total = c.reduce((a, o) => a + o.weight, 0);
      let r = this.rand() * total;
      let i = 0;
      for (; i < c.length - 1; i++) { r -= c[i].weight; if (r < 0) break; }
      const [o] = c.splice(i, 1);
      out.push({ type: o.type, id: o.id, level: o.level });
    }
    if (!out.length) out.push({ type: 'heal' }, { type: 'emerald' });
    return out;
  }

  openChoice() {
    const n = 3 + (this.rand() * 100 < this.stats.luck ? 1 : 0);
    this.choiceSeq = (this.choiceSeq || 0) + 1;
    this.pending = { id: this.choiceSeq, options: this.options(n) };
    this.events.push({ k: 'choice' });
  }

  apply(o) {
    if (o.type === 'weapon') {
      const w = this.weapons.find((x) => x.id === o.id);
      if (w) { w.level = Math.min(Rules.SURVIVOR_WEAPON_MAX, w.level + 1); w.s = Rules.survivorWeaponStats(w.id, w.level); } else this.addWeapon(o.id);
    } else if (o.type === 'passive') {
      this.passives[o.id] = (this.passives[o.id] || 0) + 1;
      this.recompute();
      this.rerolls += Rules.SURVIVOR_PASSIVES[o.id].add.rerolls || 0; // Tome des possibles
    } else if (o.type === 'heal') {
      this.heal(this.stats.maxHp * 0.3);
    } else if (o.type === 'emerald') {
      this.bonusEmeralds += 2;
    }
  }

  choose(i, id) {
    if (!this.pending) throw new Error('Aucun choix en cours');
    if (id != null && Number(id) !== this.pending.id) throw new Error('Ce choix a déjà été fait');
    const o = this.pending.options[Number(i)];
    if (!o) throw new Error('Choix inconnu');
    this.apply(o);
    this.queued = Math.max(0, this.queued - 1);
    this.pending = null;
    if (this.queued > 0) this.openChoice();
    return o;
  }

  reroll() {
    if (!this.pending) throw new Error('Aucun choix en cours');
    if (this.rerolls <= 0) throw new Error('Plus de relance');
    this.rerolls -= 1;
    this.pending = { id: this.pending.id, options: this.options(this.pending.options.length) };
  }

  // Coffre (élite : 1 amélioration, boss : 3) : appliqué tout de suite, montré au joueur.
  openChest(count) {
    const got = [];
    for (let k = 0; k < count; k++) {
      const [o] = this.options(1);
      this.apply(o);
      got.push(o);
    }
    this.events.push({ k: 'chest', items: got });
  }

  // ---------- Ennemis ----------
  spawnEnemy(kind, opts = {}) {
    const E = Rules.SURVIVOR_ENEMIES[kind];
    const W = Rules.survivorWave(this.wave);
    let x;
    let y;
    if (opts.x != null) { x = opts.x; y = opts.y; } else {
      for (let tries = 0; tries < 6; tries++) {
        const a = this.rand() * Math.PI * 2;
        const d = SV.spawnDist[0] + this.rand() * (SV.spawnDist[1] - SV.spawnDist[0]);
        x = this.p.x + Math.cos(a) * d;
        y = this.p.y + Math.sin(a) * d;
        if (x > 30 && y > 30 && x < SV.map.w - 30 && y < SV.map.h - 30) break;
      }
      x = clamp(x, 30, SV.map.w - 30);
      y = clamp(y, 30, SV.map.h - 30);
    }
    const elite = !!opts.elite;
    const spawnZone = Rules.SURVIVOR_ZONES[Rules.survivorZone(x, y)];
    const hp = E.hp * W.hp * (elite ? SV.elite.hp : 1) * (1 + ((spawnZone.fx && spawnZone.fx.enemyHp) || 0));
    const e = {
      id: this.nextId++, kind, x, y, hp, maxHp: hp, r: E.radius * (elite ? SV.elite.scale * 0.8 : 1),
      speed: E.speed * Math.min(1.25, 1 + 0.008 * (this.wave - 1)), damage: E.damage * W.damage * (elite ? SV.elite.damage : 1),
      xp: elite ? SV.elite.xp : E.xp, elite, hitCd: 0, kx: 0, ky: 0, shootCd: E.shoot ? E.shoot.every * (0.5 + this.rand()) : 0,
      phase: this.rand() * 10, hits: {},
    };
    this.enemies.push(e);
    return e;
  }

  pickKind(x, y) {
    const zone = Rules.SURVIVOR_ZONES[Rules.survivorZone(x, y)];
    const kinds = Rules.SURVIVOR_ENEMY_KINDS.filter((k) => Rules.SURVIVOR_ENEMIES[k].from <= this.wave);
    const w = kinds.map((k) => (zone.enemies.includes(k) ? 4 : 1));
    let r = this.rand() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < kinds.length; i++) { r -= w[i]; if (r < 0) return kinds[i]; }
    return kinds[0];
  }

  spawnBoss(spec) {
    const B = Rules.SURVIVOR_BOSSES[spec.kind];
    const a = this.rand() * Math.PI * 2;
    const boss = {
      id: this.nextId++, kind: spec.kind, boss: true, x: clamp(this.p.x + Math.cos(a) * 520, 60, SV.map.w - 60), y: clamp(this.p.y + Math.sin(a) * 520, 60, SV.map.h - 60),
      hp: spec.hp, maxHp: spec.hp, r: B.radius, speed: B.speed, damage: spec.damage, xp: 0, hitCd: 0, kx: 0, ky: 0, special: B.every * 0.7, hits: {}, phase: 0,
    };
    this.enemies.push(boss);
    this.boss = boss;
    this.events.push({ k: 'boss', kind: spec.kind });
  }

  buildGrid() {
    const g = new Map();
    for (const e of this.enemies) {
      if (e.dead) continue;
      const key = Math.floor(e.x / CELL) * 1000 + Math.floor(e.y / CELL);
      let cell = g.get(key);
      if (!cell) { cell = []; g.set(key, cell); }
      cell.push(e);
    }
    this.grid = g;
  }

  // Ennemis vivants dans un cercle (grille spatiale).
  near(x, y, r) {
    const out = [];
    const x0 = Math.floor((x - r - 40) / CELL);
    const x1 = Math.floor((x + r + 40) / CELL);
    const y0 = Math.floor((y - r - 40) / CELL);
    const y1 = Math.floor((y + r + 40) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const cell = this.grid.get(cx * 1000 + cy);
        if (!cell) continue;
        for (const e of cell) if (!e.dead && dist2(e.x, e.y, x, y) <= (r + e.r) * (r + e.r)) out.push(e);
      }
    }
    return out;
  }

  nearest(x, y, exclude) {
    let best = null;
    let bd = Infinity;
    for (const e of this.enemies) {
      if (e.dead || (exclude && exclude.has(e.id))) continue;
      const d = dist2(e.x, e.y, x, y);
      if (d < bd) { bd = d; best = e; }
    }
    return best && bd < 700 * 700 ? best : null;
  }

  // Dégâts infligés par une arme.
  damage(e, base, weapon, kb = 0) {
    if (e.dead) return;
    const S = this.stats;
    const crit = this.rand() < S.crit + (this.fx.crit || 0);
    const dmg = base * S.damage * (1 + (this.fx.damage || 0)) * (crit ? S.critMult : 1) * (e.boss || e.elite ? 1 + S.bossDmg : 1);
    if (S.chill) { e.chill = S.chill; e.chillUntil = this.t + 1; }
    kb *= S.knockback;
    e.hp -= dmg;
    if (this.dmgEvents < 28) { this.events.push({ k: 'd', x: Math.round(e.x), y: Math.round(e.y - e.r), v: Math.round(dmg), c: crit ? 1 : 0 }); this.dmgEvents += 1; }
    if (kb && !e.boss) {
      const d = Math.hypot(e.x - this.p.x, e.y - this.p.y) || 1;
      e.kx += ((e.x - this.p.x) / d) * kb;
      e.ky += ((e.y - this.p.y) / d) * kb;
    }
    if (e.hp <= 0) this.kill(e);
  }

  kill(e) {
    if (e.dead) return;
    e.dead = true;
    if (e.boss) {
      this.bosses += 1;
      this.boss = null;
      this.events.push({ k: 'bossDown', kind: e.kind, x: Math.round(e.x), y: Math.round(e.y) });
      this.pickups.push({ type: 'chest', x: e.x, y: e.y, count: 3 });
      for (let i = 0; i < 8; i++) this.dropGem(e.x + (this.rand() - 0.5) * 120, e.y + (this.rand() - 0.5) * 120, 25);
      return;
    }
    this.kills += 1;
    if (this.stats.lifeKill && this.hp > 0) this.heal(this.stats.lifeKill);
    if (this.deathEvents < 40) { this.events.push({ k: 'x', x: Math.round(e.x), y: Math.round(e.y), i: KIND_INDEX[e.kind] }); this.deathEvents += 1; }
    this.dropGem(e.x, e.y, e.xp * (1 + (this.fx.gems || 0)));
    if (e.elite) this.pickups.push({ type: 'chest', x: e.x, y: e.y, count: 1 });
    else if (this.rand() < SV.drops.chicken) this.pickups.push({ type: 'chicken', x: e.x, y: e.y });
    else if (this.rand() < SV.drops.magnet) this.pickups.push({ type: 'magnet', x: e.x, y: e.y });
  }

  dropGem(x, y, v) {
    if (this.gems.length >= SV.maxGems) {
      // Trop de gemmes au sol : elles fusionnent en une grosse gemme
      const g = this.gems[Math.floor(this.rand() * this.gems.length)];
      g.v += v;
      return;
    }
    this.gems.push({ x, y, v, pull: false });
  }

  // ---------- Pas de simulation ----------
  tick(dt = TICK) {
    if (this.over || this.pending || this.paused) return;
    this.t += dt;
    this.dmgEvents = 0;
    this.deathEvents = 0;
    const S = this.stats;
    const P = this.p;
    // Vagues et boss
    const wave = 1 + Math.floor(this.t / SV.waveSeconds);
    if (wave > this.wave) {
      this.wave = wave;
      this.events.push({ k: 'wave', n: wave });
      const b = Rules.survivorBoss(wave);
      if (b) this.spawnBoss(b);
    }
    // Lieu-dit et bénédiction d'autel
    const zone = Rules.survivorZone(P.x, P.y);
    if (zone !== this.zone) this.zone = zone;
    if (this.blessing && this.t >= this.blessing.until) { this.blessing = null; this.events.push({ k: 'blessEnd' }); }
    this.fx = Rules.survivorZoneFx(zone, this.blessing && this.blessing.zone);
    const regen = S.regen + (this.fx.regen || 0);
    if (regen > 0 && this.hp > 0) this.heal(regen * dt);
    if (this.fx.burn && this.hp > 1) this.hp = Math.max(1, this.hp - this.fx.burn * dt); // la Fournaise brûle, sans jamais achever
    this.updateExplore(dt);
    // Apparitions
    const W = Rules.survivorWave(this.wave);
    this.spawnAcc += W.spawnPerSec * (this.boss ? 0.6 : 1) * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      if (this.enemies.length < W.target) {
        const a = this.rand() * Math.PI * 2;
        this.spawnEnemy(this.pickKind(P.x + Math.cos(a) * 800, P.y + Math.sin(a) * 800));
      }
    }
    this.eliteT -= dt;
    if (this.eliteT <= 0) { this.eliteT = SV.eliteEvery; this.spawnEnemy(this.pickKind(P.x, P.y), { elite: true }); }
    this.buildGrid();
    this.updateEnemies(dt);
    if (this.boss) this.updateBoss(dt);
    this.fireWeapons(dt);
    this.updateShots(dt);
    this.updateAreas(dt);
    this.updateEnemyShots(dt);
    this.updatePickups(dt);
    this.enemies = this.enemies.filter((e) => !e.dead);
    // Montées de niveau
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level += 1;
      this.xpNext = Rules.survivorXpToNext(this.level);
      this.queued += 1;
      this.events.push({ k: 'lvl', n: this.level });
    }
    if (this.queued > 0 && !this.pending) this.openChoice();
    // Mort (ou seconde vie)
    if (this.hp <= 0) {
      if (this.revivals > 0) {
        this.revivals -= 1;
        this.hp = S.maxHp * 0.5;
        for (const e of this.near(P.x, P.y, 280)) if (!e.boss) this.kill(e);
        this.events.push({ k: 'revive' });
      } else {
        this.hp = 0;
        this.finish();
      }
    }
  }

  updateEnemies(dt) {
    const P = this.p;
    for (const e of this.enemies) {
      if (e.dead) continue;
      let dx = P.x - e.x;
      let dy = P.y - e.y;
      let d = Math.hypot(dx, dy) || 1;
      // Gardien de trésor : reste à son poste tant que le joueur est loin
      if (e.guard && d > Rules.SURVIVOR_EXPLORE.treasure.aggro) {
        dx = e.guard.x - e.x;
        dy = e.guard.y - e.y;
        d = Math.hypot(dx, dy) || 1;
        if (d < 8) continue;
      }
      const sp = e.speed * (1 - (this.fx.slow || 0)) * (e.chillUntil > this.t ? 1 - e.chill : 1) * (!e.boss && Rules.survivorWater(e.x, e.y) ? SV.waterSlow : 1);
      let vx = (dx / d) * sp;
      let vy = (dy / d) * sp;
      if (Rules.SURVIVOR_ENEMIES[e.kind] && Rules.SURVIVOR_ENEMIES[e.kind].erratic) {
        e.phase += dt * 4;
        vx += Math.cos(e.phase) * 60;
        vy += Math.sin(e.phase * 1.3) * 60;
      }
      // Le squelette garde ses distances et tire
      const E = Rules.SURVIVOR_ENEMIES[e.kind];
      if (E && E.shoot) {
        if (d < 260) { vx *= -0.4; vy *= -0.4; }
        e.shootCd -= dt;
        if (e.shootCd <= 0 && d < 520) {
          e.shootCd = E.shoot.every;
          this.eshots.push({ x: e.x, y: e.y, vx: (dx / d) * E.shoot.speed, vy: (dy / d) * E.shoot.speed, r: 8, damage: E.shoot.damage * Rules.survivorWave(this.wave).damage, life: 3, kind: 'bone' });
        }
      }
      e.x += (vx + e.kx) * dt;
      e.y += (vy + e.ky) * dt;
      e.kx *= 0.82;
      e.ky *= 0.82;
      // Séparation (pas d'empilement)
      if (!e.boss) {
        let checks = 0;
        for (const o of this.near(e.x, e.y, e.r)) {
          if (o === e || o.boss) continue;
          const ox = e.x - o.x;
          const oy = e.y - o.y;
          const od = Math.hypot(ox, oy) || 0.01;
          const overlap = e.r + o.r - od;
          if (overlap > 0) { e.x += (ox / od) * overlap * 0.35; e.y += (oy / od) * overlap * 0.35; }
          if (++checks > 6) break;
        }
      }
      // Contact avec le joueur
      e.hitCd -= dt;
      if (e.hitCd <= 0 && dist2(e.x, e.y, P.x, P.y) < (e.r + SV.player.radius) * (e.r + SV.player.radius)) {
        e.hitCd = SV.hitCooldown;
        this.hurt(e.damage);
        if (this.stats.thorns) this.damage(e, this.stats.thorns, null, 0); // Armure d'épines
      }
      // Trop loin derrière (le joueur a filé) : il réapparaît devant
      if (!e.boss && !e.guard && d > 1400) {
        const a = this.rand() * Math.PI * 2;
        e.x = clamp(P.x + Math.cos(a) * SV.spawnDist[0], 30, SV.map.w - 30);
        e.y = clamp(P.y + Math.sin(a) * SV.spawnDist[0], 30, SV.map.h - 30);
      }
    }
  }

  // Attaques spéciales des boss (annoncées au sol quand elles frappent une zone).
  updateBoss(dt) {
    const b = this.boss;
    const P = this.p;
    b.special -= dt;
    if (b.special > 0) return;
    const B = Rules.SURVIVOR_BOSSES[b.kind];
    b.special = B.every;
    const toward = (spd, spread = 0) => {
      const a = Math.atan2(P.y - b.y, P.x - b.x) + spread;
      return { vx: Math.cos(a) * spd, vy: Math.sin(a) * spd };
    };
    switch (b.kind) {
      case 'troll':
        this.areas.push({ id: this.nextId++, k: 'warn', x: P.x, y: P.y, r: 150, at: this.t + 1, until: this.t + 1, act: 'slam', damage: b.damage * 1.3 });
        break;
      case 'mimic':
        this.areas.push({ id: this.nextId++, k: 'warn', x: P.x, y: P.y, r: 115, at: this.t + 0.9, until: this.t + 0.9, act: 'leap', damage: b.damage * 1.2 });
        break;
      case 'maexxna':
        for (let i = 0; i < 3; i++) {
          const a = this.rand() * Math.PI * 2;
          this.areas.push({ id: this.nextId++, k: 'web', x: P.x + Math.cos(a) * 90 * i, y: P.y + Math.sin(a) * 90 * i, r: 95, until: this.t + 6 });
        }
        for (let i = 0; i < 4; i++) this.spawnEnemy('araignee', { x: b.x + (this.rand() - 0.5) * 120, y: b.y + (this.rand() - 0.5) * 120 });
        break;
      case 'dragon':
        for (let i = -2; i <= 2; i++) this.eshots.push({ x: b.x, y: b.y, ...toward(270, i * 0.18), r: 14, damage: b.damage * 0.8, life: 4, kind: 'fire' });
        break;
      case 'liche':
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2 + this.t;
          this.eshots.push({ x: b.x, y: b.y, vx: Math.cos(a) * 210, vy: Math.sin(a) * 210, r: 10, damage: b.damage * 0.6, life: 4, kind: 'ice', slow: 2 });
        }
        break;
      case 'sorcier': {
        const a = this.rand() * Math.PI * 2;
        b.x = clamp(P.x + Math.cos(a) * 320, 60, SV.map.w - 60);
        b.y = clamp(P.y + Math.sin(a) * 320, 60, SV.map.h - 60);
        this.events.push({ k: 'blink', x: Math.round(b.x), y: Math.round(b.y) });
        for (let i = -1; i <= 1; i++) this.eshots.push({ x: b.x, y: b.y, ...toward(170, i * 0.5), r: 12, damage: b.damage * 0.7, life: 4.5, kind: 'orb', homing: true });
        break;
      }
      default:
    }
  }

  fireWeapons(dt) {
    const P = this.p;
    const S = this.stats;
    for (const w of this.weapons) {
      const s = w.s;
      const area = (s.area || 1) * S.area * (1 + (this.fx.area || 0));
      const amount = (s.amount || 1) + S.amount;
      const life = s.duration * S.duration; // Sablier
      const spd = s.speed * S.shotSpeed; // Plume du vent
      // Orbes : actives un moment, puis en recharge
      if (w.id === 'orbes') {
        if (w.on) {
          const n = amount;
          const r = s.range * area;
          for (let i = 0; i < n; i++) {
            const a = (this.t - w.t0) * s.speed + (i / n) * Math.PI * 2;
            const ox = P.x + Math.cos(a) * r;
            const oy = P.y + Math.sin(a) * r;
            for (const e of this.near(ox, oy, 14 * area)) {
              if ((e.hits.orbes || 0) > this.t) continue;
              e.hits.orbes = this.t + 0.45;
              this.damage(e, s.damage, w, 90);
            }
          }
          if (this.t >= w.until) { w.on = false; w.cd = s.cooldown * S.cooldown; }
          continue;
        }
      }
      w.cd -= dt;
      if (w.cd > 0) continue;
      w.cd = s.cooldown * S.cooldown;
      switch (w.id) {
        case 'epee': {
          const len = s.range * area;
          const half = (s.width * area) / 2;
          const sides = amount >= 2 ? [1, -1] : [P.fx >= 0 ? 1 : -1];
          for (const side of sides) {
            const cx = P.x + side * len / 2;
            this.events.push({ k: 'slash', side, x: Math.round(P.x), y: Math.round(P.y), len: Math.round(len), h: Math.round(half * 2) });
            for (const e of this.near(cx, P.y, Math.max(len / 2, half) + 10)) {
              if (Math.abs(e.y - P.y) <= half + e.r && (e.x - P.x) * side >= -e.r && Math.abs(e.x - P.x) <= len + e.r) this.damage(e, s.damage, w, 160);
            }
          }
          break;
        }
        case 'dagues': {
          const base = Math.atan2(P.fy, P.fx);
          for (let i = 0; i < amount; i++) {
            const a = base + (i - (amount - 1) / 2) * 0.09;
            this.addShot(w, { x: P.x, y: P.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life, r: 9, pierce: s.pierce, damage: s.damage, kb: 60 });
          }
          break;
        }
        case 'baguette': {
          const used = new Set();
          for (let i = 0; i < amount; i++) {
            const target = this.nearest(P.x, P.y, used) || this.nearest(P.x, P.y);
            if (!target) break;
            used.add(target.id);
            const a = Math.atan2(target.y - P.y, target.x - P.x) + (i - (amount - 1) / 2) * 0.15;
            this.addShot(w, { x: P.x, y: P.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life, r: 10, pierce: s.pierce, damage: s.damage, target: target.id, homing: true, kb: 50 });
          }
          break;
        }
        case 'aura':
          for (const e of this.near(P.x, P.y, s.range * area)) this.damage(e, s.damage, w, 40);
          break;
        case 'hache':
          for (let i = 0; i < amount; i++) {
            const vx = (this.rand() - 0.5) * 300 + P.fx * 90;
            this.addShot(w, { x: P.x, y: P.y, vx: vx * S.shotSpeed, vy: -spd * (0.85 + this.rand() * 0.3), g: 900 * S.shotSpeed * S.shotSpeed, life, r: 18 * area, pierce: 99, damage: s.damage, kb: 90 });
          }
          break;
        case 'foudre': {
          const pool = this.enemies.filter((e) => !e.dead && dist2(e.x, e.y, P.x, P.y) < 620 * 620);
          for (let i = 0; i < amount && pool.length; i++) {
            const [e] = pool.splice(Math.floor(this.rand() * pool.length), 1);
            const r = s.range * area;
            this.events.push({ k: 'zap', x: Math.round(e.x), y: Math.round(e.y), r: Math.round(r) });
            for (const o of this.near(e.x, e.y, r)) this.damage(o, s.damage, w, 70);
          }
          break;
        }
        case 'orbes':
          w.on = true;
          w.t0 = this.t;
          w.until = this.t + life;
          break;
        case 'fiole': {
          const pool = this.enemies.filter((e) => !e.dead && dist2(e.x, e.y, P.x, P.y) < 480 * 480);
          for (let i = 0; i < amount; i++) {
            const e = pool.length ? pool[Math.floor(this.rand() * pool.length)] : null;
            const a = this.rand() * Math.PI * 2;
            const x = e ? e.x : P.x + Math.cos(a) * 160;
            const y = e ? e.y : P.y + Math.sin(a) * 160;
            this.areas.push({ id: this.nextId++, k: 'acid', x, y, r: s.range * area, until: this.t + life, damage: s.damage, tickAt: 0 });
          }
          break;
        }
        default:
      }
    }
  }

  addShot(w, o) {
    const shot = { id: this.nextId++, w: w.id, hit: new Set(), ...o };
    this.shots.push(shot);
    if (!shot.homing) this.events.push({ k: 'p', id: shot.id, w: w.id, x: Math.round(o.x), y: Math.round(o.y), vx: Math.round(o.vx), vy: Math.round(o.vy), g: o.g || 0, life: o.life });
  }

  updateShots(dt) {
    for (const s of this.shots) {
      if (s.homing && s.target) {
        const t = this.enemies.find((e) => e.id === s.target && !e.dead);
        if (t) {
          const a = Math.atan2(t.y - s.y, t.x - s.x);
          const sp = Math.hypot(s.vx, s.vy);
          const cur = Math.atan2(s.vy, s.vx);
          let diff = a - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const turn = clamp(diff, -6 * dt, 6 * dt);
          s.vx = Math.cos(cur + turn) * sp;
          s.vy = Math.sin(cur + turn) * sp;
        }
      }
      if (s.g) s.vy += s.g * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      for (const e of this.near(s.x, s.y, s.r)) {
        if (s.hit.has(e.id)) continue;
        s.hit.add(e.id);
        this.damage(e, s.damage, null, s.kb);
        s.pierce -= 1;
        if (s.pierce <= 0) break;
      }
      if (s.pierce <= 0 || s.life <= 0) {
        s.dead = true;
        if (!s.homing && s.life > 0) this.events.push({ k: 'rm', id: s.id });
      }
    }
    this.shots = this.shots.filter((s) => !s.dead);
  }

  updateAreas() {
    const P = this.p;
    for (const a of this.areas) {
      if (a.k === 'acid' && this.t >= a.tickAt) {
        a.tickAt = this.t + 0.4;
        for (const e of this.near(a.x, a.y, a.r)) this.damage(e, a.damage, null, 0);
      }
      if (a.k === 'warn' && this.t >= a.at) {
        const inside = dist2(a.x, a.y, P.x, P.y) < a.r * a.r;
        if (inside) this.hurt(a.damage);
        if (a.act === 'leap' && this.boss) { this.boss.x = a.x; this.boss.y = a.y; }
        this.events.push({ k: 'boom', x: Math.round(a.x), y: Math.round(a.y), r: a.r, act: a.act });
        a.done = true;
      }
    }
    this.areas = this.areas.filter((a) => !a.done && this.t < a.until + (a.k === 'warn' ? 0.01 : 0));
  }

  updateEnemyShots(dt) {
    const P = this.p;
    for (const s of this.eshots) {
      if (s.homing) {
        const a = Math.atan2(P.y - s.y, P.x - s.x);
        const sp = Math.hypot(s.vx, s.vy);
        const cur = Math.atan2(s.vy, s.vx);
        let diff = a - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turn = clamp(diff, -1.6 * dt, 1.6 * dt);
        s.vx = Math.cos(cur + turn) * sp;
        s.vy = Math.sin(cur + turn) * sp;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (dist2(s.x, s.y, P.x, P.y) < (s.r + SV.player.radius) * (s.r + SV.player.radius)) {
        if (this.hurt(s.damage) && s.slow) P.slowUntil = this.t + s.slow;
        s.life = 0;
      }
    }
    this.eshots = this.eshots.filter((s) => s.life > 0);
  }

  updatePickups(dt) {
    const P = this.p;
    const mag = this.stats.magnet * (1 + (this.fx.magnet || 0));
    for (const g of this.gems) {
      const d2 = dist2(g.x, g.y, P.x, P.y);
      if (!g.pull && d2 < mag * mag) g.pull = true;
      if (g.pull) {
        const d = Math.sqrt(d2) || 1;
        g.sp = (g.sp || 260) + 900 * dt;
        const step = Math.min(d, g.sp * dt);
        g.x += ((P.x - g.x) / d) * step;
        g.y += ((P.y - g.y) / d) * step;
        if (d < SV.player.radius + 10) { this.xp += g.v * this.stats.xp * Math.max(0.1, 1 + (this.fx.xp || 0)); g.got = true; }
      }
    }
    this.gems = this.gems.filter((g) => !g.got);
    for (const k of this.pickups) {
      if (dist2(k.x, k.y, P.x, P.y) > 30 * 30) continue;
      k.got = true;
      if (k.type === 'chicken') { this.heal(this.stats.maxHp * 0.3); this.events.push({ k: 'heal' }); }
      if (k.type === 'magnet') { for (const g of this.gems) g.pull = true; this.events.push({ k: 'magnet' }); }
      if (k.type === 'chest') this.openChest(k.count);
    }
    this.pickups = this.pickups.filter((k) => !k.got);
  }

  // ---------- Exploration ----------
  updateExplore(dt) {
    const X = Rules.SURVIVOR_EXPLORE;
    const P = this.p;
    // Autels : rester 2 s dessus donne la bénédiction de son lieu-dit (40 s), puis 150 s de recharge
    for (const a of this.altars) {
      const on = dist2(a.x, a.y, P.x, P.y) < X.altar.radius * X.altar.radius && this.t >= a.readyAt;
      a.charge = on ? a.charge + dt / X.altar.charge : 0;
      if (a.charge >= 1) {
        a.charge = 0;
        a.readyAt = this.t + X.altar.cooldown * (1 - 0.15 * this.stats.explore);
        this.blessing = { zone: a.zone, until: this.t + X.altar.duration * (1 + 0.25 * this.stats.explore) };
        this.heal(this.stats.maxHp * X.altar.heal);
        this.found.altars += 1;
        this.events.push({ k: 'bless', zone: a.zone });
      }
    }
    // Éclats d'émeraude : loin du joueur, jamais au village
    this.shardT -= dt;
    if (this.shardT <= 0) {
      this.shardT = X.shard.every;
      if (this.shards.length < X.shard.max) {
        for (let tries = 0; tries < 10; tries++) {
          const a = this.rand() * Math.PI * 2;
          const d = X.shard.dist[0] + this.rand() * (X.shard.dist[1] - X.shard.dist[0]);
          const x = clamp(P.x + Math.cos(a) * d, 80, SV.map.w - 80);
          const y = clamp(P.y + Math.sin(a) * d, 80, SV.map.h - 80);
          if (Rules.survivorZone(x, y) === 'village' || Rules.survivorWater(x, y)) continue;
          this.shards.push({ id: this.nextId++, x, y });
          this.events.push({ k: 'shardSpawn' });
          break;
        }
      }
    }
    for (const s of this.shards) {
      if (dist2(s.x, s.y, P.x, P.y) < X.shard.radius * X.shard.radius) {
        s.got = true;
        this.bonusEmeralds += X.shard.emeralds;
        this.found.shards += 1;
        this.events.push({ k: 'shard', x: Math.round(s.x), y: Math.round(s.y) });
      }
    }
    this.shards = this.shards.filter((s) => !s.got);
    // Trésor gardé dans un lieu-dit au hasard (hors village)
    this.treasureT -= dt;
    if (!this.treasure && this.treasureT <= 0) {
      this.treasureT = X.treasure.every;
      const zones = Object.keys(Rules.SURVIVOR_ZONES).filter((z) => z !== 'village' && z !== Rules.survivorZone(P.x, P.y));
      const zone = zones[Math.floor(this.rand() * zones.length)];
      const Z = Rules.SURVIVOR_ZONES[zone];
      let x;
      let y;
      for (let tries = 0; tries < 12; tries++) {
        const a = this.rand() * Math.PI * 2;
        x = clamp(Z.x + Math.cos(a) * 260 * SV.mapScale, 80, SV.map.w - 80);
        y = clamp(Z.y + Math.sin(a) * 260 * SV.mapScale, 80, SV.map.h - 80);
        if (!Rules.survivorWater(x, y)) break;
      }
      this.treasure = { x, y, zone };
      // Ses gardiens : une élite et une petite troupe du lieu-dit
      const guard = (e) => { e.guard = { x: e.x, y: e.y }; };
      // Monstres du moment, de préférence ceux du lieu-dit
      guard(this.spawnEnemy(this.pickKind(x, y), { x: x + 50, y, elite: true }));
      for (let i = 0; i < X.treasure.guards; i++) {
        const b = (i / X.treasure.guards) * Math.PI * 2;
        guard(this.spawnEnemy(this.pickKind(x, y), { x: x + Math.cos(b) * 90, y: y + Math.sin(b) * 90 }));
      }
      this.events.push({ k: 'treasure', zone });
    }
    if (this.treasure && dist2(this.treasure.x, this.treasure.y, P.x, P.y) < X.treasure.radius * X.treasure.radius) {
      const tz = this.treasure.zone;
      this.treasure = null;
      for (const e of this.enemies) e.guard = null; // les gardiens survivants se lancent à sa poursuite
      this.bonusEmeralds += X.treasure.emeralds;
      this.found.treasures += 1;
      this.events.push({ k: 'treasureOpen', zone: tz, emeralds: X.treasure.emeralds });
      this.openChest(X.treasure.upgrades);
    }
  }

  finish() {
    if (this.over) return this.over;
    const r = { time: Math.round(this.t * 10) / 10, wave: this.wave, kills: this.kills, bosses: this.bosses, level: this.level };
    r.score = Rules.survivorScore(r);
    r.weapons = this.weapons.map((w) => [w.id, w.level]);
    r.passives = Object.entries(this.passives);
    r.bonusEmeralds = this.bonusEmeralds;
    r.found = { ...this.found };
    this.over = r;
    this.events.push({ k: 'over' });
    return r;
  }

  // Ce que le joueur voit : tout ce qui est autour de lui, plus le boss.
  frame() {
    const P = this.p;
    const inView = (x, y) => Math.abs(x - P.x) < VIEW_W && Math.abs(y - P.y) < VIEW_H;
    const e = [];
    for (const m of this.enemies) {
      if (m.boss || m.dead || !inView(m.x, m.y)) continue;
      e.push(m.id, KIND_INDEX[m.kind], Math.round(m.x), Math.round(m.y), Math.round((m.hp / m.maxHp) * 100), m.elite ? 1 : 0);
    }
    const g = [];
    for (const gem of this.gems) if (inView(gem.x, gem.y)) g.push(Math.round(gem.x), Math.round(gem.y), gem.v >= 25 ? 2 : gem.v >= 5 ? 1 : 0);
    const pk = [];
    for (const k of this.pickups) if (inView(k.x, k.y)) pk.push(Math.round(k.x), Math.round(k.y), PICKUPS.indexOf(k.type));
    const es = [];
    // Projectiles suivis par le navigateur : identifiant et vitesse, pour qu'il les fasse avancer en douceur entre deux images
    for (const s of this.eshots) {
      if (!inView(s.x, s.y)) continue;
      if (!s.id) s.id = this.nextId++;
      es.push(s.id, Math.round(s.x), Math.round(s.y), SHOT_KINDS.indexOf(s.kind), Math.round(s.vx), Math.round(s.vy));
    }
    const bo = [];
    for (const s of this.shots) if (s.homing && inView(s.x, s.y)) bo.push(s.id, Math.round(s.x), Math.round(s.y), Math.round(s.vx), Math.round(s.vy));
    const ar = this.areas.filter((a) => inView(a.x, a.y)).map((a) => ({ k: a.k, x: Math.round(a.x), y: Math.round(a.y), r: Math.round(a.r), left: Math.round(((a.k === 'warn' ? a.at : a.until) - this.t) * 100) / 100 }));
    const orb = this.weapons.find((w) => w.id === 'orbes' && w.on);
    const aura = this.weapons.find((w) => w.id === 'aura');
    const b = this.boss;
    const events = this.events;
    this.events = [];
    return {
      t: Math.round(this.t * 100) / 100,
      wave: this.wave,
      waveLeft: Math.round((SV.waveSeconds - (this.t % SV.waveSeconds)) * 10) / 10,
      kills: this.kills,
      bosses: this.bosses,
      level: this.level,
      xp: Math.floor(this.xp),
      xpNext: this.xpNext,
      hp: Math.ceil(this.hp),
      maxHp: Math.round(this.stats.maxHp),
      spd: Math.round(this.baseSpeed()),
      magnet: Math.round(this.stats.magnet),
      x: Math.round(P.x),
      y: Math.round(P.y),
      e, g, pk, es, bo, ar,
      b: b ? { kind: b.kind, x: Math.round(b.x), y: Math.round(b.y), hp: Math.max(0, Math.round(b.hp)), maxHp: Math.round(b.maxHp) } : null,
      orb: orb ? { n: (orb.s.amount || 1) + this.stats.amount, r: Math.round(orb.s.range * (orb.s.area || 1) * this.stats.area), spd: orb.s.speed, t0: orb.t0, size: Math.round(14 * (orb.s.area || 1) * this.stats.area) } : null,
      aura: aura ? Math.round(aura.s.range * (aura.s.area || 1) * this.stats.area) : 0,
      weapons: this.weapons.map((w) => [w.id, w.level]),
      passives: Object.entries(this.passives),
      rerolls: this.rerolls,
      revivals: this.revivals,
      zone: this.zone,
      bless: this.blessing ? { zone: this.blessing.zone, left: Math.round((this.blessing.until - this.t) * 10) / 10 } : null,
      alt: this.altars.map((a) => [Math.max(0, Math.round(a.readyAt - this.t)), Math.round(a.charge * 100)]),
      sh: this.shards.flatMap((s) => [Math.round(s.x), Math.round(s.y)]),
      tr: this.treasure ? { x: Math.round(this.treasure.x), y: Math.round(this.treasure.y), zone: this.treasure.zone } : null,
      em: this.bonusEmeralds,
      paused: this.paused,
      pend: this.pending,
      ev: events,
      over: this.over,
    };
  }
}

// ---------- Gestionnaire des parties ----------

const runs = new Map(); // id du joueur → { run, user, lastPos, seen, pausedAt }

function svOf(c) {
  game.upgrade(c);
  return c.survivor;
}

function unlockedWeapons(c) {
  const S = svOf(c);
  return Object.keys(Rules.SURVIVOR_WEAPONS).filter((id) => Rules.SURVIVOR_UNLOCKS.weapons[id].price === 0 || S.unlocks.includes(id));
}
function unlockedPassives(c) {
  const S = svOf(c);
  return Object.keys(Rules.SURVIVOR_PASSIVES).filter((id) => Rules.SURVIVOR_UNLOCKS.passives[id] === 0 || S.unlocks.includes(id));
}
function starters(c) {
  const S = svOf(c);
  return unlockedWeapons(c).filter((id) => Rules.SURVIVOR_UNLOCKS.weapons[id].starter === 0 || S.starters.includes(id));
}

function start(user, starter) {
  const c = user.character;
  const S = svOf(c);
  if (runs.has(user.id)) throw new Error('Une partie est déjà en cours');
  const weapon = starter || S.starter || 'epee';
  if (!starters(c).includes(weapon)) throw new Error('Cette arme de départ n\'est pas débloquée');
  if (c.gold < SV.price) throw new Error(`Une partie de Survivor coûte ${SV.price} golds`);
  c.gold -= SV.price;
  S.starter = weapon;
  c.survivorActive = { at: Date.now(), price: SV.price };
  const run = new SurvivorRun({ meta: S.meta, weapons: unlockedWeapons(c), passives: unlockedPassives(c), starter: weapon });
  runs.set(user.id, { run, user, lastPos: Date.now(), seen: Date.now(), pausedAt: 0 });
  return run;
}

function current(userId) {
  const r = runs.get(userId);
  if (!r) throw new Error('Aucune partie de Survivor en cours');
  return r;
}

function input(userId, msg) {
  const r = runs.get(userId);
  if (!r || !msg) return;
  const now = Date.now();
  r.run.setPos(Number(msg.x), Number(msg.y), Number(msg.fx), Number(msg.fy), (now - r.lastPos) / 1000);
  r.lastPos = now;
  r.seen = now;
  if (r.run.paused && r.autoPaused) { r.run.paused = false; r.autoPaused = false; }
}

function setPause(userId, on) {
  const r = current(userId);
  r.run.paused = !!on;
  r.autoPaused = false;
  r.pausedAt = on ? Date.now() : 0;
  r.seen = Date.now();
}

// Fin de partie : émeraudes, récompense du jour (vague 30), record, statistiques, historique.
function finish(userId, now = Date.now()) {
  const r = runs.get(userId);
  if (!r) return null;
  runs.delete(userId);
  const res = r.run.finish();
  const c = r.user.character;
  const S = svOf(c);
  const greed = r.run.stats.greed; // Avidité (méta) + Bourse de gemmes (objet)
  const emeralds = Math.round(Rules.survivorEmeralds(res) * (1 + greed)) + (res.bonusEmeralds || 0);
  c.emeralds += emeralds;
  game.addStat(c, 'emeraldsEarned', emeralds);
  game.addStat(c, 'survivorRuns');
  game.addStat(c, 'survivorKills', res.kills);
  S.runs += 1;
  const out = { ...res, emeralds, daily: null, record: false };
  if (res.wave >= SV.dailyWave && S.dailyDate !== Rules.parisDay(now)) {
    S.dailyDate = Rules.parisDay(now);
    c.chests += SV.daily.chests;
    game.addKeys(c, SV.daily.keys);
    out.daily = { ...SV.daily };
  }
  if (!S.best || res.score > S.best.score) {
    S.best = { score: res.score, wave: res.wave, time: res.time, kills: res.kills, bosses: res.bosses, at: now };
    out.record = true;
  }
  c.counters.svBestWave = Math.max(c.counters.svBestWave || 0, res.wave);
  c.counters.svBosses = (c.counters.svBosses || 0) + res.bosses;
  c.survivorActive = null;
  game.recordActivity(c, { mode: 'survivor', outcome: 'end', kills: res.kills, duration: res.time, details: { wave: res.wave, score: res.score, bosses: res.bosses, emeralds } }, now);
  db.save();
  return out;
}

function abandon(userId) {
  current(userId).run.finish();
  return finish(userId);
}

// Un pas pour toutes les parties : pause automatique sans nouvelles du joueur, fin après 10 min de pause.
// `emit(userId, frame)` reçoit une image une fois sur `every` ; `onEnd(userId, result)` à la fin d'une partie.
let tickCount = 0;
function tickAll(emit, onEnd, every = 2, now = Date.now()) {
  tickCount += 1;
  for (const [userId, r] of runs) {
    const run = r.run;
    if (!run.paused && !run.pending && now - r.seen > SV.idlePause * 1000) { run.paused = true; r.autoPaused = true; r.pausedAt = now; }
    const idleSince = run.paused ? r.pausedAt : run.pending ? Math.max(r.seen, r.pendingAt || 0) : 0;
    if (run.pending && !r.pendingAt) r.pendingAt = now;
    if (!run.pending) r.pendingAt = 0;
    if (idleSince && now - idleSince > SV.abandonAfter * 1000) run.finish();
    run.tick(TICK);
    if (run.over) {
      const res = finish(userId, now);
      if (emit) emit(userId, run.frame());
      if (onEnd) onEnd(userId, res);
      continue;
    }
    if (emit && (tickCount % every === 0 || run.events.some((e) => e.k === 'choice'))) emit(userId, run.frame());
  }
}

// Serveur redémarré pendant une partie : les golds sont rendus.
function refundActive() {
  let n = 0;
  for (const u of Object.values(db.state.users)) {
    const c = u.character;
    if (!c || !c.survivorActive) continue;
    c.gold += c.survivorActive.price || SV.price;
    c.survivorActive = null;
    n += 1;
  }
  if (n) db.save();
  return n;
}

// ---------- Méta-progression ----------
function buyMeta(c, id) {
  const S = svOf(c);
  const M = Rules.SURVIVOR_META[id];
  if (!M) throw new Error('Amélioration inconnue');
  const lv = S.meta[id] || 0;
  const cost = Rules.survivorMetaCost(id, lv);
  if (cost == null) throw new Error('Déjà au niveau maximum');
  if (c.emeralds < cost) throw new Error(`Il te faut ${cost} émeraudes`);
  c.emeralds -= cost;
  S.meta[id] = lv + 1;
  return { id, level: lv + 1, cost };
}

function buyUnlock(c, kind, id) {
  const S = svOf(c);
  const U = Rules.SURVIVOR_UNLOCKS;
  let cost;
  if (kind === 'weapon') {
    if (!U.weapons[id]) throw new Error('Arme inconnue');
    if (unlockedWeapons(c).includes(id)) throw new Error('Déjà débloquée');
    cost = U.weapons[id].price;
  } else if (kind === 'passive') {
    if (U.passives[id] == null) throw new Error('Objet inconnu');
    if (unlockedPassives(c).includes(id)) throw new Error('Déjà débloqué');
    cost = U.passives[id];
  } else if (kind === 'starter') {
    if (!U.weapons[id]) throw new Error('Arme inconnue');
    if (!unlockedWeapons(c).includes(id)) throw new Error('Débloque d\'abord cette arme');
    if (starters(c).includes(id)) throw new Error('Déjà disponible comme arme de départ');
    cost = U.weapons[id].starter;
  } else throw new Error('Déblocage inconnu');
  if (c.emeralds < cost) throw new Error(`Il te faut ${cost} émeraudes`);
  c.emeralds -= cost;
  if (kind === 'starter') S.starters.push(id); else S.unlocks.push(id);
  return { kind, id, cost };
}

function setStarter(c, id) {
  if (!starters(c).includes(id)) throw new Error('Cette arme de départ n\'est pas débloquée');
  svOf(c).starter = id;
  return { starter: id };
}

// Classement : meilleur score de chaque joueur.
function leaderboard(meId) {
  const rows = Object.values(db.state.users)
    .filter((u) => u.character && u.character.survivor && u.character.survivor.best && !u.banned)
    .map((u) => ({ id: u.id, name: u.twitchDisplayName || u.username, cls: u.character.cls || null, ...u.character.survivor.best }))
    .sort((a, b) => b.score - a.score || a.at - b.at);
  const top = rows.slice(0, 10);
  const i = rows.findIndex((r) => r.id === meId);
  return { top, me: i >= 0 ? { rank: i + 1, ...rows[i] } : null, players: rows.length };
}

// État public pour l'onglet (débloqués, prix, partie en cours).
function stateOf(user, now = Date.now()) {
  const c = user.character;
  const S = svOf(c);
  return {
    emeralds: c.emeralds,
    meta: S.meta,
    unlocked: { weapons: unlockedWeapons(c), passives: unlockedPassives(c) },
    starters: starters(c),
    starter: S.starter,
    best: S.best,
    runs: S.runs,
    dailyDone: S.dailyDate === Rules.parisDay(now),
    playing: runs.has(user.id),
  };
}

module.exports = {
  SurvivorRun, runs, start, input, setPause, finish, abandon, current, tickAll, refundActive,
  buyMeta, buyUnlock, setStarter, leaderboard, stateOf, unlockedWeapons, unlockedPassives, starters,
  random: () => crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48,
};
