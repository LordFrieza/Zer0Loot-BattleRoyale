/* Page personnage. */
const $ = (id) => document.getElementById(id);
let me = null;
let queue = null;
let config = null;
let invFilter = 'all';
let invStat = 'all'; // filtre par stat : seulement les objets qui ont cette ligne (triés par sa valeur)
let invSet = 'all'; // filtre par panoplie ('none' : objets hors panoplie)
let invRarity = 'all'; // filtre par rareté
const seenIds = new Set(); // déjà vus pendant cette visite (même si la fiche revient du serveur avant l'envoi)
const isFresh = (item) => (item.isNew && !seenIds.has(item.id) ? 1 : 0);
let recycleMode = false;
const selected = new Set();
let simLuck = null;
const opener = new ChestOpener();
const forge = new ForgeAnimator();
const alchemist = new AlchemyAnimator();
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
  $('gold-chip').textContent = `🪙 ${c.gold.toLocaleString('fr-FR')}`;
  $('emerald-chip').innerHTML = `<i class="ico-emerald"></i> ${(c.emeralds || 0).toLocaleString('fr-FR')}`;
  $('ticket-chip').style.display = c.casinoTickets > 0 ? '' : 'none';
  $('ticket-chip').textContent = `🎟️ ${c.casinoTickets || 0}`;
  $('char-name').textContent = me.twitchDisplayName || me.username;
  window.ZL_CLASS = c.cls; // pour l'affichage des objets réservés dans les animations
  // Casino : ouvert au chargement de la page (onglet mémorisé) dès que le personnage est connu
  if (document.querySelector('.tab.active[data-tab="casino"]')) { if (!Casino.active) Casino.enter(); else Casino.renderStats(); }
  if (document.querySelector('.tab.active[data-tab="survivor"]')) { if (!Survivor.active) Survivor.enter(); else Survivor.refreshLobby(); }
  if (document.querySelector('.tab.active[data-tab="maison"]')) { if (!Housing.active) Housing.enter(); else Housing.refresh(); }
  if (document.querySelector('.tab.active[data-tab="peche"]')) { if (!Fishing.active) Fishing.enter(); else Fishing.renderSide(); }
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
  $('record').innerHTML = `${c.record.battles} bataille(s) · ${c.record.kills} kill(s) · ${c.record.wins} victoire(s)<br>
    <span class="power-line" title="Niveau + total des % de ton équipement ÷ 10. Sert à équilibrer les récompenses des modes PvP (onglet Règles).">💪 Puissance : <b>${String(c.power).replace('.', ',')}</b></span>`;
  $('open-chest').disabled = c.chests <= 0;
  $('buy-1').disabled = c.gold < Rules.CHEST_PRICE;
  $('buy-10').disabled = c.gold < Rules.CHEST_PRICE * 10;
  renderStats();
  renderEquipment();
  renderInventory();
  renderTwitch();
  renderSecurity();
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
  renderCombatStyle();
  renderSolo();
  renderPets();
  renderHistory();
  renderLifetime();
  renderMail();
  if (marketOrders) renderMarket();
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

// Répartition des points en cours (null : pas de modification en attente). Les boutons + et − préparent
// un brouillon : on voit l'effet de chaque point (valeur avant → après) puis on valide d'un coup.
let statDraft = null;

// Bulle « ? » d'une caractéristique : détail, effet d'un point et plafond (avec l'équipement et la classe).
function statHelpHtml(s, ctx) {
  const info = Rules.STAT_INFO[s];
  const det = Rules.STAT_DETAILS[s];
  const own = ctx.points[s] - ctx.extra[s];
  const lines = [`<div class="sp-title">${info.icon} ${info.label}</div>`, `<p>${info.desc}</p>`,
    `<div class="sp-line"><span>Par point</span><b>${det.per}</b></div>`,
    `<div class="sp-line"><span>Valeur actuelle</span><b>${Rules.describeDerived(s, ctx.values)}</b></div>`];
  if (!det.key) {
    lines.push(`<div class="sp-line"><span>Plafond</span><b>aucun</b></div>`);
  } else {
    lines.push(`<div class="sp-line"><span>Plafond</span><b>${det.cap}</b></div>`);
    const at = ctx.capAt[s];
    if (at === null) {
      lines.push('<p class="down">Avec ton équipement et ta classe, cette stat ne peut pas atteindre son plafond.</p>');
    } else {
      const ownAt = Math.max(0, at - ctx.extra[s]);
      const bonus = ctx.extra[s] ? ` (+${ctx.extra[s]} de panoplie / arbre)` : '';
      lines.push(`<div class="sp-line"><span>Plafond atteint à</span><b>${ownAt} point(s)${bonus}</b></div>`);
      if (ctx.points[s] >= at) {
        const waste = ctx.points[s] - at;
        lines.push(`<p class="sp-max">✅ Plafond atteint : un point de plus ne changerait rien.</p>`);
        if (waste > 0 && own > 0) lines.push(`<p class="down">⚠️ ${Math.min(waste, own)} point(s) placé(s) au-delà du plafond ne servent à rien : retire-les avec − pour les mettre ailleurs.</p>`);
      } else {
        lines.push(`<p class="up">Encore <b>${at - ctx.points[s]}</b> point(s) utile(s) avant le plafond.</p>`);
      }
      lines.push('<p class="muted sp-small">Le plafond dépend de tes bonus d\'équipement et de classe : il peut changer quand tu changes d\'objets.</p>');
    }
  }
  if (det.note) lines.push(`<p class="muted sp-small">${det.note}</p>`);
  return lines.join('');
}

let statPop = null;
function showStatPop(btn, html, pinned) {
  if (!statPop) {
    statPop = document.createElement('div');
    statPop.className = 'stat-pop';
    document.body.appendChild(statPop);
    document.addEventListener('click', (e) => {
      if (statPop.pinned && !statPop.contains(e.target) && !e.target.closest('[data-help]')) hideStatPop(true);
    });
    window.addEventListener('scroll', () => hideStatPop(true), { passive: true });
  }
  statPop.innerHTML = html;
  statPop.pinned = !!pinned;
  statPop.style.display = 'block';
  const r = btn.getBoundingClientRect();
  const w = statPop.offsetWidth;
  const h = statPop.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const top = r.bottom + 8 + h > window.innerHeight ? Math.max(8, r.top - h - 8) : r.bottom + 8;
  statPop.style.left = left + 'px';
  statPop.style.top = top + 'px';
}
function hideStatPop(force) {
  if (statPop && (force || !statPop.pinned)) { statPop.style.display = 'none'; statPop.pinned = false; }
}

function renderStats() {
  hideStatPop(true);
  const c = me.character;
  const placed = Rules.STATS.reduce((sum, s) => sum + (c.stats[s] || 0), 0);
  const total = placed + c.skillPoints;
  const draft = statDraft;
  const used = draft ? Rules.STATS.reduce((sum, s) => sum + draft[s], 0) : placed;
  const free = total - used;
  // Points totaux par stat (compétences + panoplies + arbre), même calcul que le serveur
  const setPts = Rules.setBonus(c.equipment).points;
  const talentPts = Rules.talentBonus(c.cls, c.talents, c.talentExtra);
  const extra = Object.fromEntries(Rules.STATS.map((st) => [st, (setPts[st] || 0) + (talentPts[st] || 0)]));
  const own = (st) => (draft ? draft[st] : c.stats[st] || 0);
  const points = Object.fromEntries(Rules.STATS.map((st) => [st, own(st) + extra[st]]));
  // Valeurs en direct avec la répartition en cours
  const after = draft ? Rules.derive(points, c.gear, c.cls) : null;
  const capAt = Object.fromEntries(Rules.STATS.map((st) => [st, Rules.statCapAt(st, points, c.gear, c.cls)]));
  const ctx = { points, extra, capAt, values: after || c.derived };
  const valueCell = (s) => {
    const now = Rules.describeDerived(s, c.derived);
    if (!after) return now;
    const next = Rules.describeDerived(s, after);
    const overCap = capAt[s] !== null && draft[s] > c.stats[s] && (c.stats[s] || 0) + extra[s] >= capAt[s];
    if (next === now || overCap) return draft[s] !== c.stats[s] ? `${now}<span class="stat-after down">aucun effet (plafond)</span>` : now;
    const better = draft[s] >= c.stats[s]; // plus de points dans une stat = meilleure valeur
    return `<span class="stat-before">${now}</span><span class="stat-after ${better ? 'up' : 'down'}">→ ${next}</span>`;
  };
  $('skill-banner').innerHTML = free > 0
    ? `<div class="skill-banner">✨ ${free} point(s) de compétence à répartir !</div>`
    : '';
  $('stats').innerHTML = Rules.STATS.map((s) => {
    const info = Rules.STAT_INFO[s];
    const gear = c.gear[s];
    const pts = own(s);
    const diff = draft ? draft[s] - c.stats[s] : 0;
    const at = capAt[s];
    const capped = at !== null && points[s] >= at;
    const waste = capped ? Math.min(pts, points[s] - at) : 0;
    const badge = at === null ? ''
      : waste > 0 ? `<span class="cap-badge waste" title="${waste} point(s) au-delà du plafond : ils ne servent à rien">MAX · ${waste} inutile${waste > 1 ? 's' : ''}</span>`
        : capped ? '<span class="cap-badge" title="Plafond atteint">MAX</span>'
          : `<span class="cap-left" title="Points utiles avant le plafond">plafond dans ${at - points[s]} pt${at - points[s] > 1 ? 's' : ''}</span>`;
    return `<tr class="${diff ? 'stat-changed' : ''}">
      <td class="stat-name">${info.icon} ${info.label} <button class="stat-help-btn" data-help="${s}" aria-label="Détail de ${info.label}">?</button>${badge ? `<div>${badge}</div>` : ''}</td>
      <td class="stat-desc help">${info.desc}</td>
      <td class="stat-pts">${pts}${diff ? ` <small class="${diff > 0 ? 'up' : 'down'}">(${diff > 0 ? '+' : ''}${diff})</small>` : ''}</td>
      <td class="stat-gear">${gear ? '+' + gear + Rules.statUnit(s) + ' équip.' : ''}${classMod(s)}${setMod(s)}${talentMod(s)}</td>
      <td class="stat-value">${valueCell(s)}</td>
      <td class="stat-btns">
        <button class="minus" data-minus="${s}" title="Retirer un point (pour le replacer ailleurs)" ${pts > 0 ? '' : 'disabled'}>−</button>
        <button class="plus ${capped ? 'capped' : ''}" data-stat="${s}" title="${capped ? 'Plafond atteint : ce point ne servirait à rien' : 'Ajouter un point (tu valides ensuite)'}" ${free > 0 ? '' : 'disabled'}>+</button>
      </td>
    </tr>`;
  }).join('');
  const startDraft = () => { if (!statDraft) statDraft = Object.fromEntries(Rules.STATS.map((st) => [st, c.stats[st] || 0])); };
  $('stats').querySelectorAll('[data-stat]').forEach((b) => {
    b.onclick = () => {
      startDraft();
      statDraft[b.dataset.stat] += 1;
      Sound.play('chestHit', 1);
      renderStats();
    };
  });
  $('stats').querySelectorAll('[data-minus]').forEach((b) => {
    b.onclick = () => {
      startDraft();
      statDraft[b.dataset.minus] -= 1;
      Sound.play('chestHit', 1);
      renderStats();
    };
  });
  $('stats').querySelectorAll('[data-help]').forEach((b) => {
    const html = () => statHelpHtml(b.dataset.help, ctx);
    b.onmouseenter = () => { if (!statPop || !statPop.pinned) showStatPop(b, html(), false); };
    b.onmouseleave = () => hideStatPop(false);
    b.onclick = (e) => {
      e.stopPropagation();
      if (statPop && statPop.pinned && statPop.dataset.stat === b.dataset.help) { hideStatPop(true); return; }
      showStatPop(b, html(), true);
      statPop.dataset.stat = b.dataset.help;
    };
  });
  // Validation : placer des points libres est gratuit ; 50 golds par point retiré, 500 golds au plus.
  if (!draft) {
    $('stats-reset').innerHTML = `<span class="muted">Clique sur <b>+</b> ou <b>−</b> : tu vois ce que ça change avant de valider
      (placer un point libre est gratuit ; ${Rules.STAT_RESET.perPoint} golds par point retiré, ${Rules.STAT_RESET.max} golds au plus).
      La bulle <b>?</b> donne le détail et le plafond de chaque caractéristique.</span>`;
    return;
  }
  const moved = Rules.statPointsMoved(c.stats, draft);
  const price = Rules.statResetPrice(moved);
  const added = used - placed + moved;
  const changed = moved > 0 || used !== placed;
  const wasted = Rules.STATS.reduce((sum, st) => sum + (capAt[st] !== null && points[st] > capAt[st] && draft[st] > c.stats[st] ? Math.min(draft[st] - c.stats[st], points[st] - capAt[st]) : 0), 0);
  $('stats-reset').innerHTML = `<div class="respec-bar">
      <span>${moved ? `🔁 <b>${moved}</b> point(s) déplacé(s)` : `✨ <b>${Math.max(0, added)}</b> point(s) placé(s)`}${free > 0 ? ` · <b>${free}</b> à placer` : ''} · coût : <b>${price ? price + ' 🪙' : 'gratuit'}</b></span>
      <button class="gold small" id="respec-ok" ${!changed || c.gold < price ? 'disabled' : ''}>✔ Valider</button>
      <button class="secondary small" id="respec-cancel">Annuler</button>
      ${c.gold < price ? '<span class="down">Pas assez de golds</span>' : ''}
      ${wasted ? `<span class="down">⚠️ ${wasted} point(s) au-delà du plafond : ils ne servent à rien</span>` : ''}</div>`;
  $('respec-cancel').onclick = () => { statDraft = null; renderStats(); };
  $('respec-ok').onclick = async () => {
    const r = await act('/api/stats/respec', { stats: statDraft }, 'levelUp');
    if (r) { statDraft = null; renderStats(); toast(r.price ? `🔁 Nouvelle répartition validée pour ${r.price} golds !` : '✔ Points validés !'); }
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
    const cb = Rules.itemClassBonus(item, me.character.cls);
    return `<div class="slot filled rarity-${item.rarity}" data-slot="${slot}">
      <div class="slot-actions">
        <button type="button" class="lock-btn ${item.locked ? 'on' : ''}" data-lock="${item.id}" title="${item.locked ? 'Verrouillé : cliquer pour déverrouiller' : 'Verrouiller (protège de la forge, de l\'alchimie, du recyclage et du marché)'}">${item.locked ? '🔒' : '🔓'}</button>
        <button type="button" class="unequip-btn" data-unequip="${slot}" title="Retirer cet objet (il retourne dans ton coffre personnel)">✕ Retirer</button>
      </div>
      <div class="slot-label">${label}</div>
      <div class="c-${item.rarity}" style="font-weight:800;margin:4px 0">${esc(item.name)}</div>${lines}${cb ? `<br><span class="cls-bonus">★ ${Rules.formatLine(cb.stat, cb.value)} (bonus de classe)</span>` : ''}</div>`;
  }).join('');
  $('equipment').querySelectorAll('[data-unequip]').forEach((b) => {
    b.onclick = () => act('/api/unequip', { slot: b.dataset.unequip }, 'unequip');
  });
  $('equipment').querySelectorAll('[data-lock]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); toggleLock(b.dataset.lock); };
  });
}

