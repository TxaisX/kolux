// Shared pieces of the stress scenarios: the app (scripts/evidence/app-launch.mjs is the one launcher), process and
// memory snapshots, in-page probes, statistics and the result record. A scenario returns checks; run.mjs writes them.
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, waitFor as waitUntil, WIN_PS } from "../evidence/app-launch.mjs";

export const TERM = "section.pane[data-agent]";
// In-page helper (S-02): `button.newtab` and its "New tab" menu are gone (owner change 2026-11-06), and from 10 panes on the grid is a tab strip
// with no pane header buttons. The window's own key for "New terminal tab" (Mod+T, tab.newTerminal) works at every count. Paste NEW_TERMINAL_JS
// into a page script, then await newTerminal(); it returns true once the key event was sent (the caller waits for the pane).
export const NEW_TERMINAL_JS = `async function newTerminal(sleep) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", ctrlKey: true, bubbles: true, cancelable: true }));
  await sleep(0);
  return true;
}`;
// S-02: the New tab menu's "Changed file diff" picker is gone, and so is the Source Control sidebar (T-644). What still opens a file's diff tab
// from outside is the command line's event: `kolux diff` makes the backend emit "cli-workspace" with kind "file-diff"; the same event is emitted here
// through the page's IPC, so the window's own handler (useCliBridge) selects the folder and opens the diff.
export async function openDiffFromCli(app, repo, name, staged = false) {
  const dir = repo.replace(/\//g, "\\");
  const payload = { kind: "file-diff", path: `${dir}\\${name}`, staged, worktree: dir, branch: null };
  await app.evalJs(`window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event: "cli-workspace", payload: ${JSON.stringify(payload)} }).then(() => true)`);
}
export const SHELL = 'section.pane[data-agent="shell"]';
export const SHELL_NAMES = new Set(["powershell.exe", "pwsh.exe", "cmd.exe"]);
// Host processes a terminal pane leaves behind when it is not cleaned up.
export const PANE_PROCS = new Set(["powershell.exe", "pwsh.exe", "cmd.exe", "conhost.exe", "OpenConsole.exe"]);
export const IDENTIFIER = "com.txaisxiong.kolux.stress";
export const TEMP_MARKER = ".kolux-stress-temp";
export const slash = (p) => p.replace(/\\/g, "/");

export function stats(values) {
  const a = [...values].sort((x, y) => x - y);
  if (a.length === 0) return { n: 0, min: NaN, p50: NaN, p95: NaN, max: NaN };
  const at = (q) => a[Math.min(a.length - 1, Math.ceil(q * a.length) - 1)];
  return { n: a.length, min: a[0], p50: at(0.5), p95: at(0.95), max: a[a.length - 1] };
}
export const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : "n/a");

// A check is one line of evidence: the bar, what was measured, and whether it held.
export class Checks {
  constructor() {
    this.list = [];
    this.notes = [];
  }
  add(name, threshold, measured, pass, inconclusive = false) {
    this.list.push({ name, threshold, measured: String(measured), pass: !!pass || !!inconclusive, inconclusive: !pass && !!inconclusive });
    return !!pass;
  }
  note(text) {
    this.notes.push(text);
    console.log(`  note: ${text}`);
  }
  get ok() {
    return this.list.every((c) => c.pass);
  }
}

// A scratch folder is cleared only when it carries this file, which makeTemp() writes (never a path this run did not make).
export function makeTemp(dir) {
  if (!/^G:[\\/]Temp[\\/]stress[\\/]/i.test(dir)) throw new Error(`refusing a scratch folder outside G:/Temp/stress/: ${dir}`);
  removeTemp(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, TEMP_MARKER), "made by scripts/stress/lib.mjs makeTemp()\n");
}
export function removeTemp(dir) {
  if (!existsSync(dir)) return null;
  if (!existsSync(join(dir, TEMP_MARKER)) && readdirSync(dir).length > 0) return "NOMARKER";
  let last = null;
  for (let i = 0; i < 6; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return null;
    } catch (e) {
      last = e.code ?? e.message;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * (i + 1));
    }
  }
  return last;
}

