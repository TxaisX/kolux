// Which worktrees still hold work that main does not have?
// Read-only: this prints, it never merges, removes or commits anything.
// Run: node scripts/worktree-status.mjs [--base main] [--check]
//
// Why a report and not a merge tool: work can reach main by more than one route (a branch rebased,
// a wave replayed, a lane merged under another name), so "commits ahead of main" is not proof that
// the content is missing. Merging that count blindly replays work main already has. The safe move
// is to show the count and the state, then let a person merge the ones that matter:
//   git merge --no-ff <branch>          (run in the main checkout)
// Removing a worktree never deletes its branch or commits. Only uncommitted edits are at risk,
// which is why the DIRTY column exists.
//
// One git call per question, not per row: a git spawn costs a few hundred milliseconds on Windows
// and this script asks about every worktree and every branch, so `status` doubles as the folder
// check (it fails when the folder is gone), one `log` call answers every last-commit date, and one
// `rev-list` serves each distinct tip.
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'main';
const check = args.includes('--check');

const git = (cwd, ...rest) =>
  execFileSync('git', ['-C', cwd, ...rest], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();

const [root, baseSha] = git(process.cwd(), 'rev-parse', '--show-toplevel', '--short', base).split(/\r?\n/);

// git worktree list --porcelain: one blank-line-separated block per worktree.
const blocks = git(root, 'worktree', 'list', '--porcelain').split(/\r?\n\r?\n/);

const rows = [];
for (const block of blocks) {
  const line = key => block.split(/\r?\n/).find(l => l.startsWith(key + ' '));
  const dir = line('worktree')?.slice('worktree '.length);
  const sha = line('HEAD')?.slice('HEAD '.length);
  const branch = line('branch')?.slice('branch refs/heads/'.length);
  if (!dir || !sha) continue;

  // One status call answers two questions: it fails when the folder is gone, and when it works its
  // lines are the uncommitted edits.
  let exists = true;
  let dirty = null;
  try {
    dirty = git(dir, 'status', '--porcelain').split(/\r?\n/).filter(Boolean).length;
  } catch {
    exists = false;
  }

  rows.push({ dir, sha, branch: branch ?? null, exists, ahead: null, dirty, when: null, detached: !branch });
}

const withWorktree = new Set(rows.map(r => r.branch).filter(Boolean));

// Every local branch tip in one call. A branch checked out in a worktree is not a second row.
const tips = git(root, 'for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads')
  .split(/\r?\n/)
  .filter(Boolean)
  .map(l => l.split(' '));

// Commits the base does not have, per distinct tip. The base itself is 0 without a call.
const aheadOf = new Map();
const ahead = sha => {
  if (!aheadOf.has(sha)) aheadOf.set(sha, Number(git(root, 'rev-list', '--count', `${base}..${sha}`)));
  return aheadOf.get(sha);
};

// Every last-commit date in one call per batch (a batch keeps the argument list inside the Windows
// command-line limit on a repo with hundreds of branches).
const whenOf = new Map();
const shas = [...new Set([...rows.map(r => r.sha), ...tips.map(([, sha]) => sha)])];
for (let i = 0; i < shas.length; i += 64) {
  const batch = shas.slice(i, i + 64);
  for (const line of git(root, 'log', '--no-walk', '--format=%H %cs', ...batch).split(/\r?\n/)) {
    const [sha, when] = line.trim().split(' ');
    if (sha) whenOf.set(sha, when);
  }
}

// A detached worktree has no branch to count from, so its AHEAD stays '-', as it always has.
for (const r of rows) {
  r.ahead = r.branch ? (r.branch === base ? 0 : ahead(r.sha)) : null;
  r.when = whenOf.get(r.sha);
}

// Branches whose folder is gone but whose commits are not in the base. These are the ones that
// would surprise someone: no folder to look at, yet work still on the branch.
const branchRows = tips
  .filter(([name]) => name !== base && !withWorktree.has(name))
  .map(([name, sha]) => ({ name, sha: sha.slice(0, 8), ahead: ahead(sha), when: whenOf.get(sha) }))
  .filter(b => b.ahead > 0)
  .sort((a, b) => b.ahead - a.ahead);

const pad = (s, n) => String(s).padEnd(n);
const state = r => (!r.exists ? 'GONE ' : r.dirty ? 'DIRTY' : r.detached ? 'DETCH' : r.ahead ? 'OPEN ' : 'DONE ');

const name = r => r.branch ?? (r.detached ? '(detached)' : pathName(r.dir));
const pathName = d => d.split(/[\\/]/).filter(Boolean).pop();

const mainRow = rows.find(r => r.dir.replace(/\\/g, '/').toLowerCase() === root.replace(/\\/g, '/').toLowerCase());
const others = rows.filter(r => r !== mainRow);

console.log(`\nWorktrees against ${base} (${baseSha}) — main checkout: ${root}\n`);
console.log(`${pad('STATE', 6)} ${pad('BRANCH', 32)} ${pad('AHEAD', 5)} ${pad('DIRTY', 5)} ${pad('LAST', 10)} FOLDER`);
for (const r of others) {
  console.log(
    `${pad(state(r), 6)} ${pad(name(r), 32)} ${pad(r.ahead ?? '-', 5)} ${pad(r.dirty ?? '-', 5)} ${pad(r.when, 10)} ${r.dir}`,
  );
}

if (branchRows.length) {
  console.log(`\nBranches with commits not in ${base} (no folder attached):\n`);
  console.log(`${pad('AHEAD', 5)} ${pad('BRANCH', 40)} ${pad('LAST', 10)} TIP`);
  for (const b of branchRows) console.log(`${pad(b.ahead, 5)} ${pad(b.name, 40)} ${pad(b.when, 10)} ${b.sha}`);
}

const merged = others.filter(r => r.exists && !r.dirty && r.ahead === 0).length;
const unmerged = others.filter(r => (r.ahead ?? 0) > 0).length;
const dirty = others.filter(r => r.dirty > 0).length;
const gone = others.filter(r => !r.exists).length;

console.log(
  `\n${merged} merged and safe to remove · ${unmerged} with commits not in ${base} · ` +
    `${dirty} with uncommitted edits · ${gone} registered but folder missing`,
);
console.log(`Merged examples:  git worktree remove <folder>   (the branch and its commits stay)`);
console.log(`Unmerged:         git merge --no-ff <branch>      (run in ${root})\n`);

// --check: fail when something needs a person, so a session can end on a known state. Work that
// only lives on a branch whose folder is gone counts too: the report already lists it as work main
// does not have, so exiting 0 here would call a state "known" while that work is still missing.
if (check && (unmerged || dirty || branchRows.length)) process.exit(1);
