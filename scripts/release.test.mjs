import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { acquire, buildOnce, downloadUrl, installerName, isStale, manifest, markerOf, newestTag, nextVersion, notesBody, run, smokeCli, smokeMigration, takeQueued, unlock, verifySignature, FEED_REPO, STALE_MS } from "./release.mjs";
import { decide, WAIT_MS } from "./ci-gate.mjs";
import { checkPromises, checkWorkflow } from "./workflow-check.mjs";
import { parseArgs } from "./ship.mjs";

// This file drives real git repositories and the release script, so a loaded machine takes well over the
// 5 s default (the gate caught "never asks GitHub…" at 5,344 ms); the same run passes inside 30 s.
vi.setConfig({ testTimeout: 30_000 });

describe("release version (APP-059)", () => {
  it("is one patch above the higher of the project version and the newest release", () => {
    expect(nextVersion("0.1.0", null)).toBe("0.1.1");
    expect(nextVersion("0.1.0", "v0.1.7")).toBe("0.1.8");
    expect(nextVersion("0.3.0", "v0.2.9")).toBe("0.3.1"); // a version-bump commit wins
    expect(() => nextVersion("one", null)).toThrow(/x\.y\.z/);
  });
  it("picks the newest rehearsal folder by number, not by text", () => {
    expect(newestTag(["v0.1.9", "v0.1.10", "latest.json", "v0.1.2"])).toBe("v0.1.10");
    expect(newestTag(["latest.json"])).toBeNull();
  });
});

describe("release notes (APP-059)", () => {
  it("list each commit subject, 30 at most, with the source marker hidden at the end", () => {
    const subjects = Array.from({ length: 40 }, (_, i) => `Change ${i + 1}`);
    const body = notesBody([...subjects, ""], "abc1234def");
    expect(body.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(30);
    expect(body.startsWith("- Change 1\n")).toBe(true);
    expect(markerOf(body)).toBe("abc1234def");
    expect(markerOf("no marker")).toBeNull();
  });
  it("the manifest is the updater's signed JSON with the GitHub download address", () => {
    const m = manifest("0.1.1", "- x", "sig", downloadUrl("0.1.1"), new Date("2026-10-09T00:00:00Z"));
    expect(m.platforms["windows-x86_64"].url).toBe("https://github.com/TxaisX/kolux/releases/download/v0.1.1/Kolux.RS_0.1.1_x64-setup.exe");
    expect(m.pub_date).toBe("2026-10-09T00:00:00.000Z");
  });
});

describe("one build at a time (APP-059)", () => {
  it("a lock older than three hours or held by a dead process is stale", () => {
    const now = 10 * STALE_MS;
    expect(isStale({ pid: 1, at: now - 1000 }, now, () => true)).toBe(false);
    expect(isStale({ pid: 1, at: now - STALE_MS - 1 }, now, () => true)).toBe(true);
    expect(isStale({ pid: 1, at: now }, now, () => false)).toBe(true);
    expect(isStale(null, now, () => true)).toBe(true);
  });
  it("a second job queues exactly one more build; a stale lock is taken over", () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "krs-rel-")), "checkout");
    expect(acquire(dir, { pid: 1, isAlive: () => true })).toBe("locked");
    expect(acquire(dir, { pid: 2, isAlive: () => true })).toBe("queued");
    expect(acquire(dir, { pid: 3, isAlive: () => true })).toBe("queued");
    expect(takeQueued(dir)).toBe(true);
    expect(takeQueued(dir)).toBe(false); // three ships, one extra build
    expect(acquire(dir, { pid: 4, isAlive: () => false })).toBe("locked"); // holder died
    unlock(dir, 3); // a build that no longer owns the lock leaves it alone
    expect(fs.existsSync(dir + ".lock")).toBe(true);
    unlock(dir, 4);
    expect(fs.existsSync(dir + ".lock")).toBe(false);
  });
});

