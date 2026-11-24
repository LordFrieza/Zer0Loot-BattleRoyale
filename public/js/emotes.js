/*
 * Émotes du tchat (Rules.CHAT_EMOTES) : les boss en version miniature (dessin du familier, drawPet de monsters.js) avec
 * une humeur dessinée par-dessus (flammes de colère, rougeurs, larmes, cœurs…), et quelques objets du jeu. Chaque émote
 * est dessinée une fois dans un canvas de 96 × 96, puis gardée en image (data URL).
 * Emotes.url(id) → image ; Emotes.html(texte) → HTML échappé, émotes « :id: » remplacées par leurs images.
 */
(function () {
  const S = 96;
  const cache = new Map();

  // ---------- petits dessins ----------
  function heart(g, x, y, r, color) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, y + r * 0.9);
    g.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.7, y - r * 1.4, x, y - r * 0.5);
    g.bezierCurveTo(x + r * 0.7, y - r * 1.4, x + r * 1.6, y - r * 0.2, x, y + r * 0.9);
    g.fill();
  }
  function drop(g, x, y, r, color) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, y - r * 1.6);
    g.quadraticCurveTo(x + r, y, x, y + r);
    g.quadraticCurveTo(x - r, y, x, y - r * 1.6);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.1, r * 0.25, 0, Math.PI * 2); g.fill();
  }
  function star(g, x, y, r, color) {
    g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 ? r * 0.38 : r;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath(); g.fill();
  }
  function text(g, t, x, y, size, fill, stroke = '#2a1600', rot = 0) {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.font = `900 ${size}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = Math.max(3, size / 5); g.strokeStyle = stroke; g.strokeText(t, 0, 0);
    g.fillStyle = fill; g.fillText(t, 0, 0);
    g.restore();
  }
  function coin(g, x, y, r) {
    g.fillStyle = '#b8860b'; g.beginPath(); g.ellipse(x, y + r * 0.18, r, r * 0.92, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffd34a'; g.beginPath(); g.ellipse(x, y, r, r * 0.92, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#c99a1a'; g.lineWidth = Math.max(1, r * 0.18); g.beginPath(); g.ellipse(x, y, r * 0.62, r * 0.56, 0, 0, Math.PI * 2); g.stroke();
  }
  function flake(g, x, y, r) {
    g.strokeStyle = '#e6f7ff'; g.lineWidth = 2; g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      g.beginPath(); g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.stroke();
    }
  }

  // Humeurs dessinées par-dessus le boss. (hx, hy) : à peu près le centre du visage.
  const MOODS = {
    rage(g, hx, hy) {
      // jet de flammes et veine de colère
      const grd = g.createLinearGradient(hx + 8, hy, hx + 44, hy - 4);
      grd.addColorStop(0, '#fff3a0'); grd.addColorStop(0.45, '#ff9a1f'); grd.addColorStop(1, 'rgba(255,60,20,.15)');
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(hx + 10, hy + 4); g.quadraticCurveTo(hx + 30, hy - 14, hx + 46, hy - 8); g.quadraticCurveTo(hx + 36, hy + 2, hx + 46, hy + 14); g.quadraticCurveTo(hx + 28, hy + 16, hx + 10, hy + 8); g.fill();
      g.strokeStyle = '#ff2d2d'; g.lineWidth = 3.2; g.lineCap = 'round';
      const vx = hx - 14; const vy = hy - 22;
      for (const [a, b, c, d] of [[-6, -2, -2, -2], [2, -2, 6, -2], [-2, -6, -2, -2], [-2, 2, -2, 6], [2, 2, 6, 2], [2, 2, 2, 6]]) { g.beginPath(); g.moveTo(vx + a, vy + b); g.lineTo(vx + c, vy + d); g.stroke(); }
    },
    shy(g, hx, hy) {
      g.fillStyle = 'rgba(255, 110, 150, .55)';
      g.beginPath(); g.ellipse(hx - 12, hy + 6, 7, 4, 0, 0, Math.PI * 2); g.ellipse(hx + 12, hy + 6, 7, 4, 0, 0, Math.PI * 2); g.fill();
      drop(g, hx + 24, hy - 18, 5, '#8fd3ff');
      text(g, '...', hx - 22, hy - 30, 14, '#ffffff', '#3a3a6a');
    },
    cry(g, hx, hy) {
      g.fillStyle = 'rgba(110, 190, 255, .85)';
      g.fillRect(hx - 13, hy + 2, 5, 26); g.fillRect(hx + 8, hy + 2, 5, 26);
      drop(g, hx - 10, hy + 32, 4, '#6ec0ff'); drop(g, hx + 11, hy + 34, 4, '#6ec0ff');
      g.fillStyle = 'rgba(110, 190, 255, .45)'; g.beginPath(); g.ellipse(hx, S - 6, 26, 5, 0, 0, Math.PI * 2); g.fill();
    },
    flirt(g, hx, hy) {
      heart(g, hx + 26, hy - 26, 9, '#ff4d8d');
      heart(g, hx - 28, hy - 14, 6, '#ff7eb3');
      heart(g, hx + 34, hy - 2, 5, '#ff9ac6');
      g.fillStyle = 'rgba(255, 90, 140, .5)';
      g.beginPath(); g.ellipse(hx - 11, hy + 7, 6, 3.5, 0, 0, Math.PI * 2); g.ellipse(hx + 11, hy + 7, 6, 3.5, 0, 0, Math.PI * 2); g.fill();
    },
    smug(g, hx, hy) {
      // carte à jouer et étincelles
      g.save(); g.translate(hx + 28, hy - 20); g.rotate(0.35);
      g.fillStyle = '#fff'; g.strokeStyle = '#2a1600'; g.lineWidth = 2; g.beginPath(); g.roundRect(-9, -13, 18, 26, 3); g.fill(); g.stroke();
      heart(g, 0, 2, 5, '#e33');
      g.restore();
      star(g, hx - 30, hy + 26, 6, '#ffe27a');
      text(g, 'héhé', hx - 26, hy - 26, 12, '#ff9ae0', '#3a0f2e', -0.15);
    },
    lol(g, hx, hy) {
      drop(g, hx - 20, hy + 2, 4.5, '#8fd3ff'); drop(g, hx + 20, hy + 2, 4.5, '#8fd3ff');
      text(g, 'MDR', S / 2, 14, 20, '#ffe27a', '#5a2a00', -0.12);
    },
    magic(g, hx, hy) {
      star(g, hx - 26, hy - 22, 7, '#c79bff');
      star(g, hx + 28, hy - 28, 9, '#ffe27a');
      star(g, hx + 30, hy + 8, 5, '#9fe0ff');
      g.strokeStyle = 'rgba(199, 155, 255, .8)'; g.lineWidth = 2.5;
      g.beginPath(); g.arc(hx, hy - 6, 34, -2.6, -0.6); g.stroke();
    },
    money(g, hx, hy) {
      coin(g, hx - 28, hy - 20, 8); coin(g, hx + 30, hy - 26, 9); coin(g, hx + 32, hy + 6, 7); coin(g, hx - 30, hy + 10, 6);
      text(g, '$', hx + 30, hy - 26, 11, '#8a5a00', '#ffe27a');
    },
    cold(g, hx, hy) {
      g.fillStyle = 'rgba(160, 220, 255, .28)'; g.fillRect(0, 0, S, S);
      flake(g, hx - 28, hy - 24, 7); flake(g, hx + 28, hy - 30, 8); flake(g, hx + 30, hy + 10, 6); flake(g, hx - 32, hy + 12, 5);
      g.fillStyle = '#e6f7ff';
      for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(14 + i * 16, 0); g.lineTo(22 + i * 16, 0); g.lineTo(18 + i * 16, 8 + (i % 2) * 6); g.fill(); }
    },
    scared(g, hx, hy) {
      text(g, '!!', hx + 28, hy - 26, 22, '#ff4d4d', '#3a0000', 0.15);
      drop(g, hx - 24, hy - 14, 5, '#8fd3ff'); drop(g, hx - 30, hy + 2, 4, '#8fd3ff');
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2;
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(hx + s * 38, hy - 6); g.lineTo(hx + s * 44, hy - 2); g.moveTo(hx + s * 38, hy + 4); g.lineTo(hx + s * 45, hy + 6); g.stroke(); }
    },
    sleep(g, hx, hy) {
      text(g, 'z', hx + 22, hy - 4, 13, '#ffffff', '#2a3a6a');
      text(g, 'Z', hx + 34, hy - 18, 17, '#ffffff', '#2a3a6a');
      g.fillStyle = 'rgba(200, 230, 255, .75)'; g.beginPath(); g.arc(hx - 10, hy + 10, 6, 0, Math.PI * 2); g.fill();
    },
  };

  // Objets
  const ITEMS = {
    chest(g) {
      const rays = g.createRadialGradient(48, 52, 6, 48, 52, 46);
      rays.addColorStop(0, 'rgba(255, 220, 110, .8)'); rays.addColorStop(1, 'rgba(255, 220, 110, 0)');
      g.fillStyle = rays; g.fillRect(0, 0, S, S);
      g.fillStyle = '#b56d38'; g.strokeStyle = '#2b160a'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(16, 46); g.lineTo(16, 38); g.quadraticCurveTo(16, 20, 48, 20); g.quadraticCurveTo(80, 20, 80, 38); g.lineTo(80, 46); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#8a4f24'; g.beginPath(); g.rect(16, 46, 64, 32); g.fill(); g.stroke();
      g.fillStyle = '#f2c94c'; g.fillRect(16, 43, 64, 6); g.fillRect(26, 21, 7, 57); g.fillRect(63, 21, 7, 57);
      g.fillStyle = '#ffe27a'; g.strokeStyle = '#5a4510'; g.lineWidth = 2; g.beginPath(); g.rect(42, 40, 12, 14); g.fill(); g.stroke();
      star(g, 80, 18, 7, '#fff6b0'); star(g, 14, 26, 5, '#fff6b0');
    },
    gold(g) {
      for (const [x, y, r] of [[30, 70, 12], [52, 74, 13], [72, 68, 11], [40, 56, 12], [62, 54, 12], [50, 38, 12]]) coin(g, x, y, r);
      star(g, 80, 24, 7, '#fff6b0'); star(g, 18, 34, 5, '#fff6b0');
    },
    gg(g) {
      star(g, 16, 18, 7, '#ffe27a'); star(g, 82, 76, 8, '#ffe27a'); star(g, 84, 18, 5, '#9fe0ff');
      text(g, 'GG', 48, 50, 44, '#ffd34a', '#5a2a00', -0.08);
    },
    rip(g) {
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(48, 86, 30, 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9a96a8'; g.strokeStyle = '#4a4658'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(22, 86); g.lineTo(22, 40); g.quadraticCurveTo(22, 14, 48, 14); g.quadraticCurveTo(74, 14, 74, 40); g.lineTo(74, 86); g.closePath(); g.fill(); g.stroke();
      text(g, 'RIP', 48, 46, 20, '#ffffff', '#4a4658');
      g.fillStyle = '#3f8a3e'; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(16 + i * 12, 88); g.lineTo(20 + i * 12, 78); g.lineTo(24 + i * 12, 88); g.fill(); }
    },
    fish(g) {
      g.save(); g.translate(48, 50); g.rotate(-0.25);
      g.fillStyle = '#ff9a3a'; g.beginPath(); g.ellipse(0, 0, 30, 17, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(-24, 0); g.lineTo(-44, -16); g.lineTo(-40, 0); g.lineTo(-44, 16); g.closePath(); g.fill();
      g.fillStyle = '#ffd08a'; g.beginPath(); g.ellipse(4, 6, 18, 8, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(16, -5, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1a1a2a'; g.beginPath(); g.arc(17, -5, 3, 0, Math.PI * 2); g.fill();
      g.restore();
      drop(g, 78, 22, 5, '#8fd3ff'); drop(g, 18, 22, 4, '#8fd3ff');
    },
    heart(g) {
      heart(g, 48, 50, 24, '#ff3a6a');
      g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(36, 36, 7, 4, -0.6, 0, Math.PI * 2); g.fill();
    },
    potion(g) {
      g.fillStyle = '#c9e8ff'; g.strokeStyle = '#2a3a5a'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(40, 14); g.lineTo(56, 14); g.lineTo(56, 34); g.quadraticCurveTo(80, 44, 78, 64); g.quadraticCurveTo(76, 86, 48, 86); g.quadraticCurveTo(20, 86, 18, 64); g.quadraticCurveTo(16, 44, 40, 34); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#ff3a5a'; g.beginPath(); g.moveTo(20, 58); g.quadraticCurveTo(48, 50, 76, 58); g.quadraticCurveTo(76, 84, 48, 84); g.quadraticCurveTo(20, 84, 20, 58); g.fill();
      g.fillStyle = '#8a5a30'; g.fillRect(38, 8, 20, 9);
      g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(40, 66, 4, 0, Math.PI * 2); g.arc(54, 72, 3, 0, Math.PI * 2); g.fill();
    },
  };

  // Le boss miniature cadré pour remplir l'émote : dessiné en grand dans un canvas de travail, on cherche son contour
  // (pixels non transparents) et on le recopie à la bonne taille. Renvoie le centre approximatif du visage.
  const HEAD = { maexxna: 0.45, mimic: 0.42, dragon: 0.42 }; // hauteur du visage (part de la silhouette depuis le haut)
  const HEAD_X = { dragon: 0.78 }; // position du visage en largeur (0,5 : au milieu)
  const FIT = { dragon: [62, 80, 4] }; // place réservée (largeur, hauteur, marge à gauche) : Pyrax laisse la place à ses flammes
  function drawBoss(g, boss, sleep) {
    const T = 360;
    const tc = document.createElement('canvas');
    tc.width = T; tc.height = T;
    const tg = tc.getContext('2d');
    if (window.drawPet) drawPet(tg, T / 2, T - 20, boss, { size: 1.6, t: 0, sleep, facing: 1 });
    const px = tg.getImageData(0, 0, T, T).data;
    let x0 = T; let y0 = T; let x1 = 0; let y1 = 0;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (px[(y * T + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0) return [S / 2, S / 2];
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const [fw, fh, left] = FIT[boss] || [84, 88, null];
    const k = Math.min(fw / bw, fh / bh);
    const dw = bw * k;
    const dh = bh * k;
    const dx = left == null ? (S - dw) / 2 : left;
    const dy = S - 4 - dh;
    g.drawImage(tc, x0, y0, bw, bh, dx, dy, dw, dh);
    return [dx + dw * (HEAD_X[boss] || 0.5), dy + dh * (HEAD[boss] || 0.3)];
  }

  function render(id) {
    const E = Rules.CHAT_EMOTES[id];
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    if (E.boss) {
      const [hx, hy] = drawBoss(g, E.boss, E.mood === 'sleep');
      if (MOODS[E.mood]) MOODS[E.mood](g, hx, Math.max(30, hy));
    } else if (ITEMS[E.item]) ITEMS[E.item](g);
    return c.toDataURL('image/png');
  }

  function url(id) {
    if (!Rules.CHAT_EMOTES[id]) return '';
    if (!cache.has(id)) cache.set(id, render(id));
    return cache.get(id);
  }

  function img(id, cls = 'emote') {
    const E = Rules.CHAT_EMOTES[id];
    return `<img class="${cls}" src="${url(id)}" alt=":${id}:" title="${esc(E.label)} — :${id}:" draggable="false">`;
  }

  // Texte d'un message → HTML (texte échappé, émotes en images ; un message fait d'émotes seules les montre en grand)
  function html(textValue) {
    const parts = Rules.chatTokens(String(textValue || ''));
    const onlyEmotes = parts.length && parts.every((p) => p.t === 'emote' || !p.v.trim());
    return parts.map((p) => (p.t === 'emote' ? img(p.id, onlyEmotes ? 'emote big' : 'emote') : esc(p.v))).join('');
  }

  window.Emotes = { url, img, html, ids: () => Object.keys(Rules.CHAT_EMOTES) };
})();
