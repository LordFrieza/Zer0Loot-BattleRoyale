/*
 * Onglet Survivor : le camp (lancer une partie, méta-progression en émeraudes, classement) et le jeu lui-même.
 * Le serveur simule la partie (server/survivor.js) et envoie des images (`svFrame`, 10 par seconde) ; ici on
 * déplace son personnage tout de suite (ZQSD / flèches / doigt), on envoie sa position (`sv:pos`) et on dessine
 * tout en douceur (ennemis interpolés, projectiles simulés à partir de leur lancer).
 * Utilise les globales de la page : me, api, toast, esc, socket, refresh, Sound, Rules, drawFighter, drawMonster.
 */
(function () {
  const SV = Rules.SURVIVOR;
  const KINDS = Rules.SURVIVOR_ENEMY_KINDS;
  const ZONES = Rules.SURVIVOR_ZONES;
  const W = 1280;
  const H = 720;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const EM = '<i class="ico-emerald"></i>';

  let state = null; // GET /api/survivor
  let active = false;
  let starter = null;

  // ---------- Partie ----------
  const G = {
    on: false, frame: null, frameAt: 0, srvT: 0, me: { x: SV.map.w / 2, y: SV.map.h / 2, fx: 1, fy: 0, moving: false },
    keys: new Set(), touch: null, enemies: new Map(), shots: new Map(), fx: [], texts: [], lastSend: 0, zone: null, zoneAt: 0,
    hurtAt: 0, raf: 0, last: 0, lastHp: null, puffs: [], over: null, paused: false,
  };
  let ctx = null;

  // ---------- Carte : morceaux de 512 px dessinés une fois (sol, chemins, décor), gardés en cache ----------
  const CHUNK = 512;
  const TILE = 64;
  const chunks = new Map();
  const hash = (x, y, s = 0) => {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const shade = (hex, k) => {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(c + (k > 0 ? (255 - c) * k : c * k))));
    return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
  };
  // Chemins de terre du village vers chaque lieu-dit
  const ROADS = Object.entries(ZONES).filter(([id]) => id !== 'village').map(([, z]) => [ZONES.village.x, ZONES.village.y, z.x, z.y]);
  function roadDist(x, y) {
    let best = Infinity;
    for (const [ax, ay, bx, by] of ROADS) {
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
      if (d < best) best = d;
    }
    return best;
  }

  // Petits décors dessinés au pinceau (arbres, tombes, blé, lave…)
  const DECOR = {
    tree(g, x, y, s, dark) {
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(x, y + 4, 16 * s, 6 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5a3a1e'; g.fillRect(x - 3 * s, y - 14 * s, 6 * s, 16 * s);
      g.fillStyle = dark ? '#1f4a28' : '#2f7a3a';
      for (const [ox, oy, r] of [[0, -30, 16], [-11, -20, 12], [11, -20, 12], [0, -40, 11]]) { g.beginPath(); g.arc(x + ox * s, y + oy * s, r * s, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,.1)'; g.beginPath(); g.arc(x - 5 * s, y - 36 * s, 6 * s, 0, Math.PI * 2); g.fill();
    },
    pine(g, x, y, s) {
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(x, y + 3, 13 * s, 5 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4a2e18'; g.fillRect(x - 2.5 * s, y - 8 * s, 5 * s, 10 * s);
      g.fillStyle = '#1d5530';
      for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(x, y - (40 - i * 2) * s + i * 10 * s - 10 * s); g.lineTo(x - (10 + i * 5) * s, y - (6 + (2 - i) * 9) * s); g.lineTo(x + (10 + i * 5) * s, y - (6 + (2 - i) * 9) * s); g.closePath(); g.fill(); }
    },
    rock(g, x, y, s) {
      g.fillStyle = '#7b7f86'; g.beginPath(); g.moveTo(x - 12 * s, y); g.lineTo(x - 8 * s, y - 10 * s); g.lineTo(x + 4 * s, y - 13 * s); g.lineTo(x + 12 * s, y - 3 * s); g.lineTo(x + 9 * s, y + 2 * s); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(x - 7 * s, y - 9 * s); g.lineTo(x + 3 * s, y - 12 * s); g.lineTo(x, y - 6 * s); g.closePath(); g.fill();
    },
    grave(g, x, y, s) {
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x - 9 * s, y, 18 * s, 4 * s);
      g.fillStyle = '#8d9096'; g.beginPath(); g.moveTo(x - 8 * s, y); g.lineTo(x - 8 * s, y - 16 * s); g.arc(x, y - 16 * s, 8 * s, Math.PI, 0); g.lineTo(x + 8 * s, y); g.closePath(); g.fill();
      g.strokeStyle = '#5c5f66'; g.lineWidth = 1.5 * s; g.beginPath(); g.moveTo(x, y - 20 * s); g.lineTo(x, y - 9 * s); g.moveTo(x - 4 * s, y - 16 * s); g.lineTo(x + 4 * s, y - 16 * s); g.stroke();
    },
    deadtree(g, x, y, s) {
      g.strokeStyle = '#3a2f28'; g.lineWidth = 4 * s; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 28 * s); g.moveTo(x, y - 18 * s); g.lineTo(x - 10 * s, y - 30 * s); g.moveTo(x, y - 22 * s); g.lineTo(x + 11 * s, y - 34 * s); g.stroke();
    },
    wheat(g, x, y, s) {
      g.strokeStyle = '#a8862a'; g.lineWidth = 1.5 * s;
      for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(x + i * 4 * s, y); g.lineTo(x + i * 5 * s, y - 16 * s); g.stroke(); g.fillStyle = '#e2c25a'; g.beginPath(); g.ellipse(x + i * 5 * s, y - 18 * s, 2 * s, 5 * s, 0, 0, Math.PI * 2); g.fill(); }
    },
    flower(g, x, y, s, k) {
      const c = ['#ff6b9a', '#ffd34a', '#b98cff', '#ffffff', '#ff8a3d'][Math.floor(k * 5)];
      g.strokeStyle = '#3d7a34'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 7 * s); g.stroke();
      g.fillStyle = c; for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; g.beginPath(); g.arc(x + Math.cos(a) * 3 * s, y - 8 * s + Math.sin(a) * 3 * s, 2.2 * s, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#ffe27a'; g.beginPath(); g.arc(x, y - 8 * s, 1.6 * s, 0, Math.PI * 2); g.fill();
    },
    reeds(g, x, y, s) {
      g.strokeStyle = '#6b7a3a'; g.lineWidth = 1.6 * s;
      for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(x + i * 3 * s, y); g.quadraticCurveTo(x + i * 4 * s, y - 10 * s, x + i * 6 * s, y - 20 * s); g.stroke(); }
      g.fillStyle = '#5a3a1e'; g.fillRect(x + 4 * s, y - 22 * s, 3 * s, 8 * s);
    },
    pond(g, x, y, s) {
      g.fillStyle = '#3d6a6a'; g.beginPath(); g.ellipse(x, y, 30 * s, 14 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(160, 220, 220, .35)'; g.beginPath(); g.ellipse(x - 8 * s, y - 3 * s, 12 * s, 4 * s, 0, 0, Math.PI * 2); g.fill();
    },
    ice(g, x, y, s) {
      g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.moveTo(x - 14 * s, y); g.lineTo(x - 4 * s, y - 6 * s); g.lineTo(x + 16 * s, y - 2 * s); g.lineTo(x + 6 * s, y + 5 * s); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(120, 170, 200, .7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 10 * s, y); g.lineTo(x + 8 * s, y - 1 * s); g.stroke();
    },
    crystal(g, x, y, s) {
      g.fillStyle = '#9fe0ff'; g.beginPath(); g.moveTo(x, y - 22 * s); g.lineTo(x + 6 * s, y - 6 * s); g.lineTo(x, y); g.lineTo(x - 6 * s, y - 6 * s); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.moveTo(x, y - 22 * s); g.lineTo(x + 2 * s, y - 8 * s); g.lineTo(x, y - 2 * s); g.closePath(); g.fill();
    },
    lava(g, x, y, s) {
      g.strokeStyle = '#ff6a1f'; g.lineWidth = 3 * s; g.shadowColor = '#ff8a3d'; g.shadowBlur = 8;
      g.beginPath(); g.moveTo(x - 18 * s, y); g.lineTo(x - 6 * s, y - 4 * s); g.lineTo(x + 2 * s, y + 3 * s); g.lineTo(x + 16 * s, y - 2 * s); g.stroke(); g.shadowBlur = 0;
    },
    pillar(g, x, y, s, k) {
      const h = (k > 0.5 ? 30 : 16) * s;
      g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x - 10 * s, y, 20 * s, 4 * s);
      g.fillStyle = '#d6cfbf'; g.fillRect(x - 7 * s, y - h, 14 * s, h);
      g.fillStyle = '#bdb5a3'; g.fillRect(x - 9 * s, y - h - 4 * s, 18 * s, 5 * s); g.fillRect(x - 9 * s, y - 3 * s, 18 * s, 4 * s);
      g.strokeStyle = 'rgba(0,0,0,.15)'; g.beginPath(); g.moveTo(x - 2 * s, y - h); g.lineTo(x - 2 * s, y); g.moveTo(x + 3 * s, y - h); g.lineTo(x + 3 * s, y); g.stroke();
    },
    house(g, x, y, s, k) {
      const wall = ['#efe3c8', '#e8d3b0', '#f2e6d8'][Math.floor(k * 3)];
      const roof = ['#b8452e', '#8a4a2e', '#4a5263'][Math.floor(k * 7) % 3];
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x - 30 * s, y, 62 * s, 6 * s);
      g.fillStyle = wall; g.fillRect(x - 28 * s, y - 34 * s, 56 * s, 34 * s);
      g.fillStyle = roof; g.beginPath(); g.moveTo(x - 34 * s, y - 32 * s); g.lineTo(x, y - 58 * s); g.lineTo(x + 34 * s, y - 32 * s); g.closePath(); g.fill();
      g.fillStyle = '#7a4a24'; g.fillRect(x - 6 * s, y - 18 * s, 12 * s, 18 * s);
      g.fillStyle = '#9fd8ff'; g.fillRect(x - 22 * s, y - 26 * s, 10 * s, 9 * s); g.fillRect(x + 12 * s, y - 26 * s, 10 * s, 9 * s);
    },
    well(g, x, y, s) {
      g.fillStyle = '#8d8a84'; g.beginPath(); g.ellipse(x, y - 6 * s, 14 * s, 7 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2a3a4a'; g.beginPath(); g.ellipse(x, y - 8 * s, 9 * s, 4 * s, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#5a3a1e'; g.lineWidth = 3 * s; g.beginPath(); g.moveTo(x - 12 * s, y - 6 * s); g.lineTo(x - 12 * s, y - 30 * s); g.lineTo(x + 12 * s, y - 30 * s); g.lineTo(x + 12 * s, y - 6 * s); g.stroke();
    },
    mushroom(g, x, y, s) {
      g.fillStyle = '#f2e6d0'; g.fillRect(x - 2 * s, y - 7 * s, 4 * s, 7 * s);
      g.fillStyle = '#c4122f'; g.beginPath(); g.arc(x, y - 7 * s, 6 * s, Math.PI, 0); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x - 2 * s, y - 9 * s, 1.2 * s, 0, Math.PI * 2); g.arc(x + 2.5 * s, y - 10 * s, 1 * s, 0, Math.PI * 2); g.fill();
    },
  };
  // Décor de chaque lieu-dit : [type, densité]
  const ZONE_DECOR = {
    village: [['house', 0.05], ['well', 0.01], ['flower', 0.12], ['tree', 0.03]],
    foret: [['tree', 0.38, true], ['pine', 0.2], ['mushroom', 0.08], ['rock', 0.03]],
    lac: [['ice', 0.3], ['crystal', 0.06], ['pine', 0.04]],
    cimetiere: [['grave', 0.22], ['deadtree', 0.08], ['rock', 0.04]],
    champs: [['wheat', 0.4], ['tree', 0.02]],
    volcan: [['lava', 0.16], ['rock', 0.12], ['deadtree', 0.04]],
    ruines: [['pillar', 0.14], ['rock', 0.1]],
    marais: [['reeds', 0.2], ['pond', 0.06], ['deadtree', 0.05], ['mushroom', 0.05]],
    prairie: [['flower', 0.45], ['tree', 0.05], ['rock', 0.02]],
  };

  function buildChunk(cx, cy) {
    const c = document.createElement('canvas');
    c.width = CHUNK;
    c.height = CHUNK;
    const g = c.getContext('2d');
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    // Sol : couleur du lieu-dit, légèrement variée, chemins de terre
    for (let ty = 0; ty < CHUNK; ty += TILE / 2) {
      for (let tx = 0; tx < CHUNK; tx += TILE / 2) {
        const wx = x0 + tx + TILE / 4;
        const wy = y0 + ty + TILE / 4;
        const z = ZONES[Rules.survivorZone(wx, wy)];
        const out = wx < 0 || wy < 0 || wx > SV.map.w || wy > SV.map.h;
        const n = hash(Math.floor(wx / 32), Math.floor(wy / 32), 1);
        g.fillStyle = out ? '#1a2a1a' : shade(z.ground, (n - 0.5) * 0.12);
        g.fillRect(tx, ty, TILE / 2, TILE / 2);
        if (!out && roadDist(wx, wy) < 26 + n * 10) { g.fillStyle = shade('#b08a5a', (n - 0.5) * 0.15); g.fillRect(tx, ty, TILE / 2, TILE / 2); }
      }
    }
    // Brins d'herbe
    g.strokeStyle = 'rgba(0,0,0,.08)';
    for (let i = 0; i < 90; i++) {
      const x = hash(cx, cy, i * 3) * CHUNK;
      const y = hash(cx, cy, i * 3 + 1) * CHUNK;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 2, y - 5); g.stroke();
    }
    // Décor (une graine par case), triés par profondeur
    const items = [];
    for (let ty = 0; ty < CHUNK / TILE; ty++) {
      for (let tx = 0; tx < CHUNK / TILE; tx++) {
        const gx = cx * (CHUNK / TILE) + tx;
        const gy = cy * (CHUNK / TILE) + ty;
        const wx = gx * TILE + TILE / 2;
        const wy = gy * TILE + TILE / 2;
        if (wx < 0 || wy < 0 || wx > SV.map.w || wy > SV.map.h) { if (hash(gx, gy, 9) < 0.6) items.push(['pine', tx * TILE + hash(gx, gy, 2) * TILE, ty * TILE + hash(gx, gy, 3) * TILE, 1.2]); continue; }
        if (Math.hypot(wx - SV.map.w / 2, wy - SV.map.h / 2) < 160) continue; // place du village dégagée
        if (roadDist(wx, wy) < 50) continue;
        const zone = Rules.survivorZone(wx, wy);
        let r = hash(gx, gy, 5);
        for (const [type, density, dark] of ZONE_DECOR[zone]) {
          if (r < density) { items.push([type, tx * TILE + hash(gx, gy, 2) * TILE, ty * TILE + hash(gx, gy, 3) * TILE, 0.8 + hash(gx, gy, 4) * 0.5, dark, hash(gx, gy, 6)]); break; }
          r -= density;
        }
      }
    }
    items.sort((a, b) => a[2] - b[2]);
    for (const [type, x, y, s, dark, k] of items) DECOR[type](g, x, y, s, type === 'tree' ? dark : k);
    // Bord de la carte
    g.strokeStyle = 'rgba(0,0,0,.5)';
    g.lineWidth = 6;
    g.strokeRect(-x0, -y0, SV.map.w, SV.map.h);
    return c;
  }
  function chunk(cx, cy) {
    const k = cx * 100 + cy;
    let c = chunks.get(k);
    if (!c) {
      c = buildChunk(cx, cy);
      chunks.set(k, c);
      if (chunks.size > 40) chunks.delete(chunks.keys().next().value);
    }
    return c;
  }

  // ---------- Sprites des monstres (images en cache, 6 étapes d'animation) ----------
  const sprites = new Map();
  function sprite(kind, elite, step) {
    const key = `${kind}|${elite ? 1 : 0}|${step}`;
    let c = sprites.get(key);
    if (!c) {
      const size = elite ? 200 : 120;
      c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d');
      drawMonster(g, size / 2, size * 0.62, { kind, elite, scale: elite ? SV.elite.scale : 1 }, { t: step * 120, seed: step });
      sprites.set(key, c);
    }
    return c;
  }

  // ---------- Images du serveur ----------
  function onFrame(f) {
    if (!G.on && !f.over) return;
    const now = performance.now();
    G.frame = f;
    G.frameAt = now;
    G.srvT = f.t;
    // Ennemis : interpolation entre deux images
    const seen = new Set();
    for (let i = 0; i < f.e.length; i += 6) {
      const id = f.e[i];
      seen.add(id);
      let m = G.enemies.get(id);
      const x = f.e[i + 2];
      const y = f.e[i + 3];
      if (!m) { m = { id, kind: KINDS[f.e[i + 1]], x, y, px: x, py: y, tx: x, ty: y, t0: now, hp: f.e[i + 4], elite: !!f.e[i + 5], facing: 1, flash: 0, step: Math.floor(Math.random() * 6) }; G.enemies.set(id, m); } else {
        m.px = m.x; m.py = m.y; m.tx = x; m.ty = y; m.t0 = now;
        if (f.e[i + 4] < m.hp) m.flash = now;
        m.hp = f.e[i + 4];
      }
      if (Math.abs(m.tx - m.px) > 0.5) m.facing = m.tx > m.px ? 1 : -1;
    }
    for (const id of G.enemies.keys()) if (!seen.has(id)) G.enemies.delete(id);
    for (const e of f.ev) onEvent(e, now);
    // Correction douce de ma position si le serveur me voit ailleurs (vitesse bornée, ralentissement…)
    const dx = f.x - G.me.x;
    const dy = f.y - G.me.y;
    if (Math.hypot(dx, dy) > 70) { G.me.x += dx * 0.5; G.me.y += dy * 0.5; }
    if (G.lastHp != null && f.hp < G.lastHp) G.hurtAt = now;
    G.lastHp = f.hp;
    if (f.pend && f.pend.id > chosenId) showChoice(f); else hideChoice();
    if (f.over && !G.over) G.overFrame = f;
  }

  function onEvent(e, now) {
    switch (e.k) {
      case 'p':
        G.shots.set(e.id, { ...e, t0: now, born: G.srvT });
        break;
      case 'rm':
        G.shots.delete(e.id);
        break;
      case 'slash':
        G.fx.push({ k: 'slash', side: e.side, len: e.len, h: e.h, t0: now, life: 220 });
        Sound.play('hit');
        break;
      case 'zap':
        G.fx.push({ k: 'zap', x: e.x, y: e.y, r: e.r, t0: now, life: 260, seed: Math.random() });
        Sound.play('shoot', 'mage');
        break;
      case 'd':
        if (G.texts.length < 60) G.texts.push({ x: e.x + (Math.random() - 0.5) * 14, y: e.y, v: e.v, c: e.c, t0: now });
        break;
      case 'x':
        G.puffs.push({ x: e.x, y: e.y, t0: now });
        break;
      case 'hurt':
        G.hurtAt = now;
        break;
      case 'lvl':
        Sound.play('levelUp');
        break;
      case 'chest':
        Sound.play('chestBurst', 'epique');
        svToast(`🎁 Coffre ! ${e.items.map(optLabel).join(' · ')}`, 3600);
        break;
      case 'heal':
        Sound.play('potion', 'vie');
        svToast('🍗 +30 % de vie !', 1600);
        break;
      case 'magnet':
        Sound.play('petFind');
        svToast('🧲 Toutes les gemmes accourent !', 1600);
        break;
      case 'wave':
        svToast(`🌊 Vague ${e.n}`, 1600);
        Sound.play('roomEnter');
        break;
      case 'boss':
        svToast(`⚠️ ${Rules.SURVIVOR_BOSSES[e.kind].label} arrive !`, 3000, 'boss');
        Sound.play('roar', true);
        break;
      case 'bossDown':
        svToast(`🏆 ${Rules.SURVIVOR_BOSSES[e.kind].label} est vaincu !`, 3000);
        Sound.play('bossExplode');
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: 220, t0: now, life: 700, color: '#ffd34a' });
        break;
      case 'boom':
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: e.r, t0: now, life: 420, color: e.act === 'leap' ? '#d9a441' : '#ff6b3d' });
        Sound.play('slam');
        break;
      case 'blink':
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: 70, t0: now, life: 350, color: '#b98cff' });
        Sound.play('blink');
        break;
      case 'revive':
        svToast('👼 Seconde vie !', 2400);
        G.fx.push({ k: 'ring', x: G.me.x, y: G.me.y, r: 280, t0: now, life: 700, color: '#fff2a8' });
        Sound.play('potion', 'phenix');
        break;
      default:
    }
  }

  // ---------- Boucle ----------
  function inputDir() {
    let x = 0;
    let y = 0;
    const k = G.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    if (G.touch && G.touch.dx != null) { x = G.touch.dx; y = G.touch.dy; }
    const l = Math.hypot(x, y);
    return l > 0.15 ? { x: x / Math.max(1, l), y: y / Math.max(1, l) } : { x: 0, y: 0 };
  }

  function loop(now) {
    if (!G.on) return;
    G.raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - (G.last || now)) / 1000);
    G.last = now;
    const f = G.frame;
    const stopped = !f || f.pend || f.paused || G.paused || f.over;
    const d = inputDir();
    G.me.moving = !stopped && (d.x || d.y);
    if (G.me.moving) {
      const spd = (f && f.spd) || SV.player.speed;
      G.me.x = Math.max(20, Math.min(SV.map.w - 20, G.me.x + d.x * spd * dt));
      G.me.y = Math.max(20, Math.min(SV.map.h - 20, G.me.y + d.y * spd * dt));
      G.me.fx = d.x;
      G.me.fy = d.y;
    }
    if (now - G.lastSend > 33) {
      G.lastSend = now;
      socket.emit('sv:pos', { x: Math.round(G.me.x * 10) / 10, y: Math.round(G.me.y * 10) / 10, fx: G.me.fx, fy: G.me.fy });
    }
    if (f && !stopped) G.srvT = f.t + (now - G.frameAt) / 1000;
    draw(now);
    if (G.overFrame && !G.over && now - G.frameAt > 400) showOver(G.overFrame.over, null);
  }

  // ---------- Dessin ----------
  function draw(now) {
    const f = G.frame;
    const camX = Math.max(W / 2, Math.min(SV.map.w - W / 2, G.me.x)) - W / 2;
    const camY = Math.max(H / 2, Math.min(SV.map.h - H / 2, G.me.y)) - H / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Sol
    const cx0 = Math.floor(camX / CHUNK);
    const cy0 = Math.floor(camY / CHUNK);
    for (let cx = cx0; cx <= Math.floor((camX + W) / CHUNK); cx++) {
      for (let cy = cy0; cy <= Math.floor((camY + H) / CHUNK); cy++) ctx.drawImage(chunk(cx, cy), Math.round(cx * CHUNK - camX), Math.round(cy * CHUNK - camY));
    }
    ctx.translate(-Math.round(camX), -Math.round(camY));
    if (!f) return;
    const t = now / 1000;
    // Zones au sol : flaques d'acide, toiles, attaques annoncées
    for (const a of f.ar) {
      if (a.k === 'acid') {
        const g = ctx.createRadialGradient(a.x, a.y, 4, a.x, a.y, a.r);
        g.addColorStop(0, 'rgba(140, 255, 80, .55)');
        g.addColorStop(1, 'rgba(60, 200, 40, .15)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(a.x, a.y, a.r, a.r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(200, 255, 160, .7)';
        for (let i = 0; i < 4; i++) { const b = (t * 2 + i * 0.7) % 1; ctx.beginPath(); ctx.arc(a.x + Math.cos(i * 2.3) * a.r * 0.5, a.y + Math.sin(i * 1.7) * a.r * 0.4 - b * 6, 3 * (1 - b), 0, Math.PI * 2); ctx.fill(); }
      } else if (a.k === 'web') {
        ctx.strokeStyle = 'rgba(240, 240, 255, .55)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 8; i++) { const ang = (i / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + Math.cos(ang) * a.r, a.y + Math.sin(ang) * a.r * 0.8); ctx.stroke(); }
        for (let r = a.r / 3; r <= a.r; r += a.r / 3) { ctx.beginPath(); ctx.ellipse(a.x, a.y, r, r * 0.8, 0, 0, Math.PI * 2); ctx.stroke(); }
      } else if (a.k === 'warn') {
        const k = Math.max(0, Math.min(1, 1 - (a.left - (now - G.frameAt) / 1000) / 1));
        ctx.fillStyle = 'rgba(255, 50, 30, .16)';
        ctx.beginPath(); ctx.ellipse(a.x, a.y, a.r, a.r * 0.75, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255, 70, 40, .35)';
        ctx.beginPath(); ctx.ellipse(a.x, a.y, a.r * k, a.r * 0.75 * k, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255, 80, 50, .9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(a.x, a.y, a.r, a.r * 0.75, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // Aura de feu
    if (f.aura) {
      const pulse = 1 + Math.sin(t * 6) * 0.04;
      const g = ctx.createRadialGradient(G.me.x, G.me.y, 6, G.me.x, G.me.y, f.aura * pulse);
      g.addColorStop(0, 'rgba(255, 160, 60, .05)');
      g.addColorStop(0.7, 'rgba(255, 110, 30, .22)');
      g.addColorStop(1, 'rgba(255, 70, 20, .45)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(G.me.x, G.me.y, f.aura * pulse, 0, Math.PI * 2); ctx.fill();
    }
    // Gemmes et objets au sol
    for (let i = 0; i < f.g.length; i += 3) {
      const x = f.g[i];
      const y = f.g[i + 1];
      const gem = SV.gems[f.g[i + 2]];
      const s = 4 + f.g[i + 2] * 2;
      ctx.fillStyle = gem.color;
      ctx.beginPath(); ctx.moveTo(x, y - s * 1.4); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s * 1.2); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.beginPath(); ctx.moveTo(x, y - s * 1.4); ctx.lineTo(x + s * 0.4, y - s * 0.2); ctx.lineTo(x - s * 0.3, y); ctx.closePath(); ctx.fill();
    }
    const PK = ['🍗', '🧲', '🎁'];
    ctx.font = '26px system-ui';
    ctx.textAlign = 'center';
    for (let i = 0; i < f.pk.length; i += 3) {
      const bob = Math.sin(t * 4 + i) * 3;
      if (f.pk[i + 2] === 2) { ctx.shadowColor = '#ffd34a'; ctx.shadowBlur = 18; }
      ctx.fillText(PK[f.pk[i + 2]], f.pk[i], f.pk[i + 1] + bob);
      ctx.shadowBlur = 0;
    }
    // Personnages, ennemis et boss, triés par profondeur
    const k = Math.min(1, (now - G.frameAt) / 100);
    const list = [];
    for (const m of G.enemies.values()) {
      m.x = m.px + (m.tx - m.px) * k;
      m.y = m.py + (m.ty - m.py) * k;
      list.push(m);
    }
    list.sort((a, b) => a.y - b.y);
    let meDrawn = false;
    const drawMe = () => {
      meDrawn = true;
      const hurt = now - G.hurtAt < 160;
      const bob = G.me.moving ? -Math.abs(Math.sin(now / 90)) * 3 : 0;
      ctx.save();
      if (hurt) ctx.filter = 'brightness(1.8) saturate(0.4)';
      drawFighter(ctx, G.me.x, G.me.y - 16, { name: me.twitchDisplayName || me.username, cls: me.character.cls, look: myLook(), app: me.character.look }, { scale: 1.25, facing: G.me.fx < -0.1 ? -1 : 1, bob });
      ctx.restore();
      // barre de vie sous le personnage
      const w = 44;
      const r = Math.max(0, f.hp / f.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(G.me.x - w / 2, G.me.y + 16, w, 6);
      ctx.fillStyle = r > 0.5 ? '#3ddc5a' : r > 0.25 ? '#ffc21a' : '#ff4d6d'; ctx.fillRect(G.me.x - w / 2 + 1, G.me.y + 17, (w - 2) * r, 4);
    };
    for (const m of list) {
      if (!meDrawn && m.y > G.me.y) drawMe();
      const step = (Math.floor(now / 110) + m.step) % 6;
      const img = sprite(m.kind, m.elite, step);
      const size = img.width;
      ctx.save();
      ctx.translate(m.x, m.y);
      if (m.facing < 0) ctx.scale(-1, 1);
      ctx.drawImage(img, -size / 2, -size * 0.62);
      if (now - m.flash < 90) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6; ctx.drawImage(img, -size / 2, -size * 0.62); }
      ctx.restore();
      if (m.elite) {
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(m.x - 30, m.y - 70, 60, 6);
        ctx.fillStyle = '#ff9a1f'; ctx.fillRect(m.x - 29, m.y - 69, 58 * (m.hp / 100), 4);
      }
    }
    if (f.b) {
      const b = f.b;
      const BD = { troll: [1, 30], dragon: [0.9, 26], sorcier: [0.95, 20], mimic: [0.95, 18], liche: [0.95, 20], maexxna: [0.9, 6] }[b.kind];
      if (!meDrawn && b.y > G.me.y) drawMe();
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(b.x, b.y + 6, 46, 14, 0, 0, Math.PI * 2); ctx.fill();
      drawMonster(ctx, b.x, b.y - BD[1], { kind: b.kind }, { scale: BD[0], t: now, facing: b.x > G.me.x ? -1 : 1 });
    }
    if (!meDrawn) drawMe();
    // Orbes gardiens
    if (f.orb) {
      const o = f.orb;
      for (let i = 0; i < o.n; i++) {
        const a = (G.srvT - o.t0) * o.spd + (i / o.n) * Math.PI * 2;
        const x = G.me.x + Math.cos(a) * o.r;
        const y = G.me.y + Math.sin(a) * o.r;
        const g = ctx.createRadialGradient(x, y, 1, x, y, o.size);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, '#5fd3ff'); g.addColorStop(1, 'rgba(95, 211, 255, 0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, o.size, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Projectiles lancés (dagues, haches) : simulés à partir de leur lancer
    for (const [id, s] of G.shots) {
      const age = (now - s.t0) / 1000;
      if (age > s.life) { G.shots.delete(id); continue; }
      const x = s.x + s.vx * age;
      const y = s.y + s.vy * age + 0.5 * s.g * age * age;
      ctx.save();
      ctx.translate(x, y);
      if (s.w === 'hache') {
        ctx.rotate(age * 14);
        ctx.font = '30px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🪓', 0, 0);
      } else {
        ctx.rotate(Math.atan2(s.vy, s.vx));
        ctx.fillStyle = '#e8eef8';
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-4, -3.5); ctx.lineTo(-4, 3.5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#7a4a24'; ctx.fillRect(-10, -2.5, 7, 5);
        ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-28, 0); ctx.stroke();
      }
      ctx.restore();
    }
    // Traits magiques (à tête chercheuse : positions du serveur)
    for (let i = 0; i < f.bo.length; i += 2) {
      const x = f.bo[i];
      const y = f.bo[i + 1];
      const g = ctx.createRadialGradient(x, y, 1, x, y, 12);
      g.addColorStop(0, '#fff'); g.addColorStop(0.4, '#c79bff'); g.addColorStop(1, 'rgba(150, 80, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
    }
    // Projectiles ennemis
    const SHOT = [['#f4f1ea', 7], ['#ff7a1f', 13], ['#9fe8ff', 9], ['#c070ff', 11]];
    for (let i = 0; i < f.es.length; i += 3) {
      const [c, r] = SHOT[f.es[i + 2]];
      ctx.shadowColor = c; ctx.shadowBlur = 12;
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(f.es[i], f.es[i + 1], r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    // Effets : tailles d'épée, éclairs, ondes de choc
    G.fx = G.fx.filter((e) => now - e.t0 < e.life);
    for (const e of G.fx) {
      const p = (now - e.t0) / e.life;
      if (e.k === 'slash') {
        ctx.save();
        ctx.translate(G.me.x, G.me.y - 6);
        ctx.scale(e.side, 1);
        ctx.globalAlpha = 1 - p;
        const g = ctx.createLinearGradient(0, 0, e.len, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(200,220,255,.5)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(e.len * 0.5, 0, e.len * 0.55, e.h * 0.5, 0, -Math.PI / 2, Math.PI / 2);
        ctx.ellipse(e.len * 0.42, 0, e.len * 0.42, e.h * 0.32, 0, Math.PI / 2, -Math.PI / 2, true);
        ctx.fill();
        ctx.restore();
      } else if (e.k === 'zap') {
        ctx.save();
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = '#fff6a0'; ctx.lineWidth = 4; ctx.shadowColor = '#ffe63c'; ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.moveTo(e.x + 30, e.y - 420);
        for (let i = 1; i <= 7; i++) ctx.lineTo(e.x + (hash(i, Math.floor(e.seed * 1000)) - 0.5) * 40, e.y - 420 + i * 60);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 240, 150, .35)';
        ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r, e.r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (e.k === 'ring') {
        ctx.strokeStyle = e.color; ctx.globalAlpha = 1 - p; ctx.lineWidth = 6 * (1 - p) + 1;
        ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r * (0.4 + p * 0.6), e.r * 0.75 * (0.4 + p * 0.6), 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    // Fumée des monstres vaincus
    G.puffs = G.puffs.filter((e) => now - e.t0 < 380);
    for (const e of G.puffs) {
      const p = (now - e.t0) / 380;
      ctx.fillStyle = `rgba(255, 255, 255, ${0.5 * (1 - p)})`;
      for (let i = 0; i < 5; i++) { const a = i * 1.26; ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * 14 * p, e.y - 10 + Math.sin(a) * 10 * p, 7 * (1 - p) + 2, 0, Math.PI * 2); ctx.fill(); }
    }
    // Chiffres de dégâts
    G.texts = G.texts.filter((e) => now - e.t0 < 700);
    ctx.textAlign = 'center';
    for (const e of G.texts) {
      const p = (now - e.t0) / 700;
      ctx.globalAlpha = 1 - p * p;
      ctx.font = `900 ${e.c ? 20 : 14}px system-ui, sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.strokeText(e.v, e.x, e.y - 18 - p * 26);
      ctx.fillStyle = e.c ? '#ffd34a' : '#fff';
      ctx.fillText(e.v, e.x, e.y - 18 - p * 26);
    }
    ctx.globalAlpha = 1;
    // Interface (écran)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawHud(f, now, camX, camY);
  }

  function myLook() {
    const look = {};
    for (const [slot, item] of Object.entries(me.character.equipment)) if (item) look[slot] = item.rarity;
    return look;
  }

  const MINI = 170;
  let miniCanvas = null;
  function minimap() {
    if (miniCanvas) return miniCanvas;
    miniCanvas = document.createElement('canvas');
    miniCanvas.width = MINI;
    miniCanvas.height = MINI;
    const g = miniCanvas.getContext('2d');
    const s = SV.map.w / MINI;
    for (let y = 0; y < MINI; y += 2) for (let x = 0; x < MINI; x += 2) { g.fillStyle = ZONES[Rules.survivorZone(x * s, y * s)].ground; g.fillRect(x, y, 2, 2); }
    g.fillStyle = 'rgba(176, 138, 90, .9)';
    for (let y = 0; y < MINI; y += 2) for (let x = 0; x < MINI; x += 2) if (roadDist(x * s, y * s) < 40) g.fillRect(x, y, 2, 2);
    g.font = '700 9px system-ui';
    g.textAlign = 'center';
    for (const z of Object.values(ZONES)) {
      g.lineWidth = 2.5; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(z.label, z.x / s, z.y / s + 3);
      g.fillStyle = '#fff'; g.fillText(z.label, z.x / s, z.y / s + 3);
    }
    return miniCanvas;
  }

  function drawHud(f, now) {
    // Barre d'expérience
    ctx.fillStyle = 'rgba(10, 6, 24, .75)';
    ctx.fillRect(0, 0, W, 22);
    const xpR = Math.min(1, f.xp / f.xpNext);
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#2f7dff'); g.addColorStop(1, '#5fd3ff');
    ctx.fillStyle = g;
    ctx.fillRect(2, 2, (W - 4) * xpR, 18);
    ctx.font = '900 14px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText(`NIV ${f.level}`, 10, 16);
    // Temps, vague, kills
    ctx.textAlign = 'center';
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.strokeText(mmss(G.srvT), W / 2, 60);
    ctx.fillStyle = '#fff';
    ctx.fillText(mmss(G.srvT), W / 2, 60);
    ctx.font = '800 15px system-ui, sans-serif';
    const wl = Math.max(0, f.waveLeft - (now - G.frameAt) / 1000);
    const wtxt = `Vague ${f.wave}${f.wave % SV.bossEvery === SV.bossEvery - 1 ? ` · boss dans ${Math.ceil(wl)} s` : ''}`;
    ctx.strokeText(wtxt, W / 2, 82);
    ctx.fillStyle = f.wave % SV.bossEvery === SV.bossEvery - 1 ? '#ff8a6b' : '#cfe';
    ctx.fillText(wtxt, W / 2, 82);
    ctx.textAlign = 'right';
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.strokeText(`💀 ${fmt(f.kills)}`, W - 14, 50);
    ctx.fillStyle = '#fff';
    ctx.fillText(`💀 ${fmt(f.kills)}`, W - 14, 50);
    if (f.wave >= SV.dailyWave) { ctx.font = '800 13px system-ui'; ctx.fillStyle = '#ffd34a'; ctx.fillText('★ Vague 30 atteinte !', W - 14, 70); }
    // Armes et objets
    let x = 12;
    ctx.textAlign = 'center';
    for (const [id, lv] of f.weapons) {
      const Wp = Rules.SURVIVOR_WEAPONS[id];
      hudSlot(x, 32, Wp.icon, lv, Rules.SURVIVOR_WEAPON_MAX, '#ffd34a');
      x += 40;
    }
    x = 12;
    for (const [id, lv] of f.passives) {
      const P = Rules.SURVIVOR_PASSIVES[id];
      hudSlot(x, 76, P.icon, lv, P.max, '#5fd3ff');
      x += 40;
    }
    // Vie
    ctx.textAlign = 'left';
    ctx.font = '800 13px system-ui';
    ctx.fillStyle = '#fff';
    ctx.fillText(`❤️ ${f.hp} / ${f.maxHp}${f.revivals ? '   👼' : ''}${f.rerolls ? `   🎲 ${f.rerolls}` : ''}`, 14, 136);
    // Boss
    if (f.b) {
      const bw = 520;
      const bx = W / 2 - bw / 2;
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(bx, 96, bw, 18);
      ctx.fillStyle = '#c4122f'; ctx.fillRect(bx + 2, 98, (bw - 4) * (f.b.hp / f.b.maxHp), 14);
      ctx.textAlign = 'center'; ctx.font = '900 12px system-ui'; ctx.fillStyle = '#fff';
      ctx.fillText(`${Rules.SURVIVOR_BOSSES[f.b.kind].label} — ${fmt(f.b.hp)} / ${fmt(f.b.maxHp)}`, W / 2, 110);
      // flèche vers le boss hors de l'écran
      const dx = f.b.x - G.me.x;
      const dy = f.b.y - G.me.y;
      if (Math.abs(dx) > W / 2 - 40 || Math.abs(dy) > H / 2 - 40) {
        const a = Math.atan2(dy, dx);
        const px = W / 2 + Math.cos(a) * (H / 2 - 50);
        const py = H / 2 + Math.sin(a) * (H / 2 - 50);
        ctx.save(); ctx.translate(px, py); ctx.rotate(a);
        ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-8, -11); ctx.lineTo(-8, 11); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    // Lieu-dit
    const zone = Rules.survivorZone(G.me.x, G.me.y);
    if (zone !== G.zone) { G.zone = zone; G.zoneAt = now; }
    const za = now - G.zoneAt;
    if (za < 2600) {
      ctx.globalAlpha = za < 300 ? za / 300 : za > 2000 ? (2600 - za) / 600 : 1;
      ctx.textAlign = 'center';
      ctx.font = '900 26px system-ui, sans-serif';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.strokeText(`📍 ${ZONES[zone].label}`, W / 2, H - 70);
      ctx.fillStyle = '#fff2a8';
      ctx.fillText(`📍 ${ZONES[zone].label}`, W / 2, H - 70);
      ctx.globalAlpha = 1;
    }
    // Mini-carte
    const mx = W - MINI - 12;
    const my = H - MINI - 12;
    ctx.globalAlpha = 0.85;
    ctx.drawImage(minimap(), mx, my);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.strokeRect(mx, my, MINI, MINI);
    const s = MINI / SV.map.w;
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1;
    ctx.strokeRect(mx + (G.me.x - W / 2) * s, my + (G.me.y - H / 2) * s, W * s, H * s);
    if (f.b) { ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(mx + f.b.x * s, my + f.b.y * s, 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(mx + G.me.x * s, my + G.me.y * s, 3.5, 0, Math.PI * 2); ctx.fill();
    // Vie basse : bords rouges
    const low = f.hp / f.maxHp;
    if (low < 0.3 || now - G.hurtAt < 200) {
      const a = now - G.hurtAt < 200 ? 0.35 : (0.3 - low) * (0.8 + Math.sin(now / 150) * 0.3);
      const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
      v.addColorStop(0, 'rgba(255,0,0,0)'); v.addColorStop(1, `rgba(200, 0, 20, ${Math.max(0, a)})`);
      ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    }
    if (f.paused && !G.over) {
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, W, H);
    }
  }

  function hudSlot(x, y, icon, lv, max, color) {
    ctx.fillStyle = 'rgba(10, 6, 24, .7)';
    ctx.fillRect(x, y, 36, 36);
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, 35, 35);
    ctx.font = '20px system-ui'; ctx.textBaseline = 'middle';
    ctx.fillText(icon, x + 18, y + 16);
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < max; i++) { ctx.fillStyle = i < lv ? color : 'rgba(255,255,255,.2)'; ctx.fillRect(x + 3 + i * (30 / max), y + 30, 30 / max - 1, 3); }
  }

  // ---------- Fenêtres par-dessus le jeu ----------
  function optLabel(o) {
    if (o.type === 'weapon') return `${Rules.SURVIVOR_WEAPONS[o.id].icon} ${Rules.SURVIVOR_WEAPONS[o.id].label}${o.level > 1 ? ` niv. ${o.level}` : ''}`;
    if (o.type === 'passive') return `${Rules.SURVIVOR_PASSIVES[o.id].icon} ${Rules.SURVIVOR_PASSIVES[o.id].label}${o.level > 1 ? ` niv. ${o.level}` : ''}`;
    return o.type === 'heal' ? '🍗 Poulet rôti' : '💎 2 émeraudes';
  }
  function optCard(o, i) {
    let icon;
    let name;
    let lvl;
    let desc;
    if (o.type === 'weapon') {
      const Wp = Rules.SURVIVOR_WEAPONS[o.id];
      icon = Wp.icon; name = Wp.label; desc = Rules.survivorLevelText(o.id, o.level);
      lvl = o.level === 1 ? '<span class="sv-new">NOUVELLE ARME</span>' : `Niveau ${o.level - 1} → <b>${o.level}</b>`;
    } else if (o.type === 'passive') {
      const P = Rules.SURVIVOR_PASSIVES[o.id];
      icon = P.icon; name = P.label; desc = P.desc;
      lvl = o.level === 1 ? '<span class="sv-new">NOUVEL OBJET</span>' : `Niveau ${o.level - 1} → <b>${o.level}</b>`;
    } else if (o.type === 'heal') { icon = '🍗'; name = 'Poulet rôti'; desc = 'Rend 30 % de ta vie.'; lvl = ''; } else { icon = '💎'; name = 'Éclat d\'émeraude'; desc = '+2 émeraudes à la fin de la partie.'; lvl = ''; }
    return `<button class="sv-card ${o.type}" data-opt="${i}"><span class="sv-key">${i + 1}</span><span class="sv-ico">${icon}</span><span class="sv-name">${name}</span><span class="sv-lvl">${lvl}</span><span class="sv-desc">${desc}</span></button>`;
  }
  let choiceKey = '';
  function showChoice(f) {
    const key = JSON.stringify(f.pend.options) + f.rerolls;
    if (key === choiceKey) return;
    choiceKey = key;
    const el = $('sv-choice');
    el.innerHTML = `<div class="sv-choice-box"><div class="sv-title">⬆️ NIVEAU ${f.level} !</div><div class="sv-sub">Choisis une amélioration</div>
      <div class="sv-cards">${f.pend.options.map(optCard).join('')}</div>
      ${f.rerolls ? `<button class="secondary small" id="sv-reroll">🎲 Relancer les choix (${f.rerolls})</button>` : ''}</div>`;
    el.classList.add('open');
    el.querySelectorAll('[data-opt]').forEach((b) => { b.onclick = () => choose(Number(b.dataset.opt)); });
    const rr = $('sv-reroll');
    if (rr) rr.onclick = async () => { try { const r = await api('/api/survivor/reroll', {}); choiceKey = ''; onFrame(r.frame); } catch (e) { toast('⚠️ ' + e.message); } };
  }
  function hideChoice() {
    if (!choiceKey) return;
    choiceKey = '';
    $('sv-choice').classList.remove('open');
  }
  let choosing = false;
  let chosenId = 0; // dernier choix fait (une image en retard ne le rouvre pas)
  async function choose(i) {
    if (choosing || !G.frame || !G.frame.pend) return;
    choosing = true;
    const id = G.frame.pend.id;
    try {
      const r = await api('/api/survivor/choose', { index: i, id });
      chosenId = Math.max(chosenId, id);
      Sound.play('itemPick');
      choiceKey = '';
      onFrame(r.frame);
    } catch (e) { toast('⚠️ ' + e.message); }
    choosing = false;
  }

  async function setPause(on) {
    if (!G.on || G.over) return;
    G.paused = on;
    const el = $('sv-pause');
    if (on) {
      el.innerHTML = `<div class="sv-choice-box small"><div class="sv-title">⏸ Pause</div>
        <div class="sv-sub">La partie t'attend (elle se termine après 10 min sans toi).</div>
        <div class="row" style="justify-content:center;gap:10px"><button class="gold" id="sv-resume">▶ Continuer</button><button class="secondary" id="sv-quit">🏳️ Abandonner</button></div></div>`;
      el.classList.add('open');
      $('sv-resume').onclick = () => setPause(false);
      $('sv-quit').onclick = abandon;
    } else el.classList.remove('open');
    try { await api('/api/survivor/pause', { on }); } catch (e) { /* partie déjà finie */ }
  }

  async function abandon() {
    if (!confirm('Abandonner la partie ? Tes émeraudes seront comptées jusqu\'ici.')) return;
    try {
      const r = await api('/api/survivor/abandon', {});
      showOver(r.result, r.result);
    } catch (e) { toast('⚠️ ' + e.message); }
  }

  function svToast(text, ms = 2000, kind = '') {
    const el = $('sv-toast');
    el.textContent = text;
    el.className = `sv-toast show ${kind}`;
    clearTimeout(svToast.timer);
    svToast.timer = setTimeout(() => { el.className = 'sv-toast'; }, ms);
  }

  function showOver(res) {
    if (G.over) return;
    G.over = res;
    $('sv-pause').classList.remove('open');
    hideChoice();
    Sound.music.stop();
    Sound.play(res.wave >= SV.dailyWave ? 'victory' : 'defeat');
    const el = $('sv-over');
    const daily = res.daily ? `<div class="sv-daily">🎉 Récompense du jour : +${res.daily.chests} <i class="ico-chest"></i> coffres et +${res.daily.keys} 🗝️ Clé de boss !</div>` : '';
    el.innerHTML = `<div class="sv-choice-box"><div class="sv-title">${res.wave >= SV.dailyWave ? '🏆 Quelle survie !' : '💀 Fin de partie'}</div>
      ${res.record ? '<div class="sv-record">★ Nouveau record ! ★</div>' : ''}
      <div class="sv-stats">
        <div><span>Temps</span><b>${mmss(res.time)}</b></div><div><span>Vague</span><b>${res.wave}</b></div>
        <div><span>Monstres</span><b>${fmt(res.kills)}</b></div><div><span>Boss</span><b>${res.bosses}</b></div>
        <div><span>Niveau</span><b>${res.level}</b></div><div><span>Score</span><b class="gold-text">${fmt(res.score)}</b></div>
      </div>
      <div class="sv-emeralds">+<span id="sv-em-count">0</span> ${EM} émeraudes</div>${daily}
      <div class="sv-built">${(res.weapons || []).map(([id, lv]) => `<span>${Rules.SURVIVOR_WEAPONS[id].icon} ${lv}</span>`).join('')}${(res.passives || []).map(([id, lv]) => `<span>${Rules.SURVIVOR_PASSIVES[id].icon} ${lv}</span>`).join('')}</div>
      <div class="row" style="justify-content:center;gap:10px;margin-top:12px"><button class="gold" id="sv-again">🔁 Rejouer (${SV.price} 🪙)</button><button class="secondary" id="sv-back">🏕️ Retour au camp</button></div></div>`;
    el.classList.add('open');
    // Les émeraudes défilent
    const total = res.emeralds || 0;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / 1200);
      const n = $('sv-em-count');
      if (!n) return;
      n.textContent = fmt(total * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    $('sv-again').onclick = () => { stopGame(); startGame(); };
    $('sv-back').onclick = () => { stopGame(); loadState(); };
    if (typeof refresh === 'function') refresh().catch(() => {});
  }

  // ---------- Lancer / arrêter ----------
  async function startGame() {
    try {
      const r = await api('/api/survivor/start', { starter });
      beginGame(r.frame);
      Sound.play('battleStart');
      if (typeof refresh === 'function') refresh().catch(() => {});
    } catch (e) { toast('⚠️ ' + e.message); }
  }

  function beginGame(frame) {
    G.on = true;
    G.over = null;
    G.overFrame = null;
    G.paused = false;
    G.enemies.clear();
    G.shots.clear();
    G.fx = [];
    G.texts = [];
    G.puffs = [];
    G.lastHp = null;
    G.zone = null;
    choiceKey = '';
    chosenId = 0;
    $('sv-over').classList.remove('open');
    $('sv-pause').classList.remove('open');
    $('sv-choice').classList.remove('open');
    $('sv-lobby').style.display = 'none';
    $('sv-game').style.display = '';
    ctx = $('sv-canvas').getContext('2d');
    if (frame) { G.me.x = frame.x; G.me.y = frame.y; onFrame(frame); }
    G.last = 0;
    cancelAnimationFrame(G.raf);
    G.raf = requestAnimationFrame(loop);
    $('sv-game').scrollIntoView({ behavior: 'smooth', block: 'center' });
    Sound.music.stop(0.2);
    setTimeout(() => { if (G.on && !G.over) Sound.music.start(0, 'dungeon'); }, 300);
  }

  function stopGame() {
    G.on = false;
    cancelAnimationFrame(G.raf);
    $('sv-game').style.display = 'none';
    $('sv-lobby').style.display = '';
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    Sound.music.stop();
  }

  // ---------- Commandes ----------
  const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  document.addEventListener('keydown', (e) => {
    if (!G.on || !active || e.target.tagName === 'INPUT') return;
    if (KEYS.includes(e.code)) { G.keys.add(e.code); e.preventDefault(); }
    if (e.code === 'Escape' && !G.over && G.frame && !G.frame.pend) { e.preventDefault(); setPause(!G.paused); }
    if (G.frame && G.frame.pend && /^Digit[1-4]$/.test(e.code)) choose(Number(e.code.slice(5)) - 1);
  });
  document.addEventListener('keyup', (e) => G.keys.delete(e.code));
  window.addEventListener('blur', () => G.keys.clear());
  // Joystick au doigt (téléphone)
  function setupTouch() {
    const cv = $('sv-canvas');
    cv.addEventListener('touchstart', (e) => { const t = e.touches[0]; G.touch = { x0: t.clientX, y0: t.clientY, dx: 0, dy: 0 }; e.preventDefault(); }, { passive: false });
    cv.addEventListener('touchmove', (e) => {
      if (!G.touch) return;
      const t = e.touches[0];
      const dx = t.clientX - G.touch.x0;
      const dy = t.clientY - G.touch.y0;
      const l = Math.hypot(dx, dy);
      G.touch.dx = l > 8 ? dx / Math.max(l, 40) : 0;
      G.touch.dy = l > 8 ? dy / Math.max(l, 40) : 0;
      e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchend', () => { G.touch = null; });
    $('sv-full').onclick = () => {
      const el = $('sv-game');
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    };
    $('sv-pause-btn').onclick = () => setPause(!G.paused);
  }

  // ---------- Camp : lancer une partie, méta-progression, classement ----------
  async function loadState() {
    try {
      state = await api('/api/survivor');
      if (!starter || !state.starters.includes(starter)) starter = state.starter;
      renderLobby();
      renderMeta();
      renderBoard();
      if (state.playing && !G.on) {
        beginGame(null);
        svToast('▶ Ta partie en cours reprend !', 2500);
      }
    } catch (e) { /* hors ligne */ }
  }

  function renderLobby() {
    if (!state) return;
    const c = me.character;
    const b = state.best;
    const weapons = Object.keys(Rules.SURVIVOR_WEAPONS);
    $('sv-lobby').innerHTML = `
      <div class="sv-hero">
        <div class="sv-hero-art"><canvas id="sv-hero-cv" width="420" height="200"></canvas></div>
        <div class="sv-hero-info">
          <div class="sv-balance">${EM} <b>${fmt(state.emeralds)}</b> émeraudes · 🪙 <b>${fmt(c.gold)}</b></div>
          <div class="sv-start-title">Arme de départ</div>
          <div class="sv-starters">${weapons.map((id) => {
    const Wp = Rules.SURVIVOR_WEAPONS[id];
    const ok = state.starters.includes(id);
    return `<button class="sv-starter ${ok ? '' : 'locked'} ${starter === id ? 'active' : ''}" data-starter="${id}" ${ok ? '' : 'disabled'} title="${ok ? Wp.desc : 'À débloquer dans la méta-progression'}">${Wp.icon}<span>${Wp.label}</span>${ok ? '' : '<em>🔒</em>'}</button>`;
  }).join('')}</div>
          <button class="gold big-btn sv-play" id="sv-play" ${c.gold < SV.price ? 'disabled' : ''}>▶ Jouer — ${SV.price} 🪙</button>
          <div class="sv-daily-status ${state.dailyDone ? 'done' : ''}">${state.dailyDone ? '✅ Récompense de la vague 30 déjà obtenue aujourd\'hui (revient demain)' : `🎁 Récompense du jour : atteins la vague ${SV.dailyWave} → +${SV.daily.chests} coffres et +${SV.daily.keys} Clé de boss`}</div>
          <div class="muted" style="font-size:13px">${b ? `Ton record : <b>${fmt(b.score)}</b> points (vague ${b.wave}, ${mmss(b.time)}, ${fmt(b.kills)} monstres, ${b.bosses} boss) · ${state.runs} partie(s)` : 'Pas encore de record : à toi de jouer !'}</div>
          <div class="muted" style="font-size:12px">⌨️ ZQSD ou flèches pour bouger · tes armes tirent seules · Échap : pause · 1-4 : choisir</div>
        </div>
      </div>`;
    $('sv-lobby').querySelectorAll('[data-starter]').forEach((el) => {
      el.onclick = async () => {
        starter = el.dataset.starter;
        renderLobby();
        try { await api('/api/survivor/starter', { id: starter }); } catch (e) { /* ignore */ }
      };
    });
    $('sv-play').onclick = startGame;
    drawHero();
  }

  // Petit tableau du camp : ton personnage face à une horde
  function drawHero() {
    const cv = $('sv-hero-cv');
    if (!cv) return;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 200);
    grad.addColorStop(0, '#2a1a3a'); grad.addColorStop(1, '#1a3a24');
    g.fillStyle = grad; g.fillRect(0, 0, 420, 200);
    g.fillStyle = '#ffe9a8'; g.beginPath(); g.arc(360, 40, 18, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 6; i++) DECOR.pine(g, 20 + i * 75, 150, 1.1);
    g.fillStyle = '#2f6a39'; g.fillRect(0, 150, 420, 50);
    const kinds = ['gobelin', 'squelette', 'slime', 'chauve_souris', 'rat', 'araignee', 'gobelin_violet'];
    kinds.forEach((k, i) => { drawMonster(g, 250 + (i % 4) * 42, 150 + Math.floor(i / 4) * 26 - 8, { kind: k }, { t: 300 * i, facing: -1, scale: 0.9 }); });
    drawFighter(g, 120, 152, { name: me.twitchDisplayName || me.username, cls: me.character.cls, look: myLook(), app: me.character.look }, { scale: 2, facing: 1, swing: 0.6 });
    g.font = '900 34px system-ui'; g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 5; g.textAlign = 'left';
    g.strokeText('SURVIVOR', 14, 44); g.fillText('SURVIVOR', 14, 44);
  }

  function renderMeta() {
    if (!state) return;
    const em = state.emeralds;
    const metaCards = Object.entries(Rules.SURVIVOR_META).map(([id, M]) => {
      const lv = state.meta[id] || 0;
      const cost = Rules.survivorMetaCost(id, lv);
      return `<div class="sv-meta-card ${lv >= M.max ? 'maxed' : ''}">
        <div class="smc-head"><span class="smc-ico">${M.icon}</span><b>${M.label}</b></div>
        <div class="smc-desc">${M.desc} par niveau</div>
        <div class="smc-pips">${Array.from({ length: M.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div>
        ${cost == null ? '<div class="smc-max">MAX</div>' : `<button class="small ${em >= cost ? 'gold' : 'secondary'}" data-meta="${id}" ${em >= cost ? '' : 'disabled'}>${fmt(cost)} ${EM}</button>`}
      </div>`;
    }).join('');
    const U = Rules.SURVIVOR_UNLOCKS;
    const weaponCards = Object.entries(Rules.SURVIVOR_WEAPONS).map(([id, Wp]) => {
      const have = state.unlocked.weapons.includes(id);
      const st = state.starters.includes(id);
      const u = U.weapons[id];
      return `<div class="sv-meta-card unlock ${have ? 'owned' : ''}">
        <div class="smc-head"><span class="smc-ico">${Wp.icon}</span><b>${Wp.label}</b></div>
        <div class="smc-desc">${Wp.desc}</div>
        ${have ? '<div class="smc-ok">✅ Dans les tirages</div>' : `<button class="small ${em >= u.price ? 'gold' : 'secondary'}" data-unlock="weapon:${id}" ${em >= u.price ? '' : 'disabled'}>Débloquer · ${fmt(u.price)} ${EM}</button>`}
        ${st ? '<div class="smc-ok">⚔️ Arme de départ</div>' : have ? `<button class="small ${em >= u.starter ? 'gold' : 'secondary'}" data-unlock="starter:${id}" ${em >= u.starter ? '' : 'disabled'}>Arme de départ · ${fmt(u.starter)} ${EM}</button>` : `<div class="smc-desc muted">Arme de départ : ${fmt(u.starter)} ${EM} (après déblocage)</div>`}
      </div>`;
    }).join('');
    const passiveCards = Object.entries(Rules.SURVIVOR_PASSIVES).map(([id, P]) => {
      const have = state.unlocked.passives.includes(id);
      const price = U.passives[id];
      return `<div class="sv-meta-card unlock ${have ? 'owned' : ''}">
        <div class="smc-head"><span class="smc-ico">${P.icon}</span><b>${P.label}</b></div>
        <div class="smc-desc">${P.desc} (×${P.max} au plus)</div>
        ${have ? '<div class="smc-ok">✅ Dans les tirages</div>' : `<button class="small ${em >= price ? 'gold' : 'secondary'}" data-unlock="passive:${id}" ${em >= price ? '' : 'disabled'}>Débloquer · ${fmt(price)} ${EM}</button>`}
      </div>`;
    }).join('');
    $('sv-meta').innerHTML = `<h2>💎 Méta-progression <span class="sub">${EM} ${fmt(em)} émeraudes</span></h2>
      <p class="muted" style="font-size:13px">Ces améliorations ne comptent qu'au Survivor (jamais dans les autres modes). Les armes et objets à débloquer
        rejoignent les tirages des montées de niveau ; une arme peut aussi devenir ton arme de départ.</p>
      <h3>📈 Stats de départ</h3><div class="sv-meta-grid">${metaCards}</div>
      <h3>⚔️ Armes</h3><div class="sv-meta-grid">${weaponCards}</div>
      <h3>🎒 Objets</h3><div class="sv-meta-grid">${passiveCards}</div>`;
    $('sv-meta').querySelectorAll('[data-meta]').forEach((b) => { b.onclick = () => buy('/api/survivor/meta', { id: b.dataset.meta }); });
    $('sv-meta').querySelectorAll('[data-unlock]').forEach((b) => {
      const [kind, id] = b.dataset.unlock.split(':');
      b.onclick = () => buy('/api/survivor/unlock', { kind, id });
    });
  }

  async function buy(url, body) {
    try {
      await api(url, body);
      Sound.play('buy');
      await loadState();
      if (typeof refresh === 'function') refresh().catch(() => {});
    } catch (e) { toast('⚠️ ' + e.message); }
  }

  function renderBoard() {
    if (!state) return;
    const B = state.board;
    const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    $('sv-board').innerHTML = `<h2>🏆 Classement du Survivor <span class="sub">${B.players} survivant(s)</span></h2>
      <p class="muted" style="font-size:13px">Score = secondes de survie × 10 + monstres tués + 1 000 par boss vaincu (meilleure partie de chacun).</p>
      ${B.top.length ? `<table class="sv-board-table"><tr><th></th><th>Joueur</th><th>Score</th><th>Vague</th><th>Temps</th><th>Monstres</th><th>Boss</th></tr>
        ${B.top.map((r, i) => `<tr class="${r.id === me.id ? 'mine' : ''}"><td>${medal(i)}</td><td><b>${esc(r.name)}</b></td><td class="gold-text"><b>${fmt(r.score)}</b></td><td>${r.wave}</td><td>${mmss(r.time)}</td><td>${fmt(r.kills)}</td><td>${r.bosses}</td></tr>`).join('')}</table>`
    : '<p class="muted">Personne n\'a encore survécu… Sois le premier !</p>'}
      ${B.me && B.me.rank > 10 ? `<p>Ta place : <b>${B.me.rank}ᵉ</b> avec ${fmt(B.me.score)} points.</p>` : ''}`;
  }

  // ---------- Entrée / sortie de l'onglet ----------
  let touchReady = false;
  function enter() {
    if (!me) return;
    active = true;
    if (!touchReady) { setupTouch(); touchReady = true; }
    loadState();
  }
  function leave() {
    if (!active) return;
    active = false;
    G.keys.clear();
    if (G.on && !G.over && !G.paused) setPause(true);
  }

  window.Survivor = {
    enter,
    leave,
    onFrame,
    onEnd(res) { if (G.on) showOver(res); },
    onBoard() { if (active && !G.on) loadState(); },
    refreshLobby() { if (!G.on && state) { state.emeralds = me.character.emeralds; renderLobby(); } },
    get active() { return active; },
  };
})();
