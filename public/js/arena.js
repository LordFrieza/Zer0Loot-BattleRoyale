/*
 * Rendu de l'arène : file d'attente, combat en direct, écran de victoire.
 * Utilisé par la page admin et par /arena.html (source navigateur OBS).
 */
(function () {
  const W = 1280;
  const H = 720;
  const FIGHTER_SCALE = 1.25;

  function classIcon(cls) {
    const ci = window.Rules && Rules.CLASS_INFO[cls];
    return ci ? ci.icon + ' ' : '';
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
      this.loadImages();
      this.lastHitSound = 0;
      socket.on('queue', (q) => this.onQueue(q));
      socket.on('frame', (f) => this.onFrame(f));
      requestAnimationFrame((t) => this.loop(t));
    }

    // Sol de l'arène : parquet Zer0Loot assombri, grille néon, emblème au centre et cadre lumineux.
    // Dessiné une première fois sans images, puis redessiné quand le fond et le logo sont chargés.
    makeBackground() {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.7);
      grad.addColorStop(0, '#241650');
      grad.addColorStop(1, '#0a0620');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      if (this.floorImg) {
        // « cover » : l'image (3:1) est agrandie pour couvrir tout le 16:9
        const k = Math.max(W / this.floorImg.width, H / this.floorImg.height);
        const iw = this.floorImg.width * k;
        const ih = this.floorImg.height * k;
        g.drawImage(this.floorImg, (W - iw) / 2, (H - ih) / 2, iw, ih);
        g.fillStyle = 'rgba(10, 6, 32, .5)';
        g.fillRect(0, 0, W, H);
      }
      // grille néon
      g.strokeStyle = 'rgba(41, 231, 255, .06)';
      g.lineWidth = 1;
      for (let x = 0; x < W; x += 64) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
      for (let y = 0; y < H; y += 64) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }
      // cercle central et emblème
      g.save();
      g.shadowColor = '#ff3fd8';
      g.shadowBlur = 18;
      g.strokeStyle = 'rgba(255, 63, 216, .28)';
      g.lineWidth = 3;
      g.beginPath(); g.arc(W / 2, H / 2, 190, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(41, 231, 255, .16)';
      g.lineWidth = 2;
      g.beginPath(); g.arc(W / 2, H / 2, 205, 0, Math.PI * 2); g.stroke();
      g.restore();
      if (this.logoImg) {
        const lh = 260;
        const lw = lh * this.logoImg.width / this.logoImg.height;
        g.globalAlpha = 0.13;
        g.drawImage(this.logoImg, W / 2 - lw / 2, H / 2 - lh / 2, lw, lh);
        g.globalAlpha = 1;
      }
      // vignette
      const v = g.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,.6)');
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
      // cadre néon
      g.save();
      const frame = g.createLinearGradient(0, 0, W, H);
      frame.addColorStop(0, '#29e7ff');
      frame.addColorStop(0.5, '#b83cff');
      frame.addColorStop(1, '#ff3fd8');
      g.strokeStyle = frame;
      g.shadowColor = '#b83cff';
      g.shadowBlur = 16;
      g.lineWidth = 4;
      g.strokeRect(4, 4, W - 8, H - 8);
      g.restore();
      return c;
    }

    loadImages() {
      const load = (src, key) => {
        const img = new Image();
        img.onload = () => { this[key] = img; this.bg = this.makeBackground(); };
        img.src = src;
      };
      load('/img/fond.webp', 'floorImg');
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
        if (q.phase === 'battle') Sound.music.start();
        return;
      }
      if (q.phase === 'battle' && prev.phase !== 'battle') {
        const fanfare = Sound.play('battleStart');
        Sound.music.start(Math.max(0, fanfare - 0.25));
        const ev = q.event && Rules.BATTLE_EVENTS[q.event];
        if (ev) {
          this.announces.push({ text: `${ev.icon} ${ev.label.toUpperCase()} !`, sub: ev.desc, subSize: 20, color: ev.color, life: 4, age: 0 });
          setTimeout(() => Sound.play('eventStart', q.event), Math.max(0, fanfare * 1000 - 200));
        }
      } else if (prev.phase === 'battle' && q.phase !== 'battle') {
        Sound.music.stop();
        if (q.phase === 'ended') setTimeout(() => Sound.play('victory'), 350);
      }
      if (q.phase === 'queue' && prev.phase !== 'queue') Sound.play('queueOpen');
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
      }
      this.frame = f;
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
        if (window.Sound && e.t === 'kill') Sound.play('kill');
        // Projectiles (archer, mage) : purement visuels, les dégâts sont déjà calculés.
        if ((e.t === 'hit' || e.t === 'dodge') && e.proj && from && to) {
          this.projectiles.push({ x0: from.x, y0: from.y - 12, x1: to.x, y1: to.y - 12, t: 0, dur: e.proj === 'fire' ? 0.25 : 0.16, kind: e.proj });
          const now = performance.now();
          if (window.Sound && now - this.lastShotSound > 110) { this.lastShotSound = now; Sound.play('shoot', e.proj); }
        }
        if (e.t === 'aoe') {
          this.blasts.push({ x: e.x, y: e.y - 8, r: e.r, life: 0.5 });
          if (window.Sound) Sound.play('blast');
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
          this.floaters.push({ x: to.x, y: to.y - 50, text: '💀', color: '#fff', life: 1.4, size: 28 });
          this.feed.unshift({
            text: from ? `${from.name}  ⚔  ${to.name}` : `☠ ${to.name} (zone)`,
            life: 7,
          });
          this.feed = this.feed.slice(0, 7);
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
      ctx.drawImage(this.bg, 0, 0);
      const phase = (this.queue && this.queue.phase) || 'idle';

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
      // Même place et même taille que l'emblème du sol, qu'il recouvre exactement.
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
      if (phase === 'queue') {
        const pulse = 1 + Math.sin(t / 250) * 0.04;
        this.ctx.save();
        this.ctx.translate(W / 2, 90);
        this.ctx.scale(pulse, pulse);
        this.ctx.translate(-W / 2, -90);
        this.title('TAPEZ !join DANS LE CHAT', 90, 60, '#fff', '#b83cff', W - 360);
        this.ctx.restore();
        const left = q.queueEndsAt ? q.queueEndsAt - Date.now() : 0;
        this.title(formatCountdown(left), 175, 56, left < 10000 ? '#ff4d6d' : '#ffc21a', left < 10000 ? '#ff4d6d' : '#ff9a00');
      } else {
        this.title('FILE FERMÉE', 90, 60, '#fff', '#b83cff', W - 360);
        this.title('La bataille va commencer !', 170, 32, '#ffc21a', '#ff9a00');
      }
      this.drawLogo(100, 80, 110);
      const pot = q.bets && q.bets.pool ? `   ·   💰 ${q.bets.pool} golds pariés sur le site` : '';
      this.title(`${n} combattant${n > 1 ? 's' : ''}${pot}`, 235, 26, '#cfc6ff');

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
        ctx.fillStyle = 'rgba(255, 30, 110, 0.22)';
        ctx.beginPath();
        ctx.rect(0, 0, W, H);
        ctx.arc(f.storm.x, f.storm.y, f.storm.r, 0, Math.PI * 2, true);
        ctx.fill('evenodd');
        ctx.strokeStyle = `rgba(255, 90, 170, ${0.6 + Math.sin(t / 150) * 0.3})`;
        ctx.shadowColor = '#ff3fd8';
        ctx.shadowBlur = 16;
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

      // Morts d'abord (au sol)
      for (const fi of order) {
        if (fi.alive) continue;
        const d = this.disp.get(fi.key);
        d.deathT = Math.min(1, d.deathT + dt * 2);
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.translate(d.x, d.y);
        ctx.rotate(d.deathT * Math.PI / 2 * (d.facing || 1));
        drawFighter(ctx, 0, 0, fi, { scale: FIGHTER_SCALE, facing: d.facing });
        ctx.restore();
      }

      for (const fi of order) {
        if (!fi.alive) continue;
        const d = this.disp.get(fi.key);
        d.x += (fi.x - d.x) * k;
        d.y += (fi.y - d.y) * k;
        const target = byKey.get(fi.target);
        if (target) d.facing = target.x >= d.x ? 1 : -1;
        d.flash = Math.max(0, d.flash - dt * 5);
        d.swing = Math.max(0, d.swing - dt * 4);
        const swing = d.swing > 0 ? Math.sin((1 - d.swing) * Math.PI) : 0;
        const moving = Math.hypot(fi.x - d.x, fi.y - d.y) > 0.5;
        const bob = moving ? Math.abs(Math.sin(t / 90 + fi.x)) * -3 : Math.sin(t / 400 + fi.y) * 1;
        const lunge = swing * 6 * d.facing;
        drawFighter(ctx, d.x + lunge, d.y, fi, { scale: FIGHTER_SCALE, facing: d.facing, flash: d.flash, swing, bob });

        // Pseudo, titre et barre de vie (dessinés après le brouillard ; cachés dedans)
        if (!fi.hidden) labels.push({ fi, x: d.x, y: d.y });
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
        const bw = 40;
        const ratio = fi.hp / fi.maxHp;
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
        const y = p.y0 + (p.y1 - p.y0) * k - Math.sin(k * Math.PI) * (p.kind === 'arrow' ? 18 : 8);
        const ang = Math.atan2(p.y1 - p.y0, p.x1 - p.x0);
        ctx.save();
        ctx.translate(x, y);
        if (p.kind === 'arrow') {
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
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.max(0, b.life * 2);
        const g = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, b.r * (0.5 + k * 0.6));
        g.addColorStop(0, 'rgba(255,240,180,.9)'); g.addColorStop(0.5, 'rgba(255,120,20,.6)'); g.addColorStop(1, 'rgba(255,40,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (0.5 + k * 0.6), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      this.blasts = this.blasts.filter((b) => b.life > 0);

      // Textes flottants
      for (const fl of this.floaters) {
        fl.y -= 40 * dt; fl.life -= dt;
        ctx.globalAlpha = Math.max(0, Math.min(1, fl.life * 1.5));
        this.label(fl.text, fl.x, fl.y, fl.size, fl.color);
      }
      ctx.globalAlpha = 1;
      this.floaters = this.floaters.filter((fl) => fl.life > 0);

      // HUD
      const alive = f.fighters.filter((x) => x.alive).length;
      this.hudBox(16, 16, 230, 64, '#29e7ff');
      ctx.textAlign = 'left';
      ctx.font = '900 26px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(`👥 ${alive} en vie`, 30, 38);
      ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = f.storm && f.storm.active ? '#ff8fc8' : '#cfc6ff';
      const time = Math.floor(f.time);
      ctx.fillText(`⏱ ${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}${f.storm && f.storm.active ? '  ⚡ la zone se referme' : ''}`, 30, 66);
      let hudY = 84;
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
  }

  window.ArenaView = ArenaView;
})();
