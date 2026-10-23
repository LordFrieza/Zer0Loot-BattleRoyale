/* Page personnage. */
const $ = (id) => document.getElementById(id);
let me = null;
let queue = null;
let config = null;
let invFilter = 'all';
let recycleMode = false;
const selected = new Set();
let simLuck = null;
const opener = new ChestOpener();
const forge = new ForgeAnimator();
Sound.bindVolume($('sound-ctl'));
let opening = false;

async function refresh() {
  me = await api('/api/me');
  if (me.role === 'admin') { location.href = '/admin.html'; return; }
  render();
}

function render() {
  if (!me || opening) return;
  const c = me.character;
  $('who').textContent = me.username;
  $('char-name').textContent = me.twitchDisplayName || me.username;
  window.ZL_CLASS = c.cls; // pour l'affichage des objets réservés dans les animations
  const ci = c.cls && Rules.CLASS_INFO[c.cls];
  $('class-badge').innerHTML = c.spec
    ? `<span style="color:${c.spec.color}">${c.spec.icon} ${esc(c.spec.spec)}</span> <span class="muted" style="font-size:12px">(${ci.label})</span>`
    : ci ? `<span style="color:${ci.color}">${ci.icon} ${ci.label}</span>` : '<span class="muted">Sans classe</span>';
  $('change-class').textContent = c.cls ? `🔄 Changer de classe (${Rules.CLASS_CHANGE_PRICE} 🪙)` : '🎭 Choisir ma classe';
  if (!c.cls && !classModalShown) { classModalShown = true; openClassModal(); }
  $('level').textContent = 'Niveau ' + c.level;
  $('xp-fill').style.width = (c.xp / c.xpToNext) * 100 + '%';
  $('xp-text').textContent = `${c.xp} / ${c.xpToNext} XP`;
  $('xp-text').parentElement.title = `Niveau ${c.level + 1} à ${c.xpToNext} XP. Chaque niveau demande ${Rules.XP_STEP} XP de plus que le précédent.`;
  $('gold').textContent = c.gold;
  $('chests-small').textContent = c.chests;
  $('chests').textContent = c.chests;
  $('record').textContent = `${c.record.battles} bataille(s) · ${c.record.kills} kill(s) · ${c.record.wins} victoire(s)`;
  $('open-chest').disabled = c.chests <= 0;
  $('buy-1').disabled = c.gold < Rules.CHEST_PRICE;
  $('buy-10').disabled = c.gold < Rules.CHEST_PRICE * 10;
  renderStats();
  renderEquipment();
  renderInventory();
  renderTwitch();
  renderQueue();
  renderBets();
  renderLoot();
  renderForge();
  renderSets();
  renderAchievements();
  renderAppearance();
  renderShop();
  renderPotionSlot();
  renderPotionShop();
  renderPresets();
  renderTalents();
  if (!$('training-level').dataset.set) { $('training-level').value = c.level; $('training-level').dataset.set = '1'; }
  renderBadges();
  $('char-title').textContent = c.titleName ? `« ${c.titleName} »` : '';
  $('sub-info').innerHTML = `💜 Chaque <b>abonnement</b> à la chaîne (sub, resub ou sub offert) rapporte <b>${Rules.SUB_REWARD_GOLD} golds</b>
    à celui qui s'abonne ou qui offre le sub.${me.twitchLogin ? '' : ' Lie ton compte Twitch pour les recevoir ici (sinon ils t\'attendent jusqu\'à la liaison).'}`;
}

// Points bonus des panoplies sur une stat.
function setMod(stat) {
  const pts = me.character.sets.points[stat];
  return pts ? `<div class="up" style="font-size:12px">+${pts} pts 🧩 panoplie</div>` : '';
}

// Points bonus de l'arbre de compétences sur une stat.
function talentMod(stat) {
  const pts = me.character.talentPoints[stat];
  return pts ? `<div class="up" style="font-size:12px">+${pts} pts 🌳 arbre</div>` : '';
}

// Bonus / malus de la classe sur une stat (affiché à côté des bonus d'équipement).
function classMod(stat) {
  const ci = Rules.CLASS_INFO[me.character.cls];
  if (!ci) return '';
  const flatKey = { critique: 'crit', precision: 'precision' }[stat];
  const parts = [];
  if (ci.bonus[stat]) parts.push(`${ci.bonus[stat] > 0 ? '+' : ''}${ci.bonus[stat]}%`);
  if (flatKey && ci.flat[flatKey]) parts.push(`+${Math.round(ci.flat[flatKey] * 100)} pts`);
  if (!parts.length) return '';
  const cls = (ci.bonus[stat] || 0) < 0 ? 'down' : 'up';
  return `<div class="${cls}" style="font-size:12px">${parts.join(' ')} ${ci.icon} classe</div>`;
}

function renderStats() {
  const c = me.character;
  $('skill-banner').innerHTML = c.skillPoints > 0
    ? `<div class="skill-banner">✨ ${c.skillPoints} point(s) de compétence à répartir !</div>`
    : '';
  $('stats').innerHTML = Rules.STATS.map((s) => {
    const info = Rules.STAT_INFO[s];
    const gear = c.gear[s];
    return `<tr>
      <td class="stat-name">${info.icon} ${info.label}</td>
      <td class="stat-desc help">${info.desc}</td>
      <td class="stat-pts">${c.stats[s]}</td>
      <td class="stat-gear">${gear ? '+' + gear + Rules.statUnit(s) + ' équip.' : ''}${classMod(s)}${setMod(s)}${talentMod(s)}</td>
      <td class="stat-value">${Rules.describeDerived(s, c.derived)}</td>
      <td>${c.skillPoints > 0 ? `<button class="plus" data-stat="${s}" title="Ajouter un point">+</button>` : ''}</td>
    </tr>`;
  }).join('');
  $('stats').querySelectorAll('.plus').forEach((b) => {
    b.onclick = () => act('/api/stats/allocate', { stat: b.dataset.stat }, 'levelUp');
  });
  // Remise à zéro : 50 golds par point placé, 500 golds au maximum
  const placed = Rules.STATS.reduce((sum, s) => sum + (c.stats[s] || 0), 0);
  const price = Rules.statResetPrice(placed);
  $('stats-reset').innerHTML = placed
    ? `<button class="secondary small" id="stats-reset-btn" ${c.gold < price ? 'disabled' : ''}>↺ Remettre mes ${placed} point(s) à zéro (${price} 🪙)</button>
      <span class="muted">${Rules.STAT_RESET.perPoint} golds par point placé, ${Rules.STAT_RESET.max} golds maximum.</span>`
    : '';
  const btn = $('stats-reset-btn');
  if (btn) btn.onclick = async () => {
    if (!confirm(`Remettre tes ${placed} point(s) de caractéristiques à zéro pour ${price} golds ? Tu pourras les répartir à nouveau.`)) return;
    const r = await act('/api/stats/reset', {}, 'reroll');
    if (r) toast(`↺ ${r.refunded} point(s) de compétence à répartir à nouveau !`);
  };
}

function renderEquipment() {
  const eq = me.character.equipment;
  const ci = Rules.CLASS_INFO[me.character.cls];
  $('equipment').innerHTML = Rules.SLOTS.map((slot) => {
    const info = Rules.SLOT_INFO[slot];
    const item = eq[slot];
    const kind = ci && (slot === 'arme' ? Rules.KINDS[ci.weapon] : slot === 'secondaire' ? Rules.KINDS[ci.offhand] : null);
    const label = kind ? `${kind.icon} ${info.label} · ${kind.label}` : `${info.icon} ${info.label}`;
    if (!item) return `<div class="slot"><div class="slot-label">${label}</div><div class="muted" style="margin-top:8px">Vide</div></div>`;
    const lines = item.lines.map((l) => Rules.formatLine(l.stat, l.value)).join('<br>');
    return `<div class="slot filled rarity-${item.rarity}" data-slot="${slot}">
      <div class="slot-label">${label}</div>
      <div class="c-${item.rarity}" style="font-weight:800;margin:4px 0">${esc(item.name)}</div>${lines}</div>`;
  }).join('');
  $('equipment').querySelectorAll('.slot.filled').forEach((el) => {
    el.onclick = () => act('/api/unequip', { slot: el.dataset.slot }, 'unequip');
  });
}

function sumLines(item) {
  const out = {};
  if (item) for (const l of item.lines) out[l.stat] = (out[l.stat] || 0) + l.value;
  return out;
}

function compareHtml(item) {
  const current = me.character.equipment[item.slot];
  if (!current) return '<div class="compare up">Emplacement vide</div>';
  const a = sumLines(item);
  const b = sumLines(current);
  const parts = Rules.STATS
    .map((s) => ({ s, d: (a[s] || 0) - (b[s] || 0) }))
    .filter((x) => x.d !== 0)
    .map((x) => `<span class="${x.d > 0 ? 'up' : 'down'}">${Rules.formatLine(x.s, x.d)}</span>`);
  return `<div class="compare">vs équipé : ${parts.join(', ') || 'identique'}</div>`;
}

const INV_PAGE_SIZE = 20;
let invPage = 0;

function renderPager(pages, total) {
  const el = $('inv-pager');
  if (pages <= 1) { el.innerHTML = ''; return; }
  const from = invPage * INV_PAGE_SIZE + 1;
  const to = Math.min(total, (invPage + 1) * INV_PAGE_SIZE);
  const btn = (p, label, extra = '') => `<button class="chip ${p === invPage ? 'active' : ''}" data-page="${p}" ${extra}>${label}</button>`;
  el.innerHTML = btn(invPage - 1, '‹ Précédent', invPage === 0 ? 'disabled' : '')
    + Array.from({ length: pages }, (_, p) => p)
      .filter((p) => p === 0 || p === pages - 1 || Math.abs(p - invPage) <= 2)
      .map((p, i, arr) => (i && p - arr[i - 1] > 1 ? '<span class="muted">…</span>' : '') + btn(p, p + 1)).join('')
    + btn(invPage + 1, 'Suivant ›', invPage === pages - 1 ? 'disabled' : '')
    + `<span class="muted" style="font-size:13px;margin-left:6px">Objets ${from} à ${to} sur ${total}</span>`;
  el.querySelectorAll('[data-page]:not([disabled])').forEach((b) => {
    b.onclick = () => {
      invPage = Number(b.dataset.page);
      renderInventory();
      document.getElementById('inv-filters').scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  });
}

// Objets d'une autre classe (armes et objets secondaires que la classe du joueur ne peut pas équiper).
const otherClass = (item) => !!Rules.itemClass(item) && !Rules.canEquip(item, me.character.cls);
let showOther = true;
try { showOther = localStorage.getItem('zl_inv_show_other') !== '0'; } catch (e) { /* ignore */ }
$('inv-show-other').checked = showOther;
$('inv-show-other').onchange = (e) => {
  showOther = e.target.checked;
  try { localStorage.setItem('zl_inv_show_other', showOther ? '1' : '0'); } catch (err) { /* ignore */ }
  if (!showOther && invFilter === 'other') invFilter = 'all';
  invPage = 0;
  renderInventory();
};

function renderInventory() {
  const inv = me.character.inventory;
  // Avec la case décochée, les objets hors classe disparaissent de toutes les vues sauf du filtre « Hors classe ».
  const visible = showOther ? inv : inv.filter((i) => !otherClass(i));
  const filters = [['all', 'Tout']].concat(Rules.SLOTS.map((s) => [s, Rules.SLOT_INFO[s].icon + ' ' + Rules.SLOT_INFO[s].label]), [['other', '🚫 Hors classe']]);
  $('inv-filters').innerHTML = filters.map(([k, label]) => {
    const n = k === 'all' ? visible.length : k === 'other' ? inv.filter(otherClass).length : visible.filter((i) => i.slot === k).length;
    return `<button class="${invFilter === k ? 'active' : ''}" data-f="${k}" ${k === 'other' ? 'title="Seulement les objets des autres classes : pratique pour les recycler"' : ''}>${label} (${n})</button>`;
  }).join('');
  $('inv-filters').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { invFilter = b.dataset.f; invPage = 0; renderInventory(); };
  });
  $('inv-count').textContent = inv.length + ' objet(s)';
  const list = (invFilter === 'other' ? inv : visible)
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => invFilter === 'all' || (invFilter === 'other' ? otherClass(item) : item.slot === invFilter))
    .sort((x, y) => Rules.RARITIES.indexOf(y.item.rarity) - Rules.RARITIES.indexOf(x.item.rarity) || y.i - x.i)
    .map(({ item }) => item);
  // Retire de la sélection les objets qui ne sont plus dans l'inventaire ou plus affichés (filtre, case « autres classes »).
  const ids = new Set(list.map((i) => i.id));
  for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);

  // Pagination : INV_PAGE_SIZE objets par page (les filtres et la sélection de recyclage portent sur toutes les pages).
  const pages = Math.max(1, Math.ceil(list.length / INV_PAGE_SIZE));
  invPage = Math.min(invPage, pages - 1);
  const pageItems = list.slice(invPage * INV_PAGE_SIZE, (invPage + 1) * INV_PAGE_SIZE);
  renderPager(pages, list.length);

  $('inventory').classList.toggle('recycling', recycleMode);
  $('inventory').innerHTML = pageItems.length
    ? pageItems.map((item) => {
      const ok = Rules.canEquip(item, me.character.cls);
      const btn = ok
        ? `<button class="small" data-equip="${item.id}">Équiper</button>`
        : `<button class="small secondary" disabled title="Change de classe ou passe-le à la forge">🔒 ${Rules.CLASS_INFO[Rules.itemClass(item)].label} uniquement</button>`;
      return itemHtml(item, `${protectedTag(item)}${ok ? compareHtml(item) : ''}<div class="actions">${btn}</div>`, me.character.cls);
    }).join('')
    : '<div class="muted">Ton coffre personnel est vide. Ouvre des coffres de LOOT pour le remplir !</div>';
  $('inventory').querySelectorAll('[data-equip]').forEach((b) => {
    b.onclick = () => act('/api/equip', { itemId: b.dataset.equip }, 'equip');
  });
  $('inventory').querySelectorAll('.item').forEach((el) => {
    el.classList.toggle('selected', recycleMode && selected.has(el.dataset.id));
    el.classList.toggle('protected', isProtected(el.dataset.id));
    el.onclick = () => {
      if (!recycleMode) return;
      if (isProtected(el.dataset.id)) { toast('🔐 Objet protégé par un preset : il ne peut pas être recyclé'); return; }
      if (selected.has(el.dataset.id)) selected.delete(el.dataset.id);
      else selected.add(el.dataset.id);
      el.classList.toggle('selected');
      renderRecycleBar(list);
    };
  });
  $('recycle-toggle').disabled = inv.length === 0 && !recycleMode;
  renderRecycleBar(list);
}