// The app for one scenario: its own scratch root, identifier ending ".stress", window always off-screen.
export function newApp(opts, name) {
  const temp = join(opts.temp, name);
  makeTemp(temp);
  const app = createApp({ root: opts.root, port: opts.port, cdp: opts.cdp, identifier: IDENTIFIER, temp, suffix: ".stress", offscreen: true, buildMinutes: 25, log: (...a) => console.log(" ", ...a) });
  app.temp = temp;
  app.cdpPort = opts.cdp;
  app.cdpTimeoutMs = 120000; // a page that does not answer in 2 minutes counts as frozen
  app.buildKind = "debug dev build (pnpm tauri dev: the web view loads the vite dev server)";
  if (opts.release) useReleaseBuild(app, opts);
  return app;
}

// ---------- --release: the shipped build, not the debug dev build ----------
// `pnpm tauri build --no-bundle` (cargo --release, the front end bundled by vite build, no installer) with the stress identifier compiled in
// (a release exe takes its identifier, and so its profile folder, from the config it was built with, as the dev exe does). The same scratch
// homes and CDP port as the dev launch (scripts/evidence/app-launch.mjs appEnv is not exported, so it is repeated here from app.paths).
// The exe is built once per run.mjs process; --skip-build reuses the one already in the target folder.
const releaseBuilt = new Map();
const releaseExe = (root) => join(process.env.CARGO_TARGET_DIR ? resolve(process.env.CARGO_TARGET_DIR) : join(root, "src-tauri", "target"), "release", "kolux.exe");
async function buildRelease(app, opts) {
  const exe = releaseExe(opts.root);
  if (!releaseBuilt.has(exe)) {
    releaseBuilt.set(
      exe,
      (async () => {
        if (opts.skipBuild) {
          if (!existsSync(exe)) throw new Error(`--skip-build: no release exe at ${exe}`);
          return `reused the exe already built`;
        }
        const cfg = join(app.temp, "tauri.release.json");
        writeFileSync(cfg, JSON.stringify({ identifier: IDENTIFIER }));
        const logFile = join(opts.temp, "tauri-build-release.log");
        const out = openSync(logFile, "w");
        console.log(`  building release: pnpm tauri build --no-bundle (identifier ${IDENTIFIER}; log ${logFile})`);
        const t0 = Date.now();
        const child = spawn(`pnpm tauri build --no-bundle --config "${cfg}"`, { cwd: opts.root, shell: true, windowsHide: true, stdio: ["ignore", out, out], env: { ...process.env, CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "4" } });
        const code = await new Promise((done) => child.on("exit", (c) => done(c ?? -1)));
        if (code !== 0 || !existsSync(exe)) throw new Error(`release build failed (exit ${code}); see ${logFile}`);
        return `built in ${((Date.now() - t0) / 60000).toFixed(1)} min`;
      })(),
    );
  }
  return releaseBuilt.get(exe);
}
function useReleaseBuild(app, opts) {
  const exe = releaseExe(opts.root);
  const P = app.paths;
  const env = () => ({ ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [`--remote-debugging-port=${opts.cdp}`, process.env.STRESS_EXTRA_BROWSER_ARGS].filter(Boolean).join(" "), CLAUDE_CONFIG_DIR: P.claudeConfig, CODEX_HOME: P.codexHome, TEMP: P.appTemp, TMP: P.appTemp, USERPROFILE: P.userHome, HOME: P.userHome, KOLUX_KEYBINDINGS_HOME: P.userHome, APPDATA: P.roaming, LOCALAPPDATA: P.local, CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), ".cargo"), RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), ".rustup") });
  const start = async () => {
    const out = openSync(join(app.temp, "app.log"), "a");
    const child = spawn(exe, [], { cwd: join(opts.root, "src-tauri"), windowsHide: true, stdio: ["ignore", out, out], env: env() });
    child.on("error", (e) => console.log(`  WARN release start: ${e.message}`));
    if (!child.pid) throw new Error("the release app has no pid");
    await app.pageUp(120_000);
    // The window process by its exe path (never a window title); the terminal service is not the window.
    const want = exe.replace(/'/g, "''");
    const found = await waitUntil(
      "the app process",
      async () => {
        const line = await app.ps(`$p = Get-CimInstance Win32_Process -Filter "Name='kolux.exe'" | Where-Object { $_.ExecutablePath -eq '${want}' -and [string]$_.CommandLine -notlike '*--terminal-service*' } | Select-Object -First 1; if ($p) { $p.ProcessId }`);
        return /^\d+$/.test(line) ? line : null;
      },
      30000,
      1000,
    );
    app.pid = Number(found);
    app.exePath = exe;
    console.log(`  app pid ${app.pid} (${exe}); window: ${await app.moveWindow(app.pid)}`);
  };
  app.launch = async ({ prepare } = {}) => {
    await prepare?.();
    mkdirSync(P.claudeConfig, { recursive: true });
    writeFileSync(join(P.claudeConfig, ".kolux-scratch"), "");
    mkdirSync(P.codexHome, { recursive: true });
    mkdirSync(P.local, { recursive: true });
    app.buildNote = await buildRelease(app, opts);
    const st = statSync(exe);
    app.buildKind = `release build (pnpm tauri build --no-bundle: the web view loads the bundled front end); ${app.buildNote}; exe ${(st.size / 1048576).toFixed(1)} MB, modified ${st.mtime.toISOString()}`;
    await start();
  };
  app.relaunch = start;
}
// Panes take the user's registry environment (HKCU\Environment, laid over the app's own by portable-pty), so a
// CLAUDE_CONFIG_DIR or CODEX_HOME set there wins over the scratch one the app was started with, and an agent started in
// a pane would reach the real config folder. The per-agent env setting is applied by Kolux after that, so every stress
// profile pins both to the run's scratch folders (the same two the scratch-home guard covers), on top of whatever the
// scenario sets for that agent (its own lines for the same variable are replaced; others, and `command`/`args`, stay).
const SCRATCH_AGENT_ENV = (app) => ({ claude: { CLAUDE_CONFIG_DIR: app.paths.claudeConfig }, codex: { CODEX_HOME: app.paths.codexHome } });
export function scratchAgentOptions(app, agentOptions = {}) {
  const out = { ...agentOptions };
  for (const [agent, vars] of Object.entries(SCRATCH_AGENT_ENV(app))) {
    const own = { ...(out[agent] ?? {}) };
    const kept = String(own.env ?? "")
      .split(/\r?\n/)
      .filter((l) => l.trim() && !Object.keys(vars).includes(l.split("=")[0].trim()));
    own.env = [...Object.entries(vars).map(([k, v]) => `${k}=${v.replace(/\//g, "\\")}`), ...kept].join("\n");
    out[agent] = own;
  }
  return out;
}
export const seedProfile = (app, settings = {}) => () => {
  rmSync(app.paths.profile, { recursive: true, force: true });
  mkdirSync(app.paths.profile, { recursive: true });
  // terminalGpu=false: panes draw on the DOM renderer, so their text can be read back from the page.
  writeFileSync(app.paths.settings, JSON.stringify({ confirmCloseRunning: false, terminalGpu: false, ...settings, agentOptions: scratchAgentOptions(app, settings.agentOptions) }, null, 2));
};

