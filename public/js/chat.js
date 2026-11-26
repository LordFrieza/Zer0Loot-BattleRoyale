/*
 * Tchat du site (serveur : server/chat.js), en plusieurs salons (Rules.CHAT_ROOMS : Général, Pêche, Strat & builds,
 * Commerce), affichés de plusieurs façons :
 *  - « full »    : le lieu Taverne de la page joueur (onglets des salons, joueurs en ligne, émotes, commandes) ;
 *  - « bubble »  : la bulle 💬 flottante de la page joueur (on discute sans quitter son activité) ;
 *  - « pond »    : sous l'étang de pêche (salon Pêche ouvert par défaut, actions des pêcheurs en direct) ;
 *  - « overlay » : l'incrustation transparente de l'arène en direct (salon Général seulement, messages qui s'effacent) ;
 *  - « admin »   : la modération (supprimer, mettre en sourdine, vider un salon).
 * Chat.init(socket, { me }) charge l'historique, s'abonne (room « chat ») et tient toutes les vues à jour.
 * Chat.listen(fn) : appelé à chaque nouveau message (la Pêche s'en sert pour les bulles au-dessus des barques).
 * Utilise les globales : api, esc, toast, Rules, Emotes, Sound (facultatif).
 */
(function () {
  const C = () => Rules.CHAT;
  const ROOMS = () => Rules.CHAT_ROOM_IDS;
  const S = { rooms: {}, online: { n: 0, names: [] }, views: [], name: () => null, id: () => null, unread: 0, mentions: 0, ready: false, listeners: [] };
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* ignore */ } return null; };
  let showActs = store('zl_chat_acts') !== '0'; // lignes d'action des pêcheurs (salon Pêche)
  const listOf = (room) => S.rooms[room] || (S.rooms[room] = []);

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
  const RCOL = { commun: '#c8ccd4', peu_commun: '#3ddc5a', rare: '#5a9bff', epique: '#c26bff', legendaire: '#ff9a1f', tresor: '#ffd34a' };

  // Texte avec émotes, @pseudo en évidence
  function body(textValue) {
    return Emotes.html(textValue).replace(/(^|[\s(])@([A-Za-z0-9_À-ÿ]{2,25})/g, '$1<span class="ct-at">@$2</span>');
  }

  function msgHtml(m, opts = {}) {
    const time = opts.time === false ? '' : `<span class="ct-time">${hhmm(m.at)}</span>`;
    const del = opts.admin && !m.sys ? `<button type="button" class="ct-mod" data-del="${m.id}" title="Supprimer">🗑</button><button type="button" class="ct-mod" data-mute="${esc(m.uid || '')}" data-name="${esc(m.name || '')}" title="Mettre en sourdine">🔇</button>`
      : opts.admin && !m.eph ? `<button type="button" class="ct-mod" data-del="${m.id}" title="Supprimer">🗑</button>` : '';
    if (m.act) {
      // Action d'un pêcheur : son pseudo, puis ce qu'il a fait (couleur de la rareté pour une prise)
      const r = (m.fish && m.fish.rarity) || m.rarity || (m.kind === 'fishtreasure' ? 'tresor' : null);
      const style = r ? ` style="--rc:${RCOL[r] || RCOL.commun}"` : '';
      return `<div class="ct-msg ct-sys ct-act ct-k-${esc(m.kind || 'info')}${r ? ' ct-rar' : ''}" data-id="${m.id}"${style}>${time}<span class="ct-who" data-name="${esc(m.who || '')}" style="color:hsl(${hueOf(m.who || '')}, 72%, 74%)">${esc(m.who || '')}</span> <span class="ct-text">${body(m.text)}</span>${del}</div>`;
    }
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
  // Messages d'un salon tels qu'une vue les montre (sans les actions des pêcheurs si on les a masquées)
  const visibleOf = (room) => listOf(room).filter((m) => showActs || !m.act);

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

  const formHtml = () => `<form class="ct-form" autocomplete="off"><button type="button" class="ct-emo-btn" title="Émotes">😀</button>
          <input class="ct-input" maxlength="${C().maxLen}" placeholder="Écris un message… (:pyrax:, /roll, @pseudo)" enterkeyhint="send">
          <button type="submit" class="ct-send" title="Envoyer">➤</button></form>`;

  // Onglets des salons (avec le nombre de messages non lus) ; dans le salon Pêche, un bouton masque les actions
  const tabsHtml = () => `<div class="ct-tabs" role="tablist">${ROOMS().map((r) => { const R = Rules.CHAT_ROOMS[r]; return `<button type="button" class="ct-tab" data-room="${r}" title="${esc(R.desc)}"><span>${R.icon}</span><span class="ct-tab-l">${esc(R.label)}</span><b class="ct-tab-n"></b></button>`; }).join('')}
      <button type="button" class="ct-acts" title="Afficher ou masquer les actions des pêcheurs (prises, trésors…)">📣</button></div>`;

  // Saisie : émotes, envoi, ↑ pour rappeler son dernier message, clic sur un pseudo pour l'interpeller
  function wireForm(v, root) {
    v.input = root.querySelector('.ct-input');
    const picker = emotePicker(v);
    root.querySelector('.ct-form').appendChild(picker);
    root.querySelector('.ct-emo-btn').onclick = (e) => { e.stopPropagation(); picker.classList.toggle('open'); };
    document.addEventListener('click', (e) => { if (!e.target.closest('.ct-picker') && !e.target.closest('.ct-emo-btn')) picker.classList.remove('open'); });
    root.querySelector('.ct-form').onsubmit = (e) => { e.preventDefault(); send(v); };
    v.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' && !v.input.value && v.last.length) { v.input.value = v.last[v.last.length - 1]; e.preventDefault(); }
      if (e.key === 'Escape') { if (picker.classList.contains('open')) picker.classList.remove('open'); else if (v.close) v.close(); }
    });
    v.list.addEventListener('click', (e) => {
      const n = e.target.closest('.ct-name, .ct-who');
      if (n && v.input && n.dataset.name) { v.input.value = (`@${n.dataset.name} ` + v.input.value).slice(0, C().maxLen); v.input.focus(); }
    });
  }

  function wireTabs(v, root) {
    v.tabs = root.querySelector('.ct-tabs');
    if (!v.tabs) return;
    v.tabs.querySelectorAll('[data-room]').forEach((b) => { b.onclick = () => setRoom(v, b.dataset.room, true); });
    v.tabs.querySelector('.ct-acts').onclick = () => {
      showActs = !showActs;
      store('zl_chat_acts', showActs ? '1' : '0');
      refreshAll(true);
    };
  }
  function renderTabs(v) {
    if (!v.tabs) return;
    v.tabs.querySelectorAll('[data-room]').forEach((b) => {
      const r = b.dataset.room;
      b.classList.toggle('active', r === v.room);
      const n = v.unread[r] || 0;
      const el = b.querySelector('.ct-tab-n');
      el.textContent = n ? (n > 99 ? '99+' : n) : '';
      b.classList.toggle('has-new', !!n);
    });
    const acts = v.tabs.querySelector('.ct-acts');
    acts.style.display = v.room === 'peche' ? '' : 'none';
    acts.classList.toggle('off', !showActs);
    acts.title = showActs ? 'Masquer les actions des pêcheurs (prises, trésors…)' : 'Afficher les actions des pêcheurs (prises, trésors…)';
    if (v.input) v.input.placeholder = `${Rules.CHAT_ROOMS[v.room].icon} ${Rules.CHAT_ROOMS[v.room].label} — écris un message… (:pyrax:, /roll, @pseudo)`;
  }
  function setRoom(v, room, remember) {
    if (!Rules.CHAT_ROOMS[room]) return;
    v.room = room;
    v.unread[room] = 0;
    if (remember && v.mode !== 'pond') store('zl_chat_room_' + v.mode, room);
    renderView(v, true);
    if (Chat.onChange) Chat.onChange();
  }

  function makeView(root, mode, o = {}) {
    const v = { root, mode, list: null, input: null, last: [], unread: {}, room: 'general' };
    root.classList.add('ct', 'ct-' + mode);
    if (mode === 'overlay') {
      // Incrustation de l'arène (salon Général) ; o.input : un bouton 💬 ouvre une barre de saisie (joueur connecté)
      root.innerHTML = '<div class="ct-list"></div>' + (o.input ? `<div class="ct-ov-bar"><button type="button" class="ct-ov-open" title="Écrire dans le tchat">💬</button>${formHtml()}</div>` : '');
      v.list = root.querySelector('.ct-list');
      if (o.input) {
        v.hasInput = true;
        root.classList.add('ct-has-input');
        wireForm(v, root);
        v.open = () => { v.typing = true; root.classList.add('typing'); renderOverlay(v); setTimeout(() => v.input.focus(), 30); };
        v.close = () => { v.typing = false; root.classList.remove('typing'); v.input.blur(); renderOverlay(v); };
        root.querySelector('.ct-ov-open').onclick = () => (v.typing ? v.close() : v.open());
      }
      return v;
    }
    v.room = o.room || store('zl_chat_room_' + mode) || 'general';
    if (!Rules.CHAT_ROOMS[v.room]) v.room = 'general';
    const side = mode === 'full'
      ? `<aside class="ct-side"><div class="ct-online"><b>🟢 En ligne</b> <span class="ct-online-n">0</span><div class="ct-online-list"></div></div>
          <div class="ct-help"><b>💡 Commandes</b><code>/me</code> une action · <code>/roll</code> un dé · <code>/pile</code> pile ou face · <code>@pseudo</code> pour interpeller quelqu'un (clic sur un pseudo).</div></aside>` : '';
    const form = mode === 'admin' ? `<div class="row ct-admin-tools"><span class="muted">Clique 🗑 pour supprimer un message, 🔇 pour mettre son auteur en sourdine.</span><span class="spacer"></span><button type="button" class="secondary small danger" data-clear>Vider ce salon</button></div>`
      : formHtml();
    root.innerHTML = `<div class="ct-main">${tabsHtml()}<div class="ct-list" aria-live="polite"></div>${form}</div>${side}`;
    v.list = root.querySelector('.ct-list');
    wireTabs(v, root);
    if (mode === 'admin') {
      root.querySelector('[data-clear]').onclick = async () => { if (await confirmBox(`Vider le salon ${Rules.CHAT_ROOMS[v.room].label} du tchat ?`)) api('/api/admin/chat/clear', { room: v.room }).catch((e) => toast('⚠️ ' + e.message)); };
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
    wireForm(v, root);
    return v;
  }

  async function send(v) {
    const text = v.input.value.trim();
    if (!text) return;
    try {
      const r = await api('/api/chat', { text, room: v.mode === 'overlay' ? 'general' : v.room });
      v.input.value = '';
      v.last.push(text);
      if (v.last.length > 20) v.last.shift();
      if (r.private) addLocal(r.private, v);
    } catch (err) { toast('⚠️ ' + err.message); }
  }
  // Ligne pour soi seul (réponse à /aide), dans la vue où on l'a demandée
  function addLocal(text, v) {
    v.list.insertAdjacentHTML('beforeend', `<div class="ct-msg ct-sys ct-local"><span class="ct-text">${esc(text)}</span></div>`);
    v.list.scrollTop = v.list.scrollHeight;
  }

  // ---------- Rendu ----------
  function renderView(v, full) {
    if (v.mode === 'overlay') return renderOverlay(v);
    renderTabs(v);
    const atBottom = v.list.scrollHeight - v.list.scrollTop - v.list.clientHeight < 60;
    const opts = { admin: v.mode === 'admin', title: (v.mode !== 'bubble' && v.mode !== 'pond') || window.innerWidth > 420 };
    if (full) {
      const R = Rules.CHAT_ROOMS[v.room];
      v.list.innerHTML = visibleOf(v.room).map((m) => msgHtml(m, opts)).join('') || `<div class="ct-empty muted">${R.icon} Personne n'a encore parlé dans le salon ${esc(R.label)}… lance la conversation !</div>`;
    }
    if (atBottom || full) v.list.scrollTop = v.list.scrollHeight;
    const n = v.root.querySelector('.ct-online-n');
    if (n) {
      n.textContent = S.online.n;
      v.root.querySelector('.ct-online-list').innerHTML = S.online.names.map((x) => `<span class="ct-on" data-name="${esc(x)}">${esc(x)}</span>`).join('');
      v.root.querySelectorAll('.ct-on').forEach((el) => { el.onclick = () => { const inp = v.root.querySelector('.ct-input'); if (inp) { inp.value = (`@${el.dataset.name} ` + inp.value).slice(0, C().maxLen); inp.focus(); } }; });
    }
  }
  function appendTo(v, m) {
    if (v.mode === 'overlay') { if (m.room === 'general') renderOverlay(v); return; }
    if (m.room !== v.room) {
      // Autre salon : une pastille sur son onglet (sauf les annonces et les actions)
      if (!m.sys && m.uid !== S.id()) { v.unread[m.room] = (v.unread[m.room] || 0) + 1; renderTabs(v); }
      return;
    }
    if (m.act && !showActs) return;
    const empty = v.list.querySelector('.ct-empty');
    if (empty) empty.remove();
    const atBottom = v.list.scrollHeight - v.list.scrollTop - v.list.clientHeight < 80;
    v.list.insertAdjacentHTML('beforeend', msgHtml(m, { admin: v.mode === 'admin', title: (v.mode !== 'bubble' && v.mode !== 'pond') || window.innerWidth > 420 }));
    while (v.list.children.length > C().history) v.list.firstElementChild.remove();
    if (atBottom || m.uid === S.id()) v.list.scrollTop = v.list.scrollHeight;
  }
  // Incrustation de l'arène : les derniers messages du salon Général, qui s'effacent au bout de quelques dizaines de
  // secondes (barre de saisie ouverte : les 8 derniers messages restent affichés, sans s'effacer)
  function renderOverlay(v) {
    const now = Date.now();
    const life = C().overlayLife * 1000;
    const all = listOf('general');
    const recent = v.typing ? all.slice(-8) : all.filter((m) => now - m.at < life).slice(-6);
    v.list.innerHTML = recent.map((m) => `<div class="ct-ov" style="animation-delay:${-Math.max(0, (now - m.at)) / 1000}s;--life:${life / 1000}s">${msgHtml(m, { time: false, title: false })}</div>`).join('');
    v.root.classList.toggle('empty', !recent.length && !v.hasInput);
    v.list.classList.toggle('ct-none', !recent.length);
  }

  function refreshAll(full) { for (const v of S.views) renderView(v, full); }

  function onEvent(e) {
    if (e.add) {
      const m = e.add;
      if (!m.room) m.room = 'general';
      const list = listOf(m.room);
      if (list.some((x) => x.id === m.id)) return;
      list.push(m);
      if (list.length > C().history) list.splice(0, list.length - C().history);
      for (const v of S.views) appendTo(v, m);
      for (const fn of S.listeners) { try { fn(m); } catch (err) { /* ignore */ } }
      const mine = m.uid && m.uid === S.id();
      if (!m.sys && !mine) {
        S.unread += 1;
        if (mentions(m)) {
          S.mentions += 1;
          if (window.Sound) Sound.play('reward');
          if (!Chat.visible()) toast(`💬 ${m.name} t'interpelle : ${m.text.slice(0, 80)}`, 5000);
        }
      }
      if (Chat.onChange) Chat.onChange();
    } else if (e.del) {
      for (const r of Object.keys(S.rooms)) S.rooms[r] = S.rooms[r].filter((m) => m.id !== e.del);
      for (const v of S.views) { const el = v.list.querySelector(`[data-id="${e.del}"]`); if (el) el.remove(); if (v.mode === 'overlay') renderOverlay(v); }
    } else if (e.clear) {
      if (e.room) S.rooms[e.room] = []; else S.rooms = {};
      refreshAll(true);
    }
  }

  async function load() {
    try {
      const r = await api('/api/chat');
      S.rooms = r.rooms ? { ...r.rooms } : { general: r.messages || [] };
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

  function mount(root, mode, o = {}) {
    const v = makeView(root, mode, o);
    S.views.push(v);
    renderView(v, true);
    return { setRoom: (room) => setRoom(v, room, false), get room() { return v.room; }, view: v };
  }

  const Chat = {
    init, mount,
    listen(fn) { S.listeners.push(fn); },
    get unread() { return S.unread; },
    get mentions() { return S.mentions; },
    markRead() { S.unread = 0; S.mentions = 0; if (Chat.onChange) Chat.onChange(); },
    visible: () => false, // remplacé par la page joueur (onglet Taverne ou bulle ouverte)
    onChange: null,
    scrollDown() { for (const v of S.views) if (v.list && v.mode !== 'overlay') v.list.scrollTop = v.list.scrollHeight; },
  };
  window.Chat = Chat;
})();
