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

  const METAL = '#b8b8c8';

  // Objet secondaire (main arrière), dessiné derrière le corps.
  function drawOffhand(ctx, kind, color) {
    ctx.strokeStyle = '#1a1626';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = color;
    switch (kind) {
      case 'bouclier':
        ctx.beginPath();
        ctx.moveTo(-17, -6);
        ctx.lineTo(-7, -8);
        ctx.lineTo(-7, 6);
        ctx.quadraticCurveTo(-12, 13, -17, 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      case 'carquois':
        ctx.save();
        ctx.rotate(0.35);
        roundRect(ctx, -12, -18, 7, 20, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f2f2f2';
        for (let i = 0; i < 3; i++) ctx.fillRect(-12 + i * 2.3, -22, 1.6, 5);
        ctx.restore();
        break;
      case 'grimoire':
        roundRect(ctx, -19, -4, 9, 11, 1.5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f5e9c8';
        ctx.fillRect(-11, -3, 1.5, 9);
        break;
      case 'dague':
        ctx.fillStyle = '#5a3b22';
        ctx.fillRect(-12.5, -1, 3, 5);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(-13, -1);
        ctx.lineTo(-9, -1);
        ctx.lineTo(-11, -13);
        ctx.closePath();
        ctx.fill();
        break;
      case 'relique':
        ctx.beginPath();
        ctx.arc(-13, 6, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff6c8';
        ctx.fillRect(-13.6, 3, 1.2, 6);
        ctx.fillRect(-15, 5, 4, 1.2);
        break;
      default:
    }
  }

  // Arme (main avant), dans le repère tourné de la main.
  function drawWeapon(ctx, kind, color) {
    switch (kind) {
      case 'epee':
        ctx.fillStyle = '#6b4a2b';
        ctx.fillRect(-1.5, -3, 3, 7);
        ctx.fillStyle = '#e0c060';
        ctx.fillRect(-5, -4, 10, 2.5);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(-2, -4);
        ctx.lineTo(2, -4);
        ctx.lineTo(1, -26);
        ctx.lineTo(0, -29);
        ctx.lineTo(-1, -26);
        ctx.closePath();
        ctx.fill();
        break;
      case 'arc':
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(-1, -22);
        ctx.quadraticCurveTo(10, -9, -1, 5);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.8)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-1, -22);
        ctx.lineTo(-1, 5);
        ctx.stroke();
        break;
      case 'baton':
        ctx.fillStyle = '#7a5530';
        ctx.fillRect(-1.5, -28, 3, 33);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(0, -31, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        break;
      case 'dagues':
        ctx.fillStyle = '#5a3b22';
        ctx.fillRect(-1.5, -2, 3, 6);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(-2, -2);
        ctx.lineTo(2, -2);
        ctx.lineTo(0, -16);
        ctx.closePath();
        ctx.fill();
        break;
      case 'masse':
        ctx.fillStyle = '#6b4a2b';
        ctx.fillRect(-1.5, -18, 3, 22);
        ctx.fillStyle = color;
        roundRect(ctx, -5, -27, 10, 10, 3);
        ctx.fill();
        ctx.fillRect(-7, -23, 14, 2);
        ctx.fillRect(-1, -30, 2, 14);
        break;
      default:
        // petit bâton de vagabond
        ctx.fillStyle = '#8a6a44';
        ctx.fillRect(-1.5, -16, 3, 20);
    }
  }

  /*
   * f = { name, cls, look: {slot: rarity} }
   * o = { scale, facing (1|-1), bob, flash (0..1), alpha, swing (0..1) }
   */
  function drawFighter(ctx, x, y, f, o = {}) {
    const s = o.scale || 1;
    const facing = o.facing || 1;
    const look = f.look || {};
    const ci = window.Rules && Rules.CLASS_INFO[f.cls];
    const weaponKind = ci ? ci.weapon : null;
    const offhandKind = ci ? ci.offhand : null;
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

    // objet secondaire de la classe (couleur de rareté s'il est équipé)
    if (offhandKind) drawOffhand(ctx, offhandKind, look.secondaire ? RC[look.secondaire] : METAL);

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

    // arme de la classe (main avant) avec mouvement d'attaque
    const swing = o.swing || 0;
    const ranged = weaponKind === 'arc' || weaponKind === 'baton';
    ctx.save();
    ctx.translate(11, 0);
    ctx.rotate(ranged ? -0.25 + swing * 0.5 : -0.9 + swing * 2.1);
    drawWeapon(ctx, weaponKind, look.arme ? RC[look.arme] : METAL);
    ctx.restore();

    // mains / gants
    ctx.fillStyle = look.gants ? RC[look.gants] : skin;
    ctx.beginPath();
    ctx.arc(11, 1, 3.6, 0, Math.PI * 2);
    ctx.fill();
    if (offhandKind !== 'bouclier') {
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