// A throwaway git repo with one commit, added as a project through the sidebar (as scripts/evidence/smoke.mjs does).
export async function gitInit(app, dir, name = "stress") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "notes.txt"), `${name}\n`);
  const g = (a) => app.run("git", ["-c", "user.name=stress", "-c", "user.email=stress@example.invalid", ...a], { cwd: dir });
  await g(["init", "-q", "-b", "main"]);
  await g(["add", "."]);
  await g(["commit", "-q", "-m", "stress"]);
}
// The Add project dialog opens from the sidebar's "kolux-add-project" window event (what the plus button, the setup guide and
// the Automations page all fire), so the helper does not depend on where the layout puts the button. Its "Type a path" link
// (button[data-add-by-path]) leads to the folder field. S-01: the old .sb-foot button no longer exists.
export const ADD_PROJECT_EVENT = "kolux-add-project";
export const CHOOSER = "section.pane.chooser";
// A fresh profile opens the first-run guide over the grid: close it (Close, then Skip in its question) so clicks reach the app.
export async function dismissFirstRun(app) {
  const any = '[role="dialog"], [role="alertdialog"]';
  for (let t = 0; t < 10 && (await app.exists(any)); t++) {
    const asked = await app.evalJs(`[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Skip") && /Skip setup\\?/.test(document.body.innerText)`);
    if (asked) await app.clickWhere("button", "/^\\s*Skip\\s*$/");
    else if (await app.exists('[role="dialog"] button[aria-label="Close setup"]')) await app.click('[role="dialog"] button[aria-label="Close setup"]');
    else await app.cdp("key", "Escape");
    await app.sleep(800);
  }
}
export async function openAddByPath(app) {
  await app.waitFor("the app shell", () => app.exists("aside.sidebar"), 60000);
  await dismissFirstRun(app);
  await app.evalJs(`(window.dispatchEvent(new CustomEvent(${JSON.stringify(ADD_PROJECT_EVENT)})), true)`);
  await app.waitFor("the add-by-path item", () => app.exists("button[data-add-by-path]"), 10000);
  await app.click("button[data-add-by-path]");
  await app.waitFor("the project folder field", () => app.exists('input[aria-label="project folder"]'), 5000);
}
// A new project opens the launch chooser, not a shell: seat 1's "Terminal" button (a92dae95 replaced the seat dropdown with a row
// of agent buttons), then Start, once the agent search has finished and enabled it. The way a user would.
export async function startTerminalFromChooser(app) {
  const seat = `${CHOOSER} [role="group"][aria-label="Seat 1: which AI"] button`;
  const isTerminal = (extra = "") => app.evalJs(`[...document.querySelectorAll(${JSON.stringify(seat)})].some(b => /^\\s*Terminal\\s*$/.test(b.textContent)${extra})`);
  await app.waitFor("the chooser's Terminal choice", () => isTerminal(), 30000);
  await app.clickWhere(seat, "/^\\s*Terminal\\s*$/");
  await app.waitFor("Terminal picked in seat 1", () => isTerminal(' && b.getAttribute("aria-pressed") === "true"'), 5000);
  const start = `${CHOOSER} button.btn.primary`;
  await app.waitFor("the chooser's Start button", () => app.evalJs(`[...document.querySelectorAll(${JSON.stringify(start)})].some((b) => !b.disabled && /^\\s*Start\\s*$/.test(b.textContent))`), 60000);
  await app.clickWhere(start, "/^\\s*Start\\s*$/");
}
export async function addProjectAndOpen(app, repo) {
  await openAddByPath(app);
  await app.focusField('input[aria-label="project folder"]');
  await app.cdp("insert", repo, "enter");
  await app.waitFor("the launch chooser", async () => (await app.shown(CHOOSER)) >= 1, 30000);
  await startTerminalFromChooser(app);
  await app.waitFor("the first shell pane", async () => (await app.shown(TERM)) >= 1, 30000);
  await app.waitFor("the first pane's input field", () => app.exists(`${TERM} .xterm-helper-textarea`), 30000);
}

