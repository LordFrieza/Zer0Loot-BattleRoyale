/*
 * Les neuf jeux du casino (fenêtre de jeu de casino.js). Chaque jeu : mount(corps, outils) / unmount().
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
        const r = await A.call('/api/casino/slots', { bet: stake, ticket: bet.ticket }, bet.stake);
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
        const r = await A.call('/api/casino/blackjack/deal', { bet: stake, ticket: bet.ticket }, bet.stake);
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
          <span data-ticket></span>
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
      const ticket = A.ticketToggle(body.querySelector('[data-ticket]'));
      body.querySelector('[data-clear]').onclick = () => { if (!go.dataset.spinning) { bets = []; renderBets(); } };
      renderBets();

      go.onclick = async () => {
        if (!bets.length || go.dataset.spinning) return;
        const stake = bets.reduce((a, b) => a + b.amount, 0);
        go.dataset.spinning = '1';
        go.disabled = true;
        const tk = ticket.on;
        if (tk && stake < C.ticket) { delete go.dataset.spinning; go.disabled = false; return toast(`⚠️ Avec un ticket, place au moins ${C.ticket} golds de jetons`); }
        const r = await A.call('/api/casino/roulette', { bets, ticket: tk }, tk ? stake - C.ticket : stake);
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
        const r = await A.call('/api/casino/glace/start', { bet: stake, mines, ticket: bet.ticket }, bet.stake);
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
        if (A.gold < bet.stake) return toast('⚠️ Pas assez de golds');
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
          const r = await A.call('/api/casino/gobelets', { bet: stake, cup: chosen, ticket: bet.ticket }, bet.stake);
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

  // ---------- Road to Heaven (Ether) ----------
  // La ligne monte en exp(speed × t) (même formule que le serveur, Rules.heavenMult) ; le navigateur interroge le
  // serveur plusieurs fois par seconde (/heaven/check) pour savoir si elle s'est effondrée. Axe vertical linéaire
  // (la courbe s'accélère à l'écran) ; fond : enfers en bas, paradis en haut (altitude = ln(×) / ln(50)).
  const HV = C.heaven;
  const HV_AUTO = [0, 1.5, 2, 3, 5, 10, 25, 100];
  const multTxt = (m) => `×${m.toFixed(2).replace('.', ',')}`;
  const heaven = {
    mount(body, A) {
      const token = ++alive;
      body.innerHTML = `
        <div class="hv-wrap">
          <div class="hv-stage"><canvas width="820" height="440"></canvas></div>
          <div class="hv-side">
            <div class="ice-mult"><span class="muted">Multiplicateur</span><b data-mult>×1,00</b><span data-win class="gold-text"></span></div>
            <button class="gold big-btn hv-act" data-act>🪽 S'élever</button>
            <div class="hv-setup">
              <div class="casino-bets"></div>
              <div class="hv-auto"><span class="muted">Encaisser seul à :</span>${HV_AUTO.map((a) => `<button type="button" class="casino-chip" data-auto="${a}">${a ? `×${String(a).replace('.', ',')}` : 'non'}</button>`).join('')}</div>
            </div>
            <div class="hv-hist" data-hist></div>
          </div>
        </div>
        <div class="casino-pay"><span>La ligne monte des enfers vers le paradis, <b>de plus en plus vite</b>.</span><span>Appuie sur <b>STOP</b> (ou Espace) pour encaisser la mise × le multiplicateur.</span><span>Elle peut s'effondrer à tout instant : tout est perdu !</span></div>`;
      const bet = A.betPicker(body.querySelector('.casino-bets'), 'heaven');
      const cv = body.querySelector('canvas');
      const ctx = cv.getContext('2d');
      const multEl = body.querySelector('[data-mult]');
      const winEl = body.querySelector('[data-win]');
      // Un seul bouton, toujours au même endroit : « S'élever » au repos, « STOP » pendant la montée (pas besoin de
      // bouger la souris). Les mises restent affichées en dessous, grisées pendant la montée.
      const actBtn = body.querySelector('[data-act]');
      const setup = body.querySelector('.hv-setup');
      let relaunchAt = 0; // petit délai après la fin pour ne pas relancer par un double-clic
      const setMode = (mode) => {
        actBtn.classList.toggle('hv-stop', mode === 'stop');
        setup.classList.toggle('locked', mode === 'stop');
        if (mode === 'stop') { actBtn.disabled = false; return; }
        actBtn.textContent = run.phase === 'idle' ? '🪽 S\'élever' : '🪽 Remonter';
        actBtn.disabled = performance.now() < relaunchAt;
        if (actBtn.disabled) setTimeout(() => { if (token === alive && run.phase !== 'up') actBtn.disabled = false; }, relaunchAt - performance.now() + 20);
      };
      const histEl = body.querySelector('[data-hist]');
      let auto;
      try { auto = Number(localStorage.getItem('zl_hv_auto')); } catch (e) { auto = 0; }
      if (!HV_AUTO.includes(auto)) auto = 0;
      const syncAuto = () => body.querySelectorAll('[data-auto]').forEach((b) => b.classList.toggle('active', Number(b.dataset.auto) === auto));
      body.querySelectorAll('[data-auto]').forEach((b) => { b.onclick = () => { auto = Number(b.dataset.auto); try { localStorage.setItem('zl_hv_auto', String(auto)); } catch (e) { /* ignore */ } Sound.play('chip'); syncAuto(); }; });
      syncAuto();
      // run : partie affichée. phase 'idle' | 'up' | 'crash' | 'cash'
      const run = { phase: 'idle', t0: 0, t: 0, m: 1, bet: 0, crash: null, cashAt: null, endT: 0, fall: 0, lastTick: 1, auto: 0 };
      let hist = [];
      try { hist = JSON.parse(localStorage.getItem('zl_hv_hist') || '[]').slice(0, 12); } catch (e) { hist = []; }
      const renderHist = () => { histEl.innerHTML = hist.length ? `<span class="muted">Dernières :</span>${hist.map((m) => `<b class="${m >= 2 ? 'up' : 'down'}">${multTxt(m)}</b>`).join('')}` : ''; };
      renderHist();
      // nuages et étoiles fixes (dans le monde, en altitude 0..1)
      const deco = Array.from({ length: 60 }, (_, i) => ({ a: Math.random(), x: Math.random(), s: 0.5 + Math.random(), k: i % 3 }));

      const worldColor = (a) => {
        // 0 : enfers, 0,18 : brasier, 0,35 : limbes violettes, 0,6 : ciel nocturne, 0,85 : ciel clair, 1 : lumière dorée
        const stops = [[0, [120, 8, 4]], [0.18, [200, 50, 20]], [0.35, [70, 20, 80]], [0.6, [30, 40, 110]], [0.85, [130, 180, 255]], [1, [255, 244, 200]]];
        for (let i = 1; i < stops.length; i++) {
          if (a <= stops[i][0]) {
            const [a0, c0] = stops[i - 1];
            const [a1, c1] = stops[i];
            const k = (a - a0) / (a1 - a0);
            return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(',')})`;
          }
        }
        return 'rgb(255,244,200)';
      };
      const ALT = Math.log(50);
      const altOf = (m) => Math.max(0, Math.min(1, Math.log(Math.max(1, m)) / ALT));
      function draw(now) {
        const W = cv.width;
        const H = cv.height;
        const pad = { l: 46, r: 20, t: 20, b: 30 };
        const tNow = run.t;
        const mTop = Math.max(2, run.phase === 'idle' ? 2 : Math.max(run.m, run.crash && run.phase !== 'up' ? Math.min(run.crash, run.m * 3) : run.m) * 1.25);
        const tMax = Math.max(8, Math.log(mTop) / HV.speed * 1.05, tNow * 1.08);
        const yOf = (m) => H - pad.b - ((m - 1) / (mTop - 1)) * (H - pad.t - pad.b);
        const xOf = (t) => pad.l + (t / tMax) * (W - pad.l - pad.r);
        // fond : bandes selon l'altitude réelle
        for (let y = 0; y < H; y += 4) {
          const m = 1 + ((H - pad.b - y) / (H - pad.t - pad.b)) * (mTop - 1);
          ctx.fillStyle = worldColor(altOf(m));
          ctx.fillRect(0, y, W, 4);
        }
        // flammes des enfers en bas
        for (let i = 0; i < 24; i++) {
          const x = (i / 24) * W + 10;
          const h = 22 + Math.sin(now / 140 + i * 1.7) * 10;
          const g = ctx.createLinearGradient(0, H, 0, H - h - 10);
          g.addColorStop(0, 'rgba(255, 200, 60, .95)'); g.addColorStop(1, 'rgba(255, 60, 20, 0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(x - 18, H); ctx.quadraticCurveTo(x + Math.sin(now / 90 + i) * 6, H - h - 14, x + 18, H); ctx.fill();
        }
        // décor en altitude : étoiles, nuages, rayons dorés
        for (const d of deco) {
          const m = Math.exp(d.a * ALT);
          const y = yOf(m);
          if (y < -40 || y > H) continue;
          const x = pad.l + d.x * (W - pad.l);
          if (d.a > 0.45 && d.a < 0.8 && d.k) { ctx.fillStyle = `rgba(255,255,255,${0.4 + Math.sin(now / 400 + d.x * 9) * 0.3})`; ctx.fillRect(x, y, 2, 2); }
          if (d.a >= 0.72) { ctx.fillStyle = 'rgba(255,255,255,.75)'; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(x + k * 16 * d.s, y + (k === 1 ? -6 : 0), 12 * d.s, 0, Math.PI * 2); ctx.fill(); } }
          if (d.a < 0.25 && d.k === 0) { ctx.fillStyle = 'rgba(40, 0, 0, .5)'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 8, y - 26 * d.s); ctx.lineTo(x + 16, y); ctx.fill(); }
        }
        const yHeaven = yOf(50);
        if (yHeaven > -60) {
          // Portes du paradis
          ctx.save();
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = '#ffe9a0';
          const gx = W - 150;
          ctx.fillRect(gx, yHeaven - 50, 8, 60); ctx.fillRect(gx + 92, yHeaven - 50, 8, 60);
          ctx.strokeStyle = '#ffd34a'; ctx.lineWidth = 3;
          for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(gx + 14 + k * 14, yHeaven + 10); ctx.lineTo(gx + 14 + k * 14, yHeaven - 40); ctx.stroke(); }
          ctx.beginPath(); ctx.arc(gx + 50, yHeaven - 50, 46, Math.PI, 0); ctx.stroke();
          ctx.restore();
        }
        // graduations
        ctx.font = '700 11px system-ui'; ctx.textAlign = 'right';
        const stepM = [0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250].find((s) => (mTop - 1) / s <= 6) || 500;
        for (let m = 1; m <= mTop; m += stepM) {
          const y = yOf(m);
          ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText(`×${String(Math.round(m * 100) / 100).replace(".", ",")}`, pad.l - 6, y + 4);
        }
        if (run.phase === 'idle') {
          ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '900 26px system-ui';
          ctx.fillText('Prêt à monter au paradis ?', W / 2, H / 2 - 10);
          ctx.font = '600 14px system-ui'; ctx.fillStyle = 'rgba(255,255,255,.8)';
          ctx.fillText('Choisis ta mise puis « S\'élever »', W / 2, H / 2 + 16);
          window.drawPet(ctx, W / 2, H - 50 + Math.sin(now / 300) * 6, 'ether', { t: now, size: 1.1 });
          return;
        }
        // la ligne (jusqu'à l'effondrement s'il est connu)
        const tEnd = run.phase === 'up' ? tNow : run.endT;
        const path = (t0, t1, color, width, dash) => {
          ctx.save();
          ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          if (dash) ctx.setLineDash(dash);
          ctx.shadowColor = color; ctx.shadowBlur = dash ? 0 : 14;
          ctx.beginPath();
          const n = 80;
          for (let i = 0; i <= n; i++) {
            const t = t0 + ((t1 - t0) * i) / n;
            const x = xOf(t);
            const y = yOf(Math.max(1, Rules.heavenMult(t)));
            if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          }
          ctx.stroke();
          ctx.restore();
        };
        // zone sous la courbe
        ctx.save();
        ctx.beginPath(); ctx.moveTo(xOf(0), H - pad.b);
        for (let i = 0; i <= 60; i++) { const t = (tEnd * i) / 60; ctx.lineTo(xOf(t), yOf(Math.max(1, Rules.heavenMult(t)))); }
        ctx.lineTo(xOf(tEnd), H - pad.b); ctx.closePath();
        ctx.fillStyle = run.phase === 'crash' ? 'rgba(255, 60, 40, .18)' : 'rgba(255, 255, 255, .14)'; ctx.fill();
        ctx.restore();
        if (run.phase === 'cash' && run.cashAt) {
          const tc = Math.log(run.cashAt) / HV.speed;
          path(0, tc, '#ffd34a', 5);
          if (run.crash && run.crash > run.cashAt) path(tc, Math.log(run.crash) / HV.speed, 'rgba(255,255,255,.55)', 3, [6, 6]); // jusqu'où elle serait montée
        } else path(0, tEnd, run.phase === 'crash' ? '#ff3a2a' : '#ffffff', 5);
        // le petit fantôme au bout de la ligne
        const tipT = run.phase === 'cash' && run.cashAt ? Math.log(run.cashAt) / HV.speed : tEnd;
        let gx = xOf(tipT);
        let gy = yOf(Math.max(1, Rules.heavenMult(tipT)));
        if (run.phase === 'crash') { run.fall = Math.min(1, run.fall + 0.02); gy += (H - gy) * run.fall * run.fall; gx += run.fall * 30; }
        ctx.save();
        if (run.phase === 'crash') ctx.globalAlpha = 1 - run.fall * 0.7;
        window.drawPet(ctx, gx, gy + 8, 'ether', { t: now, size: 0.8, flash: run.phase === 'crash' });
        ctx.restore();
        if (run.auto && run.phase === 'up') {
          const ya = yOf(run.auto);
          ctx.strokeStyle = 'rgba(255, 211, 74, .8)'; ctx.setLineDash([8, 6]); ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(pad.l, ya); ctx.lineTo(W - pad.r, ya); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#ffd34a'; ctx.textAlign = 'left'; ctx.font = '800 12px system-ui'; ctx.fillText(`encaissement auto ${multTxt(run.auto)}`, pad.l + 6, ya - 6);
        }
        // grand multiplicateur au centre
        ctx.textAlign = 'center';
        ctx.font = '900 56px "Orbitron", system-ui';
        ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.55)';
        const big = run.phase === 'crash' ? `💥 ${multTxt(run.crash)}` : run.phase === 'cash' ? multTxt(run.cashAt) : multTxt(run.m);
        ctx.strokeText(big, W / 2, 90);
        ctx.fillStyle = run.phase === 'crash' ? '#ff4a3a' : run.phase === 'cash' ? '#ffd34a' : '#fff';
        ctx.fillText(big, W / 2, 90);
        ctx.font = '800 16px system-ui';
        if (run.phase === 'crash') { ctx.strokeText('EFFONDRÉE ! Retour aux enfers…', W / 2, 118); ctx.fillText('EFFONDRÉE ! Retour aux enfers…', W / 2, 118); }
        if (run.phase === 'cash') { const txt = `Encaissé ! +${fmt(Math.floor(run.bet * run.cashAt))} 🪙${run.crash ? ` · elle s'est effondrée à ${multTxt(run.crash)}` : ''}`; ctx.strokeText(txt, W / 2, 118); ctx.fillStyle = '#fff'; ctx.fillText(txt, W / 2, 118); }
      }

      let polling = false;
      let pollAt = 0;
      function frame(now) {
        if (token !== alive) return;
        if (run.phase === 'up') {
          run.t = (now - run.t0) / 1000;
          run.m = Rules.heavenMult(run.t);
          multEl.textContent = multTxt(run.m);
          winEl.textContent = `${fmt(Math.floor(run.bet * run.m))} 🪙`;
          actBtn.textContent = `✋ STOP — ${fmt(Math.floor(run.bet * run.m))} 🪙`;
          // « ding » à chaque palier franchi
          const step = run.m < 2 ? 0.1 : run.m < 10 ? 0.5 : run.m < 100 ? 5 : 50;
          if (Math.floor(run.m / step) > Math.floor(run.lastTick / step)) Sound.play('heavenTick', run.m);
          run.lastTick = run.m;
          if (!polling && now >= pollAt) { pollAt = now + 150; check(); }
        }
        draw(now);
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);

      function begin(r) {
        Object.assign(run, { phase: 'up', t0: performance.now() - r.t * 1000, t: r.t, m: r.mult, bet: r.bet, crash: null, cashAt: null, fall: 0, lastTick: r.mult, auto: r.auto || 0 });
        setMode('stop');
        A.hold();
      }
      function end(r) {
        if (run.phase !== 'up') return;
        run.crash = r.crash;
        run.endT = r.outcome === 'crash' ? Math.log(r.crash) / HV.speed : run.t;
        if (r.outcome === 'crash') {
          run.phase = 'crash';
          run.m = r.crash;
          Sound.play('heavenCrash');
          A.box.classList.remove('shake'); void A.box.offsetWidth; A.box.classList.add('shake');
          multEl.textContent = `💥 ${multTxt(r.crash)}`;
          winEl.textContent = 'Tout est perdu…';
        } else {
          run.phase = 'cash';
          run.cashAt = r.mult;
          multEl.textContent = multTxt(r.mult);
          winEl.textContent = `+${fmt(r.payout)} 🪙`;
        }
        hist.unshift(r.crash);
        hist = hist.slice(0, 12);
        try { localStorage.setItem('zl_hv_hist', JSON.stringify(hist)); } catch (e) { /* ignore */ }
        renderHist();
        relaunchAt = performance.now() + 1000;
        setMode('start');
        A.setSession('heaven', null);
        A.settle(r.payout, r.bet, { win: r.payout > r.bet, banner: r.outcome === 'cash' && r.mult >= 10 ? `🪽 AU PARADIS ! ${multTxt(r.mult)} · +${fmt(r.payout)} 🪙` : null });
      }
      async function check() {
        polling = true;
        try {
          const r = await api('/api/casino/heaven/check', {});
          if (token !== alive) return;
          if (r.outcome) end(r);
          else if (Math.abs(r.t - run.t) > 0.35) run.t0 = performance.now() - r.t * 1000; // recalage sur l'horloge du serveur
        } catch (err) {
          // Montée terminée ailleurs (autre onglet, redémarrage) ; ignoré si on vient d'encaisser (réponse en retard)
          if (/Aucune montée/.test(err.message) && run.phase === 'up') { run.phase = 'idle'; A.idle(); setMode('start'); }
        } finally { polling = false; }
      }
      async function stop() {
        if (run.phase !== 'up' || actBtn.disabled) return;
        actBtn.disabled = true;
        try {
          const r = await api('/api/casino/heaven/cash', {});
          if (token !== alive) return;
          end(r);
        } catch (err) { actBtn.disabled = false; toast('⚠️ ' + err.message); }
      }
      this.key = (e) => { if (e.code === 'Space' && run.phase === 'up') { e.preventDefault(); stop(); } };
      document.addEventListener('keydown', this.key);
      async function launch() {
        if (run.phase === 'up' || actBtn.disabled) return;
        actBtn.disabled = true;
        const r = await A.call('/api/casino/heaven/start', { bet: bet.value, ticket: bet.ticket, auto: auto || null }, bet.stake);
        if (!r || token !== alive) { actBtn.disabled = false; return; }
        A.say(auto ? `Je t'arrête à ×${String(auto).replace('.', ',')}… si tu y arrives. Hou hou !` : 'Montez… montez… mais pas trop haut !');
        begin(r);
      }
      actBtn.onclick = () => (run.phase === 'up' ? stop() : launch());
      setMode('start');
      const resume = A.sessions().heaven;
      if (resume) { begin(resume); check(); }
    },
    unmount() { alive++; if (this.key) document.removeEventListener('keydown', this.key); },
  };

  // ---------- Chaton Fripon (Lilith) ----------
  // Dix toits de plus en plus hauts ; chaque saut peut faire glisser le chaton (le serveur décide). Les toits suivants
  // sont « inconnus » (brouillard) tant que le chaton n'y est pas.
  const KT = C.chaton;
  const ROOF_STYLES = [
    { name: 'tuiles', roof: '#b0412e', wall: '#e8c9a0', line: '#7a2a1e' },
    { name: 'ardoise', roof: '#4a5568', wall: '#cfd6e0', line: '#2a3240' },
    { name: 'cuivre', roof: '#3f9a7a', wall: '#e6dcc8', line: '#24624c' },
    { name: 'chaume', roof: '#c8a050', wall: '#efe2c0', line: '#8a6a2a' },
    { name: 'neige', roof: '#f4f8ff', wall: '#c9b8a8', line: '#a0b0c8' },
    { name: 'violet', roof: '#7a4a9a', wall: '#e0d0e8', line: '#4a2a6a' },
  ];
  const chaton = {
    mount(body, A) {
      const token = ++alive;
      const N = KT.slip.length;
      body.innerHTML = `
        <div class="hv-wrap">
          <div class="hv-stage"><canvas width="820" height="440"></canvas></div>
          <div class="hv-side">
            <div class="ice-mult"><span class="muted">Gain actuel</span><b data-mult>×1</b><span data-win class="gold-text"></span></div>
            <div class="ice-next muted" data-next></div>
            <button class="gold big-btn" data-jump disabled>🐈 Sauter !</button>
            <button class="gold big-btn" data-cash disabled>💰 Encaisser</button>
            <div class="hv-setup">
              <div class="casino-bets"></div>
              <button class="gold big-btn" data-start>🏠 Grimper sur le premier toit</button>
            </div>
          </div>
        </div>
        <div class="casino-pay"><span>Chaque saut vers le toit suivant fait grimper le gain (jusqu'à <b>×${String(Rules.chatonMult(N)).replace('.', ',')}</b> au 10ᵉ toit).</span><span>Mais le chaton peut <b>glisser</b> sur un toit inconnu : tout est perdu !</span><span>Encaisse quand tu veux.</span></div>`;
      const bet = A.betPicker(body.querySelector('.casino-bets'), 'chaton');
      const cv = body.querySelector('canvas');
      const ctx = cv.getContext('2d');
      const multEl = body.querySelector('[data-mult]');
      const winEl = body.querySelector('[data-win]');
      const nextEl = body.querySelector('[data-next]');
      const jumpBtn = body.querySelector('[data-jump]');
      const cashBtn = body.querySelector('[data-cash]');
      const setup = body.querySelector('.hv-setup');
      const startBtn = body.querySelector('[data-start]');
      const W = cv.width;
      const H = cv.height;
      // toits : 0 = point de départ (une cheminée), 1..10
      let roofs = [];
      const makeRoofs = () => {
        roofs = [{ x: 60, y: 330, w: 80, style: ROOF_STYLES[1] }];
        for (let i = 1; i <= N; i++) {
          const prev = roofs[i - 1];
          roofs.push({ x: prev.x + 130 + Math.random() * 30, y: 330 - i * 16 - Math.random() * 18, w: 74 + Math.random() * 24, style: ROOF_STYLES[Math.floor(Math.random() * ROOF_STYLES.length)] });
        }
      };
      makeRoofs();
      const st = { phase: 'idle', roof: 0, cat: { x: roofs[0].x, y: roofs[0].y }, anim: null, cam: 0, slip: null, bet: 0 };
      const stars = Array.from({ length: 80 }, () => ({ x: Math.random() * 2400, y: Math.random() * 260, s: Math.random() }));
      function drawRoof(r, i, known, now) {
        const S = r.style;
        const base = H;
        // façade
        ctx.fillStyle = known ? S.wall : '#2a2440';
        ctx.fillRect(r.x - r.w / 2, r.y, r.w, base - r.y);
        // fenêtres allumées
        for (let k = 0; k < 3; k++) {
          for (let j = 0; j < 4; j++) {
            const lit = (i * 7 + k * 3 + j) % 4 !== 0;
            ctx.fillStyle = lit ? `rgba(255, 216, 106, ${known ? 0.95 : 0.35})` : 'rgba(30, 20, 40, .7)';
            ctx.fillRect(r.x - r.w / 2 + 10 + k * (r.w - 20) / 3, r.y + 22 + j * 34, (r.w - 40) / 3, 18);
          }
        }
        // toit
        ctx.fillStyle = known ? S.roof : '#3a3456';
        ctx.beginPath(); ctx.moveTo(r.x - r.w / 2 - 8, r.y + 2); ctx.lineTo(r.x - r.w / 2 + 10, r.y - 18); ctx.lineTo(r.x + r.w / 2 - 10, r.y - 18); ctx.lineTo(r.x + r.w / 2 + 8, r.y + 2); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = known ? S.line : '#4a4470'; ctx.lineWidth = 1.5;
        for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(r.x - r.w / 2 - 8 + k * 4.5, r.y + 2 - k * 5); ctx.lineTo(r.x + r.w / 2 + 8 - k * 4.5, r.y + 2 - k * 5); ctx.stroke(); }
        if (S.name === 'neige' && known) { ctx.fillStyle = '#fff'; ctx.fillRect(r.x - r.w / 2 + 8, r.y - 22, r.w - 16, 5); }
        // cheminée
        ctx.fillStyle = known ? '#7a3a2a' : '#2e2848';
        ctx.fillRect(r.x + r.w / 4, r.y - 34, 12, 18);
        // multiplicateur au-dessus du toit, ou « ? » pour un toit inconnu
        if (i > 0) {
          ctx.textAlign = 'center';
          ctx.font = `900 ${known ? 15 : 22}px system-ui`;
          ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.6)';
          const label = known ? `×${String(Rules.chatonMult(i)).replace('.', ',')}` : '?';
          const y = r.y - 44 + (known ? 0 : Math.sin(now / 400 + i) * 3);
          ctx.strokeText(label, r.x, y);
          ctx.fillStyle = i === st.roof && st.phase !== 'idle' ? '#ffd34a' : known ? '#fff' : '#c9b8ff';
          ctx.fillText(label, r.x, y);
          if (!known) {
            ctx.font = '700 10px system-ui'; ctx.fillStyle = 'rgba(255,160,160,.9)';
            ctx.fillText(`${Math.round(KT.slip[i - 1] * 100)} % de glisser`, r.x, y + 16);
          }
        }
      }
      function draw(now) {
        // ciel de nuit et lune
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#0e0a24'); g.addColorStop(1, '#3a2050');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        const camTarget = Math.max(0, Math.min(roofs[N].x - W + 120, st.cat.x - W * 0.35));
        st.cam += (camTarget - st.cam) * 0.08;
        for (const s of stars) { const x = ((s.x - st.cam * 0.3) % 2400 + 2400) % 2400; if (x < W) { ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.5 * Math.abs(Math.sin(now / 700 + s.x))})`; ctx.fillRect(x, s.y, 1.5, 1.5); } }
        ctx.fillStyle = '#fff3c4'; ctx.shadowColor = '#fff3c4'; ctx.shadowBlur = 30;
        ctx.beginPath(); ctx.arc(W - 90, 70, 34, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
        ctx.fillStyle = '#e8dca8'; ctx.beginPath(); ctx.arc(W - 100, 62, 6, 0, Math.PI * 2); ctx.arc(W - 78, 82, 4, 0, Math.PI * 2); ctx.fill();
        // silhouettes lointaines
        ctx.fillStyle = '#1a1234';
        for (let i = 0; i < 30; i++) { const x = i * 90 - (st.cam * 0.5) % 90; ctx.fillRect(x, 250 + ((i * 53) % 60), 70, 200); }
        ctx.save();
        ctx.translate(-st.cam, 0);
        roofs.forEach((r, i) => drawRoof(r, i, i <= st.roof || st.phase === 'done', now));
        // chaton (Mini Lilith) : saut en arc, glissade
        let { x, y } = st.cat;
        let rot = 0;
        const a = st.anim;
        if (a) {
          const p = Math.min(1, (now - a.t0) / a.dur);
          if (a.kind === 'jump') {
            x = a.from.x + (a.to.x - a.from.x) * p;
            y = a.from.y + (a.to.y - a.from.y) * p - Math.sin(p * Math.PI) * 90;
            rot = (p - 0.5) * 0.5;
          } else if (a.kind === 'slip') {
            // atterrit, glisse vers le bord, puis tombe en tournoyant
            if (p < 0.35) { const q = p / 0.35; x = a.from.x + (a.to.x - a.from.x) * q; y = a.from.y + (a.to.y - a.from.y) * q - Math.sin(q * Math.PI) * 90; }
            else if (p < 0.6) { const q = (p - 0.35) / 0.25; x = a.to.x + q * (a.edge - a.to.x); y = a.to.y + q * 6; rot = q * 0.6; }
            else { const q = (p - 0.6) / 0.4; x = a.edge + q * 40; y = a.to.y + 6 + q * q * (H - a.to.y + 60); rot = 0.6 + q * 8; }
          }
          if (p >= 1) { st.anim = null; if (a.done) a.done(); if (a.kind === 'slip') st.fallen = true; else st.cat = { x: a.to.x, y: a.to.y }; }
        }
        if (!st.fallen || st.anim) {
          ctx.save();
          ctx.translate(x, y - 18);
          ctx.rotate(rot);
          window.drawPet(ctx, 0, 18, 'lilith', { t: now, size: 0.9, swing: a && a.kind === 'jump' ? 0.6 : 0 });
          ctx.restore();
        }
        if (st.slip) {
          ctx.font = '900 20px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
          ctx.fillText('Miaouuu !', st.slip.x, st.slip.y - 70);
        }
        ctx.restore();
        if (st.phase === 'idle') {
          ctx.textAlign = 'center'; ctx.font = '900 24px system-ui'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.6)';
          ctx.strokeText('Dix toits jusqu\'à la lune…', W / 2, 60); ctx.fillStyle = '#fff'; ctx.fillText('Dix toits jusqu\'à la lune…', W / 2, 60);
        }
      }
      function frame(now) { if (token !== alive) return; draw(now); requestAnimationFrame(frame); }
      requestAnimationFrame(frame);
      const anim = (o) => new Promise((resolve) => { st.anim = { t0: performance.now(), ...o, done: resolve }; });
      function show(v) {
        multEl.textContent = v.roof ? `×${String(v.mult).replace('.', ',')}` : '×1';
        winEl.textContent = v.roof ? `${fmt(Math.floor(v.bet * v.mult))} 🪙` : '';
        nextEl.innerHTML = v.next ? `Toit ${v.roof + 1} : ×${String(v.next).replace('.', ',')} (${fmt(Math.floor(v.bet * v.next))} 🪙) · <span class="down">${Math.round(v.risk * 100)} % de glisser</span>` : '';
        cashBtn.disabled = !v.cashable;
        cashBtn.textContent = v.cashable ? `💰 Encaisser ${fmt(Math.floor(v.bet * v.mult))} 🪙` : '💰 Encaisser';
        jumpBtn.disabled = false;
      }
      function setPlaying(on) {
        setup.style.display = on ? 'none' : '';
        jumpBtn.style.display = on ? '' : 'none';
        cashBtn.style.display = on ? '' : 'none';
      }
      function finish(r) {
        st.phase = 'done';
        A.setSession('chaton', null);
        setPlaying(false);
        startBtn.textContent = '🏠 Rejouer';
        nextEl.textContent = '';
        A.settle(r.payout, r.bet, { win: r.payout > r.bet, banner: r.outcome === 'cash' && r.roof === N ? `🐈 LES 10 TOITS ! +${fmt(r.payout)} 🪙` : null });
        winEl.textContent = r.payout ? `+${fmt(r.payout)} 🪙` : 'Tout est perdu…';
      }
      startBtn.onclick = async () => {
        const r = await A.call('/api/casino/chaton/start', { bet: bet.value, ticket: bet.ticket }, bet.stake);
        if (!r || token !== alive) return;
        makeRoofs();
        Object.assign(st, { phase: 'play', roof: 0, cat: { x: roofs[0].x, y: roofs[0].y }, anim: null, slip: null, fallen: false, bet: r.bet });
        A.setSession('chaton', r);
        A.idle();
        setPlaying(true);
        show(r);
        A.say('Saute, minou… si tu l\'oses. Hi hi !');
      };
      jumpBtn.onclick = async () => {
        if (st.phase !== 'play' || st.anim) return;
        jumpBtn.disabled = true;
        cashBtn.disabled = true;
        const r = await A.call('/api/casino/chaton/jump', {}, 0);
        if (!r || token !== alive) { jumpBtn.disabled = false; return; }
        const from = { ...st.cat };
        const target = roofs[st.roof + 1];
        Sound.play('catJump');
        if (r.outcome === 'slip') {
          st.roof += 1; // le toit se révèle : il était glissant
          await anim({ kind: 'slip', from, to: { x: target.x - 10, y: target.y - 18 }, edge: target.x + target.w / 2 + 6, dur: 1700 });
          Sound.play('catSlip');
          st.slip = { x: target.x, y: target.y };
          A.box.classList.remove('shake'); void A.box.offsetWidth; A.box.classList.add('shake');
          return finish(r);
        }
        st.roof = r.roof;
        await anim({ kind: 'jump', from, to: { x: target.x, y: target.y - 18 }, dur: 560 });
        if (token !== alive) return;
        Sound.play('catLand', r.roof);
        const cr = cv.getBoundingClientRect();
        A.burst(cr.left + ((target.x - st.cam) / W) * cr.width, cr.top + ((target.y - 30) / H) * cr.height, '#ffd34a', 16, 0.7);
        if (r.outcome === 'cash') return finish(r);
        A.setSession('chaton', r);
        A.idle();
        show(r);
      };
      cashBtn.onclick = async () => {
        if (st.phase !== 'play' || st.anim) return;
        const r = await A.call('/api/casino/chaton/cash', {}, 0);
        if (r) finish(r);
      };
      setPlaying(false);
      const resume = A.sessions().chaton;
      if (resume) {
        Object.assign(st, { phase: 'play', roof: resume.roof, cat: { x: roofs[resume.roof].x, y: roofs[resume.roof].y - (resume.roof ? 18 : 0) }, bet: resume.bet });
        setPlaying(true);
        show(resume);
      } else {
        nextEl.innerHTML = `1ᵉʳ toit : ×${String(Rules.chatonMult(1)).replace('.', ',')} · 5ᵉ : ×${String(Rules.chatonMult(5)).replace('.', ',')} · 10ᵉ : ×${String(Rules.chatonMult(N)).replace('.', ',')}`;
      }
    },
    unmount() { alive++; },
  };

  // ---------- Course de démons (Daedra) ----------
  // Le serveur tire l'ordre d'arrivée ; ici, chaque démon reçoit un temps d'arrivée dans cet ordre et une course
  // mouvementée (accélérations, coups de mou) qui se termine pile à ce temps.
  const CD = C.course;
  const course = {
    mount(body, A) {
      const token = ++alive;
      const chances = Rules.courseChances();
      body.innerHTML = `
        <div class="race-stage"><canvas width="1000" height="380"></canvas></div>
        <div class="race-picks">${CD.demons.map((d) => `<button class="race-pick" data-demon="${d.id}" style="--dc:${d.color}">
            <canvas width="54" height="54"></canvas><b>${d.name}</b><span class="gold-text">×${String(d.pays).replace('.', ',')}</span><small class="muted">${Math.round(chances[d.id] * 100)} % de chances</small></button>`).join('')}</div>
        <div class="casino-controls"><div class="casino-bets"></div><button class="gold big-btn" data-go>🏁 Lancer la course</button></div>
        <div class="casino-pay"><span>Choisis ton démon puis lance la course : s'il gagne, tu touches la mise × sa cote.</span><span>Les favoris gagnent souvent, les outsiders rapportent gros.</span></div>`;
      const bet = A.betPicker(body.querySelector('.casino-bets'), 'course');
      const cv = body.querySelector('canvas');
      const ctx = cv.getContext('2d');
      const W = cv.width;
      const H = cv.height;
      const go = body.querySelector('[data-go]');
      let pick;
      try { pick = localStorage.getItem('zl_race_pick'); } catch (e) { pick = null; }
      if (!CD.demons.some((d) => d.id === pick)) pick = CD.demons[0].id;
      const syncPick = () => body.querySelectorAll('[data-demon]').forEach((b) => b.classList.toggle('active', b.dataset.demon === pick));
      body.querySelectorAll('[data-demon]').forEach((b) => {
        window.drawImp(b.querySelector('canvas').getContext('2d'), 27, 50, CD.demons.find((d) => d.id === b.dataset.demon).color, 0, 1.7);
        b.onclick = () => { if (race.phase === 'run') return; pick = b.dataset.demon; try { localStorage.setItem('zl_race_pick', pick); } catch (e) { /* ignore */ } Sound.play('chip'); syncPick(); };
      });
      syncPick();
      const lane0 = 70;
      const laneH = (H - lane0 - 20) / CD.demons.length;
      const startX = 70;
      const finishX = W - 70;
      const race = { phase: 'idle', t0: 0, runners: CD.demons.map((d) => ({ d, p: 0, T: 1, wob: [] })), leader: null, order: null, lastStep: 0 };
      function progress(r, t) {
        // part de 0 et arrive à 1 au temps T, avec des à-coups (somme de sinus nulle aux deux bouts)
        const u = Math.min(1, t / r.T);
        let w = 0;
        for (const [a, f, ph] of r.wob) w += a * Math.sin(f * u * Math.PI * 2 + ph) * Math.sin(u * Math.PI);
        return Math.max(0, Math.min(1, u + w));
      }
      function draw(now) {
        // lave et gradins
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#2a0806'); g.addColorStop(1, '#4a1008');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        // public de petits démons dans les gradins
        for (let i = 0; i < 40; i++) {
          const x = 14 + i * 25;
          const jump = race.phase === 'run' ? Math.abs(Math.sin(now / 120 + i)) * 4 : 0;
          ctx.fillStyle = ['#7a1a10', '#5a1410', '#9a2a14'][i % 3];
          ctx.beginPath(); ctx.arc(x, 34 - jump, 8, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#f4e6c8'; ctx.fillRect(x - 5, 24 - jump, 2, 4); ctx.fillRect(x + 3, 24 - jump, 2, 4);
        }
        ctx.fillStyle = '#ffd34a'; ctx.font = '900 14px system-ui'; ctx.textAlign = 'center';
        ctx.fillText('🔥 GRAND PRIX DES ENFERS 🔥', W / 2, 60);
        CD.demons.forEach((d, i) => {
          const y = lane0 + i * laneH;
          const lava = ctx.createLinearGradient(0, y, 0, y + laneH);
          lava.addColorStop(0, i % 2 ? '#ff6a1a' : '#ff8a2a'); lava.addColorStop(1, i % 2 ? '#d84010' : '#e85a18');
          ctx.fillStyle = lava; ctx.fillRect(startX - 30, y, finishX - startX + 60, laneH - 4);
          // bulles de lave
          for (let k = 0; k < 5; k++) { const bx = startX + ((now / 20 + k * 173 + i * 61) % (finishX - startX)); ctx.fillStyle = 'rgba(255, 230, 120, .5)'; ctx.beginPath(); ctx.arc(bx, y + laneH / 2 + Math.sin(now / 200 + k) * 6, 2.5, 0, Math.PI * 2); ctx.fill(); }
          ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(startX - 30, y + laneH - 6, finishX - startX + 60, 2);
          ctx.fillStyle = d.id === pick ? '#ffd34a' : '#fff'; ctx.font = '800 12px system-ui'; ctx.textAlign = 'left';
          ctx.fillText(d.name, 6, y + laneH / 2 + 4);
        });
        // ligne d'arrivée en damier
        for (let k = 0; k < (H - lane0) / 10; k++) { ctx.fillStyle = k % 2 ? '#fff' : '#111'; ctx.fillRect(finishX, lane0 + k * 10, 8, 10); ctx.fillStyle = k % 2 ? '#111' : '#fff'; ctx.fillRect(finishX + 8, lane0 + k * 10, 8, 10); }
        const t = race.phase === 'run' ? (now - race.t0) / 1000 : race.phase === 'done' ? 99 : 0;
        race.runners.forEach((r, i) => {
          const p = race.phase === 'idle' ? 0 : progress(r, t);
          r.p = p;
          const y = lane0 + i * laneH + laneH - 10;
          const x = startX + p * (finishX - startX);
          if (r.d.id === pick) { ctx.fillStyle = 'rgba(255, 211, 74, .25)'; ctx.fillRect(startX - 30, lane0 + i * laneH, finishX - startX + 60, laneH - 4); }
          window.drawImp(ctx, x, y, r.d.color, race.phase === 'run' && p < 1 ? now + i * 50 : 0, 1.4);
          if (race.phase === 'done' && race.order) {
            const rank = race.order.indexOf(r.d.id) + 1;
            ctx.font = '900 16px system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = rank === 1 ? '#ffd34a' : '#fff';
            ctx.fillText(rank === 1 ? '🏆 1ᵉʳ' : `${rank}ᵉ`, x + 18, y - 8);
          }
        });
        if (race.phase === 'run') {
          // commentaires : changement de tête
          const lead = race.runners.reduce((a, b) => (b.p > a.p ? b : a));
          if (lead.d.id !== race.leader && t > 0.6) { race.leader = lead.d.id; A.say(`${lead.d.name} prend la tête !`); }
          if (now - race.lastStep > 90) { race.lastStep = now; Sound.play('raceStep'); }
        }
        if (race.phase === 'count') {
          const n = 3 - Math.floor((now - race.t0) / 500);
          ctx.font = '900 64px "Orbitron", system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.6)';
          const txt = n > 0 ? String(n) : 'PARTEZ !';
          ctx.strokeText(txt, W / 2, H / 2 + 20); ctx.fillStyle = '#ffd34a'; ctx.fillText(txt, W / 2, H / 2 + 20);
        }
      }
      function frame(now) { if (token !== alive) return; draw(now); requestAnimationFrame(frame); }
      requestAnimationFrame(frame);
      go.onclick = async () => {
        if (race.phase === 'run' || race.phase === 'count') return;
        const d = CD.demons.find((x) => x.id === pick);
        const r = await A.call('/api/casino/course', { bet: bet.value, ticket: bet.ticket, demon: pick }, bet.stake);
        if (!r || token !== alive) return;
        go.disabled = true;
        // temps d'arrivée dans l'ordre tiré par le serveur
        let T = 5.2 + Math.random() * 0.6;
        r.order.forEach((id) => {
          const run = race.runners.find((x) => x.d.id === id);
          run.T = T;
          run.wob = [[0.05 + Math.random() * 0.05, 1 + Math.random() * 2, Math.random() * 6], [0.03 * Math.random(), 3 + Math.random() * 3, Math.random() * 6]];
          T += 0.12 + Math.random() * 0.45;
        });
        race.phase = 'count';
        race.t0 = performance.now();
        race.leader = null;
        race.order = null;
        Sound.play('raceStart');
        A.say(`Tu mises sur ${d.name} ? Hi hi… que la lave décide !`);
        await sleep(1500);
        if (token !== alive) return;
        race.phase = 'run';
        race.t0 = performance.now();
        await sleep(Math.max(...race.runners.map((x) => x.T)) * 1000 + 300);
        if (token !== alive) return;
        race.phase = 'done';
        race.order = r.order;
        const winner = CD.demons.find((x) => x.id === r.winner);
        A.settle(r.payout, r.bet, { win: r.win, banner: r.win && winner.pays >= 10 ? `😈 ${winner.name.toUpperCase()} L'OUTSIDER ! +${fmt(r.payout)} 🪙` : null });
        if (!r.win) A.say(`${winner.name} gagne ! Ton démon a fini en cendres.`);
        go.disabled = false;
        go.textContent = '🏁 Nouvelle course';
      };
    },
    unmount() { alive++; },
  };

  window.CasinoGames = { slots, blackjack, roulette, caisse, glace, gobelets, heaven, chaton, course };
})();
