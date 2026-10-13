/* Dessin d'un petit personnage (arène + aperçu sur la page perso). */
(function () {
  const RC = {
    commun: '#cfcfd6', peu_commun: '#3ddc5a', rare: '#3b8bff', epique: '#b14dff', legendaire: '#ff9a1f',
  };

  function hueOf(name) {
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
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

  /*
   * f = { name, look: {slot: rarity} }
   * o = { scale, facing (1|-1), bob, flash (0..1), alpha, swing (0..1) }
   */
  function drawFighter(ctx, x, y, f, o = {}) {
    const s = o.scale || 1;
    const facing = o.facing || 1;
    const look = f.look || {};
    const hue = hueOf(f.name);
    const skin = `hsl(${hue}, 55%, 62%)`;
    const cloth = `hsl(${hue}, 45%, 38%)`;

    ctx.save();
    ctx.translate(x, y + (o.bob || 0));
    ctx.scale(s * facing, s);
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;

    // ombre
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.ellipse(0, 18, 13, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // jambes / pantalon
    ctx.fillStyle = look.pantalon ? RC[look.pantalon] : '#3a3350';
    roundRect(ctx, -8, 8, 7, 10, 2); ctx.fill();
    roundRect(ctx, 1, 8, 7, 10, 2); ctx.fill();

    // bouclier (main arrière)
    if (look.bouclier) {
      ctx.fillStyle = RC[look.bouclier];
      ctx.strokeStyle = '#1a1626';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-17, -6);
      ctx.lineTo(-7, -8);
      ctx.lineTo(-7, 6);
      ctx.quadraticCurveTo(-12, 13, -17, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // corps / plastron
    ctx.fillStyle = look.plastron ? RC[look.plastron] : cloth;
    roundRect(ctx, -10, -8, 20, 18, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // ceinture
    if (look.ceinture) {
      ctx.fillStyle = RC[look.ceinture];
      ctx.fillRect(-10, 4, 20, 3);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillRect(-2, 3.5, 4, 4);
    }

    // tête
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, -16, 10, 0, Math.PI * 2);
    ctx.fill();

    // yeux
    ctx.fillStyle = '#1a1626';
    ctx.fillRect(2, -18, 2.5, 3.5);
    ctx.fillRect(6, -18, 2.5, 3.5);

    // boucles d'oreilles
    if (look.boucles) {
      ctx.fillStyle = RC[look.boucles];
      ctx.beginPath();
      ctx.arc(-6, -10, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // casque
    if (look.casque) {
      ctx.fillStyle = RC[look.casque];
      ctx.beginPath();
      ctx.arc(0, -17, 11, Math.PI, 0);
      ctx.lineTo(11, -15);
      ctx.lineTo(-11, -15);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.fillRect(-1, -27, 2, 10);
    }

    // épée (main avant) avec mouvement d'attaque
    const swing = o.swing || 0;
    ctx.save();
    ctx.translate(11, 0);
    ctx.rotate(-0.9 + swing * 2.1);
    if (look.epee) {
      ctx.fillStyle = '#6b4a2b';
      ctx.fillRect(-1.5, -3, 3, 7);
      ctx.fillStyle = '#e0c060';
      ctx.fillRect(-5, -4, 10, 2.5);
      ctx.fillStyle = RC[look.epee];
      ctx.beginPath();
      ctx.moveTo(-2, -4);
      ctx.lineTo(2, -4);
      ctx.lineTo(1, -26);
      ctx.lineTo(0, -29);
      ctx.lineTo(-1, -26);
      ctx.closePath();
      ctx.fill();
    } else {
      // petit bâton
      ctx.fillStyle = '#8a6a44';
      ctx.fillRect(-1.5, -16, 3, 20);
    }
    ctx.restore();

    // mains / gants
    ctx.fillStyle = look.gants ? RC[look.gants] : skin;
    ctx.beginPath();
    ctx.arc(11, 1, 3.6, 0, Math.PI * 2);
    ctx.fill();
    if (!look.bouclier) {
      ctx.beginPath();
      ctx.arc(-11, 1, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // flash de dégâts
    if (o.flash) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,90,90,${o.flash * 0.8})`;
      ctx.beginPath();
      ctx.arc(0, -16, 10, 0, Math.PI * 2);
      ctx.fill();
      roundRect(ctx, -10, -8, 20, 18, 6);
      ctx.fill();
    }
    ctx.restore();
  }

  window.drawFighter = drawFighter;
  window.RARITY_COLORS = RC;
})();
