#!/usr/bin/env node
// Clean public export. The local checkout is the main copy and pushes everything to the private
// dev repo; the public repo (TxaisX/kolux, which also hosts the update feed) gets only the files
// a user or contributor needs. Build records, proof logs, audits and agent tooling stay private.
//
//   node scripts/export-public.mjs [--ref main] [--out G:/Dev/kolux-public] [--fresh] [--push]
//
// --fresh starts the public history over with one commit (first run only; needs --push to land,
// which then force-pushes main). Without --push nothing leaves this PC.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
export const PUBLIC_URL = 'https://github.com/TxaisX/kolux.git';

/** Paths that never go public. A trailing slash means the whole folder. */
export const PRIVATE = [
  'PLAN.md', 'PLAN-done.md', 'STATE.md', 'STATE-history.md', 'DECISIONS.md', 'DECISIONS-history.md',
  'LOOP.md', 'PRIORITIES.md', 'PROVENANCE.md', 'AGENTS.md', 'CLAUDE.md',
  '.claude/', '.kolux/', 'artifacts/', 'evidence/',
  'docs/history/', 'docs/research/', 'docs/reclaim-old-kolux.md',
  'docs/live-proofs-windows.md', 'docs/live-proofs-results-2026-10-31.md',
  'scripts/token-report.py',
];

/** Code and tests read a few files under evidence/ (fixtures, include_str!); those stay. */
const EVIDENCE_REF = /evidence\/[A-Za-z0-9._\/-]+\.(json|txt)/g;

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20 }).trim();
const isPrivate = (p) => PRIVATE.some((x) => (x.endsWith('/') ? p.startsWith(x) : p === x));

export function publicFiles(ref) {
  const all = git('ls-tree', '-r', '--name-only', ref).split('\n').filter(Boolean);
  const keep = new Set(all.filter((p) => !isPrivate(p)));
  const tracked = new Set(all);
  for (const p of all) {
    if (!/^(src|src-tauri)\//.test(p) || !/\.(ts|tsx|rs|mjs)$/.test(p)) continue;
    for (const line of git('show', `${ref}:${p}`).split('\n')) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      for (const m of line.matchAll(EVIDENCE_REF)) if (tracked.has(m[0])) keep.add(m[0]);
    }
  }
  return [...keep].sort();
}

function main() {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const ref = arg('--ref', 'main');
  const out = resolve(arg('--out', 'G:/Dev/kolux-public'));
  const fresh = process.argv.includes('--fresh');
  const push = process.argv.includes('--push');
  const sha = git('rev-parse', '--short', ref);
  const files = publicFiles(ref);

  const og = (...a) => execFileSync('git', a, { cwd: out, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  if (!existsSync(join(out, '.git'))) {
    mkdirSync(out, { recursive: true });
    if (fresh) { og('init', '-q', '-b', 'main'); og('remote', 'add', 'origin', PUBLIC_URL); }
    else execFileSync('git', ['clone', '-q', '--single-branch', '-b', 'main', PUBLIC_URL, out], { stdio: 'inherit' });
  } else if (!fresh) { og('fetch', '-q', 'origin', 'main'); og('reset', '-q', '--hard', 'origin/main'); }
  if (fresh) { try { og('checkout', '-q', '--orphan', `export-${sha}`); } catch { /* new repo, already orphan */ } }

  for (const e of readdirSync(out)) if (e !== '.git') rmSync(join(out, e), { recursive: true, force: true });
  const tar = spawnSync('git', ['archive', '--format=tar', ref, '--', ...files], { cwd: ROOT, maxBuffer: 1 << 30 });
  if (tar.status !== 0) throw new Error(String(tar.stderr));
  const x = spawnSync('tar', ['-x', '-f', '-', '-C', out], { input: tar.stdout });
  if (x.status !== 0) throw new Error(String(x.stderr));

  og('add', '-A');
  const changed = og('status', '--porcelain');
  if (!changed) { console.log(`export: public copy already matches ${ref} (${sha})`); return; }
  og('commit', '-q', '-m', `Source export of ${sha}`);
  if (fresh) { og('branch', '-M', 'main'); }
  console.log(`export: ${files.length} files from ${ref} (${sha}) -> ${out}`);
  if (!push) { console.log(`not pushed. To publish: cd "${out}" && git push ${fresh ? '--force ' : ''}origin main`); return; }
  og('push', ...(fresh ? ['--force'] : []), 'origin', 'main');
  console.log('export: pushed to the public repo');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
