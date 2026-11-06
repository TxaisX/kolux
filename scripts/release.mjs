// APP-059: the release job. Builds main in a checkout kept only for releases, one build at a time,
// gives it the next patch version, smoke-tests the result, signs the installer and publishes the
// installer, its signature and the update manifest (latest.json) with notes listing the shipped
// commits. `pnpm ship --main` starts it in the background; it can also be run by hand.
//
//   pnpm release [--dry-run] [--no-publish] [--repo <url>]
//
//   --dry-run      print the version, the notes and the steps; build and publish nothing
//   --no-publish   build, smoke-test and sign, then stop (the files stay in <checkout>-out)
//   --build-only   build and smoke-test, then stop before signing (release.yml's build step, T-588)
//   --finish       sign the build --build-only recorded in <checkout>-out, then publish it (release.yml's next step)
//
// Environment: KOLUX_RELEASE_CHECKOUT  the build checkout (default ~/.kolux-rs/release-checkout)
//              KOLUX_RELEASE_KEY       the signing key file, its public half beside it as .pub
//                                      (default ~/.kolux-rs/release-signing/kolux-rs.key)
//              KOLUX_RELEASE_KEY_PASSWORD  the key's password, when it has one
//              KOLUX_RELEASE_PUBLISH_DIR   publish into this folder instead of GitHub (rehearsal)
//              KOLUX_RELEASE_ALLOW_RED=1   publish even when CI for the commit is red (recovery only)
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decide, POLL_MS } from "./ci-gate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export const FEED_REPO = "TxaisX/kolux";
export const NOTES_MAX = 30;
export const STALE_MS = 3 * 60 * 60 * 1000;
const MARKER = /<!-- kolux-rs-source: ([0-9a-f]{7,40}) -->/;

export const checkoutDir = (env = process.env) => path.resolve(env.KOLUX_RELEASE_CHECKOUT || path.join(os.homedir(), ".kolux-rs", "release-checkout"));
export const logDir = (env = process.env) => checkoutDir(env) + "-logs";
const keyFile = (env) => path.resolve(env.KOLUX_RELEASE_KEY || path.join(os.homedir(), ".kolux-rs", "release-signing", "kolux-rs.key"));

// ------------------------------------------------------------------ pure rules (tested)

const parse = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? "").trim());
  return m ? m.slice(1).map(Number) : null;
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** One patch above whichever is higher: the project's version or the newest release. */
export function nextVersion(projectVersion, latestTag) {
  const p = parse(projectVersion);
  if (!p) throw new Error(`the project version "${projectVersion}" is not x.y.z`);
  const l = parse(latestTag);
  const base = l && cmp(l, p) > 0 ? l : p;
  return `${base[0]}.${base[1]}.${base[2] + 1}`;
}

/** The release notes: each commit subject since the last release, 30 at most, then the hidden marker. */
export function notesBody(subjects, sha) {
  const lines = subjects.filter((s) => s.trim()).slice(0, NOTES_MAX).map((s) => `- ${s.trim()}`);
  return `${lines.join("\n")}\n\n<!-- kolux-rs-source: ${sha} -->\n`;
}
export const markerOf = (body) => MARKER.exec(body ?? "")?.[1] ?? null;

/** A build lock older than three hours, or held by a process that has died, is stale. */
export const isStale = (lock, now, alive) => !lock || now - lock.at > STALE_MS || !alive(lock.pid);

export function manifest(version, notes, signature, url, now = new Date()) {
  return { version, notes, pub_date: now.toISOString(), platforms: { "windows-x86_64": { signature, url } } };
}
/** APP-061: the packaged command line reports the release version and its help works. `cli` runs it
 *  with the given words and returns what it printed; a mismatch throws, which stops the release. */
export function smokeCli(cli, version) {
  const said = cli(["--version"]);
  if (said !== version) throw new Error(`smoke test: kolux --version says ${said}, the release is ${version}`);
  const help = cli(["--help"]);
  if (!help.includes("--version") || !help.includes("worktree")) throw new Error("smoke test: kolux --help did not print the command list");
}