// ---------- Presets d'équipement ----------
const isProtected = (id) => !!(me && me.character.protectedIds.includes(id));

function protectedTag(item) {
  const names = me.character.presets.filter((p) => Object.values(p.items).includes(item.id)).map((p) => esc(p.name));
  return names.length ? `<div class="protected-tag" title="Protégé : ni recyclage, ni fusion">🔐 Preset : ${names.join(', ')}</div>` : '';
}

function renderPresets() {
  const c = me.character;
  $('preset-max').textContent = Rules.PRESET_MAX;
  const equippedIds = Object.fromEntries(Rules.SLOTS.map((s) => [s, c.equipment[s] ? c.equipment[s].id : null]));
  const list = c.presets.map((p) => {
    const n = Object.values(p.items).filter(Boolean).length;
    const current = Rules.SLOTS.every((s) => (p.items[s] || null) === equippedIds[s]);
    return `<div class="preset ${current ? 'current' : ''}" data-id="${p.id}">
      <span class="preset-name">${current ? '✅ ' : '💾 '}${esc(p.name)}</span><span class="muted">${n} objet${n > 1 ? 's' : ''}</span>
      <button class="small" data-apply ${current ? 'disabled' : ''}>${current ? 'Équipé' : 'Équiper'}</button>
      <button class="small secondary" data-update title="Remplacer ce preset par l'équipement actuel">⟳</button>
      <button class="small secondary" data-del title="Supprimer ce preset (les objets ne sont plus protégés)">🗑</button>
    </div>`;
  }).join('');
  const full = c.presets.length >= Rules.PRESET_MAX;
  $('presets').innerHTML = `<div class="presets-head"><b>💾 Presets d'équipement</b>
      <input id="preset-name" maxlength="${Rules.PRESET_NAME_MAX}" placeholder="${full ? 'Maximum atteint' : 'Nom du preset (ex. Boss, PvP…)'}" ${full ? 'disabled' : ''}>
      <button class="small gold" id="preset-save" ${full ? 'disabled' : ''}>Sauvegarder l'équipement actuel</button></div>
    <div class="preset-list">${list || '<span class="muted">Aucun preset : équipe tes objets puis sauvegarde-les ici. Ils seront protégés 🔐.</span>'}</div>`;
  $('preset-save').onclick = async () => {
    const r = await act('/api/preset/save', { name: $('preset-name').value }, 'equip');
    if (r) toast(`💾 Preset « ${r.preset.name} » sauvegardé : ses objets sont protégés 🔐`);
  };
  $('presets').querySelectorAll('.preset').forEach((el) => {
    const p = c.presets.find((x) => x.id === el.dataset.id);
    el.querySelector('[data-apply]').onclick = async () => {
      const r = await act('/api/preset/apply', { id: p.id }, 'equip');
      if (r) toast(`✅ Preset « ${r.name} » équipé${r.missing ? ` (${r.missing} objet(s) introuvable(s))` : ''}${r.locked ? ` (${r.locked} objet(s) d'une autre classe)` : ''}`);
    };
    el.querySelector('[data-update]').onclick = async () => {
      if (!confirm(`Remplacer « ${p.name} » par l'équipement actuel ?`)) return;
      if (await act('/api/preset/save', { name: p.name, id: p.id }, 'equip')) toast(`💾 Preset « ${p.name} » mis à jour`);
    };
    el.querySelector('[data-del]').onclick = async () => {
      if (!confirm(`Supprimer le preset « ${p.name} » ? Ses objets ne seront plus protégés.`)) return;
      if (await act('/api/preset/delete', { id: p.id }, 'unequip')) toast(`🗑 Preset « ${p.name} » supprimé`);
    };
  });
}

// ---------- Potions ----------
function potionCard(id, extra = '') {
  const c = Rules.CONSUMABLES[id];
  return `<div class="potion-card" style="--c:${c.color}">
    <div class="potion-ico">${c.icon}</div>
    <div class="potion-body"><b>${c.label}</b>
      <div class="potion-trigger">⏱ ${Rules.CONSUMABLE_TRIGGERS[c.trigger]}</div>
      <div class="muted">${c.desc}</div>${extra}</div>
  </div>`;
}

function renderPotionSlot() {
  const id = me.character.consumableSlot;
  const c = id && Rules.CONSUMABLES[id];
  const stock = Object.values(me.character.consumables).reduce((a, b) => a + b, 0);
  $('potion-slot').classList.toggle('filled', !!c);
  $('potion-slot').style.setProperty('--c', c ? c.color : 'var(--border)');
  $('potion-slot').innerHTML = c
    ? `<span class="potion-slot-ico">${c.icon}</span><span class="potion-slot-label">Prête</span>`
    : `<span class="potion-slot-ico">＋</span><span class="potion-slot-label">Potion${stock ? ` (${stock})` : ''}</span>`;
  $('potion-slot').title = c ? `${c.label} — ${c.desc}\nUtilisée à ta prochaine partie. Clique pour changer.` : 'Aucune potion pour la prochaine partie. Clique pour en choisir une.';
}

function openPotionModal() {
  const ch = me.character;
  const owned = Object.keys(Rules.CONSUMABLES).filter((id) => ch.consumables[id] > 0);
  let html = '';
  if (ch.consumableSlot) {
    html += potionCard(ch.consumableSlot, `<div class="row" style="margin-top:6px"><b class="up">✅ Équipée</b><button class="small secondary" data-unequip>Retirer (retour au stock)</button></div>`);
  }
  html += owned.length
    ? owned.map((id) => potionCard(id, `<div class="row" style="margin-top:6px"><span class="muted">En stock : <b>${ch.consumables[id]}</b></span><button class="small gold" data-use="${id}">Équiper</button></div>`)).join('')
    : `<p class="muted">Tu n'as aucune potion en stock. Achète-en dans l'onglet <b>Boutique</b>.</p>`;
  $('potion-pick').innerHTML = html;
  $('potion-pick').querySelectorAll('[data-use]').forEach((b) => {
    b.onclick = async () => {
      if (await act('/api/consumable/equip', { id: b.dataset.use }, 'equip')) {
        $('potion-modal').classList.remove('open');
        toast(`${Rules.CONSUMABLES[b.dataset.use].icon} ${Rules.CONSUMABLES[b.dataset.use].label} prête pour ta prochaine partie !`);
      }
    };
  });
  const un = $('potion-pick').querySelector('[data-unequip]');
  if (un) un.onclick = async () => { if (await act('/api/consumable/equip', { id: null }, 'unequip')) openPotionModal(); };
  $('potion-modal').classList.add('open');
}
$('potion-slot').onclick = openPotionModal;
$('potion-modal-close').onclick = () => $('potion-modal').classList.remove('open');
$('potion-shop-link').onclick = () => { $('potion-modal').classList.remove('open'); showTab('boutique'); window.scrollTo({ top: 0, behavior: 'smooth' }); };

function renderPotionShop() {
  const ch = me.character;
  $('potion-grid').innerHTML = Object.entries(Rules.CONSUMABLES).map(([id, c]) => {
    const have = (ch.consumables[id] || 0) + (ch.consumableSlot === id ? 1 : 0);
    return potionCard(id, `<div class="row" style="margin-top:8px">
      <span class="shop-price">${c.price} 🪙</span>
      <span class="muted">${have ? `Tu en as <b>${have}</b>${ch.consumableSlot === id ? ' (1 équipée)' : ''}` : 'Aucune'}</span>
      <span class="spacer"></span>
      <button class="small gold" data-buy="${id}" data-n="1" ${ch.gold < c.price ? 'disabled' : ''}>Acheter</button>
      <button class="small secondary" data-buy="${id}" data-n="5" ${ch.gold < c.price * 5 ? 'disabled' : ''}>×5</button></div>`);
  }).join('');
  $('potion-grid').querySelectorAll('[data-buy]').forEach((b) => {
    b.onclick = async () => {
      const r = await act('/api/consumable/buy', { id: b.dataset.buy, count: Number(b.dataset.n) }, 'buy');
      if (r) toast(`${Rules.CONSUMABLES[b.dataset.buy].icon} ${r.count} × ${Rules.CONSUMABLES[b.dataset.buy].label} (−${r.price} 🪙). Équipe-la dans la case à côté de ton personnage !`, 5000);
    };
  });
}

// ---------- Arbre de compétences ----------
// L'écart entre les paliers s'adapte à la largeur disponible pour que tout l'arbre reste visible sans défiler ;
// sur un écran trop étroit, l'arbre entier est réduit (zoom) au lieu de dépasser.
const TREE = { w: 1180, h: 380, cx: 590, cy: 190, step: 80, gap: 96, scale: 1 };
const TREE_STEP = { min: 62, max: 92 };
const TREE_MARGIN = 40; // demi-largeur du carré de spécialisation + contour
let talentSel = null;

function layoutTree() {
  const avail = document.querySelector('.talent-scroll').clientWidth;
  if (!avail) return; // onglet caché : on garde la dernière disposition, recalculée à l'affichage
  const tiers = Rules.TALENT_TIERS.length;
  TREE.step = Math.max(TREE_STEP.min, Math.min(TREE_STEP.max, (avail / 2 - TREE_MARGIN) / tiers));
  TREE.w = Math.round(2 * (tiers * TREE.step + TREE_MARGIN));
  TREE.cx = TREE.w / 2;
  TREE.scale = Math.min(1, avail / TREE.w);
}

function talentPos(n) {
  const dir = n.branch === 'left' ? -1 : 1;
  const x = TREE.cx + dir * TREE.step * (n.tier + 1);
  const y = n.tier === 2 || n.tier === 4 ? TREE.cy + (n.option - 1) * TREE.gap : TREE.cy;
  return { x, y };
}

const statsText = (points) => Object.entries(points).map(([st, v]) => `+${v} ${Rules.STAT_INFO[st].label}`).join(', ');

function talentInfo(cls, n) {
  const b = Rules.TALENT_TREES[cls][n.branch];
  if (n.type === 'ult') {
    const U = Rules.ULTS[b.ult];
    return { icon: U.icon, title: `Ultime : ${U.label}`, html: `<p>${U.desc}</p><p class="muted">Se lance tout seul quand ta <b>barre de stamina</b> est pleine. Avec la spécialisation <b>${esc(b.spec)}</b> : ${U.descPlus}</p>` };
  }
  if (n.type === 'spec') {
    const U = Rules.ULTS[b.ult];
    return { icon: b.icon, title: `Spécialisation : ${b.spec}`, html: `<p>Ta classe devient <b>${esc(b.spec)}</b> (${b.desc})</p><p><b>${U.icon} ${U.label} amélioré :</b> ${U.descPlus}</p>` };
  }
  return { icon: Rules.STAT_INFO[Object.keys(n.points)[0]].icon, title: statsText(n.points), html: '<p class="muted">Points de caractéristiques bonus, comme des points de compétence (ils s\'ajoutent à tes points).</p>' };
}

function talentState(c, n) {
  if (c.talents.includes(n.id)) return 'owned';
  const reason = Rules.talentBlocker(c.cls, c.talents, n.id, c.talentState.available);
  if (!reason) return 'available';
  if (/autre chemin|Chemin bloqué/.test(reason)) return 'blocked';
  if (/Aucun point/.test(reason)) return 'next';
  return 'future';
}

function tutoHtml() {
  return `<ol class="tuto-steps">
    <li><b>1 point d'arbre tous les ${Rules.TALENT_EVERY} niveaux</b> (niveaux 4, 7, 10, 13…), en plus de tes points de caractéristiques.</li>
    <li>Ton arbre a <b>deux chemins</b>, un de chaque côté du rond central. Le premier rond de chaque chemin (🔴) débloque un <b>ultime</b>.
      Dès que tu en prends un, <b>l'autre chemin se bloque</b>.</li>
    <li>L'ultime se lance <b>tout seul en combat</b> quand ta <b>barre de stamina</b> (barre bleue sous ta vie) est pleine. Elle est
      <b>très longue</b> à remplir, mais l'ultime est très puissant. La caractéristique <b>🔋 Stamina</b> la remplit plus vite.</li>
    <li>Les ronds verts donnent des <b>points de caractéristiques bonus</b>. Aux carrefours, tu choisis <b>un rond sur trois</b> : les deux autres se bloquent.</li>
    <li>Au bout du chemin, le carré bleu est la <b>spécialisation</b> : ta classe change de nom et ton ultime devient bien plus fort.</li>
    <li>Envie de changer ? La <b>remise à zéro</b> (${Rules.TALENT_RESET_PRICE} 🪙) te rend tous tes points et débloque tous les chemins. Changer de classe remet aussi l'arbre à zéro (gratuitement).</li>
  </ol>`;
}

function renderTalents() {
  const c = me.character;
  const st = c.talentState;
  const unlockLevel = 1 + Rules.TALENT_EVERY;
  const locked = c.level < unlockLevel || !c.cls;
  $('talent-help').innerHTML = tutoHtml();
  $('tab-arbre').classList.toggle('locked-tab', locked);
  $('talent-sub').textContent = locked ? `Débloqué au niveau ${unlockLevel}` : `${st.available} point${st.available > 1 ? 's' : ''} à dépenser`;
  $('talent-locked').innerHTML = locked
    ? `<div class="talent-lock-box">🔒 <b>${c.cls ? `Disponible au niveau ${unlockLevel}` : 'Choisis d\'abord une classe'}</b>${c.cls ? ` — encore ${unlockLevel - c.level} niveau${unlockLevel - c.level > 1 ? 'x' : ''}.` : ''}
       Tu gagneras alors ton premier point d'arbre, puis un tous les ${Rules.TALENT_EVERY} niveaux. Voici un aperçu de ton arbre :</div>`
    : '';
  $('talents-panel').classList.toggle('tree-locked', locked);
  const cls = c.cls || 'guerrier';
  const tree = Rules.TALENT_TREES[cls];
  const nextLevel = unlockLevel + st.total * Rules.TALENT_EVERY;
  const ult = c.ult && Rules.ULTS[c.ult.id];
  $('talent-head').innerHTML = `
    <div class="talent-points"><b>${st.available}</b> point${st.available > 1 ? 's' : ''} disponible${st.available > 1 ? 's' : ''}
      <span class="muted">· ${st.spent} dépensé${st.spent > 1 ? 's' : ''} · prochain point au niveau ${nextLevel}</span></div>
    <div class="talent-ult">${ult ? `${ult.icon} Ultime : <b style="color:${ult.color}">${ult.label}${c.ult.enhanced ? ' ★' : ''}</b> · barre pleine en <b>${String(c.derived.staminaTime).replace('.', ',')} s</b>` : '<span class="muted">Pas encore d\'ultime : prends le premier rond rouge d\'un chemin.</span>'}</div>
    <button class="small danger" id="talent-reset" ${c.talents.length ? '' : 'disabled'}>↺ Remise à zéro (${Rules.TALENT_RESET_PRICE} 🪙)</button>
    <div class="branch-cards">${['left', 'right'].map((b) => {
      const br = tree[b];
      const U = Rules.ULTS[br.ult];
      const chosen = Rules.talentBranch(c.talents);
      return `<div class="branch-card ${chosen && chosen !== b ? 'off' : ''}" style="--c:${br.color}">
        <b>${b === 'left' ? '⬅' : ''} ${br.icon} ${esc(br.spec)} ${b === 'right' ? '➡' : ''}</b><span class="muted">${br.desc}</span>
        <span>${U.icon} ${U.label}</span></div>`;
    }).join('')}</div>`;
  const resetBtn = $('talent-reset');
  if (resetBtn) resetBtn.onclick = async () => {
    if (!confirm(`Remettre ton arbre à zéro pour ${Rules.TALENT_RESET_PRICE} golds ? Tous tes points te sont rendus.`)) return;
    const r = await act('/api/talent/reset', {}, 'reroll');
    if (r) { talentSel = null; toast(`↺ Arbre remis à zéro : ${r.refunded} point(s) récupéré(s)`); }
  };

  // Liens et nœuds
  layoutTree();
  const nodes = Rules.talentNodes(cls);
  const byTier = (b, t) => nodes.filter((n) => n.branch === b && n.tier === t);
  const owned = new Set(c.talents);
  let lines = '';
  for (const b of ['left', 'right']) {
    const color = tree[b].color;
    const link = (a, z, on) => { lines += `<line x1="${a.x}" y1="${a.y}" x2="${z.x}" y2="${z.y}" class="${on ? 'on' : ''}" style="--c:${color}"/>`; };
    for (const n of byTier(b, 0)) link({ x: TREE.cx, y: TREE.cy }, talentPos(n), owned.has(n.id));
    for (let t = 1; t < Rules.TALENT_TIERS.length; t++) {
      for (const n of byTier(b, t)) for (const p of byTier(b, t - 1)) link(talentPos(p), talentPos(n), owned.has(n.id) && owned.has(p.id));
    }
  }
  const nodeHtml = nodes.map((n) => {
    const { x, y } = talentPos(n);
    const state = talentState(c, n);
    const info = talentInfo(cls, n);
    const pts = n.type === 'stat' ? `<small>${Object.values(n.points).reduce((a, v) => a + v, 0)}</small>` : '';
    return `<button class="tnode tnode-${n.type} ${state} ${talentSel === n.id ? 'sel' : ''}" data-id="${n.id}"
      style="left:${x}px;top:${y}px;--c:${tree[n.branch].color}" title="${esc(info.title)}">${info.icon}${pts}</button>`;
  }).join('');
  Object.assign($('talent-tree').style, {
    width: TREE.w + 'px', height: TREE.h + 'px',
    transform: TREE.scale < 1 ? `scale(${TREE.scale})` : '', margin: TREE.scale < 1 ? '0' : '0 auto',
  });
  document.querySelector('.talent-scroll').style.height = Math.ceil(TREE.h * TREE.scale) + 'px';
  $('talent-tree').innerHTML = `<svg width="${TREE.w}" height="${TREE.h}">${lines}</svg>
    <div class="tnode tnode-start" style="left:${TREE.cx}px;top:${TREE.cy}px" title="Départ">${Rules.CLASS_INFO[cls].icon}</div>${nodeHtml}`;
  $('talent-tree').querySelectorAll('.tnode[data-id]').forEach((el) => {
    el.onclick = () => { talentSel = el.dataset.id; renderTalents(); };
  });

  // Détail du nœud sélectionné
  const sel = nodes.find((n) => n.id === talentSel);
  if (!sel) {
    $('talent-detail').innerHTML = '<p class="muted">Clique sur un rond pour voir ce qu\'il apporte.</p>';
  } else {
    const info = talentInfo(cls, sel);
    const state = talentState(c, sel);
    const reason = Rules.talentBlocker(c.cls, c.talents, sel.id, st.available);
    const action = locked ? '<span class="muted">🔒 Arbre pas encore débloqué.</span>'
      : state === 'owned' ? '<b class="up">✅ Appris</b>'
        : state === 'available' ? `<button class="gold" id="talent-learn">Apprendre (1 point)</button>`
          : `<span class="muted">🔒 ${esc(reason)}</span>`;
    $('talent-detail').innerHTML = `<div class="talent-detail-box" style="--c:${tree[sel.branch].color}">
      <div class="talent-detail-title">${info.icon} <b>${esc(info.title)}</b></div>${info.html}<div class="row">${action}</div></div>`;
    const learn = $('talent-learn');
    if (learn) learn.onclick = async () => {
      const r = await act('/api/talent/learn', { id: sel.id }, 'levelUp');
      if (r) toast(r.spec ? `🎉 Spécialisation obtenue : tu es maintenant ${r.spec} !` : `✨ ${info.title} appris !`, 5000);
    };
  }

  // Tutoriel en fenêtre, la première fois que l'arbre se débloque
  const tutoKey = 'zl_tuto_talents_' + me.id;
  let seen = true;
  try { seen = localStorage.getItem(tutoKey) === '1'; } catch (e) { /* ignore */ }
  if (!locked && !seen && !$('talent-tuto').classList.contains('open')) {
    $('talent-tuto-body').innerHTML = `<p>Tu as atteint le niveau ${unlockLevel} : voici ton <b>premier point d'arbre de compétences</b> !</p>${tutoHtml()}
      <p class="muted">Ces explications restent disponibles avec le bouton <b>?</b> de l'onglet 🌳 Arbre de compétences.</p>`;
    $('talent-tuto').classList.add('open');
  }
}
let treeResize = null;
window.addEventListener('resize', () => {
  clearTimeout(treeResize);
  treeResize = setTimeout(() => { if (me && document.querySelector('.talent-scroll').clientWidth) renderTalents(); }, 120);
});
$('talent-tuto-ok').onclick = () => {
  try { localStorage.setItem('zl_tuto_talents_' + me.id, '1'); } catch (e) { /* ignore */ }
  $('talent-tuto').classList.remove('open');
  showTab('arbre');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ---------- Entraînement ----------
// Mini-bus d'événements : l'arène d'entraînement reçoit ses images comme l'arène du stream reçoit les siennes.
const trainingBus = { h: {}, on(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); }, emit(ev, d) { (this.h[ev] || []).forEach((fn) => fn(d)); } };
let trainingView = null;
let trainingKind = 'bot';
let trainingOpponents = null;

function ensureTrainingView() {
  if (trainingView) return;
  trainingView = new ArenaView($('training-arena'), trainingBus);
  trainingBus.emit('queue', { phase: 'idle', mode: 'br', training: true, participants: [], result: null });
}

async function loadTrainingOpponents() {
  if (trainingOpponents) return;
  try { trainingOpponents = await api('/api/training/opponents'); } catch (e) { trainingOpponents = []; }
  renderTrainingOpponents();
}

function renderTrainingOpponents() {
  const q = $('training-search').value.trim().toLowerCase();
  const list = (trainingOpponents || []).filter((p) => !q || p.name.toLowerCase().includes(q));
  $('training-opponent').innerHTML = list.length
    ? list.map((p) => `<option value="${p.id}">${Rules.CLASS_INFO[p.cls].icon} ${esc(p.name)} — niv. ${p.level}</option>`).join('')
    : '<option value="">Aucun joueur trouvé</option>';
}

function setupTraining() {
  $('training-cls').innerHTML = Rules.CLASSES.map((cls) => `<option value="${cls}">${Rules.CLASS_INFO[cls].icon} ${Rules.CLASS_INFO[cls].label}</option>`).join('');
  $('training-level').max = Rules.TRAINING.maxLevel;
  $('training-kind').querySelectorAll('[data-kind]').forEach((b) => {
    b.onclick = () => {
      trainingKind = b.dataset.kind;
      $('training-kind').querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('active', x === b));
      $('training-bot').style.display = trainingKind === 'bot' ? '' : 'none';
      $('training-player').style.display = trainingKind === 'player' ? '' : 'none';
      if (trainingKind === 'player') loadTrainingOpponents();
    };
  });
  $('training-search').oninput = renderTrainingOpponents;
  $('training-start').onclick = async () => {
    ensureTrainingView();
    const body = trainingKind === 'bot'
      ? { opponent: 'bot', cls: $('training-cls').value, level: Number($('training-level').value) }
      : { opponent: 'player', id: $('training-opponent').value };
    try {
      const r = await api('/api/training/start', body);
      $('training-status').textContent = `Duel contre ${r.opponent.name} (niv. ${r.opponent.level})…`;
      $('training-stop').disabled = false;
      $('training-arena').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      toast('⚠️ ' + err.message);
    }
  };
  $('training-stop').onclick = () => api('/api/training/stop', {}).catch(() => {});
}
setupTraining();

// ---------- Classes ----------
let classModalShown = false;

function openClassModal() {
  const c = me.character;
  const first = !c.cls;
  $('class-modal-title').textContent = first ? '🎭 Choisis ta classe' : '🔄 Changer de classe';
  $('class-modal-sub').innerHTML = first
    ? 'Bienvenue ! Ta classe change tes stats de base, ta façon de combattre et les armes que tu peux équiper. Le premier choix est <b>gratuit</b>.'
    : `Changer de classe coûte <b>${Rules.CLASS_CHANGE_PRICE} 🪙</b> (tu en as ${c.gold}). Ton arme et ton objet secondaire retournent dans ton coffre personnel s'ils ne conviennent pas à ta nouvelle classe.`;
  $('class-modal-close').style.display = first ? 'none' : '';
  $('class-grid').innerHTML = Rules.CLASSES.map((cls) => {
    const ci = Rules.CLASS_INFO[cls];
    const w1 = Rules.KINDS[ci.weapon];
    const w2 = Rules.KINDS[ci.offhand];
    return `<div class="class-card ${c.cls === cls ? 'current' : ''}" data-cls="${cls}" style="--c:${ci.color}">
      <canvas width="120" height="110" data-preview="${cls}"></canvas>
      <h3>${ci.icon} ${ci.label}</h3>
      <p>${ci.desc}</p>
      <ul>${ci.perks.map((x) => `<li>${x}</li>`).join('')}</ul>
      <div class="weapons">${w1.icon} ${w1.label} · ${w2.icon} ${w2.label}</div>
      <button class="small ${c.cls === cls ? 'secondary' : 'gold'}" ${c.cls === cls ? 'disabled' : ''}>${c.cls === cls ? 'Ta classe' : first ? 'Choisir' : `Choisir (${Rules.CLASS_CHANGE_PRICE} 🪙)`}</button>
    </div>`;
  }).join('');
  $('class-grid').querySelectorAll('canvas[data-preview]').forEach((cv) => {
    const g = cv.getContext('2d');
    drawFighter(g, 60, 70, { name: me.twitchDisplayName || me.username, cls: cv.dataset.preview, look: {}, app: me.character.look }, { scale: 2.2, swing: 0.3 });
  });
  $('class-grid').querySelectorAll('.class-card button:not([disabled])').forEach((b) => {
    b.onclick = async () => {
      const cls = b.closest('.class-card').dataset.cls;
      const r = await act('/api/class', { cls }, 'victory');
      if (r) {
        $('class-modal').classList.remove('open');
        toast(`${Rules.CLASS_INFO[cls].icon} Tu es maintenant ${Rules.CLASS_INFO[cls].label} !${r.unequipped ? ` (${r.unequipped} objet(s) retiré(s))` : ''}${r.talentsReset ? ` Ton arbre de compétences a été remis à zéro (${r.talentsReset} point(s) rendu(s)).` : ''}`, 6000);
      }
    };
  });
  $('class-modal').classList.add('open');
}

$('change-class').onclick = openClassModal;
$('class-modal-close').onclick = () => $('class-modal').classList.remove('open');

// ---------- Forge ----------
const fuseSel = [];
let fuseFilter = 'all';
let rerollItemId = null;

function allItems() {
  const c = me.character;
  return Object.values(c.equipment).filter(Boolean).map((i) => ({ item: i, equipped: true }))
    .concat(c.inventory.map((i) => ({ item: i, equipped: false })));
}

const fr = (x) => (Math.round(x * 10) / 10).toLocaleString('fr-FR');

function renderForge() {
  const c = me.character;
  const inv = c.inventory;
  // Retire de la fusion les objets qui ne sont plus dans le coffre.
  for (let i = fuseSel.length - 1; i >= 0; i--) if (!inv.some((x) => x.id === fuseSel[i])) fuseSel.splice(i, 1);
  const chosen = fuseSel.map((id) => inv.find((x) => x.id === id));
  const rarity = chosen[0] && chosen[0].rarity;

  $('fuse-slots').innerHTML = [0, 1, 2].map((i) => {
    const it = chosen[i];
    if (!it) return '<div class="fuse-slot">Emplacement vide</div>';
    return `<div class="fuse-slot filled rarity-${it.rarity}" data-unfuse="${it.id}" title="Retirer">
      <div><div class="c-${it.rarity}" style="font-weight:800">${itemType(it).icon} ${esc(it.name)}</div>
      <div class="muted">${Rules.RARITY_INFO[it.rarity].label}</div></div></div>`;
  }).join('');
  $('fuse-slots').querySelectorAll('[data-unfuse]').forEach((el) => {
    el.onclick = () => { fuseSel.splice(fuseSel.indexOf(el.dataset.unfuse), 1); renderForge(); };
  });

  if (rarity) {
    const chance = Rules.fuseUpgradeChance(rarity, c.derived.luck);
    const next = Rules.RARITIES[Rules.RARITIES.indexOf(rarity) + 1];
    $('fuse-info').innerHTML = next
      ? `🎲 <b>${fr(chance)} %</b> de chances d'obtenir un objet <span class="c-${next}">${Rules.RARITY_INFO[next].label}</span>
         <span class="muted">(${Rules.FUSE_UPGRADE[rarity]} % + ${fr(chance - Rules.FUSE_UPGRADE[rarity])} % grâce à ta chance : ${Rules.FUSE_LUCK_BONUS.toLocaleString('fr-FR')} % par point)</span>`
      : '🎲 Légendaire : tu obtiendras un nouvel objet <span class="c-legendaire">Légendaire</span>.';
  } else {
    $('fuse-info').innerHTML = '<span class="muted">Choisis 3 objets de même rareté ci-dessous.</span>';
  }
  $('fuse-go').disabled = fuseSel.length !== Rules.FUSE_COUNT;

  // Filtres par rareté + liste des objets du coffre
  const counts = Object.fromEntries(Rules.RARITIES.map((r) => [r, inv.filter((i) => i.rarity === r).length]));
  $('fuse-filters').innerHTML = [['all', 'Toutes']].concat(Rules.RARITIES.map((r) => [r, Rules.RARITY_INFO[r].label]))
    .map(([k, label]) => `<button class="${fuseFilter === k ? 'active' : ''}" data-ff="${k}">${label}${k === 'all' ? '' : ` (${counts[k]})`}</button>`).join('');
  $('fuse-filters').querySelectorAll('[data-ff]').forEach((b) => { b.onclick = () => { fuseFilter = b.dataset.ff; renderForge(); }; });
  const pickable = inv
    .filter((i) => !fuseSel.includes(i.id) && !isProtected(i.id) && (fuseFilter === 'all' || i.rarity === fuseFilter))
    .sort((a, b) => Rules.RARITIES.indexOf(a.rarity) - Rules.RARITIES.indexOf(b.rarity));
  $('fuse-pick').innerHTML = pickable.length
    ? pickable.map((i) => {
      const off = (rarity && i.rarity !== rarity) || fuseSel.length >= Rules.FUSE_COUNT;
      return `<span class="pick-chip rarity-${i.rarity} ${off ? 'disabled' : ''}" data-fuse="${i.id}" title="${esc(i.lines.map((l) => Rules.formatLine(l.stat, l.value)).join(', '))}">
        ${itemType(i).icon} <span class="c-${i.rarity}">${esc(i.name)}</span></span>`;
    }).join('')
    : '<span class="muted">Aucun objet disponible.</span>';
  $('fuse-pick').querySelectorAll('[data-fuse]:not(.disabled)').forEach((el) => {
    el.onclick = () => { fuseSel.push(el.dataset.fuse); Sound.play('chestHit', 3); renderForge(); };
  });

  // Relance de ligne
  $('reroll-prices').innerHTML = 'Prix : ' + Rules.RARITIES.map((r) => `<span class="c-${r}">${Rules.RARITY_INFO[r].label} ${Rules.REROLL_PRICE[r]} 🪙</span>`).join(' · ');
  const items = allItems().sort((a, b) => (b.equipped - a.equipped) || Rules.RARITIES.indexOf(b.item.rarity) - Rules.RARITIES.indexOf(a.item.rarity));
  if (!items.some((x) => x.item.id === rerollItemId)) rerollItemId = items[0] ? items[0].item.id : null;
  $('reroll-item').innerHTML = items.length
    ? items.map(({ item, equipped }) => `<option value="${item.id}" ${item.id === rerollItemId ? 'selected' : ''}>${equipped ? '✅ Équipé · ' : ''}${itemType(item).icon} ${esc(item.name)} (${Rules.RARITY_INFO[item.rarity].label})</option>`).join('')
    : '<option>Aucun objet</option>';
  renderRerollPreview();
}

function renderRerollPreview(flashIndex) {
  const entry = allItems().find((x) => x.item.id === rerollItemId);
  if (!entry) { $('reroll-preview').innerHTML = ''; return; }
  const item = entry.item;
  const price = Rules.REROLL_PRICE[item.rarity];
  const poor = me.character.gold < price;
  $('reroll-preview').innerHTML = item.lines.map((l, i) => `
    <div class="reroll-line ${i === flashIndex ? 'flash' : ''}">
      <span>${Rules.STAT_INFO[l.stat].icon} <b>+${l.value}${Rules.statUnit(l.stat)}</b> ${Rules.STAT_INFO[l.stat].label}</span>
      <span class="spacer"></span>
      <button class="small gold" data-reroll="${i}" ${poor ? 'disabled' : ''}>🎲 Relancer (${price} 🪙)</button>
    </div>`).join('');
  $('reroll-preview').querySelectorAll('[data-reroll]').forEach((b) => {
    b.onclick = async () => {
      const index = Number(b.dataset.reroll);
      try {
        const r = await api('/api/forge/reroll', { itemId: item.id, line: index });
        Sound.play('reroll');
        toast(`🎲 ${Rules.formatLine(r.old.stat, r.old.value)} → ${Rules.formatLine(r.line.stat, r.line.value)}`, 4500);
        me = await api('/api/me');
        render();
        renderRerollPreview(index);
      } catch (err) {
        toast('⚠️ ' + err.message);
      }
    };
  });
}

$('reroll-item').onchange = (e) => { rerollItemId = e.target.value; renderRerollPreview(); };
$('fuse-clear').onclick = () => { fuseSel.length = 0; renderForge(); };
$('fuse-go').onclick = async () => {
  const inputs = fuseSel.map((id) => me.character.inventory.find((x) => x.id === id));
  if (inputs.some((i) => i.rarity === 'epique' || i.rarity === 'legendaire')
    && !confirm('Ces objets vont être détruits définitivement. Continuer ?')) return;
  let r;
  opening = true; // évite d'afficher le résultat derrière l'animation
  try {
    r = await api('/api/forge/fuse', { itemIds: [...fuseSel] });
    me = await api('/api/me');
  } catch (err) {
    opening = false;
    toast('⚠️ ' + err.message);
    return;
  }
  fuseSel.length = 0;
  forge.play(inputs, r, me.character.cls, () => { opening = false; render(); });
};

// ---------- Règles des combats ----------
(function renderCombatInfo() {
  const R = Rules.REWARDS;
  const row = (label, r, note = '') => `<tr><td><b>${label}</b>${note ? `<div class="muted" style="font-size:12px">${note}</div>` : ''}</td>
    <td>${r.xp ? '+' + r.xp + ' XP' : '—'}</td><td>${r.gold ? '+' + r.gold + ' 🪙' : '—'}</td><td>${r.chests ? '+' + r.chests + ' <i class="ico-chest"></i>' : '—'}</td></tr>`;
  $('rewards-table').innerHTML = '<tr><th>Action</th><th>XP</th><th>Golds</th><th>Coffres</th></tr>'
    + row('⚔️ Kill', R.kill)
    + row('🏆 Victoire', R.win, 'Dernier survivant')
    + row('🎖️ Participation', R.participation, 'Chaque combattant, à la fin de la bataille')
    + row('🩸 Premier kill', R.firstblood, 'Le tout premier kill de la bataille')
    + row('⚡ Double kill', R.double, `2 kills d'affilée en moins de ${Rules.STREAK_WINDOW} s`)
    + row('💀 Massacre', R.massacre, `${Rules.MASSACRE_KILLS} kills dans la même bataille`);
  $('streak-rules').innerHTML = `Les bonus de séries s'ajoutent aux récompenses normales du kill et sont annoncés en grand sur le stream
    (un <b>TRIPLE KILL</b> est aussi annoncé, sans bonus).`;
  $('events-help').innerHTML = Object.values(Rules.BATTLE_EVENTS).map((ev) => `<div style="--c:${ev.color}"><b>${ev.icon} ${ev.label}</b><br>${ev.desc}</div>`).join('');
  $('class-summary').innerHTML = Rules.CLASSES.map((cls) => {
    const ci = Rules.CLASS_INFO[cls];
    return `<div style="--c:${ci.color}"><b>${ci.icon} ${ci.label}</b><br>${ci.perks.join(' · ')}</div>`;
  }).join('');
})();

// ---------- Modes de jeu : Combat de Boss et Raid de Donjon ----------
(function renderModesInfo() {
  const B = Rules.BOSS;
  const D = Rules.DUNGEON;
  const pct = (x) => Math.round(x * 100) + ' %';
  const ex = Rules.bossStats(10);
  $('boss-intro').innerHTML = `Tout le monde s'allie contre un boss géant, choisi par le streamer : <b>${Object.values(Rules.BOSSES).map((x) => x.icon + ' ' + x.short).join('</b>, <b>')}</b>. Assez difficile : il faut une équipe solide !`;
  $('boss-rules').innerHTML = [
    `Personne ne se tape dessus : <b>tous les combattants attaquent le Troll</b>. Le <b>Guerriloot</b> attire son attention et protège les autres.`,
    `Sa vie et ses dégâts dépendent du <b>nombre de combattants au lancement</b> : ${B.hpBase} PV + ${B.hpPerPlayer} PV par combattant (10 combattants → ${ex.maxHp.toLocaleString('fr-FR')} PV).`,
    `Son coup de massue touche aussi les combattants proches de sa cible (${pct(B.cleaveRatio)} des dégâts).`,
    `Toutes les ${String(B.slam.every).replace('.', ',')} s, une attaque spéciale : <b>onde de choc</b> autour de lui, puis <b>rocher</b> lancé sur le plus gros groupe. La zone rouge au sol prévient ${String(B.slam.warn).replace('.', ',')} s avant.`,
    `Sa grosse barre de vie a <b>2 coches, à 66 % et 33 %</b> : à chaque coche franchie, il frappe <b>+${pct(B.phases[0].damageMult - 1)}</b> plus fort, attaque <b>+${pct(B.phases[0].attackSpeedMult - 1)}</b> plus vite et ses attaques spéciales reviennent plus souvent.`,
    `Après ${Math.floor(B.enrageAt / 60)} min ${B.enrageAt % 60} s, c'est la <b>rage finale</b> : dégâts ×${B.enrageMult} (comme les autres boss).`,
  ].map((x) => `<li>${x}</li>`).join('');
  const Dr = Rules.BOSSES.dragon;
  const So = Rules.BOSSES.sorcier;
  const exD = Rules.bossStats(10, 'dragon');
  const exS = Rules.bossStats(10, 'sorcier');
  const block = (Bx, items) => `<div class="boss-block" style="--c:${Bx.color}"><canvas class="boss-mini" data-kind="${Bx.kind}" width="120" height="110"></canvas>
    <div><h4>${Bx.icon} ${Bx.name}</h4><ul class="rules-list">${items.map((x) => `<li>${x}</li>`).join('')}</ul></div></div>`;
  $('boss-others').innerHTML = block(Dr, [
    `${Dr.hpBase} PV + ${Dr.hpPerPlayer} par combattant (10 → ${exD.maxHp.toLocaleString('fr-FR')} PV). Ses griffes touchent aussi les voisins de sa cible.`,
    `Toutes les ${Dr.specialEvery} s : <b>souffle de feu</b> en cône vers le plus gros groupe, puis <b>coup de queue</b> tout autour de lui.`,
    `À <b>75 %</b> et <b>30 %</b>, il <b>s'envole</b> ${Dr.flight.duration} s : seuls les combattants <b>à distance</b> (Archer, Mage) peuvent le toucher. Il bombarde le sol de boules de feu et lâche des <b>flammèches</b> : chacune abattue (le travail du corps à corps !) le brûle de ${pct(Dr.sprites.burn)} et le fait atterrir 1 s plus tôt. Il atterrit ensuite lourdement sur le plus gros groupe.`,
    `À <b>50 %</b>, il part <b>pondre</b> : 1 œuf pour ${Dr.nest.eggsPer} combattants (${Dr.nest.eggsMin} à ${Dr.nest.eggsMax}). Il faut les détruire en ${Dr.nest.duration} s, sinon ils éclosent en <b>dragonnets</b>. Il revient furieux (+${pct(Dr.nest.returnDamageMult - 1)} de dégâts).`,
  ]) + block(So, [
    `${So.hpBase} PV + ${So.hpPerPlayer} par combattant (10 → ${exS.maxHp.toLocaleString('fr-FR')} PV). Il attaque <b>de loin</b> avec des traits d'ombre et se <b>téléporte</b> toutes les ${So.blinkEvery} s.`,
    `Toutes les ${So.specialEvery} s : <b>malédiction</b> sur quelques combattants (${pct(So.curse.dps)} de leur vie par seconde pendant ${So.curse.duration} s), puis <b>zones d'ombre</b> sous leurs pieds. Un <b>Prêtre</b> à côté d'un maudit le <b>purifie</b> aussitôt.`,
    `À <b>70 %</b> et <b>20 %</b>, il s'enferme dans un <b>bouclier</b> : il faut détruire ses ${So.shield.crystals} <b>cristaux</b>, qui le soignent tant qu'ils tiennent.`,
    `À <b>45 %</b>, il se <b>dédouble</b> : ${So.clones.count} illusions fragiles (mais qui attaquent aussi). Les dégâts de zone (Mage) font des merveilles !`,
  ]);
  $('boss-others').querySelectorAll('.boss-mini').forEach((cv) => {
    const kind = cv.dataset.kind;
    drawMonster(cv.getContext('2d'), kind === 'dragon' ? 66 : 60, kind === 'dragon' ? 76 : 84, { kind }, { scale: kind === 'dragon' ? 0.48 : 0.8, t: 0 });
  });
  const R = B.reward;
  $('boss-rewards').innerHTML = `<tr><th>Résultat</th><th>XP</th><th>Golds</th><th>Coffres</th></tr>
    <tr><td><b>🏆 Boss vaincu</b><div class="muted" style="font-size:12px">Pour TOUS les participants, morts ou vivants</div></td>
      <td>+${R.xp} XP</td><td>+${R.gold} 🪙</td><td>+${R.chests} <i class="ico-chest"></i></td></tr>
    <tr><td><b>💀 Tout le monde est tombé</b><div class="muted" style="font-size:12px">Seulement l'XP de participation</div></td>
      <td>+${Rules.REWARDS.participation.xp} XP</td><td>—</td><td>—</td></tr>`;

  const M = Rules.MONSTERS;
  const monsters = Object.values(M).map((m) => `${m.icon} ${m.label}${m.from > 1 ? ` (dès la salle ${m.from})` : ''}`).join(', ');
  $('dungeon-rules').innerHTML = [
    `Les aventuriers entrent par la gauche, éliminent tous les monstres de la salle, puis sortent à droite vers la salle suivante.`,
    `Monstres : ${monsters}. Toutes les ${Rules.ELITE.every} salles, un <b>chef 👑</b> beaucoup plus costaud les accompagne.`,
    `À chaque salle, les monstres sont <b>plus nombreux</b> et plus forts (+${pct(D.hpPerRoom)} de vie et +${pct(D.damagePerRoom)} de dégâts par salle). Leur nombre dépend du nombre d'aventuriers au départ.`,
    `<b>Pas de réapparition</b> : un aventurier tombé est éliminé du raid. Entre deux salles, les survivants récupèrent <b>${pct(D.healBetweenRooms)}</b> de leur vie.`,
    `Après ${D.enrageAt} s dans la même salle, les monstres s'énervent (+${pct(D.enrageRate)} de dégâts par seconde).`,
    `🗳️ <b>Sondage du chat</b> : après chaque salle de chef, le combat se met en pause ${Rules.DUNGEON_POLL.duration} s et <b>tout le monde</b> (même sans jouer) vote entre deux bonus tirés au hasard, avec leur commande dans le chat (ou <b>!1</b> / <b>!2</b>) ou avec les boutons de cette page. Une voix par personne, le dernier vote compte. Les bonus de combat durent jusqu'au sondage suivant.`,
    `Le raid s'arrête quand tout le monde est tombé. <b>Tout le monde</b> reçoit la récompense de la salle atteinte, plus ${Rules.REWARDS.participation.xp} XP de participation.`,
  ].map((x) => `<li>${x}</li>`).join('');
  $('dungeon-boons').innerHTML = Object.values(Rules.DUNGEON_BOONS).map((b) =>
    `<tr><td style="color:${b.color};white-space:nowrap"><b>${b.icon} ${b.label}</b></td><td><code>${b.cmd}</code></td><td>${b.desc}</td></tr>`).join('');
  const tiers = [5, 10, 15, 20, 25, 30].map((room) => Rules.dungeonReward(room));
  $('dungeon-rewards').innerHTML = '<tr><th>Salle atteinte</th><th>XP</th><th>Golds</th><th>Coffres</th></tr>'
    + `<tr><td><b>Salles 1 à 4</b></td><td>+${Rules.REWARDS.participation.xp} XP <span class="muted">(participation)</span></td><td>—</td><td>—</td></tr>`
    + tiers.map((r) => `<tr><td><b>Salle ${r.tier}${r.tier === 30 ? ' et +' : ` à ${r.tier + 4}`}</b></td><td>+${r.xp} XP</td><td>+${r.gold} 🪙</td><td>${r.chests ? '+' + r.chests + ' <i class="ico-chest"></i>' : '—'}</td></tr>`).join('')
    + '<tr><td colspan="4" class="muted" style="font-size:12px">Puis +1 coffre et +250 XP / golds toutes les 5 salles.</td></tr>';

  const K = Rules.KOTH;
  $('koth-rules').innerHTML = [
    `Une <b>colline</b> (cercle doré au sol) au centre de l'arène. Chaque seconde passée dessus rapporte <b>${K.points.hill} points</b> à chacun, et <b>${K.points.king} points</b> si tu y es <b>seul</b> : tu es alors le <b>Roi 👑</b>.`,
    `Chaque kill rapporte <b>${K.points.kill} points</b>. Les morts <b>reviennent au combat</b> au bord de l'arène au bout de ${K.respawn} s, protégés ${String(K.protect).replace('.', ',')} s.`,
    `Toutes les ${K.hill.moveEvery} s, la colline <b>change de place</b> : le nouvel endroit s'affiche en pointillés ${K.hill.warn} s avant.`,
    `Au bout de ${Math.floor(K.duration / 60)} min ${K.duration % 60} s, le <b>meilleur score gagne</b> (égalité : le plus de kills). Le vainqueur reçoit la récompense de victoire du Battle Royale, et <b>les paris sont ouverts</b>.`,
    `Les Guerriers et les Prêtres, solides, tiennent bien la colline ; les Mages nettoient les groupes qui s'y entassent.`,
  ].map((x) => `<li>${x}</li>`).join('');
  const kc = $('koth-portrait').getContext('2d');
  kc.fillStyle = 'rgba(255,210,63,.25)';
  kc.strokeStyle = '#ffd23f';
  kc.lineWidth = 3;
  kc.beginPath(); kc.ellipse(75, 82, 62, 22, 0, 0, Math.PI * 2); kc.fill(); kc.stroke();
  drawFighter(kc, 75, 62, { name: 'Roi', cls: 'guerrier', look: {} }, { scale: 1.5 });
  kc.font = '26px "Segoe UI Emoji", sans-serif';
  kc.textAlign = 'center';
  kc.fillText('👑', 75, 20);

  // Portraits
  const bc = $('boss-portrait').getContext('2d');
  drawMonster(bc, 72, 104, { kind: 'troll' }, { scale: 0.65, t: 0 });
  const dc = $('dungeon-portrait').getContext('2d');
  [['gobelin', 32], ['slime', 82], ['chauve_souris', 132], ['squelette', 185]].forEach(([kind, x], i) => {
    drawMonster(dc, x, 62, { kind }, { scale: 1.6, facing: i % 2 ? -1 : 1, t: 400 * i });
  });
})();

// ---------- Onglets ----------
const TABS = ['perso', 'inventaire', 'arbre', 'boutique', 'entrainement', 'succes', 'classements', 'regles'];

function showTab(name) {
  if (!TABS.includes(name)) name = 'perso';
  document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === name));
  document.querySelectorAll('#tabs-nav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  try { localStorage.setItem('zl_tab', name); } catch (e) { /* ignore */ }
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  if (name === 'arbre' && me) renderTalents(); // la largeur de l'arbre ne se mesure qu'onglet affiché
}

