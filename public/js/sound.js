/*
 * Moteur audio du jeu : tous les sons sont synthétisés en direct (WebAudio),
 * aucun fichier audio n'est nécessaire.
 *  - Sound.play('equip'), Sound.play('buy')… : effets ponctuels
 *  - Sound.music.start() / stop() : musique de bataille en boucle
 *  - Sound.bindToggle(bouton) : bouton pour couper / remettre le son
 * Le choix « son coupé » est mémorisé dans le navigateur.
 */
(function () {
  const KEY = 'zl_muted';
  const VOLUME = 0.75;
  let ctx = null;
  let master = null;
  let muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch (e) { /* stockage indisponible */ }
  const listeners = [];

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : VOLUME;
      // Compresseur / limiteur : évite la saturation quand plusieurs sons se superposent.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 6;
      comp.ratio.value = 12;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Le navigateur n'autorise le son qu'après une interaction (clic / touche).
  const unlock = () => ac();
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);

  const midi = (n) => 440 * 2 ** ((n - 69) / 12);

  // ---------- Briques de base ----------

  function env(gain, t, vol, attack, dur) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function tone(freq, dur, o = {}) {
    const c = ac();
    if (!c || muted) return;
    const t = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
    env(g, t, o.vol || 0.2, o.attack || 0.005, dur);
    osc.connect(g).connect(o.dest || master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  let noiseBuf = null;
  function noiseBuffer(c) {
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  function noise(dur, o = {}) {
    const c = ac();
    if (!c || muted) return;
    const t = o.at != null ? o.at : c.currentTime + (o.delay || 0);
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const f = c.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 2000, t);
    if (o.sweep) f.frequency.exponentialRampToValueAtTime(o.sweep, t + dur);
    f.Q.value = o.q || 1;
    const g = c.createGain();
    env(g, t, o.vol || 0.2, o.attack || 0.002, dur);
    src.connect(f).connect(g).connect(o.dest || master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  // Cuivre (clairon) : deux dents de scie désaccordées, filtre qui s'ouvre, léger vibrato.
  function brass(freq, t, dur, vol, dest) {
    const c = ctx;
    const g = c.createGain();
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(freq * 1.5, t);
    f.frequency.exponentialRampToValueAtTime(freq * 6, t + 0.06);
    f.frequency.exponentialRampToValueAtTime(freq * 3, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.035);
    g.gain.setValueAtTime(vol * 0.8, t + Math.max(0.05, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    lfo.frequency.value = 5.5;
    lfoGain.gain.value = freq * 0.006;
    lfo.connect(lfoGain);
    for (const detune of [-6, 6]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(freq * 0.97, t);
      o.frequency.exponentialRampToValueAtTime(freq, t + 0.04); // petite attaque « soufflée »
      o.detune.value = detune;
      lfoGain.connect(o.frequency);
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.2);
    }
    lfo.start(t);
    lfo.stop(t + dur + 0.2);
    f.connect(g).connect(dest || master);
  }

  function kick(t, vol, dest) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    env(g, t, vol, 0.002, 0.3);
    o.connect(g).connect(dest || master);
    o.start(t);
    o.stop(t + 0.35);
  }

  function snare(t, vol, dest) {
    noise(0.16, { at: t, filter: 'highpass', freq: 1400, vol, dest });
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    env(g, t, vol * 0.6, 0.002, 0.1);
    o.connect(g).connect(dest || master);
    o.start(t);
    o.stop(t + 0.15);
  }

  function timpani(t, freq, vol, dest) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(freq * 1.15, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.08);
    env(g, t, vol, 0.003, 0.9);
    o.connect(g).connect(dest || master);
    o.start(t);
    o.stop(t + 1);
    noise(0.12, { at: t, freq: 600, vol: vol * 0.5, dest });
  }

  function crash(t, vol, dest) {
    noise(1.6, { at: t, filter: 'highpass', freq: 5000, vol, attack: 0.003, dest });
    noise(0.6, { at: t, filter: 'bandpass', freq: 3000, q: 0.7, vol: vol * 0.6, dest });
  }

  function pluck(freq, t, dur, vol, dest) {
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 8, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
    env(g, t, vol, 0.003, dur);
    o.connect(f).connect(g).connect(dest || master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---------- Effets ----------

  // Joue une suite de notes de clairon : [demi-ton MIDI, début (temps), durée (temps)]
  function fanfare(notes, beat, vol, delay = 0) {
    const t0 = ctx.currentTime + 0.05 + delay;
    for (const [n, start, len] of notes) brass(midi(n), t0 + start * beat, len * beat, vol);
    return t0;
  }

  const sounds = {
    // Clairon médiéval de début de bataille + timbales.
    battleStart() {
      const b = 0.16;
      const t0 = fanfare([
        [60, 0, 0.8], [60, 1, 0.8], [60, 2, 0.8], [67, 3, 2.6],
        [64, 6, 0.8], [67, 7, 0.8], [72, 8, 5],
      ], b, 0.16);
      fanfare([[55, 3, 2.6], [60, 8, 5]], b, 0.09);
      [0, 1, 2].forEach((i) => timpani(t0 + i * b, 65, 0.5));
      timpani(t0 + 3 * b, 49, 0.7);
      for (let i = 0; i < 6; i++) timpani(t0 + (6 + i * 0.33) * b, 65, 0.25 + i * 0.05);
      timpani(t0 + 8 * b, 49, 0.9);
      crash(t0 + 8 * b, 0.25);
      return 13 * b;
    },

    // Fanfare de victoire (majeur, plus longue) + roulement et cymbale.
    victory() {
      const b = 0.14;
      const t0 = fanfare([
        [67, 0, 0.7], [67, 1, 0.7], [67, 2, 0.7], [72, 3, 3],
        [70, 6, 1.5], [74, 7.5, 1.5], [72, 9, 0.7], [74, 10, 0.7], [76, 11, 1], [79, 12, 6],
      ], b, 0.15);
      fanfare([[64, 3, 3], [65, 6, 3], [67, 9, 2.5], [72, 12, 6]], b, 0.08);
      fanfare([[48, 3, 3], [46, 6, 3], [43, 9, 2.5], [48, 12, 6]], b, 0.08);
      for (let i = 0; i < 12; i++) snare(t0 + i * (b / 2), 0.08 + i * 0.012);
      timpani(t0 + 3 * b, 48, 0.8);
      timpani(t0 + 12 * b, 48, 0.9);
      crash(t0 + 3 * b, 0.22);
      crash(t0 + 12 * b, 0.32);
      return 18 * b;
    },

    // Cor qui annonce l'ouverture de la file.
    queueOpen() {
      const t0 = fanfare([[55, 0, 1], [62, 1.2, 2.5]], 0.18, 0.13);
      timpani(t0, 49, 0.5);
    },

    // Un viewer rejoint la file.
    join() {
      tone(midi(79), 0.09, { type: 'square', vol: 0.05 });
      tone(midi(86), 0.14, { type: 'square', vol: 0.05, delay: 0.06 });
    },

    // Coup porté pendant le combat (discret).
    hit() {
      noise(0.07, { filter: 'bandpass', freq: 2500 + Math.random() * 1500, q: 3, vol: 0.12 });
      tone(900 + Math.random() * 400, 0.08, { type: 'square', vol: 0.025, to: 500 });
    },

    // Coup critique : impact lourd + éclat métallique.
    crit() {
      noise(0.18, { filter: 'bandpass', freq: 1800, q: 1.5, vol: 0.28 });
      tone(160, 0.22, { type: 'square', vol: 0.12, to: 55 });
      tone(midi(91), 0.2, { type: 'triangle', vol: 0.08, delay: 0.02 });
      tone(midi(96), 0.25, { type: 'triangle', vol: 0.06, delay: 0.06 });
    },

    // Pari enregistré : jetons qui s'empilent.
    bet() {
      for (let i = 0; i < 4; i++) {
        noise(0.04, { filter: 'bandpass', freq: 4200 + i * 300, q: 6, vol: 0.18, delay: i * 0.06 });
        tone(midi(86 + i * 2), 0.07, { type: 'triangle', vol: 0.06, delay: i * 0.06 });
      }
      tone(midi(91), 0.3, { type: 'sine', vol: 0.07, delay: 0.26 });
    },

    // Pari perdu : petite descente « womp womp ».
    betLost() {
      [67, 66, 65].forEach((n, i) => tone(midi(n), 0.22, { type: 'triangle', vol: 0.12, delay: i * 0.22 }));
      tone(midi(64), 0.6, { type: 'triangle', vol: 0.12, delay: 0.66, to: midi(62) });
    },

    // Tir : corde d'arc ou boule de feu.
    shoot(kind) {
      if (kind === 'fire') {
        noise(0.25, { filter: 'bandpass', freq: 600, sweep: 2500, q: 1.2, vol: 0.12, attack: 0.03 });
      } else {
        tone(220, 0.12, { type: 'triangle', vol: 0.08, to: 140 });
        noise(0.08, { filter: 'highpass', freq: 3000, vol: 0.06 });
      }
    },

    // Explosion de la boule de feu.
    blast() {
      noise(0.35, { freq: 1200, sweep: 150, vol: 0.25 });
      tone(90, 0.3, { vol: 0.2, to: 40 });
    },

    // Annonces de séries de kills.
    streak(kind) {
      const c = ctx;
      if (kind === 'firstblood') {
        fanfare([[62, 0, 0.6], [69, 0.7, 2]], 0.13, 0.13);
        timpani(c.currentTime + 0.05, 55, 0.6);
      } else if (kind === 'double') {
        fanfare([[67, 0, 0.5], [67, 0.6, 0.5], [74, 1.2, 2]], 0.11, 0.13);
      } else if (kind === 'triple') {
        fanfare([[67, 0, 0.4], [71, 0.5, 0.4], [74, 1, 0.4], [79, 1.5, 2]], 0.1, 0.13);
      } else {
        fanfare([[60, 0, 0.5], [63, 0.6, 0.5], [67, 1.2, 0.5], [72, 1.8, 3]], 0.12, 0.15);
        fanfare([[48, 0, 4.8]], 0.12, 0.08);
        crash(c.currentTime + 0.05 + 1.8 * 0.12, 0.25);
      }
    },

    // Forge : coup de marteau sur l'enclume.
    anvil(i = 0) {
      noise(0.05, { filter: 'highpass', freq: 2500, vol: 0.3 });
      tone(midi(88 + (i % 3)), 0.5, { type: 'triangle', vol: 0.14 });
      tone(midi(100 + (i % 3)), 0.35, { type: 'sine', vol: 0.06 });
      tone(120, 0.12, { type: 'square', vol: 0.06, to: 60 });
    },

    // Forge : l'objet sort du feu (fanfare plus grande s'il a gagné une rareté).
    forgeResult(upgraded, rarity) {
      noise(0.6, { filter: 'bandpass', freq: 500, sweep: 3500, q: 1, vol: 0.18, attack: 0.2 });
      if (upgraded) {
        sounds.chestBurst(rarity);
      } else {
        [0, 4, 7].forEach((st, i) => tone(midi(72 + st), 0.3, { type: 'triangle', vol: 0.1, delay: 0.3 + i * 0.07 }));
      }
    },

    // Forge : relance d'une ligne.
    reroll() {
      for (let i = 0; i < 6; i++) tone(midi(76 + i * 2), 0.08, { type: 'square', vol: 0.04, delay: i * 0.04 });
      tone(midi(91), 0.35, { type: 'triangle', vol: 0.1, delay: 0.26 });
      noise(0.15, { filter: 'highpass', freq: 5000, vol: 0.1, delay: 0.26 });
    },

    // Un combattant tombe.
    kill() {
      noise(0.25, { freq: 900, sweep: 200, vol: 0.25 });
      tone(200, 0.3, { type: 'triangle', vol: 0.2, to: 60 });
      tone(midi(88), 0.25, { type: 'triangle', vol: 0.05, delay: 0.02 });
    },

    // Équiper : cliquetis métallique qui monte.
    equip() {
      noise(0.09, { filter: 'highpass', freq: 3500, vol: 0.18 });
      tone(midi(76), 0.12, { type: 'triangle', vol: 0.14 });
      tone(midi(83), 0.12, { type: 'triangle', vol: 0.14, delay: 0.07 });
      tone(midi(88), 0.3, { type: 'triangle', vol: 0.14, delay: 0.14 });
      tone(midi(100), 0.25, { type: 'sine', vol: 0.05, delay: 0.14 });
    },

    // Déséquiper : son sourd qui descend.
    unequip() {
      noise(0.12, { freq: 1200, sweep: 300, vol: 0.2 });
      tone(midi(71), 0.1, { type: 'triangle', vol: 0.13 });
      tone(midi(64), 0.1, { type: 'triangle', vol: 0.13, delay: 0.07 });
      tone(midi(55), 0.22, { type: 'triangle', vol: 0.13, delay: 0.14 });
    },

    // Achat de coffre : « ka-ching » + pièces.
    buy() {
      tone(midi(83), 0.08, { type: 'square', vol: 0.08 });
      tone(midi(88), 0.4, { type: 'square', vol: 0.08, delay: 0.08 });
      for (let i = 0; i < 6; i++) {
        tone(midi(96 + (i % 3) * 2), 0.12, { type: 'sine', vol: 0.06, delay: 0.12 + i * 0.045 });
      }
      noise(0.05, { filter: 'highpass', freq: 6000, vol: 0.12, delay: 0.08 });
    },

    // Clic sur « Ouvrir un coffre » : souffle magique + coffre posé.
    chestAppear() {
      noise(0.5, { filter: 'bandpass', freq: 400, sweep: 3000, q: 2, vol: 0.18, attack: 0.25 });
      [0, 4, 7, 12, 16].forEach((st, i) => tone(midi(72 + st), 0.3, { type: 'sine', vol: 0.05, delay: 0.1 + i * 0.05 }));
      tone(90, 0.25, { type: 'sine', vol: 0.35, to: 45, delay: 0.45 });
      noise(0.15, { freq: 500, vol: 0.2, delay: 0.45 });
    },

    // Recyclage : broyage + petite pluie de pièces.
    recycle(count = 1) {
      noise(0.45, { filter: 'bandpass', freq: 1800, sweep: 250, q: 1.5, vol: 0.22 });
      tone(320, 0.4, { type: 'sawtooth', vol: 0.05, to: 80 });
      const coins = Math.min(8, Math.max(2, Math.round(Math.sqrt(count) * 2)));
      for (let i = 0; i < coins; i++) {
        tone(midi(93 + ((i * 5) % 7)), 0.1, { type: 'sine', vol: 0.06, delay: 0.38 + i * 0.06 });
      }
    },

    // Point de compétence dépensé.
    levelUp() {
      [0, 4, 7, 12].forEach((st, i) => tone(midi(72 + st), 0.18, { type: 'square', vol: 0.05, delay: i * 0.05 }));
    },

    // Récompense reçue (kill / victoire) sur la page perso.
    reward() {
      sounds.buy();
      [0, 4, 7].forEach((st, i) => tone(midi(84 + st), 0.25, { type: 'triangle', vol: 0.08, delay: 0.25 + i * 0.08 }));
    },

    // Ouverture de coffre (clics, paliers de couleur, explosion, cartes).
    chestHit(n) {
      noise(0.08, { freq: 1800, vol: 0.2 });
      tone(110 + n * 9, 0.12, { type: 'square', vol: 0.07, to: 70 + n * 9 });
    },
    chestTier(rarity) {
      const base = { commun: 72, peu_commun: 74, rare: 76, epique: 79, legendaire: 81 }[rarity];
      [0, 4, 7, 12].forEach((st, i) => tone(midi(base + st), 0.35, { type: 'triangle', vol: 0.12, delay: i * 0.06 }));
    },
    chestBurst(rarity) {
      noise(0.6, { freq: 1800, vol: 0.45 });
      tone(70, 0.6, { vol: 0.4, to: 30 });
      const notes = rarity === 'legendaire' ? [0, 4, 7, 11, 14, 19] : rarity === 'epique' ? [0, 4, 7, 12, 16] : [0, 4, 7, 12];
      notes.forEach((st, i) => tone(midi(72 + st), 0.6, { type: 'triangle', vol: 0.13, delay: 0.15 + i * 0.08 }));
      if (rarity === 'legendaire' || rarity === 'epique') {
        fanfare([[72, 0, 1], [76, 1, 1], [79, 2, 4]], 0.12, 0.08, 0.6);
      }
    },
    chestCard(rarity) {
      const idx = Rules.RARITIES.indexOf(rarity);
      tone(660 + idx * 120, 0.25, { vol: 0.12 });
      if (idx >= 3) tone(1320 + idx * 120, 0.4, { type: 'triangle', vol: 0.08, delay: 0.08 });
    },
  };

  // ---------- Musique de bataille (boucle) ----------
  /*
   * Marche épique en la mineur, 138 BPM, progression Am – F – G – E sur 8 mesures.
   * Les notes sont programmées à l'avance (1,5 s) pour rester fluides même si
   * l'onglet est en arrière-plan.
   */
  const music = (function () {
    const BPM = 138;
    const STEP = 60 / BPM / 4; // double-croche
    const CHORDS = [
      [45, [57, 60, 64]], [41, [57, 60, 65]], [43, [55, 59, 62]], [40, [56, 59, 64]],
      [45, [57, 60, 64]], [41, [57, 60, 65]], [43, [55, 59, 62]], [40, [56, 59, 64]],
    ];
    // Mélodie (une valeur par croche, null = silence), 8 mesures.
    const MELODY = [
      69, null, 72, 71, 69, null, 64, null,
      65, null, 69, 67, 65, 64, 62, null,
      67, null, 71, 69, 67, null, 74, null,
      71, null, 68, null, 64, null, null, null,
      69, 71, 72, 74, 76, null, 72, null,
      77, null, 76, 74, 72, null, 69, null,
      74, null, 72, 71, 67, 69, 71, 74,
      76, null, 75, null, 76, null, null, null,
    ];
    let gain = null;
    let timer = null;
    let step = 0;
    let next = 0;

    function schedule() {
      while (next < ctx.currentTime + 1.5) {
        const bar = Math.floor(step / 16) % 8;
        const s = step % 16;
        const [bass, chord] = CHORDS[bar];
        const t = next;
        // Batterie
        if (s === 0 || s === 8 || s === 10) kick(t, 0.55, gain);
        if (s === 4 || s === 12) snare(t, 0.22, gain);
        if (bar === 7 && s >= 12) snare(t, 0.12 + (s - 12) * 0.04, gain);
        if (s % 2 === 0) noise(0.03, { at: t, filter: 'highpass', freq: 8000, vol: s % 4 === 0 ? 0.05 : 0.03, dest: gain });
        if (s === 0 && bar % 4 === 0) crash(t, 0.08, gain);
        // Basse galopante
        if ([0, 3, 6, 8, 11, 14].includes(s)) pluck(midi(bass + (s === 14 ? 12 : 0)), t, STEP * 2.5, 0.16, gain);
        // Arpège d'accompagnement
        if (s % 2 === 1) pluck(midi(chord[(s >> 1) % 3] + 12), t, STEP * 1.5, 0.035, gain);
        // Mélodie au cuivre
        if (s % 2 === 0) {
          const n = MELODY[bar * 8 + s / 2];
          if (n) {
            let len = 1;
            while (len < 3 && MELODY[bar * 8 + s / 2 + len] === null && (s / 2 + len) < 8) len++;
            brass(midi(n), t, STEP * 2 * len * 0.9, 0.055, gain);
          }
        }
        step += 1;
        next += STEP;
      }
    }

    return {
      get playing() { return !!timer; },
      start(delay = 0) {
        const c = ac();
        if (!c || timer) return;
        gain = c.createGain();
        gain.gain.value = 0.8;
        gain.connect(master);
        step = 0;
        next = c.currentTime + 0.1 + delay;
        schedule();
        timer = setInterval(schedule, 200);
      },
      stop(fade = 0.6) {
        if (!timer) return;
        clearInterval(timer);
        timer = null;
        const g = gain;
        const t = ctx.currentTime;
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + fade);
        setTimeout(() => g.disconnect(), fade * 1000 + 1700);
      },
    };
  })();

  // ---------- Bouton son ----------
  function setMuted(m) {
    muted = m;
    try { localStorage.setItem(KEY, m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (ctx) master.gain.setTargetAtTime(m ? 0 : VOLUME, ctx.currentTime, 0.05);
    listeners.forEach((fn) => fn(m));
  }

  function bindToggle(btn) {
    const render = (m) => { btn.textContent = m ? '🔇 Son coupé' : '🔊 Son'; btn.title = m ? 'Réactiver les sons' : 'Couper les sons'; };
    render(muted);
    listeners.push(render);
    btn.addEventListener('click', () => { setMuted(!muted); if (!muted) sounds.equip(); });
  }

  // Lance un effet (sans erreur si l'audio n'est pas disponible).
  function play(name, ...args) {
    try {
      if (!ac() || muted) return 0;
      return sounds[name](...args) || 0;
    } catch (e) {
      return 0;
    }
  }

  window.Sound = {
    play,
    music,
    bindToggle,
    get muted() { return muted; },
    setMuted,
    // true si le navigateur bloque encore le son (aucune interaction).
    get blocked() { const c = ac(); return !c || c.state !== 'running'; },
    onStateChange(fn) { const c = ac(); if (c) c.addEventListener('statechange', fn); },
  };
})();
