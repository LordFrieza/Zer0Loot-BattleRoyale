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
      case 'tourney': {
        const b = d.bracket;
        if (e.outcome === 'win') return `🏆 Champion du tournoi · ${d.wins || 0} victoire${d.wins > 1 ? 's' : ''}`;
        const r = b && b.rounds[d.wins || 0];
        return `${d.wins || 0} victoire${d.wins > 1 ? 's' : ''}${r ? ` · éliminé en ${Rules.tourneyRoundName(r.length).toLowerCase()}` : ''}`;
      }
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

  /*
   * Image de l'arbre d'un tournoi (SVG) : chaque joueur à l'endroit le plus haut qu'il a atteint, les éliminés grisés,
   * le chemin du joueur de la fiche surligné. b = { players: [{ n, c, k }], rounds: [[[indices], gagnant]], me }.
   */
  function bracketSvg(b) {
    if (!b || !b.players || !b.rounds || !b.rounds.length) return '';
    const leaves = b.rounds[0].flatMap((m) => m[0]);
    const n = leaves.length;
    const gap = 80;
    const w = Math.max(320, n * gap + 30);
    const rowH = 64;
    const R = 15;
    const yLeaf = 34 + b.rounds.length * rowH;
    const h = yLeaf + 44;
    const leafPos = {};
    leaves.forEach((p, i) => { leafPos[p] = { x: w / 2 + (i - (n - 1) / 2) * gap, y: yLeaf }; });
    const nodes = b.rounds.map((r, ri) => r.map(() => null));
    b.rounds.forEach((r, ri) => r.forEach((m, mi) => {
      // Entrées d'un match : les joueurs (1er tour) ou les matchs du tour précédent, dans l'ordre de l'arbre
      let kids;
      if (ri === 0) kids = m[0].map((p) => leafPos[p]);
      else {
        let start = 0;
        for (let j = 0; j < mi; j++) start += b.rounds[ri][j][0].length; // (un match par joueur qualifié)
        kids = [];
        for (let j = 0; j < m[0].length; j++) kids.push(nodes[ri - 1][start + j]);
      }
      nodes[ri][mi] = { x: kids.reduce((a, c) => a + c.x, 0) / kids.length, y: yLeaf - (ri + 1) * rowH, kids, m };
    }));
    const where = {};
    leaves.forEach((p) => { where[p] = leafPos[p]; });
    const out = new Set();
    nodes.flat().forEach((nd) => { if (nd.m[1] >= 0) where[nd.m[1]] = nd; nd.m[0].forEach((p) => { if (p !== nd.m[1]) out.add(p); }); });
    const color = (p) => {
      const P = b.players[p] || {};
      const opt = P.k && Rules.APPEARANCE.color.options[P.k];
      if (opt) return opt.hex;
      let hue = 0;
      for (const ch of String(P.n || '')) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
      return `hsl(${hue}, 55%, 62%)`;
    };
    // Traits : le chemin du gagnant en or, celui du joueur de la fiche en cyan
    let lines = '';
    nodes.forEach((r, ri) => r.forEach((nd) => nd.kids.forEach((c, i) => {
      const k = nd.m[0][i]; // (au-delà du 1er tour, les places suivent l'ordre des matchs précédents)
      const won = k === nd.m[1];
      const stroke = won ? (k === b.me ? '#29e7ff' : '#ffc21a') : '#5d5873';
      const mid = (c.y + nd.y) / 2;
      lines += `<path d="M${c.x} ${c.y - R}V${mid}H${nd.x}V${nd.y + R}" fill="none" stroke="${stroke}" stroke-width="${won ? 3 : 2}"/>`;
    })));
    // Places quittées par ceux qui sont montés plus haut : cercles en pointillés
    let heads = leaves.filter((p) => where[p] !== leafPos[p]).map((p) => leafPos[p])
      .concat(nodes.flat().filter((nd) => nd.m[1] >= 0 && where[nd.m[1]] !== nd))
      .map((pt) => `<circle cx="${pt.x}" cy="${pt.y}" r="${R * 0.75}" fill="none" stroke="#ffc21a" stroke-opacity=".5" stroke-width="1.5" stroke-dasharray="3 4"/>`).join('');
    const champ = nodes[nodes.length - 1][0].m[1];
    leaves.forEach((p) => {
      const pt = where[p];
      const isOut = out.has(p);
      const big = p === champ ? 1.35 : 1;
      const r = R * big;
      const ring = p === b.me ? '#29e7ff' : isOut ? '#6f6a80' : '#ffc21a';
      heads += `<g opacity="${isOut ? 0.55 : 1}" ${isOut ? 'filter="url(#hb-grey)"' : ''}>
        <circle cx="${pt.x}" cy="${pt.y}" r="${r}" fill="${color(p)}" stroke="${ring}" stroke-width="${p === b.me ? 3.5 : 2.5}"/>
        <circle cx="${pt.x - r * 0.33}" cy="${pt.y - r * 0.08}" r="${r * 0.12}" fill="#1b1030"/><circle cx="${pt.x + r * 0.33}" cy="${pt.y - r * 0.08}" r="${r * 0.12}" fill="#1b1030"/>
        <path d="M${pt.x - r * 0.3} ${pt.y + r * 0.32}Q${pt.x} ${pt.y + r * (isOut ? 0.15 : 0.55)} ${pt.x + r * 0.3} ${pt.y + r * 0.32}" fill="none" stroke="#1b1030" stroke-width="1.6" stroke-linecap="round"/>
      </g>`;
      if (p === champ) heads += `<text x="${pt.x}" y="${pt.y - r - 4}" text-anchor="middle" font-size="${r}">👑</text>`;
    });
    const names = leaves.map((p, i) => {
      const P = b.players[p] || {};
      const ci = P.c && Rules.CLASS_INFO[P.c];
      const name = String(P.n || '?');
      const short = name.length > 11 ? name.slice(0, 10) + '…' : name;
      return `<text x="${leafPos[p].x}" y="${yLeaf + R + 14 + (n > 10 && i % 2 ? 12 : 0)}" text-anchor="middle" font-size="11" font-weight="700" fill="${p === b.me ? '#29e7ff' : out.has(p) ? '#8d88a0' : '#fff'}">${esc((ci ? ci.icon : '') + short)}</text>`;
    }).join('');
    return `<svg class="hist-bracket" viewBox="0 0 ${w} ${h + (n > 10 ? 12 : 0)}" style="max-width:${w}px" role="img" aria-label="Arbre du tournoi">
      <defs><filter id="hb-grey"><feColorMatrix type="saturate" values="0"/></filter></defs>${lines}${heads}${names}</svg>`;
  }

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
        ${e.mode === 'tourney' && e.details && e.details.bracket ? `<div class="hist-bracket-wrap"><h4>🏆 Arbre du tournoi</h4>${bracketSvg(e.details.bracket)}</div>` : ''}
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
