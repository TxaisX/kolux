// AUD-S1 / S1-F03: scripts/worktree-status.mjs reports the branches whose folder is gone but whose
// commits are not in the base ("the ones that would surprise someone"), yet --check only looks at
// worktrees and exits 0 while that work is still missing from main. --check is what a session ends
// on ("a known state"), so it has to fail when the report lists such work.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "worktree-status.mjs");

const git = (cwd, ...args) => {
  const r = spawnSync("git", ["-C", cwd, "-c", "user.name=Audit", "-c", "user.email=audit@example.invalid", ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

describe("audit S1 · worktree-status --check", () => {
  it("[S1-F03] a branch whose worktree is gone still counts as work main does not have", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "krs-worktree-status-"));
    git(repo, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
    git(repo, "add", "a.txt");
    git(repo, "commit", "-q", "-m", "seed");
    git(repo, "checkout", "-q", "-b", "feature");
    fs.writeFileSync(path.join(repo, "b.txt"), "two\n");
    git(repo, "add", "b.txt");
    git(repo, "commit", "-q", "-m", "feature work");
    git(repo, "checkout", "-q", "main");

    const run = spawnSync(process.execPath, [SCRIPT, "--check"], { cwd: repo, encoding: "utf8", windowsHide: true });
    expect(run.stdout, run.stderr).toContain("feature");
    expect(run.status, run.stdout + run.stderr).toBe(1);
  });
});
