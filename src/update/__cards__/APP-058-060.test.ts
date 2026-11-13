// APP-058 (ship), APP-059 (one build at a time) and APP-060 (the CI gate), proven on the real scripts in scripts/ against
// throwaway repositories under the scratch root. No network, no build: the release job is started for real but its signing key
// is absent (it fails into its log), or finds main already released (a pass that builds nothing), and the CI gate talks to a
// stand-in `gh` program that prints a scripted run list.
import { describe, expect, test } from "vitest";
// @ts-ignore the scripts are plain .mjs with no declarations
import { parseArgs, ship } from "../../../scripts/ship.mjs";
// @ts-ignore
import { notesBody } from "../../../scripts/release.mjs";

// src has no node types; the builtin modules come through process.getBuiltinModule (as keys/sessionKeys.test.ts does).
const process: any = (globalThis as any).process;
const builtin = (name: string): any => process.getBuiltinModule(name);
const { spawn, spawnSync } = builtin("node:child_process");
const fs = builtin("node:fs");
const os = builtin("node:os");
const path = builtin("node:path");
const SCRIPTS: string = path.resolve(path.dirname(builtin("node:url").fileURLToPath(import.meta.url)), "../../../scripts");

/** A fresh folder under the scratch root: the nearest marked folder above the temp dir, or a
 *  dedicated marked root this test makes inside the temp dir, so a clean checkout needs no setup. */
