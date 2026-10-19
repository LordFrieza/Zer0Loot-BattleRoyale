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

function toast(message, ms = 3500) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
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

// Étiquette de classe pour les armes / objets secondaires (rouge si la classe du joueur ne peut pas l'équiper).
function classTag(item, playerCls) {
  const cls = Rules.itemClass(item);
  if (!cls) return '';
  const ci = Rules.CLASS_INFO[cls];
  const locked = playerCls !== undefined && cls !== playerCls;
  return `<span class="cls-tag ${locked ? 'locked' : ''}" title="Réservé à la classe ${ci.label}">${locked ? '🔒' : ci.icon} ${ci.label}</span>`;
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
    .map((l) => `<li>${Rules.formatLine(l.stat, l.value)}</li>`)
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
