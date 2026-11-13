#!/usr/bin/env node
// `pnpm local`: try a change in minutes, on this PC alone. Built and started by hand, no installer, no
// signature, no GitHub, and it never shares settings or state with the Kolux you have installed.
//
// What it does, in order:
//   1. Builds the front end the normal way (tauri's beforeBuildCommand: `pnpm build`).
//   2. Rust: a release-profile build with the expensive parts switched off for a build nobody ships
//      (fat LTO and one codegen unit are what make the shipped build ~7x a debug build; measured
//      docs/dev-loop.md). Set from the environment, so Cargo.toml is untouched.
//   3. Merges a small config at build time: identifier com.txaisxiong.kolux.local and the name
//      "Kolux Local", so the local app keeps its own settings folder beside your installed one.
//   4. No bundling (`--no-bundle`) and no signing: no NSIS, no updater artifacts, no signature.
//   5. Starts the exe it just built.
//
// CARGO_TARGET_DIR: if KOLUX_TARGET_DIR is set, that folder is used for the build, so every checkout
// and worktree on this PC reuses one warm target (one build at a time - cargo holds a lock). Without
// it, the build lands in src-tauri/target as usual.
//
// Flags: --no-build  start the exe from the last build, build nothing.
//        --profile   print what this build turns off and what it costs on average, then stop.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(repo, "src-tauri");
const LOCAL_ID = "com.txaisxiong.kolux.local";
const LOCAL_NAME = "Kolux Local";
const args = new Set(process.argv.slice(2));
const isWindows = process.platform === "win32";
const user = process.env.USERNAME ?? process.env.USER ?? "you";

/** The config merged over tauri.conf.json for this build. Compiled in, so it must be here, not at launch.
 * Written to a temp file rather than passed inline: a shell on Windows eats the quotes in inline JSON. */
const configText = JSON.stringify({
  productName: LOCAL_NAME,
  identifier: LOCAL_ID,
  bundle: { active: false },
  app: { windows: [{ title: `${LOCAL_NAME} (local build)` }] },
});

/** The release profile, with the parts that only matter to a shipped binary turned off. */
const profile = {
  CARGO_PROFILE_RELEASE_LTO: "thin",
  CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "16",
  CARGO_PROFILE_RELEASE_OPT_LEVEL: "2",
  CARGO_PROFILE_RELEASE_STRIP: "false",
  CARGO_PROFILE_RELEASE_INCREMENTAL: "true",
};

const targetDir = process.env.KOLUX_TARGET_DIR ?? process.env.CARGO_TARGET_DIR ?? join(tauriDir, "target");
const exe = join(targetDir, "release", isWindows ? "kolux.exe" : "kolux");

const say = (s) => console.log(`local: ${s}`);

if (args.has("--profile")) {
  say("a local build is a release build with:");
  for (const [k, v] of Object.entries(profile)) say(`  ${k.replace("CARGO_PROFILE_RELEASE_", "").toLowerCase()} = ${v}`);
  say(`identifier ${LOCAL_ID} (its own settings folder), no bundle, no signature`);
  say(`target ${targetDir}`);
  say("measured cold and warm times: docs/dev-loop.md");
  process.exit(0);
}

say(`target ${targetDir}`);

if (!args.has("--no-build")) {
  const started = Date.now();
  const scratch = mkdtempSync(join(tmpdir(), "kolux-local-"));
  const confFile = join(scratch, "tauri.local.json");
  writeFileSync(confFile, configText);
  const build = spawnSync(
    "npx",
    ["tauri", "build", "--no-bundle", "--no-sign", "--ci", "--config", confFile],
    { cwd: repo, stdio: "inherit", shell: isWindows, windowsHide: true, env: { ...process.env, ...profile, CARGO_TARGET_DIR: targetDir } },
  );
  rmSync(scratch, { recursive: true, force: true });
  const secs = Math.round((Date.now() - started) / 1000);
  if (build.status !== 0) {
    say(`build failed after ${fmt(secs)} (exit ${build.status ?? "?"}); the output above says why`);
    process.exit(build.status ?? 1);
  }
  say(`built in ${fmt(secs)}`);
}

if (!existsSync(exe)) {
  say(`no build at ${exe} - run pnpm local without --no-build first`);
  process.exit(1);
}
say(`built ${new Date(statSync(exe).mtimeMs).toLocaleString()}`);
if (args.has("--no-launch")) process.exit(0);

// Started detached so the terminal comes back; the app keeps running on its own. windowsHide keeps the
// launcher from flashing a console window; the app draws its own window.
const child = spawn(exe, [], { detached: true, stdio: "ignore", cwd: repo, windowsHide: true });
child.unref();
say(`started ${exe}`);
say(`its settings: ${isWindows ? join(process.env.APPDATA ?? "", LOCAL_ID) : join("/Users", user, "Library/Application Support", LOCAL_ID)}`);
say("it sits beside your installed Kolux and shares nothing with it");
say("a change from now on: pnpm local again (only what changed rebuilds)");

function fmt(secs) {
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}