let scratchRoot: string | null = null;
function scratch(tag: string): string {
  if (!scratchRoot) {
    for (let d = os.tmpdir(); path.dirname(d) !== d; d = path.dirname(d)) {
      if (fs.existsSync(path.join(d, ".kolux-scratch"))) {
        scratchRoot = d;
        break;
      }
    }
    if (!scratchRoot) {
      scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kolux-scratch-"));
      fs.writeFileSync(path.join(scratchRoot, ".kolux-scratch"), "");
    }
  }
  const dir = fs.mkdtempSync(path.join(scratchRoot, `${tag}-`));
  fs.writeFileSync(path.join(dir, ".kolux-scratch"), "");
  return dir;
}
const slash = (p: string) => p.replace(/\\/g, "/");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(what: string, ok: () => boolean, ms = 60_000) {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

function git(cwd: string, ...a: string[]): string {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
/** A bare origin holding main (package.json at 0.5.0), and a way to clone it. */
function world(root: string) {
  const origin = path.join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  const clone = (name: string) => {
    const d = path.join(root, name);
    git(root, "clone", "-q", origin, d);
    git(d, "config", "user.email", "t@example.invalid");
    git(d, "config", "user.name", "T");
    return d;
  };
  const seed = clone("seed");
  fs.writeFileSync(path.join(seed, "a.txt"), "one\n");
  fs.writeFileSync(path.join(seed, "package.json"), JSON.stringify({ name: "x", version: "0.5.0" }));
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "seed");
  git(seed, "push", "-q", "origin", "main");
  return { origin, clone };
}

describe("APP-058", { timeout: 120_000 }, () => {
  test("box 1: shipping a change to main lands one commit on main, pushes it, and prints where the release job's log is", async () => {
    const root = scratch("app058");
    const w = world(root);
    const work = w.clone("work");
    git(work, "checkout", "-q", "-b", "feat");
    fs.writeFileSync(path.join(work, "b.txt"), "new\n");
    const publish = path.join(root, "published");
    const env = {
      ...process.env,
      KOLUX_RELEASE_CHECKOUT: path.join(root, "rel", "checkout"),
      KOLUX_RELEASE_PUBLISH_DIR: publish, // a folder, so nothing can reach GitHub
      KOLUX_RELEASE_KEY: path.join(root, "nokey", "kolux.key"), // absent: the job cannot build or sign
    };
    const lines: string[] = [];
    ship(parseArgs(["--main", "--message", "Add b"]), { cwd: work, log: (l: string) => lines.push(l), env });
    expect(git(w.origin, "log", "-1", "--format=%s", "main")).toBe("Add b");
    expect(git(w.origin, "rev-parse", "feat")).toBe(git(w.origin, "rev-parse", "main"));
    expect(git(w.origin, "rev-list", "--count", "main")).toBe("2"); // seed + the one commit
    const said = lines.find((l) => l.startsWith("release job started; its log is "));
    expect(said, lines.join("\n")).toBeTruthy();
    const logFile = said!.slice("release job started; its log is ".length);
    expect(path.isAbsolute(logFile)).toBe(true);
    expect(logFile.startsWith(root)).toBe(true);
    expect(fs.existsSync(logFile)).toBe(true);
    // The release job really ran, detached; it cannot sign, so the failure goes to that log, and the ship above had already succeeded.
    await until("the release job's failure in its log", () => fs.readFileSync(logFile, "utf8").includes("release failed: no signing key"));
    expect(fs.existsSync(publish)).toBe(false);
  });

  test("box 2: a conflicting change on the remote stops the ship and leaves every remote ref as it was", () => {
    const root = scratch("app058c");
    const w = world(root);
    const work = w.clone("work");
    const other = w.clone("other");
    fs.writeFileSync(path.join(other, "a.txt"), "theirs\n");
    git(other, "commit", "-q", "-am", "theirs");
    git(other, "push", "-q", "origin", "main");
    const refs = () => git(w.origin, "for-each-ref", "--format=%(refname) %(objectname)");
    const before = refs();
    git(work, "checkout", "-q", "-b", "feat");
    fs.writeFileSync(path.join(work, "a.txt"), "mine\n");
    expect(() => ship(parseArgs(["--main", "--no-release", "--message", "mine"]), { cwd: work, log: () => {} })).toThrow(/conflict.*Nothing was pushed/s);
    expect(refs()).toBe(before); // main untouched, and the feature branch was never pushed either
    expect(git(work, "status", "--porcelain")).toBe(""); // the merge was undone
  });
});

describe("APP-059 box 2", { timeout: 180_000 }, () => {
  test("two ships in quick succession make exactly two builds, one after the other, never side by side", async () => {
    const root = scratch("app059");
    const w = world(root);
    const sha = git(w.origin, "rev-parse", "main");
    const repo = "file:///" + slash(w.origin); // a URL, so the clone goes through upload-pack and the gate below
    const home = path.join(root, "home");
    fs.mkdirSync(home);
    const events = path.join(root, "gate-events.txt");
    const go = path.join(root, "gate-go");
    // The gate holds the first build inside its clone until `go` exists; it is git's own hook for the pack a clone asks for.
    const gate = path.join(root, "gate.mjs");
    fs.writeFileSync(
      gate,
      [
        'import fs from "node:fs";',
        'import { spawnSync } from "node:child_process";',
        `fs.appendFileSync(${JSON.stringify(events)}, "enter\\n");`,
        `while (!fs.existsSync(${JSON.stringify(go)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);`,
        'const r = spawnSync(process.argv[2], process.argv.slice(3), { stdio: "inherit" });',
        "process.exit(r.status ?? 1);",
        "",
      ].join("\n"),
    );
    const cfg = path.join(home, ".gitconfig");
    fs.writeFileSync(cfg, `[uploadpack]\n\tpackObjectsHook = node ${slash(gate)}\n[user]\n\tname = T\n\temail = t@example.invalid\n`);
    // Main is already released: a build pass finds that out and builds nothing, so every pass is countable by its line.
    const pub = path.join(root, "published");
    fs.mkdirSync(path.join(pub, "v0.5.1"), { recursive: true });
    fs.writeFileSync(path.join(pub, "v0.5.1", "notes.md"), notesBody(["seed"], sha));
    const checkout = path.join(root, "rel", "checkout");
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      GIT_CONFIG_GLOBAL: cfg,
      KOLUX_RELEASE_CHECKOUT: checkout,
      KOLUX_RELEASE_PUBLISH_DIR: pub,
      KOLUX_RELEASE_KEY: path.join(root, "nokey", "kolux.key"),
    };
    const job = [path.join(SCRIPTS, "release.mjs"), "--repo", repo];

    // Ship 1's job starts and is held inside its first build.
    const logA = path.join(root, "job-a.log");
    const fd = fs.openSync(logA, "w");
    const a = spawn(process.execPath, job, { env, stdio: ["ignore", fd, fd], windowsHide: true });
    const exited = new Promise<number | null>((r) => a.on("exit", (code: number | null) => r(code)));
    await until("the first build to be inside its clone", () => fs.existsSync(events) && fs.existsSync(checkout + ".lock"));

    // Ships 2 and 3 land while it runs: their jobs start, find the build lock held, and stop.
    const second = spawnSync(process.execPath, job, { env, encoding: "utf8", timeout: 60_000 });
    const third = spawnSync(process.execPath, job, { env, encoding: "utf8", timeout: 60_000 });
    for (const r of [second, third]) {
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("a release build is running; one more build from the newest main is queued after it");
      expect(r.stdout).not.toContain("cloning");
      expect(r.stdout).not.toContain("already released");
    }
    expect(fs.readdirSync(path.dirname(checkout)).filter((n: string) => n.endsWith(".queued"))).toHaveLength(1); // two ships, one queued build
    expect(fs.readFileSync(logA, "utf8")).not.toContain("already released"); // the first build is still in progress

    fs.writeFileSync(go, "");
    expect(await exited).toBe(0);
    fs.closeSync(fd);
    const out = fs.readFileSync(logA, "utf8");
    const passes = out.match(/was already released as v0\.5\.1; nothing to do/g) ?? [];
    expect(passes).toHaveLength(2); // exactly two builds
    expect(out.indexOf("a ship landed during the build; building again")).toBeGreaterThan(out.indexOf("nothing to do")); // the second after the first
    expect(out.match(/a ship landed during the build/g)).toHaveLength(1);
    expect(fs.readFileSync(events, "utf8").trim().split("\n")).toHaveLength(1); // only the first build ever cloned
    const left = fs.readdirSync(path.dirname(checkout)).filter((n: string) => n.endsWith(".lock") || n.endsWith(".queued"));
    expect(left).toEqual([]); // lock released, queue spent
  });
});

