/* Page admin : contrôle de la file et de la bataille. */
const $ = (id) => document.getElementById(id);
const socket = io();
new ArenaView($('arena'), socket);
Sound.bindToggle($('sound-toggle'));
$('obs-url').textContent = location.origin + '/arena.html';

const PHASES = { idle: 'En attente', queue: 'File ouverte', ready: 'File fermée', battle: 'Combat', ended: 'Terminé' };
let queue = null;

async function run(url, body = {}) {
  $('error').textContent = '';
  try {
    return await api(url, body);
  } catch (err) {
    $('error').textContent = err.message;
    return null;
  }
}

$('open').onclick = () => (queue && queue.participants.length && queue.phase !== 'ended' && !confirm('Rouvrir la file ? Les inscrits actuels seront retirés.')) || run('/api/admin/queue/open', { seconds: Math.round(Number($('duration').value) * 60) });
$('close').onclick = () => run('/api/admin/queue/close');
$('reset').onclick = () => {
  if (queue && queue.phase === 'battle' && !confirm('Annuler la bataille en cours ? Aucune récompense de victoire ne sera donnée.')) return;
  run('/api/admin/battle/reset');
};
$('add-bots').onclick = () => run('/api/admin/queue/bots', { count: Number($('bots').value) });
$('simulate').onclick = async () => {
  const r = await run('/api/admin/queue/simulate', { login: $('sim-login').value });
  if (r && !r.joined) $('error').textContent = 'Déjà inscrit.';
};

function render() {
  const q = queue;
  $('phase').textContent = PHASES[q.phase];
  $('open').disabled = q.phase === 'battle';
  $('close').disabled = q.phase !== 'queue';
  $('start').disabled = !(q.phase === 'queue' || q.phase === 'ready') || q.participants.length < 2;
  $('add-bots').disabled = q.phase !== 'queue';
  $('simulate').disabled = q.phase !== 'queue';
  $('count').textContent = q.participants.length;
  $('plist').innerHTML = q.participants.length
    ? q.participants.map((p) => `<div><span>${p.bot ? '🤖' : '👤'} ${p.cls ? Rules.CLASS_INFO[p.cls].icon + ' ' : ''}${esc(p.name)}</span><span class="muted">Niv. ${p.level}</span></div>`).join('')
    : '<span class="muted">Personne pour l\'instant.</span>';
}

socket.on('queue', (q) => { queue = q; render(); });
socket.on('twitch', (s) => {
  $('twitch-status').innerHTML = `<span class="status-dot ${s.chatConnected ? 'on' : ''}"></span>Chat #${esc(s.channel)}${s.botCanSpeak ? ' (bot actif)' : ''}`;
});

api('/api/me').then((me) => { if (me.role !== 'admin') location.href = '/character.html'; }).catch(() => { location.href = '/'; });
api('/api/config').then((c) => socket.listeners('twitch')[0](c.twitch));

// ---------- Événement de bataille ----------
let pendingEvent = null;

function renderEvents() {
  const opts = [[null, '🚫 Aucun']].concat(Object.entries(Rules.BATTLE_EVENTS).map(([k, e]) => [k, `${e.icon} ${e.label}`])).concat([['random', '🎲 Random']]);
  $('event-btns').innerHTML = opts.map(([k, label]) => `<button class="${pendingEvent === k ? 'active' : ''}" data-ev="${k === null ? '' : k}">${label}</button>`).join('');
  $('event-btns').querySelectorAll('[data-ev]').forEach((b) => {
    b.onclick = async () => {
      const r = await run('/api/admin/event', { event: b.dataset.ev || null });
      if (r) { pendingEvent = r.pendingEvent; renderEvents(); }
    };
  });
  const ev = pendingEvent && Rules.BATTLE_EVENTS[pendingEvent];
  $('event-desc').innerHTML = pendingEvent === 'random'
    ? 'Prochaine bataille : <b>un événement tiré au hasard</b> parmi les 4.'
    : ev ? `Prochaine bataille : <b>${ev.icon} ${ev.label}</b> — ${ev.desc}` : 'Prochaine bataille : <b>aucun événement</b>.';
}

$('start').onclick = async () => {
  const r = await run('/api/admin/battle/start');
  if (r) { pendingEvent = r.pendingEvent; renderEvents(); }
};

