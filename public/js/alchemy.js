/*
 * Animation de l'Alchimie noire : l'objet sacrifié tombe dans le chaudron, trois bouillonnements
 * (bulles violettes + sons), puis l'objet renforcé apparaît et la ligne choisie monte en valeur.
 */
(function () {
  const CAULDRON_SVG = `
  <svg viewBox="0 0 260 190">
    <defs>
      <radialGradient id="alchLiquid" cx="50%" cy="40%" r="60%">
        <stop offset="0" stop-color="#d27bff"/><stop offset=".6" stop-color="#7a1fc9"/><stop offset="1" stop-color="#2d0a4e"/>
      </radialGradient>
      <linearGradient id="alchPot" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#3d3a4d"/><stop offset="1" stop-color="#121018"/>
      </linearGradient>
    </defs>
    <path d="M60 150 L45 182 M200 150 L215 182 M130 160 L130 188" stroke="#121018" stroke-width="10" stroke-linecap="round"/>
    <path d="M28 62 Q22 170 130 172 Q238 170 232 62 Z" fill="url(#alchPot)" stroke="#05040a" stroke-width="4"/>
    <ellipse cx="130" cy="62" rx="104" ry="20" fill="#1b1825" stroke="#05040a" stroke-width="4"/>
    <ellipse class="alch-liquid" cx="130" cy="64" rx="92" ry="14" fill="url(#alchLiquid)"/>
    <path d="M40 92 Q130 110 220 92" stroke="rgba(255,255,255,.08)" stroke-width="6" fill="none"/>
    <text x="130" y="135" text-anchor="middle" font-size="34" fill="rgba(210,123,255,.35)">☠</text>
  </svg>`;

  class AlchemyAnimator {
    constructor() {
      const el = document.createElement('div');
      el.className = 'forge-overlay alch-overlay';
      el.innerHTML = `
        <canvas class="particles"></canvas>
        <div class="flash"></div>
        <div class="alch-stage">
          <div class="alch-cauldron">${CAULDRON_SVG}</div>
        </div>
        <div class="forge-msg"></div>
        <div class="forge-result"></div>
        <div class="forge-actions"><button class="gold close">Continuer</button></div>
        <button class="secondary small mute" style="position:absolute;top:16px;right:16px"></button>`;
      document.body.appendChild(el);
      this.el = el;
      this.stage = el.querySelector('.alch-stage');
      this.cauldron = el.querySelector('.alch-cauldron');
      this.msg = el.querySelector('.forge-msg');
      this.result = el.querySelector('.forge-result');
      this.actions = el.querySelector('.forge-actions');
      this.flashEl = el.querySelector('.flash');
      this.particles = new window.ZLParticles(el.querySelector('.particles'));
      el.querySelector('.close').onclick = () => this.close();
      Sound.bindToggle(el.querySelector('.mute'));
    }

    mouth() {
      const r = this.cauldron.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.33 };
    }

    bubble(i) {
      const p = this.mouth();
      for (let k = 0; k < 3; k++) {
        this.particles.spawn(p.x + (Math.random() - 0.5) * 140, p.y, k % 2 ? '#d27bff' : '#5dff9b', 14 + i * 10, 0.7 + i * 0.25);
      }
      this.cauldron.classList.remove('boil');
      void this.cauldron.offsetWidth;
      this.cauldron.classList.add('boil');
      Sound.play('alchemyBubble', i);
    }

    /*
     * outcome : { item, index, old, line, gain, cap, sacrifice } renvoyé par le serveur.
     */
    play(outcome, playerCls, onClose) {
      this.onClose = onClose;
      this.el.style.setProperty('--glow', '#b14dff');
      this.msg.textContent = 'Le chaudron frémit…';
      this.result.classList.remove('show');
      this.result.innerHTML = '';
      this.actions.classList.remove('show');
      this.stage.querySelectorAll('.forge-item').forEach((n) => n.remove());
      this.el.classList.add('open');

      const sac = outcome.sacrifice;
      const tile = document.createElement('div');
      tile.className = 'forge-item';
      tile.textContent = itemType(sac).icon;
      tile.style.borderColor = Rules.RARITY_INFO[sac.rarity].color;
      tile.style.boxShadow = `0 0 14px ${Rules.RARITY_INFO[sac.rarity].color}`;
      tile.style.left = '98px';
      tile.style.top = '-70px';
      this.stage.appendChild(tile);
      Sound.play('chestAppear');

      setTimeout(() => {
        tile.style.transform = 'translateY(110px) scale(.3) rotate(220deg)';
        tile.style.opacity = '0';
        this.msg.textContent = `${sac.name} se dissout…`;
      }, 500);
      [1200, 1700, 2200].forEach((at, i) => setTimeout(() => {
        this.bubble(i);
        this.msg.textContent = ['Blub…', 'Bloub… bloub…', 'BLOUBBB !'][i];
      }, at));
      setTimeout(() => this.reveal(outcome, playerCls), 2800);
    }

    reveal(outcome, playerCls) {
      const { item, index, old, line, gain } = outcome;
      this.flashEl.classList.remove('go');
      void this.flashEl.offsetWidth;
      this.flashEl.classList.add('go');
      const p = this.mouth();
      this.particles.spawn(p.x, p.y, '#d27bff', 160, 2);
      Sound.play('alchemyResult');
      const info = Rules.STAT_INFO[line.stat];
      this.msg.innerHTML = `⚗️ ${info.icon} ${info.label} <b class="alch-gain">+${gain}</b>`;
      this.result.innerHTML = itemHtml(item, '', playerCls);
      this.result.classList.add('show');
      // La ligne renforcée s'illumine et sa valeur monte de l'ancienne à la nouvelle.
      const li = this.result.querySelectorAll('li')[index];
      if (li) {
        li.classList.add('alch-up');
        let v = old;
        const step = () => {
          v += 1;
          li.innerHTML = `${Rules.formatLine(line.stat, Math.min(v, line.value))} <span class="alch-mark">⚗️</span>`;
          if (v < line.value) setTimeout(step, 220);
        };
        li.innerHTML = `${Rules.formatLine(line.stat, old)} <span class="alch-mark">⚗️</span>`;
        setTimeout(step, 350);
      }
      setTimeout(() => this.actions.classList.add('show'), 700);
    }

    close() {
      this.el.classList.remove('open');
      if (this.onClose) this.onClose();
    }
  }

  window.AlchemyAnimator = AlchemyAnimator;
})();
