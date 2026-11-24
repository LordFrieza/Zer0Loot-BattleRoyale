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
  // Projectiles ennemis : [couleur, rayon] — os du squelette en rouge vif, boules de feu, glace, orbes
  const ESHOT = [['#ff2a2a', 8], ['#ff7a1f', 13], ['#7fdcff', 10], ['#d05cff', 11], ['#c9d4ff', 11], ['#ff4fa8', 9]]; // os, feu, glace, orbe, âme (Ether), carte (Lilith)
  const W = 1280;
  const H = 720;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const EM = '<i class="ico-emerald"></i>';
  // Icône d'émeraude dessinée sur le canvas (même forme et même vert que .ico-emerald) : centre (x, y), demi-largeur r
  function emeraldIcon(ctx, x, y, r) {
    const k = r / 10;
    ctx.save();
    ctx.translate(x - 12 * k, y - 12 * k);
    ctx.scale(k, k);
    ctx.fillStyle = '#20c26a'; ctx.strokeStyle = '#0a5a2e'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(7, 2); ctx.lineTo(17, 2); ctx.lineTo(22, 9); ctx.lineTo(12, 22); ctx.lineTo(2, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(147, 255, 196, .8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(7, 2); ctx.lineTo(12, 9); ctx.lineTo(17, 2); ctx.moveTo(2, 9); ctx.lineTo(22, 9); ctx.moveTo(12, 9); ctx.lineTo(12, 22); ctx.stroke();
    ctx.restore();
  }

  const X = Rules.SURVIVOR_EXPLORE;
  const ALTARS = Object.entries(ZONES).filter(([id]) => id !== 'village').map(([id, z]) => ({ zone: id, x: z.x, y: z.y }));
  let state = null; // GET /api/survivor
  let active = false;
  let starter = null;

  // ---------- Partie ----------
  const G = {
    on: false, frame: null, frameAt: 0, srvT: 0, me: { x: SV.map.w / 2, y: SV.map.h / 2, fx: 1, fy: 0, moving: false },
    keys: new Set(), touch: null, enemies: new Map(), shots: new Map(), proj: new Map(), gems: new Map(), gemGot: new Set(), fx: [], texts: [], lastSend: 0, zone: null, zoneAt: 0,
    hurtAt: 0, raf: 0, last: 0, lastHp: null, puffs: [], over: null, paused: false,
  };
  let ctx = null;

  // ---------- Carte : morceaux de 512 px dessinés une fois (sol fondu, rivière, routes, décor), gardés en cache ----------
  const CHUNK = 512;
  const TILE = 64;
  const CELL = 8; // résolution du sol (lissé ensuite : pas de gros carrés)
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
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  // Bruit lisse (valeurs aléatoires fixes interpolées) pour marbrer le sol
  function vnoise(x, y, s) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = x - xi;
    const v = y - yi;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    const a = hash(xi, yi, s);
    const b = hash(xi + 1, yi, s);
    const c = hash(xi, yi + 1, s);
    const d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  }
  const fbm = (x, y) => vnoise(x / 260, y / 260, 11) * 0.55 + vnoise(x / 90, y / 90, 12) * 0.3 + vnoise(x / 30, y / 30, 13) * 0.15;
  // Deux teintes par lieu-dit, mélangées par le bruit
  const GROUND = {
    village: ['#7cb862', '#68a552'], foret: ['#2f6a39', '#224f2b'], lac: ['#e3f1f7', '#bcd9e6'], cimetiere: ['#5d6553', '#474d42'],
    champs: ['#cdb75a', '#ae9b45'], volcan: ['#4e2a22', '#2f1c18'], ruines: ['#a9a08a', '#8b946b'], marais: ['#4d5e3a', '#38482f'], prairie: ['#93c86e', '#a8d97c'],
  };
  const GROUND_RGB = Object.fromEntries(Object.entries(GROUND).map(([k, [a, b]]) => [k, [rgb(a), rgb(b)]]));
  const OUTSIDE = rgb('#1b301e');
  function groundRGB(x, y) {
    if (x < 0 || y < 0 || x > SV.map.w || y > SV.map.h) return OUTSIDE;
    const n = fbm(x, y);
    const near = Rules.survivorZoneNear(x, y);
    const mix = (id) => { const [p, q] = GROUND_RGB[id]; return [p[0] + (q[0] - p[0]) * n, p[1] + (q[1] - p[1]) * n, p[2] + (q[2] - p[2]) * n]; };
    const A = mix(near.a);
    // Frontière fondue sur une centaine de pixels
    // Frontière fondue et irrégulière (le bruit la fait onduler finement)
    const k = Math.max(0, Math.min(1, (near.db - near.da + (vnoise(x / 70, y / 70, 14) - 0.5) * 70) / 45));
    const t = 0.5 * (1 - k * k * (3 - 2 * k));
    if (t <= 0.001) return A;
    const B = mix(near.b);
    return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
  }

  // Lignes courbes : routes, rivière (listes de points)
  function catmull(pts, steps = 10) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  // Géographie partagée avec le serveur (l'eau y ralentit) : routes, rivière, lac gelé, mare, cratère, ponts
  const K = SV.mapScale;
  const MAP = Rules.survivorMap();
  const { roads: ROADS, river: RIVER, lake: LAKE, pond: POND, crater: CRATER, lava: LAVA, bridges: BRIDGES } = MAP;
  const bbox = (pts) => { const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 }; };
  const LB = bbox(LAKE);
  const PB = bbox(POND);
  function polyDist(x, y, lines) {
    let best = Infinity;
    for (const pts of lines) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        if (Math.min(ax, bx) - best > x || Math.max(ax, bx) + best < x || Math.min(ay, by) - best > y || Math.max(ay, by) + best < y) continue;
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
        if (d < best) best = d;
      }
    }
    return best;
  }
  const roadDist = (x, y) => polyDist(x, y, ROADS);
  const riverDist = (x, y) => polyDist(x, y, [RIVER]);
  function inPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const strokePath = (g, pts) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); };
  const fillPoly = (g, pts) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); };

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

  // Forme fermée arrondie (milieux des côtés reliés par des courbes)
  function smoothClosed(g, pts) {
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    g.beginPath();
    const m0 = mid(pts[pts.length - 1], pts[0]);
    g.moveTo(m0[0], m0[1]);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const m = mid(p, pts[(i + 1) % pts.length]);
      g.quadraticCurveTo(p[0], p[1], m[0], m[1]);
    }
    g.closePath();
  }
  // Détails du sol posés sur une grille du monde (débordent d'un morceau à l'autre sans coupure)
  const DETAIL = {
    grass(g, x, y, k, base) {
      g.strokeStyle = shade(base, -0.28); g.lineWidth = 1.4;
      for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(x + i * 3, y); g.quadraticCurveTo(x + i * 4, y - 4, x + i * 5 + (k - 0.5) * 4, y - 7 - k * 3); g.stroke(); }
      if (k > 0.6) { g.strokeStyle = shade(base, 0.25); g.beginPath(); g.moveTo(x + 6, y + 2); g.lineTo(x + 8, y - 5); g.stroke(); }
    },
    snow(g, x, y, k) {
      g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(x, y, 1.2 + k, 0, Math.PI * 2); g.fill();
      if (k > 0.55) { g.strokeStyle = 'rgba(120, 165, 195, .35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 14, y + 3); g.lineTo(x - 2, y - 1); g.lineTo(x + 12, y + 4); g.stroke(); }
    },
    ash(g, x, y, k) {
      g.strokeStyle = 'rgba(15, 8, 6, .55)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x - 12, y); g.lineTo(x - 3, y - 3); g.lineTo(x + 4, y + 2); g.lineTo(x + 13, y - 1); g.stroke();
      if (k > 0.7) { g.fillStyle = '#ff8a3d'; g.shadowColor = '#ff6a1f'; g.shadowBlur = 6; g.beginPath(); g.arc(x + 4, y + 2, 1.6, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0; }
    },
    flagstone(g, x, y, k, base) {
      if (k > 0.22) return k > 0.6 ? DETAIL.grass(g, x, y, k, '#8b946b') : undefined;
      for (let i = 0; i < 3; i++) {
        const w = 14 + hash(x | 0, y | 0, i) * 12;
        g.fillStyle = shade('#c9c0aa', (hash(y | 0, x | 0, i) - 0.5) * 0.2); g.strokeStyle = 'rgba(60, 55, 45, .35)'; g.lineWidth = 1;
        g.beginPath(); g.roundRect(x - 18 + (i % 2) * 18, y - 10 + Math.floor(i / 2) * 12, w, 10, 3); g.fill(); g.stroke();
      }
    },
    mud(g, x, y, k) {
      if (k > 0.35) return DETAIL.grass(g, x, y, k, '#4d5e3a');
      g.fillStyle = 'rgba(40, 48, 30, .55)'; g.beginPath(); g.ellipse(x, y, 16 + k * 20, 7 + k * 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(150, 190, 170, .25)'; g.beginPath(); g.ellipse(x - 4, y - 2, 6, 2, 0, 0, Math.PI * 2); g.fill();
    },
    dirt(g, x, y, k, base) {
      if (k > 0.3) return DETAIL.grass(g, x, y, k, base);
      g.fillStyle = 'rgba(70, 60, 45, .35)'; g.beginPath(); g.ellipse(x, y, 14 + k * 20, 6 + k * 8, k * 3, 0, Math.PI * 2); g.fill();
    },
    stubble(g, x, y, k) {
      g.strokeStyle = 'rgba(120, 95, 35, .5)'; g.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(x + i * 5 - 5, y); g.lineTo(x + i * 5 - 4, y - 5 - k * 3); g.stroke(); }
    },
  };
  const ZONE_DETAIL = { village: 'grass', foret: 'grass', lac: 'snow', cimetiere: 'dirt', champs: 'stubble', volcan: 'ash', ruines: 'flagstone', marais: 'mud', prairie: 'grass' };

  function buildChunk(cx, cy) {
    const c = document.createElement('canvas');
    c.width = CHUNK;
    c.height = CHUNK;
    const g = c.getContext('2d');
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    // 1) Sol : couleurs calculées tous les 8 px puis agrandies en douceur (frontières fondues, pas de carrés)
    const n = CHUNK / CELL + 3;
    const small = document.createElement('canvas');
    small.width = n;
    small.height = n;
    const sg = small.getContext('2d');
    const img = sg.createImageData(n, n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const [r, gg, b] = groundRGB(x0 + (i - 1) * CELL + CELL / 2, y0 + (j - 1) * CELL + CELL / 2);
        const o = (j * n + i) * 4;
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    sg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(small, -CELL, -CELL, n * CELL, n * CELL);
    g.translate(-x0, -y0);
    const inChunk = (x, y, m) => x > x0 - m && x < x0 + CHUNK + m && y > y0 - m && y < y0 + CHUNK + m;
    // 2) Lac gelé et cratère du volcan
    if (inChunk(LB.cx, LB.cy, (LB.x1 - LB.x0) / 2 + 100)) {
      g.fillStyle = 'rgba(150, 200, 225, .55)'; smoothClosed(g, LAKE.map(([x, y]) => [x + (x - LB.cx) * 0.06, y + (y - LB.cy) * 0.06])); g.fill();
      g.fillStyle = '#bfe3f2'; smoothClosed(g, LAKE); g.fill();
      g.save(); smoothClosed(g, LAKE); g.clip();
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2;
      for (let i = 0; i < 40; i++) { const x = LB.x0 + hash(i, 1, 40) * (LB.x1 - LB.x0); const y = LB.y0 + hash(i, 2, 40) * (LB.y1 - LB.y0); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 30 + hash(i, 3, 40) * 50, y + (hash(i, 4, 40) - 0.5) * 30); g.lineTo(x + 50 + hash(i, 5, 40) * 60, y + (hash(i, 6, 40) - 0.5) * 50); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,.35)';
      for (let i = 0; i < 18; i++) { g.beginPath(); g.ellipse(LB.x0 + hash(i, 7, 40) * (LB.x1 - LB.x0), LB.y0 + hash(i, 8, 40) * (LB.y1 - LB.y0), 40 + hash(i, 9, 40) * 60, 8, -0.2, 0, Math.PI * 2); g.fill(); }
      g.restore();
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 4; smoothClosed(g, LAKE); g.stroke();
    }
    if (inChunk(CRATER.x, CRATER.y, CRATER.r + 80)) {
      const R = CRATER.r;
      const cg = g.createRadialGradient(CRATER.x, CRATER.y, R * 0.3, CRATER.x, CRATER.y, R * 1.25);
      cg.addColorStop(0, '#3a1d18'); cg.addColorStop(0.75, '#5e3326'); cg.addColorStop(1, 'rgba(78, 42, 34, 0)');
      g.fillStyle = cg; g.beginPath(); g.ellipse(CRATER.x, CRATER.y, R * 1.25, R * 0.95, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#24130f'; smoothClosed(g, LAVA.map(([x, y]) => [CRATER.x + (x - CRATER.x) * 1.25, CRATER.y + (y - CRATER.y) * 1.25])); g.fill();
      g.save(); g.shadowColor = '#ff6a1f'; g.shadowBlur = 30;
      const lg = g.createRadialGradient(CRATER.x, CRATER.y, 10, CRATER.x, CRATER.y, 170 * K);
      lg.addColorStop(0, '#ffe27a'); lg.addColorStop(0.45, '#ff8a2a'); lg.addColorStop(1, '#c2301a');
      g.fillStyle = lg; smoothClosed(g, LAVA); g.fill(); g.restore();
      g.strokeStyle = 'rgba(255, 230, 140, .5)'; g.lineWidth = 2;
      for (let i = 0; i < 8; i++) { const a = hash(i, 1, 50) * Math.PI * 2; const r = (40 + hash(i, 2, 50) * 70) * K; g.beginPath(); g.arc(CRATER.x + Math.cos(a) * r, CRATER.y + Math.sin(a) * r * 0.7, (10 + hash(i, 3, 50) * 18) * K, 0, Math.PI); g.stroke(); }
      // Coulées de lave vers l'extérieur
      g.save(); g.shadowColor = '#ff6a1f'; g.shadowBlur = 12; g.strokeStyle = '#ff7a26'; g.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const a = Math.PI * (1.02 + i * 0.2);
        const pts = catmull([0, 1, 2, 3].map((s) => [CRATER.x + Math.cos(a + (hash(i, s, 51) - 0.5) * 0.5) * (150 + s * 55) * K, CRATER.y + Math.sin(a + (hash(i, s, 51) - 0.5) * 0.5) * (110 + s * 45) * K]), 8);
        g.lineWidth = (6 - i * 1.5) * K; strokePath(g, pts); g.stroke();
      }
      g.restore();
    }
    // 3) Détails du sol (touffes d'herbe, neige, cendres, dalles, boue…)
    const DS = 40;
    for (let gy = Math.floor((y0 - DS) / DS); gy <= Math.floor((y0 + CHUNK + DS) / DS); gy++) {
      for (let gx = Math.floor((x0 - DS) / DS); gx <= Math.floor((x0 + CHUNK + DS) / DS); gx++) {
        const k = hash(gx, gy, 31);
        if (k < 0.35) continue;
        const x = gx * DS + hash(gx, gy, 32) * DS;
        const y = gy * DS + hash(gx, gy, 33) * DS;
        if (x < 0 || y < 0 || x > SV.map.w || y > SV.map.h) continue;
        const zone = Rules.survivorZone(x, y);
        DETAIL[ZONE_DETAIL[zone]](g, x, y, hash(gx, gy, 34), GROUND[zone][0]);
      }
    }
    // 4) Rivière (berges, eau, reflets)
    const RW = MAP.width.river;
    if (RIVER.some(([x, y]) => inChunk(x, y, 160))) {
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = 'rgba(70, 60, 40, .45)'; g.lineWidth = RW + 18 * K; strokePath(g, RIVER); g.stroke();
      g.strokeStyle = '#3f86b8'; g.lineWidth = RW; strokePath(g, RIVER); g.stroke();
      g.strokeStyle = '#5aa6d6'; g.lineWidth = RW * 0.62; strokePath(g, RIVER); g.stroke();
      g.strokeStyle = 'rgba(220, 245, 255, .55)'; g.lineWidth = 2; g.setLineDash([18, 26]);
      strokePath(g, RIVER.map(([x, y], i) => [x + Math.sin(i * 0.9) * 6, y])); g.stroke(); g.setLineDash([]);
      for (let i = 0; i < RIVER.length; i += 3) { const [x, y] = RIVER[i]; if (!inChunk(x, y, 60)) continue; const s = hash(i, 1, 60) > 0.5 ? 1 : -1; DECOR.rock(g, x + s * (RW / 2 + 12), y + 6, 0.8); }
    }
    if (inChunk(PB.cx, PB.cy, (PB.x1 - PB.x0) / 2 + 100)) {
      g.fillStyle = 'rgba(60, 50, 30, .45)'; smoothClosed(g, POND.map(([x, y]) => [x + (x - PB.cx) * 0.12, y + (y - PB.cy) * 0.12])); g.fill();
      g.fillStyle = '#3f7d8a'; smoothClosed(g, POND); g.fill();
      g.fillStyle = 'rgba(170, 220, 210, .3)';
      for (let i = 0; i < 8; i++) { g.beginPath(); g.ellipse(PB.x0 + 30 + hash(i, 1, 45) * (PB.x1 - PB.x0 - 60), PB.y0 + 20 + hash(i, 2, 45) * (PB.y1 - PB.y0 - 40), 22, 5, 0, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#4f8a3a';
      for (let i = 0; i < 10; i++) { const x = PB.x0 + hash(i, 3, 45) * (PB.x1 - PB.x0); const y = PB.y0 + hash(i, 4, 45) * (PB.y1 - PB.y0); if (inPoly(x, y, POND)) { g.beginPath(); g.ellipse(x, y, 9, 6, 0, 0.3, Math.PI * 2 - 0.3); g.lineTo(x, y); g.fill(); } }
    }
    // 5) Routes de terre sinueuses, jusqu'à une clairière autour de chaque autel
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const A of ALTARS) {
      if (!inChunk(A.x, A.y, 120)) continue;
      g.fillStyle = 'rgba(80, 60, 35, .3)'; g.beginPath(); g.ellipse(A.x, A.y + 4, 96, 70, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = A.zone === 'lac' ? '#cfe4ee' : A.zone === 'volcan' ? '#6a3b2c' : '#b39064'; g.beginPath(); g.ellipse(A.x, A.y + 4, 88, 63, 0, 0, Math.PI * 2); g.fill();
    }
    const roads = ROADS.filter((r) => r.some(([x, y]) => inChunk(x, y, 180)));
    const RD = MAP.width.road;
    for (const r of roads) { g.strokeStyle = 'rgba(80, 60, 35, .35)'; g.lineWidth = RD + 12 * K; strokePath(g, r); g.stroke(); }
    for (const r of roads) { g.strokeStyle = '#b08a5a'; g.lineWidth = RD; strokePath(g, r); g.stroke(); }
    for (const r of roads) { g.strokeStyle = 'rgba(214, 180, 128, .55)'; g.lineWidth = RD * 0.4; strokePath(g, r); g.stroke(); }
    for (const r of roads) {
      for (let i = 0; i < r.length; i++) {
        const [x, y] = r[i];
        if (!inChunk(x, y, 30)) continue;
        for (let s = 0; s < 2; s++) { const h = hash(Math.round(x), Math.round(y), s); g.fillStyle = h > 0.5 ? 'rgba(120, 90, 55, .5)' : 'rgba(235, 210, 170, .5)'; g.beginPath(); g.arc(x + (h - 0.5) * RD * 0.75, y + (hash(Math.round(y), Math.round(x), s) - 0.5) * RD * 0.65, 1.5 + h * 2, 0, Math.PI * 2); g.fill(); }
      }
    }
    // Place du village pavée
    if (inChunk(SV.map.w / 2, SV.map.h / 2, 200)) {
      g.fillStyle = '#c2a679'; g.beginPath(); g.ellipse(SV.map.w / 2, SV.map.h / 2, 150, 120, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(90, 70, 45, .3)'; g.lineWidth = 1.5;
      for (let r = 40; r <= 140; r += 26) { g.beginPath(); g.ellipse(SV.map.w / 2, SV.map.h / 2, r, r * 0.8, 0, 0, Math.PI * 2); g.stroke(); }
    }
    // Ponts de bois
    for (const b of BRIDGES) {
      if (!inChunk(b.x, b.y, 120)) continue;
      const [L, Wd] = MAP.width.bridge;
      g.save(); g.translate(b.x, b.y); g.rotate(b.a);
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(-L / 2 + 2, -Wd / 2 + 4, L, Wd);
      g.fillStyle = '#8a5a30'; g.fillRect(-L / 2, -Wd / 2, L, Wd);
      g.strokeStyle = '#5e3b1c'; g.lineWidth = 2;
      for (let i = -L / 2 + 6; i <= L / 2 - 4; i += 10) { g.beginPath(); g.moveTo(i, -Wd / 2); g.lineTo(i, Wd / 2); g.stroke(); }
      g.fillStyle = '#6b4322'; g.fillRect(-L / 2 - 3, -Wd / 2 - 5, L + 6, 7); g.fillRect(-L / 2 - 3, Wd / 2 - 2, L + 6, 7);
      for (const sx of [-L / 2, L / 2]) for (const sy of [-Wd / 2 - 3, Wd / 2 + 3]) { g.fillStyle = '#4e3018'; g.beginPath(); g.arc(sx, sy, 5, 0, Math.PI * 2); g.fill(); }
      g.restore();
    }
    // Pontons de planches là où une route longe l'eau (on y marche à la vitesse de la route)
    for (const w of MAP.walks || []) {
      if (!w.some(([x, y]) => inChunk(x, y, 160))) continue;
      const W = RD + 10 * K;
      g.save();
      g.lineCap = 'butt'; g.lineJoin = 'round';
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = W + 6; g.translate(2, 4); strokePath(g, w); g.stroke(); g.translate(-2, -4);
      g.strokeStyle = '#6b4322'; g.lineWidth = W + 8; strokePath(g, w); g.stroke();
      g.strokeStyle = '#8a5a30'; g.lineWidth = W - 6; strokePath(g, w); g.stroke();
      // Planches en travers, puis pilotis le long des bords
      g.strokeStyle = '#5e3b1c'; g.lineWidth = 2;
      for (let i = 0; i < w.length - 1; i++) {
        const [ax, ay] = w[i]; const [bx, by] = w[i + 1];
        const L = Math.hypot(bx - ax, by - ay); if (!L) continue;
        const ux = (bx - ax) / L; const uy = (by - ay) / L; const nx = -uy; const ny = ux;
        for (let d = 0; d < L; d += 10) {
          const x = ax + ux * d; const y = ay + uy * d;
          g.beginPath(); g.moveTo(x + nx * (W / 2 - 3), y + ny * (W / 2 - 3)); g.lineTo(x - nx * (W / 2 - 3), y - ny * (W / 2 - 3)); g.stroke();
        }
        for (let d = 0; d < L; d += 46) {
          const x = ax + ux * d; const y = ay + uy * d;
          for (const sd of [1, -1]) { g.fillStyle = '#4e3018'; g.beginPath(); g.arc(x + nx * sd * (W / 2 + 2), y + ny * sd * (W / 2 + 2), 5, 0, Math.PI * 2); g.fill(); }
        }
      }
      g.restore();
    }
    // 6) Décor (une graine par case de 64 px, y compris celles qui débordent sur ce morceau), triés par profondeur
    const items = [];
    for (let gy = Math.floor(y0 / TILE) - 1; gy <= Math.floor((y0 + CHUNK) / TILE) + 1; gy++) {
      for (let gx = Math.floor(x0 / TILE) - 1; gx <= Math.floor((x0 + CHUNK) / TILE) + 1; gx++) {
        const x = gx * TILE + hash(gx, gy, 2) * TILE;
        const y = gy * TILE + hash(gx, gy, 3) * TILE;
        if (x < 0 || y < 0 || x > SV.map.w || y > SV.map.h) { if (hash(gx, gy, 9) < 0.6) items.push(['pine', x, y, 1.2]); continue; }
        if (Math.hypot(x - SV.map.w / 2, y - SV.map.h / 2) < 190) continue; // place du village dégagée
        if (roadDist(x, y) < 52 * K || riverDist(x, y) < RW / 2 + 28 || inPoly(x, y, LAKE) || inPoly(x, y, POND) || Math.hypot(x - CRATER.x, (y - CRATER.y) * 1.3) < CRATER.r + 20) continue;
        if (ALTARS.some((A) => Math.hypot(x - A.x, y - A.y) < 110)) continue; // autels bien visibles
        const zone = Rules.survivorZone(x, y);
        let r = hash(gx, gy, 5);
        for (const [type, density, dark] of ZONE_DECOR[zone]) {
          if (r < density) { items.push([type, x, y, 0.8 + hash(gx, gy, 4) * 0.5, dark, hash(gx, gy, 6)]); break; }
          r -= density;
        }
      }
    }
    items.sort((a, b) => a[2] - b[2]);
    for (const [type, x, y, s, dark, k] of items) DECOR[type](g, x, y, s, type === 'tree' ? dark : k);
    // Bord de la carte
    g.strokeStyle = 'rgba(0,0,0,.5)';
    g.lineWidth = 6;
    g.strokeRect(0, 0, SV.map.w, SV.map.h);
    return c;
  }
  function chunk(cx, cy) {
    const k = cx * 100 + cy;
    let c = chunks.get(k);
    if (!c) {
      c = buildChunk(cx, cy);
      chunks.set(k, c);
      if (chunks.size > 48) chunks.delete(chunks.keys().next().value);
    } else {
      chunks.delete(k); // le plus récemment vu passe en fin de file
      chunks.set(k, c);
    }
    return c;
  }
  // Prépare un morceau voisin de l'écran par image, pour ne pas saccader en changeant de morceau
  function prefetch(camX, camY) {
    for (let cx = Math.floor(camX / CHUNK) - 1; cx <= Math.floor((camX + W) / CHUNK) + 1; cx++) {
      for (let cy = Math.floor(camY / CHUNK) - 1; cy <= Math.floor((camY + H) / CHUNK) + 1; cy++) {
        if (cx < -1 || cy < -1 || cx * CHUNK > SV.map.w || cy * CHUNK > SV.map.h || chunks.has(cx * 100 + cy)) continue;
        chunks.set(cx * 100 + cy, buildChunk(cx, cy));
        if (chunks.size > 48) chunks.delete(chunks.keys().next().value);
        return;
      }
    }
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
    // Traits magiques (5 valeurs) et projectiles ennemis (6 valeurs) : on garde leur vitesse pour les animer
    const live = new Set();
    const track = (id, x, y, vx, vy, extra) => {
      live.add(id);
      const p = G.proj.get(id);
      if (p) Object.assign(p, { x, y, vx, vy }); else G.proj.set(id, { id, x, y, vx, vy, ...extra });
    };
    for (let i = 0; i < f.bo.length; i += 5) track(f.bo[i], f.bo[i + 1], f.bo[i + 2], f.bo[i + 3], f.bo[i + 4], { bolt: true });
    for (let i = 0; i < f.es.length; i += 6) track(f.es[i], f.es[i + 1], f.es[i + 2], f.es[i + 4], f.es[i + 5], { kind: f.es[i + 3] });
    for (const id of G.proj.keys()) if (!live.has(id)) G.proj.delete(id);
    // Gemmes (5 valeurs) : au repos, à leur place ; attirées, elles volent vers moi côté navigateur
    const gl = new Set();
    for (let i = 0; i < f.g.length; i += 5) {
      const id = f.g[i];
      gl.add(id);
      const x = f.g[i + 1];
      const y = f.g[i + 2];
      const sp = f.g[i + 4];
      const m = G.gems.get(id);
      if (!m) { G.gems.set(id, { id, rx: x, ry: y, size: f.g[i + 3], sp, got: G.gemGot.has(id) }); continue; }
      m.size = f.g[i + 3];
      if (!sp) { m.rx = x; m.ry = y; m.sp = 0; continue; }
      if (!m.sp) m.sp = sp; // dès qu'elle est attirée, le navigateur la fait voler seul (même trajectoire que le serveur)
    }
    for (const id of G.gems.keys()) if (!gl.has(id)) G.gems.delete(id);
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
        G.fx.push({ k: 'zap', x: e.x, y: e.y, r: e.r, t0: now, life: e.chain ? 380 : 260, seed: Math.random(), evo: e.evo, chain: e.chain });
        Sound.play('shoot', 'mage');
        break;
      case 'spin':
        G.fx.push({ k: 'spin', r: e.r, t0: now, life: 300, a0: Math.random() * Math.PI * 2 });
        Sound.play('hit');
        break;
      case 'arc':
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: e.r, t0: now, life: 320, color: '#d6b0ff', fill: 'rgba(199, 155, 255, .25)' });
        break;
      case 'quake':
        G.fx.push({ k: 'quake', x: e.x, y: e.y, r: e.r, t0: now, life: 500 });
        if (now > (G.shakeUntil || 0)) { G.shakeUntil = now + 220; G.shakeAmp = 6; }
        if (now - (G.quakeSnd || 0) > 200) { G.quakeSnd = now; Sound.play('slam'); }
        break;
      case 'legendWake': {
        const D = Rules.SURVIVOR_GUARDIANS[e.zone];
        svToast(`${D.icon} ${D.label} se réveille ! Éloigne-toi de son antre pour le rendormir.`, 3600, 'boss');
        Sound.play('roar', true);
        G.shakeUntil = now + 600; G.shakeAmp = 12;
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: 300, t0: now, life: 900, color: '#c77dff' });
        break;
      }
      case 'curse':
        svToast(`☠️ Sanctuaire maudit activé (×${e.n}) : monstres +${e.n * 10} % de dégâts et de vitesse, émeraudes +${e.n * 10} % !`, 3400, 'curse');
        Sound.play('curse');
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: 220, t0: now, life: 800, color: '#ff3a5a', fill: 'rgba(120, 0, 30, .25)' });
        break;
      case 'ring':
        svToast(`⚠️ Encerclement ! ${e.n} monstres se referment sur toi !`, 2600, 'boss');
        Sound.play('slamWarn');
        break;
      case 'cart':
        svToast('💰 Un chariot doré passe dans le coin ! Rattrape-le avant qu\'il ne s\'enfuie !', 3000, 'treasure');
        Sound.play('coin');
        break;
      case 'cartGone':
        svToast('Le chariot doré s\'est enfui…', 1800);
        break;
      case 'cartDown':
        svToast(`💰 Chariot doré détruit ! Pluie de gemmes et +${e.emeralds} {em}`, 2800, 'treasure');
        Sound.play('jackpot');
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: 200, t0: now, life: 700, color: '#ffd34a' });
        break;
      case 'dusk':
        svToast('🌇 Le soleil se couche… la nuit tombe dans 15 s.', 2600, 'night');
        break;
      case 'night':
        svToast('🌙 La nuit est tombée : on n\'y voit plus très loin…', 2800, 'night');
        Sound.play('roomEnter');
        break;
      case 'dawn':
        svToast('🌅 Le jour se lève ! Tu as survécu à la nuit.', 2600, 'bless');
        Sound.play('chestTier', 'rare');
        break;
      case 'starHit':
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: e.r, t0: now, life: 380, color: '#fff2a0', fill: 'rgba(255, 230, 120, .35)' });
        if (now - (G.starSnd || 0) > 90) { G.starSnd = now; Sound.play('meteor'); }
        break;
      case 'faux':
        Sound.play('tech', 'roulade');
        break;
      case 'legendSleep':
        svToast(`💤 ${Rules.SURVIVOR_GUARDIANS[e.zone].label} retourne dormir dans son antre…`, 2600);
        break;
      case 'legendDown': {
        const D = Rules.SURVIVOR_GUARDIANS[e.zone];
        svToast(`🏆 ${D.label} est vaincu ! +${e.emeralds} {em} et un grand coffre`, 3600, 'treasure');
        Sound.play('bossExplode');
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: 320, t0: now, life: 1000, color: '#ffd34a' });
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: 200, t0: now + 150, life: 900, color: '#c77dff' });
        break;
      }
      case 'evolve':
        G.cine = { id: e.id, t0: now };
        Sound.play('svEvolve');
        break;
      case 'd':
        if (G.texts.length < 60) G.texts.push({ x: e.x + (Math.random() - 0.5) * 14, y: e.y, v: e.v, c: e.c, t0: now });
        break;
      case 'x':
        G.puffs.push({ x: e.x, y: e.y, t0: now });
        break;
      case 'hurt':
        G.hurtAt = now;
        if (now - (G.hurtSnd || 0) > 160) { G.hurtSnd = now; Sound.play('svHurt'); }
        break;
      case 'lvl':
        Sound.play('levelUp');
        break;
      case 'chest':
        Sound.play('chestBurst', 'epique');
        svToast('🎁 Coffre !', 3600, 'chest', e.items.map(optLabel));
        break;
      case 'dodge':
        G.texts.push({ x: G.me.x, y: G.me.y - 20, v: 'Esquive !', t0: now, c: 2 });
        break;
      case 'block':
        G.texts.push({ x: G.me.x, y: G.me.y - 20, v: '🔰 Bloqué', t0: now, c: 1 });
        G.fx.push({ k: 'ring', x: G.me.x, y: G.me.y, r: 60, t0: now, life: 400, color: '#7fd0ff' });
        break;
      case 'heal':
        Sound.play('potion', 'vie');
        svToast('🍗 +30 % de vie !', 1600);
        break;
      case 'magnet':
        Sound.play('petFind');
        svToast('🧲 Toutes les gemmes accourent !', 1600);
        break;
      case 'watch':
        Sound.play('svWatch');
        svToast(`⏱️ Le temps ralentit pour les monstres pendant ${SV.watch.duration} s !`, 2200, 'watch');
        G.fx.push({ k: 'ring', x: G.me.x, y: G.me.y, r: 420, t0: now, life: 900, color: '#8fd8ff' });
        G.watchAt = now;
        break;
      case 'bomb':
        Sound.play('svBomb');
        svToast(`💣 BOUM ! ${e.n} monstre${e.n > 1 ? 's' : ''} pulvérisé${e.n > 1 ? 's' : ''} !`, 2400, 'bomb');
        G.bombAt = now;
        G.shakeUntil = now + 450;
        G.shakeAmp = 14;
        break;
      case 'wave':
        svToast(`🌊 Vague ${e.n}`, 1600);
        Sound.play('roomEnter');
        break;
      case 'boss':
        svToast(`⚠️ ${Rules.SURVIVOR_BOSSES[e.kind].label} arrive ! La vague suivante attendra qu'il soit vaincu.`, 3000, 'boss');
        Sound.play('roar', true);
        break;
      case 'bossRage':
        svToast(`😡 ${Rules.SURVIVOR_BOSSES[e.kind].label} est enragé ! Plus rapide, plus fort, plus d'attaques.`, 3200, 'boss');
        Sound.play('roar', true);
        break;
      case 'bossDown':
        svToast(`🏆 ${Rules.SURVIVOR_BOSSES[e.kind].label} est vaincu !`, 3000);
        Sound.play('bossExplode');
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: 220, t0: now, life: 700, color: '#ffd34a' });
        break;
      case 'boom':
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: e.r, t0: now, life: 420, color: e.act === 'leap' ? '#d9a441' : e.act === 'frost' ? '#9fe0ff' : e.act === 'grab' ? '#c9d4ff' : e.act === 'decoy' ? '#ff9ae0' : '#ff6b3d' });
        Sound.play('slam');
        break;
      case 'ghost':
        svToast(`👻 ${e.legend ? Rules.SURVIVOR_GUARDIANS.marais.label : 'Ether'} devient intangible ! Esquive les mains spectrales…`, 2200, 'boss');
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: 120, t0: now, life: 500, color: '#c9d4ff' });
        Sound.play('blink');
        break;
      case 'wail':
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: 200, t0: now, life: 600, color: '#c9d4ff' });
        Sound.play('roar', true);
        break;
      case 'illusions':
        svToast(`😼 Lilith se multiplie ! Brise ses ${e.n} illusions avant qu'elles n'explosent.`, 2600, 'boss');
        Sound.play('blink');
        break;
      case 'vanish':
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: 80, t0: now, life: 400, color: '#ff9ae0' });
        Sound.play('blink');
        break;
      case 'pillars':
        svToast('🔥 Colonnes de feu ! Elles ne se traversent pas.', 2000, 'boss');
        Sound.play('slam');
        break;
      case 'demons':
        svToast(`😈 Daedra invoque ${e.n} démons de feu !`, 2000, 'boss');
        break;
      case 'blink':
        G.fx.push({ k: 'ring', x: e.x, y: e.y, r: 70, t0: now, life: 350, color: '#b98cff' });
        Sound.play('blink');
        break;
      case 'bless':
        svToast(`✨ Bénédiction ${ZONES[e.zone].bonus} : ses bonus ×${String(X.altar.mult).replace('.', ',')}, partout et sans contrepartie, pendant ${X.altar.duration} s !`, 3600, 'bless');
        G.fx.push({ k: 'ring', x: G.me.x, y: G.me.y, r: 160, t0: now, life: 700, color: '#fff2a8' });
        Sound.play('chestTier', 'epique');
        break;
      case 'blessEnd':
        svToast('La bénédiction s\'estompe…', 1600);
        break;
      case 'shardSpawn':
        svToast('{em} Un éclat d\'émeraude est apparu sur la carte !', 1800);
        break;
      case 'shard':
        G.texts.push({ x: e.x, y: e.y - 10, v: '+1', gem: true, c: 2, t0: now });
        Sound.play('petFind');
        break;
      case 'treasure':
        svToast(`💰 Un trésor gardé est apparu : ${ZONES[e.zone].label} !`, 3600, 'treasure');
        Sound.play('queueOpen');
        break;
      case 'treasureOpen':
        svToast(`💰 Trésor ouvert ! +${e.emeralds} {em} et des améliorations`, 3000, 'treasure');
        Sound.play('chestBurst', 'legendaire');
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
    const stopped = !f || f.pend || f.paused || G.paused || f.over || f.cine;
    const d = inputDir();
    G.me.moving = !stopped && (d.x || d.y);
    if (G.me.moving) {
      // L'eau ralentit, les routes accélèrent (le serveur fait de même)
      const spd = ((f && f.spd) || SV.player.speed) * Rules.survivorGround(G.me.x, G.me.y);
      const nx = Math.max(20, Math.min(SV.map.w - 20, G.me.x + d.x * spd * dt));
      const ny = Math.max(20, Math.min(SV.map.h - 20, G.me.y + d.y * spd * dt));
      // Colonnes de feu de Daedra : on ne les traverse pas (le serveur refuse aussi le pas)
      const walls = f && f.ar ? f.ar.filter((a) => a.k === 'firewall') : null;
      if (!walls || !walls.length || !Rules.survivorWallBlock(G.me.x, G.me.y, nx, ny, walls)) { G.me.x = nx; G.me.y = ny; }
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
    // Tremblement de l'écran (bombe, réveil d'un gardien…)
    const shake = now < (G.shakeUntil || 0) ? G.shakeAmp * ((G.shakeUntil - now) / 450) : 0;
    const camX = Math.max(W / 2, Math.min(SV.map.w - W / 2, G.me.x)) - W / 2 + (shake ? (Math.random() - 0.5) * shake : 0);
    const camY = Math.max(H / 2, Math.min(SV.map.h - H / 2, G.me.y)) - H / 2 + (shake ? (Math.random() - 0.5) * shake : 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Sol
    const cx0 = Math.floor(camX / CHUNK);
    const cy0 = Math.floor(camY / CHUNK);
    for (let cx = cx0; cx <= Math.floor((camX + W) / CHUNK); cx++) {
      for (let cy = cy0; cy <= Math.floor((camY + H) / CHUNK); cy++) ctx.drawImage(chunk(cx, cy), Math.round(cx * CHUNK - camX), Math.round(cy * CHUNK - camY));
    }
    prefetch(camX, camY);
    ctx.translate(-Math.round(camX), -Math.round(camY));
    if (!f) return;
    const t = now / 1000;
    // Zones au sol : flaques d'acide, toiles, attaques annoncées
    for (const a of f.ar) {
      if (a.k === 'acid') {
        const g = ctx.createRadialGradient(a.x, a.y, 4, a.x, a.y, a.r);
        g.addColorStop(0, a.s ? 'rgba(80, 255, 200, .55)' : 'rgba(140, 255, 80, .55)');
        g.addColorStop(1, a.s ? 'rgba(30, 180, 160, .18)' : 'rgba(60, 200, 40, .15)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(a.x, a.y, a.r, a.r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(200, 255, 160, .7)';
        for (let i = 0; i < 4; i++) { const b = (t * 2 + i * 0.7) % 1; ctx.beginPath(); ctx.arc(a.x + Math.cos(i * 2.3) * a.r * 0.5, a.y + Math.sin(i * 1.7) * a.r * 0.4 - b * 6, 3 * (1 - b), 0, Math.PI * 2); ctx.fill(); }
      } else if (a.k === 'bog') {
        // Vase du Roi des marais : flaque sombre qui bouillonne (elle fait mal)
        const g = ctx.createRadialGradient(a.x, a.y, 4, a.x, a.y, a.r);
        g.addColorStop(0, 'rgba(70, 90, 30, .7)'); g.addColorStop(1, 'rgba(50, 70, 20, .25)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(a.x, a.y, a.r, a.r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(180, 230, 90, .7)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = 'rgba(190, 240, 110, .75)';
        for (let i = 0; i < 6; i++) { const b = (t * 1.5 + i * 0.37) % 1; ctx.beginPath(); ctx.arc(a.x + Math.cos(i * 2.1) * a.r * 0.55, a.y + Math.sin(i * 1.3) * a.r * 0.45, 5 * b, 0, Math.PI * 2); ctx.stroke(); }
      } else if (a.k === 'web') {
        ctx.strokeStyle = 'rgba(240, 240, 255, .55)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 8; i++) { const ang = (i / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + Math.cos(ang) * a.r, a.y + Math.sin(ang) * a.r * 0.8); ctx.stroke(); }
        for (let r = a.r / 3; r <= a.r; r += a.r / 3) { ctx.beginPath(); ctx.ellipse(a.x, a.y, r, r * 0.8, 0, 0, Math.PI * 2); ctx.stroke(); }
      } else if (a.k === 'firewall') {
        // Colonne de feu de Daedra : un mur de flammes qu'on ne traverse pas
        const len = Math.hypot(a.x2 - a.x, a.y2 - a.y) || 1;
        const ang = Math.atan2(a.y2 - a.y, a.x2 - a.x);
        const fade = Math.min(1, a.left / 0.6);
        ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(ang); ctx.globalAlpha = fade;
        const g = ctx.createLinearGradient(0, -a.r, 0, a.r);
        g.addColorStop(0, 'rgba(255, 60, 20, 0)'); g.addColorStop(0.35, 'rgba(255, 90, 30, .75)'); g.addColorStop(0.5, 'rgba(255, 220, 120, .95)'); g.addColorStop(0.65, 'rgba(255, 90, 30, .75)'); g.addColorStop(1, 'rgba(255, 60, 20, 0)');
        ctx.fillStyle = g; ctx.fillRect(0, -a.r, len, a.r * 2);
        // flammes qui dansent le long du mur
        for (let d = 10; d < len; d += 22) {
          const h = 26 + Math.sin(t * 9 + d * 0.31) * 10;
          const fl = ctx.createLinearGradient(0, 0, 0, -h);
          fl.addColorStop(0, 'rgba(255, 120, 30, .9)'); fl.addColorStop(1, 'rgba(255, 230, 120, 0)');
          ctx.fillStyle = fl;
          ctx.beginPath(); ctx.moveTo(d - 9, 0); ctx.quadraticCurveTo(d + Math.sin(t * 7 + d) * 5, -h, d + 9, 0); ctx.fill();
        }
        ctx.restore();
      } else if (a.k === 'warn' && a.act === 'grab') {
        // Main spectrale qui va jaillir du sol
        const k = Math.max(0, Math.min(1, 1 - (a.left - (now - G.frameAt) / 1000) / 0.9));
        ctx.fillStyle = 'rgba(160, 180, 255, .16)';
        ctx.beginPath(); ctx.ellipse(a.x, a.y, a.r, a.r * 0.75, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(200, 215, 255, .9)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.ellipse(a.x, a.y, a.r, a.r * 0.75, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.save(); ctx.globalAlpha = 0.35 + k * 0.6; ctx.fillStyle = '#dfe6ff';
        const hy = a.y + 10 - k * 34;
        ctx.beginPath(); ctx.ellipse(a.x, hy, 13, 17, 0, 0, Math.PI * 2); ctx.fill();
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(a.x - 9 + i * 6, hy - 18 - (i === 1 || i === 2 ? 4 : 0), 3, 9, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
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
    // Aura de feu (Sanctuaire ardent : lumière sacrée dorée et cercle de runes qui tourne)
    if (f.aura) {
      const pulse = 1 + Math.sin(t * 6) * 0.04;
      const R = f.aura * pulse;
      const g = ctx.createRadialGradient(G.me.x, G.me.y, 6, G.me.x, G.me.y, R);
      if (f.auraEvo) {
        g.addColorStop(0, 'rgba(255, 255, 230, .08)'); g.addColorStop(0.7, 'rgba(255, 230, 120, .2)'); g.addColorStop(1, 'rgba(255, 200, 60, .42)');
      } else {
        g.addColorStop(0, 'rgba(255, 160, 60, .05)'); g.addColorStop(0.7, 'rgba(255, 110, 30, .22)'); g.addColorStop(1, 'rgba(255, 70, 20, .45)');
      }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(G.me.x, G.me.y, R, 0, Math.PI * 2); ctx.fill();
      if (f.auraEvo) {
        ctx.save(); ctx.translate(G.me.x, G.me.y); ctx.rotate(t * 0.6);
        ctx.strokeStyle = 'rgba(255, 240, 170, .8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, R * 0.92, 0, Math.PI * 2); ctx.stroke();
        ctx.font = '700 15px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(255, 245, 190, .9)';
        const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃ';
        for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ctx.save(); ctx.rotate(a); ctx.fillText(runes[i], 0, -R * 0.92); ctx.restore(); }
        ctx.restore(); ctx.textBaseline = 'alphabetic';
      }
    }
    // Autels des lieux-dits
    ALTARS.forEach((A, i) => {
      if (Math.abs(A.x - G.me.x) > W / 2 + 80 || Math.abs(A.y - G.me.y) > H / 2 + 120) return;
      const [cd, charge] = (f.alt && f.alt[i]) || [0, 0];
      const ready = cd <= 0;
      const Z = ZONES[A.zone];
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(A.x, A.y + 6, 62, 22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ready ? '#d8d2c2' : '#8a8680'; ctx.beginPath(); ctx.ellipse(A.x, A.y, 56, 20, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = ready ? `rgba(255, 226, 122, ${0.6 + Math.sin(t * 3) * 0.3})` : 'rgba(80,80,80,.6)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(A.x, A.y, 48, 16, 0, 0, Math.PI * 2); ctx.stroke();
      if (charge > 0) { ctx.strokeStyle = '#7cff4f'; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(A.x, A.y, 52, 18, 0, -Math.PI / 2, -Math.PI / 2 + (charge / 100) * Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = ready ? '#bdb5a3' : '#6a6660'; ctx.fillRect(A.x - 12, A.y - 46, 24, 46);
      ctx.fillStyle = ready ? '#d6cfbf' : '#7a7670'; ctx.fillRect(A.x - 16, A.y - 52, 32, 8);
      if (ready) { const g = ctx.createRadialGradient(A.x, A.y - 70, 2, A.x, A.y - 70, 40); g.addColorStop(0, 'rgba(255, 240, 160, .7)'); g.addColorStop(1, 'rgba(255, 240, 160, 0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(A.x, A.y - 70, 40, 0, Math.PI * 2); ctx.fill(); }
      ctx.font = '26px system-ui'; ctx.textAlign = 'center'; ctx.globalAlpha = ready ? 1 : 0.45;
      ctx.fillText(Z.icon, A.x, A.y - 62 + (ready ? Math.sin(t * 2) * 3 : 0));
      ctx.globalAlpha = 1;
      ctx.font = '800 11px system-ui'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)';
      const label = ready ? `Autel : ${Z.bonus}` : `Autel : ${cd} s`;
      ctx.strokeText(label, A.x, A.y + 34); ctx.fillStyle = ready ? '#fff2a8' : '#ccc'; ctx.fillText(label, A.x, A.y + 34);
    });
    // Sanctuaires maudits : obélisque sombre aux runes rouges (activé : fissuré, flammes rouges)
    for (const [x, y, charge, done] of f.cu || []) {
      if (Math.abs(x - G.me.x) > W / 2 + 120 || Math.abs(y - G.me.y) > H / 2 + 160) continue;
      const CU = Rules.SURVIVOR_CURSE;
      ctx.fillStyle = 'rgba(60, 0, 20, .35)'; ctx.beginPath(); ctx.ellipse(x, y + 8, 80, 32, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = done ? 'rgba(255, 60, 80, .8)' : `rgba(255, 60, 80, ${0.35 + Math.sin(t * 2.5) * 0.25})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y + 8, CU.radius, CU.radius * 0.4, 0, 0, Math.PI * 2); ctx.stroke();
      if (charge > 0) { ctx.strokeStyle = '#ff3a5a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.ellipse(x, y + 8, CU.radius + 6, (CU.radius + 6) * 0.4, 0, -Math.PI / 2, -Math.PI / 2 + (charge / 100) * Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = done ? '#3a1820' : '#2a2030';
      ctx.beginPath(); ctx.moveTo(x - 16, y + 6); ctx.lineTo(x - 10, y - 64); ctx.lineTo(x, y - 78); ctx.lineTo(x + 10, y - 64); ctx.lineTo(x + 16, y + 6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = done ? '#ff3a5a' : `rgba(255, 70, 90, ${0.5 + Math.sin(t * 3) * 0.4})`;
      ctx.font = '900 14px serif'; ctx.textAlign = 'center';
      ctx.fillText('ᛟ', x, y - 46); ctx.fillText('ᚦ', x, y - 26);
      if (done) {
        // Flammes maudites au sommet
        for (let i = 0; i < 3; i++) { const fl = (t * 2 + i * 0.33) % 1; ctx.fillStyle = `rgba(255, ${60 + i * 40}, 80, ${1 - fl})`; ctx.beginPath(); ctx.arc(x + Math.sin(t * 5 + i) * 4, y - 82 - fl * 22, 7 * (1 - fl) + 2, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.font = '800 11px system-ui'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)';
      const lbl = done ? 'Sanctuaire maudit (activé)' : `☠️ Sanctuaire maudit · reste ${CU.charge} s dessus`;
      ctx.strokeText(lbl, x, y + 36); ctx.fillStyle = done ? '#ff8a9a' : '#ffb0b8'; ctx.fillText(lbl, x, y + 36);
      if (!done) { const l2 = `monstres +${CU.enemy * 100} % · émeraudes +${CU.emeralds * 100} %`; ctx.strokeText(l2, x, y + 50); ctx.fillStyle = '#ddd'; ctx.fillText(l2, x, y + 50); }
    }
    // Étoiles filantes : l'étoile tombe du ciel vers son point d'impact
    for (const a of f.ar) {
      if (a.k !== 'star') continue;
      const left = Math.max(0, a.left - (now - G.frameAt) / 1000);
      const k = 1 - left / 0.6;
      ctx.strokeStyle = 'rgba(255, 230, 120, .5)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.ellipse(a.x, a.y, a.r, a.r * 0.6, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      const sx = a.x + 260 * (1 - k);
      const sy = a.y - 520 * (1 - k);
      const tl = ctx.createLinearGradient(sx, sy, sx + 70, sy - 140);
      tl.addColorStop(0, 'rgba(255, 250, 200, .95)'); tl.addColorStop(1, 'rgba(255, 200, 80, 0)');
      ctx.strokeStyle = tl; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 70, sy - 140); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.shadowColor = '#ffe680'; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
    // Trésor gardé : un coffre doré sous un rayon de lumière
    if (f.tr) {
      const x = f.tr.x;
      const y = f.tr.y;
      const beam = ctx.createLinearGradient(x, y - 260, x, y);
      beam.addColorStop(0, 'rgba(255, 220, 90, 0)'); beam.addColorStop(1, 'rgba(255, 220, 90, .35)');
      ctx.fillStyle = beam; ctx.fillRect(x - 22, y - 260, 44, 260);
      ctx.font = '40px system-ui'; ctx.textAlign = 'center';
      ctx.shadowColor = '#ffd34a'; ctx.shadowBlur = 24;
      ctx.fillText('🧰', x, y + 10 + Math.sin(t * 3) * 3);
      ctx.shadowBlur = 0;
    }
    // Éclats d'émeraude
    for (let i = 0; i < (f.sh || []).length; i += 2) {
      const x = f.sh[i];
      const y = f.sh[i + 1] + Math.sin(t * 3 + i) * 4;
      const g = ctx.createRadialGradient(x, y, 2, x, y, 30);
      g.addColorStop(0, 'rgba(93, 255, 154, .6)'); g.addColorStop(1, 'rgba(93, 255, 154, 0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 30, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#20c26a'; ctx.strokeStyle = '#0a5a2e'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 8, y - 10); ctx.lineTo(x + 8, y - 10); ctx.lineTo(x + 14, y - 2); ctx.lineTo(x, y + 14); ctx.lineTo(x - 14, y - 2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(200, 255, 220, .8)'; ctx.beginPath(); ctx.moveTo(x - 8, y - 10); ctx.lineTo(x, y - 2); ctx.lineTo(x - 14, y - 2); ctx.closePath(); ctx.fill();
    }
    // Gemmes : celles qui sont attirées volent vers moi à chaque image (même accélération que sur le serveur)
    const dtG = Math.min(0.05, (now - (G.gemDrawAt || now)) / 1000);
    G.gemDrawAt = now;
    for (const m of G.gems.values()) {
      if (m.got) continue;
      if (m.sp > 0) {
        const dx = G.me.x - m.rx;
        const dy = G.me.y - m.ry;
        const d = Math.hypot(dx, dy) || 1;
        m.sp += 900 * dtG;
        const step = Math.min(d, m.sp * dtG);
        m.rx += (dx / d) * step;
        m.ry += (dy / d) * step;
        if (d < SV.player.radius + 8) {
          m.got = true; // ramassée : on ne la dessine plus en attendant le serveur
          G.gemGot.add(m.id); // ni ne la rejoue si elle revient dans une image
          if (G.gemGot.size > 600) G.gemGot.delete(G.gemGot.values().next().value);
          // Son : les gemmes d'une même série montent d'un demi-ton (série remise à zéro après 0,7 s de pause)
          G.gemStep = now - (G.gemAt || 0) < 700 ? (G.gemStep || 0) + 1 : 0;
          G.gemAt = now;
          if (now - (G.gemSnd || 0) > 45 || m.size > 0) { G.gemSnd = now; Sound.play('svGem', G.gemStep, m.size > 1); }
        }
      }
      if (m.got) continue;
      const x = m.rx;
      const y = m.ry;
      const gem = SV.gems[m.size];
      const s = 6.5 + m.size * 2.5;
      ctx.fillStyle = gem.color;
      ctx.strokeStyle = 'rgba(10, 10, 30, .75)';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x, y - s * 1.4); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s * 1.2); ctx.lineTo(x - s, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.65)';
      ctx.beginPath(); ctx.moveTo(x, y - s * 1.4); ctx.lineTo(x + s * 0.4, y - s * 0.2); ctx.lineTo(x - s * 0.3, y); ctx.closePath(); ctx.fill();
    }
    // Bonus au sol (poulet, aimant, coffre, montre, bombe) : pastille contourée qui pulse, halo coloré et petite flèche qui rebondit
    const PK = ['🍗', '🧲', '🎁', '⏱️', '💣'];
    const PKC = ['#ff9f43', '#5dc8ff', '#ffd34a', '#8fd8ff', '#ff4d4d'];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < f.pk.length; i += 3) {
      const x = f.pk[i];
      const kind = f.pk[i + 2];
      const bob = Math.sin(t * 4 + i) * 3;
      const y = f.pk[i + 1] + bob;
      const pulse = 1 + Math.sin(t * 5 + i) * 0.08;
      const c = PKC[kind];
      const glow = ctx.createRadialGradient(x, y, 6, x, y, 40 * pulse);
      glow.addColorStop(0, c + 'aa'); glow.addColorStop(1, c + '00');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, 40 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(15, 10, 30, .78)'; ctx.strokeStyle = c; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 21 * pulse, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 25 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '24px system-ui';
      ctx.fillText(PK[kind], x, y + 1);
      // Flèche au-dessus
      const ay = y - 36 - Math.abs(Math.sin(t * 4 + i)) * 5;
      ctx.fillStyle = c; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 7, ay - 6); ctx.lineTo(x + 7, ay - 6); ctx.lineTo(x, ay + 3); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.textBaseline = 'alphabetic';
    // Chariot doré : caisse dorée sur roues, pièces qui s'envolent, barre de vie
    if (f.ct) {
      const c = f.ct;
      const dir = c.fx < 0 ? -1 : 1;
      ctx.save(); ctx.translate(c.x, c.y);
      const gl = ctx.createRadialGradient(0, -20, 6, 0, -20, 90);
      gl.addColorStop(0, 'rgba(255, 220, 90, .45)'); gl.addColorStop(1, 'rgba(255, 220, 90, 0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, -20, 90, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(0, 8, 40, 10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.scale(dir, 1);
      ctx.fillStyle = '#7a4a1e'; ctx.fillRect(-34, -30, 68, 26);
      ctx.fillStyle = '#ffcf3a'; ctx.fillRect(-30, -40, 60, 14);
      ctx.strokeStyle = '#a06a10'; ctx.lineWidth = 2; ctx.strokeRect(-34, -30, 68, 26);
      for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#ffe680' : '#ffd34a'; ctx.beginPath(); ctx.arc(-22 + i * 11, -42 - (i % 2) * 4, 6, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.strokeStyle = '#4a2a10'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(34, -18); ctx.lineTo(52, -26); ctx.stroke();
      for (const wx of [-22, 22]) {
        ctx.fillStyle = '#3a2410'; ctx.beginPath(); ctx.arc(wx, -2, 10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#c8a060'; ctx.lineWidth = 2;
        for (let s = 0; s < 4; s++) { const a = now / 90 + (s * Math.PI) / 4; ctx.beginPath(); ctx.moveTo(wx, -2); ctx.lineTo(wx + Math.cos(a) * 9, -2 + Math.sin(a) * 9); ctx.stroke(); }
      }
      ctx.restore();
      for (let i = 0; i < 3; i++) { const p = ((now / 600) + i / 3) % 1; ctx.globalAlpha = 1 - p; ctx.fillStyle = '#ffe680'; ctx.beginPath(); ctx.arc(c.x + Math.sin(i * 2 + now / 300) * 20, c.y - 50 - p * 40, 4, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(c.x - 32, c.y - 70, 64, 6);
      ctx.fillStyle = '#ffd34a'; ctx.fillRect(c.x - 31, c.y - 69, 62 * (c.hp / 100), 4);
    }
    // Antres des gardiens légendaires : le gardien endormi et son sceau
    const anyAwake = (f.lg || []).some((l) => l.st === 1);
    for (const l of f.lg || []) {
      if (Math.abs(l.x - G.me.x) > W / 2 + 200 || Math.abs(l.y - G.me.y) > H / 2 + 260) continue;
      drawLair(l, now, t, anyAwake);
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
      const BD = { troll: [1, 30], dragon: [0.9, 26], sorcier: [0.95, 20], mimic: [0.95, 18], liche: [0.95, 20], maexxna: [0.9, 6], ether: [0.9, 24], lilith: [0.9, 14], daedra: [0.9, 18] }[b.kind];
      if (!meDrawn && b.y > G.me.y) drawMe();
      // Illusions de Lilith : dessinées exactement comme elle (indiscernables)
      for (const [x, y] of b.decoys || []) {
        ctx.fillStyle = 'rgba(0,0,0,.3)';
        ctx.beginPath(); ctx.ellipse(x, y + 6, 46, 14, 0, 0, Math.PI * 2); ctx.fill();
        drawMonster(ctx, x, y - BD[1], { kind: b.kind, enraged: b.rage }, { scale: BD[0], t: now, facing: x > G.me.x ? -1 : 1, enraged: b.rage });
      }
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(b.x, b.y + 6, 46, 14, 0, 0, Math.PI * 2); ctx.fill();
      if (b.rage) {
        // Enragé : halo rouge qui pulse
        const rg = ctx.createRadialGradient(b.x, b.y - 30, 10, b.x, b.y - 30, 110);
        rg.addColorStop(0, `rgba(255, 40, 20, ${0.35 + Math.sin(now / 150) * 0.15})`); rg.addColorStop(1, 'rgba(255, 40, 20, 0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(b.x, b.y - 30, 110, 0, Math.PI * 2); ctx.fill();
      }
      drawMonster(ctx, b.x, b.y - BD[1], { kind: b.kind, enraged: b.rage }, { scale: BD[0], t: now, facing: b.x > G.me.x ? -1 : 1, enraged: b.rage, intangible: !!b.ghost, vanish: !!b.hidden });
    }
    if (f.lb) {
      if (!meDrawn && f.lb.y > G.me.y) drawMe();
      drawGuardian(f.lb.z, f.lb.x, f.lb.y, now, { facing: f.lb.x > G.me.x ? -1 : 1, awake: true, ghost: !!f.lb.ghost, hidden: !!f.lb.hidden });
    }
    if (!meDrawn) drawMe();
    // Orbes gardiens
    if (f.orb) {
      const o = f.orb;
      for (const [n, r, spd] of o.rings) {
        if (o.evo) { ctx.strokeStyle = 'rgba(168, 240, 255, .18)'; ctx.lineWidth = o.size * 0.8; ctx.beginPath(); ctx.arc(G.me.x, G.me.y, r, 0, Math.PI * 2); ctx.stroke(); }
        for (let i = 0; i < n; i++) {
          const a = (G.srvT - o.t0) * spd + (i / n) * Math.PI * 2;
          const x = G.me.x + Math.cos(a) * r;
          const y = G.me.y + Math.sin(a) * r;
          const g = ctx.createRadialGradient(x, y, 1, x, y, o.size * (o.evo ? 1.25 : 1));
          g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, o.evo ? '#a8f0ff' : '#5fd3ff'); g.addColorStop(1, 'rgba(95, 211, 255, 0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(x, y, o.size * (o.evo ? 1.25 : 1), 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    // Faux lunaire : des faux spectrales font un tour éclair autour du joueur
    if (f.faux) {
      const o = f.faux;
      for (let i = 0; i < o.n; i++) {
        const a = (G.srvT - o.t0) * o.spd + (i / o.n) * Math.PI * 2;
        const x = G.me.x + Math.cos(a) * o.r;
        const y = G.me.y + Math.sin(a) * o.r;
        ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
        ctx.strokeStyle = 'rgba(216, 208, 255, .35)'; ctx.lineWidth = o.size * 0.9; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(-o.r, 0, o.r, -0.35, 0); ctx.stroke();
        ctx.shadowColor = '#b8a8ff'; ctx.shadowBlur = 16;
        ctx.fillStyle = '#eeeaff';
        ctx.beginPath(); ctx.moveTo(0, -o.size); ctx.quadraticCurveTo(o.size * 1.2, -o.size * 0.2, o.size * 0.2, o.size); ctx.quadraticCurveTo(o.size * 0.5, 0, 0, -o.size); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#6a5a8a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -o.size * 0.8); ctx.lineTo(-o.size * 0.6, o.size * 1.2); ctx.stroke();
        ctx.restore();
      }
    }
    // Projectiles lancés (dagues, haches) : simulés à partir de leur lancer
    for (const [id, s] of G.shots) {
      const age = (now - s.t0) / 1000;
      if (age > s.life) { G.shots.delete(id); continue; }
      // Tempête de lames : aller puis retour sur la même ligne
      const run = s.ret ? s.life / 2 - Math.abs(age - s.life / 2) : age;
      const x = s.x + s.vx * run;
      const y = s.y + s.vy * run + 0.5 * s.g * age * age;
      ctx.save();
      ctx.translate(x, y);
      if (s.w === 'hache') {
        if (s.evo) {
          // Hache du Titan : énorme, avec une traînée de braises
          const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 46);
          glow.addColorStop(0, 'rgba(255, 160, 60, .55)'); glow.addColorStop(1, 'rgba(255, 90, 20, 0)');
          ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.fill();
        }
        ctx.rotate(age * (s.evo ? 10 : 14));
        ctx.font = `${s.evo ? 56 : 30}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🪓', 0, 0);
      } else if (s.w === 'boomerang') {
        ctx.rotate(age * 16);
        ctx.font = '34px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🪃', 0, 0);
      } else if (s.ret) {
        // Dague de la tempête : bleu glacé, traînée lumineuse
        const dir = age < s.life / 2 ? 1 : -1;
        ctx.rotate(Math.atan2(s.vy * dir, s.vx * dir));
        ctx.strokeStyle = 'rgba(160, 235, 255, .55)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-40, 0); ctx.stroke();
        ctx.shadowColor = '#9fe8ff'; ctx.shadowBlur = 10;
        ctx.fillStyle = '#e8fbff';
        ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-5, -5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#3a6a9a'; ctx.fillRect(-12, -3, 8, 6);
      } else {
        ctx.rotate(Math.atan2(s.vy, s.vx));
        ctx.fillStyle = '#e8eef8';
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-4, -3.5); ctx.lineTo(-4, 3.5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#7a4a24'; ctx.fillRect(-10, -2.5, 7, 5);
        ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-28, 0); ctx.stroke();
      }
      ctx.restore();
    }
    // Traits magiques et projectiles ennemis : avancés à chaque image selon leur vitesse, recalés en douceur sur le serveur
    const dtF = Math.min(0.2, (now - G.frameAt) / 1000);
    const wandEvo = f.weapons.some(([id, , e]) => id === 'baguette' && e);
    for (const p of G.proj.values()) {
      const tx = p.x + p.vx * dtF;
      const ty = p.y + p.vy * dtF;
      if (p.rx == null) { p.rx = tx; p.ry = ty; } else { const k = Math.min(1, (now - (p.lastDraw || now)) / 60); p.rx += (tx - p.rx) * Math.max(0.5, k); p.ry += (ty - p.ry) * Math.max(0.5, k); }
      p.lastDraw = now;
      const x = p.rx;
      const y = p.ry;
      const ang = Math.atan2(p.vy, p.vx);
      if (p.bolt) {
        // Trait magique violet avec traînée (Sceptre des arcanes : plus gros, cœur rose et étincelles)
        const big = wandEvo ? 1.6 : 1;
        const tail = ctx.createLinearGradient(x, y, x - Math.cos(ang) * 34 * big, y - Math.sin(ang) * 34 * big);
        tail.addColorStop(0, wandEvo ? 'rgba(255, 170, 255, .9)' : 'rgba(199, 155, 255, .8)'); tail.addColorStop(1, 'rgba(150, 80, 255, 0)');
        ctx.strokeStyle = tail; ctx.lineWidth = 8 * big; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(ang) * 34 * big, y - Math.sin(ang) * 34 * big); ctx.stroke();
        const g = ctx.createRadialGradient(x, y, 1, x, y, 12 * big);
        g.addColorStop(0, '#fff'); g.addColorStop(0.4, wandEvo ? '#ff9cf0' : '#c79bff'); g.addColorStop(1, 'rgba(150, 80, 255, 0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, 12 * big, 0, Math.PI * 2); ctx.fill();
        if (wandEvo) for (let i = 0; i < 3; i++) { const a = now / 90 + i * 2.1; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 14, y + Math.sin(a) * 14, 2, 0, Math.PI * 2); ctx.fill(); }
        continue;
      }
      // Projectile ennemi : rouge vif (ou couleur de l'attaque du boss), contour sombre et halo pour bien le voir
      const [c, r] = ESHOT[p.kind] || ESHOT[0];
      if (f.slow) {
        // Temps ralenti : une longue traînée bleutée derrière le projectile
        const sp = Math.hypot(p.vx, p.vy) || 1;
        const tl = ctx.createLinearGradient(x, y, x - (p.vx / sp) * 60, y - (p.vy / sp) * 60);
        tl.addColorStop(0, 'rgba(160, 220, 255, .55)'); tl.addColorStop(1, 'rgba(160, 220, 255, 0)');
        ctx.strokeStyle = tl; ctx.lineWidth = r * 1.6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - (p.vx / sp) * 60, y - (p.vy / sp) * 60); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255, 40, 40, .22)';
      ctx.beginPath(); ctx.arc(x, y, r + 7, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = c; ctx.shadowBlur = 14;
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 3; ctx.strokeStyle = '#2a0505';
      ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255, 235, 235, .9)';
      ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, Math.PI * 2); ctx.fill();
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
      } else if (e.k === 'spin') {
        // Lame du Héros : un cercle de lumière dorée qui balaie tout autour
        ctx.save();
        ctx.translate(G.me.x, G.me.y - 6);
        const sweep = Math.min(1, p * 1.6) * Math.PI * 2;
        ctx.globalAlpha = 1 - p * p;
        for (let k = 0; k < 3; k++) {
          ctx.strokeStyle = k === 0 ? 'rgba(255, 245, 200, .95)' : k === 1 ? 'rgba(255, 211, 74, .7)' : 'rgba(255, 150, 40, .4)';
          ctx.lineWidth = (22 - k * 6) * (1 - p * 0.5);
          ctx.beginPath(); ctx.arc(0, 0, e.r * (0.7 + k * 0.12), e.a0, e.a0 + sweep); ctx.stroke();
        }
        ctx.restore();
      } else if (e.k === 'quake') {
        ctx.save();
        ctx.globalAlpha = 1 - p;
        ctx.fillStyle = 'rgba(120, 70, 30, .35)'; ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r * (0.5 + p * 0.5), e.r * 0.6 * (0.5 + p * 0.5), 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffb060'; ctx.lineWidth = 5 * (1 - p) + 1;
        ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r * (0.5 + p * 0.6), e.r * 0.6 * (0.5 + p * 0.6), 0, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(60, 30, 10, .6)'; ctx.lineWidth = 2;
        for (let i = 0; i < 6; i++) { const a = i * 1.05 + e.x; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(a) * e.r * 0.7, e.y + Math.sin(a) * e.r * 0.45); ctx.stroke(); }
        ctx.restore();
      } else if (e.k === 'zap') {
        ctx.save();
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = e.evo ? '#ffffff' : '#fff6a0'; ctx.lineWidth = e.evo ? 6 : 4; ctx.shadowColor = '#ffe63c'; ctx.shadowBlur = e.evo ? 26 : 16;
        ctx.beginPath(); ctx.moveTo(e.x + 30, e.y - 420);
        for (let i = 1; i <= 7; i++) ctx.lineTo(e.x + (hash(i, Math.floor(e.seed * 1000)) - 0.5) * 40, e.y - 420 + i * 60);
        ctx.stroke();
        // Couronne d'orage : l'éclair rebondit d'ennemi en ennemi
        if (e.chain) {
          let px = e.x;
          let py = e.y;
          ctx.lineWidth = 3;
          for (const [cx, cy] of e.chain) {
            ctx.beginPath(); ctx.moveTo(px, py);
            for (let i = 1; i < 4; i++) ctx.lineTo(px + (cx - px) * (i / 4) + (hash(i, cx) - 0.5) * 26, py + (cy - py) * (i / 4) + (hash(i, cy) - 0.5) * 26);
            ctx.lineTo(cx, cy); ctx.stroke();
            ctx.fillStyle = 'rgba(255, 245, 160, .5)'; ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2); ctx.fill();
            px = cx; py = cy;
          }
        }
        ctx.fillStyle = 'rgba(255, 240, 150, .35)';
        ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r, e.r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (e.k === 'ring') {
        if (e.fill) { ctx.fillStyle = e.fill; ctx.globalAlpha = 1 - p; ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r * (0.4 + p * 0.6), e.r * 0.75 * (0.4 + p * 0.6), 0, 0, Math.PI * 2); ctx.fill(); }
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
      const ty = e.y - 18 - p * 26;
      const tx = e.gem ? e.x - 9 : e.x; // « +1 » suivi de l'icône d'émeraude
      ctx.strokeText(e.v, tx, ty);
      ctx.fillStyle = e.c === 2 ? '#5dff9a' : e.c ? '#ffd34a' : '#fff';
      ctx.fillText(e.v, tx, ty);
      if (e.gem) emeraldIcon(ctx, tx + ctx.measureText(e.v).width / 2 + 10, ty - 7, 8);
    }
    ctx.globalAlpha = 1;
    // Interface (écran)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawDaylight(f, now, Math.round(camX), Math.round(camY));
    drawHud(f, now, camX, camY);
  }

  // ---------- Jour et nuit ----------
  // Soir doré, nuit (obscurité percée par la lumière autour du joueur, des autels, des sanctuaires…), aube rose
  let darkCv = null;
  function drawDaylight(f, now, camX, camY) {
    const L = Rules.survivorDaylight(G.srvT);
    const tint = (color, a, mode) => { ctx.save(); ctx.globalCompositeOperation = mode; ctx.fillStyle = color.replace('A', a); ctx.fillRect(0, 0, W, H); ctx.restore(); };
    if (L.warm > 0.01) {
      // Fin de soirée : lumière orangée qui vient d'en haut à gauche, ombres violettes en bas
      tint('rgba(255, 150, 60, A)', 0.5 * L.warm, 'soft-light');
      const g = ctx.createLinearGradient(0, 0, W * 0.7, H);
      g.addColorStop(0, `rgba(255, 200, 110, ${0.28 * L.warm})`); g.addColorStop(0.55, `rgba(255, 120, 70, ${0.1 * L.warm})`); g.addColorStop(1, `rgba(110, 40, 120, ${0.22 * L.warm})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const sun = ctx.createRadialGradient(-60, -60, 10, -60, -60, W * 0.6);
      sun.addColorStop(0, `rgba(255, 230, 150, ${0.35 * L.warm})`); sun.addColorStop(1, 'rgba(255, 200, 120, 0)');
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    if (L.pink > 0.01) {
      tint('rgba(255, 140, 190, A)', 0.45 * L.pink, 'soft-light');
      const g = ctx.createLinearGradient(W, 0, 0, H);
      g.addColorStop(0, `rgba(255, 190, 210, ${0.25 * L.pink})`); g.addColorStop(1, `rgba(140, 160, 255, ${0.12 * L.pink})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (L.dark > 0.01) {
      if (!darkCv) { darkCv = document.createElement('canvas'); darkCv.width = W; darkCv.height = H; }
      const d = darkCv.getContext('2d');
      d.globalCompositeOperation = 'source-over';
      d.clearRect(0, 0, W, H);
      d.fillStyle = `rgba(6, 10, 34, ${L.dark})`; d.fillRect(0, 0, W, H);
      d.globalCompositeOperation = 'destination-out';
      const hole = (wx, wy, r, k = 1) => {
        const x = wx - camX;
        const y = wy - camY;
        if (x < -r || y < -r || x > W + r || y > H + r) return;
        const g = d.createRadialGradient(x, y, r * 0.1, x, y, r);
        g.addColorStop(0, `rgba(0,0,0,${k})`); g.addColorStop(0.6, `rgba(0,0,0,${k * 0.6})`); g.addColorStop(1, 'rgba(0,0,0,0)');
        d.fillStyle = g; d.beginPath(); d.arc(x, y, r, 0, Math.PI * 2); d.fill();
      };
      hole(G.me.x, G.me.y - 10, 290 + Math.sin(now / 300) * 6);
      if (f.aura) hole(G.me.x, G.me.y, f.aura * 1.4, 0.6);
      ALTARS.forEach((A, i) => { if (!f.alt || !f.alt[i] || f.alt[i][0] <= 0) hole(A.x, A.y - 30, 170, 0.85); });
      for (const [x, y, , done] of f.cu || []) hole(x, y - 40, done ? 150 : 110, 0.7);
      for (const l of f.lg || []) if (l.st === 0) hole(l.x, l.y + 120, 150, 0.7);
      if (f.lb) hole(f.lb.x, f.lb.y - 40, 200, 0.8);
      if (f.b) hole(f.b.x, f.b.y - 30, 160, 0.6);
      if (f.tr) hole(f.tr.x, f.tr.y - 30, 200, 0.9);
      if (f.ct) hole(f.ct.x, f.ct.y - 20, 170, 0.9);
      for (let i = 0; i < (f.sh || []).length; i += 2) hole(f.sh[i], f.sh[i + 1], 100, 0.7);
      for (let i = 0; i < f.pk.length; i += 3) hole(f.pk[i], f.pk[i + 1], 80, 0.6);
      for (const e of G.fx) if (e.k === 'ring' || e.k === 'zap' || e.k === 'quake') hole(e.x, e.y, (e.r || 80) * 1.2, 0.8 * (1 - (now - e.t0) / e.life));
      for (const p of G.proj.values()) if (!p.bolt && p.rx != null) hole(p.rx, p.ry, 40, 0.7); // les projectiles ennemis luisent : on les voit venir
      ctx.drawImage(darkCv, 0, 0);
      // Lucioles
      if (L.dark > 0.4) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const k = (L.dark - 0.4) / 0.38;
        for (let i = 0; i < 46; i++) {
          const gx = Math.floor(camX / 300) + (i % 6) - 1;
          const gy = Math.floor(camY / 300) + Math.floor(i / 6) % 5 - 1;
          const seed = hash(gx, gy, 300 + i);
          if (seed < 0.5) continue;
          const x = gx * 300 + hash(gx, gy, 301 + i) * 300 + Math.sin(now / 900 + i) * 20 - camX;
          const y = gy * 300 + hash(gx, gy, 302 + i) * 300 + Math.cos(now / 700 + i * 1.3) * 16 - camY;
          const a = k * (0.4 + 0.6 * Math.abs(Math.sin(now / 500 + i)));
          const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
          g.addColorStop(0, `rgba(220, 255, 150, ${a})`); g.addColorStop(1, 'rgba(160, 255, 100, 0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  // Gardien légendaire : dessin d'un boss ou d'un monstre, grandi et teinté, avec une aura violette (éveillé) ou endormi
  const LIFT = { troll: 30, dragon: 26, sorcier: 20, mimic: 18, liche: 20, maexxna: 6, ether: 24, lilith: 14, daedra: 18 };
  const BOSS_SC = { troll: 1, dragon: 0.9, sorcier: 0.95, mimic: 0.95, liche: 0.95, maexxna: 0.9, ether: 0.9, lilith: 0.9, daedra: 0.9 };
  function drawGuardian(zone, x, y, now, o = {}) {
    const D = Rules.SURVIVOR_GUARDIANS[zone];
    const sc = D.scale * (BOSS_SC[D.draw] || 1);
    const lift = (LIFT[D.draw] || 0) * sc;
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath(); ctx.ellipse(x, y + 6, D.radius * 1.4, D.radius * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    if (o.awake) {
      // Aura légendaire : halo violet et anneau doré qui tourne
      const rg = ctx.createRadialGradient(x, y - 40, 10, x, y - 40, D.radius * 3.2);
      rg.addColorStop(0, `rgba(190, 110, 255, ${0.35 + Math.sin(now / 200) * 0.1})`); rg.addColorStop(1, 'rgba(190, 110, 255, 0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y - 40, D.radius * 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(x, y + 4); ctx.scale(1, 0.35); ctx.rotate(now / 700);
      ctx.strokeStyle = 'rgba(255, 211, 74, .75)'; ctx.lineWidth = 5; ctx.setLineDash([22, 14]);
      ctx.beginPath(); ctx.arc(0, 0, D.radius * 1.7, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    ctx.save();
    const filters = [];
    if (D.hue) filters.push(`hue-rotate(${D.hue}deg)`);
    if (D.gray) filters.push('grayscale(0.85) brightness(1.1)');
    if (!o.awake) filters.push('brightness(0.62) saturate(0.7)');
    if (filters.length) ctx.filter = filters.join(' ');
    const breathe = o.awake ? 1 : 1 + Math.sin(now / 700) * 0.03;
    drawMonster(ctx, x, y - lift, { kind: D.draw }, { scale: sc * breathe, t: o.awake ? now : 0, facing: o.facing || 1, intangible: !!o.ghost, vanish: !!o.hidden });
    ctx.restore();
  }
  function drawLair(l, now, t, anyAwake) {
    const D = Rules.SURVIVOR_GUARDIANS[l.z];
    const GD = Rules.SURVIVOR_GUARDIAN;
    // Sol de l'antre : cercle de pierres sombres
    ctx.fillStyle = 'rgba(30, 15, 45, .35)'; ctx.beginPath(); ctx.ellipse(l.x, l.y + 10, 150, 95, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const sx = l.x + Math.cos(a) * 150;
      const sy = l.y + 10 + Math.sin(a) * 95;
      ctx.fillStyle = l.st === 2 ? '#6a6670' : '#4a3a5a';
      ctx.beginPath(); ctx.moveTo(sx - 9, sy + 6); ctx.lineTo(sx - 6, sy - 26); ctx.lineTo(sx + 5, sy - 30); ctx.lineTo(sx + 9, sy + 6); ctx.closePath(); ctx.fill();
      if (l.st === 0) { ctx.fillStyle = `rgba(199, 125, 255, ${0.5 + Math.sin(t * 2 + i) * 0.4})`; ctx.fillRect(sx - 2, sy - 20, 4, 6); }
    }
    if (l.st === 0) {
      drawGuardian(l.z, l.x, l.y, now, { facing: 1 });
      // Zzz
      ctx.font = '900 18px system-ui'; ctx.textAlign = 'center';
      for (let i = 0; i < 3; i++) { const p = ((t * 0.5 + i / 3) % 1); ctx.globalAlpha = 1 - p; ctx.fillStyle = '#e8d8ff'; ctx.fillText('z', l.x + 40 + p * 30, l.y - 90 - p * 50 - i * 4); }
      ctx.globalAlpha = 1;
      // Sceau : rester dessus pour réveiller le gardien
      const sx = l.x;
      const sy = l.y + 130;
      const R = GD.sealRadius;
      const locked = anyAwake;
      ctx.fillStyle = locked ? 'rgba(80, 80, 90, .35)' : `rgba(160, 90, 255, ${0.22 + Math.sin(t * 3) * 0.08})`;
      ctx.beginPath(); ctx.ellipse(sx, sy, R, R * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = locked ? 'rgba(150,150,150,.6)' : '#c77dff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(sx, sy, R, R * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.save(); ctx.translate(sx, sy); ctx.scale(1, 0.55); ctx.rotate(-t * 0.8);
      ctx.strokeStyle = locked ? 'rgba(150,150,150,.5)' : 'rgba(230, 200, 255, .8)'; ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const b = ((i + 2) / 5) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8); ctx.lineTo(Math.cos(b) * R * 0.8, Math.sin(b) * R * 0.8); ctx.stroke(); }
      ctx.restore();
      if (l.c > 0) { ctx.strokeStyle = '#ffd34a'; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(sx, sy, R + 6, (R + 6) * 0.55, 0, -Math.PI / 2, -Math.PI / 2 + (l.c / 100) * Math.PI * 2); ctx.stroke(); }
      ctx.font = '800 12px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)';
      const t1 = `${D.icon} ${D.label} · Gardien légendaire`;
      const t2 = locked ? 'Un autre gardien est éveillé…' : `Reste ${GD.wake} s sur le sceau pour le réveiller`;
      ctx.strokeText(t1, sx, sy + R * 0.55 + 20); ctx.fillStyle = '#e6ccff'; ctx.fillText(t1, sx, sy + R * 0.55 + 20);
      ctx.strokeText(t2, sx, sy + R * 0.55 + 36); ctx.fillStyle = locked ? '#bbb' : '#fff2a8'; ctx.fillText(t2, sx, sy + R * 0.55 + 36);
    } else if (l.st === 2) {
      ctx.font = '34px system-ui'; ctx.textAlign = 'center'; ctx.fillText('🏆', l.x, l.y);
      ctx.font = '800 12px system-ui'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.strokeText(`${D.label} · vaincu`, l.x, l.y + 30); ctx.fillStyle = '#ffd34a'; ctx.fillText(`${D.label} · vaincu`, l.x, l.y + 30);
    }
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
    const img = g.createImageData(MINI, MINI);
    for (let y = 0; y < MINI; y++) {
      for (let x = 0; x < MINI; x++) {
        const c = groundRGB(x * s + s / 2, y * s + s / 2);
        const o = (y * MINI + x) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    g.save();
    g.scale(1 / s, 1 / s);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.fillStyle = '#bfe3f2'; smoothClosed(g, LAKE); g.fill();
    g.fillStyle = '#ff7a26'; smoothClosed(g, LAVA); g.fill();
    g.fillStyle = '#3f7d8a'; smoothClosed(g, POND); g.fill();
    g.strokeStyle = '#4a96c8'; g.lineWidth = MAP.width.river * 1.6; strokePath(g, RIVER); g.stroke();
    g.strokeStyle = 'rgba(176, 138, 90, .95)'; g.lineWidth = 70 * K;
    for (const r of ROADS) { strokePath(g, r); g.stroke(); }
    g.restore();
    g.font = '700 9px system-ui';
    g.textAlign = 'center';
    for (const z of Object.values(ZONES)) {
      g.lineWidth = 2.5; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(z.label, z.x / s, z.y / s + 3);
      g.fillStyle = '#fff'; g.fillText(z.label, z.x / s, z.y / s + 3);
    }
    return miniCanvas;
  }

  function drawHud(f, now) {
    // Montre : le monde se teinte de bleu, une horloge compte les secondes
    if (f.slow > 0) {
      const left = Math.max(0, f.slow - (now - G.frameAt) / 1000);
      const fade = Math.min(1, left / 1.2, (now - (G.watchAt || 0)) / 300 + 0.2);
      ctx.fillStyle = `rgba(70, 130, 255, ${0.12 * fade})`; ctx.fillRect(0, 0, W, H);
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.9);
      vg.addColorStop(0, 'rgba(120, 190, 255, 0)'); vg.addColorStop(1, `rgba(90, 160, 255, ${0.35 * fade})`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      // Horloge à droite du chrono
      const cx = W / 2 + 128;
      const cy = 50;
      ctx.fillStyle = 'rgba(10, 20, 50, .8)'; ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8fd8ff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx, cy, 20, -Math.PI / 2, -Math.PI / 2 + (left / SV.watch.duration) * Math.PI * 2); ctx.stroke();
      const ang = -Math.PI / 2 + (now / 1000) * Math.PI * 0.35; // aiguille au ralenti
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * 13, cy + Math.sin(ang) * 13); ctx.stroke();
      ctx.font = '900 14px system-ui'; ctx.textAlign = 'left'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.strokeText(`⏱️ ${Math.ceil(left)} s`, cx + 30, cy + 5); ctx.fillStyle = '#cfeaff'; ctx.fillText(`⏱️ ${Math.ceil(left)} s`, cx + 30, cy + 5);
    }
    // Bombe : éclair blanc puis onde de choc
    const ba = now - (G.bombAt || -1e9);
    if (ba < 900) {
      if (ba < 260) { ctx.fillStyle = `rgba(255, 250, 235, ${0.85 * (1 - ba / 260)})`; ctx.fillRect(0, 0, W, H); }
      const p = ba / 900;
      const sx = G.me.x - (Math.max(W / 2, Math.min(SV.map.w - W / 2, G.me.x)) - W / 2);
      const sy = G.me.y - (Math.max(H / 2, Math.min(SV.map.h - H / 2, G.me.y)) - H / 2);
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = '#ffdd88'; ctx.lineWidth = 30 * (1 - p) + 4; ctx.shadowColor = '#ff7a1f'; ctx.shadowBlur = 30;
      ctx.beginPath(); ctx.ellipse(sx, sy, W * 0.75 * p, W * 0.55 * p, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 6 * (1 - p) + 1;
      ctx.beginPath(); ctx.ellipse(sx, sy, W * 0.6 * p, W * 0.44 * p, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
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
    const wtxt = f.hold ? `Vague ${f.wave} · ⚔️ Tue le boss pour continuer !` : `Vague ${f.wave}${f.wave % SV.bossEvery === SV.bossEvery - 1 ? ` · boss dans ${Math.ceil(wl)} s` : ''}`;
    ctx.strokeText(wtxt, W / 2, 82);
    ctx.fillStyle = f.hold ? `rgba(255, 120, 90, ${0.75 + Math.sin(now / 180) * 0.25})` : f.wave % SV.bossEvery === SV.bossEvery - 1 ? '#ff8a6b' : '#cfe';
    ctx.fillText(wtxt, W / 2, 82);
    ctx.textAlign = 'right';
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.strokeText(`💀 ${fmt(f.kills)}`, W - 14, 50);
    ctx.fillStyle = '#fff';
    ctx.fillText(`💀 ${fmt(f.kills)}`, W - 14, 50);
    if (f.wave >= SV.dailyWave) { ctx.font = '800 13px system-ui'; ctx.fillStyle = '#ffd34a'; ctx.fillText('★ Vague 30 atteinte !', W - 14, 70); }
    // Jour / nuit : l'heure qu'il est et le temps avant le prochain changement
    {
      const D = Rules.SURVIVOR_DAY;
      const L = Rules.survivorDaylight(G.srvT);
      const toNight = L.c < D.nightAt ? D.nightAt - L.c : null;
      const toDay = L.c >= D.nightAt ? D.cycle - L.c + D.dawn : L.c < D.dawn ? D.dawn - L.c : null;
      const txt = L.phase === 'night' ? `🌙 Nuit · jour dans ${mmss(toDay)}` : L.phase === 'dawn' ? '🌅 Aube' : L.phase === 'evening' ? `🌇 Soir · nuit dans ${mmss(toNight)}` : `☀️ Jour · nuit dans ${mmss(toNight)}`;
      ctx.font = '800 13px system-ui'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
      const dy = f.wave >= SV.dailyWave ? 88 : 70;
      ctx.strokeText(txt, W - 14, dy); ctx.fillStyle = L.phase === 'night' ? '#b8c8ff' : L.phase === 'evening' ? '#ffc070' : '#fff2c0'; ctx.fillText(txt, W - 14, dy);
    }
    // Armes et objets
    let x = 12;
    ctx.textAlign = 'center';
    const evoReady = Rules.survivorEvoReady(f.weapons.map(([id, level, evo]) => ({ id, level, evo })), Object.fromEntries(f.passives));
    for (const [id, lv, evo] of f.weapons) {
      const Wp = Rules.SURVIVOR_WEAPONS[id];
      hudSlot(x, 32, Wp.icon, lv, Rules.SURVIVOR_WEAPON_MAX, '#ffd34a', evo ? 2 : evoReady.includes(id) ? 1 : 0, now);
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
    if (f.em) {
      const lw = ctx.measureText(`❤️ ${f.hp} / ${f.maxHp}${f.revivals ? '   👼' : ''}${f.rerolls ? `   🎲 ${f.rerolls}` : ''}   `).width;
      emeraldIcon(ctx, 14 + lw + 7, 131, 7);
      ctx.fillStyle = '#5dff9a';
      ctx.fillText(`+${f.em}`, 14 + lw + 17, 136);
    }
    const Zc = ZONES[f.zone || 'village'];
    ctx.font = '700 12px system-ui';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.65)';
    const zl = `${Zc.icon} ${Zc.label} · ${Zc.bonus} : ${Zc.desc}`;
    ctx.strokeText(zl, 14, 156); ctx.fillStyle = '#fff2a8'; ctx.fillText(zl, 14, 156);
    if (f.bless) {
      const Bz = ZONES[f.bless.zone];
      const bl = `✨ Bénédiction ${Bz.bonus} (${Math.ceil(Math.max(0, f.bless.left - (now - G.frameAt) / 1000))} s)`;
      ctx.strokeText(bl, 14, 174); ctx.fillStyle = '#b6ffa0'; ctx.fillText(bl, 14, 174);
    }
    let wy = f.bless ? 192 : 174;
    if (f.curse) {
      const cl = `☠️ Malédictions ×${f.curse} : monstres +${f.curse * 10} % · émeraudes +${f.curse * 10} %`;
      ctx.strokeText(cl, 14, wy); ctx.fillStyle = '#ff8a9a'; ctx.fillText(cl, 14, wy);
      wy += 18;
    }
    if (Rules.survivorWater(G.me.x, G.me.y)) {
      const wl = '💧 Dans l\'eau : vitesse −50 % (passe par les ponts !)';
      ctx.strokeText(wl, 14, wy); ctx.fillStyle = '#9fdcff'; ctx.fillText(wl, 14, wy);
    } else if (Rules.survivorRoad(G.me.x, G.me.y)) {
      const rl = `🛤️ Sur la route : vitesse +${Math.round(SV.roadSpeed * 100)} %`;
      ctx.strokeText(rl, 14, wy); ctx.fillStyle = '#ffe2a8'; ctx.fillText(rl, 14, wy);
    }
    // Boss
    if (f.b) {
      const bw = 520;
      const bx = W / 2 - bw / 2;
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(bx, 96, bw, 18);
      ctx.fillStyle = f.b.rage ? `rgb(${200 + Math.sin(now / 120) * 55}, 20, 20)` : '#c4122f'; ctx.fillRect(bx + 2, 98, (bw - 4) * (f.b.hp / f.b.maxHp), 14);
      if (f.b.rage) { ctx.strokeStyle = '#ff3030'; ctx.lineWidth = 2; ctx.strokeRect(bx - 1, 95, bw + 2, 20); }
      ctx.textAlign = 'center'; ctx.font = '900 12px system-ui'; ctx.fillStyle = '#fff';
      const rageTxt = f.b.rage ? ' · 😡 ENRAGÉ' : f.b.rageIn <= 60 ? ` · rage dans ${f.b.rageIn} s` : '';
      ctx.fillText(`${Rules.SURVIVOR_BOSSES[f.b.kind].label} — ${fmt(f.b.hp)} / ${fmt(f.b.maxHp)}${rageTxt}`, W / 2, 110);
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
    // Gardien légendaire éveillé : sa barre de vie (sous celle du boss) et une flèche s'il est hors de l'écran
    if (f.lb) {
      const D = Rules.SURVIVOR_GUARDIANS[f.lb.z];
      const bw = 520;
      const bx = W / 2 - bw / 2;
      const by = f.b ? 120 : 96;
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(bx, by, bw, 18);
      const lg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      lg.addColorStop(0, '#7b2cff'); lg.addColorStop(1, '#c77dff');
      ctx.fillStyle = lg; ctx.fillRect(bx + 2, by + 2, (bw - 4) * (f.lb.hp / f.lb.maxHp), 14);
      ctx.strokeStyle = '#ffd34a'; ctx.lineWidth = 1.5; ctx.strokeRect(bx - 1, by - 1, bw + 2, 20);
      ctx.textAlign = 'center'; ctx.font = '900 12px system-ui'; ctx.fillStyle = '#fff';
      ctx.fillText(`${D.icon} ${D.label} (légendaire) — ${fmt(f.lb.hp)} / ${fmt(f.lb.maxHp)}`, W / 2, by + 14);
      const dx = f.lb.x - G.me.x;
      const dy = f.lb.y - G.me.y;
      if (Math.abs(dx) > W / 2 - 40 || Math.abs(dy) > H / 2 - 40) {
        const a = Math.atan2(dy, dx);
        ctx.save(); ctx.translate(W / 2 + Math.cos(a) * (H / 2 - 50), H / 2 + Math.sin(a) * (H / 2 - 50)); ctx.rotate(a);
        ctx.fillStyle = '#c77dff'; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-8, -11); ctx.lineTo(-8, 11); ctx.closePath(); ctx.fill();
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
    ALTARS.forEach((A, i) => {
      const ready = !f.alt || !f.alt[i] || f.alt[i][0] <= 0;
      ctx.fillStyle = ready ? '#fff2a8' : 'rgba(120,120,120,.8)';
      ctx.fillRect(mx + A.x * s - 2.5, my + A.y * s - 2.5, 5, 5);
    });
    for (let i = 0; i < (f.sh || []).length; i += 2) { ctx.fillStyle = '#5dff9a'; ctx.beginPath(); ctx.arc(mx + f.sh[i] * s, my + f.sh[i + 1] * s, 3, 0, Math.PI * 2); ctx.fill(); }
    if (f.tr) { ctx.fillStyle = '#ffd34a'; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('★', mx + f.tr.x * s, my + f.tr.y * s + 4); }
    if (f.b) { ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(mx + f.b.x * s, my + f.b.y * s, 4, 0, Math.PI * 2); ctx.fill(); }
    for (const [x, y, , done] of f.cu || []) { ctx.fillStyle = done ? '#ff3a5a' : 'rgba(150, 20, 40, .9)'; ctx.fillRect(mx + x * s - 2, my + y * s - 3, 4, 6); }
    if (f.ct && Math.floor(now / 250) % 2) { ctx.fillStyle = '#ffd34a'; ctx.beginPath(); ctx.arc(mx + f.ct.x * s, my + f.ct.y * s, 4, 0, Math.PI * 2); ctx.fill(); }
    for (const l of f.lg || []) {
      ctx.fillStyle = l.st === 2 ? 'rgba(160,160,160,.8)' : l.st === 1 ? '#ff6bff' : '#c77dff';
      ctx.save(); ctx.translate(mx + l.x * s, my + l.y * s); ctx.rotate(Math.PI / 4); ctx.fillRect(-3.5, -3.5, 7, 7); ctx.restore();
    }
    // Flèches vers le trésor et l'éclat le plus proche, hors de l'écran
    const edge = (tx, ty, color, icon) => {
      const dx = tx - G.me.x;
      const dy = ty - G.me.y;
      if (Math.abs(dx) < W / 2 - 30 && Math.abs(dy) < H / 2 - 30) return;
      const a = Math.atan2(dy, dx);
      const k = Math.min((W / 2 - 46) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - 46) / Math.abs(Math.sin(a) || 1e-6));
      const px = W / 2 + Math.cos(a) * k;
      const py = H / 2 + Math.sin(a) * k;
      ctx.save(); ctx.translate(px, py);
      ctx.fillStyle = 'rgba(10, 6, 24, .7)'; ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
      if (typeof icon === 'function') icon(); else { ctx.font = '16px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(icon, 0, 1); }
      ctx.rotate(a); ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(17, -7); ctx.lineTo(17, 7); ctx.closePath(); ctx.fill();
      ctx.restore(); ctx.textBaseline = 'alphabetic';
    };
    if (f.tr) edge(f.tr.x, f.tr.y, '#ffd34a', '🧰');
    if (f.ct) edge(f.ct.x, f.ct.y, '#ffd34a', '💰');
    let near = null;
    for (let i = 0; i < (f.sh || []).length; i += 2) { const d = Math.hypot(f.sh[i] - G.me.x, f.sh[i + 1] - G.me.y); if (!near || d < near.d) near = { x: f.sh[i], y: f.sh[i + 1], d }; }
    if (near) edge(near.x, near.y, '#5dff9a', () => emeraldIcon(ctx, 0, 0, 9));
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
    if (G.cine) drawEvolution(now);
  }

  // Cinématique d'évolution : l'arme et son objet se rejoignent, éclair, puis l'arme évoluée apparaît en grand
  const EVO_MS = SV.evoPause * 1000;
  function drawEvolution(now) {
    const c = G.cine;
    const t = now - c.t0;
    if (t > EVO_MS) { G.cine = null; return; }
    const E = Rules.SURVIVOR_EVOLUTIONS[c.id];
    const Wp = Rules.SURVIVOR_WEAPONS[c.id];
    const P = Rules.SURVIVOR_PASSIVES[E.passive];
    const fade = Math.min(1, t / 250, (EVO_MS - t) / 300);
    const cx = W / 2;
    const cy = H / 2 - 20;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(8, 4, 20, .78)'; ctx.fillRect(0, 0, W, H);
    // Rayons de lumière qui tournent
    const power = Math.min(1, t / 1000);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(now / 1800);
    for (let i = 0; i < 14; i++) {
      ctx.rotate((Math.PI * 2) / 14);
      const g = ctx.createLinearGradient(0, 0, 0, -H);
      g.addColorStop(0, `rgba(255, 220, 120, ${0.35 * power})`); g.addColorStop(1, 'rgba(255, 220, 120, 0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-40 - 30 * power, -H); ctx.lineTo(40 + 30 * power, -H); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (t < 1000) {
      // L'arme et l'objet se rejoignent en tournant l'un autour de l'autre
      const k = t / 1000;
      const e = k * k * (3 - 2 * k);
      const d = 200 * (1 - e);
      const a = e * Math.PI * 1.5;
      for (const [icon, side] of [[Wp.icon, -1], [P.icon, 1]]) {
        const x = cx + Math.cos(a) * d * side;
        const y = cy + Math.sin(a) * d * side * 0.5;
        const g = ctx.createRadialGradient(x, y, 4, x, y, 60);
        g.addColorStop(0, 'rgba(255, 240, 180, .7)'); g.addColorStop(1, 'rgba(255, 200, 80, 0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 60, 0, Math.PI * 2); ctx.fill();
        ctx.font = '64px system-ui'; ctx.fillStyle = '#fff'; ctx.fillText(icon, x, y);
      }
      ctx.font = '900 22px system-ui'; ctx.fillStyle = '#fff2a8';
      ctx.fillText(`${Wp.label} niv. 8  +  ${P.label}`, cx, cy + 140);
    } else {
      const k = (t - 1000) / (EVO_MS - 1000);
      // Éclair blanc et anneaux qui s'élargissent
      if (t < 1350) { ctx.fillStyle = `rgba(255, 255, 255, ${1 - (t - 1000) / 350})`; ctx.fillRect(0, 0, W, H); }
      for (let i = 0; i < 3; i++) {
        const r = (k * 1.6 - i * 0.15) * 420;
        if (r <= 0) continue;
        ctx.strokeStyle = `rgba(255, 220, 120, ${Math.max(0, 0.8 - k - i * 0.15)})`; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      }
      // Étincelles
      for (let i = 0; i < 40; i++) {
        const a = hash(i, 1, 77) * Math.PI * 2;
        const v = 120 + hash(i, 2, 77) * 380;
        const x = cx + Math.cos(a) * v * Math.min(1, k * 2);
        const y = cy + Math.sin(a) * v * Math.min(1, k * 2) + k * k * 80;
        ctx.fillStyle = i % 3 ? E.color : '#ffffff';
        ctx.globalAlpha = fade * Math.max(0, 1 - k * 1.2);
        ctx.beginPath(); ctx.arc(x, y, 3 + hash(i, 3, 77) * 3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = fade;
      // L'arme évoluée, en grand
      const pop = Math.min(1, k * 5);
      const size = 120 * (0.6 + 0.4 * pop) * (1 + Math.sin(now / 160) * 0.04);
      const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, size * 1.2);
      g.addColorStop(0, E.color); g.addColorStop(0.5, 'rgba(255, 220, 120, .35)'); g.addColorStop(1, 'rgba(255, 220, 120, 0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, size * 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = E.color; ctx.shadowBlur = 30;
      ctx.font = `${Math.round(size)}px system-ui`; ctx.fillStyle = '#fff'; ctx.fillText(Wp.icon, cx, cy);
      ctx.shadowBlur = 0;
      ctx.font = '900 20px system-ui'; ctx.fillStyle = '#fff'; ctx.globalAlpha = fade * pop;
      ctx.fillText('✨ ÉVOLUTION ! ✨', cx, cy - 120);
      const tg = ctx.createLinearGradient(cx - 220, 0, cx + 220, 0);
      tg.addColorStop(0, '#ffe9a8'); tg.addColorStop(0.5, '#ffd34a'); tg.addColorStop(1, '#ff9a3d');
      ctx.font = '900 46px system-ui'; ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(40, 20, 0, .85)';
      ctx.strokeText(E.label, cx, cy + 112); ctx.fillStyle = tg; ctx.fillText(E.label, cx, cy + 112);
      ctx.font = '700 17px system-ui'; ctx.fillStyle = '#f3e9ff';
      ctx.fillText(E.desc, cx, cy + 156);
    }
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }

  // evo : 0 normal, 1 prête à évoluer (au prochain coffre), 2 évoluée
  function hudSlot(x, y, icon, lv, max, color, evo = 0, now = 0) {
    if (evo === 2) {
      const g = ctx.createLinearGradient(x, y, x + 36, y + 36);
      g.addColorStop(0, '#5a3a00'); g.addColorStop(1, '#2a1640');
      ctx.fillStyle = g; ctx.fillRect(x, y, 36, 36);
      ctx.save(); ctx.shadowColor = '#ffd34a'; ctx.shadowBlur = 10 + Math.sin(now / 200) * 4;
      ctx.strokeStyle = '#ffd34a'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, 34, 34); ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(10, 6, 24, .7)';
      ctx.fillRect(x, y, 36, 36);
      ctx.strokeStyle = evo === 1 ? `rgba(255, 211, 74, ${0.5 + Math.sin(now / 150) * 0.5})` : 'rgba(255,255,255,.25)'; ctx.lineWidth = evo === 1 ? 2 : 1; ctx.strokeRect(x + 0.5, y + 0.5, 35, 35);
    }
    ctx.font = '20px system-ui'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(icon, x + 18, y + 16);
    ctx.textBaseline = 'alphabetic';
    if (evo === 2) { ctx.font = '900 10px system-ui'; ctx.fillStyle = '#ffd34a'; ctx.fillText('★★★', x + 18, y + 34); ctx.font = '20px system-ui'; return; }
    for (let i = 0; i < max; i++) { ctx.fillStyle = i < lv ? color : 'rgba(255,255,255,.2)'; ctx.fillRect(x + 3 + i * (30 / max), y + 30, 30 / max - 1, 3); }
  }

  // ---------- Fenêtres par-dessus le jeu ----------
  function optLabel(o) {
    if (o.type === 'evo') return `✨ ÉVOLUTION : ${Rules.SURVIVOR_EVOLUTIONS[o.id].label}`;
    if (o.type === 'weapon') return `${Rules.SURVIVOR_WEAPONS[o.id].icon} ${Rules.SURVIVOR_WEAPONS[o.id].label}${o.level > 1 ? ` niv. ${o.level}` : ''}`;
    if (o.type === 'passive') return `${Rules.SURVIVOR_PASSIVES[o.id].icon} ${Rules.SURVIVOR_PASSIVES[o.id].label}${o.level > 1 ? ` niv. ${o.level}` : ''}`;
    return o.type === 'heal' ? '🍗 Poulet rôti' : '{em} 2 émeraudes';
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
    } else if (o.type === 'heal') { icon = '🍗'; name = 'Poulet rôti'; desc = 'Rend 30 % de ta vie.'; lvl = ''; } else { icon = EM; name = 'Éclat d\'émeraude'; desc = '+2 émeraudes à la fin de la partie.'; lvl = ''; }
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
    if (!await confirmBox('Abandonner la partie ? Tes émeraudes seront comptées jusqu\'ici.')) return;
    try {
      const r = await api('/api/survivor/abandon', {});
      showOver(r.result, r.result);
    } catch (e) { toast('⚠️ ' + e.message); }
  }

  // Annonces : cartes empilées sous le chrono et la vague (3 au plus, la plus récente en haut), assez longtemps pour les lire.
  // items : liste de lignes affichées en pastilles (ex. contenu d'un coffre).
  function svToast(text, ms = 2000, kind = '', items = null) {
    const box = $('sv-toast');
    const el = document.createElement('div');
    el.className = `sv-note ${kind ? `k-${kind}` : ''}`; // classes préfixées (pas de conflit avec .chest, .boss… du reste du site)
    const gem = (t) => esc(t).replace(/\{em\}|💎/g, EM); // émeraudes toujours en vert
    el.innerHTML = `<div class="sv-note-title">${gem(text)}</div>${items && items.length ? `<div class="sv-note-items">${items.map((t) => `<span>${gem(t)}</span>`).join('')}</div>` : ''}`;
    box.prepend(el);
    while (box.children.length > 3) box.lastElementChild.remove();
    requestAnimationFrame(() => el.classList.add('show'));
    const life = Math.max(2800, ms * 1.6);
    setTimeout(() => { el.classList.remove('show'); el.classList.add('hide'); setTimeout(() => el.remove(), 350); }, life);
  }

  function showOver(res) {
    if (G.over) return;
    G.over = res;
    $('sv-pause').classList.remove('open');
    hideChoice();
    Sound.music.stop();
    Sound.play(res.wave >= SV.dailyWave ? 'victory' : 'defeat');
    const el = $('sv-over');
    const daily = res.daily ? `<div class="sv-daily">🎉 Récompense du jour : +${res.daily.chests} <i class="ico-chest"></i> coffres et +${res.daily.keys} 🗝️ Clés de boss !</div>` : '';
    el.innerHTML = `<div class="sv-choice-box"><div class="sv-title">${res.wave >= SV.dailyWave ? '🏆 Quelle survie !' : '💀 Fin de partie'}</div>
      ${res.record ? '<div class="sv-record">★ Nouveau record ! ★</div>' : ''}
      <div class="sv-stats">
        <div><span>Temps</span><b>${mmss(res.time)}</b></div><div><span>Vague</span><b>${res.wave}</b></div>
        <div><span>Monstres</span><b>${fmt(res.kills)}</b></div><div><span>Boss</span><b>${res.bosses}</b></div>
        <div><span>Niveau</span><b>${res.level}</b></div><div><span>Score</span><b class="gold-text">${fmt(res.score)}</b></div>
      </div>
      <div class="sv-emeralds">+<span id="sv-em-count">0</span> ${EM} émeraudes</div>${daily}${overExtras(res)}
      <div class="sv-built">${(res.weapons || []).map(([id, lv, evo]) => `<span class="${evo ? 'evo' : ''}">${Rules.SURVIVOR_WEAPONS[id].icon} ${evo ? '★' : lv}</span>`).join('')}${(res.passives || []).map(([id, lv]) => `<span>${Rules.SURVIVOR_PASSIVES[id].icon} ${lv}</span>`).join('')}</div>
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

  // Fin de partie : défis réussis, armes secrètes débloquées, gardiens vaincus, malédictions
  function overExtras(res) {
    const lines = [];
    if (res.curses) lines.push(`☠️ ${res.curses} sanctuaire${res.curses > 1 ? 's' : ''} maudit${res.curses > 1 ? 's' : ''} : émeraudes ×${String(res.curseMult || 1).replace('.', ',')}`);
    for (const z of res.legends || []) lines.push(`🏆 ${Rules.SURVIVOR_GUARDIANS[z].icon} ${Rules.SURVIVOR_GUARDIANS[z].label} vaincu`);
    for (const id of res.evos || []) lines.push(`✨ Évolution : ${Rules.SURVIVOR_EVOLUTIONS[id].label}`);
    for (const id of res.challenges || []) lines.push(`🎯 Défi du jour réussi : ${Rules.SURVIVOR_CHALLENGES[id].text} (+${Rules.SURVIVOR_CHALLENGE_REWARD} ${EM})`);
    for (const id of res.secrets || []) lines.push(`<b class="gold-text">🗝️ Arme secrète débloquée : ${Rules.SURVIVOR_WEAPONS[id].icon} ${Rules.SURVIVOR_WEAPONS[id].label} !</b>`);
    return lines.length ? `<div class="sv-over-extras">${lines.map((l) => `<div>${l}</div>`).join('')}</div>` : '';
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
    G.proj.clear();
    G.gems.clear();
    G.gemGot.clear();
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
    setTimeout(() => { if (G.on && !G.over) Sound.music.start(0, 'survivor'); }, 300);
  }

  function stopGame() {
    G.on = false;
    cancelAnimationFrame(G.raf);
    $('sv-game').style.display = 'none';
    $('sv-lobby').style.display = '';
    GameScreen.exit($('sv-game'));
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
    // Plein écran (en paysage sur téléphone ; sur iPhone, le jeu couvre la page)
    $('sv-full').onclick = () => GameScreen.toggle($('sv-game'), $('sv-canvas'));
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
    const hidden = Wp.secret && !state.unlocked.weapons.includes(id);
    return `<button class="sv-starter ${ok ? '' : 'locked'} ${starter === id ? 'active' : ''}" data-starter="${id}" ${ok ? '' : 'disabled'} title="${ok ? Wp.desc : hidden ? 'Arme secrète' : 'À débloquer dans la méta-progression'}">${hidden ? '❔' : Wp.icon}<span>${hidden ? '???' : Wp.label}</span>${ok ? '' : '<em>🔒</em>'}</button>`;
  }).join('')}</div>
          <button class="gold big-btn sv-play" id="sv-play" ${c.gold < SV.price ? 'disabled' : ''}>▶ Jouer — ${SV.price} 🪙</button>
          <div class="sv-daily-status ${state.dailyDone ? 'done' : ''}">${state.dailyDone ? '✅ Récompense de la vague 30 déjà obtenue aujourd\'hui (revient demain)' : `🎁 Récompense du jour : atteins la vague ${SV.dailyWave} → +${SV.daily.chests} coffres et +${SV.daily.keys} Clés de boss`}</div>
          <div class="muted" style="font-size:13px">${b ? `Ton record : <b>${fmt(b.score)}</b> points (vague ${b.wave}, ${mmss(b.time)}, ${fmt(b.kills)} monstres, ${b.bosses} boss) · ${state.runs} partie(s)` : 'Pas encore de record : à toi de jouer !'}</div>
          <div class="muted" style="font-size:12px">${matchMedia('(pointer: coarse)').matches
            ? '👆 Glisse le doigt sur le jeu pour bouger · tes armes tirent seules · ⛶ : plein écran en paysage · ⏸ : pause'
            : '⌨️ ZQSD ou flèches pour bouger · tes armes tirent seules · Échap : pause · 1-4 : choisir'}</div>
        </div>
      </div>
      ${lobbyExtras()}
      <div class="sv-zones"><div class="sv-zones-title">🗺️ Lieux-dits : chacun a son effet tant que tu y es. Explore pour trouver les <b>autels</b> (bénédiction de ${X.altar.duration} s),
        les <b>éclats d'émeraude</b> (+${X.shard.emeralds} ${EM} chacun) et les <b>trésors gardés</b> (${X.treasure.upgrades} améliorations et +${X.treasure.emeralds} ${EM}). 💧 La rivière, le lac et la mare ralentissent de moitié (toi comme les monstres) : passe par les ponts.</div>
        <div class="sv-zones-grid">${Object.values(ZONES).map((z) => `<div class="sv-zone" style="--zc:${z.ground}"><b>${z.icon} ${z.label}</b><span>${z.bonus} : ${z.desc}</span></div>`).join('')}</div>
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

  // Défis du jour, évolutions découvertes, armes secrètes, et ce qu'on trouve sur la carte
  function lobbyExtras() {
    const ch = (state.challenges || []).map(({ id, done }) => {
      const CH = Rules.SURVIVOR_CHALLENGES[id];
      return `<div class="sv-challenge ${done ? 'done' : ''}"><span>${done ? '✅' : '🎯'}</span><b>${CH.text}</b><em>${done ? 'Réussi' : `+${Rules.SURVIVOR_CHALLENGE_REWARD} ${EM}`}</em></div>`;
    }).join('');
    const evos = Object.entries(Rules.SURVIVOR_EVOLUTIONS).map(([id, E]) => {
      const Wp = Rules.SURVIVOR_WEAPONS[id];
      const P = Rules.SURVIVOR_PASSIVES[E.passive];
      const known = (state.evos || []).includes(id);
      return `<div class="sv-evo ${known ? 'known' : ''}" style="--ec:${E.color}" title="${known ? esc(E.desc) : 'Arme au niveau 8 + cet objet, puis ouvre un coffre (élite, boss, trésor ou gardien)'}">
        <div class="sv-evo-recipe">${Wp.icon}<small>niv. 8</small> + ${P.icon}</div>
        <b>${known ? E.label : '???'}</b><span>${known ? E.desc : `${Wp.label} + ${P.label}`}</span></div>`;
    }).join('');
    const secrets = Object.entries(Rules.SURVIVOR_SECRETS).map(([id, SE]) => {
      const Wp = Rules.SURVIVOR_WEAPONS[id];
      const st = (state.secrets || {})[id] || { progress: 0 };
      return `<div class="sv-secret ${st.unlocked ? 'done' : ''}"><span class="sv-secret-ico">${st.unlocked ? Wp.icon : '❔'}</span>
        <div><b>${st.unlocked ? Wp.label : 'Arme secrète'}</b><span>${SE.text}</span>
        <div class="sv-secret-bar"><i style="width:${Math.round((st.progress / SE.goal) * 100)}%"></i></div><em>${st.unlocked ? '✅ Débloquée : elle sort dans les tirages' : `${st.progress} / ${SE.goal}`}</em></div></div>`;
    }).join('');
    const GD = Rules.SURVIVOR_GUARDIAN;
    return `<div class="sv-extras">
      <div class="sv-box"><h3>🎯 Défis du jour <span class="sub">en une seule partie · nouveaux défis chaque jour</span></h3>${ch}</div>
      <div class="sv-box"><h3>🗝️ Armes secrètes <span class="sub">objectifs cumulés sur toutes tes parties</span></h3>${secrets}</div>
      <div class="sv-box wide"><h3>✨ Évolutions <span class="sub">${(state.evos || []).length} / ${Object.keys(Rules.SURVIVOR_EVOLUTIONS).length} découvertes</span></h3>
        <p class="muted" style="font-size:12px;margin:0 0 8px">Une arme au niveau 8 et son objet : le prochain coffre (élite, boss, trésor gardé ou gardien) la fait évoluer en version surpuissante.</p>
        <div class="sv-evo-grid">${evos}</div></div>
      <div class="sv-box wide"><h3>🗺️ Sur la carte</h3><ul class="sv-howto">
        <li>🌙 <b>Gardiens légendaires</b> : ${GD.count[0]} ou ${GD.count[1]} dorment dans des lieux-dits tirés au hasard. Reste ${GD.wake} s sur leur sceau pour en réveiller un (un seul à la fois). Vaincu : +${GD.emeralds} ${EM} et un coffre de ${GD.chest} améliorations. Éloigne-toi trop et il retourne dormir.</li>
        <li>☠️ <b>Sanctuaires maudits</b> (${Rules.SURVIVOR_CURSE.count} par partie, placés au hasard) : chacun activé rend les monstres +10 % plus forts et plus rapides, mais te donne +10 % d'émeraudes. Cumulables !</li>
        <li>💰 <b>Chariot doré</b> : il passe de temps en temps et te fuit. Détruis-le pour une pluie de gemmes et +${Rules.SURVIVOR_CART.emeralds} ${EM}.</li>
        <li>⏱️ <b>Montre</b> : 10 s de temps ralenti pour les monstres. 💣 <b>Bombe</b> (plus rare) : tous les monstres normaux à l'écran explosent.</li>
        <li>🌙 <b>Nuit</b> : 1 min toutes les 5 min, on y voit moins loin. ⚠️ <b>Encerclement</b> toutes les ${Rules.SURVIVOR_RING.every} vagues. 🛤️ Les <b>routes</b> font aller +${Math.round(SV.roadSpeed * 100)} % plus vite.</li>
      </ul></div>
    </div>`;
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
        <div class="smc-head"><span class="smc-ico">${M.icon === '💎' ? EM : M.icon}</span><b>${M.label}</b></div>
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
      if (Wp.secret && !have) {
        const SE = Rules.SURVIVOR_SECRETS[id];
        const st = (state.secrets || {})[id] || { progress: 0 };
        return `<div class="sv-meta-card unlock secret"><div class="smc-head"><span class="smc-ico">❔</span><b>Arme secrète</b></div>
          <div class="smc-desc">${SE.text} (${st.progress} / ${SE.goal})</div><div class="sv-secret-bar"><i style="width:${Math.round((st.progress / SE.goal) * 100)}%"></i></div></div>`;
      }
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
    $('sv-meta').innerHTML = `<h2>${EM} Méta-progression <span class="sub">${EM} ${fmt(em)} émeraudes</span></h2>
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
