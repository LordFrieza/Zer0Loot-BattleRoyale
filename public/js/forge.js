/*
 * Animation de la forge : les 3 objets plongent dans l'enclume, trois coups de marteau
 * (étincelles + sons), puis le nouvel objet apparaît dans la couleur de sa rareté.
 */
(function () {
  const GLOW = {
    commun: '#ffffff', peu_commun: '#3ddc5a', rare: '#3b8bff', epique: '#b14dff', legendaire: '#ff9a1f',
  };

  const ANVIL_SVG = `
  <svg viewBox="0 0 260 150">
    <defs>
      <linearGradient id="anvilG" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#8a8fa3"/><stop offset="1" stop-color="#3b3e4c"/>
      </linearGradient>
    </defs>
    <path d="M10 20 L200 20 Q250 22 255 40 Q215 42 200 55 L180 70 L180 95 L215 120 L215 140 L45 140 L45 120 L80 95 L80 70 Q40 60 30 45 Q12 40 10 20 Z"
      fill="url(#anvilG)" stroke="#1a1626" stroke-width="3"/>
    <rect x="18" y="18" width="182" height="8" rx="3" fill="rgba(255,255,255,.35)"/>
    <ellipse class="anvil-heat" cx="120" cy="22" rx="70" ry="7" fill="var(--glow, #ff7a1f)" opacity="0"/>
  </svg>`;

  const HAMMER_SVG = `
  <svg viewBox="0 0 120 120">
    <rect x="62" y="20" width="10" height="95" rx="4" fill="#7a5530" stroke="#2b160a" stroke-width="2" transform="rotate(35 67 67)"/>
    <rect x="20" y="10" width="62" height="34" rx="6" fill="#9aa0b5" stroke="#1a1626" stroke-width="3" transform="rotate(35 67 67)"/>
  </svg>`;

  class ForgeAnimator {
    constructor() {
      const el = document.createElement('div');
      el.className = 'forge-overlay';
      el.innerHTML = `
        <canvas class="particles"></canvas>
        <div class="flash"></div>
        <div class="forge-stage">
          <div class="forge-anvil">${ANVIL_SVG}</div>
          <div class="forge-hammer">${HAMMER_SVG}</div>
        </div>
        <div class="forge-msg"></div>
        <div class="forge-result"></div>
        <div class="forge-actions"><button class="gold close">Continuer</button></div>
        <button class="secondary small mute" style="position:absolute;top:16px;right:16px"></button>`;
      document.body.appendChild(el);
      this.el = el;
      this.stage = el.querySelector('.forge-stage');
      this.anvil = el.querySelector('.forge-anvil');
      this.heat = el.querySelector('.anvil-heat');
      this.hammer = el.querySelector('.forge-hammer');
      this.msg = el.querySelector('.forge-msg');
      this.result = el.querySelector('.forge-result');
      this.actions = el.querySelector('.forge-actions');
      this.flashEl = el.querySelector('.flash');
      this.particles = new window.ZLParticles(el.querySelector('.particles'));
      el.querySelector('.close').onclick = () => this.close();
      Sound.bindToggle(el.querySelector('.mute'));
    }

    anvilTop() {
      const r = this.anvil.getBoundingClientRect();
      return { x: r.left + r.width * 0.46, y: r.top + r.height * 0.15 };
    }

    flash(color) {
      this.el.style.setProperty('--glow', color);
      this.flashEl.classList.remove('go');
      void this.flashEl.offsetWidth;
      this.flashEl.classList.add('go');
    }

    /*
     * inputs : les 3 objets détruits ; outcome : { item, upgraded, from } renvoyé par le serveur.
     */
    play(inputs, outcome, playerCls, onClose) {
      this.onClose = onClose;
      this.el.style.setProperty('--glow', '#ff7a1f');
      this.anvil.style.setProperty('--fg', '6px');
      this.heat.setAttribute('opacity', 0);
      this.msg.textContent = 'La forge chauffe…';
      this.result.classList.remove('show');
      this.result.innerHTML = '';
      this.actions.classList.remove('show');
      this.stage.querySelectorAll('.forge-item').forEach((n) => n.remove());
      this.el.classList.add('open');

      // Les 3 objets apparaissent au-dessus de l'enclume…
      const tiles = inputs.map((item, i) => {
        const t = document.createElement('div');
        t.className = 'forge-item';
        t.textContent = itemType(item).icon;
        t.style.borderColor = GLOW[item.rarity];
        t.style.boxShadow = `0 0 14px ${GLOW[item.rarity]}`;
        t.style.left = 70 + i * 110 + 'px';
        t.style.top = '10px';
        this.stage.appendChild(t);
        return t;
      });
      Sound.play('chestAppear');

      // … puis plongent dans le feu.
      setTimeout(() => {
        tiles.forEach((t, i) => {
          const dx = 178 - (70 + i * 110);
          t.style.transform = `translate(${dx}px, 150px) scale(.3) rotate(${(i - 1) * 40}deg)`;
          t.style.opacity = '0';
        });
      }, 450);

      const strikes = [1200, 1650, 2100];
      strikes.forEach((at, i) => setTimeout(() => {
        this.hammer.classList.remove('strike');
        void this.hammer.offsetWidth;
        this.hammer.classList.add('strike');
        setTimeout(() => {
          Sound.play('anvil', i);
          const p = this.anvilTop();
          this.particles.spawn(p.x, p.y, '#ffb347', 30 + i * 15, 1 + i * 0.25);
          this.heat.setAttribute('opacity', 0.3 + i * 0.25);
          this.anvil.style.setProperty('--fg', 10 + i * 10 + 'px');
          this.msg.textContent = ['Bam !', 'BAM !', 'BAAAM !'][i];
        }, 170);
      }, at));

      setTimeout(() => this.reveal(outcome, playerCls), 2700);
    }

    reveal(outcome, playerCls) {
      const { item, upgraded, from } = outcome;
      const color = GLOW[item.rarity];
      this.flash(color);
      this.anvil.style.setProperty('--fg', '40px');
      this.heat.setAttribute('opacity', 1);
      Sound.play('forgeResult', upgraded, item.rarity);
      const p = this.anvilTop();
      this.particles.spawn(p.x, p.y, color, upgraded ? 220 : 90, upgraded ? 2.2 : 1.4);
      this.msg.innerHTML = upgraded
        ? `✨ AMÉLIORATION ! <span class="c-${from}">${Rules.RARITY_INFO[from].label}</span> → <span class="c-${item.rarity}">${Rules.RARITY_INFO[item.rarity].label}</span>`
        : `Nouvel objet <span class="c-${item.rarity}">${Rules.RARITY_INFO[item.rarity].label}</span> forgé`;
      this.result.innerHTML = itemHtml(item, '', playerCls);
      this.result.classList.add('show');
      setTimeout(() => this.actions.classList.add('show'), 500);
    }

    close() {
      this.el.classList.remove('open');
      if (this.onClose) this.onClose();
    }
  }

  window.ForgeAnimator = ForgeAnimator;
})();