document.querySelectorAll('#tabs-nav [data-tab]').forEach((b) => {
  b.onclick = () => { showTab(b.dataset.tab); window.scrollTo({ top: 0, behavior: 'smooth' }); };
});
window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
showTab(location.hash.slice(1) || (() => { try { return localStorage.getItem('zl_tab'); } catch (e) { return null; } })() || 'perso');

// Pastilles sur les onglets : points à répartir, coffres à ouvrir, succès à récupérer.
function renderBadges() {
  const c = me.character;
  const claim = Rules.ACHIEVEMENTS.filter((a) => { const st = Rules.achievementState(c, a); return st.done && !st.claimed; }).length;
  const set = (tab, n) => {
    const el = document.querySelector(`[data-badge="${tab}"]`);
    el.textContent = n || '';
    el.classList.toggle('on', n > 0);
  };
  set('perso', c.skillPoints);
  set('inventaire', c.chests);
  set('arbre', Math.max(0, c.talentState.available));
  set('succes', claim);
}

// ---------- Apparence ----------
function renderAppearance() {
  const look = me.character.look;
  const rows = Object.entries(Rules.APPEARANCE).map(([part, def]) => {
    let opts;
    if (part === 'color') {
      opts = `<button class="swatch auto ${look.color ? '' : 'active'}" data-part="color" data-value="" title="Automatique (selon ton pseudo)"></button>`
        + Object.entries(def.options).map(([k, o]) => `<button class="swatch ${look.color === k ? 'active' : ''}" style="background:${o.hex}" data-part="color" data-value="${k}" title="${o.label}"></button>`).join('');
    } else {
      opts = Object.entries(def.options).map(([k, o]) => `<button class="chip ${look[part] === k ? 'active' : ''}" data-part="${part}" data-value="${k}">${o.label}</button>`).join('');
    }
    return `<div class="app-row"><div class="app-label">${def.label}</div><div class="chips">${opts}</div></div>`;
  });
  // Cosmétiques possédés
  const owned = me.character.owned;
  rows.push(Object.entries(Rules.COSMETIC_SLOTS).map(([slot, def]) => {
    const mine = owned.filter((id) => Rules.COSMETICS[id].slot === slot);
    const opts = mine.length
      ? `<button class="chip ${look[slot] ? '' : 'active'}" data-part="${slot}" data-value="">Aucun</button>`
        + mine.map((id) => `<button class="chip ${look[slot] === id ? 'active' : ''}" data-part="${slot}" data-value="${id}">${Rules.COSMETICS[id].label}</button>`).join('')
      : '<span class="muted" style="font-size:13px">Rien pour l\'instant — <a href="#boutique">voir la boutique</a></span>';
    return `<div class="app-row"><div class="app-label">${def.label}${def.note ? ` <span style="text-transform:none;letter-spacing:0">(${def.note.toLowerCase()})</span>` : ''}</div><div class="chips">${opts}</div></div>`;
  }).join(''));
  $('app-options').innerHTML = rows.join('');
  $('app-options').querySelectorAll('[data-part]').forEach((b) => {
    b.onclick = () => act('/api/look', { part: b.dataset.part, value: b.dataset.value || null }, 'equip');
  });
}