// Stats d'un objet pour le joueur (lignes + bonus de classe si l'objet est de sa classe).
function sumLines(item) {
  const out = {};
  if (!item) return out;
  for (const l of item.lines) out[l.stat] = (out[l.stat] || 0) + l.value;
  const cb = me && Rules.itemClassBonus(item, me.character.cls);
  if (cb) out[cb.stat] = (out[cb.stat] || 0) + cb.value;
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

// Objets d'une autre classe (équipables, mais sans bonus de classe pour le joueur).
const otherClass = (item) => !!Rules.itemClass(item) && Rules.itemClass(item) !== me.character.cls;

async function toggleLock(itemId) {
  const r = await act('/api/item/lock', { itemId }, 'equip');
  if (r) toast(r.locked ? '🔒 Objet verrouillé : il est protégé de la forge, de l\'alchimie, du recyclage et du marché' : '🔓 Objet déverrouillé', 3500);
}
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
  const filters = [['all', 'Tout']].concat(Rules.SLOTS.map((s) => [s, Rules.SLOT_INFO[s].icon + ' ' + Rules.SLOT_INFO[s].label]), [['other', '↔️ Autres classes']]);
  $('inv-filters').innerHTML = filters.map(([k, label]) => {
    const n = k === 'all' ? visible.length : k === 'other' ? inv.filter(otherClass).length : visible.filter((i) => i.slot === k).length;
    return `<button class="${invFilter === k ? 'active' : ''}" data-f="${k}" ${k === 'other' ? 'title="Armes et objets secondaires des autres classes : équipables, mais sans bonus de classe pour toi"' : ''}>${label} (${n})</button>`;
  }).join('');
  $('inv-filters').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { invFilter = b.dataset.f; invPage = 0; renderInventory(); };
  });
  $('inv-count').textContent = inv.length + ' objet(s)';
  const bySlotOnly = (invFilter === 'other' ? inv : visible)
    .filter((item) => invFilter === 'all' || (invFilter === 'other' ? otherClass(item) : item.slot === invFilter));
  // Filtre par rareté (combinable avec les autres) : seules les raretés présentes sont proposées, de la meilleure à la moins bonne.
  const rarityCounts = {};
  for (const item of bySlotOnly) rarityCounts[item.rarity] = (rarityCounts[item.rarity] || 0) + 1;
  if (invRarity !== 'all' && !rarityCounts[invRarity]) invRarity = 'all';
  $('inv-rarity-filters').innerHTML = `<span class="muted filter-label">Rareté :</span><button class="${invRarity === 'all' ? 'active' : ''}" data-rar="all">Toutes</button>`
    + Rules.RARITIES.slice().reverse().filter((r) => rarityCounts[r]).map((r) => `<button class="rarity-chip ${invRarity === r ? 'active' : ''}" data-rar="${r}" style="--rc:${Rules.RARITY_INFO[r].color}"><span class="rarity-dot"></span>${Rules.RARITY_INFO[r].label} (${rarityCounts[r]})</button>`).join('');
  $('inv-rarity-filters').querySelectorAll('[data-rar]').forEach((b) => {
    b.onclick = () => { invRarity = b.dataset.rar; invPage = 0; renderInventory(); };
  });
  const bySlot = bySlotOnly.filter((item) => invRarity === 'all' || item.rarity === invRarity);
  // Filtre par stat (combinable avec l'emplacement) : seules les stats présentes dans le coffre sont proposées.
  const statOf = (item) => item.lines.reduce((sum, l) => (l.stat === invStat ? sum + l.value : sum), 0);
  const statCounts = {};
  for (const item of bySlot) for (const st of new Set(item.lines.map((l) => l.stat))) statCounts[st] = (statCounts[st] || 0) + 1;
  if (invStat !== 'all' && !statCounts[invStat]) invStat = 'all';
  $('inv-stat-filters').innerHTML = `<span class="muted filter-label">Stat :</span><button class="${invStat === 'all' ? 'active' : ''}" data-st="all">Toutes</button>`
    + Rules.STATS.filter((st) => statCounts[st]).map((st) => `<button class="${invStat === st ? 'active' : ''}" data-st="${st}">${Rules.STAT_INFO[st].icon} ${Rules.STAT_INFO[st].label} (${statCounts[st]})</button>`).join('');
  $('inv-stat-filters').querySelectorAll('[data-st]').forEach((b) => {
    b.onclick = () => { invStat = b.dataset.st; invPage = 0; renderInventory(); };
  });
  // Filtre par panoplie (combinable avec les deux autres) : seules les panoplies présentes sont proposées.
  const byStat = bySlot.filter((item) => invStat === 'all' || item.lines.some((l) => l.stat === invStat));
  const setCounts = {};
  for (const item of byStat) {
    const k = item.set && Rules.SETS[item.set] ? item.set : 'none';
    setCounts[k] = (setCounts[k] || 0) + 1;
  }
  if (invSet !== 'all' && !setCounts[invSet]) invSet = 'all';
  const setKeys = Object.keys(Rules.SETS).filter((k) => setCounts[k]);
  $('inv-set-filters').style.display = setKeys.length ? '' : 'none';
  $('inv-set-filters').innerHTML = `<span class="muted filter-label">Panoplie :</span><button class="${invSet === 'all' ? 'active' : ''}" data-set="all">Toutes</button>`
    + setKeys.map((k) => { const S = Rules.SETS[k]; return `<button class="${invSet === k ? 'active' : ''}" data-set="${k}" style="--set:${S.color}" title="${esc(S.label)} : ${S.stats.map((st) => Rules.STAT_INFO[st].label).join(' + ')}">${S.icon} ${esc(S.label)} (${setCounts[k]})</button>`; }).join('')
    + (setCounts.none ? `<button class="${invSet === 'none' ? 'active' : ''}" data-set="none">Sans panoplie (${setCounts.none})</button>` : '');
  $('inv-set-filters').querySelectorAll('[data-set]').forEach((b) => {
    b.onclick = () => { invSet = b.dataset.set; invPage = 0; renderInventory(); };
  });
  const list = byStat
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => invSet === 'all' || (invSet === 'none' ? !(item.set && Rules.SETS[item.set]) : item.set === invSet))
    .sort((x, y) => (invStat !== 'all' ? statOf(y.item) - statOf(x.item) : 0)
      || isFresh(y.item) - isFresh(x.item) // les objets « Nouveau ! » d'abord
      || Rules.RARITIES.indexOf(y.item.rarity) - Rules.RARITIES.indexOf(x.item.rarity) || y.i - x.i)
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
      const btn = `<button class="small" data-equip="${item.id}">Équiper</button>`;
      const lock = `<button class="small secondary lock-chip ${item.locked ? 'on' : ''}" data-lock="${item.id}" title="${item.locked ? 'Déverrouiller' : 'Verrouiller : protège de la forge, de l\'alchimie, du recyclage et du marché'}">${item.locked ? '🔒' : '🔓'}</button>`;
      const sell = isProtected(item.id) ? '' : `<button class="small secondary" data-sell="${item.id}" title="Le vendre au marché">🏪 Vendre</button>`;
      return itemHtml(item, `${protectedTag(item)}${compareHtml(item)}<div class="actions">${btn}${sell}${lock}</div>`, me.character.cls);
    }).join('')
    : '<div class="muted">Ton coffre personnel est vide. Ouvre des coffres de LOOT pour le remplir !</div>';
  $('inventory').querySelectorAll('[data-equip]').forEach((b) => {
    b.onclick = () => act('/api/equip', { itemId: b.dataset.equip }, 'equip');
  });
  $('inventory').querySelectorAll('[data-lock]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); toggleLock(b.dataset.lock); };
  });
  $('inventory').querySelectorAll('[data-sell]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      marketItemId = b.dataset.sell;
      showTab('marche');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  });
  // Badge « Nouveau ! » (objets sortis d'un coffre) : disparaît au premier survol.
  const byId = new Map(pageItems.map((it) => [it.id, it]));
  $('inventory').querySelectorAll('.item').forEach((el) => {
    const item = byId.get(el.dataset.id);
    if (!item || !isFresh(item)) return;
    el.classList.add('is-new');
    el.insertAdjacentHTML('afterbegin', '<div class="new-badge">Nouveau !</div>');
    el.addEventListener('pointerenter', () => {
      item.isNew = false;
      seenIds.add(item.id);
      el.classList.remove('is-new');
      el.classList.add('seen');
      const badge = el.querySelector('.new-badge');
      if (badge) badge.remove();
      markSeen(item.id);
    }, { once: true });
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


// Objets vus : envoyés au serveur par petits paquets (sans recharger la fiche).
const seenQueue = new Set();
let seenTimer = null;
function markSeen(id) {
  seenQueue.add(id);
  clearTimeout(seenTimer);
  seenTimer = setTimeout(() => {
    const ids = [...seenQueue];
    seenQueue.clear();
    fetch('/api/items/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }).catch(() => {});
  }, 600);
}

// ---------- Presets d'équipement ----------
const isProtected = (id) => !!(me && me.character.protectedIds.includes(id));

function protectedTag(item) {
  const names = me.character.presets.filter((p) => Object.values(p.items).includes(item.id)).map((p) => esc(p.name));
  const tags = [];
  if (item.locked) tags.push('<div class="protected-tag" title="Protégé : ni fusion, ni sacrifice, ni recyclage, ni vente">🔒 Verrouillé</div>');
  if (names.length) tags.push(`<div class="protected-tag" title="Protégé : ni fusion, ni sacrifice, ni recyclage, ni vente">🔐 Preset : ${names.join(', ')}</div>`);
  return tags.join('');
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
      if (!await confirmBox(`Remplacer « ${p.name} » par l'équipement actuel ?`)) return;
      if (await act('/api/preset/save', { name: p.name, id: p.id }, 'equip')) toast(`💾 Preset « ${p.name} » mis à jour`);
    };
    el.querySelector('[data-del]').onclick = async () => {
      if (!await confirmBox(`Supprimer le preset « ${p.name} » ? Ses objets ne seront plus protégés.`)) return;
      if (await act('/api/preset/delete', { id: p.id }, 'unequip')) toast(`🗑 Preset « ${p.name} » supprimé`);
    };
  });
  renderSoloLoadout();
}

