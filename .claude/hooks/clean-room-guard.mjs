// Clean-room guard: blocks any tool call that points at the old Kolux code or other forbidden material.
// PreToolUse hook. Reads the tool call as JSON on stdin; exit 2 blocks the call (reason on stderr).
import { readFileSync } from 'node:fs';
let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
const ti = input.tool_input || {};
const fields = [ti.command, ti.file_path, ti.notebook_path, ti.path, ti.pattern, ti.glob, ti.cwd]
  .filter(v => typeof v === 'string');
const norm = s => s.split('\\').join('/').toLowerCase();
const forbidden = [
  // The old repo lived at G:/Dev/Kolux/kolux. Since 2026-11-11 G:/Dev/kolux is this repo, so only the old inner folder is blocked.
  { re: /dev\/kolux\/kolux(?![\w-])/, why: 'the old Kolux repo (G:/Dev/Kolux/kolux)' },
  { re: /kolux-scratch/, why: 'G:/Dev/kolux-scratch' },
  { re: /kolux-workspaces/, why: 'G:/Dev/kolux-workspaces' },
  { re: /nightshift-workspaces/, why: 'G:/Dev/nightshift-workspaces' },
  { re: /dev\/backups/, why: 'G:/Dev/backups' },
  { re: /programs\/kolux(?![\w-])/, why: 'the installed Kolux app folder' },
  { re: /dirty-room/, why: 'provenance/dirty-room (dirty-room evidence)' },
];
for (const raw of fields) {
  const s = norm(raw);
  for (const f of forbidden) {
    if (f.re.test(s)) {
      process.stderr.write(`Clean-room guard: blocked ${input.tool_name || 'tool'} call that touches ${f.why}. LOOP.md section 0 forbids it. Work only from SPEC.md, spec/, COMPAT.md, PRIORITIES.md, DECISIONS.md, PROVENANCE.md and public docs.\n`);
      process.exit(2);
    }
  }
}
process.exit(0);
