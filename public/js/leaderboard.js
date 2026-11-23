/* Classements (victoires, kills, batailles, records d'Expédition, de donjon et du Survivor, coffres, légendaires, casino (gagnants et poissards), fortune)
   avec podium pour le top 3. Utilisé par la page perso et la page admin. */
(function () {
  const BOARDS = [
    { key: 'wins', label: 'Victoires', icon: '🏆', unit: 'victoire', note: 'Battle Royale, Roi de la Colline et Guerre des clans' },
    { key: 'kills', label: 'Kills', icon: '⚔️', unit: 'kill', note: 'Battle Royale uniquement' },
    { key: 'battles', label: 'Batailles jouées', icon: '🎖️', unit: 'bataille', note: 'Tous les modes du stream' },
    { key: 'expedition', label: 'Expédition', icon: '🕳️', unit: 'profondeur', fmt: (n) => `profondeur ${n}`, note: 'Record de profondeur en mode Solo' },
    { key: 'dungeon', label: 'Raid de Donjon', icon: '🏰', unit: 'salle', fmt: (n) => `salle ${n}`, note: 'Salle la plus lointaine atteinte' },
    { key: 'survivor', label: 'Survivor', icon: '🧟', unit: 'vague', fmt: (n) => `vague ${n}`, note: 'Vague la plus lointaine atteinte' },
    { key: 'fish', label: 'Pêcheurs', icon: '🎣', unit: 'poisson', fmt: (n) => `${fmtN(n)} poisson${n > 1 ? 's' : ''}`, note: 'Nombre de poissons pêchés' },
    { key: 'chests', label: 'Coffres ouverts', icon: '🎁', unit: 'coffre', fmt: (n) => `${fmtN(n)} coffre${n > 1 ? 's' : ''}`, note: 'Depuis la création du personnage' },
    { key: 'legendary', label: 'Légendaires', icon: '🌟', unit: 'légendaire', fmt: (n) => `${fmtN(n)} légendaire${n > 1 ? 's' : ''}`, note: 'Objets légendaires sortis des coffres' },
    { key: 'jackpots', label: 'Chanceux du casino', icon: '🎰', unit: 'jackpot', fmt: (n) => `${fmtN(n)} jackpot${n > 1 ? 's' : ''}`, note: 'Jackpots décrochés au casino' },
    { key: 'casino', label: 'Profits positifs au casino', icon: '💹', unit: 'golds', fmt: (n) => `+${fmtN(n)} 🪙`, note: 'Bilan du casino (gagné − misé), les plus gros gagnants' },
    { key: 'casinoLoss', label: 'Profits négatifs au casino', icon: '📉', unit: 'golds', fmt: (n) => `−${fmtN(n)} 🪙`, note: 'Bilan du casino (misé − gagné), les plus poissards en haut' },
    { key: 'gold', label: 'Les plus riches', icon: '💰', unit: 'golds', fmt: (n) => `${fmtN(n)} 🪙`, note: 'Golds possédés en ce moment' },
  ];
  const fmtN = (n) => Number(n).toLocaleString('fr-FR');
  const MEDALS = ['🥇', '🥈', '🥉'];

  function name(p, meId) {
    const ci = p.cls && Rules.CLASS_INFO[p.cls];
    return `${ci ? ci.icon + ' ' : ''}<span class="${p.id === meId ? 'lb-me' : ''}">${esc(p.name)}</span>`;
  }

  function board(b, list, meId) {
    const plural = b.fmt || ((n) => `${n} ${b.unit}${n > 1 ? 's' : ''}`);
    const head = `<h3>${b.icon} ${b.label}</h3><div class="lb-note">${b.note}</div>`;
    if (!list.length) return `<div class="lb-board">${head}<p class="muted">Personne pour l'instant.</p></div>`;
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
      <span class="lb-rank">#${i + 4}</span><span class="lb-rest-name">${name(p, meId)}</span><span class="muted">Niv. ${p.level}</span><b>${b.fmt ? b.fmt(p.value) : p.value}</b></li>`).join('');
    return `<div class="lb-board">${head}<div class="lb-podium">${podium}</div>${rest ? `<ol class="lb-rest">${rest}</ol>` : ''}</div>`;
  }

  window.renderLeaderboard = function (el, data, meId) {
    el.innerHTML = `<div class="lb-grid">${BOARDS.map((b) => board(b, data[b.key] || [], meId)).join('')}</div>`;
  };
})();
