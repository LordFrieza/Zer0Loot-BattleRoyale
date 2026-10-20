/*
 * Dessin des monstres du donjon (gobelin, slime, chauve-souris, squelette) et du Troll (Combat de Boss).
 * Même repère que drawFighter : (x, y) au centre du corps, ombre au sol vers y + 18.
 * o = { scale, facing (1|-1), bob, flash (0..1), swing (0..1), t (ms, pour les animations), alpha }
 */
(function () {
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shadow(ctx, w, y = 18) {
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.ellipse(0, y, w, w * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function eye(ctx, x, y, r, color = '#fff', pupil = '#111') {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (pupil) {
      ctx.fillStyle = pupil;
      ctx.beginPath(); ctx.arc(x + r * 0.3, y, r * 0.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  function flashOver(ctx, flash, draw) {
    if (!flash) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,90,90,${flash * 0.7})`;
    draw();
    ctx.restore();
  }

  // Couronne des chefs (salles 5, 10, 15…)
  function crown(ctx, y) {
    ctx.fillStyle = '#ffd23f';
    ctx.strokeStyle = '#7a5a00';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-7, y); ctx.lineTo(-7, y - 6); ctx.lineTo(-3.5, y - 3); ctx.lineTo(0, y - 8); ctx.lineTo(3.5, y - 3); ctx.lineTo(7, y - 6); ctx.lineTo(7, y);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ff4d6d';
    ctx.beginPath(); ctx.arc(0, y - 2, 1.4, 0, Math.PI * 2); ctx.fill();
  }

  function gobelin(ctx, o, elite) {
    const skin = elite ? '#5fa33e' : '#7cbf4f';
    const swing = o.swing || 0;
    shadow(ctx, 11);
    // jambes
    ctx.fillStyle = '#4a3420';
    rr(ctx, -6, 8, 5, 9, 2); ctx.fill();
    rr(ctx, 1, 8, 5, 9, 2); ctx.fill();
    // corps (tunique en loques)
    ctx.fillStyle = '#7a5530';
    ctx.beginPath();
    ctx.moveTo(-8, -4); ctx.lineTo(8, -4); ctx.lineTo(9, 10); ctx.lineTo(5, 8); ctx.lineTo(2, 11); ctx.lineTo(-2, 8); ctx.lineTo(-5, 11); ctx.lineTo(-9, 10);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3d2a17';
    ctx.fillRect(-8, 3, 16, 2);
    // tête et grandes oreilles
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.moveTo(-7, -13); ctx.lineTo(-17, -18); ctx.lineTo(-7, -9); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(7, -13); ctx.lineTo(17, -18); ctx.lineTo(7, -9); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -12, 8.5, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e7ff6a';
    ctx.beginPath(); ctx.ellipse(-3, -13, 2.2, 1.6, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(3.5, -13, 2.2, 1.6, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(-3.4, -13.6, 1.2, 1.4); ctx.fillRect(3.3, -13.6, 1.2, 1.4);
    // nez crochu et sourire
    ctx.fillStyle = shade(skin, -0.2);
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(3, -8); ctx.lineTo(-0.5, -8.5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#2a3a14'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, -8, 3.5, 0.2, Math.PI - 0.2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillRect(-2.5, -5.6, 1.4, 1.6); ctx.fillRect(1.5, -5.6, 1.4, 1.6);
    if (elite) crown(ctx, -19);
    // dague rouillée
    ctx.save();
    ctx.translate(9, 1);
    ctx.rotate(-0.9 + swing * 2.1);
    ctx.fillStyle = '#5a3b1e'; ctx.fillRect(-1.2, -2, 2.4, 5);
    ctx.fillStyle = '#b8b0a0';
    ctx.beginPath(); ctx.moveTo(-1.8, -2); ctx.lineTo(0, -13); ctx.lineTo(1.8, -2); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(9, 1, 3, 0, Math.PI * 2); ctx.arc(-9, 1, 3, 0, Math.PI * 2); ctx.fill();
    flashOver(ctx, o.flash, () => { ctx.beginPath(); ctx.ellipse(0, -12, 8.5, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-8, -4, 16, 14); });
  }

  function slime(ctx, o, elite) {
    const t = (o.t || 0) / 1000;
    const squash = 1 + Math.sin(t * 5 + (o.seed || 0)) * 0.08 + (o.swing || 0) * 0.18;
    const base = elite ? '#b05cff' : '#4fd17a';
    shadow(ctx, 15, 17);
    ctx.save();
    ctx.translate(0, 16);
    ctx.scale(1 / squash, squash);
    const g = ctx.createRadialGradient(-5, -18, 2, 0, -10, 22);
    g.addColorStop(0, shade(base, 0.45));
    g.addColorStop(0.6, base);
    g.addColorStop(1, shade(base, -0.35));
    ctx.fillStyle = g;
    ctx.globalAlpha *= 0.92;
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.bezierCurveTo(-17, -16, -9, -27, 0, -27);
    ctx.bezierCurveTo(9, -27, 17, -16, 16, 0);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha /= 0.92;
    // reflet et bulles
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.ellipse(-7, -19, 3.5, 2, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.beginPath(); ctx.arc(6, -6, 1.8, 0, Math.PI * 2); ctx.arc(-4, -4, 1.2, 0, Math.PI * 2); ctx.fill();
    // yeux
    eye(ctx, -4.5, -13, 3);
    eye(ctx, 4.5, -13, 3);
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, -8, 2.5, 0.3, Math.PI - 0.3); ctx.stroke();
    if (elite) crown(ctx, -26);
    flashOver(ctx, o.flash, () => { ctx.beginPath(); ctx.ellipse(0, -12, 16, 14, 0, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }

  function bat(ctx, o, elite) {
    const t = (o.t || 0) / 1000;
    const flap = Math.sin(t * 18 + (o.seed || 0));
    const hover = Math.sin(t * 4 + (o.seed || 0)) * 3;
    const body = elite ? '#5a1f3a' : '#3d2d55';
    // ombre au sol, le corps vole au-dessus
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(0, 18, 9, 2.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(0, -14 + hover);
    ctx.fillStyle = shade(body, -0.15);
    for (const d of [-1, 1]) {
      ctx.save();
      ctx.scale(d, 1);
      ctx.rotate(flap * 0.5);
      ctx.beginPath();
      ctx.moveTo(3, -2);
      ctx.quadraticCurveTo(12, -12, 22, -6);
      ctx.quadraticCurveTo(18, -2, 19, 3);
      ctx.quadraticCurveTo(14, 0, 12, 4);
      ctx.quadraticCurveTo(8, 1, 3, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(0, 0, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
    // oreilles
    ctx.beginPath(); ctx.moveTo(-4, -5); ctx.lineTo(-5, -11); ctx.lineTo(-1, -6); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(4, -5); ctx.lineTo(5, -11); ctx.lineTo(1, -6); ctx.closePath(); ctx.fill();
    // yeux rouges et crocs
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath(); ctx.arc(-2.3, -2, 1.5, 0, Math.PI * 2); ctx.arc(2.3, -2, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(-2, 2); ctx.lineTo(-1.2, 4.5); ctx.lineTo(-0.4, 2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0.4, 2); ctx.lineTo(1.2, 4.5); ctx.lineTo(2, 2); ctx.closePath(); ctx.fill();
    if (elite) crown(ctx, -9);
    flashOver(ctx, o.flash, () => { ctx.beginPath(); ctx.ellipse(0, 0, 7, 8, 0, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }

  function squelette(ctx, o, elite) {
    const bone = elite ? '#f3e7c4' : '#e8e2d2';
    const dark = '#2b2620';
    const swing = o.swing || 0;
    shadow(ctx, 11);
    ctx.strokeStyle = bone;
    ctx.lineCap = 'round';
    // jambes
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(-3, 6); ctx.lineTo(-4, 17); ctx.moveTo(3, 6); ctx.lineTo(4, 17); ctx.stroke();
    // bassin et colonne
    ctx.fillStyle = bone;
    rr(ctx, -6, 4, 12, 4, 2); ctx.fill();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(0, -6); ctx.stroke();
    // côtes
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      const y = -5 + i * 3;
      ctx.beginPath(); ctx.moveTo(-7 + i, y); ctx.quadraticCurveTo(0, y - 2.5, 7 - i, y); ctx.stroke();
    }
    // arc
    ctx.save();
    ctx.translate(9, -1);
    ctx.rotate(-0.15 + swing * 0.3);
    ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(-6, 0, 11, -1.1, 1.1); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-1.5, -9.8); ctx.lineTo(-1.5 - swing * 3, 0); ctx.lineTo(-1.5, 9.8); ctx.stroke();
    ctx.restore();
    // bras
    ctx.strokeStyle = bone; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(-9, 2); ctx.moveTo(5, -5); ctx.lineTo(9, -1); ctx.stroke();
    // crâne
    ctx.fillStyle = bone;
    ctx.beginPath(); ctx.arc(0, -15, 8, 0, Math.PI * 2); ctx.fill();
    rr(ctx, -5, -10, 10, 5, 2); ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(-3, -15, 2.3, 2.8, 0, 0, Math.PI * 2); ctx.ellipse(3, -15, 2.3, 2.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = elite ? '#5fd3ff' : '#ff6b3b';
    ctx.beginPath(); ctx.arc(-3, -14.6, 0.9, 0, Math.PI * 2); ctx.arc(3, -14.6, 0.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.moveTo(0, -12.5); ctx.lineTo(-1, -10.8); ctx.lineTo(1, -10.8); ctx.closePath(); ctx.fill();
    ctx.fillRect(-3.5, -8.5, 7, 0.8);
    for (let i = -3; i <= 3; i += 1.5) ctx.fillRect(i - 0.3, -9.5, 0.6, 2.5);
    if (elite) crown(ctx, -22);
    flashOver(ctx, o.flash, () => { ctx.beginPath(); ctx.arc(0, -15, 8, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-7, -6, 14, 14); });
  }

  /*
   * Le Troll : dessiné dans un repère « taille réelle » (≈ 3× un combattant).
   * o.phase (0, 1, 2), o.enraged : la peau rougit et la vapeur sort de ses naseaux.
   */
  function troll(ctx, o) {
    const t = (o.t || 0) / 1000;
    const phase = o.phase || 0;
    const swing = o.swing || 0;
    const skins = ['#8fae8a', '#b8a25e', '#c8664e'];
    const skin = o.enraged ? '#b8473e' : skins[Math.min(2, phase)];
    const dark = shade(skin, -0.3);
    const breathe = Math.sin(t * 2.2) * 1.5;

    shadow(ctx, 52, 56);
    // jambes
    ctx.fillStyle = dark;
    rr(ctx, -30, 22, 22, 34, 9); ctx.fill();
    rr(ctx, 8, 22, 22, 34, 9); ctx.fill();
    ctx.fillStyle = shade(skin, -0.45);
    rr(ctx, -34, 48, 28, 10, 5); ctx.fill();
    rr(ctx, 6, 48, 28, 10, 5); ctx.fill();
    // bras arrière
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(-44, -2 + breathe, 13, 26, 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-50, 22 + breathe, 11, 0, Math.PI * 2); ctx.fill();
    // corps voûté
    const body = ctx.createRadialGradient(-10, -20, 10, 0, 0, 62);
    body.addColorStop(0, shade(skin, 0.15));
    body.addColorStop(1, dark);
    ctx.fillStyle = body;
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(0, -4 + breathe * 0.5, 44, 40, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // ventre
    ctx.fillStyle = shade(skin, 0.28);
    ctx.beginPath(); ctx.ellipse(4, 8 + breathe * 0.5, 26, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(4, 4, 14, 0.4, Math.PI - 0.4); ctx.stroke();
    // pagne
    ctx.fillStyle = '#6b4424';
    ctx.beginPath();
    ctx.moveTo(-36, 18); ctx.lineTo(36, 18); ctx.lineTo(30, 36); ctx.lineTo(18, 32); ctx.lineTo(8, 40); ctx.lineTo(-4, 33); ctx.lineTo(-16, 40); ctx.lineTo(-28, 33);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4a2c14';
    ctx.fillRect(-37, 15, 74, 6);
    ctx.fillStyle = '#d8c9a0';
    ctx.beginPath(); ctx.arc(0, 18, 4, 0, Math.PI * 2); ctx.fill();
    // tête (petite, enfoncée dans les épaules)
    const hy = -50 + breathe * 0.6;
    ctx.fillStyle = skin;
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.lineWidth = 2.5;
    // oreilles
    ctx.beginPath(); ctx.moveTo(-12, hy - 4); ctx.lineTo(-27, hy - 14); ctx.lineTo(-12, hy + 5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(6, hy, 23, 20, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // yeux (jaunes au calme, rouges et lumineux en colère)
    const angry = phase > 0 || o.enraged;
    ctx.save();
    ctx.shadowColor = angry ? '#ff2a00' : '#ffd23f';
    ctx.shadowBlur = angry ? 12 : 4;
    ctx.fillStyle = angry ? '#ff3b1f' : '#fff3a0';
    ctx.beginPath(); ctx.ellipse(-1, hy - 3, 5, 3.6, 0, 0, Math.PI * 2); ctx.ellipse(15, hy - 3, 5, 3.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(0.5, hy - 3, 2, 0, Math.PI * 2); ctx.arc(16.5, hy - 3, 2, 0, Math.PI * 2); ctx.fill();
    // sourcils épais (froncés en colère)
    ctx.fillStyle = shade(skin, -0.55);
    for (const [ex, dir] of [[-1, 1], [15, -1]]) {
      ctx.save();
      ctx.translate(ex, hy - 9);
      ctx.rotate((angry ? 0.35 : 0.1) * dir);
      rr(ctx, -7, -2.5, 14, 5, 2.5); ctx.fill();
      ctx.restore();
    }
    // gros nez
    ctx.fillStyle = shade(skin, -0.12);
    ctx.beginPath(); ctx.ellipse(8, hy + 4, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath(); ctx.arc(5.5, hy + 5.5, 1.3, 0, Math.PI * 2); ctx.arc(10.5, hy + 5.5, 1.3, 0, Math.PI * 2); ctx.fill();
    // mâchoire et défenses
    ctx.fillStyle = shade(skin, -0.25);
    rr(ctx, -9, hy + 9, 32, 10, 5); ctx.fill();
    ctx.fillStyle = '#2a1410';
    rr(ctx, -5, hy + 11, 24, 3, 1.5); ctx.fill();
    ctx.fillStyle = '#f2ead2';
    ctx.beginPath(); ctx.moveTo(-4, hy + 12); ctx.lineTo(-2, hy - 1); ctx.lineTo(2, hy + 12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(15, hy + 12); ctx.lineTo(19, hy - 1); ctx.lineTo(21, hy + 12); ctx.closePath(); ctx.fill();
    // vapeur de rage
    if (angry) {
      for (let i = 0; i < 3; i++) {
        const k = (t * 1.4 + i / 3) % 1;
        ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(9 + 8 + k * 14, hy + 2 - k * 16, 3 + k * 6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(9 - 6 - k * 10, hy + 2 - k * 16, 3 + k * 6, 0, Math.PI * 2); ctx.fill();
      }
    }
    // bras avant + massue (lève puis abat la massue)
    ctx.save();
    ctx.translate(36, -14 + breathe);
    ctx.rotate(-0.5 + swing * 2.4); // massue levée au-dessus de l'épaule, abattue vers l'avant
    // massue
    ctx.fillStyle = '#7a4f2a';
    rr(ctx, -5, -78, 10, 70, 5); ctx.fill();
    ctx.fillStyle = '#8f6036';
    ctx.beginPath(); ctx.ellipse(0, -84, 15, 24, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c9c2b0';
    for (const [sx, sy] of [[-14, -92], [14, -88], [-12, -74], [13, -72], [0, -106], [-4, -82], [6, -96]]) {
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + (sx > 0 ? 7 : -7), sy - 2); ctx.lineTo(sx, sy + 4); ctx.closePath(); ctx.fill();
    }
    // bras
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.ellipse(0, 4, 13, 22, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -8, 12, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    flashOver(ctx, o.flash, () => {
      ctx.beginPath(); ctx.ellipse(0, -4, 44, 40, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(6, hy, 23, 20, 0, 0, Math.PI * 2); ctx.fill();
    });
  }

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k))));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('');
  }

  const DRAW = { gobelin, slime, chauve_souris: bat, squelette, troll };

  function drawMonster(ctx, x, y, m, o = {}) {
    const draw = DRAW[m.kind];
    if (!draw) return;
    ctx.save();
    ctx.translate(x, y + (o.bob || 0));
    const s = (o.scale || 1) * (m.kind === 'troll' ? 1 : (m.scale || 1));
    ctx.scale(s * (o.facing || 1), s);
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    draw(ctx, o, !!m.elite);
    ctx.restore();
  }

  window.drawMonster = drawMonster;
})();