// Tenues sauvegardées, aussi dans le mode Solo : changer d'équipement avant un donjon sans quitter l'onglet
function renderSoloLoadout() {
  const c = me.character;
  const equippedIds = Object.fromEntries(Rules.SLOTS.map((s) => [s, c.equipment[s] ? c.equipment[s].id : null]));
  const chips = c.presets.map((p) => {
    const current = Rules.SLOTS.every((s) => (p.items[s] || null) === equippedIds[s]);
    return `<button type="button" class="chip ${current ? 'active' : ''}" data-solo-preset="${p.id}" ${current ? 'disabled' : ''} title="${current ? 'Déjà équipée' : 'Équiper cette tenue'}">${current ? '✅' : '💾'} ${esc(p.name)}</button>`;
  }).join('');
  $('solo-loadout').innerHTML = `<div class="solo-loadout-head"><b>🎽 Tenue</b><span class="muted">💪 Puissance : <b>${String(c.power).replace('.', ',')}</b></span>
      <button type="button" class="small secondary" id="solo-loadout-manage">Gérer les tenues</button></div>
    <div class="chips">${chips || '<span class="muted">Aucune tenue sauvegardée : enregistre ton équipement en preset (Personnage → Équipement) pour en changer ici en un clic.</span>'}</div>`;
  $('solo-loadout').querySelectorAll('[data-solo-preset]').forEach((b) => {
    b.onclick = async () => {
      const r = await act('/api/preset/apply', { id: b.dataset.soloPreset }, 'equip');
      if (r) toast(`✅ Tenue « ${r.name} » équipée${r.missing ? ` (${r.missing} objet(s) introuvable(s))` : ''}${r.locked ? ` (${r.locked} objet(s) d'une autre classe)` : ''}`);
    };
  });
  $('solo-loadout-manage').onclick = () => { showTab('inventaire'); setTimeout(() => { const el = $('presets'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 150); };
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
  // Écran étroit (téléphone) : l'arbre se dresse à la verticale (branche de gauche en haut, de droite en bas), à taille
  // normale, au lieu d'être réduit jusqu'à devenir illisible.
  TREE.vertical = avail < 640;
  if (TREE.vertical) {
    TREE.step = TREE_STEP.min + 4;
    TREE.gap = Math.min(96, Math.max(70, (avail - 70) / 2));
    TREE.w = Math.round(2 * TREE.gap + 70);
    TREE.h = Math.round(2 * (tiers * TREE.step + TREE_MARGIN));
    TREE.cx = TREE.w / 2;
    TREE.cy = TREE.h / 2;
    TREE.scale = Math.min(1, avail / TREE.w);
    return;
  }
  TREE.gap = 96;
  TREE.h = 380;
  TREE.cy = 190;
  TREE.step = Math.max(TREE_STEP.min, Math.min(TREE_STEP.max, (avail / 2 - TREE_MARGIN) / tiers));
  TREE.w = Math.round(2 * (tiers * TREE.step + TREE_MARGIN));
  TREE.cx = TREE.w / 2;
  TREE.scale = Math.min(1, avail / TREE.w);
}

function talentPos(n) {
  const dir = n.branch === 'left' ? -1 : 1;
  const side = n.tier === 2 || n.tier === 4 ? (n.option - 1) * TREE.gap : 0;
  if (TREE.vertical) return { x: TREE.cx + side, y: TREE.cy + dir * TREE.step * (n.tier + 1) };
  return { x: TREE.cx + dir * TREE.step * (n.tier + 1), y: TREE.cy + side };
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
  if (c.talents.includes(n.id) || (c.talentExtra || []).includes(n.id)) return 'owned';
  if (!Rules.talentExtraBlocker(c.cls, c.talents, c.talentExtra, n.id, null)) return 'extra'; // branche terminée : à prendre en bonus
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
  if (window.talentLocked !== locked) { window.talentLocked = locked; renderPlaceBar(); }
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
    if (!await confirmBox(`Remettre ton arbre à zéro pour ${Rules.TALENT_RESET_PRICE} golds ? Tous tes points te sont rendus.`)) return;
    const r = await act('/api/talent/reset', {}, 'reroll');
    if (r) { talentSel = null; toast(`↺ Arbre remis à zéro : ${r.refunded} point(s) récupéré(s)`); }
  };

  // Liens et nœuds
  layoutTree();
  const nodes = Rules.talentNodes(cls);
  const byTier = (b, t) => nodes.filter((n) => n.branch === b && n.tier === t);
  const owned = new Set(c.talents.concat(c.talentExtra || []));
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
    const extraCost = Rules.TALENT_EXTRA_COST;
    const action = locked ? '<span class="muted">🔒 Arbre pas encore débloqué.</span>'
      : state === 'owned' ? `<b class="up">✅ ${(c.talentExtra || []).includes(sel.id) ? 'Pris en bonus' : 'Appris'}</b>`
        : state === 'available' ? `<button class="gold" id="talent-learn">Apprendre (1 point)</button>`
          : state === 'extra' ? `<button class="gold" id="talent-extra" ${st.available < extraCost ? 'disabled' : ''}>⭐ Prendre en bonus (${extraCost} points d'arbre)</button>
            <span class="muted">Branche terminée : tu as ${st.available} point${st.available > 1 ? 's' : ''} d'arbre.</span>`
            : `<span class="muted">🔒 ${esc(reason)}</span>`;
    $('talent-detail').innerHTML = `<div class="talent-detail-box" style="--c:${tree[sel.branch].color}">
      <div class="talent-detail-title">${info.icon} <b>${esc(info.title)}</b></div>${info.html}<div class="row">${action}</div></div>`;
    const extraBtn = $('talent-extra');
    if (extraBtn) extraBtn.onclick = async () => {
      if (!await confirmBox(`Prendre « ${info.title} » en bonus pour ${extraCost} points d'arbre ?`, { title: '⭐ Nœud bonus' })) return;
      if (await act('/api/talent/extra', { id: sel.id }, 'levelUp')) toast(`⭐ ${info.title} pris en bonus !`, 4000);
    };
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

// ---------- Style de combat : techniques et tactique (V2) ----------
function renderCombatStyle() {
  const c = me.character;
  const slots = Rules.techSlots(c.level);
  $('techs-sub').textContent = slots ? `${c.techs.length} / ${slots} emplacement${slots > 1 ? 's' : ''}` : `Débloquées au niveau ${Rules.TECH_SLOTS[0]}`;
  $('tech-slots').innerHTML = Rules.TECH_SLOTS.map((lvl, i) => {
    const id = c.techs[i];
    const T = id && Rules.TECHNIQUES[id];
    if (c.level < lvl) return `<div class="tech-slot locked">🔒 Emplacement ${i + 1}<small>Niveau ${lvl}</small></div>`;
    return T ? `<div class="tech-slot filled"><span class="tech-ico">${T.icon}</span><b>${T.label}</b><button class="small secondary" data-untech="${id}">Retirer</button></div>`
      : `<div class="tech-slot">＋ Emplacement ${i + 1}<small>Choisis une technique ci-dessous</small></div>`;
  }).join('');
  const ids = Object.keys(Rules.TECHNIQUES).filter((id) => !Rules.TECHNIQUES[id].cls || Rules.TECHNIQUES[id].cls === c.cls)
    .sort((a, b) => Rules.TECHNIQUES[a].level - Rules.TECHNIQUES[b].level);
  $('tech-grid').innerHTML = ids.map((id) => {
    const T = Rules.TECHNIQUES[id];
    const why = Rules.techBlocker(c.cls, c.level, id);
    const on = c.techs.includes(id);
    const full = c.techs.length >= slots;
    const tag = T.cls ? `<span class="tech-tag" style="--c:${Rules.CLASS_INFO[T.cls].color}">${Rules.CLASS_INFO[T.cls].icon} ${Rules.CLASS_INFO[T.cls].role}</span>` : '<span class="tech-tag">Toutes classes</span>';
    const action = why ? `<span class="muted">🔒 ${esc(why)}</span>`
      : on ? '<b class="up">✅ Équipée</b>'
        : `<button class="small" data-tech="${id}" ${full ? 'title="Retire d\'abord une technique"' : ''}>${full ? 'Remplacer la dernière' : 'Équiper'}</button>`;
    return `<div class="tech-card ${on ? 'on' : ''} ${why ? 'locked' : ''}">
      <div class="tech-head"><span class="tech-ico">${T.icon}</span><b>${T.label}</b>${tag}<span class="muted">Niv. ${T.level}${T.cd ? ` · recharge ${T.cd} s` : ''}</span></div>
      <p>${T.desc}</p><div class="row">${action}</div></div>`;
  }).join('');
  $('tech-grid').querySelectorAll('[data-tech]').forEach((b) => {
    b.onclick = () => {
      const list = [...c.techs];
      if (list.length >= slots) list.pop();
      list.push(b.dataset.tech);
      act('/api/techs', { techs: list }, 'equip');
    };
  });
  $('tech-slots').querySelectorAll('[data-untech]').forEach((b) => {
    b.onclick = () => act('/api/techs', { techs: c.techs.filter((id) => id !== b.dataset.untech) }, 'unequip');
  });

  // Tactique
  const t = c.tactics;
  const chips = (group, key) => Object.entries(Rules.TACTICS[group]).map(([id, o]) =>
    `<button class="chip ${t[key] === id ? 'active' : ''}" data-tac="${key}" data-val="${id}" title="${esc(o.desc)}">${o.icon} ${o.label}</button>`).join('');
  const max = Rules.tacticsKiteMax(c.cls);
  const def = Rules.classInfo(c.cls).combat.kite || 0;
  const kite = t.kite === null || t.kite === undefined ? def : t.kite;
  const stanceDesc = Rules.TACTICS.stance[t.stance].desc;
  const targetDesc = Rules.TACTICS.target[t.target].desc;
  $('tactics').innerHTML = `
    <div class="tac-row"><div class="tac-label">Posture</div><div class="chips">${chips('stance', 'stance')}</div><p class="muted">${esc(stanceDesc)}</p></div>
    <div class="tac-row"><div class="tac-label">Cible préférée</div><div class="chips">${chips('target', 'target')}</div><p class="muted">${esc(targetDesc)}</p></div>
    ${max ? `<div class="tac-row"><div class="tac-label">Distance de recul</div>
      <div class="row"><input type="range" id="tac-kite" min="${Rules.TACTICS.kiteMin}" max="${max}" step="5" value="${kite}" ${t.stance === 'agressif' ? 'disabled' : ''}>
      <b id="tac-kite-val">${kite} px</b><button class="small secondary" id="tac-kite-reset" ${t.kite === null ? 'disabled' : ''}>Par défaut (${def} px)</button></div>
      <p class="muted">Ton personnage recule quand un ennemi s'approche à moins de cette distance (0 : il ne recule jamais). ${t.stance === 'agressif' ? 'Sans effet en posture Agressive.' : t.stance === 'prudent' ? 'La posture Prudente l\'augmente de 40 %.' : ''}</p></div>`
    : '<p class="muted">La distance de recul ne concerne que les classes qui attaquent à distance (Archer, Mage).</p>'}`;
  $('tactics').querySelectorAll('[data-tac]').forEach((b) => {
    b.onclick = () => act('/api/tactics', { [b.dataset.tac]: b.dataset.val }, 'equip');
  });
  const slider = $('tac-kite');
  if (slider) {
    slider.oninput = () => { $('tac-kite-val').textContent = slider.value + ' px'; };
    slider.onchange = () => act('/api/tactics', { kite: Number(slider.value) }, 'equip');
    $('tac-kite-reset').onclick = () => act('/api/tactics', { kite: null }, 'unequip');
  }
}

// ---------- Mode Solo ----------
const soloBus = { h: {}, on(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); }, emit(ev, d) { (this.h[ev] || []).forEach((fn) => fn(d)); } };
let soloView = null;
let soloQueue = null;
let soloFrame = null;
let soloBoss = 'troll';
let soloDiff = 'normal';
let soloSpeed = (() => { try { return Number(localStorage.getItem('zl_solo_speed')) || 1; } catch (e) { return 1; } })();

function ensureSoloView() {
  if (soloView) return;
  soloView = new ArenaView($('solo-arena'), soloBus);
  soloBus.emit('queue', { phase: 'idle', mode: 'dungeon', soloView: true, participants: [], result: null });
}

function energyText(st) {
  if (st.nextAt === null) return 'pleine';
  const ms = Math.max(0, st.nextAt - Date.now());
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `+1 dans ${h} h ${String(m).padStart(2, '0')}`;
}

// Énergie recalculée côté client entre deux mises à jour du serveur (même formule que le serveur).
function myEnergy() {
  return Rules.energyState(me.character.energy, Date.now());
}

function renderEnergy() {
  if (!me || !me.character) return;
  const st = myEnergy();
  const max = Rules.SOLO.energyMax;
  $('energy-chip').innerHTML = `⚡ ${st.value}/${max}`;
  $('energy-chip').title = `Énergie du mode Solo : ${st.value}/${max} (${energyText(st)})`;
  $('energy-bar').innerHTML = `<div class="pips">${Array.from({ length: max }, (_, i) => `<span class="pip ${i < st.value ? 'on' : ''}">⚡</span>`).join('')}</div>
    <div><b>${st.value} / ${max}</b> énergie${st.value > 1 ? 's' : ''} · <span class="muted">${st.nextAt === null ? 'Énergie au maximum' : `Prochaine recharge dans ${energyText(st).replace('+1 dans ', '')}`}</span></div>`;
  const keys = me.character.bossKeys || 0;
  $('key-chip').innerHTML = `🗝️ ${keys}`;
  $('key-chip').title = `Clés de boss : ${keys} (1 par Défi des boss, trouvées dans les reliques de l'Expédition)`;
  $('key-bar').innerHTML = `<b>🗝️ ${keys}</b> Clé${keys > 1 ? 's' : ''} de boss · <span class="muted">${keys ? '1 clé par défi' : 'Trouve-en dans les reliques de l\'Expédition'}</span>`;
  const busy = soloRunning();
  const cost = { 'exp-start': st.value < 1 ? 'Plus d\'énergie' : '', 'boss-start': keys < Rules.SOLO.keyCost ? 'Il te faut une Clé de boss (reliques de l\'Expédition)' : '' };
  for (const id of ['exp-start', 'boss-start']) {
    $(id).disabled = busy || !!cost[id] || !me.character.cls;
    $(id).title = !me.character.cls ? 'Choisis d\'abord une classe' : busy ? 'Une partie solo est déjà en cours' : cost[id];
  }
}

function soloRunning() {
  return !!(soloQueue && soloQueue.phase === 'battle') || !!(me && me.character.soloActive);
}

function renderSolo() {
  const c = me.character;
  renderEnergy();
  $('exp-rewards').innerHTML = '<b>Butin selon la profondeur :</b> ' + [5, 10, 20, 30].map((n) => {
    const r = Rules.expeditionReward(n);
    return `<span class="chip-info">${n} : ${r.gold} 🪙 · ${r.xp} XP · ${r.chests} 🎁</span>`;
  }).join(' ');
  const best = c.counters.expeditionBest || 0;
  const mask = Rules.COSMETICS.masque_abysses.unlock.goal;
  $('exp-record').innerHTML = `🏅 Record : <b>profondeur ${best}</b>${best < mask ? ` · <span class="muted">profondeur ${mask} pour débloquer le Masque des abysses</span>` : ' · 🎭 Masque des abysses débloqué !'}`;
  $('solo-boss-pick').innerHTML = Object.entries(Rules.BOSSES).map(([id, B]) => {
    const won = c.counters[Rules.HERO_BOSS_COUNTER[id]] > 0;
    return `<button class="solo-boss ${soloBoss === id ? 'active' : ''}" data-sboss="${id}" style="--c:${B.color}">
      <span class="ic">${B.icon}</span><b>${esc(B.name)}</b>${won ? '<span class="won" title="Vaincu en Héroïque ou Légendaire : peau légendaire débloquée">🏆</span>' : ''}</button>`;
  }).join('');
  $('solo-boss-pick').querySelectorAll('[data-sboss]').forEach((b) => { b.onclick = () => { soloBoss = b.dataset.sboss; renderSolo(); }; });
  // Difficultés ultimes (Fabuleux, Mythique, Divin) : leurs effets en plus de la vie et des dégâts
  const ultra = (D) => (D.ultimate ? `<small class="down">attaques spéciales ×${String(D.special).replace('.', ',')} · coups ×${String(D.attackSpeed).replace('.', ',')} · rage à ${D.enrageAt} s · soins −${Math.round((1 - D.healTaken) * 100)} %</small>` : '');
  $('solo-diff-pick').innerHTML = Object.entries(Rules.BOSS_CHALLENGE).map(([id, D]) => `<button class="solo-diff ${D.ultimate ? 'ultimate' : ''} ${soloDiff === id ? 'active' : ''}" data-sdiff="${id}">
      <b>${D.icon} ${D.label}</b><small>Boss ×${String(D.hp).replace('.', ',')} vie · ×${String(D.damage).replace('.', ',')} dégâts</small>${ultra(D)}
      <small class="up">${D.reward.gold} 🪙 · ${D.reward.xp} XP · ${D.reward.chests} 🎁${D.reward.keys ? ` · ${D.reward.keys} 🗝️` : ''}</small></button>`).join('');
  $('solo-diff-pick').querySelectorAll('[data-sdiff]').forEach((b) => { b.onclick = () => { soloDiff = b.dataset.sdiff; renderSolo(); }; });
  renderSoloRun();
}

function renderSoloRun() {
  const running = soloQueue && soloQueue.phase === 'battle';
  const ended = soloQueue && soloQueue.phase === 'ended';
  $('solo-run').classList.toggle('show', !!(running || ended));
  document.querySelectorAll('#solo-run [data-speed]').forEach((b) => {
    const sp = soloQueue && soloQueue.solo ? soloQueue.solo.speed : soloSpeed;
    b.classList.toggle('active', Number(b.dataset.speed) === sp);
    b.disabled = !running;
  });
  $('solo-abandon').disabled = !running;
  let status = '';
  if (soloQueue && soloQueue.solo) {
    const info = soloQueue.solo;
    if (info.kind === 'expedition') status = running ? '🕳️ Expédition en cours' : '🕳️ Expédition terminée';
    else {
      const B = Rules.BOSSES[soloQueue.boss] || Rules.BOSS;
      const D = Rules.BOSS_CHALLENGE[info.difficulty];
      status = `${B.icon} Défi : ${esc(B.name)} — ${D.icon} ${D.label}${running ? '' : ' (terminé)'}`;
    }
  }
  $('solo-status').innerHTML = status;
  renderRelicChoice();
}

function renderRelicChoice() {
  renderRelicChoiceIn(soloFrame, $('relic-choice'), '/api/solo/relic');
}

// Bouton « Masquer / Afficher » d'une fenêtre de choix posée sur l'arène : réduite en bandeau, on voit la vie du héros.
function bindPeek(box) {
  const btn = box.querySelector('.relic-peek');
  if (!btn) return;
  const sync = () => { btn.textContent = box.classList.contains('peek') ? '👁 Afficher' : '🙈 Masquer'; };
  btn.onclick = (e) => { e.stopPropagation(); box.classList.toggle('peek'); sync(); };
  sync();
}

// Choix d'une relique par-dessus une arène (mode Solo, ou sa répétition dans l'onglet Entraînement).
function renderRelicChoiceIn(frame, box, endpoint) {
  const dg = frame && frame.phase === 'battle' && frame.dungeon;
  const choice = dg && dg.relicChoice;
  if (!choice) { box.classList.remove('show', 'peek'); box.dataset.key = ''; return; }
  const key = choice.options.join(',') + dg.room;
  const left = box.querySelector('.relic-left');
  if (left) left.textContent = Math.ceil(choice.left) + ' s';
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = `<div class="relic-title">🔮 Choisis une relique <span class="relic-left">${Math.ceil(choice.left)} s</span><button class="small secondary relic-peek" type="button"></button></div>
    <div class="relic-cards">${choice.options.map((id) => {
      const R = Rules.RELICS[id];
      return `<button class="relic-card" data-relic="${id}"><span class="ic">${R.icon}</span><b>${esc(R.label)}</b><small>${esc(R.desc)}</small></button>`;
    }).join('')}</div><div class="muted relic-note" style="font-size:12px">Sans choix, une relique est tirée au hasard.</div>`;
  box.classList.add('show');
  bindPeek(box);
  Sound.play('chestAppear');
  box.querySelectorAll('[data-relic]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api(endpoint, { id: b.dataset.relic });
        Sound.play('reroll');
        box.classList.remove('show');
      } catch (err) { toast('⚠️ ' + err.message); }
    };
  });
}

// Boss Rush en solo (entraînement) : entre deux boss, le joueur choisit en cliquant (bonus, grand soin, quitte ou double).
function renderRushChoiceIn(frame, box, endpoint) {
  const poll = frame && frame.phase === 'battle' && frame.rush && frame.rush.poll;
  if (!poll) { box.classList.remove('show', 'peek'); box.dataset.key = ''; return; }
  const key = 'rush' + frame.rush.round + poll.options.map((o) => o.id + o.label).join(',');
  const left = box.querySelector('.relic-left');
  if (left) left.textContent = Math.ceil(poll.left) + ' s';
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = `<div class="relic-title">💀 Boss vaincu ! Choisis la suite de ta run <span class="relic-left">${Math.ceil(poll.left)} s</span><button class="small secondary relic-peek" type="button"></button></div>
    <div class="relic-cards">${poll.options.map((o) => `<button class="relic-card" data-rush="${o.id}" style="--c:${o.color}"><span class="ic">${o.icon}</span><b>${esc(o.label)}</b><small>${esc(o.desc || '')}</small></button>`).join('')}</div>
    <div class="muted relic-note" style="font-size:12px">Sans choix, la suite est tirée au hasard.</div>`;
  box.classList.add('show');
  bindPeek(box);
  Sound.play('chestAppear');
  box.querySelectorAll('[data-rush]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api(endpoint, { id: b.dataset.rush });
        Sound.play('pollEnd');
        box.classList.remove('show');
      } catch (err) { toast('⚠️ ' + err.message); }
    };
  });
}

async function startSolo(body) {
  try {
    ensureSoloView();
    await api('/api/solo/start', { ...body, speed: soloSpeed });
    Sound.play('chestHit', 3);
    $('solo-run').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    toast('⚠️ ' + err.message);
  }
}

$('exp-start').onclick = () => startSolo({ kind: 'expedition' });
$('boss-start').onclick = () => startSolo({ kind: 'boss', boss: soloBoss, difficulty: soloDiff });
document.querySelectorAll('#solo-run [data-speed]').forEach((b) => {
  b.onclick = async () => {
    soloSpeed = Number(b.dataset.speed);
    try { localStorage.setItem('zl_solo_speed', String(soloSpeed)); } catch (e) { /* ignore */ }
    try { await api('/api/solo/speed', { speed: soloSpeed }); } catch (err) { toast('⚠️ ' + err.message); }
  };
});
// Plein écran de l'arène du mode Solo et de l'entraînement (en paysage sur téléphone) : les reliques s'y choisissent aussi
$('solo-full').onclick = () => GameScreen.toggle($('solo-screen'), $('solo-arena'));
$('training-full').onclick = () => GameScreen.toggle($('training-screen'), $('training-arena'));
$('solo-abandon').onclick = async () => {
  const exp = soloQueue && soloQueue.solo && soloQueue.solo.kind === 'expedition';
  if (!await confirmBox(exp ? 'Remonter à la surface ? Tu gardes le butin des étages déjà nettoyés.' : 'Abandonner le défi ? Tu ne gagneras rien.')) return;
  try { await api('/api/solo/abandon', {}); } catch (err) { toast('⚠️ ' + err.message); }
};

async function loadSoloState() {
  try {
    const st = await api('/api/solo/state');
    ensureSoloView();
    onSoloQueue(st.queue);
    if (st.frame) { soloFrame = st.frame; soloBus.emit('frame', st.frame); }
  } catch (e) { /* ignore */ }
}

function onSoloQueue(q) {
  soloQueue = q;
  ensureSoloView();
  soloBus.emit('queue', { ...q, soloView: true });
  if (me) renderSolo();
}

setInterval(() => { if (me) { renderEnergy(); renderRelicChoice(); } }, 1000);
setInterval(() => { if (me) renderBadges(); }, 15000); // un courrier arrive aussi sans action du joueur

// ---------- Marché ----------
let marketOrders = null; // ordres en vente (chargés à l'ouverture de l'onglet, rafraîchis en direct)
let marketSlot = 'all';
let marketItemId = null;

async function loadMarket() {
  try { marketOrders = (await api('/api/market')).orders; } catch (e) { marketOrders = marketOrders || []; }
  renderMarket();
}

function timeLeft(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  return d ? `${d} j ${h % 24} h` : h ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
}
const dateShort = (t) => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const MARKET_LOG = { listed: '🏷️ Mis en vente', sold: '💰 Vendu', bought: '🛒 Acheté', cancelled: '↩️ Retiré', expired: '⌛ Expiré' };

