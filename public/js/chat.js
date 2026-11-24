/*
 * Tchat du site (serveur : server/chat.js). Un seul salon, affiché de plusieurs façons :
 *  - « full »    : le lieu Taverne de la page joueur (messages, joueurs en ligne, émotes, commandes) ;
 *  - « bubble »  : la bulle 💬 flottante de la page joueur (on discute sans quitter son activité) ;
 *  - « overlay » : l'incrustation transparente de l'arène en direct (les messages s'effacent seuls) ;
 *  - « admin »   : la modération (supprimer, mettre en sourdine, vider le salon).
 * Chat.init(socket, { me }) charge l'historique, s'abonne (room « chat ») et tient toutes les vues à jour.
 * Utilise les globales : api, esc, toast, Rules, Emotes, Sound (facultatif).
 */
(function () {
  const C = () => Rules.CHAT;
  const S = { messages: [], online: { n: 0, names: [] }, views: [], name: () => null, id: () => null, unread: 0, mentions: 0, ready: false };

  // Couleur d'un pseudo : celle choisie pour le personnage, sinon calculée depuis le pseudo (comme le personnage)
  function hueOf(name) {
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  }
  const colorOf = (m) => m.color || `hsl(${hueOf(m.name)}, 72%, 70%)`;
  const mentions = (m) => {
    const n = S.name();
    return !!(n && !m.sys && m.text && m.uid !== S.id() && new RegExp('@' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(m.text));
  };
  const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  // Texte avec émotes, @pseudo en évidence
  function body(textValue) {
    return Emotes.html(textValue).replace(/(^|[\s(])@([A-Za-z0-9_À-ÿ]{2,25})/g, '$1<span class="ct-at">@$2</span>');
  }

  function msgHtml(m, opts = {}) {
    const time = opts.time === false ? '' : `<span class="ct-time">${hhmm(m.at)}</span>`;
    const del = opts.admin && !m.sys ? `<button type="button" class="ct-mod" data-del="${m.id}" title="Supprimer">🗑</button><button type="button" class="ct-mod" data-mute="${esc(m.uid || '')}" data-name="${esc(m.name || '')}" title="Mettre en sourdine">🔇</button>`
      : opts.admin ? `<button type="button" class="ct-mod" data-del="${m.id}" title="Supprimer">🗑</button>` : '';
    if (m.sys) return `<div class="ct-msg ct-sys ct-k-${esc(m.kind || 'info')}" data-id="${m.id}">${time}<span class="ct-text">${body(m.text)}</span>${del}</div>`;
    const ci = m.cls && Rules.CLASS_INFO[m.cls];
    const name = `<span class="ct-name" style="color:${colorOf(m)}" data-name="${esc(m.name)}">${ci ? `<span class="ct-cls">${ci.icon}</span>` : ''}${esc(m.name)}</span>`;
    const title = m.title && opts.title !== false ? `<span class="ct-title" title="${esc(m.title)}">${esc(m.title)}</span>` : '';
    let content;
    if (m.roll) content = `<span class="ct-text ct-roll">🎲 lance un dé (1-${m.roll.max}) : <b>${m.roll.n}</b></span>`;
    else if (m.flip) content = `<span class="ct-text ct-roll">🪙 lance une pièce : <b>${m.flip}</b></span>`;
    else if (m.me) content = `<span class="ct-text ct-me">${body(m.text)}</span>`;
    else content = `<span class="ct-sep">:</span> <span class="ct-text">${body(m.text)}</span>`;
    return `<div class="ct-msg ${mentions(m) ? 'ct-mention' : ''} ${m.me || m.roll || m.flip ? 'ct-action' : ''}" data-id="${m.id}">${time}${name}${title} ${content}${del}</div>`;
  }

  // ---------- Vues ----------
  function emotePicker(view) {
    const pick = document.createElement('div');
    pick.className = 'ct-picker';
    pick.innerHTML = Emotes.ids().map((id) => `<button type="button" data-emote="${id}" title="${esc(Rules.CHAT_EMOTES[id].label)} — :${id}:">${Emotes.img(id)}</button>`).join('');
    pick.querySelectorAll('[data-emote]').forEach((b) => {
      b.onclick = (e) => {
        e.preventDefault();
        const inp = view.input;
        const add = `:${b.dataset.emote}: `;
        const pos = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
        inp.value = (inp.value.slice(0, pos) + (pos && !/\s$/.test(inp.value.slice(0, pos)) ? ' ' : '') + add + inp.value.slice(pos)).slice(0, C().maxLen);
        inp.focus();
      };
    });
    return pick;
  }

  function makeView(root, mode) {
    const v = { root, mode, list: null, input: null, last: [] };
    root.classList.add('ct', 'ct-' + mode);
    if (mode === 'overlay') {
      root.innerHTML = '<div class="ct-list"></div>';
      v.list = root.querySelector('.ct-list');
      return v;
    }
    const side = mode === 'full'
      ? `<aside class="ct-side"><div class="ct-online"><b>🟢 En ligne</b> <span class="ct-online-n">0</span><div class="ct-online-list"></div></div>
          <div class="ct-help"><b>💡 Commandes</b><code>/me</code> une action · <code>/roll</code> un dé · <code>/pile</code> pile ou face · <code>@pseudo</code> pour interpeller quelqu'un (clic sur un pseudo).</div></aside>` : '';
    const form = mode === 'admin' ? `<div class="row ct-admin-tools"><span class="muted">Clique 🗑 pour supprimer un message, 🔇 pour mettre son auteur en sourdine.</span><span class="spacer"></span><button type="button" class="secondary small danger" data-clear>Vider le salon</button></div>`
      : `<form class="ct-form" autocomplete="off"><button type="button" class="ct-emo-btn" title="Émotes">😀</button>
          <input class="ct-input" maxlength="${C().maxLen}" placeholder="Écris un message… (:pyrax:, /roll, @pseudo)" enterkeyhint="send">
          <button type="submit" class="ct-send" title="Envoyer">➤</button></form>`;
    root.innerHTML = `<div class="ct-main"><div class="ct-list" aria-live="polite"></div>${form}</div>${side}`;
    v.list = root.querySelector('.ct-list');
    if (mode === 'admin') {
      root.querySelector('[data-clear]').onclick = async () => { if (await confirmBox('Vider tout le salon du tchat ?')) api('/api/admin/chat/clear', {}).catch((e) => toast('⚠️ ' + e.message)); };
      root.addEventListener('click', async (e) => {
        const d = e.target.closest('[data-del]');
        if (d) { api('/api/admin/chat/delete', { id: Number(d.dataset.del) }).catch((err) => toast('⚠️ ' + err.message)); return; }
        const m = e.target.closest('[data-mute]');
        if (m && m.dataset.mute) {
          const min = await promptBox(`Sourdine pour ${m.dataset.name} (minutes, 0 pour la lever) :`, '30');
          if (min != null) api('/api/admin/chat/mute', { userId: m.dataset.mute, minutes: Number(min) }).then((r) => toast(r.muted ? `🔇 ${r.name} en sourdine ${r.muted} min` : `🔊 Sourdine de ${r.name} levée`)).catch((err) => toast('⚠️ ' + err.message));
        }
      });
      return v;
    }
    v.input = root.querySelector('.ct-input');
    const picker = emotePicker(v);
    root.querySelector('.ct-form').appendChild(picker);
    root.querySelector('.ct-emo-btn').onclick = (e) => { e.stopPropagation(); picker.classList.toggle('open'); };
    document.addEventListener('click', (e) => { if (!e.target.closest('.ct-picker') && !e.target.closest('.ct-emo-btn')) picker.classList.remove('open'); });
    root.querySelector('.ct-form').onsubmit = (e) => { e.preventDefault(); send(v); };
    v.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' && !v.input.value && v.last.length) { v.input.value = v.last[v.last.length - 1]; e.preventDefault(); }
      if (e.key === 'Escape') picker.classList.remove('open');
    });
    // Clic sur un pseudo : l'interpeller
    v.list.addEventListener('click', (e) => {
      const n = e.target.closest('.ct-name');
      if (n && v.input) { v.input.value = (`@${n.dataset.name} ` + v.input.value).slice(0, C().maxLen); v.input.focus(); }
    });
    return v;
  }

  async function send(v) {
    const text = v.input.value.trim();
    if (!text) return;
    try {
      const r = await api('/api/chat', { text });
      v.input.value = '';
      v.last.push(text);
      if (v.last.length > 20) v.last.shift();
      if (r.private) addLocal(r.private);
    } catch (err) { toast('⚠️ ' + err.message); }
  }
  // Ligne pour soi seul (réponse à /aide)
  function addLocal(text) {
    for (const v of S.views) if (v.mode !== 'overlay' && v.mode !== 'admin') {
      v.list.insertAdjacentHTML('beforeend', `<div class="ct-msg ct-sys ct-local"><span class="ct-text">${esc(text)}</span></div>`);
      v.list.scrollTop = v.list.scrollHeight;
    }
  }

  // ---------- Rendu ----------
  function renderView(v, full) {
    if (v.mode === 'overlay') return renderOverlay(v);
    const atBottom = v.list.scrollHeight - v.list.scrollTop - v.list.clientHeight < 60;
    const opts = { admin: v.mode === 'admin', title: v.mode !== 'bubble' || window.innerWidth > 420 };
    if (full) v.list.innerHTML = S.messages.map((m) => msgHtml(m, opts)).join('') || '<div class="ct-empty muted">Personne n\'a encore parlé… lance la conversation !</div>';
    if (atBottom || full) v.list.scrollTop = v.list.scrollHeight;
    const n = v.root.querySelector('.ct-online-n');
    if (n) {
      n.textContent = S.online.n;
      v.root.querySelector('.ct-online-list').innerHTML = S.online.names.map((x) => `<span class="ct-on" data-name="${esc(x)}">${esc(x)}</span>`).join('');
      v.root.querySelectorAll('.ct-on').forEach((el) => { el.onclick = () => { const inp = v.root.querySelector('.ct-input'); if (inp) { inp.value = (`@${el.dataset.name} ` + inp.value).slice(0, C().maxLen); inp.focus(); } }; });
    }
  }
  function appendTo(v, m) {
    if (v.mode === 'overlay') return renderOverlay(v);
    const empty = v.list.querySelector('.ct-empty');
    if (empty) empty.remove();
    const atBottom = v.list.scrollHeight - v.list.scrollTop - v.list.clientHeight < 80;
    v.list.insertAdjacentHTML('beforeend', msgHtml(m, { admin: v.mode === 'admin', title: v.mode !== 'bubble' || window.innerWidth > 420 }));
    while (v.list.children.length > C().history) v.list.firstElementChild.remove();
    if (atBottom || m.uid === S.id()) v.list.scrollTop = v.list.scrollHeight;
  }
  // Incrustation de l'arène : les derniers messages, qui s'effacent au bout de quelques dizaines de secondes
  function renderOverlay(v) {
    const now = Date.now();
    const life = C().overlayLife * 1000;
    const recent = S.messages.filter((m) => now - m.at < life).slice(-6);
    v.list.innerHTML = recent.map((m) => {
      const left = life - (now - m.at);
      return `<div class="ct-ov" style="animation-delay:${-Math.max(0, (now - m.at)) / 1000}s;--life:${life / 1000}s">${msgHtml(m, { time: false, title: false })}</div>`;
    }).join('');
    v.root.classList.toggle('empty', !recent.length);
  }

  function refreshAll(full) { for (const v of S.views) renderView(v, full); }

  function onEvent(e) {
    if (e.add) {
      if (S.messages.some((m) => m.id === e.add.id)) return;
      S.messages.push(e.add);
      if (S.messages.length > C().history) S.messages.splice(0, S.messages.length - C().history);
      for (const v of S.views) appendTo(v, e.add);
      const mine = e.add.uid && e.add.uid === S.id();
      if (!e.add.sys && !mine) {
        S.unread += 1;
        if (mentions(e.add)) {
          S.mentions += 1;
          if (window.Sound) Sound.play('reward');
          if (!Chat.visible()) toast(`💬 ${e.add.name} t'interpelle : ${e.add.text.slice(0, 80)}`, 5000);
        }
      }
      if (Chat.onChange) Chat.onChange();
    } else if (e.del) {
      S.messages = S.messages.filter((m) => m.id !== e.del);
      for (const v of S.views) { const el = v.list.querySelector(`[data-id="${e.del}"]`); if (el) el.remove(); if (v.mode === 'overlay') renderOverlay(v); }
    } else if (e.clear) {
      S.messages = [];
      refreshAll(true);
    }
  }

  async function load() {
    try {
      const r = await api('/api/chat');
      S.messages = r.messages || [];
      S.online = r.online || S.online;
      S.ready = true;
      refreshAll(true);
    } catch (e) { /* hors ligne : on réessaiera à la reconnexion */ }
  }

  // o.name() / o.id() : pseudo et identifiant du joueur connecté (pour repérer ses messages et ceux qui l'interpellent)
  function init(socket, o = {}) {
    if (o.name) S.name = o.name;
    if (o.id) S.id = o.id;
    socket.on('chat', onEvent);
    socket.on('chatOnline', (on) => { S.online = on; for (const v of S.views) if (v.mode === 'full') renderView(v, false); });
    const join = () => { socket.emit('chat:join'); load(); };
    socket.on('connect', join);
    if (socket.connected) join();
    // L'incrustation de l'arène efface les vieux messages
    setInterval(() => { for (const v of S.views) if (v.mode === 'overlay') renderOverlay(v); }, 2000);
  }

  function mount(root, mode) {
    const v = makeView(root, mode);
    S.views.push(v);
    renderView(v, true);
    return v;
  }

  const Chat = {
    init, mount,
    get unread() { return S.unread; },
    get mentions() { return S.mentions; },
    markRead() { S.unread = 0; S.mentions = 0; if (Chat.onChange) Chat.onChange(); },
    visible: () => false, // remplacé par la page joueur (onglet Taverne ou bulle ouverte)
    onChange: null,
    scrollDown() { for (const v of S.views) if (v.list && v.mode !== 'overlay') v.list.scrollTop = v.list.scrollHeight; },
  };
  window.Chat = Chat;
})();
