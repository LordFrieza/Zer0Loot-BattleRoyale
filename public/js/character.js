/* Page personnage. */
const $ = (id) => document.getElementById(id);
let me = null;
let queue = null;
let config = null;
let invFilter = 'all';
let simLuck = null;
const opener = new ChestOpener();
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
  $('level').textContent = 'Niveau ' + c.level;
  $('xp-fill').style.width = (c.xp / c.xpToNext) * 100 + '%';
  $('xp-text').textContent = `${c.xp} / ${c.xpToNext} XP`;
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
  renderLoot();
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
      <td class="stat-desc">${info.desc}</td>
      <td class="stat-pts">${c.stats[s]}</td>
      <td class="stat-gear">${gear ? '+' + gear + '% équip.' : ''}</td>
      <td class="stat-value">${Rules.describeDerived(s, c.derived)}</td>
      <td>${c.skillPoints > 0 ? `<button class="plus" data-stat="${s}" title="Ajouter un point">+</button>` : ''}</td>
    </tr>`;
  }).join('');
  $('stats').querySelectorAll('.plus').forEach((b) => {
    b.onclick = () => act('/api/stats/allocate', { stat: b.dataset.stat });
  });
}

function renderEquipment() {
  const eq = me.character.equipment;
  $('equipment').innerHTML = Rules.SLOTS.map((slot) => {
    const info = Rules.SLOT_INFO[slot];
    const item = eq[slot];
    if (!item) return `<div class="slot"><div class="slot-label">${info.icon} ${info.label}</div><div class="muted" style="margin-top:8px">Vide</div></div>`;
    const lines = item.lines.map((l) => `+${l.value}% ${Rules.STAT_INFO[l.stat].label}`).join('<br>');
    return `<div class="slot filled rarity-${item.rarity}" data-slot="${slot}">
      <div class="slot-label">${info.icon} ${info.label}</div>
      <div class="c-${item.rarity}" style="font-weight:800;margin:4px 0">${esc(item.name)}</div>${lines}</div>`;
  }).join('');
  $('equipment').querySelectorAll('.slot.filled').forEach((el) => {
    el.onclick = () => act('/api/unequip', { slot: el.dataset.slot });
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
    .map((x) => `<span class="${x.d > 0 ? 'up' : 'down'}">${x.d > 0 ? '+' : ''}${x.d}% ${Rules.STAT_INFO[x.s].label}</span>`);
  return `<div class="compare">vs équipé : ${parts.join(', ') || 'identique'}</div>`;
}

function renderInventory() {
  const inv = me.character.inventory;
  const filters = [['all', 'Tout']].concat(Rules.SLOTS.map((s) => [s, Rules.SLOT_INFO[s].icon + ' ' + Rules.SLOT_INFO[s].label]));
  $('inv-filters').innerHTML = filters.map(([k, label]) => {
    const n = k === 'all' ? inv.length : inv.filter((i) => i.slot === k).length;
    return `<button class="${invFilter === k ? 'active' : ''}" data-f="${k}">${label} (${n})</button>`;
  }).join('');
  $('inv-filters').querySelectorAll('button').forEach((b) => {
    b.onclick = () => { invFilter = b.dataset.f; renderInventory(); };
  });
  $('inv-count').textContent = inv.length + ' objet(s)';
  const list = inv
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => invFilter === 'all' || item.slot === invFilter)
    .sort((x, y) => Rules.RARITIES.indexOf(y.item.rarity) - Rules.RARITIES.indexOf(x.item.rarity) || y.i - x.i)
    .map(({ item }) => item);
  $('inventory').innerHTML = list.length
    ? list.map((item) => itemHtml(item, `${compareHtml(item)}<div class="actions"><button class="small" data-equip="${item.id}">Équiper</button></div>`)).join('')
    : '<div class="muted">Ton coffre personnel est vide. Ouvre des coffres de LOOT pour le remplir !</div>';
  $('inventory').querySelectorAll('[data-equip]').forEach((b) => {
    b.onclick = () => act('/api/equip', { itemId: b.dataset.equip });
  });
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
  if (config && config.devLink) {
    html += `<div class="row" style="margin-top:10px"><input id="dev-login" placeholder="Ton pseudo Twitch" style="flex:1">
      <button class="twitch" id="dev-link">Lier</button></div>
      <p class="muted" style="font-size:12px">Mode test : l'OAuth Twitch n'est pas configuré sur le serveur, la liaison se fait par pseudo.</p>`;
  }
  el.innerHTML = html;
  if ($('dev-link')) $('dev-link').onclick = () => act('/api/twitch/link-dev', { login: $('dev-login').value });
}

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
    if ($('join')) $('join').onclick = () => act('/api/queue/join', {});
    tickCountdown();
  } else if (queue.phase === 'ready') {
    box.innerHTML = `<b>⏳ File fermée — ${n} combattant(s). Le streamer va lancer la bataille !</b> ${inQueue ? '<span class="up">Tu en fais partie.</span>' : ''}`;
  } else if (queue.phase === 'battle') {
    box.innerHTML = `<b>🔥 Bataille en cours !</b> <a href="/arena.html" target="_blank">Regarder l'arène</a> ${inQueue ? '<span class="up">Ton perso se bat !</span>' : ''}`;
  } else if (queue.phase === 'ended' && queue.result) {
    const w = queue.result.winner;
    box.innerHTML = `<b>🏆 ${w ? esc(w.name) + ' remporte la bataille (' + w.kills + ' kill(s)) !' : 'Bataille terminée.'}</b>`;
  }
}