// ---------- processes and memory ----------
// The app's pid plus every descendant: name, working set (bytes), handles, threads, creation time.
export async function snapshot(app, pid = app.pid) {
  const out = await app.ps(
    `$all = Get-CimInstance Win32_Process
     $want = @([int]${pid}); $i = 0; $rows = @()
     while ($i -lt $want.Count) { $p = $want[$i]; $i++
       foreach ($c in $all) { if ($c.ParentProcessId -eq $p -and $want -notcontains [int]$c.ProcessId) { $want += [int]$c.ProcessId } } }
     $all | Where-Object { $want -contains [int]$_.ProcessId } | ForEach-Object { $t = ''; if ([string]$_.CommandLine -match '--type=(\\S+)') { $t = $Matches[1] }; "$($_.ProcessId)|$($_.Name)|$($_.ParentProcessId)|$($_.WorkingSetSize)|$($_.HandleCount)|$($_.ThreadCount)|$($_.CreationDate)|$($_.PrivatePageCount)|$t" }`,
  );
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [p, name, ppid, ws, handles, threads, created, priv, type] = l.split("|");
      return { pid: Number(p), name, ppid: Number(ppid), ws: Number(ws), handles: Number(handles), threads: Number(threads), created, priv: Number(priv), role: procRole(name, type) };
    });
}
// What a process is to the app: the window (kolux.exe), a web view process by its --type (the browser process has none),
// or its own name (conhost, powershell, node).
const procRole = (name, type) => (name === "kolux.exe" ? "kolux" : name === "msedgewebview2.exe" ? `wv-${type || "browser"}` : name.replace(/\.exe$/, ""));
// Working set and private bytes (Win32_Process PrivatePageCount) summed per role, in MB: { role: { n, wsMB, privMB } }.
export function memByRole(snap) {
  const r = {};
  for (const p of snap) {
    const e = (r[p.role] ??= { n: 0, wsMB: 0, privMB: 0 });
    e.n++;
    e.wsMB += p.ws / 1048576;
    e.privMB += (p.priv || 0) / 1048576;
  }
  return r;
}
const UI_PROCS = new Set(["kolux.exe", "msedgewebview2.exe"]);
// The app's own memory: the app process and its web view processes (shells and what they run are not the app).
export const appMemMB = (snap) => snap.filter((p) => UI_PROCS.has(p.name)).reduce((a, p) => a + p.ws, 0) / 1048576;
export const handlesOf = (snap) => snap.filter((p) => UI_PROCS.has(p.name)).reduce((a, p) => a + p.handles, 0);
export const paneProcs = (snap) => snap.filter((p) => PANE_PROCS.has(p.name));
// Pane host processes created since `since` (an ISO-like CIM string is not comparable across machines, so a Date is passed)
// that are alive but whose parent is gone: what a crashed or leaky close leaves behind. Scoped by this run's scratch folder
// in the command line where there is one; otherwise by name and start time only.
export async function detachedPaneProcs(app, sinceMs) {
  const out = await app.ps(
    `$since = [DateTime]'${new Date(sinceMs).toISOString()}'
     $all = Get-CimInstance Win32_Process; $ids = @{}; foreach ($p in $all) { $ids[[int]$p.ProcessId] = $p }
     $names = @('powershell.exe','pwsh.exe','cmd.exe')
     $all | Where-Object { $names -contains $_.Name -and $_.CreationDate -gt $since -and -not $ids.ContainsKey([int]$_.ParentProcessId) } | ForEach-Object { "$($_.ProcessId)|$($_.Name)|$($_.ParentProcessId)|$($_.CommandLine)" }`,
  );
  return out.split(/\r?\n/).filter(Boolean).map((l) => {
    const [pid, name, ppid, ...cmd] = l.split("|");
    return { pid: Number(pid), name, ppid: Number(ppid), cmd: cmd.join("|") };
  });
}

