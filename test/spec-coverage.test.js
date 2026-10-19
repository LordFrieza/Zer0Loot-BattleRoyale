/*
 * Tests du script scripts/spec-coverage.js sur un petit projet fictif (variable SPEC_ROOT).
 * Les appels de test des fixtures sont fabriqués par call() : écrits en toutes lettres dans ce fichier,
 * ils seraient comptés par le script comme de vrais tests de ce fichier.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'spec-coverage.js');

const SPEC = `# Spec

## 1. Section
- **A-1** Le système doit faire A.
- **A-2** Le système doit faire B.
- **A-3** Le système doit faire C.
- **A-4** Le système doit faire D. (vérification manuelle)
- **A-5** Le système doit faire E.
`;

// Une ligne « appel de test » : call("[A-1] titre", { mod: '.skip', opts: ", { skip: true }", quote: '"' })
const CALL = 'te' + 'st';
const call = (title, { mod = '', opts = '', quote = "'" } = {}) => `${CALL}${mod}(${quote}${title}${quote}${opts}, () => {});\n`;

// Crée un faux projet avec une spec et des fichiers de test, puis lance le script.
function run(testSource, args = ['--json']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zl-speccov-'));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'SPECIFICATION.md'), SPEC);
  fs.writeFileSync(path.join(dir, 'test', 'fake.test.js'), testSource);
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, SPEC_ROOT: dir } });
  return { ...r, report: args.includes('--json') ? JSON.parse(r.stdout) : null };
}

test('[NFR-4] spec:coverage : exigences couvertes, manquantes et manuelles', () => {
  const { report, status } = run(call('[A-1] premier') + call('[A-2, A-3] groupés'));
  assert.strictEqual(status, 0);
  assert.deepStrictEqual([report.total, report.covered], [4, 3], 'A-4 est manuelle : hors du total');
  assert.deepStrictEqual(report.missing.map((m) => m.id), ['A-5']);
  assert.deepStrictEqual(report.manual.map((m) => m.id), ['A-4']);
});

test('[NFR-4] spec:coverage : les tests skip / todo ne couvrent rien', () => {
  const { report } = run(
    call('[A-1] ignoré', { mod: '.skip' })
    + call('[A-2] à faire', { mod: '.todo' })
    + call('[A-3] avec option', { opts: ', { skip: true }' })
    + call('[A-5] actif', { opts: ', { skip: false }' }),
  );
  assert.deepStrictEqual(report.missing.map((m) => m.id), ['A-1', 'A-2', 'A-3']);
  assert.strictEqual(report.skipped.length, 3);
});

test('[NFR-4] spec:coverage : titres atypiques (apostrophes, ligne suivante) et tags inconnus', () => {
  const { report } = run(
    call("[A-1] l\\'été, \\', virgule")
    + `${CALL}(\n  '[A-2] titre sur la ligne suivante', () => {});\n`
    + call('[A-3] guillemets doubles', { quote: '"' })
    + call('[Z-9] tag inconnu')
    + call('sans tag'),
  );
  assert.deepStrictEqual(report.missing.map((m) => m.id), ['A-5']);
  assert.strictEqual(report.unknownTags.length, 1);
  assert.strictEqual(report.untagged.length, 1);
});

test('[NFR-4] spec:coverage --strict : échoue s\'il manque une exigence, un tag, ou s\'il reste un test ignoré', () => {
  const complete = call('[A-1, A-2, A-3, A-5] tout');
  assert.strictEqual(run(complete, ['--strict']).status, 0);
  assert.strictEqual(run(complete + call('[A-1] ignoré', { opts: ', { skip: true }' }), ['--strict']).status, 1);
  assert.strictEqual(run(complete + call('sans tag'), ['--strict']).status, 1);
  assert.strictEqual(run(call('[A-1] seul'), ['--strict']).status, 1, 'exigences manquantes');
  assert.strictEqual(run(call('[A-1] seul')).status, 0, 'sans --strict : code 0');
});
