// Shared pieces of the stress scenarios: the app (scripts/evidence/app-launch.mjs is the one launcher), process and
// memory snapshots, in-page probes, statistics and the result record. A scenario returns checks; run.mjs writes them.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../evidence/app-launch.mjs";

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
// A new project opens the launch chooser, not a shell: seat 1 gets Terminal (React's select listens for change, so the value goes
// through the native setter), then Start, once the agent search has finished and enabled it. The way a user would.
export async function startTerminalFromChooser(app) {
  const seat = `${CHOOSER} select[aria-label="Seat 1: which AI"]`;
  await app.waitFor("the chooser's Terminal choice", () => app.exists(`${seat} option[value="terminal"]`), 30000);
  const r = await app.evalJs(`(() => { const s = document.querySelector(${JSON.stringify(seat)}); if (!s) return "missing"; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "terminal"); s.dispatchEvent(new Event("change", { bubbles: true })); return s.value; })()`);
  if (r !== "terminal") throw new Error(`could not pick Terminal in the chooser: ${r}`);
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
