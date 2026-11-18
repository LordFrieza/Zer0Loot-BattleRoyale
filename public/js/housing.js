/*
 * Onglet Maison : ta façade et ta pièce (dessins de housing-draw.js), l'éditeur (glisser-déposer des meubles,
 * clic droit pour retourner, double-clic pour ranger), la boutique, les styles, l'agrandissement, la boîte aux
 * lettres, et les visites chez les autres joueurs (avec un ❤️). Le serveur vérifie chaque disposition.
 * Utilise les globales de la page : me, api, toast, esc, refresh, Sound, Rules, drawFighter.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
  const EM = '<i class="ico-emerald"></i>';
  const FUR = Rules.FURNITURE;

  let active = false;
  let mine = null; // GET /api/house
  let yardBox = null; // zone de l'enclos sur la façade (clic → onglet Familier)
  let view = null; // maison affichée (la mienne ou celle d'un autre)
  let editing = false;
  let sideTab = 'meubles';
  let shopCat = 'assises';
  let raf = 0;
  let room = null; // géométrie de la pièce (dernier dessin)
  let ext = null; // zones cliquables de la façade
  let ghost = null; // { id, x, y, ok, flip, from (index du meuble déplacé) }
  let selected = null; // meuble choisi dans « Mes meubles »
  let stylePreview = null; // { part, id } : option essayée avant l'achat
  let furnPreview = null; // { id, x, y } : meuble essayé dans la pièce avant l'achat
  let houses = [];
  const walker = { x: 1, y: 1, path: [], wait: 1, facing: 1 };

  // ---------- Chargement ----------
  async function load() {
    try {
      mine = await api('/api/house');
      if (!view || view.mine) view = mine.house;
      renderAll();
      loadList();
    } catch (e) { /* hors ligne */ }
  }
  async function loadList(q = '') {
    try {
      houses = (await api('/api/houses' + (q ? `?q=${encodeURIComponent(q)}` : ''))).houses;
      if (!q && window.HouseLife) HouseLife.setPeople(houses.filter((h) => !mine || h.id !== mine.house.id)); // les passants devant la maison
      renderVisit();
    } catch (e) { /* ignore */ }
  }

  function owned(id) {
    return (mine.owned[id] || 0);
  }
  function placedCount(id) {
    return mine.house.placed.filter((p) => p.id === id).length;
  }

  // ---------- En-tête ----------
  function renderHead() {
    const h = view;
    const L = h.level;
    const pct = L.next ? Math.round(((L.points - L.cur) / (L.next - L.cur)) * 100) : 100;
    if (!h.mine) {
      $('house-head').innerHTML = `<div class="house-headbar visiting">
        <div class="hh-title">🏠 Maison de <b>${esc(h.name)}</b></div>
        <div class="hh-level"><span class="hh-badge">Niv. ${L.level}</span> ${fmt(L.points)} points de déco</div>
        <div class="hh-meta">❤️ ${h.likes} · 👁️ ${fmt(h.visits)} visites</div>
        <span class="spacer"></span>
        <button class="${h.liked ? 'gold' : 'secondary'}" id="hh-like">${h.liked ? '❤️ Tu aimes' : '🤍 J\'aime'}</button>
        <button class="secondary" id="hh-home">↩ Retour chez moi</button></div>`;
      $('hh-like').onclick = like;
      $('hh-home').onclick = () => { view = mine.house; editing = false; renderAll(); };
      return;
    }
    const due = Rules.houseMailDue(mine.mailAt);
    $('house-head').innerHTML = `<div class="house-headbar">
      <div class="hh-level-box"><span class="hh-badge big">Niv. ${L.level}</span>
        <div><div class="hh-level-title">Niveau de décoration</div>
        <div class="hh-bar"><span style="width:${pct}%"></span></div>
        <div class="hh-sub">${fmt(L.points)} points${L.next ? ` · prochain niveau à ${fmt(L.next)}` : ' · niveau maximum !'}</div></div></div>
      <div class="hh-meta">${EM} <b>${fmt(mine.emeralds)}</b> émeraudes<br>❤️ ${h.likes} · 👁️ ${fmt(h.visits)} visites</div>
      <div class="hh-mail ${due ? 'full' : ''}">📬 ${due ? `<b>${due}</b> courrier${due > 1 ? 's' : ''} !` : 'Boîte vide'}
        <div class="hh-sub">${due ? '' : `Prochain dans ${mailIn()}`}</div>
        <div class="hh-sub" title="Contenu moyen d'un courrier à ton niveau de décoration">${mailText(L.level)}</div>
        ${due ? '<button class="gold small" id="hh-mail">Ouvrir</button>' : ''}</div>
      <span class="spacer"></span>
      <button class="${editing ? 'gold' : 'secondary'}" id="hh-edit">${editing ? '✅ Terminer' : '✏️ Décorer'}</button></div>`;
    $('hh-edit').onclick = () => { editing = !editing; selected = null; ghost = null; furnPreview = null; renderAll(); };
    if ($('hh-mail')) $('hh-mail').onclick = collect;
  }
  function mailIn() {
    const period = Rules.HOUSING.mailbox.everyH * 3600 * 1000;
    const left = period - ((Date.now() - mine.mailAt) % period);
    const h = Math.floor(left / 3600000);
    const m = Math.floor((left % 3600000) / 60000);
    return `${h} h ${String(m).padStart(2, '0')}`;
  }

  // ---------- Panneau de droite (ma maison) ----------
  function thumb(id, w = 96, h = 84) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const F = FUR[id];
    const fh = F.wall ? 1 : F.h;
    const T = Math.min((w - 10) / F.w, (h * 0.55) / fh, 48);
    const g = c.getContext('2d');
    g.translate((w - F.w * T) / 2, h - fh * T - 4);
    drawFurniture(g, id, F.w * T, id === 'cheminee' ? T * 1.4 : fh * T, T, { t: 1000 });
    return c;
  }

  function renderSide() {
    const side = $('house-side');
    if (!view.mine) { side.innerHTML = renderVisitorSide(); return; }
    const tabs = [['meubles', '🛋️ Mes meubles'], ['boutique', '🛒 Boutique'], ['style', '🎨 Style'], ['agrandir', '🏗️ Agrandir']];
    let body = '';
    if (sideTab === 'meubles') {
      const ids = Object.keys(FUR).filter((id) => owned(id) > 0);
      body = ids.length ? `<p class="muted hs-help">${editing ? 'Glisse un meuble dans la pièce (ou clique dessus puis sur une case). Dans la pièce : glisse pour déplacer, <b>clic droit</b> pour retourner, <b>double-clic</b> pour ranger.' : 'Clique sur <b>✏️ Décorer</b> pour placer tes meubles.'}</p>
        <div class="hs-grid">${ids.map((id) => {
    const free = owned(id) - placedCount(id);
    return `<div class="hs-item ${free ? '' : 'empty'} ${selected === id ? 'sel' : ''}" data-inv="${id}" title="${esc(FUR[id].label)}"><span class="hs-thumb" data-thumb="${id}"></span><span class="hs-name">${FUR[id].label}</span><span class="hs-count">${free} / ${owned(id)}</span></div>`;
  }).join('')}</div>` : '<p class="muted">Tu n\'as encore aucun meuble : va faire un tour à la <b>🛒 Boutique</b> !</p>';
    } else if (sideTab === 'boutique') {
      body = `<div class="chips hs-cats">${Object.entries(Rules.FURNITURE_CATS).map(([k, l]) => `<button class="chip ${shopCat === k ? 'active' : ''}" data-cat="${k}">${l}</button>`).join('')}</div>
        <div class="hs-grid">${Object.entries(FUR).filter(([, F]) => F.cat === shopCat).map(([id, F]) => `<div class="hs-item shop" title="${esc(F.label)}">
          <span class="hs-thumb" data-thumb="${id}"></span><span class="hs-name">${F.label}</span>
          <span class="hs-info">+${F.deco} déco · ${F.w}×${F.wall ? 1 : F.h}${F.wall ? ' mural' : F.rug ? ' tapis' : ''}${owned(id) ? ` · ×${owned(id)}` : ''}</span>
          <button class="small ${mine.emeralds >= F.price ? 'gold' : 'secondary'}" data-buy="${id}" ${mine.emeralds >= F.price ? '' : 'disabled'}>${fmt(F.price)} ${EM}</button>
          <button class="small secondary" data-htry="${id}" title="Le placer dans ta pièce pour voir, avant de l'acheter">👁️ Essayer</button></div>`).join('')}</div>`;
    } else if (sideTab === 'style') {
      body = Object.entries(Rules.HOUSE_PARTS).map(([part, P]) => `<div class="hs-part"><div class="hs-part-title">${P.zone === 'ext' ? '🏡' : '🛋️'} ${P.label}</div><div class="chips">${Object.entries(P.options).map(([id, o]) => {
    const have = o.price === 0 || mine.opts.includes(`${part}:${id}`);
    const cur = view.style[part] === id;
    const prev = stylePreview && stylePreview.part === part && stylePreview.id === id;
    return `<button class="chip ${cur ? 'active' : ''} ${have ? '' : 'locked'} ${prev ? 'previewing' : ''}" data-style="${part}:${id}" title="${have ? 'Choisir' : 'Voir l\'aperçu sur ta maison'}">${o.color ? `<i class="hs-swatch" style="background:${o.color}"></i>` : ''}${o.label}${have ? '' : ` · ${fmt(o.price)} 💎`}</button>`;
  }).join('')}</div></div>`).join('');
    } else {
      const order = Rules.HOUSING.sizeOrder;
      body = `<div class="hs-sizes">${order.map((k) => {
    const S = Rules.HOUSING.sizes[k];
    const i = order.indexOf(k);
    const cur = order.indexOf(view.size);
    const state = i < cur ? 'done' : i === cur ? 'cur' : i === cur + 1 ? 'next' : 'later';
    return `<div class="hs-size ${state}"><b>${S.label}</b><span>${S.cols} × ${S.rows} cases</span>
          ${state === 'cur' ? '<em>Ta maison</em>' : state === 'done' ? '<em>✅</em>' : state === 'next' ? `<button class="small ${mine.emeralds >= S.price ? 'gold' : 'secondary'}" id="hs-grow" ${mine.emeralds >= S.price ? '' : 'disabled'}>Agrandir · ${fmt(S.price)} ${EM}</button>` : `<em>${fmt(S.price)} 💎</em>`}</div>`;
  }).join('')}</div><p class="muted hs-help">Une plus grande maison : plus de place pour les meubles et plus de points de déco. Les meubles déjà posés restent à leur place.</p>`;
    }
    let bar = '';
    if (stylePreview) {
      const o = Rules.HOUSE_PARTS[stylePreview.part].options[stylePreview.id];
      bar = `<div class="hs-preview">👁️ Aperçu : <b>${o.label}</b> (${Rules.HOUSE_PARTS[stylePreview.part].label.toLowerCase()})
        <div class="row"><button class="small ${mine.emeralds >= o.price ? 'gold' : 'secondary'}" id="hp-buy" ${mine.emeralds >= o.price ? '' : 'disabled'}>Acheter · ${fmt(o.price)} ${EM}</button><button class="small secondary" id="hp-cancel">Annuler</button></div></div>`;
    } else if (furnPreview || (ghost && ghost.preview)) {
      const F = FUR[(furnPreview || ghost).id];
      bar = `<div class="hs-preview">👁️ Aperçu : <b>${F.label}</b> — ${furnPreview ? 'voilà ce que ça donne !' : 'glisse-le dans ta pièce'}
        <div class="row">${furnPreview ? `<button class="small ${mine.emeralds >= F.price ? 'gold' : 'secondary'}" id="hp-buy" ${mine.emeralds >= F.price ? '' : 'disabled'}>Acheter et garder · ${fmt(F.price)} ${EM}</button>` : ''}<button class="small secondary" id="hp-cancel">Annuler</button></div></div>`;
    }
    side.innerHTML = `${bar}<div class="chips hs-tabs">${tabs.map(([k, l]) => `<button class="chip ${sideTab === k ? 'active' : ''}" data-stab="${k}">${l}</button>`).join('')}</div><div class="hs-body">${body}</div>`;
    if ($('hp-cancel')) $('hp-cancel').onclick = () => { stylePreview = null; furnPreview = null; if (ghost && ghost.preview) ghost = null; renderSide(); };
    if ($('hp-buy')) $('hp-buy').onclick = () => (stylePreview ? setStyle(stylePreview.part, stylePreview.id, true) : buyPreview());
    side.querySelectorAll('[data-htry]').forEach((b) => {
      b.onclick = () => {
        if (!editing) { editing = true; renderAll(); }
        stylePreview = null;
        furnPreview = null;
        ghost = { id: b.dataset.htry, x: -99, y: -99, ok: false, flip: false, from: null, dragging: false, preview: true };
        renderSide();
        toast('👁️ Clique sur une case de ta pièce pour essayer ce meuble', 3000);
      };
    });
    side.querySelectorAll('[data-stab]').forEach((b) => { b.onclick = () => { sideTab = b.dataset.stab; renderSide(); }; });
    side.querySelectorAll('[data-cat]').forEach((b) => { b.onclick = () => { shopCat = b.dataset.cat; renderSide(); }; });
    side.querySelectorAll('[data-thumb]').forEach((el) => el.appendChild(thumb(el.dataset.thumb)));
    side.querySelectorAll('[data-buy]').forEach((b) => { b.onclick = () => buy(b.dataset.buy); });
    side.querySelectorAll('[data-style]').forEach((b) => { const [part, id] = b.dataset.style.split(':'); b.onclick = () => setStyle(part, id); });
    if ($('hs-grow')) $('hs-grow').onclick = grow;
    side.querySelectorAll('[data-inv]').forEach((el) => {
      el.onpointerdown = (e) => {
        if (!editing) return;
        const id = el.dataset.inv;
        if (owned(id) - placedCount(id) <= 0) return;
        e.preventDefault();
        selected = id;
        ghost = { id, x: -99, y: -99, ok: false, flip: false, from: null, dragging: true };
        renderSide();
      };
    });
  }

  function renderVisitorSide() {
    const h = view;
    const counts = {};
    for (const p of h.placed) counts[p.id] = (counts[p.id] || 0) + 1;
    const best = Object.entries(counts).sort((a, b) => FUR[b[0]].deco - FUR[a[0]].deco).slice(0, 8);
    return `<div class="hs-visitor"><h3>🏠 Chez ${esc(h.name)}</h3>
      <p>${Rules.HOUSING.sizes[h.size].label} · ${h.placed.length} meuble${h.placed.length > 1 ? 's' : ''}</p>
      ${best.length ? `<div class="hs-best">${best.map(([id, n]) => `<span>${FUR[id].label}${n > 1 ? ` ×${n}` : ''}</span>`).join('')}</div>` : '<p class="muted">Une maison encore toute vide…</p>'}
      <p class="muted" style="font-size:12px">Laisse-lui un ❤️ si sa maison te plaît !</p></div>`;
  }

  // ---------- Visites ----------
  function renderVisit() {
    const el = $('house-visit');
    el.innerHTML = `<h2>🏘️ Visiter des maisons <span class="sub">Les plus belles maisons du serveur</span></h2>
      <div class="row" style="gap:8px;margin-bottom:10px"><input id="hv-q" placeholder="Chercher un joueur…" style="max-width:260px"><button class="secondary small" id="hv-go">🔎</button></div>
      <div class="hv-grid">${houses.map((h, i) => `<button class="hv-card ${mine && h.id === mine.house.id ? 'me' : ''}" data-visit="${h.id}">
        <span class="hv-rank">${i + 1}</span><b>${esc(h.name)}</b>
        <span class="hv-meta"><span class="hh-badge">Niv. ${h.level}</span> ❤️ ${h.likes} · ${Rules.HOUSING.sizes[h.size].label} · ${h.furniture} meuble${h.furniture > 1 ? 's' : ''}</span></button>`).join('') || '<p class="muted">Aucune maison trouvée.</p>'}</div>`;
    el.querySelectorAll('[data-visit]').forEach((b) => { b.onclick = () => visit(b.dataset.visit); });
    $('hv-go').onclick = () => loadList($('hv-q').value);
    $('hv-q').onkeydown = (e) => { if (e.key === 'Enter') loadList($('hv-q').value); };
  }

  async function visit(id) {
    if (mine && id === mine.house.id) { view = mine.house; editing = false; renderAll(); return; }
    try {
      view = (await api(`/api/house/${id}`)).house;
      editing = false;
      walker.path = [];
      renderAll();
      window.scrollTo({ top: $('house-head').getBoundingClientRect().top + window.scrollY - 140, behavior: 'smooth' });
      Sound.play('chestPick');
    } catch (e) { toast('⚠️ ' + e.message); }
  }

  async function like() {
    try {
      const r = await api(`/api/house/${view.id}/like`, {});
      view.liked = r.liked;
      view.likes = r.likes;
      if (r.liked) Sound.play('petHappy');
      renderHead();
    } catch (e) { toast('⚠️ ' + e.message); }
  }

  // ---------- Actions ----------
  async function after(r, sound) {
    if (sound) Sound.play(sound);
    await load();
    if (typeof refresh === 'function') refresh().catch(() => {});
    return r;
  }
  async function buy(id) {
    try { await after(await api('/api/house/buy', { id }), 'buy'); toast(`🛋️ ${FUR[id].label} ajouté à tes meubles !`); } catch (e) { toast('⚠️ ' + e.message); }
  }
  async function setStyle(part, id, confirmBuy = false) {
    const o = Rules.HOUSE_PARTS[part].options[id];
    const have = o.price === 0 || mine.opts.includes(`${part}:${id}`);
    if (!have && !confirmBuy) {
      // Pas encore achetée : on l'essaie sur la maison avant de décider
      stylePreview = { part, id };
      furnPreview = null;
      renderSide();
      Sound.play('chip');
      return;
    }
    try {
      await after(await api('/api/house/style', { part, id }), have ? 'equip' : 'buy');
      stylePreview = null;
      renderSide();
    } catch (e) { toast('⚠️ ' + e.message); }
  }
  // Achète le meuble essayé et le laisse à sa place
  async function buyPreview() {
    const p = furnPreview;
    if (!p) return;
    try {
      await api('/api/house/buy', { id: p.id });
      furnPreview = null;
      mine.owned[p.id] = (mine.owned[p.id] || 0) + 1;
      await saveLayout(mine.house.placed.concat([{ id: p.id, x: p.x, y: p.y, flip: false }]));
      await after(null, 'buy');
      toast(`🛋️ ${FUR[p.id].label} acheté et installé !`);
    } catch (e) { toast('⚠️ ' + e.message); }
  }
  async function grow() {
    const order = Rules.HOUSING.sizeOrder;
    const next = Rules.HOUSING.sizes[order[order.indexOf(mine.house.size) + 1]];
    if (!await confirmBox(`Agrandir ta maison en ${next.label} pour ${fmt(next.price)} émeraudes ?`)) return;
    try { await after(await api('/api/house/upgrade', {}), 'levelUp'); toast(`🏗️ Ta maison devient un ${next.label.toLowerCase()} !`); } catch (e) { toast('⚠️ ' + e.message); }
  }
  // Ce que rapporte un courrier au niveau donné (en moyenne)
  function mailText(level) {
    const M = Rules.houseMailContent(level);
    const pct = (v) => `${Math.round(v * 100)} %`;
    return `Par courrier : ${fmt(M.gold)} 🪙${M.emeralds ? ` · ${M.emeralds} ${EM}` : ''}${M.chests ? ` · ${String(M.chests).replace('.', ',')} 🎁` : ''}${M.keyChance ? ` · clé ${pct(M.keyChance)}` : ''} · potion ${pct(M.potionChance)}`;
  }
  async function collect() {
    try {
      const r = await api('/api/house/mail', {});
      const parts = [`+${fmt(r.gold)} 🪙`];
      if (r.emeralds) parts.push(`+${r.emeralds} 💎`);
      if (r.chests) parts.push(`+${r.chests} coffre${r.chests > 1 ? 's' : ''}`);
      if (r.keys) parts.push(`+${r.keys} 🗝️`);
      for (const p of r.potions) parts.push(Rules.CONSUMABLES[p].icon);
      toast(`📬 ${r.letters} courrier${r.letters > 1 ? 's' : ''} : ${parts.join(' · ')}`, 6000);
      await after(r, 'reward');
    } catch (e) { toast('⚠️ ' + e.message); }
  }
  // Enregistre la disposition (le serveur vérifie) ; en cas de refus, on recharge.
  async function saveLayout(placed) {
    const prev = mine.house.placed;
    mine.house.placed = placed;
    if (view.mine) view.placed = placed;
    walker.path = [];
    renderSide();
    try {
      const r = await api('/api/house/layout', { placed });
      if (r.level && r.level.level > view.level.level) { toast(`✨ Niveau de décoration ${r.level.level} !`, 4000); Sound.play('levelUp'); }
      view.level = r.level || view.level;
      renderHead();
    } catch (e) {
      toast('⚠️ ' + e.message);
      mine.house.placed = prev;
      view.placed = prev;
      renderSide();
    }
  }

  // ---------- Éditeur ----------
  function cellAt(e, F) {
    const cv = $('house-int');
    const r = cv.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * cv.width;
    const my = ((e.clientY - r.top) / r.height) * cv.height;
    if (!room) return null;
    const inside = mx >= room.x && mx <= room.x + room.w && my >= room.y - room.wallPx && my <= room.y + room.h;
    const x = Math.floor((mx - room.x) / room.T - (F.w - 1) / 2);
    if (F.wall) return { x, y: -1, inside: inside && my < room.y };
    const y = Math.floor((my - room.y) / room.T - (F.h - 1) / 2);
    return { x, y, inside: inside && my >= room.y - room.T * 0.3, mx, my };
  }
  function itemAt(e) {
    const cv = $('house-int');
    const r = cv.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * cv.width;
    const my = ((e.clientY - r.top) / r.height) * cv.height;
    if (!room) return -1;
    const T = room.T;
    const wallY = room.y - room.wallPx * 0.78;
    let best = -1;
    let bz = -Infinity;
    mine.house.placed.forEach((p, i) => {
      const F = FUR[p.id];
      if (!F) return;
      const x0 = room.x + p.x * T;
      const y0 = F.wall ? wallY : room.y + p.y * T;
      const h = (F.wall ? 1 : F.h) * T;
      const top = F.wall ? y0 : y0 - T * 0.6; // les meubles hauts dépassent un peu
      if (mx >= x0 && mx <= x0 + F.w * T && my >= top && my <= y0 + h) {
        const z = F.wall ? 100 : F.rug ? -100 + p.y : p.y + F.h;
        if (z > bz) { bz = z; best = i; }
      }
    });
    return best;
  }
  function tryPlaced(p, exceptIndex, preview = false) {
    const list = mine.house.placed.filter((_, i) => i !== exceptIndex).concat([p]);
    const ownedNow = preview ? { ...mine.owned, [p.id]: (mine.owned[p.id] || 0) + 1 } : mine.owned;
    return { list, error: Rules.houseLayoutError({ size: mine.house.size, owned: ownedNow }, list) };
  }

  function setupEditor() {
    const cv = $('house-int');
    cv.addEventListener('pointerdown', (e) => {
      if (!view || !view.mine || !editing) return;
      if (e.button === 2) return;
      if (ghost && !ghost.dragging) return; // placement au clic (meuble choisi ou essayé) : géré au relâchement
      const i = itemAt(e);
      if (i < 0) return;
      const p = mine.house.placed[i];
      ghost = { id: p.id, x: p.x, y: p.y, ok: true, flip: p.flip, from: i, dragging: true };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('contextmenu', (e) => {
      if (!view || !view.mine || !editing) return;
      e.preventDefault();
      const i = itemAt(e);
      if (i < 0) return;
      const placed = mine.house.placed.map((p, k) => (k === i ? { ...p, flip: !p.flip } : p));
      saveLayout(placed);
    });
    cv.addEventListener('dblclick', (e) => {
      if (!view || !view.mine || !editing) return;
      const i = itemAt(e);
      if (i < 0) return;
      saveLayout(mine.house.placed.filter((_, k) => k !== i));
      Sound.play('unequip');
    });
    window.addEventListener('pointermove', (e) => {
      if (!ghost || !editing) return;
      const F = FUR[ghost.id];
      const c = cellAt(e, F);
      if (!c) return;
      ghost.x = c.x;
      ghost.y = c.y;
      ghost.over = c.inside;
      ghost.ok = c.inside && !tryPlaced({ id: ghost.id, x: c.x, y: c.y, flip: ghost.flip }, ghost.from, ghost.preview).error;
    });
    window.addEventListener('pointerup', (e) => {
      if (!ghost || !editing) return;
      const g = ghost;
      const F = FUR[g.id];
      const c = cellAt(e, F);
      const over = c && c.inside;
      if (g.from != null) {
        // déplacement d'un meuble posé
        ghost = null;
        if (over && g.ok && (c.x !== mine.house.placed[g.from].x || c.y !== mine.house.placed[g.from].y)) {
          const { list } = tryPlaced({ id: g.id, x: c.x, y: c.y, flip: g.flip }, g.from);
          saveLayout(list);
          Sound.play('equip');
        }
        return;
      }
      if (g.preview) {
        // Essai d'un meuble de la boutique : posé pour voir, pas enregistré
        if (over && g.ok) { furnPreview = { id: g.id, x: c.x, y: c.y }; ghost = null; renderSide(); Sound.play('equip'); }
        return;
      }
      if (over && g.ok) {
        const { list } = tryPlaced({ id: g.id, x: c.x, y: c.y, flip: false }, null);
        saveLayout(list);
        Sound.play('equip');
        if (owned(g.id) - list.filter((p) => p.id === g.id).length <= 0) { ghost = null; selected = null; renderSide(); } else ghost = { ...g, dragging: false };
      } else if (g.dragging && !over) {
        // relâché hors de la pièce : le meuble reste sélectionné, on peut cliquer sur une case
        ghost = { ...g, dragging: false };
      }
    });
    document.addEventListener('keydown', (e) => {
      if (!active || !editing) return;
      if (e.key === 'Escape') { ghost = null; selected = null; renderSide(); }
    });
    // Curseur « main » sur la boîte aux lettres et sur l'enclos
    $('house-ext').addEventListener('mousemove', (e) => {
      const cv = $('house-ext');
      const r = cv.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * cv.width;
      const my = ((e.clientY - r.top) / r.height) * cv.height;
      const y = yardBox;
      const overYard = view && view.mine && y && mx >= y.x && mx <= y.x + y.w && my >= y.y && my <= y.y + y.h;
      cv.title = overYard ? 'Aller voir mon familier' : '';
    });
    $('house-ext').addEventListener('click', (e) => {
      if (!view || !view.mine || !ext) return;
      const cv = $('house-ext');
      const r = cv.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * cv.width;
      const my = ((e.clientY - r.top) / r.height) * cv.height;
      const m = ext.mailbox;
      if (mx >= m.x && mx <= m.x + m.w && my >= m.y && my <= m.y + m.h) {
        if (Rules.houseMailDue(mine.mailAt)) collect(); else toast(`📭 Boîte vide : prochain courrier dans ${mailIn()}`);
        return;
      }
      // Clic sur mon enclos : direction l'onglet Familier
      const y = yardBox;
      if (y && mx >= y.x && mx <= y.x + y.w && my >= y.y && my <= y.y + y.h) location.hash = 'familier';
    });
  }

  // ---------- L'habitant se promène (chemin sur les cases libres) ----------
  function freeCells(h) {
    const S = Rules.HOUSING.sizes[h.size];
    const blocked = new Set();
    for (const p of h.placed) {
      const F = FUR[p.id];
      if (!F || F.wall || F.rug) continue;
      for (let i = 0; i < F.w; i++) for (let j = 0; j < F.h; j++) blocked.add(`${p.x + i},${p.y + j}`);
    }
    return { S, blocked };
  }
  function stepWalker(dt) {
    const { S, blocked } = freeCells(view);
    if (blocked.has(`${Math.round(walker.x)},${Math.round(walker.y)}`) || walker.x >= S.cols || walker.y >= S.rows) {
      // coincé dans un meuble (après une modification) : on le pose sur la première case libre
      for (let y = S.rows - 1; y >= 0; y--) for (let x = 0; x < S.cols; x++) if (!blocked.has(`${x},${y}`)) { walker.x = x; walker.y = y; y = -1; break; }
      walker.path = [];
    }
    if (walker.wait > 0) { walker.wait -= dt; return; }
    if (!walker.path.length) {
      // Destination au hasard parmi les cases libres, chemin le plus court
      const free = [];
      for (let y = 0; y < S.rows; y++) for (let x = 0; x < S.cols; x++) if (!blocked.has(`${x},${y}`)) free.push([x, y]);
      if (!free.length) return;
      const [tx, ty] = free[Math.floor(Math.random() * free.length)];
      const start = `${Math.round(walker.x)},${Math.round(walker.y)}`;
      const prev = new Map([[start, null]]);
      const q = [[Math.round(walker.x), Math.round(walker.y)]];
      while (q.length) {
        const [x, y] = q.shift();
        if (x === tx && y === ty) break;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          const k = `${nx},${ny}`;
          if (nx < 0 || ny < 0 || nx >= S.cols || ny >= S.rows || blocked.has(k) || prev.has(k)) continue;
          prev.set(k, `${x},${y}`);
          q.push([nx, ny]);
        }
      }
      let k = `${tx},${ty}`;
      if (!prev.has(k)) { walker.wait = 1; return; }
      const path = [];
      while (k && k !== start) { path.unshift(k.split(',').map(Number)); k = prev.get(k); }
      walker.path = path.slice(0, 12);
      if (!walker.path.length) walker.wait = 1 + Math.random() * 2;
      return;
    }
    const [nx, ny] = walker.path[0];
    const dx = nx - walker.x;
    const dy = ny - walker.y;
    const d = Math.hypot(dx, dy);
    const sp = 2.2 * dt;
    if (Math.abs(dx) > 0.01) walker.facing = dx > 0 ? 1 : -1;
    if (d <= sp) { walker.x = nx; walker.y = ny; walker.path.shift(); if (!walker.path.length) walker.wait = 1.5 + Math.random() * 3; } else { walker.x += (dx / d) * sp; walker.y += (dy / d) * sp; }
  }

  // ---------- Boucle de dessin ----------
  let last = 0;
  function loop(now) {
    if (!active) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    if (!view) return;
    stepWalker(dt);
    const ic = $('house-int');
    const g = ic.getContext('2d');
    const owner = view.mine ? { name: me.twitchDisplayName || me.username, cls: me.character.cls, look: myLook(), app: me.character.look } : { name: view.name, cls: view.cls, look: view.look || {}, app: view.app || {} };
    const moving = walker.path.length > 0 && walker.wait <= 0;
    const style = stylePreview && view.mine ? { ...view.style, [stylePreview.part]: stylePreview.id } : view.style;
    const house = { size: view.size, style, placed: view.placed };
    room = drawRoom(g, house, ic.width, ic.height, {
      t: now, grid: editing, hidden: ghost && ghost.from != null ? ghost.from : undefined,
      ghost: editing && ghost && ghost.over ? { id: ghost.id, x: ghost.x, y: ghost.y, ok: ghost.ok, flip: ghost.flip } : furnPreview && view.mine ? { id: furnPreview.id, x: furnPreview.x, y: furnPreview.y, ok: true, preview: true } : null,
      walkers: [{ x: walker.x, y: walker.y, f: owner, facing: walker.facing, bob: moving ? -Math.abs(Math.sin(now / 100)) * 2 : 0, name: owner.name }],
    });
    // Façade redessinée à chaque image : ciel et passants animés (housing-life.js)
    const ec = $('house-ext');
    const life = window.HouseLife;
    // Enclos à familier à droite de la maison (objets achetés et familier principal, comme dans l'onglet Familier)
    const yard = view.mine && me.character.pets ? liveYard() : view.yard;
    let cx = null;
    let yardFn = null;
    if (yard && window.drawPetYard) {
      const bw = { studio: 220, maison: 290, manoir: 380 }[view.size] || 220;
      const yw = Math.max(150, Math.min(230, ec.width - bw - 110)); // plus grand quand la maison est petite
      const x0 = ec.width - yw; // collé au bord droit
      cx = x0 - 2 - bw / 2; // la maison collée à l'enclos
      const y0 = ec.height * 0.82 + 40 - yw * window.PET_YARD_RATIO;
      yardFn = (g) => drawPetYard(g, x0, y0, yw, yard, now);
      yardBox = { x: x0, y: y0 - 30, w: yw, h: yw * window.PET_YARD_RATIO + 30 };
    } else yardBox = null;
    ext = drawHouseFront(ec.getContext('2d'), house, ec.width, ec.height, { t: now, mail: view.mine && Rules.houseMailDue(mine.mailAt) > 0, name: view.mine ? null : view.name, sky: life && life.sky, front: life && life.front, cx, yard: yardFn });
  }
  // Mon enclos d'après mes données à jour (achat d'un objet, changement de familier principal…)
  function liveYard() {
    const P = me.character.pets;
    if (!P || (!P.list.length && !P.enclos.length)) return null;
    const pet = P.list.find((p) => p.id === P.active);
    return { enclos: P.enclos, pet: pet ? { species: pet.species, name: pet.name, level: pet.level } : null };
  }
  function myLook() {
    const look = {};
    for (const [slot, item] of Object.entries(me.character.equipment)) if (item) look[slot] = item.rarity;
    return look;
  }

  // Historique de la boîte aux lettres (comme celui des familiers)
  let mailSig = '';
  function whenText(at) {
    const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
    if (s < 60) return 'à l\'instant';
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
    const d = new Date(at);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function renderMailLog() {
    const H = me.character.house || {};
    const log = H.mailLog || [];
    const T = H.mailTotals || {};
    const sig = `${log.length}:${log[0] ? log[0].at : 0}:${Math.floor(Date.now() / 60000)}`;
    if (sig === mailSig) return;
    mailSig = sig;
    const chip = (v, label, cls = '') => (v ? `<span class="pet-log-total ${cls}">${label}</span>` : '');
    const gains = (e) => [
      chip(e.gold, `+<b>${fmt(e.gold)}</b> 🪙`, 'gold'),
      chip(e.emeralds, `+<b>${e.emeralds}</b> ${EM}`),
      chip(e.chests, `+<b>${e.chests}</b> <i class="ico-chest"></i>`),
      chip(e.keys, `+<b>${e.keys}</b> 🗝️`, 'key'),
      (e.potions || []).map((p) => (Rules.CONSUMABLES[p] ? `<span class="pet-log-total" title="${esc(Rules.CONSUMABLES[p].label)}">${Rules.CONSUMABLES[p].icon}</span>` : '')).join(''),
    ].join('');
    const totals = T.letters
      ? `<div class="pet-log-totals"><span class="muted">Depuis le début :</span>
        ${chip(T.letters, `📬 <b>${T.letters}</b> courrier${T.letters > 1 ? 's' : ''}`)}
        ${chip(T.gold, `<b>${fmt(T.gold)}</b> 🪙`, 'gold')}
        ${chip(T.emeralds, `<b>${fmt(T.emeralds)}</b> ${EM}`)}
        ${chip(T.chests, `<b>${T.chests}</b> <i class="ico-chest"></i>`)}
        ${chip(T.keys, `🗝️ <b>${T.keys}</b> clé${T.keys > 1 ? 's' : ''}`, 'key')}
        ${chip(T.potions, `🧪 <b>${T.potions}</b> potion${T.potions > 1 ? 's' : ''}`)}</div>`
      : '';
    $('house-mail-log').innerHTML = `<h3>📜 Ce que ta boîte aux lettres t'a rapporté</h3>${totals}
      <div class="pet-log-list">${log.length ? log.map((e) => `<div class="pet-log-row">
          <span class="hml-ico">📬</span>
          <div class="pet-log-main"><div><b>${e.letters} courrier${e.letters > 1 ? 's' : ''}</b> <span class="muted">(niv. ${e.level})</span> ${gains(e)}</div></div>
          <span class="pet-log-when muted" title="${new Date(e.at).toLocaleString('fr-FR')}">${whenText(e.at)}</span>
        </div>`).join('')
    : '<p class="muted pet-log-empty">Rien pour l\'instant. Quand tu ouvres ta boîte aux lettres, ce qu\'elle contenait s\'affiche ici.</p>'}</div>`;
  }

  function renderAll() {
    if (!view || !mine) return;
    renderHead();
    renderSide();
    renderMailLog();
    document.querySelector('.house-main').classList.toggle('editing', editing && view.mine);
  }

  // ---------- Entrée / sortie ----------
  let ready = false;
  function enter() {
    if (!me) return;
    active = true;
    if (!ready) { setupEditor(); ready = true; }
    load();
    cancelAnimationFrame(raf);
    last = 0;
    raf = requestAnimationFrame(loop);
  }
  function leave() {
    if (!active) return;
    active = false;
    cancelAnimationFrame(raf);
    editing = false;
    ghost = null;
  }

  window.Housing = {
    enter,
    leave,
    refresh() { if (mine) { mine.emeralds = me.character.emeralds; if (view && view.mine) renderHead(); renderMailLog(); } },
    get active() { return active; },
  };
})();
