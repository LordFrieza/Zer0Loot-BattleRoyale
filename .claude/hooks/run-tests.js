#!/usr/bin/env node
/*
 * Hook PostToolUse (Edit|Write) : relance `npm test` quand un fichier de server/, shared/ ou test/ change.
 * En cas d'échec, sort avec le code 2 : stderr est renvoyé à Claude pour qu'il corrige.
 */
const { spawnSync } = require('child_process');

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let file = '';
  try { file = (JSON.parse(input).tool_input || {}).file_path || ''; } catch { process.exit(0); }
  const normalized = file.split('\\').join('/');
  if (!/(^|\/)(server|shared|test)\/[^/]+\.js$/.test(normalized)) process.exit(0);

  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const r = spawnSync('npm', ['test'], { cwd: root, encoding: 'utf8', shell: true });
  if (r.status === 0) process.exit(0);

  const out = ((r.stdout || '') + (r.stderr || '')).split('\n');
  const failures = out.filter((l) => /✖|not ok|Error|expected|actual|\.js:\d+/i.test(l)).slice(0, 40);
  console.error(`npm test a échoué après la modification de ${file} :\n${(failures.length ? failures : out.slice(-40)).join('\n')}`);
  process.exit(2);
});
