/*
 * Dessins du casino : les croupiers (les mini boss en smoking), les tables et machines de la salle.
 * drawCroupier(ctx, x, y, species, { t, size, mood }) : (x, y) = ses pieds ; mood 'win' (il applaudit) / 'lose' (il ricane).
 */
(function () {
  // Points d'accroche du smoking, en unités du dessin du familier (size 1), relatifs aux pieds (y négatif = vers le haut).
  // bow : [x, y, taille] du nœud papillon ; vest : [x, haut, bas, largeur en haut, largeur en bas] de la veste ;
  // hat : [x, y du bord, taille, inclinaison] du haut-de-forme (null : déjà coiffé d'une capuche ou d'une couronne).
  const SUIT = {
    troll: { bow: [1, -24, 1], vest: [0, -24.5, -3.5, 15, 21], hat: [3, -37.6, 0.82, -0.06] },
    dragon: { bow: [13, -19, 0.8], vest: null, hat: [27.5, -33.4, 0.6, 0.1] },
    sorcier: { bow: [0, -17.6, 0.62], vest: [0, -18.5, -8.6, 9, 14], hat: null },
    mimic: { bow: [-1, -4, 1], vest: null, hat: [4, -31.2, 0.85, -0.3] },
    liche: { bow: [0.5, -21.6, 0.7], vest: [0.5, -22.4, -11, 12, 15], hat: null },
    maexxna: { bow: [1.5, -11.5, 0.75], vest: null, hat: [8.5, -14.6, 0.66, 0.12] },
  };

  function drawBow(ctx, x, y, s, wiggle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(wiggle);
    ctx.scale(s, s);
    ctx.fillStyle = '#c4122f';
    ctx.strokeStyle = '#5a0010';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-6.5, -4); ctx.quadraticCurveTo(-8, 0, -6.5, 4); ctx.closePath();
    ctx.moveTo(0, 0); ctx.lineTo(6.5, -4); ctx.quadraticCurveTo(8, 0, 6.5, 4); ctx.closePath();
    ctx.fill(); ctx.stroke();
    // reflets
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.beginPath(); ctx.ellipse(-4.2, -1.6, 1.6, 0.8, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4.2, -1.6, 1.6, 0.8, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff3a55';
    ctx.beginPath(); ctx.ellipse(0, 0, 2, 2.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // Veste de smoking : un trapèze noir aux bords arrondis, ouvert en V sur une chemise blanche, revers satinés et boutons dorés.
  function drawVest(ctx, cx, top, bottom, wTop, wBot) {
    const h = bottom - top;
    const vTip = top + h * 0.62; // pointe du V
    ctx.save();
    ctx.lineJoin = 'round';
    // veste
    ctx.fillStyle = '#16131f';
    ctx.strokeStyle = '#05040a';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(cx - wTop / 2, top);
    ctx.lineTo(cx + wTop / 2, top);
    ctx.quadraticCurveTo(cx + wBot / 2 + 0.8, top + h * 0.5, cx + wBot / 2, bottom - 1.2);
    ctx.quadraticCurveTo(cx + wBot / 2, bottom, cx + wBot / 2 - 1.2, bottom);
    ctx.lineTo(cx - wBot / 2 + 1.2, bottom);
    ctx.quadraticCurveTo(cx - wBot / 2, bottom, cx - wBot / 2, bottom - 1.2);
    ctx.quadraticCurveTo(cx - wBot / 2 - 0.8, top + h * 0.5, cx - wTop / 2, top);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // chemise blanche
    const sw = wTop * 0.36;
    ctx.fillStyle = '#f4f1ea';
    ctx.beginPath(); ctx.moveTo(cx - sw, top); ctx.lineTo(cx + sw, top); ctx.lineTo(cx, vTip); ctx.closePath(); ctx.fill();
    // revers satinés
    ctx.fillStyle = '#2c2838';
    ctx.beginPath(); ctx.moveTo(cx - sw, top); ctx.lineTo(cx - sw - wTop * 0.14, top); ctx.lineTo(cx - 0.6, vTip + 0.6); ctx.lineTo(cx, vTip); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + sw, top); ctx.lineTo(cx + sw + wTop * 0.14, top); ctx.lineTo(cx + 0.6, vTip + 0.6); ctx.lineTo(cx, vTip); ctx.closePath(); ctx.fill();
    // boutons
    ctx.fillStyle = '#ffd34a';
    const step = (bottom - vTip) / 3;
    for (let k = 1; k <= 2; k++) { ctx.beginPath(); ctx.arc(cx, vTip + step * k, 0.75, 0, Math.PI * 2); ctx.fill(); }
    // pochette
    ctx.fillStyle = '#c4122f';
    ctx.beginPath(); ctx.moveTo(cx - wTop * 0.42, top + h * 0.28); ctx.lineTo(cx - wTop * 0.25, top + h * 0.28); ctx.lineTo(cx - wTop * 0.32, top + h * 0.2); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawTopHat(ctx, x, y, s, tilt) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.scale(s, s);
    ctx.fillStyle = '#121019';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.ellipse(0, 0, 11, 2.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillRect(-6.5, -13, 13, 13);
    ctx.fillStyle = '#c4122f';
    ctx.fillRect(-6.5, -4, 13, 2.6);
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fillRect(-4.5, -12, 2, 8);
    ctx.restore();
  }

  function drawCroupier(ctx, x, y, species, o = {}) {
    const S = SUIT[species];
    if (!S) return;
    const size = o.size || 1;
    const t = o.t || 0;
    const facing = o.facing || 1;
    // Il sautille de joie quand le joueur perd (la maison gagne !), il se tasse quand le joueur gagne.
    const hop = o.mood === 'lose' ? Math.abs(Math.sin(t / 110)) * 6 * size : 0;
    const squash = o.mood === 'win' ? 1 + Math.sin(t / 90) * 0.04 : 1;
    ctx.save();
    ctx.translate(x, y - hop);
    ctx.scale(facing, squash);
    window.drawPet(ctx, 0, 0, species, { t, size });
    ctx.scale(size, size);
    if (S.vest) drawVest(ctx, ...S.vest);
    drawBow(ctx, S.bow[0], S.bow[1], S.bow[2], Math.sin(t / 300) * 0.12);
    if (S.hat) {
      const bounce = o.mood === 'lose' ? Math.sin(t / 110) * 0.25 : 0;
      drawTopHat(ctx, S.hat[0], S.hat[1] - Math.abs(bounce) * 6, S.hat[2], S.hat[3] + bounce);
    }
    ctx.restore();
  }

  window.drawCroupier = drawCroupier;
  window.CROUPIER_SUIT = SUIT;
})();