// ---------- Boutique ----------
let trying = null; // cosmétique essayé sur l'aperçu de la boutique

function renderShop() {
  const c = me.character;
  $('shop-gold').textContent = c.gold;
  const t = trying && Rules.COSMETICS[trying];
  $('shop-try').innerHTML = t ? `Essai : <b>${esc(t.label)}</b>` : 'Clique sur un article pour l\'essayer';
  $('shop-list').innerHTML = Object.entries(Rules.COSMETIC_SLOTS).map(([slot, def]) => {
    const items = Object.entries(Rules.COSMETICS).filter(([, it]) => it.slot === slot).sort((a, b) => a[1].price - b[1].price);
    return `<div class="shop-cat"><h3>${def.icon} ${def.plural}</h3><div class="shop-grid">${items.map(([id, it]) => {
      const owned = c.owned.includes(id);
      const worn = c.look[slot] === id;
      let btn;
      if (worn) btn = `<button class="small secondary" data-wear="${slot}" data-value="">✓ Porté · retirer</button>`;
      else if (owned) btn = `<button class="small" data-wear="${slot}" data-value="${id}">Porter</button>`;
      else btn = `<button class="small gold" data-buy="${id}" ${c.gold < it.price ? 'disabled' : ''}>Acheter</button>`;
      return `<div class="shop-item ${owned ? 'owned' : ''} ${trying === id ? 'trying' : ''}" data-try="${id}">
        <canvas width="110" height="100" data-shopcv="${id}"></canvas>
        <div class="shop-name">${esc(it.label)}</div>
        <div class="shop-price">${owned ? '<span class="up">Possédé</span>' : `${it.price} 🪙`}</div>
        ${btn}
      </div>`;
    }).join('')}</div></div>`;
  }).join('');
  $('shop-list').querySelectorAll('canvas[data-shopcv]').forEach((cv) => {
    const id = cv.dataset.shopcv;
    drawFighter(cv.getContext('2d'), 55, 62, myFighter({ [Rules.COSMETICS[id].slot]: id }), { scale: 1.9 });
  });
  $('shop-list').querySelectorAll('[data-try]').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.closest('button')) return;
      trying = trying === el.dataset.try ? null : el.dataset.try;
      Sound.play('chestHit', 2);
      renderShop();
    };
  });
  $('shop-list').querySelectorAll('[data-buy]').forEach((b) => {
    b.onclick = async () => {
      const it = Rules.COSMETICS[b.dataset.buy];
      if (!confirm(`Acheter « ${it.label} » pour ${it.price} golds ?`)) return;
      const r = await act('/api/shop/buy', { id: b.dataset.buy }, 'buy');
      if (r) { trying = null; toast(`🛍️ ${it.label} acheté et porté !`); }
    };
  });
  $('shop-list').querySelectorAll('[data-wear]').forEach((b) => {
    b.onclick = () => act('/api/look', { part: b.dataset.wear, value: b.dataset.value || null }, 'equip');
  });
}

