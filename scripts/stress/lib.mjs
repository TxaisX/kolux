// Shared pieces of the stress scenarios: the app (scripts/evidence/app-launch.mjs is the one launcher), process and
// memory snapshots, in-page probes, statistics and the result record. A scenario returns checks; run.mjs writes them.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../evidence/app-launch.mjs";

export const TERM = "section.pane[data-agent]";
export const SHELL = 'section.pane[data-agent="shell"]';
export const SHELL_NAMES = new Set(["powershell.exe", "pwsh.exe", "cmd.exe"]);
// Host processes a terminal pane leaves behind when it is not cleaned up.
export const PANE_PROCS = new Set(["powershell.exe", "pwsh.exe", "cmd.exe", "conhost.exe", "OpenConsole.exe"]);
export const IDENTIFIER = "com.txaisxiong.kolux-rs.stress";
export const TEMP_MARKER = ".kolux-rs-stress-temp";
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
  app.cdpTimeoutMs = 120000; // a page that does not answer in 2 minutes counts as frozen
  return app;
}
export const seedProfile = (app, settings = {}) => () => {
  rmSync(app.paths.profile, { recursive: true, force: true });
  mkdirSync(app.paths.profile, { recursive: true });
  // terminalGpu=false: panes draw on the DOM renderer, so their text can be read back from the page.
  writeFileSync(app.paths.settings, JSON.stringify({ confirmCloseRunning: false, terminalGpu: false, ...settings }, null, 2));
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
export const CHOOSER = "section.pane.chooser";
// Same path as scripts/evidence/smoke.mjs: the sidebar's "Add project" button, its "type a path" link, the folder field, then the launch
// chooser (a new project opens the chooser, not a shell) where Terminal is picked in seat 1 and Start pressed.
export async function addProjectAndOpen(app, repo) {
  await app.waitFor("the sidebar", () => app.exists('aside.sidebar button[aria-label="Add project"]'), 30000);
  await app.click('aside.sidebar button[aria-label="Add project"]');
  await app.waitFor("the add-by-path link", () => app.exists("button[data-add-by-path]"), 5000);
  await app.click("button[data-add-by-path]");
  await app.waitFor("the project folder field", () => app.exists('input[aria-label="project folder"]'), 5000);
  await app.focusField('input[aria-label="project folder"]');
  await app.cdp("insert", repo, "enter");
  await app.waitFor("the launch chooser", async () => (await app.shown(CHOOSER)) >= 1, 30000);
  const seat = `${CHOOSER} [role="group"][aria-label="Seat 1: which AI"] button`;
  const isTerminal = (extra = "") => app.evalJs(`[...document.querySelectorAll(${JSON.stringify(seat)})].some(b => /^\\s*Terminal\\s*$/.test(b.textContent)${extra})`);
  await app.waitFor("the chooser's Terminal choice", () => isTerminal(), 30000);
  await app.clickWhere(seat, "/^\\s*Terminal\\s*$/");
  await app.waitFor("Terminal picked in seat 1", () => isTerminal(' && b.getAttribute("aria-pressed") === "true"'), 5000);
  const start = `${CHOOSER} button.btn.primary`;
  await app.waitFor("the chooser's Start button", () => app.evalJs(`[...document.querySelectorAll(${JSON.stringify(start)})].some(b => !b.disabled && /^\\s*Start\\s*$/.test(b.textContent))`), 60000);
  await app.clickWhere(start, "/^\\s*Start\\s*$/");
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
     $all | Where-Object { $want -contains [int]$_.ProcessId } | ForEach-Object { "$($_.ProcessId)|$($_.Name)|$($_.ParentProcessId)|$($_.WorkingSetSize)|$($_.HandleCount)|$($_.ThreadCount)|$($_.CreationDate)" }`,
  );
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [p, name, ppid, ws, handles, threads, created] = l.split("|");
      return { pid: Number(p), name, ppid: Number(ppid), ws: Number(ws), handles: Number(handles), threads: Number(threads), created };
    });
}
const UI_PROCS = new Set(["kolux-rs.exe", "msedgewebview2.exe"]);
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

// ---------- app footprint (S11) ----------
// The app's own processes only: the window kolux-rs.exe, the detached terminal service kolux-rs.exe and every msedgewebview2.exe
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
  return { cores, gpuRows: j.gpuRows ?? 0, gpuErr: j.gpuErr ?? "", perRole, ticks: ticks.length, seconds: ticks.length > 1 ? (ticks[ticks.length - 1].t - ticks[0].t) / 1000 : 0 };
}

// The page's own numbers: JS heap, canvases (a WebGL context is one canvas), pane and xterm element counts.
export const PAGE_STATS_JS = `(() => {
  const m = performance.memory || {};
  const q = (s) => document.querySelectorAll(s).length;
  return { jsHeapUsedMB: (m.usedJSHeapSize || 0) / 1048576, jsHeapTotalMB: (m.totalJSHeapSize || 0) / 1048576, canvases: q("canvas"), panes: q("section.pane[data-agent]"), shownPanes: [...document.querySelectorAll("section.pane[data-agent]")].filter((e) => e.offsetParent !== null).length, domNodes: document.getElementsByTagName("*").length };
})()`;

// Minimize / restore the app's window (Win32 ShowWindow: 6 = SW_MINIMIZE, 9 = SW_RESTORE). Returns whether the window is iconic after.
export const showWindow = (app, cmd) =>
  app.ps(
    `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);' -Name W -Namespace K11
     $h = (Get-Process -Id ${app.pid}).MainWindowHandle
     [K11.W]::ShowWindow($h, ${cmd}) | Out-Null; Start-Sleep -Milliseconds 800; "iconic=" + [K11.W]::IsIconic($h)`,
  );
