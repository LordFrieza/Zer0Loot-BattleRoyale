/*
 * Vie autour de la maison (vue de la façade) : ce qui passe dans le ciel (Pyrax, avion publicitaire, montgolfière,
 * nuée de chauves-souris, oiseaux) et les joueurs qui se baladent au premier plan en lâchant des petites phrases.
 * Purement décoratif : rien n'est envoyé au serveur. Dépend de fighter.js (drawFighter) et monsters.js (drawMonster).
 */
(function () {
  // Banderoles de l'avion et de la montgolfière
  const ADS = [
    '🎰 Casino Zer0Loot ! Le casino de la déchéance !',
    '🎰 Casino Zer0Loot : la maison gagne toujours (sauf la tienne)',
    '🐉 Pyrax recrute ! Salaire : des cendres',
    '🧟 Survivor : tiendras-tu jusqu\'à la vague 30 ?',
    '🛒 Marché Zer0Loot : les prix fondent… comme ta bourse',
    '👑 Un trône dans ton salon ? Ton banquier dit non.',
    '🕷️ Maexxna, tissage sur mesure. Devis gratuit.',
    '🧊 Liche & Fils : climatisation éternelle',
    '🪦 Cimetière du Survivor : places encore libres !',
    '📦 Coffre légendaire : 0,5 % de chances, 100 % d\'espoir',
    '🐾 Adoptez un familier ! (il mord un peu)',
    '🏠 Agrandissez ! Le manoir, c\'est 90 000 émeraudes de bonheur',
    '🍗 Poulet rôti du Survivor : trouvé par terre, garanti frais',
    '⚔️ !join : le seul mot magique qui marche vraiment',
  ];
  // Petites phrases des passants
  const LINES = [
    'Belle maison ! Un peu petite…',
    'J\'ai tout misé sur le rouge.',
    'Quelqu\'un a vu mon familier ?',
    'Encore raté la vague 30…',
    'Il me manque 89 000 émeraudes.',
    'Je reviens du casino. J\'ai plus de chaussures.',
    'Pyrax a encore brûlé ma haie !',
    'Joli toit. C\'est de l\'or ?',
    'Je cherche un coloc\', pas Grokk.',
    'Un jour, j\'aurai un manoir.',
    'Le facteur est passé ?',
    'Tu crois qu\'il reste du poulet ?',
    'J\'ai forgé une épée… elle a explosé.',
    'Moi, je campe au village. Chut.',
    'Maexxna m\'a mis une toile ce matin.',
    '!join !join !join',
    'C\'est toi qui as acheté le canapé à 4 200 ?',
    'Une petite partie de blackjack ?',
    'Ça sent le gâteau par ici !',
    'Je promène mon dragon (invisible).',
  ];
  // Pancarte de la montgolfière (courte)
  const SIGNS = ['Vive Zer0Loot !', '!join', 'Casino ce soir !', 'Coucou d\'en haut !', 'Vue imprenable !', 'Qui a vu Pyrax ?'];
  const CLASSES = ['guerrier', 'archer', 'mage', 'assassin', 'pretre'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  let people = []; // [{ name, cls, look, app }] : vrais joueurs (liste des maisons)
  let sky = null; // ce qui passe dans le ciel
  let skyAt = 0; // prochain passage
  let walkers = [];
  let walkAt = 0;
  let last = 0;

  function setPeople(list) {
    people = (list || []).filter((p) => p && p.name);
  }
  function randomPerson() {
    if (people.length && Math.random() < 0.85) return pick(people);
    const cls = window.Rules ? pick(Object.keys(Rules.CLASS_INFO)) : pick(CLASSES);
    return { name: pick(['Gédéon', 'Brunehilde', 'Kévin', 'Zoé', 'Marcel', 'Lucette', 'Pierrot', 'Ginette', 'Tutu']), cls, look: {}, app: {} };
  }

  // ---------- Ciel ----------
  function newSky(now, cw) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    const kind = pick(['avion', 'avion', 'pyrax', 'pyrax', 'ballon', 'chauves', 'oiseaux']);
    const speed = { avion: 70, pyrax: 85, ballon: 22, chauves: 60, oiseaux: 45 }[kind];
    const pad = kind === 'avion' ? 420 : 160;
    // Haut dans le ciel, au-dessus du toit
    return { kind, dir, speed, x: dir > 0 ? -pad : cw + pad, y: 18 + Math.random() * (kind === 'ballon' ? 10 : 26), t0: now, text: kind === 'ballon' ? pick(SIGNS) : pick(ADS), pad };
  }
  function drawPlane(g, s, t) {
    const d = s.dir;
    g.save();
    g.translate(s.x, s.y);
    // Banderole tirée derrière l'avion
    g.font = '800 12px system-ui';
    const tw = g.measureText(s.text).width + 20;
    const bx = d > 0 ? -60 - tw : 60;
    g.strokeStyle = 'rgba(60, 60, 60, .7)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(d > 0 ? -22 : 22, 0); g.lineTo(d > 0 ? bx + tw : bx, 0); g.stroke();
    const wave = (i) => Math.sin(t / 180 + i * 0.6) * 2;
    g.fillStyle = '#fff8e0'; g.strokeStyle = '#c0392b'; g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(bx, -10 + wave(0));
    for (let i = 1; i <= 6; i++) g.lineTo(bx + (tw * i) / 6, -10 + wave(i));
    for (let i = 6; i >= 0; i--) g.lineTo(bx + (tw * i) / 6, 10 + wave(i));
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#7a1f14'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s.text, bx + tw / 2, wave(3) + 1);
    // Avion
    g.scale(d, 1);
    g.fillStyle = '#e8eef5'; g.beginPath(); g.ellipse(0, 0, 26, 7, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d64545'; g.beginPath(); g.moveTo(-6, 0); g.lineTo(-14, 14); g.lineTo(2, 2); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(-6, 0); g.lineTo(-12, -11); g.lineTo(2, -2); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(-22, -2); g.lineTo(-30, -12); g.lineTo(-20, -1); g.closePath(); g.fill();
    g.fillStyle = '#7fb8e6'; g.beginPath(); g.ellipse(12, -2, 6, 3, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(80,80,80,.7)'; g.lineWidth = 1.5;
    const prop = Math.sin(t / 25) * 8;
    g.beginPath(); g.moveTo(27, -prop); g.lineTo(27, prop); g.stroke();
    g.restore();
  }
  function drawBalloon(g, s, t) {
    const sway = Math.sin(t / 900) * 4;
    g.save();
    g.translate(s.x, s.y + 10 + sway);
    const stripes = ['#ff5d73', '#ffd34a', '#5dc8ff', '#9a6bff'];
    for (let i = 0; i < 4; i++) {
      g.fillStyle = stripes[i];
      g.beginPath(); g.ellipse(0, 0, 22 - i * 5.5, 26, 0, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(80, 50, 20, .8)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-14, 18); g.lineTo(-6, 36); g.moveTo(14, 18); g.lineTo(6, 36); g.stroke();
    g.fillStyle = '#8a5a2a'; g.fillRect(-7, 35, 14, 9);
    g.restore();
    // Petit panneau suspendu
    g.font = '800 10px system-ui';
    const tw = g.measureText(s.text).width + 12;
    g.fillStyle = 'rgba(255, 248, 224, .95)'; g.strokeStyle = '#8a5a2a';
    g.fillRect(s.x - tw / 2, s.y + 58 + sway, tw, 16); g.strokeRect(s.x - tw / 2, s.y + 58 + sway, tw, 16);
    g.fillStyle = '#5a3a14'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s.text, s.x, s.y + 66 + sway);
  }
  function drawFlock(g, s, t, bats) {
    for (let i = 0; i < (bats ? 6 : 5); i++) {
      const ox = -s.dir * (i * 22 + (i % 2) * 8);
      const oy = Math.sin(t / 300 + i) * 6 + (i % 3) * 10;
      if (bats && window.drawMonster) drawMonster(g, s.x + ox, s.y + oy, { kind: 'chauve_souris' }, { t: t + i * 90, scale: 0.35, facing: s.dir });
      else {
        const fl = Math.sin(t / 120 + i) * 4;
        g.strokeStyle = 'rgba(40, 40, 60, .8)'; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(s.x + ox - 6, s.y + oy - fl); g.quadraticCurveTo(s.x + ox - 3, s.y + oy - 3, s.x + ox, s.y + oy); g.quadraticCurveTo(s.x + ox + 3, s.y + oy - 3, s.x + ox + 6, s.y + oy - fl); g.stroke();
      }
    }
  }
  function drawSky(g, cw, ch, t) {
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
    last = t;
    if (!sky && t >= skyAt) sky = newSky(t, cw);
    if (sky) {
      sky.x += sky.dir * sky.speed * dt;
      if (sky.kind === 'avion') drawPlane(g, sky, t);
      else if (sky.kind === 'ballon') drawBalloon(g, sky, t);
      else if (sky.kind === 'pyrax' && window.drawMonster) drawMonster(g, sky.x, sky.y + 18 + Math.sin(t / 400) * 6, { kind: 'dragon' }, { t, flying: true, scale: 0.3, facing: sky.dir });
      else drawFlock(g, sky, t, sky.kind === 'chauves');
      if ((sky.dir > 0 && sky.x > cw + sky.pad + 40) || (sky.dir < 0 && sky.x < -sky.pad - 40)) {
        sky = null;
        skyAt = t + 4000 + Math.random() * 9000;
      }
    }
    updateWalkers(cw, ch, t, dt);
  }

  // ---------- Passants au premier plan ----------
  function updateWalkers(cw, ch, t, dt) {
    if (walkers.length < 2 && t >= walkAt) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      walkers.push({ p: randomPerson(), dir, x: dir > 0 ? -30 : cw + 30, y: ch - 22 - Math.random() * 14, speed: 32 + Math.random() * 22, stopAt: cw * (0.2 + Math.random() * 0.6), stopped: 0, said: false, line: null, lineUntil: 0, wait: 0, t0: t });
      walkAt = t + 3500 + Math.random() * 6000;
    }
    for (const w of walkers) {
      // S'arrête parfois au milieu pour dire une petite phrase
      if (!w.said && ((w.dir > 0 && w.x >= w.stopAt) || (w.dir < 0 && w.x <= w.stopAt))) {
        w.said = true;
        if (Math.random() < 0.75) { w.line = pick(LINES); w.lineUntil = t + 3200; w.wait = t + 2600; }
      }
      if (t >= w.wait) w.x += w.dir * w.speed * dt;
    }
    walkers = walkers.filter((w) => w.x > -60 && w.x < cw + 60);
  }
  function drawFront(g, cw, ch, t) {
    walkers.sort((a, b) => a.y - b.y);
    for (const w of walkers) {
      const moving = t >= w.wait;
      const bob = moving ? -Math.abs(Math.sin((t - w.t0) / 110)) * 2 : 0;
      if (window.drawFighter) drawFighter(g, w.x, w.y - 16, w.p, { scale: 1, facing: w.dir, bob });
      g.font = '700 10px system-ui'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(w.p.name, w.x, w.y + 14);
      g.fillStyle = '#fff'; g.fillText(w.p.name, w.x, w.y + 14);
      if (w.line && t < w.lineUntil) bubble(g, w.x, w.y - 58, w.line, cw);
    }
  }
  function bubble(g, x, y, text, cw) {
    g.font = '700 11px system-ui';
    const tw = Math.min(220, g.measureText(text).width + 16);
    const bx = Math.max(4, Math.min(cw - tw - 4, x - tw / 2));
    g.fillStyle = 'rgba(255,255,255,.96)'; g.strokeStyle = 'rgba(30, 20, 50, .6)'; g.lineWidth = 1.5;
    g.beginPath(); g.roundRect(bx, y - 20, tw, 22, 9); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(x - 5, y + 1); g.lineTo(x, y + 9); g.lineTo(x + 5, y + 1); g.closePath(); g.fill();
    g.fillStyle = '#2a1d40'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, bx + tw / 2, y - 9, tw - 10);
    g.textBaseline = 'alphabetic';
  }

  window.HouseLife = { setPeople, sky: drawSky, front: drawFront };
})();