// ---------- Panoplies ----------
// « +2 Précision, +2 Critique » : le bonus d'une panoplie pour un nombre de points donné.
function setBonusText(set, points) {
  return set.stats.map((st) => `+${points} ${Rules.STAT_INFO[st].label}`).join(', ');
}

function renderSets() {
  const info = me.character.sets;
  const maxPieces = Rules.SET_TIERS[Rules.SET_TIERS.length - 1].pieces;
  $('sets-active').innerHTML = info.sets.map(({ key, pieces, tier, next }) => {
    const set = Rules.SETS[key];
    const pips = Rules.SET_TIERS.map((t) => `<span class="set-pip ${pieces >= t.pieces ? 'on' : ''}" title="${t.pieces} pièces : ${setBonusText(set, t.points)}">${t.pieces}</span>`).join('');
    return `<div class="set-chip ${tier ? '' : 'inactive'}" style="--c:${set.color}">
      <div class="set-head">${set.icon} <b>${esc(set.label)}</b><span class="muted">${pieces} / ${maxPieces} pièces</span></div>
      <div class="set-pips">${pips}</div>
      <div>Bonus actuel : ${tier ? `<b class="up">${setBonusText(set, tier.points)}</b>` : '<span class="muted">aucun (il faut 2 pièces)</span>'}</div>
      ${next ? `<div class="muted">À ${next.pieces} pièces : ${setBonusText(set, next.points)}</div>` : '<div class="muted">Palier maximum atteint !</div>'}
    </div>`;
  }).join('');
}

