/*
 * Les six jeux du casino (fenêtre de jeu de casino.js). Chaque jeu : mount(corps, outils) / unmount().
 * Le serveur décide de tout ; ici, on anime le résultat qu'il a renvoyé.
 */
(function () {
  const C = Rules.CASINO;
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const easeOutBack = (p) => { const c1 = 1.2; const c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
  let alive = 0; // jeton du jeu affiché (une animation d'un jeu fermé s'arrête d'elle-même)

  // ---------- Machine à sous (Pyrax) ----------
  const SYM = C.slots.symbols;
  const SYM_IDS = Object.keys(SYM);
  const SYM_W = SYM_IDS.reduce((a, k) => a + SYM[k].weight, 0);
  function randSym() {
    let r = Math.random() * SYM_W;
    for (const k of SYM_IDS) { r -= SYM[k].weight; if (r < 0) return k; }
    return SYM_IDS[0];
  }
  const SH = 84; // hauteur d'un symbole

  const slots = {
    mount(body, A) {
      const token = ++alive;
      body.innerHTML = `
        <div class="slots-wrap">
          <div class="slots-machine">
            <div class="slots-marquee"><span>🔥</span> PYRAX 777 <span>🔥</span></div>
            <div class="slots-lights">${Array.from({ length: 18 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
            <div class="slots-window">
              ${[0, 1, 2].map(() => '<div class="slots-reel"><div class="slots-strip"></div></div>').join('')}
              <div class="slots-payline"></div>
            </div>
            <div class="slots-msg">Tire le levier !</div>
          </div>
          <button type="button" class="slots-lever" title="Tirer le levier (Espace)"><span class="lever-stick"></span><span class="lever-knob"></span></button>
        </div>
        <div class="casino-controls"><div class="casino-bets"></div><button class="gold big-btn" data-go>🎰 Lancer</button></div>
        <div class="casino-pay">${SYM_IDS.map((k) => `<span><b>${SYM[k].icon}${SYM[k].icon}${SYM[k].icon}</b> ×${SYM[k].pays}${k === 'sept' ? ' <em>JACKPOT</em>' : ''}</span>`).join('')}
          <span><b>🍒🍒</b> ×${C.slots.cherries}</span></div>`;
      const bet = A.betPicker(body.querySelector('.casino-bets'), 'slots');
      const reels = [...body.querySelectorAll('.slots-reel')];
      const strips = reels.map((r) => r.querySelector('.slots-strip'));
      const msg = body.querySelector('.slots-msg');
      const win = body.querySelector('.slots-window');
      const lever = body.querySelector('.slots-lever');
      const go = body.querySelector('[data-go]');
      const shown = [randSym(), randSym(), randSym()];
      const fill = (strip, list) => { strip.innerHTML = list.map((k) => `<div class="slots-sym" data-s="${k}">${SYM[k].icon}</div>`).join(''); };
      strips.forEach((s, i) => { fill(s, [randSym(), shown[i], randSym()]); s.style.transform = 'translateY(0)'; });

      async function spin() {
        if (go.disabled) return;
        const stake = bet.value;
        lever.classList.remove('pull'); void lever.offsetWidth; lever.classList.add('pull');
        Sound.play('lever');
        go.disabled = true;
        const r = await A.call('/api/casino/slots', { bet: stake }, stake);
        if (!r) { go.disabled = false; return; }
        win.classList.remove('win', 'jackpot');
        msg.textContent = '…';
        // Chaque rouleau : une longue bande qui défile et s'arrête sur le symbole tiré (au milieu).
        await Promise.all(strips.map((strip, i) => new Promise((done) => {
          const n = 26 + i * 9;
          const list = [strip.children[0] ? strip.children[0].dataset.s : randSym(), shown[i]];
          while (list.length < n) list.push(randSym());
          list.push(r.reels[i], randSym());
          fill(strip, list);
          const target = (list.length - 3) * SH;
          const dur = 1250 + i * 520;
          const t0 = performance.now();
          let lastTick = 0;
          reels[i].classList.add('spinning');
          const step = (now) => {
            if (token !== alive) return done();
            const p = Math.min(1, (now - t0) / dur);
            const y = target * (p < 1 ? easeOutBack(p) : 1);
            strip.style.transform = `translateY(${-y}px)`;
            const k = Math.floor(y / SH);
            if (k !== lastTick) { lastTick = k; if (p < 0.92) Sound.play('casinoTick', i * 3); }
            if (p < 1) requestAnimationFrame(step);
            else {
              reels[i].classList.remove('spinning');
              reels[i].classList.add('stop');
              setTimeout(() => reels[i].classList.remove('stop'), 300);
              Sound.play('reelStop', i);
              shown[i] = r.reels[i];
              done();
            }
          };
          requestAnimationFrame(step);
        })));
        if (token !== alive) return;
        // Les symboles gagnants clignotent
        strips.forEach((strip, i) => {
          const mid = strip.children[strip.children.length - 2];
          if (r.kind === 'cerises' ? r.reels[i] === 'cerise' : r.mult > 0) mid.classList.add('hit');
        });
        if (r.payout > 0) {
          win.classList.add(r.kind === 'jackpot' ? 'jackpot' : 'win');
          msg.innerHTML = r.kind === 'jackpot' ? `💥 JACKPOT ! +${fmt(r.payout)} 🪙` : `Gagné ! ×${r.mult} → <b>+${fmt(r.payout)} 🪙</b>`;
        } else msg.textContent = 'Perdu… retente ta chance !';
        A.settle(r.payout, stake, { jackpot: r.kind === 'jackpot', banner: r.kind === 'jackpot' ? `💥 JACKPOT ! +${fmt(r.payout)} 🪙` : null });
        go.disabled = false;
      }
      go.onclick = spin;
      lever.onclick = spin;
      this.key = (e) => { if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); spin(); } };
      document.addEventListener('keydown', this.key);
    },
    unmount() { alive++; document.removeEventListener('keydown', this.key); },
  };

  // ---------- Blackjack (Maexxna) ----------
  const RED = ['♥', '♦'];
  function cardHtml(c, hidden) {
    if (!c || c.hidden || hidden) return '<div class="pcard back"><div class="pc-back"></div></div>';
    const red = RED.includes(c.s) ? 'red' : '';
    return `<div class="pcard ${red}"><span class="pc-r">${c.r}<br>${c.s}</span><span class="pc-big">${c.s}</span><span class="pc-r br">${c.r}<br>${c.s}</span></div>`;
  }
  const OUTCOME = {
    blackjack: ['BLACKJACK !', 'win'], win: ['Gagné !', 'win'], push: ['Égalité', 'push'], lose: ['Perdu', 'lose'], bust: ['Dépassé !', 'lose'],
  };

  const blackjack = {
    mount(body, A) {
      const token = ++alive;
      body.innerHTML = `
        <div class="bj-table">
          <div class="bj-deck"><div class="pcard back"><div class="pc-back"></div></div><div class="pcard back"><div class="pc-back"></div></div></div>
          <div class="bj-row"><div class="bj-label">Banque <span class="bj-val" data-dv></span></div><div class="bj-hand" data-dealer></div></div>
          <div class="bj-center" data-msg>La banque reste sur 17 · Blackjack payé 3 pour 2</div>
          <div class="bj-row"><div class="bj-hand" data-player></div><div class="bj-label">Toi <span class="bj-val" data-pv></span></div></div>
        </div>
        <div class="casino-controls">
          <div class="casino-bets"></div>
          <button class="gold big-btn" data-deal>🃏 Distribuer</button>
          <div class="bj-actions">
            <button class="big-btn" data-hit>➕ Tirer</button>
            <button class="secondary big-btn" data-stand>✋ Rester</button>
            <button class="secondary big-btn" data-double>✖2 Doubler</button>
          </div>
        </div>`;
      const bet = A.betPicker(body.querySelector('.casino-bets'), 'blackjack');
      const dealerEl = body.querySelector('[data-dealer]');
      const playerEl = body.querySelector('[data-player]');
      const dv = body.querySelector('[data-dv]');
      const pv = body.querySelector('[data-pv]');
      const msg = body.querySelector('[data-msg]');
      const dealBtn = body.querySelector('[data-deal]');
      const actions = body.querySelector('.bj-actions');
      const betsEl = body.querySelector('.casino-bets');
      let view = null;
      const valText = (v) => (v ? `${v.total}${v.soft && v.total < 21 ? ' (souple)' : ''}` : '');

      function setMode(playing) {
        dealBtn.style.display = playing ? 'none' : '';
        betsEl.style.display = playing ? 'none' : '';
        actions.style.display = playing ? '' : 'none';
        if (playing && view) {
          const dbl = actions.querySelector('[data-double]');
          dbl.disabled = !view.canDouble || A.gold < view.bet;
          dbl.textContent = `✖2 Doubler (+${fmt(view.bet)})`;
        }
      }
      function addCard(el, c, hidden) {
        el.insertAdjacentHTML('beforeend', cardHtml(c, hidden));
        const node = el.lastElementChild;
        node.classList.add('deal');
        Sound.play('cardDeal');
        return node;
      }
      async function reveal(r) {
        // Carte cachée retournée, puis les cartes tirées par la banque une à une
        const hole = dealerEl.children[1];
        if (hole && hole.classList.contains('back') && r.dealer[1]) {
          hole.outerHTML = cardHtml(r.dealer[1]);
          dealerEl.children[1].classList.add('flip');
          Sound.play('cardFlip');
          await sleep(450);
        }
        for (let i = dealerEl.children.length; i < r.dealer.length; i++) {
          if (token !== alive) return;
          addCard(dealerEl, r.dealer[i]);
          dv.textContent = valText(Rules.bjValue(r.dealer.slice(0, i + 1)));
          await sleep(520);
        }
        dv.textContent = valText(r.dealerValue);
      }
      async function finishHand(r) {
        await reveal(r);
        if (token !== alive) return;
        const [text, cls] = OUTCOME[r.outcome];
        msg.innerHTML = `<b class="bj-out ${cls}">${text}</b>${r.payout ? ` <span class="gold-text">+${fmt(r.payout)} 🪙</span>` : ''}`;
        A.setSession('blackjack', null);
        A.settle(r.payout, r.bet, { win: r.payout > r.bet, banner: r.outcome === 'blackjack' ? `🃏 BLACKJACK ! +${fmt(r.payout)} 🪙` : null });
        view = null;
        setMode(false);
      }
      function drawStatic(r) {
        dealerEl.innerHTML = r.dealer.map((c) => cardHtml(c)).join('');
        playerEl.innerHTML = r.player.map((c) => cardHtml(c)).join('');
        dv.textContent = valText(r.dealerValue);
        pv.textContent = valText(r.playerValue);
      }

      dealBtn.onclick = async () => {
        const stake = bet.value;
        const r = await A.call('/api/casino/blackjack/deal', { bet: stake }, stake);
        if (!r) return;
        dealerEl.innerHTML = '';
        playerEl.innerHTML = '';
        dv.textContent = '';
        pv.textContent = '';
        msg.textContent = '';
        view = r;
        // Distribution : joueur, banque, joueur, banque (face cachée)
        const order = [[playerEl, r.player[0]], [dealerEl, r.dealer[0]], [playerEl, r.player[1]], [dealerEl, { hidden: true }]];
        for (const [el, c] of order) {
          if (token !== alive) return;
          addCard(el, c);
          await sleep(330);
        }
        pv.textContent = valText(r.playerValue);
        dv.textContent = valText(Rules.bjValue([r.dealer[0]]));
        if (r.outcome) return finishHand(r);
        A.setSession('blackjack', r);
        A.idle();
        setMode(true);
        A.say(r.playerValue.total >= 17 ? 'Ssss… tu tentes le diable ?' : 'Tirer… ou rester ?');
      };
      async function step(url) {
        if (!view) return;
        const stake = url.endsWith('double') ? view.bet : 0;
        actions.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        const r = await A.call(url, {}, stake);
        actions.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        if (!r) return;
        for (let i = playerEl.children.length; i < r.player.length; i++) {
          addCard(playerEl, r.player[i]);
          pv.textContent = valText(Rules.bjValue(r.player.slice(0, i + 1)));
          await sleep(380);
        }
        view = r;
        if (r.outcome) return finishHand(r);
        A.setSession('blackjack', r);
        A.idle();
        setMode(true);
      }
      actions.querySelector('[data-hit]').onclick = () => step('/api/casino/blackjack/hit');
      actions.querySelector('[data-stand]').onclick = () => step('/api/casino/blackjack/stand');
      actions.querySelector('[data-double]').onclick = () => step('/api/casino/blackjack/double');
      // Main en cours (page rechargée, fenêtre refermée)
      const resume = A.sessions().blackjack;
      if (resume) { view = resume; drawStatic(resume); msg.textContent = 'Ta main en cours t\'attendait.'; setMode(true); } else setMode(false);
    },
    unmount() { alive++; },
  };

  // ---------- Roulette (Grokk) ----------
  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const COLOR = { rouge: '#c4122f', noir: '#16131f', vert: '#138a43' };
  const BET_LABEL = { rouge: 'Rouge', noir: 'Noir', pair: 'Pair', impair: 'Impair', manque: '1-18', passe: '19-36', d1: '1-12', d2: '13-24', d3: '25-36', c1: '2:1', c2: '2:1', c3: '2:1' };

  function drawWheel(ctx, size, angle, ball) {
    const R = size / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(R, R);
    // bord en bois
    ctx.fillStyle = '#5a3416';
    ctx.beginPath(); ctx.arc(0, 0, R - 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c99a3a';
    ctx.beginPath(); ctx.arc(0, 0, R - 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a1608';
    ctx.beginPath(); ctx.arc(0, 0, R - 16, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(angle);
    const n = WHEEL.length;
    const seg = (Math.PI * 2) / n;
    for (let i = 0; i < n; i++) {
      const num = WHEEL[i];
      ctx.fillStyle = COLOR[Rules.rouletteColor(num)];
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R - 18, i * seg - seg / 2 - Math.PI / 2, i * seg + seg / 2 - Math.PI / 2); ctx.closePath(); ctx.fill();
      ctx.save();
      ctx.rotate(i * seg);
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.round(size / 26)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(String(num), 0, -(R - 30));
      ctx.restore();
    }
    // séparateurs et centre doré
    ctx.strokeStyle = 'rgba(255, 215, 120, .6)';
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) { ctx.save(); ctx.rotate(i * seg + seg / 2); ctx.beginPath(); ctx.moveTo(0, -(R * 0.42)); ctx.lineTo(0, -(R - 18)); ctx.stroke(); ctx.restore(); }
    ctx.fillStyle = '#7a1a2a';
    ctx.beginPath(); ctx.arc(0, 0, R * 0.42, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, R * 0.3);
    g.addColorStop(0, '#ffe27a'); g.addColorStop(1, '#a8762a');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.28, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < 4; k++) { ctx.save(); ctx.rotate((k * Math.PI) / 2); ctx.fillStyle = '#ffe27a'; ctx.fillRect(-3, -R * 0.4, 6, R * 0.2); ctx.restore(); }
    ctx.restore();
    if (ball) {
      ctx.save();
      ctx.translate(R, R);
      const bx = Math.cos(ball.a - Math.PI / 2) * ball.r;
      const by = Math.sin(ball.a - Math.PI / 2) * ball.r;
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath(); ctx.arc(bx + 2, by + 2, 6, 0, Math.PI * 2); ctx.fill();
      const bg = ctx.createRadialGradient(bx - 2, by - 2, 1, bx, by, 6);
      bg.addColorStop(0, '#fff'); bg.addColorStop(1, '#bbb');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  const roulette = {
    mount(body, A) {
      const token = ++alive;
      const nums = [];
      for (let col = 0; col < 12; col++) for (let row = 0; row < 3; row++) nums.push(col * 3 + (3 - row));
      body.innerHTML = `
        <div class="rl-wrap">
          <div class="rl-wheel"><canvas width="320" height="320"></canvas><div class="rl-result" data-res></div></div>
          <div class="rl-side">
            <div class="rl-board">
              <button class="rl-cell zero" data-on="n:0">0</button>
              <div class="rl-nums">${[3, 2, 1].map((top) => Array.from({ length: 12 }, (_, c) => c * 3 + top).map((n) => `<button class="rl-cell ${Rules.rouletteColor(n)}" data-on="n:${n}">${n}</button>`).join('')).join('')}</div>
              <div class="rl-cols"><button class="rl-cell out" data-on="c3">2:1</button><button class="rl-cell out" data-on="c2">2:1</button><button class="rl-cell out" data-on="c1">2:1</button></div>
              <div class="rl-dozens">${['d1', 'd2', 'd3'].map((d) => `<button class="rl-cell out" data-on="${d}">${BET_LABEL[d]}</button>`).join('')}</div>
              <div class="rl-simple">${['manque', 'pair', 'rouge', 'noir', 'impair', 'passe'].map((d) => `<button class="rl-cell out ${d === 'rouge' || d === 'noir' ? d : ''}" data-on="${d}">${d === 'rouge' ? '◆' : d === 'noir' ? '◆' : BET_LABEL[d]}</button>`).join('')}</div>
            </div>
            <div class="rl-history" data-hist></div>
          </div>
        </div>
        <div class="casino-controls">
          <div class="casino-bets rl-chips"><span class="muted">Jeton :</span>${C.roulette.chips.map((v) => `<button type="button" class="casino-chip chip-${v}" data-chip="${v}">${v}</button>`).join('')}</div>
          <span class="rl-total" data-total></span>
          <button class="secondary small" data-clear>Effacer</button>
          <button class="gold big-btn" data-go>🎡 Lancer la bille</button>
        </div>
        <div class="casino-pay"><span>Numéro ×36</span><span>Douzaine / colonne ×3</span><span>Rouge, noir, pair, impair, 1-18, 19-36 ×2</span><span class="muted">Le 0 vert fait perdre les chances simples</span></div>`;
      const canvas = body.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      const res = body.querySelector('[data-res]');
      const totalEl = body.querySelector('[data-total]');
      const go = body.querySelector('[data-go]');
      const hist = body.querySelector('[data-hist]');
      let chip = C.roulette.chips[0];
      let bets = []; // { on, amount } : un jeton par pari
      let angle = 0;
      let history = [];
      drawWheel(ctx, 320, angle, null);
      const chipsEl = body.querySelector('.rl-chips');
      const syncChips = () => chipsEl.querySelectorAll('[data-chip]').forEach((b) => b.classList.toggle('active', Number(b.dataset.chip) === chip));
      chipsEl.querySelectorAll('[data-chip]').forEach((b) => { b.onclick = () => { chip = Number(b.dataset.chip); Sound.play('chip'); syncChips(); }; });
      syncChips();
      function renderBets() {
        const sums = {};
        for (const b of bets) sums[b.on] = (sums[b.on] || 0) + b.amount;
        body.querySelectorAll('.rl-cell').forEach((cell) => {
          const v = sums[cell.dataset.on];
          let tok = cell.querySelector('.rl-token');
          if (v) {
            if (!tok) { tok = document.createElement('span'); tok.className = 'rl-token'; cell.appendChild(tok); }
            tok.textContent = v;
          } else if (tok) tok.remove();
        });
        const total = bets.reduce((a, b) => a + b.amount, 0);
        totalEl.innerHTML = total ? `Mise : <b>${fmt(total)} 🪙</b> <span class="muted">(${bets.length}/${C.roulette.maxBets} jetons)</span>` : '<span class="muted">Clique sur le tapis pour miser</span>';
        go.disabled = !total;
      }
      body.querySelectorAll('.rl-cell').forEach((cell) => {
        cell.onclick = () => {
          if (go.dataset.spinning) return;
          const total = bets.reduce((a, b) => a + b.amount, 0);
          if (bets.length >= C.roulette.maxBets) return toast(`⚠️ ${C.roulette.maxBets} jetons au plus`);
          if (total + chip > C.maxBet) return toast(`⚠️ ${C.maxBet} golds au plus par lancer`);
          if (total + chip > A.gold) return toast('⚠️ Pas assez de golds');
          bets.push({ on: cell.dataset.on, amount: chip });
          body.querySelectorAll('.rl-cell.won').forEach((c) => c.classList.remove('won'));
          Sound.play('chip');
          renderBets();
        };
        cell.oncontextmenu = (e) => {
          e.preventDefault();
          const i = bets.map((b) => b.on).lastIndexOf(cell.dataset.on);
          if (i >= 0 && !go.dataset.spinning) { bets.splice(i, 1); renderBets(); }
        };
      });
      body.querySelector('[data-clear]').onclick = () => { if (!go.dataset.spinning) { bets = []; renderBets(); } };
      renderBets();

      go.onclick = async () => {
        if (!bets.length || go.dataset.spinning) return;
        const stake = bets.reduce((a, b) => a + b.amount, 0);
        go.dataset.spinning = '1';
        go.disabled = true;
        const r = await A.call('/api/casino/roulette', { bets }, stake);
        if (!r) { delete go.dataset.spinning; go.disabled = false; return; }
        A.say('GROKK LANCER BILLE !');
        res.classList.remove('show');
        // La roue tourne et ralentit ; la bille tourne en sens inverse, descend et tombe dans la case tirée.
        const seg = (Math.PI * 2) / WHEEL.length;
        const pocket = WHEEL.indexOf(r.number) * seg;
        const dur = 5600;
        const w0 = angle;
        const w1 = w0 + Math.PI * 2 * 3 + Math.random() * Math.PI;
        const rel0 = Math.random() * Math.PI * 2;
        const rel1 = pocket - Math.PI * 2 * 5; // la bille fait 5 tours de plus que la roue, en sens inverse
        const R0 = 145;
        const R1 = 96;
        const t0 = performance.now();
        let lastSeg = null;
        await new Promise((done) => {
          const frame = (now) => {
            if (token !== alive) return done();
            const p = Math.min(1, (now - t0) / dur);
            angle = w0 + (w1 - w0) * easeOut(p);
            const pb = Math.min(1, p / 0.82);
            const rel = rel0 + (rel1 - rel0) * (1 - Math.pow(1 - pb, 2.4));
            const drop = Math.max(0, Math.min(1, (p - 0.55) / 0.27));
            const bounce = drop > 0 && drop < 1 ? Math.sin(drop * Math.PI * 3) * 6 * (1 - drop) : 0;
            const radius = R0 - (R0 - R1) * drop + bounce;
            drawWheel(ctx, 320, angle, { a: angle + rel, r: radius });
            const s = Math.floor(rel / seg);
            if (s !== lastSeg) { lastSeg = s; if (p < 0.85) Sound.play('casinoTick', 6); }
            if (p < 1) requestAnimationFrame(frame); else done();
          };
          requestAnimationFrame(frame);
        });
        if (token !== alive) return;
        angle %= Math.PI * 2;
        Sound.play('reelStop', 2);
        res.innerHTML = `<span style="background:${COLOR[r.color]}">${r.number}</span>`;
        res.classList.add('show');
        history = [r.number, ...history].slice(0, 12);
        hist.innerHTML = history.map((n) => `<span style="background:${COLOR[Rules.rouletteColor(n)]}">${n}</span>`).join('');
        body.querySelectorAll('.rl-cell').forEach((cell) => cell.classList.toggle('won', r.wins.includes(cell.dataset.on) || cell.dataset.on === `n:${r.number}`));
        A.settle(r.payout, stake);
        bets = [];
        renderBets();
        delete go.dataset.spinning;
      };
    },
    unmount() { alive++; },
  };

  // ---------- Caisse de Grignotor ----------
  const LOOT = C.caisse.loot;
  const TIERS = C.caisse.tiers;
  const TILE = 118;
  function randLot() {
    // Affichage : les lots incroyables passent un peu plus souvent devant les yeux (pur suspense, sans effet sur le tirage).
    const w = LOOT.map((l) => l.weight * (l.tier === 'incroyable' ? 8 : 1));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < LOOT.length; i++) { r -= w[i]; if (r < 0) return LOOT[i]; }
    return LOOT[0];
  }
  const tileHtml = (l) => `<div class="cs-tile tier-${l.tier}" style="--tc:${TIERS[l.tier].color}"><div class="cs-ico">${l.icon}</div><div class="cs-lbl">${l.label}</div></div>`;

  const caisse = {
    mount(body, A) {
      const token = ++alive;
      const total = LOOT.reduce((a, l) => a + l.weight, 0);
      body.innerHTML = `
        <div class="cs-view"><div class="cs-strip"></div><div class="cs-marker"></div></div>
        <div class="cs-result" data-res><span class="muted">Chaque caisse cache un lot… lequel ?</span></div>
        <div class="casino-controls"><button class="gold big-btn" data-go>🎁 Ouvrir une caisse (${C.caisse.price} 🪙)</button></div>
        <div class="cs-odds">${Object.entries(TIERS).map(([t, T]) => `<div class="cs-odds-col" style="--tc:${T.color}"><b>${T.label}</b>
          ${LOOT.filter((l) => l.tier === t).map((l) => `<span>${l.icon} ${l.label} <em>${(l.weight / total * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</em></span>`).join('')}</div>`).join('')}</div>`;
      const view = body.querySelector('.cs-view');
      const strip = body.querySelector('.cs-strip');
      const resEl = body.querySelector('[data-res]');
      const go = body.querySelector('[data-go]');
      const idle = () => { strip.style.transition = 'none'; strip.style.transform = 'translateX(0)'; strip.innerHTML = Array.from({ length: 12 }, randLot).map(tileHtml).join(''); };
      idle();
      go.onclick = async () => {
        if (go.disabled) return;
        go.disabled = true;
        const r = await A.call('/api/casino/caisse', {}, C.caisse.price);
        if (!r) { go.disabled = false; return; }
        const WIN = 52;
        const lots = Array.from({ length: WIN + 6 }, randLot);
        lots[WIN] = LOOT.find((l) => l.id === r.lot.id);
        strip.style.transition = 'none';
        strip.style.transform = 'translateX(0)';
        strip.innerHTML = lots.map(tileHtml).join('');
        resEl.innerHTML = '<span class="muted">…</span>';
        void strip.offsetWidth;
        const center = view.clientWidth / 2;
        const jitter = (Math.random() - 0.5) * TILE * 0.7;
        const target = WIN * TILE + TILE / 2 - center + jitter;
        const dur = 6200;
        strip.style.transition = `transform ${dur}ms cubic-bezier(0.06, 0.62, 0.1, 1)`;
        strip.style.transform = `translateX(${-target}px)`;
        // Cliquetis à chaque lot qui passe sous le repère
        let last = -1;
        const t0 = performance.now();
        await new Promise((done) => {
          const tick = (now) => {
            if (token !== alive) return done();
            const m = new DOMMatrixReadOnly(getComputedStyle(strip).transform);
            const k = Math.floor((-m.m41 + center) / TILE);
            if (k !== last) { last = k; Sound.play('casinoTick', 2); }
            if (now - t0 < dur + 50) requestAnimationFrame(tick); else done();
          };
          requestAnimationFrame(tick);
        });
        if (token !== alive) return;
        const tile = strip.children[WIN];
        tile.classList.add('won');
        const tr = tile.getBoundingClientRect();
        A.burst(tr.left + tr.width / 2, tr.top + tr.height / 2, TIERS[r.lot.tier].color, r.lot.tier === 'incroyable' ? 240 : r.lot.tier === 'correct' ? 100 : 30, r.lot.tier === 'incroyable' ? 2.2 : 1.2);
        let detail = '';
        if (r.item) detail = itemHtml(r.item, '', me.character.cls);
        else if (r.gold) detail = `<div class="cs-gain">+${fmt(r.gold)} 🪙</div>`;
        else if (r.keys) detail = '<div class="cs-gain">🗝️ +1 Clé de boss</div>';
        else if (r.pet) detail = `<div class="cs-gain">🐾 ${esc(r.pet.name)} ${r.pet.duplicate ? 'gagne de l\'XP (tu l\'avais déjà) !' : 'rejoint ton enclos !'}</div>`;
        resEl.innerHTML = `<div class="cs-tier" style="color:${TIERS[r.lot.tier].color}">${TIERS[r.lot.tier].label} : ${r.lot.icon} ${r.lot.label}</div>${detail}`;
        const good = r.lot.tier !== 'mauvais';
        A.settle(r.payout, C.caisse.price, { win: good, quiet: true, banner: r.lot.tier === 'incroyable' ? '🌟 LOT INCROYABLE !' : null, jackpot: r.lot.tier === 'incroyable' });
        if (r.lot.tier === 'incroyable') Sound.play('chestBurst', 'legendaire');
        else if (good) Sound.play('chestTier', r.lot.id === 'epique' ? 'epique' : 'rare');
        go.disabled = false;
      };
    },
    unmount() { alive++; },
  };

  // ---------- Lac gelé (Givrenoire) ----------
  const glace = {
    mount(body, A) {
      const token = ++alive;
      const N = C.glace.size;
      body.innerHTML = `
        <div class="ice-wrap">
          <div class="ice-grid">${Array.from({ length: N }, (_, i) => `<button class="ice-cell" data-i="${i}"><span></span></button>`).join('')}</div>
          <div class="ice-side">
            <div class="ice-mult"><span class="muted">Gain actuel</span><b data-mult>×1</b><span data-win class="gold-text"></span></div>
            <div class="ice-next muted" data-next></div>
            <button class="gold big-btn" data-cash disabled>💰 Encaisser</button>
            <div class="ice-setup">
              <div class="casino-bets"></div>
              <div class="ice-mines"><span class="muted">Fissures :</span>${C.glace.mines.map((m) => `<button type="button" class="casino-chip" data-m="${m}">${m}</button>`).join('')}</div>
              <button class="gold big-btn" data-start>🧊 Commencer</button>
            </div>
          </div>
        </div>
        <div class="casino-pay"><span>Brise la glace case par case : chaque case sûre fait monter le gain.</span><span>Une fissure : tout est perdu !</span><span>Plus il y a de fissures, plus ça rapporte.</span></div>`;
      const bet = A.betPicker(body.querySelector('.casino-bets'), 'glace');
      const cells = [...body.querySelectorAll('.ice-cell')];
      const multEl = body.querySelector('[data-mult]');
      const winEl = body.querySelector('[data-win]');
      const nextEl = body.querySelector('[data-next]');
      const cash = body.querySelector('[data-cash]');
      const setup = body.querySelector('.ice-setup');
      const startBtn = body.querySelector('[data-start]');
      let mines;
      try { mines = Number(localStorage.getItem('zl_ice_mines')); } catch (e) { mines = 0; }
      if (!C.glace.mines.includes(mines)) mines = C.glace.mines[1];
      const syncMines = () => body.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('active', Number(b.dataset.m) === mines));
      body.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { mines = Number(b.dataset.m); try { localStorage.setItem('zl_ice_mines', String(mines)); } catch (e) { /* ignore */ } Sound.play('chip'); syncMines(); preview(); }; });
      syncMines();
      let game = null;
      function preview() {
        if (game) return;
        multEl.textContent = '×1';
        winEl.textContent = '';
        nextEl.innerHTML = `1ʳᵉ case sûre : ×${String(Rules.glaceMult(mines, 1)).replace('.', ',')} · 5 cases : ×${String(Rules.glaceMult(mines, 5)).replace('.', ',')}`;
      }
      function setPlaying(on) {
        setup.style.display = on ? 'none' : '';
        cash.style.display = on ? '' : 'none';
        body.querySelector('.ice-grid').classList.toggle('live', on);
      }
      function show(g) {
        game = g;
        multEl.textContent = `×${String(g.mult).replace('.', ',')}`;
        winEl.textContent = g.revealed.length ? `${fmt(Math.floor(g.bet * g.mult))} 🪙` : '';
        nextEl.innerHTML = g.next ? `Case suivante : ×${String(g.next).replace('.', ',')} (${fmt(Math.floor(g.bet * g.next))} 🪙)` : '';
        cash.disabled = !g.cashable;
        cash.textContent = g.cashable ? `💰 Encaisser ${fmt(Math.floor(g.bet * g.mult))} 🪙` : '💰 Encaisser';
      }
      function resetGrid() { cells.forEach((c) => { c.className = 'ice-cell'; c.disabled = false; }); }
      async function end(r) {
        // Fissures révélées une à une
        for (const i of r.cracks) {
          if (token !== alive) return;
          if (i !== r.boom) { cells[i].classList.add('crack'); await sleep(60); }
        }
        cells.forEach((c) => { c.disabled = true; });
        game = null;
        A.setSession('glace', null);
        A.settle(r.payout, r.bet, { win: r.payout > r.bet, banner: r.outcome === 'cash' && r.payout >= r.bet * 10 ? `🧊 LAC TRAVERSÉ ! +${fmt(r.payout)} 🪙` : null });
        multEl.textContent = r.outcome === 'boom' ? '💀' : `×${String(r.mult).replace('.', ',')}`;
        winEl.textContent = r.payout ? `+${fmt(r.payout)} 🪙` : 'Tout est perdu…';
        nextEl.textContent = '';
        setPlaying(false);
        startBtn.textContent = '🧊 Rejouer';
      }
      startBtn.onclick = async () => {
        const stake = bet.value;
        const r = await A.call('/api/casino/glace/start', { bet: stake, mines }, stake);
        if (!r) return;
        resetGrid();
        A.setSession('glace', r);
        A.idle();
        show(r);
        setPlaying(true);
        A.say(`${mines} fissures se cachent sous la glace…`);
      };
      cells.forEach((cell) => {
        cell.onclick = async () => {
          if (!game || cell.classList.contains('safe')) return;
          cell.classList.add('tap');
          const r = await A.call('/api/casino/glace/pick', { index: Number(cell.dataset.i) }, 0);
          cell.classList.remove('tap');
          if (!r || token !== alive) return;
          if (r.outcome === 'boom') {
            cell.classList.add('boom');
            Sound.play('iceShatter');
            A.box.classList.remove('shake'); void A.box.offsetWidth; A.box.classList.add('shake');
            await sleep(500);
            return end(r);
          }
          cell.classList.add('safe');
          Sound.play('iceSafe', r.revealed.length);
          const cr = cell.getBoundingClientRect();
          A.burst(cr.left + cr.width / 2, cr.top + cr.height / 2, '#9fe8ff', 18, 0.7);
          show(r);
          if (r.outcome === 'cash') return end(r);
          A.setSession('glace', r);
          A.idle();
        };
      });
      cash.onclick = async () => {
        if (!game) return;
        const r = await A.call('/api/casino/glace/cash', {}, 0);
        if (r) end(r);
      };
      const resume = A.sessions().glace;
      if (resume) {
        resume.revealed.forEach((i) => cells[i].classList.add('safe'));
        show(resume);
        setPlaying(true);
      } else { preview(); setPlaying(false); }
    },
    unmount() { alive++; },
  };

  // ---------- Gobelets du mage (Malvorath) ----------
  const gobelets = {
    mount(body, A) {
      const token = ++alive;
      body.innerHTML = `
        <div class="cups-stage">
          ${[0, 1, 2].map((i) => `<button class="cup" data-cup="${i}" style="--x:${i}"><span class="cup-body"></span></button>`).join('')}
          <span class="cups-ball" style="--x:1"></span>
          <div class="cups-msg" data-msg>Regarde bien la bille…</div>
        </div>
        <div class="casino-controls"><div class="casino-bets"></div><button class="gold big-btn" data-go>🔮 Mélanger</button></div>
        <div class="casino-pay"><span>Trouve la bille sous le bon gobelet : <b>×${String(C.gobelets.pays).replace('.', ',')}</b> la mise.</span></div>`;
      const bet = A.betPicker(body.querySelector('.casino-bets'), 'gobelets');
      const stage = body.querySelector('.cups-stage');
      const cups = [...body.querySelectorAll('.cup')];
      const ball = body.querySelector('.cups-ball');
      const msg = body.querySelector('[data-msg]');
      const go = body.querySelector('[data-go]');
      let pos = [0, 1, 2]; // position (0-2) de chaque gobelet
      let state = 'idle';
      const place = () => cups.forEach((c, i) => { c.style.setProperty('--x', pos[i]); });
      cups[1].classList.add('up');

      go.onclick = async () => {
        if (state !== 'idle' && state !== 'done') return;
        if (A.gold < bet.value) return toast('⚠️ Pas assez de golds');
        state = 'shuffle';
        go.disabled = true;
        cups.forEach((c) => c.classList.remove('up', 'win', 'lose'));
        ball.style.setProperty('--x', 1);
        ball.classList.remove('hide');
        msg.textContent = 'Abracadabra…';
        A.say('Mes mains sont plus rapides que tes yeux !');
        cups[pos.indexOf(1)].classList.add('up');
        await sleep(500);
        cups.forEach((c) => c.classList.remove('up'));
        await sleep(350);
        ball.classList.add('hide');
        stage.classList.add('fast');
        for (let k = 0; k < 14; k++) {
          if (token !== alive) return;
          const a = Math.floor(Math.random() * 3);
          let b = Math.floor(Math.random() * 2);
          if (b >= a) b += 1;
          const ia = pos.indexOf(a);
          const ib = pos.indexOf(b);
          pos[ia] = b;
          pos[ib] = a;
          place();
          Sound.play('cupShuffle');
          await sleep(Math.max(140, 330 - k * 15));
        }
        stage.classList.remove('fast');
        state = 'choose';
        stage.classList.add('choose');
        msg.textContent = 'Où est la bille ? Choisis un gobelet !';
      };
      cups.forEach((cup, i) => {
        cup.onclick = async () => {
          if (state !== 'choose') return;
          state = 'reveal';
          stage.classList.remove('choose');
          const stake = bet.value;
          const chosen = pos[i];
          const r = await A.call('/api/casino/gobelets', { bet: stake, cup: chosen }, stake);
          if (!r) { state = 'choose'; stage.classList.add('choose'); return; }
          ball.style.setProperty('--x', r.ball);
          ball.classList.remove('hide');
          cup.classList.add('up', r.win ? 'win' : 'lose');
          Sound.play('cardFlip');
          await sleep(650);
          if (token !== alive) return;
          if (!r.win) {
            const other = cups[pos.indexOf(r.ball)];
            other.classList.add('up');
            Sound.play('cardFlip');
          }
          msg.innerHTML = r.win ? `Trouvée ! <b class="gold-text">+${fmt(r.payout)} 🪙</b>` : 'Raté ! La bille était ailleurs…';
          A.settle(r.payout, stake);
          state = 'done';
          go.disabled = false;
          go.textContent = '🔮 Rejouer';
        };
      });
    },
    unmount() { alive++; },
  };

  window.CasinoGames = { slots, blackjack, roulette, caisse, glace, gobelets };
})();
