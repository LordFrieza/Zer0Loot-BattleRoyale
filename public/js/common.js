/* Utilitaires partagés par les pages. */
async function api(path, body) {
  const opts = body === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur ' + res.status);
  return data;
}

// Fenêtre de dialogue au style du site (remplace confirm / alert / prompt du navigateur).
// o : { title, message, ok, cancel (false = pas de bouton Annuler), input (valeur de départ d'un champ texte), danger }
// Résout true / false (confirmation), la valeur saisie ou null (champ texte).
function zlDialog(o) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal open zl-dialog';
    const box = document.createElement('div');
    box.className = 'modal-box';
    box.setAttribute('role', 'dialog');
    box.innerHTML = `${o.title ? `<h2>${esc(o.title)}</h2>` : ''}<p class="zl-dialog-msg"></p>
      ${o.input != null ? '<input type="text" class="zl-dialog-input" maxlength="40">' : ''}
      <div class="zl-dialog-btns">${o.cancel === false ? '' : `<button class="secondary" data-act="no">${esc(o.cancel || 'Annuler')}</button>`}
      <button class="${o.danger ? 'danger' : 'gold'}" data-act="yes">${esc(o.ok || 'Confirmer')}</button></div>`;
    box.querySelector('.zl-dialog-msg').textContent = o.message || '';
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    const input = box.querySelector('.zl-dialog-input');
    if (input) { input.value = o.input; setTimeout(() => { input.focus(); input.select(); }, 0); } else setTimeout(() => box.querySelector('[data-act="yes"]').focus(), 0);
    const close = (v) => { document.removeEventListener('keydown', onKey, true); wrap.remove(); resolve(v); };
    const yes = () => close(input ? input.value : true);
    const no = () => close(input ? null : false);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); no(); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); yes(); }
    };
    document.addEventListener('keydown', onKey, true);
    box.querySelector('[data-act="yes"]').onclick = yes;
    if (box.querySelector('[data-act="no"]')) box.querySelector('[data-act="no"]').onclick = no;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) no(); });
  });
}
const confirmBox = (message, o = {}) => zlDialog({ title: o.title || 'Confirmation', message, ok: o.ok, cancel: o.cancel, danger: o.danger });
const alertBox = (message, o = {}) => zlDialog({ title: o.title || 'Information', message, ok: o.ok || 'OK', cancel: false });
const promptBox = (message, value = '', o = {}) => zlDialog({ title: o.title || '', message, ok: o.ok || 'Valider', input: value });

function toast(message, ms = 3500) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  // {em} : icône verte des émeraudes (jamais l'emoji 💎, bleu, qu'on confondrait avec une autre monnaie)
  el.innerHTML = esc(message).replace(/\{em\}/g, '<i class="ico-emerald"></i>');
  wrap.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Icône + libellé d'un objet (« 🏹 Arc », « ⛑️ Casque »).
function itemType(item) {
  const kind = item.kind && Rules.KINDS[item.kind];
  return kind ? { icon: kind.icon, label: kind.label } : { icon: Rules.SLOT_INFO[item.slot].icon, label: Rules.SLOT_INFO[item.slot].label };
}

// Bonus de classe des armes / objets secondaires (équipables par tous ; bonus pour la classe de l'objet).
function classTag(item, playerCls) {
  const b = Rules.classBonusOf(item);
  if (!b) return '';
  const ci = Rules.CLASS_INFO[b.cls];
  const mine = playerCls !== undefined && b.cls === playerCls;
  const other = playerCls !== undefined && !mine;
  const bonus = `${Rules.STAT_INFO[b.stat].label} +${b.value} %`;
  return `<span class="cls-tag ${mine ? 'mine' : other ? 'other' : ''}" title="Équipable par toutes les classes. Bonus pour les ${ci.label} : ${bonus}">${ci.icon} Bonus ${ci.label} : ${bonus}</span>`;
}

// Étiquette de panoplie (« 🧛 Nosferatu »).
function setTag(item) {
  const set = item.set && Rules.SETS[item.set];
  if (!set) return '';
  const stats = set.stats.map((st) => Rules.STAT_INFO[st].label).join(' et ');
  const tiers = Rules.SET_TIERS.map((t) => `${t.pieces} pièces : +${t.points}`).join(' · ');
  return `<span class="set-tag" style="--c:${set.color}" title="Panoplie ${esc(set.label)} — bonus en ${stats} : ${tiers}">${set.icon} ${esc(set.label)}</span>`;
}

function itemHtml(item, extra = '', playerCls) {
  const r = Rules.RARITY_INFO[item.rarity];
  const type = itemType(item);
  const lines = item.lines
    .map((l) => `<li${l.alch ? ` class="alch" title="Renforcée ${l.alch} fois par l'Alchimie noire"` : ''}>${Rules.formatLine(l.stat, l.value)}${l.alch ? ' <span class="alch-mark">⚗️</span>' : ''}</li>`)
    .join('');
  return `<div class="item rarity-${item.rarity}" data-id="${item.id}">
    <div class="item-name c-${item.rarity}">${type.icon} ${esc(item.name)}</div>
    <div class="item-meta">${type.label} · <span class="c-${item.rarity}">${r.label}</span>${classTag(item, playerCls)}${setTag(item)}</div>
    <ul>${lines}</ul>${extra}
  </div>`;
}

async function logout() {
  await api('/api/logout', {});
  location.href = '/';
}

function formatCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/*
 * Boutons « ? » : chaque panneau qui contient un bouton .help-btn cache ses éléments .help
 * (longues explications) tant qu'on ne clique pas dessus. Le choix est mémorisé par panneau.
 */
function initHelp(root = document) {
  root.querySelectorAll('.help-btn').forEach((btn) => {
    if (btn.dataset.ready) return;
    btn.dataset.ready = '1';
    const panel = btn.closest('.panel');
    const key = 'zl_help_' + (panel.id || btn.dataset.help || 'x');
    let open = false;
    try { open = localStorage.getItem(key) === '1'; } catch (e) { /* stockage indisponible */ }
    const apply = () => {
      panel.classList.toggle('help-open', open);
      btn.classList.toggle('active', open);
      btn.title = open ? 'Masquer les explications' : 'Afficher les explications';
    };
    apply();
    btn.addEventListener('click', () => {
      open = !open;
      try { localStorage.setItem(key, open ? '1' : '0'); } catch (e) { /* ignore */ }
      apply();
    });
  });
}
document.addEventListener('DOMContentLoaded', () => initHelp());