describe("packaged CLI smoke test (APP-061)", () => {
  const cli = (version, help) => (words) => (words[0] === "--version" ? version : help);
  const HELP = ["kolux: drive Kolux from a terminal", "  kolux --version", "  kolux worktree create --name <name>"].join(String.fromCharCode(10));
  it("passes a CLI that reports the release version and prints its help", () => {
    expect(() => smokeCli(cli("0.2.0", HELP), "0.2.0")).not.toThrow();
  });
  it("stops the release when the CLI's version is wrong or its help is broken", () => {
    expect(() => smokeCli(cli("0.1.9", HELP), "0.2.0")).toThrow(/says 0.1.9, the release is 0.2.0/);
    expect(() => smokeCli(cli("0.2.0", ""), "0.2.0")).toThrow(/--help/);
  });
});

describe("packaged old-profile migration smoke test (APP-061)", () => {
  const fake = (added, seen = []) => (words, env) => {
    seen.push({ words, env });
    return JSON.stringify({ success: true, result: { added } });
  };
  const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "mig-smoke-"));
  it("lays out a former-name folder beside a throwaway profile and passes when exactly the listed settings carried", () => {
    const root = scratch();
    const seen = [];
    smokeMigration(fake(["uiLook", "language"], seen), root);
    expect(seen[0].words).toEqual(["profile", "migrate", "--json"]);
    expect(seen[0].env.KOLUX_USER_DATA_PATH).toBe(path.join(root, "kolux.smoke"));
    expect(fs.readFileSync(path.join(root, "Nightshift", "settings.json"), "utf8")).toMatch(/nightshiftLanguage/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  it("stops the release when a setting is missing or one beyond the allow-list carried", () => {
    const root = scratch();
    expect(() => smokeMigration(fake(["uiLook"]), root)).toThrow(/carried \["uiLook"\]/);
    expect(() => smokeMigration(fake(["uiLook", "language", "githubToken"]), root)).toThrow(/more than the allow-list/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

// T-587 (X-proc.1): the real publish path, not the rehearsal folder every other test uses. git builds
// from a scratch main; `exec` stands in for gh, pnpm, cargo and the packaged CLI, and logs each call
// with the environment it was given. Nothing reaches GitHub and nothing is compiled. T-588: the signing
// key is a real throwaway one, and the real tauri signer signs with it.
describe("release job publishing to GitHub, with gh stubbed (APP-059, DT-R11)", () => {
  const git = (dir, ...a) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { encoding: "utf8" }).trim();
  const TAURI_JS = fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url));
  const keypair = (key) => execFileSync(process.execPath, [TAURI_JS, "signer", "generate", "--ci", "-p", "key-password", "-w", key], { encoding: "utf8" });
  const SECRET = /^(GH_TOKEN|GITHUB_TOKEN|KOLUX_RELEASE_KEY|KOLUX_RELEASE_KEY_PASSWORD|TAURI(_SIGNING)?_PRIVATE_KEY(_PATH|_PASSWORD)?)$/;
  const held = (call) => Object.keys(call.env).filter((k) => SECRET.test(k)).sort();
  function scratch() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "krs-release-"));
    const origin = path.join(root, "origin");
    fs.mkdirSync(path.join(origin, "src-tauri"), { recursive: true });
    fs.writeFileSync(path.join(origin, "package.json"), '{ "version": "0.1.0" }\n');
    fs.writeFileSync(path.join(origin, "src-tauri", "tauri.conf.json"), '{ "version": "0.1.0" }\n');
    fs.writeFileSync(path.join(origin, "src-tauri", "Cargo.toml"), '[package]\nversion = "0.1.0"\n');
    git(root, "init", "-q", "-b", "main", origin);
    git(origin, "add", "-A");
    git(origin, "commit", "-qm", "Terminals keep their place");
    fs.writeFileSync(path.join(origin, "README.md"), "x\n");
    git(origin, "add", "-A");
    git(origin, "commit", "-qm", "Agents start faster");
    const key = path.join(root, "signing", "kolux-rs.key");
    keypair(key);
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (SECRET.test(k) || ["KOLUX_RELEASE_PUBLISH_DIR", "CARGO_TARGET_DIR"].includes(k)) delete env[k];
    Object.assign(env, { KOLUX_RELEASE_CHECKOUT: path.join(root, "checkout"), KOLUX_RELEASE_KEY: key, KOLUX_RELEASE_KEY_PASSWORD: "key-password", GH_TOKEN: "release-token", GITHUB_ACTIONS: "true" });
    return { root, origin, env, key, checkout: env.KOLUX_RELEASE_CHECKOUT, done: () => fs.rmSync(root, { recursive: true, force: true }) };
  }
  // gh answers with `latest` (null: no release yet); the bundler leaves an installer, signed only when it
  // is handed the key (as `tauri build` does); tauri signer is the real one; the packaged CLI passes its
  // smoke test.
  function tools(checkout, latest) {
    const calls = [];
    const version = () => JSON.parse(fs.readFileSync(path.join(checkout, "src-tauri", "tauri.conf.json"), "utf8")).version;
    const exec = (cmd, args, opts = {}) => {
      const name = cmd === process.execPath && args[0]?.endsWith("tauri.js") ? `tauri ${args[1]}` : path.basename(cmd);
      calls.push({ name, args, env: opts.env ?? process.env });
      // APP-060: the gate asks for the CI runs of the commit; a green run lets the release go on.
      if (name === "gh" && args[0] === "run" && args[1] === "list") return JSON.stringify([{ status: "completed", conclusion: "success", url: "" }]);
      if (name === "gh" && args[1] === "view") {
        if (!latest) throw new Error("gh: release not found");
        return JSON.stringify(latest);
      }
      if (name === "pnpm" && args[0] === "tauri" && args[1] === "build") {
        const exe = path.join(checkout, "src-tauri", "target", "release", "bundle", "nsis", installerName(version()));
        fs.mkdirSync(path.dirname(exe), { recursive: true });
        fs.writeFileSync(exe, Buffer.alloc((1 << 20) + 1));
        if (opts.env?.TAURI_SIGNING_PRIVATE_KEY) fs.writeFileSync(exe + ".sig", "c2lnbmF0dXJl");
      }
      if (name === "tauri signer") return execFileSync(process.execPath, [TAURI_JS, ...args.slice(1)], { env: opts.env, encoding: "utf8" });
      if (name === "kolux.exe") {
        if (args[0] === "--version") return version();
        if (args[0] === "--help") return "kolux --version\nkolux worktree create --name <name>";
        return JSON.stringify({ success: true, result: { added: ["uiLook", "language"] } });
      }
      return "";
    };
    return { calls, exec, gh: () => calls.filter((c) => c.name === "gh" && c.args[0] !== "run") };
  }

  it("inside GitHub Actions, from the local checkout release.yml passes, it asks gh for the newest release and publishes the next", () => {
    const s = scratch();
    try {
      const t = tools(s.checkout, { tagName: "v0.1.7", body: "- Older\n\n<!-- kolux-rs-source: 1234567 -->\n" });
      const r = buildOnce({ repo: s.origin }, s.env, t.exec);
      expect(r).toMatchObject({ version: "0.1.8", published: true });
      expect(r.notes).toMatch(/^- Agents start faster\n- Terminals keep their place\n/);
      expect(t.gh().map((c) => c.args.slice(0, 2).join(" "))).toEqual(["release view", "release create", "release upload"]);
      const [, create, upload] = t.gh().map((c) => c.args);
      // APP-060 / APP-031: the tag names the commit that was built, not whatever main is at publish time.
      expect(create.slice(2, 5)).toEqual(["v0.1.8", "--target", r.sha]);
      expect(create.slice(5, 7)).toEqual(["--repo", FEED_REPO]);
      expect(create.slice(-2).map((f) => path.basename(f))).toEqual([installerName("0.1.8"), installerName("0.1.8") + ".sig"]);
      expect(path.basename(upload.at(-1))).toBe("latest.json"); // APP-031: the manifest goes up last
    } finally {
      s.done();
    }
  });

  it("refuses a commit whose CI is red, before it builds or publishes anything", () => {
    const s = scratch();
    try {
      const t = tools(s.checkout, null);
      const red = (cmd, args, opts) =>
        path.basename(cmd) === "gh" && args[0] === "run" && args[1] === "list"
          ? JSON.stringify([{ status: "completed", conclusion: "failure", url: "https://example.invalid/run" }])
          : t.exec(cmd, args, opts);
      expect(() => buildOnce({ repo: s.origin }, s.env, red)).toThrow(/CI for commit .* ended "failure"/);
      expect(t.gh().some((c) => c.args[1] === "create"), "no release is created").toBe(false);
    } finally {
      s.done();
    }
  });

  it("lets a recovery publish past a red commit only when KOLUX_RELEASE_ALLOW_RED=1 says so", () => {
    const s = scratch();
    try {
      const t = tools(s.checkout, null);
      const red = (cmd, args, opts) =>
        path.basename(cmd) === "gh" && args[0] === "run" && args[1] === "list"
          ? JSON.stringify([{ status: "completed", conclusion: "failure", url: "" }])
          : t.exec(cmd, args, opts);
      const r = buildOnce({ repo: s.origin }, { ...s.env, KOLUX_RELEASE_ALLOW_RED: "1" }, red);
      expect(r).toMatchObject({ published: true });
    } finally {
      s.done();
    }
  });

  it("skips a main that was already released, building nothing", () => {
    const s = scratch();
    try {
      const sha = git(s.origin, "rev-parse", "HEAD");
      const t = tools(s.checkout, { tagName: "v0.1.3", body: notesBody(["Agents start faster"], sha) });
      expect(buildOnce({ repo: s.origin }, s.env, t.exec)).toBeNull();
      expect(t.calls.map((c) => c.name)).toEqual(["gh"]);
    } finally {
      s.done();
    }
  });

  it("never asks GitHub, and refuses to publish, from a repository that is neither on GitHub nor in GitHub Actions", () => {
    const s = scratch();
    try {
      delete s.env.GITHUB_ACTIONS;
      const t = tools(s.checkout, { tagName: "v0.1.7", body: "" });
      expect(buildOnce({ repo: s.origin, dryRun: true }, s.env, t.exec)).toMatchObject({ version: "0.1.1", dryRun: true });
      expect(() => buildOnce({ repo: s.origin }, s.env, t.exec)).toThrow(/is not on GitHub, so nothing is published/);
      expect(t.gh()).toEqual([]);
    } finally {
      s.done();
    }
  });

  // T-588 (X-proc.5): the build runs every dependency's install and build scripts, so it holds neither
  // the release token nor the signing key.
  it("the build gets neither the token nor the key; tauri signer alone gets the key and binds the version; gh alone gets the token", () => {
    const s = scratch();
    try {
      const t = tools(s.checkout, { tagName: "v0.1.7", body: "" });
      const r = buildOnce({ repo: s.origin }, s.env, t.exec);
      expect(r).toMatchObject({ version: "0.1.8", published: true });
      const build = t.calls.filter((c) => ["pnpm", "cargo", "kolux.exe"].includes(c.name));
      expect(build.map((c) => c.name)).toEqual(["pnpm", "cargo", "pnpm", "kolux.exe", "kolux.exe", "kolux.exe"]);
      for (const c of build) expect(held(c), `${c.name} ${c.args.join(" ")}`).toEqual([]);
      const signer = t.calls.filter((c) => c.name === "tauri signer");
      expect(signer.map((c) => c.args.slice(1, 5))).toEqual([["signer", "sign", "--app-version", "0.1.8"]]);
      expect(held(signer[0])).toEqual(["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"]);
      expect(signer[0].env.TAURI_SIGNING_PRIVATE_KEY).toBe(fs.readFileSync(s.key, "utf8").trim());
      expect(t.gh()).toHaveLength(3);
      for (const c of t.gh()) expect(held(c), c.args.slice(0, 2).join(" ")).toEqual(["GH_TOKEN"]);
      // The manifest carries the signature tauri signer made, bound to the version (requireSignedVersion).
      const sig = JSON.parse(fs.readFileSync(path.join(r.out, "latest.json"), "utf8")).platforms["windows-x86_64"].signature;
      expect(Buffer.from(sig, "base64").toString("utf8")).toMatch(/trusted comment: .*\tversion:0\.1\.8\n/);
    } finally {
      s.done();
    }
  });

  it("a signature that does not check out against the public key the app carries stops the release before anything is published", () => {
    const s = scratch();
    try {
      keypair(path.join(s.root, "other.key"));
      fs.copyFileSync(path.join(s.root, "other.key.pub"), s.key + ".pub"); // the app is built with another key's public half
      const t = tools(s.checkout, { tagName: "v0.1.7", body: "" });
      expect(() => buildOnce({ repo: s.origin }, s.env, t.exec)).toThrow(/another key than the public key the app carries/);
      expect(t.gh().map((c) => c.args[1])).toEqual(["view"]);
    } finally {
      s.done();
    }
  });

  it("in CI's two steps, --build-only builds with no private key on the machine and signs nothing; --finish signs that build and publishes it", () => {
    const s = scratch();
    try {
      const t = tools(s.checkout, { tagName: "v0.1.7", body: "" });
      const privateKey = fs.readFileSync(s.key);
      fs.rmSync(s.key); // release.yml writes it only in the step that signs
      const built = buildOnce({ repo: s.origin, buildOnly: true }, s.env, t.exec);
      expect(built).toMatchObject({ version: "0.1.8", signed: false });
      expect(fs.readdirSync(built.out).sort()).toEqual([installerName("0.1.8"), "notes.md"]);
      expect(t.calls.map((c) => c.name)).not.toContain("tauri signer");
      expect(t.gh().map((c) => c.args[1])).toEqual(["view"]);
      fs.writeFileSync(s.key, privateKey);
      fs.mkdirSync(path.join(s.checkout + "-out", "v0.1.9"), { recursive: true }); // a newer-named folder from some other run is never picked
      run({ finish: true }, s.env, t.exec);
      expect(t.gh().map((c) => c.args[1])).toEqual(["view", "create", "upload"]);
      expect(t.gh()[1].args[2]).toBe("v0.1.8");
      run({ finish: true }, s.env, t.exec); // a second --finish finds nothing pending
      expect(t.gh()).toHaveLength(3);
      expect(fs.readdirSync(built.out).sort()).toEqual([installerName("0.1.8"), installerName("0.1.8") + ".sig", "latest.json", "notes.md"]);
    } finally {
      s.done();
    }
  });

  // T-588 review: APP-059 skips a main that was already released. In CI's two steps the skip must
  // carry through --finish, which signs only what this --build-only built, never an older folder.
  it("in CI's two steps, an already-released main builds nothing, and --finish then signs and publishes nothing", () => {
    const s = scratch();
    try {
      const sha = git(s.origin, "rev-parse", "HEAD");
      const t = tools(s.checkout, { tagName: "v0.1.3", body: notesBody(["Agents start faster"], sha) });
      fs.mkdirSync(path.join(s.checkout + "-out", "v0.1.3"), { recursive: true }); // a build an earlier run published
      expect(() => run({ repo: s.origin, buildOnly: true }, s.env, t.exec)).not.toThrow();
      expect(() => run({ finish: true }, s.env, t.exec)).not.toThrow();
      expect(t.calls.map((c) => c.name)).toEqual(["gh"]);
      expect(t.gh().map((c) => c.args[1])).toEqual(["view"]);
    } finally {
      s.done();
    }
  });

  it("the signature check passes tauri signer's own signature and refuses other bytes, another version, an altered version or another key", () => {
    const s = scratch();
    try {
      const file = path.join(s.root, "setup.exe");
      fs.writeFileSync(file, "installer bytes");
      execFileSync(process.execPath, [TAURI_JS, "signer", "sign", "--app-version", "0.1.8", file], { env: { ...s.env, TAURI_SIGNING_PRIVATE_KEY: fs.readFileSync(s.key, "utf8").trim(), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "key-password" } });
      const sig = fs.readFileSync(file + ".sig", "utf8");
      const pub = fs.readFileSync(s.key + ".pub", "utf8");
      const bytes = Buffer.from("installer bytes");
      expect(() => verifySignature(bytes, sig, pub, "0.1.8")).not.toThrow();
      expect(() => verifySignature(Buffer.from("installer bytez"), sig, pub, "0.1.8")).toThrow(/does not cover this installer/);
      expect(() => verifySignature(bytes, sig, pub, "0.1.9")).toThrow(/not bound to version 0\.1\.9/);
      const forged = Buffer.from(Buffer.from(sig, "base64").toString("utf8").replace("version:0.1.8", "version:0.1.9")).toString("base64");
      expect(() => verifySignature(bytes, forged, pub, "0.1.9")).toThrow(/trusted comment was altered/);
      keypair(path.join(s.root, "other.key"));
      expect(() => verifySignature(bytes, sig, fs.readFileSync(path.join(s.root, "other.key.pub"), "utf8"), "0.1.8")).toThrow(/another key/);
    } finally {
      s.done();
    }
  });
});

