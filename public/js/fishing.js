/*
 * Onglet Pêche : une barque sur un lac, son personnage et son familier, une ambiance tranquille (ciel selon l'heure
 * réelle, nuages, libellules ou lucioles, nénuphars, roseaux). Un seul bouton (clic ou Espace) pour tout :
 *  - lancer la ligne ;
 *  - une forme approche du bouchon, le tapote… et quand il COULE, cliquer pour ferrer (trop tôt ou trop tard : raté) ;
 *  - remontée : maintenir le clic fait monter la zone verte (sinon elle retombe, elle a de l'élan) ; la garder sur le
 *    poisson remplit la jauge, sinon elle se vide ; pleine = prise, vide = il s'échappe.
 * Le serveur décide de ce qui mord et vérifie le ferrage et la durée de la remontée (/api/fishing/*).
 * Le Pêchédex (100 espèces, silhouettes noires pour celles qui manquent) s'ouvre à tout moment.
 * Étang partagé (serveur : server/pond.js) : les autres pêcheurs du même étang apparaissent dans leur barque autour de la
 * sienne (skins, familier, canne), arrivent et repartent en ramant, et on voit leur ligne, leurs remontées et leurs prises.
 * Le tchat (salon Pêche par défaut) est sous l'étang ; un message du salon Pêche s'affiche aussi en bulle au-dessus de la
 * barque de son auteur, et les réactions rapides (👋 🎉…) flottent au-dessus de la sienne.
 * Utilise les globales : me, api, toast, esc, refresh, skyPhase, Rules, Sound, drawFighter, drawPet, drawFish, drawTreasure,
 * Chat, Emotes.
 */
