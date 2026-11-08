// T-785: the update proof rig. It proves the updater on a SCRATCH identity, never on the installed Kolux:
// its own product name and identifier, its own throwaway minisign key, its own install folder and a feed
// served from this process on the loopback address. Nothing here reads the real profile, the real install
// or the release signing key, and nothing is published.
//
//   node scripts/prove/update-rig.mjs key                       make the scratch signing key (once)
//   node scripts/prove/update-rig.mjs build <identity> <version> build and sign one installer, e.g. proof-rs 0.1.0
//   node scripts/prove/update-rig.mjs prove-785                 D-2, D-3, D-4 and the refusals on proof-rs 0.1.0 -> 0.1.1
//   node scripts/prove/update-rig.mjs clean                     uninstall the scratch install and remove its profiles
//
// Identities (the real pair they stand in for is in parentheses; T-790 moves the first to the second):
//   proof-rs  "Kolux Proof RS"  com.txaisxiong.kolux-proof-rs   (Kolux RS / com.txaisxiong.kolux-rs, 0.1.10)
//   proof     "Kolux Proof"     com.txaisxiong.kolux-proof      (Kolux / com.txaisxiong.kolux, 0.1.11)
//
// Everything lives under G:\Temp\ready-identity-rig (RIG_BASE overrides it). The app's own profile is placed
// by Windows' known folders, so it lands at %APPDATA%\<scratch identifier>; `clean` removes those two scratch
// identifiers' folders and nothing else. The installer puts <install>\bin on the user's PATH the way the real
// one does; the uninstaller (run by `clean`) takes that entry off again.
//
// A release build reads its feed address at build time (update.rs RELEASE_ENDPOINT, KOLUX_RS_RELEASE_ENDPOINT),
// so the installers built here point at http://127.0.0.1:<RIG_PORT>/latest.json and carry the scratch public key.
import { execFile, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const BASE = process.env.RIG_BASE || "G:\\Temp\\ready-identity-rig";
export const PORT = Number(process.env.RIG_PORT || 9377); // the feed
const CDP = Number(process.env.RIG_CDP || 9378); // the app's WebView2 debugging port
export const KEY = join(BASE, "key", "proof.key");
export const INSTALL = join(BASE, "install");
const HOME = join(BASE, "home");
const LOGS = join(BASE, "logs");
export const IDENTITIES = {
  "proof-rs": { productName: "Kolux Proof RS", identifier: "com.txaisxiong.kolux-proof-rs", exe: "kolux-rs.exe" },
  proof: { productName: "Kolux Proof", identifier: "com.txaisxiong.kolux-proof", exe: "kolux.exe" },
};
const isMain = !!process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = [];
export function log(...a) {
  const s = `${new Date().toISOString().slice(11, 19)} ${a.join(" ")}`;
  console.log(s);
  lines.push(s);
}
export const evidence = () => lines.join("\n");

// ---------- processes ----------
const sh = (cmd, args, opt = {}) => {
  // pnpm and cargo are .cmd shims on Windows; one command string, every argument is ours.
  const shell = !!opt.shim;
  if (shell) [cmd, args] = [[cmd, ...args].map((a) => (/\s/.test(a) || a === "" ? `"${a}"` : a)).join(" "), []];
  const r = spawnSync(cmd, args, { encoding: "utf8", shell, cwd: opt.cwd, env: opt.env ?? process.env, stdio: opt.echo ? "inherit" : "pipe", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}): ${(r.stderr || "").slice(-2000)}`);
  return (r.stdout || "").trim();
};
const ps = (script) => sh("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
export const fileVersion = (exe) => (existsSync(exe) ? ps(`(Get-Item '${exe}').VersionInfo.ProductVersion`) : null);
/** Processes of `name` whose image sits under `dir`: [{pid, path}]. */
function running(name, dir) {
  const out = ps(`Get-CimInstance Win32_Process -Filter "Name='${name}'" | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }`);
  return out.split(/\r?\n/).filter(Boolean).map((l) => ({ pid: Number(l.split("|")[0]), path: l.split("|")[1] || "" })).filter((p) => !dir || p.path.toLowerCase().startsWith(dir.toLowerCase()));
}
const alive = (pid) => ps(`if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }`) === "yes";

// Secrets never reach a build or the app: token-like variables go, as do the real agent homes.
function cleanEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/TOKEN|SECRET|PASSWORD|API_KEY|AUTH/i.test(k)) continue;
    if (k.startsWith("KOLUX_") || k.startsWith("CLAUDE_") || k === "CLAUDECODE" || k === "CODEX_HOME" || k.startsWith("TAURI_SIGNING")) continue;
    env[k] = v;
  }
  env.PATH = `${env.PATH};${join(process.env.USERPROFILE, ".cargo", "bin")}`;
  return { ...env, ...extra };
}

// ---------- key ----------
export function makeKey() {
  mkdirSync(dirname(KEY), { recursive: true });
  if (existsSync(KEY) && existsSync(KEY + ".pub")) return log(`key: already at ${KEY}`);
  sh("pnpm", ["tauri", "signer", "generate", "-w", KEY, "-p", "", "--ci", "-f"], { cwd: ROOT, shim: true, env: cleanEnv() });
  // A second key signs the wrong-key installer of the refusal case.
  sh("pnpm", ["tauri", "signer", "generate", "-w", KEY + ".other", "-p", "", "--ci", "-f"], { cwd: ROOT, shim: true, env: cleanEnv() });
  log(`key: scratch minisign key made at ${KEY} (+ .pub, + .other for the wrong-key case)`);
}
const pubkey = () => readFileSync(KEY + ".pub", "utf8").trim();

// ---------- build ----------
export const installerName = (id, version) => `${IDENTITIES[id].productName}_${version}_x64-setup.exe`;
export const built = (id, version) => join(BASE, "build", installerName(id, version));

/** Builds one scratch-identity installer with the scratch key and the loopback feed, signs it, and keeps
 *  installer + .sig (+ .wrong.sig, made with the other key) under BASE/build. */
export function build(id, version) {
  const ident = IDENTITIES[id];
  if (!ident) throw new Error(`unknown identity ${id}; one of ${Object.keys(IDENTITIES).join(", ")}`);
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`bad version ${version}`);
  mkdirSync(join(BASE, "build"), { recursive: true });
  const target = join(ROOT, "src-tauri", "target", "release");
  const slash = (p) => p.replaceAll("\\", "/");
  // The same shape as scripts/release.mjs: the CLI and its shim ride along in bin/, the key is the scratch one.
  const resources = { [slash(join(ROOT, "src-tauri", "cli", "kolux.cmd"))]: "bin/kolux.cmd", [slash(join(target, "kolux.exe"))]: "bin/kolux.exe" };
  const conf = join(BASE, "build", `${id}-${version}.conf.json`);
  writeFileSync(conf, JSON.stringify({ version, productName: ident.productName, identifier: ident.identifier, bundle: { resources }, plugins: { updater: { pubkey: pubkey(), dangerousInsecureTransportProtocol: true } } }, null, 2));
  const env = cleanEnv({ KOLUX_RS_RELEASE_PUBKEY: pubkey(), KOLUX_RS_RELEASE_ENDPOINT: `http://127.0.0.1:${PORT}/latest.json`, CARGO_BUILD_JOBS: "4" });
  log(`build: ${ident.productName} ${version} (${ident.identifier}), feed http://127.0.0.1:${PORT}/latest.json`);
  if (!existsSync(join(target, "kolux.exe"))) sh("cargo", ["build", "--release", "--features", "release-cli", "--bin", "kolux"], { cwd: join(ROOT, "src-tauri"), env, shim: true, echo: true });
  sh("pnpm", ["tauri", "build", "--bundles", "nsis", "--config", conf], { cwd: ROOT, env, shim: true, echo: true });
  const from = join(target, "bundle", "nsis", installerName(id, version));
  if (!existsSync(from) || statSync(from).size < 1 << 20) throw new Error(`no installer at ${from}`);
  const to = built(id, version);
  copyFileSync(from, to);
  const sign = (key, out) => {
    sh("pnpm", ["tauri", "signer", "sign", "-f", key, "-p", "", "--app-version", version, to], { cwd: ROOT, shim: true, env: cleanEnv() });
    if (out !== to + ".sig") copyFileSync(to + ".sig", out);
  };
  sign(KEY + ".other", to + ".wrong.sig"); // first, so the real signature is the one left at <installer>.sig
  sign(KEY, to + ".sig");
  log(`build: ${to} (${statSync(to).size} bytes), signed; version resource says ${fileVersion(to)}`);
  return to;
}

