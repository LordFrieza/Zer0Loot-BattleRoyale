/*
 * Onglet Casino : la salle animée (joueurs qui se promènent entre les tables, croupiers en smoking), la fenêtre
 * de jeu commune (croupier qui parle, solde, mise, effets) et le fil des gros gains. Les six jeux sont dans
 * casino-games.js (window.CasinoGames). Tous les tirages sont faits par le serveur (/api/casino/*).
 * Utilise les globales de la page : me, api, toast, esc, opening, refresh (character.js), Sound, Rules.
 */
(function () {
  const C = Rules.CASINO;
  const W = 1100;
  const H = 500;
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');

  // ---------- Salle ----------
  // Emplacements des six jeux (centre de la table) et du croupier (ses pieds, derrière la table).
  const STATIONS = {
    slots: { x: 185, y: 235, w: 250, h: 120, cx: 300, cy: 200 },
    roulette: { x: 550, y: 238, w: 240, h: 110, cx: 550, cy: 186 },
    blackjack: { x: 915, y: 238, w: 240, h: 110, cx: 915, cy: 186 },
    caisse: { x: 185, y: 420, w: 220, h: 100, cx: 290, cy: 400 },
    glace: { x: 550, y: 420, w: 230, h: 100, cx: 680, cy: 398 },
    gobelets: { x: 915, y: 420, w: 220, h: 100, cx: 915, cy: 372 },
  };
  // Allées (graphe de nœuds) : les promeneurs passent entre les tables et s'arrêtent parfois devant un jeu.
  const NODES = [];
  const COLS = [40, 368, 732, 1060];
  const ROWS = [138, 312, 485];
  for (const y of ROWS) for (const x of COLS) NODES.push({ x, y, links: [] });
  const node = (c, r) => NODES[r * COLS.length + c];
  for (let r = 0; r < ROWS.length; r++) {
    for (let c = 0; c < COLS.length; c++) {
      if (c + 1 < COLS.length) { node(c, r).links.push(node(c + 1, r)); node(c + 1, r).links.push(node(c, r)); }
      if (r + 1 < ROWS.length) { node(c, r).links.push(node(c, r + 1)); node(c, r + 1).links.push(node(c, r)); }
    }
  }
  // Places de spectateur (devant chaque table), reliées à l'allée du dessous.
  for (const [id, s] of Object.entries(STATIONS)) {
    const spot = { x: s.x + (Math.random() - 0.5) * 60, y: s.y + s.h / 2 + 22, links: [], station: id };
    const below = NODES.filter((n) => !n.station).reduce((b, n) => (Math.abs(n.y - spot.y) + Math.abs(n.x - spot.x) * 0.3 < Math.abs(b.y - spot.y) + Math.abs(b.x - spot.x) * 0.3 ? n : b));
    spot.links.push(below);
    below.links.push(spot);
    NODES.push(spot);
  }

  const scene = {
    canvas: null, ctx: null, running: false, last: 0, t: 0,
    walkers: [], hover: null, moods: {}, floats: [], sparkles: [],
  };
  let data = null; // { crowd, feed, sessions }
  let active = false;

  function makeWalker(p, i) {
    const start = NODES[Math.floor(Math.random() * 12)];
    return {
      id: p.id, me: p.me, f: { name: p.name, cls: p.cls, look: p.look || {}, app: p.app || {} },
      x: start.x + (Math.random() - 0.5) * 30, y: start.y + (Math.random() - 0.5) * 16, from: start, to: start,
      wait: Math.random() * 3, speed: 38 + Math.random() * 22, facing: Math.random() < 0.5 ? 1 : -1, phase: i * 1.7, goal: null,
      ox: (Math.random() - 0.5) * 44, oy: (Math.random() - 0.5) * 18, // chacun son côté de l'allée (pas d'empilement)
    };
  }

  function pickNext(w) {
    // Destination imposée (le joueur a cliqué sur un jeu) : on suit les allées vers la place du jeu.
    const here = w.to;
    if (w.goal) {
      const target = NODES.find((n) => n.station === w.goal);
      if (here === target) { w.goal = null; w.wait = 9999; return here; }
      // Plus court chemin (BFS) vers la place
      const prev = new Map([[here, null]]);
      const queue = [here];
      while (queue.length) {
        const n = queue.shift();
        if (n === target) break;
        for (const l of n.links) if (!prev.has(l)) { prev.set(l, n); queue.push(l); }
      }
      let step = target;
      while (prev.get(step) && prev.get(step) !== here) step = prev.get(step);
      return step;
    }
    const options = here.links.filter((l) => l !== w.from || here.links.length === 1);
    const spots = options.filter((l) => l.station);
    if (spots.length && Math.random() < 0.35) return spots[0];
    const lanes = options.filter((l) => !l.station);
    return lanes[Math.floor(Math.random() * lanes.length)] || here.links[0];
  }

  function updateWalkers(dt) {
    for (const w of scene.walkers) {
      if (w.wait > 0) { w.wait -= dt; continue; }
      const dx = w.to.x + w.ox - w.x;
      const dy = w.to.y + w.oy - w.y;
      const d = Math.hypot(dx, dy);
      if (d < 3) {
        const next = pickNext(w);
        w.from = w.to;
        w.to = next;
        if (w.from.station) w.wait = 0; // il quitte la table
        else if (next === w.from) w.wait = 1 + Math.random() * 2;
        if (w.to.station && !w.goal) w.waitAtSpot = true;
        if (w.from.station && w.waitAtSpot) w.waitAtSpot = false;
        continue;
      }
      const step = Math.min(d, w.speed * dt);
      w.x += (dx / d) * step;
      w.y += (dy / d) * step;
      if (Math.abs(dx) > 2) w.facing = dx > 0 ? 1 : -1;
      if (w.to.station && Math.hypot(w.to.x + w.ox - w.x, w.to.y + w.oy - w.y) < 3 && w.wait <= 0 && !w.me) {
        w.wait = 3 + Math.random() * 6;
        const s = STATIONS[w.to.station];
        w.facing = s.x > w.x ? 1 : -1;
      }
    }
  }

  // ---------- Dessin de la salle ----------
  function drawRoom(ctx, t) {
    // Mur du fond : velours bordeaux, boiseries dorées
    const wall = ctx.createLinearGradient(0, 0, 0, 118);
    wall.addColorStop(0, '#2a0a1e');
    wall.addColorStop(1, '#4a1030');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, 118);
    ctx.fillStyle = 'rgba(255,215,120,.06)';
    for (let x = 0; x < W; x += 36) ctx.fillRect(x, 0, 2, 110);
    ctx.fillStyle = '#b8862b';
    ctx.fillRect(0, 108, W, 6);
    ctx.fillStyle = '#6b4512';
    ctx.fillRect(0, 114, W, 6);
    // Enseigne néon
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '900 40px "Orbitron", system-ui, sans-serif';
    const flick = Math.sin(t / 130) > 0.97 ? 0.4 : 1;
    ctx.shadowColor = '#ff3fd8';
    ctx.shadowBlur = 22 * flick;
    ctx.fillStyle = `rgba(255, 120, 230, ${flick})`;
    ctx.fillText('CASINO ZER0LOOT', W / 2, 62);
    ctx.shadowBlur = 0;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillStyle = '#ffd34a';
    ctx.fillText('★ La maison gagne toujours… presque ! ★', W / 2, 88);
    ctx.restore();
    // Ampoules du cadre de l'enseigne
    for (let i = 0; i < 28; i++) {
      const x = W / 2 - 230 + i * 17;
      const on = (Math.floor(t / 180) + i) % 3 === 0;
      ctx.fillStyle = on ? '#fff2a8' : '#7a5a20';
      ctx.beginPath(); ctx.arc(x, 18, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x, 100, 3, 0, Math.PI * 2); ctx.fill();
    }
    // Lustres
    for (const lx of [150, 950]) {
      const g = ctx.createRadialGradient(lx, 40, 4, lx, 40, 90);
      g.addColorStop(0, 'rgba(255,230,160,.55)');
      g.addColorStop(1, 'rgba(255,230,160,0)');
      ctx.fillStyle = g;
      ctx.fillRect(lx - 90, 0, 180, 130);
      ctx.fillStyle = '#ffd34a';
      for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.arc(lx + k * 12, 44 + Math.abs(k) * -3, 4, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillRect(lx - 1, 0, 2, 38);
    }
    // Moquette rouge à losanges dorés
    const floor = ctx.createLinearGradient(0, 120, 0, H);
    floor.addColorStop(0, '#5a0d1c');
    floor.addColorStop(1, '#3a0712');
    ctx.fillStyle = floor;
    ctx.fillRect(0, 120, W, H - 120);
    ctx.strokeStyle = 'rgba(255, 200, 90, .09)';
    ctx.lineWidth = 1;
    for (let k = -H; k < W + H; k += 46) {
      ctx.beginPath(); ctx.moveTo(k, 120); ctx.lineTo(k + (H - 120), H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(k, H); ctx.lineTo(k + (H - 120), 120); ctx.stroke();
    }
    // Lumières des projecteurs au sol
    for (const s of Object.values(STATIONS)) {
      const g = ctx.createRadialGradient(s.x, s.y, 10, s.x, s.y, 170);
      g.addColorStop(0, 'rgba(255, 220, 150, .13)');
      g.addColorStop(1, 'rgba(255, 220, 150, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(s.x - 170, s.y - 170, 340, 340);
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const SLOT_ICONS = Object.values(C.slots.symbols).map((s) => s.icon);
  function drawStation(ctx, id, t, hover) {
    const s = STATIONS[id];
    ctx.save();
    if (hover) { ctx.shadowColor = C.games[id].color; ctx.shadowBlur = 26; }
    switch (id) {
      case 'slots':
        for (let i = 0; i < 3; i++) {
          const x = s.x - 105 + i * 70;
          const y = s.y - 70;
          ctx.fillStyle = ['#8a1a2a', '#1a3a8a', '#1a6a3a'][i];
          roundRect(ctx, x, y, 58, 110, 10); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#ffd34a';
          roundRect(ctx, x + 4, y + 4, 50, 18, 6); ctx.fill();
          ctx.fillStyle = '#2a0a1e';
          ctx.font = '900 10px system-ui'; ctx.textAlign = 'center';
          ctx.fillText('777', x + 29, y + 17);
          ctx.fillStyle = '#fff';
          roundRect(ctx, x + 6, y + 30, 46, 30, 4); ctx.fill();
          ctx.font = '12px system-ui';
          for (let k = 0; k < 3; k++) ctx.fillText(SLOT_ICONS[(Math.floor(t / 400) + i * 2 + k) % SLOT_ICONS.length], x + 14 + k * 15, y + 50);
          ctx.fillStyle = 'rgba(0,0,0,.35)';
          ctx.fillRect(x + 8, y + 70, 42, 6);
          // levier
          ctx.strokeStyle = '#ccc'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(x + 58, y + 50); ctx.lineTo(x + 66, y + 30); ctx.stroke();
          ctx.fillStyle = '#e33'; ctx.beginPath(); ctx.arc(x + 66, y + 28, 4, 0, Math.PI * 2); ctx.fill();
          // ampoules
          for (let k = 0; k < 5; k++) {
            ctx.fillStyle = (Math.floor(t / 150) + k + i) % 2 ? '#fff2a8' : '#a07a20';
            ctx.beginPath(); ctx.arc(x + 9 + k * 10, y + 100, 2.4, 0, Math.PI * 2); ctx.fill();
          }
          if (hover) { ctx.shadowColor = C.games[id].color; ctx.shadowBlur = 26; }
        }
        break;
      case 'roulette': {
        ctx.fillStyle = '#5a3416';
        ctx.beginPath(); ctx.ellipse(s.x, s.y, 122, 54, 0, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#0f6b3a';
        ctx.beginPath(); ctx.ellipse(s.x, s.y - 3, 110, 45, 0, 0, Math.PI * 2); ctx.fill();
        // tapis : cases
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        for (let k = 0; k < 6; k++) ctx.fillRect(s.x - 10 + k * 14, s.y - 18, 12, 30);
        // roue qui tourne doucement
        const wx = s.x - 55;
        const wy = s.y - 4;
        ctx.save();
        ctx.translate(wx, wy);
        ctx.scale(1, 0.5);
        ctx.rotate(t / 900);
        for (let k = 0; k < 18; k++) {
          ctx.fillStyle = k === 0 ? '#1a9a4a' : k % 2 ? '#c4122f' : '#16131f';
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 34, (k / 18) * Math.PI * 2, ((k + 1) / 18) * Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#c99a3a'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'blackjack': {
        ctx.fillStyle = '#5a3416';
        ctx.beginPath(); ctx.ellipse(s.x, s.y - 20, 120, 72, 0, 0, Math.PI); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#0f6b3a';
        ctx.beginPath(); ctx.ellipse(s.x, s.y - 20, 108, 62, 0, 0, Math.PI); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255, 215, 120, .5)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(s.x, s.y - 20, 80, 42, 0, 0.15, Math.PI - 0.15); ctx.stroke();
        for (let k = 0; k < 4; k++) {
          const a = 0.35 + k * 0.8;
          const cx = s.x + Math.cos(a) * 70;
          const cy = s.y - 20 + Math.sin(a) * 34;
          ctx.fillStyle = '#fff';
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(a - Math.PI / 2);
          roundRect(ctx, -7, -10, 14, 20, 2); ctx.fill();
          ctx.fillStyle = k % 2 ? '#c4122f' : '#16131f';
          ctx.font = '9px system-ui'; ctx.textAlign = 'center'; ctx.fillText(['A', 'K', '7', 'Q'][k], 0, 3);
          ctx.restore();
        }
        // jetons
        for (let k = 0; k < 4; k++) {
          ctx.fillStyle = ['#e33', '#36f', '#1a1', '#fd3'][k];
          ctx.beginPath(); ctx.ellipse(s.x - 20 + k * 13, s.y - 6, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'caisse': {
        const glow = 0.5 + Math.sin(t / 300) * 0.5;
        for (const [dx, dy, sc] of [[-60, 0, 1], [0, -8, 1.15], [62, 2, 0.95], [-28, -46, 0.9], [34, -50, 0.85]]) {
          const w = 54 * sc;
          const h = 40 * sc;
          const x = s.x + dx - w / 2;
          const y = s.y + dy - h / 2;
          ctx.fillStyle = '#7a4a1e';
          roundRect(ctx, x, y, w, h, 5); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#d9a441';
          ctx.fillRect(x, y + h * 0.42, w, 4);
          ctx.fillRect(x + w * 0.2, y, 4, h);
          ctx.fillRect(x + w * 0.75, y, 4, h);
          ctx.fillStyle = `rgba(255, 215, 90, ${0.4 + glow * 0.5})`;
          ctx.font = `900 ${14 * sc}px system-ui`; ctx.textAlign = 'center';
          ctx.fillText('?', x + w / 2, y + h * 0.4);
          if (hover) { ctx.shadowColor = C.games[id].color; ctx.shadowBlur = 26; }
        }
        break;
      }
      case 'glace': {
        ctx.fillStyle = '#9fdcff';
        roundRect(ctx, s.x - 100, s.y - 40, 200, 80, 14); ctx.fill();
        ctx.shadowBlur = 0;
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 7; c++) {
            const shine = (Math.sin(t / 500 + r + c * 0.7) + 1) / 2;
            ctx.fillStyle = `rgba(${200 + shine * 55}, ${235 + shine * 20}, 255, .9)`;
            roundRect(ctx, s.x - 92 + c * 26.5, s.y - 33 + r * 22, 23, 19, 4); ctx.fill();
          }
        }
        ctx.strokeStyle = 'rgba(40, 90, 140, .5)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(s.x + 30, s.y - 10); ctx.lineTo(s.x + 44, s.y + 4); ctx.lineTo(s.x + 38, s.y + 16); ctx.stroke();
        break;
      }
      case 'gobelets': {
        ctx.fillStyle = '#3a1a5a';
        ctx.beginPath(); ctx.ellipse(s.x, s.y, 100, 44, 0, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#5a2a8a';
        ctx.beginPath(); ctx.ellipse(s.x, s.y - 3, 90, 36, 0, 0, Math.PI * 2); ctx.fill();
        for (let k = 0; k < 3; k++) {
          const x = s.x - 46 + k * 46 + Math.sin(t / 250 + k * 2) * 4;
          const y = s.y - 6;
          ctx.fillStyle = '#c99a3a';
          ctx.beginPath(); ctx.moveTo(x - 13, y + 8); ctx.lineTo(x - 9, y - 18); ctx.lineTo(x + 9, y - 18); ctx.lineTo(x + 13, y + 8); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#8a6420'; ctx.fillRect(x - 13, y + 4, 26, 4);
        }
        // étincelles
        for (let k = 0; k < 6; k++) {
          const a = t / 600 + k;
          ctx.fillStyle = 'rgba(220, 180, 255, .8)';
          ctx.fillRect(s.x + Math.cos(a) * 80, s.y - 20 + Math.sin(a * 1.3) * 26, 2, 2);
        }
        break;
      }
      default:
    }
    ctx.restore();
    // Plaque : nom du jeu
    ctx.save();
    ctx.font = '800 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const label = `${C.games[id].icon} ${C.games[id].label}`;
    const lw = ctx.measureText(label).width + 18;
    const py = s.y + s.h / 2 - 4;
    ctx.fillStyle = hover ? C.games[id].color : 'rgba(10, 6, 20, .78)';
    roundRect(ctx, s.x - lw / 2, py - 12, lw, 20, 10); ctx.fill();
    ctx.strokeStyle = C.games[id].color; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = hover ? '#120a1e' : '#fff';
    ctx.fillText(label, s.x, py + 2);
    ctx.restore();
  }

  function drawScene(now) {
    const ctx = scene.ctx;
    const t = now;
    drawRoom(ctx, t);
    // Ordre d'affichage par profondeur (y) : croupiers, tables, promeneurs
    const items = [];
    for (const [id, s] of Object.entries(STATIONS)) {
      items.push({ y: s.cy, draw: () => {
        const m = scene.moods[id];
        const mood = m && m.until > now ? m.mood : null;
        const sp = C.games[id].croupier;
        const facing = id === 'blackjack' || id === 'gobelets' ? -1 : 1;
        drawCroupier(ctx, s.cx, s.cy, sp, { t, size: 1.25, mood, facing });
      } });
      items.push({ y: s.y, draw: () => drawStation(ctx, id, t, scene.hover === id) });
    }
    for (const w of scene.walkers) {
      items.push({ y: w.y, draw: () => {
        const moving = w.wait <= 0 && Math.hypot(w.to.x + w.ox - w.x, w.to.y + w.oy - w.y) > 3;
        const bob = moving ? -Math.abs(Math.sin(t / 120 + w.phase)) * 3 : 0;
        drawFighter(ctx, w.x, w.y - 18, w.f, { scale: 1.15, facing: w.facing, bob });
        ctx.save();
        ctx.font = `${w.me ? 800 : 600} 11px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.75)';
        ctx.strokeText(w.f.name, w.x, w.y + 14);
        ctx.fillStyle = w.me ? '#ffd34a' : '#e8ddff';
        ctx.fillText(w.f.name, w.x, w.y + 14);
        if (w.me) {
          ctx.fillStyle = '#ffd34a';
          const ay = w.y - 62 + Math.sin(t / 200) * 3;
          ctx.beginPath(); ctx.moveTo(w.x - 6, ay); ctx.lineTo(w.x + 6, ay); ctx.lineTo(w.x, ay + 8); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      } });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    // Gains qui s'envolent au-dessus des tables
    for (const f of scene.floats) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.font = '900 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
  }

  function loop(now) {
    if (!scene.running) return;
    const dt = Math.min(0.05, (now - (scene.last || now)) / 1000);
    scene.last = now;
    updateWalkers(dt);
    for (const f of scene.floats) { f.y -= 26 * dt; f.life -= dt / 2.2; }
    scene.floats = scene.floats.filter((f) => f.life > 0);
    if (scene.canvas.offsetParent) drawScene(now);
    requestAnimationFrame(loop);
  }

  function canvasPoint(e) {
    const r = scene.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }
  function stationAt(p) {
    for (const [id, s] of Object.entries(STATIONS)) {
      if (Math.abs(p.x - s.x) < s.w / 2 && p.y > s.y - s.h / 2 - 70 && p.y < s.y + s.h / 2 + 6) return id;
    }
    return null;
  }

  function setupScene() {
    if (scene.canvas) return;
    scene.canvas = $('casino-canvas');
    scene.ctx = scene.canvas.getContext('2d');
    scene.canvas.addEventListener('mousemove', (e) => {
      const id = stationAt(canvasPoint(e));
      scene.hover = id;
      scene.canvas.style.cursor = id ? 'pointer' : 'default';
      scene.canvas.title = id ? `${C.games[id].label} — ${C.games[id].desc}` : '';
    });
    scene.canvas.addEventListener('mouseleave', () => { scene.hover = null; });
    scene.canvas.addEventListener('click', (e) => {
      const id = stationAt(canvasPoint(e));
      if (id) openGame(id);
    });
  }

  function setCrowd(crowd) {
    const old = new Map(scene.walkers.map((w) => [w.id, w]));
    scene.walkers = crowd.map((p, i) => {
      const w = old.get(p.id);
      if (w) { w.f = { name: p.name, cls: p.cls, look: p.look || {}, app: p.app || {} }; return w; }
      return makeWalker(p, i);
    });
  }

  // Le croupier réagit (dans la salle et dans la fenêtre de jeu) ; un gain s'envole au-dessus de sa table.
  function react(id, playerWon, amount) {
    scene.moods[id] = { mood: playerWon ? 'win' : 'lose', until: performance.now() + 2600 };
    if (playerWon && amount) {
      const s = STATIONS[id];
      scene.floats.push({ x: s.x, y: s.y - 60, text: `+${fmt(amount)} 🪙`, color: '#ffd34a', life: 1 });
    }
  }

  // ---------- Fil des gros gains et statistiques ----------
  function renderFeed() {
    const feed = (data && data.feed) || [];
    $('casino-feed').innerHTML = `<h3>🏆 Gros gains du casino</h3>
      <div class="casino-feed-list">${feed.length ? feed.map((e) => {
    const G = C.games[e.game] || { icon: '🎲', label: e.game };
    const what = e.text && !e.amount ? `gagne <b class="c-legendaire">${esc(e.text)}</b>` : `gagne <b class="gold-text">${fmt(e.amount)} 🪙</b>${e.text ? ` — <b>${esc(e.text)}</b>` : ''}`;
    return `<div class="casino-feed-row"><span class="cf-ico" style="background:${G.color}">${G.icon}</span>
          <span><b>${esc(e.name)}</b> ${what} <span class="muted">au ${G.label}</span></span>
          <span class="muted cf-when">${whenText(e.at)}</span></div>`;
  }).join('') : '<p class="muted">Aucun gros gain pour l\'instant… À toi de faire sauter la banque !</p>'}</div>`;
  }
  function whenText(at) {
    const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
    if (s < 60) return 'à l\'instant';
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
    return new Date(at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  }
  function renderStats() {
    if (!me) return;
    const L = me.character.lifetime || {};
    const net = (L.casinoWon || 0) - (L.casinoWagered || 0);
    $('casino-stats').innerHTML = `<h3>📊 Mes jeux</h3>
      <div class="casino-stat-grid">
        <div><span class="muted">Parties</span><b>${fmt(L.casinoBets || 0)}</b></div>
        <div><span class="muted">Misé</span><b>${fmt(L.casinoWagered || 0)} 🪙</b></div>
        <div><span class="muted">Gagné</span><b>${fmt(L.casinoWon || 0)} 🪙</b></div>
        <div><span class="muted">Bilan</span><b class="${net >= 0 ? 'up' : 'down'}">${net >= 0 ? '+' : ''}${fmt(net)} 🪙</b></div>
        <div><span class="muted">Plus gros gain</span><b class="gold-text">${fmt(L.casinoBest || 0)} 🪙</b></div>
        <div><span class="muted">Jackpots</span><b>${fmt((me.character.counters || {}).jackpots || 0)}</b></div>
      </div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">Joue pour le plaisir : en moyenne, la maison garde quelques pourcents de chaque mise.</p>`;
  }
  function renderCards() {
    const box = $('casino-games');
    if (box.dataset.ready) return;
    box.dataset.ready = '1';
    box.innerHTML = Object.entries(C.games).map(([id, g]) => `<button class="casino-card" data-cgame="${id}" style="--gc:${g.color}">
        <canvas width="110" height="96" data-ccroup="${g.croupier}"></canvas>
        <div class="cc-body"><div class="cc-title">${g.icon} ${g.label}</div>
        <div class="cc-desc">${g.desc}</div>
        <div class="cc-price">${id === 'caisse' ? `${C.caisse.price} 🪙 la caisse` : `Mise ${C.bets[0]} à ${C.maxBet} 🪙`}</div></div>
      </button>`).join('');
    box.querySelectorAll('[data-cgame]').forEach((b) => { b.onclick = () => openGame(b.dataset.cgame); });
    box.querySelectorAll('canvas[data-ccroup]').forEach((cv) => {
      drawCroupier(cv.getContext('2d'), 55, 90, cv.dataset.ccroup, { t: 900, size: 1.15 });
    });
  }

  // ---------- Fenêtre de jeu ----------
  const LINES = {
    dragon: { hello: ['Faites chauffer les rouleaux !', 'Trois 7 et je vous crache un trésor !', 'Bienvenue au 777 de Pyrax !'], win: ['Grr… bien joué.', 'Mon or ! MON OR !', 'Je vais devoir rallumer ma forge…'], lose: ['Hé hé hé, la maison gagne !', 'Encore un tour ? Allez…', 'Merci pour la contribution !'] },
    maexxna: { hello: ['Asseyez-vous… je ne mords pas. Presque.', 'Huit pattes, huit mains de cartes.', 'Faites vos jeux, petite mouche.'], win: ['Ssss… vous avez de la chance.', 'Ma toile a un trou…', 'Bien joué, insecte.'], lose: ['Prise dans ma toile !', 'Délicieux.', 'La banque tisse toujours.'] },
    troll: { hello: ['GROKK FAIT TOURNER ROUE !', 'Toi miser. Grokk lancer.', 'Rouge ou noir ? Grokk aime rouge.'], win: ['GRRR ! Toi gagner ?!', 'Grokk pas content…', 'Grokk recompter… toi gagner.'], lose: ['HA HA ! Grokk garder sous !', 'Roue aimer Grokk !', 'Encore ! Encore !'] },
    mimic: { hello: ['Ouvre-moi… enfin, ouvre une caisse.', 'Je suis un coffre. Je connais les coffres.', 'Miam… je veux dire, bonne chance !'], win: ['Mais… c\'était MON lot préféré !', 'Bien joué, chasseur de trésor.', 'Gloups.'], lose: ['Croc croc ! Petit lot !', 'La prochaine sera la bonne… peut-être.', 'Encore une ? Elles sont toutes neuves !'] },
    liche: { hello: ['La glace est fine… très fine.', 'Brisez-la, si vous l\'osez.', 'Le froid ne pardonne pas.'], win: ['Vous avez le cœur bien accroché.', 'Le lac vous épargne… pour cette fois.', 'Glacial… pour moi.'], lose: ['Craaac ! Plouf.', 'Le lac garde tout.', 'Vous êtes gelé… et ruiné.'] },
    sorcier: { hello: ['Regardez bien la bille…', 'Abracadabra ! Où est-elle ?', 'Mes mains sont plus rapides que vos yeux.'], win: ['Impossible ! Un sort de vision ?', 'Bien vu… trop bien vu.', 'Hmpf. Chance de débutant.'], lose: ['Pouf ! Disparue !', 'La magie, c\'est de l\'illusion.', 'Encore un tour de passe-passe ?'] },
  };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const cm = { el: null, id: null, gold: 0, busy: false, raf: 0, moodUntil: 0, mood: null, fx: null };

  function buildModal() {
    if (cm.el) return;
    const el = document.createElement('div');
    el.className = 'casino-modal';
    el.innerHTML = `<canvas class="casino-fx"></canvas>
      <div class="cm-box">
        <div class="cm-head">
          <canvas class="cm-croup" width="150" height="130"></canvas>
          <div class="cm-speech"></div>
          <div class="cm-info"><div class="cm-title"></div><div class="cm-gold"></div></div>
          <button class="secondary small cm-close" title="Quitter la table (Échap)">✕</button>
        </div>
        <div class="cm-body"></div>
      </div>
      <div class="cm-banner"></div>`;
    document.body.appendChild(el);
    cm.el = el;
    cm.box = el.querySelector('.cm-box');
    cm.croup = el.querySelector('.cm-croup');
    cm.speech = el.querySelector('.cm-speech');
    cm.title = el.querySelector('.cm-title');
    cm.goldEl = el.querySelector('.cm-gold');
    cm.body = el.querySelector('.cm-body');
    cm.banner = el.querySelector('.cm-banner');
    cm.fx = new window.ZLParticles(el.querySelector('.casino-fx'));
    el.querySelector('.cm-close').onclick = closeGame;
    el.addEventListener('mousedown', (e) => { if (e.target === el) closeGame(); });
    document.addEventListener('keydown', (e) => { if (e.code === 'Escape' && cm.el.classList.contains('open')) closeGame(); });
  }

  function croupLoop(now) {
    if (!cm.el.classList.contains('open')) return;
    const ctx = cm.croup.getContext('2d');
    ctx.clearRect(0, 0, 150, 130);
    const g = ctx.createRadialGradient(75, 80, 10, 75, 80, 75);
    g.addColorStop(0, 'rgba(255, 220, 150, .35)');
    g.addColorStop(1, 'rgba(255, 220, 150, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 150, 130);
    const mood = cm.moodUntil > now ? cm.mood : null;
    drawCroupier(ctx, 75, 122, C.games[cm.id].croupier, { t: now, size: 1.9, mood });
    cm.raf = requestAnimationFrame(croupLoop);
  }

  function say(text) {
    cm.speech.textContent = text;
    cm.speech.classList.remove('pop');
    void cm.speech.offsetWidth;
    cm.speech.classList.add('pop');
  }

  function showGold() {
    cm.goldEl.innerHTML = `🪙 <b>${fmt(cm.gold)}</b>`;
  }

  function openGame(id) {
    buildModal();
    if (cm.busy) return;
    cm.id = id;
    const G = C.games[id];
    cm.el.style.setProperty('--gc', G.color);
    cm.title.innerHTML = `${G.icon} ${G.label} <span class="muted">avec ${Rules.BOSSES[G.croupier].short}</span>`;
    cm.gold = me.character.gold;
    showGold();
    cm.body.innerHTML = '';
    cm.banner.className = 'cm-banner';
    cm.el.classList.add('open');
    cancelAnimationFrame(cm.raf);
    cm.raf = requestAnimationFrame(croupLoop);
    say(pick(LINES[G.croupier].hello));
    window.CasinoGames[id].mount(cm.body, api_);
    // Mon personnage se rend à la table
    const meW = scene.walkers.find((w) => w.me);
    if (meW) { meW.goal = id; meW.wait = 0; }
    Sound.play('chip');
  }

  function closeGame() {
    if (!cm.el || !cm.el.classList.contains('open')) return;
    if (cm.busy) { toast('⏳ Attends la fin du tour !'); return; }
    const game = window.CasinoGames[cm.id];
    if (game && game.unmount) game.unmount();
    cm.el.classList.remove('open');
    cancelAnimationFrame(cm.raf);
    const meW = scene.walkers.find((w) => w.me);
    if (meW) { meW.goal = null; meW.wait = 0.5; }
    finish();
  }

  // Fin d'un tour : la page reprend ses mises à jour (solde du bandeau, etc.).
  function finish() {
    opening = false;
    if (typeof refresh === 'function') refresh().then(() => { if (cm.el && !cm.busy) { cm.gold = me.character.gold; showGold(); } renderStats(); }).catch(() => {});
  }

  // Outils fournis aux jeux
  const api_ = {
    C,
    fmt,
    get gold() { return cm.gold; },
    // Appel serveur : la mise est retirée tout de suite à l'écran ; la page ne se met plus à jour avant la fin de l'animation.
    async call(url, body, stake = 0) {
      if (cm.busy) return null;
      try {
        cm.busy = true;
        opening = true;
        const r = await api(url, body);
        cm.gold -= stake;
        showGold();
        return r;
      } catch (err) {
        cm.busy = false;
        opening = false;
        toast('⚠️ ' + err.message);
        return null;
      }
    },
    // Résultat affiché : gain crédité, croupier qui réagit, effets.
    settle(payout, stake, opts = {}) {
      cm.gold += payout;
      showGold();
      const won = opts.win != null ? opts.win : payout > stake;
      const mult = stake ? payout / stake : 0;
      cm.mood = won ? 'win' : 'lose';
      cm.moodUntil = performance.now() + 2600;
      react(cm.id, won, payout > 0 ? payout : 0);
      const croup = C.games[cm.id].croupier;
      if (won) {
        say(pick(LINES[croup].win));
        Sound.play(opts.jackpot ? 'jackpot' : 'casinoWin', mult);
        const r = cm.box.getBoundingClientRect();
        const n = mult >= 10 || opts.jackpot ? 260 : mult >= 3 ? 120 : 50;
        cm.fx.spawn(r.left + r.width / 2, r.top + r.height * 0.45, '#ffd34a', n, mult >= 10 ? 2.2 : 1.4);
        if (mult >= 10 || opts.jackpot) setTimeout(() => cm.fx.spawn(r.left + r.width * 0.25, r.top + r.height * 0.4, '#ff6bd5', 120, 1.8), 220);
        if (opts.banner || mult >= 10) banner(opts.banner || `GROS GAIN ! +${fmt(payout)} 🪙`, opts.jackpot ? 'jackpot' : 'big');
      } else if (payout > 0 && !opts.quiet) {
        say(payout === stake ? 'Égalité… on remet ça ?' : pick(LINES[croup].lose));
        Sound.play('coin');
      } else {
        say(pick(LINES[croup].lose));
        Sound.play('casinoLose');
      }
      cm.busy = false;
      finish();
    },
    // Fin d'un coup sans règlement (partie en plusieurs coups qui continue)
    idle() { cm.busy = false; opening = false; },
    say,
    banner,
    burst(x, y, color, n = 60, power = 1.2) { cm.fx.spawn(x, y, color, n, power); },
    sessions: () => (data && data.sessions) || {},
    setSession(id, v) { if (!data) data = { crowd: [], feed: [], sessions: {} }; if (!data.sessions) data.sessions = {}; data.sessions[id] = v; },
    get box() { return cm.box; },
  };

  function banner(text, kind = 'big') {
    cm.banner.textContent = text;
    cm.banner.className = `cm-banner ${kind}`;
    void cm.banner.offsetWidth;
    cm.banner.classList.add('show');
    setTimeout(() => cm.banner.classList.remove('show'), kind === 'jackpot' ? 3600 : 2400);
  }

  // Sélecteur de mise (dernière mise retenue par jeu)
  function betPicker(container, gameId, onChange) {
    let bet;
    try { bet = Number(localStorage.getItem('zl_bet_' + gameId)); } catch (e) { bet = 0; }
    if (!C.bets.includes(bet)) bet = C.bets[0];
    container.innerHTML = '<span class="muted">Mise :</span>' + C.bets.map((b) => `<button type="button" class="casino-chip chip-${b}" data-bet="${b}">${b}</button>`).join('');
    const sync = () => container.querySelectorAll('[data-bet]').forEach((el) => el.classList.toggle('active', Number(el.dataset.bet) === bet));
    container.querySelectorAll('[data-bet]').forEach((el) => {
      el.onclick = () => {
        bet = Number(el.dataset.bet);
        try { localStorage.setItem('zl_bet_' + gameId, String(bet)); } catch (e) { /* ignore */ }
        Sound.play('chip');
        sync();
        if (onChange) onChange(bet);
      };
    });
    sync();
    return { get value() { return bet; } };
  }
  api_.betPicker = betPicker;

  // ---------- Entrée / sortie de l'onglet ----------
  async function load() {
    try {
      data = await api('/api/casino');
      setCrowd(data.crowd);
      renderFeed();
    } catch (e) { /* hors ligne : la salle reste vide */ }
  }

  function enter() {
    if (!me) return;
    active = true;
    setupScene();
    renderCards();
    renderStats();
    load();
    if (!scene.running) { scene.running = true; scene.last = 0; requestAnimationFrame(loop); }
    Sound.music.stop(0.2);
    setTimeout(() => { if (active) Sound.music.start(0, 'casino'); }, 250);
  }

  function leave() {
    if (!active) return;
    active = false;
    scene.running = false;
    if (cm.el && cm.el.classList.contains('open') && !cm.busy) closeGame();
    if (Sound.music.state && /casino/.test(Sound.music.state.src || '')) Sound.music.stop();
  }

  window.Casino = {
    enter,
    leave,
    onFeed(feed) { if (data) data.feed = feed; else data = { feed, crowd: [], sessions: {} }; if (active) renderFeed(); },
    renderStats,
    openGame,
    get active() { return active; },
  };
})();
