#!/usr/bin/env node
/*
 * Hook Stop : avant de terminer, vérifie que
 *  - si server/ ou shared/ ont changé, un test (test/) a changé aussi ;
 *  - si server/ ou shared/ ont changé, SPECIFICATION.md a changé aussi ;
 *  - `npm test` est vert.
 * Sort avec le code 2 (Claude doit continuer) au plus une fois par tour : `stop_hook_active` évite la boucle.
 */
const { spawnSync } = require('child_process');

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(input); } catch { /* entrée vide */ }
  if (payload.stop_hook_active) process.exit(0);

  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const git = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
  if (git.status !== 0) process.exit(0);
  const changed = git.stdout.split('\n').filter(Boolean).map((l) => {
    const name = l.slice(3).split(' -> ').pop();
    return name.replace(/^"|"$/g, '');
  });
  const any = (re) => changed.some((f) => re.test(f));

  const problems = [];
  const code = any(/^(server|shared)\/.+\.js$/);
  if (code && !any(/^test\/.+\.test\.js$/)) {
    problems.push('Du code de server/ ou shared/ a changé sans test : ajoute ou adapte un test dans test/ (nom préfixé par les identifiants de SPECIFICATION.md, ex. « [BET-7] … »).');
  }
  if (code && !any(/^SPECIFICATION\.md$/)) {
    problems.push('Du code de server/ ou shared/ a changé : vérifie que SPECIFICATION.md décrit toujours le comportement et mets-la à jour si besoin.');
  }
  if (code || any(/^test\//)) {
    const r = spawnSync('npm', ['test'], { cwd: root, encoding: 'utf8', shell: true });
    if (r.status !== 0) {
      const out = ((r.stdout || '') + (r.stderr || '')).split('\n').filter((l) => /✖|not ok|Error/.test(l)).slice(0, 20);
      problems.push('npm test échoue :\n' + out.join('\n'));
    }
  }
  if (!problems.length) process.exit(0);
  console.error('Avant de terminer :\n- ' + problems.join('\n- '));
  process.exit(2);
});