// ---------- feed ----------
/** The feed on 127.0.0.1:PORT. `serving` names the identity and version offered; `mode` shapes the download:
 *  "ok", "truncate" (the connection drops mid-file, the length header promised the whole file),
 *  "short" (a cut-down file sent whole) or "wrongkey" (a manifest signature made with the other key). */
export function feed() {
  const state = { id: "proof-rs", version: null, mode: "ok", hits: [] };
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    state.hits.push(`${req.method} ${url}`);
    if (!state.version) return void (res.statusCode = 404, res.end());
    const exe = built(state.id, state.version);
    if (url === "/latest.json") {
      const sig = readFileSync(exe + (state.mode === "wrongkey" ? ".wrong.sig" : ".sig"), "utf8").trim();
      const body = JSON.stringify({ version: state.version, notes: `Proof release ${state.version} (T-785 rig)`, pub_date: new Date().toISOString(), platforms: { "windows-x86_64": { signature: sig, url: `http://127.0.0.1:${PORT}/${encodeURIComponent(installerName(state.id, state.version))}` } } });
      res.setHeader("content-type", "application/json");
      return void res.end(body);
    }
    if (url === `/${installerName(state.id, state.version)}`) {
      const bytes = readFileSync(exe);
      res.setHeader("content-type", "application/octet-stream");
      if (req.method === "HEAD") return void (res.setHeader("content-length", bytes.length), res.end());
      if (state.mode === "truncate") {
        res.setHeader("content-length", bytes.length);
        res.write(bytes.subarray(0, Math.floor(bytes.length * 0.4)));
        return void setTimeout(() => res.destroy(), 200);
      }
      const out = state.mode === "short" ? bytes.subarray(0, Math.floor(bytes.length * 0.4)) : bytes;
      res.setHeader("content-length", out.length);
      return void res.end(out);
    }
    res.statusCode = 404;
    res.end();
  });
  return { state, start: () => new Promise((r) => server.listen(PORT, "127.0.0.1", r)), stop: () => new Promise((r) => server.close(r)) };
}