// ---------- Joueurs ----------
let playersList = [];

async function loadPlayers() {
  try {
    playersList = await api('/api/admin/players');
    renderPlayers();
  } catch (e) { /* ignore */ }
}

function renderPlayers() {
  const q = $('players-search').value.trim().toLowerCase();
  const list = playersList
    .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.twitch || '').includes(q) || p.username.toLowerCase().includes(q))
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  $('players-count').textContent = `${playersList.length} joueur(s)`;
  $('players').innerHTML = `<tr><th>Joueur</th><th>Classe</th><th>Niv.</th><th>🪙</th><th>🎁</th><th>V / K / B</th><th>Donner</th><th></th></tr>`
    + list.map((p) => {
      const ci = p.cls && Rules.CLASS_INFO[p.cls];
      return `<tr class="${p.banned ? 'banned' : ''}" data-id="${p.id}">
        <td><b>${esc(p.name)}</b>${p.twitch ? ` <span class="muted">@${esc(p.twitch)}</span>` : ''}${p.ghost ? '<span class="tag">sans compte</span>' : ''}${p.banned ? '<span class="tag red">banni</span>' : ''}
          ${p.title ? `<div class="muted" style="font-size:11px">« ${esc(p.title)} »</div>` : ''}</td>
        <td>${ci ? ci.icon + ' ' + ci.label : '—'}</td>
        <td>${p.level}</td><td>${p.gold}</td><td>${p.chests}</td>
        <td>${p.record.wins} / ${p.record.kills} / ${p.record.battles}</td>
        <td><div class="row" style="gap:4px;flex-wrap:nowrap">
          <input type="number" min="1" value="100" data-amount>
          <select data-kind><option value="gold">golds</option><option value="chests">coffres</option><option value="xp">XP</option></select>
          <button class="small" data-give>Donner</button></div></td>
        <td><button class="small ${p.banned ? 'secondary' : 'danger'}" data-ban="${p.banned ? '0' : '1'}">${p.banned ? 'Débannir' : 'Bannir'}</button></td>
      </tr>`;
    }).join('');
  $('players').querySelectorAll('[data-give]').forEach((b) => {
    b.onclick = async () => {
      const row = b.closest('tr');
      const amount = Number(row.querySelector('[data-amount]').value);
      const kind = row.querySelector('[data-kind]').value;
      const r = await run(`/api/admin/players/${row.dataset.id}/give`, { [kind]: amount });
      if (r) {
        const p = playersList.find((x) => x.id === row.dataset.id);
        toast(`🎁 ${amount} ${kind === 'gold' ? 'golds' : kind === 'chests' ? 'coffre(s)' : 'XP'} donné(s) à ${p.name}`);
        loadPlayers();
      }
    };
  });
  $('players').querySelectorAll('[data-ban]').forEach((b) => {
    b.onclick = async () => {
      const row = b.closest('tr');
      const p = playersList.find((x) => x.id === row.dataset.id);
      const ban = b.dataset.ban === '1';
      if (ban && !confirm(`Bannir ${p.name} ? Il ne pourra plus se connecter ni rejoindre les batailles.`)) return;
      const r = await run(`/api/admin/players/${row.dataset.id}/ban`, { banned: ban });
      if (r) { toast(ban ? `⛔ ${p.name} est banni` : `✅ ${p.name} est débanni`); loadPlayers(); }
    };
  });
}

$('players-search').oninput = renderPlayers;
$('players-refresh').onclick = loadPlayers;
$('simulate-sub').onclick = async () => {
  const r = await run('/api/admin/simulate-sub', { login: $('sim-sub').value });
  if (r) { toast(`💜 Sub simulé : +${Rules.SUB_REWARD_GOLD} golds pour ${$('sim-sub').value}`); loadPlayers(); }
};

// ---------- Classements ----------
async function loadLeaderboard(data) {
  try { renderLeaderboard($('leaderboard'), data || await api('/api/leaderboard')); } catch (e) { /* ignore */ }
}
socket.on('leaderboard', (data) => { loadLeaderboard(data); loadPlayers(); });

api('/api/admin/state').then((st) => { pendingEvent = st.pendingEvent; renderEvents(); }).catch(() => {});
renderEvents();
loadPlayers();
loadLeaderboard();
