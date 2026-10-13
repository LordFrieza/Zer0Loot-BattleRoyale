/*
 * Ouverture de coffre : clics répétés, lumières qui changent de teinte,
 * particules, sons synthétisés, puis révélation des objets.
 */
(function () {
  const GLOW = {
    commun: '#ffffff', peu_commun: '#3ddc5a', rare: '#3b8bff', epique: '#b14dff', legendaire: '#ff9a1f',
  };

  // ---------- Sons (WebAudio, aucun fichier requis) ----------
  let audio = null;
  let muted = false;
  try { muted = localStorage.getItem('zl_muted') === '1'; } catch (e) { /* stockage indisponible */ }

  function ac() {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    return audio;
  }

  function tone(freq, dur, type = 'sine', vol = 0.2, slide = 0, delay = 0) {
    if (muted) return;
    const ctx = ac();
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  function noise(dur, vol = 0.25) {
    if (muted) return;
    const ctx = ac();
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    gain.gain.value = vol;
    src.buffer = buf;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }

  const sfx = {
    hit(n) {
      noise(0.08, 0.2);
      tone(110 + n * 9, 0.12, 'square', 0.07, -40);
    },
    tier(rarity) {
      const base = { commun: 523, peu_commun: 587, rare: 659, epique: 784, legendaire: 880 }[rarity];
      [0, 4, 7, 12].forEach((st, i) => tone(base * 2 ** (st / 12), 0.35, 'triangle', 0.12, 0, i * 0.06));
    },
    burst(rarity) {
      noise(0.6, 0.45);
      tone(70, 0.6, 'sine', 0.4, -40);
      const notes = rarity === 'legendaire' ? [0, 4, 7, 11, 14, 19] : rarity === 'epique' ? [0, 4, 7, 12, 16] : [0, 4, 7, 12];
      notes.forEach((st, i) => tone(523 * 2 ** (st / 12), 0.6, 'triangle', 0.13, 0, 0.15 + i * 0.08));
    },
    card(rarity) {
      const idx = Rules.RARITIES.indexOf(rarity);
      tone(660 + idx * 120, 0.25, 'sine', 0.12);
      if (idx >= 3) tone(1320 + idx * 120, 0.4, 'triangle', 0.08, 0, 0.08);
    },
  };

  // ---------- Particules ----------
  class Particles {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.list = [];
      this.running = false;
      window.addEventListener('resize', () => this.resize());
      this.resize();
    }
    resize() {
      this.canvas.width = window.innerWidth * devicePixelRatio;
      this.canvas.height = window.innerHeight * devicePixelRatio;
    }
    spawn(x, y, color, count, power = 1) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = (2 + Math.random() * 7) * power;
        this.list.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2 * power,
          life: 1, decay: 0.012 + Math.random() * 0.02, size: 2 + Math.random() * 4 * power,
          color: Math.random() < 0.25 ? '#ffffff' : color, star: Math.random() < 0.3,
        });
      }
      if (!this.running) { this.running = true; requestAnimationFrame(() => this.step()); }
    }
    step() {
      const { ctx } = this;
      const dpr = devicePixelRatio;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.list) {
        p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.vx *= 0.985; p.life -= p.decay;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        if (p.star) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.life * 6);
          ctx.fillRect(-p.size, -0.8, p.size * 2, 1.6);
          ctx.fillRect(-0.8, -p.size, 1.6, p.size * 2);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0, p.size * p.life), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      this.list = this.list.filter((p) => p.life > 0);
      if (this.list.length) requestAnimationFrame(() => this.step());
      else { this.running = false; ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
    }
  }

  const CHEST_SVG = (u) => `
  <svg viewBox="0 0 210 170">
    <defs>
      <linearGradient id="wood${u}" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#9a5a2c"/><stop offset="1" stop-color="#5c3216"/>
      </linearGradient>
      <linearGradient id="woodLid${u}" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#b56d38"/><stop offset="1" stop-color="#7a4520"/>
      </linearGradient>
      <linearGradient id="metal${u}" x1="0" x2="1">
        <stop offset="0" stop-color="#a88a2a"/><stop offset=".5" stop-color="#ffe27a"/><stop offset="1" stop-color="#a88a2a"/>
      </linearGradient>
    </defs>
    <rect class="seam" x="12" y="62" width="186" height="10" rx="3" fill="var(--glow)" opacity="0"/>
    <g class="body">
      <rect x="10" y="70" width="190" height="95" rx="8" fill="url(#wood${u})" stroke="#2b160a" stroke-width="3"/>
      <line x1="10" y1="100" x2="200" y2="100" stroke="#4a280f" stroke-width="2"/>
      <line x1="10" y1="132" x2="200" y2="132" stroke="#4a280f" stroke-width="2"/>
      <rect x="30" y="70" width="16" height="95" fill="url(#metal${u})" stroke="#5a4510" stroke-width="1.5"/>
      <rect x="164" y="70" width="16" height="95" fill="url(#metal${u})" stroke="#5a4510" stroke-width="1.5"/>
      <rect x="10" y="150" width="190" height="15" rx="6" fill="url(#metal${u})" stroke="#5a4510" stroke-width="1.5"/>
    </g>
    <g class="lid">
      <path d="M10 72 L10 40 Q10 8 105 8 Q200 8 200 40 L200 72 Z" fill="url(#woodLid${u})" stroke="#2b160a" stroke-width="3"/>
      <path d="M30 72 L30 20 Q38 12 46 11 L46 72 Z" fill="url(#metal${u})" stroke="#5a4510" stroke-width="1.5"/>
      <path d="M164 11 Q172 12 180 20 L180 72 L164 72 Z" fill="url(#metal${u})" stroke="#5a4510" stroke-width="1.5"/>
      <rect x="10" y="62" width="190" height="10" fill="url(#metal${u})" stroke="#5a4510" stroke-width="1.5"/>
      <rect x="90" y="56" width="30" height="34" rx="5" fill="url(#metal${u})" stroke="#5a4510" stroke-width="2"/>
      <circle cx="105" cy="70" r="5" fill="#2b160a"/>
      <rect x="103" y="72" width="4" height="10" fill="#2b160a"/>
    </g>
    <g class="cracks" stroke="var(--glow)" stroke-width="2.5" fill="none" stroke-linecap="round" style="filter:drop-shadow(0 0 4px var(--glow))">
      <polyline class="crack" points="60,80 70,95 64,108 76,124"/>
      <polyline class="crack" points="150,30 140,44 148,55"/>
      <polyline class="crack" points="130,90 120,104 132,118 124,140"/>
      <polyline class="crack" points="60,25 72,40 66,52"/>
      <polyline class="crack" points="95,110 105,122 98,138"/>
      <polyline class="crack" points="185,95 176,110 186,126"/>
      <polyline class="crack" points="22,90 30,104 22,116"/>
      <polyline class="crack" points="105,18 112,30 104,42"/>
    </g>
  </svg>`;

  let uid = 0;

  class ChestOpener {
    constructor() {
      const el = document.createElement('div');
      el.className = 'chest-overlay';
      el.innerHTML = `
        <canvas class="particles"></canvas>
        <div class="flash"></div>
        <div class="chest-clicks"></div>
        <div class="chest-stage">
          <div class="chest-rays"></div>
          <div class="chest-glow"></div>
          <div class="chest">${CHEST_SVG(++uid)}</div>
        </div>
        <div class="chest-hint"></div>
        <div class="reveal"></div>
        <div class="reveal-actions">
          <button class="gold next">Ouvrir le suivant</button>
          <button class="secondary close">Fermer</button>
        </div>
        <button class="secondary small mute" style="position:absolute;top:16px;right:16px"></button>`;
      document.body.appendChild(el);
      this.el = el;
      this.chestEl = el.querySelector('.chest');
      this.rays = el.querySelector('.chest-rays');
      this.glow = el.querySelector('.chest-glow');
      this.counter = el.querySelector('.chest-clicks');
      this.hint = el.querySelector('.chest-hint');
      this.flashEl = el.querySelector('.flash');
      this.revealEl = el.querySelector('.reveal');
      this.actions = el.querySelector('.reveal-actions');
      this.stage = el.querySelector('.chest-stage');
      this.particles = new Particles(el.querySelector('.particles'));
      this.cracks = [...el.querySelectorAll('.crack')];
      this.seam = el.querySelector('.seam');
      this.lid = el.querySelector('.lid');

      this.chestEl.addEventListener('pointerdown', (e) => { e.preventDefault(); this.click(); });
      el.querySelector('.close').onclick = () => this.close();
      el.querySelector('.next').onclick = () => this.onNext && this.onNext();
      const muteBtn = el.querySelector('.mute');
      const renderMute = () => { muteBtn.textContent = muted ? '🔇 Son coupé' : '🔊 Son'; };
      renderMute();
      muteBtn.onclick = () => {
        muted = !muted;
        try { localStorage.setItem('zl_muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
        renderMute();
      };
      document.addEventListener('keydown', (e) => {
        if (!this.el.classList.contains('open')) return;
        if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (this.result && !this.done) this.click(); }
        if (e.code === 'Escape' && this.done) this.close();
      });
    }

    /*
     * result = { items, bestRarity, clicks }
     * opts = { remaining, onNext, onClose }
     */
    show(result, opts = {}) {
      this.result = result;
      this.clicks = 0;
      this.done = false;
      this.onNext = opts.onNext;
      this.onClose = opts.onClose;
      this.tier = 'commun';
      this.setGlow('commun', 0);
      this.chestEl.classList.remove('burst');
      this.chestEl.style.display = '';
      this.stage.style.display = '';
      this.lid.style.transform = '';
      this.cracks.forEach((c) => { c.style.opacity = 0; });
      this.seam.setAttribute('opacity', 0);
      this.counter.textContent = '';
      this.hint.textContent = 'Clique sur le coffre ! (ou Espace)';
      this.revealEl.innerHTML = '';
      this.revealEl.classList.remove('show');
      this.actions.classList.remove('show');
      const next = this.el.querySelector('.next');
      next.style.display = opts.remaining > 0 ? '' : 'none';
      next.textContent = `Ouvrir le suivant (${opts.remaining} restant${opts.remaining > 1 ? 's' : ''})`;
      this.el.classList.add('open');
      this.rays.style.opacity = 0.15;
    }

    setGlow(rarity, intensity) {
      const c = GLOW[rarity];
      this.el.style.setProperty('--glow', c);
      this.chestEl.style.setProperty('--glowSize', 6 + intensity * 30 + 'px');
      this.glow.style.opacity = 0.25 + intensity * 0.6;
      this.glow.style.transform = `scale(${1 + intensity * 0.6})`;
      this.rays.style.opacity = 0.15 + intensity * 0.75;
    }

    center() {
      const r = this.chestEl.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    click() {
      if (!this.result || this.done) return;
      this.clicks += 1;
      const need = this.result.clicks;
      // La lumière suit le nombre de clics : blanc, vert (4), bleu (6), violet (11), orange (21).
      const tier = Rules.chestLightRarity(this.clicks);
      const progress = this.clicks / need;
      const intensity = Math.min(1, 0.15 + this.clicks / 30 + progress * 0.25);
      this.setGlow(tier, intensity);

      if (tier !== this.tier) {
        this.tier = tier;
        this.flash();
        sfx.tier(tier);
        const c = this.center();
        this.particles.spawn(c.x, c.y, GLOW[tier], 60, 1.4);
      }

      this.counter.textContent = this.clicks;
      this.counter.classList.remove('pop');
      void this.counter.offsetWidth;
      this.counter.classList.add('pop');
      setTimeout(() => this.counter.classList.remove('pop'), 100);

      this.chestEl.style.setProperty('--s', 3 + Math.min(this.clicks, 30) * 0.5);
      this.chestEl.classList.remove('shake');
      void this.chestEl.offsetWidth;
      this.chestEl.classList.add('shake');

      const shown = Math.ceil(progress * this.cracks.length);
      this.cracks.forEach((c, i) => { c.style.opacity = i < shown ? 1 : 0; });
      this.seam.setAttribute('opacity', Math.min(1, progress * 1.2));
      this.lid.style.transform = `translateY(${-progress * 4}px)`;

      const c = this.center();
      this.particles.spawn(c.x, c.y - 20, GLOW[tier], 8 + this.clicks, 0.7 + progress * 0.6);
      sfx.hit(this.clicks);

      if (this.clicks >= need) this.burst();
    }

    flash() {
      this.flashEl.classList.remove('go');
      void this.flashEl.offsetWidth;
      this.flashEl.classList.add('go');
    }

    burst() {
      this.done = true;
      const { bestRarity, items } = this.result;
      const c = this.center();
      this.hint.textContent = '';
      this.flash();
      sfx.burst(bestRarity);
      this.lid.style.transition = 'transform .5s cubic-bezier(.2,.8,.2,1)';
      this.lid.style.transform = 'translate(0,-120px) rotate(-25deg)';
      this.chestEl.classList.add('burst');
      this.particles.spawn(c.x, c.y, GLOW[bestRarity], 220, 2.2);
      setTimeout(() => this.particles.spawn(c.x, c.y, '#ffffff', 80, 1.6), 120);

      setTimeout(() => {
        this.stage.style.display = 'none';
        this.lid.style.transition = '';
        this.counter.textContent = '';
        this.revealEl.innerHTML = items.map((it) => itemHtml(it)).join('');
        this.revealEl.classList.add('show');
        const cards = [...this.revealEl.children];
        cards.forEach((card, i) => {
          setTimeout(() => {
            card.classList.add('in');
            sfx.card(items[i].rarity);
            const r = card.getBoundingClientRect();
            const idx = Rules.RARITIES.indexOf(items[i].rarity);
            if (idx >= 1) this.particles.spawn(r.left + r.width / 2, r.top + r.height / 2, GLOW[items[i].rarity], 30 * idx, 1 + idx * 0.2);
          }, 250 + i * 380);
        });
        setTimeout(() => this.actions.classList.add('show'), 250 + cards.length * 380);
      }, 550);
    }

    close() {
      this.el.classList.remove('open');
      this.result = null;
      if (this.onClose) this.onClose();
    }
  }

  window.ChestOpener = ChestOpener;
})();