// ---------- install ----------
export function install(id, version) {
  const exe = built(id, version);
  if (!existsSync(exe)) throw new Error(`build it first: ${exe}`);
  mkdirSync(INSTALL, { recursive: true });
  // /P passive, /NS no shortcut, /D= the install folder (must be last, unquoted: the path has no spaces).
  const r = spawnSync(exe, ["/P", "/NS", `/D=${INSTALL}`], { stdio: "ignore" });
  const app = join(INSTALL, IDENTITIES[id].exe);
  if (r.status !== 0 || !existsSync(app)) throw new Error(`install of ${exe} failed (${r.status}); ${app} ${existsSync(app) ? "exists" : "missing"}`);
  log(`install: ${installerName(id, version)} -> ${INSTALL}; ${IDENTITIES[id].exe} version ${fileVersion(app)}`);
}
export function uninstall({ keepData = true } = {}) {
  const un = join(INSTALL, "uninstall.exe");
  if (!existsSync(un)) return log("uninstall: nothing installed");
  // /UPDATE keeps the app's data (the template deletes it only outside update mode and only on request).
  const r = spawnSync(un, ["/P", ...(keepData ? ["/UPDATE"] : []), `_?=${INSTALL}`], { stdio: "ignore" });
  log(`uninstall: exit ${r.status}; install folder ${existsSync(join(INSTALL, "uninstall.exe")) ? "still has uninstall.exe" : "emptied"}`);
}

