#!/usr/bin/env node
// The Hive: the private companion repository (TxaisX/kolux-hive) that holds what this public repository
// does not publish: the build logs (plan, state, decisions, priorities, the loop's rules), the proof files
// and screenshots, the behaviour spec and its provenance record, the internal reports and audits, and the
// one-off proof and stress scripts.
//
// It is laid over this checkout rather than kept beside it. Its git data sits in `.hive/` and its files sit
// at the paths they always had (PLAN.md at the root, evidence/ beside src/), so every tool that reads them
// works as before: the plan check, the guide check, the smoke run, the loop. Two repositories, one folder:
//   git ...                    the public repository (this one)
//   node scripts/hive.mjs ...  the private one
// The public .gitignore lists every Hive path, so `git add -A` here can never publish a Hive file;
// scripts/hive.test.mjs holds that, and fails if a Hive path is ever tracked in the public repository.
//
//   node scripts/hive.mjs attach [url]    first time: fetch the Hive into .hive/ and put its files in place
//   node scripts/hive.mjs status          changed Hive files, and new files not yet added
//   node scripts/hive.mjs add <path>...   stage Hive files (refuses a path that belongs to the public repository)
//   node scripts/hive.mjs commit -m "…"   commit what is staged
//   node scripts/hive.mjs pull | push     fast-forward from, or send to, the private repository
//   node scripts/hive.mjs paths           what the Hive holds
//   node scripts/hive.mjs git <args>      any other git command, run against the Hive
//   node scripts/hive.mjs seed <commit>   (one-off) build the Hive's first commit from a commit of this repository
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HIVE_URL = "https://github.com/TxaisX/kolux-hive.git";
export const GIT_DIR = ".hive";

/** What the Hive holds. A name ending in "/" is a folder and everything under it. */
export const HIVE_PATHS = [
  // proof files and screenshots
  "evidence/",
  // build logs
  "PLAN.md",
  "PLAN-done.md",
  "STATE.md",
  "STATE-history.md",
  "DECISIONS.md",
  "DECISIONS-history.md",
  "PRIORITIES.md",
  "LOOP.md",
  // the behaviour spec and the record of where it came from
  "SPEC.md",
  "spec/",
  "COMPAT.md",
  "PROVENANCE.md",
  // internal reports, audits and checklists
  "docs/history/",
  "docs/research/",
  "docs/live-proofs-results-2026-10-31.md",
  "docs/reclaim-old-kolux.md",
  "docs/development/release-0.1.11-checklist.md",
  "docs/development/security-lanes-backlog.md",
  // one-off proof, stress and housekeeping scripts
  "scripts/prove/",
  "scripts/stress/",
  "scripts/firewall-check.ps1",
  "scripts/firewall-allowlist.txt",
  "scripts/firewall-baseline.txt",
  "scripts/token-report.py",
  "scripts/reclaim-old-kolux.ps1",
  // the Hive's own note
  "HIVE.md",
];

/** Inside those folders, what stays public: the fixtures tests read, and the one report public pages cite.
 *  `under` is the Hive folder it sits in, `is` tells a kept file, `ignore` is the line that lets it back in. */
export const KEPT = [
  { under: "evidence/", is: (f) => /^evidence\/cards-[^/]*\.json$/.test(f), ignore: "!/evidence/cards-*.json" },
  { under: "evidence/", is: (f) => f.startsWith("evidence/T-193-b/"), ignore: "!/evidence/T-193-b/" },
  { under: "docs/research/", is: (f) => f === "docs/research/kolux-slimdown-2026-11-09.md", ignore: "!/docs/research/kolux-slimdown-2026-11-09.md" },
];

