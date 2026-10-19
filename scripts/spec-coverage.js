#!/usr/bin/env node
/*
 * Couverture de SPECIFICATION.md par les tests : croise les identifiants d'exigences (**ACC-1**, **B-15**…)
 * avec les identifiants entre crochets au début du nom des tests (« [BET-7, BET-8] paris : … »).
 *
 *   npm run spec:coverage                rapport lisible
 *   npm run spec:coverage -- --json      rapport JSON (pour l'agent QA et le test NFR-4), code de sortie 0
 *   npm run spec:coverage -- --strict    code 1 s'il reste des exigences automatisables sans test, des tags
 *                                        inconnus, des tests sans tag ou des tests ignorés (skip / todo)
 *
 * Règles de comptage :
 *  - une exigence dont le texte contient « (vérification manuelle) » est signalée à part et n'est jamais « manquante » ;
 *  - un test `skip`, `todo` ou `{ skip: … }` ne couvre rien (il est listé dans `skipped`) ;
 *  - ce script ne dit pas si un test passe : c'est le rôle de `npm test`.
 */
const fs = require('fs');
const path = require('path');

const root = process.env.SPEC_ROOT || path.join(__dirname, '..'); // SPEC_ROOT : dossier fictif des tests du script
const spec = fs.readFileSync(path.join(root, 'SPECIFICATION.md'), 'utf8');

// Exigences : id → texte, section, manuelle ?
const requirements = {};
let current = '';
for (const line of spec.split('\n')) {
  const h = line.match(/^##\s+(.*)/);
  if (h) current = h[1].trim();
  const m = line.match(/^- \*\*([A-Z]+-\d+)\*\*\s+(.*)/);
  if (m) requirements[m[1]] = { text: m[2], section: current, manual: /\(vérification manuelle/.test(m[2]) };
}

// Tests : `test(`, `test.skip(`, `test.todo(`, `t.test(`… avec le titre (guillemets simples, doubles ou backticks,
// échappements autorisés, titre éventuellement sur la ligne suivante) et l'objet d'options facultatif.
const TEST_CALL = /\btest(?:\.(skip|todo|only))?\(\s*(['"`])((?:\\[\s\S]|(?!\2)[^\\])*)\2\s*(?:,\s*\{([^}]*)\})?/g;
const unescape = (s) => s.replace(/\\([\s\S])/g, '$1');

const testDir = path.join(root, 'test');
const covered = {};
const unknownTags = [];
const untagged = [];
const skipped = [];
for (const file of fs.readdirSync(testDir).filter((f) => f.endsWith('.test.js'))) {
  const src = fs.readFileSync(path.join(testDir, file), 'utf8');
  for (const m of src.matchAll(TEST_CALL)) {
    const [, modifier, , rawName, options = ''] = m;
    const name = unescape(rawName);
    const ignored = modifier === 'skip' || modifier === 'todo' || /\b(?:skip|todo)\s*:\s*(?!false\b)\S/.test(options);
    const tag = name.match(/^\[([^\]]+)\]\s*(.*)/);
    if (!tag) { untagged.push(`${file} › ${name}`); continue; }
    if (ignored) { skipped.push(`${file} › ${name}`); continue; }
    for (const id of tag[1].split(',').map((s) => s.trim())) {
      if (!requirements[id]) unknownTags.push(`${file} › ${id}`);
      (covered[id] = covered[id] || []).push(`${file} › ${tag[2]}`);
    }
  }
}

const ids = Object.keys(requirements);
const automatable = ids.filter((id) => !requirements[id].manual);
const missing = automatable.filter((id) => !covered[id]);
const manual = ids.filter((id) => requirements[id].manual);
const report = {
  total: automatable.length,
  covered: automatable.length - missing.length,
  missing: missing.map((id) => ({ id, section: requirements[id].section, text: requirements[id].text })),
  manual: manual.map((id) => ({ id, section: requirements[id].section, text: requirements[id].text, tests: covered[id] || [] })),
  unknownTags,
  untagged,
  skipped,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const short = (t) => (t.length > 110 ? t.slice(0, 107) + '…' : t);
console.log(`Exigences automatisables couvertes par au moins un test : ${report.covered} / ${report.total} (${Math.round((report.covered / report.total) * 100)} %)`);
console.log(`Exigences à vérifier à la main : ${manual.length}\n`);
const bySection = {};
for (const m of report.missing) (bySection[m.section] = bySection[m.section] || []).push(m);
for (const [name, list] of Object.entries(bySection)) {
  console.log(`## ${name}`);
  for (const m of list) console.log(`  ✗ ${m.id}  ${short(m.text)}`);
}
if (manual.length) console.log(`Vérification manuelle :\n  ${report.manual.map((m) => m.id).join(', ')}`);
if (unknownTags.length) console.log(`\nTags inconnus (absents de la spec) :\n  ${unknownTags.join('\n  ')}`);
if (untagged.length) console.log(`\nTests sans tag :\n  ${untagged.join('\n  ')}`);
if (skipped.length) console.log(`\nTests ignorés (skip / todo), non comptés :\n  ${skipped.join('\n  ')}`);

if (process.argv.includes('--strict') && (missing.length || unknownTags.length || untagged.length || skipped.length)) process.exit(1);
