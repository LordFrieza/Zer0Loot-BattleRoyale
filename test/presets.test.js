/*
 * Presets d'équipement : sauvegarde, application et protection contre le recyclage et la forge.
 */
const test = require('node:test');
const assert = require('node:assert');
const { Rules, game } = require('./helpers');

// Personnage Guerrier avec un casque et une épée équipés, plus quelques objets dans le coffre.
function equipped() {
  const c = game.newCharacter();
  game.chooseClass(c, 'guerrier');
  const casque = game.makeItem('rare', 'casque');
  const epee = game.makeItem('rare', 'arme', { kind: 'epee' });
  c.inventory.push(casque, epee);
  game.equip(c, casque.id);
  game.equip(c, epee.id);
  return { c, casque, epee };
}

test('[PRE-1] presets : nom obligatoire, au moins un objet, 5 maximum, remplacement par identifiant', () => {
  const empty = game.newCharacter();
  assert.throws(() => game.savePreset(empty, 'Vide'), /Équipe au moins un objet/);
  const { c, casque, epee } = equipped();
  assert.throws(() => game.savePreset(c, '   '), /nom/);
  const { preset } = game.savePreset(c, 'Un nom beaucoup trop long pour un preset');
  assert.strictEqual(preset.name.length, Rules.PRESET_NAME_MAX);
  assert.strictEqual(preset.items.casque, casque.id);
  assert.strictEqual(preset.items.arme, epee.id);
  assert.strictEqual(preset.items.gants, null);
  for (let i = 1; i < Rules.PRESET_MAX; i++) game.savePreset(c, 'P' + i);
  assert.throws(() => game.savePreset(c, 'De trop'), /5 presets maximum/);
  // Remplacement : même identifiant, nouvel équipement
  game.unequip(c, 'casque');
  game.savePreset(c, 'Sans casque', preset.id);
  assert.strictEqual(c.presets.length, Rules.PRESET_MAX);
  assert.strictEqual(c.presets[0].name, 'Sans casque');
  assert.strictEqual(c.presets[0].items.casque, null);
});

test('[PRE-2] presets : application exacte, objets manquants ou d\'une autre classe ignorés', () => {
  const { c, casque, epee } = equipped();
  const { preset } = game.savePreset(c, 'Boss');
  // On change tout : autre casque, plus d'arme
  const autre = game.makeItem('commun', 'casque');
  c.inventory.push(autre);
  game.equip(c, autre.id);
  game.unequip(c, 'arme');
  const r = game.applyPreset(c, preset.id);
  assert.deepStrictEqual([r.changed, r.missing, r.locked], [2, 0, 0]);
  assert.strictEqual(c.equipment.casque.id, casque.id);
  assert.strictEqual(c.equipment.arme.id, epee.id);
  assert.ok(c.inventory.some((i) => i.id === autre.id), 'le casque remplacé retourne au coffre');
  // Un emplacement vide dans le preset est vidé
  const gants = game.makeItem('commun', 'gants');
  c.inventory.push(gants);
  game.equip(c, gants.id);
  game.applyPreset(c, preset.id);
  assert.strictEqual(c.equipment.gants, undefined);
  // Objet d'une autre classe : ignoré
  game.unequip(c, 'arme');
  c.cls = 'archer';
  const r2 = game.applyPreset(c, preset.id);
  assert.strictEqual(r2.locked, 1);
  assert.strictEqual(c.equipment.arme, undefined);
  assert.throws(() => game.applyPreset(c, 'inconnu'), /introuvable/);
});

test('[PRE-3, PRE-4] presets : objets protégés du recyclage et de la forge, protection levée à la suppression', () => {
  const { c, casque } = equipped();
  const { preset } = game.savePreset(c, 'Boss');
  game.unequip(c, 'casque');
  const extra = [game.makeItem('rare', 'gants'), game.makeItem('rare', 'gants')];
  c.inventory.push(...extra);
  const gold = c.gold;
  assert.throws(() => game.recycle(c, [casque.id, extra[0].id]), /protégé/);
  assert.strictEqual(c.gold, gold, 'rien n\'est recyclé');
  assert.strictEqual(c.inventory.length, 3);
  assert.throws(() => game.fuse(c, [casque.id, extra[0].id, extra[1].id]), /protégé/);
  assert.ok(game.publicCharacter({ character: c }).protectedIds.includes(casque.id));
  game.deletePreset(c, preset.id);
  assert.deepStrictEqual(game.publicCharacter({ character: c }).protectedIds, []);
  assert.strictEqual(game.recycle(c, [casque.id]).recycled, 1);
  assert.throws(() => game.deletePreset(c, preset.id), /introuvable/);
});