function renderMarket() {
  if (!me || !me.character) return;
  const c = me.character;
  const M = Rules.MARKET;
  const orders = marketOrders || [];
  const mine = orders.filter((o) => o.sellerId === me.id);
  $('market-slots').textContent = `${mine.length} / ${M.maxOrders} ventes en cours`;

  // Vendre : un objet du coffre (pas protégé par un preset)
  const sellable = c.inventory.filter((i) => !isProtected(i.id))
    .sort((a, b) => Rules.RARITIES.indexOf(b.rarity) - Rules.RARITIES.indexOf(a.rarity));
  if (!sellable.some((i) => i.id === marketItemId)) marketItemId = sellable[0] ? sellable[0].id : null;
  $('market-item').innerHTML = sellable.length
    ? sellable.map((i) => `<option value="${i.id}" ${i.id === marketItemId ? 'selected' : ''}>${itemType(i).icon} ${esc(i.name)} (${Rules.RARITY_INFO[i.rarity].label})</option>`).join('')
    : '<option value="">Aucun objet à vendre dans ton coffre</option>';
  const item = sellable.find((i) => i.id === marketItemId);
  $('market-item-preview').innerHTML = item ? itemHtml(item, '', c.cls) : '';
  const price = Math.floor(Number($('market-price').value) || 0);
  const okPrice = price >= M.minPrice && price <= M.maxPrice;
  const tax = okPrice ? Rules.marketTax(price) : 0;
  $('market-tax').innerHTML = okPrice
    ? `Taxe : <b>${tax} 🪙</b> (20 %, non remboursée) · tu recevras <b>${price} 🪙</b> à la vente`
    : `Prix entre ${M.minPrice} et ${M.maxPrice.toLocaleString('fr-FR')} 🪙`;
  $('market-sell').disabled = !item || !okPrice || c.gold < tax || mine.length >= M.maxOrders;
  $('market-sell').title = mine.length >= M.maxOrders ? `${M.maxOrders} ventes au maximum` : c.gold < tax ? 'Pas assez de golds pour la taxe' : '';

  // Mes ventes en cours
  $('market-mine').innerHTML = mine.length
    ? mine.map((o) => `<div class="market-row"><span class="c-${o.item.rarity}">${itemType(o.item).icon} ${esc(o.item.name)}</span>
        <b>${o.price.toLocaleString('fr-FR')} 🪙</b><span class="muted">⌛ ${timeLeft(o.expiresAt - Date.now())}</span>
        <button class="small secondary" data-mcancel="${o.id}">↩️ Retirer</button></div>`).join('')
    : '<p class="muted">Aucune vente en cours.</p>';
  $('market-mine').querySelectorAll('[data-mcancel]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmBox('Retirer cette vente ? L\'objet revient dans ton coffre, mais la taxe n\'est pas remboursée.')) return;
      if (await act('/api/market/cancel', { orderId: b.dataset.mcancel }, 'equip')) { toast('↩️ Vente retirée : l\'objet est revenu dans ton coffre'); loadMarket(); }
    };
  });

  // Historique
  $('market-history').innerHTML = c.marketLog.length
    ? c.marketLog.map((l) => `<div class="market-log"><span class="muted">${dateShort(l.at)}</span> ${MARKET_LOG[l.kind] || l.kind}
        <span class="c-${l.rarity}">${esc(l.item)}</span> · <b>${l.price.toLocaleString('fr-FR')} 🪙</b>${l.other ? ` <span class="muted">(${l.kind === 'sold' ? 'à' : 'de'} ${esc(l.other)})</span>` : ''}${l.tax ? ` <span class="muted">· taxe ${l.tax} 🪙</span>` : ''}</div>`).join('')
    : '<p class="muted">Rien pour l\'instant : tes ventes et tes achats s\'afficheront ici.</p>';

  // Objets en vente (filtres et tri)
  const rarity = $('market-rarity').value;
  const stat = $('market-stat').value;
  const myCls = $('market-mycls').checked;
  const base = orders.filter((o) => (rarity === 'all' || o.item.rarity === rarity)
    && (stat === 'all' || o.item.lines.some((l) => l.stat === stat))
    && (!myCls || Rules.itemClassBonus(o.item, c.cls)));
  const counts = {};
  for (const o of base) counts[o.item.slot] = (counts[o.item.slot] || 0) + 1;
  $('market-slot-filters').innerHTML = [['all', 'Tout']].concat(Rules.SLOTS.map((s) => [s, Rules.SLOT_INFO[s].icon + ' ' + Rules.SLOT_INFO[s].label]))
    .map(([k, label]) => `<button class="${marketSlot === k ? 'active' : ''}" data-ms="${k}">${label} (${k === 'all' ? base.length : counts[k] || 0})</button>`).join('');
  $('market-slot-filters').querySelectorAll('[data-ms]').forEach((b) => { b.onclick = () => { marketSlot = b.dataset.ms; renderMarket(); }; });
  const statVal = (o) => o.item.lines.reduce((s, l) => (l.stat === stat ? s + l.value : s), 0);
  const sort = $('market-sort').value;
  const shown = base.filter((o) => marketSlot === 'all' || o.item.slot === marketSlot).sort((a, b) => {
    if (sort === 'cheap') return a.price - b.price;
    if (sort === 'dear') return b.price - a.price;
    if (sort === 'rarity') return Rules.RARITIES.indexOf(b.item.rarity) - Rules.RARITIES.indexOf(a.item.rarity) || a.price - b.price;
    return (stat !== 'all' ? statVal(b) - statVal(a) : 0) || b.createdAt - a.createdAt;
  });
  $('market-count').textContent = marketOrders ? `${orders.length} objet(s) en vente` : 'Chargement…';
  $('market-list').innerHTML = shown.length
    ? shown.map((o) => {
      const own = o.sellerId === me.id;
      const btn = own ? '<button class="small secondary" disabled>Ta vente</button>'
        : c.gold < o.price ? '<button class="small" disabled>Pas assez de golds</button>'
          : `<button class="small gold" data-mbuy="${o.id}">🛒 Acheter</button>`;
      return itemHtml(o.item, `<div class="market-price">${o.price.toLocaleString('fr-FR')} 🪙</div>
        <div class="muted market-meta">Vendu par ${esc(o.seller)} · ⌛ ${timeLeft(o.expiresAt - Date.now())}</div>
        ${!own ? compareHtml(o.item) : ''}<div class="actions">${btn}</div>`, c.cls);
    }).join('')
    : `<div class="muted">${marketOrders ? 'Aucun objet ne correspond à ces filtres.' : 'Chargement du marché…'}</div>`;
  $('market-list').querySelectorAll('[data-mbuy]').forEach((b) => {
    b.onclick = async () => {
      const o = orders.find((x) => x.id === b.dataset.mbuy);
      if (!o || !await confirmBox(`Acheter « ${o.item.name} » à ${o.seller} pour ${o.price} golds ?`)) return;
      const r = await act('/api/market/buy', { orderId: o.id }, 'buy');
      if (r) { toast(`🛒 « ${o.item.name} » acheté : il est dans ton coffre personnel !`, 5000); loadMarket(); }
    };
  });
}

function setupMarket() {
  $('market-rarity').innerHTML = '<option value="all">Toutes les raretés</option>'
    + Rules.RARITIES.map((r) => `<option value="${r}">${Rules.RARITY_INFO[r].label}</option>`).join('');
  $('market-stat').innerHTML = '<option value="all">Toutes les stats</option>'
    + Rules.STATS.filter((s) => s !== 'stamina').map((s) => `<option value="${s}">${Rules.STAT_INFO[s].icon} ${Rules.STAT_INFO[s].label}</option>`).join('');
  for (const id of ['market-rarity', 'market-stat', 'market-sort', 'market-mycls']) $(id).onchange = renderMarket;
  $('market-item').onchange = (e) => { marketItemId = e.target.value; renderMarket(); };
  $('market-price').oninput = renderMarket;
  $('market-sell').onclick = async () => {
    const item = me.character.inventory.find((i) => i.id === marketItemId);
    const price = Math.floor(Number($('market-price').value) || 0);
    if (!item) return;
    const tax = Rules.marketTax(price);
    if (!await confirmBox(`Mettre « ${item.name} » en vente pour ${price} golds ?\nTaxe : ${tax} golds, payée maintenant et non remboursée.\nLa vente dure 4 jours.`)) return;
    const r = await act('/api/market/sell', { itemId: item.id, price }, 'buy');
    if (r) { toast(`🏷️ « ${item.name} » est en vente pour ${price} golds (taxe ${r.tax} 🪙)`, 5000); loadMarket(); }
  };
}
setupMarket();