/** The note at the Hive's root (HIVE.md). Kept here so the first commit can be rebuilt from this file alone. */
export const HIVE_NOTE = `# Kolux Hive

This private repository holds what the public Kolux repository (TxaisX/kolux) does not publish:

- the build logs: PLAN.md, PLAN-done.md, STATE.md, STATE-history.md, DECISIONS.md, DECISIONS-history.md, PRIORITIES.md, LOOP.md
- the proof files and screenshots: evidence/
- the behaviour spec and the record of where it came from: SPEC.md, spec/, COMPAT.md, PROVENANCE.md
- internal reports, audits and checklists: docs/history/, docs/research/, and a few files under docs/
- one-off proof, stress and housekeeping scripts: scripts/prove/, scripts/stress/, the spec firewall, the spend report

Every file sits at the path it had in the public repository, because the Hive is laid over a Kolux checkout:
its git data goes in \`.hive/\` and its files go where they always were, so the plan check, the guide check,
the smoke run and the loop work as before. The public repository ignores all of these paths.

## Use it

From a Kolux checkout:

    node scripts/hive.mjs attach        # first time: fetch the Hive and put its files in place
    node scripts/hive.mjs status        # changed Hive files, and new ones not yet added
    node scripts/hive.mjs add evidence/T-900.txt DECISIONS.md
    node scripts/hive.mjs commit -m "T-900 evidence and its decision row"
    node scripts/hive.mjs push
    node scripts/hive.mjs pull

Two repositories share the folder: \`git\` is the public one, \`node scripts/hive.mjs\` is this one. A change
that touches both (code plus its evidence and its DECISIONS row) is two commits, one in each.

## What must never happen

A Hive file must not be committed to the public repository. The public .gitignore lists every Hive path and
scripts/hive.test.mjs fails if one is ever tracked there; do not use \`git add -f\` on these paths.

## Branches

- \`main\`: the Hive's files.
- \`kolux-full-<date>\`: a complete copy of the public repository, history included, as it stood the day the
  Hive was split off. Nothing is lost if the public history is ever restarted.
`;

const slashes = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");

/** Whether a path (relative to the checkout) belongs to the Hive. */
export function inHive(file) {
  const f = slashes(file);
  if (KEPT.some((k) => k.is(f))) return false;
  return HIVE_PATHS.some((h) => (h.endsWith("/") ? f.startsWith(h) : f === h));
}

/** The lines the public .gitignore must carry: every Hive path, with the kept files let back in. */
export function ignoreLines() {
  const lines = [`/${GIT_DIR}/`];
  for (const h of HIVE_PATHS) {
    const kept = KEPT.filter((k) => k.under === h);
    if (!h.endsWith("/") || kept.length === 0) {
      lines.push("/" + h);
      continue;
    }
    // a folder with kept files: ignore what is in it, not the folder, so the kept ones can be let back in
    lines.push(`/${h}*`);
    for (const k of kept) lines.push(k.ignore);
  }
  return lines;
}

const git = (args, opts = {}) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true, ...opts });
const hive = (args, opts = {}) => git([`--git-dir=${GIT_DIR}`, ...args], opts);
const attached = () => fs.existsSync(path.join(ROOT, GIT_DIR, "HEAD"));
const die = (msg) => {
  console.error("hive: " + msg);
  process.exit(1);
};
const must = (r, what) => {
  if (r.status !== 0) die(`${what} failed: ${(r.stderr || r.stdout || "").trim()}`);
  return r;
};

/** New files under the Hive's paths that the Hive does not track yet. The public .gitignore hides them from
 *  an ordinary status, so they are listed by asking for every untracked file and keeping the Hive's own. */
export function untracked() {
  const r = must(hive(["ls-files", "--others", "-z"]), "listing new files");
  return r.stdout.split("\0").filter((f) => f && inHive(f));
}

function attach(url = HIVE_URL) {
  if (attached()) return console.log(`hive: already attached (${GIT_DIR}/). Use "pull" to update it.`);
  must(git(["clone", "--bare", url, GIT_DIR], { stdio: "inherit" }), "fetching the Hive");
  // A bare clone has no work tree and no remote-tracking branches; give it both.
  must(hive(["config", "core.bare", "false"]), "config");
  must(hive(["config", "core.worktree", ".."]), "config");
  must(hive(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]), "config");
  must(hive(["config", "status.showUntrackedFiles", "no"]), "config");
  must(hive(["fetch", "origin"]), "fetch");
  // The Hive's branch is main, whatever the remote calls its default.
  must(hive(["symbolic-ref", "HEAD", "refs/heads/main"]), "choosing the Hive's branch");
  if (hive(["rev-parse", "--verify", "-q", "refs/heads/main"]).status !== 0) die("the Hive has no main branch yet; nothing to put in place");
  hive(["branch", "--set-upstream-to=origin/main", "main"]);
  // Put the Hive's files in place without touching any that are already here: a file this checkout
  // already has is left as it is and shows up in "status" if it differs.
  must(hive(["read-tree", "HEAD"]), "reading the Hive's file list");
  must(hive(["checkout-index", "--all"]), "putting the Hive's files in place");
  const changed = hive(["status", "--short"]).stdout.trim();
  console.log("hive: attached. Its files are at their usual paths; its git data is in " + GIT_DIR + "/.");
  if (changed) console.log("hive: these files were already here and differ from the Hive's copy (left as they are):\n" + changed);
}

