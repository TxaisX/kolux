// APP-058 against a real throwaway "origin": a bare repository in the temp folder.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ship, parseArgs } from "./ship.mjs";

const git = (cwd, ...a) => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "krs-ship-"));
  const origin = path.join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  const seed = path.join(root, "seed");
  git(root, "clone", "-q", origin, seed);
  for (const d of [seed]) {
    git(d, "config", "user.email", "t@example.invalid");
    git(d, "config", "user.name", "T");
  }
  fs.writeFileSync(path.join(seed, "a.txt"), "one\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "seed");
  git(seed, "push", "-q", "origin", "main");
  const clone = (name) => {
    const d = path.join(root, name);
    git(root, "clone", "-q", origin, d);
    git(d, "config", "user.email", "t@example.invalid");
    git(d, "config", "user.name", "T");
    return d;
  };
  return { root, origin, clone };
}
const quiet = () => {
  const lines = [];
  return { log: (l) => lines.push(l), lines };
};

// T-560: each test spawns a few dozen git processes against real repositories; under a loaded machine
// that takes well past vitest's 5 s default, so the whole block gets a minute per test.
describe("ship (APP-058)", { timeout: 60_000 }, () => {
  it("commits, lands a worktree branch on main and pushes both", () => {
    const w = world();
    const work = w.clone("work");
    git(work, "checkout", "-q", "-b", "feat");
    fs.writeFileSync(path.join(work, "b.txt"), "new\n");
    const out = quiet();
    ship(parseArgs(["--main", "--no-release", "--message", "Add b"]), { cwd: work, log: out.log });
    expect(git(w.origin, "log", "-1", "--format=%s", "main")).toBe("Add b");
    expect(git(w.origin, "rev-parse", "feat")).toBe(git(w.origin, "rev-parse", "main"));
    expect(out.lines.join("\n")).toMatch(/landed [0-9a-f]+ on main/);
  });

  it("brings remote changes in by merge and stops on a conflict with the remote untouched", () => {
    const w = world();
    const work = w.clone("work");
    const other = w.clone("other");
    fs.writeFileSync(path.join(other, "a.txt"), "theirs\n");
    git(other, "commit", "-q", "-am", "theirs");
    git(other, "push", "-q", "origin", "main");
    const before = git(w.origin, "rev-parse", "main");
    fs.writeFileSync(path.join(work, "a.txt"), "mine\n");
    expect(() => ship(parseArgs(["--main", "--no-release", "--message", "mine"]), { cwd: work, log: () => {} })).toThrow(/conflict.*Nothing was pushed/s);
    expect(git(w.origin, "rev-parse", "main")).toBe(before);
    expect(git(work, "status", "--porcelain")).toBe(""); // the merge was undone
  });

  it("a dry run changes nothing", () => {
    const w = world();
    const work = w.clone("work");
    fs.writeFileSync(path.join(work, "c.txt"), "x\n");
    const before = git(w.origin, "rev-parse", "main");
    const out = quiet();
    ship(parseArgs(["--main", "--dry-run"]), { cwd: work, log: out.log });
    expect(git(w.origin, "rev-parse", "main")).toBe(before);
    expect(git(work, "status", "--porcelain")).toMatch(/c\.txt/);
    expect(out.lines.join("\n")).toMatch(/would write the commit message with AI \(haiku\)/);
    expect(out.lines.join("\n")).toMatch(/would start the release job/);
  });

  it("merges a named branch first", () => {
    const w = world();
    const work = w.clone("work");
    git(work, "checkout", "-q", "-b", "side");
    fs.writeFileSync(path.join(work, "s.txt"), "s\n");
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", "side work");
    git(work, "checkout", "-q", "main");
    ship(parseArgs(["--merge", "side", "--message", "unused"]), { cwd: work, log: () => {} });
    expect(git(w.origin, "log", "--format=%s", "main")).toMatch(/side work/);
  });
});