// ---------- Courrier ----------
function renderMail() {
  const mail = me.character.mail || [];
  const unread = mail.filter((m) => !m.read).length;
  $('mail-count').textContent = unread ? String(unread) : '';
  $('mail-btn').classList.toggle('has-mail', unread > 0);
  $('mail-btn').title = unread ? `${unread} nouveau(x) courrier(s)` : 'Courrier';
  if ($('mail-modal').classList.contains('open')) {
    $('mail-list').innerHTML = mail.length
      ? mail.map((m) => `<div class="mail-item ${m.read ? '' : 'unread'}"><span class="muted">${dateShort(m.at)}</span><div>${esc(m.text)}</div></div>`).join('')
      : '<p class="muted">Aucun courrier. Tu seras prévenu ici quand un joueur achètera un de tes objets.</p>';
  }
}
$('mail-btn').onclick = async () => {
  $('mail-modal').classList.add('open');
  renderMail();
  if (me.character.mail.some((m) => !m.read)) {
    try { await api('/api/mail/read', {}); } catch (e) { /* ignore */ }
  }
};
$('mail-close').onclick = () => { $('mail-modal').classList.remove('open'); };
$('mail-market').onclick = () => { $('mail-modal').classList.remove('open'); showTab('marche'); };

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
  $('training-boss-id').innerHTML = Object.entries(Rules.BOSSES).map(([id, B]) => `<option value="${id}">${B.icon} ${esc(B.name)}</option>`).join('');
  $('training-diff').innerHTML = Object.entries(Rules.BOSS_CHALLENGE).map(([id, D]) => `<option value="${id}">${D.icon} ${D.label}</option>`).join('');
  document.querySelectorAll('[data-tspeed]').forEach((b) => {
    b.onclick = async () => {
      soloSpeed = Number(b.dataset.tspeed);
      try { localStorage.setItem('zl_solo_speed', String(soloSpeed)); } catch (e) { /* ignore */ }
      try { await api('/api/training/speed', { speed: soloSpeed }); } catch (err) { toast('⚠️ ' + err.message); }
    };
  });
  $('training-kind').querySelectorAll('[data-kind]').forEach((b) => {
    b.onclick = () => {
      trainingKind = b.dataset.kind;
      $('training-kind').querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('active', x === b));
      $('training-bot').style.display = trainingKind === 'bot' ? '' : 'none';
      $('training-player').style.display = trainingKind === 'player' ? '' : 'none';
      $('training-boss').style.display = trainingKind === 'boss' || trainingKind === 'rush' ? '' : 'none';
      $('training-boss-id').style.display = trainingKind === 'rush' ? 'none' : '';
      $('training-boss-lbl').style.display = trainingKind === 'rush' ? 'none' : '';
      $('training-start').textContent = trainingKind === 'expedition' ? '🕳️ Lancer l\'expédition' : trainingKind === 'boss' ? '👹 Lancer le défi' : trainingKind === 'rush' ? '💀 Lancer le Boss Rush' : '⚔️ Lancer le duel';
      if (trainingKind === 'player') loadTrainingOpponents();
    };
  });
  $('training-search').oninput = renderTrainingOpponents;
  $('training-start').onclick = async () => {
    ensureTrainingView();
    const body = trainingKind === 'bot'
      ? { opponent: 'bot', cls: $('training-cls').value, level: Number($('training-level').value) }
      : trainingKind === 'player' ? { opponent: 'player', id: $('training-opponent').value }
        : trainingKind === 'boss' ? { opponent: 'boss', boss: $('training-boss-id').value, difficulty: $('training-diff').value, speed: soloSpeed }
          : trainingKind === 'rush' ? { opponent: 'rush', difficulty: $('training-diff').value, speed: soloSpeed }
            : { opponent: 'expedition', speed: soloSpeed };
    try {
      const r = await api('/api/training/start', body);
      $('training-status').textContent = trainingKind === 'expedition' ? 'Expédition d\'entraînement en cours (sans énergie ni récompense)…'
        : trainingKind === 'boss' ? `Défi d'entraînement : ${r.opponent.name} en ${Rules.BOSS_CHALLENGE[r.opponent.difficulty].label}…`
          : trainingKind === 'rush' ? `Boss Rush d'entraînement en ${Rules.BOSS_CHALLENGE[r.opponent.difficulty].label} : tiens le plus longtemps possible !`
          : `Duel contre ${r.opponent.name} (niv. ${r.opponent.level})…`;
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

  // Prix de la fusion (payé à chaque forge, selon la rareté des 3 objets)
  $('fuse-prices').innerHTML = 'Prix d\'une fusion : ' + Rules.RARITIES.map((r) => `<span class="c-${r}">${Rules.RARITY_INFO[r].label} ${Rules.FUSE_PRICE[r]} 🪙</span>`).join(' · ');
  const price = rarity ? Rules.FUSE_PRICE[rarity] : 0;
  const poor = !!rarity && c.gold < price;
  if (rarity) {
    const pity = (c.forgePity || {})[rarity] || 0;
    const chance = Rules.fuseUpgradeChance(rarity, c.derived.luck, pity);
    const luckPart = Rules.fuseUpgradeChance(rarity, c.derived.luck) - Rules.FUSE_UPGRADE[rarity];
    const next = Rules.RARITIES[Rules.RARITIES.indexOf(rarity) + 1];
    $('fuse-info').innerHTML = (next
      ? `🎲 <b>${fr(chance)} %</b> de chances d'obtenir un objet <span class="c-${next}">${Rules.RARITY_INFO[next].label}</span>
         <span class="muted">(${Rules.FUSE_UPGRADE[rarity]} % + ${fr(luckPart)} % grâce à ta chance : ${Rules.FUSE_LUCK_BONUS.toLocaleString('fr-FR')} % par point${pity ? `
         <b class="up">+ ${fr(pity * Rules.FUSE_PITY)} % après ${pity} échec${pity > 1 ? 's' : ''} d'affilée</b>` : ''})</span>
         ${pity ? '' : `<br><span class="muted">Chaque échec ajoute +${Rules.FUSE_PITY} % à ta prochaine fusion <span class="c-${rarity}">${Rules.RARITY_INFO[rarity].label}</span> (jusqu'à la réussite).</span>`}`
      : '🎲 Légendaire : tu obtiendras un nouvel objet <span class="c-legendaire">Légendaire</span>.')
      + `<br>💰 Coût : <b>${price} 🪙</b>${poor ? ` <span class="down">(il te manque ${price - c.gold} 🪙)</span>` : ''}`;
  } else {
    $('fuse-info').innerHTML = '<span class="muted">Choisis 3 objets de même rareté ci-dessous.</span>';
  }
  $('fuse-go').textContent = rarity ? `🔨 Forger ! (${price} 🪙)` : '🔨 Forger !';
  $('fuse-go').disabled = fuseSel.length !== Rules.FUSE_COUNT || poor;
  renderBatch();
  $('fuse-go').title = poor ? `La fusion coûte ${price} golds` : '';

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
  // Rappel des fourchettes de valeur par rareté (relance et alchimie)
  const range = (r) => `<span class="c-${r}">${Rules.RARITY_INFO[r].label} +${Rules.RARITY_INFO[r].min} à +${Rules.RARITY_INFO[r].max}</span>`;
  $('reroll-ranges').innerHTML = 'Valeur d\'une nouvelle ligne : ' + Rules.RARITIES.map(range).join(' · ');
  $('alch-ranges').innerHTML = 'Valeurs normales : ' + Rules.RARITIES.map(range).join(' · ')
    + '<br>Plafond de l\'alchimie : ' + Rules.RARITIES.map((r) => `<span class="c-${r}">${Rules.RARITY_INFO[r].label} ${Rules.alchemyCap(r)}</span>`).join(' · ');
  $('reroll-prices').innerHTML = 'Prix : ' + Rules.RARITIES.map((r) => `<span class="c-${r}">${Rules.RARITY_INFO[r].label} ${Rules.REROLL_PRICE[r]} 🪙</span>`).join(' · ');
  const items = allItems().sort((a, b) => (b.equipped - a.equipped) || Rules.RARITIES.indexOf(b.item.rarity) - Rules.RARITIES.indexOf(a.item.rarity));
  if (!items.some((x) => x.item.id === rerollItemId)) rerollItemId = items[0] ? items[0].item.id : null;
  $('reroll-item').innerHTML = items.length
    ? items.map(({ item, equipped }) => `<option value="${item.id}" ${item.id === rerollItemId ? 'selected' : ''}>${equipped ? '✅ Équipé · ' : ''}${itemType(item).icon} ${esc(item.name)} (${Rules.RARITY_INFO[item.rarity].label})</option>`).join('')
    : '<option>Aucun objet</option>';
  renderRerollPreview();
  renderAlchemy();
}

// ---------- Alchimie noire ----------
let alchItemId = null;
let alchLine = 0;
let alchSacId = null;

function renderAlchemy() {
  const c = me.character;
  const items = allItems().sort((a, b) => (b.equipped - a.equipped) || Rules.RARITIES.indexOf(b.item.rarity) - Rules.RARITIES.indexOf(a.item.rarity));
  if (!items.some((x) => x.item.id === alchItemId)) { alchItemId = items[0] ? items[0].item.id : null; alchLine = 0; }
  $('alch-item').innerHTML = items.length
    ? items.map(({ item, equipped }) => `<option value="${item.id}" ${item.id === alchItemId ? 'selected' : ''}>${equipped ? '✅ Équipé · ' : ''}${itemType(item).icon} ${esc(item.name)} (${Rules.RARITY_INFO[item.rarity].label})</option>`).join('')
    : '<option>Aucun objet</option>';
  const entry = items.find((x) => x.item.id === alchItemId);
  if (!entry) {
    $('alch-lines').innerHTML = ''; $('alch-pick').innerHTML = ''; $('alch-info').innerHTML = ''; $('alch-go').disabled = true;
    return;
  }
  const item = entry.item;
  const cap = Rules.alchemyCap(item.rarity);
  const [gmin, gmax] = Rules.ALCHEMY.gain[item.rarity];
  if (!item.lines[alchLine]) alchLine = 0;
  $('alch-lines').innerHTML = item.lines.map((l, i) => {
    const full = l.value >= cap;
    return `<div class="alch-line ${i === alchLine ? 'active' : ''} ${full ? 'full' : ''}" data-al="${i}">
      <span>${Rules.STAT_INFO[l.stat].icon} <b>+${l.value}${Rules.statUnit(l.stat)}</b> ${Rules.STAT_INFO[l.stat].label}${l.alch ? ' ⚗️' : ''}</span>
      <span class="alch-bar"><i style="width:${Math.min(100, (l.value / cap) * 100)}%"></i></span>
      <span class="muted">${full ? 'MAX' : `${l.value} / ${cap}`}</span></div>`;
  }).join('');
  $('alch-lines').querySelectorAll('[data-al]').forEach((el) => { el.onclick = () => { alchLine = Number(el.dataset.al); renderAlchemy(); }; });

  const sacrifices = c.inventory.filter((i) => i.id !== item.id && i.rarity === item.rarity && !isProtected(i.id));
  if (!sacrifices.some((i) => i.id === alchSacId)) alchSacId = null;
  $('alch-sac-sub').innerHTML = `(${Rules.RARITY_INFO[item.rarity].label}, dans ton coffre)`;
  $('alch-pick').innerHTML = sacrifices.length
    ? sacrifices.map((i) => `<span class="pick-chip rarity-${i.rarity} ${i.id === alchSacId ? 'chosen' : ''}" data-sac="${i.id}" title="${esc(i.lines.map((l) => Rules.formatLine(l.stat, l.value)).join(', '))}">
        ${itemType(i).icon} <span class="c-${i.rarity}">${esc(i.name)}</span></span>`).join('')
    : `<span class="muted">Aucun objet <span class="c-${item.rarity}">${Rules.RARITY_INFO[item.rarity].label}</span> à sacrifier (hors objets protégés par un preset).</span>`;
  $('alch-pick').querySelectorAll('[data-sac]').forEach((el) => {
    el.onclick = () => { alchSacId = alchSacId === el.dataset.sac ? null : el.dataset.sac; Sound.play('chestHit', 2); renderAlchemy(); };
  });

  const line = item.lines[alchLine];
  const price = Rules.ALCHEMY.price[item.rarity];
  const full = line.value >= cap;
  const gain = gmin === gmax ? `+${gmin}` : `+${gmin} à +${gmax}`;
  $('alch-info').innerHTML = full
    ? '⚗️ Cette ligne est déjà au <b>maximum de l\'alchimie</b>.'
    : `⚗️ ${Rules.STAT_INFO[line.stat].label} : <b>${gain}</b> (plafond ${cap}${Rules.statUnit(line.stat)}) · coût <b>${price} 🪙</b>${alchSacId ? '' : ' · <span class="muted">choisis l\'objet à sacrifier</span>'}`;
  $('alch-go').disabled = full || !alchSacId || c.gold < price;
}

$('alch-item').onchange = (e) => { alchItemId = e.target.value; alchLine = 0; alchSacId = null; renderAlchemy(); };
$('alch-go').onclick = async () => {
  const sacrifice = me.character.inventory.find((x) => x.id === alchSacId);
  if (sacrifice && (sacrifice.rarity === 'epique' || sacrifice.rarity === 'legendaire')
    && !await confirmBox(`« ${sacrifice.name} » va être détruit définitivement. Continuer ?`)) return;
  let r;
  opening = true;
  try {
    r = await api('/api/forge/alchemy', { itemId: alchItemId, line: alchLine, sacrificeId: alchSacId });
    me = await api('/api/me');
  } catch (err) {
    opening = false;
    toast('⚠️ ' + err.message);
    return;
  }
  alchSacId = null;
  alchemist.play(r, me.character.cls, () => { opening = false; render(); });
};

function renderRerollPreview(flashIndex) {
  const entry = allItems().find((x) => x.item.id === rerollItemId);
  if (!entry) { $('reroll-preview').innerHTML = ''; return; }
  const item = entry.item;
  const price = Rules.REROLL_PRICE[item.rarity];
  const poor = me.character.gold < price;
  $('reroll-preview').innerHTML = item.lines.map((l, i) => `
    <div class="reroll-line ${i === flashIndex ? 'just-rerolled' : ''}">
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

// « Passer l'animation » (forge et coffres) : un seul réglage, mémorisé dans le navigateur.
const skipAnim = {
  get() { try { return localStorage.getItem('zl_skip_anim') === '1'; } catch (e) { return false; } },
  set(on) { try { localStorage.setItem('zl_skip_anim', on ? '1' : '0'); } catch (e) { /* ignore */ } this.sync(); },
  sync() { const on = this.get(); document.querySelectorAll('[data-skip-anim]').forEach((el) => { el.checked = on; }); },
};
document.querySelectorAll('[data-skip-anim]').forEach((el) => { el.onchange = () => skipAnim.set(el.checked); });
skipAnim.sync();

// Remplir la fusion au hasard : rareté déjà en place, sinon celle du filtre, sinon la plus basse qui a 3 objets.
$('fuse-random').onclick = () => {
  const inv = me.character.inventory;
  const free = (r) => inv.filter((i) => i.rarity === r && !fuseSel.includes(i.id) && !isProtected(i.id));
  const placed = fuseSel.length && inv.find((x) => x.id === fuseSel[0]);
  const rarity = placed ? placed.rarity
    : fuseFilter !== 'all' ? fuseFilter
      : Rules.RARITIES.find((r) => free(r).length >= Rules.FUSE_COUNT);
  const pool = rarity ? free(rarity) : [];
  if (fuseSel.length + pool.length < Rules.FUSE_COUNT) { toast(`⚠️ Pas assez d'objets ${rarity ? Rules.RARITY_INFO[rarity].label.toLowerCase() + 's ' : ''}non protégés`); return; }
  while (fuseSel.length < Rules.FUSE_COUNT) fuseSel.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id);
  Sound.play('chestHit', 3);
  renderForge();
};

// Forge en série
let batchRarity = null;
function batchAvailable(rarity) {
  return me.character.inventory.filter((i) => i.rarity === rarity && !isProtected(i.id)).length;
}
function batchMax(rarity) {
  const price = Rules.FUSE_PRICE[rarity];
  return Math.min(Rules.FUSE_BATCH_MAX, Math.floor(batchAvailable(rarity) / Rules.FUSE_COUNT), Math.floor(me.character.gold / price));
}
function renderBatch() {
  const sel = $('batch-rarity');
  if (!batchRarity) batchRarity = Rules.RARITIES.find((r) => batchAvailable(r) >= Rules.FUSE_COUNT) || 'commun';
  sel.innerHTML = Rules.RARITIES.map((r) => `<option value="${r}" ${r === batchRarity ? 'selected' : ''}>${Rules.RARITY_INFO[r].label} (${batchAvailable(r)})</option>`).join('');
  const max = batchMax(batchRarity);
  const input = $('batch-count');
  input.max = Math.max(1, max);
  let n = Math.floor(Number(input.value)) || 1;
  if (max >= 1 && n > max) { n = max; input.value = n; }
  const price = Rules.FUSE_PRICE[batchRarity];
  const objs = n * Rules.FUSE_COUNT;
  const avail = batchAvailable(batchRarity);
  const chance = Rules.fuseUpgradeChance(batchRarity, me.character.derived.luck, (me.character.forgePity || {})[batchRarity]);
  const next = Rules.RARITIES[Rules.RARITIES.indexOf(batchRarity) + 1];
  let why = '';
  if (avail < objs) why = `il te faut ${objs} objets, tu en as ${avail}`;
  else if (me.character.gold < n * price) why = `il te manque ${n * price - me.character.gold} 🪙`;
  $('batch-info').innerHTML = `${n} fusion${n > 1 ? 's' : ''} : <b>${objs} objets</b> détruits, <b>${n * price} 🪙</b>`
    + (next ? ` · ${fr(chance)} % de chances de <span class="c-${next}">${Rules.RARITY_INFO[next].label}</span> à la première fusion (+${Rules.FUSE_PITY} % après chaque échec, retour à la normale après une réussite)` : '')
    + (why ? ` · <span class="down">${why}</span>` : '');
  $('batch-go').disabled = !!why;
}
$('batch-rarity').onchange = (e) => { batchRarity = e.target.value; renderBatch(); };
$('batch-count').oninput = () => renderBatch();
$('batch-max').onclick = () => { $('batch-count').value = Math.max(1, batchMax(batchRarity)); renderBatch(); };
$('batch-go').onclick = async () => {
  const n = Math.floor(Number($('batch-count').value)) || 1;
  const label = Rules.RARITY_INFO[batchRarity].label.toLowerCase();
  if (!await confirmBox(`${n * Rules.FUSE_COUNT} objets ${label}s tirés au hasard (jamais un objet verrouillé ou dans un preset) vont être détruits définitivement pour ${n} fusion${n > 1 ? 's' : ''}. Continuer ?`)) return;
  let r;
  opening = true;
  try {
    r = await api('/api/forge/batch', { rarity: batchRarity, count: n });
    me = await api('/api/me');
  } catch (err) {
    opening = false;
    toast('⚠️ ' + err.message);
    return;
  }
  fuseSel.length = 0;
  forge.playBatch(r, me.character.cls, () => { opening = false; render(); pityToast(r.results[r.results.length - 1]); }, skipAnim.get());
};

$('reroll-item').onchange = (e) => { rerollItemId = e.target.value; renderRerollPreview(); };
$('fuse-clear').onclick = () => { fuseSel.length = 0; renderForge(); };
$('fuse-go').onclick = async () => {
  const inputs = fuseSel.map((id) => me.character.inventory.find((x) => x.id === id));
  if (inputs.some((i) => i.rarity === 'epique' || i.rarity === 'legendaire')
    && !await confirmBox('Ces objets vont être détruits définitivement. Continuer ?')) return;
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
  forge.play(inputs, r, me.character.cls, () => { opening = false; render(); pityToast(r); }, skipAnim.get());
};

// Après un échec : la prochaine fusion de cette rareté aura +1 % de réussite
function pityToast(r) {
  if (!r || r.upgraded || !r.pity) return;
  const chance = Rules.fuseUpgradeChance(r.from, me.character.derived.luck, r.pity);
  toast(`🍀 Raté… ta prochaine fusion « ${Rules.RARITY_INFO[r.from].label} » aura ${fr(chance)} % de réussite (+${r.pity * Rules.FUSE_PITY} %)`, 5000);
}

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
    (un <b>TRIPLE KILL</b> est aussi annoncé, sans bonus). Ces montants sont les mêmes pour tout le monde, quelle que soit
    la puissance : ce sont les combats qui sont équilibrés (voir juste en dessous).`;
  const P = Rules.POWER;
  const ex = (mine, theirs) => { const m = Rules.powerUnderdog(theirs, mine); return `<tr><td>${mine}</td><td>${theirs}</td><td><b>${m > 1 ? `×${String(m).replace('.', ',')}` : '—'}</b></td>
    <td>${m > 1 ? `vie et dégâts ×${String(m).replace('.', ',')}` : 'aucun bonus'}</td></tr>`; };
  $('power-rules').innerHTML = `
    <p>Pour que tout le monde ait sa chance, les combats du <b>Battle Royale</b>, du <b>Roi de la Colline</b> et de la
      <b>Guerre des clans</b> sont équilibrés selon la <b>puissance</b> des combattants :</p>
    <ul class="rules-list">
      <li><b>💪 Puissance</b> = ton niveau + le total des % de ton équipement ÷ ${P.gearDivisor} (bonus de classe compris).
        Elle est affichée sur ta fiche et recalculée au lancement de chaque partie.</li>
      <li><b>Bonus du plus faible</b> : au lancement, si ta puissance est inférieure à la <b>puissance moyenne des autres
        combattants</b>, ta vie et tes dégâts sont multipliés par <b>√(puissance adverse ÷ ta puissance)</b>, jusqu'à
        <b>×${String(P.underdog).replace('.', ',')}</b>. Les plus forts ne sont jamais affaiblis.</li>
      <li>En <b>Guerre des clans</b>, c'est l'équipe entière la plus faible (puissance totale) qui est renforcée.</li>
      <li>Les <b>récompenses</b> sont les mêmes pour tous, quelle que soit la puissance (×2 avec le Loot double).</li>
    </ul>
    <table class="loot-table"><tr><th>Ta puissance</th><th>Moyenne des autres</th><th>Bonus</th><th>Effet</th></tr>
      ${ex(20, 20)}${ex(20, 30)}${ex(15, 30)}${ex(10, 60)}${ex(60, 30)}</table>
    <p>Sur le stream, un combattant renforcé porte la mention <b>⬆️ ×…</b> sous son nom.</p>`;
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
  const Mi = Rules.BOSSES.mimic;
  const Li = Rules.BOSSES.liche;
  const Ma = Rules.BOSSES.maexxna;
  const exOf = (id) => Rules.bossStats(10, id).maxHp.toLocaleString('fr-FR');
  $('boss-others').innerHTML += block(Mi, [
    `${Mi.hpBase} PV + ${Mi.hpPerPlayer} par combattant (10 → ${exOf('mimic')} PV). Ses morsures touchent aussi les voisins de sa cible.`,
    `Toutes les ${String(Mi.specialEvery).replace('.', ',')} s : il <b>vomit</b> en cône le contenu de son ventre, puis <b>bondit</b> sur le héros le plus éloigné. Le vomi change à chaque fois : ${Object.values(Mi.vomit.loot).map((L) => `${L.icon} <b>${L.label}</b>`).join(', ')} (dégâts, saignement, poison et ralentissement, ou héros assommés).`,
    `À <b>75 %</b>, <b>50 %</b> et <b>25 %</b>, il <b>copie un héros</b> au hasard : ${Mi.copies.counts.join(', puis ')} copies de <b>niveau 1</b> (sa classe, sans équipement). Tant qu'une copie est debout, il subit <b>${pct(1 - Mi.copies.guard)} de dégâts en moins</b> !`,
  ]) + block(Li, [
    `${Li.hpBase} PV + ${Li.hpPerPlayer} par combattant (10 → ${exOf('liche')} PV). Elle attaque <b>de loin</b> avec des éclats de glace et se téléporte de temps en temps.`,
    `Elle <b>gèle</b> des héros pendant ${Li.freeze.duration} s, puis recommence ${Li.freeze.gap} s plus tard : <b>1</b> héros à la fois, puis <b>2</b> sous 66 %. Un héros gelé ne bouge plus, n'attaque plus, ne remplit plus sa stamina et perd ${Li.freeze.dps} PV par seconde, mais <b>personne ne peut le toucher</b> et on peut le soigner.`,
    `Toutes les ${String(Li.specialEvery).replace('.', ',')} s : <b>pics de glace</b> sous quelques héros, puis <b>nova de givre</b> autour d'elle (dégâts et ralentissement).`,
    `À <b>33 %</b>, elle <b>relève tous les héros morts</b> depuis le début pour se défendre (${pct(Li.raise.hpRatio)} de leurs stats) : ils s'effondrent si elle meurt. Si personne n'est tombé, elle gèle <b>3</b> héros, puis 2.`,
  ]) + block(Ma, [
    `${Ma.hpBase} PV + ${Ma.hpPerPlayer} par combattant (10 → ${exOf('maexxna')} PV). Chaque morsure <b>empoisonne</b> (${pct(Ma.poison.dot)} de la vie par seconde pendant ${Ma.poison.duration} s).`,
    `Elle tisse des <b>toiles</b> partout : un héros dedans est <b>ralenti de ${pct(1 - Ma.webs.slow)}</b>. Toutes les ${Ma.specialEvery} s : <b>jet de toile</b> sur le plus gros groupe, puis <b>crachat de venin</b> en cône. Une <b>nuée d'araignées</b> venimeuses arrive toutes les ${Ma.spiders.every} s.`,
    `À <b>70 %</b> et <b>20 %</b>, elle enferme des héros dans des <b>cocons</b> : brisez-les pour libérer vos alliés (sinon ils cèdent seuls au bout de ${Ma.cocoon.hold} s, après avoir bien souffert).`,
    `À <b>45 %</b>, elle remonte <b>au plafond</b> ${Ma.ceiling.duration} s : pluie de toiles et de venin, et une grosse nuée. Elle redescend plus rapide, et entre en <b>frénésie</b> sous 20 %.`,
  ]);
  const Et = Rules.BOSSES.ether;
  const Ll = Rules.BOSSES.lilith;
  const Da = Rules.BOSSES.daedra;
  $('boss-others').innerHTML += block(Et, [
    `${Et.hpBase} PV + ${Et.hpPerPlayer} par combattant (10 → ${exOf('ether')} PV). Insaisissable : il <b>esquive ${pct(Et.dodge)}</b> des coups (la Précision aide beaucoup) et <b>riposte</b> aussitôt une fois sur trois.`,
    `Toutes les ${String(Et.specialEvery).replace('.', ',')} s : <b>hurlement</b> autour de lui (dégâts et effroi qui ralentit), <b>chaînes spectrales</b> vers quelques héros (ils restent étourdis ${Et.chains.stun} s), puis <b>moisson d'âmes</b> sous leurs pieds (il se soigne de la moitié des dégâts).`,
    `À <b>70 %</b> et <b>35 %</b>, il devient <b>intangible</b> ${Et.intangible.duration} s : plus rien ne le touche, et des <b>mains spectrales</b> jaillissent sous les héros pour les agripper. Chaque main détruite le fait revenir ${String(Et.intangible.shorten).replace('.', ',')} s plus tôt.`,
    `À <b>50 %</b>, des <b>feux follets</b> errent dans l'arène et explosent au contact ; sous <b>15 %</b>, il entre en <b>furie</b> (encore plus d'esquive, coups plus rapides).`,
  ]) + block(Ll, [
    `${Ll.hpBase} PV + ${Ll.hpPerPlayer} par combattant (10 → ${exOf('lilith')} PV). Rapide, ses griffes touchent aussi les voisins de sa cible.`,
    `Toutes les ${Ll.specialEvery} s, à tour de rôle : <b>bond</b> sur le héros le plus éloigné, <b>éventail de cartes</b> tranchantes (saignement), <b>disparition</b> (seul son sourire flotte… puis elle frappe dans le dos), et <b>bonneteau</b> : les héros <b>échangent leurs places</b> et restent sonnés un instant.`,
    `À <b>75 %</b> et <b>40 %</b>, elle se <b>multiplie</b> (${Ll.illusions.counts.join(' puis ')} illusions <b>indiscernables</b>). Brisez-les toutes en ${Ll.illusions.duration} s : elle est <b>étourdie</b> (+${pct(Ll.illusions.dazedTaken - 1)} de dégâts subis). Sinon, elles <b>explosent</b> !`,
    `À <b>50 %</b>, un <b>chapeau magique</b> fait sortir des chatons tant qu'il tient ; à <b>10 %</b>, sa <b>neuvième vie</b> la relève avec ${pct(Ll.ninelives.heal)} de vie, plus vive que jamais.`,
  ]) + block(Da, [
    `${Da.hpBase} PV + ${Da.hpPerPlayer} par combattant (10 → ${exOf('daedra')} PV). Son <b>fouet de feu</b> frappe de très loin et <b>brûle</b>. Des <b>démons de feu</b> arrivent toutes les ${Da.demons.every} s.`,
    `Toutes les ${String(Da.specialEvery).replace('.', ',')} s : <b>colonnes de feu</b> qui traversent toute l'arène et <b>séparent les héros</b> (impossible de les franchir pendant ${Da.pillars.life} s, elles brûlent), <b>fouet infernal</b> en cône, puis <b>cercle infernal</b> qui enferme un héros avant d'<b>exploser</b>.`,
    `À <b>66 %</b>, trois <b>portails infernaux</b> s'ouvrent autour d'elle : elle subit <b>${pct(1 - Da.portals.guard)} de dégâts en moins</b> tant qu'ils tiennent, et ils crachent des démons.`,
    `À <b>33 %</b>, elle s'élève et <b>embrase l'arène</b> ${Da.inferno.duration} s (colonnes de feu partout, pluie de flammes) ; sous <b>15 %</b>, <b>furie</b> : fouet plus long et plus rapide, démons sans arrêt.`,
  ]);
  $('boss-others').querySelectorAll('.boss-mini').forEach((cv) => {
    const kind = cv.dataset.kind;
    const conf = { dragon: [66, 76, 0.48], mimic: [62, 90, 0.62], maexxna: [64, 96, 0.5], ether: [60, 92, 0.62], lilith: [58, 86, 0.6], daedra: [60, 96, 0.62] }[kind] || [60, 84, 0.8];
    drawMonster(cv.getContext('2d'), conf[0], conf[1], { kind }, { scale: conf[2], t: 0 });
  });
  const RU = Rules.RUSH;
  $('rush-rules').innerHTML = [
    `Un boss tiré au hasard ouvre la run (chacun passe une fois avant de revenir, jamais deux fois de suite). Le boss n°k a <b>+${pct(RU.hpPerRound)} de vie</b> par boss déjà passé, et ses <b>dégâts montent de plus en plus vite</b> : ×${[5, 10, 15].map((k) => `${String(Math.round(Rules.rushScale(k).damage * 10) / 10).replace('.', ',')} au ${k}<sup>e</sup>`).join(', ')}.`,
    `Après chaque boss vaincu, le chat vote ${RU.poll.duration} s (<code>!1</code>, <code>!2</code>, <code>!3</code>, ou sur le site) : <b>🎲 un bonus</b> tiré au hasard pour le reste de la run (le même ${RU.boonMax} fois au plus), <b>👼 une résurrection</b> (un héros tombé au hasard, à ${pct(RU.revive)} de sa vie ; ou <b>💖 un grand soin</b> si personne n'est tombé), ou <b>💀 Quitte ou double</b> : boss suivants <b>×${String(RU.defiMult).replace('.', ',')}</b>, mais ${RU.defiGold} golds et ${RU.defiXp} XP par boss vaincu tout de suite pour tous.`,
    `Les survivants récupèrent ${pct(RU.healBetween)} de leur vie entre deux boss. La run s'arrête quand <b>tout le monde est tombé</b> (ou qu'un boss tient ${Math.floor(300 / 60)} min).`,
    `Chaque boss vaincu compte pour ses succès et peut laisser un <b>familier</b> (5 %).`,
  ].map((x) => `<li>${x}</li>`).join('');
  $('rush-rewards').innerHTML = '<tr><th>Boss vaincus</th><th>XP</th><th>Golds</th><th>Coffres</th></tr>'
    + [1, 2, 3, 5, 8].map((n) => { const r = Rules.rushReward(n); return `<tr><td><b>${n}</b></td><td>+${r.xp} XP</td><td>+${r.gold} 🪙</td><td>+${r.chests} <i class="ico-chest"></i></td></tr>`; }).join('')
    + '<tr><td colspan="4" class="muted" style="font-size:12px">Pour TOUS les participants, morts ou vivants (+ l\'XP de participation).</td></tr>';
  $('rush-boons').innerHTML = Object.values(Rules.RUSH_BOONS).map((b) => `<tr><td style="color:${b.color}"><b>${b.icon} ${b.label}</b></td><td>${b.desc}</td></tr>`).join('');
  const R = B.reward;
  $('boss-rewards').innerHTML = `<tr><th>Résultat</th><th>XP</th><th>Golds</th><th>Coffres</th></tr>
    <tr><td><b>🏆 Boss vaincu</b><div class="muted" style="font-size:12px">Pour TOUS les participants, morts ou vivants</div></td>
      <td>+${R.xp} XP</td><td>+${R.gold} 🪙</td><td>+${R.chests} <i class="ico-chest"></i></td></tr>
    <tr><td><b>💀 Tout le monde est tombé</b><div class="muted" style="font-size:12px">Seulement l'XP de participation</div></td>
      <td>+${Rules.COOP_PARTICIPATION.xp} XP</td><td>—</td><td>—</td></tr>`;

  const M = Rules.MONSTERS;
  const monsters = Object.values(M).map((m) => `${m.icon} ${m.label}${m.poison ? ' (venimeux ☠️)' : ''}${m.from > 1 ? ` (dès la salle ${m.from})` : ''}`).join(', ');
  $('dungeon-rules').innerHTML = [
    `Les aventuriers entrent par la gauche, éliminent tous les monstres de la salle, puis sortent à droite vers la salle suivante.`,
    `Monstres : ${monsters}. Toutes les ${Rules.ELITE.every} salles, un <b>chef 👑</b> beaucoup plus costaud les accompagne.`,
    `À chaque salle, les monstres sont <b>plus nombreux</b> et plus forts (+${pct(D.hpPerRoom)} de vie et +${pct(D.damagePerRoom)} de dégâts par salle). Leur nombre dépend du nombre d'aventuriers au départ.`,
    `<b>Pas de réapparition</b> : un aventurier tombé est éliminé du raid. Entre deux salles, les survivants récupèrent <b>${pct(D.healBetweenRooms)}</b> de leur vie.`,
    `Après ${D.enrageAt} s dans la même salle, les monstres s'énervent (+${pct(D.enrageRate)} de dégâts par seconde).`,
    `🗳️ <b>Sondage du chat</b> : après chaque salle de chef, le combat se met en pause ${Rules.DUNGEON_POLL.duration} s et <b>tout le monde</b> (même sans jouer) vote entre deux bonus tirés au hasard, avec leur commande dans le chat (ou <b>!1</b> / <b>!2</b>) ou avec les boutons de cette page. Une voix par personne, le dernier vote compte. Les bonus de combat durent jusqu'au sondage suivant.`,
    `Le raid s'arrête quand tout le monde est tombé. <b>Tout le monde</b> reçoit la récompense de la salle atteinte, plus ${Rules.COOP_PARTICIPATION.xp} XP de participation.`,
  ].map((x) => `<li>${x}</li>`).join('');
  $('dungeon-boons').innerHTML = Object.values(Rules.DUNGEON_BOONS).map((b) =>
    `<tr><td style="color:${b.color};white-space:nowrap"><b>${b.icon} ${b.label}</b></td><td><code>${b.cmd}</code></td><td>${b.desc}</td></tr>`).join('');
  const tiers = [5, 10, 15, 20, 25, 30].map((room) => Rules.dungeonReward(room));
  $('dungeon-rewards').innerHTML = '<tr><th>Salle atteinte</th><th>XP</th><th>Golds</th><th>Coffres</th></tr>'
    + `<tr><td><b>Salles 1 à 4</b></td><td>+${Rules.COOP_PARTICIPATION.xp} XP <span class="muted">(participation)</span></td><td>—</td><td>—</td></tr>`
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
  const CL = Rules.CLANS;
  $('clans-rules').innerHTML = [
    `Tape <b>!rouge</b> ou <b>!bleu</b> dans le chat (ou clique sur le bouton de l'équipe) pour choisir ton camp ; <b>!join</b> te place dans l'équipe la moins nombreuse. On peut changer d'avis tant que la bataille n'a pas commencé.`,
    `Chaque équipe a un <b>cristal</b> dans son camp, qui tire sur les ennemis proches. Détruire le cristal adverse = <b>victoire</b>.`,
    `Les combattants foncent vers le cristal adverse, mais défendent le leur et répondent à qui les attaque.`,
    `Les morts <b>reviennent</b> dans leur camp : 5 s après la première mort, puis <b>5 s de plus à chaque mort</b> (${CL.respawn.max} s au plus).`,
    `L'équipe la plus <b>faible</b> (puissance totale de ses membres, pas leur nombre) est renforcée : vie et dégâts × √(puissance forte ÷ puissance faible), jusqu'à ×${String(CL.underdog).replace('.', ',')}.`,
    `À ${Math.floor(CL.overtimeAt / 60)} min ${CL.overtimeAt % 60} s, <b>mort subite</b> : les cristaux prennent ×${CL.overtimeMult}. Au bout de ${CL.duration / 60} min, le cristal le moins entamé gagne.`,
    `Chaque membre de l'équipe gagnante : <b>+${CL.reward.xp} XP, +${CL.reward.gold} golds, +${CL.reward.chests} coffre</b> ; le <b>MVP</b> (le plus de dégâts) gagne 1 coffre de plus. Les paris se font sur une <b>équipe</b>.`,
  ].map((x) => `<li>${x}</li>`).join('');
  const cc = $('clans-portrait').getContext('2d');
  drawMonster(cc, 34, 92, { kind: 'cristal_clan' }, { scale: 0.8, t: 0, color: CL.teams.rouge.color });
  drawMonster(cc, 136, 92, { kind: 'cristal_clan' }, { scale: 0.8, t: 0, color: CL.teams.bleu.color });
  drawFighter(cc, 70, 80, { name: 'Rouge', cls: 'guerrier', look: {} }, { scale: 1.3 });
  drawFighter(cc, 100, 80, { name: 'Bleu', cls: 'assassin', look: {} }, { scale: 1.3, facing: -1 });
  const G = Rules.GOLD;
  $('gold-rules').innerHTML = [
    `<b>Mode bonus de ${G.duration} s</b>, sans combat : les personnages se baladent sur l'arène et ramassent tout ce qui tombe du ciel. Chaque pièce = <b>1 gold</b>.`,
    `Plus rares : des <b>coffres</b> en parachute, et des bonus : 💰 <b>Sac d'or</b> (+${G.items.kinds.sac.gold} golds), 🧲 <b>Aimant</b> (ramassage ×${G.items.kinds.aimant.pickupMult}), ⭐ <b>Étoile</b> (vitesse ×${String(G.items.kinds.etoile.speedMult).replace('.', ',')}).`,
    `Ta <b>Chance</b> agrandit ton rayon de ramassage, ta <b>Vitesse</b> te fait parcourir plus de terrain.`,
    `Les ${G.duration - G.jackpotAt} dernières secondes : <b>JACKPOT</b>, pluie ×${G.jackpot.rain} et pièces à ${G.jackpot.value} golds !`,
    `À la fin, chacun <b>garde tout ce qu'il a ramassé</b> ; le meilleur ramasseur gagne 1 coffre de plus. Pas de paris, et ta potion n'est pas consommée.`,
  ].map((x) => `<li>${x}</li>`).join('');
  const gc = $('gold-portrait').getContext('2d');
  drawFighter(gc, 75, 78, { name: 'Riche', cls: 'mage', look: {} }, { scale: 1.5 });
  gc.font = '20px "Segoe UI Emoji", sans-serif';
  [[20, 30], [120, 24], [40, 70], [118, 66], [70, 18], [96, 96], [28, 100]].forEach(([x, y]) => gc.fillText('🪙', x, y));
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

// ---------- Lieux et onglets ----------
// La carte du monde (onglet « carte ») mène à des lieux ; un lieu regroupe un ou plusieurs onglets (ses sous-onglets).
// L'adresse (#onglet) reste celle de l'onglet, si bien que les anciens liens (#solo, #casino…) marchent toujours.
const PLACES = [
  { id: 'heros', icon: '🧙', label: 'Personnage', desc: 'Ta fiche, ton équipement, tes compétences et ton style de combat',
    tabs: [['perso', '🧙', 'Fiche'], ['inventaire', '🎒', 'Équipement'], ['arbre', '🌳', 'Compétences'], ['combat', '⚔️', 'Combat']] },
  { id: 'maison', icon: '🏠', label: 'Maison', desc: 'Décore ta maison, relève ton courrier, visite tes voisins', tabs: [['maison', '🏠', 'Maison']] },
  { id: 'niche', icon: '🐾', label: 'Niche', desc: 'Tes familiers, leur enclos et leurs trouvailles', tabs: [['familier', '🐾', 'Familiers']] },
  { id: 'commerce', icon: '🛍️', label: 'Place du marché', desc: 'La boutique et le marché entre joueurs', tabs: [['boutique', '🛍️', 'Boutique'], ['marche', '🏪', 'Marché']] },
  { id: 'donjon', icon: '🕳️', label: 'Donjon', desc: 'Mode Solo : Expédition et Défi des boss', tabs: [['solo', '🕳️', 'Solo']] },
  { id: 'gym', icon: '🏋️', label: 'Gymnase', desc: 'Entraînement sans risque : duels, boss, Boss Rush', tabs: [['entrainement', '🏋️', 'Entraînement']] },
  { id: 'casino', icon: '🎰', label: 'Casino', desc: 'Neuf jeux tenus par les boss en smoking', tabs: [['casino', '🎰', 'Casino']] },
  { id: 'peche', icon: '🎣', label: 'Ponton de pêche', desc: 'Pêche tranquille et Pêchédex', tabs: [['peche', '🎣', 'Pêche']] },
  { id: 'survivor', icon: '🧟', label: 'Terres sauvages', desc: 'Survivor : tiens le plus de vagues possible', tabs: [['survivor', '🧟', 'Survivor']] },
  { id: 'hall', icon: '🏆', label: 'Hall des héros', desc: 'Classements, succès, statistiques et historique',
    tabs: [['classements', '🏆', 'Classements'], ['succes', '🏅', 'Succès'], ['statistiques', '📊', 'Stats'], ['historique', '📜', 'Historique']] },
  { id: 'taverne', icon: '🍺', label: 'Taverne', desc: 'Le tchat : discute avec tous les joueurs, émotes des boss comprises', tabs: [['tchat', '💬', 'Tchat']] },
  { id: 'guide', icon: '📖', label: 'Guide', desc: 'Toutes les règles du jeu', tabs: [['regles', '📖', 'Règles']] },
  { id: 'arene', icon: '📺', label: 'Arène en direct', desc: 'Le combat du stream, en direct (nouvel onglet)', href: '/arena.html' },
];
const TABS = ['carte', ...PLACES.flatMap((p) => (p.tabs || []).map((t) => t[0]))];
const placeOf = (tab) => PLACES.find((p) => p.tabs && p.tabs.some((t) => t[0] === tab)) || null;
let tabBadges = {}; // pastille de chaque onglet (renderBadges)
let lastSub = {}; // dernier sous-onglet ouvert de chaque lieu
try { lastSub = JSON.parse(localStorage.getItem('zl_sub') || '{}') || {}; } catch (e) { lastSub = {}; }
let currentTab = null;

const placeBadge = (p) => (p.tabs || []).reduce((n, t) => n + (tabBadges[t[0]] || 0), 0);
function goPlace(id) {
  const p = PLACES.find((x) => x.id === id);
  if (!p) return;
  closePlaceMenu();
  if (p.href) { window.open(p.href, '_blank'); return; }
  const sub = lastSub[p.id] && p.tabs.some((t) => t[0] === lastSub[p.id]) ? lastSub[p.id] : p.tabs[0][0];
  showTab(sub);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Barre du haut : bouton Carte, lieu actuel (ouvre le menu des lieux) et sous-onglets du lieu
function renderPlaceBar() {
  const p = placeOf(currentTab);
  $('pb-ico').textContent = p ? p.icon : '🧭';
  $('pb-name').textContent = p ? p.label : 'Aller à…';
  const other = PLACES.reduce((n, x) => n + (x === p ? 0 : placeBadge(x)), 0);
  const pb = $('pb-badge');
  pb.textContent = other || '';
  pb.classList.toggle('on', other > 0);
  document.querySelector('#place-bar .pb-map').classList.toggle('active', currentTab === 'carte');
  const sub = $('pb-sub');
  sub.innerHTML = p && p.tabs.length > 1 ? p.tabs.map(([id, ico, label]) => {
    const n = tabBadges[id] || 0;
    const locked = id === 'arbre' && window.talentLocked;
    return `<button type="button" role="tab" data-tab="${id}" class="${id === currentTab ? 'active' : ''} ${locked ? 'locked-tab' : ''}" aria-selected="${id === currentTab}">
      <span class="pb-ico">${ico}</span><span class="pb-sub-label">${label}</span><span class="tab-badge ${n ? 'on' : ''}">${n || ''}</span></button>`;
  }).join('') : '';
  sub.classList.toggle('empty', !sub.innerHTML);
  sub.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
  const act = sub.querySelector('.active');
  if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'center' });
  if (window.WorldMap) WorldMap.setBadges(Object.fromEntries(PLACES.map((x) => [x.id, placeBadge(x)])));
  if ($('place-menu').classList.contains('open')) renderPlaceMenu();
}

