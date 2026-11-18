/*
 * Onglets Historique (les dernières parties, stream et solo, avec l'équipement et les stats du moment)
 * et Statistiques (tout ce que le personnage a accompli). Chargé avant character.js : utilise ses globales
 * (me, $, esc) seulement à l'appel. Aussi utilisé par la page admin (historyRowHtml).
 */
(function () {
  const fmt = (n) => Math.round(n || 0).toLocaleString('fr-FR');
  function fmtDur(s) {
    s = Math.max(0, Math.round(s || 0));
    if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
    if (s >= 60) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`;
    return `${s} s`;
  }
  function fmtDate(at) {
    const d = new Date(at);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  // Mode d'une ligne : modes du stream, ou contenu solo
  function kindOf(mode) {
    return Rules.GAME_MODES[mode] || Rules.HISTORY_KINDS[mode] || { label: mode, icon: '❔', color: '#ccc' };
  }
  const OUTCOME = {
    win: { label: 'Victoire', cls: 'win' },
    loss: { label: 'Défaite', cls: 'loss' },
    end: { label: 'Terminé', cls: 'end' },
  };

  // Résumé propre à chaque mode (rang, vie du boss, profondeur…)
  function detailText(e) {
    const d = e.details || {};
    const boss = d.boss && Rules.BOSSES[d.boss];
    switch (e.mode) {
      case 'br': return e.rank ? `${e.rank === 1 ? '🏆 ' : ''}${e.rank}ᵉ sur ${e.total}` : '';
      case 'koth': return `${e.rank ? `${e.rank}ᵉ sur ${e.total} · ` : ''}${d.score || 0} points · ${fmtDur(d.hillTime)} sur la colline`;
      case 'clans': return `${d.clan ? Rules.CLANS.teams[d.clan].icon + ' ' + Rules.CLANS.teams[d.clan].label : ''}${d.mvp ? ' · 🌟 MVP' : ''}`;
      case 'gold': return `🪙 ${d.gold || 0} golds ramassés · 🎁 ${d.chests || 0}${d.best ? ' · 👑 Roi du butin' : ''}`;
      case 'boss': return boss ? `${boss.icon} ${boss.short}${e.outcome === 'win' ? ' vaincu' : ` : il lui restait ${d.bossHp} % de vie`}` : '';
      case 'dungeon': return `🏰 Salle ${d.room || 0} atteinte`;
      case 'rush': return `💀 ${d.killed || 0} boss vaincu${d.killed > 1 ? 's' : ''} ${(d.defeated || []).map((id) => (Rules.BOSSES[id] || {}).icon || '').join('')}`;
      case 'expedition': return `🕳️ Profondeur ${d.depth || 0}${d.relics ? ` · 🔮 ${d.relics} relique${d.relics > 1 ? 's' : ''}` : ''}${d.abandoned ? ' · remonté' : ''}`;
      case 'survivor': return `🌊 Vague ${d.wave || 1} · ${(d.score || 0).toLocaleString('fr-FR')} points${d.bosses ? ` · 👹 ${d.bosses} boss` : ''}${d.emeralds ? ` · <i class="ico-emerald"></i> +${d.emeralds}` : ''}`;
      case 'challenge': {
        const D = Rules.BOSS_CHALLENGE[d.difficulty];
        return boss ? `${boss.icon} ${boss.short} ${D ? `(${D.label})` : ''}${e.outcome === 'win' ? ' vaincu' : ` : il lui restait ${d.bossHp} % de vie`}` : '';
      }
      default: return '';
    }
  }

  function gainsText(g) {
    if (!g) return '';
    const parts = [];
    if (g.xp) parts.push(`+${fmt(g.xp)} XP`);
    if (g.gold) parts.push(`+${fmt(g.gold)} 🪙`);
    if (g.chests) parts.push(`+${g.chests} 🎁`);
    if (g.keys) parts.push(`+${g.keys} 🗝️`);
    return parts.join(' · ') || 'aucun gain';
  }

  const STAT_ROWS = [
    ['maxHp', '❤️ Vie', (v) => `${fmt(v)} PV`], ['damage', '⚔️ Dégâts', (v) => `${v} / coup`], ['attackSpeed', '⚡ Attaques', (v) => `${v} / s`],
    ['reduction', '🛡️ Défense', (v) => `−${v} %`], ['dodge', '🌀 Esquive', (v) => `${v} %`], ['crit', '💥 Critique', (v) => `${v} %`],
    ['speed', '💨 Vitesse', (v) => `${v} px/s`], ['precision', '🎯 Précision', (v) => `${v} %`], ['lifesteal', '🩸 Vol de vie', (v) => `${v} %`],
    ['thorns', '🌵 Épines', (v) => `${v} %`], ['luck', '🍀 Chance', (v) => `${v}`],
  ];

  // Une ligne d'historique (dépliable : niveau, stats et équipement du moment). who : nom du joueur (vue admin).
  function historyRowHtml(e, who) {
    const K = kindOf(e.mode);
    const O = OUTCOME[e.outcome] || OUTCOME.end;
    const ci = e.cls && Rules.CLASS_INFO[e.cls];
    const gear = Rules.SLOTS.map((slot) => {
      const it = e.gear && e.gear[slot];
      const S = Rules.SLOT_INFO[slot];
      return `<div class="hist-gear-slot">${S.icon} ${it ? `<b style="color:${Rules.RARITY_INFO[it.rarity].color}">${esc(it.name)}</b>${it.set && Rules.SETS[it.set] ? ` ${Rules.SETS[it.set].icon}` : ''}` : '<span class="muted">vide</span>'}</div>`;
    }).join('');
    const stats = e.stats ? STAT_ROWS.filter(([k]) => e.stats[k] != null).map(([k, label, f]) => `<div><span>${label}</span><b>${f(e.stats[k])}</b></div>`).join('') : '';
    return `<details class="hist-row ${O.cls} ${who ? 'with-who' : ''}" style="--c:${K.color}" data-hid="${e.id || ''}" ${openRows.has(e.id) ? 'open' : ''}>
      <summary>
        <span class="hist-kind">${K.icon} ${esc(K.label)}</span>
        <span class="hist-outcome ${O.cls}">${O.label}</span>
        ${who ? `<span class="hist-who">${esc(who)}</span>` : ''}
        <span class="hist-detail">${detailText(e)}</span>
        <span class="hist-nums">⚔️ ${e.kills || 0} · 💥 ${fmt(e.dealt)} · 🩸 ${fmt(e.taken)}${e.bossDealt ? ` · 👹 ${fmt(e.bossDealt)}` : ''}</span>
        <span class="hist-gains">${gainsText(e.gains)}</span>
        <span class="hist-date">${fmtDate(e.at)} · ${fmtDur(e.duration)}</span>
      </summary>
      <div class="hist-body">
        <div class="hist-meta">Niveau <b>${e.level}</b> · ${ci ? `${ci.icon} ${ci.label}` : 'Sans classe'} · 💪 Puissance <b>${String(e.power || 0).replace('.', ',')}</b>
          · ⚔️ ${e.kills || 0} kill${e.kills > 1 ? 's' : ''} · ☠️ ${e.deaths || 0} mort${e.deaths > 1 ? 's' : ''}
          · 💥 ${fmt(e.dealt)} dégâts infligés · 🩸 ${fmt(e.taken)} dégâts subis${e.bossDealt ? ` · 👹 ${fmt(e.bossDealt)} sur les boss` : ''}</div>
        <div class="hist-cols">
          <div><h4>📊 Stats du moment</h4><div class="hist-stats">${stats}</div></div>
          <div><h4>🛡️ Équipement porté</h4><div class="hist-gear">${gear}</div></div>
        </div>
      </div>
    </details>`;
  }

  let histFilter = 'all';
  let histSig = '';
  const openRows = new Set(); // lignes dépliées (gardées quand la fiche se met à jour)
  const FILTERS = [['all', 'Tout'], ['online', '📺 Stream'], ['solo', '🕳️ Solo'], ['win', '🏆 Victoires'], ['loss', '💀 Défaites']];

  function renderHistory() {
    if (!me || !me.character) return;
    const list = me.character.history || [];
    // Rien n'a changé : on ne reconstruit pas (les lignes dépliées restent ouvertes)
    const sig = histFilter + '|' + list.map((e) => e.id).join(',');
    if (sig === histSig) return;
    histSig = sig;
    $('history-filters').innerHTML = FILTERS.map(([k, label]) => `<button class="chip ${histFilter === k ? 'active' : ''}" data-hf="${k}">${label}</button>`).join('');
    $('history-filters').querySelectorAll('[data-hf]').forEach((b) => { b.onclick = () => { histFilter = b.dataset.hf; renderHistory(); }; });
    const shown = list.filter((e) => histFilter === 'all'
      || (histFilter === 'online' && Rules.GAME_MODES[e.mode]) || (histFilter === 'solo' && Rules.HISTORY_KINDS[e.mode])
      || e.outcome === histFilter);
    $('history-list').innerHTML = shown.length ? shown.map((e) => historyRowHtml(e)).join('')
      : `<div class="muted">${list.length ? 'Aucune partie pour ce filtre.' : 'Pas encore de partie enregistrée : joue sur le stream ou en solo, elles apparaîtront ici (les ' + Rules.HISTORY.max + ' dernières).'}</div>`;
    $('history-list').querySelectorAll('details[data-hid]').forEach((d) => {
      d.addEventListener('toggle', () => { if (d.open) openRows.add(d.dataset.hid); else openRows.delete(d.dataset.hid); });
    });
  }

  // ---------- Statistiques ----------

  function card(title, rows) {
    return `<div class="stat-card"><h3>${title}</h3>${rows.filter(Boolean).map(([label, value, hint]) => `<div class="stat-line" ${hint ? `title="${esc(hint)}"` : ''}><span>${label}</span><b>${value}</b></div>`).join('')}</div>`;
  }

  function renderLifetime() {
    if (!me || !me.character) return;
    const c = me.character;
    const L = c.lifetime || {};
    const C = c.counters || {};
    const R = c.record || {};
    const modes = L.modes || {};
    const onlineGames = Object.values(modes).reduce((a, m) => a + (m.games || 0), 0);
    const onlineWins = Object.values(modes).reduce((a, m) => a + (m.wins || 0), 0);
    const since = c.lifetimeSince ? new Date(c.lifetimeSince).toLocaleDateString('fr-FR') : '';
    const pctWin = onlineGames ? Math.round((onlineWins / onlineGames) * 100) : 0;
    const achDone = Rules.ACHIEVEMENTS.filter((a) => Rules.achievementState(c, a).done).length;
    const ownedCosm = (c.owned || []).filter((id) => Rules.COSMETICS[id] && !Rules.COSMETICS[id].empty).length;
    const bossLines = Object.entries(Rules.BOSSES).map(([id, B]) => [`${B.icon} ${B.short} vaincu`, `${fmt(C[Rules.BOSS_WIN_COUNTER[id]])} fois`]);
    $('lifetime-since').textContent = since ? `Statistiques détaillées depuis le ${since} (les compteurs historiques remontent au début).` : '';
    $('lifetime-cards').innerHTML = [
      card('📺 Parties sur le stream', [
        ['Parties jouées', fmt(R.battles), 'Tous les modes du stream'],
        ['Victoires (Battle Royale, Colline, Clans)', fmt(R.wins)],
        ['Kills en Battle Royale', fmt(R.kills)],
        ['Parties depuis le suivi détaillé', fmt(onlineGames)],
        ['Victoires depuis le suivi', `${fmt(onlineWins)} (${pctWin} %)`],
        ['Défaites depuis le suivi', fmt(L.losses)],
        ['Morts', fmt(L.deaths)],
        ['Temps de jeu (stream + solo)', fmtDur(L.playTime)],
      ]),
      card('🎮 Par mode (depuis le suivi)', Object.entries(Rules.GAME_MODES).map(([id, M]) => [`${M.icon} ${M.label}`, `${fmt((modes[id] || {}).games)} partie${(modes[id] || {}).games > 1 ? 's' : ''} · ${fmt((modes[id] || {}).wins)} 🏆`])),
      card('⚔️ Combat', [
        ['Dégâts infligés', fmt(L.damageDealt)],
        ['Dégâts subis', fmt(L.damageTaken)],
        ['Dégâts sur les boss', fmt(L.bossDamage)],
        ['Record de kills en une partie', fmt(L.maxKills)],
        ['Record de dégâts en une partie', fmt(L.maxDamage)],
        ['Temps sur la colline', fmtDur(L.hillTime), 'Roi de la Colline'],
        ['Victoires du Roi de la Colline', fmt(C.kothWins)],
        ['Guerres des clans gagnées / MVP', `${fmt(C.clansWins)} / ${fmt(C.clansMvp)}`],
        ['Premiers sangs · doubles · massacres', `${fmt(C.firstblood)} · ${fmt(C.double)} · ${fmt(C.massacre)}`],
      ]),
      card('👹 Boss et raids', [
        ['Boss vaincus (au total)', fmt(C.bossWins)],
        ...bossLines,
        ['Record de salle (Raid de Donjon)', fmt(C.dungeonBest)],
        ['Salles franchies (au total)', fmt(L.dungeonRooms)],
        ['Record de boss en Boss Rush', fmt(C.rushBest)],
        ['Boss vaincus en Boss Rush', fmt(L.rushBosses)],
      ]),
      card('🕳️ Mode Solo', [
        ['Expéditions', fmt(L.expeditions)],
        ['Profondeur maximale', fmt(C.expeditionBest)],
        ['Profondeurs nettoyées (au total)', fmt(L.expeditionFloors)],
        ['Reliques choisies', fmt(C.relics)],
        ['Défis des boss tentés', fmt(L.challenges)],
        ['Défis réussis', fmt(C.challengeWins)],
        ['… en Héroïque ou Légendaire / en Légendaire', `${fmt(C.heroWins)} / ${fmt(C.legendWins)}`],
      ]),
      card('🧟 Survivor et Maison', [
        ['Parties de Survivor', fmt(L.survivorRuns)],
        ['Meilleure vague', fmt(C.svBestWave)],
        ['Meilleur score', fmt((c.survivor && c.survivor.best && c.survivor.best.score) || 0)],
        ['Monstres tués au Survivor', fmt(L.survivorKills)],
        ['Boss vaincus au Survivor', fmt(C.svBosses)],
        ['Émeraudes gagnées · actuelles', `${fmt(L.emeraldsEarned)} · ${fmt(c.emeralds || 0)}`],
        ['Niveau de décoration (record)', fmt(C.decoLevel)],
      ]),
      card('💰 Économie et loot', [
        ['Golds actuels', fmt(c.gold)],
        ['Golds gagnés', fmt(L.goldEarned), 'Récompenses, ventes au marché, paris, trouvailles (hors cadeaux de l\'admin)'],
        ['Coffres ouverts', fmt(C.chests)],
        ['Objets obtenus', fmt(L.itemsObtained), 'Coffres, fusions, marché, familiers'],
        ['Objets légendaires', fmt(C.legendary)],
        ['Objets recyclés', fmt(C.recycled)],
        ['Fusions · relances · alchimies', `${fmt(C.fused)} · ${fmt(C.rerolled)} · ${fmt(C.alchemy)}`],
        ['Ventes · achats au marché', `${fmt(C.sold)} · ${fmt(C.bought)}`],
        ['Paris gagnés (gains nets)', `${fmt(C.betsWon)} (${fmt(L.betGold)} 🪙)`],
        ['Potions utilisées', fmt(L.potionsUsed)],
        ['Golden Shower : record · total ramassé', `${fmt(C.goldBest)} · ${fmt(L.goldShower)} 🪙`],
        ['Casino : parties · misé · gagné', `${fmt(L.casinoBets)} · ${fmt(L.casinoWagered)} · ${fmt(L.casinoWon)} 🪙`],
        ['Casino : plus gros gain · jackpots', `${fmt(L.casinoBest)} 🪙 · ${fmt(C.jackpots)}`],
      ]),
      card('🏅 Collection', [
        ['Niveau', fmt(c.level)],
        ['Succès accomplis', `${achDone} / ${Rules.ACHIEVEMENTS.length}`],
        ['Cosmétiques possédés', fmt(ownedCosm)],
        ['Familiers', `${(c.pets && c.pets.list.length) || 0} / ${Object.keys(Rules.PETS).length}`],
        ['Trouvailles de familiers', fmt(C.petFinds)],
        ['Clés de boss', fmt(c.bossKeys)],
      ]),
    ].join('');
  }

  window.renderHistory = renderHistory;
  window.renderLifetime = renderLifetime;
  window.historyRowHtml = historyRowHtml;
})();
