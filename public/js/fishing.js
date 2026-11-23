/*
 * Onglet Pêche : une barque sur un lac, son personnage et son familier, une ambiance tranquille (ciel selon l'heure
 * réelle, nuages, libellules ou lucioles, nénuphars, roseaux). Un seul bouton (clic ou Espace) pour tout :
 *  - lancer la ligne ;
 *  - une forme approche du bouchon, le tapote… et quand il COULE, cliquer pour ferrer (trop tôt ou trop tard : raté) ;
 *  - remontée : maintenir le clic fait monter la zone verte (sinon elle retombe, elle a de l'élan) ; la garder sur le
 *    poisson remplit la jauge, sinon elle se vide ; pleine = prise, vide = il s'échappe.
 * Le serveur décide de ce qui mord et vérifie le ferrage et la durée de la remontée (/api/fishing/*).
 * Le Pêchédex (100 espèces, silhouettes noires pour celles qui manquent) s'ouvre à tout moment.
 * Utilise les globales : me, api, toast, esc, refresh, skyPhase, Rules, Sound, drawFighter, drawPet, drawFish, drawTreasure.
 */
(function () {
  const F = Rules.FISHING;
  const W = 960;
  const H = 460;
  const WATER = 236; // ligne d'horizon de l'eau
  const BOAT = { x: 300, y: 318 };
  const BOBBER = { x: 650, y: 352 };
  const $ = (id) => document.getElementById(id);
  const RCOL = { commun: '#a8acb4', peu_commun: '#3ddc5a', rare: '#3b8bff', epique: '#b14dff', legendaire: '#ff9a1f' };
  const RLAB = Object.fromEntries(Object.entries(Rules.RARITY_INFO).map(([k, v]) => [k, v.label]));
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const cm = (x) => (x >= 100 ? `${String(Math.round(x) / 100).replace('.', ',')} m` : `${String(Math.round(x * 10) / 10).replace('.', ',')} cm`);

  const S = {
    active: false, canvas: null, ctx: null, raf: 0, last: 0,
    phase: 'idle', // idle | casting | wait | bite | reel | result | escape
    cast: null, t0: 0, busy: false, holding: false,
    reel: null, result: null, msg: null, auto: false, nextAt: 0,
    ripples: [], splashes: [], hearts: [], jumps: [], jumpAt: 0, petHop: 0,
    session: [], // dernières prises de la séance
  };
  try { S.auto = localStorage.getItem('zl_fish_auto') === '1'; } catch (e) { /* ignore */ }

  // ---------- Décor ----------
  const CLOUDS = Array.from({ length: 6 }, (_, i) => ({ x: i * 190 + Math.random() * 80, y: 30 + Math.random() * 90, s: 0.6 + Math.random() * 0.7 }));
  const PADS = [[90, 400, 24], [150, 430, 18], [820, 300, 20], [880, 420, 26], [520, 440, 16], [760, 445, 22]];
  const REEDS = [...Array.from({ length: 9 }, (_, i) => [10 + i * 12, 460]), ...Array.from({ length: 8 }, (_, i) => [870 + i * 11, 300])];
  const BUGS = Array.from({ length: 14 }, (_, i) => ({ x: Math.random() * W, y: WATER - 40 + Math.random() * 200, p: Math.random() * 10, i }));

  function drawSky(ctx, t, ph) {
    const g = ctx.createLinearGradient(0, 0, 0, WATER);
    if (ph.night) { g.addColorStop(0, '#0a0f2c'); g.addColorStop(1, '#2b2c5e'); }
    else if (ph.dusk) { g.addColorStop(0, '#4a5ab0'); g.addColorStop(0.6, '#f09a7a'); g.addColorStop(1, '#ffd08a'); }
    else { g.addColorStop(0, '#7ec4f2'); g.addColorStop(1, '#d6f0ff'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, WATER + 2);
    if (ph.night) {
      for (let i = 0; i < 80; i++) { ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.5 * Math.abs(Math.sin(t / 700 + i * 1.3))})`; ctx.fillRect((i * 137.5) % W, (i * 41.7) % (WATER - 70), i % 9 ? 1.5 : 2.5, i % 9 ? 1.5 : 2.5); }
      ctx.fillStyle = '#fff6d0'; ctx.beginPath(); ctx.arc(780, 70, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#121640'; ctx.beginPath(); ctx.arc(792, 63, 24, 0, Math.PI * 2); ctx.fill();
    } else {
      const sx = 80 + ph.sun * 800;
      const sy = WATER - 20 - Math.sin(ph.sun * Math.PI) * 180;
      const sg = ctx.createRadialGradient(sx, sy, 8, sx, sy, 80);
      sg.addColorStop(0, ph.dusk ? '#ffe0a8' : '#fffbe0'); sg.addColorStop(0.35, ph.dusk ? 'rgba(255,170,100,.6)' : 'rgba(255,240,160,.5)'); sg.addColorStop(1, 'rgba(255,240,160,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, 80, 0, Math.PI * 2); ctx.fill();
    }
    // nuages qui dérivent
    ctx.fillStyle = ph.night ? 'rgba(160,170,220,.18)' : ph.dusk ? 'rgba(255,225,210,.75)' : 'rgba(255,255,255,.88)';
    for (const c of CLOUDS) {
      const x = ((c.x + t / 90 * c.s) % (W + 200)) - 100;
      ctx.beginPath(); ctx.ellipse(x, c.y, 46 * c.s, 15 * c.s, 0, 0, Math.PI * 2); ctx.ellipse(x + 30 * c.s, c.y - 9 * c.s, 30 * c.s, 15 * c.s, 0, 0, Math.PI * 2); ctx.ellipse(x - 28 * c.s, c.y - 4 * c.s, 24 * c.s, 12 * c.s, 0, 0, Math.PI * 2); ctx.fill();
    }
    // collines et sapins au loin
    ctx.fillStyle = ph.night ? '#1b2a3a' : ph.dusk ? '#6a6a8a' : '#8fbf8a';
    ctx.beginPath(); ctx.moveTo(0, WATER); ctx.quadraticCurveTo(160, WATER - 90, 360, WATER - 20); ctx.quadraticCurveTo(560, WATER - 110, 760, WATER - 30); ctx.quadraticCurveTo(880, WATER - 70, 960, WATER - 40); ctx.lineTo(960, WATER); ctx.closePath(); ctx.fill();
    ctx.fillStyle = ph.night ? '#12202a' : ph.dusk ? '#4a4a64' : '#4f8a5a';
    for (let i = 0; i < 26; i++) {
      const x = i * 38 + ((i * 17) % 20);
      const h = 26 + ((i * 29) % 30);
      ctx.beginPath(); ctx.moveTo(x, WATER); ctx.lineTo(x + 9, WATER - h); ctx.lineTo(x + 18, WATER); ctx.closePath(); ctx.fill();
    }
    // petit chalet et sa fumée, sur la rive gauche
    ctx.fillStyle = ph.night ? '#3a2a24' : '#8a5a3a'; ctx.fillRect(70, WATER - 34, 46, 30);
    ctx.fillStyle = ph.night ? '#4a2020' : '#b04a3a'; ctx.beginPath(); ctx.moveTo(62, WATER - 34); ctx.lineTo(93, WATER - 58); ctx.lineTo(124, WATER - 34); ctx.closePath(); ctx.fill();
    ctx.fillStyle = ph.night || ph.dusk ? '#ffd27a' : '#cfe8ff'; ctx.fillRect(84, WATER - 26, 10, 9);
    if (ph.night || ph.dusk) { const gl = ctx.createRadialGradient(89, WATER - 21, 2, 89, WATER - 21, 30); gl.addColorStop(0, 'rgba(255,210,120,.5)'); gl.addColorStop(1, 'rgba(255,210,120,0)'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(89, WATER - 21, 30, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = 'rgba(230,230,235,.5)';
    for (let i = 0; i < 3; i++) { const p = ((t / 2200) + i / 3) % 1; ctx.globalAlpha = 0.5 * (1 - p); ctx.beginPath(); ctx.arc(108 + Math.sin(p * 5) * 5, WATER - 62 - p * 40, 4 + p * 7, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  function drawWater(ctx, t, ph) {
    const g = ctx.createLinearGradient(0, WATER, 0, H);
    if (ph.night) { g.addColorStop(0, '#1c2c54'); g.addColorStop(1, '#0c1430'); }
    else if (ph.dusk) { g.addColorStop(0, '#d89a8a'); g.addColorStop(0.3, '#6a6aa8'); g.addColorStop(1, '#2a3a6a'); }
    else { g.addColorStop(0, '#9fd8ef'); g.addColorStop(0.35, '#4aa8d0'); g.addColorStop(1, '#1f6a9a'); }
    ctx.fillStyle = g; ctx.fillRect(0, WATER, W, H - WATER);
    // Pilotis du chalet : les piliers plongent dans l'eau et s'y effacent ; petit ponton et échelle, remous au pied
    for (const x of [72, 86, 100, 113]) {
      const pg = ctx.createLinearGradient(0, WATER - 6, 0, WATER + 26);
      pg.addColorStop(0, ph.night ? 'rgba(58,40,30,1)' : 'rgba(110,72,40,1)'); pg.addColorStop(0.35, ph.night ? 'rgba(58,40,30,.8)' : 'rgba(110,72,40,.75)'); pg.addColorStop(1, 'rgba(110,72,40,0)');
      ctx.fillStyle = pg; ctx.fillRect(x, WATER - 6, 4, 32);
      ctx.strokeStyle = ph.night ? 'rgba(160,190,255,.25)' : 'rgba(255,255,255,.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(x + 2, WATER + 2 + Math.sin(t / 600 + x) * 0.8, 5 + Math.sin(t / 400 + x) * 1, 1.6, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = ph.night ? '#3a2a20' : '#8a5a32'; ctx.fillRect(66, WATER - 6, 56, 3); // plancher
    ctx.fillRect(116, WATER - 5, 22, 2.5); // ponton
    for (const x of [120, 134]) { const pg = ctx.createLinearGradient(0, WATER - 3, 0, WATER + 16); pg.addColorStop(0, ph.night ? 'rgba(58,40,30,1)' : 'rgba(110,72,40,1)'); pg.addColorStop(1, 'rgba(110,72,40,0)'); ctx.fillStyle = pg; ctx.fillRect(x, WATER - 3, 3, 19); }
    // reflet tremblant du chalet
    ctx.fillStyle = ph.night ? 'rgba(255,210,120,.12)' : 'rgba(138,90,58,.18)';
    for (let i = 0; i < 6; i++) ctx.fillRect(70 + Math.sin(t / 500 + i) * 2, WATER + 6 + i * 4, 46 - i * 3, 2);
    // reflet du soleil ou de la lune
    const rx = ph.night ? 780 : 80 + ph.sun * 800;
    ctx.fillStyle = ph.night ? 'rgba(255,246,208,.35)' : 'rgba(255,250,220,.45)';
    for (let i = 0; i < 9; i++) { const y = WATER + 8 + i * 9; const w = 40 - i * 3 + Math.sin(t / 300 + i) * 8; ctx.fillRect(rx - w / 2 + Math.sin(t / 500 + i * 2) * 6, y, w, 2); }
    // vaguelettes
    ctx.strokeStyle = ph.night ? 'rgba(160,190,255,.18)' : 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1.5;
    for (let r = 0; r < 9; r++) {
      const y = WATER + 14 + r * 26;
      for (let i = 0; i < 7; i++) {
        const x = ((i * 160 + r * 70 + t / (40 + r * 6)) % (W + 120)) - 60;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 12, y - 3, x + 24, y); ctx.stroke();
      }
    }
  }

  function drawPads(ctx, t, ph) {
    for (const [x, y, r] of PADS) {
      const bob = Math.sin(t / 900 + x) * 1.2;
      ctx.fillStyle = ph.night ? '#1f4a2a' : '#4caa4a';
      ctx.beginPath(); ctx.ellipse(x, y + bob, r, r * 0.42, 0, 0.25, Math.PI * 2 - 0.05); ctx.lineTo(x, y + bob); ctx.closePath(); ctx.fill();
      if (r > 20) { ctx.fillStyle = ph.night ? '#c8a0c8' : '#ffb8d8'; ctx.beginPath(); ctx.arc(x - r * 0.3, y + bob - 4, 4, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.strokeStyle = ph.night ? '#2a4a2a' : '#5a8a3a';
    ctx.lineWidth = 3;
    for (const [x, y] of REEDS) {
      const sway = Math.sin(t / 700 + x * 0.1) * 4;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + sway * 0.5, y - 50, x + sway, y - 80); ctx.stroke();
      ctx.fillStyle = ph.night ? '#3a2a1a' : '#7a4a2a'; ctx.beginPath(); ctx.ellipse(x + sway, y - 84, 3.5, 9, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Libellules le jour, lucioles la nuit
  function drawBugs(ctx, t, ph) {
    for (const b of BUGS) {
      const x = (b.x + Math.sin(t / 1300 + b.p) * 60 + W) % W;
      const y = b.y + Math.sin(t / 900 + b.p * 2) * 20;
      if (ph.night) {
        const a = 0.4 + 0.6 * Math.abs(Math.sin(t / 600 + b.p));
        const g = ctx.createRadialGradient(x, y, 0, x, y, 10);
        g.addColorStop(0, `rgba(230,255,140,${a})`); g.addColorStop(1, 'rgba(230,255,140,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
      } else if (b.i % 3 === 0) {
        ctx.fillStyle = '#4ac8d8'; ctx.fillRect(x - 6, y - 1, 12, 2);
        ctx.fillStyle = 'rgba(255,255,255,.6)';
        const flap = Math.sin(t / 30 + b.p) * 3;
        ctx.beginPath(); ctx.ellipse(x - 1, y - 3 - flap * 0.3, 5, 2, -0.4, 0, Math.PI * 2); ctx.ellipse(x + 2, y - 3 - flap * 0.3, 5, 2, 0.4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Un poisson saute au loin de temps en temps (juste pour l'ambiance)
  function drawJumps(ctx, dt) {
    for (const j of S.jumps) {
      j.p += dt / 0.9;
      const x = j.x + j.p * 40;
      const y = j.y - Math.sin(Math.min(1, j.p) * Math.PI) * 26;
      if (j.p < 1) drawFish(ctx, x, y, j.fish, { size: 18, t: 0, facing: 1, alpha: 0.85 });
      if (!j.splashed && j.p >= 1) { j.splashed = true; S.ripples.push({ x, y: j.y, r: 2, life: 1 }); Sound.play('fishPlop', 0.3); }
    }
    S.jumps = S.jumps.filter((j) => j.p < 1.2);
  }

  // ---------- Ce qui passe dans le ciel (comme à la Maison) : banderoles sur le thème de la pêche ----------
  const SKY_ADS = [
    '🎣 Pêchédex : attrapez-les tous (sauf le Kraken)',
    '🐟 Poissonnerie Zer0Loot : fermée, le poissonnier est à la pêche',
    '🦑 Kraken cherche âme sœur. Bras ouverts (les huit).',
    '🪱 Vers de terre bio, élevés en plein air !',
    '🛶 Barques d\'occasion : quelques fuites, beaucoup de charme',
    '🐉 Pyrax vend du poisson grillé (involontairement)',
    '🧊 Givrenoire & Fils : la pêche sur glace, même en été',
    '📏 Ton poisson était PLUS GRAND. On te croit.',
    '🎰 Casino Zer0Loot : ici aussi, on se fait plumer',
    '👻 Ether des brumes décline toute responsabilité',
    '🌊 Pêche du Léviathan interdite sans permis (et sans courage)',
    '😴 La pêche : 90 % d\'attente, 10 % de panique',
    '🐈 Mini Lilith a mangé ta prise ? C\'est normal.',
    '👻 Ether ne mord pas. Il traverse le filet.',
    '🧘 Respire. Le poisson aussi (enfin, par les ouïes).',
  ];
  const SKY_SIGNS = ['Ça mord ?', 'Chut, ça pêche !', 'Pêchédex 100 % !', 'Coucou les poissons !', '!join', 'Bonne pêche !'];

  // ---------- Une famille de canards traverse le lac de temps en temps ----------
  function drawDucks(ctx, t, dt, ph) {
    if (!S.ducks && t > (S.duckAt || 0)) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      S.ducks = { dir, x: dir > 0 ? -60 : W + 60, y: WATER + 26 + Math.random() * 26, n: 2 + Math.floor(Math.random() * 3) };
    }
    const D = S.ducks;
    if (!D) return;
    D.x += D.dir * 16 * dt;
    for (let i = 0; i <= D.n; i++) {
      const big = i === 0;
      const x = D.x - D.dir * i * (big ? 0 : 20) - (i ? D.dir * 14 : 0);
      const y = D.y + Math.sin(t / 380 + i * 1.3) * 1.5;
      const s = big ? 1 : 0.6;
      ctx.save(); ctx.translate(x, y); if (D.dir < 0) ctx.scale(-1, 1); ctx.scale(s, s);
      // sillage
      ctx.strokeStyle = ph.night ? 'rgba(160,190,255,.2)' : 'rgba(255,255,255,.45)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-14, 4); ctx.quadraticCurveTo(-26, 7, -36, 5); ctx.stroke();
      // corps, tête, bec
      ctx.fillStyle = big ? (ph.night ? '#8a7a5a' : '#c8a46a') : (ph.night ? '#b8a860' : '#ffe066');
      ctx.beginPath(); ctx.ellipse(0, 0, 13, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-10, -2); ctx.lineTo(-17, -6); ctx.lineTo(-12, 1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = big ? (ph.night ? '#2a4a3a' : '#2f7a4a') : ctx.fillStyle;
      ctx.beginPath(); ctx.arc(9, -8, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff9a2a'; ctx.beginPath(); ctx.moveTo(13, -8); ctx.lineTo(19, -7); ctx.lineTo(13, -5.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1d1a26'; ctx.beginPath(); ctx.arc(10.5, -9.5, 1.1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if ((D.dir > 0 && D.x > W + 140) || (D.dir < 0 && D.x < -140)) { S.ducks = null; S.duckAt = t + 40000 + Math.random() * 50000; }
  }

  // ---------- Barque, personnage, familier, canne ----------
  function lookOf() {
    const look = {};
    for (const [slot, item] of Object.entries(me.character.equipment || {})) if (item) look[slot] = item.rarity;
    return look;
  }
  const rodTip = (t) => ({ x: BOAT.x + 110 + (S.phase === 'reel' ? Math.sin(t / 60) * 4 - 8 : 0), y: BOAT.y - 112 + (S.phase === 'reel' ? 14 : 0) });

  function drawBoat(ctx, t, ph) {
    const bob = Math.sin(t / 800) * 3;
    const c = me.character;
    const y = BOAT.y + bob;
    // reflet sombre
    ctx.fillStyle = 'rgba(0,20,40,.25)'; ctx.beginPath(); ctx.ellipse(BOAT.x, y + 30, 120, 12, 0, 0, Math.PI * 2); ctx.fill();
    // personnage debout dans la barque (on cache son arme habituelle : il tient la canne)
    // (pieds sous le bord de la coque : on ne voit que le haut du corps, il est vraiment DANS la barque)
    // (le pseudo donne la couleur de peau « automatique », comme partout ailleurs)
    drawFighter(ctx, BOAT.x - 10, y - 27, { name: me.twitchDisplayName || me.username, cls: c.cls, look: lookOf(), app: { ...c.look, weapon: 'vide_weapon' } }, { scale: 1.45, facing: 1, bob: S.phase === 'reel' ? Math.sin(t / 70) * 1.5 : 0 });
    // familier principal à la proue
    const P = c.pets;
    const pet = P && P.list && P.list.find((p) => p.id === P.active);
    if (pet && window.drawPet) {
      const hop = S.petHop > 0 ? -Math.abs(Math.sin(S.petHop * 12)) * 14 : 0;
      drawPet(ctx, BOAT.x + 64, y + 6 + hop, pet.species, { t, size: 0.95, facing: 1 });
    }
    // coque
    const hull = ctx.createLinearGradient(0, y - 4, 0, y + 30);
    hull.addColorStop(0, '#a8703e'); hull.addColorStop(1, '#6a4020');
    ctx.fillStyle = hull;
    ctx.beginPath(); ctx.moveTo(BOAT.x - 118, y - 6); ctx.lineTo(BOAT.x + 118, y - 6); ctx.quadraticCurveTo(BOAT.x + 100, y + 28, BOAT.x + 60, y + 30); ctx.lineTo(BOAT.x - 70, y + 30); ctx.quadraticCurveTo(BOAT.x - 106, y + 26, BOAT.x - 118, y - 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#4a2a10'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,170,.25)'; ctx.lineWidth = 1.5;
    for (const k of [6, 15]) { ctx.beginPath(); ctx.moveTo(BOAT.x - 110 + k * 0.6, y + k - 6); ctx.lineTo(BOAT.x + 108 - k * 0.6, y + k - 6); ctx.stroke(); }
    ctx.fillStyle = '#c8905a'; ctx.fillRect(BOAT.x - 118, y - 9, 236, 5);
    // lanterne sur la poupe (allumée le soir et la nuit)
    ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(BOAT.x - 108, y - 8); ctx.lineTo(BOAT.x - 108, y - 46); ctx.lineTo(BOAT.x - 96, y - 46); ctx.stroke();
    if (ph.night || ph.dusk) { const gl = ctx.createRadialGradient(BOAT.x - 96, y - 38, 2, BOAT.x - 96, y - 38, 50); gl.addColorStop(0, 'rgba(255,210,120,.6)'); gl.addColorStop(1, 'rgba(255,210,120,0)'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(BOAT.x - 96, y - 38, 50, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = ph.night || ph.dusk ? '#ffe9a8' : '#e8e0c8'; ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1.5;
    ctx.fillRect(BOAT.x - 101, y - 44, 10, 12); ctx.strokeRect(BOAT.x - 101, y - 44, 10, 12);
    // canne (dorée avec la canne légendaire)
    const legend = c.look && c.look.weapon === 'canne_legendaire';
    const hand = { x: BOAT.x + 8, y: y - 43 };
    const tip = rodTip(t);
    ctx.strokeStyle = legend ? '#ffd34a' : '#8a5a2a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hand.x - 10, hand.y + 10); ctx.quadraticCurveTo((hand.x + tip.x) / 2, Math.min(hand.y, tip.y) - 10, tip.x, tip.y + bob); ctx.stroke();
    if (legend) { ctx.save(); ctx.shadowColor = '#7fe8ff'; ctx.shadowBlur = 12; ctx.fillStyle = '#7fe8ff'; ctx.beginPath(); ctx.arc(tip.x, tip.y + bob, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    ctx.fillStyle = '#3a3a42'; ctx.beginPath(); ctx.arc(hand.x - 2, hand.y + 4, 5, 0, Math.PI * 2); ctx.fill(); // moulinet
    return { tip: { x: tip.x, y: tip.y + bob } };
  }

  // ---------- Ligne, bouchon, forme dans l'eau ----------
  function castT() { return (performance.now() - S.t0) / 1000; }

  function bobberState(t) {
    const c = S.cast;
    let dip = 0;
    let under = false;
    if (S.phase === 'casting') return { x: BOBBER.x, y: BOBBER.y, dip: 0, air: true };
    if (!c || S.phase === 'idle' || S.phase === 'result' || S.phase === 'escape') return null;
    if (S.phase === 'reel') return { x: BOBBER.x + Math.sin(t / 90) * 6, y: BOBBER.y + 10, dip: 0, under: true };
    const ct = castT();
    for (const n of c.nibbles) if (ct >= n && ct < n + 0.28) dip = Math.sin(((ct - n) / 0.28) * Math.PI) * 6;
    if (ct >= c.sink) { under = true; dip = 14; }
    return { x: BOBBER.x, y: BOBBER.y + Math.sin(t / 500) * 1.5 + dip, dip, under };
  }

  function drawShadow(ctx, t) {
    const c = S.cast;
    if (!c || (S.phase !== 'wait' && S.phase !== 'bite')) return;
    const ct = castT();
    if (ct < c.appear) return;
    const k = Math.min(1, (ct - c.appear) / c.approach);
    const size = { petit: 34, moyen: 52, grand: 80, enorme: 120 }[c.big] || 50;
    const sx = BOBBER.x + 260 - k * 250 + Math.sin(t / 300) * (k >= 1 ? 8 : 3);
    const sy = BOBBER.y + 34 + Math.sin(t / 700) * 6;
    const alpha = Math.min(0.4, (ct - c.appear) * 0.5);
    if (c.shape === 'tresor') drawTreasure(ctx, sx, sy, size, { shadow: true, alpha });
    else drawFish(ctx, sx, sy, { shape: c.shape, id: '', color: '#000', accent: '#000', pattern: 'uni' }, { size, t, shadow: true, facing: -1, alpha });
  }

  function drawLine(ctx, t, tip, b) {
    if (!b) return;
    let bx = b.x;
    let by = b.y;
    if (S.phase === 'casting') {
      const p = Math.min(1, castT() / 0.6);
      bx = tip.x + (BOBBER.x - tip.x) * p;
      by = tip.y + (BOBBER.y - tip.y) * p - Math.sin(p * Math.PI) * 80;
    }
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tip.x, tip.y);
    const sag = S.phase === 'reel' ? 0 : 40;
    ctx.quadraticCurveTo((tip.x + bx) / 2, Math.max(tip.y, by) + sag, bx, by - 6); ctx.stroke();
    if (b.under && S.phase !== 'casting') {
      // bouchon sous l'eau : remous
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2;
      const r = 10 + (t / 40) % 14;
      ctx.beginPath(); ctx.ellipse(BOBBER.x, BOBBER.y + 2, r, r * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
      if (S.phase === 'bite') {
        ctx.font = '900 34px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd34a'; ctx.strokeStyle = '#3a2a10'; ctx.lineWidth = 5;
        const y = BOBBER.y - 40 + Math.sin(t / 80) * 3;
        ctx.strokeText('!', BOBBER.x, y); ctx.fillText('!', BOBBER.x, y);
      }
      return;
    }
    // bouchon rouge et blanc
    ctx.save(); ctx.translate(bx, by);
    ctx.fillStyle = '#e8343a'; ctx.beginPath(); ctx.arc(0, -4, 7, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, -4, 7, 0, Math.PI); ctx.fill();
    ctx.strokeStyle = '#3a1a1a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, -4, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#3a1a1a'; ctx.fillRect(-1, -16, 2, 6);
    ctx.restore();
  }

  // ---------- Remontée : la barre ----------
  const BAR = { x: 812, y: 34, w: 58, h: 392 };
  function newReel(r) {
    return { ...r, pos: 0, vel: 0, fy: 0.25, ft: 0.4, progress: r.start, dartT: 0, t: 0, done: false };
  }
  // Nage du poisson dans la barre (Rules.FISHING.swim) : il change de cap `changes` fois par seconde, nage à `vmax`,
  // et certains changements sont des départs soudains (vitesse `dart` pendant 0,35 s), selon son caractère et sa rareté.
  function moveFish(R, dt) {
    const M = F.swim[R.move] || F.swim.mixte;
    if (Math.random() < dt * R.changes * M.c) {
      const target = M.rel ? R.fy + (Math.random() - 0.5) * M.rel : M.lo + Math.random() * (M.hi - M.lo);
      if (Math.random() < M.dart) R.dartT = 0.35;
      R.ft = Math.max(0.02, Math.min(0.98, target));
    }
    const v = R.dartT > 0 ? R.dart : R.vmax * M.v;
    R.dartT = Math.max(0, R.dartT - dt);
    const d = R.ft - R.fy;
    R.fy += Math.sign(d) * Math.min(Math.abs(d), v * dt);
    R.fy = Math.max(0.02, Math.min(0.98, R.fy));
  }
  function stepReel(dt) {
    const R = S.reel;
    if (!R || R.done) return;
    R.t += dt;
    // Zone verte : poussée vers le haut quand on tient le clic, gravité sinon ; rebond amorti en bas
    R.vel += (S.holding ? 3.1 : -2.5) * dt;
    R.vel = Math.max(-1.6, Math.min(1.6, R.vel));
    R.pos += R.vel * dt;
    const top = 1 - R.zone;
    if (R.pos < 0) { R.pos = 0; R.vel = -R.vel * 0.35; if (Math.abs(R.vel) < 0.05) R.vel = 0; }
    if (R.pos > top) { R.pos = top; R.vel = Math.min(0, R.vel) * 0.2; }
    moveFish(R, dt);
    const inside = R.fy >= R.pos && R.fy <= R.pos + R.zone;
    R.inside = inside;
    R.progress += (inside ? 1 : -R.drain) * dt / R.fill;
    if (inside && Math.random() < dt * 9) Sound.play('fishReel');
    if (R.progress >= 1) { R.progress = 1; R.done = true; land(true); }
    else if (R.progress <= 0) { R.progress = 0; R.done = true; land(false); }
  }
  function drawReel(ctx, t) {
    const R = S.reel;
    if (!R) return;
    const { x, y, w, h } = BAR;
    // cadre de bambou
    ctx.fillStyle = '#c8954a'; ctx.fillRect(x - 8, y - 8, w + 16, h + 16);
    ctx.strokeStyle = '#7a5020'; ctx.lineWidth = 2;
    for (let k = 1; k < 8; k++) { ctx.beginPath(); ctx.moveTo(x - 8, y + (h / 8) * k); ctx.lineTo(x + w + 8, y + (h / 8) * k); ctx.stroke(); }
    ctx.strokeRect(x - 8, y - 8, w + 16, h + 16);
    // eau
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#bfe4ff'); g.addColorStop(1, '#2f6ab8');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    // herbes au fond
    ctx.strokeStyle = '#4a9a3a'; ctx.lineWidth = 2;
    for (let k = 0; k < 4; k++) { const sx = x + 10 + k * 13; ctx.beginPath(); ctx.moveTo(sx, y + h); ctx.quadraticCurveTo(sx + Math.sin(t / 400 + k) * 4, y + h - 12, sx + 2, y + h - 22); ctx.stroke(); }
    // zone verte
    const zy = y + h - (R.pos + R.zone) * h;
    const zh = R.zone * h;
    ctx.fillStyle = R.inside ? 'rgba(120, 255, 90, .75)' : 'rgba(90, 210, 70, .55)';
    ctx.fillRect(x + 3, zy, w - 6, zh);
    ctx.strokeStyle = '#2a7a1a'; ctx.lineWidth = 2; ctx.strokeRect(x + 3, zy, w - 6, zh);
    // le poisson (ou le coffre)
    const fy = y + h - R.fy * h;
    if (S.cast && S.cast.shape === 'tresor') drawTreasure(ctx, x + w / 2, fy + 6, 30, { t });
    else drawFish(ctx, x + w / 2, fy, { shape: S.cast ? S.cast.shape : 'poisson', id: '', color: '#3aa8e8', accent: '#bfe8ff', pattern: 'uni' }, { size: 34, t, facing: Math.sin(t / 400) > 0 ? 1 : -1 });
    // jauge de prise
    const px = x + w + 14;
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(px, y - 8, 16, h + 16);
    const pc = R.progress;
    ctx.fillStyle = pc > 0.66 ? '#3ddc5a' : pc > 0.33 ? '#ffc21a' : '#ff4d6d';
    ctx.fillRect(px + 3, y + h - pc * h, 10, pc * h);
    // aide
    ctx.font = '800 13px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 4;
    const tip = 'Maintiens le clic (ou Espace)';
    ctx.strokeText(tip, x + w / 2 - 60, y + h + 26); ctx.fillText(tip, x + w / 2 - 60, y + h + 26);
  }

  // ---------- Résultat ----------
  function drawResult(ctx, t) {
    const r = S.result;
    if (!r) return;
    const age = (performance.now() - r.at) / 1000;
    const pop = Math.min(1, age / 0.25);
    ctx.save();
    ctx.translate(W / 2 + 120, 150);
    ctx.scale(0.8 + pop * 0.2, 0.8 + pop * 0.2);
    ctx.globalAlpha = pop;
    const col = r.kind === 'fish' ? RCOL[Rules.FISH[r.id].rarity] : '#ffd34a';
    ctx.fillStyle = 'rgba(20, 14, 34, .86)'; ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(-190, -105, 380, 210, 18); ctx.fill(); ctx.stroke();
    // halo
    const gl = ctx.createRadialGradient(0, -20, 10, 0, -20, 110);
    gl.addColorStop(0, col + '55'); gl.addColorStop(1, col + '00');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, -20, 110, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'center';
    if (r.kind === 'fish') {
      const f = Rules.FISH[r.id];
      drawFish(ctx, 0, -32, f, { size: 120, t, facing: 1 });
      ctx.font = '900 22px system-ui'; ctx.fillStyle = col; ctx.fillText(f.name, 0, 46);
      ctx.font = '700 14px system-ui'; ctx.fillStyle = '#e8e0ff';
      ctx.fillText(`${RLAB[f.rarity]} · ${cm(r.size)}${f.when ? (f.when === 'nuit' ? ' · 🌙' : ' · ☀️') : ''}`, 0, 68);
      const tag = r.isNew ? '🆕 Nouvelle espèce au Pêchédex !' : r.record ? `🏆 Nouveau record ! (${cm(r.best)})` : `Déjà pêché ×${r.n} · record ${cm(r.best)}`;
      ctx.font = '800 14px system-ui'; ctx.fillStyle = r.isNew || r.record ? '#ffd34a' : '#a8a0c8'; ctx.fillText(tag, 0, 92);
    } else {
      drawTreasure(ctx, 0, -20, 110, { t });
      ctx.font = '900 22px system-ui'; ctx.fillStyle = '#ffd34a'; ctx.fillText('Un trésor !', 0, 52);
      ctx.font = '800 16px system-ui'; ctx.fillStyle = '#fff'; ctx.fillText(`${r.lot.icon} ${treasureText(r.lot)}`, 0, 80);
    }
    ctx.restore();
  }
  function treasureText(lot) {
    if (lot.chests) return `+${lot.chests} coffres`;
    if (lot.gold) return `+${fmt(lot.gold)} golds${lot.replaced ? ' (tu as déjà la canne)' : ''}`;
    if (lot.emeralds) return `+${fmt(lot.emeralds)} émeraudes`;
    if (lot.keys) return `+${lot.keys} Clé de boss`;
    if (lot.cosmetic) return 'Canne à pêche légendaire !';
    return lot.label;
  }

  function drawMessage(ctx, t) {
    const m = S.msg;
    if (!m) return;
    const age = (performance.now() - m.at) / 1000;
    if (age > m.life) { S.msg = null; return; }
    ctx.save();
    ctx.globalAlpha = Math.min(1, (m.life - age) / 0.4, age / 0.15);
    ctx.font = '900 26px system-ui'; ctx.textAlign = 'center';
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.fillStyle = m.color || '#fff';
    const y = 110 - Math.min(10, age * 20);
    ctx.strokeText(m.text, W / 2 + 120, y); ctx.fillText(m.text, W / 2 + 120, y);
    if (m.sub) { ctx.font = '700 15px system-ui'; ctx.lineWidth = 4; ctx.strokeText(m.sub, W / 2 + 120, y + 26); ctx.fillStyle = '#fff'; ctx.fillText(m.sub, W / 2 + 120, y + 26); }
    ctx.restore();
  }
  const say = (text, sub, color, life = 2.2) => { S.msg = { text, sub, color, life, at: performance.now() }; };

  function drawHint(ctx, t) {
    let text = null;
    if (S.phase === 'idle') text = '🎣 Clique (ou Espace) pour lancer ta ligne';
    else if (S.phase === 'wait') text = S.cast && castT() >= S.cast.appear ? 'Quelque chose approche… attends que le bouchon coule !' : 'Le bouchon flotte… tout est calme.';
    else if (S.phase === 'bite') text = 'IL A MORDU ! Clique vite !';
    else if (S.phase === 'result' || S.phase === 'escape') text = S.auto ? 'La ligne repart toute seule…' : 'Clique pour relancer';
    if (!text) return;
    ctx.font = '800 15px system-ui'; ctx.textAlign = 'center';
    const w = ctx.measureText(text).width + 28;
    ctx.fillStyle = S.phase === 'bite' ? 'rgba(255, 200, 40, .92)' : 'rgba(15, 10, 30, .62)';
    ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, H - 40, w, 28, 14); ctx.fill();
    ctx.fillStyle = S.phase === 'bite' ? '#2a1a00' : '#fff';
    ctx.fillText(text, W / 2, H - 21);
  }

  // ---------- Boucle ----------
  function frame(now) {
    if (!S.active) return;
    S.raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (S.last || now)) / 1000);
    S.last = now;
    const ctx = S.ctx;
    const ph = skyPhase();
    const t = now;
    tickPhase(now);
    stepReel(dt);
    if (now > S.jumpAt) { S.jumpAt = now + 9000 + Math.random() * 16000; const ids = Rules.FISH_IDS; S.jumps.push({ x: 420 + Math.random() * 380, y: WATER + 30 + Math.random() * 40, p: 0, fish: Rules.FISH[ids[Math.floor(Math.random() * 30)]] }); }
    if (Math.random() < dt * 0.12) Sound.play(ph.night ? 'cricket' : 'birdChirp');
    S.petHop = Math.max(0, S.petHop - dt);
    drawSky(ctx, t, ph);
    if (!S.sky && window.HouseLife && HouseLife.makeSky) S.sky = HouseLife.makeSky({ ads: SKY_ADS, signs: SKY_SIGNS, scale: 0.34, gap: [6000, 14000] });
    if (S.sky) S.sky(ctx, W, H, t, ph);
    drawWater(ctx, t, ph);
    drawDucks(ctx, t, dt, ph);
    drawJumps(ctx, dt);
    drawShadow(ctx, t);
    // ronds dans l'eau
    for (const r of S.ripples) { r.r += dt * 30; r.life -= dt * 0.8; ctx.strokeStyle = `rgba(255,255,255,${Math.max(0, r.life) * 0.7})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r, r.r * 0.35, 0, 0, Math.PI * 2); ctx.stroke(); }
    S.ripples = S.ripples.filter((r) => r.life > 0);
    drawPads(ctx, t, ph);
    const boat = drawBoat(ctx, t, ph);
    drawLine(ctx, t, boat.tip, bobberState(t));
    for (const s of S.splashes) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 400 * dt; s.life -= dt; ctx.fillStyle = `rgba(220,240,255,${Math.max(0, s.life)})`; ctx.fillRect(s.x, s.y, 3, 3); }
    S.splashes = S.splashes.filter((s) => s.life > 0);
    for (const h of S.hearts) { h.y -= 30 * dt; h.life -= dt; ctx.globalAlpha = Math.max(0, h.life); ctx.font = '18px system-ui'; ctx.fillText(h.e, h.x, h.y); ctx.globalAlpha = 1; }
    S.hearts = S.hearts.filter((h) => h.life > 0);
    drawBugs(ctx, t, ph);
    if (ph.night) { ctx.fillStyle = 'rgba(10, 14, 50, .18)'; ctx.fillRect(0, 0, W, H); }
    drawReel(ctx, t);
    drawResult(ctx, t);
    drawMessage(ctx, t);
    drawHint(ctx, t);
  }

  function splash(x, y, n = 14) {
    for (let i = 0; i < n; i++) S.splashes.push({ x, y, vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 120, life: 0.7 });
    S.ripples.push({ x, y: y + 4, r: 4, life: 1 });
  }

  // Étapes pilotées par le temps du lancer (touches, bouchon qui coule, fenêtre ratée)
  function tickPhase(now) {
    const c = S.cast;
    if (S.phase === 'casting' && castT() >= 0.6) { S.phase = 'wait'; Sound.play('fishPlop'); splash(BOBBER.x, BOBBER.y, 6); }
    if ((S.phase === 'wait' || S.phase === 'bite') && c) {
      const ct = castT();
      for (const n of c.nibbles) if (!c.done[n] && ct >= n) { c.done[n] = true; Sound.play('fishNibble'); S.ripples.push({ x: BOBBER.x, y: BOBBER.y + 2, r: 4, life: 0.8 }); }
      if (S.phase === 'wait' && ct >= c.sink) { S.phase = 'bite'; Sound.play('fishSink'); splash(BOBBER.x, BOBBER.y); }
      if (S.phase === 'bite' && ct > c.sink + c.window + 0.25 && !S.busy) {
        S.phase = 'escape';
        say('Trop tard…', 'Il a filé avec l\'appât.', '#a8c8ff');
        Sound.play('fishEscape');
        api('/api/fishing/stop', {}).catch(() => {});
        S.nextAt = now + 1800;
      }
    }
    if ((S.phase === 'result' || S.phase === 'escape') && S.auto && S.nextAt && now >= S.nextAt) { S.nextAt = 0; castLine(); }
  }

  // ---------- Actions ----------
  async function castLine() {
    if (S.busy) return;
    S.busy = true;
    S.result = null;
    S.reel = null;
    try {
      const r = await api('/api/fishing/cast', {});
      S.cast = { ...r, done: {} };
      S.t0 = performance.now();
      S.phase = 'casting';
      Sound.play('fishCast');
    } catch (err) { toast('⚠️ ' + err.message); S.phase = 'idle'; } finally { S.busy = false; }
  }

  async function hook() {
    if (S.busy || !S.cast) return;
    const early = S.phase === 'wait';
    S.busy = true;
    try {
      const r = await api('/api/fishing/hook', { id: S.cast.id });
      if (r.escaped) {
        S.phase = 'escape';
        S.nextAt = performance.now() + 1800;
        Sound.play('fishEscape');
        if (r.reason === 'tot' || early) say('Trop tôt !', 'Attends que le bouchon coule vraiment.', '#ffb0b0');
        else say('Trop tard…', 'Il a filé avec l\'appât.', '#a8c8ff');
        return;
      }
      S.phase = 'reel';
      S.reel = newReel(r.reel);
      S.holding = false;
      Sound.play('fishHook');
      splash(BOBBER.x, BOBBER.y, 18);
    } catch (err) { toast('⚠️ ' + err.message); S.phase = 'idle'; } finally { S.busy = false; }
  }

  async function land(success) {
    S.busy = true;
    try {
      const r = await api('/api/fishing/land', { id: S.cast.id, success });
      S.reel = null;
      S.holding = false;
      if (!r.caught) {
        S.phase = 'escape';
        say('Il s\'est échappé !', 'La ligne s\'est détendue…', '#a8c8ff');
        Sound.play('fishEscape');
      } else {
        S.phase = 'result';
        S.result = { ...r, at: performance.now() };
        S.petHop = 0.8;
        for (let i = 0; i < 5; i++) S.hearts.push({ x: BOAT.x + 50 + Math.random() * 40, y: BOAT.y - 20, e: ['❤️', '✨', '⭐'][i % 3], life: 1.4 + Math.random() * 0.5 });
        if (r.kind === 'treasure') {
          Sound.play('fishTreasure');
          toast(`🎁 Trésor : ${r.lot.icon} ${treasureText(r.lot)}`, 6000);
        } else {
          Sound.play('fishCatch', Rules.FISH[r.id].rarity);
          S.session.unshift({ id: r.id, size: r.size, isNew: r.isNew, record: r.record });
          S.session = S.session.slice(0, 8);
        }
        refresh().then(renderSide).catch(() => {});
      }
      S.nextAt = performance.now() + (r.caught ? 3200 : 1800);
    } catch (err) {
      toast('⚠️ ' + err.message);
      S.phase = 'idle';
      S.reel = null;
    } finally { S.busy = false; renderSide(); }
  }

  // Un seul bouton pour tout (clic gauche ou Espace) : lancer, ferrer, tenir la zone verte, relancer
  function press() {
    if (S.phase === 'idle' || S.phase === 'result' || S.phase === 'escape') { castLine(); return; }
    if (S.phase === 'wait' || S.phase === 'bite') { hook(); return; }
    if (S.phase === 'reel') S.holding = true;
  }
  function release() { S.holding = false; }

  // ---------- Panneau latéral et Pêchédex ----------
  function renderSide() {
    if (!me || !$('fish-side')) return;
    const dex = (me.character.fishing && me.character.fishing.dex) || {};
    const n = Object.keys(dex).length;
    const total = Rules.FISH_IDS.length;
    const k = me.character.counters || {};
    const time = Rules.fishTime(Date.now());
    $('fish-side').innerHTML = `
      <div class="fish-progress"><div class="fish-progress-top"><b>📖 Pêchédex</b><span>${n} / ${total}</span></div>
        <div class="fish-bar"><span style="width:${(n / total) * 100}%"></span></div>
        <button class="gold" id="fish-dex-btn">📖 Ouvrir le Pêchédex</button></div>
      <div class="fish-stats">
        <div><span class="muted">Poissons pêchés</span><b>${fmt(k.fishCaught || 0)}</b></div>
        <div><span class="muted">Trésors</span><b>${fmt(k.fishTreasures || 0)}</b></div>
        <div><span class="muted">Légendaires</span><b>${fmt(k.fishLegend || 0)}</b></div>
      </div>
      <div class="fish-time">${time === 'nuit' ? '🌙 C\'est la nuit (heure de Paris) : les poissons de nuit mordent.' : '☀️ C\'est le jour (heure de Paris) : les poissons de jour mordent.'}</div>
      <label class="fish-auto"><input type="checkbox" id="fish-auto" ${S.auto ? 'checked' : ''}> Relancer la ligne toute seule</label>
      <div class="fish-session"><b>🐟 Dernières prises</b>${S.session.length ? S.session.map((s) => { const f = Rules.FISH[s.id]; return `<div><span style="color:${RCOL[f.rarity]}">${esc(f.name)}</span> <span class="muted">${cm(s.size)}</span>${s.isNew ? ' <b class="fish-new">Nouveau</b>' : s.record ? ' <b class="fish-new">Record</b>' : ''}</div>`; }).join('') : '<div class="muted">Rien encore… patience !</div>'}</div>
      <div class="fish-reward muted">${n >= total ? '🎉 Pêchédex complet : la <b>panoplie du pêcheur</b> t\'attend à la boutique !' : `Complète le Pêchédex pour débloquer la <b>panoplie du pêcheur</b> à la boutique.`}</div>`;
    $('fish-dex-btn').onclick = openDex;
    $('fish-auto').onchange = (e) => { S.auto = e.target.checked; try { localStorage.setItem('zl_fish_auto', S.auto ? '1' : '0'); } catch (er) { /* ignore */ } if (S.auto && (S.phase === 'result' || S.phase === 'escape')) S.nextAt = performance.now() + 800; };
  }

  let dexFilter = 'all';
  function openDex() {
    let el = $('fish-dex');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fish-dex';
      el.className = 'fish-dex';
      document.body.appendChild(el);
      el.addEventListener('mousedown', (e) => { if (e.target === el) el.classList.remove('open'); });
    }
    renderDex();
    el.classList.add('open');
  }
  function renderDex() {
    const el = $('fish-dex');
    const dex = (me.character.fishing && me.character.fishing.dex) || {};
    const n = Object.keys(dex).length;
    const total = Rules.FISH_IDS.length;
    const list = Object.values(Rules.FISH).filter((f) => dexFilter === 'all' || (dexFilter === 'missing' ? !dex[f.id] : f.rarity === dexFilter));
    const count = (r) => Object.values(Rules.FISH).filter((f) => f.rarity === r && dex[f.id]).length + ' / ' + Object.values(Rules.FISH).filter((f) => f.rarity === r).length;
    el.innerHTML = `<div class="fish-book">
      <div class="fish-book-head"><h2>📖 Pêchédex</h2><span class="fish-book-count">${n} / ${total} espèces</span><button class="secondary small" data-close>✕</button></div>
      <div class="fish-bar"><span style="width:${(n / total) * 100}%"></span></div>
      <div class="fish-filters">
        <button data-f="all" class="${dexFilter === 'all' ? 'active' : ''}">Toutes</button>
        <button data-f="missing" class="${dexFilter === 'missing' ? 'active' : ''}">Manquantes</button>
        ${Object.keys(F.rarities).map((r) => `<button data-f="${r}" class="${dexFilter === r ? 'active' : ''}" style="--rc:${RCOL[r]}">${RLAB[r]} <small>${count(r)}</small></button>`).join('')}
      </div>
      <div class="fish-grid">${list.map((f) => {
    const e = dex[f.id];
    const when = f.when === 'nuit' ? '🌙 Nuit' : f.when === 'jour' ? '☀️ Jour' : '🕒 Toujours';
    return `<div class="fish-card ${e ? '' : 'unknown'}" style="--rc:${RCOL[f.rarity]}">
          <canvas width="120" height="80" data-fish="${f.id}"></canvas>
          <b>${e ? esc(f.name) : '???'}</b>
          <small style="color:${f.rarity === 'commun' ? '#6a6e78' : RCOL[f.rarity]};font-weight:800">${RLAB[f.rarity]}</small>
          <small class="muted">${when}${e ? ` · ${F.moves[f.move].split(' :')[0]}` : ''}</small>
          ${e ? `<small>🏆 ${cm(e.best)} · ×${e.n}</small>` : `<small class="muted">${cm(f.min)} – ${cm(f.max)}</small>`}
        </div>`;
  }).join('')}</div>
      <p class="muted fish-book-foot">Les espèces manquantes apparaissent en ombre noire. Certaines ne mordent que le jour ☀️ ou la nuit 🌙 (heure de Paris).
        Compléter le Pêchédex débloque la panoplie du pêcheur à la boutique.</p></div>`;
    el.querySelector('[data-close]').onclick = () => el.classList.remove('open');
    el.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { dexFilter = b.dataset.f; renderDex(); }; });
    el.querySelectorAll('canvas[data-fish]').forEach((cv) => {
      const f = Rules.FISH[cv.dataset.fish];
      const ctx = cv.getContext('2d');
      drawFish(ctx, 60, 42, f, { size: f.shape === 'anguille' || f.shape === 'long' ? 84 : 70, t: 600, shadow: !dex[f.id] });
    });
  }

  // ---------- Entrée / sortie ----------
  function setup() {
    if (S.canvas) return;
    S.canvas = $('fish-canvas');
    S.ctx = S.canvas.getContext('2d');
    S.canvas.addEventListener('mousedown', (e) => { if (e.button === 0) { e.preventDefault(); press(); } });
    window.addEventListener('mouseup', release);
    S.canvas.addEventListener('touchstart', (e) => { e.preventDefault(); press(); }, { passive: false });
    S.canvas.addEventListener('touchend', release);
    document.addEventListener('keydown', (e) => {
      if (!S.active || e.code !== 'Space' || e.repeat || /input|textarea/i.test(e.target.tagName)) return;
      e.preventDefault();
      press();
    });
    document.addEventListener('keyup', (e) => { if (e.code === 'Space') release(); });
    S.jumpAt = performance.now() + 4000;
  }

  function enter() {
    if (!me) return;
    setup();
    renderSide();
    if (S.active) return;
    S.active = true;
    S.last = 0;
    S.phase = 'idle';
    S.duckAt = performance.now() + 12000;
    S.raf = requestAnimationFrame(frame);
    // Musique chill : les 4 morceaux lo-fi s'enchaînent en boucle
    Sound.music.stop(0.2);
    setTimeout(() => { if (S.active) Sound.music.start(0, 'peche'); }, 250);
  }

  function leave() {
    if (!S.active) return;
    S.active = false;
    cancelAnimationFrame(S.raf);
    if (Sound.music.state && /peche/.test(Sound.music.state.src || '')) Sound.music.stop();
    if (S.phase !== 'idle') api('/api/fishing/stop', {}).catch(() => {});
    S.phase = 'idle';
    S.cast = null;
    S.reel = null;
    S.result = null;
    const el = $('fish-dex');
    if (el) el.classList.remove('open');
  }

  // peek() : état en lecture seule (étape, barre de remontée), pour les tests automatiques du navigateur
  const peek = () => ({ phase: S.phase, sink: S.cast && S.cast.sink, t: S.cast ? castT() : 0, reel: S.reel && { pos: S.reel.pos, zone: S.reel.zone, fy: S.reel.fy, progress: S.reel.progress } });
  window.Fishing = { enter, leave, renderSide, openDex, peek, get active() { return S.active; } };
})();
