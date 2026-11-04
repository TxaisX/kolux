// T-765 flood probe (copy of live-stress-t1.mjs): S1 only, plus output counters, an event-loop lag sampler and a CPU profile.
//   node scripts/prove/live-flood.mjs [--label main|fix]
// LIVE STRESS T1: the stress half of the button audit, on the 0.1.7 code (main 5e481cf2). One dev app, hidden off-screen,
// scratch profile, stand-in claude. Launch, input paths, IPC guard and teardown come from live-verify-t12.mjs (built on
// scripts/evidence/app-launch.mjs createApp). Six scenarios, each measured before and after (JS heap and DOM nodes /
// listeners over CDP Performance.getMetrics after a forced GC, the working set of the app's whole process tree, long
// tasks, and a second CDP socket that times a trivial evaluate every 200 ms: a 1 s main-thread block shows as a slow answer).
//   node scripts/prove/live-flood.mjs
// Run only when 57 has said "published" AND 49's live-verify t13 is done: one dev app at a time.
// Isolation: identifier com.txaisxiong.kolux-rs.flood1, vite 1490, CDP 9310, scratch root G:/Temp/live-flood/run,
// cargo target G:/Temp/live-verify-t5/target. HOME/USERPROFILE/APPDATA/CLAUDE_CONFIG_DIR all point into the scratch root
// (createApp), so the real ~/.claude is never read. PIDs 3392 and 34868 belong to other sessions: never touched.
// Results: G:/Temp/live-flood/table.md, one row appended as each scenario finishes; run.log next to it.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
const KB = join(homedir(), ".kolux", "keybindings.json");
const kbBefore = existsSync(KB) ? statSync(KB).mtimeMs : null;
import { dirname, join } from "node:path";
import { ROOT, git, writeStandinClaude, dismissFirstRun } from "./live-common.mjs";
import { createApp, sleep } from "../evidence/app-launch.mjs";

process.env.PROVE_PORT ||= "1490";
process.env.PROVE_CDP ||= "9310";
process.env.CARGO_TARGET_DIR ||= "G:/Temp/live-verify-t5/target";
const PORT = process.env.PROVE_PORT;
const CDPP = process.env.PROVE_CDP;
const IDENT = "com.txaisxiong.kolux-rs.flood1";
const OUT = "G:/Temp/live-flood";
const SHOTS = `${OUT}/shots`;
const TEMP = `${OUT}/run`;
const REPO = `${OUT}/work/flood1`;
mkdirSync(SHOTS, { recursive: true });
const PAGE = new RegExp(`localhost:${PORT}|tauri\\.localhost`);
const TERM = "section.pane[data-agent]";
const lines = [];
const log = (...a) => { const s = a.join(" "); lines.push(s); console.log(s); };
const cell = (s) => String(s).replace(/\|/g, "/").replace(/\r?\n/g, " ");

