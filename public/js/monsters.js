/*
 * Dessin des monstres du donjon (gobelin, slime, chauve-souris, squelette) et des boss (Troll, Dragon, Magicien des
 * ténèbres, Mimic, Liche de glace, Maexxna, Ether, Lilith, Daedra) avec leurs créatures (œufs, dragonnets, cristaux d'ombre,
 * araignées, cocons, mains spectrales, feux follets, chapeau et chatons, démons et portails).
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

  // Gobelin violet (venimeux) : même silhouette, peau violette et dague qui goutte de poison.
  function gobelinViolet(ctx, o, elite) {
    gobelin(ctx, o, elite, { skin: elite ? '#7a3db8' : '#a061d8', blade: '#7dff6a', eyes: '#ffe14a' });
    const t = (o.t || 0) / 1000;
    const swing = o.swing || 0;
    ctx.save();
    ctx.translate(9, 1);
    ctx.rotate(-0.9 + swing * 2.1);
    ctx.fillStyle = 'rgba(125,255,106,.85)';
    const drip = (t * 1.6 + (o.seed || 0)) % 1;
    ctx.beginPath(); ctx.arc(0, -4 + drip * 9, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (elite) { // plumes de chaman
      ctx.fillStyle = '#7dff6a';
      for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(d * 4, -24, 1.6, 4, d * 0.4, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  // Rat pestiféré : petit, rapide, la gueule bave du poison.
  function rat(ctx, o, elite) {
    const t = (o.t || 0) / 1000;
    const run = Math.sin(t * 22 + (o.seed || 0));
    const fur = elite ? '#5a4a3a' : '#7d7266';
    shadow(ctx, 11, 15);
    // queue
    ctx.strokeStyle = '#d9a3a3'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-10, 8); ctx.quadraticCurveTo(-18, 4 + run * 2, -22, 10); ctx.stroke();
    // pattes
    ctx.fillStyle = '#d9a3a3';
    ctx.fillRect(-7 + run * 1.5, 11, 3, 4); ctx.fillRect(4 - run * 1.5, 11, 3, 4);
    // corps
    ctx.fillStyle = fur;
    ctx.beginPath(); ctx.ellipse(-1, 6, 11, 7, 0, 0, Math.PI * 2); ctx.fill();
    // tête pointue
    ctx.beginPath(); ctx.moveTo(6, 1); ctx.quadraticCurveTo(14, 2, 17, 7); ctx.quadraticCurveTo(12, 10, 6, 10); ctx.closePath(); ctx.fill();
    // oreille
    ctx.fillStyle = '#e8a8b0';
    ctx.beginPath(); ctx.ellipse(6, 0, 3, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = fur;
    ctx.beginPath(); ctx.ellipse(6.6, 0.6, 1.6, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    // œil rouge, nez, bave verte
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath(); ctx.arc(11, 4, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8a8b0';
    ctx.beginPath(); ctx.arc(17, 7, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(125,255,106,.9)';
    const drip = (t * 1.3 + (o.seed || 0)) % 1;
    ctx.beginPath(); ctx.arc(15, 10 + drip * 6, 1, 0, Math.PI * 2); ctx.fill();
    if (elite) crown(ctx, -4);
    flashOver(ctx, o.flash, () => { ctx.beginPath(); ctx.ellipse(-1, 6, 11, 7, 0, 0, Math.PI * 2); ctx.fill(); });
  }

  function gobelin(ctx, o, elite, pal = {}) {
    const skin = pal.skin || (elite ? '#5fa33e' : '#7cbf4f');
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
    ctx.fillStyle = pal.eyes || '#e7ff6a';
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
    ctx.fillStyle = pal.blade || '#b8b0a0';
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

  /*
   * Pyrax le Dragon, vu de profil (tourné vers la droite), dans le même repère « taille réelle » que le Troll.
   * o.flying : ailes déployées, sans ombre (l'arène dessine l'ombre au sol) ; o.swing : gueule ouverte ;
   * o.whelp : petit dragonnet (couleurs plus claires) ; o.phase / o.enraged : flammes aux naseaux.
   */
  function dragon(ctx, o) {
    const t = (o.t || 0) / 1000;
    const whelp = !!o.whelp;
    const flying = !!o.flying;
    const swing = o.swing || 0;
    const red = whelp ? '#e0702c' : o.enraged ? '#d02820' : '#b8322a';
    const dark = shade(red, -0.35);
    const belly = whelp ? '#ffd27a' : '#f2b45a';
    const membrane = whelp ? 'rgba(255,170,90,.85)' : 'rgba(120,28,24,.92)';
    const flap = Math.sin(t * (flying ? 7 : 2.4) + (o.seed || 0)) * (flying ? 0.55 : 0.18);
    const breathe = Math.sin(t * 2) * 1.5;
    if (!flying) shadow(ctx, 62, 50);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.lineWidth = 2.5;
    // queue qui ondule, terminée par une pointe
    ctx.fillStyle = red;
    ctx.beginPath();
    const tw = Math.sin(t * 2.2) * 8;
    ctx.moveTo(-34, 4);
    ctx.quadraticCurveTo(-70, 30 + tw, -104, 8 - tw);
    ctx.lineTo(-96, 0 - tw);
    ctx.quadraticCurveTo(-66, 14 + tw, -36, -14);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.moveTo(-104, 8 - tw); ctx.lineTo(-122, -2 - tw); ctx.lineTo(-100, -6 - tw); ctx.closePath(); ctx.fill();
    // aile arrière
    const wing = (dir, alpha) => {
      ctx.save();
      ctx.translate(-6, -26);
      ctx.rotate(-0.35 - flap * dir);
      ctx.globalAlpha *= alpha;
      ctx.fillStyle = membrane;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-30, -70);
      ctx.lineTo(-10, -58); ctx.lineTo(-4, -84); ctx.lineTo(14, -60); ctx.lineTo(30, -76); ctx.lineTo(40, -40);
      ctx.quadraticCurveTo(26, -10, 0, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = dark; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-30, -70); ctx.moveTo(0, 0); ctx.lineTo(-4, -84); ctx.moveTo(0, 0); ctx.lineTo(30, -76); ctx.stroke();
      ctx.restore();
    };
    wing(-1, 0.7);
    // pattes
    ctx.fillStyle = dark;
    const legs = flying ? 10 : 0;
    rr(ctx, -30, 14 + legs * 0.5, 16, 34 - legs, 7); ctx.fill(); ctx.stroke();
    rr(ctx, 14, 14 + legs * 0.5, 16, 34 - legs, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f2ead2';
    for (const x of [-28, -22, 16, 22]) { ctx.beginPath(); ctx.moveTo(x, 46 - legs * 0.5); ctx.lineTo(x + 3, 52 - legs * 0.5); ctx.lineTo(x + 6, 46 - legs * 0.5); ctx.fill(); }
    // corps
    const body = ctx.createRadialGradient(0, -14, 8, 0, 0, 60);
    body.addColorStop(0, shade(red, 0.18));
    body.addColorStop(1, dark);
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(0, 0 + breathe * 0.4, 50, 32, -0.08, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // ventre écaillé
    ctx.fillStyle = belly;
    ctx.beginPath(); ctx.ellipse(8, 14 + breathe * 0.4, 34, 15, -0.08, 0, Math.PI); ctx.fill();
    ctx.strokeStyle = 'rgba(120,60,10,.45)'; ctx.lineWidth = 1.5;
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(8 + i * 12, 15); ctx.lineTo(8 + i * 12, 27); ctx.stroke(); }
    // crête dorsale
    ctx.fillStyle = dark;
    for (let i = 0; i < 6; i++) {
      const x = -40 + i * 13;
      const y = -26 - Math.sin((i / 5) * Math.PI) * 6;
      ctx.beginPath(); ctx.moveTo(x - 5, y + 4); ctx.lineTo(x, y - 10); ctx.lineTo(x + 5, y + 4); ctx.fill();
    }
    // cou et tête
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 2.5;
    ctx.fillStyle = red;
    ctx.beginPath();
    ctx.moveTo(26, -18); ctx.quadraticCurveTo(48, -40, 52, -62); ctx.lineTo(72, -58); ctx.quadraticCurveTo(64, -24, 44, 6);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    const hx = 66;
    const hy = -66 + breathe;
    const jaw = 0.12 + swing * 0.5;
    // mâchoire inférieure
    ctx.save();
    ctx.translate(hx - 4, hy + 6);
    ctx.rotate(jaw);
    ctx.fillStyle = dark;
    rr(ctx, 0, -4, 38, 10, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(8 + i * 8, -4); ctx.lineTo(11 + i * 8, -10); ctx.lineTo(14 + i * 8, -4); ctx.fill(); }
    ctx.restore();
    // crâne et museau
    ctx.fillStyle = red;
    ctx.beginPath(); ctx.ellipse(hx, hy, 20, 15, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    rr(ctx, hx + 2, hy - 8, 40, 16, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(hx + 12 + i * 8, hy + 8); ctx.lineTo(hx + 15 + i * 8, hy + 14); ctx.lineTo(hx + 18 + i * 8, hy + 8); ctx.fill(); }
    // cornes
    ctx.fillStyle = '#efe2c0';
    ctx.beginPath(); ctx.moveTo(hx - 12, hy - 8); ctx.quadraticCurveTo(hx - 34, hy - 26, hx - 30, hy - 40); ctx.quadraticCurveTo(hx - 18, hy - 24, hx - 4, hy - 13); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx - 2, hy - 12); ctx.quadraticCurveTo(hx - 12, hy - 32, hx - 4, hy - 42); ctx.quadraticCurveTo(hx, hy - 26, hx + 8, hy - 14); ctx.closePath(); ctx.fill(); ctx.stroke();
    // œil qui brille
    ctx.save();
    ctx.shadowColor = '#ffd23f';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffe35a';
    ctx.beginPath(); ctx.ellipse(hx + 6, hy - 4, 5, 3.5, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#111';
    ctx.fillRect(hx + 6, hy - 7, 1.8, 6);
    // naseaux fumants
    ctx.fillStyle = '#3a0d0a';
    ctx.beginPath(); ctx.arc(hx + 38, hy - 3, 2, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 2; i++) {
      const k = (t * 1.2 + i / 2) % 1;
      ctx.fillStyle = o.enraged || o.phase ? `rgba(255,140,40,${0.5 * (1 - k)})` : `rgba(200,200,200,${0.3 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(hx + 44 + k * 16, hy - 6 - k * 14, 3 + k * 5, 0, Math.PI * 2); ctx.fill();
    }
    // aile avant
    wing(1, 1);
    flashOver(ctx, o.flash, () => {
      ctx.beginPath(); ctx.ellipse(0, 0, 50, 32, -0.08, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(hx, hy, 20, 15, 0, 0, Math.PI * 2); ctx.fill();
    });
  }

  // Dragonnet : un petit dragon (même dessin, réduit) qui sort d'un œuf.
  function dragonnet(ctx, o) {
    ctx.save();
    ctx.scale(0.3, 0.3);
    ctx.translate(0, 4);
    dragon(ctx, Object.assign({}, o, { whelp: true, flash: o.flash }));
    ctx.restore();
    shadow(ctx, 16, 17);
  }

  // Œuf de dragon : se fissure à l'approche de l'éclosion (o.crack de 0 à 1).
  function oeuf(ctx, o) {
    const t = (o.t || 0) / 1000;
    const crack = o.crack || 0;
    const wobble = crack > 0.6 ? Math.sin(t * 30) * crack * 0.12 : 0;
    shadow(ctx, 15, 17);
    ctx.save();
    ctx.translate(0, 16);
    ctx.rotate(wobble);
    const g = ctx.createRadialGradient(-5, -26, 3, 0, -16, 26);
    g.addColorStop(0, '#fff1c7');
    g.addColorStop(0.55, '#e7a94a');
    g.addColorStop(1, '#8a4a16');
    ctx.fillStyle = g;
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, -18, 15, 20, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(150,40,20,.55)';
    for (const [x, y, r] of [[-6, -26, 3], [5, -16, 4], [-3, -9, 2.5], [7, -30, 2]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    if (crack > 0.2) {
      ctx.save();
      ctx.shadowColor = '#ff8a1f';
      ctx.shadowBlur = 8 * crack;
      ctx.strokeStyle = `rgba(255,${200 - crack * 120},60,${0.5 + crack * 0.5})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-12, -22); ctx.lineTo(-5, -18); ctx.lineTo(-8, -12); ctx.lineTo(0, -8);
      if (crack > 0.5) { ctx.moveTo(-5, -18); ctx.lineTo(3, -24); ctx.lineTo(10, -20); }
      if (crack > 0.8) { ctx.moveTo(0, -8); ctx.lineTo(6, -6); ctx.lineTo(12, -12); }
      ctx.stroke();
      ctx.restore();
    }
    flashOver(ctx, o.flash, () => { ctx.beginPath(); ctx.ellipse(0, -18, 15, 20, 0, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }

  /*
   * Malvorath le Magicien des ténèbres (et ses illusions) : longue robe, capuche, yeux violets, bâton à orbe.
   * Il flotte au-dessus du sol. o.swing : il lève son bâton pour lancer un sort.
   */
  function sorcier(ctx, o) {
    const t = (o.t || 0) / 1000;
    const swing = o.swing || 0;
    const float = Math.sin(t * 2.4 + (o.seed || 0)) * 4;
    shadow(ctx, 30, 42);
    ctx.save();
    ctx.translate(0, float - 6);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 2;
    // cape qui flotte
    ctx.fillStyle = '#160a26';
    ctx.beginPath();
    const wave = Math.sin(t * 3) * 5;
    ctx.moveTo(-14, -34); ctx.quadraticCurveTo(-40, 0, -34 + wave, 40); ctx.lineTo(26, 40); ctx.quadraticCurveTo(30, 0, 14, -34);
    ctx.closePath(); ctx.fill();
    // robe étoilée
    const robe = ctx.createLinearGradient(0, -30, 0, 44);
    robe.addColorStop(0, '#4a2478');
    robe.addColorStop(1, '#1f0d38');
    ctx.fillStyle = robe;
    ctx.beginPath();
    ctx.moveTo(-14, -30); ctx.lineTo(14, -30); ctx.lineTo(26, 38);
    ctx.lineTo(16, 34); ctx.lineTo(8, 40); ctx.lineTo(0, 34); ctx.lineTo(-8, 40); ctx.lineTo(-16, 34); ctx.lineTo(-26, 38);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(214,170,255,.8)';
    for (const [x, y] of [[-8, 0], [6, 14], [-12, 24], [12, -10], [2, 28]]) {
      ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x + 1, y - 1); ctx.lineTo(x + 3, y); ctx.lineTo(x + 1, y + 1); ctx.lineTo(x, y + 3); ctx.lineTo(x - 1, y + 1); ctx.lineTo(x - 3, y); ctx.lineTo(x - 1, y - 1); ctx.closePath(); ctx.fill();
    }
    // ceinture et bras arrière
    ctx.fillStyle = '#c9a646';
    ctx.fillRect(-15, 2, 30, 4);
    ctx.fillStyle = '#2d1550';
    ctx.beginPath(); ctx.ellipse(-16, -12, 7, 16, 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // capuche pointue
    ctx.fillStyle = '#2a1148';
    ctx.beginPath();
    ctx.moveTo(-17, -30); ctx.quadraticCurveTo(-18, -58, 0, -66); ctx.quadraticCurveTo(10, -76, 24, -86);
    ctx.quadraticCurveTo(14, -66, 18, -52); ctx.quadraticCurveTo(20, -38, 17, -30);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // visage dans l'ombre, yeux qui brillent
    ctx.fillStyle = '#05020a';
    ctx.beginPath(); ctx.ellipse(1, -44, 11, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.shadowColor = '#c56bff';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#e7b8ff';
    ctx.beginPath(); ctx.ellipse(-3, -46, 2.6, 1.6, -0.15, 0, Math.PI * 2); ctx.ellipse(6, -46, 2.6, 1.6, 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // barbe grise
    ctx.fillStyle = '#9a95a8';
    ctx.beginPath(); ctx.moveTo(-7, -36); ctx.lineTo(9, -36); ctx.lineTo(4, -18); ctx.lineTo(1, -24); ctx.lineTo(-2, -16); ctx.closePath(); ctx.fill();
    // bâton à orbe (levé pour lancer un sort)
    ctx.save();
    ctx.translate(18, -6);
    ctx.rotate(0.12 - swing * 0.5);
    ctx.fillStyle = '#3b2412';
    rr(ctx, -2, -56, 4, 84, 2); ctx.fill();
    ctx.fillStyle = '#5c3a1c';
    ctx.beginPath(); ctx.moveTo(-6, -58); ctx.quadraticCurveTo(0, -72, 6, -58); ctx.lineTo(3, -54); ctx.lineTo(-3, -54); ctx.closePath(); ctx.fill();
    const glow = 0.6 + Math.sin(t * 5) * 0.2 + swing * 0.4;
    const orb = ctx.createRadialGradient(0, -64, 1, 0, -64, 12);
    orb.addColorStop(0, '#fff');
    orb.addColorStop(0.4, `rgba(200,120,255,${glow})`);
    orb.addColorStop(1, 'rgba(110,30,200,0)');
    ctx.fillStyle = orb;
    ctx.beginPath(); ctx.arc(0, -64, 12 + swing * 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // main osseuse
    ctx.fillStyle = '#cfc6d8';
    ctx.beginPath(); ctx.arc(18, -6, 4, 0, Math.PI * 2); ctx.fill();
    flashOver(ctx, o.flash, () => {
      ctx.beginPath(); ctx.moveTo(-14, -30); ctx.lineTo(14, -30); ctx.lineTo(26, 38); ctx.lineTo(-26, 38); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.ellipse(1, -46, 16, 18, 0, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }

  // Flammèche : petit esprit de feu lâché par le Dragon en vol (cible du corps à corps).
  function flammeche(ctx, o) {
    const t = (o.t || 0) / 1000;
    const flick = Math.sin(t * 14 + (o.seed || 0)) * 2;
    shadow(ctx, 10, 16);
    ctx.save();
    ctx.translate(0, Math.sin(t * 4 + (o.seed || 0)) * 2 - 2);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, -4, 1, 0, -6, 18);
    g.addColorStop(0, '#fff6c0');
    g.addColorStop(0.45, '#ff9a1f');
    g.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -26 - flick);
    ctx.quadraticCurveTo(12, -10, 9, 4);
    ctx.quadraticCurveTo(0, 12, -9, 4);
    ctx.quadraticCurveTo(-12, -10, 0, -26 - flick);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    eye(ctx, -3.5, -4, 2.2, '#3a0d0a', null);
    eye(ctx, 3.5, -4, 2.2, '#3a0d0a', null);
    flashOver(ctx, o.flash, () => { ctx.beginPath(); ctx.arc(0, -4, 10, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }

  // Cristal de clan (Guerre des clans) : grand cristal aux couleurs de l'équipe (o.color), qui se défend.
  function cristalClan(ctx, o) {
    const t = (o.t || 0) / 1000;
    const c = o.color || '#ff4d6d';
    shadow(ctx, 30, 30);
    ctx.save();
    // socle de pierre
    ctx.fillStyle = '#4a4458';
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.lineWidth = 2;
    rr(ctx, -26, 14, 52, 16, 6); ctx.fill(); ctx.stroke();
    ctx.translate(0, Math.sin(t * 2) * 2);
    ctx.save();
    ctx.shadowColor = c;
    ctx.shadowBlur = 22 + Math.sin(t * 4) * 8;
    const g = ctx.createLinearGradient(-20, -70, 20, 14);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, c);
    g.addColorStop(1, shade(c, -0.55));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -74); ctx.lineTo(20, -36); ctx.lineTo(14, 14); ctx.lineTo(-14, 14); ctx.lineTo(-20, -36);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -74); ctx.lineTo(0, 14); ctx.moveTo(-20, -36); ctx.lineTo(20, -36); ctx.stroke();
    // petits éclats en orbite
    for (let i = 0; i < 3; i++) {
      const a = t * 1.6 + i * 2.1;
      ctx.fillStyle = shade(c, 0.4);
      ctx.beginPath(); ctx.arc(Math.cos(a) * 30, -30 + Math.sin(a) * 10, 3, 0, Math.PI * 2); ctx.fill();
    }
    flashOver(ctx, o.flash, () => { ctx.beginPath(); ctx.moveTo(0, -74); ctx.lineTo(20, -36); ctx.lineTo(14, 14); ctx.lineTo(-14, 14); ctx.lineTo(-20, -36); ctx.closePath(); ctx.fill(); });
    ctx.restore();
  }

  // Cristal d'ombre : nourrit le bouclier du Magicien tant qu'il tient debout.
  function cristal(ctx, o) {
    const t = (o.t || 0) / 1000;
    const hover = Math.sin(t * 2.5 + (o.seed || 0)) * 3;
    shadow(ctx, 14, 18);
    ctx.save();
    ctx.translate(0, hover - 4);
    ctx.save();
    ctx.shadowColor = '#b06bff';
    ctx.shadowBlur = 16 + Math.sin(t * 6) * 6;
    const g = ctx.createLinearGradient(-12, -36, 12, 10);
    g.addColorStop(0, '#f0d8ff');
    g.addColorStop(0.45, '#9b59ff');
    g.addColorStop(1, '#3a1470');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -38); ctx.lineTo(12, -16); ctx.lineTo(8, 10); ctx.lineTo(-8, 10); ctx.lineTo(-12, -16);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(0, 10); ctx.moveTo(-12, -16); ctx.lineTo(12, -16); ctx.stroke();
    flashOver(ctx, o.flash, () => { ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(12, -16); ctx.lineTo(8, 10); ctx.lineTo(-8, 10); ctx.lineTo(-12, -16); ctx.closePath(); ctx.fill(); });
    ctx.restore();
  }

  /*
   * Grignotor le Mimic : un coffre de bois cerclé d'or, couvercle qui s'ouvre sur des rangées de dents,
   * une langue baveuse et deux yeux jaunes au fond. o.swing : il claque des mâchoires. Petites pattes griffues.
   */
  function mimic(ctx, o) {
    const t = (o.t || 0) / 1000;
    const swing = o.swing || 0;
    const phase = o.phase || 0;
    const step = Math.sin(t * 9 + (o.seed || 0));
    shadow(ctx, 56, 44);
    ctx.save();
    ctx.lineJoin = 'round';
    // pattes griffues
    ctx.fillStyle = '#3b2412';
    for (const [x, k] of [[-38, 1], [-16, -1], [14, 1], [36, -1]]) {
      const lift = Math.max(0, step * k) * 5;
      ctx.beginPath(); ctx.moveTo(x - 6, 30); ctx.lineTo(x + 6, 30); ctx.lineTo(x + 4, 42 - lift); ctx.lineTo(x - 4, 42 - lift); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8e2cf';
      ctx.beginPath(); ctx.moveTo(x - 5, 42 - lift); ctx.lineTo(x - 2, 47 - lift); ctx.lineTo(x, 42 - lift); ctx.lineTo(x + 2, 47 - lift); ctx.lineTo(x + 5, 42 - lift); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3b2412';
    }
    const open = 0.32 + Math.sin(t * 2.6) * 0.06 + swing * 0.5 + phase * 0.04;
    // intérieur de la gueule
    const hx = -52;
    const hy = -6;
    const lidEnd = { x: hx + Math.cos(-open) * 104, y: hy + Math.sin(-open) * 104 };
    const mouth = ctx.createLinearGradient(0, lidEnd.y, 0, hy);
    mouth.addColorStop(0, '#2a0508');
    mouth.addColorStop(1, '#6e0f1a');
    ctx.fillStyle = mouth;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(lidEnd.x, lidEnd.y); ctx.lineTo(52, hy); ctx.closePath(); ctx.fill();
    // yeux au fond de la gueule
    ctx.save();
    ctx.shadowColor = o.enraged ? '#ff3b2a' : '#ffd23f';
    ctx.shadowBlur = 14;
    ctx.fillStyle = o.enraged ? '#ff6b4a' : '#ffe14a';
    const ey = hy - 16 * open / 0.32;
    ctx.beginPath(); ctx.ellipse(-14, ey, 6, 4, -0.2, 0, Math.PI * 2); ctx.ellipse(8, ey - 2, 6, 4, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#1a0306';
    ctx.beginPath(); ctx.ellipse(-13, ey, 1.6, 3.4, 0, 0, Math.PI * 2); ctx.ellipse(9, ey - 2, 1.6, 3.4, 0, 0, Math.PI * 2); ctx.fill();
    // corps du coffre (planches, cerclages dorés)
    const wood = ctx.createLinearGradient(0, -6, 0, 40);
    wood.addColorStop(0, '#9a6230');
    wood.addColorStop(1, '#5a3315');
    ctx.fillStyle = wood;
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 2;
    rr(ctx, -54, -6, 108, 46, 6); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(40,20,5,.5)';
    ctx.lineWidth = 1.2;
    for (const y of [8, 22]) { ctx.beginPath(); ctx.moveTo(-52, y); ctx.lineTo(52, y); ctx.stroke(); }
    const gold = o.enraged ? '#e0603a' : '#d9a441';
    ctx.fillStyle = gold;
    for (const x of [-44, 36]) { rr(ctx, x, -6, 8, 46, 2); ctx.fill(); }
    ctx.fillStyle = shade(gold, 0.35);
    for (const [x, y] of [[-40, 0], [-40, 32], [40, 0], [40, 32]]) { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); }
    // dents du bas
    ctx.fillStyle = '#f4ecd6';
    ctx.strokeStyle = 'rgba(90,60,30,.6)';
    ctx.lineWidth = 0.8;
    for (let x = -46; x <= 44; x += 10) {
      ctx.beginPath(); ctx.moveTo(x, -5); ctx.lineTo(x + 4.5, -15 - (x % 20 === 0 ? 3 : 0)); ctx.lineTo(x + 9, -5); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // langue baveuse qui pend sur le devant
    const sway = Math.sin(t * 3.2) * 6;
    ctx.fillStyle = '#e0607e';
    ctx.strokeStyle = '#8a2038';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(18, -8); ctx.quadraticCurveTo(58, -14, 56 + sway * 0.3, 16 + swing * 6);
    ctx.quadraticCurveTo(52 + sway, 34, 42 + sway, 30); ctx.quadraticCurveTo(40, 8, 8, -4); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(138,32,56,.6)';
    ctx.beginPath(); ctx.moveTo(26, -6); ctx.quadraticCurveTo(48, -6, 48 + sway * 0.6, 22); ctx.stroke();
    // bave
    ctx.fillStyle = 'rgba(200,240,255,.7)';
    const drip = (t * 1.3 + (o.seed || 0)) % 1;
    ctx.beginPath(); ctx.ellipse(46 + sway, 32 + drip * 16, 2, 3 + drip * 2, 0, 0, Math.PI * 2); ctx.fill();
    // couvercle (articulé à l'arrière)
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(-open);
    const lid = ctx.createLinearGradient(0, -34, 0, 0);
    lid.addColorStop(0, '#b47a3e');
    lid.addColorStop(1, '#6e4019');
    ctx.fillStyle = lid;
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -18); ctx.quadraticCurveTo(52, -42, 104, -18); ctx.lineTo(104, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = gold;
    rr(ctx, 8, -26, 8, 26, 2); ctx.fill();
    rr(ctx, 88, -26, 8, 26, 2); ctx.fill();
    // serrure (devient un œil quand il s'énerve)
    ctx.fillStyle = shade(gold, 0.2);
    rr(ctx, 94, -12, 12, 14, 3); ctx.fill();
    ctx.fillStyle = phase > 0 ? '#ff3b2a' : '#2a1606';
    ctx.beginPath(); ctx.arc(100, -6, 2.6, 0, Math.PI * 2); ctx.fill();
    // dents du haut
    ctx.fillStyle = '#f4ecd6';
    ctx.strokeStyle = 'rgba(90,60,30,.6)';
    ctx.lineWidth = 0.8;
    for (let x = 4; x <= 94; x += 10) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 4.5, 11 + (x % 20 === 4 ? 3 : 0)); ctx.lineTo(x + 9, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore();
    flashOver(ctx, o.flash, () => { rr(ctx, -54, -40, 108, 80, 8); ctx.fill(); });
    ctx.restore();
  }

  /*
   * Givrenoire la Liche de glace : squelette mage dans une robe déchirée bleu nuit, couronne de glace,
   * yeux cyan, bâton surmonté d'un cristal de givre. Elle flotte, des volutes de froid sous sa robe.
   */
  function liche(ctx, o) {
    const t = (o.t || 0) / 1000;
    const swing = o.swing || 0;
    const float = Math.sin(t * 2 + (o.seed || 0)) * 4;
    shadow(ctx, 30, 42);
    ctx.save();
    ctx.translate(0, float - 6);
    ctx.lineJoin = 'round';
    // volutes de froid
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const k = (t * 0.6 + i / 5) % 1;
      ctx.fillStyle = `rgba(140,220,255,${0.25 * (1 - k)})`;
      ctx.beginPath(); ctx.ellipse(-18 + i * 9 + Math.sin(t * 2 + i) * 4, 40 + k * 10, 8 + k * 8, 4 + k * 3, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // robe déchirée
    const robe = ctx.createLinearGradient(0, -30, 0, 44);
    robe.addColorStop(0, '#2c4a78');
    robe.addColorStop(1, '#0d1a33');
    ctx.fillStyle = robe;
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 2;
    const w = Math.sin(t * 3) * 3;
    ctx.beginPath();
    ctx.moveTo(-15, -30); ctx.lineTo(15, -30); ctx.lineTo(27, 30);
    ctx.lineTo(20 + w, 42); ctx.lineTo(13, 32); ctx.lineTo(6 - w, 44); ctx.lineTo(-1, 33); ctx.lineTo(-8 + w, 45); ctx.lineTo(-14, 32); ctx.lineTo(-22 - w, 42); ctx.lineTo(-27, 30);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // givre sur la robe
    ctx.strokeStyle = 'rgba(190,240,255,.55)';
    ctx.lineWidth = 1.2;
    for (const [x, y] of [[-10, 6], [8, 18], [-4, 26]]) {
      for (let a = 0; a < 3; a++) { const ang = a * Math.PI / 3; ctx.beginPath(); ctx.moveTo(x - Math.cos(ang) * 4, y - Math.sin(ang) * 4); ctx.lineTo(x + Math.cos(ang) * 4, y + Math.sin(ang) * 4); ctx.stroke(); }
    }
    // cage thoracique visible
    ctx.strokeStyle = '#d8e6ee';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-9, -22 + i * 6); ctx.quadraticCurveTo(0, -18 + i * 6, 9, -22 + i * 6); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, -2); ctx.stroke();
    // épaulières de glace
    ctx.fillStyle = '#9fe6ff';
    ctx.strokeStyle = 'rgba(30,80,120,.7)';
    ctx.lineWidth = 1.2;
    for (const k of [-1, 1]) { ctx.beginPath(); ctx.moveTo(14 * k, -32); ctx.lineTo(26 * k, -40); ctx.lineTo(22 * k, -28); ctx.lineTo(30 * k, -30); ctx.lineTo(20 * k, -22); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    // crâne
    ctx.fillStyle = '#e9f1f4';
    ctx.strokeStyle = 'rgba(40,60,80,.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(1, -46, 12, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    rr(ctx, -6, -38, 14, 8, 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5a6a78';
    for (let i = 0; i < 4; i++) ctx.fillRect(-4 + i * 3.4, -36, 1.2, 5);
    // orbites et yeux cyan
    ctx.fillStyle = '#0a1420';
    ctx.beginPath(); ctx.ellipse(-4, -47, 4, 4.5, 0, 0, Math.PI * 2); ctx.ellipse(7, -47, 4, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.shadowColor = '#5fe0ff';
    ctx.shadowBlur = 14;
    ctx.fillStyle = o.enraged ? '#ff9ad0' : '#bff6ff';
    ctx.beginPath(); ctx.arc(-4, -47, 1.8, 0, Math.PI * 2); ctx.arc(7, -47, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // couronne de glace
    ctx.fillStyle = 'rgba(170,235,255,.95)';
    ctx.strokeStyle = 'rgba(40,110,160,.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-12, -56); ctx.lineTo(-10, -68); ctx.lineTo(-5, -58); ctx.lineTo(0, -76); ctx.lineTo(5, -58); ctx.lineTo(10, -70); ctx.lineTo(13, -56);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // bras osseux et bâton à cristal
    ctx.save();
    ctx.translate(18, -8);
    ctx.rotate(0.1 - swing * 0.6);
    ctx.fillStyle = '#6b7d8c';
    rr(ctx, -2, -58, 4, 88, 2); ctx.fill();
    const glow = 0.6 + Math.sin(t * 4) * 0.2 + swing * 0.4;
    ctx.save();
    ctx.shadowColor = '#7fe8ff';
    ctx.shadowBlur = 16 + swing * 10;
    ctx.fillStyle = `rgba(190,245,255,${0.7 + glow * 0.3})`;
    ctx.strokeStyle = '#2a7fb0';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, -84 - swing * 4); ctx.lineTo(8, -66); ctx.lineTo(0, -56); ctx.lineTo(-8, -66); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.restore();
    ctx.strokeStyle = '#d8e6ee';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(10, -24); ctx.lineTo(18, -10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-10, -24); ctx.quadraticCurveTo(-22, -10, -16, 2); ctx.stroke();
    flashOver(ctx, o.flash, () => {
      ctx.beginPath(); ctx.moveTo(-15, -30); ctx.lineTo(15, -30); ctx.lineTo(27, 40); ctx.lineTo(-27, 40); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.ellipse(1, -46, 14, 15, 0, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }

  /*
   * Maexxna la Veuve noire : grosse araignée noire luisante, sablier rouge sur l'abdomen, huit pattes articulées
   * qui marchent, crochets verts qui gouttent de venin, yeux rouges. o.small : version araignée (petites créatures).
   */
  function maexxna(ctx, o) {
    const t = (o.t || 0) / 1000;
    const swing = o.swing || 0;
    const small = !!o.small;
    const walk = t * (small ? 16 : 7) + (o.seed || 0);
    if (!small) shadow(ctx, 70, 30);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const body = o.enraged ? '#2a0a10' : '#121018';
    // pattes (4 paires)
    const legs = [[-82, 0], [-44, 1], [34, 0], [78, 1], [-96, 1], [-60, 0], [54, 1], [94, 0]];
    legs.forEach(([fx, k], i) => {
      const back = i >= 4;
      const lift = Math.max(0, Math.sin(walk + k * Math.PI + i * 0.4)) * 7;
      const ax = 12 + (i % 4) * 4 - 8;
      const ay = -14;
      const kx = ax + (fx - ax) * 0.45;
      const ky = -52 - (i % 4 === 1 || i % 4 === 2 ? 6 : 0) - lift * 0.6;
      ctx.strokeStyle = back ? '#08070c' : '#1d1a26';
      ctx.lineWidth = small ? 4 : 5.5;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(kx, ky); ctx.lineTo(fx, 28 - lift); ctx.stroke();
      ctx.strokeStyle = 'rgba(120,110,150,.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(ax, ay - 1); ctx.lineTo(kx, ky - 1); ctx.stroke();
    });
    // abdomen
    const ab = ctx.createRadialGradient(-36, -38, 4, -28, -24, 40);
    ab.addColorStop(0, '#4a4458');
    ab.addColorStop(0.35, body);
    ab.addColorStop(1, '#000');
    ctx.fillStyle = ab;
    ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.lineWidth = 2;
    const pulse = 1 + Math.sin(t * 2.5) * 0.02;
    ctx.beginPath(); ctx.ellipse(-30, -24, 36 * pulse, 30 * pulse, -0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // sablier rouge
    ctx.save();
    ctx.shadowColor = '#ff2040';
    ctx.shadowBlur = small ? 4 : 10;
    ctx.fillStyle = '#e8203c';
    ctx.beginPath(); ctx.moveTo(-40, -42); ctx.lineTo(-24, -42); ctx.lineTo(-32, -30); ctx.lineTo(-24, -18); ctx.lineTo(-40, -18); ctx.lineTo(-32, -30); ctx.closePath(); ctx.fill();
    ctx.restore();
    // reflet
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.beginPath(); ctx.ellipse(-40, -40, 10, 5, -0.5, 0, Math.PI * 2); ctx.fill();
    // céphalothorax
    const th = ctx.createRadialGradient(14, -22, 2, 18, -14, 22);
    th.addColorStop(0, '#3a3546');
    th.addColorStop(1, body);
    ctx.fillStyle = th;
    ctx.beginPath(); ctx.ellipse(18, -14, 22, 17, 0.1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // yeux rouges (8)
    ctx.save();
    ctx.shadowColor = '#ff1a2a';
    ctx.shadowBlur = small ? 3 : 8;
    ctx.fillStyle = '#ff3344';
    for (const [x, y, r] of [[30, -22, 3], [36, -19, 3.4], [26, -16, 2], [33, -12, 2.2], [22, -24, 1.6], [38, -14, 1.6]]) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // crochets venimeux
    const bite = swing * 0.5;
    ctx.fillStyle = '#2b2735';
    for (const k of [-1, 1]) {
      ctx.save();
      ctx.translate(38, -6 + k * 4);
      ctx.rotate(k * (0.3 + bite));
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.quadraticCurveTo(12, 0, 8, 12); ctx.lineTo(4, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    if (!small) {
      ctx.fillStyle = 'rgba(120,255,90,.8)';
      const drip = (t * 1.6 + (o.seed || 0)) % 1;
      ctx.beginPath(); ctx.ellipse(46, 6 + drip * 14, 1.8, 2.6 + drip * 2, 0, 0, Math.PI * 2); ctx.fill();
    }
    flashOver(ctx, o.flash, () => {
      ctx.beginPath(); ctx.ellipse(-30, -24, 36, 30, -0.15, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(18, -14, 22, 17, 0.1, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }

  // Petite araignée de la nuée de Maexxna.
  function araignee(ctx, o) {
    shadow(ctx, 12, 16);
    ctx.save();
    ctx.translate(2, 10);
    ctx.scale(0.28, 0.28);
    maexxna(ctx, Object.assign({}, o, { small: true }));
    ctx.restore();
  }

  // Cocon de soie de Maexxna : un héros y est enfermé (on devine sa silhouette), il palpite.
  function cocon(ctx, o) {
    const t = (o.t || 0) / 1000;
    const throb = 1 + Math.sin(t * 5 + (o.seed || 0)) * 0.04;
    shadow(ctx, 16, 18);
    ctx.save();
    ctx.translate(0, -4);
    ctx.scale(throb, 1 / throb);
    const g = ctx.createRadialGradient(-5, -16, 3, 0, -4, 30);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.6, '#e4e0ea');
    g.addColorStop(1, '#a7a0b6');
    ctx.fillStyle = g;
    ctx.strokeStyle = 'rgba(80,70,100,.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, -4, 17, 26, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(70,60,90,.18)';
    ctx.beginPath(); ctx.arc(0, -16, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 2, 8, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(150,140,170,.7)';
    ctx.lineWidth = 1;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath(); ctx.moveTo(-17, -4 + i * 7); ctx.quadraticCurveTo(0, -8 + i * 7 + Math.sin(i) * 3, 17, -2 + i * 7); ctx.stroke();
    }
    flashOver(ctx, o.flash, () => { ctx.beginPath(); ctx.ellipse(0, -4, 17, 26, 0, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }

  /*
   * Ether le Fantôme : un grand drap spectral bleuté au bas qui ondule, yeux creux qui luisent, bouche béante,
   * chaînes qui traînent. Intangible : il devient presque transparent.
   */
  function ether(ctx, o) {
    const t = (o.t || 0) / 1000;
    const swing = o.swing || 0;
    const float = Math.sin(t * 2 + (o.seed || 0)) * 6;
    shadow(ctx, 34, 44);
    ctx.save();
    ctx.translate(0, float - 10);
    if (o.intangible) ctx.globalAlpha *= 0.42 + Math.sin(t * 6) * 0.08;
    const halo = ctx.createRadialGradient(0, -24, 10, 0, -24, 82);
    halo.addColorStop(0, 'rgba(190,210,255,.38)');
    halo.addColorStop(1, 'rgba(190,210,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, -24, 82, 0, Math.PI * 2); ctx.fill();
    // chaînes qui traînent derrière lui
    ctx.strokeStyle = 'rgba(120,130,165,.85)';
    ctx.lineWidth = 2;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const x = side * (18 + k * 7);
        const y = 4 + k * 6 + Math.sin(t * 3 + k + side) * 2;
        ctx.beginPath(); ctx.ellipse(x, y, 4, 2.6, side * 0.6 + k * 0.3, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // le drap
    const body = ctx.createLinearGradient(0, -82, 0, 40);
    body.addColorStop(0, '#f6f8ff');
    body.addColorStop(0.55, '#cbd6ff');
    body.addColorStop(1, 'rgba(150,170,240,0.25)');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-35, 2);
    ctx.bezierCurveTo(-40, -52, -22, -82, 0, -84);
    ctx.bezierCurveTo(22, -82, 40, -52, 35, 2);
    for (let i = 0; i <= 7; i++) {
      const x = 35 - i * 10;
      const y = 26 + Math.sin(t * 4 + i * 1.3) * 5 + (i % 2 ? -7 : 5);
      ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(90,110,180,.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // bras spectraux (levés pour frapper)
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 30, -34);
      ctx.rotate(side * (0.5 + swing * 0.9));
      ctx.fillStyle = '#dde5ff';
      ctx.beginPath(); ctx.ellipse(side * 6, 12, 8, 19, side * 0.25, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#eef2ff';
      for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.ellipse(side * 6 + k * 4, 32, 2.2, 6, k * 0.25, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    // visage : orbites creuses, yeux qui luisent, bouche béante
    ctx.fillStyle = '#121833';
    ctx.beginPath(); ctx.ellipse(-12, -52, 8, 11, -0.1, 0, Math.PI * 2); ctx.ellipse(12, -52, 8, 11, 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -28, 9, 12 + swing * 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.shadowColor = '#7fb0ff';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#cfe6ff';
    ctx.beginPath(); ctx.arc(-11, -51, 2.6, 0, Math.PI * 2); ctx.arc(13, -51, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    flashOver(ctx, o.flash, () => { ctx.beginPath(); ctx.ellipse(0, -30, 36, 56, 0, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }

  // Main spectrale (Ether) : elle jaillit du sol, doigts crochus, et tremble.
  function main(ctx, o) {
    const t = (o.t || 0) / 1000;
    const wob = Math.sin(t * 7 + (o.seed || 0)) * 0.12;
    ctx.fillStyle = 'rgba(40,50,90,.45)';
    ctx.beginPath(); ctx.ellipse(0, 16, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(0, 14);
    ctx.rotate(wob);
    ctx.globalAlpha *= 0.85;
    const g = ctx.createLinearGradient(0, 0, 0, -44);
    g.addColorStop(0, 'rgba(150,170,240,.3)');
    g.addColorStop(1, '#e6ecff');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-7, -26); ctx.lineTo(7, -26); ctx.lineTo(6, 0); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -30, 10, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#eef2ff';
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.4;
    for (let k = 0; k < 4; k++) {
      const a = -1.9 + k * 0.42 + Math.sin(t * 6 + k) * 0.08;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 7, -32 + Math.sin(a) * 6);
      ctx.quadraticCurveTo(Math.cos(a) * 14, -38 + Math.sin(a) * 10, Math.cos(a) * 16 + 2, -34 + Math.sin(a) * 15);
      ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(8, -28); ctx.quadraticCurveTo(15, -27, 15, -21); ctx.stroke();
    ctx.restore();
    flashOver(ctx, o.flash, () => { ctx.beginPath(); ctx.ellipse(0, -14, 12, 20, 0, 0, Math.PI * 2); ctx.fill(); });
  }

  // Feu follet (Ether) : petite flamme bleue qui erre, avec deux yeux.
  function feuFollet(ctx, o) {
    const t = (o.t || 0) / 1000;
    const f = Math.sin(t * 9 + (o.seed || 0));
    ctx.save();
    ctx.translate(0, -6 + Math.sin(t * 3 + (o.seed || 0)) * 3);
    ctx.shadowColor = '#6fd8ff';
    ctx.shadowBlur = 16;
    const g = ctx.createRadialGradient(0, 2, 1, 0, -2, 16);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.45, '#8fe8ff');
    g.addColorStop(1, 'rgba(60,140,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, -20 - f * 3); ctx.quadraticCurveTo(12, -4, 8, 6); ctx.quadraticCurveTo(0, 14, -8, 6); ctx.quadraticCurveTo(-12, -4, 0, -20 - f * 3); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#123';
    ctx.beginPath(); ctx.arc(-3, -4, 1.4, 0, Math.PI * 2); ctx.arc(3, -4, 1.4, 0, Math.PI * 2); ctx.fill();
  }

  // Sourire du chat (Lilith) : grand croissant sombre bordé de dents blanches.
  function grin(ctx, x, y, k = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.fillStyle = '#2a0a18';
    ctx.beginPath(); ctx.moveTo(-24, -4); ctx.quadraticCurveTo(0, 18, 24, -4); ctx.quadraticCurveTo(0, 6, -24, -4); ctx.fill();
    ctx.fillStyle = '#fffaf0';
    for (let i = 0; i < 9; i++) {
      const tx = -21 + i * 5.2;
      const ty = -2.4 + Math.pow((tx / 24), 2) * -3 + 3.2;
      ctx.beginPath(); ctx.moveTo(tx - 2.2, ty - 1.2); ctx.lineTo(tx, ty + 3.4); ctx.lineTo(tx + 2.2, ty - 1.2); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function catEyes(ctx, x, y, k = 1) {
    ctx.save();
    ctx.shadowColor = '#ffd34a';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffe14a';
    ctx.beginPath(); ctx.ellipse(x - 11 * k, y, 7 * k, 5.5 * k, -0.15, 0, Math.PI * 2); ctx.ellipse(x + 11 * k, y, 7 * k, 5.5 * k, 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#140808';
    ctx.beginPath(); ctx.ellipse(x - 10 * k, y, 1.6 * k, 5 * k, 0, 0, Math.PI * 2); ctx.ellipse(x + 12 * k, y, 1.6 * k, 5 * k, 0, 0, Math.PI * 2); ctx.fill();
  }

  /*
   * Lilith le Chat : grosse chatte tricolore (marron, noir et blanc) au sourire immense façon Cheshire, longue
   * queue rayée qui ondule. Disparue : on ne voit plus que son sourire et ses yeux. Étourdie : des étoiles tournent.
   */
  function lilith(ctx, o) {
    const t = (o.t || 0) / 1000;
    const swing = o.swing || 0;
    const BR = '#8a5a2e';
    const BK = '#221812';
    const WH = '#f3ead8';
    if (o.vanish) {
      ctx.save();
      ctx.globalAlpha *= 0.75 + Math.sin(t * 5) * 0.2;
      ctx.translate(0, -40 + Math.sin(t * 2) * 4);
      catEyes(ctx, 4, -14, 1);
      grin(ctx, 4, 8, 1.15);
      ctx.restore();
      return;
    }
    if (!o.kitten) shadow(ctx, 38, 40);
    ctx.save();
    // queue rayée
    ctx.lineCap = 'round';
    const tw = Math.sin(t * 2.5) * 8;
    ctx.strokeStyle = BK;
    ctx.lineWidth = 11;
    ctx.beginPath(); ctx.moveTo(-30, 14); ctx.bezierCurveTo(-60, 10, -58 + tw, -30, -40 + tw, -56); ctx.stroke();
    ctx.strokeStyle = BR;
    ctx.setLineDash([9, 9]);
    ctx.beginPath(); ctx.moveTo(-30, 14); ctx.bezierCurveTo(-60, 10, -58 + tw, -30, -40 + tw, -56); ctx.stroke();
    ctx.setLineDash([]);
    // pattes arrière
    ctx.fillStyle = BR;
    ctx.beginPath(); ctx.ellipse(-22, 26, 12, 14, 0, 0, Math.PI * 2); ctx.fill();
    // corps
    ctx.fillStyle = BR;
    ctx.beginPath(); ctx.ellipse(-2, 8, 36, 26, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = BK;
    ctx.beginPath(); ctx.ellipse(-16, -2, 14, 11, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = WH;
    ctx.beginPath(); ctx.ellipse(6, 18, 20, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(30,20,12,.4)';
    ctx.lineWidth = 2;
    for (const x of [-26, -18, -10]) { ctx.beginPath(); ctx.moveTo(x, -12); ctx.lineTo(x + 3, 2); ctx.stroke(); }
    // pattes avant (l'une se lève pour griffer)
    ctx.fillStyle = WH;
    ctx.beginPath(); ctx.ellipse(4, 34, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(20, 22);
    ctx.rotate(-swing * 1.3);
    ctx.fillStyle = BR;
    ctx.beginPath(); ctx.ellipse(0, 4, 7, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = WH;
    ctx.beginPath(); ctx.ellipse(0, 14, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (swing > 0.2) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(k * 3, 18); ctx.lineTo(k * 4, 23); ctx.stroke(); } }
    ctx.restore();
    // tête
    const hx = 16;
    const hy = -30;
    ctx.fillStyle = BR;
    ctx.beginPath(); ctx.arc(hx, hy, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = BK;
    ctx.beginPath(); ctx.ellipse(hx - 12, hy - 14, 15, 11, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = WH;
    ctx.beginPath(); ctx.ellipse(hx + 2, hy + 12, 20, 13, 0, 0, Math.PI * 2); ctx.fill();
    // oreilles
    for (const [ex, dir, col] of [[hx - 16, -1, BK], [hx + 16, 1, BR]]) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(ex - 10, hy - 18); ctx.lineTo(ex + dir * 4, hy - 48); ctx.lineTo(ex + 10, hy - 20); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e9a0b8';
      ctx.beginPath(); ctx.moveTo(ex - 5, hy - 20); ctx.lineTo(ex + dir * 3, hy - 40); ctx.lineTo(ex + 5, hy - 21); ctx.closePath(); ctx.fill();
    }
    catEyes(ctx, hx, hy - 6, 1);
    grin(ctx, hx + 1, hy + 10, 0.85);
    ctx.fillStyle = '#e07a9a';
    ctx.beginPath(); ctx.moveTo(hx - 3, hy + 2); ctx.lineTo(hx + 3, hy + 2); ctx.lineTo(hx, hy + 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = 1;
    for (const dy of [4, 8]) {
      ctx.beginPath(); ctx.moveTo(hx + 18, hy + dy); ctx.lineTo(hx + 40, hy + dy - 3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hx - 16, hy + dy); ctx.lineTo(hx - 38, hy + dy - 3); ctx.stroke();
    }
    if (o.dazed) {
      ctx.fillStyle = '#ffe14a';
      ctx.font = '14px "Segoe UI Emoji", sans-serif';
      ctx.textAlign = 'center';
      for (let k = 0; k < 3; k++) { const a = t * 4 + (k / 3) * Math.PI * 2; ctx.fillText('⭐', hx + Math.cos(a) * 30, hy - 40 + Math.sin(a) * 8); }
    }
    flashOver(ctx, o.flash, () => { ctx.beginPath(); ctx.ellipse(-2, 8, 36, 26, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(hx, hy, 30, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }

  // Chaton (chapeau de Lilith) : une Lilith miniature.
  function chaton(ctx, o) {
    shadow(ctx, 11, 14);
    ctx.save();
    ctx.translate(0, 8);
    ctx.scale(0.3, 0.3);
    lilith(ctx, Object.assign({}, o, { kitten: true, dazed: false, vanish: false }));
    ctx.restore();
  }

  // Chapeau magique (Lilith) : haut-de-forme noir à ruban rose, d'où sortent les chatons.
  function chapeau(ctx, o) {
    const t = (o.t || 0) / 1000;
    const hop = Math.abs(Math.sin(t * 3)) * 4;
    shadow(ctx, 22, 16);
    ctx.save();
    ctx.translate(0, -hop);
    ctx.fillStyle = '#16121c';
    ctx.beginPath(); ctx.ellipse(0, 10, 26, 7, 0, 0, Math.PI * 2); ctx.fill();
    rr(ctx, -16, -30, 32, 40, 4); ctx.fill();
    ctx.fillStyle = '#ff5fd2';
    ctx.fillRect(-16, 0, 32, 6);
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fillRect(-12, -28, 5, 26);
    ctx.fillStyle = '#ffe680';
    for (let k = 0; k < 4; k++) { const a = t * 2 + k * 1.6; const r = 22 + Math.sin(t * 3 + k) * 4; ctx.beginPath(); ctx.arc(Math.cos(a) * r, -18 + Math.sin(a) * 10, 1.8, 0, Math.PI * 2); ctx.fill(); }
    flashOver(ctx, o.flash, () => { rr(ctx, -16, -30, 32, 40, 4); ctx.fill(); });
    ctx.restore();
  }

  /*
   * Daedra la Succube : peau rouge, longs cheveux noirs, cornes, ailes membraneuses et queue de démon, tenue de
   * latex noir lustrée (corset et cuissardes), fouet de feu à la main.
   */
  function daedra(ctx, o) {
    const t = (o.t || 0) / 1000;
    const swing = o.swing || 0;
    const float = Math.sin(t * 2) * 2;
    const SKIN = '#c8303e';
    const LATEX = '#0e0a12';
    shadow(ctx, 28, 42);
    ctx.save();
    ctx.translate(0, float);
    // ailes
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(side * 6, -50);
      ctx.rotate(side * (0.3 + Math.sin(t * 3) * 0.12));
      ctx.fillStyle = '#3a0a14';
      ctx.strokeStyle = '#ff4a2a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(side * 56, -36); ctx.lineTo(side * 64, -14);
      ctx.quadraticCurveTo(side * 50, -10, side * 54, 6); ctx.quadraticCurveTo(side * 40, 0, side * 38, 16); ctx.quadraticCurveTo(side * 24, 6, side * 14, 18);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      for (const [x, y] of [[56, -36], [54, 6], [38, 16]]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(side * x, y); ctx.stroke(); }
      ctx.restore();
    }
    // queue de démon
    const tw = Math.sin(t * 3) * 6;
    ctx.strokeStyle = SKIN;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-4, 0); ctx.bezierCurveTo(-30, 12, -44, 20 + tw, -40, -6 + tw); ctx.stroke();
    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.moveTo(-40, -6 + tw); ctx.lineTo(-48, -14 + tw); ctx.lineTo(-34, -12 + tw); ctx.closePath(); ctx.fill();
    // cheveux (derrière)
    ctx.fillStyle = '#16080e';
    ctx.beginPath(); ctx.moveTo(-14, -74); ctx.quadraticCurveTo(-24, -40, -16, -18); ctx.lineTo(16, -18); ctx.quadraticCurveTo(24, -40, 14, -74); ctx.closePath(); ctx.fill();
    // cuissardes de latex
    for (const side of [-1, 1]) {
      ctx.fillStyle = SKIN;
      ctx.beginPath(); ctx.moveTo(side * 3, -4); ctx.lineTo(side * 13, -4); ctx.lineTo(side * 12, 8); ctx.lineTo(side * 4, 8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = LATEX;
      ctx.beginPath(); ctx.moveTo(side * 4, 6); ctx.lineTo(side * 12, 6); ctx.lineTo(side * 11, 36); ctx.lineTo(side * 15, 40); ctx.lineTo(side * 3, 40); ctx.lineTo(side * 5, 36); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(200,200,230,.45)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(side * 8, 10); ctx.lineTo(side * 8, 32); ctx.stroke();
    }
    // corset et jupe de latex, laçage rouge
    const lx = ctx.createLinearGradient(-14, 0, 14, 0);
    lx.addColorStop(0, LATEX); lx.addColorStop(0.5, '#2a2434'); lx.addColorStop(1, LATEX);
    ctx.fillStyle = lx;
    ctx.beginPath(); ctx.moveTo(-12, -46); ctx.quadraticCurveTo(0, -42, 12, -46); ctx.lineTo(10, -22); ctx.lineTo(16, -2); ctx.lineTo(-16, -2); ctx.lineTo(-10, -22); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ff4a5a';
    ctx.lineWidth = 0.9;
    for (let y = -40; y <= -24; y += 4) { ctx.beginPath(); ctx.moveTo(-3, y); ctx.lineTo(3, y + 2); ctx.moveTo(3, y); ctx.lineTo(-3, y + 2); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(220,220,255,.4)';
    ctx.beginPath(); ctx.moveTo(-8, -44); ctx.quadraticCurveTo(-10, -30, -7, -22); ctx.stroke();
    // épaules, bras (gauche sur la hanche, droit au fouet)
    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.ellipse(-13, -46, 5, 4, 0, 0, Math.PI * 2); ctx.ellipse(13, -46, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = SKIN;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-14, -44); ctx.quadraticCurveTo(-22, -32, -12, -22); ctx.stroke();
    ctx.save();
    ctx.translate(14, -44);
    ctx.rotate(-0.4 - swing * 1.4);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(12, 18); ctx.stroke();
    // fouet : enroulé au repos, déployé en frappant, braises au bout
    ctx.translate(12, 18);
    if (swing > 0.15) ctx.rotate(0.4 + swing * 1.4); // le fouet claque vers l'avant, à l'horizontale
    ctx.strokeStyle = '#2a1408';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    if (swing > 0.15) { ctx.moveTo(0, 0); ctx.quadraticCurveTo(30, -10, 70 * swing + 20, 6 + Math.sin(t * 20) * 4); } else { ctx.moveTo(0, 0); ctx.bezierCurveTo(10, 12, -6, 22, 4, 26); ctx.arc(2, 22, 6, 0.5, Math.PI * 2.3); }
    ctx.stroke();
    if (swing > 0.15) {
      ctx.save(); ctx.shadowColor = '#ff6a1f'; ctx.shadowBlur = 12; ctx.fillStyle = '#ffb347';
      ctx.beginPath(); ctx.arc(70 * swing + 20, 6, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.restore();
    // tête
    ctx.fillStyle = SKIN;
    ctx.fillRect(-3, -54, 6, 6);
    ctx.beginPath(); ctx.ellipse(0, -64, 10, 12, 0, 0, Math.PI * 2); ctx.fill();
    // cornes
    ctx.fillStyle = '#120608';
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(d * 5, -73); ctx.quadraticCurveTo(d * 16, -82, d * 12, -94); ctx.quadraticCurveTo(d * 10, -84, d * 1, -75); ctx.closePath(); ctx.fill(); }
    // frange
    ctx.fillStyle = '#16080e';
    ctx.beginPath(); ctx.moveTo(-11, -66); ctx.quadraticCurveTo(-8, -80, 4, -76); ctx.quadraticCurveTo(12, -74, 11, -62); ctx.quadraticCurveTo(4, -70, -11, -66); ctx.fill();
    // yeux dorés et lèvres sombres
    ctx.save();
    ctx.shadowColor = '#ffcf3a'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath(); ctx.ellipse(-4, -64, 2.4, 1.4, -0.2, 0, Math.PI * 2); ctx.ellipse(5, -64, 2.4, 1.4, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#5a0810';
    ctx.beginPath(); ctx.ellipse(1, -57, 3, 1.3, 0, 0, Math.PI * 2); ctx.fill();
    flashOver(ctx, o.flash, () => { ctx.beginPath(); ctx.ellipse(0, -30, 18, 50, 0, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }

  // Démon de feu (Daedra) : petit diablotin rouge aux cornes, entouré de flammes.
  function demon(ctx, o) {
    const t = (o.t || 0) / 1000;
    const hop = Math.abs(Math.sin(t * 8 + (o.seed || 0))) * 3;
    shadow(ctx, 12, 16);
    ctx.save();
    ctx.translate(0, -hop);
    const fl = ctx.createRadialGradient(0, 0, 2, 0, -2, 22);
    fl.addColorStop(0, 'rgba(255,200,80,.6)'); fl.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = fl;
    ctx.beginPath(); ctx.arc(0, -2, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d42a2a';
    ctx.beginPath(); ctx.ellipse(0, 4, 10, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -10, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a0606';
    for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(d * 4, -16); ctx.lineTo(d * 10, -24); ctx.lineTo(d * 7, -14); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = '#ffe14a';
    ctx.beginPath(); ctx.arc(-3, -11, 1.8, 0, Math.PI * 2); ctx.arc(4, -11, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff9a3d';
    for (let k = 0; k < 3; k++) { const p = ((t * 2 + k / 3) % 1); ctx.globalAlpha = 1 - p; ctx.beginPath(); ctx.arc(Math.sin(k * 2 + t * 5) * 7, -18 - p * 14, 3 * (1 - p) + 1, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    flashOver(ctx, o.flash, () => { ctx.beginPath(); ctx.ellipse(0, -2, 11, 18, 0, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }

  // Portail infernal (Daedra) : anneau de feu qui tourbillonne et crache des démons.
  function portail(ctx, o) {
    const t = (o.t || 0) / 1000;
    ctx.save();
    ctx.translate(0, -18);
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 34);
    g.addColorStop(0, '#1a0004'); g.addColorStop(0.6, '#5a0812'); g.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, 28, 36, 0, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 3;
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = ['#ff4a2a', '#ff9a3d', '#ffd84a'][k];
      ctx.beginPath(); ctx.ellipse(0, 0, 26 - k * 6, 34 - k * 8, 0, t * (2 + k) + k, t * (2 + k) + k + Math.PI * 1.3); ctx.stroke();
    }
    ctx.shadowColor = '#ff4a2a'; ctx.shadowBlur = 16;
    ctx.strokeStyle = '#ff6a3a';
    ctx.beginPath(); ctx.ellipse(0, 0, 28, 36, 0, 0, Math.PI * 2); ctx.stroke();
    flashOver(ctx, o.flash, () => { ctx.beginPath(); ctx.ellipse(0, 0, 28, 36, 0, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k))));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('');
  }

  const DRAW = { gobelin, gobelin_violet: gobelinViolet, rat, slime, chauve_souris: bat, squelette, troll, dragon, sorcier, dragonnet, oeuf, cristal, flammeche, cristal_clan: cristalClan, mimic, liche, maexxna, araignee, cocon, ether, main, feu_follet: feuFollet, lilith, chaton, chapeau, daedra, demon, portail };
  // Les boss ont leur propre échelle (dessin « taille réelle »), les autres suivent m.scale (chefs du donjon).
  const BOSS_KINDS = ['troll', 'dragon', 'sorcier', 'mimic', 'liche', 'maexxna', 'ether', 'lilith', 'daedra'];

  function drawMonster(ctx, x, y, m, o = {}) {
    const draw = DRAW[m.kind];
    if (!draw) return;
    ctx.save();
    ctx.translate(x, y + (o.bob || 0));
    const s = (o.scale || 1) * (BOSS_KINDS.includes(m.kind) ? 1 : (m.scale || 1));
    ctx.scale(s * (o.facing || 1), s);
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    draw(ctx, o, !!m.elite);
    ctx.restore();
  }

  window.drawMonster = drawMonster;

  /*
   * Familier : la version miniature d'un boss (même dessin, en petit, avec des joues roses).
   * (x, y) : ses pieds au sol. o = { facing, t, size (1 = taille de l'enclos), flash, swing, sleep }
   */
  const PET_DRAW = {
    troll: { scale: 0.42, lift: 24 }, dragon: { scale: 0.36, lift: 16 }, sorcier: { scale: 0.46, lift: 18 },
    mimic: { scale: 0.42, lift: 16 }, liche: { scale: 0.46, lift: 18 }, maexxna: { scale: 0.4, lift: 6 },
    ether: { scale: 0.42, lift: 20 }, lilith: { scale: 0.42, lift: 14 }, daedra: { scale: 0.44, lift: 18 },
  };
  function drawPet(ctx, x, y, species, o = {}) {
    const P = PET_DRAW[species];
    if (!P) return;
    const size = o.size || 1;
    const sc = P.scale * size;
    ctx.save();
    if (o.sleep) { ctx.translate(x, y); ctx.scale(1, 0.92 + Math.sin((o.t || 0) / 600) * 0.03); ctx.translate(-x, -y); }
    drawMonster(ctx, x, y - P.lift * sc, { kind: species }, { scale: sc, facing: o.facing || 1, t: o.sleep ? 0 : o.t, seed: o.seed || 0, flash: o.flash, swing: o.swing });
    ctx.restore();
  }
  window.drawPet = drawPet;
  window.PET_DRAW = PET_DRAW;
})();
