/*
 * Carte du monde (lieu « carte ») : le hub d'où l'on rejoint toutes les activités.
 * Un décor dessiné au canvas (jour / nuit selon l'heure réelle, comme le Familier et la Maison) et, par-dessus, un bouton
 * HTML par lieu (zone cliquable + étiquette + pastille). Deux mises en page : « large » (PC, tablette en paysage) et
 * « haute » (téléphone). Les lieux viennent de character.js (WorldMap.init(places, go)).
 * Utilise les globales : me, Rules, skyPhase, drawFighter, drawPet, drawMonster, drawCroupier.
 */
(function () {
  // Position de chaque lieu : [x, y du sol, largeur et hauteur de la zone cliquable] dans un repère W × H
  const LAYOUTS = {
    wide: {
      W: 1200, H: 640, plaza: [600, 420],
      spots: {
        hall: [600, 150, 190, 130], donjon: [165, 205, 220, 165], survivor: [1045, 200, 230, 160], arene: [830, 205, 170, 120],
        gym: [335, 395, 160, 120], maison: [600, 385, 160, 150], niche: [735, 420, 90, 80], heros: [492, 470, 80, 120],
        casino: [935, 440, 190, 160], guide: [395, 545, 90, 90], peche: [170, 560, 240, 140], commerce: [720, 590, 260, 120],
        taverne: [1065, 605, 170, 140],
      },
      deco: 52,
    },
    tall: {
      W: 600, H: 980, plaza: [300, 505],
      spots: {
        hall: [300, 150, 190, 130], donjon: [110, 230, 200, 165], survivor: [490, 230, 200, 165], arene: [470, 365, 160, 110],
        gym: [125, 395, 170, 120], maison: [300, 470, 160, 150], niche: [430, 505, 90, 80], heros: [190, 560, 80, 120],
        casino: [460, 670, 180, 160], guide: [130, 660, 90, 90], peche: [150, 860, 250, 150], commerce: [440, 880, 230, 120],
        taverne: [300, 770, 160, 130],
      },
      deco: 40,
    },
  };

  const S = { places: [], go: null, canvas: null, ctx: null, raf: 0, active: false, layout: null, mode: '', hover: null, badges: {}, deco: null, w: 0, h: 0, last: 0, ro: null };

  // Pseudo-hasard stable (décor identique d'une image à l'autre)
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function init(places, go) {
    S.places = places.filter((p) => LAYOUTS.wide.spots[p.id]);
    S.go = go;
    S.canvas = document.getElementById('map-canvas');
    S.ctx = S.canvas.getContext('2d');
    S.spots = document.getElementById('map-spots');
    S.canvas.addEventListener('mousemove', () => {});
    if (window.ResizeObserver) { S.ro = new ResizeObserver(() => { if (S.active) resize(); }); S.ro.observe(document.getElementById('map-wrap')); }
  }

  // Taille du canvas et choix de la mise en page selon la largeur disponible
  function resize() {
    const wrap = document.getElementById('map-wrap');
    const cw = wrap.clientWidth;
    if (!cw) return;
    const mode = cw < 640 ? 'tall' : 'wide';
    const L = LAYOUTS[mode];
    const ch = Math.round((cw * L.H) / L.W);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    S.canvas.width = Math.round(cw * dpr);
    S.canvas.height = Math.round(ch * dpr);
    S.canvas.style.height = ch + 'px';
    wrap.style.height = ch + 'px';
    S.scale = (cw * dpr) / L.W;
    if (mode !== S.mode) { S.mode = mode; S.layout = L; S.deco = makeDeco(L); buildSpots(); }
  }

  // Boutons des lieux, posés sur le dessin (en % : ils suivent la taille du canvas)
  function buildSpots() {
    const L = S.layout;
    S.spots.innerHTML = S.places.map((p) => {
      const [x, y, w, h] = L.spots[p.id];
      const style = `left:${((x - w / 2) / L.W) * 100}%;top:${((y - h) / L.H) * 100}%;width:${(w / L.W) * 100}%;height:${(h / L.H) * 100}%`;
      return `<button type="button" class="map-spot" data-place="${p.id}" style="${style}" title="${esc(p.desc || p.label)}">
        <span class="ms-label"><span class="ms-ico">${p.icon}</span>${esc(p.label)}<span class="tab-badge" data-map-badge="${p.id}"></span></span></button>`;
    }).join('');
    S.spots.querySelectorAll('.map-spot').forEach((b) => {
      b.onclick = () => S.go(b.dataset.place);
      b.onmouseenter = () => { S.hover = b.dataset.place; };
      b.onmouseleave = () => { if (S.hover === b.dataset.place) S.hover = null; };
      b.onfocus = b.onmouseenter;
      b.onblur = b.onmouseleave;
    });
    setBadges(S.badges);
  }

  function setBadges(b) {
    S.badges = b || {};
    if (!S.spots) return;
    S.spots.querySelectorAll('[data-map-badge]').forEach((el) => {
      const n = S.badges[el.dataset.mapBadge] || 0;
      el.textContent = n || '';
      el.classList.toggle('on', n > 0);
    });
  }

  // Décor : arbres, rochers, fleurs, lanternes, tirés une fois (loin des lieux et des chemins)
  function makeDeco(L) {
    const r = rng(L === LAYOUTS.wide ? 7 : 11);
    const items = [];
    const busy = (x, y) => Object.values(L.spots).some(([sx, sy, w, h]) => x > sx - w / 2 - 18 && x < sx + w / 2 + 18 && y > sy - h - 10 && y < sy + 26);
    let tries = 0;
    while (items.length < L.deco && tries++ < 3000) {
      const x = 20 + r() * (L.W - 40);
      const y = 70 + r() * (L.H - 90);
      if (busy(x, y) || onPath(L, x, y, 26)) continue;
      const k = r();
      items.push({ x, y, kind: k < 0.55 ? 'tree' : k < 0.7 ? 'pine' : k < 0.85 ? 'flowers' : 'rock', s: 0.75 + r() * 0.5, seed: r() });
    }
    // Lanternes le long des chemins
    for (const p of S.places) {
      const [x, y] = L.spots[p.id];
      const [px, py] = L.plaza;
      items.push({ x: px + (x - px) * 0.55 + 16, y: py + (y - py) * 0.55 + 6, kind: 'lamp', s: 1, seed: 0 });
    }
    items.sort((a, b) => a.y - b.y);
    return items;
  }

  // Chemins : du centre de la place vers le pied de chaque lieu
  function paths(L) {
    const [px, py] = L.plaza;
    return S.places.map((p) => {
      const [x, y] = L.spots[p.id];
      const mx = (px + x) / 2 + (y - py) * 0.12;
      const my = (py + y) / 2 - (x - px) * 0.08;
      return [px, py, mx, my, x, y + 6];
    });
  }
  function onPath(L, x, y, d) {
    for (const [ax, ay, mx, my, bx, by] of paths(L)) {
      for (let t = 0; t <= 1; t += 0.05) {
        const qx = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * mx + t * t * bx;
        const qy = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * my + t * t * by;
        if (Math.hypot(qx - x, qy - y) < d) return true;
      }
    }
    return Math.hypot(x - L.plaza[0], (y - L.plaza[1]) * 1.6) < 90;
  }

  // ---------- Dessins ----------
  function shadow(g, x, y, w, h, a = 0.25) { g.fillStyle = `rgba(0,0,0,${a})`; g.beginPath(); g.ellipse(x, y, w, h, 0, 0, Math.PI * 2); g.fill(); }
  function glowWin(g, x, y, w, h, night, color = '#ffd77a') {
    g.fillStyle = night ? color : '#9fd3ee';
    g.fillRect(x, y, w, h);
    if (night) { g.save(); g.globalAlpha = 0.25; g.fillStyle = color; g.beginPath(); g.arc(x + w / 2, y + h / 2, Math.max(w, h) * 1.4, 0, Math.PI * 2); g.fill(); g.restore(); }
    g.strokeStyle = 'rgba(40,25,15,.8)'; g.lineWidth = 2; g.strokeRect(x, y, w, h);
  }

  function drawTree(g, x, y, s, seed, ph) {
    shadow(g, x, y, 22 * s, 7 * s, 0.2);
    g.fillStyle = '#6b4424'; g.fillRect(x - 4 * s, y - 22 * s, 8 * s, 22 * s);
    const c = ph.night ? ['#1f4a3a', '#2a5d47'] : ['#3f8f4a', '#56aa58'];
    g.fillStyle = c[0]; g.beginPath(); g.arc(x, y - 34 * s, 22 * s, 0, Math.PI * 2); g.fill();
    g.fillStyle = c[1]; g.beginPath(); g.arc(x - 8 * s, y - 40 * s, 13 * s, 0, Math.PI * 2); g.arc(x + 9 * s, y - 31 * s, 12 * s, 0, Math.PI * 2); g.fill();
    if (seed > 0.7 && !ph.night) { g.fillStyle = '#e8493a'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(x - 10 * s + i * 9 * s, y - 30 * s - (i % 2) * 10 * s, 2.6 * s, 0, Math.PI * 2); g.fill(); } }
  }
  function drawPine(g, x, y, s, ph) {
    shadow(g, x, y, 16 * s, 5 * s, 0.2);
    g.fillStyle = '#5a3a1e'; g.fillRect(x - 3 * s, y - 12 * s, 6 * s, 12 * s);
    g.fillStyle = ph.night ? '#173d33' : '#2f7a4c';
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(x, y - (60 - i * 14) * s); g.lineTo(x - (14 + i * 5) * s, y - (22 - i * 4 + 10) * s + i * 8 * s); g.lineTo(x + (14 + i * 5) * s, y - (22 - i * 4 + 10) * s + i * 8 * s); g.closePath(); g.fill(); }
  }
  function drawFlowers(g, x, y, s, seed) {
    const cols = ['#ff7eb3', '#ffd34a', '#ffffff', '#b08cff'];
    for (let i = 0; i < 5; i++) {
      const a = seed * 10 + i * 1.3;
      const fx = x + Math.cos(a) * 12 * s;
      const fy = y + Math.sin(a) * 5 * s;
      g.strokeStyle = '#3f8a3e'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx, fy - 7 * s); g.stroke();
      g.fillStyle = cols[i % cols.length]; g.beginPath(); g.arc(fx, fy - 8 * s, 3 * s, 0, Math.PI * 2); g.fill();
    }
  }
  function drawRock(g, x, y, s) {
    shadow(g, x, y + 2, 14 * s, 4 * s, 0.2);
    g.fillStyle = '#8d8a96'; g.beginPath(); g.ellipse(x, y - 5 * s, 14 * s, 9 * s, 0, Math.PI, 0); g.lineTo(x + 14 * s, y); g.lineTo(x - 14 * s, y); g.fill();
    g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.ellipse(x - 4 * s, y - 9 * s, 5 * s, 3 * s, 0, 0, Math.PI * 2); g.fill();
  }
  function drawLamp(g, x, y, ph, t) {
    g.fillStyle = '#3a2f3f'; g.fillRect(x - 2, y - 34, 4, 34);
    g.fillStyle = '#2a2230'; g.fillRect(x - 6, y - 42, 12, 9);
    g.fillStyle = ph.night || ph.dusk ? '#ffd77a' : '#e9e2c8'; g.fillRect(x - 4, y - 40, 8, 6);
    if (ph.night || ph.dusk) {
      g.save(); g.globalAlpha = 0.18 + Math.sin(t / 400 + x) * 0.03; g.fillStyle = '#ffcf6a';
      g.beginPath(); g.arc(x, y - 37, 26, 0, Math.PI * 2); g.fill(); g.restore();
    }
  }

  function drawHouse(g, x, y, ph, t) {
    const st = (me && me.character.house && me.character.house.style) || {};
    const P = Rules.HOUSE_PARTS || {};
    const wall = (P.murs && P.murs.options[st.murs] && P.murs.options[st.murs].color) || '#efe9dc';
    const roof = (P.toit && P.toit.options[st.toit] && P.toit.options[st.toit].color) || '#b8452e';
    shadow(g, x, y, 78, 12);
    // cheminée et fumée
    g.fillStyle = '#7a4a3a'; g.fillRect(x + 28, y - 128, 14, 30);
    for (let i = 0; i < 3; i++) {
      const k = ((t / 2200 + i / 3) % 1);
      g.fillStyle = `rgba(230,230,240,${0.45 * (1 - k)})`;
      g.beginPath(); g.arc(x + 35 + Math.sin(k * 6 + i) * 6, y - 134 - k * 40, 6 + k * 8, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = wall; g.fillRect(x - 60, y - 78, 120, 78);
    g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(x + 20, y - 78, 40, 78);
    g.fillStyle = roof; g.beginPath(); g.moveTo(x - 74, y - 74); g.lineTo(x, y - 126); g.lineTo(x + 74, y - 74); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,.15)'; g.beginPath(); g.moveTo(x, y - 126); g.lineTo(x + 74, y - 74); g.lineTo(x, y - 74); g.closePath(); g.fill();
    // porte et fenêtres
    g.fillStyle = '#6b3f22'; g.beginPath(); g.roundRect(x - 13, y - 42, 26, 42, [12, 12, 0, 0]); g.fill();
    g.fillStyle = '#ffd34a'; g.beginPath(); g.arc(x + 7, y - 20, 2.2, 0, Math.PI * 2); g.fill();
    glowWin(g, x - 48, y - 60, 24, 20, ph.night);
    glowWin(g, x + 24, y - 60, 24, 20, ph.night);
    // boîte aux lettres
    g.fillStyle = '#5a3a1e'; g.fillRect(x + 66, y - 22, 4, 22);
    g.fillStyle = '#3b6fd8'; g.beginPath(); g.roundRect(x + 59, y - 34, 18, 13, 5); g.fill();
    if (S.badges.maison) { g.fillStyle = '#ff4d6d'; g.fillRect(x + 77, y - 38, 3, 11); g.fillRect(x + 77, y - 38, 8, 5); }
  }

  function drawNiche(g, x, y, ph, t) {
    shadow(g, x, y, 40, 8);
    g.fillStyle = '#b5773e'; g.fillRect(x - 26, y - 34, 52, 34);
    g.fillStyle = '#c0392b'; g.beginPath(); g.moveTo(x - 33, y - 32); g.lineTo(x, y - 56); g.lineTo(x + 33, y - 32); g.closePath(); g.fill();
    g.fillStyle = '#2b1a10'; g.beginPath(); g.arc(x, y - 12, 11, Math.PI, 0); g.lineTo(x + 11, y); g.lineTo(x - 11, y); g.fill();
    g.fillStyle = '#7a5a2a'; g.font = '700 8px system-ui'; g.textAlign = 'center';
    // gamelle
    g.fillStyle = '#d64545'; g.beginPath(); g.ellipse(x + 34, y - 3, 9, 4, 0, 0, Math.PI * 2); g.fill();
    // le familier principal à côté de sa niche
    const P = me && me.character.pets;
    const pet = P && P.list && P.list.find((p) => p.id === P.active);
    if (pet && window.drawPet) drawPet(g, x - 40, y + 2, pet.species, { t, size: 0.55, facing: 1, sleep: ph.night });
  }

  function drawHall(g, x, y, ph, t) {
    shadow(g, x, y + 2, 96, 12);
    g.fillStyle = '#cfc8bd'; g.fillRect(x - 92, y - 12, 184, 12); g.fillRect(x - 84, y - 20, 168, 8);
    g.fillStyle = '#ece6da';
    for (let i = 0; i < 5; i++) { const cx = x - 70 + i * 35; g.fillRect(cx - 7, y - 82, 14, 62); g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(cx + 2, y - 82, 5, 62); g.fillStyle = '#ece6da'; }
    g.fillStyle = '#d9d1c4'; g.fillRect(x - 88, y - 92, 176, 12);
    g.fillStyle = '#e8e0d2'; g.beginPath(); g.moveTo(x - 92, y - 92); g.lineTo(x, y - 124); g.lineTo(x + 92, y - 92); g.closePath(); g.fill();
    // coupe dorée
    const bob = Math.sin(t / 600) * 2;
    g.fillStyle = '#ffcf3a'; g.beginPath(); g.moveTo(x - 11, y - 140 + bob); g.lineTo(x + 11, y - 140 + bob); g.quadraticCurveTo(x + 10, y - 124 + bob, x, y - 122 + bob); g.quadraticCurveTo(x - 10, y - 124 + bob, x - 11, y - 140 + bob); g.fill();
    g.fillRect(x - 2, y - 123 + bob, 4, 5); g.fillRect(x - 7, y - 119 + bob, 14, 3);
    g.strokeStyle = '#ffcf3a'; g.lineWidth = 2.5; g.beginPath(); g.arc(x - 12, y - 134 + bob, 5, Math.PI / 2, Math.PI * 1.5); g.stroke(); g.beginPath(); g.arc(x + 12, y - 134 + bob, 5, -Math.PI / 2, Math.PI / 2); g.stroke();
    if (ph.night) { g.save(); g.globalAlpha = 0.25; g.fillStyle = '#ffe48a'; g.beginPath(); g.arc(x, y - 132, 26, 0, Math.PI * 2); g.fill(); g.restore(); }
  }

  function drawDungeon(g, x, y, ph, t) {
    shadow(g, x, y + 2, 110, 14);
    g.fillStyle = ph.night ? '#3e3a4f' : '#6f6a7d';
    g.beginPath(); g.moveTo(x - 115, y); g.lineTo(x - 70, y - 110); g.lineTo(x - 30, y - 80); g.lineTo(x + 5, y - 150); g.lineTo(x + 55, y - 95); g.lineTo(x + 80, y - 120); g.lineTo(x + 115, y); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.moveTo(x + 5, y - 150); g.lineTo(x - 12, y - 120); g.lineTo(x + 2, y - 126); g.lineTo(x + 18, y - 118); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.moveTo(x + 5, y - 150); g.lineTo(x + 55, y - 95); g.lineTo(x + 80, y - 120); g.lineTo(x + 115, y); g.lineTo(x + 5, y); g.closePath(); g.fill();
    // entrée
    g.fillStyle = '#0d0a14'; g.beginPath(); g.moveTo(x - 30, y); g.lineTo(x - 30, y - 44); g.quadraticCurveTo(x, y - 82, x + 30, y - 44); g.lineTo(x + 30, y); g.closePath(); g.fill();
    g.strokeStyle = '#4c4558'; g.lineWidth = 5; g.stroke();
    // yeux dans le noir
    if (Math.sin(t / 900) > 0.2) { g.fillStyle = '#ff4d6d'; g.beginPath(); g.arc(x - 6, y - 30, 2, 0, Math.PI * 2); g.arc(x + 6, y - 30, 2, 0, Math.PI * 2); g.fill(); }
    // torches
    for (const sx of [-42, 42]) {
      g.fillStyle = '#5a3a1e'; g.fillRect(x + sx - 2, y - 40, 4, 24);
      const f = Math.sin(t / 90 + sx) * 2;
      g.fillStyle = '#ff9a1f'; g.beginPath(); g.ellipse(x + sx, y - 46 + f * 0.3, 5, 9 + f, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffe27a'; g.beginPath(); g.ellipse(x + sx, y - 44, 2.5, 5, 0, 0, Math.PI * 2); g.fill();
      if (ph.night || ph.dusk) { g.save(); g.globalAlpha = 0.16; g.fillStyle = '#ff9a1f'; g.beginPath(); g.arc(x + sx, y - 44, 22, 0, Math.PI * 2); g.fill(); g.restore(); }
    }
  }

  function drawWilds(g, x, y, ph, t) {
    // Terre désolée, arbres morts, brume, monstres qui rôdent
    g.fillStyle = ph.night ? 'rgba(40,30,40,.75)' : 'rgba(92,78,70,.55)';
    g.beginPath(); g.ellipse(x, y - 30, 118, 62, 0, 0, Math.PI * 2); g.fill();
    for (const [dx, dy, s] of [[-80, -30, 1], [70, -50, 0.9], [-20, -78, 0.8], [95, -8, 0.75]]) {
      g.strokeStyle = '#3a2b28'; g.lineWidth = 5 * s; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx, y + dy - 50 * s); g.moveTo(x + dx, y + dy - 30 * s); g.lineTo(x + dx - 16 * s, y + dy - 44 * s); g.moveTo(x + dx, y + dy - 40 * s); g.lineTo(x + dx + 14 * s, y + dy - 58 * s); g.stroke();
    }
    g.lineCap = 'butt';
    if (window.drawMonster) {
      const k = (t / 4000) % 1;
      drawMonster(g, x - 40 + Math.sin(k * Math.PI * 2) * 20, y - 8, { kind: 'squelette' }, { scale: 0.55, t, facing: Math.cos(k * Math.PI * 2) > 0 ? 1 : -1 });
      drawMonster(g, x + 30, y - 22 + Math.sin(t / 500) * 2, { kind: 'gobelin' }, { scale: 0.5, t, facing: -1 });
      drawMonster(g, x + 5, y - 70 + Math.sin(t / 300) * 5, { kind: 'chauve_souris' }, { scale: 0.45, t });
    }
    // brume
    for (let i = 0; i < 4; i++) {
      const k = (t / 9000 + i / 4) % 1;
      g.fillStyle = `rgba(220,215,235,${0.12 * Math.sin(k * Math.PI)})`;
      g.beginPath(); g.ellipse(x - 120 + k * 240, y - 20 - i * 14, 60, 14, 0, 0, Math.PI * 2); g.fill();
    }
  }

  function drawArena(g, x, y, ph, t) {
    shadow(g, x, y + 2, 84, 12);
    g.fillStyle = '#c8a878'; g.beginPath(); g.ellipse(x, y - 30, 80, 32, 0, Math.PI, 0); g.lineTo(x + 80, y); g.lineTo(x - 80, y); g.closePath(); g.fill();
    g.fillStyle = '#b5946a'; g.fillRect(x - 80, y - 30, 160, 30);
    g.fillStyle = '#5a4230';
    for (let i = 0; i < 7; i++) { const ax = x - 66 + i * 22; g.beginPath(); g.roundRect(ax - 7, y - 24, 14, 24, [7, 7, 0, 0]); g.fill(); }
    for (let i = 0; i < 8; i++) { const ax = x - 70 + i * 20; g.beginPath(); g.roundRect(ax - 5, y - 52 + Math.abs(i - 3.5) * 2.5, 10, 14, [5, 5, 0, 0]); g.fill(); }
    // bannières
    for (const sx of [-60, 0, 60]) {
      g.fillStyle = '#4a3a2a'; g.fillRect(x + sx - 1, y - 92, 2, 32);
      g.fillStyle = sx ? '#b83cff' : '#29e7ff';
      const w = Math.sin(t / 300 + sx) * 3;
      g.beginPath(); g.moveTo(x + sx + 1, y - 92); g.lineTo(x + sx + 20 + w, y - 86); g.lineTo(x + sx + 1, y - 80); g.closePath(); g.fill();
    }
    // écran « en direct »
    g.fillStyle = '#ff3a5a'; g.beginPath(); g.roundRect(x - 22, y - 74, 44, 14, 4); g.fill();
    g.fillStyle = '#fff'; g.font = '800 9px system-ui'; g.textAlign = 'center'; g.fillText('LIVE', x, y - 64);
  }

  function drawGym(g, x, y, ph, t) {
    shadow(g, x, y, 76, 10);
    g.fillStyle = '#8fa3b8'; g.fillRect(x - 64, y - 70, 128, 70);
    g.fillStyle = '#5d6f86'; g.fillRect(x - 70, y - 80, 140, 12);
    g.fillStyle = '#3a4658'; g.fillRect(x - 18, y - 40, 36, 40);
    glowWin(g, x - 54, y - 56, 26, 18, ph.night, '#bfe6ff');
    glowWin(g, x + 28, y - 56, 26, 18, ph.night, '#bfe6ff');
    // enseigne haltère
    g.fillStyle = '#ffcf3a'; g.beginPath(); g.roundRect(x - 34, y - 104, 68, 22, 6); g.fill();
    g.fillStyle = '#2a1a00'; g.fillRect(x - 18, y - 95, 36, 4); g.fillRect(x - 22, y - 100, 6, 14); g.fillRect(x + 16, y - 100, 6, 14);
    // mannequin d'entraînement qui oscille
    const a = Math.sin(t / 260) * 0.18;
    g.save(); g.translate(x + 86, y); g.rotate(a);
    g.fillStyle = '#6b4424'; g.fillRect(-2, -40, 4, 40);
    g.fillStyle = '#d8b56a'; g.beginPath(); g.ellipse(0, -46, 11, 16, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(-16, -50, 32, 5);
    g.beginPath(); g.arc(0, -66, 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#c0392b'; g.lineWidth = 2; g.beginPath(); g.arc(0, -46, 6, 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  function drawCasino(g, x, y, ph, t) {
    shadow(g, x, y, 92, 12);
    g.fillStyle = '#3b1d5c'; g.fillRect(x - 82, y - 104, 164, 104);
    g.fillStyle = '#2a1342'; g.fillRect(x - 90, y - 112, 180, 12);
    // ampoules autour
    for (let i = 0; i < 18; i++) {
      const on = (Math.floor(t / 200) + i) % 3 === 0;
      g.fillStyle = on ? '#ffe27a' : '#8a6a2a';
      g.beginPath(); g.arc(x - 85 + i * 10, y - 106, 2.6, 0, Math.PI * 2); g.fill();
    }
    // enseigne néon
    const blink = Math.sin(t / 160) > -0.85;
    g.save();
    g.font = '900 22px Orbitron, system-ui'; g.textAlign = 'center';
    g.shadowColor = '#ff3fd8'; g.shadowBlur = blink ? 14 : 2;
    g.fillStyle = blink ? '#ff9af0' : '#7a3a70'; g.fillText('CASINO', x, y - 72);
    g.restore();
    // portes, tapis rouge
    g.fillStyle = '#ffcf3a'; g.fillRect(x - 24, y - 48, 48, 48);
    g.fillStyle = '#5a2a10'; g.fillRect(x - 21, y - 45, 20, 45); g.fillRect(x + 1, y - 45, 20, 45);
    g.fillStyle = '#c0182c'; g.beginPath(); g.moveTo(x - 20, y); g.lineTo(x + 20, y); g.lineTo(x + 30, y + 16); g.lineTo(x - 30, y + 16); g.closePath(); g.fill();
    glowWin(g, x - 70, y - 48, 30, 22, ph.night || ph.dusk, '#ff9af0');
    glowWin(g, x + 40, y - 48, 30, 22, ph.night || ph.dusk, '#9af0ff');
    // dés
    g.fillStyle = '#fff'; g.save(); g.translate(x + 64, y - 6); g.rotate(0.3); g.fillRect(-7, -7, 14, 14); g.fillStyle = '#c0182c'; g.beginPath(); g.arc(-3, -3, 1.6, 0, Math.PI * 2); g.arc(3, 3, 1.6, 0, Math.PI * 2); g.fill(); g.restore();
  }

  function drawPond(g, x, y, ph, t) {
    // étang
    g.fillStyle = ph.night ? '#1d3558' : '#4fa3d6';
    g.beginPath(); g.ellipse(x - 10, y - 50, 120, 58, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = ph.night ? '#264a78' : '#79c0e8';
    g.beginPath(); g.ellipse(x - 20, y - 56, 92, 38, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) { const k = (t / 3000 + i / 4) % 1; g.globalAlpha = 1 - k; g.beginPath(); g.ellipse(x - 60 + i * 30, y - 50 + (i % 2) * 12, 6 + k * 12, 2 + k * 3, 0, 0, Math.PI * 2); g.stroke(); }
    g.globalAlpha = 1;
    // nénuphars
    g.fillStyle = '#3f9a52';
    for (const [dx, dy] of [[-90, -40], [-70, -70], [30, -84]]) { g.beginPath(); g.arc(x + dx, y + dy, 8, 0.3, Math.PI * 2 - 0.3); g.lineTo(x + dx, y + dy); g.fill(); }
    // ponton
    g.fillStyle = '#9a6a3a'; g.fillRect(x + 30, y - 62, 80, 16);
    g.strokeStyle = '#6b4424'; g.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(x + 32 + i * 10, y - 62); g.lineTo(x + 32 + i * 10, y - 46); g.stroke(); }
    g.fillStyle = '#5a3a1e'; for (const px of [34, 62, 104]) g.fillRect(x + px, y - 46, 4, 10);
    // barque qui flotte
    const bob = Math.sin(t / 700) * 2;
    g.fillStyle = '#8a5a30'; g.beginPath(); g.moveTo(x - 64, y - 52 + bob); g.lineTo(x - 18, y - 52 + bob); g.quadraticCurveTo(x - 24, y - 40 + bob, x - 30, y - 40 + bob); g.lineTo(x - 54, y - 40 + bob); g.quadraticCurveTo(x - 60, y - 42 + bob, x - 64, y - 52 + bob); g.fill();
    // canne et bouchon
    g.strokeStyle = '#6b4424'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 96, y - 64); g.quadraticCurveTo(x + 70, y - 100, x + 40, y - 104); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 40, y - 104); g.lineTo(x + 30, y - 72 + bob); g.stroke();
    g.fillStyle = '#e8343a'; g.beginPath(); g.arc(x + 30, y - 72 + bob, 3, 0, Math.PI * 2); g.fill();
    // poisson qui saute de temps en temps
    const j = (t / 5200) % 1;
    if (j < 0.12) { const k = j / 0.12; g.fillStyle = '#ffb04a'; g.save(); g.translate(x - 100 + k * 40, y - 60 - Math.sin(k * Math.PI) * 26); g.rotate(-0.8 + k * 1.6); g.beginPath(); g.ellipse(0, 0, 8, 4, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(-7, 0); g.lineTo(-13, -4); g.lineTo(-13, 4); g.fill(); g.restore(); }
  }

  function drawMarket(g, x, y, ph, t) {
    const stalls = [[-90, '#e8493a'], [0, '#3b8bff'], [90, '#3ddc5a']];
    for (const [dx, c] of stalls) {
      const sx = x + dx;
      shadow(g, sx, y, 40, 7);
      g.fillStyle = '#8a5a30'; g.fillRect(sx - 34, y - 26, 68, 26);
      g.fillStyle = '#6b4424'; g.fillRect(sx - 34, y - 62, 4, 36); g.fillRect(sx + 30, y - 62, 4, 36);
      for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#fff' : c; g.fillRect(sx - 38 + i * 13, y - 70, 13, 12); }
      g.fillStyle = c; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(sx - 31.5 + i * 13, y - 58, 6.5, 0, Math.PI); g.fill(); }
      // marchandises
      const items = dx < 0 ? ['#ffcf3a', '#ffcf3a', '#e8a020'] : dx === 0 ? ['#b14dff', '#3b8bff', '#ff9a1f'] : ['#7fd65a', '#e84a3a', '#ffd34a'];
      items.forEach((ic, i) => { g.fillStyle = ic; g.beginPath(); g.arc(sx - 18 + i * 18, y - 30, 6, 0, Math.PI * 2); g.fill(); });
    }
    // caisses
    g.fillStyle = '#a8703e'; g.fillRect(x + 128, y - 18, 20, 18); g.fillRect(x + 134, y - 32, 16, 14);
    g.strokeStyle = '#6b4424'; g.lineWidth = 1.5; g.strokeRect(x + 128, y - 18, 20, 18); g.strokeRect(x + 134, y - 32, 16, 14);
  }

  // Taverne : maison à colombages, enseigne à la chope, tonneaux, et des bulles de discussion qui s'échappent
  function drawTavern(g, x, y, ph, t) {
    shadow(g, x, y, 82, 12);
    g.fillStyle = '#e9d9b8'; g.fillRect(x - 66, y - 82, 132, 82);
    g.strokeStyle = '#6b4424'; g.lineWidth = 5;
    g.strokeRect(x - 66, y - 82, 132, 82);
    g.beginPath(); g.moveTo(x - 66, y - 42); g.lineTo(x + 66, y - 42); g.moveTo(x - 22, y - 82); g.lineTo(x - 22, y); g.moveTo(x + 22, y - 82); g.lineTo(x + 22, y);
    g.moveTo(x - 66, y - 82); g.lineTo(x - 22, y - 42); g.moveTo(x + 66, y - 82); g.lineTo(x + 22, y - 42); g.stroke();
    g.fillStyle = '#7a3b2a'; g.beginPath(); g.moveTo(x - 78, y - 78); g.lineTo(x, y - 122); g.lineTo(x + 78, y - 78); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.moveTo(x, y - 122); g.lineTo(x + 78, y - 78); g.lineTo(x, y - 78); g.closePath(); g.fill();
    // porte et fenêtres
    g.fillStyle = '#5a3418'; g.beginPath(); g.roundRect(x - 13, y - 38, 26, 38, [12, 12, 0, 0]); g.fill();
    glowWin(g, x - 56, y - 34, 26, 20, ph.night || ph.dusk, '#ffc46a');
    glowWin(g, x + 30, y - 34, 26, 20, ph.night || ph.dusk, '#ffc46a');
    glowWin(g, x - 12, y - 72, 24, 18, ph.night || ph.dusk, '#ffc46a');
    // enseigne à la chope qui se balance
    const sw = Math.sin(t / 700) * 0.12;
    g.strokeStyle = '#3a2a1a'; g.lineWidth = 3; g.beginPath(); g.moveTo(x + 66, y - 66); g.lineTo(x + 92, y - 66); g.stroke();
    g.save(); g.translate(x + 86, y - 66); g.rotate(sw);
    g.fillStyle = '#c8955a'; g.strokeStyle = '#5a3a1e'; g.lineWidth = 2; g.beginPath(); g.roundRect(-14, 4, 28, 26, 4); g.fill(); g.stroke();
    g.fillStyle = '#ffcf3a'; g.fillRect(-7, 10, 11, 15); g.fillStyle = '#fff'; g.fillRect(-8, 8, 13, 4);
    g.strokeStyle = '#ffcf3a'; g.lineWidth = 2.5; g.beginPath(); g.arc(5, 17, 4, -Math.PI / 2, Math.PI / 2); g.stroke();
    g.restore();
    // tonneaux
    for (const [bx, s] of [[-84, 1], [-70, 0.8]]) {
      g.fillStyle = '#8a5a30'; g.beginPath(); g.ellipse(x + bx, y - 12 * s, 11 * s, 13 * s, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#4e3018'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + bx - 10 * s, y - 16 * s); g.lineTo(x + bx + 10 * s, y - 16 * s); g.moveTo(x + bx - 10 * s, y - 7 * s); g.lineTo(x + bx + 10 * s, y - 7 * s); g.stroke();
    }
    // bulles de discussion qui montent du toit
    for (let i = 0; i < 3; i++) {
      const k = ((t / 2600 + i / 3) % 1);
      const bx = x - 30 + i * 30 + Math.sin(k * 6 + i) * 6;
      const by = y - 126 - k * 46;
      g.globalAlpha = Math.sin(k * Math.PI);
      g.fillStyle = '#fff'; g.beginPath(); g.roundRect(bx - 13, by - 9, 26, 18, 8); g.fill();
      g.beginPath(); g.moveTo(bx - 4, by + 8); g.lineTo(bx - 8, by + 14); g.lineTo(bx + 2, by + 8); g.fill();
      g.fillStyle = ['#ff5a8a', '#3b8bff', '#ff9a1f'][i];
      if (i === 0) heartTiny(g, bx, by);
      else for (let d = -1; d <= 1; d++) { g.beginPath(); g.arc(bx + d * 6, by, 2, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1;
    }
  }
  function heartTiny(g, x, y) {
    g.beginPath(); g.moveTo(x, y + 4); g.bezierCurveTo(x - 7, y - 1, x - 3, y - 7, x, y - 3); g.bezierCurveTo(x + 3, y - 7, x + 7, y - 1, x, y + 4); g.fill();
  }

  function drawSign(g, x, y, ph, t) {
    shadow(g, x, y, 26, 6);
    g.fillStyle = '#6b4424'; g.fillRect(x - 3, y - 70, 6, 70);
    g.fillStyle = '#c8955a';
    g.beginPath(); g.moveTo(x - 34, y - 66); g.lineTo(x + 24, y - 66); g.lineTo(x + 34, y - 58); g.lineTo(x + 24, y - 50); g.lineTo(x - 34, y - 50); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x + 34, y - 44); g.lineTo(x - 24, y - 44); g.lineTo(x - 34, y - 36); g.lineTo(x - 24, y - 28); g.lineTo(x + 34, y - 28); g.closePath(); g.fill();
    g.fillStyle = '#5a3a1e'; g.font = '800 9px system-ui'; g.textAlign = 'center';
    g.fillText('GUIDE', x - 4, y - 55); g.fillText('RÈGLES', x + 4, y - 33);
    // livre ouvert posé au pied
    g.fillStyle = '#fff6dc'; g.beginPath(); g.moveTo(x + 10, y - 4); g.lineTo(x + 22, y - 8); g.lineTo(x + 34, y - 4); g.lineTo(x + 34, y + 2); g.lineTo(x + 22, y - 2); g.lineTo(x + 10, y + 2); g.closePath(); g.fill();
  }

  function drawHero(g, x, y, t) {
    if (!me || !window.drawFighter) return;
    const c = me.character;
    const look = {};
    for (const [slot, item] of Object.entries(c.equipment || {})) if (item) look[slot] = item.rarity;
    shadow(g, x, y - 22, 22, 6);
    drawFighter(g, x, y - 56, { name: me.twitchDisplayName || me.username, cls: c.cls, look, app: c.look }, { scale: 1.45, facing: 1, bob: Math.sin(t / 500) * 1.2 });
  }

  const DRAWERS = { maison: drawHouse, niche: drawNiche, hall: drawHall, donjon: drawDungeon, survivor: drawWilds, arene: drawArena, gym: drawGym, casino: drawCasino, peche: drawPond, commerce: drawMarket, guide: drawSign, taverne: drawTavern };

  function drawGround(g, L, ph, t) {
    const day = ph.night ? ['#1b3a2c', '#14301f'] : ph.dusk ? ['#5e8a4a', '#4a7340'] : ['#7cc36a', '#62ad57'];
    const gr = g.createLinearGradient(0, 0, 0, L.H);
    gr.addColorStop(0, day[0]); gr.addColorStop(1, day[1]);
    g.fillStyle = gr; g.fillRect(0, 0, L.W, L.H);
    // taches d'herbe
    const r = rng(3);
    g.fillStyle = ph.night ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.07)';
    for (let i = 0; i < 60; i++) { g.beginPath(); g.ellipse(r() * L.W, r() * L.H, 30 + r() * 60, 10 + r() * 18, 0, 0, Math.PI * 2); g.fill(); }
    // chemins
    g.lineCap = 'round';
    for (const [w, c] of [[30, ph.night ? '#4d4236' : '#c9a66b'], [22, ph.night ? '#5d5040' : '#dcbd85']]) {
      g.strokeStyle = c; g.lineWidth = w;
      for (const [ax, ay, mx, my, bx, by] of paths(L)) { g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(mx, my, bx, by); g.stroke(); }
    }
    g.lineCap = 'butt';
    // place pavée
    const [px, py] = L.plaza;
    g.fillStyle = ph.night ? '#57506a' : '#cdbfa4'; g.beginPath(); g.ellipse(px, py, 92, 48, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = ph.night ? 'rgba(255,255,255,.08)' : 'rgba(90,70,45,.25)'; g.lineWidth = 1.5;
    for (let rr = 24; rr <= 84; rr += 20) { g.beginPath(); g.ellipse(px, py, rr, rr * 0.52, 0, 0, Math.PI * 2); g.stroke(); }
    // fontaine
    g.fillStyle = ph.night ? '#6c6a80' : '#b7b4c0'; g.beginPath(); g.ellipse(px, py + 4, 26, 12, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = ph.night ? '#2c4f80' : '#6ec0ee'; g.beginPath(); g.ellipse(px, py + 3, 20, 8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = ph.night ? '#6c6a80' : '#b7b4c0'; g.fillRect(px - 3, py - 18, 6, 20);
    for (let i = 0; i < 6; i++) {
      const k = ((t / 900 + i / 6) % 1);
      const a = (i / 6) * Math.PI * 2;
      g.fillStyle = `rgba(200,235,255,${0.8 * (1 - k)})`;
      g.beginPath(); g.arc(px + Math.cos(a) * k * 16, py - 20 + k * 22 - Math.sin(k * Math.PI) * 10, 2, 0, Math.PI * 2); g.fill();
    }
  }

  function drawSky(g, L, ph, t) {
    // Nuages (le jour) ou lucioles (la nuit), par-dessus la carte
    if (ph.night) {
      for (let i = 0; i < 24; i++) {
        const x = (i * 211 + Math.sin(t / 1500 + i) * 30) % L.W;
        const y = 90 + ((i * 137) % (L.H - 140)) + Math.cos(t / 1200 + i) * 12;
        const a = 0.4 + Math.sin(t / 300 + i * 2) * 0.4;
        g.fillStyle = `rgba(220,255,140,${Math.max(0, a)})`;
        g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill();
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const x = ((t / 60 + i * 340) % (L.W + 300)) - 150;
        const y = 40 + i * 90;
        g.fillStyle = 'rgba(0,0,0,.07)';
        g.beginPath(); g.ellipse(x, y + 60, 70, 18, 0, 0, Math.PI * 2); g.fill();
      }
    }
  }

  function draw(now) {
    if (!S.active) return;
    S.raf = requestAnimationFrame(draw);
    if (now - S.last < 33) return; // ~30 images/s suffisent
    S.last = now;
    const g = S.ctx;
    const L = S.layout;
    if (!L) return;
    const ph = skyPhase();
    g.setTransform(S.scale, 0, 0, S.scale, 0, 0);
    drawGround(g, L, ph, now);
    // Tout ce qui est posé au sol, du fond vers l'avant
    const things = S.deco.map((d) => ({ y: d.y, f: () => {
      if (d.kind === 'tree') drawTree(g, d.x, d.y, d.s, d.seed, ph);
      else if (d.kind === 'pine') drawPine(g, d.x, d.y, d.s, ph);
      else if (d.kind === 'flowers') drawFlowers(g, d.x, d.y, d.s, d.seed);
      else if (d.kind === 'rock') drawRock(g, d.x, d.y, d.s);
      else drawLamp(g, d.x, d.y, ph, now);
    } }));
    for (const p of S.places) {
      const [x, y, w] = L.spots[p.id];
      if (p.id === 'heros') { things.push({ y, f: () => drawHero(g, x, y, now) }); continue; }
      const fn = DRAWERS[p.id];
      if (fn) things.push({ y: p.id === 'peche' ? y - 120 : y, f: () => {
        if (S.hover === p.id) { g.save(); g.fillStyle = 'rgba(255, 230, 120, .28)'; g.beginPath(); g.ellipse(x, y, w * 0.55, 18, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
        fn(g, x, y, ph, now);
      } });
    }
    things.sort((a, b) => a.y - b.y);
    for (const th of things) th.f();
    drawSky(g, L, ph, now);
    // Teinte du soir / de la nuit
    if (ph.dusk) { g.fillStyle = 'rgba(255, 120, 60, .10)'; g.fillRect(0, 0, L.W, L.H); }
    if (ph.night) { g.fillStyle = 'rgba(10, 10, 40, .22)'; g.fillRect(0, 0, L.W, L.H); }
  }

  function enter() {
    if (!S.canvas) return;
    S.active = true;
    S.mode = '';
    resize();
    cancelAnimationFrame(S.raf);
    S.last = 0;
    S.raf = requestAnimationFrame(draw);
  }
  function leave() {
    S.active = false;
    cancelAnimationFrame(S.raf);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(S.raf); else if (S.active) S.raf = requestAnimationFrame(draw); });
  window.addEventListener('resize', () => { if (S.active) resize(); });

  window.WorldMap = { init, enter, leave, setBadges, get active() { return S.active; } };
})();