// ---------- in-page probes ----------
// Collects page errors from now on (the page keeps them in window.__stress); call again after every page load.
export const installProbe = (app) =>
  app.evalJs(`(() => {
    if (window.__stress) return "already";
    const errs = [];
    const cap = (s) => { if (errs.length < 200) errs.push(String(s).slice(0, 300)); };
    window.addEventListener("error", (e) => cap("error: " + e.message));
    window.addEventListener("unhandledrejection", (e) => cap("rejection: " + (e.reason && e.reason.message || e.reason)));
    const ce = console.error.bind(console);
    console.error = (...a) => { cap("console.error: " + a.map((x) => (x && x.message) || String(x)).join(" ")); ce(...a); };
    window.__stress = { errs };
    return "installed";
  })()`);
export const pageErrors = (app) => app.evalJs(`(window.__stress && window.__stress.errs) || []`);

// Text on the n-th shown shell pane's screen (the DOM renderer draws every visible row as text).
export const paneText = (app, index, sel = TERM) =>
  app.evalJs(`(() => { const p = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.offsetParent !== null)[${index}]; return p ? (p.querySelector(".xterm-rows")?.innerText ?? "") : null; })()`);

// Types text into the n-th shown pane as one edit, then Enter (cdp.mjs insert goes through the real input pipeline).
export async function typeInto(app, index, text, sel = TERM) {
  await app.focusPane(sel, index, ".xterm-helper-textarea");
  await app.cdp("insert", text, "enter");
}