// ---------------------------------------------------------------- CDP client (one socket, page errors kept)
class Page {
  errors = [];
  async connect() {
    const targets = await (await fetch(`http://127.0.0.1:${CDPP}/json`)).json();
    const t = targets.find((x) => x.type === "page" && PAGE.test(x.url));
    if (!t) throw new Error("no page target");
    this.ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; });
    this.id = 0;
    this.wait = new Map();
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.wait.has(m.id)) { this.wait.get(m.id)(m); this.wait.delete(m.id); return; }
      if (m.method === "Runtime.exceptionThrown") this.errors.push(`exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`.slice(0, 300));
    };
    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }
  send(method, params = {}) {
    return new Promise((res) => { const i = ++this.id; this.wait.set(i, res); this.ws.send(JSON.stringify({ id: i, method, params })); });
  }
  async ev(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.error) throw new Error(JSON.stringify(r.error));
    if (r.result?.exceptionDetails) throw new Error(`page threw: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
  }
  async mouse(type, x, y) {
    await this.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1 });
  }
  async clickAt(x, y) { await this.mouse("mouseMoved", x, y); await this.mouse("mousePressed", x, y); await this.mouse("mouseReleased", x, y); }
  async rclickAt(x, y) { await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 }); await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "right", buttons: 2, clickCount: 1 }); await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "right", buttons: 0, clickCount: 1 }); }
  async key(key, { code, vk, mods = 0, text } = {}) {
    const k = { key, code: code ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key), windowsVirtualKeyCode: vk ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0), modifiers: mods };
    await this.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...k, ...(text ? { text } : {}) });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
  }
  insert(text) { return this.send("Input.insertText", { text }); }
  async shot(name) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    const file = `${SHOTS}/${name}.png`;
    if (r.result?.data) writeFileSync(file, Buffer.from(r.result.data, "base64"));
    return r.result?.data ? file : "(no shot)";
  }
  drain() { const e = this.errors; this.errors = []; return e; }
}
let P;
const q = (s) => JSON.stringify(s);
const Ctrl = 2, Shift = 8;
const ENTER = { code: "Enter", vk: 13, text: String.fromCharCode(13) };

// page helper: visible element matching sel (+ name regex source), its centre and whether something else is on top there
const HELP = `(() => {
  if (window.__v10) return true;
  const vis = (e) => { if (!e || !e.getClientRects().length) return false; const s = getComputedStyle(e); if (s.visibility === "hidden" || s.display === "none") return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const nameOf = (e) => [e.getAttribute("aria-label"), e.getAttribute("title"), (e.textContent || "").replace(/\\s+/g, " ").trim(), e.getAttribute("placeholder")].filter(Boolean).join(" | ");
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
  const topAt = (e, x, y) => { const t = document.elementFromPoint(x, y); return !t || e === t || e.contains(t) || t.contains(e) ? null : t.tagName + "." + String(t.className).slice(0, 40); };
  window.__v10 = {
    vis,
    find(sel, re, within) {
      const root = within ? document.querySelector(within) : document;
      if (!root) return null;
      const rx = re ? new RegExp(re, "i") : null;
      const e = [...root.querySelectorAll(sel)].find((x) => vis(x) && (!rx || rx.test(nameOf(x))));
      if (!e) return null;
      e.scrollIntoView({ block: "nearest", inline: "nearest" });
      const b = box(e);
      return { ...b, name: nameOf(e).slice(0, 80), disabled: !!e.disabled, coveredBy: topAt(e, b.x, b.y), offscreen: b.r > innerWidth + 1 || b.b > innerHeight + 1 || b.l < -1 || b.t < -1 };
    },
    screen() { return [...document.querySelectorAll("nav.switcher button")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent.trim()).join(","); },
  };
  return true;
})()`;
const inject = () => P.ev(HELP);
const find = async (sel, re, within) => { await inject(); return P.ev(`window.__v10.find(${q(sel)}, ${re ? q(re) : "null"}, ${within ? q(within) : "null"})`); };
const exists = async (sel, re, within) => !!(await find(sel, re, within));
const countVis = async (sel) => { await inject(); return P.ev(`[...document.querySelectorAll(${q(sel)})].filter(window.__v10.vis).length`); };
const bodyHas = (re) => P.ev(`new RegExp(${q(re)}, "i").test(document.body.innerText)`);
const waitFor = async (fn, ms = 4000, every = 150) => {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() > end) return false;
    await sleep(every);
  }
};
/** A real mouse click on the first visible element matching (sel, re). Returns its find() record, or null. */
const clickEl = async (sel, re, within, settle = 500) => {
  const f = await find(sel, re, within);
  if (!f) return null;
  await P.clickAt(f.x, f.y);
  await sleep(settle);
  return f;
};
/** Real typing: a real click on the field first, then Input.insertText (a React-controlled field takes it). */
const typeInto = async (sel, text) => {
  const f = await find(sel);
  if (!f) return "missing";
  await P.clickAt(f.x, f.y);
  await sleep(120);
  const focused = await P.ev(`document.activeElement === document.querySelector(${q(sel)})`);
  if (!focused) return "not-focused";
  await P.insert(text);
  await sleep(250);
  return "typed";
};
const esc = async () => { await P.key("Escape", { code: "Escape", vk: 27 }); await sleep(300); };
const screenNow = async () => { await inject(); return P.ev("window.__v10.screen()"); };
const goTerminals = async () => { await clickEl("nav.switcher button", "^\\s*Terminals", null, 700); };
const PAGES = { tasks: '[aria-label="Search issues and pull requests"]', automations: 'button[aria-label="Close Automations"]', skills: 'button[aria-label="Close Skills"]', artifacts: 'button[aria-label="Close Artifacts"]', floor: "section.floor" };
const shownPage = async () => { for (const [k, sel] of Object.entries(PAGES)) if (await exists(sel)) return k; return ""; };
/** Palette by the real chord: waits for the real palette's input; returns false when it never came up. */
async function viaPalette(label, { run = true } = {}) {
  for (const key of ["j", "J"]) {
    await P.key(key, { code: "KeyJ", vk: 74, mods: Ctrl | Shift });
    if (await waitFor(() => exists('.palette input, [role="dialog"][aria-label="Switch worktree"] input'), 2500)) {
      const typed = await typeInto('.palette input, [role="dialog"][aria-label="Switch worktree"] input', label);
      if (typed !== "typed") { log(`  palette typing: ${typed}`); }
      await sleep(400);
      if (run) { await P.key("Enter", { code: "Enter", vk: 13, text: String.fromCharCode(13) }); await sleep(900); }
      return true;
    }
  }
  return false;
}
/** Back to a clean Terminals screen: no palette, form, sheet or page. */
async function home() {
  for (let i = 0; i < 4; i++) {
    const open = await P.ev(`document.querySelectorAll('.palette, [role=dialog], [role=menu], [role=alertdialog]').length`);
    if (!open) break;
    await esc();
  }
  await P.ev(`document.querySelector('button[aria-label="Close Automations"], button[aria-label="Close Skills"], button[aria-label="Close Artifacts"]')?.click()`);
  await sleep(250);
  await goTerminals();
  if (await P.ev(`!!document.querySelector('.sb-form, [data-filter]')`)) { await clickEl("aside.sidebar button.ib", "^Group and sort", null, 300); }
}


// ---------------------------------------------------------------- more input paths
Page.prototype.rclickAt = async function (x, y) {
  await this.mouse("mouseMoved", x, y);
  await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "right", buttons: 2, clickCount: 1 });
  await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "right", buttons: 0, clickCount: 1 });
};
const KEYS = { ArrowDown: [40, "ArrowDown"], ArrowUp: [38, "ArrowUp"], ArrowRight: [39, "ArrowRight"], ArrowLeft: [37, "ArrowLeft"], Home: [36, "Home"], Escape: [27, "Escape"], Enter: [13, "Enter"] };
const press = async (name, mods = 0) => { const [vk, code] = KEYS[name]; await P.key(name, { code, vk, mods }); await sleep(250); };

// ---------------------------------------------------------------- boot (the Add project dialog flow)
let app = null;
async function mkRepo(dir, files) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [n, t] of Object.entries(files)) { mkdirSync(dirname(join(dir, n)), { recursive: true }); writeFileSync(join(dir, n), t); }
  await git(dir, ["init", "-q", "-b", "main"]);
  await git(dir, ["add", "."]);
  await git(dir, ["commit", "-q", "-m", "start"]);
}
async function boot() {
  if (existsSync(TEMP)) {
    if (!existsSync(join(TEMP, ".prove-run"))) throw new Error(`${TEMP} exists without the prove marker`);
    rmSync(TEMP, { recursive: true, force: true });
  }
  mkdirSync(TEMP, { recursive: true });
  writeFileSync(join(TEMP, ".prove-run"), "made by scripts/prove/live-flood.mjs\n");
  writeFileSync(join(TEMP, ".kolux-rs-scratch"), "");
  const skillMd = (n) => `---\nname: ${n}\ndescription: A throwaway skill for the live verify run\n---\nDo nothing.\n`;
  await mkRepo(REPO, { "big.txt": BIG, "notes.txt": "flood1 line one\nflood1 line two\n", "src/app.js": "console.log(1)\n", ".claude/skills/flood1-skill/SKILL.md": skillMd("flood1-skill") });
  for (const base of [join(TEMP, "home", ".claude"), join(TEMP, "tmp", "claude-config")]) { mkdirSync(join(base, "skills", "flood1-user"), { recursive: true }); writeFileSync(join(base, "skills", "flood1-user", "SKILL.md"), skillMd("flood1-user")); }
  const standin = writeStandinClaude(join(TEMP, "standin"), ["echo flood1 stand-in"]);
  process.env.PATH = `${join(TEMP, "standin").replace(/\//g, "\\")};${process.env.PATH}`;
  app = createApp({ root: ROOT, port: PORT, cdp: CDPP, identifier: IDENT, temp: TEMP, suffix: ".flood1", offscreen: true, buildMinutes: 40, log });
  const { profile } = app.paths;
  const seeded = { confirmCloseRunning: false, agentStatusHooks: true, uiLook: "new", agentOptions: { claude: { command: standin } } };
  await app.launch({ prepare: () => { rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true }); writeFileSync(join(profile, "settings.json"), JSON.stringify(seeded, null, 2)); } });
  P = new Page();
  await P.connect();
  await waitFor(() => exists("aside.sidebar"), 30000, 500);
  await dismissFirstRun(app, log);
  if (!(await clickEl("aside.sidebar button.ib", "^Add project"))) { await P.shot("boot-no-add"); throw new Error(`no Add project button; sidebar buttons: ${JSON.stringify(await P.ev(`[...document.querySelectorAll("aside.sidebar button")].map((b) => (b.className + "|" + (b.getAttribute("aria-label") || "") + "|" + (b.title || "") + "|" + b.textContent.trim()).slice(0, 60))`))}; dialogs: ${await P.ev(`[...document.querySelectorAll('[role=dialog]')].map((d) => d.getAttribute("aria-label")).join(",")`)}; vw ${await P.ev("innerWidth")}`); }
  await waitFor(() => exists('[role="dialog"][aria-label="Add project"]'), 5000);
  if (!(await clickEl('[role="dialog"] button', "Type a path"))) throw new Error("no 'Type a path' button");
  await waitFor(() => exists('input[aria-label="project folder"]'), 5000);
  const t = await typeInto('input[aria-label="project folder"]', REPO);
  if (t !== "typed") throw new Error(`project folder field: ${t}`);
  await P.key("Enter", { code: "Enter", vk: 13, text: String.fromCharCode(13) });
  await waitFor(async () => (await countVis(TERM)) >= 1 || (await exists("section.pane.chooser .chooser-foot")), 30000, 300);
  if ((await exists("section.pane.chooser select")) && !(await countVis(TERM))) {
    // The session chooser of a new project: setup only (not a row under test), the value is set the React way.
    await P.ev(`(() => { for (const sel of document.querySelectorAll("section.pane.chooser select")) { const o = [...sel.options].find((x) => x.text.trim() === "Terminal"); if (!o) continue; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, o.value); sel.dispatchEvent(new Event("change", { bubbles: true })); } })()`);
    await waitFor(() => exists("section.pane.chooser .chooser-foot button.btn.primary:not(:disabled)"), 20000);
    await clickEl("section.pane.chooser .chooser-foot button.btn.primary");
  }
  await waitFor(async () => (await countVis(TERM)) >= 1, 30000, 300);
  await sleep(1500);
  await dismissFirstRun(app, log);
  // IPC guard + a log of what the page asked the backend for
  // The internals object is frozen, so the guard sits one layer lower: Tauri's invoke goes out as a fetch to the ipc custom protocol.
  const guard = await P.ev(`(() => {
    window.__v10calls = [];
    const BLOCK = /^(open_external|app_restart|keybindings_(show|write|reload)|plugin:(opener|shell|process)\\|)/;
    const orig = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input?.url ?? String(input);
      const m = /^(?:https?|ipc):\\/\\/(?:ipc\\.)?(?:localhost|tauri\\.localhost)\\/([^?#]+)/.exec(url);
      const looksIpc = /ipc\\.localhost|^ipc:/.test(url);
      if (m && looksIpc) {
        const cmd = decodeURIComponent(m[1]);
        if (!/^plugin:(event|log)/.test(cmd)) {
          const blocked = BLOCK.test(cmd);
          window.__v10calls.push(cmd + (blocked ? " " + String(init?.body ?? "").slice(0, 120) + " [BLOCKED]" : ""));
          if (window.__v10calls.length > 400) window.__v10calls.shift();
          if (blocked) return Promise.resolve(new Response("null", { status: 200, headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } }));
        }
      }
      return orig(input, init);
    };
    return "fetch wrapped";
  })()`);
  await P.ev(`window.__TAURI_INTERNALS__.invoke("v8_probe").catch(() => {})`);
  await sleep(300);
  const probe = await P.ev(`window.__v10calls.slice(-12)`);
  log(`ipc guard: ${guard}; probe recorded: ${JSON.stringify(probe)}`);
  if (!probe.some((c) => /v8_probe/.test(c))) throw new Error("the IPC guard is NOT effective; refusing to click anything that could open a browser, an editor or restart the app");
}
const calls = () => P.ev(`window.__v10calls ? window.__v10calls.splice(0) : []`);

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const openSettings = async () => {
  if (await exists('[role="dialog"][aria-label="Settings"]')) return true;
  await clickEl("aside button[aria-label='Settings']", null, null, 700);
  if (!(await waitFor(() => exists('[role="dialog"][aria-label="Settings"]'), 2500))) { await P.key(",", { code: "Comma", vk: 188, mods: Ctrl }); await sleep(700); }
  return waitFor(() => exists('[role="dialog"][aria-label="Settings"]'), 3000);
};
const openHelpMenu = async () => { if (await exists('[role=menu][aria-label="Help"]')) return true; await clickEl('button.ib[title="Help"]', null, null, 900); return waitFor(() => exists('[role=menu][aria-label="Help"]'), 3000); };
const settingsLinks = () => P.ev(`[...document.querySelectorAll('.settings-link')].filter(e => e.getClientRects().length).map((e, i) => ({ i, n: e.textContent.trim().slice(0, 40), repo: e.classList.contains("repo") }))`);
const gotoSettings = async (re) => {
  if (!(await openSettings())) return null;
  const f = await find(".settings-link", re.source ?? re);
  if (!f) return null;
  await P.clickAt(f.x, f.y);
  await sleep(700);
  return P.ev(`document.querySelector("main.settings-main header h1")?.textContent?.trim() ?? ""`);
};
const closeSettings = async () => { await clickEl('button[aria-label="Close Settings"]', null, null, 500); if (await exists('[role="dialog"][aria-label="Settings"]')) await esc(); };
const explorerState = () => P.ev(`(() => { const e = document.querySelector("aside.explorer, .explorer"); if (!e) return "absent"; const r = e.getBoundingClientRect(); const vis = e.getClientRects().length > 0 && r.width > 0; return (vis ? "visible " : "hidden ") + Math.round(r.width) + "x" + Math.round(r.height) + (vis ? " focusInside=" + e.contains(document.activeElement) : ""); })()`);



// ---------------------------------------------------------------- stress measurements (T1)
const TABLE = `${OUT}/table.md`;
const FORBIDDEN_PIDS = [3392, 34868]; // other sessions' processes: never touched
const MB = (b) => (b / 1048576).toFixed(1);
const LABEL = process.argv.includes("--label") ? process.argv[process.argv.indexOf("--label") + 1] : "run";
const FL = {};
/** Self time per function from a CPU profile, top 25, plus the share of idle / GC / program. */
function summarize(p) {
  const by = new Map(), node = new Map(p.nodes.map((n) => [n.id, n]));
  const dt = p.timeDeltas; let total = 0;
  for (let i = 0; i < p.samples.length; i++) {
    const n = node.get(p.samples[i]); const d = (dt[i + 1] ?? 0) / 1000; total += d;
    const cf = n.callFrame; const url = (cf.url || "").replace(/^.*\/(node_modules\/(?:\.pnpm\/)?)?/, "").replace(/\?.*$/, "");
    const k = `${cf.functionName || "(anon)"} ${url}:${cf.lineNumber + 1}`;
    by.set(k, (by.get(k) ?? 0) + d);
  }
  const top = [...by].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => [k, Math.round(v), +(100 * v / total).toFixed(1)]);
  return { totalMs: Math.round(total), top };
}
let W; // a second CDP socket: a 1 s main-thread block shows as a slow answer to a trivial evaluate
/** GC first, then CDP Performance metrics and the summed working set of the app's process tree. */
async function snap() {
  await P.send("HeapProfiler.collectGarbage").catch(() => {});
  await sleep(400);
  const m = Object.fromEntries(((await P.send("Performance.getMetrics")).result?.metrics ?? []).map((x) => [x.name, x.value]));
  const tree = await app.treeOf(app.pid);
  if (tree.some((t) => FORBIDDEN_PIDS.includes(t.pid))) throw new Error(`a forbidden pid is in the app tree: ${JSON.stringify(tree.filter((t) => FORBIDDEN_PIDS.includes(t.pid)))}`);
  const ids = [app.pid, ...tree.map((t) => t.pid)].join(",");
  const ws = Number(await app.ps(`(Get-Process -Id ${ids} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`)) || 0;
  return { heap: m.JSHeapUsedSize ?? 0, nodes: m.Nodes ?? 0, listeners: m.JSEventListeners ?? 0, docs: m.Documents ?? 0, ws, procs: tree.length + 1, shells: tree.filter((t) => /^(powershell|pwsh)\.exe$/i.test(t.name)).length };
}
const fmt = (s) => `heap ${MB(s.heap)} MB, WS ${MB(s.ws)} MB, nodes ${s.nodes}, listeners ${s.listeners}, procs ${s.procs} (shells ${s.shells})`;
/** Page counters: long tasks (PerformanceObserver) and frames (rAF; an off-screen window may throttle these, so info only). */
const COUNTERS = `(() => {
  if (!window.__st) {
    const s = (window.__st = { lt: 0, ltMax: 0, ltTotal: 0, frames: 0, err: "" });
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { s.lt++; s.ltTotal += e.duration; if (e.duration > s.ltMax) s.ltMax = e.duration; } }).observe({ type: "longtask" }); } catch (e) { s.err = String(e); }
    const f = () => { s.frames++; requestAnimationFrame(f); }; requestAnimationFrame(f);
    window.__stressMark = Date.now();
  }
  return true;
})()`;
const readCounters = () => P.ev(`(() => { const s = window.__st; if (!s) return null; const r = { ...s, vis: document.visibilityState }; s.lt = 0; s.ltMax = 0; s.ltTotal = 0; s.frames = 0; return r; })()`);
let T0 = Date.now();
function startWatch() {
  T0 = Date.now();
  const w = { max: 0, slow: 0, n: 0, dead: 0, on: true };
  w.done = (async () => {
    while (w.on) {
      const t = Date.now();
      const ok = await Promise.race([W.ev("1").then(() => true, () => false), sleep(5000).then(() => false)]);
      const dt = Date.now() - t;
      w.n++;
      if (!ok) w.dead++;
      if (dt > w.max) w.max = dt;
      if (dt > 1000) w.slow++;
      if (dt > 300) (w.slowAt ??= []).push([t - T0, dt]);
      await sleep(200);
    }
  })();
  w.stop = async () => { w.on = false; await w.done; return w; };
  return w;
}
const ctrl = (key, extra = 0) => P.key(key, { code: key.length === 1 ? `Key${key.toUpperCase()}` : key, vk: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0, mods: Ctrl | extra });
const blur = () => P.ev(`document.activeElement?.blur?.(); true`);
const visPanes = () => countVis(TERM);
const visTabs = () => countVis('[role="tab"]');
/** Clicks the n-th shown terminal pane and focuses its input field. */
async function focusNth(i) {
  const r = await P.ev(`(() => { const p = [...document.querySelectorAll(${q(TERM)})].filter((e) => e.offsetParent !== null)[${i}]; if (!p) return null; const b = p.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
  if (!r) return false;
  await P.clickAt(r.x, r.y);
  await sleep(150);
  return P.ev(`(() => { const p = [...document.querySelectorAll(${q(TERM)})].filter((e) => e.offsetParent !== null)[${i}]; const t = p?.querySelector(".xterm-helper-textarea"); t?.focus(); return document.activeElement === t; })()`);
}
const paneText = (i) => P.ev(`(() => { const p = [...document.querySelectorAll(${q(TERM)})].filter((e) => e.offsetParent !== null)[${i}]; if (!p) return null; for (const d of p.querySelectorAll("div")) { const t = d.__koluxTerm; if (t) { const b = t.buffer.active; const out = []; for (let y = Math.max(0, b.length - 400); y < b.length; y++) out.push(b.getLine(y)?.translateToString(true) ?? ""); return out.join("\\n"); } } return null; })()`);
/** Live shells under the app: the ground truth for "closed" (a hidden tab's pane is not on screen, so DOM counts miss it). */
const shellCount = async () => (await app.treeOf(app.pid)).filter((t) => /^(powershell|pwsh)\.exe$/i.test(t.name)).length;
let closeNotes = [];
/** Closes terminals the way a user does — focus the last shown pane, Ctrl+W (tab.close; a focused terminal hands Kolux
 *  chords to the app, not the shell) — until `keep` shells are left. A single-tab split cell has no tab strip, so no x. */
async function closeDownTo(keep) {
  for (let i = 0; i < 80; i++) {
    const before = await shellCount();
    if (before <= keep) break;
    const n = await visPanes();
    if (!(await focusNth(n - 1))) { closeNotes.push(`pane ${n - 1} took no focus`); break; }
    await ctrl("w");
    if (await waitFor(async () => (await exists('[role="alertdialog"]')) ? "ask" : 0, 600, 150)) closeNotes.push(`Ctrl+W asked: ${(await P.ev(`document.querySelector('[role="alertdialog"]')?.textContent?.slice(0, 120)`)) ?? ""}`);
    if (!(await waitFor(async () => ((await shellCount()) < before ? 1 : 0), 8000, 300))) { closeNotes.push(`Ctrl+W left ${before} shells`); break; }
  }
  return shellCount();
}
/** One terminal pane on Terminals, so each scenario starts from the same place. */
async function ensureOnePane() {
  await home();
  if ((await shellCount()) > 1) await closeDownTo(1);
  if ((await visPanes()) === 0) { await blur(); await ctrl("t"); await waitFor(async () => (await visPanes()) >= 1, 15000, 300); }
  return visPanes();
}
function appendRow(id, verdict, text) {
  if (!existsSync(TABLE)) writeFileSync(TABLE, `# Live stress T1 (main 5e481cf2, the 0.1.7 code)\n\nFAIL = heap or working set above 1.5x baseline after teardown + 10 s, a freeze over 1 s, a crash, or a wrong UI.\nBaselines are taken after one warm-up pass, so first-use chunk loads do not count as leaks.\n\n| Scenario | Verdict | Numbers |\n|---|---|---|\n`);
  writeFileSync(TABLE, readFileSync(TABLE, "utf8") + `| ${id} | ${verdict} | ${cell(text)} |\n`);
}
/**
 * One scenario: warm-up (optional), baseline, body under the freeze watch, teardown, home, 10 s, after.
 * body(peak) returns { ok, note }: ok false = a wrong UI; peak() records the load-time numbers.
 */
async function scenario(id, what, { warm, body }) {
  log(`=== ${id}: ${what}`);
  P.drain();
  // 49's finding: one failed ipc.localhost fetch makes Tauri switch to postMessage for good, which blinds the fetch guard. Re-probe before every scenario.
  await P.ev(`window.__TAURI_INTERNALS__.invoke("v8_probe_${id}").catch(() => {})`);
  await sleep(300);
  if (!(await P.ev(`window.__v10calls.some((c) => c === "v8_probe_${id}")`))) throw new Error(`the IPC guard went blind before ${id}; stopping before anything risky`);
  let note = "", ui = true, threw = "";
  try {
    await ensureOnePane();
    if (warm) await warm();
    await ensureOnePane();
    await sleep(2000);
  } catch (e) { threw = `setup threw: ${String(e.message).slice(0, 200)}`; }
  const base = await snap();
  await P.ev(COUNTERS);
  await readCounters();
  const watch = startWatch();
  let load = null;
  const t0 = Date.now();
  if (!threw) {
    try {
      const r = await body(async () => { const pt = Date.now() - T0; load = await snap(); FL.peak = [pt, Date.now() - T0]; });
      ui = r.ok !== false;
      note = r.note ?? "";
    } catch (e) { ui = false; threw = `body threw: ${String(e.stack ?? e.message).slice(0, 300)}`; }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const alive = await app.alive(app.pid).catch(() => false);
  const reloaded = alive ? await P.ev(`!window.__stressMark`).catch(() => true) : true;
  if (alive) { await home().catch(() => {}); await ensureOnePane().catch(() => {}); }
  await sleep(10000);
  const w = await watch.stop();
  FL.slowAt = w.slowAt ?? [];
  FL.watch = { max: w.max, n: w.n, slow: w.slow };
  const c = alive ? await readCounters().catch(() => null) : null;
  const after = alive ? await snap().catch((e) => ({ err: String(e.message) })) : null;
  const errs = P.drain();
  const fails = [];
  if (!alive) fails.push("CRASH: the app process is gone");
  else if (reloaded) fails.push("CRASH/RELOAD: the page lost its marker (it reloaded)");
  if (w.dead) fails.push(`no answer within 5 s on ${w.dead} of ${w.n} probes`);
  if (w.max > 1000) fails.push(`freeze: the main thread took ${w.max} ms to answer (over 1 s ${w.slow}x)`);
  if (after && !after.err) {
    if (after.heap > 1.5 * base.heap) fails.push(`heap ${MB(after.heap)} MB > 1.5x baseline ${MB(base.heap)} MB`);
    if (after.ws > 1.5 * base.ws) fails.push(`working set ${MB(after.ws)} MB > 1.5x baseline ${MB(base.ws)} MB`);
  }
  if (!ui) fails.push(`wrong UI: ${note}`);
  if (threw) fails.push(threw);
  const verdict = fails.length ? "FAIL" : "PASS";
  const text = [
    what,
    `baseline: ${fmt(base)}`,
    load ? `under load: ${fmt(load)}` : "",
    after?.err ? `after: ${after.err}` : after ? `after teardown + 10 s: ${fmt(after)}` : "after: (app gone)",
    `ran ${secs} s; slowest probe ${w.max} ms over ${w.n} probes`,
    c ? `long tasks ${c.lt} (max ${Math.round(c.ltMax)} ms, total ${Math.round(c.ltTotal)} ms), frames ${c.frames}, page ${c.vis}${c.err ? `, observer: ${c.err}` : ""}` : "",
    note && ui ? note : "",
    errs.length ? `PAGE ERRORS (${errs.length}): ${errs.slice(0, 3).join(" // ")}` : "page errors: 0",
    fails.length ? `FAIL because: ${fails.join("; ")}` : "",
  ].filter(Boolean).join(" · ");
  appendRow(id, verdict, text);
  log(`${verdict} ${id} | ${text}`);
  if (verdict === "FAIL") await P.shot(`${id}-fail`).catch(() => {});
  return alive && !reloaded;
}

// ---------------------------------------------------------------- the six scenarios
const STREAM = `$e=(Get-Date).AddSeconds(60); $s='x'*120; $n=0; while((Get-Date) -lt $e){ 1..400 | % { "stress $n $_ $s" }; $n++ }; 'STRESS-DONE'`;
async function s1(peak) {
  // 5 splits from the first pane: right, down, right, down, right (the keymap's terminal-safe chords).
  for (let i = 0; i < 5 && (await visPanes()) < 6; i++) {
    await focusNth((await visPanes()) - 1);
    if (i % 2 === 0) await ctrl("D", Shift); else await P.key("D", { code: "KeyD", vk: 68, mods: 1 | Shift });
    await waitFor(async () => (await visPanes()) > i + 1, 8000, 250);
  }
  const panes = await visPanes();
  if (panes < 6) return { ok: false, note: `only ${panes} terminal panes after 5 splits` };
  await sleep(2500); // the new shells start
  for (let i = 0; i < 6; i++) { if (!(await focusNth(i))) return { ok: false, note: `pane ${i} did not take focus` }; await P.insert(STREAM); await P.key("Enter", ENTER); await sleep(150); }
  FL.listeners = await P.ev("(() => {\n  const L = window.__internal_unstable_listeners_object_id__?.[\"terminal-output\"] ?? {};\n  const C = window.__TAURI_INTERNALS__.callbacks;\n  const s = (window.__fl = { events: 0, calls: 0, chars: 0, maxChars: 0, syncMs: 0, maxSyncMs: 0, listeners: 0, lagMax: 0, lagOver100: 0, lagOver300: [], t0: performance.now() });\n  const seen = new WeakSet();\n  for (const l of Object.values(L)) {\n    const h = l.handlerId, f = C.get(h);\n    if (!f || f.__fl) continue;\n    const w = (d) => {\n      if (!seen.has(d)) { seen.add(d); s.events++; const n = d.payload?.data?.length ?? 0; s.chars += n; if (n > s.maxChars) s.maxChars = n; }\n      const t = performance.now();\n      try { return f(d); } finally { const dt = performance.now() - t; s.calls++; s.syncMs += dt; if (dt > s.maxSyncMs) s.maxSyncMs = dt; }\n    };\n    w.__fl = 1; C.set(h, w); s.listeners++;\n  }\n  let last = performance.now();\n  const tick = () => { const now = performance.now(), lag = now - last - 50; if (lag > s.lagMax) s.lagMax = lag; if (lag > 100) s.lagOver100++; if (lag > 300) s.lagOver300.push([Math.round(now - s.t0), Math.round(lag)]); last = now; if (s.on !== false) setTimeout(tick, 50); };\n  setTimeout(tick, 50);\n  return s.listeners;\n})()");
  FL.injectAt = Date.now() - T0;
  await sleep(8000);
  await P.send("Profiler.enable");
  await P.send("Profiler.setSamplingInterval", { interval: 500 });
  await P.send("Profiler.start");
  await sleep(10000);
  const prof = (await P.send("Profiler.stop")).result?.profile;
  if (prof) { writeFileSync(`${OUT}/s1-${LABEL}.cpuprofile`, JSON.stringify(prof)); FL.profile = summarize(prof); }
  FL.counters = await P.ev("(() => { const s = window.__fl; const r = { ...s, secs: (performance.now() - s.t0) / 1000 }; return r; })()");
  await sleep(10000);
  await peak();
  const done = await waitFor(async () => { let n = 0; for (let i = 0; i < 6; i++) if (/STRESS-DONE/.test((await paneText(i)) ?? "")) n++; return n === 6 ? n : 0; }, 60000, 2000);
  let finished = 0;
  for (let i = 0; i < 6; i++) if (/STRESS-DONE/.test((await paneText(i)) ?? "")) finished++;
  // 57's side question: every split pane, tab strip or not, should show its own header close (TerminalPane .pane-head)
  const heads = await P.ev(`[...document.querySelectorAll(${q(TERM)})].filter((e) => e.offsetParent !== null).map((p) => !!p.querySelector('.pane-head button[title^="Close pane"]')).filter(Boolean).length`);
  FL.end = await P.ev("(() => { const s = window.__fl; if (!s) return null; s.on = false; return { ...s, secs: (performance.now() - s.t0) / 1000 }; })()");
  const left = await closeDownTo(1);
  return { ok: !!done && left === 1 && heads === 6, note: `6 panes streamed ~60 s; ${finished}/6 printed STRESS-DONE; header close shown on ${heads}/6 panes; ${left} shell(s) left after closing the splits${closeNotes.length ? " (" + closeNotes.splice(0).join("; ") + ")" : ""}` };
}
async function s2(peak) {
  // 50 terminal tabs in 5 rounds of 10 (open 10, close 10): 50 shells at once would measure the PC, not the app.
  const tabs0 = await visTabs();
  const bad = [];
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < 10; i++) { await blur(); await ctrl("t"); await sleep(250); }
    const opened = await waitFor(async () => ((await visTabs()) >= tabs0 + 10 ? visTabs() : 0), 15000, 300);
    if (!opened) bad.push(`round ${round + 1}: ${(await visTabs()) - tabs0} of 10 tabs opened`);
    if (round === 4) await peak();
    await closeDownTo(1);
    const back = await visTabs();
    if (back !== tabs0) bad.push(`round ${round + 1}: ${back} tabs after closing (start ${tabs0})`);
  }
  return { ok: bad.length === 0, note: bad.length ? bad.join("; ") : `5 rounds of 10 terminal tabs opened and closed; tab count back to ${tabs0}` };
}
async function s3(peak) {
  const w0 = await P.ev("innerWidth");
  const bad = [];
  for (let i = 0; i < 30; i++) {
    const w = 900 + ((i * 137) % 1000);
    await P.send("Emulation.setDeviceMetricsOverride", { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(120);
    const o = await P.ev(`({ sw: document.documentElement.scrollWidth, iw: innerWidth })`);
    if (o.iw !== w || o.sw > o.iw + 1) bad.push(`w ${w}: viewport ${o.iw}, page ${o.sw} wide`);
  }
  await peak();
  await P.send("Emulation.clearDeviceMetricsOverride");
  await sleep(800);
  const w1 = await P.ev("innerWidth");
  if (w1 !== w0) bad.push(`width ${w1} after clearing (was ${w0})`);
  return { ok: bad.length === 0, note: bad.length ? bad.slice(0, 5).join("; ") : `30 resizes 900-1899 px, no horizontal overflow, width back to ${w0}` };
}
async function openBig() {
  await blur();
  await ctrl("p");
  const field = await waitFor(() => P.ev(`document.activeElement?.tagName === "INPUT"`), 4000);
  if (!field) return "Go to File (Ctrl+P) gave no focused field";
  await P.insert("big.txt");
  await sleep(700);
  await P.key("Enter", ENTER);
  const t = Date.now();
  const ed = await waitFor(() => exists(".cm-editor"), 30000, 250);
  return ed ? Date.now() - t : `no editor after 30 s; page says: ${(await P.ev("document.body.innerText")).slice(0, 160)}`;
}
async function closeEditor() {
  for (let i = 0; i < 3 && (await exists(".cm-editor")); i++) { await P.ev(`document.querySelector(".cm-content")?.focus(); true`); await ctrl("w"); await sleep(600); if (await exists('[role="alertdialog"]')) await esc(); }
  return !(await exists(".cm-editor"));
}
async function s4(peak) {
  const ms = await openBig();
  if (typeof ms === "string") return { ok: false, note: ms };
  const box = await find(".cm-scroller");
  if (!box) return { ok: false, note: "no .cm-scroller" };
  for (let i = 0; i < 80; i++) { await P.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: 4000 }); await sleep(40); }
  await P.ev(`document.querySelector(".cm-content")?.focus(); true`);
  await P.key("End", { code: "End", vk: 35, mods: Ctrl });
  await sleep(800);
  const end = await P.ev(`/line 60000\\b/.test(document.querySelector(".cm-content")?.innerText ?? "")`);
  for (let i = 0; i < 40; i++) { await P.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: -9000 }); await sleep(40); }
  await peak();
  const closed = await closeEditor();
  return { ok: end && closed, note: `big.txt (${MB(BIG.length)} MB, 60000 lines) opened in ${ms} ms; wheel-scrolled 80 down + Ctrl+End${end ? " showed line 60000" : " did NOT show line 60000"}, 40 up; ${closed ? "closed" : "editor still open after Ctrl+W"}` };
}
async function s5(peak) {
  await inject();
  const labels = await P.ev(`[...document.querySelectorAll("nav.switcher button")].filter((b) => b.getClientRects().length).map((b) => b.textContent.trim())`);
  if (!labels.length) return { ok: false, note: "no screen switcher buttons" };
  const bad = [];
  for (let round = 0; round < 20; round++) {
    for (const l of labels) {
      const f = await clickEl("nav.switcher button", `^\\s*${reEsc(l)}\\s*$`, null, 120);
      const now = await screenNow();
      if (!f || !now.includes(l)) bad.push(`round ${round + 1} ${l}: shows ${now || "(none)"}`);
    }
    if (round === 19) await peak();
  }
  return { ok: bad.length === 0, note: bad.length ? `${bad.length} wrong: ${bad.slice(0, 4).join("; ")}` : `${labels.join(", ")}: 20 rounds, every click showed its screen` };
}
const ANYOPEN = `[...document.querySelectorAll('.palette, [role=dialog], [role=menu], [role=alertdialog]')].filter((e) => e.getClientRects().length).length`;
const OPENERS = [
  ["worktree palette (Ctrl+Shift+J)", async () => { await blur(); await ctrl("j", Shift); return waitFor(() => exists('.palette input, [role="dialog"][aria-label="Switch worktree"] input'), 3000); }],
  ["Go to File (Ctrl+P)", async () => { await blur(); await ctrl("p"); return waitFor(() => P.ev(ANYOPEN), 3000); }],
  ["Search open tabs (Ctrl+Shift+K)", async () => { await blur(); await ctrl("k", Shift); return waitFor(() => P.ev(ANYOPEN), 3000); }],
  ["Settings", async () => openSettings()],
  ["Add project", async () => (await clickEl("aside.sidebar button.ib", "^Add project")) && waitFor(() => exists('[role="dialog"][aria-label="Add project"]'), 3000)],
  ["Help menu", async () => openHelpMenu()],
];
async function cycleAll(bad, round) {
  for (const [name, open] of OPENERS) {
    if (!(await open())) { bad.push(`round ${round}: ${name} did not open`); await home(); continue; }
    await sleep(200);
    if (name === "Settings") await closeSettings(); else await esc();
    if (!(await waitFor(async () => (await P.ev(ANYOPEN)) === 0, 2000))) { bad.push(`round ${round}: ${name} still open after its close`); await home(); }
  }
}
async function s6(peak) {
  const bad = [];
  for (let r = 1; r <= 20; r++) await cycleAll(bad, r);
  await peak();
  return { ok: bad.length === 0, note: bad.length ? `${bad.length} wrong: ${bad.slice(0, 4).join("; ")}` : `${OPENERS.map((o) => o[0]).join(", ")}: each opened and closed 20 times` };
}

