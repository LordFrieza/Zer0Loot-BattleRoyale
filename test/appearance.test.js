const test = require('node:test');
const assert = require('node:assert');
const { Rules, game } = require('./helpers');

// ---------- Apparence & boutique ----------

test('[LOOK-1, LOOK-2, LOOK-3] apparence : options gratuites, cosmétiques à acheter', () => {
  const c = game.newCharacter();
  game.setLook(c, 'color', 'cyan');
  game.setLook(c, 'eyes', 'etoiles');
  game.setLook(c, 'color', null);
  assert.strictEqual(c.look.color, null);
  assert.throws(() => game.setLook(c, 'eyes', 'laser'), /inconnue/);
  assert.throws(() => game.setLook(c, 'nez', 'x'), /inconnue/);
  assert.throws(() => game.setLook(c, 'hat', 'couronne'), /Achète/);
  assert.throws(() => game.setLook(c, 'hat', 'bottes'), /inconnu/);
  assert.throws(() => game.buyCosmetic(c, 'couronne'), /1200 golds/);
  c.gold = 1300;
  assert.deepStrictEqual(game.buyCosmetic(c, 'couronne'), { price: 1200, worn: true });
  assert.strictEqual(c.gold, 100);
  assert.strictEqual(c.look.hat, 'couronne'); // porté directement
  assert.throws(() => game.buyCosmetic(c, 'couronne'), /déjà/);
  game.setLook(c, 'hat', null);
  game.setLook(c, 'hat', 'couronne');
  assert.strictEqual(Rules.achievementState(c, Rules.achievementById('cosmetics1')).done, true);
});

test('[DB-7] apparence : anciennes sauvegardes', () => {
  const c = game.newCharacter();
  delete c.look; delete c.owned;
  game.upgrade(c);
  assert.deepStrictEqual(c.look, Rules.DEFAULT_LOOK);
  assert.deepStrictEqual(c.owned, []);
});

test('[LOOK-5] skins d\'équipement et skins réservés à une classe', () => {
  for (const cls of Rules.CLASSES) {
    const mine = Object.values(Rules.COSMETICS).filter((it) => it.cls === cls);
    assert.deepStrictEqual([mine.filter((it) => it.slot === 'weapon').length, mine.filter((it) => it.slot === 'offhand').length], [2, 1], cls);
  }
  for (const slot of ['chest', 'pants', 'gloves', 'belt']) assert.ok(Object.values(Rules.COSMETICS).some((it) => it.slot === slot), slot);
  const c = game.newCharacter();
  game.chooseClass(c, 'mage');
  c.gold = 5000;
  assert.deepStrictEqual(game.buyCosmetic(c, 'epee_feu'), { price: 900, worn: false }, 'acheté mais pas porté par un Mage');
  assert.strictEqual(c.look.weapon, null);
  assert.throws(() => game.setLook(c, 'weapon', 'epee_feu'), /réservé à la classe Guerriloot/);
  assert.deepStrictEqual(game.buyCosmetic(c, 'baton_lune'), { price: 850, worn: true });
  game.buyCosmetic(c, 'plastron_dore');
  assert.strictEqual(c.look.chest, 'plastron_dore');
  game.chooseClass(c, 'guerrier');
  assert.strictEqual(c.look.weapon, null, 'le bâton du mage est retiré');
  assert.ok(c.owned.includes('baton_lune'), 'mais gardé');
  assert.strictEqual(c.look.chest, 'plastron_dore');
  game.setLook(c, 'weapon', 'epee_feu');
  assert.strictEqual(c.look.weapon, 'epee_feu');
});

test('[LOOK-6] cosmétiques d\'exploit : visibles, verrouillés, puis gratuits', () => {
  const exploits = Object.entries(Rules.COSMETICS).filter(([, it]) => it.unlock);
  assert.deepStrictEqual(exploits.map(([id]) => id).sort(),
    ['aura_champion', 'bottes_legende', 'cape_guerre', 'couronne_os', 'masque_abysses', 'peau_dragon', 'peau_ogre', 'peau_spectre']);
  assert.deepStrictEqual(Rules.COSMETICS.peau_ogre.unlock, { metric: 'heroTroll', goal: 1, desc: 'Vaincre le Troll en Défi des boss, en Héroïque ou Légendaire' });
  const c = game.newCharacter();
  c.gold = 10000;
  assert.strictEqual(Rules.cosmeticLocked(c, 'peau_ogre'), true);
  assert.throws(() => game.buyCosmetic(c, 'peau_ogre'), /Exploit requis : Vaincre le Troll en Défi des boss/);
  game.bump(c, 'soloTroll');
  assert.strictEqual(Rules.cosmeticLocked(c, 'peau_ogre'), true, 'une victoire seul en Normal ne suffit pas');
  game.bump(c, 'heroTroll');
  assert.strictEqual(Rules.cosmeticLocked(c, 'peau_ogre'), false);
  assert.deepStrictEqual(game.buyCosmetic(c, 'peau_ogre'), { price: 0, worn: true });
  assert.strictEqual(c.gold, 10000);
  assert.strictEqual(c.look.body, 'peau_ogre');
  c.record.wins = 99;
  assert.throws(() => game.buyCosmetic(c, 'aura_champion'), /100 parties/);
  c.record.wins = 100;
  game.buyCosmetic(c, 'aura_champion');
  assert.strictEqual(c.look.aura, 'aura_champion');
});

test('[LOOK-8] visage dessiné : grille validée, version, modération', () => {
  assert.strictEqual(Rules.DRAWING.size, 12);
  assert.strictEqual(Rules.DRAWING.palette.length, 8);
  const c = game.newCharacter();
  const pixels = '8'.repeat(144);
  assert.throws(() => game.setDrawing(c, pixels), /Achète/);
  c.owned.push('dessin');
  assert.throws(() => game.setDrawing(c, '0'.repeat(144)), /vide/);
  assert.throws(() => game.setDrawing(c, '1'.repeat(143)), /invalide/);
  assert.throws(() => game.setDrawing(c, 'a'.repeat(144)), /invalide/);
  assert.throws(() => game.setDrawing(c, null), /invalide/);
  assert.deepStrictEqual(game.setDrawing(c, pixels), { ver: 1 });
  assert.deepStrictEqual([c.drawing, c.look.drawing], [pixels, 'dessin']);
  game.clearDrawing(c);
  assert.deepStrictEqual([c.drawing, c.drawingVer, c.look.drawing], ['', 2, null]);
});

test('[LOOK-8] choisir des yeux, des sourcils ou une bouche retire le visage dessiné (sans l\'effacer)', () => {
  const c = game.newCharacter();
  c.owned.push('dessin');
  const pixels = '0'.repeat(30) + '1111' + '0'.repeat(110);
  game.setDrawing(c, pixels);
  assert.strictEqual(c.look.drawing, 'dessin');
  game.setLook(c, 'color', 'cyan');
  assert.strictEqual(c.look.drawing, 'dessin', 'la couleur ne touche pas au visage');
  for (const [part, value] of [['eyes', 'ronds'], ['brows', 'droits'], ['mouth', 'sourire']]) {
    game.setLook(c, 'drawing', 'dessin');
    game.setLook(c, part, value);
    assert.strictEqual(c.look.drawing, null, part);
    assert.strictEqual(c.drawing, pixels, 'le dessin reste enregistré');
  }
});
