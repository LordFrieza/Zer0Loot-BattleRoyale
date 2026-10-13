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
$('start').onclick = () => run('/api/admin/battle/start');
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
    ? q.participants.map((p) => `<div><span>${p.bot ? '🤖' : '👤'} ${esc(p.name)}</span><span class="muted">Niv. ${p.level}</span></div>`).join('')
    : '<span class="muted">Personne pour l\'instant.</span>';
}

socket.on('queue', (q) => { queue = q; render(); });
socket.on('twitch', (s) => {
  $('twitch-status').innerHTML = `<span class="status-dot ${s.chatConnected ? 'on' : ''}"></span>Chat #${esc(s.channel)}${s.botCanSpeak ? ' (bot actif)' : ''}`;
});

api('/api/me').then((me) => { if (me.role !== 'admin') location.href = '/character.html'; }).catch(() => { location.href = '/'; });
api('/api/config').then((c) => socket.listeners('twitch')[0](c.twitch));