// Menu des lieux : tous les lieux d'un coup d'œil, pour qui préfère aller droit au but
function renderPlaceMenu() {
  const cur = placeOf(currentTab);
  $('place-menu').innerHTML = `<button type="button" class="pm-item ${currentTab === 'carte' ? 'active' : ''}" data-go="carte"><span class="pm-ico">🗺️</span><span class="pm-text"><b>Carte du monde</b><small>Tous les lieux sur la carte</small></span></button>`
    + PLACES.map((p) => {
      const n = placeBadge(p);
      return `<button type="button" class="pm-item ${p === cur ? 'active' : ''}" data-place="${p.id}"><span class="pm-ico">${p.icon}</span>
        <span class="pm-text"><b>${p.label}${p.href ? ' ↗' : ''}</b><small>${p.desc}</small></span><span class="tab-badge ${n ? 'on' : ''}">${n || ''}</span></button>`;
    }).join('');
  $('place-menu').querySelectorAll('[data-place]').forEach((b) => { b.onclick = () => goPlace(b.dataset.place); });
  $('place-menu').querySelector('[data-go]').onclick = () => { closePlaceMenu(); showTab('carte'); };
}
function closePlaceMenu() { $('place-menu').classList.remove('open'); $('pb-current').setAttribute('aria-expanded', 'false'); }
$('pb-current').onclick = (e) => {
  e.stopPropagation();
  const open = !$('place-menu').classList.contains('open');
  if (open) renderPlaceMenu();
  $('place-menu').classList.toggle('open', open);
  $('pb-current').setAttribute('aria-expanded', String(open));
};
document.addEventListener('click', (e) => { if (!e.target.closest('#place-menu') && !e.target.closest('#pb-current')) closePlaceMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePlaceMenu(); });
document.querySelector('#place-bar .pb-map').onclick = () => { showTab('carte'); window.scrollTo({ top: 0, behavior: 'smooth' }); };

