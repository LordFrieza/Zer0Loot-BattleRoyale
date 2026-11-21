/*
 * Dessins de la Maison : les meubles (vue de trois quarts), la pièce (papier peint, sol, meubles, habitant)
 * et la façade (murs, toit, fenêtres, porte, jardin, boîte aux lettres).
 *  - drawFurniture(g, id, W, H, T, o) : meuble dont l'emprise au sol fait W × H px (coin haut-gauche en 0,0) ;
 *    les meubles hauts dépassent vers le haut. o = { t, flip, ghost }
 *  - drawHouseFront(g, house, o) / roomGeometry(size, cw, ch)
 */
(function () {
  const WOOD = '#9a6332';
  const WOOD_D = '#6b4423';
  const WOOD_L = '#c08850';
  const GOLD = '#e8b923';
  const GOLD_D = '#a87a10';

  function rr(g, x, y, w, h, r, fill, stroke) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.2; g.stroke(); }
  }
  function shadow(g, x, y, rx, ry) {
    g.fillStyle = 'rgba(0,0,0,.22)';
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
  }
  function leg(g, x, y, h, w = 3) { g.fillStyle = WOOD_D; g.fillRect(x - w / 2, y - h, w, h); }
  function flame(g, x, y, s, t) {
    const f = 1 + Math.sin((t || 0) / 90) * 0.12;
    g.fillStyle = '#ffb43a';
    g.beginPath(); g.moveTo(x, y - 9 * s * f); g.quadraticCurveTo(x + 4 * s, y - 2 * s, x, y); g.quadraticCurveTo(x - 4 * s, y - 2 * s, x, y - 9 * s * f); g.fill();
    g.fillStyle = '#fff2a8';
    g.beginPath(); g.ellipse(x, y - 2.5 * s, 1.6 * s, 3 * s * f, 0, 0, Math.PI * 2); g.fill();
  }
  function glow(g, x, y, r, color) {
    const gr = g.createRadialGradient(x, y, 1, x, y, r);
    gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(255, 220, 140, 0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  function plantLeaves(g, x, y, s, color = '#3a9a48') {
    g.fillStyle = color;
    for (const [dx, dy, r] of [[0, -14, 8], [-7, -9, 6], [7, -9, 6], [-3, -19, 5], [4, -18, 5]]) { g.beginPath(); g.ellipse(x + dx * s, y + dy * s, r * s, r * 0.8 * s, 0, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(255,255,255,.15)'; g.beginPath(); g.ellipse(x - 2 * s, y - 16 * s, 3 * s, 2 * s, 0, 0, Math.PI * 2); g.fill();
  }
  function pot(g, x, y, s, color = '#c0663a') {
    g.fillStyle = color;
    g.beginPath(); g.moveTo(x - 7 * s, y - 10 * s); g.lineTo(x + 7 * s, y - 10 * s); g.lineTo(x + 5 * s, y); g.lineTo(x - 5 * s, y); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(x - 7 * s, y - 10 * s, 14 * s, 2.5 * s);
  }

  // Chaque meuble : (g, W, H, T, t) ; s = T / 48 (taille d'une case de référence).
  const F = {
    tabouret(g, W, H, T) {
      const s = T / 48;
      shadow(g, W / 2, H * 0.78, 12 * s, 4 * s);
      leg(g, W / 2 - 8 * s, H * 0.8, 16 * s); leg(g, W / 2 + 8 * s, H * 0.8, 16 * s); leg(g, W / 2, H * 0.85, 14 * s);
      g.fillStyle = WOOD_L; g.beginPath(); g.ellipse(W / 2, H * 0.8 - 16 * s, 13 * s, 5 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = WOOD; g.fillRect(W / 2 - 13 * s, H * 0.8 - 16 * s, 26 * s, 3 * s);
    },
    chaise(g, W, H, T) {
      const s = T / 48;
      const b = H * 0.85;
      shadow(g, W / 2, b, 13 * s, 4 * s);
      leg(g, W / 2 - 10 * s, b, 14 * s); leg(g, W / 2 + 10 * s, b, 14 * s);
      rr(g, W / 2 - 12 * s, b - 34 * s, 24 * s, 20 * s, 3 * s, WOOD, WOOD_D);
      g.fillStyle = WOOD_D; for (let i = -1; i <= 1; i++) g.fillRect(W / 2 + i * 7 * s - 1.5 * s, b - 31 * s, 3 * s, 14 * s);
      rr(g, W / 2 - 13 * s, b - 16 * s, 26 * s, 6 * s, 2 * s, WOOD_L, WOOD_D);
    },
    pouf(g, W, H, T) {
      const s = T / 48;
      shadow(g, W / 2, H * 0.82, 15 * s, 5 * s);
      g.fillStyle = '#c94f8a'; g.beginPath(); g.ellipse(W / 2, H * 0.72, 15 * s, 11 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e57aaf'; g.beginPath(); g.ellipse(W / 2, H * 0.66, 13 * s, 6 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffd34a'; g.beginPath(); g.arc(W / 2, H * 0.66, 2 * s, 0, Math.PI * 2); g.fill();
    },
    fauteuil(g, W, H, T) {
      const s = T / 48;
      const b = H * 0.88;
      shadow(g, W / 2, b, 18 * s, 5 * s);
      rr(g, W / 2 - 16 * s, b - 38 * s, 32 * s, 26 * s, 8 * s, '#8a1f2e', '#5a1018');
      rr(g, W / 2 - 19 * s, b - 22 * s, 8 * s, 18 * s, 4 * s, '#a82a3a', '#5a1018');
      rr(g, W / 2 + 11 * s, b - 22 * s, 8 * s, 18 * s, 4 * s, '#a82a3a', '#5a1018');
      rr(g, W / 2 - 12 * s, b - 16 * s, 24 * s, 11 * s, 4 * s, '#c43a4c', '#5a1018');
      g.fillStyle = GOLD; for (const dx of [-8, 0, 8]) { g.beginPath(); g.arc(W / 2 + dx * s, b - 30 * s, 1.3 * s, 0, Math.PI * 2); g.fill(); }
    },
    canape(g, W, H, T) {
      const s = T / 48;
      const b = H * 0.88;
      shadow(g, W / 2, b, W * 0.45, 6 * s);
      rr(g, 6 * s, b - 40 * s, W - 12 * s, 26 * s, 9 * s, '#2f5fa8', '#1a3a70');
      rr(g, 2 * s, b - 24 * s, 12 * s, 20 * s, 5 * s, '#3a70c0', '#1a3a70');
      rr(g, W - 14 * s, b - 24 * s, 12 * s, 20 * s, 5 * s, '#3a70c0', '#1a3a70');
      rr(g, 12 * s, b - 18 * s, W / 2 - 13 * s, 12 * s, 4 * s, '#4f86d8', '#1a3a70');
      rr(g, W / 2 + 1 * s, b - 18 * s, W / 2 - 13 * s, 12 * s, 4 * s, '#4f86d8', '#1a3a70');
      rr(g, 14 * s, b - 34 * s, 12 * s, 10 * s, 3 * s, '#ffd34a');
    },
    trone(g, W, H, T, t) {
      const s = T / 48;
      const b = H * 0.9;
      shadow(g, W / 2, b, 18 * s, 5 * s);
      g.fillStyle = GOLD; g.beginPath(); g.moveTo(W / 2 - 16 * s, b - 20 * s); g.lineTo(W / 2 - 16 * s, b - 56 * s); g.lineTo(W / 2 - 8 * s, b - 64 * s); g.lineTo(W / 2, b - 58 * s); g.lineTo(W / 2 + 8 * s, b - 64 * s); g.lineTo(W / 2 + 16 * s, b - 56 * s); g.lineTo(W / 2 + 16 * s, b - 20 * s); g.closePath(); g.fill();
      g.strokeStyle = GOLD_D; g.lineWidth = 1.5; g.stroke();
      rr(g, W / 2 - 11 * s, b - 52 * s, 22 * s, 30 * s, 4 * s, '#a01830');
      g.fillStyle = '#5fd3ff'; g.beginPath(); g.arc(W / 2, b - 58 * s, 3 * s, 0, Math.PI * 2); g.fill();
      rr(g, W / 2 - 18 * s, b - 22 * s, 36 * s, 16 * s, 4 * s, GOLD, GOLD_D);
      rr(g, W / 2 - 13 * s, b - 22 * s, 26 * s, 7 * s, 3 * s, '#c41e3a');
      g.fillStyle = '#fff'; g.globalAlpha = 0.5 + Math.sin((t || 0) / 300) * 0.4; g.fillRect(W / 2 - 12 * s, b - 50 * s, 2 * s, 2 * s); g.globalAlpha = 1;
    },
    table_basse(g, W, H, T) {
      const s = T / 48;
      const b = H * 0.8;
      shadow(g, W / 2, b, W * 0.42, 5 * s);
      leg(g, 10 * s, b, 10 * s, 4 * s); leg(g, W - 10 * s, b, 10 * s, 4 * s);
      rr(g, 4 * s, b - 16 * s, W - 8 * s, 8 * s, 3 * s, WOOD_L, WOOD_D);
      g.fillStyle = '#f4f1ea'; g.beginPath(); g.ellipse(W * 0.35, b - 16 * s, 5 * s, 2 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#b3262e'; g.fillRect(W * 0.6, b - 19 * s, 10 * s, 3 * s);
    },
    table_ronde(g, W, H, T) {
      const s = T / 48;
      const b = H * 0.85;
      shadow(g, W / 2, b, 14 * s, 4 * s);
      g.fillStyle = WOOD_D; g.fillRect(W / 2 - 2 * s, b - 20 * s, 4 * s, 20 * s); g.fillRect(W / 2 - 8 * s, b - 3 * s, 16 * s, 3 * s);
      g.fillStyle = WOOD; g.beginPath(); g.ellipse(W / 2, b - 21 * s, 17 * s, 6 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = WOOD_L; g.beginPath(); g.ellipse(W / 2, b - 23 * s, 17 * s, 6 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ff8fb8'; g.beginPath(); g.arc(W / 2, b - 27 * s, 3 * s, 0, Math.PI * 2); g.fill();
    },
    table(g, W, H, T) {
      const s = T / 48;
      const b = H * 0.86;
      shadow(g, W / 2, b, W * 0.44, 5 * s);
      for (const x of [8, W / s - 8]) leg(g, x * s, b, 20 * s, 4 * s);
      rr(g, 3 * s, b - 26 * s, W - 6 * s, 9 * s, 2 * s, WOOD, WOOD_D);
      g.fillStyle = '#f4f1ea'; g.fillRect(W * 0.2, b - 27 * s, W * 0.6, 3 * s);
      g.fillStyle = '#c0663a'; g.beginPath(); g.arc(W / 2, b - 30 * s, 4 * s, 0, Math.PI * 2); g.fill();
    },
    bureau(g, W, H, T, t) {
      const s = T / 48;
      const b = H * 0.88;
      shadow(g, W / 2, b, W * 0.44, 5 * s);
      rr(g, 4 * s, b - 26 * s, W - 8 * s, 26 * s, 2 * s, WOOD, WOOD_D);
      for (let i = 0; i < 3; i++) { rr(g, W - 26 * s, b - 22 * s + i * 7 * s, 20 * s, 6 * s, 1, WOOD_L, WOOD_D); g.fillStyle = GOLD; g.fillRect(W - 17 * s, b - 20 * s + i * 7 * s, 2 * s, 2 * s); }
      g.fillStyle = '#f2e6c8'; g.save(); g.translate(W * 0.3, b - 29 * s); g.rotate(-0.1); g.fillRect(-8 * s, -2 * s, 16 * s, 4 * s); g.restore();
      g.fillStyle = '#e8e2d0'; g.fillRect(W * 0.55, b - 34 * s, 3 * s, 8 * s);
      flame(g, W * 0.55 + 1.5 * s, b - 34 * s, s * 0.7, t);
    },
    lit(g, W, H, T) {
      const s = T / 48;
      shadow(g, W / 2, H - 4 * s, W * 0.46, 5 * s);
      rr(g, 3 * s, 2 * s, W - 6 * s, 18 * s, 4 * s, WOOD, WOOD_D);
      rr(g, 4 * s, 12 * s, W - 8 * s, H - 16 * s, 4 * s, '#f4f1ea', '#c9c2b0');
      rr(g, 8 * s, 16 * s, W - 16 * s, 12 * s, 5 * s, '#ffffff', '#d8d2c2');
      rr(g, 4 * s, H * 0.42, W - 8 * s, H * 0.55, 4 * s, '#4a7ad8', '#2a4a90');
      g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(4 * s, H * 0.42, W - 8 * s, 4 * s);
    },
    lit_double(g, W, H, T) {
      const s = T / 48;
      shadow(g, W / 2, H - 4 * s, W * 0.46, 6 * s);
      rr(g, 3 * s, 0, W - 6 * s, 22 * s, 5 * s, WOOD_D, '#3a2410');
      rr(g, 4 * s, 12 * s, W - 8 * s, H - 16 * s, 5 * s, '#f4f1ea', '#c9c2b0');
      rr(g, 9 * s, 17 * s, W / 2 - 13 * s, 13 * s, 5 * s, '#fff', '#d8d2c2');
      rr(g, W / 2 + 4 * s, 17 * s, W / 2 - 13 * s, 13 * s, 5 * s, '#fff', '#d8d2c2');
      rr(g, 4 * s, H * 0.4, W - 8 * s, H * 0.57, 5 * s, '#8a2be2', '#5a1a90');
      g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(8 * s, H * 0.55); g.lineTo(W - 8 * s, H * 0.55); g.stroke();
    },
    lit_baldaquin(g, W, H, T) {
      const s = T / 48;
      F.lit_double(g, W, H, T);
      g.fillStyle = WOOD_D;
      for (const x of [5 * s, W - 9 * s]) { g.fillRect(x, -40 * s, 4 * s, H - 6 * s + 40 * s); }
      g.fillStyle = 'rgba(200, 30, 60, .85)';
      g.beginPath(); g.moveTo(2 * s, -42 * s); g.lineTo(W - 2 * s, -42 * s); g.lineTo(W - 2 * s, -30 * s); g.quadraticCurveTo(W / 2, -18 * s, 2 * s, -30 * s); g.closePath(); g.fill();
      g.fillStyle = GOLD; g.fillRect(2 * s, -44 * s, W - 4 * s, 3 * s);
      g.fillStyle = 'rgba(200, 30, 60, .35)'; g.fillRect(2 * s, -30 * s, 8 * s, H * 0.6); g.fillRect(W - 10 * s, -30 * s, 8 * s, H * 0.6);
    },
    coffre(g, W, H, T) {
      const s = T / 48;
      const b = H * 0.85;
      shadow(g, W / 2, b, 17 * s, 4 * s);
      rr(g, W / 2 - 16 * s, b - 18 * s, 32 * s, 18 * s, 2 * s, WOOD, WOOD_D);
      g.fillStyle = WOOD_L; g.beginPath(); g.moveTo(W / 2 - 16 * s, b - 18 * s); g.quadraticCurveTo(W / 2, b - 32 * s, W / 2 + 16 * s, b - 18 * s); g.closePath(); g.fill();
      g.fillStyle = '#5a5a60'; g.fillRect(W / 2 - 16 * s, b - 19 * s, 32 * s, 2.5 * s); g.fillRect(W / 2 - 10 * s, b - 26 * s, 3 * s, 26 * s); g.fillRect(W / 2 + 7 * s, b - 26 * s, 3 * s, 26 * s);
      g.fillStyle = GOLD; g.fillRect(W / 2 - 2.5 * s, b - 20 * s, 5 * s, 6 * s);
    },
    commode(g, W, H, T) {
      const s = T / 48;
      const b = H * 0.88;
      shadow(g, W / 2, b, 18 * s, 4 * s);
      rr(g, W / 2 - 17 * s, b - 36 * s, 34 * s, 36 * s, 2 * s, WOOD, WOOD_D);
      for (let i = 0; i < 3; i++) { rr(g, W / 2 - 14 * s, b - 32 * s + i * 10.5 * s, 28 * s, 9 * s, 1.5, WOOD_L, WOOD_D); g.fillStyle = GOLD; g.beginPath(); g.arc(W / 2, b - 27.5 * s + i * 10.5 * s, 1.5 * s, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#7cff4f'; g.fillRect(W / 2 - 10 * s, b - 42 * s, 5 * s, 6 * s);
    },
    armoire(g, W, H, T) {
      const s = T / 48;
      const b = H * 0.9;
      shadow(g, W / 2, b, 19 * s, 4 * s);
      rr(g, W / 2 - 18 * s, b - 72 * s, 36 * s, 72 * s, 3 * s, WOOD, WOOD_D);
      rr(g, W / 2 - 20 * s, b - 76 * s, 40 * s, 6 * s, 2 * s, WOOD_D);
      rr(g, W / 2 - 15 * s, b - 68 * s, 14 * s, 58 * s, 2 * s, WOOD_L, WOOD_D);
      rr(g, W / 2 + 1 * s, b - 68 * s, 14 * s, 58 * s, 2 * s, WOOD_L, WOOD_D);
      g.fillStyle = GOLD; g.fillRect(W / 2 - 3 * s, b - 42 * s, 2 * s, 6 * s); g.fillRect(W / 2 + 1 * s, b - 42 * s, 2 * s, 6 * s);
    },
    bibliotheque(g, W, H, T) {
      const s = T / 48;
      const b = H * 0.9;
      shadow(g, W / 2, b, W * 0.45, 5 * s);
      rr(g, 3 * s, b - 74 * s, W - 6 * s, 74 * s, 2 * s, WOOD_D, '#3a2410');
      const colors = ['#c4122f', '#2f5fa8', '#3ddc5a', '#ffd34a', '#8a2be2', '#ff7a1f', '#f4f1ea'];
      for (let r = 0; r < 4; r++) {
        const y = b - 70 * s + r * 17.5 * s;
        g.fillStyle = WOOD; g.fillRect(6 * s, y + 14 * s, W - 12 * s, 3 * s);
        let x = 8 * s;
        let k = r * 3;
        while (x < W - 12 * s) {
          const bw = (4 + ((k * 7) % 4)) * s;
          const bh = (10 + ((k * 5) % 4)) * s;
          g.fillStyle = colors[k % colors.length];
          g.fillRect(x, y + 14 * s - bh, bw, bh);
          x += bw + 1;
          k += 1;
        }
      }
    },
    coffre_or(g, W, H, T, t) {
      const s = T / 48;
      const b = H * 0.86;
      shadow(g, W / 2, b, 18 * s, 4 * s);
      glow(g, W / 2, b - 24 * s, 26 * s, 'rgba(255, 215, 80, .45)');
      rr(g, W / 2 - 16 * s, b - 18 * s, 32 * s, 18 * s, 2 * s, '#b07a1a', GOLD_D);
      g.fillStyle = GOLD; for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(W / 2 - 12 * s + (i % 5) * 6 * s, b - 20 * s - Math.floor(i / 5) * 4 * s, 3.5 * s, 2 * s, 0, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#c41e3a'; g.beginPath(); g.arc(W / 2 + 6 * s, b - 25 * s, 2.5 * s, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5fd3ff'; g.beginPath(); g.arc(W / 2 - 5 * s, b - 26 * s, 2.5 * s, 0, Math.PI * 2); g.fill();
      g.fillStyle = GOLD; g.fillRect(W / 2 - 16 * s, b - 12 * s, 32 * s, 3 * s);
      g.fillStyle = '#fff'; g.globalAlpha = Math.max(0, Math.sin((t || 0) / 250)); g.fillRect(W / 2 + 10 * s, b - 28 * s, 2 * s, 2 * s); g.globalAlpha = 1;
    },
    bougeoir(g, W, H, T, t) {
      const s = T / 48;
      const b = H * 0.82;
      shadow(g, W / 2, b, 7 * s, 2.5 * s);
      glow(g, W / 2, b - 30 * s, 22 * s, 'rgba(255, 200, 100, .4)');
      g.fillStyle = GOLD; g.fillRect(W / 2 - 1.5 * s, b - 18 * s, 3 * s, 18 * s); g.fillRect(W / 2 - 6 * s, b - 2 * s, 12 * s, 2 * s);
      g.fillStyle = '#f4f1ea'; g.fillRect(W / 2 - 2.5 * s, b - 26 * s, 5 * s, 8 * s);
      flame(g, W / 2, b - 26 * s, s, t);
    },
    lampe(g, W, H, T) {
      const s = T / 48;
      const b = H * 0.84;
      shadow(g, W / 2, b, 12 * s, 3.5 * s);
      glow(g, W / 2, b - 30 * s, 26 * s, 'rgba(255, 230, 150, .45)');
      rr(g, W / 2 - 11 * s, b - 14 * s, 22 * s, 14 * s, 2 * s, WOOD, WOOD_D);
      g.fillStyle = '#c0c6d0'; g.fillRect(W / 2 - 1 * s, b - 26 * s, 2 * s, 12 * s);
      g.fillStyle = '#ffe9a8'; g.beginPath(); g.moveTo(W / 2 - 6 * s, b - 36 * s); g.lineTo(W / 2 + 6 * s, b - 36 * s); g.lineTo(W / 2 + 10 * s, b - 24 * s); g.lineTo(W / 2 - 10 * s, b - 24 * s); g.closePath(); g.fill();
    },
    lampadaire(g, W, H, T) {
      const s = T / 48;
      const b = H * 0.86;
      shadow(g, W / 2, b, 9 * s, 3 * s);
      glow(g, W / 2, b - 70 * s, 34 * s, 'rgba(255, 230, 150, .5)');
      g.fillStyle = '#3a3a42'; g.fillRect(W / 2 - 1.5 * s, b - 66 * s, 3 * s, 66 * s); g.beginPath(); g.ellipse(W / 2, b, 8 * s, 2.5 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffe9a8'; g.beginPath(); g.moveTo(W / 2 - 7 * s, b - 80 * s); g.lineTo(W / 2 + 7 * s, b - 80 * s); g.lineTo(W / 2 + 12 * s, b - 64 * s); g.lineTo(W / 2 - 12 * s, b - 64 * s); g.closePath(); g.fill();
    },
    brasero(g, W, H, T, t) {
      const s = T / 48;
      const b = H * 0.86;
      shadow(g, W / 2, b, 14 * s, 4 * s);
      glow(g, W / 2, b - 30 * s, 34 * s, 'rgba(255, 140, 40, .5)');
      g.strokeStyle = '#3a3a42'; g.lineWidth = 3 * s;
      g.beginPath(); g.moveTo(W / 2 - 10 * s, b); g.lineTo(W / 2, b - 16 * s); g.lineTo(W / 2 + 10 * s, b); g.stroke();
      g.fillStyle = '#4a4a52'; g.beginPath(); g.ellipse(W / 2, b - 18 * s, 15 * s, 6 * s, 0, 0, Math.PI); g.fill();
      for (let i = -1; i <= 1; i++) flame(g, W / 2 + i * 6 * s, b - 18 * s, 1.5 * s, (t || 0) + i * 200);
    },
    plante(g, W, H, T) {
      const s = T / 48;
      const b = H * 0.86;
      shadow(g, W / 2, b, 9 * s, 3 * s);
      pot(g, W / 2, b, s);
      plantLeaves(g, W / 2, b - 10 * s, s);
    },
    cactus(g, W, H, T) {
      const s = T / 48;
      const b = H * 0.86;
      shadow(g, W / 2, b, 9 * s, 3 * s);
      pot(g, W / 2, b, s, '#d8b48a');
      g.fillStyle = '#3d9a4a';
      rr(g, W / 2 - 5 * s, b - 36 * s, 10 * s, 28 * s, 5 * s, '#3d9a4a');
      rr(g, W / 2 - 13 * s, b - 28 * s, 6 * s, 12 * s, 3 * s, '#3d9a4a');
      rr(g, W / 2 + 7 * s, b - 32 * s, 6 * s, 12 * s, 3 * s, '#3d9a4a');
      g.fillStyle = '#ff6b9a'; g.beginPath(); g.arc(W / 2, b - 37 * s, 3 * s, 0, Math.PI * 2); g.fill();
    },
    bonsai(g, W, H, T) {
      const s = T / 48;
      const b = H * 0.86;
      shadow(g, W / 2, b, 13 * s, 3.5 * s);
      rr(g, W / 2 - 13 * s, b - 7 * s, 26 * s, 7 * s, 2 * s, '#3a4a6a');
      g.strokeStyle = '#5a3a1e'; g.lineWidth = 3 * s; g.beginPath(); g.moveTo(W / 2, b - 7 * s); g.quadraticCurveTo(W / 2 - 8 * s, b - 16 * s, W / 2 + 2 * s, b - 24 * s); g.stroke();
      g.fillStyle = '#2f7a3a'; for (const [dx, dy, r] of [[-8, -26, 8], [6, -28, 9], [-1, -33, 7]]) { g.beginPath(); g.ellipse(W / 2 + dx * s, b + dy * s, r * s, r * 0.6 * s, 0, 0, Math.PI * 2); g.fill(); }
    },
    palmier(g, W, H, T) {
      const s = T / 48;
      const b = H * 0.86;
      shadow(g, W / 2, b, 12 * s, 3.5 * s);
      pot(g, W / 2, b, s * 1.2, '#a65a3a');
      g.strokeStyle = '#8a6a3a'; g.lineWidth = 4 * s; g.beginPath(); g.moveTo(W / 2, b - 12 * s); g.quadraticCurveTo(W / 2 + 5 * s, b - 40 * s, W / 2 + 2 * s, b - 62 * s); g.stroke();
      g.fillStyle = '#2f8a3a';
      for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i - 2.5) * 0.55; g.save(); g.translate(W / 2 + 2 * s, b - 62 * s); g.rotate(a); g.beginPath(); g.ellipse(14 * s, 0, 16 * s, 4 * s, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
    },
    cerisier(g, W, H, T, t) {
      const s = T / 48;
      shadow(g, W / 2, H * 0.85, W * 0.36, 8 * s);
      g.fillStyle = '#5a3a2a'; g.fillRect(W / 2 - 5 * s, H * 0.3, 10 * s, H * 0.55);
      g.strokeStyle = '#5a3a2a'; g.lineWidth = 4 * s; g.beginPath(); g.moveTo(W / 2, H * 0.45); g.lineTo(W / 2 - 22 * s, H * 0.2); g.moveTo(W / 2, H * 0.4); g.lineTo(W / 2 + 22 * s, H * 0.15); g.stroke();
      for (const [dx, dy, r, c] of [[-24, -10, 24, '#ffb6d0'], [22, -14, 26, '#ffc4da'], [0, -30, 28, '#ff9ec0'], [-10, -46, 18, '#ffd0e2'], [14, -44, 20, '#ffb6d0']]) {
        g.fillStyle = c; g.beginPath(); g.arc(W / 2 + dx * s, H * 0.2 + dy * s, r * s, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#fff0f6';
      for (let i = 0; i < 4; i++) { const y = ((t || 0) / 30 + i * 37) % (H * 0.8); g.beginPath(); g.ellipse(W * (0.2 + i * 0.2), y, 2.2 * s, 1.4 * s, 0.5, 0, Math.PI * 2); g.fill(); }
    },
    tapis(g, W, H, T) {
      const s = T / 48;
      rr(g, 4 * s, 6 * s, W - 8 * s, H - 12 * s, 3 * s, '#a63a3a');
      g.strokeStyle = '#ffd34a'; g.lineWidth = 2 * s; g.strokeRect(8 * s, 10 * s, W - 16 * s, H - 20 * s);
      g.fillStyle = '#ffd34a'; g.beginPath(); g.moveTo(W / 2, 14 * s); g.lineTo(W / 2 + 10 * s, H / 2); g.lineTo(W / 2, H - 14 * s); g.lineTo(W / 2 - 10 * s, H / 2); g.closePath(); g.fill();
    },
    tapis_rond(g, W, H, T) {
      const s = T / 48;
      g.fillStyle = '#2f6a8a'; g.beginPath(); g.ellipse(W / 2, H / 2, W / 2 - 4 * s, H / 2 - 6 * s, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#f4f1ea'; g.lineWidth = 2 * s;
      for (const k of [0.75, 0.5, 0.25]) { g.beginPath(); g.ellipse(W / 2, H / 2, (W / 2 - 4 * s) * k, (H / 2 - 6 * s) * k, 0, 0, Math.PI * 2); g.stroke(); }
    },
    tapis_royal(g, W, H, T) {
      const s = T / 48;
      rr(g, 4 * s, 6 * s, W - 8 * s, H - 12 * s, 4 * s, '#7a1f3d');
      g.strokeStyle = GOLD; g.lineWidth = 3 * s; g.strokeRect(10 * s, 12 * s, W - 20 * s, H - 24 * s);
      g.lineWidth = 1.5 * s; g.strokeRect(16 * s, 18 * s, W - 32 * s, H - 36 * s);
      g.fillStyle = GOLD;
      g.beginPath(); g.ellipse(W / 2, H / 2, 22 * s, 14 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#7a1f3d'; g.beginPath(); g.ellipse(W / 2, H / 2, 14 * s, 8 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f4f1ea'; for (let i = 0; i < 10; i++) { g.fillRect(4 * s + i * (W - 8 * s) / 10, 3 * s, 2 * s, 4 * s); g.fillRect(4 * s + i * (W - 8 * s) / 10, H - 7 * s, 2 * s, 4 * s); }
    },
    // ---- Décoration murale : dessinée dans un cadre W × H sur le mur ----
    tableau(g, W, H, T) {
      const s = T / 48;
      rr(g, W / 2 - 18 * s, H / 2 - 14 * s, 36 * s, 26 * s, 1, GOLD, GOLD_D);
      g.fillStyle = '#8fd0ff'; g.fillRect(W / 2 - 14 * s, H / 2 - 10 * s, 28 * s, 18 * s);
      g.fillStyle = '#5aa04a'; g.beginPath(); g.moveTo(W / 2 - 14 * s, H / 2 + 8 * s); g.lineTo(W / 2 - 4 * s, H / 2 - 4 * s); g.lineTo(W / 2 + 4 * s, H / 2 + 2 * s); g.lineTo(W / 2 + 8 * s, H / 2 - 2 * s); g.lineTo(W / 2 + 14 * s, H / 2 + 8 * s); g.closePath(); g.fill();
      g.fillStyle = '#ffe27a'; g.beginPath(); g.arc(W / 2 + 8 * s, H / 2 - 6 * s, 3 * s, 0, Math.PI * 2); g.fill();
    },
    etagere(g, W, H, T) {
      const s = T / 48;
      g.fillStyle = WOOD; g.fillRect(W / 2 - 20 * s, H / 2 + 4 * s, 40 * s, 4 * s);
      g.fillStyle = WOOD_D; g.fillRect(W / 2 - 16 * s, H / 2 + 8 * s, 3 * s, 6 * s); g.fillRect(W / 2 + 13 * s, H / 2 + 8 * s, 3 * s, 6 * s);
      for (const [dx, c, h] of [[-14, '#ff4d6d', 12], [-5, '#5fd3ff', 9], [5, '#7cff4f', 14], [13, '#b98cff', 10]]) {
        g.fillStyle = c; g.beginPath(); g.arc(W / 2 + dx * s, H / 2 + 4 * s - h * 0.35 * s, 4 * s, 0, Math.PI * 2); g.fill();
        g.fillRect(W / 2 + dx * s - 1.2 * s, H / 2 + 4 * s - h * s, 2.4 * s, h * 0.5 * s);
      }
    },
    horloge(g, W, H, T, t) {
      const s = T / 48;
      g.fillStyle = WOOD_D; g.beginPath(); g.arc(W / 2, H / 2, 16 * s, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f8f4ea'; g.beginPath(); g.arc(W / 2, H / 2, 13 * s, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#333'; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.fillRect(W / 2 + Math.cos(a) * 10.5 * s - 0.8, H / 2 + Math.sin(a) * 10.5 * s - 0.8, 1.6, 1.6); }
      const d = new Date();
      const hand = (a, l, w) => { g.strokeStyle = '#222'; g.lineWidth = w; g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + Math.sin(a) * l, H / 2 - Math.cos(a) * l); g.stroke(); };
      hand(((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, 6 * s, 2);
      hand(d.getMinutes() / 60 * Math.PI * 2, 9 * s, 1.5);
      hand(((t || 0) / 1000 % 60) / 60 * Math.PI * 2, 10 * s, 0.8);
    },
    banniere(g, W, H, T) {
      const s = T / 48;
      g.fillStyle = GOLD; g.fillRect(W / 2 - 14 * s, H / 2 - 20 * s, 28 * s, 2.5 * s);
      g.fillStyle = '#7a2cff'; g.beginPath(); g.moveTo(W / 2 - 12 * s, H / 2 - 18 * s); g.lineTo(W / 2 + 12 * s, H / 2 - 18 * s); g.lineTo(W / 2 + 12 * s, H / 2 + 16 * s); g.lineTo(W / 2, H / 2 + 10 * s); g.lineTo(W / 2 - 12 * s, H / 2 + 16 * s); g.closePath(); g.fill();
      g.fillStyle = '#ffd34a'; g.font = `900 ${11 * s}px system-ui`; g.textAlign = 'center'; g.fillText('Z0', W / 2, H / 2 + 2 * s);
    },
    miroir(g, W, H, T) {
      const s = T / 48;
      g.fillStyle = GOLD; g.beginPath(); g.ellipse(W / 2, H / 2, 14 * s, 19 * s, 0, 0, Math.PI * 2); g.fill();
      const gr = g.createLinearGradient(W / 2 - 10 * s, H / 2 - 15 * s, W / 2 + 10 * s, H / 2 + 15 * s);
      gr.addColorStop(0, '#e8f4ff'); gr.addColorStop(0.5, '#a8c8e8'); gr.addColorStop(1, '#d8ecff');
      g.fillStyle = gr; g.beginPath(); g.ellipse(W / 2, H / 2, 11 * s, 16 * s, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(W / 2 - 5 * s, H / 2 - 8 * s); g.lineTo(W / 2 + 1 * s, H / 2 - 13 * s); g.stroke();
    },
    cheminee(g, W, H, T, t) {
      const s = T / 48;
      // Posée contre le mur : elle descend jusqu'au sol (bas du cadre)
      rr(g, 4 * s, H * 0.1, W - 8 * s, H * 0.9, 2 * s, '#9a6a5a', '#5a3a2a');
      g.fillStyle = '#b8846a'; g.fillRect(0, H * 0.06, W, 6 * s);
      g.fillStyle = '#1a0e08'; rr(g, W / 2 - 22 * s, H * 0.42, 44 * s, H * 0.58, 10 * s, '#1a0e08');
      glow(g, W / 2, H * 0.85, 30 * s, 'rgba(255, 140, 40, .6)');
      for (let i = -2; i <= 2; i++) flame(g, W / 2 + i * 7 * s, H - 4 * s, 1.6 * s, (t || 0) + i * 130);
      g.fillStyle = '#ffd34a'; g.fillRect(W / 2 - 18 * s, H * 0.06 - 8 * s, 5 * s, 8 * s); g.fillRect(W / 2 + 12 * s, H * 0.06 - 10 * s, 6 * s, 10 * s);
      // Âtre en pierre qui avance sur le sol : la cheminée est posée par terre, pas accrochée au mur
      const hy = H;
      const hh = T * 0.32;
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(-2 * s, hy + hh - 2 * s, W + 4 * s, 6 * s);
      rr(g, -4 * s, hy - 2 * s, W + 8 * s, hh, 3 * s, '#8d8580', '#5a5450');
      g.strokeStyle = 'rgba(40, 35, 30, .45)'; g.lineWidth = 1.2 * s;
      for (let i = 1; i < 4; i++) { const x = -4 * s + ((W + 8 * s) * i) / 4; g.beginPath(); g.moveTo(x, hy - 2 * s); g.lineTo(x, hy + hh - 2 * s); g.stroke(); }
      glow(g, W / 2, hy + 2 * s, 26 * s, 'rgba(255, 140, 40, .35)');
    },
    vitrail(g, W, H, T, t) {
      const s = T / 48;
      g.fillStyle = '#4a4a52'; g.beginPath(); g.moveTo(8 * s, H - 4 * s); g.lineTo(8 * s, H * 0.35); g.arc(W / 2, H * 0.35, W / 2 - 8 * s, Math.PI, 0); g.lineTo(W - 8 * s, H - 4 * s); g.closePath(); g.fill();
      const colors = ['#ff4d6d', '#5fd3ff', '#ffd34a', '#7cff4f', '#b98cff'];
      let k = 0;
      for (let y = H * 0.2; y < H - 8 * s; y += 10 * s) for (let x = 12 * s; x < W - 12 * s; x += 10 * s) {
        const dx = x + 4 * s - W / 2;
        const dy = y + 4 * s - H * 0.35;
        if (y < H * 0.35 && Math.hypot(dx, dy) > W / 2 - 12 * s) continue;
        g.fillStyle = colors[k++ % colors.length]; g.globalAlpha = 0.75 + Math.sin(((t || 0) / 600) + k) * 0.15; g.fillRect(x, y, 8 * s, 8 * s);
      }
      g.globalAlpha = 1;
    },
    trophee(g, W, H, T) {
      const s = T / 48;
      rr(g, W / 2 - 14 * s, H / 2 - 12 * s, 28 * s, 26 * s, 6 * s, WOOD, WOOD_D);
      g.save();
      g.translate(W / 2 - 2 * s, H / 2 + 6 * s);
      g.scale(0.42 * s, 0.42 * s);
      g.fillStyle = '#c4122f';
      g.beginPath(); g.ellipse(0, -10, 22, 16, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(10, -16); g.lineTo(40, -12); g.lineTo(40, 0); g.lineTo(10, 2); g.closePath(); g.fill();
      g.fillStyle = '#f4f1ea'; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(16 + i * 6, 0); g.lineTo(19 + i * 6, 6); g.lineTo(22 + i * 6, 0); g.fill(); }
      g.fillStyle = '#ffd34a'; g.beginPath(); g.arc(8, -16, 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e8e2d0'; g.beginPath(); g.moveTo(-8, -22); g.lineTo(-20, -44); g.lineTo(-2, -26); g.fill(); g.beginPath(); g.moveTo(4, -24); g.lineTo(0, -48); g.lineTo(10, -26); g.fill();
      g.restore();
    },
    // ---- Loisirs ----
    aquarium(g, W, H, T, t) {
      const s = T / 48;
      const b = H * 0.9;
      shadow(g, W / 2, b, W * 0.45, 5 * s);
      rr(g, 4 * s, b - 14 * s, W - 8 * s, 14 * s, 2 * s, WOOD_D);
      const gr = g.createLinearGradient(0, b - 48 * s, 0, b - 14 * s);
      gr.addColorStop(0, 'rgba(120, 210, 255, .85)'); gr.addColorStop(1, 'rgba(30, 110, 180, .9)');
      rr(g, 4 * s, b - 48 * s, W - 8 * s, 34 * s, 3 * s, gr, '#c0e8ff');
      g.fillStyle = '#e8d8a8'; g.fillRect(6 * s, b - 18 * s, W - 12 * s, 4 * s);
      g.strokeStyle = '#3a9a48'; g.lineWidth = 2 * s; for (const x of [12, W / s - 16]) { g.beginPath(); g.moveTo(x * s, b - 16 * s); g.quadraticCurveTo(x * s + 4 * s, b - 28 * s, x * s, b - 38 * s); g.stroke(); }
      const tt = (t || 0) / 1000;
      for (const [k, c] of [[0, '#ff7a1f'], [1, '#ffd34a'], [2, '#ff6b9a']]) {
        const x = 14 * s + ((Math.sin(tt * 0.8 + k * 2) + 1) / 2) * (W - 30 * s);
        const y = b - 40 * s + k * 8 * s + Math.sin(tt * 2 + k) * 2 * s;
        const dir = Math.cos(tt * 0.8 + k * 2) > 0 ? 1 : -1;
        g.fillStyle = c; g.beginPath(); g.ellipse(x, y, 5 * s, 3 * s, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(x - dir * 4 * s, y); g.lineTo(x - dir * 9 * s, y - 3 * s); g.lineTo(x - dir * 9 * s, y + 3 * s); g.closePath(); g.fill();
      }
    },
    jukebox(g, W, H, T, t) {
      const s = T / 48;
      const b = H * 0.9;
      shadow(g, W / 2, b, 18 * s, 4 * s);
      g.fillStyle = '#8a1f2e'; g.beginPath(); g.moveTo(W / 2 - 18 * s, b); g.lineTo(W / 2 - 18 * s, b - 44 * s); g.arc(W / 2, b - 44 * s, 18 * s, Math.PI, 0); g.lineTo(W / 2 + 18 * s, b); g.closePath(); g.fill();
      const hue = ((t || 0) / 15) % 360;
      g.strokeStyle = `hsl(${hue}, 90%, 60%)`; g.lineWidth = 3 * s; g.beginPath(); g.arc(W / 2, b - 44 * s, 14 * s, Math.PI, 0); g.stroke();
      g.strokeStyle = `hsl(${(hue + 120) % 360}, 90%, 60%)`; g.beginPath(); g.moveTo(W / 2 - 14 * s, b - 44 * s); g.lineTo(W / 2 - 14 * s, b - 6 * s); g.moveTo(W / 2 + 14 * s, b - 44 * s); g.lineTo(W / 2 + 14 * s, b - 6 * s); g.stroke();
      rr(g, W / 2 - 9 * s, b - 34 * s, 18 * s, 12 * s, 2 * s, '#ffe9a8');
      g.fillStyle = '#333'; for (let i = 0; i < 4; i++) g.fillRect(W / 2 - 8 * s + i * 4 * s, b - 18 * s, 2.5 * s, 10 * s);
    },
    arcade(g, W, H, T, t) {
      const s = T / 48;
      const b = H * 0.9;
      shadow(g, W / 2, b, 17 * s, 4 * s);
      g.fillStyle = '#2a1a5a'; g.beginPath(); g.moveTo(W / 2 - 15 * s, b); g.lineTo(W / 2 - 15 * s, b - 70 * s); g.lineTo(W / 2 + 15 * s, b - 70 * s); g.lineTo(W / 2 + 15 * s, b - 34 * s); g.lineTo(W / 2 + 18 * s, b - 28 * s); g.lineTo(W / 2 + 15 * s, b); g.closePath(); g.fill();
      g.fillStyle = '#ff3fd8'; g.fillRect(W / 2 - 15 * s, b - 70 * s, 30 * s, 8 * s);
      const gr = g.createLinearGradient(0, b - 60 * s, 0, b - 38 * s);
      gr.addColorStop(0, '#29e7ff'); gr.addColorStop(1, '#7a2cff');
      g.fillStyle = gr; g.fillRect(W / 2 - 11 * s, b - 60 * s, 22 * s, 20 * s);
      g.fillStyle = '#ffd34a'; const px = W / 2 - 8 * s + (((t || 0) / 40) % (16 * s)); g.fillRect(px, b - 48 * s, 3 * s, 3 * s);
      g.fillStyle = '#ff4d6d'; g.beginPath(); g.arc(W / 2 - 5 * s, b - 31 * s, 2.5 * s, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5fd3ff'; g.beginPath(); g.arc(W / 2 + 4 * s, b - 31 * s, 2 * s, 0, Math.PI * 2); g.fill();
    },
    machine_sous(g, W, H, T, t) {
      const s = T / 48;
      const b = H * 0.9;
      shadow(g, W / 2, b, 17 * s, 4 * s);
      rr(g, W / 2 - 15 * s, b - 62 * s, 30 * s, 62 * s, 6 * s, '#c4122f', '#6a0818');
      rr(g, W / 2 - 13 * s, b - 60 * s, 26 * s, 9 * s, 3 * s, GOLD);
      g.fillStyle = '#6a0818'; g.font = `900 ${7 * s}px system-ui`; g.textAlign = 'center'; g.fillText('777', W / 2, b - 53.5 * s);
      rr(g, W / 2 - 12 * s, b - 46 * s, 24 * s, 14 * s, 2 * s, '#fff');
      const syms = ['🍒', '7', '💎'];
      g.font = `${8 * s}px system-ui`; g.fillStyle = '#c4122f';
      for (let i = 0; i < 3; i++) g.fillText(syms[(Math.floor((t || 0) / 500) + i) % 3], W / 2 - 8 * s + i * 8 * s, b - 36 * s);
      g.strokeStyle = '#ccc'; g.lineWidth = 2 * s; g.beginPath(); g.moveTo(W / 2 + 15 * s, b - 38 * s); g.lineTo(W / 2 + 21 * s, b - 52 * s); g.stroke();
      g.fillStyle = '#e33'; g.beginPath(); g.arc(W / 2 + 21 * s, b - 53 * s, 3 * s, 0, Math.PI * 2); g.fill();
    },
    billard(g, W, H, T) {
      const s = T / 48;
      shadow(g, W / 2, H * 0.9, W * 0.46, 7 * s);
      for (const [x, y] of [[10, H - 4], [W - 10, H - 4]]) leg(g, x, y, 16 * s, 6 * s);
      rr(g, 2 * s, 6 * s, W - 4 * s, H - 22 * s, 8 * s, WOOD_D, '#3a2410');
      rr(g, 9 * s, 13 * s, W - 18 * s, H - 36 * s, 4 * s, '#0f7a40');
      g.fillStyle = '#111'; for (const [x, y] of [[11, 15], [W / 2, 13], [W - 11, 15], [11, H - 25], [W / 2, H - 23], [W - 11, H - 25]]) { g.beginPath(); g.arc(x === W / 2 ? x : x * (x > W / 2 ? 1 : s), y * (y > H / 2 ? 1 : s), 3.5 * s, 0, Math.PI * 2); g.fill(); }
      const balls = ['#ffd34a', '#2f5fa8', '#c4122f', '#8a2be2', '#ff7a1f', '#3ddc5a', '#111'];
      balls.forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(W * 0.6 + (i % 3) * 6 * s + Math.floor(i / 3) * 3 * s, H * 0.35 + Math.floor(i / 3) * 6 * s, 2.8 * s, 0, Math.PI * 2); g.fill(); });
      g.fillStyle = '#fff'; g.beginPath(); g.arc(W * 0.28, H * 0.42, 2.8 * s, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#d8b48a'; g.lineWidth = 2 * s; g.beginPath(); g.moveTo(W * 0.08, H * 0.6); g.lineTo(W * 0.26, H * 0.44); g.stroke();
    },
    piano(g, W, H, T, t) {
      const s = T / 48;
      shadow(g, W / 2, H * 0.88, W * 0.42, 8 * s);
      g.fillStyle = '#111'; g.beginPath(); g.moveTo(6 * s, H * 0.25); g.lineTo(W - 10 * s, H * 0.2); g.quadraticCurveTo(W - 2 * s, H * 0.55, W * 0.62, H * 0.82); g.lineTo(6 * s, H * 0.82); g.closePath(); g.fill();
      g.fillStyle = '#2a2a30'; g.beginPath(); g.moveTo(10 * s, H * 0.18); g.lineTo(W - 18 * s, H * 0.02); g.lineTo(W - 16 * s, H * 0.06); g.lineTo(12 * s, H * 0.24); g.closePath(); g.fill();
      g.fillStyle = '#fff'; g.fillRect(6 * s, H * 0.62, W * 0.55, 10 * s);
      g.fillStyle = '#111'; for (let i = 0; i < 12; i++) if (i % 7 !== 2 && i % 7 !== 6) g.fillRect(9 * s + i * W * 0.045, H * 0.62, 2.5 * s, 6 * s);
      leg(g, 14 * s, H * 0.98, H * 0.16, 4 * s); leg(g, W * 0.55, H * 0.98, H * 0.16, 4 * s);
      g.fillStyle = '#ffd34a'; const n = Math.floor((t || 0) / 700) % 3; g.font = `${10 * s}px system-ui`; g.fillText('♪', W * 0.7 + n * 5 * s, H * 0.1 - n * 4 * s);
    },
    statue_troll(g, W, H, T, t) {
      const s = T / 48;
      const b = H * 0.9;
      rr(g, W / 2 - 16 * s, b - 10 * s, 32 * s, 10 * s, 2 * s, '#8a8680', '#5a5650');
      g.save();
      g.filter = 'grayscale(1) brightness(1.15) contrast(.9)';
      drawPet(g, W / 2, b - 9 * s, 'troll', { size: 1 * s, t: 0 });
      g.restore();
    },
    statue_dragon(g, W, H, T, t) {
      const s = T / 48;
      const b = H * 0.92;
      glow(g, W / 2, H * 0.4, W * 0.5, 'rgba(255, 215, 80, .3)');
      rr(g, 10 * s, b - 14 * s, W - 20 * s, 14 * s, 3 * s, '#5a3a8a', '#2a1a4a');
      g.save();
      g.filter = 'sepia(1) saturate(3.2) hue-rotate(-12deg) brightness(1.15)';
      drawPet(g, W / 2, b - 13 * s, 'dragon', { size: 1.25 * s, t: 0 });
      g.restore();
      g.fillStyle = '#fff'; g.globalAlpha = Math.max(0, Math.sin((t || 0) / 300)); g.fillRect(W * 0.62, H * 0.3, 3 * s, 3 * s); g.globalAlpha = 1;
    },
    fontaine(g, W, H, T, t) {
      const s = T / 48;
      shadow(g, W / 2, H * 0.82, W * 0.46, 10 * s);
      g.fillStyle = '#a8a39a'; g.beginPath(); g.ellipse(W / 2, H * 0.7, W * 0.45, H * 0.22, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5ab8e8'; g.beginPath(); g.ellipse(W / 2, H * 0.66, W * 0.38, H * 0.16, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#c0bab0'; g.fillRect(W / 2 - 5 * s, H * 0.25, 10 * s, H * 0.42);
      g.fillStyle = '#a8a39a'; g.beginPath(); g.ellipse(W / 2, H * 0.27, 18 * s, 6 * s, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(180, 230, 255, .9)'; g.lineWidth = 2 * s;
      const tt = (t || 0) / 1000;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.beginPath(); g.moveTo(W / 2, H * 0.22); g.quadraticCurveTo(W / 2 + Math.cos(a) * 26 * s, H * 0.1, W / 2 + Math.cos(a) * 34 * s, H * 0.62 + Math.sin(a) * 6 * s); g.stroke();
      }
      g.fillStyle = 'rgba(255,255,255,.7)'; for (let i = 0; i < 6; i++) { const p = (tt * 1.5 + i / 6) % 1; g.beginPath(); g.arc(W / 2 + Math.cos(i) * 30 * s * p, H * 0.62 - Math.sin(p * Math.PI) * 4 * s, 1.6 * s, 0, Math.PI * 2); g.fill(); }
    },
  };

  function drawFurniture(g, id, W, H, T, o = {}) {
    const fn = F[id];
    if (!fn) return;
    g.save();
    if (o.ghost) g.globalAlpha = 0.55;
    if (o.flip) { g.translate(W, 0); g.scale(-1, 1); }
    fn(g, W, H, T, o.t || 0);
    g.restore();
  }

  // ---------- Pièce ----------
  // Taille des cases pour faire tenir la pièce (et son mur) dans le canevas.
  function roomGeometry(size, cw, ch) {
    const S = Rules.HOUSING.sizes[size] || Rules.HOUSING.sizes.studio;
    const wallH = 2.3;
    const T = Math.floor(Math.min((cw - 40) / S.cols, (ch - 20) / (S.rows + wallH)));
    const w = S.cols * T;
    const h = S.rows * T;
    const x = Math.round((cw - w) / 2);
    const wallPx = Math.round(wallH * T);
    const y = Math.round((ch - h - wallPx) / 2) + wallPx;
    return { cols: S.cols, rows: S.rows, T, x, y, w, h, wallPx };
  }

  function wallpaper(g, id, x, y, w, h, T) {
    const o = Rules.HOUSE_PARTS.papier.options[id] || Rules.HOUSE_PARTS.papier.options.beige;
    g.fillStyle = o.color;
    g.fillRect(x, y, w, h);
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    switch (id) {
      case 'rayures': g.fillStyle = 'rgba(255,255,255,.35)'; for (let i = x; i < x + w; i += T / 2) g.fillRect(i, y, T / 6, h); break;
      case 'fleurs': g.fillStyle = 'rgba(220, 90, 120, .35)'; for (let j = y + 10; j < y + h; j += T * 0.6) for (let i = x + ((j / (T * 0.6)) % 2) * T * 0.3; i < x + w; i += T * 0.6) { for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(i + Math.cos(k * 1.26) * 3, j + Math.sin(k * 1.26) * 3, 2.4, 0, Math.PI * 2); g.fill(); } } break;
      case 'bois': g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 2; for (let i = x; i < x + w; i += T / 3) { g.beginPath(); g.moveTo(i, y); g.lineTo(i, y + h); g.stroke(); } break;
      case 'pierre': g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 2; for (let j = y; j < y + h; j += T / 2.5) { g.beginPath(); g.moveTo(x, j); g.lineTo(x + w, j); g.stroke(); for (let i = x + ((Math.round((j - y) / (T / 2.5))) % 2) * T / 2; i < x + w; i += T) { g.beginPath(); g.moveTo(i, j); g.lineTo(i, j + T / 2.5); g.stroke(); } } break;
      case 'etoiles': g.fillStyle = '#fff'; for (let k = 0; k < (w * h) / 1600; k++) { const sx = x + ((k * 97) % w); const sy = y + ((k * 61) % h); g.globalAlpha = 0.4 + ((k * 13) % 6) / 10; g.fillRect(sx, sy, 2, 2); } g.globalAlpha = 1; break;
      case 'royal': g.fillStyle = 'rgba(232, 185, 35, .35)'; for (let j = y + T / 2; j < y + h; j += T) for (let i = x + T / 2; i < x + w; i += T) { g.beginPath(); g.moveTo(i, j - 6); g.lineTo(i + 5, j); g.lineTo(i, j + 6); g.lineTo(i - 5, j); g.closePath(); g.fill(); } break;
      default: g.fillStyle = 'rgba(0,0,0,.04)'; for (let i = x; i < x + w; i += T) g.fillRect(i, y, 1, h);
    }
    g.restore();
    // plinthe et moulure
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x, y, w, 4);
    g.fillStyle = WOOD_D; g.fillRect(x, y + h - 8, w, 8);
  }

  function floor(g, id, x, y, w, h, T) {
    const o = Rules.HOUSE_PARTS.sol.options[id] || Rules.HOUSE_PARTS.sol.options.parquet;
    g.fillStyle = o.color;
    g.fillRect(x, y, w, h);
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    switch (id) {
      case 'carrelage': g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 1; for (let i = x; i <= x + w; i += T) { g.beginPath(); g.moveTo(i, y); g.lineTo(i, y + h); g.stroke(); } for (let j = y; j <= y + h; j += T) { g.beginPath(); g.moveTo(x, j); g.lineTo(x + w, j); g.stroke(); } break;
      case 'damier': g.fillStyle = '#2a2a30'; for (let j = 0; j < h / T; j++) for (let i = 0; i < w / T; i++) if ((i + j) % 2) g.fillRect(x + i * T, y + j * T, T, T); break;
      case 'moquette': g.fillStyle = 'rgba(255,255,255,.05)'; for (let k = 0; k < (w * h) / 300; k++) g.fillRect(x + ((k * 53) % w), y + ((k * 37) % h), 2, 2); break;
      case 'herbe': g.strokeStyle = 'rgba(30, 90, 30, .35)'; for (let k = 0; k < (w * h) / 500; k++) { const sx = x + ((k * 53) % w); const sy = y + ((k * 37) % h); g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + 2, sy - 6); g.stroke(); } break;
      case 'marbre': g.strokeStyle = 'rgba(150, 140, 130, .35)'; g.lineWidth = 1.5; for (let k = 0; k < 8; k++) { g.beginPath(); g.moveTo(x + ((k * 131) % w), y); g.bezierCurveTo(x + ((k * 71) % w), y + h / 3, x + ((k * 191) % w), y + h * 0.6, x + ((k * 53) % w), y + h); g.stroke(); } g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1; for (let i = x; i <= x + w; i += T * 2) { g.beginPath(); g.moveTo(i, y); g.lineTo(i, y + h); g.stroke(); } break;
      default: // parquet
        g.strokeStyle = 'rgba(0,0,0,.14)'; g.lineWidth = 1;
        for (let j = y; j < y + h; j += T / 3) { g.beginPath(); g.moveTo(x, j); g.lineTo(x + w, j); g.stroke(); for (let i = x + (((j - y) / (T / 3)) % 2) * T * 0.7; i < x + w; i += T * 1.4) { g.beginPath(); g.moveTo(i, j); g.lineTo(i, j + T / 3); g.stroke(); } }
    }
    g.restore();
    // ombre du mur sur le sol
    const sh = g.createLinearGradient(0, y, 0, y + T * 0.6);
    sh.addColorStop(0, 'rgba(0,0,0,.22)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh; g.fillRect(x, y, w, T * 0.6);
  }

  /*
   * Pièce complète : mur, sol, meubles (tapis d'abord, puis par profondeur), habitants.
   * o = { t, grid (montrer la grille), ghost: { id, x, y, ok }, hidden (index du meuble porté), walkers: [{ x, y (en cases), f, facing, bob }] }
   */
  function drawRoom(g, house, cw, ch, o = {}) {
    const R = roomGeometry(house.size, cw, ch);
    const { T } = R;
    g.clearRect(0, 0, cw, ch);
    // murs latéraux en perspective
    g.fillStyle = '#2a1a3a';
    g.fillRect(0, 0, cw, ch);
    wallpaper(g, house.style.papier, R.x, R.y - R.wallPx, R.w, R.wallPx, T);
    floor(g, house.style.sol, R.x, R.y, R.w, R.h, T);
    g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 3; g.strokeRect(R.x, R.y - R.wallPx, R.w, R.wallPx + R.h);
    if (o.grid) {
      g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
      for (let i = 0; i <= R.cols; i++) { g.beginPath(); g.moveTo(R.x + i * T, R.y); g.lineTo(R.x + i * T, R.y + R.h); g.stroke(); }
      for (let j = 0; j <= R.rows; j++) { g.beginPath(); g.moveTo(R.x, R.y + j * T); g.lineTo(R.x + R.w, R.y + j * T); g.stroke(); }
      g.strokeStyle = 'rgba(255, 211, 74, .35)';
      g.strokeRect(R.x, R.y - R.wallPx * 0.78, R.w, T);
    }
    const placed = house.placed.map((p, i) => ({ ...p, i })).filter((p) => p.i !== o.hidden && Rules.FURNITURE[p.id]);
    // Décoration murale (une rangée de cases sur le mur)
    const wallY = R.y - R.wallPx * 0.78;
    for (const p of placed.filter((q) => Rules.FURNITURE[q.id].wall)) {
      const Fd = Rules.FURNITURE[p.id];
      g.save();
      g.translate(R.x + p.x * T, p.id === 'cheminee' ? R.y - T * 1.4 : wallY);
      drawFurniture(g, p.id, Fd.w * T, p.id === 'cheminee' ? T * 1.4 : T, T, { t: o.t, flip: p.flip });
      g.restore();
    }
    // Tapis
    for (const p of placed.filter((q) => Rules.FURNITURE[q.id].rug)) {
      const Fd = Rules.FURNITURE[p.id];
      g.save(); g.translate(R.x + p.x * T, R.y + p.y * T);
      drawFurniture(g, p.id, Fd.w * T, Fd.h * T, T, { t: o.t, flip: p.flip });
      g.restore();
    }
    // Meubles et habitants triés par profondeur (bas de l'emprise)
    const items = [];
    for (const p of placed.filter((q) => !Rules.FURNITURE[q.id].rug && !Rules.FURNITURE[q.id].wall)) {
      const Fd = Rules.FURNITURE[p.id];
      items.push({ z: p.y + Fd.h, draw: () => { g.save(); g.translate(R.x + p.x * T, R.y + p.y * T); drawFurniture(g, p.id, Fd.w * T, Fd.h * T, T, { t: o.t, flip: p.flip }); g.restore(); } });
    }
    // Les habitants passent toujours devant les meubles (dessinés après eux)
    for (const w of o.walkers || []) {
      items.push({ z: 1e6 + w.y, draw: () => {
        const px = R.x + (w.x + 0.5) * T;
        const py = R.y + (w.y + 0.6) * T;
        drawFighter(g, px, py - T * 0.35, w.f, { scale: T / 30, facing: w.facing, bob: w.bob || 0 });
        if (w.name) {
          g.font = `700 ${Math.max(10, T * 0.22)}px system-ui`; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)';
          g.strokeText(w.name, px, py + T * 0.38); g.fillStyle = '#fff'; g.fillText(w.name, px, py + T * 0.38);
        }
      } });
    }
    items.sort((a, b) => a.z - b.z);
    for (const it of items) it.draw();
    // Meuble en cours de placement
    if (o.ghost) {
      const Fd = Rules.FURNITURE[o.ghost.id];
      const gx = R.x + o.ghost.x * T;
      const gy = Fd.wall ? wallY : R.y + o.ghost.y * T;
      if (o.ghost.preview) {
        // Meuble essayé : dessiné normalement, entouré de pointillés dorés
        g.save(); g.setLineDash([6, 4]); g.strokeStyle = `rgba(255, 211, 74, ${0.6 + Math.sin((o.t || 0) / 200) * 0.3})`; g.lineWidth = 2;
        g.strokeRect(gx + 1, gy + 1, Fd.w * T - 2, (Fd.wall ? 1 : Fd.h) * T - 2); g.restore();
      } else {
        g.fillStyle = o.ghost.ok ? 'rgba(80, 255, 120, .25)' : 'rgba(255, 60, 60, .3)';
        g.fillRect(gx, gy, Fd.w * T, (Fd.wall ? 1 : Fd.h) * T);
      }
      g.save(); g.translate(gx, Fd.id === 'cheminee' ? R.y - T * 1.4 : gy);
      drawFurniture(g, o.ghost.id, Fd.w * T, o.ghost.id === 'cheminee' ? T * 1.4 : (Fd.wall ? 1 : Fd.h) * T, T, { t: o.t, ghost: !o.ghost.preview, flip: o.ghost.flip });
      g.restore();
    }
    return R;
  }

  // ---------- Façade ----------
  function drawHouseFront(g, house, cw, ch, o = {}) {
    const st = house.style;
    const P = Rules.HOUSE_PARTS;
    const t = o.t || 0;
    // Ciel selon l'heure réelle du joueur (comme l'enclos du Familier) : jour, aube / crépuscule, nuit étoilée
    const ph = o.phase || (typeof skyPhase === 'function' ? skyPhase() : { night: false, dusk: false, sun: 0.5 });
    drawFrontSky(g, cw, ch, t, ph);
    if (o.sky) o.sky(g, cw, ch, t, ph); // ce qui passe dans le ciel (housing-life.js)
    g.fillStyle = '#8cc56a'; g.beginPath(); g.ellipse(cw * 0.2, ch * 0.8, cw * 0.4, 70, 0, 0, Math.PI * 2); g.ellipse(cw * 0.85, ch * 0.82, cw * 0.35, 60, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6fb35a'; g.fillRect(0, ch * 0.8, cw, ch * 0.2);
    const size = house.size || 'studio';
    const cx = o.cx != null ? o.cx : cw / 2; // centre de la maison (décalée à gauche quand l'enclos est à droite)
    const bw = { studio: 220, maison: 290, manoir: 380 }[size];
    const bh = { studio: 110, maison: 120, manoir: 150 }[size];
    const bx = cx - bw / 2;
    const by = ch * 0.82 - bh;
    // Allée
    g.fillStyle = '#d8c09a'; g.beginPath(); g.moveTo(cx - 16, ch * 0.82); g.lineTo(cx + 16, ch * 0.82); g.lineTo(cx + 34, ch); g.lineTo(cx - 34, ch); g.closePath(); g.fill();
    // Murs
    const wall = P.murs.options[st.murs] || P.murs.options.blanc;
    g.fillStyle = wall.color; g.fillRect(bx, by, bw, bh);
    g.save(); g.beginPath(); g.rect(bx, by, bw, bh); g.clip();
    if (st.murs === 'brique') { g.strokeStyle = 'rgba(80, 30, 20, .45)'; g.lineWidth = 1.5; for (let y = by; y < by + bh; y += 10) { g.beginPath(); g.moveTo(bx, y); g.lineTo(bx + bw, y); g.stroke(); for (let x = bx + ((y - by) / 10 % 2) * 10; x < bx + bw; x += 20) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 10); g.stroke(); } } }
    if (st.murs === 'bois') { g.strokeStyle = 'rgba(60, 30, 10, .5)'; g.lineWidth = 2; for (let y = by; y < by + bh; y += 12) { g.beginPath(); g.moveTo(bx, y); g.lineTo(bx + bw, y); g.stroke(); } }
    if (st.murs === 'pierre') { g.fillStyle = 'rgba(0,0,0,.12)'; for (let k = 0; k < 40; k++) g.fillRect(bx + ((k * 47) % bw), by + ((k * 29) % bh), 16, 9); }
    if (st.murs === 'marbre') { g.strokeStyle = 'rgba(160, 150, 140, .45)'; for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(bx + ((k * 61) % bw), by); g.bezierCurveTo(bx + ((k * 97) % bw), by + bh * 0.4, bx + ((k * 31) % bw), by + bh * 0.7, bx + ((k * 83) % bw), by + bh); g.stroke(); } }
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2; g.strokeRect(bx, by, bw, bh);
    // Cheminée et fumée
    g.fillStyle = '#8a4a3a'; g.fillRect(bx + bw * 0.72, by - 62, 18, 40);
    g.fillStyle = 'rgba(230, 230, 230, .6)';
    for (let i = 0; i < 3; i++) { const p = ((t / 1600) + i / 3) % 1; g.beginPath(); g.arc(bx + bw * 0.72 + 9 + Math.sin(p * 6) * 6, by - 66 - p * 40, 6 + p * 8, 0, Math.PI * 2); g.globalAlpha = 0.6 * (1 - p); g.fill(); }
    g.globalAlpha = 1;
    // Toit
    const roof = P.toit.options[st.toit] || P.toit.options.tuiles;
    g.fillStyle = roof.color;
    if (st.toit === 'pagode') {
      for (let k = 0; k < 2; k++) {
        const y = by - k * 34;
        g.beginPath(); g.moveTo(bx - 26 + k * 30, y); g.quadraticCurveTo(bx + 10 + k * 30, y - 10, bx + 20 + k * 30, y - 30); g.lineTo(bx + bw - 20 - k * 30, y - 30); g.quadraticCurveTo(bx + bw - 10 - k * 30, y - 10, bx + bw + 26 - k * 30, y); g.closePath(); g.fill();
      }
      g.fillStyle = GOLD; g.fillRect(cx - 3, by - 82, 6, 18);
    } else if (st.toit === 'chaume') {
      g.beginPath(); g.moveTo(bx - 18, by + 4); g.quadraticCurveTo(cx, by - 110, bx + bw + 18, by + 4); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(120, 90, 30, .5)'; for (let i = 0; i < 14; i++) { g.beginPath(); g.moveTo(bx - 10 + i * (bw + 20) / 14, by + 2); g.lineTo(cx + (i - 7) * 4, by - 40); g.stroke(); }
    } else {
      g.beginPath(); g.moveTo(bx - 20, by + 2); g.lineTo(cx, by - 78); g.lineTo(bx + bw + 20, by + 2); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1;
      for (let i = 1; i < 6; i++) { const y = by + 2 - i * 13; const half = (bw / 2 + 20) * (1 - i / 6); g.beginPath(); g.moveTo(cx - half, y); g.lineTo(cx + half, y); g.stroke(); }
      if (st.toit === 'or') { g.fillStyle = 'rgba(255,255,255,.6)'; g.globalAlpha = Math.max(0, Math.sin(t / 400)); g.fillRect(cx - 30, by - 40, 4, 4); g.fillRect(cx + 40, by - 20, 3, 3); g.globalAlpha = 1; }
    }
    // Fenêtres
    const winY = by + bh * 0.25;
    const wins = size === 'studio' ? [bx + bw * 0.18, bx + bw * 0.68] : size === 'maison' ? [bx + bw * 0.12, bx + bw * 0.3, bx + bw * 0.62, bx + bw * 0.8] : [bx + bw * 0.08, bx + bw * 0.22, bx + bw * 0.66, bx + bw * 0.8];
    const lit = []; // fenêtres allumées la nuit
    for (const wx of wins) { drawWindow(g, st.fenetres, wx, winY, 30, 30, t); lit.push([wx, winY, 30, 30]); }
    if (size === 'manoir') for (const wx of [bx + bw * 0.4, bx + bw * 0.53]) { drawWindow(g, st.fenetres, wx, by + 8, 26, 22, t); lit.push([wx, by + 8, 26, 22]); }
    // Porte
    const door = P.porte.options[st.porte] || P.porte.options.bois;
    const dw = 34;
    const dh = 54;
    const dx = cx - dw / 2;
    const dy = by + bh - dh;
    g.fillStyle = door.color;
    if (st.porte === 'arche' || st.porte === 'doree') { g.beginPath(); g.moveTo(dx, by + bh); g.lineTo(dx, dy + 14); g.arc(cx, dy + 14, dw / 2, Math.PI, 0); g.lineTo(dx + dw, by + bh); g.closePath(); g.fill(); } else g.fillRect(dx, dy, dw, dh);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.5; g.strokeRect(dx + 5, dy + 8, dw - 10, dh - 14);
    g.fillStyle = GOLD; g.beginPath(); g.arc(dx + dw - 8, dy + dh / 2 + 4, 2.5, 0, Math.PI * 2); g.fill();
    if (st.porte === 'doree') { g.fillStyle = '#fff'; g.globalAlpha = Math.max(0, Math.sin(t / 300)); g.fillRect(dx + 8, dy + 16, 3, 3); g.globalAlpha = 1; }
    // Jardin
    const gy = ch * 0.82;
    if (st.jardin === 'fleurs') for (let i = 0; i < 14; i++) { const x = bx + 8 + i * ((bw - 16) / 13); if (Math.abs(x - cx) < 26) continue; g.fillStyle = '#3d7a34'; g.fillRect(x - 1, gy - 6, 2, 8); g.fillStyle = ['#ff6b9a', '#ffd34a', '#b98cff', '#fff'][i % 4]; g.beginPath(); g.arc(x, gy - 8, 4, 0, Math.PI * 2); g.fill(); }
    if (st.jardin === 'haie') { g.fillStyle = '#2f7a3a'; rr(g, bx - 30, gy - 18, cx - bx + 4, 22, 9, '#2f7a3a'); rr(g, cx + 26, gy - 18, bx + bw - cx + 4, 22, 9, '#2f7a3a'); }
    if (st.jardin === 'lanternes') for (const x of [cx - 50, cx + 50]) { g.fillStyle = '#3a3a42'; g.fillRect(x - 2, gy - 40, 4, 44); glow(g, x, gy - 44, 24, 'rgba(255, 210, 120, .6)'); rr(g, x - 6, gy - 52, 12, 14, 3, '#ffe9a8', '#3a3a42'); }
    if (st.jardin === 'cerisier') { const x = o.cx != null ? bx - 52 : bx + bw + 46; g.fillStyle = '#5a3a2a'; g.fillRect(x - 5, gy - 70, 10, 74); for (const [ox, oy, r] of [[-20, -80, 24], [18, -84, 26], [0, -102, 24]]) { g.fillStyle = '#ffb6d0'; g.beginPath(); g.arc(x + ox, gy + oy, r, 0, Math.PI * 2); g.fill(); } }
    if (st.jardin === 'fontaine') { const x = bx - 56; g.fillStyle = '#a8a39a'; g.beginPath(); g.ellipse(x, gy, 34, 10, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#5ab8e8'; g.beginPath(); g.ellipse(x, gy - 2, 28, 7, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#c0bab0'; g.fillRect(x - 4, gy - 30, 8, 28); g.strokeStyle = 'rgba(180,230,255,.9)'; g.lineWidth = 2; for (let i = -1; i <= 1; i += 2) { g.beginPath(); g.moveTo(x, gy - 30); g.quadraticCurveTo(x + i * 20, gy - 44, x + i * 26, gy - 4); g.stroke(); } }
    if (o.yard) o.yard(g, bx + bw, gy); // enclos à familier à droite de la maison (pets.js)
    // Boîte aux lettres (drapeau levé = courrier)
    const mx = bx - 30;
    const my = gy;
    g.fillStyle = WOOD_D; g.fillRect(mx - 2, my - 34, 4, 36);
    rr(g, mx - 13, my - 48, 26, 16, 6, '#2f5fa8', '#1a3a70');
    if (o.mail) {
      g.fillStyle = '#c4122f'; g.fillRect(mx + 12, my - 60 + Math.sin(t / 200) * 1.5, 3, 18); g.fillRect(mx + 12, my - 60 + Math.sin(t / 200) * 1.5, 10, 7);
      g.fillStyle = '#fff'; g.fillRect(mx - 8, my - 44, 12, 6);
    }
    if (o.front) o.front(g, cw, ch, t, ph); // passants au premier plan
    // La nuit, tout s'assombrit… sauf les lumières : fenêtres, lanternes, lampe de la porte, lune
    if (ph.night || ph.dusk) drawFrontNight(g, cw, ch, t, ph, { lit, cx, dy, dw, gy, by, bw, bx, lanterns: st.jardin === 'lanternes' ? [cx - 50, cx + 50] : [], seed: (house.id || '').length + bw });
    // Nom du propriétaire
    if (o.name) {
      g.font = '800 13px system-ui'; g.textAlign = 'center';
      const label = `Maison de ${o.name}`;
      const w = g.measureText(label).width + 18;
      rr(g, cw / 2 - w / 2, 8, w, 22, 11, 'rgba(10, 6, 24, .7)');
      g.fillStyle = '#fff'; g.fillText(label, cw / 2, 23);
    }
    return { mailbox: { x: mx - 16, y: my - 64, w: 40, h: 68 } };
  }

  // Ciel de la façade : dégradé selon le moment, soleil qui suit sa course, nuages ; étoiles et lune la nuit.
  function drawFrontSky(g, cw, ch, t, ph) {
    const sky = g.createLinearGradient(0, 0, 0, ch * 0.8);
    if (ph.night) { sky.addColorStop(0, '#070b26'); sky.addColorStop(1, '#25285a'); }
    else if (ph.dusk) { sky.addColorStop(0, '#3e4d9e'); sky.addColorStop(0.55, '#e9876a'); sky.addColorStop(1, '#ffc27a'); }
    else { sky.addColorStop(0, '#7ec8f0'); sky.addColorStop(0.7, '#cfeeff'); }
    g.fillStyle = sky; g.fillRect(0, 0, cw, ch);
    if (ph.night) {
      for (let i = 0; i < 70; i++) {
        const x = (i * 137.5) % cw;
        const y = (i * 53.3) % (ch * 0.6);
        g.fillStyle = `rgba(255,255,255,${0.35 + 0.45 * Math.abs(Math.sin(t / 600 + i * 1.7))})`;
        g.fillRect(x, y, i % 7 ? 1.6 : 2.4, i % 7 ? 1.6 : 2.4);
      }
      // étoile filante de temps en temps
      const sp = (t / 9000) % 1;
      if (sp < 0.08) { const k = sp / 0.08; g.strokeStyle = `rgba(255,255,255,${1 - k})`; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cw * 0.15 + k * 160, 20 + k * 50); g.lineTo(cw * 0.15 + k * 160 - 30, 20 + k * 50 - 9); g.stroke(); }
      // lune (croissant) et son halo
      const mx = cw * 0.86;
      const my = 46;
      const halo = g.createRadialGradient(mx, my, 10, mx, my, 70);
      halo.addColorStop(0, 'rgba(255, 246, 208, .35)'); halo.addColorStop(1, 'rgba(255, 246, 208, 0)');
      g.fillStyle = halo; g.beginPath(); g.arc(mx, my, 70, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff6d0'; g.beginPath(); g.arc(mx, my, 22, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0d1236'; g.beginPath(); g.arc(mx + 11, my - 6, 20, 0, Math.PI * 2); g.fill();
      return;
    }
    // soleil : se lève à gauche, culmine à midi, se couche à droite
    const sx = cw * 0.08 + ph.sun * cw * 0.84;
    const sy = ch * 0.62 - Math.sin(ph.sun * Math.PI) * ch * 0.52;
    const sg = g.createRadialGradient(sx, sy, 6, sx, sy, 64);
    sg.addColorStop(0, ph.dusk ? '#ffd59a' : '#fffbe0');
    sg.addColorStop(0.4, ph.dusk ? 'rgba(255,170,90,.6)' : 'rgba(255,240,150,.5)');
    sg.addColorStop(1, 'rgba(255,240,150,0)');
    g.fillStyle = sg; g.beginPath(); g.arc(sx, sy, 64, 0, Math.PI * 2); g.fill();
    g.fillStyle = ph.dusk ? 'rgba(255,220,200,.75)' : 'rgba(255,255,255,.85)';
    for (let i = 0; i < 3; i++) { const x = ((t / 60 + i * 230) % (cw + 160)) - 80; const y = 30 + i * 18; g.beginPath(); g.ellipse(x, y, 34, 11, 0, 0, Math.PI * 2); g.ellipse(x + 22, y - 6, 22, 10, 0, 0, Math.PI * 2); g.fill(); }
  }

  // Nuit (ou crépuscule) sur la rue : voile bleu sombre, puis les lumières par-dessus (fenêtres jaunes qui
  // s'éteignent peu à peu après minuit, lampe au-dessus de la porte, lanternes du jardin).
  function drawFrontNight(g, cw, ch, t, ph, L) {
    g.fillStyle = ph.night ? 'rgba(8, 12, 48, .5)' : 'rgba(255, 110, 60, .1)';
    g.fillRect(0, ch * 0.3, cw, ch * 0.7);
    if (ph.night) { g.fillStyle = 'rgba(8, 12, 48, .5)'; g.fillRect(0, 0, cw, ch * 0.3); }
    if (!ph.night && ph.h < 12) return; // aube : rien n'est encore allumé
    // Après minuit, de moins en moins de fenêtres allumées (jusqu'à 6 h)
    const late = ph.h < 6 ? ph.h / 6 : 0;
    L.lit.forEach(([x, y, w, h], i) => {
      if (late && ((i * 7 + L.seed) % 10) / 10 < late * 0.8) return;
      const flick = 0.92 + Math.sin(t / 700 + i * 2.3) * 0.04;
      glow(g, x + w / 2, y + h / 2, w * 1.4, `rgba(255, 200, 100, ${0.45 * flick})`);
      g.fillStyle = `rgba(255, 214, 120, ${0.85 * flick})`; g.fillRect(x + 1, y + 1, w - 2, h - 2);
      g.strokeStyle = '#5a3416'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke();
    });
    // Lampe au-dessus de la porte
    const lx = L.cx;
    const ly = L.dy - 10;
    glow(g, lx, ly, 46, 'rgba(255, 210, 120, .55)');
    rr(g, lx - 5, ly - 6, 10, 10, 3, '#ffe9a8', '#3a3a42');
    // Lanternes du jardin
    for (const x of L.lanterns) { glow(g, x, L.gy - 44, 40, 'rgba(255, 210, 120, .7)'); rr(g, x - 6, L.gy - 52, 12, 14, 3, '#fff2c0', '#3a3a42'); }
  }

  function drawWindow(g, kind, x, y, w, h, t) {
    if (kind === 'rondes') {
      g.fillStyle = '#5a3416'; g.beginPath(); g.arc(x + w / 2, y + h / 2, w / 2 + 3, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9fd8ff'; g.beginPath(); g.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#5a3416'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke();
      return;
    }
    g.fillStyle = '#5a3416'; g.fillRect(x - 3, y - 3, w + 6, h + 6);
    if (kind === 'vitraux') {
      const cs = ['#ff4d6d', '#5fd3ff', '#ffd34a', '#7cff4f'];
      for (let i = 0; i < 4; i++) { g.fillStyle = cs[i]; g.fillRect(x + (i % 2) * w / 2, y + Math.floor(i / 2) * h / 2, w / 2, h / 2); }
    } else {
      g.fillStyle = '#9fd8ff'; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(x + 3, y + 3, w / 3, h / 3);
    }
    g.strokeStyle = '#5a3416'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke();
    if (kind === 'volets') { g.fillStyle = '#3e8a55'; g.fillRect(x - 13, y - 2, 10, h + 4); g.fillRect(x + w + 3, y - 2, 10, h + 4); g.strokeStyle = 'rgba(0,0,0,.25)'; for (let k = 4; k < h; k += 5) { g.beginPath(); g.moveTo(x - 12, y + k); g.lineTo(x - 4, y + k); g.moveTo(x + w + 4, y + k); g.lineTo(x + w + 12, y + k); g.stroke(); } }
    if (kind === 'fleuries') { g.fillStyle = '#8a4a2a'; g.fillRect(x - 4, y + h + 2, w + 8, 7); for (let i = 0; i < 5; i++) { g.fillStyle = ['#ff6b9a', '#ffd34a', '#ff8a3d'][i % 3]; g.beginPath(); g.arc(x + i * w / 4, y + h + 1, 3.5, 0, Math.PI * 2); g.fill(); } }
  }

  window.drawFurniture = drawFurniture;
  window.drawRoom = drawRoom;
  window.drawHouseFront = drawHouseFront;
  window.roomGeometry = roomGeometry;
})();
