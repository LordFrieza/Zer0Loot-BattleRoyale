/*
 * Moteur audio du jeu.
 *  - Sound.play('equip'), Sound.play('buy')… : effets synthétisés en direct (WebAudio), sans fichier
 *  - Sound.music.start(délai, mode) / stop() : musique de la partie (fichiers MP3 de public/audio/), en boucle
 *  - Sound.bindVolume(élément) : deux curseurs, volume des sons et volume de la musique
 *  - Sound.bindToggle(bouton) : bouton pour couper / remettre les sons (coffres, forge)
 * Les deux volumes sont mémorisés dans le navigateur.
 */
(function () {
  const KEYS = { sfx: 'zl_vol_sfx', music: 'zl_vol_music' };
  const DEFAULTS = { sfx: 0.8, music: 0.6 };
  const VOLUME = 0.75; // niveau maximal des effets (avant le limiteur)
  const MUSIC_LEVEL = 0.8; // niveau maximal de la musique (les MP3 sont normalisés à -16 LUFS)
  let ctx = null;
  let master = null;
  const vol = { ...DEFAULTS };
  const lastOn = { ...DEFAULTS }; // volume à remettre quand on réactive un curseur coupé
  try {
    for (const k of ['sfx', 'music']) {
      const v = localStorage.getItem(KEYS[k]);
      if (v !== null && Number.isFinite(Number(v))) vol[k] = Math.max(0, Math.min(1, Number(v)));
    }
    // Ancien réglage « son coupé » : on le reprend pour les deux volumes.
    if (localStorage.getItem('zl_muted') === '1' && localStorage.getItem(KEYS.sfx) === null) { vol.sfx = 0; vol.music = 0; }
  } catch (e) { /* stockage indisponible */ }
  const listeners = [];
  const stateListeners = [];

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = VOLUME * vol.sfx;
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
  const unlock = () => { ac(); music.resume(); };
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
    if (!c || vol.sfx <= 0) return;
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
    if (!c || vol.sfx <= 0) return;
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

    // Annonce d'un événement de bataille : gong + motif selon l'événement.
    eventStart(kind) {
      const c = ctx;
      timpani(c.currentTime + 0.02, 41, 0.9);
      tone(110, 2.2, { type: 'sine', vol: 0.25, to: 98 });
      tone(165, 1.8, { type: 'triangle', vol: 0.08 });
      const motifs = {
        double: [[72, 0, 0.4], [76, 0.5, 0.4], [79, 1, 0.4], [84, 1.5, 2]],
        fog: [[57, 0, 1.2], [60, 1.3, 1.2], [56, 2.6, 2]],
        fast: [[76, 0, 0.25], [79, 0.3, 0.25], [83, 0.6, 0.25], [88, 0.9, 1.5]],
        meteors: [[52, 0, 0.8], [55, 0.9, 0.8], [58, 1.8, 2]],
      };
      fanfare(motifs[kind] || motifs.double, 0.14, 0.12, 0.3);
    },

    // Impact de météore.
    meteor() {
      noise(0.7, { freq: 900, sweep: 90, vol: 0.4 });
      tone(70, 0.6, { vol: 0.35, to: 28 });
      noise(0.25, { filter: 'highpass', freq: 3000, vol: 0.12, delay: 0.05 });
    },

    // Rugissement du Troll (changement de phase, rage) : grondement grave qui monte puis retombe.
    roar(big = false) {
      const c = ctx;
      const t = c.currentTime + 0.02;
      const dur = big ? 1.6 : 1.1;
      for (const [f0, det] of [[70, 0], [72, 7], [105, -5]]) {
        const osc = c.createOscillator();
        const g = c.createGain();
        const flt = c.createBiquadFilter();
        osc.type = 'sawtooth';
        osc.detune.value = det;
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.exponentialRampToValueAtTime(f0 * 1.6, t + dur * 0.35);
        osc.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + dur);
        flt.type = 'lowpass';
        flt.frequency.setValueAtTime(300, t);
        flt.frequency.exponentialRampToValueAtTime(1100, t + dur * 0.35);
        flt.frequency.exponentialRampToValueAtTime(250, t + dur);
        env(g, t, big ? 0.22 : 0.16, 0.08, dur);
        osc.connect(flt).connect(g).connect(master);
        osc.start(t);
        osc.stop(t + dur + 0.05);
      }
      noise(dur, { filter: 'bandpass', freq: 400, sweep: 200, q: 0.8, vol: 0.18, attack: 0.08 });
      if (big) timpani(t, 41, 0.9);
    },

    // Onde de choc / rocher du Troll.
    slam() {
      noise(0.6, { freq: 700, sweep: 60, vol: 0.45 });
      tone(55, 0.6, { vol: 0.4, to: 25 });
      timpani(ctx.currentTime + 0.01, 36, 0.8);
    },

    // Alerte avant une attaque spéciale du Troll.
    slamWarn() {
      tone(midi(57), 0.18, { type: 'square', vol: 0.05 });
      tone(midi(57), 0.18, { type: 'square', vol: 0.05, delay: 0.22 });
    },

    // Le Troll explose : grosse détonation puis pluie de pièces.
    bossExplode() {
      noise(1.4, { freq: 1500, sweep: 50, vol: 0.5 });
      tone(60, 1.2, { vol: 0.45, to: 22 });
      crash(ctx.currentTime + 0.05, 0.3);
      for (let i = 0; i < 14; i++) {
        tone(midi(86 + (i % 5) * 2), 0.12, { type: 'triangle', vol: 0.05, delay: 0.5 + i * 0.07 + Math.random() * 0.04 });
      }
    },

    // Défaite en coopération : marche funèbre courte.
    defeat() {
      const t0 = fanfare([[60, 0, 1.5], [60, 1.6, 1], [60, 2.7, 0.5], [60, 3.3, 1.5], [63, 5, 1], [62, 6.1, 0.5], [62, 6.7, 1], [60, 7.8, 0.5], [60, 8.4, 1], [59, 9.5, 0.5], [60, 10.1, 3]], 0.17, 0.12);
      timpani(t0, 36, 0.7);
      return 13 * 0.17;
    },

    // Salle du donjon terminée.
    roomClear() {
      fanfare([[67, 0, 0.5], [72, 0.6, 0.5], [76, 1.2, 0.5], [79, 1.8, 2]], 0.1, 0.12);
      timpani(ctx.currentTime + 0.05, 48, 0.5);
    },

    // Nouvelle salle : porte qui grince et coup sourd.
    roomEnter() {
      tone(180, 0.7, { type: 'sawtooth', vol: 0.03, to: 120, attack: 0.1 });
      noise(0.6, { filter: 'bandpass', freq: 900, sweep: 500, q: 6, vol: 0.06, attack: 0.1 });
      timpani(ctx.currentTime + 0.7, 41, 0.6);
    },

    // Souffle du Dragon : grondement grave et rafale de flammes.
    fireBreath() {
      noise(0.9, { filter: 'bandpass', freq: 700, sweep: 2600, q: 0.8, vol: 0.22, attack: 0.05 });
      tone(70, 0.8, { type: 'sawtooth', vol: 0.06, to: 45 });
    },

    // Zone d'ombre du Magicien : implosion grave.
    voidBlast() {
      tone(220, 0.5, { type: 'sine', vol: 0.12, to: 55 });
      noise(0.4, { filter: 'lowpass', freq: 600, vol: 0.1 });
    },

    // Téléportation du Magicien : « bloup » descendant puis scintillement.
    blink() {
      tone(1200, 0.18, { type: 'sine', vol: 0.08, to: 300 });
      [0, 7, 12].forEach((st, i) => tone(midi(84 + st), 0.12, { type: 'triangle', vol: 0.04, delay: 0.15 + i * 0.04 }));
    },

    // Malédiction : accord dissonant.
    curse() {
      tone(midi(58), 0.5, { type: 'sawtooth', vol: 0.04 });
      tone(midi(59), 0.5, { type: 'sawtooth', vol: 0.04 });
    },

    // Bouclier d'ombre levé, puis brisé.
    shieldUp() {
      tone(110, 1.2, { type: 'triangle', vol: 0.1, to: 220, attack: 0.3 });
      noise(0.8, { filter: 'bandpass', freq: 1800, q: 4, vol: 0.06, attack: 0.3 });
    },
    shieldDown() {
      noise(0.5, { filter: 'highpass', freq: 3000, vol: 0.2 });
      [79, 76, 72, 67].forEach((n, i) => tone(midi(n), 0.2, { type: 'triangle', vol: 0.06, delay: i * 0.05 }));
    },

    // Roi de la Colline : la colline change de place.
    hillMove() {
      [72, 76, 79].forEach((n, i) => tone(midi(n), 0.16, { type: 'square', vol: 0.05, delay: i * 0.07 }));
    },

    // Ouverture du sondage du donjon : carillon à deux notes et roulement.
    pollOpen() {
      [[76, 0], [72, 0.35], [79, 0.7]].forEach(([n, d]) => tone(midi(n), 0.6, { type: 'triangle', vol: 0.12, delay: d }));
      for (let i = 0; i < 10; i++) timpani(ctx.currentTime + 1.1 + i * 0.06, 52, 0.12);
    },

    // Fin du sondage : le bonus choisi par le chat est appliqué.
    pollEnd() {
      fanfare([[72, 0, 0.5], [76, 0.5, 0.5], [79, 1, 0.5], [84, 1.5, 2.5]], 0.09, 0.12);
      [0, 4, 7, 12].forEach((st, i) => tone(midi(84 + st), 0.25, { type: 'triangle', vol: 0.05, delay: 0.5 + i * 0.06 }));
    },

    // Ultime lancé : montée d'énergie puis accord puissant (couleur selon l'ultime).
    ult(id) {
      const c = ctx;
      const t = c.currentTime + 0.02;
      noise(0.35, { filter: 'bandpass', freq: 400, sweep: 3500, q: 1.2, vol: 0.16, attack: 0.15 });
      const roots = { rempart: 60, priere: 64, chatiment: 62, blizzard: 66, meteore: 55, tourbillon: 57, perforante: 64, pluie: 67, execution: 59, poison: 56 };
      const root = roots[id] || 60;
      fanfare([[root, 0, 0.6], [root + 7, 0.5, 2.2]], 0.12, 0.11, 0.25);
      fanfare([[root - 12, 0.5, 2.2]], 0.12, 0.07, 0.25);
      timpani(t + 0.3, 49, 0.6);
      if (id === 'blizzard') noise(1, { filter: 'highpass', freq: 4000, vol: 0.12, delay: 0.3 });
      if (id === 'meteore') tone(80, 0.8, { vol: 0.2, to: 40, delay: 0.3 });
    },

    // Potion déclenchée : glouglou puis petit éclat (téléportation : souffle magique).
    potion(id) {
      for (let i = 0; i < 3; i++) tone(320 + i * 90 + Math.random() * 40, 0.08, { type: 'sine', vol: 0.12, to: 180, delay: i * 0.07 });
      if (id === 'teleportation' || id === 'invisibilite') noise(0.4, { filter: 'bandpass', freq: 2500, sweep: 600, q: 2, vol: 0.14, delay: 0.2 });
      else [0, 4, 7].forEach((st, i) => tone(midi(79 + st), 0.18, { type: 'triangle', vol: 0.07, delay: 0.24 + i * 0.05 }));
      if (id === 'phenix') fanfare([[67, 0, 0.5], [74, 0.5, 2]], 0.11, 0.1, 0.25);
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

  // ---------- Musique (fichiers MP3, une par mode de jeu) ----------
  const TRACKS = {
    br: '/audio/battle-royale.mp3', // « Not dead YET! » (remix chiptune)
    boss: '/audio/boss.mp3', // BOSSFIGHT — Milky Ways
    dungeon: '/audio/donjon.mp3', // Mattashi — The Final Battle
  };

  const music = (function () {
    const els = {};
    let current = null; // morceau en cours (élément <audio>)
    let pending = null; // morceau bloqué par le navigateur, relancé au premier clic
    let startTimer = null;
    let previewTimer = null;

    function track(mode) {
      const src = TRACKS[mode] || TRACKS.br;
      if (!els[src]) {
        const a = new Audio(src);
        a.loop = true;
        a.preload = 'auto';
        els[src] = a;
      }
      return els[src];
    }
    const level = () => vol.music * MUSIC_LEVEL;

    // Fondu du volume d'un morceau vers v en `dur` secondes.
    function fadeTo(a, v, dur, done) {
      clearInterval(a.fadeTimer);
      const from = a.volume;
      const t0 = performance.now();
      a.fadeTimer = setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / (dur * 1000));
        a.volume = Math.max(0, Math.min(1, from + (v - from) * k));
        if (k >= 1) { clearInterval(a.fadeTimer); if (done) done(); }
      }, 30);
    }

    function tryPlay(a) {
      a.play().then(() => {
        if (pending === a) pending = null;
        stateListeners.forEach((fn) => fn());
      }).catch(() => {
        pending = a; // lecture automatique refusée : on attend une interaction
        stateListeners.forEach((fn) => fn());
      });
    }

    return {
      get playing() { return !!current; },
      get blocked() { return !!pending; },
      // État du morceau en cours (diagnostic) : fichier, en pause ?, volume.
      get state() { return current ? { src: current.getAttribute('src'), paused: current.paused, volume: Math.round(current.volume * 100) / 100 } : null; },
      // Charge à l'avance le morceau d'un mode (ouverture de la file).
      preload(mode) { track(mode); },
      start(delay = 0, mode = 'br') {
        if (current) return;
        const a = track(mode);
        current = a;
        clearTimeout(startTimer);
        clearTimeout(previewTimer);
        startTimer = setTimeout(() => {
          if (current !== a) return;
          a.currentTime = 0;
          a.volume = 0;
          tryPlay(a);
          fadeTo(a, level(), 1.2);
        }, delay * 1000);
      },
      stop(fade = 0.8) {
        const a = current;
        current = null;
        clearTimeout(startTimer);
        if (!a) return;
        if (pending === a) pending = null;
        fadeTo(a, 0, fade, () => { a.pause(); a.currentTime = 0; });
      },
      // Relance après une interaction si le navigateur avait bloqué la lecture.
      resume() {
        if (pending && pending === current) tryPlay(pending);
      },
      // Applique le curseur de volume au morceau en cours.
      apply() {
        const a = current;
        if (a) { clearInterval(a.fadeTimer); a.volume = level(); }
      },
      // Pendant le réglage du curseur, s'il n'y a pas de partie : extrait du thème du Battle Royale.
      preview() {
        if (current) return;
        const a = track('br');
        clearTimeout(previewTimer);
        clearInterval(a.fadeTimer);
        a.volume = level();
        if (a.paused) { a.currentTime = 20; a.play().catch(() => {}); }
        previewTimer = setTimeout(() => fadeTo(a, 0, 0.6, () => { if (!current) a.pause(); }), 1500);
      },
    };
  })();

  // ---------- Volumes ----------
  function setVolume(kind, v) {
    v = Math.max(0, Math.min(1, Math.round(v * 100) / 100));
    vol[kind] = v;
    if (v > 0) lastOn[kind] = v;
    try { localStorage.setItem(KEYS[kind], String(v)); } catch (e) { /* ignore */ }
    if (kind === 'sfx' && ctx) master.gain.setTargetAtTime(VOLUME * v, ctx.currentTime, 0.05);
    if (kind === 'music') music.apply();
    listeners.forEach((fn) => fn());
  }

  // Coupe ou remet un volume (en revenant au dernier niveau choisi).
  function toggle(kind) {
    setVolume(kind, vol[kind] > 0 ? 0 : lastOn[kind] || DEFAULTS[kind]);
  }

  // Ancienne API : couper / remettre les sons.
  function setMuted(m) {
    setVolume('sfx', m ? 0 : lastOn.sfx || DEFAULTS.sfx);
  }

  const ICONS = {
    sfx: (v) => (v <= 0 ? '🔇' : v < 0.34 ? '🔈' : v < 0.67 ? '🔉' : '🔊'),
    music: () => '🎵',
  };
  const LABELS = { sfx: 'Sons', music: 'Musique' };

  /*
   * Deux curseurs de volume : « Sons » (combats, début et fin de partie, coffres…) et « Musique ».
   * Clic sur l'icône : couper / remettre.
   */
  function bindVolume(root) {
    root.classList.add('volume-ctl');
    root.innerHTML = ['sfx', 'music'].map((k) => `
      <div class="vol" data-k="${k}">
        <button type="button" class="vol-ico" title="Couper / remettre : ${LABELS[k].toLowerCase()}"></button>
        <input type="range" min="0" max="100" step="1" aria-label="Volume : ${LABELS[k]}">
        <span class="vol-val"></span>
      </div>`).join('');
    const render = () => {
      root.querySelectorAll('.vol').forEach((el) => {
        const k = el.dataset.k;
        const pct = Math.round(vol[k] * 100);
        const input = el.querySelector('input');
        if (document.activeElement !== input) input.value = pct;
        input.style.setProperty('--v', pct + '%');
        el.querySelector('.vol-ico').textContent = ICONS[k](vol[k]);
        el.querySelector('.vol-val').textContent = pct;
        el.classList.toggle('off', vol[k] <= 0);
        el.title = `${LABELS[k]} : ${pct} %`;
      });
    };
    root.querySelectorAll('.vol').forEach((el) => {
      const k = el.dataset.k;
      const input = el.querySelector('input');
      input.addEventListener('input', () => {
        setVolume(k, input.value / 100);
        if (k === 'music') music.preview();
      });
      // Petit son de test quand on relâche le curseur des sons.
      input.addEventListener('change', () => { if (k === 'sfx') play('join'); });
      el.querySelector('.vol-ico').addEventListener('click', () => {
        toggle(k);
        if (k === 'sfx') play('join');
        else if (vol.music > 0) music.preview();
      });
    });
    listeners.push(render);
    render();
  }

  // Bouton « couper les sons » (fenêtres de coffre et de forge).
  function bindToggle(btn) {
    const render = () => {
      const off = vol.sfx <= 0;
      btn.textContent = off ? '🔇 Son coupé' : '🔊 Son';
      btn.title = off ? 'Réactiver les sons' : 'Couper les sons';
    };
    render();
    listeners.push(render);
    btn.addEventListener('click', () => { toggle('sfx'); if (vol.sfx > 0) sounds.equip(); });
  }

  // Lance un effet (sans erreur si l'audio n'est pas disponible).
  function play(name, ...args) {
    try {
      if (!ac() || vol.sfx <= 0) return 0;
      return sounds[name](...args) || 0;
    } catch (e) {
      return 0;
    }
  }

  window.Sound = {
    play,
    music,
    bindVolume,
    bindToggle,
    setVolume,
    get volumes() { return { ...vol }; },
    // true si les deux volumes sont à zéro
    get muted() { return vol.sfx <= 0 && vol.music <= 0; },
    setMuted,
    // true si le navigateur bloque encore le son ou la musique (aucune interaction).
    get blocked() { const c = ac(); return !c || c.state !== 'running' || music.blocked; },
    onStateChange(fn) {
      const c = ac();
      if (c) c.addEventListener('statechange', fn);
      stateListeners.push(fn);
    },
  };
})();