// ---------- the app ----------
/** Profile folders a scratch identity could use: Windows' roaming folder (where Tauri puts app data) and the
 *  scratch home's copy of it. `clean` removes both; a run reports which one filled. */
export function profileDirs(id) {
  const ident = IDENTITIES[id].identifier;
  return [join(process.env.APPDATA, ident), join(HOME, "AppData", "Roaming", ident)];
}
export function localDirs(id) {
  const ident = IDENTITIES[id].identifier;
  return [join(process.env.LOCALAPPDATA, ident), join(HOME, "AppData", "Local", ident)];
}
export function freshProfile(id) {
  for (const d of [...profileDirs(id), ...localDirs(id)]) rmSync(d, { recursive: true, force: true });
  for (const d of profileDirs(id)) {
    mkdirSync(d, { recursive: true });
    // The smoke settings: a close with running shells asks nothing (the proof quits the app the ordinary way).
    writeFileSync(join(d, "settings.json"), JSON.stringify({ confirmCloseRunning: false, agentStatusHooks: true }, null, 2));
  }
}
function scratchHome() {
  const claude = join(HOME, "claude-config");
  const codex = join(HOME, "codex-home");
  const tmp = join(BASE, "tmp");
  for (const d of [join(HOME, "AppData", "Roaming"), join(HOME, "AppData", "Local"), claude, codex, tmp]) mkdirSync(d, { recursive: true });
  for (const d of [claude, codex]) writeFileSync(join(d, ".kolux-rs-scratch"), "T-785 update rig scratch home; never a real agent home\n");
  return { claude, codex, tmp };
}
export function appEnv() {
  const { claude, codex, tmp } = scratchHome();
  return cleanEnv({
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP}`,
    USERPROFILE: HOME,
    HOME,
    APPDATA: join(HOME, "AppData", "Roaming"),
    LOCALAPPDATA: join(HOME, "AppData", "Local"),
    TEMP: tmp,
    TMP: tmp,
    CLAUDE_CONFIG_DIR: claude,
    CODEX_HOME: codex,
    KOLUX_KEYBINDINGS_HOME: HOME,
  });
}

export function launch(id) {
  const exe = join(INSTALL, IDENTITIES[id].exe);
  mkdirSync(LOGS, { recursive: true });
  const child = spawn(exe, [], { cwd: INSTALL, env: appEnv(), detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  log(`launch: ${exe} pid ${child.pid}`);
  return child.pid;
}

export async function waitFor(what, probe, ms = 30000, every = 300) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try {
      last = await probe();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}${last instanceof Error ? ` (${last.message})` : ""}`);
    await sleep(every);
  }
}