(function renderSetsHelp() {
  $('set-tiers').textContent = Rules.SET_TIERS.map((t) => `${t.pieces} pièces = +${t.points} points`).join(', ');
  $('sets-help').innerHTML = Object.values(Rules.SETS).map((set) => `<div style="--c:${set.color}">${set.icon} <b style="color:${set.color}">${esc(set.label)}</b>
    <span class="muted">· ${set.stats.map((st) => Rules.STAT_INFO[st].label).join(' et ')}</span>
    <ul class="set-tier-list">${Rules.SET_TIERS.map((t) => `<li><b>${t.pieces} pièces</b> : ${setBonusText(set, t.points)}</li>`).join('')}</ul></div>`).join('');
})();

// ---------- Succès ----------
let achFilter = 'next';
let knownDone = null; // succès déjà terminés (pour annoncer les nouveaux)

function renderAchievements() {
  const c = me.character;
  const list = Rules.ACHIEVEMENTS.map((a) => ({ a, st: Rules.achievementState(c, a) }));
  const done = list.filter((x) => x.st.done);
  const claimable = done.filter((x) => !x.st.claimed);

  // Annonce des succès qui viennent d'être terminés.
  const doneIds = new Set(done.map((x) => x.a.id));
  if (knownDone) {
    for (const x of done) {
      if (!knownDone.has(x.a.id)) {
        toast(`🏅 Succès débloqué : ${x.a.name} ! (+${x.a.gold} 🪙 à récupérer)`, 6000);
        Sound.play('levelUp');
      }
    }
  }
  knownDone = doneIds;

  $('ach-count').textContent = `${done.length} / ${list.length} terminés`;
  $('ach-summary').innerHTML = (claimable.length
    ? `<span class="c-legendaire">🏅 ${claimable.length} récompense${claimable.length > 1 ? 's' : ''} à récupérer</span>`
    : '<span class="muted">Aucune récompense en attente</span>')
    + `<span class="spacer"></span><span>Titre : <b class="char-title">${c.titleName ? '« ' + esc(c.titleName) + ' »' : 'aucun'}</b></span>`
    + (c.title ? ' <button class="secondary small" id="title-clear">Retirer le titre</button>' : '');
  if ($('title-clear')) $('title-clear').onclick = () => act('/api/title', { id: null }, 'unequip');

  const filters = [['next', 'À suivre'], ['claim', 'À récupérer'], ['progress', 'En cours'], ['done', 'Terminés'], ['all', 'Tous']];
  // « À suivre » : les récompenses à récupérer + le prochain palier non terminé de chaque série.
  const nextIds = new Set();
  const seen = new Set();
  for (const { a, st } of list) {
    if (st.done && !st.claimed) nextIds.add(a.id);
    if (!st.done && !seen.has(a.metric)) { seen.add(a.metric); nextIds.add(a.id); }
  }
  $('ach-filters').innerHTML = filters.map(([k, l]) => `<button class="${achFilter === k ? 'active' : ''}" data-af="${k}">${l}</button>`).join('');
  $('ach-filters').querySelectorAll('[data-af]').forEach((b) => { b.onclick = () => { achFilter = b.dataset.af; renderAchievements(); }; });

  const shown = list.filter(({ a, st }) => achFilter === 'all'
    || (achFilter === 'next' && nextIds.has(a.id))
    || (achFilter === 'claim' && st.done && !st.claimed)
    || (achFilter === 'progress' && !st.done)
    || (achFilter === 'done' && st.done))
    .sort((x, y) => (y.st.done && !y.st.claimed) - (x.st.done && !x.st.claimed));
  $('ach-grid').innerHTML = shown.map(({ a, st }) => {
    const pctDone = Math.round((st.value / a.goal) * 100);
    const actions = [];
    if (st.done && !st.claimed) actions.push(`<button class="small gold" data-claim="${a.id}">Récupérer ${a.gold} 🪙</button>`);
    if (st.claimed) actions.push(`<span class="up">✅ ${a.gold} 🪙 récupérés</span>`);
    if (st.done) {
      actions.push(c.title === a.id
        ? '<span class="tag">🏷️ Titre porté</span>'
        : `<button class="small secondary" data-title="${a.id}">🏷️ Porter le titre</button>`);
    }
    return `<div class="ach ${st.done ? 'done' : ''} ${st.done && !st.claimed ? 'claimable' : ''}">
      <div class="ach-name"><span>${st.done ? '🏅' : '🔒'} ${esc(a.name)}</span><span class="muted">${a.gold} 🪙</span></div>
      <div class="muted">${esc(a.desc)}</div>
      <div class="bar"><div style="width:${pctDone}%"></div></div>
      <div class="muted" style="font-size:12px">${st.value} / ${a.goal}</div>
      ${actions.length ? `<div class="row">${actions.join('')}</div>` : ''}
    </div>`;
  }).join('') || '<span class="muted">Aucun succès dans cette catégorie.</span>';
  $('ach-grid').querySelectorAll('[data-claim]').forEach((b) => {
    b.onclick = async () => {
      const r = await act('/api/achievements/claim', { id: b.dataset.claim }, 'buy');
      if (r) toast(`🏅 +${r.gold} 🪙 récupérés !`);
    };
  });
  $('ach-grid').querySelectorAll('[data-title]').forEach((b) => {
    b.onclick = async () => {
      const r = await act('/api/title', { id: b.dataset.title }, 'equip');
      if (r) toast(`🏷️ Nouveau titre : « ${Rules.achievementById(b.dataset.title).name} »`);
    };
  });
}

