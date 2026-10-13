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
Sound.bindToggle($('sound-toggle'));
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
    b.onclick = () => act('/api/stats/allocate', { stat: b.dataset.stat }, 'levelUp');
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
  // Retire de la sélection les objets qui ne sont plus dans l'inventaire.
  const ids = new Set(inv.map((i) => i.id));
  for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);

  $('inventory').classList.toggle('recycling', recycleMode);
  $('inventory').innerHTML = list.length
    ? list.map((item) => itemHtml(item, `${compareHtml(item)}<div class="actions"><button class="small" data-equip="${item.id}">Équiper</button></div>`)).join('')
    : '<div class="muted">Ton coffre personnel est vide. Ouvre des coffres de LOOT pour le remplir !</div>';
  $('inventory').querySelectorAll('[data-equip]').forEach((b) => {
    b.onclick = () => act('/api/equip', { itemId: b.dataset.equip }, 'equip');
  });
  $('inventory').querySelectorAll('.item').forEach((el) => {
    el.classList.toggle('selected', recycleMode && selected.has(el.dataset.id));
    el.onclick = () => {
      if (!recycleMode) return;
      if (selected.has(el.dataset.id)) selected.delete(el.dataset.id);
      else selected.add(el.dataset.id);
      el.classList.toggle('selected');
      renderRecycleBar(list);
    };
  });
  $('recycle-toggle').disabled = inv.length === 0 && !recycleMode;
  renderRecycleBar(list);
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
      else visible.filter((i) => k === 'all' || i.rarity === k).forEach((i) => selected.add(i.id));
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
  if (!queue || !queue.bets || queue.phase === 'idle' || (queue.phase === 'ended' && !queue.bets.lastResult && !lastBetResult)) {
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
      <div class="bet-name"><span>${p.bot ? '🤖' : '⚔️'} ${esc(p.name)}</span><span class="muted">Niv. ${p.level}</span></div>
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
socket.on('queue', (q) => { queue = q; if (me) { renderQueue(); renderBets(); } });
const REWARD_LABELS = { win: '🏆 VICTOIRE !', kill: '⚔️ Kill !', participation: '🎖️ Participation à la bataille' };
const REWARD_SOUNDS = { win: 'victory', kill: 'reward', participation: 'levelUp' };
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
  if (r.reward.chests) gains.push(`+${r.reward.chests} 🎁`);
  toast(`${REWARD_LABELS[r.type]} ${gains.join(', ')}`, 5000);
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