/** APP-061: the packaged CLI carries an old-name profile into a throwaway one. `cli(words, env)` runs it;
 *  `root` is an empty scratch folder that gets a Nightshift folder and the throwaway profile beside it.
 *  Carried: a listed setting, and one under its old name; refused: a secret-like one. */
export function smokeMigration(cli, root) {
  const old = path.join(root, "Nightshift");
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, "settings.json"), JSON.stringify({ uiLook: "new", nightshiftLanguage: "fr", nightshiftGithubToken: "smoke-secret" }));
  const profile = path.join(root, "kolux.smoke");
  const said = JSON.parse(cli(["profile", "migrate", "--json"], { KOLUX_USER_DATA_PATH: profile }));
  const added = (said.result ?? said).added ?? [];
  if (!added.includes("uiLook") || !added.includes("language")) throw new Error(`smoke test: the old-profile migration carried ${JSON.stringify(added)}, not uiLook and language`);
  if (added.length !== 2) throw new Error(`smoke test: the old-profile migration carried more than the allow-list: ${JSON.stringify(added)}`);
}

export const installerName = (version) => `Kolux RS_${version}_x64-setup.exe`;
// GitHub stores an uploaded asset with each space turned into a dot, so the link names it that way.
export const downloadUrl = (version) => `https://github.com/${FEED_REPO}/releases/download/v${version}/${installerName(version).replaceAll(" ", ".")}`;
export const isGitHub = (repo) => /^(https:\/\/github\.com\/|git@github\.com:)/.test(repo ?? "");
/** DT-R11: gh runs only for a GitHub origin or inside GitHub Actions, whose release.yml builds from a local path. */
export const onGitHub = (repo, env) => isGitHub(repo) || env.GITHUB_ACTIONS === "true";

/** T-588: the check `tauri build` made when it signed, and the updater repeats before it installs: the
 *  signature (minisign, base64, as tauri signer writes it) is the release key's, covers these bytes,
 *  and its signed comment names this version (requireSignedVersion). Throws the reason otherwise. */
export function verifySignature(data, signature, pubkey, version) {
  const box = (b64) => Buffer.from(b64.trim(), "base64").toString("utf8").split(/\r?\n/);
  const pk = Buffer.from(box(pubkey)[1] ?? "", "base64"); // "Ed", key id (8 bytes), public key (32)
  const [, line = "", comment = "", global = ""] = box(signature);
  const sig = Buffer.from(line, "base64"); // "ED" (the file is hashed first), key id, signature (64)
  const trusted = comment.replace(/^trusted comment: /, "");
  const fail = (why) => {
    throw new Error(`release signature: ${why}; installed copies would refuse this update`);
  };
  if (pk.length !== 42 || sig.length !== 74 || sig.subarray(0, 2).toString() !== "ED") fail("not a minisign signature and key");
  if (!sig.subarray(2, 10).equals(pk.subarray(2, 10))) fail("made with another key than the public key the app carries");
  const key = crypto.createPublicKey({ format: "jwk", key: { kty: "OKP", crv: "Ed25519", x: pk.subarray(10).toString("base64url") } });
  if (!crypto.verify(null, crypto.createHash("blake2b512").update(data).digest(), key, sig.subarray(10))) fail("does not cover this installer");
  if (!crypto.verify(null, Buffer.concat([sig.subarray(10), Buffer.from(trusted)]), key, Buffer.from(global, "base64"))) fail("its trusted comment was altered");
  if (!trusted.split("\t").includes(`version:${version}`)) fail(`not bound to version ${version}`);
}

/** Picks the newest `v<x.y.z>` folder of a rehearsal publish folder. */
export function newestTag(names) {
  return names.filter((n) => parse(n)).sort((a, b) => cmp(parse(b), parse(a)))[0] ?? null;
}

// ------------------------------------------------------------------ the lock and the queue

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

