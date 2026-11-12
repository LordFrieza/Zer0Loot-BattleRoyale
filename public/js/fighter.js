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

  // ---------- Apparence ----------

  // Assombrit / éclaircit une couleur hexadécimale (amount entre -1 et 1).
  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount));
    return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
  }

  function cosmetic(id) {
    return id && window.Rules && Rules.COSMETICS[id];
  }

  const INK = '#1a1626';

  // Aura animée sous les pieds.
  function drawAura(ctx, id) {
    const c = cosmetic(id);
    if (!c) return;
    const t = performance.now();
    const rainbow = id === 'aura_arcenciel';
    const col = (k) => (rainbow ? `hsl(${(t / 8 + k * 70) % 360}, 90%, 62%)` : c.color);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pulse = 0.75 + Math.sin(t / 260) * 0.25;
    const g = ctx.createRadialGradient(0, 17, 2, 0, 17, 26);
    g.addColorStop(0, col(0));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha *= 0.85 * pulse;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 17, 26, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha /= 0.85 * pulse;
    // particules qui montent
    for (let k = 0; k < 6; k++) {
      const ph = ((t / 900) + k / 6) % 1;
      const px = Math.sin(k * 2.1 + t / 400) * 13;
      const py = 16 - ph * 34;
      ctx.globalAlpha = (1 - ph) * 0.9;
      ctx.fillStyle = col(k);
      if (id === 'aura_foudre' && k % 2) {
        ctx.fillRect(px, py, 1.5, 6);
        ctx.fillRect(px + 1.5, py + 5, 3, 1.5);
      } else {
        ctx.beginPath();
        ctx.arc(px, py, 2.2 * (1 - ph) + 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Cape dans le dos (dessinée derrière le corps).
  function drawCape(ctx, id) {
    const c = cosmetic(id);
    if (!c) return;
    const wave = Math.sin(performance.now() / 300) * 1.5;
    ctx.fillStyle = c.color;
    ctx.strokeStyle = c.trim || shade(c.color, -0.4);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-8, -9);
    ctx.lineTo(6, -9);
    ctx.lineTo(2, 17);
    ctx.quadraticCurveTo(-12, 21 + wave, -24 + wave, 15);
    ctx.quadraticCurveTo(-18, 2, -8, -9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Col de la cape, par-dessus le corps.
  function drawCapeCollar(ctx, id) {
    const c = cosmetic(id);
    if (!c) return;
    ctx.fillStyle = c.color;
    roundRect(ctx, -10, -9, 20, 4, 2);
    ctx.fill();
    ctx.fillStyle = c.trim || '#ffd23f';
    ctx.beginPath(); ctx.arc(6, -7, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  function drawShoes(ctx, id) {
    const c = cosmetic(id);
    if (!c) return;
    ctx.fillStyle = c.color;
    roundRect(ctx, -9, 15, 9, 4.5, 2); ctx.fill();
    roundRect(ctx, 0.5, 15, 9.5, 4.5, 2); ctx.fill();
    if (c.trim) {
      ctx.fillStyle = c.trim;
      ctx.fillRect(-9, 17.5, 9, 1.4);
      ctx.fillRect(0.5, 17.5, 9.5, 1.4);
    }
    if (id === 'flammes') {
      const f = Math.sin(performance.now() / 90) * 1.5;
      ctx.fillStyle = '#ffd23f';
      for (const fx of [-6, 4]) {
        ctx.beginPath();
        ctx.moveTo(fx - 2, 15);
        ctx.lineTo(fx, 10 + f);
        ctx.lineTo(fx + 2, 15);
        ctx.fill();
      }
    }
  }

  // Yeux, sourcils et bouche (le personnage regarde vers la droite).
  function drawFace(ctx, app) {
    const E1 = 3.2;
    const E2 = 7.6;
    const EY = -16.8;
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    switch (app.eyes) {
      case 'ronds':
        for (const ex of [E1, E2]) {
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(ex, EY, 2.3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = INK;
          ctx.beginPath(); ctx.arc(ex + 0.7, EY + 0.2, 1.2, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 'malicieux':
        // yeux mi-clos avec une paupière en biais
        for (const ex of [E1, E2]) {
          ctx.beginPath(); ctx.arc(ex, EY + 0.3, 1.4, 0, Math.PI); ctx.fill();
          ctx.beginPath(); ctx.moveTo(ex - 1.8, EY - 0.2); ctx.lineTo(ex + 1.8, EY + 0.4); ctx.stroke();
        }
        break;
      case 'endormis':
        for (const ex of [E1, E2]) { ctx.beginPath(); ctx.arc(ex, EY - 0.5, 1.5, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
        break;
      case 'colere':
        for (const [ex, d] of [[E1, 1], [E2, -1]]) {
          ctx.beginPath(); ctx.moveTo(ex - 1.5, EY - 0.8 * d); ctx.lineTo(ex + 1.5, EY + 0.8 * d); ctx.lineTo(ex, EY + 1.6); ctx.closePath(); ctx.fill();
        }
        break;
      case 'etoiles':
        ctx.fillStyle = '#ffd23f';
        for (const ex of [E1, E2]) {
          ctx.beginPath();
          for (let k = 0; k < 8; k++) {
            const r = k % 2 ? 1 : 2.6;
            const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
            ctx.lineTo(ex + Math.cos(a) * r, EY + Math.sin(a) * r);
          }
          ctx.closePath(); ctx.fill();
        }
        break;
      case 'croix':
        for (const ex of [E1, E2]) {
          ctx.beginPath(); ctx.moveTo(ex - 1.3, EY - 1.3); ctx.lineTo(ex + 1.3, EY + 1.3);
          ctx.moveTo(ex + 1.3, EY - 1.3); ctx.lineTo(ex - 1.3, EY + 1.3); ctx.stroke();
        }
        break;
      default: // points
        ctx.fillRect(2, -18, 2.5, 3.5);
        ctx.fillRect(6, -18, 2.5, 3.5);
    }

    // sourcils
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    const BY = -20.8;
    switch (app.brows) {
      case 'droits':
        ctx.fillRect(1.8, BY, 3, 1); ctx.fillRect(6.2, BY, 3, 1);
        break;
      case 'fronces':
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(1.6, BY - 0.8); ctx.lineTo(4.8, BY + 0.6); ctx.moveTo(9.4, BY - 0.8); ctx.lineTo(6.2, BY + 0.6); ctx.stroke();
        break;
      case 'inquiets':
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(1.6, BY + 0.6); ctx.lineTo(4.8, BY - 0.8); ctx.moveTo(9.4, BY + 0.6); ctx.lineTo(6.2, BY - 0.8); ctx.stroke();
        break;
      case 'epais':
        ctx.fillRect(1.4, BY - 0.6, 3.8, 2); ctx.fillRect(5.8, BY - 0.6, 3.8, 2);
        break;
      default:
    }

    // bouche
    const MX = 5.6;
    const MY = -11.6;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = INK;
    switch (app.mouth) {
      case 'sourire':
        ctx.beginPath(); ctx.arc(MX, MY - 1.2, 2.2, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
        break;
      case 'grand':
        ctx.fillStyle = INK;
        ctx.beginPath(); ctx.arc(MX, MY - 0.8, 2.6, 0, Math.PI); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ff7a8a';
        ctx.beginPath(); ctx.arc(MX, MY + 0.9, 1.2, 0, Math.PI); ctx.fill();
        break;
      case 'neutre':
        ctx.beginPath(); ctx.moveTo(MX - 1.8, MY); ctx.lineTo(MX + 1.8, MY); ctx.stroke();
        break;
      case 'surprise':
        ctx.beginPath(); ctx.arc(MX, MY, 1.4, 0, Math.PI * 2); ctx.stroke();
        break;
      case 'grimace':
        ctx.fillStyle = '#fff';
        ctx.fillRect(MX - 2.4, MY - 1, 4.8, 2.4);
        ctx.strokeRect(MX - 2.4, MY - 1, 4.8, 2.4);
        ctx.beginPath(); ctx.moveTo(MX, MY - 1); ctx.lineTo(MX, MY + 1.4); ctx.stroke();
        break;
      case 'langue':
        ctx.beginPath(); ctx.arc(MX, MY - 1.2, 2.2, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
        ctx.fillStyle = '#ff7a8a';
        ctx.beginPath(); ctx.arc(MX + 0.6, MY + 1.3, 1.3, 0, Math.PI); ctx.fill();
        break;
      case 'crocs':
        ctx.beginPath(); ctx.moveTo(MX - 2.4, MY); ctx.lineTo(MX + 2.4, MY); ctx.stroke();
        ctx.fillStyle = '#fff';
        for (const fx of [MX - 1.4, MX + 1.4]) { ctx.beginPath(); ctx.moveTo(fx - 0.8, MY); ctx.lineTo(fx + 0.8, MY); ctx.lineTo(fx, MY + 2); ctx.fill(); }
        break;
      default:
    }
  }

  // Accessoires de visage (lunettes, monocle…).
  function drawFaceItem(ctx, id) {
    const c = cosmetic(id);
    if (!c) return;
    ctx.fillStyle = c.color;
    ctx.strokeStyle = c.color;
    switch (id) {
      case 'lunettes':
        roundRect(ctx, 0.6, -19, 4.4, 3.6, 1.2); ctx.fill();
        roundRect(ctx, 5.6, -19, 4.4, 3.6, 1.2); ctx.fill();
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-8, -17.5); ctx.lineTo(0.6, -17.5); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.4)';
        ctx.fillRect(1.4, -18.4, 1.2, 1); ctx.fillRect(6.4, -18.4, 1.2, 1);
        break;
      case 'monocle':
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(7.6, -16.8, 2.8, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(7.6, -14); ctx.quadraticCurveTo(6, -8, 2, -6); ctx.stroke();
        break;
      case 'bandeau':
        ctx.beginPath(); ctx.ellipse(7.6, -16.8, 2.6, 2.3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-9, -21); ctx.lineTo(9.6, -17.5); ctx.stroke();
        break;
      case 'moustache':
        ctx.beginPath();
        ctx.moveTo(5.6, -14.6);
        ctx.quadraticCurveTo(1.5, -16.5, -0.5, -12);
        ctx.quadraticCurveTo(2.8, -12.4, 5.6, -12.8);
        ctx.quadraticCurveTo(8.4, -12.4, 11.2, -12);
        ctx.quadraticCurveTo(9.6, -16.5, 5.6, -14.6);
        ctx.fill();
        break;
      case 'masque_abysses': {
        // masque des profondeurs : demi-masque sombre aux yeux bleus luisants
        ctx.beginPath();
        ctx.moveTo(-9.8, -22); ctx.lineTo(10.2, -22); ctx.lineTo(10, -13); ctx.quadraticCurveTo(5, -10, 0, -13.5); ctx.quadraticCurveTo(-6, -11, -9.8, -14);
        ctx.closePath(); ctx.fill();
        ctx.save();
        ctx.shadowColor = '#5ad8ff'; ctx.shadowBlur = 6;
        ctx.fillStyle = '#7fe8ff';
        ctx.beginPath(); ctx.ellipse(3.2, -17.2, 1.6, 1.1, 0, 0, Math.PI * 2); ctx.ellipse(7.8, -17.2, 1.6, 1.1, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'masque':
        ctx.beginPath();
        ctx.moveTo(-9.6, -14.5);
        ctx.lineTo(10, -14.5);
        ctx.quadraticCurveTo(9.5, -8, 0, -6.2);
        ctx.quadraticCurveTo(-8, -7.5, -9.6, -14.5);
        ctx.fill();
        break;
      default:
    }
  }

  /*
   * Casque : un dôme posé sur le haut du crâne, qui s'arrête au-dessus des sourcils
   * (les yeux et sourcils choisis dans l'apparence restent visibles).
   */
  function drawHelmet(ctx, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-11, -22.6);
    ctx.quadraticCurveTo(-11, -32.5, 0, -32.5);
    ctx.quadraticCurveTo(11, -32.5, 11, -22.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // bandeau du bord
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(-11.4, -24.4, 22.8, 2);
    // reflet / crête
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.fillRect(-1, -31.5, 2, 7);
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.beginPath(); ctx.ellipse(-5, -28.5, 2.2, 3.2, -0.5, 0, Math.PI * 2); ctx.fill();
  }

  // Chapeaux (remplacent l'affichage du casque).
  function drawHat(ctx, id) {
    const c = cosmetic(id);
    if (!c) return;
    ctx.fillStyle = c.color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.2;
    switch (id) {
      case 'sorcier':
        ctx.beginPath(); ctx.ellipse(0, -24, 14, 3.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-8, -24.5); ctx.quadraticCurveTo(-2, -38, 6, -46); ctx.quadraticCurveTo(4, -36, 8, -24.5); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(-7.5, -27.5, 15.5, 2.5);
        break;
      case 'pirate':
        ctx.beginPath(); ctx.moveTo(-15, -22); ctx.quadraticCurveTo(0, -38, 15, -22); ctx.quadraticCurveTo(0, -27, -15, -22); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath(); ctx.moveTo(-13, -23); ctx.quadraticCurveTo(0, -28, 13, -23); ctx.lineTo(13, -22); ctx.quadraticCurveTo(0, -26.5, -13, -22); ctx.fill();
        ctx.fillStyle = '#f2f2f2';
        ctx.beginPath(); ctx.arc(0, -30, 2.4, 0, Math.PI * 2); ctx.fill();
        break;
      case 'haut_de_forme':
        ctx.fillRect(-12, -25, 24, 3); ctx.strokeRect(-12, -25, 24, 3);
        ctx.fillRect(-8, -40, 16, 15.5); ctx.strokeRect(-8, -40, 16, 15.5);
        ctx.fillStyle = '#c8323c';
        ctx.fillRect(-8, -29, 16, 3);
        break;
      case 'viking':
        drawHelmet(ctx, c.color);
        ctx.fillStyle = c.color;
        ctx.fillStyle = '#f5ead0';
        for (const d of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(9 * d, -22); ctx.quadraticCurveTo(17 * d, -26, 15 * d, -35); ctx.quadraticCurveTo(13 * d, -27, 6 * d, -25); ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        break;
      case 'couronne':
        ctx.shadowColor = '#ffd23f';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(-8.5, -24); ctx.lineTo(-9, -33); ctx.lineTo(-4.5, -28); ctx.lineTo(0, -35); ctx.lineTo(4.5, -28); ctx.lineTo(9, -33); ctx.lineTo(8.5, -24);
        ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.fillStyle = '#e8434f';
        ctx.beginPath(); ctx.arc(0, -27, 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3b8bff';
        ctx.beginPath(); ctx.arc(-5, -26.5, 1.2, 0, Math.PI * 2); ctx.arc(5, -26.5, 1.2, 0, Math.PI * 2); ctx.fill();
        break;
      case 'aureole': {
        const bob = Math.sin(performance.now() / 400) * 1.2;
        ctx.save();
        ctx.strokeStyle = c.color;
        ctx.shadowColor = '#fff6b0';
        ctx.shadowBlur = 10;
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.ellipse(0, -33 + bob, 8, 2.6, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'couronne_os':
        ctx.fillStyle = c.color;
        ctx.lineWidth = 0.6;
        for (const x of [-7, -2.5, 2.5, 7]) {
          ctx.beginPath(); ctx.moveTo(x - 2, -25); ctx.lineTo(x, -33 - (Math.abs(x) < 3 ? 2 : 0)); ctx.lineTo(x + 2, -25); ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.fillRect(-9.5, -26, 19, 3.2); ctx.strokeRect(-9.5, -26, 19, 3.2);
        ctx.fillStyle = '#e8434f';
        ctx.beginPath(); ctx.arc(0, -24.5, 1.2, 0, Math.PI * 2); ctx.fill();
        break;
      case 'chat':
        for (const d of [-1, 1]) {
          ctx.fillStyle = c.color;
          ctx.beginPath(); ctx.moveTo(4 * d, -24); ctx.lineTo(9 * d, -33); ctx.lineTo(10 * d, -21); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#ffd0e0';
          ctx.beginPath(); ctx.moveTo(6 * d, -24); ctx.lineTo(8.8 * d, -29.5); ctx.lineTo(9.2 * d, -23); ctx.closePath(); ctx.fill();
        }
        break;
      default:
    }
  }


  // ---------- Skins d'équipement (V2) ----------

  // Skin porté dans un emplacement, ou null (un skin de classe ne s'affiche que pour cette classe).
  function skinOf(app, slot, cls) {
    const c = cosmetic(app[slot]);
    if (!c || c.slot !== slot) return null;
    if (c.cls && c.cls !== cls) return null;
    return c;
  }

  function flicker(speed = 90, amp = 1.5) {
    return Math.sin(performance.now() / speed) * amp;
  }

  // Plastron
  function drawChestSkin(ctx, id, c) {
    ctx.fillStyle = c.color;
    roundRect(ctx, -10, -8, 20, 18, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    roundRect(ctx, -10, -8, 20, 18, 6);
    ctx.clip();
    switch (id) {
      case 'plastron_dore':
        ctx.fillStyle = c.trim;
        ctx.fillRect(-10, -1, 20, 1.2);
        ctx.fillRect(-10, 4, 20, 1.2);
        ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(3, -3); ctx.lineTo(0, 0); ctx.lineTo(-3, -3); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.35)';
        ctx.fillRect(-7, -7, 3, 14);
        break;
      case 'robe_etoilee':
        ctx.fillStyle = c.trim;
        for (const [sx, sy, r] of [[-5, -3, 1.3], [4, -5, 1], [2, 3, 1.4], [-3, 6, 0.9], [6, 5, 0.8]]) {
          ctx.beginPath();
          for (let k = 0; k < 8; k++) {
            const rr = k % 2 ? r * 0.4 : r * 1.6;
            const a = (k / 8) * Math.PI * 2;
            ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
          }
          ctx.closePath(); ctx.fill();
        }
        ctx.fillRect(-10, 8, 20, 2);
        break;
      case 'tenue_ninja':
        ctx.strokeStyle = c.trim;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-10, -6); ctx.lineTo(10, 8); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.08)';
        ctx.fillRect(-1, -8, 2, 18);
        break;
      case 'tunique_foret':
        ctx.fillStyle = c.trim;
        ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(0, -1); ctx.lineTo(6, -8); ctx.lineTo(3, -8); ctx.lineTo(0, -4); ctx.lineTo(-3, -8); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#7a4a26';
        ctx.fillRect(-10, 5, 20, 2.5);
        break;
      case 'smoking':
        ctx.fillStyle = c.trim;
        ctx.beginPath(); ctx.moveTo(-4, -8); ctx.lineTo(0, 4); ctx.lineTo(4, -8); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#c8323c';
        ctx.beginPath(); ctx.moveTo(-3, -7); ctx.lineTo(0, -5.5); ctx.lineTo(-3, -4); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(3, -7); ctx.lineTo(0, -5.5); ctx.lineTo(3, -4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = INK;
        ctx.beginPath(); ctx.arc(0, 0, 0.8, 0, Math.PI * 2); ctx.arc(0, 2.6, 0.8, 0, Math.PI * 2); ctx.fill();
        break;
      default:
    }
    ctx.restore();
  }

  // Pantalon (jambes)
  function drawPantsSkin(ctx, id, c, skin) {
    switch (id) {
      case 'kilt':
        ctx.fillStyle = skin;
        roundRect(ctx, -7, 12, 5, 6, 2); ctx.fill();
        roundRect(ctx, 2, 12, 5, 6, 2); ctx.fill();
        ctx.fillStyle = c.color;
        ctx.beginPath(); ctx.moveTo(-9, 7); ctx.lineTo(9, 7); ctx.lineTo(10.5, 14); ctx.lineTo(-10.5, 14); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = c.trim;
        ctx.lineWidth = 1.2;
        for (const x of [-6, -1.5, 3, 7.5]) { ctx.beginPath(); ctx.moveTo(x, 7); ctx.lineTo(x + 0.6, 14); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(-10, 10.5); ctx.lineTo(10, 10.5); ctx.stroke();
        break;
      case 'jambieres':
        ctx.fillStyle = c.color;
        roundRect(ctx, -8, 8, 7, 10, 2); ctx.fill();
        roundRect(ctx, 1, 8, 7, 10, 2); ctx.fill();
        ctx.fillStyle = c.trim;
        ctx.beginPath(); ctx.arc(-4.5, 12.5, 2, 0, Math.PI * 2); ctx.arc(4.5, 12.5, 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.4)';
        ctx.fillRect(-7, 9, 1.2, 8); ctx.fillRect(2, 9, 1.2, 8);
        break;
      default: // pantalon_ninja et autres : couleur + bandes aux chevilles
        ctx.fillStyle = c.color;
        roundRect(ctx, -8, 8, 7, 10, 2); ctx.fill();
        roundRect(ctx, 1, 8, 7, 10, 2); ctx.fill();
        ctx.fillStyle = c.trim || shade(c.color, 0.3);
        ctx.fillRect(-8, 14, 7, 1.5); ctx.fillRect(1, 14, 7, 1.5);
        ctx.fillRect(-8, 16.3, 7, 1); ctx.fillRect(1, 16.3, 7, 1);
    }
  }

  // Ceinture
  function drawBeltSkin(ctx, id, c) {
    switch (id) {
      case 'ceinture_champion':
        ctx.fillStyle = c.color;
        ctx.fillRect(-10, 3.5, 20, 4);
        ctx.fillStyle = c.trim;
        ctx.shadowColor = c.trim; ctx.shadowBlur = 4;
        ctx.beginPath(); ctx.ellipse(0, 5.5, 4.2, 3.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#c8323c';
        ctx.beginPath(); ctx.arc(0, 5.5, 1.3, 0, Math.PI * 2); ctx.fill();
        break;
      case 'ceinture_crane':
        ctx.fillStyle = c.color;
        ctx.fillRect(-10, 4, 20, 3);
        ctx.fillStyle = c.trim;
        ctx.beginPath(); ctx.arc(0, 5.2, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(-1.6, 6.5, 3.2, 1.6);
        ctx.fillStyle = INK;
        ctx.fillRect(-1.5, 4.4, 1.1, 1.1); ctx.fillRect(0.5, 4.4, 1.1, 1.1);
        break;
      default:
        ctx.fillStyle = c.color;
        ctx.fillRect(-10, 4, 20, 3);
        ctx.fillStyle = c.trim || '#ffe9a8';
        ctx.fillRect(-2, 3.5, 4, 4);
        ctx.fillStyle = shade(c.color, -0.2);
        roundRect(ctx, -9, 5, 4.5, 5, 1); ctx.fill();
    }
  }

  // Gants (une main)
  function drawGloveSkin(ctx, id, c, x, y) {
    ctx.fillStyle = c.color;
    ctx.beginPath(); ctx.arc(x, y, 3.8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 0.8; ctx.stroke();
    if (id === 'gants_dores') {
      ctx.fillStyle = 'rgba(255,255,255,.6)';
      ctx.beginPath(); ctx.arc(x - 1.2, y - 1.2, 1, 0, Math.PI * 2); ctx.fill();
    } else if (id === 'gants_feu') {
      ctx.fillStyle = c.trim;
      const f = flicker(80, 1.2);
      ctx.beginPath(); ctx.moveTo(x - 2.5, y - 2); ctx.lineTo(x - 1, y - 7 + f); ctx.lineTo(x + 0.5, y - 3); ctx.lineTo(x + 1.6, y - 6 - f); ctx.lineTo(x + 2.8, y - 1.5); ctx.closePath(); ctx.fill();
    } else if (id === 'griffes') {
      ctx.fillStyle = c.trim;
      for (const dy of [-2, 0, 2]) { ctx.beginPath(); ctx.moveTo(x + 2.5, y + dy - 0.7); ctx.lineTo(x + 7, y + dy); ctx.lineTo(x + 2.5, y + dy + 0.7); ctx.fill(); }
    }
  }

  // Arme (dans le repère tourné de la main)
  function drawWeaponSkin(ctx, id, c) {
    switch (id) {
      case 'epee_feu':
        ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-1.5, -3, 3, 7);
        ctx.fillStyle = c.trim; ctx.fillRect(-5.5, -4.5, 11, 2.5);
        ctx.save();
        ctx.shadowColor = c.color; ctx.shadowBlur = 10;
        ctx.fillStyle = c.color;
        ctx.beginPath(); ctx.moveTo(-2.4, -4); ctx.lineTo(2.4, -4); ctx.lineTo(1.2, -27); ctx.lineTo(0, -31); ctx.lineTo(-1.2, -27); ctx.closePath(); ctx.fill();
        ctx.fillStyle = c.trim;
        for (let k = 0; k < 3; k++) {
          const yy = -10 - k * 7;
          const f = flicker(70 + k * 13, 1.6);
          ctx.beginPath(); ctx.moveTo(1.5, yy); ctx.lineTo(4.5 + f, yy - 3); ctx.lineTo(1.2, yy - 4); ctx.fill();
        }
        ctx.restore();
        break;
      case 'hache':
        ctx.fillStyle = c.trim; ctx.fillRect(-1.5, -26, 3, 31);
        ctx.fillStyle = c.color;
        ctx.strokeStyle = INK; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(1, -25); ctx.quadraticCurveTo(12, -27, 12, -18); ctx.quadraticCurveTo(12, -11, 1, -14); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-1, -23); ctx.lineTo(-5, -21); ctx.lineTo(-1, -17); ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case 'arc_elfique':
      case 'arc_os':
        ctx.strokeStyle = c.color;
        ctx.lineWidth = id === 'arc_os' ? 3.2 : 2.6;
        ctx.beginPath(); ctx.moveTo(-1, -24); ctx.quadraticCurveTo(13, -9, -1, 7); ctx.stroke();
        if (id === 'arc_elfique') {
          ctx.fillStyle = c.trim;
          for (const [lx, ly, a] of [[2, -20, -0.6], [2.5, 3, 0.6]]) { ctx.save(); ctx.translate(lx, ly); ctx.rotate(a); ctx.beginPath(); ctx.ellipse(0, 0, 3.2, 1.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
        } else {
          ctx.fillStyle = c.color;
          for (const [lx, ly] of [[-1, -24], [-1, 7], [5.5, -8.5]]) { ctx.beginPath(); ctx.arc(lx, ly, 1.8, 0, Math.PI * 2); ctx.fill(); }
        }
        ctx.strokeStyle = id === 'arc_os' ? c.trim : 'rgba(255,255,255,.85)';
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-1, -24); ctx.lineTo(-1, 7); ctx.stroke();
        break;
      case 'baton_lune':
        ctx.fillStyle = '#e8e0f8'; ctx.fillRect(-1.5, -27, 3, 32);
        ctx.save();
        ctx.shadowColor = c.trim; ctx.shadowBlur = 10;
        ctx.fillStyle = c.color;
        ctx.beginPath(); ctx.arc(0, -32, 5.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.arc(2.6, -33.5, 4.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = c.trim;
        ctx.beginPath(); ctx.arc(3.5, -28, 1.1 + Math.abs(flicker(300, 0.5)), 0, Math.PI * 2); ctx.fill();
        break;
      case 'baton_crane':
        ctx.fillStyle = '#4a3828'; ctx.fillRect(-1.5, -26, 3, 31);
        ctx.save();
        ctx.shadowColor = c.color; ctx.shadowBlur = 9;
        ctx.fillStyle = c.trim;
        ctx.beginPath(); ctx.arc(0, -30, 4.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(-2.6, -27, 5.2, 3);
        ctx.restore();
        ctx.fillStyle = c.color;
        ctx.beginPath(); ctx.arc(-1.6, -30.5, 1.2, 0, Math.PI * 2); ctx.arc(1.6, -30.5, 1.2, 0, Math.PI * 2); ctx.fill();
        break;
      case 'katana':
        ctx.fillStyle = c.trim; ctx.fillRect(-1.3, -2, 2.6, 8);
        ctx.fillStyle = '#ffc93a'; ctx.fillRect(-3.5, -3, 7, 1.6);
        ctx.fillStyle = c.color;
        ctx.beginPath(); ctx.moveTo(-1.3, -3); ctx.quadraticCurveTo(-0.5, -18, 2.5, -32); ctx.quadraticCurveTo(2.2, -18, 1.3, -3); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.7)';
        ctx.fillRect(0.2, -20, 0.6, 15);
        break;
      case 'dagues_ombre':
        ctx.fillStyle = c.trim; ctx.fillRect(-1.5, -2, 3, 6);
        ctx.save();
        ctx.shadowColor = c.color; ctx.shadowBlur = 8;
        ctx.fillStyle = c.color;
        ctx.beginPath(); ctx.moveTo(-2.4, -2); ctx.lineTo(2.4, -2); ctx.quadraticCurveTo(3, -10, -0.5, -19); ctx.quadraticCurveTo(0, -10, -2.4, -2); ctx.fill();
        ctx.restore();
        break;
      case 'masse_soleil':
        ctx.fillStyle = '#c9a050'; ctx.fillRect(-1.5, -18, 3, 22);
        ctx.save();
        ctx.shadowColor = c.color; ctx.shadowBlur = 10;
        ctx.fillStyle = c.color;
        ctx.save(); ctx.translate(0, -24); ctx.rotate(performance.now() / 900);
        for (let k = 0; k < 8; k++) { ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.moveTo(-1.2, -4.5); ctx.lineTo(0, -8.5); ctx.lineTo(1.2, -4.5); ctx.fill(); }
        ctx.restore();
        ctx.beginPath(); ctx.arc(0, -24, 5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = c.trim;
        ctx.beginPath(); ctx.arc(0, -24, 2.2, 0, Math.PI * 2); ctx.fill();
        break;
      case 'marteau':
        ctx.fillStyle = '#7a5530'; ctx.fillRect(-1.5, -20, 3, 25);
        ctx.fillStyle = c.color;
        ctx.strokeStyle = INK; ctx.lineWidth = 1;
        roundRect(ctx, -7, -29, 14, 9, 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = c.trim;
        ctx.fillRect(-7, -26, 14, 2.4);
        break;
      default:
    }
  }

  // Objet secondaire (derrière le corps)
  function drawOffhandSkin(ctx, id, c) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    switch (id) {
      case 'bouclier_dragon':
        ctx.fillStyle = c.color;
        ctx.beginPath(); ctx.moveTo(-19, -8); ctx.lineTo(-6, -10); ctx.lineTo(-6, 7); ctx.quadraticCurveTo(-12, 15, -19, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = c.trim; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(-18, -7); ctx.lineTo(-7, -9); ctx.lineTo(-7, 6.5); ctx.quadraticCurveTo(-12, 13.5, -18, 6.5); ctx.closePath(); ctx.stroke();
        ctx.fillStyle = c.trim;
        ctx.beginPath(); ctx.ellipse(-12.5, 0, 3, 1.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = INK;
        ctx.fillRect(-12.9, -1.6, 0.9, 3.2);
        break;
      case 'carquois_feu':
        ctx.save(); ctx.rotate(0.35);
        ctx.fillStyle = c.color;
        roundRect(ctx, -12, -18, 7, 20, 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = c.trim;
        ctx.fillRect(-12, -14, 7, 1.5); ctx.fillRect(-12, -4, 7, 1.5);
        for (let i = 0; i < 3; i++) {
          const f = flicker(70 + i * 20, 1.2);
          ctx.beginPath(); ctx.moveTo(-12 + i * 2.3, -18); ctx.lineTo(-11.2 + i * 2.3, -24 + f); ctx.lineTo(-10.4 + i * 2.3, -18); ctx.fill();
        }
        ctx.restore();
        break;
      case 'grimoire_maudit':
        ctx.fillStyle = c.color;
        roundRect(ctx, -20, -5, 10.5, 12.5, 1.5); ctx.fill(); ctx.stroke();
        ctx.save();
        ctx.shadowColor = c.trim; ctx.shadowBlur = 6;
        ctx.fillStyle = c.trim;
        ctx.beginPath(); ctx.ellipse(-14.7, 1.2, 2.6, 1.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = INK;
        ctx.beginPath(); ctx.arc(-14.7, 1.2, 0.8, 0, Math.PI * 2); ctx.fill();
        break;
      case 'dague_poison':
        ctx.fillStyle = c.trim;
        ctx.fillRect(-12.5, -1, 3, 5);
        ctx.fillStyle = c.color;
        ctx.beginPath(); ctx.moveTo(-13.2, -1); ctx.lineTo(-8.8, -1); ctx.lineTo(-11, -14); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(-11, 5 + ((performance.now() / 40) % 8), 0.9, 0, Math.PI * 2); ctx.fill();
        break;
      case 'relique_lune':
        ctx.save();
        ctx.shadowColor = c.color; ctx.shadowBlur = 8;
        ctx.fillStyle = c.color;
        ctx.beginPath(); ctx.arc(-13, 5, 5, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.arc(-11, 3.5, 4.2, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = c.trim;
        ctx.beginPath(); ctx.arc(-11, 4.5, 1, 0, Math.PI * 2); ctx.fill();
        break;
      default:
    }
  }

  // Peaux légendaires : détails par-dessus la tête
  function drawBodyExtras(ctx, id, c) {
    switch (id) {
      case 'peau_ogre':
        ctx.fillStyle = shade(c.color, -0.15);
        ctx.beginPath(); ctx.moveTo(-8, -20); ctx.lineTo(-14, -24); ctx.lineTo(-9, -15); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f5ead0';
        for (const tx of [3.2, 8]) { ctx.beginPath(); ctx.moveTo(tx - 1.2, -10.5); ctx.lineTo(tx, -14.5); ctx.lineTo(tx + 1.2, -10.5); ctx.closePath(); ctx.fill(); }
        ctx.fillStyle = 'rgba(0,0,0,.18)';
        ctx.fillRect(1, -22, 9.5, 1.6);
        break;
      case 'peau_dragon':
        ctx.fillStyle = '#ffc93a';
        ctx.strokeStyle = INK; ctx.lineWidth = 0.8;
        for (const [hx, d] of [[-4, -1], [4, 1]]) {
          ctx.beginPath(); ctx.moveTo(hx - 2, -24.5); ctx.quadraticCurveTo(hx - 4 + d, -31, hx - 8, -33); ctx.quadraticCurveTo(hx - 3, -29, hx + 2, -25); ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = shade(c.color, -0.3);
        for (const [sx, sy] of [[-5, -19], [-3, -13], [-7, -14], [-2, -22]]) { ctx.beginPath(); ctx.arc(sx, sy, 1.1, 0, Math.PI); ctx.fill(); }
        break;
      default:
    }
  }

  // Visage dessiné (cache des dessins des autres joueurs : « id.version » → pixels)
  const drawings = {};
  function drawingPixels(ref) {
    if (!ref || !String(ref).includes('.')) return null; // « id.version » seulement
    const entry = drawings[ref];
    if (entry !== undefined) return entry;
    drawings[ref] = null;
    const id = String(ref).split('.')[0];
    fetch(`/api/drawing/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d && d.pixels) drawings[ref] = d.pixels;
    }).catch(() => {});
    return null;
  }

  function drawDrawnFace(ctx, pixels, facing) {
    const n = window.Rules ? Rules.DRAWING.size : 12;
    const palette = window.Rules ? Rules.DRAWING.palette : [];
    const size = 18;
    const px = size / n;
    ctx.save();
    ctx.beginPath(); ctx.arc(0, -16, 10, 0, Math.PI * 2); ctx.clip();
    ctx.translate(0, -16);
    ctx.scale(facing, 1); // le dessin n'est jamais en miroir
    for (let i = 0; i < pixels.length; i++) {
      const ch = pixels[i];
      if (ch === '0') continue;
      ctx.fillStyle = palette[Number(ch) - 1] || INK;
      ctx.fillRect(-size / 2 + (i % n) * px, -size / 2 + Math.floor(i / n) * px, px + 0.05, px + 0.05);
    }
    ctx.restore();
  }

  /*
   * f = { name, cls, look: {slot: rarité} (équipement), app: apparence (couleur, visage, cosmétiques) }
   * o = { scale, facing (1|-1), bob, flash (0..1), alpha, swing (0..1) }
   */
  function drawFighter(ctx, x, y, f, o = {}) {
    const s = o.scale || 1;
    const facing = o.facing || 1;
    const look = f.look || {};
    const app = f.app || {};
    const ci = window.Rules && Rules.CLASS_INFO[f.cls];
    const weaponKind = ci ? ci.weapon : null;
    const offhandKind = ci ? ci.offhand : null;
    const colorOpt = app.color && window.Rules && Rules.APPEARANCE.color.options[app.color];
    const hue = hueOf(f.name);
    const body = skinOf(app, 'body', f.cls);
    const skin = body ? body.color : colorOpt ? colorOpt.hex : `hsl(${hue}, 55%, 62%)`;
    const spectre = body && app.body === 'peau_spectre';
    const cloth = colorOpt ? shade(colorOpt.hex, -0.45) : `hsl(${hue}, 45%, 38%)`;

    ctx.save();
    ctx.translate(x, y + (o.bob || 0));
    ctx.scale(s * facing, s);
    ctx.globalAlpha = (o.alpha == null ? 1 : o.alpha) * (spectre ? 0.72 : 1);

    drawAura(ctx, app.aura);

    // ombre
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.ellipse(0, 18, 13, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    drawCape(ctx, app.cape);

    // jambes / pantalon (une forme spectrale flotte : une traîne au lieu des jambes)
    const pants = skinOf(app, 'pants', f.cls);
    if (spectre) {
      const w = Math.sin(performance.now() / 250) * 2;
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.moveTo(-9, 6); ctx.lineTo(9, 6); ctx.quadraticCurveTo(6, 14, 2 + w, 20); ctx.quadraticCurveTo(-2, 14, -6 - w, 19); ctx.quadraticCurveTo(-8, 12, -9, 6); ctx.fill();
    } else {
      if (pants) drawPantsSkin(ctx, app.pants, pants, skin);
      else {
        ctx.fillStyle = look.pantalon ? RC[look.pantalon] : '#3a3350';
        roundRect(ctx, -8, 8, 7, 10, 2); ctx.fill();
        roundRect(ctx, 1, 8, 7, 10, 2); ctx.fill();
      }
      drawShoes(ctx, app.shoes);
    }

    // objet secondaire de la classe (couleur de rareté s'il est équipé, ou skin de la classe)
    const offSkin = skinOf(app, 'offhand', f.cls);
    if (offSkin) drawOffhandSkin(ctx, app.offhand, offSkin);
    else if (offhandKind) drawOffhand(ctx, offhandKind, look.secondaire ? RC[look.secondaire] : METAL);

    // corps / plastron
    const chest = skinOf(app, 'chest', f.cls);
    if (chest) drawChestSkin(ctx, app.chest, chest);
    else {
      ctx.fillStyle = body && app.body === 'peau_dragon' && !look.plastron ? shade(skin, -0.2) : look.plastron ? RC[look.plastron] : cloth;
      roundRect(ctx, -10, -8, 20, 18, 6); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    drawCapeCollar(ctx, app.cape);

    // ceinture
    const belt = skinOf(app, 'belt', f.cls);
    if (belt) {
      drawBeltSkin(ctx, app.belt, belt);
    } else if (look.ceinture) {
      ctx.fillStyle = RC[look.ceinture];
      ctx.fillRect(-10, 4, 20, 3);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillRect(-2, 3.5, 4, 4);
    }

    // tête + visage
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, -16, 10, 0, Math.PI * 2);
    ctx.fill();
    const drawn = skinOf(app, 'drawing', f.cls) && (app.drawingPixels || drawingPixels(app.drawing));
    if (drawn) drawDrawnFace(ctx, drawn, facing);
    else drawFace(ctx, app);
    if (body) drawBodyExtras(ctx, app.body, body);
    drawFaceItem(ctx, app.face);

    // boucles d'oreilles
    if (look.boucles) {
      ctx.fillStyle = RC[look.boucles];
      ctx.beginPath();
      ctx.arc(-6, -10, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // chapeau (cosmétique) sinon casque (équipement)
    if (cosmetic(app.hat)) {
      drawHat(ctx, app.hat);
    } else if (look.casque) {
      drawHelmet(ctx, RC[look.casque]);
    }

    // arme de la classe (main avant) avec mouvement d'attaque : au repos, elle est tenue droite, un peu vers
    // l'avant, pour ne jamais passer devant le visage (et les cosmétiques) ; le coup part vers l'avant.
    const swing = o.swing || 0;
    const ranged = weaponKind === 'arc' || weaponKind === 'baton';
    ctx.save();
    ctx.translate(11, 0);
    ctx.rotate(ranged ? 0.15 + swing * 0.4 : 0.25 + swing * 1.45);
    const weaponSkin = skinOf(app, 'weapon', f.cls);
    if (weaponSkin) drawWeaponSkin(ctx, app.weapon, weaponSkin);
    else drawWeapon(ctx, weaponKind, look.arme ? RC[look.arme] : METAL);
    ctx.restore();

    // mains / gants
    const gloves = skinOf(app, 'gloves', f.cls);
    const backHand = offhandKind !== 'bouclier' && !(offSkin && app.offhand === 'bouclier_dragon');
    if (gloves) {
      drawGloveSkin(ctx, app.gloves, gloves, 11, 1);
      if (backHand) drawGloveSkin(ctx, app.gloves, gloves, -11, 1);
    } else {
      ctx.fillStyle = look.gants ? RC[look.gants] : skin;
      ctx.beginPath();
      ctx.arc(11, 1, 3.6, 0, Math.PI * 2);
      ctx.fill();
      if (backHand) {
        ctx.beginPath();
        ctx.arc(-11, 1, 3.6, 0, Math.PI * 2);
        ctx.fill();
      }
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
  window.ZLDrawings = drawings;
  window.RARITY_COLORS = RC;
})();
