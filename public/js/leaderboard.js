/* Classements (victoires, kills, batailles) avec podium pour le top 3. Utilisé par la page perso et la page admin. */
(function () {
  const BOARDS = [
    { key: 'wins', label: 'Victoires', icon: '🏆', unit: 'victoire' },
    { key: 'kills', label: 'Kills', icon: '⚔️', unit: 'kill' },
    { key: 'battles', label: 'Batailles jouées', icon: '🎖️', unit: 'bataille' },
  ];
  const MEDALS = ['🥇', '🥈', '🥉'];

  function name(p, meId) {
    const ci = p.cls && Rules.CLASS_INFO[p.cls];
    return `${ci ? ci.icon + ' ' : ''}<span class="${p.id === meId ? 'lb-me' : ''}">${esc(p.name)}</span>`;
  }

  function board(b, list, meId) {
    const plural = (n) => `${n} ${b.unit}${n > 1 ? 's' : ''}`;
    if (!list.length) return `<div class="lb-board"><h3>${b.icon} ${b.label}</h3><p class="muted">Personne pour l'instant.</p></div>`;
    // Ordre visuel du podium : 2e, 1er, 3e
    const podium = [1, 0, 2].filter((i) => list[i]).map((i) => {
      const p = list[i];
      return `<div class="lb-step lb-step-${i + 1}">
        <div class="lb-medal">${MEDALS[i]}</div>
        <div class="lb-name">${name(p, meId)}</div>
        ${p.title ? `<div class="lb-title">« ${esc(p.title)} »</div>` : ''}
        <div class="lb-value">${plural(p.value)}</div>
        <div class="lb-block">${i + 1}</div>
      </div>`;
    }).join('');
    const rest = list.slice(3).map((p, i) => `<li class="${p.id === meId ? 'lb-me-row' : ''}">
      <span class="lb-rank">#${i + 4}</span><span class="lb-rest-name">${name(p, meId)}</span><span class="muted">Niv. ${p.level}</span><b>${p.value}</b></li>`).join('');
    return `<div class="lb-board"><h3>${b.icon} ${b.label}</h3><div class="lb-podium">${podium}</div>${rest ? `<ol class="lb-rest">${rest}</ol>` : ''}</div>`;
  }

  window.renderLeaderboard = function (el, data, meId) {
    el.innerHTML = `<div class="lb-grid">${BOARDS.map((b) => board(b, data[b.key] || [], meId)).join('')}</div>`;
  };
})();