function showTab(name) {
  if (!TABS.includes(name)) name = 'carte';
  currentTab = name;
  document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.dataset.tab === name));
  const p = placeOf(name);
  if (p) { lastSub[p.id] = name; try { localStorage.setItem('zl_sub', JSON.stringify(lastSub)); } catch (e) { /* ignore */ } }
  try { localStorage.setItem('zl_tab', name); } catch (e) { /* ignore */ }
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  renderPlaceBar();
  if (name === 'carte') WorldMap.enter(); else WorldMap.leave();
  if (name !== 'solo') GameScreen.exit($('solo-screen'));
  if (name !== 'entrainement') GameScreen.exit($('training-screen'));
  if (name === 'arbre' && me) renderTalents(); // la largeur de l'arbre ne se mesure qu'onglet affiché
  if (name === 'marche' && me) loadMarket();
  if (name === 'familier' && me) renderPets();
  if (name === 'casino') Casino.enter(); else Casino.leave();
  if (name === 'survivor') Survivor.enter(); else Survivor.leave();
  if (name === 'maison') Housing.enter(); else Housing.leave();
  if (name === 'peche') Fishing.enter(); else Fishing.leave();
  if (name === 'tchat') { closeChatPop(); Chat.markRead(); Chat.scrollDown(); }
  $('chat-bubble').classList.toggle('hidden', name === 'tchat');
}

// ---------- Tchat ----------
// Lieu Taverne (vue complète) et bulle flottante (vue compacte) ; pastilles : messages non lus et @mentions.
function closeChatPop() { $('chat-pop').classList.remove('open'); }
Chat.visible = () => currentTab === 'tchat' || $('chat-pop').classList.contains('open');
Chat.onChange = () => {
  if (Chat.visible()) { if (Chat.unread) Chat.markRead(); return; }
  const n = Chat.unread;
  const b = $('chat-bubble-n');
  b.textContent = n > 99 ? '99+' : n || '';
  b.classList.toggle('on', n > 0);
  $('chat-bubble').classList.toggle('mention', Chat.mentions > 0);
  if (me) renderBadges();
};
$('chat-bubble').onclick = () => {
  const open = !$('chat-pop').classList.contains('open');
  $('chat-pop').classList.toggle('open', open);
  if (open) { Chat.markRead(); Chat.onChange(); Chat.scrollDown(); const inp = $('chat-pop').querySelector('.ct-input'); if (inp && window.innerWidth > 700) inp.focus(); }
};
$('chat-pop-close').onclick = closeChatPop;
$('chat-pop-big').onclick = () => { closeChatPop(); showTab('tchat'); window.scrollTo({ top: 0, behavior: 'smooth' }); };

WorldMap.init(PLACES, goPlace);
// Téléphone : le son et la déconnexion passent dans un petit menu ⚙️ du bandeau
$('hdr-tools-btn').onclick = (e) => {
  e.stopPropagation();
  const open = !$('hdr-tools').classList.contains('open');
  $('hdr-tools').classList.toggle('open', open);
  $('hdr-tools-btn').setAttribute('aria-expanded', String(open));
};
document.addEventListener('click', (e) => { if (!e.target.closest('#hdr-tools') && !e.target.closest('#hdr-tools-btn')) $('hdr-tools').classList.remove('open'); });
window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
showTab(location.hash.slice(1) || (() => { try { return localStorage.getItem('zl_tab'); } catch (e) { return null; } })() || 'carte');

// Pastilles sur les onglets : points à répartir, coffres à ouvrir, succès à récupérer.
function renderBadges() {
  const c = me.character;
  const claim = Rules.ACHIEVEMENTS.filter((a) => { const st = Rules.achievementState(c, a); return st.done && !st.claimed; }).length;
  const set = (tab, n) => { tabBadges[tab] = Math.max(0, n || 0); };
  set('perso', c.skillPoints);
  set('inventaire', c.chests);
  set('arbre', Math.max(0, c.talentState.available));
  set('combat', Math.max(0, Rules.techSlots(c.level) - c.techs.length));
  set('solo', c.cls && !c.soloActive ? Rules.energyState(c.energy, Date.now()).value : 0);
  set('marche', (c.mail || []).filter((m) => !m.read).length);
  set('familier', window.petFindsWaiting ? petFindsWaiting() : 0);
  set('maison', c.house ? Rules.houseMailDue(c.house.mailAt) : 0); // courriers qui attendent dans la boîte aux lettres
  set('succes', claim);
  set('tchat', Chat.mentions); // quelqu'un t'a interpellé (@pseudo) dans le tchat
  renderPlaceBar();
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
    const mine = owned.filter((id) => Rules.COSMETICS[id].slot === slot && (!Rules.COSMETICS[id].cls || Rules.COSMETICS[id].cls === me.character.cls));
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
  renderDrawEditor();
}

// ---------- Visage dessiné ----------
let drawPixels = null; // brouillon en cours (null = pas encore chargé)
let drawDirty = false; // le joueur est en train de dessiner (brouillon non enregistré)
let drawColor = 1;
let drawing = false;

function renderDrawEditor() {
  const c = me.character;
  const has = c.owned.includes('dessin');
  $('draw-box').style.display = has ? '' : 'none';
  if (!has) return;
  const n = Rules.DRAWING.size;
  if (drawPixels === null) drawPixels = c.drawing && c.drawing.length === n * n ? c.drawing : '0'.repeat(n * n);
  if (!$('draw-grid').childElementCount) {
    $('draw-grid').style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    $('draw-grid').innerHTML = Array.from({ length: n * n }, (_, i) => `<div data-px="${i}"></div>`).join('');
    const paint = (el) => {
      if (!el || el.dataset.px === undefined) return;
      const i = Number(el.dataset.px);
      drawPixels = drawPixels.slice(0, i) + String(drawColor) + drawPixels.slice(i + 1);
      drawDirty = true;
      paintCell(el);
    };
    $('draw-grid').onpointerdown = (e) => { drawing = true; $('draw-grid').setPointerCapture(e.pointerId); paint(e.target.closest('[data-px]')); e.preventDefault(); };
    $('draw-grid').onpointermove = (e) => { if (drawing) paint(document.elementFromPoint(e.clientX, e.clientY)); };
    $('draw-grid').onpointerup = () => { drawing = false; };
    $('draw-grid').onpointercancel = () => { drawing = false; };
  }
  $('draw-grid').querySelectorAll('[data-px]').forEach(paintCell);
  const body = Rules.COSMETICS[c.look.body];
  const col = c.look.color && Rules.APPEARANCE.color.options[c.look.color];
  $('draw-grid').style.background = body ? body.color : col ? col.hex : '#f5d3b8';
  $('draw-palette').innerHTML = `<button class="swatch eraser ${drawColor === 0 ? 'active' : ''}" data-col="0" title="Gomme">🧽</button>`
    + Rules.DRAWING.palette.map((hex, i) => `<button class="swatch ${drawColor === i + 1 ? 'active' : ''}" data-col="${i + 1}" style="background:${hex}"></button>`).join('');
  $('draw-palette').querySelectorAll('[data-col]').forEach((b) => { b.onclick = () => { drawColor = Number(b.dataset.col); renderDrawEditor(); }; });
}

function paintCell(el) {
  const ch = drawPixels[Number(el.dataset.px)];
  el.style.background = ch === '0' ? '' : Rules.DRAWING.palette[Number(ch) - 1];
}

$('draw-clear').onclick = () => { drawPixels = '0'.repeat(Rules.DRAWING.size ** 2); drawDirty = true; renderDrawEditor(); };
$('draw-reset').onclick = () => { drawPixels = null; drawDirty = false; renderDrawEditor(); };
$('draw-save').onclick = async () => {
  const r = await act('/api/drawing', { pixels: drawPixels }, 'equip');
  if (r) drawDirty = false;
  if (r) toast('🎨 Visage enregistré : il apparaîtra en bataille !');
};

// ---------- Boutique ----------
let trying = null; // cosmétique essayé sur l'aperçu de la boutique

function renderShop() {
  const c = me.character;
  $('shop-gold').textContent = c.gold;
  const t = trying && Rules.COSMETICS[trying];
  $('shop-try').innerHTML = t ? `Essai : <b>${esc(t.label)}</b>` : 'Clique sur un article pour l\'essayer';
  $('shop-list').innerHTML = Object.entries(Rules.COSMETIC_SLOTS).map(([slot, def]) => {
    const items = Object.entries(Rules.COSMETICS).filter(([, it]) => it.slot === slot)
      .sort((a, b) => (!!a[1].unlock - !!b[1].unlock) || (!!a[1].legend - !!b[1].legend) || (a[1].cls || '').localeCompare(b[1].cls || '') || a[1].price - b[1].price);
    return `<div class="shop-cat"><h3>${def.icon} ${def.plural}${def.note ? ` <span class="sub">${def.note}</span>` : ''}</h3><div class="shop-grid">${items.map(([id, it]) => {
      const owned = c.owned.includes(id);
      const worn = c.look[slot] === id;
      const locked = Rules.cosmeticLocked(c, id);
      const wrongCls = it.cls && it.cls !== c.cls;
      let btn;
      if (worn) btn = `<button class="small secondary" data-wear="${slot}" data-value="">✓ Porté · retirer</button>`;
      else if (owned) btn = wrongCls ? `<button class="small" disabled>${Rules.CLASS_INFO[it.cls].label} uniquement</button>` : `<button class="small" data-wear="${slot}" data-value="${id}">Porter</button>`;
      else if (locked) btn = '<button class="small" disabled>🔒 Verrouillé</button>';
      else if (it.unlock) btn = `<button class="small gold" data-buy="${id}">🏆 Récupérer</button>`;
      else btn = `<button class="small gold" data-buy="${id}" ${c.gold < it.price ? 'disabled' : ''}>Acheter</button>`;
      const progress = it.unlock ? Math.min(Rules.achievementValue(c, it.unlock.metric), it.unlock.goal) : 0;
      const fmtN = (n) => Number(n).toLocaleString('fr-FR');
      const ci = it.cls && Rules.CLASS_INFO[it.cls];
      return `<div class="shop-item ${owned ? 'owned' : ''} ${locked ? 'locked' : ''} ${it.unlock ? 'exploit' : ''} ${it.legend ? 'legend' : ''} ${trying === id ? 'trying' : ''}" data-try="${id}">
        ${it.legend ? '<div class="shop-legend">✦ Légende</div>' : ''}
        <canvas width="110" height="100" data-shopcv="${id}"></canvas>
        <div class="shop-name">${esc(it.label)}</div>
        ${ci ? `<div class="shop-cls" style="color:${ci.color}">${ci.icon} ${ci.label}</div>` : ''}
        ${it.unlock ? `<div class="shop-unlock" title="Cosmétique d'exploit">🏆 ${esc(it.unlock.desc)}${owned ? '' : ` <b>${fmtN(progress)} / ${fmtN(it.unlock.goal)}</b>`}</div>` : ''}
        <div class="shop-price">${owned ? '<span class="up">Possédé</span>' : it.unlock ? (locked ? '<span class="muted">Exploit</span>' : '<span class="up">Débloqué !</span>') : `${it.price} 🪙`}</div>
        ${btn}
      </div>`;
    }).join('')}</div></div>`;
  }).join('');
  $('shop-list').querySelectorAll('canvas[data-shopcv]').forEach((cv) => {
    const id = cv.dataset.shopcv;
    drawFighter(cv.getContext('2d'), 55, 62, myFighter(tryOverride(id), Rules.COSMETICS[id].cls), { scale: 1.9 });
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
      if (!it.unlock && !await confirmBox(`Acheter « ${it.label} » pour ${it.price} golds ?`)) return;
      const r = await act('/api/shop/buy', { id: b.dataset.buy }, 'buy');
      if (!r) return;
      trying = null;
      if (it.slot === 'drawing') { toast('🎨 Visage débloqué ! Dessine-le dans l\'onglet Personnage, rubrique Apparence.', 6000); return; }
      toast(r.worn ? `🛍️ ${it.label} ${it.unlock ? 'récupéré' : 'acheté'} et porté !` : `🛍️ ${it.label} acheté : il sera porté quand tu joueras ${Rules.CLASS_INFO[it.cls].label}.`, 5000);
    };
  });
  $('shop-list').querySelectorAll('[data-wear]').forEach((b) => {
    b.onclick = () => act('/api/look', { part: b.dataset.wear, value: b.dataset.value || null }, 'equip');
  });
}

// Aperçu d'un article : le visage à dessiner montre un exemple tant que le joueur n'a rien dessiné.
const DRAW_SAMPLE = '000000000000000000000000000000000000000001100110000001100110000000000000000000000000000030000030000003333300000000000000000000000000000000000000';
function tryOverride(id) {
  const it = Rules.COSMETICS[id];
  const o = { [it.slot]: id };
  if (it.slot === 'drawing') o.drawingPixels = me.character.drawing || DRAW_SAMPLE;
  return o;
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
    const pips = Rules.setTiers(key).map((t) => `<span class="set-pip ${pieces >= t.pieces ? 'on' : ''}" title="${t.pieces} pièces : ${setBonusText(set, t.points)}">${t.pieces}</span>`).join('');
    return `<div class="set-chip ${tier ? '' : 'inactive'}" style="--c:${set.color}">
      <div class="set-head">${set.icon} <b>${esc(set.label)}</b><span class="muted">${pieces} / ${maxPieces} pièces</span></div>
      <div class="set-pips">${pips}</div>
      <div>Bonus actuel : ${tier ? `<b class="up">${setBonusText(set, tier.points)}</b>` : '<span class="muted">aucun (il faut 2 pièces)</span>'}</div>
      ${next ? `<div class="muted">À ${next.pieces} pièces : ${setBonusText(set, next.points)}</div>` : '<div class="muted">Palier maximum atteint !</div>'}
    </div>`;
  }).join('');
}

(function renderSetsHelp() {
  // Paliers communs, puis les panoplies qui ont leurs propres points (Fortune)
  const special = Object.values(Rules.SETS).filter((s) => s.points).map((s) => `${s.label} : ${s.points.map((p) => '+' + p).join(' / ')}`);
  $('set-tiers').textContent = Rules.SET_TIERS.map((t) => `${t.pieces} pièces = +${t.points} points`).join(', ') + (special.length ? ` (${special.join(' ; ')})` : '');
  $('sets-help').innerHTML = Object.entries(Rules.SETS).map(([key, set]) => `<div style="--c:${set.color}">${set.icon} <b style="color:${set.color}">${esc(set.label)}</b>
    <span class="muted">· ${set.stats.map((st) => Rules.STAT_INFO[st].label).join(' et ')}</span>
    <ul class="set-tier-list">${Rules.setTiers(key).map((t) => `<li><b>${t.pieces} pièces</b> : ${setBonusText(set, t.points)}</li>`).join('')}</ul></div>`).join('');
})();

// ---------- Succès ----------
let achFilter = 'next';
let knownDone = null; // succès déjà terminés (pour annoncer les nouveaux)
const announced = new Set(); // succès déjà annoncés pendant cette visite (jamais deux fois)

