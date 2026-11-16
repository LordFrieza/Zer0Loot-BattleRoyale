/*
 * Dessins du casino : les croupiers (les mini boss en smoking), les tables et machines de la salle.
 * drawCroupier(ctx, x, y, species, { t, size, mood }) : (x, y) = ses pieds ; mood 'win' (il applaudit) / 'lose' (il ricane).
 */
(function () {
  // Points d'accroche du smoking, en unités du dessin du familier (size 1), relatifs aux pieds.
  // bow : nœud papillon ; vest : plastron (largeur, hauteur) ; hat : haut-de-forme (null : déjà coiffé) ; tilt en radians.
  const SUIT = {
    troll: { bow: [3, -24], vest: [3, -17, 22, 14], hat: [6, -52, 1.1, -0.12] },
    dragon: { bow: [17, -25], vest: null, hat: [33, -39, 0.8, 0.25] },
    sorcier: { bow: [1, -25], vest: [1, -19, 13, 12], hat: null },
    mimic: { bow: [-2, -7], vest: null, hat: [6, -45, 1, -0.2] },
    liche: { bow: [0, -31], vest: [0, -25, 12, 10], hat: null },
    maexxna: { bow: [8, -16], vest: null, hat: [-4, -30, 0.9, -0.1] },
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
    ctx.moveTo(0, 0); ctx.lineTo(-7, -4.5); ctx.quadraticCurveTo(-8.5, 0, -7, 4.5); ctx.closePath();
    ctx.moveTo(0, 0); ctx.lineTo(7, -4.5); ctx.quadraticCurveTo(8.5, 0, 7, 4.5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ff3a55';
    ctx.beginPath(); ctx.ellipse(0, 0, 2.2, 2.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawVest(ctx, x, y, w, h) {
    // Veste noire ouverte en V sur une chemise blanche, deux boutons dorés.
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#16131f';
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, -h / 2); ctx.lineTo(w / 2 + 1, h / 2); ctx.lineTo(-w / 2 - 1, h / 2); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f4f1ea';
    ctx.beginPath(); ctx.moveTo(-w * 0.28, -h / 2); ctx.lineTo(w * 0.28, -h / 2); ctx.lineTo(0, h * 0.42); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#2c2838';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-w * 0.28, -h / 2); ctx.lineTo(0, h * 0.42); ctx.lineTo(w * 0.28, -h / 2); ctx.stroke();
    ctx.fillStyle = '#ffd34a';
    for (const k of [0.15, 0.32]) { ctx.beginPath(); ctx.arc(0, h * k + 1.5, 0.9, 0, Math.PI * 2); ctx.fill(); }
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
    if (S.vest) drawVest(ctx, S.vest[0], S.vest[1], S.vest[2], S.vest[3]);
    drawBow(ctx, S.bow[0], S.bow[1], 0.9, Math.sin(t / 300) * 0.12);
    if (S.hat) {
      const bounce = o.mood === 'lose' ? Math.sin(t / 110) * 0.25 : 0;
      drawTopHat(ctx, S.hat[0], S.hat[1] - Math.abs(bounce) * 6, S.hat[2], S.hat[3] + bounce);
    }
    ctx.restore();
  }

  window.drawCroupier = drawCroupier;
  window.CROUPIER_SUIT = SUIT;
})();