/** Attaches to the app's page over the WebView2 debugging port (the pattern of scripts/prove/live-installed.mjs). */
export async function attach() {
  const target = await waitFor("the app page over CDP", async () => {
    const list = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
    return list.find((t) => t.type === "page" && t.url.includes("tauri.localhost")) ?? null;
  }, 60000);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const page = {
    send,
    close: () => ws.close(),
    async eval(expr) {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.result?.exceptionDetails) throw new Error("eval failed: " + (r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails)));
      return r.result?.result?.value;
    },
    exists: (sel) => page.eval(`!!document.querySelector(${JSON.stringify(sel)})`),
    count: (sel) => page.eval(`document.querySelectorAll(${JSON.stringify(sel)}).length`),
    text: (sel) => page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); return e?e.innerText:null})()`),
    click: (sel, nth = 0) => page.eval(`(()=>{const e=document.querySelectorAll(${JSON.stringify(sel)})[${nth}]; if(!e) return "missing"; e.click(); return "clicked";})()`),
    clickText: (text, sel = "button") => page.eval(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>(x.innerText||"").trim()===${JSON.stringify(text)}); if(!b) return "missing"; b.click(); return "clicked";})()`),
    /** The app's own backend call, as its page makes it; a rejection comes back as {error}. */
    invoke: (cmd, args = {}) => page.eval(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then(v => ({ok: v}), e => ({error: String(e && e.message || e)}))`),
    async enter() {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    },
  };
  await waitFor("the sidebar", () => page.exists("aside.sidebar"), 60000, 500);
  return page;
}

/** What the running copy says about itself: the version its page reports, and the exe's version resource. */
export async function versions(page, id) {
  const r = await page.invoke("plugin:app|version");
  return { page: r.ok ?? `(${r.error})`, exe: fileVersion(join(INSTALL, IDENTITIES[id].exe)) };
}

const TERM = "section.pane[data-agent]";
const CHOOSER = "section.pane.chooser";
const LAYOUT_ON = '.layouts button[aria-pressed="true"]';
const POPUP = '[aria-label="Update available"]';

/** D-2 set-up: a throwaway repo as a project, a shell pane, split once (two panes). */
export async function setUpWorkspace(page) {
  const repo = join(BASE, "repo");
  if (!existsSync(join(repo, ".git"))) {
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "README.md"), "T-785 update rig throwaway repo\n");
    sh("git", ["init", "-q", "-b", "main"], { cwd: repo });
    sh("git", ["-c", "user.name=rig", "-c", "user.email=rig@example.invalid", "add", "."], { cwd: repo });
    sh("git", ["-c", "user.name=rig", "-c", "user.email=rig@example.invalid", "commit", "-q", "-m", "rig"], { cwd: repo });
  }
  await waitFor("the add-project button", () => page.exists('.sb-foot button[title^="Add a project by path"]'), 30000);
  await page.click('.sb-foot button[title^="Add a project by path"]');
  await waitFor("the project folder field", () => page.exists('input[aria-label="project folder"]'), 5000);
  await page.eval(`document.querySelector('input[aria-label="project folder"]').focus()`);
  await page.send("Input.insertText", { text: repo });
  await page.enter();
  const seat = `${CHOOSER} select[aria-label="Seat 1: which AI"]`;
  await waitFor("the chooser's Terminal choice", () => page.exists(`${seat} option[value="terminal"]`), 30000);
  await page.eval(`(() => { const s = document.querySelector(${JSON.stringify(seat)}); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "terminal"); s.dispatchEvent(new Event("change", { bubbles: true })); return s.value; })()`);
  const start = `${CHOOSER} button.btn.primary`;
  await waitFor("the chooser's Start button", () => page.eval(`[...document.querySelectorAll(${JSON.stringify(start)})].some(b => !b.disabled && /^\\s*Start\\s*$/.test(b.textContent))`), 60000);
  await page.eval(`[...document.querySelectorAll(${JSON.stringify(start)})].find(b => /^\\s*Start\\s*$/.test(b.textContent)).click()`);
  await waitFor("the first shell pane", async () => (await page.count(TERM)) >= 1, 30000);
  await waitFor("the shell's input field", () => page.exists(`${TERM} .xterm-helper-textarea`), 30000);
  await page.eval(`document.querySelector(${JSON.stringify(TERM + " .xterm-helper-textarea")}).focus()`);
  await sleep(500);
  const split = await page.eval(`(() => { const p = document.querySelector('.pane.focused') || document.querySelector(${JSON.stringify(TERM)}); const b = p && p.querySelector('button[title^="Split right"]'); if (!b) return "missing"; b.click(); return "clicked"; })()`);
  if (split !== "clicked") throw new Error(`split right: ${split}`);
  await waitFor("two shell panes", async () => (await page.count(TERM)) === 2, 30000);
  await sleep(3000); // the layout save follows every pane change
}

/** The shape D-3 compares: layout, panes and the sidebar's projects. */
export async function snapshot(page) {
  return {
    layout: await page.eval(`document.querySelector(${JSON.stringify(LAYOUT_ON)})?.textContent.trim() ?? null`),
    panes: await page.eval(`[...document.querySelectorAll(${JSON.stringify(TERM)})].map(p => p.dataset.agent)`),
    projects: await page.eval(`[...document.querySelectorAll('aside.sidebar [data-project], aside.sidebar .project, aside.sidebar li')].map(e => (e.innerText || "").trim().split("\\n")[0]).filter(Boolean).slice(0, 8)`),
  };
}

/** Quits the app the ordinary way (the window's close button) and waits for the process to end. */
export async function quit(pid) {
  ps(`$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { [void]$p.CloseMainWindow() }`);
  await waitFor(`pid ${pid} to end`, async () => !alive(pid), 60000, 500);
  log(`quit: pid ${pid} ended after the window close`);
}
/** Waits until no installer of this identity runs any more (the update installs after the quit). */
export async function installerDone(id, version) {
  const name = installerName(id, version);
  await waitFor("the installer to end", () => running(name).length === 0, 180000, 1000);
}
export const appPids = (id) => running(IDENTITIES[id].exe, INSTALL).map((p) => p.pid);

// ---------- the T-785 run ----------
export async function prove785() {
  const id = "proof-rs";
  const [old, next] = ["0.1.0", "0.1.1"];
  const results = [];
  const verdict = (name, pass, detail) => { results.push({ name, pass }); log(`${name}: ${pass ? "PASS" : "FAIL"} ${detail}`); };
  for (const v of [old, next]) if (!existsSync(built(id, v))) throw new Error(`build first: node scripts/prove/update-rig.mjs build ${id} ${v}`);
  if (appPids(id).length) throw new Error(`a scratch app is still running (${appPids(id).join(", ")}); run clean first`);
  const f = feed();
  await f.start();
  log(`feed: http://127.0.0.1:${PORT}/latest.json serving ${installerName(id, next)}`);
  f.state.id = id;
  f.state.version = next;
  try {
    uninstall();
    install(id, old);
    const exe = join(INSTALL, IDENTITIES[id].exe);

    // Refusals first, while 0.1.0 is installed: each on a fresh profile so the start-up check runs.
    for (const [mode, name] of [["truncate", "refusal: download cut mid-file"], ["short", "refusal: file cut short, sent whole"], ["wrongkey", "refusal: manifest signed with the wrong key"]]) {
      f.state.mode = mode;
      f.state.hits = [];
      freshProfile(id);
      const pid = launch(id);
      const page = await attach();
      const popup = await waitFor("the start-up check to answer", async () => (await page.exists(POPUP)) || (await page.exists(".upd-err")) || (f.state.hits.length >= 2 && (await sleep(8000), true)), 120000, 1000);
      // The page's own attempt has run; the backend says why in one line when asked again the way the page asks.
      const again = await page.invoke("update_download");
      const err = again.error ?? (await page.text(".upd-err")) ?? "(no error shown)";
      const shownPopup = await page.exists(POPUP);
      page.close();
      await quit(pid);
      await installerDone(id, next);
      const after = fileVersion(exe);
      verdict(name, !shownPopup && after === old && !!again.error, `popup ${shownPopup ? "shown" : "not shown"}; backend: ${String(err).replace(/\s+/g, " ").slice(0, 220)}; exe after quit ${after}; feed hits ${f.state.hits.join(", ")}`);
    }

    // D-4: Restart to update brings the app back on the new version.
    f.state.mode = "ok";
    f.state.hits = [];
    freshProfile(id);
    {
      const pid = launch(id);
      const page = await attach();
      const before = await versions(page, id);
      await waitFor("the ready pop-up", () => page.exists(POPUP), 180000, 1000);
      const popupText = (await page.text(POPUP)).replace(/\s+/g, " ");
      log(`D-4: pop-up "${popupText}" with the app on ${before.page} (exe ${before.exe})`);
      const clicked = await page.clickText("Update now", `${POPUP} button`);
      if (clicked !== "clicked") throw new Error("Update now button missing");
      page.close();
      await waitFor(`pid ${pid} to end`, async () => !alive(pid), 90000, 500);
      await installerDone(id, next);
      const newPid = await waitFor("the app to come back by itself", () => appPids(id).find((p) => p !== pid) ?? null, 120000, 1000);
      const page2 = await attach();
      const after = await versions(page2, id);
      page2.close();
      const pageAgrees = !/^\d+\.\d+\.\d+$/.test(String(after.page)) || String(after.page) === next;
      verdict("D-4 Restart to update", before.exe === old && after.exe === next && pageAgrees, `before ${before.exe}, after ${after.exe} (page says ${after.page}); came back as pid ${newPid} without a hand`);
      await quit(newPid);
    }

    // D-2 and D-3: back on 0.1.0 with a fresh profile, a workspace with two panes, quit without clicking.
    uninstall();
    install(id, old);
    freshProfile(id);
    f.state.hits = [];
    {
      const pid = launch(id);
      const page = await attach();
      const before = await versions(page, id);
      await setUpWorkspace(page);
      const shape = await snapshot(page);
      await waitFor("the ready pop-up", () => page.exists(POPUP), 180000, 1000);
      const popupText = (await page.text(POPUP)).replace(/\s+/g, " ");
      log(`D-2: pop-up "${popupText}" left alone; workspace ${JSON.stringify(shape)}; app ${before.page} (exe ${before.exe})`);
      const stillOld = fileVersion(exe);
      page.close();
      await quit(pid);
      await installerDone(id, next);
      const after = fileVersion(exe);
      verdict("D-2 install on quit", stillOld === old && after === next && appPids(id).length === 0, `exe before quit ${stillOld}, after quit ${after}; app did not restart itself (running copies: ${appPids(id).length})`);
      const pid2 = launch(id);
      const page2 = await attach();
      const now = await versions(page2, id);
      await waitFor("the panes to come back", async () => (await page2.count(TERM)) >= shape.panes.length, 60000, 1000);
      await sleep(2000);
      const shape2 = await snapshot(page2);
      page2.close();
      const same = JSON.stringify(shape) === JSON.stringify(shape2);
      verdict("D-3 layout and panes identical", same && now.exe === next, `before ${JSON.stringify(shape)} after ${JSON.stringify(shape2)}; now ${now.page} (exe ${now.exe})`);
      await quit(pid2);
    }
    const profile = profileDirs(id).find((d) => existsSync(join(d, "state.db")));
    log(`profile used by the scratch app: ${profile ?? "(none found)"}`);
  } finally {
    await f.stop();
  }
  const failed = results.filter((r) => !r.pass);
  log(`result: ${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map((r) => r.name).join(", ")}` : ""}`);
  return failed.length === 0;
}

export async function clean() {
  for (const id of Object.keys(IDENTITIES)) for (const p of appPids(id)) { ps(`Stop-Process -Id ${p} -Force -ErrorAction SilentlyContinue`); log(`clean: stopped ${p}`); }
  uninstall({ keepData: false });
  for (const id of Object.keys(IDENTITIES)) for (const d of [...profileDirs(id), ...localDirs(id)]) if (existsSync(d)) { rmSync(d, { recursive: true, force: true }); log(`clean: removed ${d}`); }
  rmSync(INSTALL, { recursive: true, force: true });
  const path = ps(`(Get-ItemProperty HKCU:\\Environment).Path`);
  log(`clean: user PATH ${path.toLowerCase().includes(INSTALL.toLowerCase()) ? "STILL HOLDS" : "no longer holds"} ${INSTALL}\\bin`);
}

if (isMain) {
  const [cmd, ...a] = process.argv.slice(2);
  mkdirSync(BASE, { recursive: true });
  const main = async () => {
    if (cmd === "key") makeKey();
    else if (cmd === "build") build(a[0], a[1]);
    else if (cmd === "install") install(a[0], a[1]);
    else if (cmd === "uninstall") uninstall();
    else if (cmd === "clean") await clean();
    else if (cmd === "prove-785") {
      const ok = await prove785();
      mkdirSync(LOGS, { recursive: true });
      writeFileSync(join(LOGS, "prove-785.txt"), evidence() + "\n");
      log(`log: ${join(LOGS, "prove-785.txt")}`);
      process.exitCode = ok ? 0 : 1;
    } else {
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n"));
      process.exitCode = 2;
    }
  };
  main().catch((e) => { log(`error: ${e.stack || e}`); process.exitCode = 1; });
}
