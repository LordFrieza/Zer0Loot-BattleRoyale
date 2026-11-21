/*
 * Onglet Familier : l'enclos animé (canevas), la fiche du familier principal (besoins, trouvailles, soins),
 * le garde-manger et l'épicerie, les objets de l'enclos et la collection des 6 mini boss.
 * Chargé avant character.js : utilise ses globales (me, act, api, toast, esc, $) seulement à l'appel.
 */
(function () {
  const W = 960;
  const H = 400;
  const GROUND = 232; // haut de l'herbe
  const PET_SIZE = 1.75; // taille des familiers dans l'enclos
  const NEED_INFO = {
    faim: { label: 'Faim', icon: '🍖', color: '#ffb347' },
    soif: { label: 'Soif', icon: '💧', color: '#5fd3ff' },
    joie: { label: 'Joie', icon: '🎾', color: '#ff7ac8' },
  };
  // Emplacements des objets de l'enclos sur la scène
  const SCENE_W = W;
  const SCENE_GROUND = GROUND;
  const SPOT_DEFAULT = {
    statue: { x: 70, y: 262 }, jouets: { x: 160, y: 268 }, gamelle: { x: 250, y: 352 }, mare: { x: 500, y: 356 },
    fontaine: { x: 770, y: 262 }, niche: { x: 880, y: 300 }, fleurs: { x: 0, y: 0 }, lanternes: { x: 0, y: 0 },
  };

  const scene = {
    pets: new Map(), // id → { x, y, tx, ty, wait, facing, hop, anim, animT, squish }
    fx: [], // particules (cœurs, miettes, étoiles, gouttes)
    ball: null,
    bowl: null,
    hand: null,
    texts: [],
    raf: null,
    last: 0,
    gifts: [], // positions des cadeaux en attente (cliquables)
  };

  const now = () => Date.now();
  const P = () => me && me.character && me.character.pets;
  const enclos = () => (P() ? P().enclos : []);
  // État du familier recalculé à l'instant (même formule que le serveur)
  function live(pet) {
    return Rules.petAdvance(pet, enclos(), now(), pet.id === P().active).pet;
  }
  function activePet() {
    const pets = P();
    return pets && pets.active ? pets.list.find((p) => p.id === pets.active) || null : null;
  }
  function fmtDur(ms) {
    const m = Math.max(0, Math.ceil(ms / 60000));
    if (m >= 60 * 24) return `${Math.floor(m / 1440)} j ${Math.floor((m % 1440) / 60)} h`;
    if (m >= 60) return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
    return `${m} min`;
  }
  function moodOf(sat) {
    if (sat >= 80) return { icon: '😄', text: 'Aux anges', color: '#3ddc5a' };
    if (sat >= 50) return { icon: '🙂', text: 'Content', color: '#ffd23f' };
    if (sat >= 25) return { icon: '😟', text: 'Triste : il ne ramène plus rien', color: '#ff9a1f' };
    return { icon: '😭', text: 'Malheureux : il ne ramène plus rien', color: '#ff4d6d' };
  }
  const bossOf = (species) => Rules.BOSSES[species];

  // ---------- Rendu HTML ----------

  function renderPets() {
    if (!me || !P()) return;
    const pets = P();
    const has = pets.list.length > 0;
    $('pet-empty').style.display = has ? 'none' : '';
    $('pet-main').style.display = has ? '' : 'none';
    if (!has) {
      $('pet-empty').innerHTML = `<div class="pet-empty-box"><div class="pet-empty-ico">🥚</div>
        <b>Ton enclos est vide… pour l'instant !</b>
        <p>Chaque boss vaincu (Combat de Boss, Boss Rush ou Défi des boss du mode Solo) a <b>${Math.round(Rules.PET.dropChance * 100)} % de chance</b>
        de laisser sa version miniature à chaque héros. Il viendra vivre ici, et tu pourras t'en occuper.</p></div>`;
    }
    renderSide();
    renderLog();
    renderPantry();
    renderEnclosShop();
    renderCollection();
    syncScene();
    startScene();
  }

  function needBar(k, v) {
    const N = NEED_INFO[k];
    return `<div class="pet-need" title="${N.label} : ${Math.round(v)} / 100">
      <span class="pet-need-ico">${N.icon}</span><span class="pet-need-lbl">${N.label}</span>
      <span class="pet-need-bar"><span style="width:${Math.max(0, Math.min(100, v))}%;background:${N.color}"></span></span>
      <span class="pet-need-val">${Math.round(v)}</span></div>`;
  }

  // ---------- Journal des trouvailles ----------
  let logSig = null; // évite de reconstruire le journal (et ses dessins) quand rien n'a changé
  function findText(e) {
    return findBody(e) + (e.surprise ? ' <span class="muted">(surprise !)</span>' : '');
  }
  function findBody(e) {
    if (e.kind === 'emerald') return `<b class="pet-log-gain emerald">+${e.emeralds.toLocaleString('fr-FR')} <i class="ico-emerald"></i></b>`;
    if (e.kind === 'ticket') return `<b class="pet-log-gain">+${e.tickets} 🎟️ ticket${e.tickets > 1 ? 's' : ''} de casino</b>`;
    if (e.kind === 'gold') return `<b class="pet-log-gain gold">+${e.gold.toLocaleString('fr-FR')} 🪙</b>`;
    if (e.kind === 'xp') return `<b class="pet-log-gain xp">+${e.xp.toLocaleString('fr-FR')} XP</b>`;
    if (e.kind === 'chest') return `<b class="pet-log-gain">+${e.chests} <i class="ico-chest"></i> coffre${e.chests > 1 ? 's' : ''}</b>`;
    if (e.kind === 'potion') {
      const C = Rules.CONSUMABLES[e.potion];
      return `<b class="pet-log-gain">${C ? `${C.icon} ${C.label}` : 'Une potion'}</b>${e.key ? ' <b class="pet-log-gain key">+ 🗝️ Clé de boss !</b>' : ''}`;
    }
    if (e.kind === 'item' && e.item) {
      const S = Rules.SLOT_INFO[e.item.slot];
      return `<b class="c-${e.item.rarity}">${S ? S.icon + ' ' : ''}${esc(e.item.name)}</b> <span class="muted">${Rules.RARITY_INFO[e.item.rarity].label}</span>`;
    }
    return '';
  }
  function whenText(at) {
    const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
    if (s < 60) return 'à l\'instant';
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
    const d = new Date(at);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function renderLog() {
    const pets = P();
    const log = pets.log || [];
    const T = pets.totals || {};
    const sig = `${log.length}:${log[0] ? log[0].at : 0}:${T.finds}:${Math.floor(Date.now() / 60000)}`;
    if (sig === logSig) return;
    logSig = sig;
    const chip = (v, label, cls = '') => (v ? `<span class="pet-log-total ${cls}">${label}</span>` : '');
    const totals = T.finds
      ? `<div class="pet-log-totals"><span class="muted">Depuis le début :</span>
        ${chip(T.finds, `🎁 <b>${T.finds}</b> trouvaille${T.finds > 1 ? 's' : ''}`)}
        ${chip(T.gold, `<b>${(T.gold || 0).toLocaleString('fr-FR')}</b> 🪙`, 'gold')}
        ${chip(T.xp, `<b>${(T.xp || 0).toLocaleString('fr-FR')}</b> XP`, 'xp')}
        ${chip(T.chests, `<b>${T.chests}</b> <i class="ico-chest"></i>`)}
        ${chip(T.potions, `🧪 <b>${T.potions}</b> potion${T.potions > 1 ? 's' : ''}`)}
        ${chip(T.emeralds, `<b>${(T.emeralds || 0).toLocaleString('fr-FR')}</b> <i class="ico-emerald"></i>`, 'emerald')}
        ${chip(T.tickets, `🎟️ <b>${T.tickets}</b> ticket${T.tickets > 1 ? 's' : ''}`)}
        ${chip(T.keys, `🗝️ <b>${T.keys}</b> clé${T.keys > 1 ? 's' : ''}`, 'key')}
        ${chip(T.items, `⚔️ <b>${T.items}</b> objet${T.items > 1 ? 's' : ''}`)}</div>`
      : '';
    $('pet-log').innerHTML = `<h3>📜 Ce que tes familiers ont rapporté</h3>${totals}
      <div class="pet-log-list">${log.length ? log.map((e) => `<div class="pet-log-row">
          <canvas width="40" height="36" data-plog="${e.species || ''}"></canvas>
          <div class="pet-log-main"><div><b style="color:${(Rules.PETS[e.species] || {}).color || 'inherit'}">${esc(e.name)}</b> a rapporté ${findText(e)}</div></div>
          <span class="pet-log-when muted" title="${new Date(e.at).toLocaleString('fr-FR')}">${whenText(e.at)}</span>
        </div>`).join('')
    : `<p class="muted pet-log-empty">Rien pour l'instant. Quand tu récupères les trouvailles de tes familiers (bouton 🎁), elles s'affichent ici.</p>`}</div>`;
    $('pet-log').querySelectorAll('canvas[data-plog]').forEach((cv) => {
      if (!cv.dataset.plog || !Rules.PETS[cv.dataset.plog]) return;
      const ctx = cv.getContext('2d');
      drawPet(ctx, 20, 31, cv.dataset.plog, { t: 900, size: 0.42 });
    });
  }

  function renderSide() {
    const pet = activePet();
    if (!pet) { $('pet-side').innerHTML = ''; return; }
    const cur = live(pet);
    const sat = Rules.petSatisfaction(cur.needs);
    const mood = moodOf(sat);
    const S = Rules.PETS[pet.species];
    const B = bossOf(pet.species);
    const fx = Rules.petEnclosEffects(enclos());
    const every = Rules.petFindEvery(pet.level, fx);
    const findIn = cur.findAt ? cur.findAt - now() : every;
    const maxed = pet.level >= Rules.PET.maxLevel;
    const xpNeed = Rules.petXpToNext(pet.level);
    const A = Rules.PET.actions;
    const cd = (key, ms) => Math.max(0, (pet[key] || 0) + ms - now());
    const caressCd = cd('caressAt', A.caresser.cooldownMs);
    const playCd = cd('playAt', A.jouer.cooldownMs);
    const streakMs = cur.streakAt != null ? now() - cur.streakAt : 0;
    const followMs = Rules.PET.followDays * 24 * 3600 * 1000;
    const finds = P().list.reduce((a, p) => a + (live(p).finds || 0), 0);
    const findValue = Rules.petFindValue(pet.species, pet.level, fx);
    const findText = S.find === 'gold' ? `${findValue} golds` : S.find === 'xp' ? `${findValue} XP` : S.find === 'emerald' ? `${findValue} émeraude${findValue > 1 ? 's' : ''}` : S.findLabel;
    $('pet-side').innerHTML = `
      <div class="pet-card" style="--c:${S.color}">
        <div class="pet-card-head">
          <button class="pet-name" id="pet-rename" title="Renommer">${esc(pet.name)} ✏️</button>
          <span class="pet-species">${B.icon} mini ${esc(B.short)}</span>
        </div>
        <div class="pet-level"><b>Niveau ${pet.level}</b>${maxed ? ' <span class="muted">(max)</span>' : ` <span class="muted">${pet.xp} / ${xpNeed} XP</span>`}
          <span class="pet-xp"><span style="width:${maxed ? 100 : (pet.xp / xpNeed) * 100}%"></span></span></div>
        <div class="pet-mood" style="--m:${mood.color}"><span class="pet-mood-ico">${mood.icon}</span>
          <div><b>Satisfaction : ${Math.round(sat)} %</b><br><span>${mood.text}</span></div>
          <span class="pet-sat"><span style="width:${sat}%;background:${mood.color}"></span><i style="left:${Rules.PET.findThreshold}%" title="Trouvailles à partir de ${Rules.PET.findThreshold} %"></i><i style="left:${Rules.PET.followThreshold}%" title="Compagnon de combat : ${Rules.PET.followThreshold} % pendant ${Rules.PET.followDays} jours"></i></span>
        </div>
        ${['faim', 'soif', 'joie'].map((k) => needBar(k, cur.needs[k])).join('')}
        <div class="pet-actions">
          <button data-pact="caresser" ${caressCd ? 'disabled' : ''} title="+${A.caresser.joie + fx.caress} Joie">${A.caresser.icon} Caresser${caressCd ? `<small>${fmtDur(caressCd)}</small>` : ''}</button>
          <button data-pact="jouer" ${playCd ? 'disabled' : ''} title="+${A.jouer.joie + fx.play} Joie, un peu de faim et de soif">${A.jouer.icon} Jouer${playCd ? `<small>${fmtDur(playCd)}</small>` : ''}</button>
        </div>
        <div class="pet-feed-row">${Object.entries(Rules.PET_FOODS).map(([id, F]) => {
          const n = P().food[id] || 0;
          const fav = S.favorite === id;
          return `<button class="pet-food ${fav ? 'fav' : ''}" data-pfeed="${id}" ${n ? '' : 'disabled'} title="${F.label}${fav ? ' (son plat préféré : effet ×1,5 !)' : ''} : ${[F.faim ? `+${F.faim} Faim` : '', F.soif ? `+${F.soif} Soif` : '', F.joie ? `+${F.joie} Joie` : ''].filter(Boolean).join(', ')}">
            <span>${F.icon}</span><small>×${n}</small>${fav ? '<i>❤️</i>' : ''}</button>`;
        }).join('')}</div>
        <div class="pet-finds">
          <div>🎁 Il ramène <b>${findText}</b> toutes les <b>${fmtDur(every)}</b> s'il est à ${Rules.PET.findThreshold} % ou plus.</div>
          <div class="muted">${(cur.finds || 0) >= Rules.PET.maxFinds ? `Il a déjà ${Rules.PET.maxFinds} trouvailles en attente : récupère-les !` : `Prochaine trouvaille dans ${fmtDur(findIn)}${sat < Rules.PET.findThreshold ? ' (s\'il est assez content d\'ici là)' : ''}.`}</div>
          <button class="gold" id="pet-collect" ${finds ? '' : 'disabled'}>🎁 Récupérer ${finds ? `${finds} trouvaille${finds > 1 ? 's' : ''}` : 'les trouvailles'}</button>
        </div>
        <div class="pet-follow">
          ${pet.follower
            ? `⚔️ <b>Compagnon de combat débloqué !</b> <button class="small ${P().follow === pet.id ? 'secondary' : ''}" id="pet-follow">${P().follow === pet.id ? 'Ne plus l\'emmener en bataille' : '🐾 L\'emmener en bataille'}</button>`
            : `<div>⚔️ Compagnon de combat : <b>${fmtDur(Math.min(streakMs, followMs))}</b> / ${Rules.PET.followDays} j au-dessus de ${Rules.PET.followThreshold} %</div>
               <span class="pet-streak"><span style="width:${Math.min(100, (streakMs / followMs) * 100)}%"></span></span>
               <span class="muted">${cur.streakAt != null ? 'Garde-le heureux : la série continue !' : `Sa satisfaction doit rester au-dessus de ${Rules.PET.followThreshold} % pour lancer la série.`}</span>`}
        </div>
      </div>`;
    $('pet-rename').onclick = async () => {
      const name = await promptBox('Nouveau nom de ton familier :', pet.name, { title: '✏️ Renommer' });
      if (name && name.trim()) act('/api/pet/rename', { id: pet.id, name }, 'equip');
    };
    $('pet-side').querySelectorAll('[data-pact]').forEach((b) => { b.onclick = () => petAct(b.dataset.pact); });
    $('pet-side').querySelectorAll('[data-pfeed]').forEach((b) => { b.onclick = () => petFeed(b.dataset.pfeed); });
    $('pet-collect').onclick = collect;
    const fb = $('pet-follow');
    if (fb) fb.onclick = () => act('/api/pet/follow', { id: P().follow === pet.id ? null : pet.id }, 'equip');
  }

  function renderPantry() {
    const food = P().food;
    $('pet-pantry').innerHTML = `<h3>🧺 Épicerie de l'enclos</h3>
      <p class="muted">Achète de quoi nourrir et abreuver ton familier. Chaque espèce a son plat préféré (❤️ : effet ×${String(Rules.PET.favoriteMult).replace('.', ',')}).</p>
      <div class="pet-shop">${Object.entries(Rules.PET_FOODS).map(([id, F]) => `<div class="pet-shop-item">
        <span class="pet-shop-ico">${F.icon}</span>
        <div><b>${F.label}</b> <span class="muted">×${food[id] || 0}</span><br>
          <small>${[F.faim ? `+${F.faim} Faim` : '', F.soif ? `+${F.soif} Soif` : '', F.joie ? `+${F.joie} Joie` : ''].filter(Boolean).join(' · ')}</small></div>
        <button class="small" data-pbuy="${id}" data-n="1" ${me.character.gold < F.price ? 'disabled' : ''}>${F.price} 🪙</button>
        <button class="small secondary" data-pbuy="${id}" data-n="5" ${me.character.gold < F.price * 5 ? 'disabled' : ''}>×5 · ${F.price * 5} 🪙</button>
      </div>`).join('')}</div>`;
    $('pet-pantry').querySelectorAll('[data-pbuy]').forEach((b) => {
      b.onclick = () => act('/api/pet/food/buy', { food: b.dataset.pbuy, count: Number(b.dataset.n) }, 'buy');
    });
  }

  function renderEnclosShop() {
    const owned = enclos();
    $('pet-enclos-shop').innerHTML = `<h3>🏡 Aménager l'enclos</h3>
      <p class="muted">Des objets achetés une fois pour toutes : ils rendent la vie de tes familiers plus douce (et l'enclos plus joli).</p>
      <div class="pet-shop">${Object.entries(Rules.PET_ENCLOS).map(([id, E]) => {
        const have = owned.includes(id);
        return `<div class="pet-shop-item ${have ? 'owned' : ''}">
          <span class="pet-shop-ico">${E.icon}</span>
          <div><b>${E.label}</b><br><small>${E.desc}</small></div>
          ${have ? '<span class="pet-owned">✅ Installé</span>' : `<button class="small" data-penclos="${id}" ${me.character.gold < E.price ? 'disabled' : ''}>${E.price} 🪙</button>`}
        </div>`;
      }).join('')}</div>`;
    $('pet-enclos-shop').querySelectorAll('[data-penclos]').forEach((b) => {
      b.onclick = async () => {
        const r = await act('/api/pet/enclos/buy', { item: b.dataset.penclos }, 'buy');
        if (r) { const sp = SPOT_DEFAULT[b.dataset.penclos]; burst(sp.x || W / 2, sp.y || 120, ['✨', '⭐'], 14); }
      };
    });
  }

  function renderCollection() {
    const pets = P();
    $('pet-collection').innerHTML = `<h3>📖 Ma collection <span class="muted">(${pets.list.length} / ${Object.keys(Rules.PETS).length})</span></h3>
      <div class="pet-collection">${Object.entries(Rules.PETS).map(([sp, S]) => {
        const pet = pets.list.find((p) => p.species === sp);
        const B = bossOf(sp);
        if (!pet) {
          return `<div class="pet-slot locked"><canvas width="120" height="96" data-pdraw="${sp}" data-locked="1"></canvas>
            <b>???</b><small>${Math.round(Rules.PET.dropChance * 100)} % de chance en battant ${B.icon} ${esc(B.short)}</small><small class="muted">Ramène ${S.findLabel}</small></div>`;
        }
        const active = pets.active === pet.id;
        const cur = live(pet);
        const sat = Math.round(Rules.petSatisfaction(cur.needs));
        return `<div class="pet-slot ${active ? 'active' : ''}" style="--c:${S.color}"><canvas width="120" height="96" data-pdraw="${sp}"></canvas>
          <b>${esc(pet.name)}</b><small>Niveau ${pet.level}${pet.follower ? ' · ⚔️ compagnon' : ''}</small>
          <small>${active ? `${moodOf(sat).icon} ${sat} % · principal` : '💤 Se repose (ses besoins ne baissent pas)'}</small>
          ${cur.finds ? `<small class="pet-has-gift">🎁 ${cur.finds} trouvaille${cur.finds > 1 ? 's' : ''}</small>` : ''}
          ${active ? '<span class="pet-badge">⭐ Principal</span>' : `<button class="small" data-pactive="${pet.id}">Choisir comme principal</button>`}</div>`;
      }).join('')}</div>`;
    $('pet-collection').querySelectorAll('[data-pactive]').forEach((b) => {
      b.onclick = () => act('/api/pet/active', { id: b.dataset.pactive }, 'equip');
    });
    $('pet-collection').querySelectorAll('canvas[data-pdraw]').forEach((cv) => {
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (cv.dataset.locked) ctx.filter = 'brightness(0) opacity(0.45)';
      drawPet(ctx, 60, 84, cv.dataset.pdraw, { t: 900, size: 1.15 });
    });
  }

  // ---------- Actions ----------

  async function petAct(kind) {
    const r = await act('/api/pet/action', { kind }, null);
    if (!r) return;
    const pet = activePet();
    const s = pet && scene.pets.get(pet.id);
    if (kind === 'caresser') {
      Sound.play('petHappy');
      if (s) { scene.hand = { x: s.x, y: s.y - 70, t: 0 }; s.anim = 'love'; s.animT = 0; burst(s.x, s.y - 60, ['❤️', '💕', '💖'], 12); }
    } else {
      Sound.play('petHappy');
      if (s) { scene.ball = { x: s.x, y: s.y - 30, vx: (s.x < W / 2 ? 1 : -1) * 260, vy: -260, z: 0, t: 0 }; s.anim = 'play'; s.animT = 0; }
    }
    if (r.levels) levelUp(pet);
  }

  async function petFeed(food) {
    const r = await act('/api/pet/feed', { food }, null);
    if (!r) return;
    const F = Rules.PET_FOODS[food];
    const pet = activePet();
    const s = pet && scene.pets.get(pet.id);
    Sound.play(F.kind === 'drink' ? 'petDrink' : 'petEat');
    if (s) {
      const bx = Math.max(60, Math.min(W - 60, s.x + (s.facing || 1) * 46));
      scene.bowl = { x: bx, y: s.y + 6, icon: F.icon, drink: F.kind === 'drink', t: 0 };
      s.tx = bx - (s.facing || 1) * 30; s.ty = s.y; s.anim = 'eat'; s.animT = 0;
      if (r.favorite) burst(s.x, s.y - 50, ['❤️', '😋'], 8);
    }
    if (r.levels) levelUp(pet);
  }

  async function collect() {
    const r = await act('/api/pet/collect', {}, null);
    if (!r) return;
    Sound.play('petFind');
    const lines = r.gifts.map((g) => {
      if (g.kind === 'gold') return `🪙 ${g.gold} golds`;
      if (g.kind === 'xp') return `📚 ${g.xp} XP`;
      if (g.kind === 'chest') return `🎁 ${g.chests} coffre${g.chests > 1 ? 's' : ''}`;
      if (g.kind === 'potion') return `${Rules.CONSUMABLES[g.potion].icon} ${Rules.CONSUMABLES[g.potion].label}${g.key ? ' + 🗝️ une Clé de boss !' : ''}`;
      if (g.kind === 'item') return `${Rules.RARITY_INFO[g.item.rarity].label} : ${g.item.name}`;
      if (g.kind === 'emerald') return `${g.emeralds} émeraude${g.emeralds > 1 ? 's' : ''}`;
      if (g.kind === 'ticket') return `🎟️ ${g.tickets} ticket${g.tickets > 1 ? 's' : ''} de casino`;
      return '';
    }).map((txt, i) => (r.gifts[i].surprise ? `${txt} (surprise !)` : txt));
    toast(`🐾 Trouvailles : ${lines.join(' · ')}`, 7000);
    for (const gift of scene.gifts) burst(gift.x, gift.y - 10, ['🎉', '✨', '⭐'], 12);
  }

  function levelUp(pet) {
    const s = pet && scene.pets.get(pet.id);
    Sound.play('levelUp');
    if (s) { burst(s.x, s.y - 40, ['⭐', '✨'], 18); scene.texts.push({ x: s.x, y: s.y - 90, text: `⬆️ Niveau ${pet.level} !`, life: 2.2, color: '#ffe27a' }); }
  }

  // Nouveau familier (boss vaincu ou cadeau de l'admin)
  function onPetEvent(e) {
    const S = Rules.PETS[e.species];
    if (!S) return;
    if (e.duplicate) {
      toast(`🐾 Encore un mini ${bossOf(e.species).short} ! Le tien gagne ${Rules.PET.duplicateXp} XP et un ${Rules.PET_FOODS.festin.label}.`, 7000);
      return;
    }
    Sound.play('petNew');
    const box = document.createElement('div');
    box.className = 'modal open pet-new-modal';
    box.innerHTML = `<div class="modal-box"><div class="pet-new-glow"></div><canvas width="260" height="200"></canvas>
      <h2>🎉 Un nouveau familier !</h2><p><b>${esc(S.name)}</b> t'a suivi après la défaite de ${esc(bossOf(e.species).name)}.<br>
      Il t'attend dans ton enclos : il ramènera ${S.findLabel} si tu prends soin de lui.</p>
      <div class="row" style="justify-content:center"><button class="gold" data-go>🐾 Voir mon enclos</button><button class="secondary" data-close>Plus tard</button></div></div>`;
    document.body.appendChild(box);
    const cv = box.querySelector('canvas');
    const ctx = cv.getContext('2d');
    let t0 = performance.now();
    const loop = (t) => {
      if (!box.isConnected) return;
      ctx.clearRect(0, 0, cv.width, cv.height);
      const hop = Math.abs(Math.sin((t - t0) / 260)) * 14;
      drawPet(ctx, 130, 180 - hop, e.species, { t, size: 2 });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    box.querySelector('[data-close]').onclick = () => box.remove();
    box.querySelector('[data-go]').onclick = () => { box.remove(); showTab('familier'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  }

  // ---------- Enclos animé ----------

  function syncScene() {
    const pets = P();
    if (!pets) return;
    const ids = new Set(pets.list.map((p) => p.id));
    for (const id of [...scene.pets.keys()]) if (!ids.has(id)) scene.pets.delete(id);
    pets.list.forEach((p, i) => {
      if (!scene.pets.has(p.id)) {
        scene.pets.set(p.id, { x: 300 + i * 90, y: 300 + (i % 2) * 40, tx: 300, ty: 300, wait: 1 + Math.random() * 2, facing: 1, hop: 0, anim: null, animT: 0, seed: i * 1.7 });
      }
    });
  }

  function startScene() {
    if (scene.raf) return;
    const step = (t) => {
      scene.raf = null;
      const tab = document.querySelector('.tab[data-tab="familier"]');
      if (!tab || !tab.classList.contains('active') || !P() || !P().list.length) return;
      const dt = Math.min(0.05, scene.last ? (t - scene.last) / 1000 : 0.016);
      scene.last = t;
      drawScene(dt, t);
      scene.raf = requestAnimationFrame(step);
    };
    scene.last = 0;
    scene.raf = requestAnimationFrame(step);
  }

  function burst(x, y, icons, n) {
    for (let i = 0; i < n; i++) {
      scene.fx.push({ x, y, vx: (Math.random() - 0.5) * 120, vy: -60 - Math.random() * 90, life: 1.2 + Math.random() * 0.6, icon: icons[i % icons.length], size: 14 + Math.random() * 8 });
    }
  }

  // Ciel selon l'heure réelle : jour, couchant, nuit étoilée.
  function drawSky(ctx, t) {
    const { h, night, dusk } = skyPhase();
    const g = ctx.createLinearGradient(0, 0, 0, GROUND);
    if (night) { g.addColorStop(0, '#0b1030'); g.addColorStop(1, '#2a2e5e'); } else if (dusk) { g.addColorStop(0, '#4a5bb0'); g.addColorStop(0.6, '#f08a6a'); g.addColorStop(1, '#ffc27a'); } else { g.addColorStop(0, '#6fb8ff'); g.addColorStop(1, '#cfeaff'); }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, GROUND + 10);
    if (night) {
      for (let i = 0; i < 40; i++) {
        const x = (i * 137) % W;
        const y = (i * 53) % (GROUND - 40);
        ctx.fillStyle = `rgba(255,255,255,${0.4 + 0.4 * Math.sin(t / 500 + i)})`;
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.fillStyle = '#fff6d0';
      ctx.beginPath(); ctx.arc(820, 60, 24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = night ? '#1a1f48' : '#fff';
      ctx.beginPath(); ctx.arc(832, 54, 22, 0, Math.PI * 2); ctx.fill();
    } else {
      const k = Math.max(0, Math.min(1, (h - 6) / 14));
      const sx = 80 + k * 800;
      const sy = 150 - Math.sin(k * Math.PI) * 120;
      const sg = ctx.createRadialGradient(sx, sy, 6, sx, sy, 60);
      sg.addColorStop(0, dusk ? '#ffd59a' : '#fffbe0');
      sg.addColorStop(0.4, dusk ? 'rgba(255,170,90,.6)' : 'rgba(255,240,150,.5)');
      sg.addColorStop(1, 'rgba(255,240,150,0)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(sx, sy, 60, 0, Math.PI * 2); ctx.fill();
      // nuages qui dérivent
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      for (let i = 0; i < 4; i++) {
        const cx = ((t / 60 + i * 260) % (W + 200)) - 100;
        const cy = 40 + i * 28;
        ctx.beginPath(); ctx.ellipse(cx, cy, 40, 14, 0, 0, Math.PI * 2); ctx.ellipse(cx + 26, cy - 8, 26, 14, 0, 0, Math.PI * 2); ctx.ellipse(cx - 24, cy - 4, 22, 11, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    // collines
    ctx.fillStyle = night ? '#1d3a2a' : '#7cc46a';
    ctx.beginPath(); ctx.moveTo(0, GROUND); ctx.quadraticCurveTo(200, GROUND - 70, 420, GROUND); ctx.quadraticCurveTo(650, GROUND - 90, 960, GROUND); ctx.lineTo(960, GROUND + 10); ctx.lineTo(0, GROUND + 10); ctx.fill();
    return night;
  }

  function drawGround(ctx, t, night) {
    const g = ctx.createLinearGradient(0, GROUND, 0, H);
    g.addColorStop(0, night ? '#244a2c' : '#68b84e');
    g.addColorStop(1, night ? '#16301c' : '#4a9a38');
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND, W, H - GROUND);
    // bandes de tonte
    ctx.fillStyle = 'rgba(255,255,255,.04)';
    for (let i = 0; i < 6; i++) ctx.fillRect(0, GROUND + 14 + i * 30, W, 14);
    // touffes d'herbe qui ondulent
    ctx.strokeStyle = night ? 'rgba(80,140,80,.8)' : 'rgba(40,110,30,.7)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 46; i++) {
      const x = (i * 97) % W;
      const y = GROUND + 20 + ((i * 41) % (H - GROUND - 30));
      const sway = Math.sin(t / 700 + i) * 3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + sway, y - 6, x + sway * 1.5 - 3, y - 11); ctx.moveTo(x + 4, y); ctx.quadraticCurveTo(x + 4 + sway, y - 7, x + 5 + sway * 1.5, y - 12); ctx.stroke();
    }
    // clôture du fond
    ctx.fillStyle = night ? '#5a4030' : '#a5774a';
    ctx.strokeStyle = 'rgba(60,35,15,.6)';
    for (let x = 10; x < W; x += 46) { ctx.fillRect(x, GROUND - 34, 9, 44); ctx.strokeRect(x, GROUND - 34, 9, 44); }
    ctx.fillRect(0, GROUND - 26, W, 6);
    ctx.fillRect(0, GROUND - 10, W, 6);
  }

  // o (facultatif, pour l'enclos miniature de la Maison) : own (objets possédés), spots, w (largeur), ground,
  // lanternY, petName — par défaut ceux de l'onglet Familier.
  function drawItems(ctx, t, night, cur, o = {}) {
    const own = o.own || new Set(enclos());
    const SPOTS = o.spots || SPOT_DEFAULT;
    const W = o.w || SCENE_W;
    const GROUND = o.ground != null ? o.ground : SCENE_GROUND;
    const LY = o.lanternY != null ? o.lanternY : 26;
    if (own.has('fleurs')) {
      for (let i = 0; i < Math.round(22 * W / SCENE_W) + 1; i++) {
        const x = 30 + i * 43 + Math.sin(i) * 8;
        const y = GROUND + 6 + (i % 2) * 8;
        ctx.strokeStyle = '#2f7a2a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y + 10); ctx.lineTo(x + Math.sin(t / 900 + i) * 2, y); ctx.stroke();
        ctx.fillStyle = ['#ff7ac8', '#ffd23f', '#ff6b4a', '#c88bff', '#ffffff'][i % 5];
        for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 3, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#ffe14a'; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (own.has('lanternes')) {
      ctx.strokeStyle = 'rgba(60,40,20,.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, LY); ctx.quadraticCurveTo(W / 2, LY + 54, W, LY); ctx.stroke();
      for (let i = 1; i < 10; i++) {
        const x = (i / 10) * W;
        const y = LY + Math.sin((i / 10) * Math.PI) * 27 + 10;
        const glow = night ? 0.8 + Math.sin(t / 300 + i) * 0.15 : 0.35;
        const g = ctx.createRadialGradient(x, y, 2, x, y, night ? 30 : 14);
        g.addColorStop(0, `rgba(255,190,90,${glow})`); g.addColorStop(1, 'rgba(255,150,60,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, night ? 30 : 14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = ['#ff5a4a', '#ffb347', '#ff7ac8'][i % 3];
        ctx.beginPath(); ctx.ellipse(x, y, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (own.has('statue')) {
      const { x, y } = SPOTS.statue;
      ctx.fillStyle = '#8a8a96'; ctx.fillRect(x - 22, y + 10, 44, 16);
      const g = ctx.createLinearGradient(x - 16, y - 60, x + 16, y);
      g.addColorStop(0, '#fff2a8'); g.addColorStop(1, '#c99a1f');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(x, y - 34, 14, 16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 16, y + 10); ctx.lineTo(x - 12, y - 20); ctx.lineTo(x + 12, y - 20); ctx.lineTo(x + 16, y + 10); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.5 + Math.sin(t / 400) * 0.4})`;
      ctx.beginPath(); ctx.arc(x - 6, y - 40, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    if (own.has('jouets')) {
      const { x, y } = SPOTS.jouets;
      ctx.fillStyle = '#c0503a'; ctx.fillRect(x - 26, y - 14, 52, 30);
      ctx.fillStyle = '#e8a33a'; ctx.fillRect(x - 28, y - 20, 56, 8);
      ctx.font = '18px "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('🧸', x - 10, y - 18); ctx.fillText('⚽', x + 12, y - 16);
    }
    if (own.has('mare')) {
      const { x, y } = SPOTS.mare;
      ctx.fillStyle = '#3b7a3a'; ctx.beginPath(); ctx.ellipse(x, y, 94, 26, 0, 0, Math.PI * 2); ctx.fill();
      const g = ctx.createLinearGradient(0, y - 20, 0, y + 20);
      g.addColorStop(0, '#7fd0ff'); g.addColorStop(1, '#2a7fc0');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, 86, 21, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5;
      const rip = (t / 1500) % 1;
      ctx.beginPath(); ctx.ellipse(x + 20, y, 10 + rip * 30, 3 + rip * 7, 0, 0, Math.PI * 2); ctx.globalAlpha = 1 - rip; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#4caf50';
      for (const [dx, dy] of [[-40, -4], [30, 6], [-8, 8]]) { ctx.beginPath(); ctx.arc(x + dx, y + dy, 8, 0.4, Math.PI * 2 - 0.1); ctx.lineTo(x + dx, y + dy); ctx.fill(); }
      ctx.fillStyle = '#ff9ad0'; ctx.beginPath(); ctx.arc(x - 40, y - 6, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    if (own.has('fontaine')) {
      const { x, y } = SPOTS.fontaine;
      ctx.fillStyle = '#9aa4b8'; ctx.beginPath(); ctx.ellipse(x, y + 18, 46, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5fb8ff'; ctx.beginPath(); ctx.ellipse(x, y + 15, 38, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b8c0d0'; ctx.fillRect(x - 6, y - 30, 12, 46);
      ctx.beginPath(); ctx.ellipse(x, y - 30, 18, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(160,220,255,.85)'; ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const k = ((t / 600) + i / 4) % 1;
        const dir = i % 2 ? 1 : -1;
        ctx.beginPath(); ctx.moveTo(x, y - 34); ctx.quadraticCurveTo(x + dir * 20, y - 60, x + dir * (24 + k * 6), y + 10); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(220,245,255,.9)';
      for (let i = 0; i < 6; i++) { const k = ((t / 400) + i / 6) % 1; ctx.beginPath(); ctx.arc(x + Math.sin(i * 2) * 28, y + 14 - k * 10, 2, 0, Math.PI * 2); ctx.fill(); }
    }
    if (own.has('niche')) {
      const { x, y } = SPOTS.niche;
      ctx.fillStyle = '#b05a3a'; ctx.fillRect(x - 40, y - 40, 80, 56);
      ctx.fillStyle = '#7a2e1e';
      ctx.beginPath(); ctx.moveTo(x - 50, y - 36); ctx.lineTo(x, y - 76); ctx.lineTo(x + 50, y - 36); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2a1608';
      ctx.beginPath(); ctx.arc(x, y + 2, 20, Math.PI, 0); ctx.lineTo(x + 20, y + 16); ctx.lineTo(x - 20, y + 16); ctx.fill();
      // plaque au nom du familier principal, centrée entre le toit et la porte (police réduite si le nom est long)
      const pet = o.petName !== undefined ? (o.petName ? { name: o.petName } : null) : activePet();
      if (pet) {
        let size = 11;
        ctx.font = `700 ${size}px sans-serif`;
        while (size > 7 && ctx.measureText(pet.name).width > 64) { size -= 1; ctx.font = `700 ${size}px sans-serif`; }
        const w = Math.min(70, ctx.measureText(pet.name).width + 10);
        ctx.fillStyle = '#5a2a14';
        ctx.fillRect(x - w / 2, y - 35, w, 14);
        ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 1;
        ctx.strokeRect(x - w / 2 + 0.5, y - 34.5, w - 1, 13);
        ctx.fillStyle = '#ffe27a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pet.name, x, y - 27.5, 64);
        ctx.textBaseline = 'alphabetic';
      }
    }
    if (own.has('gamelle')) {
      const { x, y } = SPOTS.gamelle;
      const fill = cur ? Math.max(0, Math.min(1, cur.needs.faim / 100)) : 0.5;
      ctx.fillStyle = '#3a6ad8'; ctx.beginPath(); ctx.ellipse(x, y + 6, 26, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6f95f0'; ctx.beginPath(); ctx.ellipse(x, y, 24, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a5683a'; ctx.beginPath(); ctx.ellipse(x, y + 1, 20 * fill, 5 * fill, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawScene(dt, t) {
    const cv = $('pet-canvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const pets = P();
    const act = activePet();
    const cur = act ? live(act) : null;
    const night = drawSky(ctx, t);
    drawGround(ctx, t, night);
    drawItems(ctx, t, night, cur);

    // cadeaux en attente (cliquables)
    scene.gifts = [];
    let gi = 0;
    for (const p of pets.list) {
      const n = live(p).finds || 0;
      for (let k = 0; k < n; k++) {
        const x = 340 + gi * 46;
        const y = 380;
        scene.gifts.push({ x, y });
        const bob = Math.abs(Math.sin(t / 300 + gi)) * 5;
        ctx.save();
        ctx.translate(x, y - bob);
        ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, bob + 4, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = ['#ff4d6d', '#5fd3ff', '#ffd23f'][gi % 3];
        ctx.fillRect(-14, -24, 28, 24);
        ctx.fillStyle = '#fff'; ctx.fillRect(-3, -24, 6, 24); ctx.fillRect(-16, -28, 32, 6);
        ctx.beginPath(); ctx.ellipse(-6, -32, 6, 4, -0.5, 0, Math.PI * 2); ctx.ellipse(6, -32, 6, 4, 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        gi++;
      }
    }

    // bol temporaire (repas / boisson)
    if (scene.bowl) {
      const b = scene.bowl;
      b.t += dt;
      ctx.fillStyle = b.drink ? '#3aa0d8' : '#c0503a';
      ctx.beginPath(); ctx.ellipse(b.x, b.y + 6, 18, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.font = '20px "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center';
      if (b.t < 2.2) ctx.fillText(b.icon, b.x, b.y - 2 - Math.max(0, 1.2 - b.t) * 10);
      if (b.t > 0.9 && b.t < 2.6 && Math.random() < 0.3) scene.fx.push({ x: b.x + (Math.random() - 0.5) * 16, y: b.y - 6, vx: (Math.random() - 0.5) * 60, vy: -50, life: 0.5, icon: b.drink ? '💧' : '·', size: b.drink ? 10 : 18 });
      if (b.t > 3.2) scene.bowl = null;
    }

    // familiers (triés par profondeur)
    const order = pets.list.map((p) => ({ p, s: scene.pets.get(p.id) })).filter((x) => x.s).sort((a, b) => a.s.y - b.s.y);
    let rest = 0;
    for (const p of pets.list) if (p.id !== pets.active) { const s = scene.pets.get(p.id); if (s) { s.rx = 90 + rest * 92; s.ry = 300 + (rest % 2) * 46; } rest++; }
    for (const { p, s } of order) {
      const isActive = p.id === pets.active;
      const c = isActive ? cur : p;
      const sat = isActive ? Rules.petSatisfaction(c.needs) : 70;
      updatePet(s, dt, isActive, sat);
      const hop = s.hop;
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath(); ctx.ellipse(s.x, s.y + 2, 38, 11, 0, 0, Math.PI * 2); ctx.fill();
      let squish = 1;
      if (s.anim === 'love') squish = 1 + Math.sin(s.animT * 14) * 0.06;
      if (s.anim === 'eat' && s.animT > 0.9) squish = 1 + Math.sin(s.animT * 18) * 0.04;
      ctx.save();
      ctx.translate(s.x, s.y - hop);
      ctx.scale(1 / squish, squish);
      drawPet(ctx, 0, 0, p.species, { facing: s.facing, t: isActive ? t : 0, sleep: !isActive, seed: s.seed, size: PET_SIZE });
      ctx.restore();
      if (!isActive) {
        // il se repose : Zzz
        ctx.font = '700 14px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.textAlign = 'left';
        const k = (t / 1200 + s.seed) % 1;
        ctx.globalAlpha = 1 - k;
        ctx.fillText('z', s.x + 26 + k * 10, s.y - 70 - k * 20);
        ctx.fillText('Z', s.x + 34 + k * 14, s.y - 86 - k * 26);
        ctx.globalAlpha = 1;
      } else {
        // bulle d'humeur : son besoin le plus pressant (ou un cœur s'il est comblé)
        const low = ['faim', 'soif', 'joie'].map((k) => [k, c.needs[k]]).sort((a, b) => a[1] - b[1])[0];
        let bubble = null;
        if (low[1] < 35) bubble = NEED_INFO[low[0]].icon;
        else if (sat >= 80 && Math.sin(t / 900) > 0.6) bubble = '❤️';
        if (bubble) {
          const by = s.y - 128 - Math.sin(t / 300) * 3;
          ctx.fillStyle = 'rgba(255,255,255,.92)';
          ctx.beginPath(); ctx.ellipse(s.x + 26, by, 17, 14, 0, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.moveTo(s.x + 16, by + 10); ctx.lineTo(s.x + 10, by + 20); ctx.lineTo(s.x + 22, by + 12); ctx.fill();
          ctx.font = '16px "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(bubble, s.x + 26, by + 6);
        }
        if (sat < 25 && Math.random() < 0.02) scene.fx.push({ x: s.x - 10, y: s.y - 60, vx: 0, vy: 20, life: 0.8, icon: '💧', size: 12 });
      }
      ctx.font = '700 12px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
      const label = `${p.name} · niv. ${p.level}`;
      ctx.strokeText(label, s.x, s.y + 20); ctx.fillStyle = isActive ? '#fff' : '#cfd8e3'; ctx.fillText(label, s.x, s.y + 20);
    }

    // balle
    if (scene.ball) {
      const b = scene.ball;
      b.t += dt;
      b.vy += 600 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y > 360) { b.y = 360; b.vy *= -0.55; b.vx *= 0.8; }
      if (b.x < 30 || b.x > W - 30) b.vx *= -1;
      ctx.font = '20px "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('🎾', b.x, b.y);
      if (act) { const s = scene.pets.get(act.id); if (s) { s.tx = b.x; s.ty = Math.max(GROUND + 40, Math.min(370, b.y + 10)); } }
      if (b.t > 3) { scene.ball = null; if (act) burst(b.x, b.y - 20, ['⭐', '✨'], 8); }
    }
    // main qui caresse
    if (scene.hand) {
      const h = scene.hand;
      h.t += dt;
      ctx.font = '30px "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center';
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, h.t - 1.4) * 2);
      ctx.fillText('🤚', h.x + Math.sin(h.t * 10) * 14, h.y - 30);
      ctx.globalAlpha = 1;
      if (h.t > 1.9) scene.hand = null;
    }
    // particules
    for (const f of scene.fx) {
      f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 60 * dt;
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.5));
      ctx.font = `${f.size}px "Segoe UI Emoji", sans-serif`; ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(f.icon, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    scene.fx = scene.fx.filter((f) => f.life > 0);
    for (const tx of scene.texts) {
      tx.life -= dt; tx.y -= 20 * dt;
      ctx.globalAlpha = Math.max(0, Math.min(1, tx.life));
      ctx.font = '900 20px "Segoe UI", sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(tx.text, tx.x, tx.y);
      ctx.fillStyle = tx.color; ctx.fillText(tx.text, tx.x, tx.y);
    }
    ctx.globalAlpha = 1;
    scene.texts = scene.texts.filter((x) => x.life > 0);
    if (night) { ctx.fillStyle = 'rgba(10,15,50,.25)'; ctx.fillRect(0, 0, W, H); }
  }

  // Déplacement : promenade au hasard, plus lent s'il est triste ; les familiers au repos restent couchés.
  function updatePet(s, dt, active, sat) {
    s.animT += dt;
    if (s.anim && s.animT > 3) s.anim = null;
    if (!active) {
      // il va se coucher à sa place, sur le côté de l'enclos
      if (s.rx != null) { s.x += (s.rx - s.x) * Math.min(1, dt * 2); s.y += (s.ry - s.y) * Math.min(1, dt * 2); }
      s.hop = 0;
      return;
    }
    const dx = s.tx - s.x;
    const dy = s.ty - s.y;
    const dist = Math.hypot(dx, dy);
    const speed = (scene.ball ? 170 : sat < 50 ? 28 : 55) * (s.anim === 'eat' ? 1.6 : 1);
    if (dist > 3 && !(s.anim === 'eat' && s.animT > 0.9 && s.animT < 2.6) && !(s.anim === 'love' && s.animT < 1.8)) {
      const step = Math.min(dist, speed * dt);
      s.x += (dx / dist) * step;
      s.y += (dy / dist) * step;
      if (Math.abs(dx) > 2) s.facing = dx > 0 ? 1 : -1;
      s.hop = Math.abs(Math.sin(s.animT * (scene.ball ? 16 : 9))) * (sat >= 50 ? 5 : 2);
    } else {
      s.hop = sat >= 80 && Math.sin(s.animT * 2 + s.seed) > 0.95 ? 8 : Math.max(0, s.hop - dt * 30);
      s.wait -= dt;
      if (s.wait <= 0 && !scene.ball && !s.anim) {
        s.wait = 2 + Math.random() * 3;
        s.tx = 120 + Math.random() * (W - 240);
        s.ty = GROUND + 50 + Math.random() * (H - GROUND - 70);
      }
    }
  }

  // Clic sur l'enclos : cadeau → récupérer ; familier principal → le caresser.
  function onCanvasClick(e) {
    const cv = $('pet-canvas');
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * (W / r.width);
    const y = (e.clientY - r.top) * (H / r.height);
    if (scene.gifts.some((g) => Math.abs(g.x - x) < 22 && y > g.y - 40 && y < g.y + 8)) { collect(); return; }
    const pet = activePet();
    const s = pet && scene.pets.get(pet.id);
    if (s && Math.abs(s.x - x) < 50 && y > s.y - 120 && y < s.y + 10) {
      const wait = (pet.caressAt || 0) + Rules.PET.actions.caresser.cooldownMs - Date.now();
      if (wait > 0) { burst(s.x, s.y - 50, ['❤️'], 2); s.anim = 'love'; s.animT = 0; } else petAct('caresser');
    }
  }

  // Barres et minuteurs qui bougent en direct
  setInterval(() => {
    const tab = document.querySelector('.tab[data-tab="familier"]');
    if (me && P() && P().list.length && tab && tab.classList.contains('active')) { renderSide(); startScene(); }
  }, 5000);

  document.addEventListener('DOMContentLoaded', () => {
    const cv = document.getElementById('pet-canvas');
    if (cv) cv.addEventListener('click', onCanvasClick);
  });

  // ---------- Enclos miniature (vu depuis la façade de la Maison) ----------
  // data : { enclos: [ids], pet: { species, name, level } | null } ; dessiné à (x, y), largeur w (hauteur w × 0,52).
  const YARD_W = 420;
  const YARD_H = 218;
  const YARD_SPOTS = {
    statue: { x: 48, y: 96 }, niche: { x: 362, y: 118 }, fontaine: { x: 212, y: 84 }, jouets: { x: 70, y: 182 },
    gamelle: { x: 332, y: 186 }, mare: { x: 205, y: 180 }, fleurs: { x: 0, y: 0 }, lanternes: { x: 0, y: 0 },
  };
  const yardPets = new Map(); // un état de promenade par familier affiché
  function drawPetYard(ctx, x, y, w, data, t) {
    if (!data) return null;
    const s = w / YARD_W;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    // Herbe, clôture et pancarte
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.roundRect(4, 46, YARD_W, YARD_H - 40, 14); ctx.fill();
    const g = ctx.createLinearGradient(0, 40, 0, YARD_H);
    g.addColorStop(0, '#79c85c'); g.addColorStop(1, '#58a844');
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(0, 40, YARD_W, YARD_H - 40, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(40,110,30,.55)'; ctx.lineWidth = 2;
    for (let i = 0; i < 18; i++) { const gx = 20 + ((i * 97) % (YARD_W - 40)); const gy = 70 + ((i * 41) % (YARD_H - 90)); ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx - 2, gy - 8); ctx.moveTo(gx + 4, gy); ctx.lineTo(gx + 5, gy - 9); ctx.stroke(); }
    const fence = (x0, y0, x1, y1) => {
      ctx.fillStyle = '#a5774a'; ctx.strokeStyle = 'rgba(60,35,15,.6)'; ctx.lineWidth = 1.5;
      const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 44));
      for (let i = 0; i <= n; i++) { const px = x0 + ((x1 - x0) * i) / n; const py = y0 + ((y1 - y0) * i) / n; ctx.fillRect(px - 4, py - 30, 8, 34); ctx.strokeRect(px - 4, py - 30, 8, 34); }
      ctx.lineWidth = 6; ctx.strokeStyle = '#a5774a';
      ctx.beginPath(); ctx.moveTo(x0, y0 - 22); ctx.lineTo(x1, y1 - 22); ctx.moveTo(x0, y0 - 8); ctx.lineTo(x1, y1 - 8); ctx.stroke();
    };
    fence(6, 44, YARD_W - 6, 44); // clôture du fond
    const own = new Set(data.enclos || []);
    if (own.has('lanternes')) {
      // Deux mâts aux coins pour tendre la guirlande (elle ne flotte plus dans le vide)
      for (const px of [6, YARD_W - 6]) {
        ctx.fillStyle = '#7a5230'; ctx.fillRect(px - 4, -22, 8, 70);
        ctx.fillStyle = '#5e3b1c'; ctx.beginPath(); ctx.arc(px, -22, 6, 0, Math.PI * 2); ctx.fill();
      }
    }
    drawItems(ctx, t, skyPhase().night, null, { own, spots: YARD_SPOTS, w: YARD_W, ground: 40, lanternY: -20, petName: data.pet ? data.pet.name : '' });
    // Familier principal qui se promène dans l'enclos
    if (data.pet && window.drawPet) {
      const key = data.pet.species + '|' + data.pet.name;
      let st = yardPets.get(key);
      if (!st) { st = { x: 200, y: 140, tx: 200, ty: 140, wait: 1, facing: 1, last: t }; yardPets.set(key, st); }
      const dt = Math.min(0.1, Math.max(0, (t - st.last) / 1000));
      st.last = t;
      const d = Math.hypot(st.tx - st.x, st.ty - st.y);
      if (d < 4) { st.wait -= dt; if (st.wait <= 0) { st.tx = 90 + Math.random() * 230; st.ty = 105 + Math.random() * 60; st.wait = 1.5 + Math.random() * 3; } } else {
        const sp = 46 * dt;
        st.x += ((st.tx - st.x) / d) * Math.min(sp, d);
        st.y += ((st.ty - st.y) / d) * Math.min(sp, d);
        st.facing = st.tx > st.x ? 1 : -1;
      }
      const hop = d >= 4 ? Math.abs(Math.sin(t / 140)) * 5 : 0;
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(st.x, st.y + 2, 30, 9, 0, 0, Math.PI * 2); ctx.fill();
      drawPet(ctx, st.x, st.y - hop, data.pet.species, { facing: st.facing, t, seed: 1, size: 1.35 });
    }
    // Clôture de devant (basse) et pancarte
    ctx.fillStyle = '#a5774a'; ctx.strokeStyle = 'rgba(60,35,15,.6)'; ctx.lineWidth = 1.5;
    for (let i = 0; i <= 9; i++) { const px = 6 + ((YARD_W - 12) * i) / 9; ctx.fillRect(px - 4, YARD_H - 22, 8, 24); ctx.strokeRect(px - 4, YARD_H - 22, 8, 24); }
    ctx.fillRect(0, YARD_H - 16, YARD_W, 6);
    const label = data.pet ? `${data.pet.name} · niv. ${data.pet.level}` : 'Enclos';
    ctx.font = '800 20px sans-serif';
    const lw = ctx.measureText(label).width + 22;
    ctx.fillStyle = '#6b4322'; ctx.fillRect(YARD_W / 2 - lw / 2, YARD_H - 30, lw, 30);
    ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 2; ctx.strokeRect(YARD_W / 2 - lw / 2 + 1, YARD_H - 29, lw - 2, 28);
    ctx.fillStyle = '#ffe27a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, YARD_W / 2, YARD_H - 15);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
    return { h: YARD_H * s };
  }
  window.drawPetYard = drawPetYard;
  window.PET_YARD_RATIO = YARD_H / YARD_W;

  window.renderPets = renderPets;
  window.onPetEvent = onPetEvent;
  window.petsStartScene = startScene;
  // Nombre de trouvailles en attente (pastille de l'onglet)
  window.petFindsWaiting = () => (P() ? P().list.reduce((a, p) => a + (live(p).finds || 0), 0) : 0);
})();