// T-588 (X-proc.5): the workflows run no third-party code that can change under them, and the release
// job's signing key exists only in the step that signs.
describe("release and CI workflows hand secrets to as little code as possible", () => {
  const workflow = (f) => fs.readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), "utf8");
  it("every action is pinned to a full commit SHA, with its version beside it", () => {
    for (const f of ["ci.yml", "release.yml"]) {
      const uses = [...workflow(f).matchAll(/^\s*(?:- )?uses: (.+)$/gm)].map((m) => m[1]);
      expect(uses.length, f).toBeGreaterThan(0);
      for (const u of uses) expect(`${f}: ${u}`).toMatch(/^\S+: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # (v\d+(\.\d+)*|stable)$/);
    }
  });
  it("the build step holds no signing secret; the one step after it writes the key, signs, and deletes the key", () => {
    const steps = parse(workflow("release.yml")).jobs.release.steps;
    const build = steps.findIndex((s) => /scripts\/release\.mjs --build-only/.test(s.run ?? ""));
    const sign = steps.findIndex((s) => /scripts\/release\.mjs --finish/.test(s.run ?? ""));
    expect(build).toBeGreaterThan(-1);
    expect(sign).toBeGreaterThan(build);
    const keyed = steps.flatMap((s, i) => (/secrets\.KOLUX_RELEASE_KEY(_PASSWORD)? \}\}/.test(JSON.stringify(s.env ?? {})) ? [i] : []));
    expect(keyed).toEqual([sign]);
    expect(steps[sign].run).toMatch(/trap 'rm -f "\$KOLUX_RELEASE_KEY"' EXIT\n.*> "\$KOLUX_RELEASE_KEY"\n/);
  });
});

