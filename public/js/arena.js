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
  /*
   * Ambiances du donjon, une toutes les 5 salles (voir Rules.DUNGEON_THEMES) :
   * cachots, crypte (flammes vertes, toiles), forges (lave), abysses (yeux dans le noir), néant.
   */
  const DUNGEON_PALETTES = [
    { base: '#211d26', floor: [255, 8, 15], wall: [260, 10, 11], moss: 'rgba(90,140,70,.25)', bones: 0.35, glow: '255,170,60', flame: ['#fff3c0', '#ffa030', 'rgba(255,60,0,0)'], vignette: 0.72 },
    { base: '#141a16', floor: [140, 9, 12], wall: [150, 10, 8], moss: 'rgba(110,190,90,.3)', bones: 0.6, glow: '90,255,120', flame: ['#e6ffd0', '#5cff7a', 'rgba(0,160,40,0)'], vignette: 0.8, extra: 'webs' },
    { base: '#1f0e0a', floor: [12, 22, 11], wall: [8, 28, 8], moss: null, bones: 0.25, glow: '255,110,40', flame: ['#fff3c0', '#ff6a20', 'rgba(255,40,0,0)'], vignette: 0.74, extra: 'lava' },
    { base: '#070b18', floor: [222, 28, 8], wall: [228, 30, 6], moss: null, bones: 0.3, glow: '80,150,255', flame: ['#e0f4ff', '#3fa0ff', 'rgba(0,60,255,0)'], vignette: 0.88, extra: 'eyes' },
    { base: '#08040e', floor: [285, 26, 6], wall: [285, 30, 3], moss: null, bones: 0, glow: '200,80,255', flame: ['#ffe0ff', '#c040ff', 'rgba(120,0,255,0)'], vignette: 0.92, extra: 'void' },
  ];
  // Les boss sont dessinés plus grands que les combattants ; lift : décalage pour que leurs pieds touchent le sol.
  const BOSS_DRAW = { troll: { scale: 1.35, lift: 40 }, dragon: { scale: 1.2, lift: 34 }, sorcier: { scale: 1.25, lift: 26 } };
  const FLY_HEIGHT = 150; // le Dragon en vol plane au-dessus de son ombre
  const isBossKind = (f) => !!BOSS_DRAW[f.kind];

  function classIcon(cls) {
    const ci = window.Rules && Rules.CLASS_INFO[cls];
    return ci ? ci.icon + ' ' : '';
  }

  // Monstre du donjon ou créature d'un boss (les boss et les illusions du Magicien sont traités à part).
  function isMonster(f) {
    return !!f.kind && f.kind !== 'player' && !isBossKind(f);
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
      this.beams = []; // flèches perforantes
      this.pillars = []; // colonnes de lumière (Prière, Châtiment, Rempart)
      this.slashes = []; // entailles (Exécution)
      this.announces = []; // « PREMIER KILL ! », « DOUBLE KILL ! »…
      this.lastShotSound = 0;
      this.last = performance.now();
      this.bg = this.makeBackground();
      this.dungeonBgs = []; // une image de fond par ambiance, créée à la demande
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
    makeDungeonBackground(theme = 0) {
      const P = DUNGEON_PALETTES[theme] || DUNGEON_PALETTES[0];
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      let seed = 11 + theme * 101;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      g.fillStyle = P.base;
      g.fillRect(0, 0, W, H);
      // dalles irrégulières
      const rowH = 46;
      for (let y = WALL_H, row = 0; y < H; y += rowH, row++) {
        let x = row % 2 ? -30 : 0;
        while (x < W) {
          const w = 70 + rnd() * 50;
          const l = P.floor[2] + rnd() * 8;
          g.fillStyle = `hsl(${P.floor[0] + rnd() * 20}, ${P.floor[1]}%, ${l}%)`;
          g.fillRect(x + 2, y + 2, w - 4, rowH - 4);
          g.fillStyle = 'rgba(255,255,255,.04)';
          g.fillRect(x + 2, y + 2, w - 4, 3);
          if (rnd() < 0.18) { // fissure
            g.strokeStyle = 'rgba(0,0,0,.45)';
            g.beginPath(); g.moveTo(x + w * 0.3, y + 6); g.lineTo(x + w * 0.45, y + rowH * 0.5); g.lineTo(x + w * 0.38, y + rowH - 6); g.stroke();
          }
          if (P.moss && rnd() < 0.1) { // mousse
            g.fillStyle = P.moss;
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
        g.fillStyle = `rgba(220,210,190,${P.bones})`;
        g.fillRect(-8, -1.5, 16, 3);
        g.beginPath(); g.arc(-8, 0, 2.6, 0, Math.PI * 2); g.arc(8, 0, 2.6, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      // Forges : fissures de lave sur le sol
      if (P.extra === 'lava') {
        g.save();
        g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 14; i++) {
          let x = rnd() * W;
          let y = WALL_H + rnd() * (H - WALL_H);
          g.strokeStyle = `rgba(255,${90 + rnd() * 60},20,.55)`;
          g.lineWidth = 2 + rnd() * 2;
          g.shadowColor = '#ff5a00';
          g.shadowBlur = 12;
          g.beginPath(); g.moveTo(x, y);
          for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 90; y += (rnd() - 0.5) * 50; g.lineTo(x, y); }
          g.stroke();
        }
        g.restore();
      }
      // Néant : le sol se dissout dans le vide étoilé
      if (P.extra === 'void') {
        const fade = g.createRadialGradient(W / 2, H / 2 + 40, 150, W / 2, H / 2 + 40, W * 0.6);
        fade.addColorStop(0, 'rgba(8,4,14,0)');
        fade.addColorStop(1, 'rgba(8,4,14,.95)');
        g.fillStyle = fade;
        g.fillRect(0, 0, W, H);
        for (let i = 0; i < 160; i++) {
          g.fillStyle = `rgba(${200 + rnd() * 55},${150 + rnd() * 100},255,${0.2 + rnd() * 0.6})`;
          g.fillRect(rnd() * W, rnd() * H, 1.5, 1.5);
        }
      }
      // mur du fond (absent dans le Néant)
      if (P.extra !== 'void') {
        g.fillStyle = `hsl(${P.wall[0]}, ${P.wall[1]}%, ${P.wall[2] - 3}%)`;
        g.fillRect(0, 0, W, WALL_H);
        for (let y = 0, row = 0; y < WALL_H; y += 22, row++) {
          for (let x = row % 2 ? -24 : 0; x < W; x += 48) {
            g.fillStyle = `hsl(${P.wall[0]}, ${P.wall[1]}%, ${P.wall[2] + rnd() * 6}%)`;
            g.fillRect(x + 1.5, y + 1.5, 45, 19);
          }
        }
      }
      // Crypte : toiles d'araignée dans les coins
      if (P.extra === 'webs') {
        g.strokeStyle = 'rgba(220,230,220,.22)';
        g.lineWidth = 1;
        for (const [cx, sx] of [[0, 1], [W, -1]]) {
          for (let a = 0; a <= 5; a++) {
            const ang = (a / 5) * Math.PI / 2;
            g.beginPath(); g.moveTo(cx, WALL_H); g.lineTo(cx + sx * Math.cos(ang) * 150, WALL_H + Math.sin(ang) * 150); g.stroke();
          }
          for (let r = 30; r <= 150; r += 30) {
            g.beginPath();
            for (let a = 0; a <= 5; a++) {
              const ang = (a / 5) * Math.PI / 2;
              const px = cx + sx * Math.cos(ang) * r;
              const py = WALL_H + Math.sin(ang) * r;
              if (a) g.quadraticCurveTo(cx + sx * Math.cos(ang - 0.15) * r * 0.85, WALL_H + Math.sin(ang - 0.15) * r * 0.85, px, py); else g.moveTo(px, py);
            }
            g.stroke();
          }
        }
      }
      const wallShade = g.createLinearGradient(0, WALL_H - 10, 0, WALL_H + 26);
      wallShade.addColorStop(0, 'rgba(0,0,0,.6)');
      wallShade.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = wallShade;
      g.fillRect(0, WALL_H - 10, W, 36);
      // supports de torches
      for (const tx of P.extra === 'void' ? [] : TORCHES) {
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
      v.addColorStop(1, `rgba(0,0,0,${P.vignette})`);
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
      return c;
    }

    dungeonBackground(theme) {
      if (!this.dungeonBgs[theme]) this.dungeonBgs[theme] = this.makeDungeonBackground(theme);
      return this.dungeonBgs[theme];
    }

    // Flammes des torches du donjon (animées), aux couleurs de l'ambiance ; yeux dans le noir aux Abysses.
    drawTorches(t, theme = 0) {
      const P = DUNGEON_PALETTES[theme] || DUNGEON_PALETTES[0];
      const ctx = this.ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (P.extra === 'eyes') {
        // paires d'yeux qui clignent sur les bords
        [[70, 260], [1210, 330], [40, 560], [1240, 610], [620, 30], [980, 40]].forEach(([x, y], i) => {
          const open = Math.sin(t / 900 + i * 1.7) > -0.85;
          if (!open) return;
          ctx.fillStyle = `rgba(${i % 2 ? '255,60,60' : '255,220,90'},${0.55 + Math.sin(t / 300 + i) * 0.2})`;
          ctx.beginPath(); ctx.ellipse(x - 6, y, 3, 1.6, 0, 0, Math.PI * 2); ctx.ellipse(x + 6, y, 3, 1.6, 0, 0, Math.PI * 2); ctx.fill();
        });
      }
      const torches = P.extra === 'void'
        ? [[180, 120 + Math.sin(t / 700) * 20], [1100, 140 + Math.cos(t / 800) * 20], [640, 60 + Math.sin(t / 600) * 10]] // flammes flottantes
        : TORCHES.map((x) => [x, 26]);
      torches.forEach(([tx, ty], i) => {
        const fl = 1 + Math.sin(t / 90 + i * 2) * 0.12 + Math.sin(t / 37 + i) * 0.06;
        const glow = ctx.createRadialGradient(tx, ty, 4, tx, ty + 14, 150 * fl);
        glow.addColorStop(0, `rgba(${P.glow},.35)`);
        glow.addColorStop(1, `rgba(${P.glow},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(tx, ty + 14, 150 * fl, 0, Math.PI * 2); ctx.fill();
        const flame = ctx.createRadialGradient(tx, ty - 4, 1, tx, ty - 4, 12 * fl);
        flame.addColorStop(0, P.flame[0]);
        flame.addColorStop(0.5, P.flame[1]);
        flame.addColorStop(1, P.flame[2]);
        ctx.fillStyle = flame;
        ctx.beginPath(); ctx.ellipse(tx, ty - 6, 7 * fl, 13 * fl, 0, 0, Math.PI * 2); ctx.fill();
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
        if (q.mode === 'gold') {
          this.announces.push({ text: '🎉 BONUS GAME ! 🎉', sub: 'Ruée vers l\'or : ramassez un max de pièces et de coffres !', subSize: 24, color: '#ffd23f', life: 3.5, age: 0 });
        }
        if (q.mode === 'clans') {
          this.announces.push({ text: '⚔️ GUERRE DES CLANS !', sub: '🔴 Rouges contre Bleus 🔵 : détruisez le cristal adverse !', subSize: 24, color: '#ff6b9a', life: 3.5, age: 0 });
        }
        if (q.mode === 'koth') {
          this.announces.push({ text: '👑 ROI DE LA COLLINE !', sub: 'Tenez la colline pour marquer des points. Seul dessus, c\'est ×3 !', subSize: 24, color: '#ffd23f', life: 3.5, age: 0 });
        }
        if (q.mode === 'boss') {
          const B = Rules.BOSSES[q.boss] || Rules.BOSS;
          this.announces.push({ text: `${B.icon} COMBAT DE BOSS !`, sub: `Tous ensemble contre ${B.name} !`, subSize: 26, color: B.color, life: 3.5, age: 0 });
          setTimeout(() => Sound.play('roar', true), Math.max(0, fanfare * 1000 - 300));
        }
      } else if (prev.phase === 'battle' && q.phase !== 'battle') {
        Sound.music.stop();
        const r = q.result;
        if (q.phase !== 'ended' || !r) return;
        if (r.mode === 'boss' && r.victory) setTimeout(() => Sound.play('victory'), 2600); // après l'explosion du boss
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
        this.projectiles = []; this.blasts = []; this.beams = []; this.pillars = []; this.slashes = [];
        this.bossDeath = null; this.loot = []; this.bossHpShown = null;
        this.coins = new Map(); this.flyingCoins = []; this.confetti = [];
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
          this.projectiles.push({ x0: from.x, y0: from.y - (from.kind === 'cristal_clan' ? 50 : 12), x1: to.x, y1: to.y - 12, t: 0, dur: e.proj === 'fire' || e.proj === 'shadow' ? 0.3 : 0.16, kind: e.proj, color: from.clan && Rules.CLANS.teams[from.clan].color });
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
          if (e.kind === 'void') {
            this.blasts.push({ x: e.x, y: e.y, r: e.r, life: 0.5, color: 'void' });
            this.spark(e.x, e.y, '#b06bff', 30);
            if (window.Sound) Sound.play('voidBlast');
          } else if (e.kind === 'cone' || e.kind === 'fireball') {
            if (e.kind === 'fireball') this.blasts.push({ x: e.x, y: e.y, r: e.r * 1.3, life: 0.5 });
            this.spark(e.x, e.y, '#ff6b2a', e.kind === 'cone' ? 20 : 30);
            this.shake = Math.max(this.shake || 0, e.kind === 'cone' ? 0.3 : 0.25);
            if (window.Sound) Sound.play(e.kind === 'cone' ? 'fireBreath' : 'meteor');
          } else {
            this.blasts.push({ x: e.x, y: e.y, r: e.r, life: 0.6, color: 'dust' });
            this.spark(e.x, e.y, '#b89a6a', 50);
            this.spark(e.x, e.y, '#8a8a8a', 20);
            this.shake = Math.max(this.shake || 0, e.kind === 'land' ? 0.8 : 0.5);
            if (window.Sound) Sound.play('slam');
          }
          // Souffle de feu : la gerbe de flammes reste visible un instant
          if (e.kind === 'cone') { const s = (this.frame && this.frame.slams || []).find((x) => x.kind === 'cone'); this.flames = { x: e.x, y: e.y, r: e.r, a: s ? s.a : 0, half: s ? s.half : 0.5, life: 0.6 }; }
        } else if (e.t === 'coins') {
          // Ruée vers l'or : les pièces qui viennent d'apparaître dans le ciel
          const now = performance.now();
          if (!this.coins) this.coins = new Map();
          for (const [id, x, y, v] of e.list) this.coins.set(id, { x, y, v, born: now, seed: id * 1.7 });
        } else if (e.t === 'pick' && to) {
          const c = this.coins && this.coins.get(e.id);
          if (c) {
            this.coins.delete(e.id);
            (this.flyingCoins = this.flyingCoins || []).push({ x: c.x, y: c.y, to: e.to, life: 0.35, v: e.v });
          }
          const now = performance.now();
          if (window.Sound && now - (this.lastCoinSound || 0) > 55) { this.lastCoinSound = now; Sound.play('coin'); }
        } else if (e.t === 'pickChest' && to) {
          this.floaters.push({ x: to.x, y: to.y - 80, text: '🎁 +1 coffre !', color: '#ffd23f', life: 1.6, size: 18 });
          this.spark(to.x, to.y - 20, '#ffd23f', 40);
          if (window.Sound) Sound.play('chestPick');
        } else if (e.t === 'pickItem' && to) {
          const K = Rules.GOLD.items.kinds[e.kind];
          this.floaters.push({ x: to.x, y: to.y - 80, text: `${K.icon} ${K.label}${K.gold ? ` +${K.gold}` : ''} !`, color: '#fff3a0', life: 1.6, size: 17 });
          this.spark(to.x, to.y - 20, '#fff3a0', 30);
          if (window.Sound) Sound.play('itemPick');
        } else if (e.t === 'jackpot') {
          this.announces.push({ text: '💥 JACKPOT ! 💥', sub: 'Pluie de pièces ×3 · chaque pièce vaut 2 golds !', subSize: 26, color: '#ffd23f', life: 3.4, age: 0 });
          this.shake = Math.max(this.shake || 0, 0.6);
          if (window.Sound) Sound.play('jackpot');
        } else if (e.t === 'overtime') {
          this.announces.push({ text: '⚡ MORT SUBITE !', sub: 'Les cristaux subissent 3 fois plus de dégâts !', subSize: 24, color: '#ff4d6d', life: 3, age: 0 });
          this.shake = Math.max(this.shake || 0, 0.5);
          if (window.Sound) Sound.play('roar', false);
        } else if (e.t === 'king' && to) {
          this.floaters.push({ x: to.x, y: to.y - 92, text: '👑 Roi de la colline !', color: '#ffd23f', life: 1.6, size: 15 });
        } else if (e.t === 'hillWarn') {
          this.announces.push({ text: 'LA COLLINE VA BOUGER !', sub: 'Dans 5 secondes : suivez les pointillés !', subSize: 22, color: '#ffd23f', life: 2.2, age: 0 });
        } else if (e.t === 'hillMove') {
          this.spark(e.x, e.y, '#ffd23f', 40);
          if (window.Sound) Sound.play('hillMove');
        } else if (e.t === 'respawn' && to) {
          const dd = this.disp.get(e.to);
          if (dd) { dd.x = e.x; dd.y = e.y; dd.deathT = 0; }
          this.spark(e.x, e.y - 20, '#9ff6ff', 22);
          this.floaters.push({ x: e.x, y: e.y - 70, text: '↻ De retour !', color: '#9ff6ff', life: 1.2, size: 14 });
        } else if (e.t === 'bossFly') {
          const B = this.bossInfo();
          this.announces.push({ text: `🪽 ${B.short.toUpperCase()} S'ENVOLE !`, sub: 'Les tireurs le visent, le corps à corps chasse les flammèches pour le faire tomber !', subSize: 22, color: '#ff9a1f', life: 3.2, age: 0 });
          if (window.Sound) Sound.play('roar', true);
        } else if (e.t === 'bossAway') {
          const B = this.bossInfo();
          this.announces.push({ text: `🥚 ${B.short.toUpperCase()} PART PONDRE !`, sub: `Détruisez les ${e.eggs} œufs avant qu'ils n'éclosent !`, subSize: 24, color: '#ffc21a', life: 3.4, age: 0 });
          if (window.Sound) Sound.play('roar', false);
        } else if (e.t === 'bossReturn') {
          this.announces.push({ text: e.label, sub: e.hatched ? `${e.hatched} dragonnet${e.hatched > 1 ? 's' : ''} ${e.hatched > 1 ? 'ont' : 'a'} éclos !` : 'Tous les œufs ont été détruits !', subSize: 24, color: '#ff4d6d', life: 3, age: 0 });
          this.shake = Math.max(this.shake || 0, 0.6);
          if (window.Sound) Sound.play('roar', true);
        } else if (e.t === 'spriteDown') {
          // la flammèche abattue remonte brûler le dragon
          const boss = this.disp.get('boss');
          if (boss) this.beams.push({ path: [{ x: e.x, y: e.y }, { x: boss.x, y: boss.y - FLY_HEIGHT - 20 }], width: 6, color: '#ff9a1f', t: 0, dur: 0.45 });
          this.spark(e.x, e.y - 10, '#ffb347', 18);
        } else if (e.t === 'hatch') {
          this.spark(e.x, e.y - 10, '#ffc46b', 24);
          this.floaters.push({ x: e.x, y: e.y - 40, text: '🐣', color: '#fff', life: 1.4, size: 24 });
        } else if (e.t === 'shieldUp') {
          this.announces.push({ text: '🛡️ BOUCLIER D\'OMBRE !', sub: `Détruisez les ${e.crystals} cristaux pour le briser !`, subSize: 24, color: '#b06bff', life: 3.2, age: 0 });
          if (window.Sound) Sound.play('shieldUp');
        } else if (e.t === 'shieldDown') {
          this.announces.push({ text: 'LE BOUCLIER SE BRISE !', sub: 'À l\'attaque !', subSize: 26, color: '#ffe066', life: 2.4, age: 0 });
          const boss = this.disp.get('boss');
          if (boss) this.spark(boss.x, boss.y - 40, '#d9b3ff', 60);
          if (window.Sound) Sound.play('shieldDown');
        } else if (e.t === 'clones') {
          this.announces.push({ text: '🪞 IL SE DÉDOUBLE !', sub: 'Trouvez le vrai Magicien parmi ses illusions !', subSize: 24, color: '#b06bff', life: 3, age: 0 });
        } else if (e.t === 'blink') {
          const dd = this.disp.get(e.to);
          this.spark(e.fx, e.fy - 40, '#b06bff', 26);
          this.spark(e.x, e.y - 40, '#e3c4ff', 26);
          if (dd) { dd.x = e.x; dd.y = e.y; }
          if (window.Sound) Sound.play('blink');
        } else if (e.t === 'curse' && to) {
          this.floaters.push({ x: to.x, y: to.y - 80, text: '☠️ Maudit !', color: '#c88bff', life: 1.6, size: 15 });
          if (window.Sound) Sound.play('curse');
        } else if (e.t === 'purify' && to) {
          this.floaters.push({ x: to.x, y: to.y - 80, text: '✨ Purifié !', color: '#ffe8a0', life: 1.6, size: 15 });
          this.spark(to.x, to.y - 20, '#fff2a8', 22);
          if (from) this.beams.push({ path: [{ x: from.x, y: from.y - 10 }, { x: to.x, y: to.y - 10 }], width: 5, color: '#ffe8a0', t: 0, dur: 0.5 });
        } else if (e.t === 'vanish') {
          const dd = this.disp.get(e.to);
          if (dd) this.spark(dd.x, dd.y - 20, '#b06bff', 24);
        } else if (e.t === 'bossPhase') {
          this.announces.push({ text: e.label, sub: 'Il frappe plus fort et plus vite !', subSize: 26, color: e.phase > 1 ? '#ff4d6d' : '#ff9a1f', life: 2.8, age: 0 });
          this.shake = Math.max(this.shake || 0, 0.6);
          if (window.Sound) Sound.play('roar', e.phase > 1);
        } else if (e.t === 'bossEnrage') {
          this.announces.push({ text: '🔥 RAGE FINALE !', sub: `${this.bossInfo().short} frappe 3 fois plus fort !`, subSize: 26, color: '#ff2a2a', life: 3, age: 0 });
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
        } else if (e.t === 'ult' && from) {
          this.onUlt(e, from, byKey);
        } else if (e.t === 'potion' && to) {
          const c = Rules.CONSUMABLES[e.id];
          this.floaters.push({ x: to.x, y: to.y - 88, text: `${c.icon} ${c.label} !`, color: c.color, life: 1.8, size: 16 });
          this.spark(to.x, to.y - 20, c.color, 18);
          if (e.fx !== undefined) {
            this.spark(e.fx, e.fy - 10, '#d38bff', 26);
            const dd = this.disp.get(e.to);
            if (dd) { dd.x = to.x; dd.y = to.y; } // pas de glissade : téléportation
          }
          if (window.Sound) Sound.play('potion', e.id);
        } else if (e.t === 'zoneHit') {
          if (e.kind === 'meteor') {
            this.blasts.push({ x: e.x, y: e.y, r: e.r * 1.4, life: 0.5 });
            this.spark(e.x, e.y, '#ff6b2a', 36);
            this.shake = Math.max(this.shake || 0, 0.4);
            if (window.Sound) Sound.play('meteor');
          } else if (e.kind === 'arrow') {
            this.spark(e.x, e.y, '#e8d7b0', 4);
            const now = performance.now();
            if (window.Sound && now - (this.lastArrowSound || 0) > 90) { this.lastArrowSound = now; Sound.play('hit'); }
          }
        } else if (e.t === 'poll') {
          if (window.Sound) Sound.play('pollOpen');
        } else if (e.t === 'pollEnd') {
          const b = Rules.DUNGEON_BOONS[e.id];
          this.announces = [];
          this.announces.push({ text: `${b.icon} ${b.label.toUpperCase()} !`, sub: `Le chat a choisi : ${b.desc}`, subSize: 22, color: b.color, life: 3.6, age: 0 });
          if (window.Sound) Sound.play('pollEnd');
        } else if (e.t === 'revive' && to) {
          const dd = this.disp.get(e.to);
          if (dd) { dd.deathT = 0; dd.x = to.x; dd.y = to.y; }
          this.floaters.push({ x: to.x, y: to.y - 88, text: '👼 De retour !', color: '#fff2a8', life: 2.4, size: 18 });
          this.spark(to.x, to.y - 20, '#fff2a8', 30);
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
          if (to.clone) this.spark(to.x, to.y - 40, '#b06bff', 30);
          else if (!isBossKind(to) && to.kind !== 'oeuf' && to.kind !== 'cristal') this.floaters.push({ x: to.x, y: to.y - 50, text: '💀', color: '#fff', life: 1.4, size: 28 });
          // En coopération, le fil n'affiche que les aventuriers tombés et les chefs vaincus.
          let text = null;
          const ci = (x) => (x && x.clan ? Rules.CLANS.teams[x.clan].icon + ' ' : '');
          if (to.kind === 'cristal_clan') text = `💥 ${to.name} est détruit !`;
          else if (f.mode === 'br' || f.mode === 'koth' || f.mode === 'clans' || !f.mode) text = from ? `${ci(from)}${from.name}  ⚔  ${ci(to)}${to.name}` : `☠ ${to.name} (zone)`;
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
      const theme = dungeon && this.frame && this.frame.dungeon ? Rules.dungeonTheme(this.frame.dungeon.room) : 0;
      ctx.drawImage(dungeon ? this.dungeonBackground(theme) : this.bg, 0, 0);
      if (dungeon) this.drawTorches(t, theme);
      if (phase !== 'idle' && this.queue && this.queue.mode === 'gold') this.drawGoldSky(t);

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
      const training = this.queue && this.queue.training;
      this.title(training ? 'ENTRAÎNEMENT' : 'BATTLE ROYALE', H / 2 + 185, 46, '#fff', '#ff3fd8');
      this.ctx.globalAlpha = 0.6 + Math.sin(t / 500) * 0.3;
      this.title(training ? 'Choisis un adversaire et lance le duel' : 'En attente du prochain combat…', H / 2 + 245, 24, '#cfc6ff', '#29e7ff');
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
        this.title(q.mode === 'clans' ? 'TAPEZ !rouge OU !bleu' : 'TAPEZ !join DANS LE CHAT', 70, 56, '#fff', '#b83cff', W - 360);
        this.ctx.restore();
        const left = q.queueEndsAt ? q.queueEndsAt - Date.now() : 0;
        this.title(formatCountdown(left), 188, 50, left < 10000 ? '#ff4d6d' : '#ffc21a', left < 10000 ? '#ff4d6d' : '#ff9a00');
      } else {
        this.title('FILE FERMÉE', 70, 56, '#fff', '#b83cff', W - 360);
        this.title(q.mode === 'br' || q.mode === 'koth' ? 'La bataille va commencer !' : 'L\'aventure va commencer !', 188, 30, '#ffc21a', '#ff9a00');
      }
      // Mode de jeu choisi par le streamer
      const QB = q.mode === 'boss' && Rules.BOSSES[q.boss];
      if (QB) this.title(`${QB.icon} COMBAT DE BOSS : ${QB.name.toUpperCase()}`, 128, 30, QB.color, QB.color, W - 360);
      else this.title(`${mode.icon} MODE : ${mode.label.toUpperCase()}`, 128, 30, mode.color, mode.color, W - 360);
      this.drawLogo(100, 80, 110);
      const pot = q.bets && q.bets.pool ? `   ·   💰 ${q.bets.pool} golds pariés sur le site` : '';
      const who = q.mode === 'dungeon' ? 'aventurier' : 'combattant';
      if (q.mode === 'clans') {
        const cnt = (c) => q.participants.filter((p) => p.clan === c).length;
        this.title(`🔴 ${cnt('rouge')} Rouges   ⚔   ${cnt('bleu')} Bleus 🔵${pot}`, 240, 24, '#cfc6ff');
      } else this.title(`${n} ${who}${n > 1 ? 's' : ''}${pot}`, 240, 24, '#cfc6ff');

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
        this.label((p.clan ? Rules.CLANS.teams[p.clan].icon + ' ' : '') + classIcon(p.cls) + p.name, x, y + 32 * scale, 13, p.clan ? shade(Rules.CLANS.teams[p.clan].color, 0.45) : '#fff');
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

      // Attaques spéciales des boss : zone d'impact au sol qui se remplit (cercle, ou cône pour le souffle du Dragon)
      for (const s of f.slams || []) {
        const blink = 0.55 + Math.sin(t / 60) * 0.3;
        const rgb = s.kind === 'void' ? '170,80,255' : s.kind === 'rock' ? '255,150,40' : '255,60,40';
        ctx.save();
        ctx.strokeStyle = `rgba(${rgb},${blink})`;
        ctx.lineWidth = 4;
        ctx.setLineDash([12, 8]);
        if (s.kind === 'cone') {
          ctx.translate(s.x, s.y + 10);
          ctx.scale(1, 0.75);
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, s.r, s.a - s.half, s.a + s.half); ctx.closePath(); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = `rgba(255,90,20,${0.1 + s.p * 0.35})`;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, s.r * s.p, s.a - s.half, s.a + s.half); ctx.closePath(); ctx.fill();
        } else {
          ctx.beginPath(); ctx.ellipse(s.x, s.y + 10, s.r, s.r * 0.75, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = s.kind === 'void' ? `rgba(110,30,200,${0.15 + s.p * 0.35})` : `rgba(255,70,30,${0.1 + s.p * 0.3})`;
          ctx.beginPath(); ctx.ellipse(s.x, s.y + 10, s.r * s.p, s.r * 0.75 * s.p, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
      // Souffle de feu qui vient de partir
      if (this.flames) {
        const fl = this.flames;
        fl.life -= dt;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(fl.x, fl.y + 10);
        ctx.scale(1, 0.75);
        const g = ctx.createRadialGradient(0, 0, 10, 0, 0, fl.r);
        g.addColorStop(0, `rgba(255,240,170,${fl.life})`);
        g.addColorStop(0.5, `rgba(255,120,30,${fl.life})`);
        g.addColorStop(1, 'rgba(255,40,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, fl.r, fl.a - fl.half, fl.a + fl.half); ctx.closePath(); ctx.fill();
        ctx.restore();
        if (fl.life <= 0) this.flames = null;
      }

      if (f.koth) this.drawHill(f, t);
      if (f.clans) this.drawBases(t);
      if (f.gold) this.drawGoldLoot(f, t, 'ground');
      this.drawZones(f.zones || [], t, 'ground');
      // Morts d'abord (au sol)
      for (const fi of order) {
        if (fi.alive) continue;
        const d = this.disp.get(fi.key);
        if (!d) continue;
        if (fi.key === 'boss') { this.drawBossDeath(dt, t, d, fi); continue; }
        if (fi.clone || fi.kind === 'oeuf' || fi.kind === 'cristal') continue; // illusions, œufs et cristaux disparaissent
        d.deathT = Math.min(1, d.deathT + dt * 2);
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.translate(d.x, d.y);
        ctx.rotate(d.deathT * Math.PI / 2 * (d.facing || 1));
        if (isMonster(fi)) drawMonster(ctx, 0, 0, fi, { scale: FIGHTER_SCALE, facing: d.facing, t });
        else drawFighter(ctx, 0, 0, fi, { scale: FIGHTER_SCALE, facing: d.facing });
        ctx.restore();
        // Roi de la Colline, Guerre des clans : compte à rebours avant le retour au combat
        if (fi.respawn !== undefined) this.label(`↻ ${Math.ceil(fi.respawn)} s`, d.x, d.y - 40, 13, '#9ff6ff');
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
        d.swing = Math.max(0, d.swing - dt * (isBossKind(fi) ? 2.2 : 4));
        const swing = d.swing > 0 ? Math.sin((1 - d.swing) * Math.PI) : 0;
        const moving = Math.hypot(fi.x - d.x, fi.y - d.y) > 0.5;
        const bob = moving ? Math.abs(Math.sin(t / 90 + fi.x)) * -3 : Math.sin(t / 400 + fi.y) * 1;
        const lunge = swing * 6 * d.facing;
        if (isBossKind(fi)) {
          this.drawBoss(fi, d, f.boss, swing, t, dt);
        } else if (isMonster(fi)) {
          const nest = f.boss && f.boss.timer && f.boss.timer.kind === 'nest' ? f.boss.timer : null;
          const crack = fi.kind === 'oeuf' && nest ? 1 - nest.left / Rules.BOSSES.dragon.nest.duration : 0;
          const color = fi.clan && Rules.CLANS.teams[fi.clan].color;
          drawMonster(ctx, fi.kind === 'cristal_clan' ? d.x : d.x + lunge, fi.kind === 'cristal_clan' ? d.y : d.y, fi, { scale: FIGHTER_SCALE, facing: fi.kind === 'cristal_clan' ? 1 : d.facing, flash: d.flash, swing, bob: fi.kind === 'cristal_clan' ? 0 : bob, t, seed: fi.x, crack, color });
        } else {
          if (fi.clan) {
            ctx.save();
            ctx.strokeStyle = Rules.CLANS.teams[fi.clan].color;
            ctx.fillStyle = Rules.CLANS.teams[fi.clan].color + '40';
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.ellipse(d.x, d.y + 18, 17, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.restore();
          }
          this.drawFx(fi, d.x, d.y, t, 'under');
          const invisible = fi.fx && fi.fx.includes('invisible');
          drawFighter(ctx, d.x + lunge, d.y, fi, { scale: FIGHTER_SCALE, facing: d.facing, flash: d.flash, swing, bob, alpha: invisible ? 0.28 + Math.sin(t / 120) * 0.08 : 1 });
        }
        if (fi.fx) this.drawFx(fi, d.x, d.y, t, 'over');

        // Pseudo, titre et barre de vie (dessinés après le brouillard ; cachés dedans)
        if (!fi.hidden && !isBossKind(fi) && d.x > -20 && d.x < W + 20) labels.push({ fi, x: d.x, y: d.y });
      }

      // Rochers lancés par le Troll, boules de feu crachées par le Dragon en vol
      for (const s of f.slams || []) {
        if ((s.kind !== 'rock' && s.kind !== 'fireball') || s.fx == null) continue;
        const p = Math.min(1, s.p + (performance.now() - this.frameAt) / 1000 / s.w);
        const rx = s.fx + (s.x - s.fx) * p;
        const ry = s.fy + (s.y - s.fy) * p - Math.sin(p * Math.PI) * (s.kind === 'rock' ? 220 : 60);
        ctx.save();
        ctx.translate(rx, ry);
        if (s.kind === 'fireball') {
          ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 20);
          g.addColorStop(0, '#fff3b0'); g.addColorStop(0.45, '#ff8a1f'); g.addColorStop(1, 'rgba(255,40,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          continue;
        }
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

      this.drawZones(f.zones || [], t, 'air');
      this.drawBeams(dt);

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
          if (fi.kind === 'cristal_clan') continue; // sa vie est affichée en haut de l'écran
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
        // Barre de stamina (ultime) juste sous la vie : brille quand elle est presque pleine.
        if (fi.st !== undefined) {
          ctx.fillStyle = 'rgba(0,0,0,.7)';
          ctx.fillRect(x - bw / 2 - 1, y - 42, bw + 2, 4);
          ctx.save();
          if (fi.st > 0.9) { ctx.shadowColor = '#29e7ff'; ctx.shadowBlur = 8 + Math.sin(t / 80) * 4; }
          ctx.fillStyle = fi.st > 0.9 ? '#9ff6ff' : '#29c7ff';
          ctx.fillRect(x - bw / 2, y - 41.5, bw * fi.st, 2.5);
          ctx.restore();
        }
        if (fi.protect) {
          ctx.save();
          ctx.strokeStyle = `rgba(160,240,255,${0.5 + Math.sin(t / 80) * 0.3})`;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y - 12, 30, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        if (f.koth && f.koth.king === fi.key) this.label('👑', x, (fi.title ? y - 67 : y - 58) - 20 + Math.sin(t / 200) * 2, 22, '#ffd23f');
        const nameY = fi.title ? y - 67 : y - 58;
        const icon = fi.spec ? fi.spec.icon + ' ' : classIcon(fi.cls);
        const potion = fi.potion && Rules.CONSUMABLES[fi.potion] ? ' ' + Rules.CONSUMABLES[fi.potion].icon : '';
        const pts = fi.score !== undefined ? ` · ${fi.score} pts` : fi.gold !== undefined ? ` · 🪙 ${fi.gold}${fi.chests ? ` · 🎁${fi.chests}` : ''}` : '';
        this.label(icon + fi.name + potion + (fi.kills ? ` ⚔${fi.kills}` : '') + pts, x, nameY, 12, fi.clan ? shade(Rules.CLANS.teams[fi.clan].color, 0.5) : '#fff');
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
        } else if (p.kind === 'shard') {
          // tir d'un cristal de clan : éclat aux couleurs de l'équipe
          ctx.rotate(ang);
          ctx.fillStyle = p.color || '#fff';
          ctx.shadowColor = p.color || '#fff';
          ctx.shadowBlur = 12;
          ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(0, -4); ctx.lineTo(-10, 0); ctx.lineTo(0, 4); ctx.closePath(); ctx.fill();
        } else if (p.kind === 'shadow') {
          // trait d'ombre du Magicien : orbe violette avec une traînée
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = 'rgba(160,80,255,.45)';
          ctx.lineWidth = 6;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-Math.cos(ang) * 26, -Math.sin(ang) * 26); ctx.stroke();
          const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 13);
          g.addColorStop(0, '#f4dcff'); g.addColorStop(0.45, '#9b59ff'); g.addColorStop(1, 'rgba(60,0,120,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
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
        if (b.color === 'void') {
          // Zone d'ombre du Magicien : implosion violette
          ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, b.r * (1.1 - k * 0.5));
          g.addColorStop(0, 'rgba(240,210,255,.9)'); g.addColorStop(0.5, 'rgba(150,60,255,.6)'); g.addColorStop(1, 'rgba(60,0,140,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (1.1 - k * 0.5), 0, Math.PI * 2); ctx.fill();
        } else if (b.color === 'ice') {
          ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, b.r * (0.4 + k * 0.7));
          g.addColorStop(0, 'rgba(230,250,255,.9)'); g.addColorStop(0.5, 'rgba(120,200,255,.5)'); g.addColorStop(1, 'rgba(60,140,255,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (0.4 + k * 0.7), 0, Math.PI * 2); ctx.fill();
        } else if (b.color === 'dust') {
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
      const heroes = f.fighters.filter((x) => !isMonster(x) && !isBossKind(x));
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
        // Bonus votés par le chat (jusqu'au prochain sondage) et « Quitte ou double »
        const dg = f.dungeon;
        const tags = (dg.boons || []).map((id) => ({ text: `${Rules.DUNGEON_BOONS[id].icon} ${Rules.DUNGEON_BOONS[id].label}`, color: Rules.DUNGEON_BOONS[id].color }));
        const fmt = (m) => String(Math.round(m * 100) / 100).replace('.', ',');
        if (dg.rewardMult > 1) tags.push({ text: `💀 Monstres ×${fmt(dg.monsterMult)} · butin ×${fmt(dg.rewardMult)}`, color: '#9b59ff' });
        ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
        for (const tg of tags) {
          this.hudBox(16, hudY, Math.max(250, ctx.measureText(tg.text).width + 30), 30, tg.color);
          ctx.fillStyle = tg.color;
          ctx.fillText(tg.text, 30, hudY + 21);
          hudY += 34;
        }
      } else if (f.mode === 'gold' && f.gold) {
        this.drawGoldHud(f, t);
        hudY = 90;
      } else if (f.mode === 'clans' && f.clans) {
        this.drawClansHud(f, t);
        hudY = 16;
      } else if (f.mode === 'koth' && f.koth) {
        this.hudBox(16, 16, 250, 64, '#ffd23f');
        ctx.font = '900 22px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = '#ffd23f';
        ctx.fillText('👑 Roi de la Colline', 30, 40);
        ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
        const leftS = Math.ceil(f.koth.left);
        ctx.fillStyle = leftS <= 10 ? '#ff8fa3' : '#cfc6ff';
        ctx.fillText(`⏱ ${Math.floor(leftS / 60)}:${String(leftS % 60).padStart(2, '0')} restantes`, 30, 66);
        // Tableau des scores (top 5)
        const top = f.fighters.filter((x) => x.score !== undefined).sort((a, b) => b.score - a.score || b.kills - a.kills).slice(0, 5);
        this.hudBox(16, 88, 250, 26 + top.length * 22, '#ffd23f');
        ctx.font = '800 13px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = '#ffd23f';
        ctx.fillText('CLASSEMENT', 30, 106);
        top.forEach((x, i) => {
          ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
          ctx.fillStyle = x.key === f.koth.king ? '#ffd23f' : i === 0 ? '#fff3a0' : '#fff';
          const name = x.name.length > 16 ? x.name.slice(0, 15) + '…' : x.name;
          ctx.fillText(`${i + 1}. ${x.key === f.koth.king ? '👑 ' : ''}${name}`, 30, 128 + i * 22);
          ctx.textAlign = 'right';
          ctx.fillText(`${x.score}`, 254, 128 + i * 22);
          ctx.textAlign = 'left';
        });
        hudY = 88 + 30 + top.length * 22;
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
        const fy = f.mode === 'clans' ? 96 : 16; // sous le bandeau des cristaux en Guerre des clans
        this.hudBox(W - w - 16, fy + i * 30, w, 26, '#ff3fd8');
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'right';
        ctx.fillText(item.text, W - 28, fy + 14 + i * 30);
      });
      ctx.globalAlpha = 1;
      this.feed = this.feed.filter((x) => x.life > 0);
      // Pas d'annonce par-dessus l'écran de victoire.
      if (this.queue && this.queue.phase === 'ended') this.announces = [];
      else this.drawAnnounces(dt);
      if (f.mode === 'dungeon' && f.dungeon && f.phase === 'battle') this.drawRoomTransition(f.dungeon);
      if (f.mode === 'dungeon' && f.dungeon && f.dungeon.poll && f.phase === 'battle') this.drawPoll(f.dungeon.poll, t);
    }

    /*
     * Sondage du donjon : deux grandes cartes avec la commande à taper dans le chat, le nombre de voix
     * et une barre de temps (60 s).
     */
    drawPoll(poll, t) {
      const ctx = this.ctx;
      const left = Math.max(0, poll.left - (performance.now() - this.frameAt) / 1000);
      const total = poll.options.reduce((a, o) => a + o.votes, 0);
      const best = Math.max(...poll.options.map((o) => o.votes));
      const box = (x, y, w, h, r) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
      };
      ctx.save();
      ctx.fillStyle = 'rgba(4, 2, 16, .6)';
      ctx.fillRect(0, 0, W, H);
      const pulse = 1 + Math.sin(t / 260) * 0.025;
      ctx.save();
      ctx.translate(W / 2, 92); ctx.scale(pulse, pulse); ctx.translate(-W / 2, -92);
      this.title('🗳️ LE CHAT DÉCIDE !', 92, 48, '#ffc21a', '#ff9a00');
      ctx.restore();
      this.title('Tapez la commande dans le chat Twitch (ou votez sur le site)', 140, 22, '#fff', '#b83cff');

      const cw = 470;
      const ch = 380;
      const gap = 90;
      const y0 = 175;
      poll.options.forEach((o, i) => {
        const b = Rules.DUNGEON_BOONS[o.id];
        const x = W / 2 - cw - gap / 2 + i * (cw + gap);
        const share = total ? o.votes / total : 0;
        const lead = total > 0 && o.votes === best;
        ctx.save();
        box(x, y0, cw, ch, 18);
        ctx.fillStyle = 'rgba(14, 10, 38, .94)';
        ctx.fill();
        ctx.strokeStyle = b.color;
        ctx.lineWidth = lead ? 5 : 2.5;
        ctx.shadowColor = b.color;
        ctx.shadowBlur = lead ? 26 + Math.sin(t / 180) * 8 : 12;
        ctx.stroke();
        ctx.restore();
        ctx.textAlign = 'center';
        ctx.font = '70px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
        ctx.fillText(b.icon, x + cw / 2, y0 + 92);
        ctx.font = '900 28px Orbitron, "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = b.color;
        ctx.fillText(b.label.toUpperCase(), x + cw / 2, y0 + 140);
        // Description sur 3 lignes au plus
        ctx.font = '600 18px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = '#e8e2ff';
        const lines = [];
        let line = '';
        for (const word of b.desc.split(' ')) {
          const next = line ? line + ' ' + word : word;
          if (ctx.measureText(next).width > cw - 50 && line) { lines.push(line); line = word; } else line = next;
        }
        lines.push(line);
        lines.slice(0, 3).forEach((l, k) => ctx.fillText(l, x + cw / 2, y0 + 176 + k * 24));
        // Commande à taper
        ctx.font = '900 30px Orbitron, "Segoe UI", system-ui, sans-serif';
        const cmd = `${b.cmd}   ou   !${i + 1}`;
        const cwid = ctx.measureText(cmd).width + 40;
        box(x + cw / 2 - cwid / 2, y0 + 254, cwid, 48, 24);
        ctx.fillStyle = b.color;
        ctx.globalAlpha = 0.18;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        // Centrée dans la pastille d'après la hauteur réelle des lettres (Orbitron ou police de secours d'OBS).
        const m = ctx.measureText(cmd);
        ctx.fillText(cmd, x + cw / 2, y0 + 254 + 24 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
        // Voix
        box(x + 30, y0 + 322, cw - 60, 34, 10);
        ctx.fillStyle = 'rgba(255,255,255,.08)';
        ctx.fill();
        if (share > 0) {
          box(x + 30, y0 + 322, Math.max(20, (cw - 60) * share), 34, 10);
          ctx.fillStyle = b.color;
          ctx.fill();
        }
        ctx.font = '800 19px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 6;
        ctx.fillText(`${o.votes} voix · ${Math.round(share * 100)} %`, x + cw / 2, y0 + 346);
        ctx.shadowBlur = 0;
      });
      this.title('OU', y0 + ch / 2 + 14, 40, '#fff', '#ff3fd8');

      // Temps restant
      const bw = 700;
      const bx = W / 2 - bw / 2;
      const by = y0 + ch + 34;
      const p = left / Rules.DUNGEON_POLL.duration;
      box(bx, by, bw, 18, 9);
      ctx.fillStyle = 'rgba(255,255,255,.1)';
      ctx.fill();
      box(bx, by, Math.max(18, bw * p), 18, 9);
      ctx.fillStyle = left < 10 ? '#ff4d6d' : '#29e7ff';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
      this.title(`⏳ ${Math.ceil(left)} s · ${total} vote${total > 1 ? 's' : ''}`, by + 60, 26, left < 10 ? '#ff8fa3' : '#fff', '#29e7ff');
      ctx.restore();
    }

    /*
     * Grosse barre de vie du Troll en haut de l'écran, avec les coches à 66 % et 33 %
     * (à chaque coche franchie, il devient plus fort). Une traînée blanche montre les dégâts récents.
     */
    /*
     * Roi de la Colline : la colline au sol (dorée quand un Roi la tient seul, rouge quand elle est disputée),
     * et la prochaine en pointillés avec son compte à rebours.
     */
    drawHill(f, t) {
      const ctx = this.ctx;
      const k = f.koth;
      const h = k.hill;
      const inside = f.fighters.filter((x) => x.alive && x.score !== undefined && Math.hypot(x.x - h.x, x.y - h.y) <= h.r).length;
      const rgb = k.king ? '255,210,63' : inside > 1 ? '255,77,109' : '230,230,255';
      const pulse = 0.5 + Math.sin(t / (k.king ? 160 : 260)) * 0.25;
      ctx.save();
      const g = ctx.createRadialGradient(h.x, h.y + 10, 10, h.x, h.y + 10, h.r);
      g.addColorStop(0, `rgba(${rgb},${0.08 + pulse * 0.12})`);
      g.addColorStop(1, `rgba(${rgb},${0.22 + pulse * 0.15})`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(h.x, h.y + 10, h.r, h.r * 0.75, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(${rgb},${0.7 + pulse * 0.3})`;
      ctx.lineWidth = 4;
      ctx.shadowColor = `rgb(${rgb})`;
      ctx.shadowBlur = 16;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.35;
      ctx.font = '48px "Segoe UI Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('👑', h.x, h.y + 10);
      ctx.restore();
      if (k.next) {
        ctx.save();
        ctx.strokeStyle = `rgba(255,210,63,${0.5 + Math.sin(t / 90) * 0.35})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([14, 10]);
        ctx.lineDashOffset = -t / 30;
        ctx.beginPath(); ctx.ellipse(k.next.x, k.next.y + 10, h.r, h.r * 0.75, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        this.label(`👑 dans ${Math.max(0, Math.ceil(k.moveIn))} s`, k.next.x, k.next.y + 10, 18, '#ffd23f');
      }
    }

    // ---------- Ruée vers l'or ----------

    // Ambiance « bonus game » : lumière dorée, rayons qui tournent, étoiles ; arc-en-ciel pendant le JACKPOT.
    drawGoldSky(t) {
      const ctx = this.ctx;
      const jackpot = this.frame && this.frame.gold && this.frame.gold.jackpot;
      ctx.save();
      ctx.fillStyle = jackpot ? `hsla(${(t / 8) % 360},90%,55%,.16)` : 'rgba(255,200,60,.13)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(W / 2, -60);
      ctx.rotate(t / 6000);
      for (let i = 0; i < 14; i++) {
        ctx.rotate((Math.PI * 2) / 14);
        ctx.fillStyle = jackpot ? `hsla(${(i * 26 + t / 6) % 360},100%,65%,.07)` : 'rgba(255,230,140,.06)';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-60, 1100); ctx.lineTo(60, 1100); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      // étoiles scintillantes
      ctx.save();
      for (let i = 0; i < 26; i++) {
        const x = (i * 197.3) % W;
        const y = (i * 131.7) % H;
        const a = 0.25 + 0.75 * Math.max(0, Math.sin(t / 300 + i * 1.3));
        ctx.globalAlpha = a * 0.8;
        ctx.fillStyle = '#fff6c0';
        ctx.font = '14px "Segoe UI Emoji", sans-serif';
        ctx.fillText('✦', x, y);
      }
      ctx.restore();
    }

    coinSprite(x, y, t, seed, scale = 1, v = 1) {
      const ctx = this.ctx;
      const spin = Math.abs(Math.cos(t / 160 + seed));
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.fillStyle = v > 1 ? '#ff9a1f' : '#e0a400';
      ctx.beginPath(); ctx.ellipse(0, 0, 8 * Math.max(0.15, spin), 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = v > 1 ? '#ffd27a' : '#ffe066';
      ctx.beginPath(); ctx.ellipse(0, 0, 6 * Math.max(0.12, spin), 6, 0, 0, Math.PI * 2); ctx.fill();
      if (spin > 0.5) { ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(-1.5 * spin, -4, 2 * spin, 3); }
      ctx.restore();
    }

    drawGoldLoot(f, t) {
      const ctx = this.ctx;
      const G = Rules.GOLD;
      const now = performance.now();
      // Pièces : elles tombent du ciel (ombre qui grossit), tournent au sol puis clignotent avant de disparaître
      if (this.coins) {
        for (const [id, c] of this.coins) {
          const age = (now - c.born) / 1000;
          if (age > G.coins.fall + G.coins.life) { this.coins.delete(id); continue; }
          const fall = Math.max(0, 1 - age / G.coins.fall);
          ctx.fillStyle = `rgba(0,0,0,${0.25 * (1 - fall)})`;
          ctx.beginPath(); ctx.ellipse(c.x, c.y + 8, 7 * (1 - fall * 0.6), 2.5, 0, 0, Math.PI * 2); ctx.fill();
          const left = G.coins.fall + G.coins.life - age;
          if (left < 1 && Math.sin(t / 50) < 0) continue;
          this.coinSprite(c.x, c.y - fall * fall * 420, t, c.seed, 1, c.v);
        }
      }
      // Coffres (en parachute) et bonus
      for (const ch of f.gold.chests) {
        const lift = ch.fall * 260;
        ctx.fillStyle = 'rgba(0,0,0,.3)';
        ctx.beginPath(); ctx.ellipse(ch.x, ch.y + 12, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.translate(ch.x + (ch.fall ? Math.sin(t / 200 + ch.id) * 8 : 0), ch.y - lift);
        if (ch.fall > 0) {
          ctx.fillStyle = '#ff4d6d';
          ctx.beginPath(); ctx.arc(0, -46, 26, Math.PI, 0); ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(0, -46, 26, Math.PI, Math.PI * 1.33); ctx.lineTo(0, -46); ctx.fill();
          ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(-24, -46); ctx.lineTo(-10, -10); ctx.moveTo(24, -46); ctx.lineTo(10, -10); ctx.stroke();
        }
        ctx.shadowColor = '#ffd23f';
        ctx.shadowBlur = 14 + Math.sin(t / 120) * 6;
        ctx.fillStyle = '#8a5a2b';
        ctx.fillRect(-15, -12, 30, 22);
        ctx.fillStyle = '#a8703a';
        ctx.fillRect(-15, -16, 30, 8);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(-15, -9, 30, 3);
        ctx.fillRect(-3, -12, 6, 8);
        ctx.restore();
      }
      for (const it of f.gold.items) {
        const K = G.items.kinds[it.kind];
        const lift = it.fall * 220;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        ctx.beginPath(); ctx.ellipse(it.x, it.y + 12, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createRadialGradient(it.x, it.y - lift - 4, 2, it.x, it.y - lift - 4, 30);
        g.addColorStop(0, 'rgba(255,255,255,.7)');
        g.addColorStop(1, 'rgba(255,220,100,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(it.x, it.y - lift - 4, 30, 0, Math.PI * 2); ctx.fill();
        ctx.font = '30px "Segoe UI Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(K.icon, it.x, it.y - lift - 4 + Math.sin(t / 200 + it.id) * 4);
        ctx.restore();
      }
      // Pièces ramassées qui volent vers le joueur
      if (this.flyingCoins) {
        for (const c of this.flyingCoins) {
          c.life -= 1 / 60;
          const d = this.disp.get(c.to);
          if (!d) continue;
          const k = 1 - c.life / 0.35;
          this.coinSprite(c.x + (d.x - c.x) * k, c.y + (d.y - 30 - c.y) * k - Math.sin(k * Math.PI) * 30, t, 0, 0.8 * (1 - k * 0.5), c.v);
        }
        this.flyingCoins = this.flyingCoins.filter((c) => c.life > 0);
      }
    }

    drawGoldHud(f, t) {
      const ctx = this.ctx;
      const g = f.gold;
      this.hudBox(16, 16, 250, 64, '#ffd23f');
      ctx.font = '900 22px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#ffd23f';
      ctx.textAlign = 'left';
      ctx.fillText('🪙 Ruée vers l\'or', 30, 40);
      const left = Math.ceil(g.left);
      ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = left <= 15 ? '#ff8fa3' : '#fff';
      ctx.fillText(`⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · ${g.rain} pièces/s`, 30, 66);
      // Total ramassé, en gros au centre
      const total = f.fighters.reduce((a, x) => a + (x.gold || 0), 0);
      const pulse = g.jackpot ? 1 + Math.sin(t / 80) * 0.06 : 1;
      ctx.save();
      ctx.translate(W / 2, 46); ctx.scale(pulse, pulse); ctx.translate(-W / 2, -46);
      this.title(`💰 ${total.toLocaleString('fr-FR')} golds ramassés`, 46, 32, g.jackpot ? `hsl(${(t / 5) % 360},100%,65%)` : '#ffe066', '#ff9a00');
      ctx.restore();
      if (g.jackpot) this.title('💥 JACKPOT ×2 💥', 88, 22, '#fff', '#ff3fd8');
      // Top 5 à droite
      const top = f.fighters.filter((x) => x.gold !== undefined).sort((a, b) => b.gold - a.gold || b.chests - a.chests).slice(0, 5);
      this.hudBox(W - 266, 16, 250, 26 + top.length * 22, '#ffd23f');
      ctx.font = '800 13px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#ffd23f';
      ctx.textAlign = 'left';
      ctx.fillText('MEILLEURS RAMASSEURS', W - 252, 34);
      top.forEach((x, i) => {
        ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = i === 0 ? '#ffe066' : '#fff';
        const name = x.name.length > 14 ? x.name.slice(0, 13) + '…' : x.name;
        ctx.textAlign = 'left';
        ctx.fillText(`${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'} ${name}`, W - 252, 56 + i * 22);
        ctx.textAlign = 'right';
        ctx.fillText(`${x.gold} 🪙${x.chests ? ' · ' + x.chests + ' 🎁' : ''}`, W - 26, 56 + i * 22);
      });
      ctx.textAlign = 'left';
    }

    drawGoldResult(t, r) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(20,10,0,.72)';
      ctx.fillRect(0, 0, W, H);
      // confettis
      if (!this.confetti || !this.confetti.length) {
        this.confetti = Array.from({ length: 120 }, () => ({ x: Math.random() * W, y: -Math.random() * H, vy: 60 + Math.random() * 90, h: Math.random() * 360, r: Math.random() * 6, s: 4 + Math.random() * 5 }));
      }
      ctx.save();
      for (const c of this.confetti) {
        c.y += c.vy / 60;
        if (c.y > H + 10) c.y = -10;
        ctx.fillStyle = `hsl(${c.h},90%,60%)`;
        ctx.save(); ctx.translate(c.x + Math.sin(c.y / 30 + c.r) * 8, c.y); ctx.rotate(c.y / 40 + c.r); ctx.fillRect(-c.s / 2, -c.s / 4, c.s, c.s / 2); ctx.restore();
      }
      ctx.restore();
      const s = 1 + Math.sin(t / 300) * 0.04;
      ctx.save();
      ctx.translate(W / 2, 110); ctx.scale(s, s); ctx.translate(-W / 2, -110);
      this.title('🎉 FIN DE LA RUÉE VERS L\'OR ! 🎉', 110, 50, '#ffe066', '#ff9a00');
      ctx.restore();
      this.title(`${r.totals.gold.toLocaleString('fr-FR')} golds et ${r.totals.chests} coffre${r.totals.chests > 1 ? 's' : ''} ramassés · chacun garde son butin !`, 165, 24, '#fff', '#b83cff');
      // Podium
      const podium = [{ i: 1, x: W / 2 - 220, h: 90 }, { i: 0, x: W / 2, h: 130 }, { i: 2, x: W / 2 + 220, h: 60 }];
      for (const p of podium) {
        const e = r.ranking[p.i];
        if (!e) continue;
        const base = 560;
        ctx.fillStyle = ['#ffd23f', '#c9d3e0', '#d08a4a'][p.i];
        ctx.fillRect(p.x - 80, base - p.h, 160, p.h);
        ctx.fillStyle = 'rgba(0,0,0,.25)';
        ctx.fillRect(p.x - 80, base - p.h, 160, 8);
        this.label(['🥇', '🥈', '🥉'][p.i], p.x, base - p.h / 2, 34, '#fff');
        const fighter = this.frame && this.frame.fighters.find((x) => x.key === e.key);
        if (fighter) drawFighter(ctx, p.x, base - p.h - 34, fighter, { scale: p.i === 0 ? 2.2 : 1.8, bob: Math.sin(t / 250 + p.i) * 3 });
        this.label(e.name, p.x, base - p.h - 100 - (p.i === 0 ? 14 : 0), 18, '#fff');
        this.label(`${e.gold} 🪙${e.chests ? ` · ${e.chests} 🎁` : ''}`, p.x, base - p.h - 78 - (p.i === 0 ? 14 : 0), 17, '#ffe066');
      }
      if (r.best) this.title(`👑 Roi du butin : ${r.best.name} (+${Rules.GOLD.bestChests} coffre bonus)`, 610, 22, '#ffd23f', '#ff9a00');
      const rest = r.ranking.slice(3, 8).map((e) => `#${e.rank} ${e.name} ${e.gold} 🪙`).join('   ·   ');
      if (rest) this.label(rest, W / 2, 660, 15, '#ddd');
    }

    // Guerre des clans : les deux camps teintés aux couleurs des équipes.
    drawBases(t) {
      const ctx = this.ctx;
      for (const [c, x0] of [['rouge', 0], ['bleu', W]]) {
        const col = Rules.CLANS.teams[c].color;
        const g = ctx.createLinearGradient(x0, 0, x0 === 0 ? 460 : W - 460, 0);
        g.addColorStop(0, col + '38');
        g.addColorStop(1, col + '00');
        ctx.fillStyle = g;
        ctx.fillRect(x0 === 0 ? 0 : W - 460, 0, 460, H);
      }
    }

    // Bandeau du haut : la vie des deux cristaux face à face, les kills et le temps.
    drawClansHud(f, t) {
      const ctx = this.ctx;
      const k = f.clans;
      const bw = 420;
      const y = 22;
      const T = Rules.CLANS.teams;
      ctx.save();
      ctx.fillStyle = 'rgba(8,5,28,.85)';
      ctx.fillRect(W / 2 - bw - 70, y - 8, 2 * bw + 140, 66);
      for (const [c, dir] of [['rouge', -1], ['bleu', 1]]) {
        const cr = k.crystals[c];
        const ratio = Math.max(0, cr.hp / cr.maxHp);
        const x0 = dir < 0 ? W / 2 - 60 - bw : W / 2 + 60;
        ctx.fillStyle = 'rgba(255,255,255,.1)';
        ctx.fillRect(x0, y, bw, 24);
        ctx.fillStyle = T[c].color;
        ctx.shadowColor = T[c].color;
        ctx.shadowBlur = 10;
        // la barre se vide vers l'extérieur, comme dans un jeu de combat
        if (dir < 0) ctx.fillRect(x0 + bw * (1 - ratio), y, bw * ratio, 24);
        else ctx.fillRect(x0, y, bw * ratio, 24);
        ctx.shadowBlur = 0;
        ctx.font = '900 15px Orbitron, "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = dir < 0 ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${T[c].icon} ${T[c].label.toUpperCase()}  ${Math.round(ratio * 100)} %`, dir < 0 ? x0 + 8 : x0 + bw - 8, y + 12);
        ctx.font = '700 14px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = T[c].color;
        const alive = f.fighters.filter((x) => x.clan === c && x.alive && x.kind !== 'cristal_clan').length;
        const total = f.fighters.filter((x) => x.clan === c && x.kind !== 'cristal_clan').length;
        const bonus = k.mult[c] > 1 ? `  ·  bonus ×${String(Math.round(k.mult[c] * 100) / 100).replace('.', ',')}` : '';
        ctx.fillText(`⚔ ${k.kills[c]} kills  ·  👥 ${alive}/${total} debout${bonus}`, dir < 0 ? x0 + 8 : x0 + bw - 8, y + 42);
      }
      const left = Math.ceil(k.left);
      ctx.textAlign = 'center';
      ctx.font = '900 22px Orbitron, "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = k.overtime ? (Math.sin(t / 120) > 0 ? '#ff4d6d' : '#ffb000') : '#fff';
      ctx.fillText(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, W / 2, y + 12);
      ctx.font = '800 12px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = k.overtime ? '#ff8fa3' : '#cfc6ff';
      ctx.fillText(k.overtime ? 'MORT SUBITE' : 'VS', W / 2, y + 40);
      ctx.restore();
    }

    drawClansResult(t, r) {
      const ctx = this.ctx;
      const T = Rules.CLANS.teams[r.winner];
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(0, 0, W, H);
      const s = 1 + Math.sin(t / 300) * 0.03;
      ctx.save();
      ctx.translate(W / 2, 140); ctx.scale(s, s); ctx.translate(-W / 2, -140);
      this.title(`${T.icon} VICTOIRE DES ${T.label.toUpperCase()} ! ${T.icon}`, 140, 56, T.color, T.color);
      ctx.restore();
      const pct = (x) => `${Math.round(x * 100)} %`;
      this.title(`Cristal rouge ${pct(r.teams.rouge.crystal)}  ·  ${r.teams.rouge.kills} – ${r.teams.bleu.kills} kills  ·  Cristal bleu ${pct(r.teams.bleu.crystal)}`, 205, 22, '#fff', '#b83cff');
      this.title(`🎁 Chaque ${T.label.slice(0, -1)} : +${r.reward.xp} XP · +${r.reward.gold} golds · +${r.reward.chests} coffre`, 252, 24, '#3ddc5a', '#3ddc5a');
      if (r.mvp) {
        this.title(`🌟 MVP : ${r.mvp.name} — ${r.mvp.dealt.toLocaleString('fr-FR')} dégâts · ${r.mvp.kills} kill(s) · +${Rules.CLANS.mvpChests} coffre`, 300, 22, '#ffd23f', '#ff9a00');
        const fighter = this.frame && this.frame.fighters.find((x) => x.key === r.mvp.key);
        if (fighter) drawFighter(ctx, W / 2, 400, Object.assign({}, fighter), { scale: 2.6, bob: Math.sin(t / 300) * 4, swing: (Math.sin(t / 500) + 1) / 2 });
      }
      r.ranking.slice(0, 5).forEach((p, i) => {
        const icon = Rules.CLANS.teams[p.clan] ? Rules.CLANS.teams[p.clan].icon : '';
        this.label(`#${p.rank}  ${icon} ${p.name}  —  ${p.dealt.toLocaleString('fr-FR')} dégâts · ${p.kills} kill(s) · ${p.deaths} mort(s)`, W / 2, 500 + i * 28, 17, i === 0 ? '#ffe27a' : '#ddd');
      });
      const br = this.queue.bets && this.queue.bets.lastResult;
      if (br) {
        const text = br.refund ? `💰 Personne n'avait parié sur ${br.winnerName} : ${br.pool} golds remboursés`
          : `💰 ${br.winners > 1 ? br.winners + ' parieurs se partagent' : '1 parieur remporte'} ${br.distributed} golds !`;
        this.label(text, W / 2, 700, 20, '#ffb000');
      }
    }

    bossInfo() {
      const b = this.frame && this.frame.boss;
      return Rules.BOSSES[b && b.id] || Rules.BOSSES[this.queue && this.queue.boss] || Rules.BOSS;
    }

    /*
     * Un boss (ou une illusion du Magicien) : le Dragon en vol plane au-dessus de son ombre,
     * le Magicien protégé est enfermé dans une bulle reliée à ses cristaux.
     */
    drawBoss(fi, d, boss, swing, t, dt) {
      const ctx = this.ctx;
      const BD = BOSS_DRAW[fi.kind];
      const real = fi.key === 'boss';
      const state = real && boss ? boss : {};
      // Envol / atterrissage en douceur
      const airborne = state.flying || state.away ? 1 : 0;
      d.air = (d.air || 0) + (airborne - (d.air || 0)) * Math.min(1, dt * 2.5);
      const lift = BD.lift + d.air * FLY_HEIGHT;
      if (d.air > 0.02) {
        ctx.save();
        ctx.fillStyle = `rgba(0,0,0,${0.35 * d.air})`;
        ctx.beginPath(); ctx.ellipse(d.x, d.y + 20, 70 * (1 - d.air * 0.3), 18 * (1 - d.air * 0.3), 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      if (state.shielded) {
        // rayons des cristaux vers le Magicien
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const c of this.frame.fighters) {
          if (c.kind !== 'cristal' || !c.alive) continue;
          const cd = this.disp.get(c.key);
          if (!cd) continue;
          ctx.strokeStyle = `rgba(176,107,255,${0.35 + Math.sin(t / 90 + cd.x) * 0.2})`;
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(cd.x, cd.y - 30); ctx.lineTo(d.x, d.y - 50); ctx.stroke();
        }
        ctx.restore();
      }
      drawMonster(ctx, d.x, d.y - lift, fi, {
        scale: BD.scale, facing: d.facing, flash: d.flash, swing, t, seed: fi.x,
        phase: state.phase, enraged: state.enraged, flying: d.air > 0.3,
      });
      if (state.shielded) {
        ctx.save();
        const r = 72 + Math.sin(t / 200) * 3;
        const g = ctx.createRadialGradient(d.x, d.y - 40, r * 0.6, d.x, d.y - 40, r);
        g.addColorStop(0, 'rgba(140,60,255,0.05)');
        g.addColorStop(1, 'rgba(190,120,255,0.45)');
        ctx.fillStyle = g;
        ctx.strokeStyle = 'rgba(220,180,255,.8)';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#b06bff';
        ctx.shadowBlur = 18;
        ctx.beginPath(); ctx.arc(d.x, d.y - 40, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }

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
      const B = Rules.BOSSES[boss.id] || Rules.BOSS;
      const title = `${B.icon} ${boss.name}${boss.enraged ? ' — RAGE FINALE' : boss.phase ? ` — PHASE ${boss.phase + 1}` : ''}`;
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
      // coches des étapes du boss (66 % et 33 % pour le Troll…)
      for (const at of B.marks) {
        const cx = x + bw * at;
        const passed = ratio <= at;
        ctx.fillStyle = passed ? 'rgba(0,0,0,.6)' : '#fff';
        ctx.fillRect(cx - 2, y - 8, 4, bh + 16);
        ctx.beginPath(); ctx.moveTo(cx - 7, y - 12); ctx.lineTo(cx + 7, y - 12); ctx.lineTo(cx, y - 4); ctx.closePath(); ctx.fill();
        ctx.font = '800 11px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = passed ? '#ff8fa3' : '#fff';
        ctx.fillText(`${Math.round(at * 100)} %`, cx, y + bh + 14);
      }
      // État du boss : en vol, au nid, derrière son bouclier
      let status = null;
      const left = boss.timer ? ` · ${Math.ceil(boss.timer.left)} s` : '';
      if (boss.away) status = { text: `🥚 AU NID — détruisez les œufs !${left}`, color: '#ffc21a' };
      else if (boss.flying) status = { text: `🪽 EN VOL — seuls les combattants à distance le touchent${left}`, color: '#ff9a1f' };
      else if (boss.shielded) {
        const n = (this.frame.fighters || []).filter((fi) => fi.kind === 'cristal' && fi.alive).length;
        status = { text: `🛡️ BOUCLIER — détruisez les cristaux (${n} restant${n > 1 ? 's' : ''})`, color: '#c88bff' };
      }
      if (status) {
        ctx.font = '800 16px "Segoe UI", system-ui, sans-serif';
        const tw = ctx.measureText(status.text).width + 28;
        ctx.fillStyle = 'rgba(8,5,28,.85)';
        ctx.fillRect(W / 2 - tw / 2, y + bh + 22, tw, 26);
        ctx.fillStyle = status.color;
        ctx.fillRect(W / 2 - tw / 2, y + bh + 22, 3, 26);
        ctx.fillText(status.text, W / 2, y + bh + 36);
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
        const zone = Rules.DUNGEON_THEMES[Rules.dungeonTheme(room)];
        const P = DUNGEON_PALETTES[Rules.dungeonTheme(room)];
        const newZone = room > 1 && room % 5 === 1;
        this.title(newZone ? `Nouvelle zone : ${zone.name}` : `— ${zone.name} —`, H / 2 - 105, newZone ? 30 : 22, `rgb(${P.glow})`, `rgb(${P.glow})`);
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
        const BD = BOSS_DRAW[fi.kind];
        drawMonster(ctx, d.x + jx, d.y - BD.lift + jy, fi, { scale: BD.scale, facing: d.facing, t, phase: 2, flash: Math.sin(t / 40) > 0 ? 0.4 + k : 0 });
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

    // ---------- Ultimes et potions ----------

    // Un ultime est lancé : annonce au-dessus du lanceur + effet propre à l'ultime.
    onUlt(e, from, byKey) {
      const U = Rules.ULTS[e.id];
      const dFrom = this.disp.get(e.from);
      this.floaters.push({ x: from.x, y: from.y - 92, text: `${U.icon} ${U.label.toUpperCase()}${e.enhanced ? ' ★' : ''}`, color: U.color, life: 2, size: e.enhanced ? 22 : 19 });
      this.spark(from.x, from.y - 20, U.color, 30);
      if (window.Sound) Sound.play('ult', e.id);
      const posOf = (key) => byKey.get(key);
      switch (e.id) {
        case 'perforante':
          this.beams.push({ path: e.path, width: e.width, color: U.color, t: 0, dur: 0.75 });
          break;
        case 'blizzard':
          this.blasts.push({ x: e.tx, y: e.ty, r: e.r, life: 0.7, color: 'ice' });
          this.spark(e.tx, e.ty, '#bdf0ff', 50);
          break;
        case 'execution':
          for (const h of e.hops || []) {
            this.spark(h.fx, h.fy - 10, '#7a6a9a', 20);
            this.spark(h.x, h.y - 10, '#ffd23f', 24);
            this.slashes.push({ x: h.x, y: h.y - 14, t: 0, color: U.color });
          }
          if (dFrom && e.hops && e.hops.length) { const last = e.hops[e.hops.length - 1]; dFrom.x = last.x; dFrom.y = last.y; }
          break;
        case 'priere':
        case 'chatiment':
          for (const key of e.targets || []) {
            const tg = posOf(key);
            if (tg) this.pillars.push({ x: tg.x, y: tg.y, t: 0, color: e.id === 'priere' ? '#fff3a0' : '#ffe27a', holy: e.id === 'priere' });
          }
          break;
        case 'rempart':
          for (const key of e.targets || []) { const tg = posOf(key); if (tg) this.pillars.push({ x: tg.x, y: tg.y, t: 0, color: '#ffd23f', holy: true }); }
          break;
        case 'pluie':
          this.floaters.push({ x: e.tx, y: e.ty - 20, text: '🏹🏹🏹', color: '#9be564', life: 1, size: 18 });
          break;
        default:
      }
    }

    // Effets visibles d'un combattant (fx) : sous lui (auras) ou par-dessus (gel, bouclier, tourbillon).
    drawFx(fi, x, y, t, layer) {
      if (!fi.fx) return;
      const ctx = this.ctx;
      const has = (k) => fi.fx.includes(k);
      ctx.save();
      if (layer === 'under') {
        const aura = (color, r) => {
          const g = ctx.createRadialGradient(x, y + 4, 4, x, y + 4, r);
          g.addColorStop(0, color);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.ellipse(x, y + 8, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
        };
        if (has('potion_berserker')) aura('rgba(255,60,40,.55)', 34);
        if (has('potion_vie')) aura('rgba(80,255,120,.45)', 30);
        if (has('potion_ronces')) aura('rgba(190,80,255,.45)', 30);
        if (has('gold_aimant')) aura(`rgba(200,80,255,${0.35 + Math.sin(t / 90) * 0.15})`, 46);
        if (has('gold_etoile')) aura(`hsla(${(t / 4) % 360},100%,60%,.5)`, 36);
        if (has('curse')) aura(`rgba(120,20,200,${0.5 + Math.sin(t / 100) * 0.15})`, 32); // malédiction du Magicien
        if (has('potion_celerite')) aura('rgba(255,230,60,.45)', 30);
      } else {
        if (has('rempart') || has('potion_defense') || has('priere')) {
          ctx.strokeStyle = has('rempart') ? 'rgba(255,215,80,.85)' : 'rgba(95,211,255,.8)';
          ctx.fillStyle = has('rempart') ? 'rgba(255,215,80,.12)' : 'rgba(95,211,255,.1)';
          ctx.lineWidth = 2.5;
          ctx.shadowColor = ctx.strokeStyle;
          ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.arc(x, y - 10, 30 + Math.sin(t / 150) * 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        if (has('tourbillon')) {
          ctx.strokeStyle = 'rgba(255,90,90,.85)';
          ctx.lineWidth = 4;
          ctx.shadowColor = '#ff4d6d';
          ctx.shadowBlur = 12;
          const a0 = t / 70;
          for (let i = 0; i < 3; i++) {
            ctx.beginPath(); ctx.arc(x, y - 4, 46, a0 + i * 2.09, a0 + i * 2.09 + 1.1); ctx.stroke();
          }
        }
        if (has('frozen')) {
          ctx.fillStyle = 'rgba(170,230,255,.45)';
          ctx.strokeStyle = 'rgba(230,250,255,.9)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x - 18, y + 20); ctx.lineTo(x - 22, y - 30); ctx.lineTo(x - 6, y - 46); ctx.lineTo(x + 14, y - 40); ctx.lineTo(x + 22, y - 10); ctx.lineTo(x + 18, y + 20);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        if (has('potion_celerite')) {
          ctx.strokeStyle = 'rgba(255,230,90,.7)';
          ctx.lineWidth = 2;
          for (let i = 0; i < 3; i++) {
            const yy = y - 20 + i * 10;
            const off = (t / 6 + i * 13) % 26;
            ctx.beginPath(); ctx.moveTo(x - 26 - off, yy); ctx.lineTo(x - 16 - off, yy); ctx.stroke();
          }
        }
        if (has('potion_vie')) {
          ctx.fillStyle = 'rgba(120,255,150,.9)';
          ctx.font = '700 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('+', x + Math.sin(t / 200) * 14, y - 40 - ((t / 15) % 20));
        }
      }
      ctx.restore();
    }

    // Zones des ultimes : nuage de poison (au sol), météores et flèches qui tombent (en l'air).
    drawZones(zones, t, layer) {
      const ctx = this.ctx;
      for (const z of zones) {
        ctx.save();
        if (z.kind === 'poison' && layer === 'ground') {
          for (let i = 0; i < 4; i++) {
            const ox = Math.sin(t / 900 + i * 1.7) * z.r * 0.2;
            const oy = Math.cos(t / 1100 + i * 2.3) * z.r * 0.15;
            const g = ctx.createRadialGradient(z.x + ox, z.y + oy, 4, z.x + ox, z.y + oy, z.r * (0.7 + i * 0.1));
            g.addColorStop(0, `rgba(120,220,80,${0.32 * Math.min(1, z.p * 3)})`);
            g.addColorStop(1, 'rgba(80,160,40,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(z.x + ox, z.y + oy, z.r * (0.7 + i * 0.1), 0, Math.PI * 2); ctx.fill();
          }
        } else if (z.kind === 'meteor' && layer === 'air' && z.p >= 0) {
          ctx.strokeStyle = `rgba(255,80,30,${0.5 + Math.sin(t / 60) * 0.3})`;
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 6]);
          ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
          const k2 = 1 - z.p;
          const mx = z.x + 300 * k2;
          const my = z.y - 560 * k2;
          ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(mx, my, 3, mx, my, 34);
          g.addColorStop(0, '#fff3b0'); g.addColorStop(0.4, '#ff8a1f'); g.addColorStop(1, 'rgba(255,40,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(mx, my, 34, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(255,140,40,.5)';
          ctx.lineWidth = 12;
          ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + 70, my - 130); ctx.stroke();
        } else if (z.kind === 'arrow' && layer === 'air' && z.p >= 0) {
          const ay = z.y - 260 * (1 - z.p);
          ctx.strokeStyle = '#e8d7b0';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(z.x + 6, ay - 22); ctx.lineTo(z.x, ay); ctx.stroke();
          ctx.fillStyle = '#d0d0e0';
          ctx.beginPath(); ctx.moveTo(z.x, ay + 2); ctx.lineTo(z.x - 3, ay - 5); ctx.lineTo(z.x + 4, ay - 4); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,.25)';
          ctx.beginPath(); ctx.ellipse(z.x, z.y, 6 * z.p, 2 * z.p, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    }

    // Flèche perforante (trajectoire lumineuse), colonnes de lumière (Prière, Châtiment) et entailles (Exécution).
    drawBeams(dt) {
      const ctx = this.ctx;
      for (const b of this.beams) {
        b.t += dt;
        const k = Math.min(1, b.t / (b.dur * 0.45));
        const fade = Math.max(0, 1 - Math.max(0, b.t - b.dur * 0.45) / (b.dur * 0.55));
        // longueur totale parcourue jusqu'ici
        const lens = [];
        let total = 0;
        for (let i = 1; i < b.path.length; i++) { const l = Math.hypot(b.path[i].x - b.path[i - 1].x, b.path[i].y - b.path[i - 1].y); lens.push(l); total += l; }
        let left = total * k;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.lineCap = 'round';
        ctx.strokeStyle = b.color;
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 20;
        ctx.lineWidth = b.width;
        ctx.beginPath();
        ctx.moveTo(b.path[0].x, b.path[0].y - 12);
        let head = b.path[0];
        for (let i = 1; i < b.path.length && left > 0; i++) {
          const seg = Math.min(left, lens[i - 1]);
          const r = seg / lens[i - 1];
          head = { x: b.path[i - 1].x + (b.path[i].x - b.path[i - 1].x) * r, y: b.path[i - 1].y + (b.path[i].y - b.path[i - 1].y) * r };
          ctx.lineTo(head.x, head.y - 12);
          left -= seg;
        }
        ctx.stroke();
        ctx.lineWidth = b.width * 0.35;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.restore();
      }
      this.beams = this.beams.filter((b) => b.t < b.dur);

      for (const p of this.pillars) {
        p.t += dt;
        const a = Math.max(0, 1 - p.t / 0.9);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(p.x, 0, p.x, p.y);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(1, p.color);
        ctx.globalAlpha = a * 0.8;
        ctx.fillStyle = g;
        const wdt = p.holy ? 34 : 18;
        ctx.fillRect(p.x - wdt / 2, 0, wdt, p.y + 10);
        ctx.restore();
      }
      this.pillars = this.pillars.filter((p) => p.t < 0.9);

      for (const s of this.slashes) {
        s.t += dt;
        const a = Math.max(0, 1 - s.t / 0.4);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#fff';
        ctx.shadowColor = s.color;
        ctx.shadowBlur = 14;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(s.x - 22, s.y - 18); ctx.lineTo(s.x + 22, s.y + 18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.x + 22, s.y - 18); ctx.lineTo(s.x - 22, s.y + 18); ctx.stroke();
        ctx.restore();
      }
      this.slashes = this.slashes.filter((s) => s.t < 0.4);
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
      if (r.mode === 'clans') { this.drawClansResult(t, r); return; }
      if (r.mode === 'gold') { this.drawGoldResult(t, r); return; }
      const koth = r.mode === 'koth';
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(0, 0, W, H);
      if (r.winner) {
        const s = 1 + Math.sin(t / 300) * 0.03;
        ctx.save();
        ctx.translate(W / 2, 150);
        ctx.scale(s, s);
        ctx.translate(-W / 2, -150);
        this.title(this.queue.training ? '🏋️ FIN DE L\'ENTRAÎNEMENT' : koth ? '👑 ROI DE LA COLLINE 👑' : '🏆 VICTOIRE ROYALE 🏆', 150, 56, '#ffc21a', '#ff9a00');
        ctx.restore();
        this.title(r.winner.name, 240, 64, '#fff', '#ff3fd8');
        this.title(this.queue.training
          ? `remporte le duel en ${formatCountdown(r.duration * 1000)} · aucune récompense en entraînement`
          : `${koth ? `${r.winner.score} points · ` : ''}${r.winner.kills} kill(s) · +${Rules.REWARDS.win.xp} XP · +${Rules.REWARDS.win.chests} coffre · +${Rules.REWARDS.win.gold} golds`, 305, 24, '#cfc6ff');
        const fighter = this.frame && this.frame.fighters.find((f) => f.key === r.winner.key);
        if (fighter) drawFighter(ctx, W / 2, 420, fighter, { scale: 3, bob: Math.sin(t / 300) * 4, swing: (Math.sin(t / 500) + 1) / 2 });
      }
      const top = r.ranking.slice(1, 6);
      top.forEach((p, i) => {
        this.label(`#${p.rank}  ${p.name}  —  ${koth ? `${p.score} pts · ` : ''}${p.kills} kill(s)`, W / 2, 540 + i * 30, 18, '#ddd');
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
      // Victoire contre le boss : on laisse d'abord l'explosion et la pluie de butin se jouer.
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
        const short = (Rules.BOSSES[r.boss.id] || Rules.BOSS).short.toUpperCase();
        if (r.victory) this.title(`🏆 ${short} EST VAINCU ! 🏆`, 130, 54, '#ffc21a', '#ff9a00');
        else this.title(`💀 ${short} A GAGNÉ…`, 130, 54, '#ff4d6d', '#ff2a2a');
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