function renderAchievements() {
  const c = me.character;
  const list = Rules.ACHIEVEMENTS.map((a) => ({ a, st: Rules.achievementState(c, a) }));
  const done = list.filter((x) => x.st.done);
  const claimable = done.filter((x) => !x.st.claimed);

  // Annonce des succès qui viennent d'être terminés.
  const doneIds = new Set(done.map((x) => x.a.id));
  if (knownDone) {
    for (const x of done) {
      if (!knownDone.has(x.a.id) && !x.st.claimed && !announced.has(x.a.id)) {
        announced.add(x.a.id);
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
  if (precious && !await confirmBox(`Attention : ta sélection contient ${precious} objet(s) Épique ou Légendaire. Les recycler quand même ?`)) return;
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

// Compte et sécurité : adresse e-mail (pour récupérer son compte si on oublie son mot de passe) et mot de passe
let securitySig = '';
function renderSecurity() {
  const mailOn = config && config.mail;
  const sig = [me.email, me.emailVerified, me.emailPending, mailOn].join('|');
  if (sig === securitySig) return; // on ne réécrit pas le panneau (et les champs en cours de saisie) à chaque mise à jour
  securitySig = sig;
  const status = me.email && me.emailVerified
    ? `<div class="sec-status ok">✅ Adresse liée : <b>${esc(me.email)}</b></div>`
    : '<div class="sec-status warn">⚠️ Aucune adresse liée : si tu oublies ton mot de passe, tu ne pourras pas récupérer ton compte seul.</div>';
  const pending = me.emailPending ? `<div class="sec-status pending">📨 En attente de confirmation : <b>${esc(me.emailPending)}</b> — clique sur le lien reçu par e-mail (regarde aussi dans les indésirables).
      <button type="button" class="small secondary" id="sec-resend">Renvoyer l'e-mail</button></div>` : '';
  $('security-content').innerHTML = `${status}${pending}
    <p class="muted" style="font-size:13px">Ton adresse sert seulement à te renvoyer un lien si tu oublies ton mot de passe. Elle n'est montrée à personne.${me.twitchLogin && config && config.twitchLogin ? ' Ton Twitch étant lié, tu peux aussi te connecter avec Twitch.' : ''}</p>
    ${mailOn ? `<form class="sec-form" id="sec-email-form" autocomplete="off">
      <input type="email" id="sec-email" placeholder="ton.adresse@exemple.fr" value="${esc(me.emailPending || me.email || '')}" maxlength="254">
      <input type="password" id="sec-email-pw" placeholder="Ton mot de passe actuel" autocomplete="current-password">
      <button type="submit" class="small">${me.email ? 'Changer d\'adresse' : 'Lier cette adresse'}</button>
      ${me.email || me.emailPending ? '<button type="button" class="small secondary" id="sec-email-remove">Retirer</button>' : ''}
    </form>` : '<p class="muted" style="font-size:13px">📭 L\'envoi d\'e-mails n\'est pas encore activé sur le serveur. En attendant, si tu perds ton mot de passe, le streamer peut te donner un lien pour en choisir un nouveau.</p>'}
    <details class="sec-pw"><summary>🔑 Changer de mot de passe</summary>
      <form class="sec-form" id="sec-pw-form" autocomplete="off">
        <input type="password" id="sec-pw-current" placeholder="Mot de passe actuel" autocomplete="current-password">
        <input type="password" id="sec-pw-new" placeholder="Nouveau (6 caractères minimum)" autocomplete="new-password">
        <button type="submit" class="small">Changer</button>
      </form></details>`;
  if ($('sec-email-form')) {
    $('sec-email-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api/account/email', { email: $('sec-email').value.trim(), password: $('sec-email-pw').value });
        toast(r.removed ? 'Adresse retirée' : `📨 E-mail envoyé à ${r.pending} : clique sur le lien pour confirmer`, 6000);
      } catch (err) { toast('⚠️ ' + err.message); }
    };
  }
  if ($('sec-email-remove')) {
    $('sec-email-remove').onclick = async () => {
      const pw = await promptBox('Ton mot de passe, pour retirer l\'adresse :', '', { title: 'Retirer l\'adresse e-mail', ok: 'Retirer' });
      if (pw == null) return;
      try { await api('/api/account/email', { email: '', password: pw }); toast('Adresse retirée'); } catch (err) { toast('⚠️ ' + err.message); }
    };
  }
  if ($('sec-resend')) $('sec-resend').onclick = () => api('/api/account/email/resend', {}).then(() => toast('📨 E-mail renvoyé')).catch((err) => toast('⚠️ ' + err.message));
  $('sec-pw-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/account/password', { current: $('sec-pw-current').value, password: $('sec-pw-new').value });
      $('sec-pw-current').value = ''; $('sec-pw-new').value = '';
      toast('🔑 Mot de passe changé (tes autres appareils sont déconnectés)', 5000);
    } catch (err) { toast('⚠️ ' + err.message); }
  };
}

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
  $('bet-hint').textContent = queue.mode === 'clans' ? 'Choisis ensuite ton équipe ci-dessous.' : 'Choisis ensuite ton combattant ci-dessous.';
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
  // Guerre des clans : on parie sur une équipe (la sienne comprise), pas sur un combattant.
  const targets = queue.mode === 'clans'
    ? Object.entries(Rules.CLANS.teams).map(([c, T]) => ({ key: 'clan:' + c, name: `les ${T.label}`, icon: T.icon, clanTarget: true, count: queue.participants.filter((p) => p.clan === c).length }))
    : queue.participants;
  $('bet-list').innerHTML = targets.map((p) => {
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
      <div class="bet-name">${p.clanTarget
    ? `<span>${p.icon} ${esc(p.name)}</span><span class="muted">${p.count} combattant${p.count > 1 ? 's' : ''}</span>`
    : `<span>${p.bot ? '🤖' : ''}${p.cls ? Rules.CLASS_INFO[p.cls].icon : '⚔️'} ${esc(p.name)}</span><span class="muted">Niv. ${p.level}</span>`}</div>
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
  if (queue.phase === 'queue' && queue.mode === 'clans') {
    // Guerre des clans : on choisit (ou change) son équipe
    const mineP = queue.participants.find((p) => p.key === 'u' + me.id);
    const teams = Object.entries(Rules.CLANS.teams).map(([c, T]) => {
      const count = queue.participants.filter((p) => p.clan === c).length;
      const here = mineP && mineP.clan === c;
      return `<button class="clan-btn ${here ? 'mine' : ''}" data-clan="${c}" style="--c:${T.color}" ${here ? 'disabled' : ''}>${T.icon} ${here ? 'Tu es chez les' : mineP ? 'Passer chez les' : 'Rejoindre les'} ${T.label} <span class="muted">(${count})</span></button>`;
    }).join('');
    box.innerHTML = `<div class="row"><b style="font-size:18px">⚔️ La file est ouverte !</b>
      <span class="countdown" id="cd"></span><span class="muted">${n} combattant(s) inscrit(s) · tape <b>!rouge</b> ou <b>!bleu</b> sur le stream</span></div>
      <div class="row clan-btns">${teams}</div>`;
    box.querySelectorAll('[data-clan]').forEach((b) => {
      b.onclick = () => act('/api/queue/join', { clan: b.dataset.clan }, 'join');
    });
    tickCountdown();
  } else if (queue.phase === 'queue') {
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
    const what = queue.mode === 'gold' ? '🪙 Golden Shower en cours : il pleut des pièces !' : queue.mode === 'clans' ? '⚔️ Guerre des clans en cours !' : queue.mode === 'koth' ? '👑 Roi de la Colline en cours !' : queue.mode === 'boss' ? `${QB ? QB.icon : '👹'} Combat contre ${QB ? QB.name : 'le boss'} en cours !` : queue.mode === 'dungeon' ? '🏰 Raid de Donjon en cours !' : '🔥 Bataille en cours !';
    box.innerHTML = `<b>${what}</b> ${ev ? `<span class="tag" style="color:${ev.color}">${ev.icon} ${ev.label}</span>` : ''} <a href="/arena.html" target="_blank">Regarder l'arène</a> ${inQueue ? '<span class="up">Ton perso se bat !</span>' : ''}`;
    if (queue.poll) renderPollVote(box);
  } else if (queue.phase === 'ended' && queue.result) {
    const r = queue.result;
    let text;
    if (r.mode === 'boss') text = r.victory ? `🏆 ${r.boss.name} est vaincu ! Tous les participants sont récompensés.` : `💀 ${r.boss.name} a gagné… Retentez votre chance !`;
    else if (r.mode === 'dungeon') text = `🏰 Le raid s'est arrêté en salle ${r.room}${r.reward ? ' : récompense pour tous les participants !' : '.'}`;
    else if (r.mode === 'gold') text = `🪙 Fin du Golden Shower : ${r.totals.gold} golds ramassés !${r.best ? ` Roi du butin : ${esc(r.best.name)} (${r.best.gold} golds).` : ''}`;
    else if (r.mode === 'clans') text = `${Rules.CLANS.teams[r.winner].icon} Victoire des ${Rules.CLANS.teams[r.winner].label} !${r.mvp ? ` MVP : ${esc(r.mvp.name)}.` : ''}`;
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
    <div class="row"><b>🗳️ ${poll.rush ? 'Boss Rush : le chat choisit la suite de la run !' : 'Sondage du donjon : le chat choisit un bonus pour les aventuriers !'}</b><span class="countdown" id="poll-cd"></span></div>
    <div class="poll-options">${poll.options.map((o, i) => {
      const b = o.label ? o : Rules.DUNGEON_BOONS[o.id];
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
  $('luck-sim').value = Math.min(Rules.LUCK_CAP, luck);
  // Explications générées à partir des règles (toujours à jour)
  const pctFr = (x) => String(Math.round(x * 1000) / 1000).replace('.', ',');
  const t0 = Rules.lootTable(0);
  const tMax = Rules.lootTable(Rules.LUCK_CAP);
  const list = (t) => Rules.RARITIES.map((r) => `${pctFr(t[r])} % ${Rules.RARITY_INFO[r].label}`).join(', ');
  $('luck-explain').innerHTML = `Chaque coffre contient 3 objets. La rareté de chaque objet est tirée selon le tableau ci-dessous.
    Avec <b>0 de chance</b> : ${list(t0)}. Chaque point de chance <b>retire ${pctFr(-Rules.LOOT_PER_LUCK[0])} %</b> aux Communs
    et le redistribue aux raretés supérieures (${Rules.RARITIES.slice(1).map((r, i) => `+${pctFr(Rules.LOOT_PER_LUCK[i + 1])} % ${Rules.RARITY_INFO[r].label}`).join(', ')}),
    jusqu'au plafond de <b>${Rules.LUCK_CAP}</b> de chance effective : ${list(tMax)}.
    Les bonus de Chance de ton équipement <b>s'ajoutent</b> à tes points (un objet « +3 Chance » = +3 de chance effective).`;
  $('rarity-explain').innerHTML = 'Plus la rareté est haute, plus l\'objet a de lignes de stats : '
    + Rules.RARITIES.map((r) => { const I = Rules.RARITY_INFO[r]; return `${I.label} ${I.lines} ligne${I.lines > 1 ? 's' : ''} (+${I.min} à +${I.max} %)`; }).join(', ') + '.';
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
    instant: skipAnim.get(),
  });
}

// Aperçu animé du personnage.
// Aperçus animés du personnage (fiche, apparence, boutique avec essayage).
function myFighter(appOverride, clsOverride) {
  const c = me.character;
  const look = {};
  for (const [slot, item] of Object.entries(c.equipment)) if (item) look[slot] = item.rarity;
  const app = { ...c.look };
  // Mon propre dessin : le brouillon de l'éditeur, sinon le dessin enregistré (pas besoin du cache réseau)
  // Le dessin ne s'affiche que s'il est porté, ou pendant qu'on dessine (aperçu en direct du brouillon).
  const drafting = drawDirty && drawPixels && /[1-9]/.test(drawPixels);
  if (app.drawing) app.drawingPixels = (drafting ? drawPixels : c.drawing) || null;
  else if (drafting && $('draw-box').offsetParent) { app.drawing = 'dessin'; app.drawingPixels = drawPixels; }
  return { name: me.twitchDisplayName || me.username, cls: clsOverride || c.cls, look, app: { ...app, ...appOverride } };
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
      const f = v.shop && trying ? myFighter(tryOverride(trying), Rules.COSMETICS[trying].cls) : myFighter({});
      drawFighter(ctx, v.x, v.y, f, { scale: v.scale, bob: Math.sin(t / 400) * 3, swing: (Math.sin(t / 700) + 1) * 0.15 });
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

// Temps réel
const socket = io();
socket.on('me', (m) => { me = m; render(); });
// Tchat : la Taverne (vue complète) et la bulle flottante (vue compacte), branchées sur le même salon
Chat.mount($('chat-full'), 'full');
Chat.mount($('chat-pop-body'), 'bubble');
Chat.init(socket, { name: () => me && (me.twitchDisplayName || me.username), id: () => me && me.id });
socket.on('queue', (q) => { queue = q; if (me) { renderQueue(); renderBets(); } });
const REWARD_LABELS = {
  win: '🏆 VICTOIRE !', kill: '⚔️ Kill !', participation: '🎖️ Participation à la bataille',
  firstblood: '🩸 PREMIER KILL !', double: '⚡ DOUBLE KILL !', massacre: '💀 MASSACRE !',
  sub: '💜 Merci pour ton abonnement !', gift: '🎁 Cadeau du streamer !',
  boss: '👹 BOSS VAINCU !', dungeon: '🏰 Récompense du raid :', poll: '🗳️ Bonus voté par le chat :',
  solo_boss: '👹 Défi des boss réussi !', clans: '⚔️ VICTOIRE DE TON CLAN !', mvp: '🌟 MVP de la Guerre des clans !', gold: '🪙 Butin du Golden Shower :',
};
const REWARD_SOUNDS = {
  win: 'victory', kill: 'reward', participation: 'levelUp', firstblood: 'reward', double: 'reward', massacre: 'reward', sub: 'victory', gift: 'reward',
  boss: 'victory', dungeon: 'victory', solo_boss: 'victory', solo_expedition: 'victory', poll: 'reward', clans: 'victory', mvp: 'reward', gold: 'victory',
};
socket.on('leaderboard', (data) => loadLeaderboard(data));
socket.on('trainingQueue', (q) => {
  ensureTrainingView();
  trainingBus.emit('queue', q);
  const running = q.phase === 'battle';
  $('training-stop').disabled = !running;
  $('training-speed').style.display = q.solo && running ? '' : 'none';
  document.querySelectorAll('[data-tspeed]').forEach((b) => b.classList.toggle('active', !!q.solo && Number(b.dataset.tspeed) === q.solo.speed));
  if (q.phase === 'ended' && q.result && q.result.solo) {
    const r = q.result;
    $('training-status').innerHTML = r.solo === 'expedition'
      ? `🕳️ <b>Profondeur ${r.depth} atteinte</b> (entraînement, rien n'est gagné). Relance quand tu veux.`
      : r.solo === 'rush' ? `💀 <b>Boss Rush : ${r.rush.killed} boss vaincu${r.rush.killed > 1 ? 's' : ''}</b> (entraînement, rien n'est gagné). Relance quand tu veux.`
      : r.victory ? `🏆 <b class="up">${esc(r.boss.name)} vaincu</b> en ${Rules.BOSS_CHALLENGE[r.difficulty].label} ! (entraînement, rien n'est gagné)`
        : `💀 <b class="down">${esc(r.boss.name)} a gagné</b> (${Rules.BOSS_CHALLENGE[r.difficulty].label}). Ajuste ton build et retente !`;
  } else if (q.phase === 'ended' && q.result && q.result.winner) {
    const won = q.result.winner.key === 'u' + me.id;
    $('training-status').innerHTML = won ? '🏆 <b class="up">Victoire !</b> Relance quand tu veux.' : `💀 <b class="down">${esc(q.result.winner.name)} gagne.</b> Ajuste ton build et retente !`;
  } else if (q.phase === 'idle') {
    $('training-status').textContent = 'Duel arrêté.';
  }
});
socket.on('trainingFrame', (f) => {
  trainingBus.emit('frame', f);
  if (f.rush) renderRushChoiceIn(f, $('training-relic'), '/api/training/rush');
  else renderRelicChoiceIn(f, $('training-relic'), '/api/training/relic');
});
socket.on('soloQueue', onSoloQueue);
// Marché : un ordre a changé quelque part → on rafraîchit si l'onglet est ouvert.
let marketRefresh = null;
socket.on('market', () => {
  if (!document.querySelector('.tab[data-tab="marche"].active')) { if (marketOrders) marketOrders = null; return; }
  clearTimeout(marketRefresh);
  marketRefresh = setTimeout(loadMarket, 300);
});
socket.on('mail', (m) => { toast('✉️ ' + m.text, 8000); Sound.play(m.kind === 'sold' ? 'victory' : 'reward'); });
socket.on('soloFrame', (f) => { soloFrame = f; soloBus.emit('frame', f); });
socket.on('banned', async () => { await alertBox('Ton compte a été banni.', { title: 'Compte banni' }); location.href = '/'; });
socket.on('bet', (r) => {
  lastBetResult = r;
  if (r.outcome === 'won') { Sound.play('reward'); toast(`💰 Pari gagné sur ${r.targetName} ! +${r.payout} 🪙`, 6000); }
  else if (r.outcome === 'lost') { Sound.play('betLost'); toast(`💸 Pari perdu sur ${r.targetName} (−${r.amount} 🪙)`, 6000); }
  else toast(`↩️ Pari remboursé : +${r.amount} 🪙`, 5000);
  renderBets();
});

socket.on('pet', (e) => { if (window.onPetEvent) onPetEvent(e); });
socket.on('casino', (d) => Casino.onFeed(d.feed));
socket.on('svFrame', (f) => Survivor.onFrame(f));
socket.on('fishing', (e) => Fishing.onEvent(e)); // étapes du lancer de pêche, en direct
socket.on('svEnd', (r) => Survivor.onEnd(r));
socket.on('svBoard', () => Survivor.onBoard());
socket.on('reward', (r) => {
  Sound.play(REWARD_SOUNDS[r.type]);
  const gains = r.reward.xp || r.type !== 'gift' ? [`+${r.reward.xp} XP`] : [];
  if (r.reward.gold) gains.push(`+${r.reward.gold} 🪙`);
  if (r.reward.chests) gains.push(`+${r.reward.chests} coffre${r.reward.chests > 1 ? 's' : ''}`);
  if (r.keys) gains.push(`+${r.keys} 🗝️ Clé${r.keys > 1 ? 's' : ''} de boss`);
  if (r.energy) gains.push(`+${r.energy} ⚡ énergie`);
  if (r.emeralds) gains.push(`+${r.emeralds} {em} émeraude${r.emeralds > 1 ? 's' : ''}`);
  const label = r.type === 'dungeon' ? `🏰 Raid : salle ${r.room} atteinte !`
    : r.type === 'solo_expedition' ? `🕳️ Expédition : profondeur ${r.depth} !` : REWARD_LABELS[r.type];
  const mult = r.mult && r.mult !== 1 ? ` (×${String(r.mult).replace('.', ',')} ${r.mult > 1 ? '⬆️ adversaires plus forts' : '⬇️ adversaires plus faibles'})` : '';
  toast(`${label} ${gains.join(', ')}${mult}`, 5000);
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
  loadSoloState();
  loadLeaderboard();
  const params = new URLSearchParams(location.search);
  if (params.get('twitch') === 'ok') toast('✅ Compte Twitch lié !');
  if (params.get('twitch') === 'error') toast('⚠️ Liaison Twitch échouée' + (params.get('msg') ? ' : ' + params.get('msg') : ''));
  if (params.get('email') === 'ok') toast('✅ Adresse e-mail confirmée : ton compte est récupérable', 6000);
  if (params.get('email') === 'expired') toast('⚠️ Lien de confirmation expiré ou déjà utilisé : renvoie l\'e-mail depuis « Compte et sécurité »', 7000);
  if (params.has('twitch') || params.has('email')) history.replaceState(null, '', '/character.html' + location.hash);
})();