function tickCountdown() {
  const el = $('cd');
  if (el && queue && queue.queueEndsAt) el.textContent = formatCountdown(queue.queueEndsAt - Date.now());
}
setInterval(tickCountdown, 250);

function renderLoot() {
  const myLuck = me.character.derived.luck;
  const luck = simLuck == null ? myLuck : simLuck;
  const table = Rules.lootTable(luck);
  $('luck-sim').value = Math.min(85, luck);
  $('luck-sim-val').textContent = luck;
  $('loot-table').innerHTML = `<table class="loot-table">
    <tr><th>Rareté</th><th>Probabilité ${simLuck == null ? '(ta chance : ' + myLuck + ')' : '(simulation)'}</th><th></th><th>Lignes</th><th>Bonus par ligne</th><th>Clics pour ouvrir</th></tr>
    ${Rules.RARITIES.map((r) => {
      const info = Rules.RARITY_INFO[r];
      return `<tr><td class="c-${r}" style="font-weight:800">${info.label}</td>
        <td><b>${table[r].toLocaleString('fr-FR')} %</b></td>
        <td style="width:30%"><div class="loot-bar"><div style="width:${table[r]}%;background:${RARITY_COLORS[r]}"></div></div></td>
        <td>${info.lines}</td><td>+${info.min} à +${info.max} %</td><td>${info.clicks}</td></tr>`;
    }).join('')}
  </table>`;
}

$('luck-sim').oninput = (e) => { simLuck = Number(e.target.value); renderLoot(); };
$('luck-reset').onclick = () => { simLuck = null; renderLoot(); };

async function act(url, body) {
  try {
    const r = await api(url, body);
    await refresh();
    return r;
  } catch (err) {
    toast('⚠️ ' + err.message);
    return null;
  }
}

$('buy-1').onclick = () => act('/api/chest/buy', { count: 1 });
$('buy-10').onclick = () => act('/api/chest/buy', { count: 10 });
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
  opener.show(result, {
    remaining: me.character.chests,
    onNext: openChest,
    onClose: () => { opening = false; render(); },
  });
}

// Aperçu animé du personnage.
(function animateAvatar() {
  const canvas = $('avatar');
  const ctx = canvas.getContext('2d');
  function frame(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (me) {
      const look = {};
      for (const [slot, item] of Object.entries(me.character.equipment)) if (item) look[slot] = item.rarity;
      drawFighter(ctx, 100, 118, { name: me.twitchDisplayName || me.username, look }, {
        scale: 3.4, bob: Math.sin(t / 400) * 3, swing: (Math.sin(t / 700) + 1) * 0.15,
      });
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

// Temps réel
const socket = io();
socket.on('me', (m) => { me = m; render(); });
socket.on('queue', (q) => { queue = q; if (me) renderQueue(); });
socket.on('reward', (r) => {
  const label = r.type === 'win' ? '🏆 VICTOIRE !' : '⚔️ Kill !';
  toast(`${label} +${r.reward.xp} XP, +${r.reward.gold} 🪙, +${r.reward.chests} 🎁`, 5000);
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
  const params = new URLSearchParams(location.search);
  if (params.get('twitch') === 'ok') toast('✅ Compte Twitch lié !');
  if (params.get('twitch') === 'error') toast('⚠️ Liaison Twitch échouée' + (params.get('msg') ? ' : ' + params.get('msg') : ''));
  if (params.has('twitch')) history.replaceState(null, '', '/character.html');
})();
