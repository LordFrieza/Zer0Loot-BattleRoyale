/*
 * Rendu de l'arène : file d'attente, combat en direct, écran de victoire.
 * Utilisé par la page admin et par /arena.html (source navigateur OBS).
 */
(function () {
  const W = 1280;
  const H = 720;
  const FIGHTER_SCALE = 1.25;
  const WALL_H = 70; // hauteur du mur du fond dans le donjon
  const TORCHES = [210, 640, 1070];
  const TROLL_SCALE = 1.35; // le Troll est dessiné plus grand que les combattants
  const TROLL_LIFT = 40; // décalage pour que ses pieds touchent le sol

  function classIcon(cls) {
    const ci = window.Rules && Rules.CLASS_INFO[cls];
    return ci ? ci.icon + ' ' : '';
  }

  // Monstre du donjon (le Troll est traité à part).
  function isMonster(f) {
    return !!f.kind && f.kind !== 'player' && f.kind !== 'troll';
  }

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
    return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
  }

  // Coffre ou pièce projeté par l'explosion du Troll.
  function lootPiece(kind, d) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
    const v = (kind === 'chest' ? 260 : 320) + Math.random() * 260;
    return {
      kind,
      x: d.x, y: d.y - 40,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200,
      ground: d.y + 10 + (Math.random() - 0.5) * 120,
      rot: 0, vr: kind === 'chest' ? (Math.random() - 0.5) * 6 : 0,
      spin: Math.random() * 6, size: 1 + Math.random() * 0.3, rest: false,
    };
  }

  function drawChestIcon(ctx, s = 1) {
    ctx.scale(s, s);
    ctx.strokeStyle = '#2b160a';
    ctx.lineWidth = 1.4;
    ctx.fillStyle = '#b56d38';
    ctx.beginPath(); ctx.moveTo(-13, -2); ctx.lineTo(-13, -6); ctx.quadraticCurveTo(-13, -13, 0, -13); ctx.quadraticCurveTo(13, -13, 13, -6); ctx.lineTo(13, -2); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8a4f24';
    ctx.fillRect(-13, -2, 26, 12); ctx.strokeRect(-13, -2, 26, 12);
    ctx.fillStyle = '#f2c94c';
    ctx.fillRect(-13, -3.5, 26, 3);
    ctx.fillRect(-9, -12.5, 3, 22.5); ctx.fillRect(6, -12.5, 3, 22.5);
    ctx.fillStyle = '#ffe27a';
    ctx.fillRect(-2.5, -5, 5, 6);
  }

  class ArenaView {
    constructor(canvas, socket) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      canvas.width = W;
      canvas.height = H;
      this.queue = null;
      this.frame = null;
      this.disp = new Map(); // positions affichées (lissées) et effets par combattant
      this.floaters = [];
      this.feed = [];
      this.sparks = [];
      this.projectiles = []; // flèches et boules de feu
      this.blasts = []; // explosions du mage
      this.announces = []; // « PREMIER KILL ! », « DOUBLE KILL ! »…
      this.lastShotSound = 0;
      this.last = performance.now();
      this.bg = this.makeBackground();
      this.dungeonBg = this.makeDungeonBackground();
      this.loadImages();
      this.lastHitSound = 0;
      socket.on('queue', (q) => this.onQueue(q));
      socket.on('frame', (f) => this.onFrame(f));
      requestAnimationFrame((t) => this.loop(t));
    }

    // Pré : herbe, dalles et cailloux (Battle Royale et Combat de Boss).
    makeBackground() {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.7);
      grad.addColorStop(0, '#2b3a2a');
      grad.addColorStop(1, '#141b16');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      // dalles
      g.strokeStyle = 'rgba(255,255,255,.035)';
      for (let x = 0; x < W; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (let y = 0; y < H; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      // touffes d'herbe et cailloux pseudo-aléatoires
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 260; i++) {
        const x = rnd() * W;
        const y = rnd() * H;
        if (rnd() < 0.7) {
          g.strokeStyle = `rgba(120,${160 + rnd() * 60},90,.35)`;
          g.beginPath();
          g.moveTo(x, y); g.lineTo(x - 3, y - 7);
          g.moveTo(x, y); g.lineTo(x + 1, y - 9);
          g.moveTo(x, y); g.lineTo(x + 4, y - 6);
          g.stroke();
        } else {
          g.fillStyle = 'rgba(0,0,0,.25)';
          g.beginPath(); g.ellipse(x, y, 4 + rnd() * 5, 3 + rnd() * 3, 0, 0, Math.PI * 2); g.fill();
        }
      }
      // vignette
      const v = g.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,.65)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
      return c;
    }

    // Salle de donjon : dallage de pierre, mur du fond avec torches, portes à gauche et à droite.
    makeDungeonBackground() {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      let seed = 11;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      g.fillStyle = '#211d26';
      g.fillRect(0, 0, W, H);
      // dalles irrégulières
      const rowH = 46;
      for (let y = WALL_H, row = 0; y < H; y += rowH, row++) {
        let x = row % 2 ? -30 : 0;
        while (x < W) {
          const w = 70 + rnd() * 50;
          const l = 15 + rnd() * 8;
          g.fillStyle = `hsl(${255 + rnd() * 20}, 8%, ${l}%)`;
          g.fillRect(x + 2, y + 2, w - 4, rowH - 4);
          g.fillStyle = 'rgba(255,255,255,.04)';
          g.fillRect(x + 2, y + 2, w - 4, 3);
          if (rnd() < 0.18) { // fissure
            g.strokeStyle = 'rgba(0,0,0,.45)';
            g.beginPath(); g.moveTo(x + w * 0.3, y + 6); g.lineTo(x + w * 0.45, y + rowH * 0.5); g.lineTo(x + w * 0.38, y + rowH - 6); g.stroke();
          }
          if (rnd() < 0.1) { // mousse
            g.fillStyle = 'rgba(90,140,70,.25)';
            g.beginPath(); g.ellipse(x + rnd() * w, y + rowH - 6, 12, 4, 0, 0, Math.PI * 2); g.fill();
          }
          x += w;
        }
      }
      // ossements et débris
      for (let i = 0; i < 18; i++) {
        const x = 60 + rnd() * (W - 120);
        const y = WALL_H + 30 + rnd() * (H - WALL_H - 60);
        g.save();
        g.translate(x, y); g.rotate(rnd() * Math.PI);
        g.fillStyle = 'rgba(220,210,190,.35)';
        g.fillRect(-8, -1.5, 16, 3);
        g.beginPath(); g.arc(-8, 0, 2.6, 0, Math.PI * 2); g.arc(8, 0, 2.6, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      // mur du fond
      g.fillStyle = '#16131b';
      g.fillRect(0, 0, W, WALL_H);
      for (let y = 0, row = 0; y < WALL_H; y += 22, row++) {
        for (let x = row % 2 ? -24 : 0; x < W; x += 48) {
          g.fillStyle = `hsl(260, 10%, ${11 + rnd() * 6}%)`;
          g.fillRect(x + 1.5, y + 1.5, 45, 19);
        }
      }
      const wallShade = g.createLinearGradient(0, WALL_H - 10, 0, WALL_H + 26);
      wallShade.addColorStop(0, 'rgba(0,0,0,.6)');
      wallShade.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = wallShade;
      g.fillRect(0, WALL_H - 10, W, 36);
      // supports de torches
      for (const tx of TORCHES) {
        g.fillStyle = '#3b2a1c';
        g.fillRect(tx - 3, 34, 6, 22);
        g.fillStyle = '#6b6b78';
        g.fillRect(tx - 7, 30, 14, 6);
      }
      // portes (entrée à gauche, sortie à droite)
      for (const side of [0, 1]) {
        const x = side ? W - 22 : 0;
        const door = g.createLinearGradient(side ? W : 0, 0, side ? W - 40 : 40, 0);
        door.addColorStop(0, '#000');
        door.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = door;
        g.fillRect(side ? W - 60 : 0, H / 2 - 90, 60, 180);
        g.fillStyle = '#4a4552';
        g.fillRect(x, H / 2 - 98, 22, 10);
        g.fillRect(x, H / 2 + 88, 22, 10);
      }
      // vignette
      const v = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.72);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,.72)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
      return c;
    }

    // Flammes des torches du donjon (animées).
    drawTorches(t) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      TORCHES.forEach((tx, i) => {
        const fl = 1 + Math.sin(t / 90 + i * 2) * 0.12 + Math.sin(t / 37 + i) * 0.06;
        const glow = ctx.createRadialGradient(tx, 26, 4, tx, 40, 150 * fl);
        glow.addColorStop(0, 'rgba(255,170,60,.35)');
        glow.addColorStop(1, 'rgba(255,120,30,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(tx, 40, 150 * fl, 0, Math.PI * 2); ctx.fill();
        const flame = ctx.createRadialGradient(tx, 22, 1, tx, 22, 12 * fl);
        flame.addColorStop(0, '#fff3c0');
        flame.addColorStop(0.5, '#ffa030');
        flame.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = flame;
        ctx.beginPath(); ctx.ellipse(tx, 20, 7 * fl, 13 * fl, 0, 0, Math.PI * 2); ctx.fill();
      });
      ctx.restore();
    }

    loadImages() {
      const load = (src, key) => {
        const img = new Image();
        img.onload = () => { this[key] = img; };
        img.src = src;
      };
      load('/img/logo.png', 'logoImg');
      // La police des titres doit être demandée explicitement pour être utilisable dans le canvas.
      if (document.fonts) document.fonts.load('900 40px Orbitron').catch(() => {});
    }

    // Logo Zer0Loot centré horizontalement sur x, de hauteur h.
    drawLogo(x, y, h, alpha = 1, blur = 30) {
      if (!this.logoImg) return false;
      const ctx = this.ctx;
      const w = h * this.logoImg.width / this.logoImg.height;
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.shadowColor = 'rgba(184, 60, 255, .8)';
      ctx.shadowBlur = blur;
      ctx.drawImage(this.logoImg, x - w / 2, y - h / 2, w, h);
      ctx.restore();
      return true;
    }

    // Sons liés aux changements de phase (clairons, musique, inscriptions).
    onQueue(q) {
      const prev = this.queue;
      this.queue = q;
      if (!window.Sound) return;
      if (!prev) {
        // Page ouverte en plein combat : on lance directement la musique.
        if (q.phase === 'battle') Sound.music.start(0, q.mode);
        return;
      }
      if (q.phase === 'battle' && prev.phase !== 'battle') {
        const fanfare = Sound.play('battleStart');
        Sound.music.start(Math.max(0, fanfare - 0.25), q.mode);
        const ev = q.event && Rules.BATTLE_EVENTS[q.event];
        if (ev) {
          this.announces.push({ text: `${ev.icon} ${ev.label.toUpperCase()} !`, sub: ev.desc, subSize: 20, color: ev.color, life: 4, age: 0 });
          setTimeout(() => Sound.play('eventStart', q.event), Math.max(0, fanfare * 1000 - 200));
        }
        if (q.mode === 'boss') {
          this.announces.push({ text: '👹 COMBAT DE BOSS !', sub: `Tous ensemble contre ${Rules.BOSS.name} !`, subSize: 26, color: '#7ccf6a', life: 3.5, age: 0 });
          setTimeout(() => Sound.play('roar', true), Math.max(0, fanfare * 1000 - 300));
        }
      } else if (prev.phase === 'battle' && q.phase !== 'battle') {
        Sound.music.stop();
        const r = q.result;
        if (q.phase !== 'ended' || !r) return;
        if (r.mode === 'boss' && r.victory) setTimeout(() => Sound.play('victory'), 2600); // après l'explosion du Troll
        else if (r.mode === 'boss' || (r.mode === 'dungeon' && !r.reward)) setTimeout(() => Sound.play('defeat'), 350);
        else setTimeout(() => Sound.play('victory'), 350);
      }
      if (q.phase === 'queue' && prev.phase !== 'queue') { Sound.play('queueOpen'); Sound.music.preload(q.mode); }
      else if (q.phase === 'queue' && q.participants.length > prev.participants.length) {
        const now = performance.now();
        if (now - (this.lastJoinSound || 0) > 120) { this.lastJoinSound = now; Sound.play('join'); }
      }
    }

    onFrame(f) {
      if (f.phase === 'battle' && (!this.frame || this.frame.phase !== 'battle')) {
        this.disp.clear(); this.feed = []; this.floaters = []; this.sparks = [];
        // (les annonces ne sont pas effacées : celle de l'événement arrive juste avant cette image)
        this.projectiles = []; this.blasts = [];
        this.bossDeath = null; this.loot = []; this.bossHpShown = null;
      }
      if (f.phase === 'idle') { this.bossDeath = null; this.loot = []; }
      // Nouvelle salle du donjon : on oublie les monstres de la salle précédente.
      if ((f.events || []).some((e) => e.t === 'room')) {
        for (const key of [...this.disp.keys()]) if (key.startsWith('m')) this.disp.delete(key);
        this.projectiles = []; this.blasts = []; this.floaters = [];
        if (window.Sound) Sound.play('roomEnter');
      }
      this.frame = f;
      this.frameAt = performance.now();
      const byKey = new Map(f.fighters.map((x) => [x.key, x]));
      for (const fi of f.fighters) {
        if (!this.disp.has(fi.key)) this.disp.set(fi.key, { x: fi.x, y: fi.y, flash: 0, swing: 0, facing: 1, deathT: 0 });
      }
      for (const e of f.events || []) {
        const to = byKey.get(e.to);
        const from = byKey.get(e.from);
        const dTo = this.disp.get(e.to);
        const dFrom = this.disp.get(e.from);
        if (window.Sound && e.crit) Sound.play('crit');
        else if (window.Sound && (e.t === 'hit' || e.t === 'dodge')) {
          const now = performance.now();
          if (now - this.lastHitSound > 90) { this.lastHitSound = now; Sound.play('hit'); }
        }
        if (window.Sound && e.t === 'kill') {
          const now = performance.now();
          if (now - (this.lastKillSound || 0) > 120) { this.lastKillSound = now; Sound.play('kill'); }
        }
        // Projectiles (archer, mage) : purement visuels, les dégâts sont déjà calculés.
        if ((e.t === 'hit' || e.t === 'dodge') && e.proj && from && to) {
          this.projectiles.push({ x0: from.x, y0: from.y - 12, x1: to.x, y1: to.y - 12, t: 0, dur: e.proj === 'fire' ? 0.25 : 0.16, kind: e.proj });
          const now = performance.now();
          if (window.Sound && now - this.lastShotSound > 110) { this.lastShotSound = now; Sound.play('shoot', e.proj); }
        }
        if (e.t === 'aoe') {
          // Boule de feu du mage, ou coup de massue du Troll (nuage de poussière).
          this.blasts.push({ x: e.x, y: e.y - 8, r: e.r, life: 0.5, color: e.cleave ? 'dust' : undefined });
          if (e.cleave) this.shake = Math.max(this.shake || 0, 0.2);
          if (window.Sound) Sound.play(e.cleave ? 'slam' : 'blast');
        } else if (e.t === 'heal' && to) {
          this.floaters.push({ x: to.x + 14, y: to.y - 40, text: '+' + e.amount, color: '#5dff8a', life: 0.9, size: 15 });
        } else if (e.t === 'thorns' && to) {
          this.floaters.push({ x: to.x - 14, y: to.y - 50, text: '🌵-' + e.dmg, color: '#d38bff', life: 0.9, size: 15 });
        } else if (e.t === 'meteor') {
          this.blasts.push({ x: e.x, y: e.y, r: e.r * 1.3, life: 0.5 });
          this.spark(e.x, e.y, '#ff6b2a', 40);
          this.shake = 0.35;
          const now = performance.now();
          if (window.Sound && now - (this.lastMeteorSound || 0) > 150) { this.lastMeteorSound = now; Sound.play('meteor'); }
        } else if (e.t === 'streak' && to) {
          const info = Rules.STREAK_INFO[e.kind];
          this.announces.push({ text: info.label, sub: to.name, color: info.color, life: 2.4, age: 0 });
          this.spark(to.x, to.y - 10, info.color, 40);
          if (window.Sound) Sound.play('streak', e.kind);
        } else if (e.t === 'slamWarn') {
          if (window.Sound) Sound.play('slamWarn');
          const boss = this.disp.get('boss');
          if (boss) boss.swing = 1;
        } else if (e.t === 'slam') {
          this.blasts.push({ x: e.x, y: e.y, r: e.r, life: 0.6, color: 'dust' });
          this.spark(e.x, e.y, '#b89a6a', 50);
          this.spark(e.x, e.y, '#8a8a8a', 20);
          this.shake = Math.max(this.shake || 0, 0.5);
          if (window.Sound) Sound.play('slam');
        } else if (e.t === 'bossPhase') {
          this.announces.push({ text: e.label, sub: 'Il frappe plus fort et plus vite !', subSize: 26, color: e.phase > 1 ? '#ff4d6d' : '#ff9a1f', life: 2.8, age: 0 });
          this.shake = Math.max(this.shake || 0, 0.6);
          if (window.Sound) Sound.play('roar', e.phase > 1);
        } else if (e.t === 'bossEnrage') {
          this.announces.push({ text: '🔥 RAGE FINALE !', sub: 'Le Troll frappe 3 fois plus fort !', subSize: 26, color: '#ff2a2a', life: 3, age: 0 });
          this.shake = Math.max(this.shake || 0, 0.8);
          if (window.Sound) Sound.play('roar', true);
        } else if (e.t === 'bossDown') {
          this.bossDeath = { x: e.x, y: e.y, t: 0, exploded: false };
          this.announces = [];
        } else if (e.t === 'roomClear') {
          const reward = Rules.dungeonReward(e.room + 1);
          const next = (e.room + 1) % 5 === 0 && reward ? `Prochaine salle : palier de récompense !` : 'En route vers la salle suivante…';
          this.announces.push({ text: `SALLE ${e.room} TERMINÉE !`, sub: next, subSize: 24, color: '#3ddc5a', life: 2.4, age: 0 });
          if (window.Sound) Sound.play('roomClear');
        } else if (e.t === 'enrage') {
          this.announces.push({ text: 'LES MONSTRES S\'ÉNERVENT !', sub: 'Ils frappent de plus en plus fort…', subSize: 24, color: '#ff4d6d', life: 2.6, age: 0 });
        }
        if (e.t === 'hit' && to && e.splash) {
          dTo.flash = 1;
          this.floaters.push({ x: to.x + (Math.random() * 16 - 8), y: to.y - 60, text: '-' + e.dmg, color: '#ff9a4a', life: 0.9, size: 16 });
        } else if (e.t === 'hit' && to) {
          dTo.flash = 1;
          if (dFrom) dFrom.swing = 1;
          if (e.crit) {
            this.floaters.push({ x: to.x + (Math.random() * 16 - 8), y: to.y - 70, text: 'CRIT -' + e.dmg + ' !', color: '#ff5a3c', life: 1.3, size: 30 });
            this.spark(to.x, to.y - 10, '#ff7a3c', 22);
          } else {
            this.floaters.push({ x: to.x + (Math.random() * 16 - 8), y: to.y - 66, text: '-' + e.dmg, color: '#ffdf5e', life: 1, size: 22 });
            this.spark(to.x, to.y - 10, '#ffcf6a', 6);
          }
        } else if (e.t === 'dodge' && to) {
          if (dFrom) dFrom.swing = 1;
          this.floaters.push({ x: to.x, y: to.y - 44, text: 'ESQUIVE', color: '#7fd8ff', life: 1, size: 16 });
        } else if (e.t === 'kill' && to) {
          this.spark(to.x, to.y - 10, '#ff4d6d', 26);
          if (to.kind !== 'troll') this.floaters.push({ x: to.x, y: to.y - 50, text: '💀', color: '#fff', life: 1.4, size: 28 });
          // En coopération, le fil n'affiche que les aventuriers tombés et les chefs vaincus.
          let text = null;
          if (f.mode === 'br' || !f.mode) text = from ? `${from.name}  ⚔  ${to.name}` : `☠ ${to.name} (zone)`;
          else if (to.kind === 'player') text = `☠ ${to.name} est tombé(e)`;
          else if (to.elite && from) text = `👑 ${from.name} a vaincu ${to.name}`;
          if (text) {
            this.feed.unshift({ text, life: 7 });
            this.feed = this.feed.slice(0, 7);
          }
        } else if (e.t === 'win' && to) {
          this.spark(to.x, to.y - 10, '#ffb000', 80);
        }
      }
    }

    spark(x, y, color, n) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 40 + Math.random() * 160;
        this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.6 + Math.random() * 0.5, color });
      }
    }

    loop(t) {
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.draw(dt, t);
      requestAnimationFrame((tt) => this.loop(tt));
    }

    draw(dt, t) {
      const ctx = this.ctx;
      // Tremblement de l'écran (impact de météore)
      this.shake = Math.max(0, (this.shake || 0) - dt);
      ctx.save();
      if (this.shake > 0) ctx.translate((Math.random() - 0.5) * 14 * this.shake, (Math.random() - 0.5) * 14 * this.shake);
      const phase = (this.queue && this.queue.phase) || 'idle';
      const dungeon = phase !== 'idle' && this.queue && this.queue.mode === 'dungeon';
      ctx.drawImage(dungeon ? this.dungeonBg : this.bg, 0, 0);
      if (dungeon) this.drawTorches(t);

      if (phase === 'battle' || (phase === 'ended' && this.frame && this.frame.fighters.length)) {
        this.drawBattle(dt, t);
        if (phase === 'ended') this.drawResult(t);
      } else if (phase === 'queue' || phase === 'ready') {
        this.drawQueue(t, phase);
      } else {
        this.drawIdle(t);
      }
      ctx.restore();
    }

    // Grand titre néon centré ; la taille est réduite si le texte dépasse maxW.
    title(text, y, size, color = '#fff', glow = '#b83cff', maxW = W - 80) {
      const ctx = this.ctx;
      ctx.save();
      const font = (px) => `900 ${px}px Orbitron, "Segoe UI", system-ui, sans-serif`;
      ctx.font = font(size);
      const width = ctx.measureText(text).width;
      if (width > maxW) {
        size = Math.floor(size * maxW / width);
        ctx.font = font(size);
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = glow;
      ctx.shadowBlur = 24;
      ctx.lineWidth = Math.max(3, size / 10);
      ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.strokeText(text, W / 2, y);
      ctx.fillStyle = color;
      ctx.fillText(text, W / 2, y);
      ctx.restore();
    }

    drawIdle(t) {
      if (!this.drawLogo(W / 2, H / 2, 260, 1, 30 + Math.sin(t / 600) * 14)) this.title('ZER0LOOT', H / 2, 110, '#fff');
      this.ctx.globalAlpha = Math.random() < 0.015 ? 0.5 : 1; // petit grésillement de néon
      this.title('BATTLE ROYALE', H / 2 + 185, 46, '#fff', '#ff3fd8');
      this.ctx.globalAlpha = 0.6 + Math.sin(t / 500) * 0.3;
      this.title('En attente du prochain combat…', H / 2 + 245, 24, '#cfc6ff', '#29e7ff');
      this.ctx.globalAlpha = 1;
    }

    drawQueue(t, phase) {
      const q = this.queue;
      const n = q.participants.length;
      const mode = Rules.GAME_MODES[q.mode] || Rules.GAME_MODES.br;
      if (phase === 'queue') {
        const pulse = 1 + Math.sin(t / 250) * 0.04;
        this.ctx.save();
        this.ctx.translate(W / 2, 70);
        this.ctx.scale(pulse, pulse);
        this.ctx.translate(-W / 2, -70);
        this.title('TAPEZ !join DANS LE CHAT', 70, 56, '#fff', '#b83cff', W - 360);
        this.ctx.restore();
        const left = q.queueEndsAt ? q.queueEndsAt - Date.now() : 0;
        this.title(formatCountdown(left), 188, 50, left < 10000 ? '#ff4d6d' : '#ffc21a', left < 10000 ? '#ff4d6d' : '#ff9a00');
      } else {
        this.title('FILE FERMÉE', 70, 56, '#fff', '#b83cff', W - 360);
        this.title(q.mode === 'br' ? 'La bataille va commencer !' : 'L\'aventure va commencer !', 188, 30, '#ffc21a', '#ff9a00');
      }
      // Mode de jeu choisi par le streamer
      this.title(`${mode.icon} MODE : ${mode.label.toUpperCase()}`, 128, 30, mode.color, mode.color, W - 360);
      this.drawLogo(100, 80, 110);
      const pot = q.bets && q.bets.pool ? `   ·   💰 ${q.bets.pool} golds pariés sur le site` : '';
      const who = q.mode === 'dungeon' ? 'aventurier' : 'combattant';
      this.title(`${n} ${who}${n > 1 ? 's' : ''}${pot}`, 240, 24, '#cfc6ff');

      // Grille des inscrits
      const cols = n > 40 ? 12 : 10;
      const cellW = W / (cols + 1);
      const scale = n > 40 ? 0.9 : 1.2;
      const cellH = 70 * scale;
      const maxRows = Math.floor((H - 290) / cellH);
      const shown = q.participants.slice(-cols * maxRows);
      shown.forEach((p, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = cellW * (col + 1);
        const y = 310 + row * cellH;
        drawFighter(this.ctx, x, y, p, { scale, bob: Math.sin(t / 300 + i) * 2 });
        this.label(classIcon(p.cls) + p.name, x, y + 32 * scale, 13, '#fff');
        if (p.title) this.label(p.title, x, y + 32 * scale + 14, 11, '#ffcf5a');
      });
    }

    label(text, x, y, size, color) {
      const ctx = this.ctx;
      ctx.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.85)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    }

    drawBattle(dt, t) {
      const ctx = this.ctx;
      const f = this.frame;
      if (!f) return;

      // Zone qui rétrécit
      if (f.storm && f.storm.active) {
        ctx.save();
        ctx.fillStyle = 'rgba(120, 40, 200, 0.28)';
        ctx.beginPath();
        ctx.rect(0, 0, W, H);
        ctx.arc(f.storm.x, f.storm.y, f.storm.r, 0, Math.PI * 2, true);
        ctx.fill('evenodd');
        ctx.strokeStyle = `rgba(200, 120, 255, ${0.6 + Math.sin(t / 150) * 0.3})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(f.storm.x, f.storm.y, f.storm.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      const k = Math.min(1, dt * 14);
      const byKey = new Map(f.fighters.map((x) => [x.key, x]));
      const order = [...f.fighters].sort((a, b) => a.y - b.y);
      const labels = [];

      // Météores : zone d'impact au sol qui se remplit
      for (const m of f.meteors || []) {
        ctx.save();
        ctx.strokeStyle = `rgba(255,80,30,${0.5 + Math.sin(t / 60) * 0.3})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(255,60,20,${0.12 + m.p * 0.25})`;
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r * m.p, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // Attaques spéciales du Troll : zone d'impact au sol qui se remplit
      for (const s of f.slams || []) {
        ctx.save();
        ctx.strokeStyle = `rgba(255,${s.kind === 'rock' ? 150 : 60},40,${0.55 + Math.sin(t / 60) * 0.3})`;
        ctx.lineWidth = 4;
        ctx.setLineDash([12, 8]);
        ctx.beginPath(); ctx.ellipse(s.x, s.y + 10, s.r, s.r * 0.75, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(255,70,30,${0.1 + s.p * 0.3})`;
        ctx.beginPath(); ctx.ellipse(s.x, s.y + 10, s.r * s.p, s.r * 0.75 * s.p, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // Morts d'abord (au sol)
      for (const fi of order) {
        if (fi.alive) continue;
        const d = this.disp.get(fi.key);
        if (!d) continue;
        if (fi.kind === 'troll') { this.drawBossDeath(dt, t, d, fi); continue; }
        d.deathT = Math.min(1, d.deathT + dt * 2);
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.translate(d.x, d.y);
        ctx.rotate(d.deathT * Math.PI / 2 * (d.facing || 1));
        if (isMonster(fi)) drawMonster(ctx, 0, 0, fi, { scale: FIGHTER_SCALE, facing: d.facing, t });
        else drawFighter(ctx, 0, 0, fi, { scale: FIGHTER_SCALE, facing: d.facing });
        ctx.restore();
      }

      for (const fi of order) {
        if (!fi.alive) continue;
        const d = this.disp.get(fi.key);
        d.x += (fi.x - d.x) * k;
        d.y += (fi.y - d.y) * k;
        const target = byKey.get(fi.target);
        if (target) d.facing = target.x >= d.x ? 1 : -1;
        else if (Math.abs(fi.x - d.x) > 1) d.facing = fi.x > d.x ? 1 : -1; // entrée / sortie des salles
        d.flash = Math.max(0, d.flash - dt * 5);
        d.swing = Math.max(0, d.swing - dt * (fi.kind === 'troll' ? 2.2 : 4));
        const swing = d.swing > 0 ? Math.sin((1 - d.swing) * Math.PI) : 0;
        const moving = Math.hypot(fi.x - d.x, fi.y - d.y) > 0.5;
        const bob = moving ? Math.abs(Math.sin(t / 90 + fi.x)) * -3 : Math.sin(t / 400 + fi.y) * 1;
        const lunge = swing * 6 * d.facing;
        if (fi.kind === 'troll') {
          drawMonster(ctx, d.x, d.y - TROLL_LIFT, fi, { scale: TROLL_SCALE, facing: d.facing, flash: d.flash, swing, t, phase: f.boss && f.boss.phase, enraged: f.boss && f.boss.enraged });
        } else if (isMonster(fi)) {
          drawMonster(ctx, d.x + lunge, d.y, fi, { scale: FIGHTER_SCALE, facing: d.facing, flash: d.flash, swing, bob, t, seed: fi.x });
        } else {
          drawFighter(ctx, d.x + lunge, d.y, fi, { scale: FIGHTER_SCALE, facing: d.facing, flash: d.flash, swing, bob });
        }

        // Pseudo, titre et barre de vie (dessinés après le brouillard ; cachés dedans)
        if (!fi.hidden && fi.kind !== 'troll' && d.x > -20 && d.x < W + 20) labels.push({ fi, x: d.x, y: d.y });
      }

      // Rochers lancés par le Troll
      for (const s of f.slams || []) {
        if (s.kind !== 'rock' || s.fx == null) continue;
        const p = Math.min(1, s.p + (performance.now() - this.frameAt) / 1000 / Rules.BOSS.slam.warn);
        const rx = s.fx + (s.x - s.fx) * p;
        const ry = s.fy + (s.y - s.fy) * p - Math.sin(p * Math.PI) * 220;
        ctx.save();
        ctx.translate(rx, ry);
        ctx.rotate(p * 9);
        ctx.fillStyle = '#7d7468';
        ctx.strokeStyle = '#3d3830';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-18, -4); ctx.lineTo(-10, -16); ctx.lineTo(6, -17); ctx.lineTo(18, -6); ctx.lineTo(15, 10); ctx.lineTo(0, 17); ctx.lineTo(-14, 12);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        ctx.beginPath(); ctx.arc(-4, -7, 5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // Météores en chute
      for (const m of f.meteors || []) {
        const k2 = 1 - m.p;
        const mx = m.x + 260 * k2;
        const my = m.y - 520 * k2;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(mx, my, 2, mx, my, 22);
        g.addColorStop(0, '#fff3b0'); g.addColorStop(0.4, '#ff8a1f'); g.addColorStop(1, 'rgba(255,40,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(mx, my, 22, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,140,40,.45)';
        ctx.lineWidth = 8;
        ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + 60, my - 120); ctx.stroke();
        ctx.restore();
      }

      // Brouillard
      for (const z of f.fogs || []) {
        ctx.save();
        for (let i = 0; i < 4; i++) {
          const ox = Math.sin(t / 1300 + i * 1.7) * z.r * 0.18;
          const oy = Math.cos(t / 1700 + i * 2.3) * z.r * 0.14;
          const g = ctx.createRadialGradient(z.x + ox, z.y + oy, 4, z.x + ox, z.y + oy, z.r * (0.75 + i * 0.12));
          g.addColorStop(0, `rgba(215,222,232,${0.55 * z.a})`);
          g.addColorStop(0.6, `rgba(190,200,215,${0.35 * z.a})`);
          g.addColorStop(1, 'rgba(180,190,205,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(z.x + ox, z.y + oy, z.r * (0.75 + i * 0.12), 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }

      for (const { fi, x, y } of labels) {
        const ratio = fi.hp / fi.maxHp;
        if (isMonster(fi)) {
          // Monstres : petite barre de vie rouge, nom seulement pour les chefs.
          const top = y - fi.r * FIGHTER_SCALE - (fi.kind === 'chauve_souris' ? 42 : 30);
          const mw = fi.elite ? 56 : 30;
          ctx.fillStyle = 'rgba(0,0,0,.7)';
          ctx.fillRect(x - mw / 2 - 1, top - 1, mw + 2, 6);
          ctx.fillStyle = '#ff4d6d';
          ctx.fillRect(x - mw / 2, top, mw * ratio, 4);
          if (fi.elite) this.label('👑 ' + fi.name, x, top - 11, 13, '#ffb000');
          continue;
        }
        const bw = 40;
        ctx.fillStyle = 'rgba(0,0,0,.7)';
        ctx.fillRect(x - bw / 2 - 1, y - 49, bw + 2, 7);
        ctx.fillStyle = ratio > 0.5 ? '#3ddc5a' : ratio > 0.25 ? '#ffb000' : '#ff4d6d';
        ctx.fillRect(x - bw / 2, y - 48, bw * ratio, 5);
        const nameY = fi.title ? y - 67 : y - 58;
        this.label(classIcon(fi.cls) + fi.name + (fi.kills ? ` ⚔${fi.kills}` : ''), x, nameY, 12, '#fff');
        if (fi.title) this.label(fi.title, x, y - 56, 10, '#ffcf5a');
      }

      // Étincelles
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const s of this.sparks) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 300 * dt; s.life -= dt;
        ctx.globalAlpha = Math.max(0, s.life);
        ctx.fillStyle = s.color;
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
      }
      ctx.restore();
      this.sparks = this.sparks.filter((s) => s.life > 0);

      // Projectiles
      for (const p of this.projectiles) {
        p.t += dt;
        const k = Math.min(1, p.t / p.dur);
        const x = p.x0 + (p.x1 - p.x0) * k;
        const y = p.y0 + (p.y1 - p.y0) * k - Math.sin(k * Math.PI) * (p.kind === 'fire' ? 8 : 18);
        const ang = Math.atan2(p.y1 - p.y0, p.x1 - p.x0);
        ctx.save();
        ctx.translate(x, y);
        if (p.kind === 'bone') {
          // flèche d'os du squelette
          ctx.rotate(ang);
          ctx.fillStyle = '#ece4cf';
          ctx.fillRect(-10, -1.2, 18, 2.4);
          ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(6, -3.5); ctx.lineTo(6, 3.5); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.arc(-10, -2, 2, 0, Math.PI * 2); ctx.arc(-10, 2, 2, 0, Math.PI * 2); ctx.fill();
        } else if (p.kind === 'arrow') {
          ctx.rotate(ang);
          ctx.fillStyle = '#e8d7b0';
          ctx.fillRect(-10, -1, 16, 2);
          ctx.fillStyle = '#d0d0e0';
          ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(4, -3); ctx.lineTo(4, 3); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#ff6b4a';
          ctx.fillRect(-12, -2.5, 4, 5);
        } else {
          ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 11);
          g.addColorStop(0, '#fff6b0'); g.addColorStop(0.4, '#ff9a1f'); g.addColorStop(1, 'rgba(255,60,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        if (p.kind === 'fire' && Math.random() < 0.6) this.sparks.push({ x, y, vx: (Math.random() - 0.5) * 40, vy: -20, life: 0.3, color: '#ff7a1f' });
      }
      this.projectiles = this.projectiles.filter((p) => p.t < p.dur);

      // Explosions
      for (const b of this.blasts) {
        b.life -= dt;
        const k = 1 - b.life / 0.5;
        ctx.save();
        ctx.globalAlpha = Math.max(0, b.life * 2);
        if (b.color === 'dust') {
          // Onde de choc / coup de massue : anneau de poussière au sol
          ctx.strokeStyle = 'rgba(214,190,150,.8)';
          ctx.lineWidth = 10 * (1 - k) + 2;
          ctx.beginPath(); ctx.ellipse(b.x, b.y + 10, b.r * (0.3 + k * 0.8), b.r * 0.75 * (0.3 + k * 0.8), 0, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = 'rgba(180,160,120,.25)';
          ctx.fill();
        } else {
          ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, b.r * (0.5 + k * 0.6));
          g.addColorStop(0, 'rgba(255,240,180,.9)'); g.addColorStop(0.5, 'rgba(255,120,20,.6)'); g.addColorStop(1, 'rgba(255,40,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (0.5 + k * 0.6), 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
      this.blasts = this.blasts.filter((b) => b.life > 0);
      this.drawLoot(dt);

      // Textes flottants
      for (const fl of this.floaters) {
        fl.y -= 40 * dt; fl.life -= dt;
        ctx.globalAlpha = Math.max(0, Math.min(1, fl.life * 1.5));
        this.label(fl.text, fl.x, fl.y, fl.size, fl.color);
      }
      ctx.globalAlpha = 1;
      this.floaters = this.floaters.filter((fl) => fl.life > 0);

      // HUD
      const heroes = f.fighters.filter((x) => !isMonster(x) && x.kind !== 'troll');
      const alive = heroes.filter((x) => x.alive).length;
      const total = this.queue && this.queue.participants ? this.queue.participants.length : heroes.length;
      const time = Math.floor(f.time);
      const clock = `⏱ ${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`;
      ctx.textAlign = 'left';
      let hudY = 84;
      if (f.mode === 'dungeon' && f.dungeon) {
        this.hudBox(16, 16, 250, 92, '#5fd3ff');
        ctx.font = '900 28px Orbitron, "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = '#ffc21a';
        ctx.fillText(`🏰 Salle ${Math.max(1, f.dungeon.room)}`, 30, 42);
        ctx.font = '700 17px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(`👥 ${alive} / ${total} aventuriers`, 30, 70);
        ctx.fillStyle = f.dungeon.enraged ? '#ff8fa3' : '#cfc6ff';
        ctx.fillText(`${clock}${f.dungeon.enraged ? '  😡 monstres énervés' : ''}`, 30, 95);
        hudY = 112;
      } else if (f.mode === 'boss') {
        this.hudBox(16, 16, 230, 64, '#7ccf6a');
        ctx.font = '900 24px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(`👥 ${alive} / ${total} debout`, 30, 38);
        ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = '#cfc6ff';
        ctx.fillText(clock, 30, 66);
        this.drawBossBar(dt, t, f.boss);
      } else {
        this.hudBox(16, 16, 230, 64, '#29e7ff');
        ctx.font = '900 26px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(`👥 ${alive} en vie`, 30, 38);
        ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = f.storm && f.storm.active ? '#d49bff' : '#cfc6ff';
        ctx.fillText(`${clock}${f.storm && f.storm.active ? '  ⚡ la zone se referme' : ''}`, 30, 66);
      }
      ctx.textAlign = 'left';
      ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
      const ev = f.event && Rules.BATTLE_EVENTS[f.event];
      if (ev) {
        this.hudBox(16, hudY, 230, 30, ev.color);
        ctx.fillStyle = ev.color;
        ctx.fillText(`${ev.icon} ${ev.label}`, 30, hudY + 21);
        hudY += 34;
      }
      const bets = this.queue && this.queue.bets;
      if (bets && bets.pool && this.queue.phase === 'battle') {
        this.hudBox(16, hudY, 230, 30, '#ffc21a');
        ctx.fillStyle = '#ffc21a';
        ctx.fillText(`💰 ${bets.pool} golds en jeu (${bets.bettors} paris)`, 30, hudY + 21);
      }

      // Kill feed
      this.feed.forEach((item, i) => {
        item.life -= dt;
        const a = Math.max(0, Math.min(1, item.life));
        ctx.globalAlpha = a;
        ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
        const w = ctx.measureText(item.text).width + 24;
        this.hudBox(W - w - 16, 16 + i * 30, w, 26, '#ff3fd8');
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'right';
        ctx.fillText(item.text, W - 28, 30 + i * 30);
      });
      ctx.globalAlpha = 1;
      this.feed = this.feed.filter((x) => x.life > 0);
      // Pas d'annonce par-dessus l'écran de victoire.
      if (this.queue && this.queue.phase === 'ended') this.announces = [];
      else this.drawAnnounces(dt);
      if (f.mode === 'dungeon' && f.dungeon && f.phase === 'battle') this.drawRoomTransition(f.dungeon);
    }

    /*
     * Grosse barre de vie du Troll en haut de l'écran, avec les coches à 66 % et 33 %
     * (à chaque coche franchie, il devient plus fort). Une traînée blanche montre les dégâts récents.
     */
    drawBossBar(dt, t, boss) {
      if (!boss) return;
      const ctx = this.ctx;
      const bw = 640;
      const bh = 30;
      const x = (W - bw) / 2;
      const y = 50;
      const ratio = Math.max(0, boss.hp / boss.maxHp);
      if (this.bossHpShown == null || this.bossHpShown < ratio) this.bossHpShown = ratio;
      this.bossHpShown += (ratio - this.bossHpShown) * Math.min(1, dt * 2.5);
      const colors = ['#3ddc5a', '#ffb000', '#ff4d6d'];
      const color = boss.enraged ? (Math.sin(t / 90) > 0 ? '#ff2a2a' : '#ff9a1f') : colors[Math.min(2, boss.phase || 0)];

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 22px Orbitron, "Segoe UI", system-ui, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,.85)';
      const title = `👹 ${boss.name}${boss.enraged ? ' — RAGE FINALE' : boss.phase ? ` — PHASE ${boss.phase + 1}` : ''}`;
      ctx.strokeText(title, W / 2, y - 16);
      ctx.fillStyle = boss.enraged ? '#ff6b4a' : '#fff';
      ctx.fillText(title, W / 2, y - 16);
      // cadre
      ctx.fillStyle = 'rgba(8,5,28,.85)';
      ctx.fillRect(x - 4, y - 4, bw + 8, bh + 8);
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 4, y - 4, bw + 8, bh + 8);
      ctx.shadowBlur = 0;
      // traînée des dégâts récents, puis la vie
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.fillRect(x, y, bw * this.bossHpShown, bh);
      const g = ctx.createLinearGradient(0, y, 0, y + bh);
      g.addColorStop(0, shade(color, 0.3));
      g.addColorStop(1, shade(color, -0.25));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, bw * ratio, bh);
      // coches à 66 % et 33 %
      for (const ph of Rules.BOSS.phases) {
        const cx = x + bw * ph.at;
        const passed = ratio <= ph.at;
        ctx.fillStyle = passed ? 'rgba(0,0,0,.6)' : '#fff';
        ctx.fillRect(cx - 2, y - 8, 4, bh + 16);
        ctx.beginPath(); ctx.moveTo(cx - 7, y - 12); ctx.lineTo(cx + 7, y - 12); ctx.lineTo(cx, y - 4); ctx.closePath(); ctx.fill();
        ctx.font = '800 11px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = passed ? '#ff8fa3' : '#fff';
        ctx.fillText(`${Math.round(ph.at * 100)} %`, cx, y + bh + 14);
      }
      ctx.font = '800 15px "Segoe UI", system-ui, sans-serif';
      ctx.lineWidth = 3;
      const hpText = `${boss.hp.toLocaleString('fr-FR')} / ${boss.maxHp.toLocaleString('fr-FR')}`;
      ctx.strokeText(hpText, W / 2, y + bh / 2 + 1);
      ctx.fillStyle = '#fff';
      ctx.fillText(hpText, W / 2, y + bh / 2 + 1);
      ctx.restore();
    }

    /*
     * Donjon : fondu au noir quand les aventuriers sortent à droite, grand « SALLE X »,
     * puis retour de la lumière quand ils entrent par la gauche.
     */
    drawRoomTransition(dg) {
      const S = Rules.DUNGEON.stages;
      const st = dg.stageT + Math.min(0.06, (performance.now() - this.frameAt) / 1000);
      let black = 0;
      let showText = false;
      let room = dg.room;
      if (dg.stage === 'exit') black = Math.max(0, Math.min(1, (st - (S.exit - 1)) / 0.9));
      else if (dg.stage === 'dark') { black = 1; showText = true; room = dg.room + 1; }
      else if (dg.stage === 'enter') { black = Math.max(0, 1 - st / 0.8); showText = st < 0.8; }
      if (black <= 0) return;
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = `rgba(0,0,0,${black})`;
      ctx.fillRect(-20, -20, W + 40, H + 40);
      if (showText) {
        const k = dg.stage === 'dark' ? Math.min(1, st / 0.35) : 1;
        ctx.globalAlpha = black;
        ctx.translate(W / 2, H / 2);
        ctx.scale(0.7 + 0.3 * k, 0.7 + 0.3 * k);
        ctx.translate(-W / 2, -H / 2);
        this.title(`SALLE ${room}`, H / 2 - 20, 110, '#ffc21a', '#ff9a00');
        const tier = Rules.dungeonReward(room);
        let sub = room === 1 ? 'Le raid commence !' : 'Les monstres sont plus nombreux et plus forts…';
        if (room % Rules.ELITE.every === 0) sub = '👑 Un chef garde cette salle !';
        this.title(sub, H / 2 + 60, 28, '#fff', '#b83cff');
        if (tier && tier.tier === room) {
          const gains = [tier.chests ? `${tier.chests} coffre${tier.chests > 1 ? 's' : ''}` : '', `${tier.xp} XP`, `${tier.gold} golds`].filter(Boolean).join(' · ');
          this.title(`🎁 Palier atteint : ${gains} pour tout le monde`, H / 2 + 110, 24, '#3ddc5a', '#3ddc5a');
        }
      }
      ctx.restore();
    }

    // Le Troll vaincu tremble et clignote, puis explose en laissant tomber coffres et golds.
    drawBossDeath(dt, t, d, fi) {
      const bd = this.bossDeath;
      if (!bd) return; // page ouverte après la fin : on ne rejoue pas l'animation
      const ctx = this.ctx;
      bd.t += dt;
      if (bd.t < 1.3) {
        const k = bd.t / 1.3;
        const jx = (Math.random() - 0.5) * 10 * k;
        const jy = (Math.random() - 0.5) * 6 * k;
        drawMonster(ctx, d.x + jx, d.y - TROLL_LIFT + jy, fi, { scale: TROLL_SCALE, facing: d.facing, t, phase: 2, flash: Math.sin(t / 40) > 0 ? 0.4 + k : 0 });
        if (Math.random() < 0.5) this.spark(d.x + (Math.random() - 0.5) * 80, d.y - 40 + (Math.random() - 0.5) * 80, '#ffe9a0', 2);
        // lumière qui grandit
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(d.x, d.y - 30, 4, d.x, d.y - 30, 60 + k * 120);
        g.addColorStop(0, `rgba(255,240,200,${0.3 + k * 0.5})`);
        g.addColorStop(1, 'rgba(255,200,80,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(d.x, d.y - 30, 60 + k * 120, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        return;
      }
      if (!bd.exploded) {
        bd.exploded = true;
        this.shake = 1;
        this.blasts.push({ x: d.x, y: d.y - 20, r: 260, life: 0.5 });
        this.blasts.push({ x: d.x, y: d.y, r: 200, life: 0.6, color: 'dust' });
        for (const c of ['#ffe066', '#ff9a1f', '#ffffff', '#7ccf6a']) this.spark(d.x, d.y - 30, c, 45);
        if (window.Sound) Sound.play('bossExplode');
        // butin : coffres et pièces projetés, qui retombent et rebondissent au sol
        this.loot = [];
        for (let i = 0; i < 9; i++) this.loot.push(lootPiece('chest', d));
        for (let i = 0; i < 45; i++) this.loot.push(lootPiece('coin', d));
      }
      // éclair blanc juste après l'explosion
      if (bd.t < 1.6) {
        ctx.save();
        ctx.fillStyle = `rgba(255,255,255,${(1.6 - bd.t) / 0.3 * 0.7})`;
        ctx.fillRect(-20, -20, W + 40, H + 40);
        ctx.restore();
      }
    }

    drawLoot(dt) {
      const ctx = this.ctx;
      for (const p of this.loot || []) {
        if (!p.rest) {
          p.vy += 900 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          if (p.y >= p.ground) {
            p.y = p.ground;
            if (Math.abs(p.vy) < 90) { p.rest = true; p.vy = 0; p.vx = 0; p.vr = 0; }
            else { p.vy *= -0.45; p.vx *= 0.6; p.vr *= 0.5; }
          }
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.fillStyle = 'rgba(0,0,0,.3)';
        ctx.beginPath(); ctx.ellipse(0, p.ground - p.y + 6, p.kind === 'chest' ? 14 : 5, p.kind === 'chest' ? 4 : 2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.rotate(p.rot);
        if (p.kind === 'chest') drawChestIcon(ctx, p.size);
        else {
          ctx.scale(Math.abs(Math.cos(p.spin += dt * 9)) * 0.8 + 0.2, 1);
          ctx.fillStyle = '#ffd23f';
          ctx.strokeStyle = '#a07000';
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#fff3a0';
          ctx.fillRect(-1, -3, 2, 6);
        }
        ctx.restore();
      }
    }

    // Cadre du HUD : fond sombre avec une barre néon à gauche.
    hudBox(x, y, w, h, color) {
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = 'rgba(8, 5, 28, .72)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.fillRect(x, y, 3, h);
      ctx.restore();
    }

    // Annonces de séries (une à la fois, au centre en haut).
    drawAnnounces(dt) {
      const a = this.announces[0];
      if (!a) return;
      a.age += dt;
      a.life -= dt;
      const pop = a.age < 0.18 ? 0.6 + (a.age / 0.18) * 0.6 : 1.2 - Math.min(0.2, (a.age - 0.18) * 1.2);
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, a.life * 2));
      ctx.translate(W / 2, 140);
      ctx.scale(pop, pop);
      ctx.translate(-W / 2, -140);
      this.title(a.text, 130, 64, a.color, a.color);
      this.title(a.sub, 190, a.subSize || 30, '#ffffff');
      ctx.restore();
      if (a.life <= 0) this.announces.shift();
    }

    drawResult(t) {
      const r = this.queue && this.queue.result;
      if (!r) return;
      if (r.mode === 'boss' || r.mode === 'dungeon') { this.drawCoopResult(t, r); return; }
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(0, 0, W, H);
      if (r.winner) {
        const s = 1 + Math.sin(t / 300) * 0.03;
        ctx.save();
        ctx.translate(W / 2, 150);
        ctx.scale(s, s);
        ctx.translate(-W / 2, -150);
        this.title('🏆 VICTOIRE ROYALE 🏆', 150, 56, '#ffc21a', '#ff9a00');
        ctx.restore();
        this.title(r.winner.name, 240, 64, '#fff', '#ff3fd8');
        this.title(`${r.winner.kills} kill(s) · +${Rules.REWARDS.win.xp} XP · +${Rules.REWARDS.win.chests} coffre · +${Rules.REWARDS.win.gold} golds`, 305, 24, '#cfc6ff');
        const fighter = this.frame && this.frame.fighters.find((f) => f.key === r.winner.key);
        if (fighter) drawFighter(ctx, W / 2, 420, fighter, { scale: 3, bob: Math.sin(t / 300) * 4, swing: (Math.sin(t / 500) + 1) / 2 });
      }
      const top = r.ranking.slice(1, 6);
      top.forEach((p, i) => {
        this.label(`#${p.rank}  ${p.name}  —  ${p.kills} kill(s)`, W / 2, 540 + i * 30, 18, '#ddd');
      });
      const br = this.queue.bets && this.queue.bets.lastResult;
      if (br) {
        const text = br.refund
          ? `💰 Personne n'avait parié sur le gagnant : ${br.pool} golds remboursés`
          : `💰 ${br.winners > 1 ? br.winners + ' parieurs se partagent' : '1 parieur remporte'} ${br.distributed} golds !`;
        this.label(text, W / 2, 700, 20, '#ffb000');
      }
    }

    // Écran de fin des modes coopératifs : victoire / défaite commune, récompense et meilleurs combattants.
    drawCoopResult(t, r) {
      const ctx = this.ctx;
      // Victoire contre le Troll : on laisse d'abord l'explosion et la pluie de butin se jouer.
      let a = 1;
      if (r.mode === 'boss' && r.victory && this.bossDeath) a = Math.max(0, Math.min(1, (this.bossDeath.t - 2.8) / 0.6));
      if (a <= 0) return;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(0, 0, W, H);
      const s = 1 + Math.sin(t / 300) * 0.03;
      ctx.save();
      ctx.translate(W / 2, 130);
      ctx.scale(s, s);
      ctx.translate(-W / 2, -130);
      if (r.mode === 'boss') {
        if (r.victory) this.title('🏆 LE TROLL EST VAINCU ! 🏆', 130, 54, '#ffc21a', '#ff9a00');
        else this.title('💀 LE TROLL A GAGNÉ…', 130, 54, '#ff4d6d', '#ff2a2a');
      } else {
        this.title(`🏰 FIN DU RAID : SALLE ${r.room}`, 130, 54, '#5fd3ff', '#29e7ff');
      }
      ctx.restore();

      let sub;
      if (r.mode === 'boss') {
        sub = r.victory
          ? `Victoire collective en ${formatCountdown(r.duration * 1000)} !`
          : `Il lui restait ${Math.round((r.boss.hp / r.boss.maxHp) * 100)} % de vie. Personne ne gagne de récompense.`;
      } else {
        sub = r.room > 1 ? `${r.room - 1} salle${r.room > 2 ? 's' : ''} nettoyée${r.room > 2 ? 's' : ''} avant la chute de l'équipe.` : 'L\'équipe est tombée dès la première salle…';
      }
      this.title(sub, 205, 26, '#fff', '#b83cff');
      if (r.reward) {
        const gains = [r.reward.chests ? `+${r.reward.chests} coffre${r.reward.chests > 1 ? 's' : ''}` : '', `+${r.reward.xp} XP`, `+${r.reward.gold} golds`].filter(Boolean).join(' · ');
        this.title(`🎁 Pour TOUS les participants : ${gains}`, 265, 28, '#3ddc5a', '#3ddc5a');
      } else if (r.mode === 'dungeon') {
        this.title('Il faut atteindre la salle 5 pour décrocher une récompense.', 265, 24, '#cfc6ff', '#b83cff');
      }
      this.title(`+${Rules.REWARDS.participation.xp} XP de participation pour chacun`, 312, 20, '#cfc6ff', '#29e7ff');

      // Meilleurs combattants (dégâts infligés)
      this.title('⚔️ Meilleurs dégâts', 380, 24, '#ffc21a', '#ff9a00');
      r.ranking.slice(0, 5).forEach((p, i) => {
        const medal = ['🥇', '🥈', '🥉'][i] || `#${i + 1}`;
        this.label(`${medal}  ${p.name}  —  ${p.dealt.toLocaleString('fr-FR')} dégâts · ${p.kills} kill(s)${p.alive ? '' : '  ☠'}`, W / 2, 425 + i * 32, 19, i === 0 ? '#ffe27a' : '#ddd');
      });
      ctx.restore();
    }
  }

  window.ArenaView = ArenaView;
})();
