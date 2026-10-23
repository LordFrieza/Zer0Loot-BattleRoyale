/*
 * Dessin des monstres du donjon (gobelin, slime, chauve-souris, squelette) et des boss (Troll, Dragon, Magicien des
 * ténèbres) avec leurs créatures (œufs, dragonnets, cristaux d'ombre).
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

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k))));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('');
  }

  const DRAW = { gobelin, slime, chauve_souris: bat, squelette, troll, dragon, sorcier, dragonnet, oeuf, cristal, flammeche, cristal_clan: cristalClan };
  // Les boss ont leur propre échelle (dessin « taille réelle »), les autres suivent m.scale (chefs du donjon).
  const BOSS_KINDS = ['troll', 'dragon', 'sorcier'];

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
})();
