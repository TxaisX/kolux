// The Hive (scripts/hive.mjs) is the private companion repository laid over this checkout. These tests hold
// the one promise that matters on the public side: a Hive file can never be published from here.
import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { HIVE_NOTE, HIVE_PATHS, KEPT, ROOT, ignoreLines, inHive } from "./hive.mjs";

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true });
const tracked = git("ls-files").split("\n").filter(Boolean);

test("a path belongs to the Hive when it is a Hive file or sits in a Hive folder, unless it is one of the kept files", () => {
  for (const f of ["PLAN.md", "STATE.md", "DECISIONS.md", "LOOP.md", "SPEC.md", "spec/03-terminals-panes.md", "PROVENANCE.md", "evidence/T-900.txt", "evidence/perf-idle/shot.png", "evidence/cards-TERM-001.txt", "docs/history/cycle-5-report.md", "docs/research/repo-audit.md", "scripts/prove/live-T-1.mjs", "scripts/stress/run.mjs", "scripts/token-report.py", "HIVE.md", ".\\evidence\\T-1.txt"]) {
    expect(inHive(f), f).toBe(true);
  }
  for (const f of ["README.md", "src/App.tsx", "scripts/hive.mjs", "scripts/plan-check.mjs", "scripts/evidence/smoke.mjs", "docs/guide/README.md", "docs/STATUS.md", "PLAN.md.bak", "specs/x.md", "evidence/cards-GIT-states.json", "evidence/T-193-b/hermes-version.txt", "docs/research/kolux-slimdown-2026-11-09.md", "CHANGELOG.md", "AGENTS.md"]) {
    expect(inHive(f), f).toBe(false);
  }
});

test("no Hive file is tracked in the public repository", () => {
  expect(tracked.filter(inHive)).toEqual([]);
});

test("the public .gitignore carries every Hive line, so an add of everything cannot pick a Hive file up", () => {
  const ignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").split(/\r?\n/);
  for (const line of ignoreLines()) expect(ignore, line).toContain(line);
  // asked of git itself, with a file that would be new in each place
  const samples = HIVE_PATHS.map((h) => (h.endsWith("/") ? h + "new-file-for-the-test.txt" : h)).concat([".hive/HEAD", "evidence/cards-NEW-001.txt", "evidence/shots/a.png"]);
  for (const s of samples) {
    let ignored = true;
    try {
      git("check-ignore", "-q", "--no-index", s);
    } catch {
      ignored = false;
    }
    expect(ignored, s + " is ignored").toBe(true);
  }
});

test("the kept files stay in the public repository: tracked, and not ignored", () => {
  const kept = tracked.filter((f) => KEPT.some((k) => k.is(f)));
  expect(kept.length).toBeGreaterThanOrEqual(12);
  for (const f of kept) {
    let ignored = true;
    try {
      git("check-ignore", "-q", "--no-index", f);
    } catch {
      ignored = false;
    }
    expect(ignored, f + " is not ignored").toBe(false);
  }
  // the fixtures the Rust and front-end card tests read by name
  for (const f of ["evidence/cards-GIT-states.json", "evidence/cards-ACCT-013-key-expired.json", "evidence/cards-SKILL-036-replay.json", "evidence/cards-SET-028-replay.json", "evidence/cards-SET-030-replay.json", "evidence/cards-SET-037-replay.json", "evidence/cards-APP-048-050-patches.json", "evidence/T-193-b/hermes-cron-list-empty.txt", "evidence/T-193-b/openclaw-cron-list-no-gateway.json"]) {
    expect(tracked, f).toContain(f);
  }
});

test("every kept rule names a Hive folder, and the Hive's note names what it holds", () => {
  for (const k of KEPT) expect(HIVE_PATHS, k.under).toContain(k.under);
  for (const word of ["PLAN.md", "evidence/", "spec/", "scripts/prove/", "node scripts/hive.mjs attach"]) expect(HIVE_NOTE).toContain(word);
});
