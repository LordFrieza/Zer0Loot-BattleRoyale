/*
 * Décors de l'arène : un par boss (forêt de Grokk, volcan de Pyrax, grotte de Maexxna, blizzard de Givrenoire…) et
 * un par mode (colisée du Tournoi, cour du château de la Guerre des clans, nuage du Golden Shower, sommet du Roi de
 * la Colline). Chargé avant arena.js : window.ArenaThemes = { of(mode, bossId), paint(key, g), under(key, ctx, t),
 * over(key, ctx, t) }.
 *  - paint : le fond fixe (dessiné une fois dans une image en cache, repère 1280 × 720) ;
 *  - under : l'ambiance animée posée sur le fond, sous les combattants (lueurs, brume, foule…) ;
 *  - over : ce qui passe devant les combattants, toujours léger (neige, braises, feuilles…).
 * Les décors restent sombres ou doux au centre : les combattants, les zones d'attaque et les barres de vie doivent
 * rester lisibles. Aucun état : les animations sont des fonctions du temps.
 */
(function () {
  const W = 1280;
  const H = 720;
  const TAU = Math.PI * 2;

  function rng(seed) {
    let s = seed;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  }
  // Pseudo-hasard stable d'un indice (animations sans état)
  const hash = (i, k = 1) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

  function radial(g, inner, outer, stops) {
    const gr = g.createRadialGradient(W / 2, H / 2, inner, W / 2, H / 2, outer);
    stops.forEach(([o, c]) => gr.addColorStop(o, c));
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  }
  function vignette(g, a, inner = 0.4) {
    radial(g, H * inner, W * 0.75, [[0, 'rgba(0,0,0,0)'], [1, `rgba(0,0,0,${a})`]]);
  }
  function blobs(g, rnd, n, color, rMin, rMax, area = null) {
    for (let i = 0; i < n; i++) {
      const x = area ? area.x + rnd() * area.w : rnd() * W;
      const y = area ? area.y + rnd() * area.h : rnd() * H;
      const r = rMin + rnd() * (rMax - rMin);
      g.fillStyle = typeof color === 'function' ? color(rnd) : color;
      g.beginPath(); g.ellipse(x, y, r, r * (0.55 + rnd() * 0.3), rnd() * Math.PI, 0, TAU); g.fill();
    }
  }
  // Position au bord de l'arène (pour les décors qui encadrent la zone de combat)
  function edgeSpot(rnd, margin) {
    const side = Math.floor(rnd() * 4);
    const along = rnd();
    if (side === 0) return { x: along * W, y: rnd() * margin };
    if (side === 1) return { x: along * W, y: H - rnd() * margin };
    if (side === 2) return { x: rnd() * margin, y: along * H };
    return { x: W - rnd() * margin, y: along * H };
  }
  function shadowDisc(g, x, y, rx, ry, a = 0.35) {
    g.fillStyle = `rgba(0,0,0,${a})`;
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill();
  }
  function rock(g, rnd, x, y, r, fill, light) {
    shadowDisc(g, x + r * 0.2, y + r * 0.35, r * 1.1, r * 0.55, 0.4);
    g.fillStyle = fill;
    g.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU;
      const rr = r * (0.75 + rnd() * 0.3);
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.7);
    }
    g.closePath(); g.fill();
    g.fillStyle = light;
    g.beginPath(); g.ellipse(x - r * 0.25, y - r * 0.25, r * 0.4, r * 0.22, -0.4, 0, TAU); g.fill();
  }
  // Toile d'araignée rayonnante (coin ou centre libre)
  function web(g, cx, cy, radius, a0, a1, alpha = 0.28, rings = 6) {
    g.save();
    g.strokeStyle = `rgba(230,235,240,${alpha})`;
    g.lineWidth = 1.1;
    const spokes = 9;
    for (let s = 0; s <= spokes; s++) {
      const a = a0 + (a1 - a0) * (s / spokes);
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius); g.stroke();
    }
    for (let r = 1; r <= rings; r++) {
      const rr = (r / rings) * radius;
      g.beginPath();
      for (let s = 0; s <= spokes; s++) {
        const a = a0 + (a1 - a0) * (s / spokes);
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr;
        if (!s) g.moveTo(px, py);
        else {
          const am = a - (a1 - a0) / spokes / 2;
          g.quadraticCurveTo(cx + Math.cos(am) * rr * 0.86, cy + Math.sin(am) * rr * 0.86, px, py);
        }
      }
      g.stroke();
    }
    g.restore();
  }
  function glow(g, x, y, r, rgb, a) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${rgb},${a})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }

  // ---------- Fonds fixes ----------
  const PAINT = {
    // Grokk le Troll : sous-bois sombre, feuilles mortes, racines, champignons, frondaisons tout autour
    foret(g) {
      const rnd = rng(31);
      radial(g, 80, W * 0.7, [[0, '#2c3d22'], [0.6, '#1c2a16'], [1, '#0e160b']]);
      blobs(g, rnd, 70, (r) => `rgba(${60 + r() * 40},${50 + r() * 30},${25 + r() * 15},.18)`, 30, 90); // terre
      blobs(g, rnd, 60, (r) => `rgba(${50 + r() * 30},${100 + r() * 50},${40 + r() * 20},.16)`, 20, 70); // mousse
      // Racines qui partent des bords
      for (let i = 0; i < 16; i++) {
        const p = edgeSpot(rnd, 10);
        let x = p.x; let y = p.y;
        g.strokeStyle = `rgba(${70 + rnd() * 30},${45 + rnd() * 20},25,.55)`;
        g.lineWidth = 5 + rnd() * 6;
        g.lineCap = 'round';
        g.beginPath(); g.moveTo(x, y);
        const dx = (W / 2 - x) / 6; const dy = (H / 2 - y) / 6;
        for (let k = 0; k < 3; k++) { x += dx * (0.4 + rnd() * 0.5) + (rnd() - 0.5) * 50; y += dy * (0.4 + rnd() * 0.5) + (rnd() - 0.5) * 50; g.lineTo(x, y); g.lineWidth *= 0.7; }
        g.stroke();
      }
      // Feuilles mortes
      for (let i = 0; i < 380; i++) {
        g.save();
        g.translate(rnd() * W, rnd() * H); g.rotate(rnd() * TAU);
        const c = [[196, 110, 40], [150, 90, 40], [120, 130, 50], [170, 60, 30], [90, 110, 45]][Math.floor(rnd() * 5)];
        g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.35 + rnd() * 0.35})`;
        g.beginPath(); g.ellipse(0, 0, 4 + rnd() * 3, 2 + rnd() * 1.5, 0, 0, TAU); g.fill();
        g.restore();
      }
      // Champignons
      for (let i = 0; i < 16; i++) {
        const x = 40 + rnd() * (W - 80); const y = 40 + rnd() * (H - 80);
        if (Math.abs(x - W / 2) < 330 && Math.abs(y - H / 2) < 200) continue;
        shadowDisc(g, x, y + 4, 8, 3);
        g.fillStyle = '#e8dcc0'; g.fillRect(x - 2, y - 4, 4, 8);
        g.fillStyle = rnd() < 0.6 ? '#c0392b' : '#b07a3a';
        g.beginPath(); g.ellipse(x, y - 5, 8, 5, 0, Math.PI, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,.85)';
        g.beginPath(); g.arc(x - 3, y - 7, 1.3, 0, TAU); g.arc(x + 3, y - 6, 1.1, 0, TAU); g.fill();
      }
      // Rochers moussus
      for (let i = 0; i < 9; i++) { const p = edgeSpot(rnd, 120); rock(g, rnd, p.x, p.y, 12 + rnd() * 14, '#4c5446', 'rgba(130,190,90,.35)'); }
      // Taches de soleil
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 9; i++) glow(g, 200 + rnd() * (W - 400), 150 + rnd() * (H - 300), 60 + rnd() * 70, '255,230,150', 0.06);
      g.restore();
      // Frondaisons : grands arbres vus du dessus, tout autour
      for (let i = 0; i < 46; i++) {
        const p = edgeSpot(rnd, 30);
        const r = 45 + rnd() * 45;
        shadowDisc(g, p.x + 18, p.y + 22, r * 1.05, r * 0.9, 0.45);
        for (let k = 0; k < 5; k++) {
          const ox = (rnd() - 0.5) * r; const oy = (rnd() - 0.5) * r;
          const l = 16 + rnd() * 10;
          g.fillStyle = `hsl(${100 + rnd() * 25}, 38%, ${l}%)`;
          g.beginPath(); g.arc(p.x + ox, p.y + oy, r * (0.45 + rnd() * 0.25), 0, TAU); g.fill();
          g.fillStyle = `hsla(${95 + rnd() * 20}, 45%, ${l + 9}%, .7)`;
          g.beginPath(); g.arc(p.x + ox - r * 0.12, p.y + oy - r * 0.12, r * 0.22, 0, TAU); g.fill();
        }
      }
      vignette(g, 0.6);
    },

    // Pyrax le Dragon : basalte fendu, rivières de lave, rochers, cendres
    volcan(g) {
      const rnd = rng(47);
      radial(g, 60, W * 0.7, [[0, '#2a1b16'], [0.65, '#1a100d'], [1, '#090404']]);
      // Dalles de basalte (fissures sombres)
      g.strokeStyle = 'rgba(0,0,0,.55)';
      g.lineWidth = 2;
      for (let i = 0; i < 70; i++) {
        let x = rnd() * W; let y = rnd() * H;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 110; y += (rnd() - 0.5) * 70; g.lineTo(x, y); }
        g.stroke();
      }
      blobs(g, rnd, 50, (r) => `rgba(${70 + r() * 30},${45 + r() * 20},${35 + r() * 10},.18)`, 25, 80);
      // Rivières de lave : coin bas-gauche et coin haut-droit
      const river = (pts, width) => {
        g.save();
        g.lineCap = 'round'; g.lineJoin = 'round';
        const path = () => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length - 1; i++) g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2); g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); };
        g.strokeStyle = '#2a0e05'; g.lineWidth = width + 14; path(); g.stroke(); // croûte
        g.shadowColor = '#ff4a00'; g.shadowBlur = 30;
        g.strokeStyle = '#c2360a'; g.lineWidth = width; path(); g.stroke();
        g.shadowBlur = 0;
        g.strokeStyle = '#ff7a1a'; g.lineWidth = width * 0.6; path(); g.stroke();
        g.strokeStyle = '#ffd36a'; g.lineWidth = width * 0.22; path(); g.stroke();
        g.restore();
      };
      river([[-20, 520], [90, 560], [150, 650], [260, 700], [330, 740]], 34);
      river([[-20, 600], [60, 640], [70, 740]], 18);
      river([[940, -20], [1010, 70], [1120, 110], [1200, 190], [1300, 230]], 32);
      // Fissures de lave dispersées
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 16; i++) {
        let x = rnd() * W; let y = rnd() * H;
        g.strokeStyle = `rgba(255,${80 + rnd() * 70},20,.5)`;
        g.lineWidth = 1.5 + rnd() * 2;
        g.shadowColor = '#ff5a00'; g.shadowBlur = 10;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 70; y += (rnd() - 0.5) * 40; g.lineTo(x, y); }
        g.stroke();
      }
      g.restore();
      // Rochers volcaniques
      for (let i = 0; i < 16; i++) { const p = edgeSpot(rnd, 110); rock(g, rnd, p.x, p.y, 12 + rnd() * 20, '#2e2422', 'rgba(255,120,60,.18)'); }
      // Cendres
      for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${150 + rnd() * 60},${140 + rnd() * 50},${130 + rnd() * 40},${rnd() * 0.18})`; g.fillRect(rnd() * W, rnd() * H, 1.6, 1.6); }
      vignette(g, 0.7);
    },

    // Malvorath : sanctuaire de pierre violette, grand cercle de runes, chandelles
    sanctum(g) {
      const rnd = rng(59);
      g.fillStyle = '#140f20'; g.fillRect(0, 0, W, H);
      // Dallage
      const tile = 72;
      for (let y = 0, row = 0; y < H; y += tile, row++) {
        for (let x = row % 2 ? -tile / 2 : 0; x < W; x += tile) {
          g.fillStyle = `hsl(${262 + rnd() * 16}, 18%, ${10 + rnd() * 5}%)`;
          g.fillRect(x + 2, y + 2, tile - 4, tile - 4);
          g.fillStyle = 'rgba(255,255,255,.03)'; g.fillRect(x + 2, y + 2, tile - 4, 3);
          if (rnd() < 0.15) { g.strokeStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.moveTo(x + 10, y + 8); g.lineTo(x + tile * 0.5, y + tile * 0.6); g.lineTo(x + tile - 12, y + tile - 8); g.stroke(); }
        }
      }
      // Grand cercle de runes au centre
      const cx = W / 2; const cy = H / 2;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.shadowColor = '#9b59ff'; g.shadowBlur = 16;
      g.strokeStyle = 'rgba(155,89,255,.45)';
      for (const [r, w] of [[300, 3], [282, 1.5], [215, 2], [120, 2]]) { g.lineWidth = w; g.beginPath(); g.ellipse(cx, cy, r, r * 0.62, 0, 0, TAU); g.stroke(); }
      // Étoile à sept branches
      g.lineWidth = 2;
      g.beginPath();
      for (let k = 0; k <= 7; k++) {
        const a = -Math.PI / 2 + (k * 3 * TAU) / 7;
        const px = cx + Math.cos(a) * 215; const py = cy + Math.sin(a) * 215 * 0.62;
        if (!k) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
      // Runes entre les deux anneaux extérieurs
      g.fillStyle = 'rgba(190,140,255,.55)';
      g.font = '18px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * TAU;
        g.fillText(runes[k % runes.length], cx + Math.cos(a) * 258, cy + Math.sin(a) * 258 * 0.62);
      }
      g.restore();
      // Chandeliers et livres dans les coins
      for (const [x, y] of [[70, 80], [1210, 80], [70, 640], [1210, 640], [380, 40], [900, 40], [380, 690], [900, 690]]) {
        shadowDisc(g, x, y + 10, 26, 8, 0.5);
        for (let k = 0; k < 4; k++) {
          const px = x + (k - 1.5) * 10; const h = 14 + (k % 2) * 8;
          g.fillStyle = '#d8cbb0'; g.fillRect(px - 3, y - h, 6, h);
          g.fillStyle = 'rgba(216,203,176,.6)'; g.beginPath(); g.ellipse(px, y, 5, 2.5, 0, 0, TAU); g.fill();
        }
      }
      for (let i = 0; i < 10; i++) {
        const p = edgeSpot(rnd, 70);
        g.save(); g.translate(p.x, p.y); g.rotate(rnd() * TAU);
        g.fillStyle = ['#5a2a6a', '#2a3a6a', '#6a2a2a', '#2a5a3a'][i % 4]; g.fillRect(-12, -8, 24, 16);
        g.fillStyle = '#e8dcc0'; g.fillRect(-10, -6, 20, 2);
        g.restore();
      }
      vignette(g, 0.75);
    },

    // Grignotor le Mimic : salle au trésor, parquet, tapis rouge, montagnes d'or et coffres
    tresor(g) {
      const rnd = rng(71);
      g.fillStyle = '#2c1b0e'; g.fillRect(0, 0, W, H);
      // Parquet
      for (let y = 0; y < H; y += 30) {
        let x = -rnd() * 120;
        while (x < W) {
          const w = 110 + rnd() * 90;
          g.fillStyle = `hsl(${26 + rnd() * 8}, ${40 + rnd() * 10}%, ${15 + rnd() * 6}%)`;
          g.fillRect(x + 1, y + 1, w - 2, 28);
          g.strokeStyle = 'rgba(0,0,0,.18)';
          g.beginPath(); g.moveTo(x + 6, y + 10 + rnd() * 8); g.bezierCurveTo(x + w * 0.3, y + 6, x + w * 0.6, y + 22, x + w - 6, y + 12); g.stroke();
          x += w;
        }
      }
      // Tapis rouge au centre, bordé d'or
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, H / 2 - 96, W, 196);
      g.fillStyle = '#6e1420'; g.fillRect(0, H / 2 - 92, W, 184);
      g.fillStyle = '#d4a035'; g.fillRect(0, H / 2 - 92, W, 6); g.fillRect(0, H / 2 + 86, W, 6);
      g.strokeStyle = 'rgba(212,160,53,.35)'; g.lineWidth = 2;
      for (let x = 30; x < W; x += 80) { g.beginPath(); g.moveTo(x, H / 2); g.lineTo(x + 20, H / 2 - 28); g.lineTo(x + 40, H / 2); g.lineTo(x + 20, H / 2 + 28); g.closePath(); g.stroke(); }
      // Pièces éparpillées
      for (let i = 0; i < 160; i++) {
        const x = rnd() * W; const y = rnd() * H;
        g.fillStyle = `rgba(${220 + rnd() * 30},${170 + rnd() * 40},40,${0.45 + rnd() * 0.4})`;
        g.beginPath(); g.ellipse(x, y, 4, 2.6, 0, 0, TAU); g.fill();
      }
      // Montagnes d'or dans les coins et sur les bords
      const pile = (x, y, r) => {
        shadowDisc(g, x + 6, y + r * 0.35, r * 1.2, r * 0.45, 0.45);
        for (let i = 0; i < r * 5; i++) {
          const a = rnd() * TAU; const d = Math.sqrt(rnd()) * r;
          const px = x + Math.cos(a) * d; const py = y + Math.sin(a) * d * 0.5 - (r - d) * 0.6;
          g.fillStyle = `hsl(${42 + rnd() * 8}, ${80 + rnd() * 15}%, ${42 + rnd() * 18}%)`;
          g.beginPath(); g.ellipse(px, py, 5, 3.2, 0, 0, TAU); g.fill();
        }
        for (let k = 0; k < 3; k++) {
          const gx = x + (rnd() - 0.5) * r; const gy = y - rnd() * r * 0.5;
          g.fillStyle = ['#ff4d6d', '#3fa0ff', '#3ddc5a', '#b14dff'][Math.floor(rnd() * 4)];
          g.beginPath(); g.moveTo(gx, gy - 6); g.lineTo(gx + 5, gy); g.lineTo(gx, gy + 6); g.lineTo(gx - 5, gy); g.closePath(); g.fill();
        }
      };
      for (const [x, y, r] of [[70, 70, 60], [1210, 70, 64], [80, 650, 66], [1200, 650, 60], [640, 40, 44], [640, 690, 40], [340, 30, 34], [940, 690, 36]]) pile(x, y, r);
      // Coffres
      const chest = (x, y, s) => {
        g.save(); g.translate(x, y); g.scale(s, s);
        shadowDisc(g, 0, 12, 20, 5, 0.45);
        g.fillStyle = '#8a4f24'; g.fillRect(-16, -4, 32, 15);
        g.fillStyle = '#b56d38'; g.beginPath(); g.moveTo(-16, -4); g.quadraticCurveTo(0, -18, 16, -4); g.closePath(); g.fill();
        g.fillStyle = '#f2c94c'; g.fillRect(-16, -6, 32, 3); g.fillRect(-12, -14, 4, 25); g.fillRect(8, -14, 4, 25); g.fillRect(-3, -4, 6, 7);
        g.restore();
      };
      for (const [x, y] of [[180, 60], [1100, 60], [190, 660], [1090, 660], [40, 360], [1240, 360]]) chest(x, y, 1.3);
      vignette(g, 0.62);
    },

    // Givrenoire la Liche : champ de neige, mare gelée, sapins enneigés
    neige(g) {
      const rnd = rng(83);
      radial(g, 60, W * 0.72, [[0, '#a6b8cc'], [0.6, '#8296ae'], [1, '#4a5a72']]);
      blobs(g, rnd, 80, (r) => `rgba(255,255,255,${0.06 + r() * 0.1})`, 30, 110); // congères
      blobs(g, rnd, 40, (r) => `rgba(60,80,110,${0.05 + r() * 0.06})`, 20, 70); // ombres de neige
      // Mares gelées
      for (const [x, y, rx, ry] of [[290, 470, 120, 50], [960, 230, 110, 46]]) {
        g.fillStyle = 'rgba(160,215,245,.45)'; g.beginPath(); g.ellipse(x, y, rx, ry, -0.1, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; g.stroke();
        g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1;
        for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(x + (rnd() - 0.5) * rx, y + (rnd() - 0.5) * ry); g.lineTo(x + (rnd() - 0.5) * rx * 1.4, y + (rnd() - 0.5) * ry * 1.2); g.stroke(); }
        g.fillStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.ellipse(x - rx * 0.35, y - ry * 0.3, rx * 0.3, ry * 0.15, -0.2, 0, TAU); g.fill();
      }
      // Traces de pas
      for (let i = 0; i < 2; i++) {
        let x = 100 + rnd() * 300; let y = 100 + rnd() * 500;
        for (let k = 0; k < 18; k++) { g.fillStyle = 'rgba(70,90,120,.25)'; g.beginPath(); g.ellipse(x + (k % 2) * 10, y, 4, 2.4, 0, 0, TAU); g.fill(); x += 34; y += (rnd() - 0.5) * 12; }
      }
      // Cristaux de glace
      for (let i = 0; i < 12; i++) {
        const p = edgeSpot(rnd, 140);
        g.save(); g.translate(p.x, p.y);
        for (let k = 0; k < 3; k++) {
          g.fillStyle = `rgba(${170 + rnd() * 60},${225 + rnd() * 30},255,.8)`;
          g.beginPath(); g.moveTo(-5 + k * 6, 6); g.lineTo(-2 + k * 6, -14 - rnd() * 12); g.lineTo(1 + k * 6, 6); g.closePath(); g.fill();
        }
        g.restore();
      }
      // Sapins enneigés vus du dessus, tout autour
      for (let i = 0; i < 40; i++) {
        const p = edgeSpot(rnd, 26);
        const r = 30 + rnd() * 26;
        shadowDisc(g, p.x + 16, p.y + 18, r, r * 0.8, 0.3);
        for (let layer = 0; layer < 3; layer++) {
          const rr = r * (1 - layer * 0.28);
          g.fillStyle = `hsl(${150 + rnd() * 10}, 25%, ${15 + layer * 5}%)`;
          g.beginPath();
          for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU + layer * 0.2; const d = k % 2 ? rr * 0.72 : rr; g.lineTo(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d); }
          g.closePath(); g.fill();
          g.fillStyle = 'rgba(240,248,255,.75)';
          g.beginPath(); g.arc(p.x - rr * 0.25, p.y - rr * 0.25, rr * 0.38, 0, TAU); g.fill();
        }
      }
      vignette(g, 0.45);
    },

    // Maexxna : grotte sombre couverte de toiles, stalagmites, cocons
    grotte(g) {
      const rnd = rng(97);
      radial(g, 60, W * 0.7, [[0, '#211c26'], [0.6, '#15111a'], [1, '#060408']]);
      blobs(g, rnd, 90, (r) => `rgba(${40 + r() * 25},${35 + r() * 20},${45 + r() * 25},.25)`, 20, 80);
      // Flaques
      for (let i = 0; i < 6; i++) { const x = 150 + rnd() * (W - 300); const y = 120 + rnd() * (H - 240); g.fillStyle = 'rgba(60,90,110,.25)'; g.beginPath(); g.ellipse(x, y, 30 + rnd() * 40, 10 + rnd() * 12, 0, 0, TAU); g.fill(); g.fillStyle = 'rgba(180,220,255,.12)'; g.beginPath(); g.ellipse(x - 8, y - 3, 10, 2, 0, 0, TAU); g.fill(); }
      // Ossements
      for (let i = 0; i < 16; i++) {
        const x = rnd() * W; const y = rnd() * H;
        g.save(); g.translate(x, y); g.rotate(rnd() * Math.PI);
        g.fillStyle = 'rgba(210,200,180,.4)'; g.fillRect(-8, -1.5, 16, 3);
        g.beginPath(); g.arc(-8, 0, 2.6, 0, TAU); g.arc(8, 0, 2.6, 0, TAU); g.fill();
        g.restore();
      }
      // Stalagmites
      for (let i = 0; i < 22; i++) {
        const p = edgeSpot(rnd, 90);
        const r = 10 + rnd() * 18;
        shadowDisc(g, p.x + 8, p.y + 8, r * 1.2, r * 0.8, 0.5);
        const gr = g.createRadialGradient(p.x - r * 0.3, p.y - r * 0.3, 1, p.x, p.y, r);
        gr.addColorStop(0, '#7a6e80'); gr.addColorStop(1, '#2e2733');
        g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.fill();
      }
      // Grandes toiles dans les coins, toiles le long des bords
      web(g, 0, 0, 300, 0, Math.PI / 2, 0.3, 8);
      web(g, W, 0, 300, Math.PI / 2, Math.PI, 0.3, 8);
      web(g, 0, H, 260, -Math.PI / 2, 0, 0.26, 7);
      web(g, W, H, 260, Math.PI, Math.PI * 1.5, 0.26, 7);
      web(g, W / 2, 0, 170, 0.2, Math.PI - 0.2, 0.2, 5);
      for (let i = 0; i < 7; i++) { const x = 120 + rnd() * (W - 240); const y = 100 + rnd() * (H - 200); if (Math.abs(x - W / 2) < 250 && Math.abs(y - H / 2) < 150) continue; web(g, x, y, 34 + rnd() * 26, 0, TAU, 0.14, 4); }
      // Fils tendus en travers des bords
      g.strokeStyle = 'rgba(230,235,240,.18)'; g.lineWidth = 1;
      for (let i = 0; i < 14; i++) { const a = edgeSpot(rnd, 5); const b = edgeSpot(rnd, 5); g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo(W / 2 + (rnd() - 0.5) * 500, H / 2 + (rnd() - 0.5) * 300, b.x, b.y); g.stroke(); }
      // Cocons et sacs d'œufs dans les toiles
      for (const [x, y, a] of [[130, 120, 0.6], [1150, 120, -0.6], [220, 60, 0.2], [1050, 70, -0.3], [110, 610, -0.5], [1170, 600, 0.5]]) {
        g.save(); g.translate(x, y); g.rotate(a);
        shadowDisc(g, 4, 6, 14, 22, 0.35);
        g.fillStyle = '#e6e2d8'; g.beginPath(); g.ellipse(0, 0, 11, 20, 0, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(150,140,130,.6)'; g.lineWidth = 1;
        for (let k = -16; k < 18; k += 5) { g.beginPath(); g.moveTo(-10, k); g.quadraticCurveTo(0, k + 4, 10, k - 2); g.stroke(); }
        g.restore();
      }
      vignette(g, 0.8, 0.32);
    },

    // Ether le Fantôme : cimetière dans la brume, tombes, arbres morts, grille
    cimetiere(g) {
      const rnd = rng(113);
      radial(g, 60, W * 0.7, [[0, '#1b2b2e'], [0.6, '#122023'], [1, '#05090b']]);
      blobs(g, rnd, 70, (r) => `rgba(${40 + r() * 20},${60 + r() * 25},${55 + r() * 20},.18)`, 25, 80);
      for (let i = 0; i < 260; i++) {
        const x = rnd() * W; const y = rnd() * H;
        g.strokeStyle = `rgba(110,${130 + rnd() * 30},120,.25)`;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - 3, y - 6); g.moveTo(x, y); g.lineTo(x + 2, y - 7); g.stroke();
      }
      // Allée de pierres
      for (let x = 30; x < W; x += 46) { const y = H / 2 + Math.sin(x / 160) * 30; g.fillStyle = 'rgba(120,130,135,.18)'; g.beginPath(); g.ellipse(x, y, 16, 9, 0, 0, TAU); g.fill(); }
      // Tombes
      const tomb = (x, y, s, kind) => {
        g.save(); g.translate(x, y); g.scale(s, s); g.rotate((rnd() - 0.5) * 0.25);
        shadowDisc(g, 6, 14, 20, 6, 0.45);
        g.fillStyle = '#5c6668';
        if (kind === 0) { g.beginPath(); g.moveTo(-12, 12); g.lineTo(-12, -6); g.arc(0, -6, 12, Math.PI, TAU); g.lineTo(12, 12); g.closePath(); g.fill(); }
        else if (kind === 1) { g.fillRect(-3, -20, 6, 32); g.fillRect(-11, -12, 22, 6); }
        else { g.fillRect(-14, -4, 28, 16); }
        g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(-10, -4, 3, 14);
        g.fillStyle = 'rgba(40,50,52,.8)'; if (kind === 0) g.fillRect(-6, -4, 12, 2);
        g.fillStyle = 'rgba(90,140,90,.35)'; g.beginPath(); g.ellipse(-4, 12, 9, 3, 0, 0, TAU); g.fill();
        g.restore();
      };
      for (let i = 0; i < 30; i++) { const p = edgeSpot(rnd, 120); tomb(p.x, p.y, 1 + rnd() * 0.5, Math.floor(rnd() * 3)); }
      // Arbres morts dans les coins
      const deadTree = (x, y, len, ang, depth) => {
        if (depth <= 0) return;
        const x2 = x + Math.cos(ang) * len; const y2 = y + Math.sin(ang) * len;
        g.strokeStyle = '#0b0f10'; g.lineWidth = depth * 1.6; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
        deadTree(x2, y2, len * 0.72, ang - 0.5 + rnd() * 0.2, depth - 1);
        deadTree(x2, y2, len * 0.68, ang + 0.45 + rnd() * 0.2, depth - 1);
      };
      deadTree(40, 40, 70, 0.6, 5); deadTree(W - 40, 30, 70, Math.PI - 0.6, 5); deadTree(50, H - 30, 60, -0.7, 5); deadTree(W - 50, H - 40, 64, Math.PI + 0.7, 5);
      // Grille en fer forgé le long du haut
      g.strokeStyle = 'rgba(15,20,22,.9)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, 22); g.lineTo(W, 22); g.stroke();
      for (let x = 8; x < W; x += 18) { g.beginPath(); g.moveTo(x, 34); g.lineTo(x, 4); g.stroke(); g.fillStyle = 'rgba(15,20,22,.9)'; g.beginPath(); g.moveTo(x - 4, 6); g.lineTo(x, -2); g.lineTo(x + 4, 6); g.fill(); }
      vignette(g, 0.75);
    },

    // Lilith le Chat : scène de théâtre de magie, rideaux rouges, planches, cartes à jouer
    theatre(g) {
      const rnd = rng(127);
      g.fillStyle = '#2a170c'; g.fillRect(0, 0, W, H);
      // Planches de la scène
      for (let x = 0; x < W; x += 64) {
        g.fillStyle = `hsl(${24 + rnd() * 8}, 45%, ${17 + rnd() * 5}%)`;
        g.fillRect(x + 1, 0, 62, H);
        g.strokeStyle = 'rgba(0,0,0,.25)';
        for (let y = rnd() * 200; y < H; y += 180 + rnd() * 120) { g.beginPath(); g.moveTo(x + 1, y); g.lineTo(x + 63, y); g.stroke(); }
        g.strokeStyle = 'rgba(255,220,170,.05)'; g.beginPath(); g.moveTo(x + 6, 0); g.lineTo(x + 6, H); g.stroke();
      }
      // Étoile du magicien au centre
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = 'rgba(255,200,120,.25)'; g.lineWidth = 3;
      g.beginPath(); g.ellipse(W / 2, H / 2, 230, 140, 0, 0, TAU); g.stroke();
      // Étoile du magicien à huit branches, et sa couronne de petites étoiles
      g.beginPath();
      for (let k = 0; k <= 16; k++) { const a = -Math.PI / 2 + (k / 16) * TAU; const d = k % 2 ? 0.42 : 1; const px = W / 2 + Math.cos(a) * 190 * d; const py = H / 2 + Math.sin(a) * 115 * d; if (!k) g.moveTo(px, py); else g.lineTo(px, py); }
      g.stroke();
      g.fillStyle = 'rgba(255,210,140,.25)'; g.font = '16px "Segoe UI Symbol", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; g.fillText('★', W / 2 + Math.cos(a) * 256, H / 2 + Math.sin(a) * 158); }
      g.restore();
      // Cartes à jouer éparpillées
      for (let i = 0; i < 26; i++) {
        const x = 90 + rnd() * (W - 180); const y = 80 + rnd() * (H - 160);
        g.save(); g.translate(x, y); g.rotate(rnd() * TAU);
        g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(-7, -9, 16, 22);
        g.fillStyle = '#f2ece0'; g.fillRect(-8, -11, 16, 22);
        const red = rnd() < 0.5;
        g.fillStyle = red ? '#c0203a' : '#1a1a22';
        g.font = '11px "Segoe UI Symbol", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(red ? (rnd() < 0.5 ? '♥' : '♦') : (rnd() < 0.5 ? '♠' : '♣'), 0, 0);
        g.restore();
      }
      // Rideaux rouges à gauche et à droite
      const curtain = (x0, dir) => {
        for (let k = 0; k < 7; k++) {
          const x = x0 + dir * k * 14;
          const gr = g.createLinearGradient(x, 0, x + dir * 14, 0);
          gr.addColorStop(0, '#5a0a14'); gr.addColorStop(0.5, '#a3162a'); gr.addColorStop(1, '#5a0a14');
          g.fillStyle = gr;
          g.beginPath(); g.moveTo(x, 0); g.lineTo(x + dir * 14, 0); g.lineTo(x + dir * (14 - k * 1.2), H); g.lineTo(x - dir * k * 1.2, H); g.closePath(); g.fill();
        }
        g.fillStyle = '#d4a035';
        g.fillRect(dir > 0 ? x0 + 70 : x0 - 76, H * 0.55, 6, 22); // embrasse dorée
      };
      curtain(0, 1);
      curtain(W, -1);
      // Lambrequin en haut, frange dorée
      for (let x = 0; x < W; x += 80) {
        g.fillStyle = '#8a1022';
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 80, 0); g.lineTo(x + 80, 26); g.quadraticCurveTo(x + 40, 52, x, 26); g.closePath(); g.fill();
      }
      g.fillStyle = '#d4a035';
      for (let x = 0; x < W; x += 80) { g.beginPath(); g.moveTo(x, 26); g.quadraticCurveTo(x + 40, 52, x + 80, 26); g.lineTo(x + 80, 30); g.quadraticCurveTo(x + 40, 56, x, 30); g.closePath(); g.fill(); }
      // Rampe de lumières en bas
      g.fillStyle = '#1a0f08'; g.fillRect(0, H - 16, W, 16);
      for (let x = 40; x < W; x += 60) { glow(g, x, H - 8, 26, '255,210,120', 0.35); g.fillStyle = '#ffe9b0'; g.beginPath(); g.arc(x, H - 8, 4, 0, TAU); g.fill(); }
      vignette(g, 0.6);
    },

    // Daedra la Succube : enfer d'obsidienne, pentacle, chaînes, braseros
    enfer(g) {
      const rnd = rng(139);
      radial(g, 60, W * 0.7, [[0, '#2a0a0e'], [0.6, '#1a0508'], [1, '#070102']]);
      // Dalles d'obsidienne aux joints rougeoyants
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 60; i++) {
        let x = rnd() * W; let y = rnd() * H;
        g.strokeStyle = `rgba(255,${30 + rnd() * 40},${30 + rnd() * 30},.35)`;
        g.lineWidth = 1 + rnd() * 1.5; g.shadowColor = '#ff2040'; g.shadowBlur = 8;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 3; k++) { x += (rnd() - 0.5) * 120; y += (rnd() - 0.5) * 70; g.lineTo(x, y); }
        g.stroke();
      }
      // Grand pentacle au centre
      g.shadowBlur = 18; g.shadowColor = '#ff2a4a';
      g.strokeStyle = 'rgba(255,50,80,.45)';
      g.lineWidth = 3; g.beginPath(); g.ellipse(W / 2, H / 2, 260, 165, 0, 0, TAU); g.stroke();
      g.lineWidth = 1.5; g.beginPath(); g.ellipse(W / 2, H / 2, 240, 150, 0, 0, TAU); g.stroke();
      g.lineWidth = 2.5; g.beginPath();
      for (let k = 0; k <= 5; k++) { const a = Math.PI / 2 + (k * 2 * TAU) / 5; const px = W / 2 + Math.cos(a) * 240; const py = H / 2 + Math.sin(a) * 150; if (!k) g.moveTo(px, py); else g.lineTo(px, py); }
      g.stroke();
      g.restore();
      // Crânes et ossements
      for (let i = 0; i < 18; i++) {
        const p = edgeSpot(rnd, 140);
        g.fillStyle = 'rgba(210,190,170,.45)';
        g.beginPath(); g.arc(p.x, p.y, 6, 0, TAU); g.fill(); g.fillRect(p.x - 4, p.y + 3, 8, 4);
        g.fillStyle = 'rgba(20,0,0,.8)'; g.beginPath(); g.arc(p.x - 2.2, p.y, 1.5, 0, TAU); g.arc(p.x + 2.2, p.y, 1.5, 0, TAU); g.fill();
      }
      // Chaînes tendues aux bords
      g.strokeStyle = 'rgba(70,60,62,.9)'; g.lineWidth = 2;
      for (const [x1, y1, x2, y2] of [[0, 140, 200, 0], [W, 140, W - 200, 0], [0, H - 140, 200, H], [W, H - 140, W - 200, H]]) {
        const n = 12;
        for (let k = 0; k < n; k++) {
          const t = k / n; const sag = Math.sin(t * Math.PI) * 26;
          const x = x1 + (x2 - x1) * t + sag * 0.6; const y = y1 + (y2 - y1) * t + sag;
          g.beginPath(); g.ellipse(x, y, 7, 4, Math.atan2(y2 - y1, x2 - x1) + (k % 2 ? 0 : Math.PI / 2) * 0.3, 0, TAU); g.stroke();
        }
      }
      // Braseros (pierre) aux quatre coins et en haut / bas
      for (const [x, y] of [[60, 60], [W - 60, 60], [60, H - 60], [W - 60, H - 60], [W / 2, 30], [W / 2, H - 30]]) {
        shadowDisc(g, x + 4, y + 10, 26, 9, 0.5);
        g.fillStyle = '#2a2224'; g.beginPath(); g.arc(x, y, 18, 0, TAU); g.fill();
        g.fillStyle = '#120a0b'; g.beginPath(); g.arc(x, y, 12, 0, TAU); g.fill();
      }
      vignette(g, 0.75);
    },

    // Tournoi : colisée — piste de sable ovale, muret, gradins pleins de spectateurs
    colisee(g) {
      const rnd = rng(151);
      const cx = W / 2; const cy = H / 2 + 10; const rx = 700; const ry = 430;
      // Gradins (anneaux concentriques en dehors de l'ovale)
      g.fillStyle = '#3a3029'; g.fillRect(0, 0, W, H);
      for (let k = 7; k >= 0; k--) {
        g.fillStyle = k % 2 ? '#5b4c3e' : '#4d4034';
        g.beginPath(); g.ellipse(cx, cy, rx + 30 + k * 26, ry + 30 + k * 22, 0, 0, TAU); g.fill();
        // Spectateurs (têtes colorées)
        const R1 = rx + 30 + k * 26 - 13; const R2 = ry + 30 + k * 22 - 11;
        for (let a = 0; a < TAU; a += 0.012 + rnd() * 0.01) {
          const x = cx + Math.cos(a) * R1; const y = cy + Math.sin(a) * R2;
          if (x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;
          g.fillStyle = `hsl(${rnd() * 360}, ${45 + rnd() * 30}%, ${40 + rnd() * 25}%)`;
          g.beginPath(); g.arc(x, y + 3, 5, 0, TAU); g.fill();
          g.fillStyle = ['#f5d3b8', '#d9a47a', '#a8714a', '#6e4630'][Math.floor(rnd() * 4)];
          g.beginPath(); g.arc(x, y - 3, 3.4, 0, TAU); g.fill();
        }
      }
      // Muret de l'arène
      g.fillStyle = '#8c7a66'; g.beginPath(); g.ellipse(cx, cy, rx + 26, ry + 26, 0, 0, TAU); g.fill();
      g.fillStyle = '#6a5a4a'; g.beginPath(); g.ellipse(cx, cy, rx + 12, ry + 12, 0, 0, TAU); g.fill();
      // Piste de sable
      const sand = g.createRadialGradient(cx, cy, 60, cx, cy, rx);
      sand.addColorStop(0, '#a88456'); sand.addColorStop(0.7, '#8d6b43'); sand.addColorStop(1, '#6e5233');
      g.fillStyle = sand; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.fill();
      g.save();
      g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.clip();
      for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '60,40,20' : '230,200,150'},${rnd() * 0.18})`; g.fillRect(rnd() * W, rnd() * H, 2, 2); }
      // Traces de râteau
      g.strokeStyle = 'rgba(70,50,28,.18)'; g.lineWidth = 1.5;
      for (let k = 1; k < 9; k++) { g.beginPath(); g.ellipse(cx, cy, rx * k / 9, ry * k / 9, 0, 0, TAU); g.stroke(); }
      // Emblème : lauriers autour d'un cercle
      g.strokeStyle = 'rgba(255,215,140,.22)'; g.lineWidth = 3;
      g.beginPath(); g.ellipse(cx, cy, 120, 74, 0, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(255,215,140,.16)';
      for (const side of [-1, 1]) {
        for (let k = 0; k < 9; k++) {
          const a = Math.PI / 2 + side * (0.35 + k * 0.28);
          const x = cx + Math.cos(a) * 140; const y = cy + Math.sin(a) * 88;
          g.save(); g.translate(x, y); g.rotate(a + side * 0.6); g.beginPath(); g.ellipse(0, 0, 11, 4.5, 0, 0, TAU); g.fill(); g.restore();
        }
      }
      g.restore();
      // Ombre du muret sur le sable
      const sh = g.createRadialGradient(cx, cy, ry * 0.8, cx, cy, rx);
      sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.35)');
      g.save(); g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.clip(); g.fillStyle = sh; g.fillRect(0, 0, W, H); g.restore();
      // Colonnes et étendards dans les coins
      for (const [x, y] of [[40, 40], [W - 40, 40], [40, H - 40], [W - 40, H - 40]]) {
        shadowDisc(g, x + 6, y + 8, 26, 10, 0.5);
        g.fillStyle = '#d8ccb8'; g.beginPath(); g.arc(x, y, 20, 0, TAU); g.fill();
        g.fillStyle = '#b8aa94'; g.beginPath(); g.arc(x, y, 14, 0, TAU); g.fill();
      }
      vignette(g, 0.45);
    },

    // Guerre des clans : cour du château — pavés, remparts crénelés, tours, bannières rouges et bleues
    chateau(g) {
      const rnd = rng(163);
      g.fillStyle = '#34343c'; g.fillRect(0, 0, W, H);
      // Pavés
      for (let y = 0; y < H; y += 22) {
        for (let x = (y / 22) % 2 ? -14 : 0; x < W; x += 28) {
          const l = 26 + rnd() * 10;
          g.fillStyle = `hsl(${220 + rnd() * 30}, 6%, ${l}%)`;
          g.beginPath(); g.ellipse(x + 14 + (rnd() - 0.5) * 3, y + 11, 12, 9, 0, 0, TAU); g.fill();
          g.fillStyle = 'rgba(255,255,255,.05)'; g.beginPath(); g.ellipse(x + 11, y + 8, 6, 3, 0, 0, TAU); g.fill();
        }
      }
      blobs(g, rnd, 26, 'rgba(90,120,70,.18)', 10, 30); // mousse entre les pavés
      // Allée centrale de dalles
      g.fillStyle = 'rgba(160,150,135,.18)'; g.fillRect(W / 2 - 50, 60, 100, H - 60);
      // Rempart du haut, crénelé, avec la porte
      g.fillStyle = '#4c4a52'; g.fillRect(0, 0, W, 54);
      for (let x = 0; x < W; x += 40) { g.fillStyle = '#5c5a64'; g.fillRect(x + 4, 0, 24, 18); }
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 54, W, 10);
      g.fillStyle = '#1a1416'; g.beginPath(); g.moveTo(W / 2 - 50, 54); g.lineTo(W / 2 - 50, 20); g.arc(W / 2, 20, 50, Math.PI, TAU); g.lineTo(W / 2 + 50, 54); g.fill();
      g.strokeStyle = '#3a2a1a'; g.lineWidth = 3;
      for (let x = W / 2 - 40; x <= W / 2 + 40; x += 16) { g.beginPath(); g.moveTo(x, 54); g.lineTo(x, 0); g.stroke(); } // herse
      // Bannières : rouges à gauche, bleues à droite
      for (let i = 0; i < 6; i++) {
        for (const [col, dark, x0] of [['#c0203a', '#7a1020', 90], ['#2d6fd6', '#16408a', W / 2 + 140]]) {
          const x = x0 + i * 72;
          if (x > W - 70) continue;
          g.fillStyle = dark; g.fillRect(x - 1, 8, 30, 3);
          g.fillStyle = col; g.beginPath(); g.moveTo(x, 10); g.lineTo(x + 28, 10); g.lineTo(x + 28, 58); g.lineTo(x + 14, 48); g.lineTo(x, 58); g.closePath(); g.fill();
          g.fillStyle = 'rgba(255,215,120,.85)'; g.beginPath(); g.arc(x + 14, 28, 5, 0, TAU); g.fill();
        }
      }
      // Tours rondes aux coins (vues du dessus)
      for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
        g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.arc(x + 8, y + 10, 92, 0, TAU); g.fill();
        g.fillStyle = '#56545e'; g.beginPath(); g.arc(x, y, 86, 0, TAU); g.fill();
        g.fillStyle = '#3c3a42'; g.beginPath(); g.arc(x, y, 66, 0, TAU); g.fill();
        for (let k = 0; k < 20; k++) { const a = (k / 20) * TAU; g.fillStyle = '#6a6872'; g.fillRect(x + Math.cos(a) * 74 - 6, y + Math.sin(a) * 74 - 6, 12, 12); }
      }
      // Tonneaux et bottes de foin
      for (const [x, y, kind] of [[150, 650, 0], [190, 670, 0], [1100, 640, 1], [1140, 670, 0], [40, 360, 1], [1240, 330, 1], [330, 690, 1], [960, 700, 0]]) {
        shadowDisc(g, x + 4, y + 8, 16, 7, 0.45);
        if (kind === 0) { g.fillStyle = '#7a4a24'; g.beginPath(); g.arc(x, y, 13, 0, TAU); g.fill(); g.strokeStyle = '#3a2a1a'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 9, 0, TAU); g.stroke(); }
        else { g.fillStyle = '#c9a34a'; g.fillRect(x - 18, y - 10, 36, 20); g.strokeStyle = 'rgba(120,90,30,.7)'; g.beginPath(); g.moveTo(x - 6, y - 10); g.lineTo(x - 6, y + 10); g.moveTo(x + 6, y - 10); g.lineTo(x + 6, y + 10); g.stroke(); }
      }
      vignette(g, 0.55);
    },

    // Golden Shower : zone secrète dans le ciel — dégradé bleu, arc-en-ciel, soleil, sol de nuages
    nuage(g) {
      const rnd = rng(177);
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#3b82d8'); sky.addColorStop(0.5, '#69aee8'); sky.addColorStop(1, '#9fd0f2');
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      glow(g, W - 140, 80, 260, '255,240,180', 0.55); // soleil
      g.fillStyle = '#fff6c8'; g.beginPath(); g.arc(W - 140, 80, 46, 0, TAU); g.fill();
      // Arc-en-ciel
      g.save(); g.globalAlpha = 0.35;
      ['#ff4d4d', '#ff9a3c', '#ffe04d', '#5fd36a', '#4da6ff', '#8a5cff'].forEach((c, i) => {
        g.strokeStyle = c; g.lineWidth = 12;
        g.beginPath(); g.arc(W * 0.32, H * 0.95, 620 - i * 12, Math.PI * 1.08, Math.PI * 1.75); g.stroke();
      });
      g.restore();
      // Petits nuages lointains
      for (let i = 0; i < 14; i++) {
        const x = rnd() * W; const y = 20 + rnd() * 140; const s = 0.4 + rnd() * 0.5;
        g.fillStyle = 'rgba(255,255,255,.55)';
        for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(x + k * 26 * s, y + (k % 2) * -8 * s, 22 * s, 0, TAU); g.fill(); }
      }
      // Le sol : un grand banc de nuages (bosselé en haut), ombré vers le bas
      const top = 150;
      const bank = g.createLinearGradient(0, top, 0, H);
      bank.addColorStop(0, '#e4edf9'); bank.addColorStop(0.5, '#cbdcf0'); bank.addColorStop(1, '#a9c2e2');
      g.fillStyle = bank;
      g.beginPath(); g.moveTo(0, H); g.lineTo(0, top + 30);
      for (let x = 0; x <= W + 60; x += 60) g.quadraticCurveTo(x + 30, top - 28 + rnd() * 20, x + 60, top + 20 + rnd() * 20);
      g.lineTo(W, H); g.closePath(); g.fill();
      // Boursouflures du nuage (ombres et reflets doux)
      for (let i = 0; i < 120; i++) {
        const x = rnd() * W; const y = top + 30 + rnd() * (H - top - 30); const r = 24 + rnd() * 50;
        g.fillStyle = `rgba(110,145,200,${0.08 + rnd() * 0.1})`;
        g.beginPath(); g.arc(x + r * 0.2, y + r * 0.25, r, 0, TAU); g.fill();
        g.fillStyle = `rgba(255,255,255,${0.12 + rnd() * 0.14})`;
        g.beginPath(); g.arc(x - r * 0.15, y - r * 0.2, r * 0.7, 0, TAU); g.fill();
      }
      // Blocs dorés flottants au bord du ciel
      for (const [x, y] of [[120, 60], [170, 60], [220, 60], [1000, 120], [1050, 120]]) {
        g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x + 4, y + 30, 34, 6);
        g.fillStyle = '#e8a800'; g.fillRect(x, y, 36, 28);
        g.fillStyle = '#ffd34d'; g.fillRect(x + 3, y + 3, 30, 22);
        g.fillStyle = '#b07800'; g.fillRect(x + 3, y + 20, 30, 5);
        g.fillStyle = '#fff3b0'; g.beginPath(); g.arc(x + 18, y + 13, 5, 0, TAU); g.fill();
      }
      const v = g.createRadialGradient(W / 2, H / 2, H * 0.5, W / 2, H / 2, W * 0.8);
      v.addColorStop(0, 'rgba(30,60,120,0)'); v.addColorStop(1, 'rgba(30,60,120,.35)');
      g.fillStyle = v; g.fillRect(0, 0, W, H);
    },

    // Roi de la Colline : sommet de montagne au-dessus d'une mer de nuages, rochers, fleurs, pierres levées
    sommet(g) {
      const rnd = rng(191);
      g.fillStyle = '#b9d0e8'; g.fillRect(0, 0, W, H); // mer de nuages sous le sommet
      // Plateau d'herbe et de roche (forme irrégulière qui remplit presque tout)
      const plateau = () => {
        g.beginPath();
        const n = 40;
        for (let k = 0; k <= n; k++) {
          const a = (k / n) * TAU;
          const rr = 1 + (Math.sin(a * 5 + 1) * 0.03 + Math.sin(a * 11) * 0.02);
          g.lineTo(W / 2 + Math.cos(a) * 690 * rr, H / 2 + Math.sin(a) * 410 * rr);
        }
        g.closePath();
      };
      g.save();
      g.fillStyle = '#6e6458'; plateau(); g.fill(); // falaise
      g.translate(0, -12);
      const grass = g.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, 680);
      grass.addColorStop(0, '#4f6a3c'); grass.addColorStop(0.7, '#435a35'); grass.addColorStop(1, '#5a5a4c');
      g.fillStyle = grass; plateau(); g.fill();
      g.clip();
      blobs(g, rnd, 50, (r) => `rgba(${110 + r() * 30},${105 + r() * 25},${95 + r() * 20},.25)`, 20, 70); // roche affleurante
      for (let i = 0; i < 300; i++) {
        const x = rnd() * W; const y = rnd() * H;
        g.strokeStyle = `rgba(${130 + rnd() * 40},${170 + rnd() * 40},100,.3)`;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - 2, y - 6); g.moveTo(x, y); g.lineTo(x + 2, y - 7); g.stroke();
      }
      for (let i = 0; i < 70; i++) { g.fillStyle = ['#fff', '#ffd23f', '#b78cff', '#ff8fb0'][i % 4]; g.beginPath(); g.arc(rnd() * W, rnd() * H, 1.8, 0, TAU); g.fill(); }
      g.restore();
      // Mer de nuages dans les coins
      for (let i = 0; i < 60; i++) {
        const p = edgeSpot(rnd, 40);
        if (Math.hypot((p.x - W / 2) / 690, (p.y - H / 2) / 410) < 0.95) continue;
        g.fillStyle = `rgba(255,255,255,${0.5 + rnd() * 0.4})`;
        g.beginPath(); g.arc(p.x, p.y, 20 + rnd() * 30, 0, TAU); g.fill();
      }
      // Pierres levées et rochers au bord du plateau
      for (let i = 0; i < 14; i++) {
        const a = rnd() * TAU;
        const x = W / 2 + Math.cos(a) * 610; const y = H / 2 + Math.sin(a) * 350;
        if (rnd() < 0.5) rock(g, rnd, x, y, 12 + rnd() * 14, '#7a7268', 'rgba(255,255,255,.18)');
        else { shadowDisc(g, x + 8, y + 10, 14, 6, 0.4); g.fillStyle = '#8a8478'; g.fillRect(x - 7, y - 28, 14, 34); g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(x - 7, y - 28, 4, 34); }
      }
      vignette(g, 0.35, 0.5);
    },
  };

  // ---------- Animations sous les combattants ----------
  const UNDER = {
    volcan(ctx, t) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const [x, y, r, k] of [[150, 640, 170, 0], [1130, 100, 170, 1], [60, 620, 90, 2]]) glow(ctx, x, y, r * (1 + Math.sin(t / 700 + k) * 0.08), '255,90,20', 0.16 + Math.sin(t / 500 + k * 2) * 0.05);
      ctx.restore();
    },
    sanctum(ctx, t) {
      // L'anneau de runes s'illumine en tournant ; flammes des chandelles
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const a0 = (t / 4000) % TAU;
      ctx.strokeStyle = 'rgba(180,120,255,.35)'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.ellipse(W / 2, H / 2, 300, 186, 0, a0, a0 + 1.2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(W / 2, H / 2, 300, 186, 0, a0 + Math.PI, a0 + Math.PI + 1.2); ctx.stroke();
      glow(ctx, W / 2, H / 2, 160, '150,80,255', 0.08 + Math.sin(t / 900) * 0.04);
      for (const [x, y] of [[70, 80], [1210, 80], [70, 640], [1210, 640], [380, 40], [900, 40], [380, 690], [900, 690]]) {
        for (let k = 0; k < 4; k++) {
          const px = x + (k - 1.5) * 10; const h = 14 + (k % 2) * 8;
          const fl = 1 + Math.sin(t / 80 + k * 2 + x) * 0.15;
          glow(ctx, px, y - h - 4, 14 * fl, '255,190,110', 0.4);
          ctx.fillStyle = '#ffe3a0'; ctx.beginPath(); ctx.ellipse(px, y - h - 4, 2.2 * fl, 4.5 * fl, 0, 0, TAU); ctx.fill();
        }
      }
      ctx.restore();
    },
    tresor(ctx, t) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 26; i++) {
        const p = [[70, 70], [1210, 70], [80, 650], [1200, 650], [640, 40], [640, 690], [340, 30], [940, 690]][i % 8];
        const x = p[0] + (hash(i) - 0.5) * 90; const y = p[1] + (hash(i, 2) - 0.5) * 50;
        const a = Math.max(0, Math.sin(t / 260 + i * 1.7));
        if (a < 0.6) continue;
        ctx.fillStyle = `rgba(255,250,210,${(a - 0.6) * 2})`;
        ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 1.6, y - 1.6); ctx.lineTo(x + 7, y); ctx.lineTo(x + 1.6, y + 1.6); ctx.lineTo(x, y + 7); ctx.lineTo(x - 1.6, y + 1.6); ctx.lineTo(x - 7, y); ctx.lineTo(x - 1.6, y - 1.6); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    },
    neige(ctx, t) {
      // Bancs de brume glacée qui glissent
      ctx.save();
      for (let i = 0; i < 6; i++) {
        const x = ((hash(i) * W + t * (0.02 + hash(i, 3) * 0.02)) % (W + 600)) - 300;
        const y = 80 + hash(i, 2) * (H - 160);
        const gr = ctx.createRadialGradient(x, y, 0, x, y, 260);
        gr.addColorStop(0, 'rgba(235,245,255,.14)'); gr.addColorStop(1, 'rgba(235,245,255,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(x, y, 260, 90, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    },
    grotte(ctx, t) {
      // Champignons luminescents qui respirent
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 14; i++) {
        const x = i % 2 ? 30 + hash(i, 2) * 160 : W - 30 - hash(i, 2) * 160;
        const y = 60 + hash(i, 3) * (H - 120);
        const a = 0.12 + Math.sin(t / 900 + i * 2.1) * 0.06;
        glow(ctx, x, y, 34, i % 3 ? '80,220,200' : '160,120,255', a);
        ctx.fillStyle = i % 3 ? 'rgba(140,255,230,.7)' : 'rgba(200,170,255,.7)';
        ctx.beginPath(); ctx.arc(x, y, 2.4, 0, TAU); ctx.fill();
      }
      ctx.restore();
    },
    cimetiere(ctx, t) {
      // Brume au ras du sol
      ctx.save();
      for (let i = 0; i < 8; i++) {
        const x = ((hash(i) * W + t * (0.015 + hash(i, 4) * 0.02) * (i % 2 ? 1 : -1)) % (W + 700) + W + 700) % (W + 700) - 350;
        const y = 60 + hash(i, 2) * (H - 120);
        const gr = ctx.createRadialGradient(x, y, 0, x, y, 300);
        gr.addColorStop(0, 'rgba(190,220,230,.12)'); gr.addColorStop(1, 'rgba(190,220,230,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(x, y, 300, 80, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    },
    theatre(ctx, t) {
      // Deux poursuites (projecteurs) qui balaient la scène
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 2; k++) {
        const x = W / 2 + Math.sin(t / 2600 + k * 2.4) * 420;
        const y = H / 2 + Math.cos(t / 3300 + k * 1.3) * 180;
        const gr = ctx.createRadialGradient(x, y, 10, x, y, 150);
        gr.addColorStop(0, k ? 'rgba(255,200,240,.16)' : 'rgba(255,240,190,.16)'); gr.addColorStop(1, 'rgba(255,240,190,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(x, y, 150, 100, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    },
    enfer(ctx, t) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      glow(ctx, W / 2, H / 2, 280, '255,30,60', 0.08 + Math.sin(t / 600) * 0.05);
      // Feu des braseros
      for (const [x, y] of [[60, 60], [W - 60, 60], [60, H - 60], [W - 60, H - 60], [W / 2, 30], [W / 2, H - 30]]) {
        const fl = 1 + Math.sin(t / 90 + x) * 0.12 + Math.sin(t / 37 + y) * 0.06;
        glow(ctx, x, y, 70 * fl, '255,60,40', 0.3);
        const gr = ctx.createRadialGradient(x, y - 6, 1, x, y - 6, 16 * fl);
        gr.addColorStop(0, '#fff0c0'); gr.addColorStop(0.5, '#ff4a2a'); gr.addColorStop(1, 'rgba(255,0,60,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(x, y - 8, 10 * fl, 18 * fl, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    },
    colisee(ctx, t) {
      // La foule s'agite : quelques spectateurs se lèvent les bras en l'air
      ctx.save();
      for (let i = 0; i < 70; i++) {
        const a = hash(i) * TAU; const k = Math.floor(hash(i, 2) * 6);
        const x = W / 2 + Math.cos(a) * (700 + 30 + k * 26 - 13); const y = H / 2 + 10 + Math.sin(a) * (430 + 30 + k * 22 - 11);
        if (x < 0 || x > W || y < 0 || y > H) continue;
        const up = Math.sin(t / 180 + i * 2.3) > 0.4;
        if (!up) continue;
        ctx.strokeStyle = 'rgba(245,215,180,.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x - 6, y - 9); ctx.moveTo(x + 3, y); ctx.lineTo(x + 6, y - 9); ctx.stroke();
      }
      // Étendards qui flottent sur les colonnes
      for (const [x, y, c] of [[40, 40, '#ffb84d'], [W - 40, 40, '#ff4d6d'], [40, H - 40, '#29e7ff'], [W - 40, H - 40, '#b14dff']]) {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.moveTo(x, y - 30);
        for (let k = 0; k <= 6; k++) ctx.lineTo(x + k * 7, y - 30 + Math.sin(t / 200 + k * 0.9) * 3);
        for (let k = 6; k >= 0; k--) ctx.lineTo(x + k * 7, y - 14 + Math.sin(t / 200 + k * 0.9) * 3);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    },
    chateau(ctx, t) {
      // Torches des remparts
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const x of [300, 520, 760, 980]) {
        const fl = 1 + Math.sin(t / 90 + x) * 0.12;
        glow(ctx, x, 60, 80 * fl, '255,170,60', 0.22);
        const gr = ctx.createRadialGradient(x, 48, 1, x, 48, 10 * fl);
        gr.addColorStop(0, '#fff3c0'); gr.addColorStop(0.5, '#ffa030'); gr.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(x, 46, 6 * fl, 11 * fl, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    },
    nuage(ctx, t) {
      // Petits nuages qui passent dans le ciel
      ctx.save();
      for (let i = 0; i < 5; i++) {
        const x = ((hash(i) * W + t * (0.012 + hash(i, 2) * 0.015)) % (W + 300)) - 150;
        const y = 30 + hash(i, 3) * 100; const s = 0.6 + hash(i, 4) * 0.6;
        ctx.fillStyle = 'rgba(255,255,255,.7)';
        for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(x + k * 24 * s, y + (k % 2) * -8 * s, 20 * s, 0, TAU); ctx.fill(); }
      }
      ctx.restore();
    },
    sommet(ctx, t) {
      // Les nuages filent autour du sommet
      ctx.save();
      for (let i = 0; i < 9; i++) {
        const top = i % 2 === 0;
        const x = ((hash(i) * W + t * (0.025 + hash(i, 2) * 0.02)) % (W + 400)) - 200;
        const y = top ? 10 + hash(i, 3) * 40 : H - 10 - hash(i, 3) * 40;
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(x + k * 30, y + (k % 2) * 8, 26, 0, TAU); ctx.fill(); }
      }
      ctx.restore();
    },
  };

  // ---------- Devant les combattants (léger) ----------
  const OVER = {
    foret(ctx, t) {
      ctx.save();
      // Feuilles qui tombent en tournoyant
      for (let i = 0; i < 16; i++) {
        const sp = 0.03 + hash(i) * 0.03;
        const y = ((hash(i, 2) * H + t * sp) % (H + 60)) - 30;
        const x = hash(i, 3) * W + Math.sin(t / 900 + i) * 40;
        ctx.save(); ctx.translate(x, y); ctx.rotate(t / 600 + i);
        ctx.fillStyle = ['rgba(196,110,40,.75)', 'rgba(150,170,60,.7)', 'rgba(170,70,30,.7)'][i % 3];
        ctx.beginPath(); ctx.ellipse(0, 0, 5, 2.4 * Math.abs(Math.sin(t / 400 + i)) + 0.6, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
      // Lucioles
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 14; i++) {
        const x = hash(i, 5) * W + Math.sin(t / 1300 + i * 2) * 50;
        const y = hash(i, 6) * H + Math.cos(t / 1100 + i) * 30;
        const a = Math.max(0, Math.sin(t / 500 + i * 1.9));
        glow(ctx, x, y, 10, '220,255,120', 0.5 * a);
      }
      ctx.restore();
    },
    volcan(ctx, t) {
      // Braises qui montent
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 40; i++) {
        const sp = 0.04 + hash(i) * 0.06;
        const y = H + 20 - ((hash(i, 2) * H + t * sp) % (H + 40));
        const x = hash(i, 3) * W + Math.sin(t / 700 + i) * 18;
        const a = 0.4 + 0.5 * Math.abs(Math.sin(t / 150 + i));
        ctx.fillStyle = `rgba(255,${120 + hash(i, 4) * 100},40,${a})`;
        ctx.beginPath(); ctx.arc(x, y, 1.2 + hash(i, 5) * 1.6, 0, TAU); ctx.fill();
      }
      ctx.restore();
    },
    sanctum(ctx, t) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 24; i++) {
        const sp = 0.012 + hash(i) * 0.02;
        const y = H - ((hash(i, 2) * H + t * sp) % H);
        const x = hash(i, 3) * W + Math.sin(t / 1000 + i) * 25;
        glow(ctx, x, y, 6, '190,130,255', 0.5 * Math.abs(Math.sin(t / 700 + i)));
      }
      ctx.restore();
    },
    neige(ctx, t) {
      // Blizzard : flocons poussés par le vent, de biais
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.lineCap = 'round';
      for (let i = 0; i < 150; i++) {
        const sp = 0.25 + hash(i) * 0.35;
        const d = (hash(i, 2) * (W + H) + t * sp) % (W + H);
        const x = (hash(i, 3) * W + d) % (W + 80) - 40;
        const y = (hash(i, 4) * H + d * 0.55) % (H + 40) - 20;
        const s = 0.8 + hash(i, 5) * 1.8;
        ctx.globalAlpha = 0.35 + hash(i, 6) * 0.5;
        ctx.lineWidth = s;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 7 * s, y - 4 * s); ctx.stroke();
      }
      // Rafale : voile blanc qui passe
      ctx.globalAlpha = 1;
      const gust = Math.max(0, Math.sin(t / 2300)) * 0.1;
      if (gust > 0.01) { ctx.fillStyle = `rgba(240,248,255,${gust})`; ctx.fillRect(0, 0, W, H); }
      ctx.restore();
    },
    grotte(ctx, t) {
      // Araignées qui descendent au bout de leur fil
      ctx.save();
      for (let i = 0; i < 4; i++) {
        const x = [170, 420, 860, 1110][i];
        const len = 60 + (Math.sin(t / 1800 + i * 1.7) * 0.5 + 0.5) * 130;
        ctx.strokeStyle = 'rgba(230,235,240,.4)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, len); ctx.stroke();
        ctx.save(); ctx.translate(x, len + 5); ctx.rotate(Math.sin(t / 400 + i) * 0.2);
        ctx.strokeStyle = '#120a10'; ctx.lineWidth = 1.4;
        for (let k = 0; k < 4; k++) { const a = -0.6 + k * 0.4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 6 + 3); ctx.moveTo(0, 0); ctx.lineTo(-Math.cos(a) * 9, Math.sin(a) * 6 + 3); ctx.stroke(); }
        ctx.fillStyle = '#1a0e14'; ctx.beginPath(); ctx.ellipse(0, 0, 4.5, 6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c0203a'; ctx.beginPath(); ctx.arc(0, 1.5, 1.6, 0, TAU); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    },
    cimetiere(ctx, t) {
      // Feux follets
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 9; i++) {
        const x = hash(i) * W + Math.sin(t / 1400 + i * 2) * 60;
        const y = hash(i, 2) * H + Math.cos(t / 1700 + i) * 40;
        const a = 0.3 + 0.3 * Math.sin(t / 600 + i);
        glow(ctx, x, y, 22, '150,200,255', a);
        ctx.fillStyle = `rgba(220,240,255,${a + 0.2})`; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, TAU); ctx.fill();
      }
      ctx.restore();
    },
    theatre(ctx, t) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 16; i++) {
        const x = 100 + hash(i) * (W - 200); const y = 60 + hash(i, 2) * (H - 120);
        const a = Math.max(0, Math.sin(t / 340 + i * 2.2));
        if (a < 0.7) continue;
        ctx.fillStyle = `rgba(255,230,250,${(a - 0.7) * 2.5})`;
        ctx.font = '12px "Segoe UI Symbol", sans-serif';
        ctx.fillText('✦', x, y);
      }
      ctx.restore();
    },
    enfer(ctx, t) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 36; i++) {
        const sp = 0.035 + hash(i) * 0.05;
        const y = H + 20 - ((hash(i, 2) * H + t * sp) % (H + 40));
        const x = hash(i, 3) * W + Math.sin(t / 600 + i) * 22;
        ctx.fillStyle = `rgba(255,${40 + hash(i, 4) * 80},${80 + hash(i, 5) * 60},${0.35 + 0.4 * Math.abs(Math.sin(t / 160 + i))})`;
        ctx.beginPath(); ctx.arc(x, y, 1.2 + hash(i, 6) * 1.5, 0, TAU); ctx.fill();
      }
      ctx.restore();
    },
  };

  // Décor d'une partie : boss (Combat de Boss, Boss Rush, Défi des boss) ou mode ; null = décor par défaut (le pré).
  const BOSS_THEME = { troll: 'foret', dragon: 'volcan', sorcier: 'sanctum', mimic: 'tresor', liche: 'neige', maexxna: 'grotte', ether: 'cimetiere', lilith: 'theatre', daedra: 'enfer' };
  const MODE_THEME = { tourney: 'colisee', clans: 'chateau', gold: 'nuage', koth: 'sommet' };
  function of(mode, bossId) {
    if (mode === 'boss' || mode === 'rush') return BOSS_THEME[bossId] || 'foret';
    return MODE_THEME[mode] || null;
  }

  window.ArenaThemes = {
    of,
    BOSS_THEME,
    MODE_THEME,
    has: (key) => !!PAINT[key],
    paint: (key, g) => PAINT[key](g),
    under: (key, ctx, t) => { if (UNDER[key]) UNDER[key](ctx, t); },
    over: (key, ctx, t) => { if (OVER[key]) OVER[key](ctx, t); },
  };
})();