/** Takes the build lock, or leaves a queue mark for the build that holds it. */
export function acquire(dir, { now = Date.now(), pid = process.pid, isAlive = alive } = {}) {
  const lockPath = dir + ".lock";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lockPath, JSON.stringify({ pid, at: now }), { flag: "wx" });
      return "locked";
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let lock = null;
      try {
        lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      } catch {
        /* unreadable counts as stale */
      }
      if (!isStale(lock, now, isAlive)) {
        // One more build from the newest main, however many ships land meanwhile.
        fs.writeFileSync(dir + ".queued", String(now));
        // ponytail: the holder may have finished between our two looks; a few-ms window, rerun the job if it ever bites.
        if (fs.existsSync(lockPath)) return "queued";
      }
      fs.rmSync(lockPath, { force: true });
    }
  }
  return "queued";
}
/** True (and the mark is cleared) when a ship landed during the build. */
export function takeQueued(dir) {
  try {
    fs.rmSync(dir + ".queued");
    return true;
  } catch {
    return false;
  }
}
/** Removes the lock only when `pid` owns it: a failed build must never unlock the run that replaced it. */
export const unlock = (dir, pid = process.pid) => {
  let owner;
  try {
    owner = JSON.parse(fs.readFileSync(dir + ".lock", "utf8")).pid;
  } catch {
    return; // already gone, or not provably this build's
  }
  if (owner === pid) fs.rmSync(dir + ".lock", { force: true });
};

// ------------------------------------------------------------------ the job

const say = (...a) => console.log(new Date().toISOString(), ...a);

// T-588 (X-proc.5): who holds which secret. The build (pnpm install, the CLI's cargo build, tauri build:
// every dependency's install and build scripts) and the packaged CLI get none; the gh release calls get
// the token; tauri signer alone gets the private key and its password.
const TOKENS = /^(GH|GITHUB|GH_ENTERPRISE|GITHUB_ENTERPRISE)_TOKEN$/i;
const KEYS = /^(KOLUX_RELEASE_KEY(_PASSWORD)?|TAURI(_SIGNING)?_PRIVATE_KEY(_PATH|_PASSWORD)?)$/i;
const without = (env, ...secrets) => Object.fromEntries(Object.entries(env).filter(([k]) => !secrets.some((s) => s.test(k))));
const buildEnv = (env) => without(env, TOKENS, KEYS);
const ghEnv = (env) => without(env, KEYS);