describe("CI gate (APP-060)", () => {
  const sha = "0123456789abcdef";
  it("passes only a green run for that commit", () => {
    expect(decide([{ status: "completed", conclusion: "success" }], sha, 0).verdict).toBe("pass");
    const r = decide([{ status: "completed", conclusion: "failure", url: "u" }], sha, 0);
    expect(r.verdict).toBe("refuse");
    expect(r.reason).toMatch(/0123456 ended "failure".*not published/);
  });
  it("waits up to 30 minutes for a queued or missing run, then refuses with the reason", () => {
    expect(decide([{ status: "queued" }], sha, WAIT_MS - 1).verdict).toBe("wait");
    expect(decide([], sha, 0).verdict).toBe("wait");
    expect(decide([{ status: "in_progress" }], sha, WAIT_MS).reason).toMatch(/still in_progress after 30 minutes/);
    expect(decide([], sha, WAIT_MS).verdict).toBe("refuse");
  });
});

describe("workflow check", () => {
  it("finds schema mistakes", () => {
    const bad = "name: x\non: [push]\njobs:\n  a:\n    needs: b\n    runs-on: ubuntu-latest\n    stepz: []\n";
    const errs = checkWorkflow(bad, "bad.yml");
    expect(errs.join("\n")).toMatch(/needs "b"/);
    expect(errs.join("\n")).toMatch(/unknown key "stepz"/);
    expect(checkWorkflow("name: [", "b.yml")[0]).toMatch(/not valid YAML/);
  });
  it("holds the shipped workflows to the four-shard and gate promises", () => {
    expect(checkPromises({ "ci.yml": { on: { push: {} }, jobs: { test: { strategy: { matrix: { shard: [1, 2] } } } } } }).join("\n")).toMatch(/shards 1, 2, 3 and 4/);
    const rel = { jobs: { r: { steps: [{ run: "node scripts/release.mjs" }, { run: "node scripts/ci-gate.mjs x" }] } } };
    expect(checkPromises({ "release.yml": rel }).join("\n")).toMatch(/gate must come before/);
  });
});

describe("ship options (APP-058)", () => {
  it("reads the 0.15.0 options", () => {
    const o = parseArgs(["--main", "--no-release", "--merge", "feat", "--dry-run", "--model", "sonnet", "--message", "Bump to 0.2.0"]);
    expect(o).toMatchObject({ main: true, release: false, merge: "feat", dryRun: true, model: "sonnet", message: "Bump to 0.2.0" });
    expect(parseArgs([]).model).toBe("haiku");
    expect(() => parseArgs(["--merge"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--model", "x & del"])).toThrow(/not a model id/);
    expect(() => parseArgs(["--rebase"])).toThrow(/unknown option/);
  });
});