function status() {
  const s = must(hive(["status", "--short", "--branch"]), "status").stdout.trimEnd();
  console.log(s || "hive: nothing changed");
  const fresh = untracked();
  if (fresh.length) console.log(`\nnew, not added yet (${fresh.length}):\n` + fresh.slice(0, 40).map((f) => "  " + f).join("\n") + (fresh.length > 40 ? `\n  … and ${fresh.length - 40} more` : ""));
}

function add(paths) {
  if (paths.length === 0) die('say what to add, for example: node scripts/hive.mjs add evidence/T-900.txt');
  const rel = paths.map((p) => slashes(path.relative(ROOT, path.resolve(p))));
  const wrong = rel.filter((p) => !inHive(p) && !HIVE_PATHS.some((h) => h.endsWith("/") && (h.startsWith(p + "/") || h === p + "/")));
  if (wrong.length) die(`not a Hive path, so it belongs to the public repository: ${wrong.join(", ")}`);
  // -f because the public .gitignore lists every Hive path on purpose.
  must(hive(["add", "-f", "--", ...rel], { stdio: "inherit" }), "add");
}

/** One-off: the Hive's first commit, built from a commit of this repository. The files keep their exact
 *  contents (the same git blobs), so nothing is re-encoded. Prints the new commit; nothing is pushed. */
function seed(from) {
  if (!from) die("say which commit to take the files from: node scripts/hive.mjs seed <commit>");
  const index = path.join(ROOT, ".git", "hive-seed.index");
  fs.rmSync(index, { force: true });
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const rows = must(git(["ls-tree", "-r", "-z", from]), "reading " + from).stdout.split("\0").filter(Boolean);
  const mine = rows.filter((r) => inHive(r.slice(r.indexOf("\t") + 1)));
  if (mine.length === 0) die(`${from} holds no Hive file`);
  const note = must(git(["hash-object", "-w", "--stdin"], { input: HIVE_NOTE }), "writing HIVE.md").stdout.trim();
  must(git(["update-index", "-z", "--index-info"], { env, input: mine.join("\0") + "\0" + `100644 blob ${note}\tHIVE.md` + "\0" }), "building the file list");
  const tree = must(git(["write-tree"], { env }), "write-tree").stdout.trim();
  const sha = must(git(["rev-parse", from]), "rev-parse").stdout.trim();
  const commit = must(git(["commit-tree", tree, "-m", `The Hive: build logs, evidence, spec and proof scripts split from TxaisX/kolux at ${sha.slice(0, 8)}\n\n${mine.length} files, each with the contents it had in that commit, plus HIVE.md.`]), "commit-tree").stdout.trim();
  fs.rmSync(index, { force: true });
  must(git(["update-ref", "refs/hive/seed", commit]), "update-ref");
  console.log(`hive: seed commit ${commit} (${mine.length} files + HIVE.md), kept locally as refs/hive/seed.`);
  console.log(`      send it with: git push ${HIVE_URL} refs/hive/seed:refs/heads/main`);
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help") return console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 23).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  if (cmd === "paths") return console.log(HIVE_PATHS.join("\n") + "\n\nkept in the public repository:\n" + KEPT.map((k) => k.ignore.slice(2)).join("\n"));
  if (cmd === "attach") return attach(rest[0]);
  if (cmd === "seed") return seed(rest[0]);
  if (!attached()) die(`the Hive is not attached to this checkout. Run: node scripts/hive.mjs attach`);
  if (cmd === "status") return status();
  if (cmd === "add") return add(rest);
  if (cmd === "commit") return process.exit(hive(["commit", ...rest], { stdio: "inherit" }).status ?? 1);
  if (cmd === "push") return process.exit(hive(["push", "origin", "HEAD", ...rest], { stdio: "inherit" }).status ?? 1);
  if (cmd === "pull") {
    must(hive(["fetch", "origin"], { stdio: "inherit" }), "fetch");
    return process.exit(hive(["merge", "--ff-only", "origin/main"], { stdio: "inherit" }).status ?? 1);
  }
  if (cmd === "git") return process.exit(hive(rest, { stdio: "inherit" }).status ?? 1);
  die(`no command called "${cmd}". Run: node scripts/hive.mjs help`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