// ---------- Classements ----------
async function loadLeaderboard(data) {
  try {
    renderLeaderboard($('leaderboard'), data || await api('/api/leaderboard'), me && me.id);
  } catch (e) { /* ignore */ }
}

// ---------- Recyclage de masse ----------
const PLURAL = { commun: 'Communs', peu_commun: 'Peu communs', rare: 'Rares', epique: 'Épiques', legendaire: 'Légendaires' };

function renderRecycleBar(visible) {
  const bar = $('recycle-bar');
  $('recycle-toggle').textContent = recycleMode ? '✖ Quitter le recyclage' : '♻️ Recycler';
  if (!recycleMode) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  const n = selected.size;
  const quick = Rules.RARITIES
    .filter((r) => visible.some((i) => i.rarity === r))
    .map((r) => `<button class="secondary" data-select="${r}">Tous les <span class="c-${r}">${PLURAL[r]}</span></button>`)
    .join('');
  bar.innerHTML = `
    <div><b>♻️ Mode recyclage</b> <span class="muted">— clique sur les objets à recycler. Chaque objet rapporte
      ${Rules.RECYCLE_GOLD} 🪙, quelle que soit sa rareté. Les objets équipés ne sont jamais recyclés.</span></div>
    <div class="row">
      <button class="secondary" data-select="all">Tout sélectionner</button>${quick}
      <button class="secondary" data-select="none">Tout désélectionner</button>
      <span class="spacer"></span>
      <button class="gold" id="recycle-go" ${n ? '' : 'disabled'}>Recycler ${n} objet${n > 1 ? 's' : ''} (+${n * Rules.RECYCLE_GOLD} 🪙)</button>
    </div>`;
  bar.querySelectorAll('[data-select]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.select;
      if (k === 'none') selected.clear();
      else visible.filter((i) => (k === 'all' || i.rarity === k) && !isProtected(i.id)).forEach((i) => selected.add(i.id));
      renderInventory();
    };
  });
  $('recycle-go').onclick = recycleSelected;
}

async function recycleSelected() {
  const items = me.character.inventory.filter((i) => selected.has(i.id));
  const precious = items.filter((i) => i.rarity === 'epique' || i.rarity === 'legendaire').length;
  if (precious && !confirm(`Attention : ta sélection contient ${precious} objet(s) Épique ou Légendaire. Les recycler quand même ?`)) return;
  document.querySelectorAll('#inventory .item.selected').forEach((el) => el.classList.add('recycled'));
  Sound.play('recycle', items.length);
  await new Promise((r) => setTimeout(r, 400));
  const r = await act('/api/recycle', { itemIds: [...selected] });
  if (r) {
    toast(`♻️ ${r.recycled} objet(s) recyclé(s) : +${r.gold} 🪙`);
    selected.clear();
    recycleMode = false;
    renderInventory();
  }
}

$('recycle-toggle').onclick = () => {
  recycleMode = !recycleMode;
  selected.clear();
  renderInventory();
};

function renderTwitch() {
  const el = $('twitch-content');
  if (me.twitchLogin) {
    el.innerHTML = `<p>Lié à <b style="color:#b98cff">${esc(me.twitchDisplayName || me.twitchLogin)}</b> ✅</p>
      <p class="muted">Tape <b>!join</b> dans le chat de <a href="https://www.twitch.tv/${config ? config.twitch.channel : 'zer0loot'}" target="_blank" rel="noopener">twitch.tv/${config ? config.twitch.channel : 'zer0loot'}</a> quand la file est ouverte.</p>
      <button class="secondary small" id="unlink">Délier</button>`;
    $('unlink').onclick = () => act('/api/twitch/unlink', {});
    return;
  }
  let html = '<p class="muted">Lie ton compte Twitch pour que ton <b>!join</b> dans le chat fasse combattre ce personnage. Si tu as déjà joué sans compte, ton loot sera récupéré.</p>';
  if (config && config.twitch.oauth) html += '<a class="btn twitch" href="/auth/twitch">Se connecter avec Twitch</a>';
  if (config && !config.twitch.oauth && !config.devLink) {
    html += '<p class="muted">⏳ La connexion Twitch n\'est pas encore activée sur le serveur. En attendant, ton <b>!join</b> fonctionne quand même : tu récupéreras ton loot dès que tu lieras ton compte.</p>';
  }
  if (config && config.devLink) {
    html += `<div class="row" style="margin-top:10px"><input id="dev-login" placeholder="Ton pseudo Twitch" style="flex:1">
      <button class="twitch" id="dev-link">Lier</button></div>
      <p class="muted" style="font-size:12px">Mode test : l'OAuth Twitch n'est pas configuré sur le serveur, la liaison se fait par pseudo.</p>`;
  }
  el.innerHTML = html;
  if ($('dev-link')) $('dev-link').onclick = () => act('/api/twitch/link-dev', { login: $('dev-login').value });
}

// ---------- Paris ----------
let lastBetResult = null; // résultat de mon pari pour la dernière bataille

function betAmount() {
  return Math.max(1, Math.floor(Number($('bet-amount').value) || 0));
}

// Gain estimé (en plus de la mise) si je mise `amount` sur `key`, avec les paris actuels.
function estimateGain(key, amount) {
  const s = queue.bets;
  const mine = me.bet;
  const poolOthers = s.pool - (mine ? mine.amount : 0);
  const onTarget = (s.targets[key] ? s.targets[key].total : 0) - (mine && mine.target === key ? mine.amount : 0);
  const lost = poolOthers - onTarget;
  return Math.floor((lost * amount) / (onTarget + amount));
}

