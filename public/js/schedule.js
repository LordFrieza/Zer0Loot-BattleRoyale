/*
 * Planning des parties (créneaux choisis par l'admin, heure de Paris) :
 * bandeau à côté de « Arène en direct » (prochain mode et compte à rebours, ou file ouverte) et fenêtre du planning
 * de la semaine. Données : GET /api/schedule et événement socket « schedule ». Dépend de common.js (api, esc).
 */
(function () {
  let data = null;
  let fetchedAt = 0;

  function modeInfo(o) {
    const m = Rules.GAME_MODES[o.mode] || { icon: '🎮', label: o.mode, color: '#fff' };
    const boss = o.mode === 'boss' && o.boss && Rules.BOSSES[o.boss];
    return { icon: m.icon, label: m.label + (boss ? ` · ${boss.icon} ${boss.name}` : ''), short: boss ? `${boss.icon} ${boss.name}` : m.label, color: m.color };
  }
  function dur(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min${s % 60 && m < 10 ? ` ${String(s % 60).padStart(2, '0')}` : ''}`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ${String(m % 60).padStart(2, '0')}`;
    return `${Math.floor(h / 24)} j ${h % 24} h`;
  }
  function render() {
    const chip = document.getElementById('sched-chip');
    if (!chip) return;
    if (!data || (!data.live && !data.next.length)) { chip.style.display = 'none'; return; }
    chip.style.display = '';
    const now = Date.now();
    if (data.live) {
      const i = modeInfo(data.live);
      chip.className = 'sched-chip live';
      chip.innerHTML = `<span class="sched-dot"></span>${i.icon}<span class="wide-only"> ${esc(i.short)} :</span> file ouverte · <b>${dur(data.live.startAt - now)}</b>`;
      chip.title = `${i.label} : la file est ouverte, tape !join (ou Rejoindre) ! Lancement automatique dans ${dur(data.live.startAt - now)}.`;
      return;
    }
    const next = data.next.find((o) => o.at > now - 5000) || data.next[0];
    const i = modeInfo(next);
    chip.className = 'sched-chip';
    chip.innerHTML = `📅 ${i.icon}<span class="wide-only"> ${esc(i.short)}</span> dans <b>${dur(next.at - now)}</b>`;
    chip.title = `Prochaine partie planifiée : ${i.label}, à ${next.time} (heure de Paris). Clique pour voir le planning de la semaine.`;
  }
  async function load() {
    try { data = await api('/api/schedule'); fetchedAt = Date.now(); render(); } catch (e) { /* hors ligne */ }
  }

  // Fenêtre du planning de la semaine : une colonne par jour, aujourd'hui en premier
  function openPlanning() {
    if (!data) return;
    const today = Rules.parisParts(Date.now()).dow;
    const order = Array.from({ length: 7 }, (_, k) => ((today - 1 + k) % 7) + 1);
    const nextAt = data.next[0] && data.next[0].at;
    const cols = order.map((dow, k) => {
      const items = data.items.filter((it) => it.enabled !== false && it.days.includes(dow));
      const rows = items.map((it) => {
        const i = modeInfo(it);
        const isNext = data.next[0] && data.next[0].id === it.id && data.next[0].dow === dow && k < 7;
        return `<div class="plan-item ${isNext ? 'next' : ''}" style="--c:${i.color}"><b>${it.time}</b><span>${i.icon} ${esc(i.label)}</span>${isNext ? `<small>dans ${dur(nextAt - Date.now())}</small>` : ''}</div>`;
      }).join('');
      return `<div class="plan-day ${k === 0 ? 'today' : ''}"><h4>${Rules.SCHEDULE.days[dow - 1]}${k === 0 ? ' <span>(aujourd\'hui)</span>' : ''}</h4>${rows || '<p class="muted">—</p>'}</div>`;
    }).join('');
    const wrap = document.createElement('div');
    wrap.className = 'modal open zl-dialog plan-modal';
    wrap.innerHTML = `<div class="modal-box"><h2>📅 Planning de la semaine</h2>
      <p class="muted">Heure de Paris. À l'heure dite, la file s'ouvre pendant ${data.queueSeconds >= 60 ? `${Math.round(data.queueSeconds / 60)} minutes` : `${data.queueSeconds} secondes`} (tape <b>!join</b> dans le chat ou clique sur Rejoindre), puis la partie se lance toute seule.</p>
      ${data.live ? `<div class="plan-live">🔴 ${modeInfo(data.live).icon} <b>${esc(modeInfo(data.live).label)}</b> : file ouverte, lancement dans ${dur(data.live.startAt - Date.now())} !</div>` : ''}
      <div class="plan-week">${cols}</div>
      <div class="zl-dialog-btns"><button class="gold" data-close>Fermer</button></div></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector('[data-close]').onclick = close;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  }

  function init() {
    const chip = document.getElementById('sched-chip');
    if (!chip) return;
    chip.addEventListener('click', openPlanning);
    load();
    setInterval(() => { if (Date.now() - fetchedAt > 10 * 60000) load(); else render(); }, 1000);
    if (typeof socket !== 'undefined') socket.on('schedule', (d) => { data = d; fetchedAt = Date.now(); render(); });
  }
  window.ZLSchedule = { init, load, get data() { return data; } };
  init();
})();