describe("APP-060 box 2", { timeout: 60_000 }, () => {
  /** Runs the real CI gate against a `gh` stand-in that answers `gh run list` with `runs`. */
  function gateWith(runs: unknown[]) {
    const root = scratch("app060");
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    const body = JSON.stringify(runs);
    fs.writeFileSync(path.join(bin, "gh.cmd"), `@echo off\r\necho ${body}\r\n`);
    fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho '${body}'\n`, { mode: 0o755 });
    const summary = path.join(root, "summary.md");
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const r = spawnSync(process.execPath, [path.join(SCRIPTS, "ci-gate.mjs"), sha], {
      encoding: "utf8",
      env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, GITHUB_STEP_SUMMARY: summary },
    });
    return { r, summary: fs.existsSync(summary) ? fs.readFileSync(summary, "utf8") : "" };
  }

  test("a commit whose CI run failed is refused, and the reason is printed and written to the job summary", () => {
    const { r, summary } = gateWith([{ status: "completed", conclusion: "failure", url: "https://example.invalid/runs/1" }]);
    expect(r.status).toBe(1);
    const reason = 'CI for commit 0123456 ended "failure", so this release was not published.';
    expect(r.stdout).toContain(reason);
    expect(summary).toContain("### Release refused");
    expect(summary).toContain(reason);
  });

  test("a commit whose CI run passed is let through (the gate tells the two apart)", () => {
    const { r, summary } = gateWith([{ status: "completed", conclusion: "success", url: "https://example.invalid/runs/2" }]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("CI passed for commit 0123456.");
    expect(summary).toBe("");
  });

  test("the shipped release workflow runs that gate before the release job (workflow-check holds both workflows to it)", () => {
    const r = spawnSync(process.execPath, [path.join(SCRIPTS, "workflow-check.mjs")], { cwd: path.resolve(SCRIPTS, ".."), encoding: "utf8" });
    expect(r.stdout).toContain("workflow-check: OK");
    expect(r.status).toBe(0);
  });
});