// ---------- page CPU and allocation over a window (S2) ----------
// One CDP session held open on the main page: Performance metrics (cumulative task, script, layout and style
// time) read at two points give the page's main-thread work between them; the sampling heap profiler, told to
// keep objects the GCs collected, gives what was allocated in a window (short-lived garbage included) and
// which functions allocated it. Opened beside cdp.mjs's one-shot connections, never instead of them.
export async function perfSession(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find((t) => t.type === "page" && /localhost:14\d\d|tauri\.localhost/.test(t.url));
  if (!target) throw new Error("perfSession: no main page target");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) {
      waiting.get(m.id)(m);
      waiting.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      waiting.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send("Performance.enable", { timeDomain: "threadTicks" });
  const metrics = async () => Object.fromEntries(((await send("Performance.getMetrics")).result?.metrics ?? []).map((m) => [m.name, m.value]));
  return {
    metrics,
    /** Seconds of each duration metric between two metrics() readings. */
    diff: (a, b) => Object.fromEntries(["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration"].map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)])),
    async allocations(ms) {
      await send("HeapProfiler.enable");
      await send("HeapProfiler.startSampling", { samplingInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      await new Promise((r) => setTimeout(r, ms));
      const prof = (await send("HeapProfiler.stopSampling")).result?.profile;
      await send("HeapProfiler.disable");
      const byFn = new Map();
      let total = 0;
      const walk = (n) => {
        const self = n.selfSize ?? 0;
        total += self;
        const f = n.callFrame;
        const k = `${f.functionName || "(anon)"} ${(f.url || "").split("/").pop()}:${f.lineNumber}:${f.columnNumber}`;
        if (self) byFn.set(k, (byFn.get(k) ?? 0) + self);
        for (const c of n.children ?? []) walk(c);
      };
      if (prof?.head) walk(prof.head);
      const top = [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${(v / 1048576).toFixed(0)} MB`);
      return { totalMB: total / 1048576, top };
    },
    close: () => ws.close(),
  };
}

// ---------- app footprint (S11) ----------
// The app's own processes only: the window kolux.exe, the detached terminal service kolux.exe and every msedgewebview2.exe
// under the window. Shells, conhost and agents are not the app. Private bytes = Win32_Process PrivatePageCount.
const FOOTPRINT_PS = fileURLToPath(new URL("./footprint-sample.ps1", import.meta.url));
export const FOOTPRINT_ROLES = ["window", "service", "wv-browser", "renderer", "gpu-process", "utility", "crashpad-handler"];
const MB = 1048576;
// Samples `windowS` seconds (a tick every `intervalS`) and returns { cores, perRole: {role: {n, wsMB, privMB, cpuCorePct, cpuTotalPct, gpuDedMB, gpuSharedMB, gpuCommitMB, gpuEngPct, handles, threads}}, ticks }.
export async function footprint(app, windowS = 60, intervalS = 2) {
  const match = slash(app.temp);
  const r = await app.run("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", FOOTPRINT_PS, "-AppPid", String(app.pid), "-ServiceMatch", match, "-WindowS", String(windowS), "-IntervalS", String(intervalS)], { timeout: (windowS + 180) * 1000 });
  const j = JSON.parse(r.stdout);
  const cores = j.cores;
  const gpuByPid = j.gpu ?? {};
  const ticks = (Array.isArray(j.ticks) ? j.ticks : [j.ticks]).map((t) => ({ t: Date.parse(t.t), procs: Array.isArray(t.procs) ? t.procs : t.procs ? [t.procs] : [] }));
  const roles = new Set(ticks.flatMap((t) => t.procs.map((p) => p.role)));
  const roleList = [...roles, "total"];
  const pidRole = new Map(ticks.flatMap((t) => t.procs.map((p) => [String(p.pid), p.role])));
  const gpuOf = (role) => {
    if (!j.gpuRows) return { gpuDedMB: NaN, gpuSharedMB: NaN, gpuCommitMB: NaN, gpuEngPct: NaN };
    let ded = 0, shared = 0, commit = 0, eng = 0;
    for (const [pid, g] of Object.entries(gpuByPid)) if (role === "total" || pidRole.get(pid) === role) { ded += g.ded; shared += g.shared; commit += g.commit; eng += g.eng; }
    return { gpuDedMB: ded / MB, gpuSharedMB: shared / MB, gpuCommitMB: commit / MB, gpuEngPct: eng };
  };
  const perRole = {};
  for (const role of roleList) {
    const sel = (t) => t.procs.filter((p) => role === "total" || p.role === role);
    const mean = (f) => ticks.reduce((a, t) => a + sel(t).reduce((b, p) => b + f(p), 0), 0) / ticks.length;
    let cpu100 = 0;
    let secs = 0;
    for (let i = 1; i < ticks.length; i++) {
      const prev = new Map(ticks[i - 1].procs.map((p) => [p.pid, p]));
      for (const p of sel(ticks[i])) if (prev.has(p.pid)) cpu100 += Math.max(0, p.cpu100ns - prev.get(p.pid).cpu100ns);
      secs += (ticks[i].t - ticks[i - 1].t) / 1000;
    }
    const core = secs > 0 ? (cpu100 / 1e7 / secs) * 100 : NaN;
    perRole[role] = {
      n: mean((p) => 1),
      wsMB: mean((p) => p.ws) / MB,
      privMB: mean((p) => p.priv) / MB,
      cpuCorePct: core,
      cpuTotalPct: core / cores,
      ...gpuOf(role),
      handles: mean((p) => p.handles),
      threads: mean((p) => p.threads),
    };
  }
  if (!j.gpuRows) console.log(`  warn: no GPU counter rows this window (${String(j.gpuErr ?? "").slice(0, 200)})`);
  // Per process (every pid seen in the window): the same numbers as perRole, so a phase with several web views shows each one's renderer.
  const pids = new Map();
  for (let i = 0; i < ticks.length; i++) {
    for (const p of ticks[i].procs) {
      if (!pids.has(p.pid)) pids.set(p.pid, { pid: p.pid, role: p.role, n: 0, ws: 0, priv: 0, cpu100: 0 });
      const q = pids.get(p.pid);
      q.n++;
      q.ws += p.ws;
      q.priv += p.priv;
    }
  }
  for (let i = 1; i < ticks.length; i++) {
    const prev = new Map(ticks[i - 1].procs.map((p) => [p.pid, p]));
    for (const p of ticks[i].procs) if (prev.has(p.pid)) pids.get(p.pid).cpu100 += Math.max(0, p.cpu100ns - prev.get(p.pid).cpu100ns);
  }
  const spanS = ticks.length > 1 ? (ticks[ticks.length - 1].t - ticks[0].t) / 1000 : 0;
  const procs = [...pids.values()]
    .map((q) => ({ pid: q.pid, role: q.role, wsMB: q.ws / q.n / MB, privMB: q.priv / q.n / MB, cpuCorePct: spanS > 0 ? (q.cpu100 / 1e7 / spanS) * 100 : NaN, gpuDedMB: j.gpuRows && gpuByPid[String(q.pid)] ? gpuByPid[String(q.pid)].ded / MB : NaN, ticks: q.n }))
    .sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : b.privMB - a.privMB));
  return { cores, gpuRows: j.gpuRows ?? 0, gpuErr: j.gpuErr ?? "", perRole, procs, ticks: ticks.length, seconds: ticks.length > 1 ? (ticks[ticks.length - 1].t - ticks[0].t) / 1000 : 0 };
}

// The page's own numbers: JS heap, canvases (a WebGL context is one canvas), pane and xterm element counts.
export const PAGE_STATS_JS = `(() => {
  const m = performance.memory || {};
  const q = (s) => document.querySelectorAll(s).length;
  return { jsHeapUsedMB: (m.usedJSHeapSize || 0) / 1048576, jsHeapTotalMB: (m.totalJSHeapSize || 0) / 1048576, canvases: q("canvas"), panes: q("section.pane[data-agent]"), shownPanes: [...document.querySelectorAll("section.pane[data-agent]")].filter((e) => e.offsetParent !== null).length, domNodes: document.getElementsByTagName("*").length, visibility: document.visibilityState, wizard: document.querySelector(".onb-backdrop") !== null };
})()`;

// WIN_PS (the V11 helper: AppWindow(pid) finds the app's real window) now lives in scripts/evidence/app-launch.mjs, shared with moveScript and gracefulClose there.
const mainWindow = (app) => `${WIN_PS}
     $h = [V11]::AppWindow(${app.pid}); if ($h -eq [IntPtr]::Zero) { throw "no Kolux window for pid ${app.pid}" }`;

// Minimize / restore the app's window (Win32 ShowWindow: 6 = SW_MINIMIZE, 9 = SW_RESTORE). Returns whether the window is iconic after.
export const showWindow = (app, cmd) =>
  app.ps(`${mainWindow(app)}
     [V11]::ShowWindow($h, ${cmd}) | Out-Null; Start-Sleep -Milliseconds 800; "iconic=" + [V11]::IsIconic($h)`);

// Bring the minimised window back without activating it (SW_SHOWNA, then SW_SHOWNORMAL): it returns to where it was, off-screen, and
// the restore's resize tells the app the view is in sight again.
export const restoreWindow = (app) =>
  app.ps(`${mainWindow(app)}
     [V11]::ShowWindow($h, 8) | Out-Null; [V11]::ShowWindow($h, 1) | Out-Null; Start-Sleep -Milliseconds 800; "iconic=" + [V11]::IsIconic($h)`);
// Fallback when the page still reports hidden: the window is put on screen at a size 40 px smaller (a resize the app hears), then back
// to its own size w x h, then off-screen again.
export const nudgeWindow = (app, w = 1200, h = 800) =>
  app.ps(`${mainWindow(app)}
     [V11]::ShowWindow($h, 9) | Out-Null; Start-Sleep -Milliseconds 1200; [V11]::SetWindowPos($h, [IntPtr]::Zero, 100, 100, ${w - 40}, ${h - 40}, 0x0044) | Out-Null; Start-Sleep -Milliseconds 700
     [V11]::SetWindowPos($h, [IntPtr]::Zero, 100, 100, ${w}, ${h}, 0x0044) | Out-Null; Start-Sleep -Milliseconds 700
     [V11]::SetWindowPos($h, [IntPtr]::Zero, -32000, -32000, 0, 0, 0x0015) | Out-Null; "on screen ${w}x${h} via ${w - 40}x${h - 40} and off again, iconic=" + [V11]::IsIconic($h)`);

// A fresh profile opens the first-run wizard (src-tauri/src/onboarding.rs: kv key "onboarding", record with no closedAt); its dots pulse
// forever over a blurred backdrop, which alone costs 20+ % of a core in the GPU process, so an idle measurement must never include it.
// The profile gets the record a closed wizard leaves (outcome "dismissed"), written into the same state.db the app opens.
export function seedOnboardingDone(profileDir) {
  const db = new DatabaseSync(join(profileDir, "state.db"));
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
    const rec = JSON.stringify({ version: 7, step: 3, closedAt: Date.now(), outcome: "dismissed" });
    db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run("onboarding", rec);
  } finally {
    db.close();
  }
}
