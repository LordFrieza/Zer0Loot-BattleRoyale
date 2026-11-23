/*
 * Dessins de la pêche : les 100 créatures du Pêchédex (18 formes, couleurs et motifs de Rules.FISH), le coffre
 * au trésor et la silhouette noire des espèces pas encore pêchées.
 * drawFish(ctx, x, y, fish, { size, t, shadow, facing, alpha }) : (x, y) = centre ; size = longueur en px.
 */
(function () {
  const INK = '#1d1a26';

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const f = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }

  // Motif sur le corps (déjà « clippé » à la forme) : rayures, points, écailles, dégradé.
  function pattern(ctx, f, w, h, shadow) {
    if (shadow) return;
    if (f.pattern === 'rayures') {
      ctx.fillStyle = shade(f.accent, -0.1);
      ctx.globalAlpha *= 0.75;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.ellipse(i * w * 0.16, 0, w * 0.035, h * 0.6, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha /= 0.75;
    } else if (f.pattern === 'points') {
      ctx.fillStyle = shade(f.accent, -0.05);
      for (let i = 0; i < 9; i++) { const px = ((i * 37) % 100) / 100 - 0.5; const py = ((i * 61) % 100) / 100 - 0.5; ctx.beginPath(); ctx.arc(px * w * 0.7, py * h * 0.6, Math.max(1, w * 0.035), 0, Math.PI * 2); ctx.fill(); }
    } else if (f.pattern === 'ecailles') {
      ctx.strokeStyle = shade(f.color, -0.25);
      ctx.lineWidth = Math.max(0.6, w * 0.012);
      for (let i = -3; i <= 3; i++) for (let j = -1; j <= 1; j++) { ctx.beginPath(); ctx.arc(i * w * 0.1 + (j % 2) * w * 0.05, j * h * 0.22, w * 0.05, -Math.PI / 2, Math.PI / 2); ctx.stroke(); }
    } else if (f.pattern === 'degrade') {
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, f.accent);
      ctx.globalAlpha *= 0.6; ctx.fillStyle = g; ctx.fillRect(-w / 2, -h, w, h * 2); ctx.globalAlpha /= 0.6;
    }
  }

  function eye(ctx, x, y, r, shadow) {
    if (shadow) return;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(x + r * 0.25, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + r * 0.4, y - r * 0.3, r * 0.2, 0, Math.PI * 2); ctx.fill();
  }

  // Corps de poisson générique : ellipse effilée, queue fourchue, nageoires ; `tall` pour les poissons hauts.
  function fishBody(ctx, f, L, t, shadow, o = {}) {
    const w = L;
    const h = L * (o.tall || 0.42);
    const wag = Math.sin(t / 160) * 0.18;
    const body = shadow ? INK : f.color;
    const fin = shadow ? INK : shade(f.color, -0.2);
    // queue
    ctx.save(); ctx.translate(-w * 0.42, 0); ctx.rotate(wag);
    ctx.fillStyle = fin;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-w * 0.26, -h * 0.55); ctx.quadraticCurveTo(-w * 0.16, 0, -w * 0.26, h * 0.55); ctx.closePath(); ctx.fill();
    ctx.restore();
    // nageoires dorsale et ventrale
    ctx.fillStyle = fin;
    ctx.beginPath(); ctx.moveTo(-w * 0.18, -h * 0.4); ctx.quadraticCurveTo(0, -h * (o.sail ? 1.25 : 0.85), w * 0.16, -h * 0.42); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-w * 0.08, h * 0.4); ctx.quadraticCurveTo(0, h * 0.7, w * 0.08, h * 0.42); ctx.closePath(); ctx.fill();
    // corps
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, 0, w * 0.46, h * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = body; ctx.fill();
    if (!shadow) {
      ctx.clip();
      ctx.fillStyle = f.accent; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.ellipse(0, h * 0.32, w * 0.46, h * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      pattern(ctx, f, w, h, shadow);
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.ellipse(-w * 0.05, -h * 0.22, w * 0.25, h * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    if (!shadow) { ctx.strokeStyle = shade(f.color, -0.45); ctx.lineWidth = Math.max(1, L * 0.02); ctx.beginPath(); ctx.ellipse(0, 0, w * 0.46, h * 0.5, 0, 0, Math.PI * 2); ctx.stroke(); }
    // ouïe et œil
    if (!shadow) { ctx.strokeStyle = shade(f.color, -0.35); ctx.lineWidth = Math.max(1, L * 0.018); ctx.beginPath(); ctx.arc(w * 0.18, 0, h * 0.3, -1.1, 1.1); ctx.stroke(); }
    eye(ctx, w * 0.3, -h * 0.1, Math.max(1.5, L * 0.055), shadow);
    // sourire
    if (!shadow) { ctx.strokeStyle = INK; ctx.lineWidth = Math.max(0.8, L * 0.012); ctx.beginPath(); ctx.arc(w * 0.4, h * 0.08, L * 0.035, 0.2, 1.6); ctx.stroke(); }
  }

  const SHAPES = {
    poisson(ctx, f, L, t, s) { fishBody(ctx, f, L, t, s); },
    lune(ctx, f, L, t, s) { fishBody(ctx, f, L * 0.85, t, s, { tall: 0.85 }); },
    ange(ctx, f, L, t, s) { fishBody(ctx, f, L * 0.8, t, s, { tall: 0.75, sail: true }); },
    long(ctx, f, L, t, s) {
      ctx.save(); ctx.scale(1, 0.62); fishBody(ctx, f, L * 1.1, t, s); ctx.restore();
      if (f.id === 'espadon' || f.id === 'poisson_scie') { ctx.strokeStyle = s ? INK : shade(f.color, -0.2); ctx.lineWidth = Math.max(2, L * 0.04); ctx.beginPath(); ctx.moveTo(L * 0.5, 0); ctx.lineTo(L * 0.85, -L * 0.01); ctx.stroke(); }
    },
    requin(ctx, f, L, t, s) {
      ctx.save(); ctx.scale(1, 0.7); fishBody(ctx, f, L * 1.05, t, s, { sail: true }); ctx.restore();
      if (f.id === 'marteau') { ctx.fillStyle = s ? INK : f.color; ctx.fillRect(L * 0.38, -L * 0.16, L * 0.08, L * 0.32); }
      if (!s) { ctx.strokeStyle = shade(f.color, -0.4); ctx.lineWidth = 1; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(L * 0.2 - i * L * 0.04, -L * 0.06); ctx.lineTo(L * 0.18 - i * L * 0.04, L * 0.06); ctx.stroke(); } }
    },
    plat(ctx, f, L, t, s) {
      ctx.fillStyle = s ? INK : f.color;
      ctx.beginPath(); ctx.ellipse(0, 0, L * 0.45, L * 0.28, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.clip(); pattern(ctx, f, L, L * 0.5, s); ctx.restore();
      ctx.beginPath(); ctx.moveTo(-L * 0.42, 0); ctx.lineTo(-L * 0.6, -L * 0.12); ctx.lineTo(-L * 0.6, L * 0.12); ctx.closePath(); ctx.fill();
      eye(ctx, L * 0.2, -L * 0.1, Math.max(1.5, L * 0.04), s); eye(ctx, L * 0.26, -L * 0.02, Math.max(1.5, L * 0.04), s);
    },
    raie(ctx, f, L, t, s) {
      const flap = Math.sin(t / 300) * L * 0.05;
      ctx.fillStyle = s ? INK : f.color;
      ctx.beginPath(); ctx.moveTo(L * 0.32, 0); ctx.quadraticCurveTo(0, -L * 0.5 - flap, -L * 0.2, -L * 0.42 - flap); ctx.quadraticCurveTo(-L * 0.12, 0, -L * 0.2, L * 0.42 + flap); ctx.quadraticCurveTo(0, L * 0.5 + flap, L * 0.32, 0); ctx.fill();
      ctx.save(); ctx.clip(); pattern(ctx, f, L, L * 0.6, s); ctx.restore();
      ctx.strokeStyle = s ? INK : shade(f.color, -0.3); ctx.lineWidth = Math.max(1, L * 0.025);
      ctx.beginPath(); ctx.moveTo(-L * 0.15, 0); ctx.quadraticCurveTo(-L * 0.45, Math.sin(t / 200) * L * 0.06, -L * 0.7, 0); ctx.stroke();
      eye(ctx, L * 0.18, -L * 0.07, Math.max(1.4, L * 0.035), s); eye(ctx, L * 0.18, L * 0.07, Math.max(1.4, L * 0.035), s);
    },
    anguille(ctx, f, L, t, s) {
      ctx.strokeStyle = s ? INK : f.color; ctx.lineCap = 'round'; ctx.lineWidth = L * 0.12;
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) { const u = i / 20; const x = L * (0.5 - u); const y = Math.sin(u * 7 + t / 180) * L * 0.08 * u; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
      if (!s) { ctx.strokeStyle = f.accent; ctx.lineWidth = L * 0.035; ctx.globalAlpha = 0.7; ctx.stroke(); ctx.globalAlpha = 1; }
      eye(ctx, L * 0.44, -L * 0.02, Math.max(1.4, L * 0.035), s);
    },
    meduse(ctx, f, L, t, s) {
      const pulse = 1 + Math.sin(t / 350) * 0.06;
      ctx.save(); ctx.rotate(-Math.PI / 2); // tête en haut quelle que soit la direction
      ctx.strokeStyle = s ? INK : f.accent; ctx.lineWidth = Math.max(1, L * 0.025); ctx.globalAlpha *= s ? 1 : 0.8;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(-L * 0.05, i * L * 0.07); for (let k = 1; k <= 6; k++) ctx.lineTo(-L * 0.05 - k * L * 0.08, i * L * 0.07 + Math.sin(t / 220 + k + i) * L * 0.03); ctx.stroke(); }
      ctx.fillStyle = s ? INK : f.color;
      ctx.beginPath(); ctx.ellipse(0, 0, L * 0.28 * pulse, L * 0.3 / pulse, 0, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
      if (!s) { ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.beginPath(); ctx.ellipse(L * 0.12, -L * 0.08, L * 0.08, L * 0.05, 0, 0, Math.PI * 2); ctx.fill(); pattern(ctx, f, L * 0.5, L * 0.3, s); }
      ctx.restore();
      eye(ctx, -L * 0.07, -L * 0.12, Math.max(1.2, L * 0.03), s); eye(ctx, L * 0.07, -L * 0.12, Math.max(1.2, L * 0.03), s);
    },
    poulpe(ctx, f, L, t, s) {
      ctx.fillStyle = s ? INK : f.color;
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * 0.15 + (i / 5) * Math.PI * 0.7;
        ctx.strokeStyle = s ? INK : shade(f.color, -0.1); ctx.lineWidth = L * 0.07; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, L * 0.05);
        ctx.quadraticCurveTo(Math.cos(a) * L * 0.3 + Math.sin(t / 250 + i) * L * 0.05, L * 0.2, Math.cos(a) * L * 0.42, L * 0.38 + Math.sin(t / 200 + i) * L * 0.04);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.ellipse(0, -L * 0.12, L * 0.26, L * 0.28, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.clip(); pattern(ctx, f, L * 0.6, L * 0.5, s); ctx.restore();
      eye(ctx, -L * 0.09, -L * 0.08, Math.max(1.5, L * 0.045), s); eye(ctx, L * 0.09, -L * 0.08, Math.max(1.5, L * 0.045), s);
    },
    calmar(ctx, f, L, t, s) {
      ctx.fillStyle = s ? INK : f.color;
      ctx.beginPath(); ctx.moveTo(L * 0.48, 0); ctx.quadraticCurveTo(L * 0.2, -L * 0.2, -L * 0.05, -L * 0.14); ctx.lineTo(-L * 0.05, L * 0.14); ctx.quadraticCurveTo(L * 0.2, L * 0.2, L * 0.48, 0); ctx.fill();
      ctx.save(); ctx.clip(); pattern(ctx, f, L, L * 0.4, s); ctx.restore();
      ctx.strokeStyle = s ? INK : shade(f.color, -0.15); ctx.lineWidth = L * 0.035; ctx.lineCap = 'round';
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(-L * 0.05, i * L * 0.04); ctx.quadraticCurveTo(-L * 0.25, i * L * 0.06 + Math.sin(t / 200 + i) * L * 0.04, -L * 0.45, i * L * 0.09); ctx.stroke(); }
      eye(ctx, L * 0.02, -L * 0.07, Math.max(1.4, L * 0.04), s);
    },
    crabe(ctx, f, L, t, s) {
      const c = s ? INK : f.color;
      ctx.strokeStyle = c; ctx.lineWidth = L * 0.04; ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(side * L * 0.15, L * 0.02 + i * L * 0.06); ctx.lineTo(side * L * 0.35, L * 0.12 + i * L * 0.06 + Math.sin(t / 150 + i) * L * 0.02); ctx.stroke(); }
      ctx.fillStyle = c;
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(side * L * 0.36, -L * 0.18, L * 0.1, L * 0.07, side * 0.4, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(side * L * 0.2, -L * 0.05); ctx.lineTo(side * L * 0.32, -L * 0.14); ctx.stroke(); }
      ctx.beginPath(); ctx.ellipse(0, 0, L * 0.26, L * 0.18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.clip(); pattern(ctx, f, L * 0.5, L * 0.3, s); ctx.restore();
      eye(ctx, -L * 0.07, -L * 0.17, Math.max(1.3, L * 0.035), s); eye(ctx, L * 0.07, -L * 0.17, Math.max(1.3, L * 0.035), s);
    },
    crevette(ctx, f, L, t, s) {
      ctx.fillStyle = s ? INK : f.color;
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(L * 0.25 - i * L * 0.12, Math.sin(i * 0.6) * L * 0.08, L * 0.09 - i * L * 0.008, L * 0.1 - i * L * 0.01, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.beginPath(); ctx.moveTo(-L * 0.3, L * 0.1); ctx.lineTo(-L * 0.45, L * 0.02); ctx.lineTo(-L * 0.42, L * 0.2); ctx.fill();
      ctx.strokeStyle = s ? INK : f.accent; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L * 0.32, -L * 0.04); ctx.quadraticCurveTo(L * 0.5, -L * 0.25, L * 0.6, -L * 0.12 + Math.sin(t / 200) * L * 0.03); ctx.stroke();
      eye(ctx, L * 0.28, -L * 0.04, Math.max(1.2, L * 0.03), s);
    },
    tortue(ctx, f, L, t, s) {
      const c = s ? INK : shade(f.accent, -0.2);
      ctx.fillStyle = c;
      for (const [x, y] of [[0.22, -0.2], [0.22, 0.2], [-0.22, -0.2], [-0.22, 0.2]]) { ctx.beginPath(); ctx.ellipse(x * L + Math.sin(t / 300) * L * 0.02, y * L, L * 0.08, L * 0.05, x > 0 ? 0.5 : -0.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.beginPath(); ctx.ellipse(L * 0.38, 0, L * 0.1, L * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = s ? INK : f.color;
      ctx.beginPath(); ctx.ellipse(0, 0, L * 0.3, L * 0.24, 0, 0, Math.PI * 2); ctx.fill();
      if (!s) { ctx.strokeStyle = shade(f.color, -0.35); ctx.lineWidth = Math.max(1, L * 0.02); for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(i * L * 0.12, 0, L * 0.07, 0, Math.PI * 2); ctx.stroke(); } }
      eye(ctx, L * 0.41, -L * 0.03, Math.max(1.2, L * 0.03), s);
    },
    hippocampe(ctx, f, L, t, s) {
      ctx.save(); ctx.rotate(-Math.PI / 2 + Math.sin(t / 400) * 0.1);
      ctx.strokeStyle = s ? INK : f.color; ctx.lineCap = 'round'; ctx.lineWidth = L * 0.13;
      ctx.beginPath(); ctx.moveTo(L * 0.25, 0); ctx.quadraticCurveTo(0, L * 0.12, -L * 0.22, 0); ctx.quadraticCurveTo(-L * 0.36, -L * 0.1, -L * 0.3, -L * 0.18); ctx.stroke();
      ctx.lineWidth = L * 0.04; ctx.beginPath(); ctx.arc(-L * 0.24, -L * 0.18, L * 0.06, 0, Math.PI * 1.5); ctx.stroke();
      ctx.fillStyle = s ? INK : f.color; ctx.beginPath(); ctx.ellipse(L * 0.3, -L * 0.03, L * 0.1, L * 0.07, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(L * 0.36, -L * 0.08, L * 0.14, L * 0.04);
      if (!s) { ctx.strokeStyle = f.accent; ctx.lineWidth = Math.max(1, L * 0.02); for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(L * 0.18 - i * L * 0.09, -L * 0.04); ctx.lineTo(L * 0.18 - i * L * 0.09, L * 0.08); ctx.stroke(); } }
      ctx.restore();
      eye(ctx, L * 0.02, -L * 0.3, Math.max(1.2, L * 0.03), s);
    },
    globe(ctx, f, L, t, s) {
      const puff = 1 + Math.max(0, Math.sin(t / 700)) * 0.12;
      ctx.fillStyle = s ? INK : shade(f.color, -0.2);
      ctx.beginPath(); ctx.moveTo(-L * 0.3, 0); ctx.lineTo(-L * 0.45, -L * 0.12); ctx.lineTo(-L * 0.45, L * 0.12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = s ? INK : f.color;
      ctx.beginPath(); ctx.arc(0, 0, L * 0.32 * puff, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = s ? INK : shade(f.color, -0.35); ctx.lineWidth = Math.max(1, L * 0.02);
      for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * L * 0.3 * puff, Math.sin(a) * L * 0.3 * puff); ctx.lineTo(Math.cos(a) * L * 0.38 * puff, Math.sin(a) * L * 0.38 * puff); ctx.stroke(); }
      ctx.save(); ctx.beginPath(); ctx.arc(0, 0, L * 0.32 * puff, 0, Math.PI * 2); ctx.clip(); pattern(ctx, f, L * 0.6, L * 0.6, s); ctx.restore();
      eye(ctx, L * 0.14, -L * 0.08, Math.max(1.5, L * 0.05), s);
    },
    etoile(ctx, f, L, t, s) {
      ctx.save(); ctx.rotate(t / 4000);
      ctx.fillStyle = s ? INK : f.color;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? L * 0.16 : L * 0.4; const a = (i / 10) * Math.PI * 2 - Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
      ctx.save(); ctx.clip(); pattern(ctx, f, L * 0.8, L * 0.6, s); ctx.restore();
      ctx.restore();
      eye(ctx, -L * 0.06, -L * 0.03, Math.max(1.2, L * 0.03), s); eye(ctx, L * 0.06, -L * 0.03, Math.max(1.2, L * 0.03), s);
    },
    axolotl(ctx, f, L, t, s) {
      ctx.strokeStyle = s ? INK : f.color; ctx.lineCap = 'round'; ctx.lineWidth = L * 0.14;
      ctx.beginPath(); ctx.moveTo(L * 0.2, 0); ctx.quadraticCurveTo(-L * 0.1, Math.sin(t / 250) * L * 0.06, -L * 0.42, Math.sin(t / 200) * L * 0.08); ctx.stroke();
      ctx.fillStyle = s ? INK : f.color;
      ctx.beginPath(); ctx.ellipse(L * 0.28, 0, L * 0.15, L * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      // branchies en plumes
      ctx.strokeStyle = s ? INK : f.accent; ctx.lineWidth = L * 0.03;
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(L * 0.22, side * L * 0.06); ctx.lineTo(L * 0.12 - i * L * 0.03, side * (L * 0.16 + i * L * 0.03)); ctx.stroke(); }
      for (const [x, y] of [[0.1, 0.1], [-0.15, 0.1]]) { ctx.lineWidth = L * 0.04; ctx.strokeStyle = s ? INK : f.color; ctx.beginPath(); ctx.moveTo(x * L, 0); ctx.lineTo(x * L + L * 0.03, y * L + L * 0.04); ctx.stroke(); }
      eye(ctx, L * 0.33, -L * 0.03, Math.max(1.3, L * 0.03), s);
      if (!s) { ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(L * 0.36, L * 0.03, L * 0.04, 0.2, 2.6); ctx.stroke(); }
    },
  };

  // Coffre au trésor (pour la silhouette sous l'eau et la carte de prise)
  function drawTreasure(ctx, x, y, size, o = {}) {
    const s = o.shadow;
    const w = size * 0.7;
    const h = size * 0.5;
    ctx.save(); ctx.translate(x, y);
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.fillStyle = s ? INK : '#8a5a2a'; ctx.fillRect(-w / 2, -h * 0.1, w, h * 0.6);
    ctx.beginPath(); ctx.moveTo(-w / 2, -h * 0.1); ctx.quadraticCurveTo(0, -h * 0.7, w / 2, -h * 0.1); ctx.closePath(); ctx.fillStyle = s ? INK : '#a8702e'; ctx.fill();
    if (!s) {
      ctx.fillStyle = '#ffd34a'; ctx.fillRect(-w / 2, -h * 0.13, w, h * 0.08); ctx.fillRect(-w * 0.07, -h * 0.2, w * 0.14, h * 0.3);
      ctx.strokeStyle = '#4a2a10'; ctx.lineWidth = 2; ctx.strokeRect(-w / 2, -h * 0.1, w, h * 0.6);
      const g = ctx.createRadialGradient(0, -h * 0.2, 2, 0, -h * 0.2, size * 0.7);
      g.addColorStop(0, `rgba(255, 230, 120, ${0.35 + Math.sin((o.t || 0) / 200) * 0.15})`); g.addColorStop(1, 'rgba(255, 230, 120, 0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -h * 0.2, size * 0.7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawFish(ctx, x, y, fish, o = {}) {
    if (!fish) return;
    const fn = SHAPES[fish.shape] || SHAPES.poisson;
    ctx.save();
    ctx.translate(x, y);
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    if ((o.facing || 1) < 0) ctx.scale(-1, 1);
    fn(ctx, fish, o.size || 60, o.t || 0, !!o.shadow);
    ctx.restore();
  }

  window.drawFish = drawFish;
  window.drawTreasure = drawTreasure;
  window.FISH_SHAPES = Object.keys(SHAPES);
})();
