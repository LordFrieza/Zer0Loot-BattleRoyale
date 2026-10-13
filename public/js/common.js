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

function itemHtml(item, extra = '') {
  const r = Rules.RARITY_INFO[item.rarity];
  const slot = Rules.SLOT_INFO[item.slot];
  const lines = item.lines
    .map((l) => `<li>+${l.value}% ${Rules.STAT_INFO[l.stat].label}</li>`)
    .join('');
  return `<div class="item rarity-${item.rarity}" data-id="${item.id}">
    <div class="item-name c-${item.rarity}">${slot.icon} ${esc(item.name)}</div>
    <div class="item-meta">${slot.label} · <span class="c-${item.rarity}">${r.label}</span></div>
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