function renderBets() {
  const box = $('bet-box');
  if (queue && ['idle', 'queue', 'ready'].includes(queue.phase)) lastBetResult = null; // nouvelle bataille
  // Pas de paris dans les modes coopératifs (Combat de Boss, Raid de Donjon).
  const coop = queue && queue.mode && Rules.GAME_MODES[queue.mode] && Rules.GAME_MODES[queue.mode].coop;
  if (!queue || !queue.bets || coop || queue.phase === 'idle' || (queue.phase === 'ended' && !queue.bets.lastResult && !lastBetResult)) {
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  const s = queue.bets;
  const open = s.open;
  const mine = me.bet;
  $('bet-controls').style.display = open ? '' : 'none';
  $('bet-status').textContent = open ? 'Ouverts jusqu\'au lancement du combat' : queue.phase === 'battle' ? '🔒 Fermés : combat en cours' : 'Bataille terminée';

  let summary = `<div class="bet-summary"><span class="bet-pot">💰 ${s.pool} 🪙</span><span class="muted">misés par ${s.bettors} parieur${s.bettors > 1 ? 's' : ''}</span>`;
  if (mine) summary += `<span>Ton pari : <b class="c-legendaire">${mine.amount} 🪙</b> sur <b>${esc(mine.targetName)}</b></span>`;
  summary += '</div>';
  if (queue.phase === 'ended') {
    const r = s.lastResult;
    if (r) {
      summary = r.refund
        ? `<div class="bet-result refund">↩️ Personne n'avait parié sur ${esc(r.winnerName || 'le gagnant')} : les ${r.pool} 🪙 misés ont été remboursés.</div>`
        : `<div class="bet-result won">🏆 ${esc(r.winnerName)} gagne ! ${r.winners > 1 ? r.winners + ' parieurs se partagent' : '1 parieur remporte'} ${r.distributed} 🪙 de mises perdues.</div>`;
    } else summary = '';
    if (lastBetResult) {
      const b = lastBetResult;
      const text = b.outcome === 'won' ? `💰 Ton pari sur ${esc(b.targetName)} est gagnant : +${b.payout} 🪙 (mise ${b.amount} + gain ${b.payout - b.amount}).`
        : b.outcome === 'lost' ? `💸 Ton pari sur ${esc(b.targetName)} est perdu (−${b.amount} 🪙).`
          : `↩️ Ton pari de ${b.amount} 🪙 t'a été remboursé.`;
      summary += `<div class="bet-result ${b.outcome}">${text}</div>`;
    }
  }
  $('bet-summary').innerHTML = summary;
  renderBetList();
}

function renderBetList() {
  const s = queue.bets;
  const mine = me.bet;
  const open = s.open;
  if (queue.phase === 'ended') { $('bet-list').innerHTML = ''; return; }
  if (!queue.participants.length) { $('bet-list').innerHTML = '<div class="muted">En attente des combattants… (ils s\'inscrivent avec !join)</div>'; return; }
  const amount = betAmount();
  $('bet-list').innerHTML = queue.participants.map((p) => {
    const t = s.targets[p.key] || { total: 0, bettors: 0 };
    const self = p.key === 'u' + me.id;
    const isMine = mine && mine.target === p.key;
    let action = '';
    if (open) {
      if (self) action = '<span class="muted">C\'est toi</span>';
      else if (isMine) action = `<button class="small gold" data-bet="${p.key}">Miser ${amount} 🪙 à la place</button><button class="small secondary" data-cancel="1">Annuler</button>`;
      else action = `<button class="small gold" data-bet="${p.key}">Parier ${amount} 🪙</button>`;
    }
    const gain = !self && (open || isMine) ? `<span class="bet-gain">Si victoire : +${estimateGain(p.key, isMine ? mine.amount : amount)} 🪙${isMine ? '' : ' (estimation)'}</span>` : '';
    return `<div class="bet-row ${isMine ? 'mine' : ''} ${self ? 'self' : ''}">
      <div class="bet-name"><span>${p.bot ? '🤖' : ''}${p.cls ? Rules.CLASS_INFO[p.cls].icon : '⚔️'} ${esc(p.name)}</span><span class="muted">Niv. ${p.level}</span></div>
      <div class="muted">${t.total} 🪙 misés · ${t.bettors} parieur${t.bettors > 1 ? 's' : ''}${isMine ? ` · <b class="c-legendaire">ton pari : ${mine.amount} 🪙</b>` : ''}</div>
      ${gain}
      ${action ? `<div class="row">${action}</div>` : ''}
    </div>`;
  }).join('');
  $('bet-list').querySelectorAll('[data-bet]').forEach((b) => {
    b.onclick = async () => {
      const r = await act('/api/bet', { target: b.dataset.bet, amount: betAmount() }, 'bet');
      if (r) toast(`🎲 Pari enregistré : ${r.bet.amount} 🪙 sur ${r.bet.targetName}`);
    };
  });
  $('bet-list').querySelectorAll('[data-cancel]').forEach((b) => {
    b.onclick = () => act('/api/bet/cancel', {}, 'unequip');
  });
}

$('bet-amount').addEventListener('input', () => { if (queue && queue.bets) renderBetList(); });
document.querySelectorAll('[data-quick]').forEach((b) => {
  b.onclick = () => {
    const budget = me.character.gold + (me.bet ? me.bet.amount : 0);
    const q = b.dataset.quick;
    const v = q === 'max' ? budget : q === 'half' ? Math.floor(budget / 2) : Number(q);
    $('bet-amount').value = Math.max(1, Math.min(v, Math.max(1, budget)));
    renderBetList();
  };
});


function renderQueue() {
  const box = $('queue-box');
  if (!queue || queue.phase === 'idle') { box.style.display = 'none'; return; }
  box.style.display = '';
  const inQueue = queue.participants.some((p) => p.key === 'u' + me.id);
  const n = queue.participants.length;
  if (queue.phase === 'queue') {
    box.innerHTML = `<div class="row"><b style="font-size:18px">⚔️ La file est ouverte !</b>
      <span class="countdown" id="cd"></span><span class="muted">${n} combattant(s) inscrit(s)</span><span class="spacer"></span>
      ${inQueue ? '<b class="up">✅ Tu es inscrit !</b>' : '<span class="muted">Tape <b>!join</b> sur le stream ou</span> <button id="join">Rejoindre</button>'}</div>`;
    if ($('join')) $('join').onclick = () => act('/api/queue/join', {}, 'join');
    tickCountdown();
  } else if (queue.phase === 'ready') {
    box.innerHTML = `<b>⏳ File fermée — ${n} combattant(s). Le streamer va lancer la bataille !</b> ${inQueue ? '<span class="up">Tu en fais partie.</span>' : ''}`;
  } else if (queue.phase === 'battle') {
    const ev = queue.event && Rules.BATTLE_EVENTS[queue.event];
    const QB = Rules.BOSSES[queue.boss];
    const what = queue.mode === 'koth' ? '👑 Roi de la Colline en cours !' : queue.mode === 'boss' ? `${QB ? QB.icon : '👹'} Combat contre ${QB ? QB.name : 'le boss'} en cours !` : queue.mode === 'dungeon' ? '🏰 Raid de Donjon en cours !' : '🔥 Bataille en cours !';
    box.innerHTML = `<b>${what}</b> ${ev ? `<span class="tag" style="color:${ev.color}">${ev.icon} ${ev.label}</span>` : ''} <a href="/arena.html" target="_blank">Regarder l'arène</a> ${inQueue ? '<span class="up">Ton perso se bat !</span>' : ''}`;
    if (queue.poll) renderPollVote(box);
  } else if (queue.phase === 'ended' && queue.result) {
    const r = queue.result;
    let text;
    if (r.mode === 'boss') text = r.victory ? `🏆 ${r.boss.name} est vaincu ! Tous les participants sont récompensés.` : `💀 ${r.boss.name} a gagné… Retentez votre chance !`;
    else if (r.mode === 'dungeon') text = `🏰 Le raid s'est arrêté en salle ${r.room}${r.reward ? ' : récompense pour tous les participants !' : '.'}`;
    else if (r.mode === 'koth') text = r.winner ? `👑 ${esc(r.winner.name)} est le Roi de la Colline (${r.winner.score} points, ${r.winner.kills} kill(s)) !` : 'Partie terminée.';
    else text = r.winner ? `🏆 ${esc(r.winner.name)} remporte la bataille (${r.winner.kills} kill(s)) !` : 'Bataille terminée.';
    box.innerHTML = `<b>${text}</b>`;
  }
  // Mode de jeu de la file en cours
  const m = Rules.GAME_MODES[queue.mode];
  if (m && queue.phase !== 'ended') box.insertAdjacentHTML('afterbegin', `<span class="mode-tag" style="--c:${m.color};margin-right:8px" title="${esc(m.desc)}">${m.icon} ${m.label}</span>`);
}

// Sondage du donjon : tout le monde vote (une voix par personne, le dernier vote compte).
let pollVote = null; // { room, choice } : mon vote dans le sondage en cours
function renderPollVote(box) {
  const poll = queue.poll;
  const mine = pollVote && pollVote.room === poll.room ? pollVote.choice : null;
  const total = poll.options.reduce((a, o) => a + o.votes, 0);
  box.insertAdjacentHTML('beforeend', `<div class="poll-vote">
    <div class="row"><b>🗳️ Sondage du donjon : le chat choisit un bonus pour les aventuriers !</b><span class="countdown" id="poll-cd"></span></div>
    <div class="poll-options">${poll.options.map((o, i) => {
      const b = Rules.DUNGEON_BOONS[o.id];
      const share = total ? Math.round((o.votes / total) * 100) : 0;
      return `<button class="poll-option ${mine === o.id ? 'mine' : ''}" data-vote="${o.id}" style="--c:${b.color}">
        <span class="poll-ico">${b.icon}</span><span class="poll-body"><b>${b.label}</b><span>${b.desc}</span>
        <small>Chat : <code>${b.cmd}</code> ou <code>!${i + 1}</code> · ${o.votes} voix (${share} %)${mine === o.id ? ' · ✅ ton vote' : ''}</small></span>
        <span class="poll-bar" style="width:${share}%"></span></button>`;
    }).join('')}</div></div>`);
  box.querySelectorAll('[data-vote]').forEach((btn) => {
    btn.onclick = async () => {
      const r = await act('/api/poll/vote', { choice: btn.dataset.vote }, 'equip');
      if (r) { pollVote = { room: poll.room, choice: r.choice }; renderQueue(); }
    };
  });
  tickCountdown();
}

function tickCountdown() {
  const el = $('cd');
  if (el && queue && queue.queueEndsAt) el.textContent = formatCountdown(queue.queueEndsAt - Date.now());
  const pc = $('poll-cd');
  if (pc && queue && queue.poll) pc.textContent = formatCountdown(queue.poll.endsAt - Date.now());
}
setInterval(tickCountdown, 250);

function renderLoot() {
  const myLuck = me.character.derived.luck;
  const luck = simLuck == null ? myLuck : simLuck;
  const table = Rules.lootTable(luck);
  $('luck-sim').value = Math.min(85, luck);
  $('luck-sim-val').textContent = luck;
  const stats = me.character.lootStats || {};
  const drawn = Rules.RARITIES.reduce((s, r) => s + (stats[r] || 0), 0);
  const mine = (r) => (drawn ? `${stats[r] || 0} <span class="muted">(${(((stats[r] || 0) / drawn) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %)</span>` : '—');
  $('loot-table').innerHTML = `<table class="loot-table">
    <tr><th>Rareté</th><th>Probabilité ${simLuck == null ? '(ta chance : ' + myLuck + ')' : '(simulation)'}</th><th></th><th>Lignes</th><th>Bonus par ligne</th><th>Clics pour ouvrir</th><th title="Objets réellement obtenus dans tes coffres">Tes tirages (${drawn})</th></tr>
    ${Rules.RARITIES.map((r) => {
      const info = Rules.RARITY_INFO[r];
      return `<tr><td class="c-${r}" style="font-weight:800">${info.label}</td>
        <td><b>${table[r].toLocaleString('fr-FR')} %</b></td>
        <td style="width:30%"><div class="loot-bar"><div style="width:${table[r]}%;background:${RARITY_COLORS[r]}"></div></div></td>
        <td>${info.lines}</td><td>+${info.min} à +${info.max} %</td><td>${info.clicks}</td><td>${mine(r)}</td></tr>`;
    }).join('')}
  </table>`;
}

$('luck-sim').oninput = (e) => { simLuck = Number(e.target.value); renderLoot(); };
$('luck-reset').onclick = () => { simLuck = null; renderLoot(); };

// Appelle l'API ; si l'action réussit, joue le son indiqué.
async function act(url, body, sound) {
  try {
    const r = await api(url, body);
    if (sound) Sound.play(sound);
    await refresh();
    return r;
  } catch (err) {
    toast('⚠️ ' + err.message);
    return null;
  }
}

$('buy-1').onclick = () => act('/api/chest/buy', { count: 1 }, 'buy');
$('buy-10').onclick = () => act('/api/chest/buy', { count: 10 }, 'buy');
$('open-chest').onclick = openChest;

async function openChest() {
  let result;
  opening = true; // évite d'afficher le loot derrière l'animation
  try {
    result = await api('/api/chest/open', {});
    me = await api('/api/me');
  } catch (err) {
    opening = false;
    toast('⚠️ ' + err.message);
    return;
  }
  Sound.play('chestAppear');
  opener.show(result, {
    remaining: me.character.chests,
    onNext: openChest,
    onClose: () => { opening = false; render(); },
  });
}

// Aperçu animé du personnage.
// Aperçus animés du personnage (fiche, apparence, boutique avec essayage).
function myFighter(appOverride) {
  const look = {};
  for (const [slot, item] of Object.entries(me.character.equipment)) if (item) look[slot] = item.rarity;
  return { name: me.twitchDisplayName || me.username, cls: me.character.cls, look, app: { ...me.character.look, ...appOverride } };
}

(function animatePreviews() {
  const views = [
    { canvas: $('avatar'), x: 100, y: 118, scale: 3.4 },
    { canvas: $('app-preview'), x: 110, y: 135, scale: 3.6 },
    { canvas: $('shop-preview'), x: 120, y: 145, scale: 3.8, shop: true },
  ];
  function frame(t) {
    for (const v of views) {
      if (!v.canvas.offsetParent) continue; // onglet masqué
      const ctx = v.canvas.getContext('2d');
      ctx.clearRect(0, 0, v.canvas.width, v.canvas.height);
      if (!me) continue;
      const f = myFighter(v.shop && trying ? { [Rules.COSMETICS[trying].slot]: trying } : {});
      drawFighter(ctx, v.x, v.y, f, { scale: v.scale, bob: Math.sin(t / 400) * 3, swing: (Math.sin(t / 700) + 1) * 0.15 });
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

// Temps réel
const socket = io();
socket.on('me', (m) => { me = m; render(); });
socket.on('queue', (q) => { queue = q; if (me) { renderQueue(); renderBets(); } });
const REWARD_LABELS = {
  win: '🏆 VICTOIRE !', kill: '⚔️ Kill !', participation: '🎖️ Participation à la bataille',
  firstblood: '🩸 PREMIER KILL !', double: '⚡ DOUBLE KILL !', massacre: '💀 MASSACRE !',
  sub: '💜 Merci pour ton abonnement !', gift: '🎁 Cadeau du streamer !',
  boss: '👹 BOSS VAINCU !', dungeon: '🏰 Récompense du raid :', poll: '🗳️ Bonus voté par le chat :',
};
const REWARD_SOUNDS = {
  win: 'victory', kill: 'reward', participation: 'levelUp', firstblood: 'reward', double: 'reward', massacre: 'reward', sub: 'victory', gift: 'reward',
  boss: 'victory', dungeon: 'victory', poll: 'reward',
};
socket.on('leaderboard', (data) => loadLeaderboard(data));
socket.on('trainingQueue', (q) => {
  ensureTrainingView();
  trainingBus.emit('queue', q);
  const running = q.phase === 'battle';
  $('training-stop').disabled = !running;
  if (q.phase === 'ended' && q.result && q.result.winner) {
    const won = q.result.winner.key === 'u' + me.id;
    $('training-status').innerHTML = won ? '🏆 <b class="up">Victoire !</b> Relance quand tu veux.' : `💀 <b class="down">${esc(q.result.winner.name)} gagne.</b> Ajuste ton build et retente !`;
  } else if (q.phase === 'idle') {
    $('training-status').textContent = 'Duel arrêté.';
  }
});
socket.on('trainingFrame', (f) => trainingBus.emit('frame', f));
socket.on('banned', () => { alert('Ton compte a été banni.'); location.href = '/'; });
socket.on('bet', (r) => {
  lastBetResult = r;
  if (r.outcome === 'won') { Sound.play('reward'); toast(`💰 Pari gagné sur ${r.targetName} ! +${r.payout} 🪙`, 6000); }
  else if (r.outcome === 'lost') { Sound.play('betLost'); toast(`💸 Pari perdu sur ${r.targetName} (−${r.amount} 🪙)`, 6000); }
  else toast(`↩️ Pari remboursé : +${r.amount} 🪙`, 5000);
  renderBets();
});

socket.on('reward', (r) => {
  Sound.play(REWARD_SOUNDS[r.type]);
  const gains = [`+${r.reward.xp} XP`];
  if (r.reward.gold) gains.push(`+${r.reward.gold} 🪙`);
  if (r.reward.chests) gains.push(`+${r.reward.chests} coffre${r.reward.chests > 1 ? 's' : ''}`);
  const label = r.type === 'dungeon' ? `🏰 Raid : salle ${r.room} atteinte !` : REWARD_LABELS[r.type];
  toast(`${label} ${gains.join(', ')}`, 5000);
  if (r.levels) toast(`✨ Niveau supérieur ! +${r.levels} point(s) de compétence`, 5000);
});

(async function init() {
  try {
    config = await api('/api/config');
    await refresh();
  } catch (err) {
    location.href = '/';
    return;
  }
  loadLeaderboard();
  const params = new URLSearchParams(location.search);
  if (params.get('twitch') === 'ok') toast('✅ Compte Twitch lié !');
  if (params.get('twitch') === 'error') toast('⚠️ Liaison Twitch échouée' + (params.get('msg') ? ' : ' + params.get('msg') : ''));
  if (params.has('twitch')) history.replaceState(null, '', '/character.html');
})();