(function () {
  const F = Rules.FISHING;
  const W = 960;
  const H = 520;
  const WATER = 236; // ligne d'horizon de l'eau
  // Sa barque au premier plan (vue un peu dézoomée pour laisser la place aux autres) ; échelle de la barque
  const BOAT = { x: 290, y: 410, s: 0.85 };
  const BOBBER = { x: 590, y: 450 };
  // Places des autres pêcheurs (les 7 autres places de l'étang), du plus proche au plus lointain : plus c'est loin, plus
  // c'est petit ; `dir` : sens de la barque (vers le milieu du lac).
  const SPOTS = [
    { x: 800, y: 386, s: 0.6, dir: -1 },
    { x: 118, y: 318, s: 0.5, dir: 1 },
    { x: 585, y: 322, s: 0.5, dir: -1 },
    { x: 365, y: 274, s: 0.4, dir: 1 },
    { x: 720, y: 280, s: 0.4, dir: -1 },
    { x: 905, y: 266, s: 0.36, dir: -1 },
    { x: 198, y: 266, s: 0.36, dir: 1 },
  ];
  const $ = (id) => document.getElementById(id);
  const RCOL = { commun: '#a8acb4', peu_commun: '#3ddc5a', rare: '#3b8bff', epique: '#b14dff', legendaire: '#ff9a1f' };
  const RLAB = Object.fromEntries(Object.entries(Rules.RARITY_INFO).map(([k, v]) => [k, v.label]));
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const cm = (x) => (x >= 100 ? `${String(Math.round(x) / 100).replace('.', ',')} m` : `${String(Math.round(x * 10) / 10).replace('.', ',')} cm`);

  const S = {
    active: false, canvas: null, ctx: null, raf: 0, last: 0,
    phase: 'idle', // idle | casting | wait | bite | reel | result | escape
    cast: null, t0: 0, busy: false, holding: false,
    reel: null, reelAcc: 0, reelHold: false, toggles: [], calmUntil: 0, result: null, msg: null, auto: false, nextAt: 0,
    ripples: [], splashes: [], hearts: [], jumps: [], jumpAt: 0, petHop: 0,
    session: [], // dernières prises de la séance
    // Étang partagé : liste reçue du serveur, barques des autres (uid → barque), barques qui repartent, sa bulle, ses réactions
    pond: null, boats: new Map(), leaving: [], mine: { bubble: null, floats: [] }, socket: null, chat: null, contest: null, schoolEnd: 0,
    // Météo (Rules.fishWeather, la même pour tous), houle, gouttes / flocons, éclairs ; aperçu de la barque (boutique)
    weather: 'normal', waveAmp: 1, drops: [], flash: 0, nextFlash: 0, previewBoat: null, lockUntil: 0, shopTab: 'baits',
  };
  try { S.auto = localStorage.getItem('zl_fish_auto') === '1'; } catch (e) { /* ignore */ }

  // ---------- Décor ----------
  const CLOUDS = Array.from({ length: 6 }, (_, i) => ({ x: i * 190 + Math.random() * 80, y: 30 + Math.random() * 90, s: 0.6 + Math.random() * 0.7 }));
  const PADS = [[60, 478, 24], [140, 505, 18], [455, 500, 16], [690, 492, 22], [930, 470, 26], [470, 300, 14]];
  const REEDS = [...Array.from({ length: 9 }, (_, i) => [10 + i * 12, 520]), ...Array.from({ length: 7 }, (_, i) => [888 + i * 11, 520])];
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
  // Bout de la canne, dans le repère de la barque (origine : milieu du bord, qui tangue)
  const tipLocal = (t, reeling) => ({ x: 110 + (reeling ? Math.sin(t / 60) * 4 - 8 : 0), y: -112 + (reeling ? 14 : 0) });

  // Une barque, n'importe laquelle : B = { x, y, s (échelle), dir (1 : vers la droite), phase (tangage), fighter
  // ({ name, cls, look, app }), pet (espèce), legend (canne légendaire), reeling, hop }. Renvoie le bout de la canne et
  // le haut de la tête (repère de l'écran).
  function drawBoatAt(ctx, t, ph, B) {
    const bob = Math.sin(t / (S.weather === 'tempete' ? 520 : 800) + (B.phase || 0)) * 3 * S.waveAmp;
    const by = B.y + bob * B.s;
    const eq = { ...Rules.BOAT_DEFAULT, ...(B.boat || {}) };
    const opt = (part) => Rules.BOAT_PARTS[part].options[eq[part]] || Object.values(Rules.BOAT_PARTS[part].options)[0];
    ctx.save();
    ctx.translate(B.x, by);
    ctx.scale(B.s * B.dir, B.s);
    if (S.weather === 'tempete') ctx.rotate(Math.sin(t / 700 + (B.phase || 0)) * 0.04);
    // reflet sombre
    ctx.fillStyle = 'rgba(0,20,40,.25)'; ctx.beginPath(); ctx.ellipse(0, 30, 120, 12, 0, 0, Math.PI * 2); ctx.fill();
    // fanion au mât (derrière le personnage)
    drawFlag(ctx, t, opt('fanion'));
    // personnage debout dans la barque (on cache son arme habituelle : il tient la canne)
    // (pieds sous le bord de la coque : on ne voit que le haut du corps, il est vraiment DANS la barque)
    // (le pseudo donne la couleur de peau « automatique », comme partout ailleurs)
    drawFighter(ctx, -10, -27, { ...B.fighter, app: { ...(B.fighter.app || {}), weapon: 'vide_weapon' } }, { scale: 1.45, facing: 1, bob: B.reeling ? Math.sin(t / 70) * 1.5 : 0 });
    // familier principal à la proue
    if (B.pet && window.drawPet) {
      const hop = B.hop > 0 ? -Math.abs(Math.sin(B.hop * 12)) * 14 : 0;
      drawPet(ctx, 64, 6 + hop, B.pet, { t, size: 0.95, facing: 1 });
    }
    drawHull(ctx, t, opt('coque'));
    drawAnchor(ctx, t, opt('ancre'));
    drawFigurehead(ctx, t, eq.proue);
    drawLantern(ctx, t, ph, opt('lanterne'));
    // canne (dorée avec la canne légendaire)
    const hand = { x: 8, y: -43 };
    const tip = tipLocal(t, B.reeling);
    ctx.strokeStyle = B.legend ? '#ffd34a' : '#8a5a2a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hand.x - 10, hand.y + 10); ctx.quadraticCurveTo((hand.x + tip.x) / 2, Math.min(hand.y, tip.y) - 10, tip.x, tip.y); ctx.stroke();
    if (B.legend) { ctx.save(); ctx.shadowColor = '#7fe8ff'; ctx.shadowBlur = 12; ctx.fillStyle = '#7fe8ff'; ctx.beginPath(); ctx.arc(tip.x, tip.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    ctx.fillStyle = '#3a3a42'; ctx.beginPath(); ctx.arc(hand.x - 2, hand.y + 4, 5, 0, Math.PI * 2); ctx.fill(); // moulinet
    ctx.restore();
    return {
      tip: { x: B.x + B.dir * B.s * tip.x, y: by + B.s * tip.y },
      head: { x: B.x - B.dir * B.s * 10, y: by - B.s * 132 },
      y: by,
    };
  }

  // ---------- Pièces de la barque (Rules.BOAT_PARTS), dans le repère de la barque ----------
  function hullPath(ctx) {
    ctx.beginPath(); ctx.moveTo(-118, -6); ctx.lineTo(118, -6); ctx.quadraticCurveTo(100, 28, 60, 30); ctx.lineTo(-70, 30); ctx.quadraticCurveTo(-106, 26, -118, -6); ctx.closePath();
  }
  function drawHull(ctx, t, O) {
    const hull = ctx.createLinearGradient(0, -4, 0, 30);
    hull.addColorStop(0, O.hull[0]); hull.addColorStop(1, O.hull[1]);
    ctx.fillStyle = hull;
    hullPath(ctx); ctx.fill();
    ctx.save(); hullPath(ctx); ctx.clip();
    if (O.scales) {
      // écailles de dragon
      ctx.strokeStyle = 'rgba(255, 200, 80, .35)'; ctx.lineWidth = 1.2;
      for (let row = 0; row < 4; row++) for (let x = -120 + (row % 2) * 9; x < 120; x += 18) { ctx.beginPath(); ctx.arc(x, row * 8 - 2, 9, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
    }
    if (O.skull) {
      // tête de mort peinte et bandes
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.beginPath(); ctx.arc(0, 10, 7, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-4, 14, 8, 5);
      ctx.fillStyle = O.hull[1]; ctx.beginPath(); ctx.arc(-2.6, 9, 1.8, 0, Math.PI * 2); ctx.arc(2.6, 9, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-13, 3); ctx.lineTo(13, 21); ctx.moveTo(13, 3); ctx.lineTo(-13, 21); ctx.stroke();
      ctx.strokeStyle = O.rim; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-118, 22); ctx.lineTo(118, 22); ctx.stroke();
    }
    if (O.shine) {
      // reflet qui glisse sur la coque
      const x = ((t / 9) % 360) - 180;
      const g = ctx.createLinearGradient(x - 30, 0, x + 30, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 30, -10, 60, 44);
    }
    ctx.restore();
    hullPath(ctx); ctx.strokeStyle = O.line; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,170,.22)'; ctx.lineWidth = 1.5;
    for (const k of [6, 15]) { ctx.beginPath(); ctx.moveTo(-110 + k * 0.6, k - 6); ctx.lineTo(108 - k * 0.6, k - 6); ctx.stroke(); }
    ctx.fillStyle = O.rim; ctx.fillRect(-118, -9, 236, 5);
  }
  function drawLantern(ctx, t, ph, O) {
    const lit = ph.night || ph.dusk || S.weather === 'brume' || S.weather === 'tempete' || S.weather === 'aurore';
    ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-108, -8); ctx.lineTo(-108, -46); ctx.lineTo(-96, -46); ctx.stroke();
    const flick = 0.85 + Math.sin(t / 90) * 0.08 + Math.sin(t / 37) * 0.05;
    if (lit) { const gl = ctx.createRadialGradient(-96, -38, 2, -96, -38, 50); gl.addColorStop(0, `rgba(${O.glow},${0.6 * flick})`); gl.addColorStop(1, `rgba(${O.glow},0)`); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(-96, -38, 50, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1.5;
    if (O.pumpkin) {
      ctx.fillStyle = '#f08a1a'; ctx.beginPath(); ctx.ellipse(-96, -37, 8, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = lit ? '#ffe86a' : '#5a2a0a'; ctx.beginPath(); ctx.moveTo(-99, -39); ctx.lineTo(-97, -41); ctx.lineTo(-97, -38); ctx.fill(); ctx.beginPath(); ctx.moveTo(-93, -39); ctx.lineTo(-95, -41); ctx.lineTo(-95, -38); ctx.fill();
      ctx.fillRect(-99, -35, 6, 1.6);
      ctx.fillStyle = '#4a8a2a'; ctx.fillRect(-97, -46, 2, 3);
    } else if (O.paper) {
      ctx.fillStyle = O.glass; ctx.beginPath(); ctx.ellipse(-96, -37, 7, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(80,20,10,.5)'; for (const dy of [-41, -37, -33]) { ctx.beginPath(); ctx.moveTo(-102, dy); ctx.lineTo(-90, dy); ctx.stroke(); }
    } else if (O.wisp) {
      ctx.fillStyle = 'rgba(160,255,190,.25)'; ctx.fillRect(-101, -44, 10, 12); ctx.strokeRect(-101, -44, 10, 12);
      ctx.save(); ctx.shadowColor = '#8affb0'; ctx.shadowBlur = 10; ctx.fillStyle = O.glass;
      ctx.beginPath(); ctx.arc(-96, -38 + Math.sin(t / 200) * 1.5, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    } else {
      ctx.fillStyle = lit ? O.glass : '#e8e0c8'; ctx.fillRect(-101, -44, 10, 12); ctx.strokeRect(-101, -44, 10, 12);
    }
  }
  function drawAnchor(ctx, t, O) {
    if (!O.color) return;
    // corde depuis le bord, ancre posée contre la coque
    ctx.strokeStyle = '#c8b080'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-58, -8); ctx.quadraticCurveTo(-62, 2, -60, 6); ctx.stroke();
    ctx.save(); ctx.translate(-60, 16); ctx.rotate(Math.sin(t / 900) * 0.08);
    ctx.strokeStyle = O.color; ctx.fillStyle = O.color; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -10, 3, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(0, 8); ctx.moveTo(-6, -3); ctx.lineTo(6, -3); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 2, 8, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-8, 4); ctx.lineTo(-10, 0); ctx.lineTo(-5, 3); ctx.fill(); ctx.beginPath(); ctx.moveTo(8, 4); ctx.lineTo(10, 0); ctx.lineTo(5, 3); ctx.fill();
    ctx.restore();
  }
  function drawFlag(ctx, t, O) {
    if (!O.colors && !O.rainbow) return;
    ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-74, -6); ctx.lineTo(-74, -96); ctx.stroke();
    const wind = S.weather === 'tempete' ? 2.4 : 1;
    const pts = [];
    for (let i = 0; i <= 8; i++) { const k = i / 8; pts.push([-74 - k * 30, Math.sin(t / (160 / wind) - k * 5) * 3 * k * wind]); }
    const path = () => { ctx.beginPath(); ctx.moveTo(-74, -94); for (const [x, w] of pts) ctx.lineTo(x, -94 + w); for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0], -76 + pts[i][1]); ctx.closePath(); };
    ctx.save(); path(); ctx.clip();
    if (O.rainbow) ['#ff4a4a', '#ff9a2a', '#ffe03a', '#4ad84a', '#3a8aff', '#9a4aff'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(-110, -95 + i * 3.2, 40, 3.4); });
    else { ctx.fillStyle = O.colors[0]; ctx.fillRect(-110, -96, 40, 22); ctx.fillStyle = O.colors[1]; ctx.fillRect(-110, -80, 40, 5); }
    if (O.skull) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-89, -87, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(-91, -85, 4, 3); }
    if (O.text) { ctx.save(); ctx.scale(-1, 1); ctx.fillStyle = '#fff'; ctx.font = '900 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(O.text, 89, -81); ctx.restore(); }
    ctx.restore();
  }
  function drawFigurehead(ctx, t, id) {
    if (!id || id === 'aucune') return;
    ctx.save(); ctx.translate(120, -8);
    if (id === 'canard') {
      ctx.fillStyle = '#ffd83a'; ctx.beginPath(); ctx.ellipse(0, 0, 9, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(5, -7, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff8a1a'; ctx.beginPath(); ctx.moveTo(9, -8); ctx.lineTo(15, -6.5); ctx.lineTo(9, -5); ctx.fill();
      ctx.fillStyle = '#1d1a26'; ctx.beginPath(); ctx.arc(6, -8.5, 1, 0, Math.PI * 2); ctx.fill();
    } else if (id === 'licorne') {
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#c8a8e8'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-4, 4); ctx.quadraticCurveTo(0, -14, 10, -16); ctx.quadraticCurveTo(18, -14, 16, -8); ctx.lineTo(6, -6); ctx.lineTo(4, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffd34a'; ctx.beginPath(); ctx.moveTo(10, -16); ctx.lineTo(16, -28); ctx.lineTo(13, -15); ctx.fill();
      ctx.fillStyle = '#ff8ad8'; ctx.beginPath(); ctx.moveTo(-4, -2); ctx.quadraticCurveTo(-8, -10, 2, -14); ctx.lineTo(4, -8); ctx.fill();
      ctx.fillStyle = '#1d1a26'; ctx.beginPath(); ctx.arc(11, -12, 1.1, 0, Math.PI * 2); ctx.fill();
    } else if (id === 'dragon') {
      ctx.fillStyle = '#3a8a4a'; ctx.strokeStyle = '#1a4a24'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-4, 6); ctx.quadraticCurveTo(-2, -16, 12, -18); ctx.lineTo(22, -14); ctx.lineTo(14, -9); ctx.lineTo(18, -6); ctx.lineTo(6, -5); ctx.lineTo(4, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffcc44'; for (const [x, y] of [[0, -10], [3, -16], [8, -20]]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y - 6); ctx.lineTo(x + 3, y - 1); ctx.fill(); }
      ctx.fillStyle = '#ff4a2a'; ctx.beginPath(); ctx.arc(13, -14, 1.5, 0, Math.PI * 2); ctx.fill();
      if (Math.sin(t / 400) > 0.7) { ctx.fillStyle = 'rgba(255,140,40,.6)'; ctx.beginPath(); ctx.arc(26, -12, 3, 0, Math.PI * 2); ctx.fill(); }
    } else if (id === 'sirene') {
      ctx.fillStyle = '#ffcc44'; ctx.strokeStyle = '#8a5a08'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-6, 8); ctx.quadraticCurveTo(-2, -4, 4, -8); ctx.quadraticCurveTo(10, -12, 8, -20); ctx.arc(8, -24, 4.5, Math.PI / 2, Math.PI * 2.5); ctx.quadraticCurveTo(14, -10, 8, -2); ctx.lineTo(4, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e8a020'; ctx.beginPath(); ctx.moveTo(-6, 8); ctx.lineTo(-12, 12); ctx.lineTo(-4, 12); ctx.fill();
    }
    ctx.restore();
  }

  function myBoat() {
    const c = me.character;
    const P = c.pets;
    const pet = P && P.list && P.list.find((p) => p.id === P.active);
    return {
      x: BOAT.x, y: BOAT.y, s: BOAT.s, dir: 1, phase: 0,
      fighter: { name: me.twitchDisplayName || me.username, cls: c.cls, look: lookOf(), app: c.look },
      pet: pet && pet.species, legend: c.look && c.look.weapon === 'canne_legendaire', reeling: S.phase === 'reel', hop: S.petHop,
      boat: S.previewBoat || (c.boat && c.boat.equip),
    };
  }
  // ---------- Les autres pêcheurs de l'étang ----------
  // Une place de l'étang (0 à 7) → une position autour de sa barque : on saute sa propre place.
  function spotPos(spot) {
    const mine = S.pond && S.pond.members.find((m) => m.uid === me.id);
    const ms = mine ? mine.spot : 0;
    return SPOTS[Math.max(0, Math.min(SPOTS.length - 1, spot < ms ? spot : spot - 1))];
  }
  const easeOut = (k) => 1 - (1 - k) ** 3;
  const easeIn = (k) => k ** 2.2;
  // Arrivée (ou départ) en ramant depuis le bord du lac le plus proche
  function entryAnim(pos, kind) {
    const edge = pos.x < W / 2 ? -170 : W + 170;
    return kind === 'in' ? { kind, from: edge, to: pos.x, t0: performance.now(), dur: 3600 } : { kind, from: pos.x, to: edge, t0: performance.now(), dur: 3200 };
  }
  // Liste des pêcheurs reçue du serveur : nouvelles barques (qui arrivent en ramant, sauf à sa propre arrivée), barques
  // qui repartent, et état de chacun.
  function applyPond(v) {
    const first = !S.pond || S.pond.id !== v.id;
    S.pond = v;
    S.schoolEnd = v.school ? Date.now() + (v.school.until - v.now) : 0;
    const seen = new Set();
    for (const m of v.members) {
      if (m.uid === me.id) continue;
      seen.add(m.uid);
      let b = S.boats.get(m.uid);
      const pos = spotPos(m.spot);
      if (!b) {
        b = { uid: m.uid, m, pos, state: m.state, castAt: 0, show: null, bubble: null, floats: [], phase: Math.random() * 6, hop: 0, anim: first ? null : entryAnim(pos, 'in') };
        S.boats.set(m.uid, b);
        if (!first) Sound.play('fishPlop', 0.25);
      }
      b.m = m;
      b.pos = pos;
      if (b.state !== m.state && !(b.state === 'wait' && m.state === 'wait')) b.state = m.state;
    }
    for (const [uid, b] of S.boats) {
      if (seen.has(uid)) continue;
      S.boats.delete(uid);
      if (!first) { b.anim = entryAnim(b.pos, 'out'); b.state = 'idle'; S.leaving.push(b); }
    }
    renderSide();
  }
  // Action d'un autre pêcheur, en direct : lancer, remontée, prise brandie au-dessus de sa tête, poisson perdu, réaction.
  function onPondAct(e) {
    if (!S.active) return;
    const now = performance.now();
    if (e.uid === me.id) {
      if (e.k === 'react') S.mine.floats.push({ e: e.e, at: now });
      return;
    }
    const b = S.boats.get(e.uid);
    if (!b) return;
    if (e.k === 'react') { b.floats.push({ e: e.e, at: now }); return; }
    if (e.k === 'cast') { b.state = 'wait'; b.castAt = now; b.show = null; }
    else if (e.k === 'reel') b.state = 'reel';
    else if (e.k === 'catch') {
      b.state = 'idle';
      b.hop = 0.8;
      b.show = { fish: e.fish, treasure: e.treasure, at: now };
      const R = e.fish && Rules.FISH[e.fish.id];
      if (R && (R.rarity === 'epique' || R.rarity === 'legendaire' || e.treasure)) Sound.play('fishTreasure', 0.5);
    } else if (e.k === 'escape' || e.k === 'miss') { b.state = 'idle'; b.floats.push({ e: e.k === 'miss' ? '💤' : '💨', at: now }); }
    else if (e.k === 'stop') b.state = 'idle';
  }
  // Barque d'un autre pêcheur (avec son arrivée ou son départ en ramant)
  function otherBoat(b, t) {
    const m = b.m;
    let x = b.pos.x;
    let dir = b.pos.dir;
    let rowing = false;
    if (b.anim) {
      const k = Math.min(1, (performance.now() - b.anim.t0) / b.anim.dur);
      x = b.anim.from + (b.anim.to - b.anim.from) * (b.anim.kind === 'in' ? easeOut(k) : easeIn(k));
      dir = Math.sign(b.anim.to - b.anim.from) || dir;
      rowing = k < 1;
      if (k >= 1 && b.anim.kind === 'in') b.anim = null;
      if (k >= 1 && b.anim && b.anim.kind === 'out') b.gone = true;
    }
    return {
      x, y: b.pos.y, s: b.pos.s, dir, phase: b.phase, rowing,
      fighter: { name: m.name, cls: m.cls, look: m.look, app: m.app }, pet: m.pet,
      legend: m.app && m.app.weapon === 'canne_legendaire', reeling: b.state === 'reel' && !rowing, hop: b.hop, boat: m.boat,
    };
  }
  // Sillage et rames d'une barque qui arrive ou repart
  function drawWake(ctx, t, B) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5;
    for (let i = 1; i <= 4; i++) {
      const x = B.x - B.dir * (90 + i * 26) * B.s;
      const w = (14 + i * 6) * B.s;
      ctx.globalAlpha = 0.6 - i * 0.12;
      ctx.beginPath(); ctx.moveTo(x, B.y + 26 * B.s - w * 0.3); ctx.quadraticCurveTo(x - B.dir * 8 * B.s, B.y + 26 * B.s, x, B.y + 26 * B.s + w * 0.3); ctx.stroke();
    }
    // rames qui battent l'eau
    const a = Math.sin(t / 160) * 0.6;
    ctx.globalAlpha = 1; ctx.strokeStyle = '#6a4020'; ctx.lineWidth = 3 * B.s + 1;
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(B.x - B.dir * 20 * B.s, B.y - 6 * B.s);
      ctx.lineTo(B.x - B.dir * (20 + Math.cos(a) * 70) * B.s, B.y + (14 + side * 6 + Math.sin(a) * 10) * B.s); ctx.stroke();
    }
    ctx.restore();
  }
  // Ligne et bouchon d'un autre pêcheur (lancée, à l'eau, ou en pleine remontée)
  function drawOtherLine(ctx, t, b, B, boat) {
    if (b.state !== 'wait' && b.state !== 'reel') return;
    const tip = boat.tip;
    const bx = B.x + B.dir * 255 * B.s;
    const byy = B.y + 34 * B.s;
    const p = Math.min(1, (performance.now() - (b.castAt || 0)) / 600);
    const x = tip.x + (bx - tip.x) * p;
    const y = tip.y + (byy - tip.y) * p - Math.sin(p * Math.PI) * 50 * B.s;
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.quadraticCurveTo((tip.x + x) / 2, Math.max(tip.y, y) + (b.state === 'reel' ? 0 : 30 * B.s), x, y); ctx.stroke();
    if (b.state === 'reel') {
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.5;
      const r = (8 + (t / 40) % 12) * B.s;
      ctx.beginPath(); ctx.ellipse(bx + Math.sin(t / 90) * 4 * B.s, byy + 3, r, r * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
      if (Math.random() < 0.15) S.splashes.push({ x: bx, y: byy, vx: (Math.random() - 0.5) * 60, vy: -40 - Math.random() * 50, life: 0.5 });
      return;
    }
    if (p < 1) return;
    const dip = Math.sin(t / 500 + b.phase) * 1.5;
    ctx.save(); ctx.translate(x, y + dip); ctx.scale(B.s * 1.3, B.s * 1.3);
    ctx.fillStyle = '#e8343a'; ctx.beginPath(); ctx.arc(0, -4, 7, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, -4, 7, 0, Math.PI); ctx.fill();
    ctx.restore();
  }
  // Prise brandie au-dessus de la tête (3,5 s), avec un halo de la couleur de la rareté
  function drawShow(ctx, t, b, boat, B) {
    const sh = b.show;
    if (!sh) return;
    const age = (performance.now() - sh.at) / 1000;
    if (age > 3.5) { b.show = null; return; }
    const x = boat.head.x;
    const y = boat.head.y - 34 - 34 * B.s - Math.min(1, age * 3) * 10;
    ctx.save();
    ctx.globalAlpha = Math.min(1, age * 4, (3.5 - age) * 2);
    const R = sh.fish && Rules.FISH[sh.fish.id];
    const col = R ? RCOL[R.rarity] : '#ffd34a';
    const g = ctx.createRadialGradient(x, y, 2, x, y, 46 * B.s + 14);
    g.addColorStop(0, col + 'aa'); g.addColorStop(1, col + '00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 46 * B.s + 14, 0, Math.PI * 2); ctx.fill();
    if (R) drawFish(ctx, x, y, R, { size: 64 * B.s + 18, t, facing: B.dir });
    else drawTreasure(ctx, x, y + 4, 50 * B.s + 14, { t });
    ctx.font = `800 ${Math.round(9 + 5 * B.s)}px system-ui`; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.fillStyle = col;
    const label = R ? `${R.name} · ${cm(sh.fish.size)}` : `${sh.treasure.icon} ${sh.treasure.label}`;
    ctx.strokeText(label, x, y - 30 * B.s - 10); ctx.fillText(label, x, y - 30 * B.s - 10);
    ctx.restore();
  }
  // Pseudo au-dessus des autres barques
  function drawNameTag(ctx, x, y, name, s) {
    ctx.save();
    ctx.font = `800 ${Math.round(9 + 5 * s)}px system-ui`; ctx.textAlign = 'center';
    const w = ctx.measureText(name).width + 12;
    ctx.fillStyle = 'rgba(12, 8, 30, .55)';
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - 12, w, 16, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(name, x, y);
    ctx.restore();
  }
  // Réactions et petits nuages (💨) qui montent au-dessus d'une tête
  function drawFloats(ctx, list, x, y) {
    const now = performance.now();
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i];
      const age = (now - f.at) / 1000;
      if (age > 2.8) { list.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.min(1, age * 5, (2.8 - age) * 2);
      ctx.font = `${Math.round(22 + Math.min(1, age * 4) * 6)}px system-ui`; ctx.textAlign = 'center';
      ctx.fillText(f.e, x + Math.sin(age * 5 + i) * 6, y - age * 24);
      ctx.restore();
    }
  }

  // ---------- Bulles du salon Pêche ----------
  const emoteImgs = {};
  function emoteImg(id) {
    if (!emoteImgs[id]) { const im = new Image(); im.src = Emotes.url(id); emoteImgs[id] = im; }
    return emoteImgs[id];
  }
  // Texte d'une bulle (avec les émotes), coupé en lignes de 170 px au plus
  function bubbleLines(ctx, text) {
    const words = [];
    for (const tk of Rules.chatTokens(text)) {
      if (tk.t === 'emote') words.push({ emote: tk.id, w: 18 });
      else for (const w of tk.v.split(/\s+/).filter(Boolean)) words.push({ text: w, w: ctx.measureText(w).width });
    }
    const lines = [[]];
    let lw = 0;
    const space = ctx.measureText(' ').width;
    for (const w of words) {
      const line = lines[lines.length - 1];
      if (line.length && lw + space + w.w > 170) { lines.push([w]); lw = w.w; continue; }
      lw += (line.length ? space : 0) + w.w;
      line.push(w);
    }
    return lines.slice(0, 4).map((l) => ({ items: l, w: l.reduce((a, w, i) => a + w.w + (i ? space : 0), 0) }));
  }
  function bubbleOf(m) {
    const text = m.roll ? `🎲 ${m.roll.n} (1-${m.roll.max})` : m.flip ? `🪙 ${m.flip} !` : m.me ? `* ${m.text} *` : m.text;
    return { text, at: performance.now(), until: performance.now() + 4500 + Math.min(6000, text.length * 60) };
  }
  // Une bulle au-dessus de la tête ; `placed` évite que deux bulles se chevauchent
  function drawBubble(ctx, bub, x, y, placed, mine) {
    const now = performance.now();
    if (!bub || bub.until <= now) return;
    ctx.save();
    ctx.font = '600 12px system-ui, sans-serif';
    const lines = bubbleLines(ctx, bub.text);
    const lw = Math.max(30, ...lines.map((l) => l.w)) + 16;
    const lh = lines.length * 16 + 8;
    const bx = Math.max(4, Math.min(W - lw - 4, x - lw / 2));
    let by = Math.max(4, y - lh - 10);
    for (let k = 0; k < 4; k++) {
      const hit = placed.find((r) => bx < r.x + r.w && bx + lw > r.x && by < r.y + r.h && by + lh + 8 > r.y);
      if (!hit) break;
      by = Math.max(2, hit.y - lh - 10);
    }
    placed.push({ x: bx, y: by, w: lw, h: lh + 8 });
    const pop = Math.min(1, (now - bub.at) / 160);
    ctx.globalAlpha = Math.max(0, Math.min(1, (now - bub.at) / 160, (bub.until - now) / 400));
    ctx.translate(x, by + lh); ctx.scale(0.7 + pop * 0.3, 0.7 + pop * 0.3); ctx.translate(-x, -(by + lh));
    ctx.fillStyle = mine ? '#fff6d0' : '#ffffff';
    ctx.strokeStyle = mine ? '#ffd34a' : 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(bx, by, lw, lh, 9); ctx.fill(); ctx.stroke();
    const tx = Math.max(bx + 10, Math.min(bx + lw - 10, x));
    ctx.beginPath(); ctx.moveTo(tx - 6, by + lh - 1); ctx.lineTo(tx + 6, by + lh - 1); ctx.lineTo(tx, by + lh + 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2a2040'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const space = ctx.measureText(' ').width;
    lines.forEach((l, i) => {
      let cx = bx + 8;
      const cy = by + 12 + i * 16;
      for (const w of l.items) {
        if (w.emote) { const im = emoteImg(w.emote); if (im.complete && im.naturalWidth) ctx.drawImage(im, cx, cy - 9, 18, 18); }
        else ctx.fillText(w.text, cx, cy);
        cx += w.w + space;
      }
    });
    ctx.restore();
  }
  // Message du salon Pêche : en bulle au-dessus de la barque de son auteur (s'il pêche sur le même étang)
  function onChatMessage(m) {
    if (!S.active || m.room !== 'peche') return;
    if (m.kind === 'contest') loadContest(); // (le classement du concours du jour a changé)
    if (m.sys || !m.uid) return;
    if (m.uid === me.id) { S.mine.bubble = bubbleOf(m); return; }
    const b = S.boats.get(m.uid);
    if (b) b.bubble = bubbleOf(m);
  }

  // ---------- Météo (Rules.fishWeather) : animations ----------
  const WINFO = Rules.FISH_WEATHER.kinds;
  function updateWeather(dt) {
    if (!S.weatherAt || performance.now() > S.weatherAt) {
      S.weatherAt = performance.now() + 3000;
      const w = window.ZL_WEATHER || Rules.fishWeather(Date.now());
      if (w !== S.weather) { S.weather = w; S.drops = []; renderSide(); }
    }
    const amp = S.weather === 'tempete' ? 2.3 : S.weather === 'pluie' ? 1.3 : 1;
    S.waveAmp += (amp - S.waveAmp) * Math.min(1, dt * 0.8);
  }
  // Nuages bas qui masquent le ciel (pluie, tempête, neige)
  function heavyClouds(ctx, t, color, n, speed) {
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const x = ((i * 157 + t / speed) % (W + 300)) - 150;
      const y = 18 + (i % 4) * 26;
      ctx.beginPath(); ctx.ellipse(x, y, 110, 30, 0, 0, Math.PI * 2); ctx.ellipse(x + 70, y + 8, 80, 24, 0, 0, Math.PI * 2); ctx.ellipse(x - 70, y + 10, 70, 22, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawWeatherSky(ctx, t, ph) {
    const w = S.weather;
    if (w === 'pluie') { ctx.fillStyle = 'rgba(60, 70, 90, .38)'; ctx.fillRect(0, 0, W, WATER); heavyClouds(ctx, t, ph.night ? 'rgba(40,44,60,.85)' : 'rgba(120,128,145,.85)', 9, 120); }
    else if (w === 'tempete') {
      ctx.fillStyle = 'rgba(20, 20, 40, .6)'; ctx.fillRect(0, 0, W, WATER);
      heavyClouds(ctx, t, 'rgba(34,34,52,.92)', 11, 45);
      // éclair : zigzag et grondement
      if (performance.now() > S.nextFlash) {
        S.nextFlash = performance.now() + 4000 + Math.random() * 9000;
        S.flash = 1;
        S.bolt = { x: 80 + Math.random() * (W - 160), seed: Math.random() };
        setTimeout(() => { if (S.active && S.weather === 'tempete') Sound.play('fishThunder'); }, 250 + Math.random() * 500);
      }
      if (S.flash > 0.4 && S.bolt) {
        ctx.save(); ctx.strokeStyle = `rgba(255,255,230,${S.flash})`; ctx.lineWidth = 3; ctx.shadowColor = '#bfe8ff'; ctx.shadowBlur = 18;
        ctx.beginPath(); let x = S.bolt.x; let y = 0; ctx.moveTo(x, y);
        for (let i = 0; i < 9; i++) { x += Math.sin(S.bolt.seed * 50 + i * 2.3) * 22; y += WATER / 9; ctx.lineTo(x, y); }
        ctx.stroke(); ctx.restore();
      }
    } else if (w === 'neige') { ctx.fillStyle = 'rgba(225, 232, 245, .35)'; ctx.fillRect(0, 0, W, WATER); heavyClouds(ctx, t, ph.night ? 'rgba(90,96,120,.6)' : 'rgba(235,238,245,.75)', 7, 160); }
    else if (w === 'aurore') {
      ctx.fillStyle = 'rgba(8, 10, 40, .62)'; ctx.fillRect(0, 0, W, WATER);
      for (let i = 0; i < 80; i++) { ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.5 * Math.abs(Math.sin(t / 900 + i))})`; ctx.fillRect((i * 97.3) % W, (i * 37.9) % (WATER - 80), 1.6, 1.6); }
      // rubans de l'aurore qui ondulent
      const bands = [['120,255,200', 60, 0], ['200,130,255', 95, 2], ['120,220,255', 125, 4]];
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const [rgb, y0, ph0] of bands) {
        for (let x = 0; x < W; x += 6) {
          const y = y0 + Math.sin(x / 120 + t / 1800 + ph0) * 22 + Math.sin(x / 47 + t / 900) * 6;
          const h = 50 + Math.sin(x / 80 + t / 1300 + ph0) * 25;
          const g = ctx.createLinearGradient(0, y - h, 0, y + 10);
          g.addColorStop(0, `rgba(${rgb},0)`); g.addColorStop(0.7, `rgba(${rgb},.22)`); g.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = g; ctx.fillRect(x, y - h, 7, h + 10);
        }
      }
      ctx.restore();
    }
  }
  function drawWeatherWater(ctx, t) {
    const w = S.weather;
    if (w === 'pluie' || w === 'tempete') {
      // gouttes qui tombent dans l'eau
      ctx.strokeStyle = 'rgba(220,235,255,.45)'; ctx.lineWidth = 1;
      const n = w === 'tempete' ? 40 : 26;
      for (let i = 0; i < n; i++) {
        const p = ((t / 700) + i * 0.137) % 1;
        const x = (i * 211.7 + Math.floor((t / 700) + i * 0.137) * 97) % W;
        const y = WATER + 10 + ((i * 53.3) % (H - WATER - 20));
        ctx.globalAlpha = 1 - p; ctx.beginPath(); ctx.ellipse(x, y, 2 + p * 9, (2 + p * 9) * 0.32, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(30, 40, 60, .22)'; ctx.fillRect(0, WATER, W, H - WATER);
    }
    if (w === 'tempete') {
      // moutons d'écume sur la houle
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2;
      for (let r = 0; r < 8; r++) {
        const y = WATER + 20 + r * 34;
        for (let i = 0; i < 6; i++) {
          const x = ((i * 190 + r * 60 + t / 14) % (W + 120)) - 60;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 16, y - 7, x + 34, y); ctx.stroke();
        }
      }
    }
    if (w === 'neige') { ctx.fillStyle = 'rgba(230, 240, 255, .16)'; ctx.fillRect(0, WATER, W, H - WATER); }
    if (w === 'aurore') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 12; i++) { const y = WATER + 10 + i * 9; ctx.fillStyle = `rgba(${i % 2 ? '120,255,200' : '200,130,255'},${0.09 - i * 0.006})`; ctx.fillRect(Math.sin(t / 600 + i) * 30, y, W, 3); }
      ctx.restore();
    }
  }
  // Devant tout (sauf l'interface) : pluie, neige, brume, éclair
  function drawWeatherFront(ctx, t, dt) {
    const w = S.weather;
    const want = w === 'tempete' ? 240 : w === 'pluie' ? 150 : w === 'neige' ? 130 : 0;
    while (S.drops.length < want) S.drops.push({ x: Math.random() * (W + 200) - 100, y: Math.random() * H, v: 0.7 + Math.random() * 0.6, p: Math.random() * 6 });
    if (S.drops.length > want) S.drops.length = want;
    if (w === 'pluie' || w === 'tempete') {
      const slant = w === 'tempete' ? 0.45 : 0.12;
      ctx.strokeStyle = w === 'tempete' ? 'rgba(200,215,240,.55)' : 'rgba(200,220,255,.45)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const d of S.drops) {
        const sp = (w === 'tempete' ? 900 : 650) * d.v;
        d.y += sp * dt; d.x += sp * slant * dt;
        if (d.y > H) { d.y = -20; d.x = Math.random() * (W + 200) - 200; }
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - slant * 16, d.y - 16);
      }
      ctx.stroke();
    } else if (w === 'neige') {
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      for (const d of S.drops) {
        d.y += 40 * d.v * dt; d.x += Math.sin(t / 900 + d.p) * 18 * dt;
        if (d.y > H) { d.y = -5; d.x = Math.random() * W; }
        ctx.beginPath(); ctx.arc(d.x, d.y, 1.2 + d.v * 1.6, 0, Math.PI * 2); ctx.fill();
      }
    } else if (w === 'brume') {
      // nappes de brouillard qui dérivent
      for (let i = 0; i < 6; i++) {
        const y = 150 + i * 62;
        const x = ((t / (60 + i * 15) + i * 230) % (W + 600)) - 300;
        const g = ctx.createRadialGradient(x, y, 20, x, y, 340);
        g.addColorStop(0, 'rgba(225,230,240,.42)'); g.addColorStop(1, 'rgba(225,230,240,0)');
        ctx.fillStyle = g; ctx.fillRect(x - 340, y - 120, 680, 240);
      }
      ctx.fillStyle = 'rgba(210, 216, 228, .25)'; ctx.fillRect(0, 0, W, H);
    }
    if (S.flash > 0) {
      ctx.fillStyle = `rgba(235, 240, 255, ${S.flash * 0.55})`; ctx.fillRect(0, 0, W, H);
      S.flash = Math.max(0, S.flash - dt * 2.2);
    }
  }
  // En bas à gauche : la météo du moment et l'appât utilisé
  function drawWeatherBadge(ctx) {
    const c = me.character;
    const fz = c.fishing || {};
    const parts = [];
    if (S.weather !== 'normal') parts.push(`${WINFO[S.weather].icon} ${WINFO[S.weather].label}`);
    const B = fz.bait && Rules.FISH_BAITS[fz.bait];
    if (B) parts.push(`${B.icon} ${B.label} ×${(fz.baits && fz.baits[fz.bait]) || 0}`);
    if (fz.streak) parts.push(`🔥 Série ${fz.streak}`);
    if (!parts.length) return;
    const text = parts.join('  ·  ');
    ctx.save();
    ctx.font = '800 13px system-ui'; ctx.textAlign = 'right';
    const w = ctx.measureText(text).width + 20;
    ctx.fillStyle = 'rgba(15, 10, 30, .6)';
    ctx.beginPath(); ctx.roundRect(W - w - 60, 10, w, 24, 12); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(text, W - 70, 27);
    ctx.restore();
  }

  // ---------- Banc de poissons ----------
  function drawSchool(ctx, t) {
    if (!S.pond || !S.pond.school || Date.now() >= S.schoolEnd) return;
    const cx = S.pond.school.x * W;
    const cy = WATER + 96;
    ctx.save();
    for (let i = 0; i < 16; i++) {
      const a = t / 1400 + i * 0.39;
      const r = 40 + (i % 4) * 22;
      const x = cx + Math.cos(a) * r * 1.8;
      const y = cy + Math.sin(a) * r * 0.45;
      drawFish(ctx, x, y, { shape: 'poisson', id: '', color: '#000', accent: '#000', pattern: 'uni' }, { size: 16 + (i % 3) * 4, t, shadow: true, facing: Math.sin(a) > 0 ? -1 : 1, alpha: 0.32 });
    }
    for (let i = 0; i < 10; i++) {
      const p = ((t / 900) + i / 10) % 1;
      ctx.fillStyle = `rgba(255, 240, 150, ${0.8 * (1 - p)})`;
      const x = cx + Math.sin(i * 7.3 + t / 700) * 140;
      ctx.fillRect(x, cy - 10 - p * 26, 2.5, 2.5);
    }
    ctx.restore();
  }
  // En haut : nombre de pêcheurs de l'étang et banc de poissons en cours
  function drawPondBadge(ctx) {
    if (!S.pond) return;
    const n = S.pond.members.length;
    let text = `🛶 ${n} pêcheur${n > 1 ? 's' : ''} sur l'étang${S.pond.ponds > 1 ? ` n°${S.pond.id}` : ''}`;
    const left = Math.ceil((S.schoolEnd - Date.now()) / 1000);
    if (S.pond.school && left > 0) text = `🐟✨ Banc de poissons ! Les rares mordent ×2 — ${left} s`;
    ctx.save();
    ctx.font = '800 13px system-ui'; ctx.textAlign = 'left';
    const w = ctx.measureText(text).width + 20;
    ctx.fillStyle = left > 0 && S.pond.school ? 'rgba(255, 200, 40, .9)' : 'rgba(15, 10, 30, .55)';
    ctx.beginPath(); ctx.roundRect(10, 10, w, 24, 12); ctx.fill();
    ctx.fillStyle = left > 0 && S.pond.school ? '#2a1a00' : '#fff';
    ctx.fillText(text, 20, 27);
    ctx.restore();
  }

  // Toutes les barques, des plus lointaines aux plus proches (la sienne comprise)
  function drawBoats(ctx, t, ph, dt) {
    const placed = [];
    const list = [...S.boats.values(), ...S.leaving].map((b) => ({ b, B: otherBoat(b, t) }));
    S.leaving = S.leaving.filter((b) => !b.gone);
    list.push({ mine: true, B: myBoat() });
    list.sort((a, b) => a.B.y - b.B.y);
    const tops = [];
    let myTip = null;
    for (const it of list) {
      if (it.mine) {
        const boat = drawBoatAt(ctx, t, ph, it.B);
        myTip = boat.tip;
        drawLine(ctx, t, boat.tip, bobberState(t));
        tops.push({ mine: true, head: boat.head });
        continue;
      }
      const { b, B } = it;
      if (B.rowing) drawWake(ctx, t, B);
      b.hop = Math.max(0, b.hop - dt);
      const boat = drawBoatAt(ctx, t, ph, B);
      drawOtherLine(ctx, t, b, B, boat);
      tops.push({ b, B, boat });
    }
    // Par-dessus : pseudos, prises brandies, réactions, puis bulles (les plus proches d'abord pour la place)
    for (const it of tops) {
      if (it.mine) { drawFloats(ctx, S.mine.floats, it.head.x, it.head.y - 10); continue; }
      const { b, B, boat } = it;
      drawNameTag(ctx, boat.head.x, boat.head.y - 8, b.m.name, B.s);
      drawShow(ctx, t, b, boat, B);
      drawFloats(ctx, b.floats, boat.head.x, boat.head.y - 24);
    }
    for (const it of [...tops].reverse()) {
      if (it.mine) drawBubble(ctx, S.mine.bubble, it.head.x, it.head.y - 4, placed, true);
      else drawBubble(ctx, it.b.bubble, it.boat.head.x, it.boat.head.y - 22, placed, false);
    }
    return { tip: myTip };
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
  // La physique (zone verte, nage du poisson) est Rules.fishReelStep, à pas fixe et avec la graine reçue au ferrage :
  // le navigateur l'anime et note à quels pas le joueur appuie ou relâche ; le serveur rejoue ces appuis pour décider.
  function stepReel(dt) {
    const R = S.reel;
    if (!R || R.done) return;
    S.reelAcc += dt;
    while (S.reelAcc >= F.reelDt && !R.done) {
      S.reelAcc -= F.reelDt;
      if (S.holding !== S.reelHold) { S.toggles.push(R.step); S.reelHold = S.holding; }
      Rules.fishReelStep(R, S.reelHold);
    }
    if (R.inside && Math.random() < dt * 9) Sound.play('fishReel');
    if (R.done) land();
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
      ctx.fillText(`${RLAB[f.rarity]} · ${cm(r.size)}${f.weather ? ` · ${WINFO[f.weather].icon} ${WINFO[f.weather].label}` : f.when ? (f.when === 'nuit' ? ' · 🌙' : ' · ☀️') : ''}`, 0, 68);
      if (r.streak > 1) { ctx.font = '900 13px system-ui'; ctx.fillStyle = '#ffb04a'; ctx.fillText(`🔥 ${r.streak} d'affilée${r.streak >= r.bestStreak ? ' · record !' : ''}`, 0, -86); }
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
    if (S.phase === 'idle' && performance.now() >= S.calmUntil) text = '🎣 Clique (ou Espace) pour lancer ta ligne';
    else if (S.phase === 'wait') text = S.cast && castT() >= S.cast.appear ? 'Quelque chose approche… attends que le bouchon coule !' : 'Le bouchon flotte… tout est calme.';
    else if (S.phase === 'bite') text = 'IL A MORDU ! Clique vite !';
    else if ((S.phase === 'result' || S.phase === 'escape' || S.phase === 'idle') && performance.now() < S.calmUntil) text = `🐟 Les poissons se méfient… relance dans ${Math.ceil((S.calmUntil - performance.now()) / 1000)} s`;
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
    // Plein écran ou écran haute densité : on dessine en pleine définition (même repère W × H)
    const k = canvasScale(S.canvas, W, H, 3);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const ph = skyPhase();
    const t = now;
    tickPhase(now);
    stepReel(dt);
    if (now > S.jumpAt) { S.jumpAt = now + 9000 + Math.random() * 16000; const ids = Rules.FISH_IDS; S.jumps.push({ x: 420 + Math.random() * 380, y: WATER + 30 + Math.random() * 40, p: 0, fish: Rules.FISH[ids[Math.floor(Math.random() * 30)]] }); }
    if (Math.random() < dt * 0.12) Sound.play(ph.night ? 'cricket' : 'birdChirp');
    S.petHop = Math.max(0, S.petHop - dt);
    updateWeather(dt);
    drawSky(ctx, t, ph);
    drawWeatherSky(ctx, t, ph);
    if (!S.sky && window.HouseLife && HouseLife.makeSky) S.sky = HouseLife.makeSky({ ads: SKY_ADS, signs: SKY_SIGNS, scale: 0.34, gap: [6000, 14000] });
    if (S.sky) S.sky(ctx, W, H, t, ph);
    drawWater(ctx, t, ph);
    drawWeatherWater(ctx, t);
    drawDucks(ctx, t, dt, ph);
    drawJumps(ctx, dt);
    drawShadow(ctx, t);
    // ronds dans l'eau
    for (const r of S.ripples) { r.r += dt * 30; r.life -= dt * 0.8; ctx.strokeStyle = `rgba(255,255,255,${Math.max(0, r.life) * 0.7})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r, r.r * 0.35, 0, 0, Math.PI * 2); ctx.stroke(); }
    S.ripples = S.ripples.filter((r) => r.life > 0);
    drawSchool(ctx, t);
    drawPads(ctx, t, ph);
    drawBoats(ctx, t, ph, dt);
    for (const s of S.splashes) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 400 * dt; s.life -= dt; ctx.fillStyle = `rgba(220,240,255,${Math.max(0, s.life)})`; ctx.fillRect(s.x, s.y, 3, 3); }
    S.splashes = S.splashes.filter((s) => s.life > 0);
    for (const h of S.hearts) { h.y -= 30 * dt; h.life -= dt; ctx.globalAlpha = Math.max(0, h.life); ctx.font = '18px system-ui'; ctx.fillText(h.e, h.x, h.y); ctx.globalAlpha = 1; }
    S.hearts = S.hearts.filter((h) => h.life > 0);
    drawBugs(ctx, t, ph);
    if (ph.night) { ctx.fillStyle = 'rgba(10, 14, 50, .18)'; ctx.fillRect(0, 0, W, H); }
    drawWeatherFront(ctx, t, dt);
    drawWeatherBadge(ctx);
    drawPondBadge(ctx);
    drawPreview(t, ph);
    drawReel(ctx, t);
    drawResult(ctx, t);
    drawMessage(ctx, t);
    drawHint(ctx, t);
  }

  function splash(x, y, n = 14) {
    for (let i = 0; i < n; i++) S.splashes.push({ x, y, vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 120, life: 0.7 });
    S.ripples.push({ x, y: y + 4, r: 4, life: 1 });
  }

  // Étapes du lancer : le serveur les envoie au moment où elles arrivent (socket `fishing`), rien n'est connu d'avance.
  // On les note en temps du lancer (castT) pour l'animation : silhouette, touches, bouchon qui coule, prise ratée.
  function onEvent(e) {
    const c = S.cast;
    if (!S.active || !c || e.id !== c.id) return;
    const ct = castT();
    if (e.k === 'appear') { c.appear = ct; c.shape = e.shape; c.big = e.big; }
    else if (e.k === 'nibble') { c.nibbles.push(ct); Sound.play('fishNibble'); S.ripples.push({ x: BOBBER.x, y: BOBBER.y + 2, r: 4, life: 0.8 }); }
    else if (e.k === 'sink') c.sink = ct;
    else if (e.k === 'miss' && (S.phase === 'wait' || S.phase === 'bite' || S.phase === 'casting')) {
      S.phase = 'escape';
      say('Trop tard…', 'Il a filé avec l\'appât.', '#a8c8ff');
      Sound.play('fishEscape');
      scared(e.wait);
      S.nextAt = Math.max(performance.now() + 1800, S.calmUntil);
    }
  }
  // Une prise vue puis laissée effraie les poissons : il faut attendre avant de relancer
  function scared(wait) {
    if (wait > 0) {
      S.calmUntil = performance.now() + wait * 1000;
      if (me && me.character.fishing) me.character.fishing.streak = 0; // (la série repart de zéro)
    }
    S.lockUntil = performance.now() + 1000;
  }
  function tickPhase(now) {
    const c = S.cast;
    if (S.phase === 'casting' && castT() >= 0.6) { S.phase = 'wait'; Sound.play('fishPlop'); splash(BOBBER.x, BOBBER.y, 6); }
    if (S.phase === 'wait' && c && castT() >= c.sink) { S.phase = 'bite'; Sound.play('fishSink'); splash(BOBBER.x, BOBBER.y); }
    // Sans nouvelles du serveur (connexion perdue), on finit par rentrer la ligne
    if (S.phase === 'bite' && c && castT() > c.sink + 4 && !S.busy) {
      S.phase = 'escape';
      say('Trop tard…', 'Il a filé avec l\'appât.', '#a8c8ff');
      api('/api/fishing/stop', {}).then((r) => scared(r.wait)).catch(() => {});
      S.nextAt = now + 1800;
    }
    if ((S.phase === 'result' || S.phase === 'escape') && S.auto && S.nextAt && now >= S.nextAt && now >= S.calmUntil) { S.nextAt = 0; castLine(); }
  }

  // ---------- Actions ----------
  async function castLine() {
    if (S.busy) return;
    if (performance.now() < S.calmUntil) {
      say('Les poissons se méfient…', `Patiente encore ${Math.ceil((S.calmUntil - performance.now()) / 1000)} s avant de relancer.`, '#a8c8ff');
      return;
    }
    S.busy = true;
    S.result = null;
    S.reel = null;
    try {
      const r = await api('/api/fishing/cast', {});
      S.cast = { id: r.id, approach: r.approach, appear: Infinity, sink: Infinity, nibbles: [] };
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
        scared(r.wait);
        S.nextAt = Math.max(performance.now() + 1800, S.calmUntil);
        Sound.play('fishEscape');
        if (r.reason === 'tot' || early) say('Trop tôt !', 'Attends que le bouchon coule vraiment.', '#ffb0b0');
        else say('Trop tard…', 'Il a filé avec l\'appât.', '#a8c8ff');
        return;
      }
      S.phase = 'reel';
      S.reel = Rules.fishReelNew(r.reel);
      S.reelAcc = 0;
      S.reelHold = false;
      S.toggles = [];
      S.holding = false;
      Sound.play('fishHook');
      splash(BOBBER.x, BOBBER.y, 18);
    } catch (err) { toast('⚠️ ' + err.message); S.phase = 'idle'; } finally { S.busy = false; }
  }

  async function land() {
    S.busy = true;
    try {
      const r = await api('/api/fishing/land', { id: S.cast.id, toggles: S.toggles });
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
          if (r.contest) {
            loadContest();
            if (r.contest.improved) toast(r.contest.rank === 1 ? `🏆 Tu prends la tête du concours du jour (${cm(r.size)}) !` : `🏆 Concours du jour : te voilà ${r.contest.rank}ᵉ (${cm(r.size)}) !`, 5000);
          }
          S.session = S.session.slice(0, 8);
        }
        refresh().then(renderSide).catch(() => {});
      }
      S.nextAt = performance.now() + (r.caught ? 3200 : 1800);
      S.lockUntil = performance.now() + 1000;
      if (r.caught && r.streak != null) me.character.fishing.streak = r.streak;
      if (!r.caught && me.character.fishing) me.character.fishing.streak = 0;
    } catch (err) {
      toast('⚠️ ' + err.message);
      S.phase = 'idle';
      S.reel = null;
    } finally { S.busy = false; renderSide(); }
  }

  // Un seul bouton pour tout (clic gauche ou Espace) : lancer, ferrer, tenir la zone verte, relancer
  function press() {
    // (1 s de pause après la fin d'une prise : un clic de trop ne fait pas disparaître la carte du poisson)
    if ((S.phase === 'result' || S.phase === 'escape') && performance.now() < S.lockUntil) return;
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
        <div><span class="muted">Série</span><b>🔥 ${fmt((me.character.fishing && me.character.fishing.streak) || 0)}</b></div>
        <div><span class="muted">Record de série</span><b>${fmt(k.fishStreak || 0)}</b></div>
        <div><span class="muted">Espèces</span><b>${n}</b></div>
      </div>
      <div class="fish-time">${time === 'nuit' ? '🌙 C\'est la nuit (heure de Paris) : les poissons de nuit mordent.' : '☀️ C\'est le jour (heure de Paris) : les poissons de jour mordent.'}</div>
      ${weatherHtml()}
      ${pondHtml()}
      ${contestHtml()}
      <label class="fish-auto"><input type="checkbox" id="fish-auto" ${S.auto ? 'checked' : ''}> Relancer la ligne toute seule</label>
      <div class="fish-session"><b>🐟 Dernières prises</b>${S.session.length ? S.session.map((s) => { const f = Rules.FISH[s.id]; return `<div><span style="color:${RCOL[f.rarity]}">${esc(f.name)}</span> <span class="muted">${cm(s.size)}</span>${s.isNew ? ' <b class="fish-new">Nouveau</b>' : s.record ? ' <b class="fish-new">Record</b>' : ''}</div>`; }).join('') : '<div class="muted">Rien encore… patience !</div>'}</div>
      <div class="fish-reward muted">${n >= 100 ? '🎉 100 espèces : la <b>panoplie du pêcheur</b> t\'attend à la boutique !' : `Inscris 100 espèces au Pêchédex pour débloquer la <b>panoplie du pêcheur</b> à la boutique.`}</div>`;
    $('fish-dex-btn').onclick = openDex;
    renderShop();
    const plan = $('fish-side').querySelector('.fw-plan');
    if (plan) { plan.open = !!S.planOpen; plan.ontoggle = () => { S.planOpen = plan.open; }; }
    const cf = $('fish-side').querySelector('[data-contest-fish]');
    if (cf && S.contest) { const f = Rules.FISH[S.contest.species]; drawFish(cf.getContext('2d'), 42, 24, f, { size: f.shape === 'anguille' || f.shape === 'long' ? 64 : 48, t: 600 }); }
    $('fish-auto').onchange = (e) => { S.auto = e.target.checked; try { localStorage.setItem('zl_fish_auto', S.auto ? '1' : '0'); } catch (er) { /* ignore */ } if (S.auto && (S.phase === 'result' || S.phase === 'escape')) S.nextAt = performance.now() + 800; };
  }

  // Météo du moment et planning d'aujourd'hui et de demain (créneaux de 2 h, heure de Paris)
  function weatherHtml() {
    const now = Date.now();
    const plan = Rules.fishWeatherPlan(now);
    const cur = plan.find((p) => p.start <= now && now < p.end);
    const W0 = WINFO[S.weather] || WINFO.normal;
    const left = cur ? Math.max(1, Math.round((cur.end - now) / 60000)) : 0;
    const next = plan.find((p) => p.start > now && p.weather !== 'normal');
    const days = [...new Set(plan.map((p) => p.day))];
    const grid = days.map((d, i) => `<div class="fw-day"><small class="muted">${i ? 'Demain' : 'Aujourd\'hui'}</small><div class="fw-grid">${plan.filter((p) => p.day === d).map((p) => {
      const K = WINFO[p.weather];
      const state = p.end <= now ? ' past' : p === cur ? ' now' : '';
      return `<span class="fw-cell${state}${p.weather !== 'normal' ? ' special' : ''}" title="${p.h} h – ${p.h + 2} h : ${esc(K.label)}"><b>${K.icon}</b><small>${p.h}h</small></span>`;
    }).join('')}</div></div>`).join('');
    return `<div class="fish-weather"><b>${W0.icon} Météo : ${esc(W0.label)}</b> <small class="muted">${cur ? `encore ${left >= 60 ? `${Math.floor(left / 60)} h ${String(left % 60).padStart(2, '0')}` : `${left} min`}` : ''}</small>
      <small class="muted">${esc(W0.desc)}${next && S.weather === 'normal' ? ` · prochaine : ${WINFO[next.weather].icon} ${esc(WINFO[next.weather].label)} à ${next.h} h${next.day !== cur.day ? ' (demain)' : ''}` : ''}</small>
      <details class="fw-plan"><summary>📅 Planning de la météo</summary>${grid}</details></div>`;
  }

  // Les pêcheurs de l'étang (soi compris), avec ce qu'ils font
  function pondHtml() {
    if (!S.pond) return '<div class="fish-pond muted">🛶 Connexion à l\'étang…</div>';
    const icon = { idle: '🪑', wait: '🎣', reel: '💪' };
    const label = { idle: 'au repos', wait: 'ligne à l\'eau', reel: 'remonte une prise !' };
    const list = S.pond.members.map((m) => {
      const mine = m.uid === me.id;
      const st = mine ? (S.phase === 'reel' ? 'reel' : S.phase === 'wait' || S.phase === 'bite' || S.phase === 'casting' ? 'wait' : 'idle') : m.state;
      const ci = m.cls && Rules.CLASS_INFO[m.cls];
      return `<div class="fish-angler${mine ? ' me' : ''}" title="${label[st]}"><span>${icon[st] || '🎣'}</span><b>${ci ? ci.icon + ' ' : ''}${esc(m.name)}</b>${mine ? ' <small class="muted">(toi)</small>' : ''}<small class="muted">niv. ${m.level || 1}</small></div>`;
    }).join('');
    return `<div class="fish-pond"><b>🛶 Sur l'étang${S.pond.ponds > 1 ? ` n°${S.pond.id}` : ''}</b> <span class="muted">${S.pond.members.length} / ${S.pond.spots}</span>
      <div class="fish-anglers">${list}</div>
      ${S.pond.members.length < 2 ? '<small class="muted">Seul pour l\'instant… à plusieurs, des <b>bancs de poissons</b> passent de temps en temps (rares ×2) !</small>' : ''}</div>`;
  }
  // Concours du jour : l'espèce, le podium, sa place et les lots
  function contestHtml() {
    const C = S.contest;
    if (!C) return '';
    const f = Rules.FISH[C.species];
    const medal = ['🥇', '🥈', '🥉'];
    const top = C.top.slice(0, 5).map((e, i) => `<div class="fish-contest-row${e.uid === me.id ? ' me' : ''}"><span>${medal[i] || `${i + 1}.`}</span><b>${esc(e.name)}</b><span>${cm(e.size)}</span></div>`).join('');
    const mine = C.me && C.me.rank > 5 ? `<div class="fish-contest-row me"><span>${C.me.rank}.</span><b>Toi</b><span>${cm(C.me.size)}</span></div>` : '';
    return `<div class="fish-contest"><b>🏆 Concours du jour</b>
      <div class="fish-contest-fish"><canvas width="84" height="44" data-contest-fish></canvas><div>La plus grande <b style="color:${RCOL[f.rarity]}">${esc(f.name)}</b><br><small class="muted">${cm(f.min)} – ${cm(f.max)} · fin à minuit (heure de Paris)</small></div></div>
      ${top || '<small class="muted">Personne encore… à toi de jouer !</small>'}${mine}
      <small class="muted">Lots : 🥇 ${C.rewards[0].gold} golds + ${C.rewards[0].chests} coffres · 🥈 ${C.rewards[1].gold} + ${C.rewards[1].chests} · 🥉 ${C.rewards[2].gold} + ${C.rewards[2].chests}</small></div>`;
  }
  async function loadContest() {
    try { S.contest = await api('/api/fishing/contest'); renderSide(); } catch (e) { /* ignore */ }
  }

  // ---------- Boutique du ponton : appâts et barque ----------
  const gold = (n) => `${fmt(n)} 🪙`;
  async function shopCall(url, body, msg) {
    try {
      await api(url, body);
      if (msg) toast(msg);
      await refresh();
      renderSide();
    } catch (err) { toast('⚠️ ' + err.message); }
  }
  function renderShop() {
    const el = $('fish-shop');
    if (!el || !me) return;
    const c = me.character;
    const fz = c.fishing || { baits: {} };
    const boat = c.boat || { owned: [], equip: Rules.BOAT_DEFAULT };
    const tabs = `<div class="fs-tabs"><button type="button" data-shop="baits" class="${S.shopTab === 'baits' ? 'active' : ''}">🪱 Appâts</button><button type="button" data-shop="boat" class="${S.shopTab === 'boat' ? 'active' : ''}">🛶 Ma barque</button><span class="spacer"></span><span class="fs-gold">${gold(c.gold)}</span></div>`;
    let body;
    if (S.shopTab === 'baits') {
      const cur = fz.bait && Rules.FISH_BAITS[fz.bait];
      body = `<p class="muted fs-note">Un appât est utilisé à chaque lancer tant qu'il en reste. En ce moment : <b>${cur ? `${cur.icon} ${esc(cur.label)} (${fz.baits[fz.bait] || 0})` : 'aucun appât'}</b>
          ${cur ? '<button type="button" class="secondary small" data-bait-use="">Pêcher sans appât</button>' : ''}</p>
        <div class="fs-grid">${Object.entries(Rules.FISH_BAITS).map(([id, B]) => {
    const n = fz.baits[id] || 0;
    const used = fz.bait === id;
    return `<div class="fs-card${used ? ' used' : ''}"><div class="fs-card-top"><span class="fs-ico">${B.icon}</span><div><b>${esc(B.label)}</b><small class="muted">${esc(B.desc)}</small></div></div>
            <div class="fs-card-row"><span class="muted">Stock : <b>${n}</b></span>${n ? (used ? '<span class="fs-used">✓ Utilisé</span>' : `<button type="button" class="secondary small" data-bait-use="${id}">Utiliser</button>`) : ''}</div>
            <div class="fs-buy">${Rules.FISH_BAIT_PACKS.map((k) => `<button type="button" class="small" data-bait-buy="${id}" data-n="${k}" ${c.gold < B.price * k ? 'disabled' : ''}>×${k} · ${gold(B.price * k)}</button>`).join('')}</div></div>`;
  }).join('')}</div>`;
    } else {
      const prev = S.previewBoat || {};
      body = `<div class="fs-boat"><div class="fs-preview"><canvas id="fish-boat-preview" width="340" height="200"></canvas><small class="muted">Clique une pièce pour l'essayer ; elle s'affiche aussi sur ta barque, sur le lac.</small></div>
        <div class="fs-parts">${Object.entries(Rules.BOAT_PARTS).map(([part, P]) => {
    const tryId = prev[part];
    const tryO = tryId && P.options[tryId];
    const owned = (id) => !P.options[id].price || boat.owned.includes(`${part}:${id}`);
    return `<div class="fs-part"><b>${P.icon} ${esc(P.label)}</b><div class="fs-opts">${Object.entries(P.options).map(([id, O]) => {
      const on = boat.equip[part] === id;
      return `<button type="button" class="fs-opt${on ? ' on' : ''}${tryId === id ? ' try' : ''}" data-part="${part}" data-opt="${id}">${esc(O.label)}<small>${on ? '✓ Posée' : owned(id) ? 'À toi' : gold(O.price)}</small></button>`;
    }).join('')}</div>
            ${tryO && !owned(tryId) ? `<div class="fs-try">Essai : <b>${esc(tryO.label)}</b> <button type="button" class="gold small" data-boat-buy="${part}" data-opt="${tryId}" ${c.gold < tryO.price ? 'disabled' : ''}>Acheter · ${gold(tryO.price)}</button> <button type="button" class="secondary small" data-boat-cancel="${part}">Annuler</button></div>` : ''}</div>`;
  }).join('')}</div></div>`;
    }
    el.innerHTML = `<h3>🛶 Boutique du ponton</h3>${tabs}${body}`;
    el.querySelectorAll('[data-shop]').forEach((b) => { b.onclick = () => { S.shopTab = b.dataset.shop; if (S.shopTab !== 'boat') S.previewBoat = null; renderShop(); }; });
    el.querySelectorAll('[data-bait-buy]').forEach((b) => { b.onclick = () => { const B = Rules.FISH_BAITS[b.dataset.baitBuy]; shopCall('/api/fishing/bait/buy', { id: b.dataset.baitBuy, n: Number(b.dataset.n) }, `${B.icon} ${b.dataset.n} × ${B.label} acheté${b.dataset.n > 1 ? 's' : ''}`); }; });
    el.querySelectorAll('[data-bait-use]').forEach((b) => { b.onclick = () => shopCall('/api/fishing/bait/use', { id: b.dataset.baitUse || null }); });
    el.querySelectorAll('[data-part]').forEach((b) => {
      b.onclick = () => {
        const { part, opt } = b.dataset;
        const O = Rules.BOAT_PARTS[part].options[opt];
        const mine = !O.price || boat.owned.includes(`${part}:${opt}`);
        const rest = { ...(S.previewBoat || {}) };
        delete rest[part];
        if (mine) { S.previewBoat = Object.keys(rest).length ? { ...boat.equip, ...rest } : null; shopCall('/api/fishing/boat/equip', { part, id: opt }); return; }
        S.previewBoat = { ...boat.equip, ...rest, [part]: opt };
        renderShop();
      };
    });
    el.querySelectorAll('[data-boat-buy]').forEach((b) => { b.onclick = () => { const { boatBuy: part, opt } = b.dataset; const rest = { ...(S.previewBoat || {}) }; delete rest[part]; S.previewBoat = Object.keys(rest).filter((k) => rest[k] !== boat.equip[k]).length ? { ...boat.equip, ...rest } : null; shopCall('/api/fishing/boat/buy', { part, id: opt }, `🛶 ${Rules.BOAT_PARTS[part].options[opt].label} : à toi !`); }; });
    el.querySelectorAll('[data-boat-cancel]').forEach((b) => { b.onclick = () => { const p2 = b.dataset.boatCancel; const rest = { ...(S.previewBoat || {}) }; rest[p2] = boat.equip[p2]; S.previewBoat = Object.keys(rest).some((k) => rest[k] !== boat.equip[k]) ? { ...boat.equip, ...rest } : null; renderShop(); }; });
  }
  // Aperçu de la barque dans la boutique (redessiné à chaque image tant qu'il est affiché)
  function drawPreview(t, ph) {
    const cv = S.shopTab === 'boat' && $('fish-boat-preview');
    if (!cv || !cv.offsetParent) return;
    const PW = 340;
    const PH = 200;
    const k = canvasScale(cv, PW, PH, 2);
    const ctx = cv.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, PH);
    g.addColorStop(0, ph.night ? '#1a2050' : '#bfe4ff'); g.addColorStop(0.55, ph.night ? '#2b2c5e' : '#e8f6ff'); g.addColorStop(0.56, ph.night ? '#1c2c54' : '#6ab8e0'); g.addColorStop(1, ph.night ? '#0c1430' : '#2f78b0');
    ctx.fillStyle = g; ctx.fillRect(0, 0, PW, PH);
    const B = { ...myBoat(), x: 175, y: 150, s: 0.95, reeling: false };
    drawBoatAt(ctx, t, ph, B);
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
    // Filtres : toutes, manquantes, une rareté, les espèces de toujours ou celles d'une météo
    const keep = (f) => dexFilter === 'all' || (dexFilter === 'missing' ? !dex[f.id] : dexFilter === 'base' ? !f.weather : WINFO[dexFilter] ? f.weather === dexFilter : f.rarity === dexFilter);
    const list = Object.values(Rules.FISH).filter(keep);
    const wcount = (w) => Object.values(Rules.FISH).filter((f) => (w === 'base' ? !f.weather : f.weather === w) && dex[f.id]).length + ' / ' + Object.values(Rules.FISH).filter((f) => (w === 'base' ? !f.weather : f.weather === w)).length;
    const count = (r) => Object.values(Rules.FISH).filter((f) => f.rarity === r && dex[f.id]).length + ' / ' + Object.values(Rules.FISH).filter((f) => f.rarity === r).length;
    el.innerHTML = `<div class="fish-book">
      <div class="fish-book-head"><h2>📖 Pêchédex</h2><span class="fish-book-count">${n} / ${total} espèces</span><button class="secondary small" data-close>✕</button></div>
      <div class="fish-bar"><span style="width:${(n / total) * 100}%"></span></div>
      <div class="fish-filters">
        <button data-f="all" class="${dexFilter === 'all' ? 'active' : ''}">Toutes</button>
        <button data-f="missing" class="${dexFilter === 'missing' ? 'active' : ''}">Manquantes</button>
        ${Object.keys(F.rarities).map((r) => `<button data-f="${r}" class="${dexFilter === r ? 'active' : ''}" style="--rc:${RCOL[r]}">${RLAB[r]} <small>${count(r)}</small></button>`).join('')}
      </div>
      <div class="fish-filters">
        <button data-f="base" class="${dexFilter === 'base' ? 'active' : ''}">🕒 De toujours <small>${wcount('base')}</small></button>
        ${Rules.FISH_WEATHER_SPECIAL.map((w) => `<button data-f="${w}" class="${dexFilter === w ? 'active' : ''}" style="--rc:#5a8ac8">${WINFO[w].icon} ${esc(WINFO[w].label)} <small>${wcount(w)}</small></button>`).join('')}
      </div>
      <div class="fish-grid">${list.map((f) => {
    const e = dex[f.id];
    const when = f.weather ? `${WINFO[f.weather].icon} ${WINFO[f.weather].label}` : f.when === 'nuit' ? '🌙 Nuit' : f.when === 'jour' ? '☀️ Jour' : '🕒 Toujours';
    return `<div class="fish-card ${e ? '' : 'unknown'}" style="--rc:${RCOL[f.rarity]}">
          <canvas width="120" height="80" data-fish="${f.id}"></canvas>
          <b>${e ? esc(f.name) : '???'}</b>
          <small style="color:${f.rarity === 'commun' ? '#6a6e78' : RCOL[f.rarity]};font-weight:800">${RLAB[f.rarity]}</small>
          <small class="muted">${when}${e ? ` · ${F.moves[f.move].split(' :')[0]}` : ''}</small>
          ${e ? `<small>🏆 ${cm(e.best)} · ×${e.n}</small>` : `<small class="muted">${cm(f.min)} – ${cm(f.max)}</small>`}
        </div>`;
  }).join('')}</div>
      <p class="muted fish-book-foot">Les espèces manquantes apparaissent en ombre noire. Certaines ne mordent que le jour ☀️ ou la nuit 🌙 (heure de Paris),
        les 100 espèces des intempéries seulement par leur météo (pluie, brume, tempête, neige, aurore boréale : voir le planning).
        100 espèces inscrites débloquent la panoplie du pêcheur à la boutique.</p></div>`;
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
    // Plein écran : sur téléphone, la scène passe en paysage et prend tout l'écran
    $('fish-full').onclick = (e) => { e.stopPropagation(); GameScreen.toggle($('fish-scene'), S.canvas); };
    $('fish-full').addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
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
    // Tchat sous l'étang (salon Pêche par défaut) ; ses messages s'affichent aussi en bulles au-dessus des barques
    S.chat = Chat.mount($('fish-chat'), 'pond', { room: 'peche' });
    Chat.listen(onChatMessage);
    // Réactions rapides
    $('fish-reacts').innerHTML = F.pond.reactions.map((e) => `<button type="button" data-react="${e}" title="Réagir : ${e}">${e}</button>`).join('');
    $('fish-reacts').querySelectorAll('[data-react]').forEach((btn) => { btn.onclick = () => { if (S.socket) S.socket.emit('fish:react', btn.dataset.react); }; });
  }
  // Branché par character.js : l'étang partagé passe par le socket de la page
  function bind(socket) {
    S.socket = socket;
    socket.on('pond', (v) => { if (S.active) applyPond(v); });
    socket.on('pondAct', onPondAct);
    socket.on('pondError', (msg) => { if (S.active) toast('⚠️ ' + msg); });
    socket.on('connect', () => { if (S.active) socket.emit('fish:join'); });
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
    // On prend sa place sur l'étang partagé ; le tchat rouvre le salon Pêche
    S.pond = null;
    S.boats.clear();
    S.leaving = [];
    if (S.socket) S.socket.emit('fish:join');
    if (S.chat) S.chat.setRoom('peche');
    loadContest();
    // Musique chill : les 4 morceaux lo-fi s'enchaînent en boucle
    Sound.music.stop(0.2);
    setTimeout(() => { if (S.active) Sound.music.start(0, 'peche'); }, 250);
  }

  function leave() {
    if (!S.active) return;
    GameScreen.exit($('fish-scene'));
    S.active = false;
    cancelAnimationFrame(S.raf);
    if (Sound.music.state && /peche/.test(Sound.music.state.src || '')) Sound.music.stop();
    if (S.phase !== 'idle') api('/api/fishing/stop', {}).then((r) => scared(r.wait)).catch(() => {});
    if (S.socket) S.socket.emit('fish:leave');
    S.pond = null;
    S.boats.clear();
    S.leaving = [];
    S.phase = 'idle';
    S.cast = null;
    S.reel = null;
    S.result = null;
    const el = $('fish-dex');
    if (el) el.classList.remove('open');
  }

  // peek() : état en lecture seule (étape, barre de remontée), pour les tests automatiques du navigateur
  const peek = () => ({ pond: S.pond && { id: S.pond.id, n: S.pond.members.length, boats: [...S.boats.values()].map((b) => ({ uid: b.uid, name: b.m.name, state: b.state, bubble: !!(b.bubble && b.bubble.until > performance.now()), anim: b.anim && b.anim.kind })), leaving: S.leaving.length, school: !!(S.pond.school && Date.now() < S.schoolEnd) }, phase: S.phase, sink: S.cast && S.cast.sink, appear: S.cast && S.cast.appear, t: S.cast ? castT() : 0, calm: Math.max(0, S.calmUntil - performance.now()), reel: S.reel && { pos: S.reel.pos, vel: S.reel.vel, zone: S.reel.zone, fy: S.reel.fy, progress: S.reel.progress } });
  window.Fishing = { enter, leave, renderSide, openDex, peek, onEvent, bind, get active() { return S.active; } };
})();