// ---------------------------------------------------------------- main
const BIG = Array.from({ length: 60000 }, (_, i) => `line ${i + 1} ${"lorem ipsum dolor sit amet ".repeat(3)}`.padEnd(86, ".")).join("\n") + "\n";
let closed = null;
try {
  if (existsSync(TABLE)) rmSync(TABLE);
  await boot();
  if ([app.pid, app.dev?.pid].some((p) => FORBIDDEN_PIDS.includes(p))) throw new Error(`the launched app has a forbidden pid: ${app.pid}/${app.dev?.pid}`);
  await P.send("Performance.enable");
  W = new Page();
  await W.connect();
  if (process.argv.includes("--probe")) {
    // 57: prove each close by hand (count before and after) before any close-dependent row counts
    const st = async (label) => { const s = { label, shells: await shellCount(), panes: await visPanes(), tabs: await visTabs(), xs: await countVis('[role="tab"] button.tab-x'), ask: await exists('[role="alertdialog"]') }; log("PROBE " + JSON.stringify(s)); return s; };
    const out = [await st("start")];
    await blur(); await ctrl("t"); await waitFor(async () => ((await shellCount()) >= 2 ? 1 : 0), 15000, 300); out.push(await st("after Ctrl+T"));
    await focusNth((await visPanes()) - 1); await ctrl("w"); await sleep(3000); out.push(await st("after one Ctrl+W in the focused terminal"));
    await focusNth(0); await ctrl("D", Shift); await waitFor(async () => ((await visPanes()) >= 2 ? 1 : 0), 15000, 300); out.push(await st("after a split (Ctrl+Shift+D)"));
    await focusNth(1); await ctrl("w"); await sleep(3000); out.push(await st("after Ctrl+W in the split pane"));
    await blur(); await ctrl("t"); await waitFor(async () => ((await shellCount()) >= 2 ? 1 : 0), 15000, 300); out.push(await st("after Ctrl+T (two tabs: strip shows)"));
    const f = await P.ev(`(() => { const xs = [...document.querySelectorAll('[role="tab"] button.tab-x')].filter((e) => e.getClientRects().length); const x = xs[xs.length - 1]; if (!x) return null; const b = x.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
    if (f) { await P.clickAt(f.x, f.y); await sleep(3000); }
    out.push(await st(f ? "after clicking the last tab x" : "no tab x shown"));
    writeFileSync(`${OUT}/probe.md`, out.map((o) => JSON.stringify(o)).join("\n") + "\n");
    throw new Error("probe done (no scenarios run)");
  }
  const run = [
    ["S1 6 panes streaming", "6 terminal panes each streaming heavy output for 60 s", { body: s1 }],
    ["S2 50 tabs", "open and close 50 terminal tabs", { warm: async () => { await blur(); await ctrl("t"); await sleep(1500); await closeDownTo(1); }, body: s2 }],
    ["S3 30 resizes", "30 rapid viewport resizes (Emulation.setDeviceMetricsOverride, integer widths 900-1899)", { body: s3 }],
    ["S4 5 MB file", "open a ~5 MB file in the editor and scroll it", { warm: async () => { await openBig(); await closeEditor(); }, body: s4 }],
    ["S5 screens x20", "switch every screen 20 times in a row", { warm: async () => { await s5(async () => {}).catch(() => {}); }, body: s5 }],
    ["S6 dialogs x20", "open and close the palette, Settings and each dialog 20 times; leaked DOM nodes / listeners", {
      warm: async () => { await cycleAll([], 0); },
      body: async (peak) => {
        const b = await snap();
        const r = await s6(peak);
        await home(); await sleep(1500);
        const a = await snap();
        const dn = a.nodes - b.nodes, dl = a.listeners - b.listeners;
        const leak = dn > 200 || dl > 40; // over ~10 nodes or 2 listeners kept per round of 20
        return { ok: r.ok && !leak, note: `${r.note}; after GC: DOM nodes ${b.nodes} -> ${a.nodes} (${dn >= 0 ? "+" : ""}${dn}), listeners ${b.listeners} -> ${a.listeners} (${dl >= 0 ? "+" : ""}${dl})${leak ? " LEAK" : ""}` };
      },
    }],
  ];
  for (const [id, what, s] of run.slice(0, 1)) if (!(await scenario(id, what, s))) { appendRow("(stopped)", "FAIL", `the app crashed or reloaded in ${id}; later scenarios not run`); break; }
} catch (e) { log("ERROR " + (e.stack ?? e.message)); appendRow("(harness)", "NOT-TESTED", `boot or harness error: ${String(e.message).slice(0, 300)}`); }
finally {
  writeFileSync(`${OUT}/flood-${LABEL}.json`, JSON.stringify(FL, null, 1));
  log(`flood ${LABEL}: ${JSON.stringify({ ...FL, profile: FL.profile?.top?.slice(0, 12) })}`);
  await P?.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  closed = await (app ? app.closeApp().catch((e) => [false, String(e.message)]) : [true, "no app"]);
  log(`close: ${JSON.stringify(closed)}`);
  // T-761: dev apps share the real ~/.kolux/keybindings.json; the run must leave it as it found it
  const kbAfter = existsSync(KB) ? statSync(KB).mtimeMs : null;
  log(`keybindings.json mtime before ${kbBefore} after ${kbAfter}: ${kbBefore === kbAfter ? "UNCHANGED" : "CHANGED"}`);
  if (kbBefore !== kbAfter) appendRow("(keybindings)", "FAIL", "the real ~/.kolux/keybindings.json changed during the run (T-761)");
  writeFileSync(`${OUT}/run.log`, lines.join("\n") + "\n");
}