/** Runs a program and returns what it printed; a failure throws. buildOnce and finish take another runner in tests. */
function sh(cmd, args, opts = {}) {
  // pnpm and cargo are .cmd shims on Windows (opts.shim), which only start through the shell; every
  // argument here is ours. One command string, so node does not warn about unescaped arguments.
  const shell = !!opts.shim && process.platform === "win32";
  if (shell) [cmd, args] = [[cmd, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" "), []];
  const r = spawnSync(cmd, args, { encoding: "utf8", shell, cwd: opts.cwd, env: opts.env ?? process.env, maxBuffer: 1 << 28 });
  if (opts.echo) process.stdout.write((r.stdout || "") + (r.stderr || ""));
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status ?? r.error?.message}):\n${(r.stderr || r.stdout || "").trim().slice(-2000)}`);
  return (r.stdout || "").trim();
}
const git = (dir, ...args) => sh("git", ["-C", dir, ...args]);

/**
 * APP-060: the same gate the workflow runs, for the local path. The workflow refused a red commit
 * and the hand-run path did not, which is how 0.1.4 was published over a failing CI. A rehearsal
 * (KOLUX_RELEASE_PUBLISH_DIR) writes to a local folder and is exempt; the only way past the gate
 * for the real feed is the explicit KOLUX_RELEASE_ALLOW_RED=1, which says so loudly.
 */
export function requireGreenCi(sha, env = process.env, exec = sh) {
  if (env.KOLUX_RELEASE_PUBLISH_DIR) return;
  if (env.KOLUX_RELEASE_ALLOW_RED === "1") {
    say("WARNING: KOLUX_RELEASE_ALLOW_RED=1 is set, so the CI gate is skipped. Use this only to recover a build already known good.");
    return;
  }
  const start = Date.now();
  for (;;) {
    let runs;
    try {
      runs = JSON.parse(exec("gh", ["run", "list", "--workflow", "ci.yml", "--commit", sha, "--json", "status,conclusion,url", "--limit", "20"], { env: ghEnv(env) }) || "[]");
    } catch (e) {
      throw new Error(`could not ask GitHub whether CI passed for ${sha.slice(0, 7)}: ${e.message}. Nothing was published.`);
    }
    const d = decide(runs, sha, Date.now() - start);
    say(`CI gate: ${d.reason}`);
    if (d.verdict === "pass") return;
    if (d.verdict === "refuse") throw new Error(d.reason);
    sleepSync(POLL_MS);
  }
}

function latestRelease(env, repo, exec) {
  if (env.KOLUX_RELEASE_PUBLISH_DIR) {
    const pub = path.resolve(env.KOLUX_RELEASE_PUBLISH_DIR);
    const tag = fs.existsSync(pub) ? newestTag(fs.readdirSync(pub)) : null;
    return tag ? { tag, body: fs.readFileSync(path.join(pub, tag, "notes.md"), "utf8") } : null;
  }
  if (!onGitHub(repo, env)) return null;
  let out;
  try {
    out = exec("gh", ["release", "view", "--repo", FEED_REPO, "--json", "tagName,body"], { env: ghEnv(env) });
  } catch {
    return null; // no release yet
  }
  const j = JSON.parse(out);
  return { tag: j.tagName, body: j.body };
}

function setVersion(dir, version) {
  const edit = (f, fn) => fs.writeFileSync(path.join(dir, f), fn(fs.readFileSync(path.join(dir, f), "utf8")));
  edit("package.json", (s) => s.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`));
  edit("src-tauri/tauri.conf.json", (s) => s.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`));
  edit("src-tauri/Cargo.toml", (s) => s.replace(/^version = "[^"]*"/m, `version = "${version}"`));
}

export function buildOnce(o, env = process.env, exec = sh) {
  let dir = checkoutDir(env);
  if (o.buildOnly) fs.rmSync(pendingFile(env), { force: true }); // --finish acts only on what this run builds
  // 1. The checkout kept only for releases, at the newest main.
  if (!fs.existsSync(path.join(dir, ".git"))) {
    if (!o.repo) throw new Error(`no build checkout at ${dir} and no --repo to clone it from`);
    say(`cloning ${o.repo} into ${dir}`);
    sh("git", ["clone", "-q", o.repo, dir]);
  } else {
    if (o.repo) git(dir, "remote", "set-url", "origin", o.repo);
    git(dir, "fetch", "-q", "--prune", "origin");
  }
  // A checkout reached through a junction (the usual home folder on this PC) makes Tauri read the
  // resource keys as `/Users/...` and fail the build. Use the real folder after the clone or fetch.
  dir = fs.realpathSync(dir);
  const repo = o.repo || git(dir, "remote", "get-url", "origin");
  const sha = git(dir, "rev-parse", "origin/main");
  const latest = latestRelease(env, repo, exec);
  if (latest && markerOf(latest.body) === sha) {
    say(`main ${sha.slice(0, 7)} was already released as ${latest.tag}; nothing to do`);
    return null;
  }
  git(dir, "checkout", "-q", "--force", "--detach", sha);
  git(dir, "clean", "-q", "-fdx", "-e", "node_modules", "-e", "src-tauri/target");

  // 2. Version and notes.
  const projectVersion = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
  const version = nextVersion(projectVersion, latest?.tag);
  const prev = markerOf(latest?.body);
  const known = prev && spawnSync("git", ["-C", dir, "merge-base", "--is-ancestor", prev, sha]).status === 0;
  const range = known ? [`${prev}..${sha}`] : [sha, "-n", String(NOTES_MAX)];
  const subjects = git(dir, "log", "--no-merges", "--format=%s", ...range).split("\n");
  const notes = notesBody(subjects, sha);
  say(`release ${version} from main ${sha.slice(0, 7)} (project ${projectVersion}, newest release ${latest?.tag ?? "none"})`);
  console.log(notes);
  if (o.dryRun) {
    say(`dry run: would set version ${version}, run pnpm install and pnpm tauri build --bundles nsis with no secret in reach, smoke-test, sign with tauri signer and ${keyFile(env)}, then publish ${installerName(version)}, its .sig and latest.json to ${env.KOLUX_RELEASE_PUBLISH_DIR ? path.resolve(env.KOLUX_RELEASE_PUBLISH_DIR) : FEED_REPO}`);
    return { version, sha, notes, dryRun: true };
  }

  // APP-060: refuse a red commit before spending twenty minutes on the build.
  requireGreenCi(sha, env, exec);

  // 3. Build. It needs only the key's public half, which the app carries; the private half is checked
  // up front unless a later step brings it (--build-only).
  const key = keyFile(env);
  if (!fs.existsSync(key + ".pub") || (!o.buildOnly && !fs.existsSync(key))) throw new Error(`no signing key at ${key} (and ${key}.pub). Make one once with: pnpm tauri signer generate -w "${key}"`);
  const pubkey = fs.readFileSync(key + ".pub", "utf8").trim();
  setVersion(dir, version);
  const conf = path.join(dir, "src-tauri", "release.conf.json");
  const target = path.resolve(env.CARGO_TARGET_DIR || path.join(dir, "src-tauri", "target"), "release");
  // CLI-006: the installer carries the command line and its kolux.cmd shim in a bin folder of the install.
  const resources = { [path.join(dir, "src-tauri", "cli", "kolux.cmd").replaceAll("\\", "/")]: "bin/kolux.cmd", [path.join(target, "kolux.exe").replaceAll("\\", "/")]: "bin/kolux.exe" };
  fs.writeFileSync(conf, JSON.stringify({ bundle: { resources }, plugins: { updater: { pubkey } } }));
  const benv = { ...buildEnv(env), KOLUX_RS_RELEASE_PUBKEY: pubkey };
  say("installing packages");
  exec("pnpm", ["install", "--frozen-lockfile"], { cwd: dir, env: benv, shim: true });
  say("building the command line, then the Windows installer that carries it");
  exec("cargo", ["build", "--release", "--features", "release-cli", "--bin", "kolux"], { cwd: path.join(dir, "src-tauri"), env: benv, shim: true });
  exec("pnpm", ["tauri", "build", "--bundles", "nsis", "--config", conf], { cwd: dir, env: benv, echo: true, shim: true });

  // 4. Smoke test: the installer is there, and the CLI and the app agree on the version.
  const exe = path.join(target, "bundle", "nsis", installerName(version));
  if (!fs.existsSync(exe) || fs.statSync(exe).size < 1 << 20) throw new Error(`smoke test: no installer at ${exe}`);
  const kolux = (words, extra) => exec(path.join(target, "kolux.exe"), words, { env: { ...buildEnv(env), ...extra } });
  smokeCli(kolux, version);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "kolux-migrate-smoke-"));
  try { smokeMigration(kolux, scratch); } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  const appVersion = JSON.parse(fs.readFileSync(path.join(dir, "src-tauri", "tauri.conf.json"), "utf8")).version;
  if (appVersion !== version) throw new Error(`smoke test: the app says ${appVersion}, the release is ${version}`);
  const out = path.join(dir + "-out", `v${version}`);
  fs.rmSync(out, { recursive: true, force: true }); // never a signature or manifest left from an earlier try
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(exe, path.join(out, installerName(version)));
  fs.writeFileSync(path.join(out, "notes.md"), notes);
  say(`smoke test passed: the installer, kolux --version, --help and the old-profile migration all say ${version}`);
  if (o.buildOnly) {
    fs.writeFileSync(pendingFile(env), `v${version}\n`);
    say(`built ${version}, not signed; release.mjs --finish signs and publishes it (the files are in ${out})`);
    return { version, sha, notes, out, signed: false };
  }
  return finish(o, env, exec, out);
}

/** T-588: the note --build-only leaves in <checkout>-out naming the build it made, and removes when it
 *  built nothing (APP-059's skip); --finish signs that build and no other. */
const pendingFile = (env) => path.join(checkoutDir(env) + "-out", "pending");
function pendingBuild(env) {
  const f = pendingFile(env);
  return fs.existsSync(f) ? path.join(path.dirname(f), fs.readFileSync(f, "utf8").trim()) : null;
}

/** 5-6. Signs a build (its folder in <checkout>-out), checks the signature, writes the update manifest
 *  and publishes the installer, its signature and the manifest. */
export function finish(o, env, exec, out) {
  const version = path.basename(out).slice(1);
  const exe = path.join(out, installerName(version));
  const notes = fs.readFileSync(path.join(out, "notes.md"), "utf8");
  const sha = markerOf(notes);

  // 5. Sign. The locked tauri CLI starts straight from the checkout's node_modules (no package manager
  // in between, so nothing else sees the key); --app-version binds the version (requireSignedVersion).
  const key = keyFile(env);
  if (!fs.existsSync(key)) throw new Error(`no signing key at ${key}`);
  const tauri = path.join(checkoutDir(env), "node_modules", "@tauri-apps", "cli", "tauri.js");
  const senv = { ...buildEnv(env), TAURI_SIGNING_PRIVATE_KEY: fs.readFileSync(key, "utf8").trim(), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: env.KOLUX_RELEASE_KEY_PASSWORD ?? "" };
  exec(process.execPath, [tauri, "signer", "sign", "--app-version", version, exe], { env: senv });
  const signature = fs.readFileSync(exe + ".sig", "utf8").trim();
  verifySignature(fs.readFileSync(exe), signature, fs.readFileSync(key + ".pub", "utf8"), version);
  fs.writeFileSync(path.join(out, "latest.json"), JSON.stringify(manifest(version, notes, signature, downloadUrl(version)), null, 2));
  say(`signed ${version}; the signature checks out against the public key the app carries`);
  if (o.noPublish) {
    say(`built ${version}, not published; the files are in ${out}`);
    return { version, sha, notes, out, published: false };
  }

  // 6. Publish: the installer, its signature and the manifest.
  if (env.KOLUX_RELEASE_PUBLISH_DIR) {
    const pub = path.resolve(env.KOLUX_RELEASE_PUBLISH_DIR);
    fs.cpSync(out, path.join(pub, `v${version}`), { recursive: true });
    fs.copyFileSync(path.join(out, "latest.json"), path.join(pub, "latest.json"));
    say(`published ${version} to the folder ${pub}`);
  } else {
    const repo = o.repo || git(checkoutDir(env), "remote", "get-url", "origin");
    if (!onGitHub(repo, env)) throw new Error(`the source repository ${repo} is not on GitHub, so nothing is published; set KOLUX_RELEASE_PUBLISH_DIR to rehearse`);
    // APP-060: check again at the moment of publishing, so a --finish hours later cannot slip past a
    // gate that was green when the build started.
    requireGreenCi(sha, env, exec);
    // APP-031: the manifest goes up last, so a release is never announced before its installer is there.
    const files = [installerName(version), installerName(version) + ".sig"].map((f) => path.join(out, f));
    exec("gh", ["release", "create", `v${version}`, "--target", sha, "--repo", FEED_REPO, "--title", `Kolux ${version}`, "--notes-file", path.join(out, "notes.md"), ...files], { env: ghEnv(env) });
    exec("gh", ["release", "upload", `v${version}`, "--repo", FEED_REPO, path.join(out, "latest.json")], { env: ghEnv(env) });
    say(`published ${version} to ${FEED_REPO}`);
  }
  return { version, sha, notes, out, published: true };
}

export function run(o, env = process.env, exec = sh) {
  const dir = checkoutDir(env);
  if (o.dryRun) return void buildOnce(o, env, exec);
  if (o.finish) {
    // release.yml's step after --build-only; the build already ran, or there was nothing to build
    const out = pendingBuild(env);
    if (!out) return void say("nothing was built, nothing to sign");
    finish(o, env, exec, out);
    return void fs.rmSync(pendingFile(env), { force: true }); // signed and handed on: a second --finish does nothing
  }
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  if (acquire(dir) === "queued") return void say("a release build is running; one more build from the newest main is queued after it");
  try {
    do buildOnce(o, env, exec);
    while (takeQueued(dir) && (say("a ship landed during the build; building again from the newest main"), true));
  } finally {
    unlock(dir);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const a = process.argv.slice(2);
  const o = { dryRun: a.includes("--dry-run"), noPublish: a.includes("--no-publish"), buildOnly: a.includes("--build-only"), finish: a.includes("--finish"), repo: a.includes("--repo") ? a[a.indexOf("--repo") + 1] : null };
  try {
    run(o);
  } catch (e) {
    // The failure goes to the log; the ship that started this job has already succeeded.
    say(`release failed: ${e.message}`);
    process.exit(1);
  }
}

