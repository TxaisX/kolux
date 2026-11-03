// LIVE proof, wave UI lane D (s-57/settings): custom colour themes (Settings > Appearance) and the Claude page (Settings > Claude),
// at window widths 900 / 1400 / 1920 and at 125% / 150% scaling (CDP Emulation.setDeviceMetricsOverride, never the Windows display settings).
// Run:  node evidence/wave-ui-D/live-wave-ui-D.mjs     (from the worktree; hold a slot first: node G:/Dev/kolux-rs-slots/slot.mjs acquire s-57)
// Everything runs from scratch folders under G:/Temp/live-57; the window is kept at X=-12000,Y=-12000 by a PowerShell loop; shots come from CDP.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, run, ps, sleep, waitFor } from "../../scripts/evidence/app-launch.mjs";

for (const k of Object.keys(process.env)) if (k.startsWith("KOLUX_") || k.startsWith("CLAUDE")) delete process.env[k];

const ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]+$/, "").replace(/\\/g, "/");
const OUT = `${ROOT}/evidence/wave-ui-D`;
const BASE = "G:/Temp/live-57";
const TEMP = `${BASE}/run`;
const CLAUDE_CFG = `${BASE}/claude-config`;
const DOWNLOADS = `${BASE}/downloads`;
const PORT = "1477";
const CDP = "9297";
const IDENT = "com.txaisxiong.kolux-rs.live57";
const TARGET_DIR = "G:/Dev/kolux-rs-sessions/target-57";
const SIZE_FILE = `${BASE}/size.txt`;
const MOVER_LOG = `${BASE}/mover.log`;

const results = [];
const logLines = [];
const log = (...a) => {
  const l = a.join(" ");
  console.log(l);
  logLines.push(l);
};
const rec = (check, width, pass, numbers, shot = "") => {
  results.push({ check, width, pass, numbers, shot });
  log(`${pass ? "PASS" : "FAIL"} | ${check} | ${width} | ${numbers} | ${shot}`);
};

// ---------- scratch folders and fake Claude setup ----------
const appTemp = `${TEMP}/tmp`;
const home = `${TEMP}/home`;
const roaming = `${home}/AppData/Roaming`;
const local = `${home}/AppData/Local`;
const profile = `${roaming}/${IDENT}`;
const LONG = "very-long-value-".repeat(14) + "END";
function prepare() {
  rmSync(BASE, { recursive: true, force: true });
  for (const d of [OUT, appTemp, roaming, local, profile, CLAUDE_CFG, DOWNLOADS, `${CLAUDE_CFG}/skills/${"long-skill-name-".repeat(6)}x`, `${CLAUDE_CFG}/agents`, `${BASE}/codex`]) mkdirSync(d, { recursive: true });
  writeFileSync(`${CLAUDE_CFG}/.kolux-rs-scratch`, "");
  writeFileSync(`${profile}/settings.json`, JSON.stringify({ confirmCloseRunning: false }, null, 2));
  writeFileSync(
    `${CLAUDE_CFG}/settings.json`,
    JSON.stringify(
      {
        model: "claude-fake-model-" + "x".repeat(120),
        env: { SHORT: "1", LONG_VALUE: LONG },
        permissions: { allow: ["Read", `Bash(${"npm run very-long-script-name-".repeat(6)}:*)`], ask: ["WebFetch"], deny: [`Read(./${"secret-folder/".repeat(12)}.env)`] },
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo " + LONG + " " + LONG }] }] },
        enabledPlugins: { "fake-plugin@fake-market": true },
      },
      null,
      2,
    ),
  );
  writeFileSync(`${CLAUDE_CFG}/CLAUDE.md`, "# fake memory\n" + "line\n".repeat(50));
  writeFileSync(`${CLAUDE_CFG}/skills/${"long-skill-name-".repeat(6)}x/SKILL.md`, `---\nname: ${"long-skill-name-".repeat(6)}x\ndescription: ${"A deliberately long description that must be cut with an ellipsis and a tooltip. ".repeat(6)}\n---\nbody\n`);
  writeFileSync(`${CLAUDE_CFG}/agents/reviewer.md`, `---\nname: reviewer\ndescription: ${"Reviews code carefully. ".repeat(12)}\n---\nbody\n`);
  const mcp = { mcpServers: { fake: { command: "node", args: ["server.js", LONG], env: { API_KEY: "SHOULD-NOT-SHOW" } }, remote: { type: "http", url: "https://example.invalid/" + "path/".repeat(30), headers: { Authorization: "SHOULD-NOT-SHOW" } } } };
  writeFileSync(`${CLAUDE_CFG}/.claude.json`, JSON.stringify(mcp));
  writeFileSync(`${home}/.claude.json`, JSON.stringify(mcp));
}

// ---------- window mover: every kolux-rs.exe window of THIS build goes to -12000,-12000 (and gets the size in size.txt) ----------
const MOVER_PS = `$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public class WinMove {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static string Apply(HashSet<uint> pids, int x, int y, int w, int h) {
    string note = "";
    EnumWindows((hw, l) => {
      uint pid; GetWindowThreadProcessId(hw, out pid);
      if (!pids.Contains(pid)) return true;
      RECT r; GetWindowRect(hw, out r);
      bool want = w > 0 && h > 0;
      bool off = r.L != x || r.T != y || (want && (r.R - r.L != w || r.B - r.T != h));
      if (off) { SetWindowPos(hw, IntPtr.Zero, x, y, w, h, want ? 0x0014u : 0x0015u); note += "moved " + hw + " from " + r.L + "," + r.T + " " + (r.R - r.L) + "x" + (r.B - r.T) + "; "; }
      return true; }, IntPtr.Zero);
    return note;
  }
}
"@
$dir = '${TARGET_DIR.replace(/\//g, "\\")}'
while ($true) {
  $set = New-Object 'System.Collections.Generic.HashSet[uint32]'
  foreach ($p in Get-Process -Name kolux-rs) { if ($p.Path -and $p.Path.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase)) { [void]$set.Add([uint32]$p.Id) } }
  $w = 0; $h = 0
  if (Test-Path '${SIZE_FILE}') { $t = (Get-Content '${SIZE_FILE}' -Raw).Trim().Split(' '); if ($t.Count -eq 2) { $w = [int]$t[0]; $h = [int]$t[1] } }
  if ($set.Count -gt 0) { $n = [WinMove]::Apply($set, -12000, -12000, $w, $h); if ($n) { Add-Content '${MOVER_LOG}' ((Get-Date).ToString('HH:mm:ss.fff') + ' pids ' + ($set -join ',') + ' ' + $n) } }
  Start-Sleep -Milliseconds 200
}
`;

// ---------- CDP page client ----------
class Page {
  static async connect() {
    const targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
    const t = targets.find((x) => x.type === "page" && /localhost:1477|tauri\.localhost/.test(x.url) && !/tower-window/.test(x.url));
    if (!t) throw new Error("no main page target");
    const p = new Page();
    p.ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((ok, bad) => ((p.ws.onopen = ok), (p.ws.onerror = () => bad(new Error("ws")))));
    p.id = 0;
    p.waiting = new Map();
    p.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && p.waiting.has(m.id)) (p.waiting.get(m.id)(m), p.waiting.delete(m.id));
    };
    return p;
  }
  send(method, params = {}) {
    return new Promise((r) => {
      const i = ++this.id;
      this.waiting.set(i, r);
      this.ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error("page threw: " + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text));
    return r.result?.result?.value;
  }
  async shot(name) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    const file = `${name}.png`;
    writeFileSync(`${OUT}/${file}`, Buffer.from(r.result.data, "base64"));
    return file;
  }
  async key(key, code, vk, mods = 0) {
    const e = { key, code, windowsVirtualKeyCode: vk, modifiers: mods, ...(key === "Enter" ? { text: "\r" } : {}) };
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", ...e });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...e });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

let page;
let app;
let devChild = null;
let viteChild = null;
let moverChild = null;
let appPid = null;

const exists = (sel) => page.eval(`!!document.querySelector(${JSON.stringify(sel)})`);
const until = (what, probe, ms = 15000) => waitFor(what, probe, ms, 250);
const click = async (sel) => {
  const r = await page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return "missing"; e.click(); return "ok"})()`);
  if (r !== "ok") throw new Error("nothing to click at " + sel);
};
const clickText = async (sel, re) => {
  const r = await page.eval(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>${re}.test((x.textContent||"").trim())); if(!e) return "missing"; e.click(); return "ok"})()`);
  if (r !== "ok") throw new Error(`no ${sel} matching ${re}`);
};
const setInput = (sel, value) =>
  page.eval(`(()=>{const i=document.querySelector(${JSON.stringify(sel)}); if(!i) return "missing"; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,${JSON.stringify(value)}); i.dispatchEvent(new Event("input",{bubbles:true})); i.dispatchEvent(new Event("change",{bubbles:true})); return i.value})()`);
const setColour = (key, hex) => setInput(`[data-colour="${key}"] input[type=color]`, hex);
const rootVar = (v) => page.eval(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(v)}).trim().toLowerCase()`);
const previewVar = (v) => page.eval(`(()=>{const e=document.querySelector(".look-preview"); return e? getComputedStyle(e).getPropertyValue(${JSON.stringify(v)}).trim().toLowerCase() : null})()`);

const MEASURE = `(() => {
  const se = document.scrollingElement, main = document.querySelector(".settings-main"), nav = document.querySelector(".settings-nav"), st = document.querySelector(".settings");
  const mr = main ? main.getBoundingClientRect() : null;
  const label = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : "") + ":" + (e.textContent || "").trim().slice(0, 30);
  const spill = [], hscroll = [], silent = [];
  let ellipsed = 0, ellipsedTitled = 0;
  if (main) for (const e of main.querySelectorAll("*")) {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    if (r.width === 0 || r.height === 0 || cs.display === "none" || cs.visibility === "hidden") continue;
    if (e.closest("details:not([open]) > :not(summary)")) continue;
    if ((r.right > mr.right + 1 || r.left < mr.left - 1) && !e.closest(".ct-term, pre, code")) spill.push(label(e) + " r=" + Math.round(r.right) + " mainR=" + Math.round(mr.right));
    if (["auto", "scroll"].includes(cs.overflowX) && e.scrollWidth > e.clientWidth + 1) hscroll.push(label(e) + " " + e.scrollWidth + ">" + e.clientWidth);
    if (e.scrollWidth > e.clientWidth + 1 && cs.textOverflow === "ellipsis") { ellipsed++; const t = (e.getAttribute("title") || e.closest("[title]")?.getAttribute("title") || ""); if (t && t.trim().length >= (e.textContent || "").trim().length) ellipsedTitled++; }
    else if (e.scrollWidth > e.clientWidth + 1 && ["hidden", "clip"].includes(cs.overflowX) && cs.textOverflow !== "ellipsis" && e.children.length === 0 && !e.closest(".ct-term")) silent.push(label(e) + " " + e.scrollWidth + ">" + e.clientWidth);
  }
  return { inner: innerWidth, innerH: innerHeight, dpr: devicePixelRatio, doc: [se.scrollWidth, se.clientWidth], main: main ? [main.scrollWidth, main.clientWidth] : null, nav: nav ? [nav.scrollWidth, nav.clientWidth] : null, settings: st ? [st.scrollWidth, st.clientWidth] : null,
    spill: spill.slice(0, 5), spillN: spill.length, hscroll: hscroll.slice(0, 5), hscrollN: hscroll.length, silent: silent.slice(0, 5), silentN: silent.length, ellipsed, ellipsedTitled };
})()`;

async function measure() {
  const m = await page.eval(MEASURE);
  const noH = m.doc[0] <= m.doc[1] && (!m.main || m.main[0] <= m.main[1]) && (!m.settings || m.settings[0] <= m.settings[1]);
  const txt = `inner ${m.inner}x${m.innerH} dpr ${m.dpr}; doc ${m.doc[0]}<=${m.doc[1]}; .settings-main ${m.main?.[0]}<=${m.main?.[1]}; .settings ${m.settings?.[0]}<=${m.settings?.[1]}; inner h-scrollers ${m.hscrollN}${m.hscrollN ? " " + JSON.stringify(m.hscroll) : ""}`;
  return { m, noH, txt };
}

async function setWidth(css, height = 880) {
  await page.send("Emulation.clearDeviceMetricsOverride");
  const dpr = await page.eval("devicePixelRatio");
  writeFileSync(SIZE_FILE, `${Math.round(css * dpr)} ${Math.round(height * dpr)}`);
  let ok = false;
  try {
    await until(`innerWidth ${css}`, async () => Math.abs((await page.eval("innerWidth")) - css) <= 1, 8000);
    ok = true;
  } catch {}
  if (!ok) {
    await page.send("Emulation.setDeviceMetricsOverride", { width: css, height, deviceScaleFactor: 0, mobile: false });
    log(`NOTE: the real window would not reach ${css} css px (innerWidth ${await page.eval("innerWidth")}); width set by CDP override`);
    await sleep(600);
    return "emulated";
  }
  await sleep(700);
  return "window";
}
const emulate = async (css, dsf, height = 880) => {
  await page.send("Emulation.setDeviceMetricsOverride", { width: css, height, deviceScaleFactor: dsf, mobile: false });
  await sleep(700);
};

// ---------- app start / relaunch / close ----------
const appEnv = () => ({
  ...process.env,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP}`,
  CLAUDE_CONFIG_DIR: CLAUDE_CFG,
  CODEX_HOME: `${BASE}/codex`,
  TEMP: appTemp,
  TMP: appTemp,
  USERPROFILE: home,
  HOME: home,
  APPDATA: roaming,
  LOCALAPPDATA: local,
  CARGO_HOME: process.env.CARGO_HOME ?? join(process.env.USERPROFILE ?? "", ".cargo"),
  RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(process.env.USERPROFILE ?? "", ".rustup"),
  CARGO_TARGET_DIR: TARGET_DIR,
  CARGO_PROFILE_DEV_DEBUG: "0",
  CARGO_INCREMENTAL: "0",
  CARGO_BUILD_JOBS: "2",
});
const portFree = async (p) => !(await ps(`(Get-NetTCPConnection -LocalPort ${p} -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count`)).trim().match(/^[1-9]/);
const findPid = async () => {
  const out = await ps(`$p = Get-Process -Name kolux-rs -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith('${TARGET_DIR.replace(/\//g, "\\")}', [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1; if ($p) { "$($p.Id)|$($p.Path)" }`);
  return out.includes("|") ? out.split("|") : null;
};
let exePath = null;
const dlEvents = [];
let browserWs = null;
async function watchDownloads() {
  try {
    browserWs?.close();
  } catch {}
  const v = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json();
  browserWs = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((ok, bad) => ((browserWs.onopen = ok), (browserWs.onerror = () => bad(new Error("browser ws")))));
  browserWs.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method && /download/i.test(m.method)) dlEvents.push(m.method + " " + JSON.stringify(m.params).slice(0, 200));
    if (m.id === 1) dlEvents.push("setDownloadBehavior -> " + JSON.stringify(m).slice(0, 200));
  };
  browserWs.send(JSON.stringify({ id: 1, method: "Browser.setDownloadBehavior", params: { behavior: "allow", downloadPath: DOWNLOADS.split("/").join("\\"), eventsEnabled: true } }));
  await sleep(300);
}
async function launch() {
  const cfg = `${TEMP}/tauri.dev.json`;
  writeFileSync(cfg, JSON.stringify({ identifier: IDENT, build: { devUrl: `http://localhost:${PORT}`, beforeDevCommand: `pnpm exec vite --port ${PORT} --strictPort` } }));
  const { openSync } = await import("node:fs");
  const out = openSync(`${TEMP}/tauri-dev.log`, "w");
  devChild = spawn(`pnpm -s exec tauri dev --config "${cfg}"`, { cwd: ROOT, shell: true, windowsHide: true, stdio: ["ignore", out, out], env: appEnv() });
  log(`launching: pnpm -s exec tauri dev (identifier ${IDENT}, vite ${PORT}, CDP ${CDP}, target ${TARGET_DIR}); dev pid ${devChild.pid}`);
  await app.pageUp(25 * 60_000);
  const f = await waitFor("the app process", findPid, 30000, 1000);
  appPid = Number(f[0]);
  exePath = f[1];
  log(`app pid ${appPid} (${exePath})`);
  page = await Page.connect();
}
async function closeApp() {
  page?.close();
  try {
    const p = await Page.connect();
    await p.eval(`window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" }).catch(() => {})`).catch(() => {});
    p.close();
  } catch {}
  await waitFor("the app to exit", async () => !(await app.alive(appPid)), 30000, 500).catch(() => log("WARN app did not exit on close"));
  await sleep(1500);
}
async function relaunch() {
  await closeApp();
  // The old window's web view can outlive the app and keep the debug port; a new app would then talk to it. Wait for it to go, then end it.
  const portUp = async () => fetch(`http://127.0.0.1:9297/json/version`).then(() => true, () => false);
  for (let i = 0; i < 20 && (await portUp()); i++) await sleep(1000);
  if (await portUp()) {
    await run("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*com.txaisxiong.kolux-rs.live57*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"]).catch(() => {});
    for (let i = 0; i < 10 && (await portUp()); i++) await sleep(1000);
  }
  const vite = async () => {
    try {
      return (await fetch(`http://localhost:${PORT}/`)).ok;
    } catch {
      return false;
    }
  };
  // tauri dev (and the dev server it started) is shutting down with the old app: end it now and wait for the dev server to go, so the one we start below is the one that stays.
  if (devChild?.pid) await run("taskkill", ["/PID", String(devChild.pid), "/T", "/F"]).catch(() => {});
  for (let i = 0; i < 15 && (await vite()); i++) await sleep(1000);
  if (!(await vite())) {
    const { openSync } = await import("node:fs");
    viteChild = spawn(`pnpm -s exec vite --port ${PORT} --strictPort`, { cwd: ROOT, shell: true, windowsHide: true, stdio: ["ignore", openSync(`${TEMP}/vite.log`, "a"), openSync(`${TEMP}/vite.log`, "a")], env: process.env });
    await waitFor("vite", vite, 60000, 1000);
  }
  const { openSync } = await import("node:fs");
  const o = openSync(`${TEMP}/app.log`, "a");
  const child = spawn(exePath, [], { cwd: `${ROOT}/src-tauri`, windowsHide: true, stdio: ["ignore", o, o], env: appEnv() });
  appPid = child.pid;
  log(`relaunched app pid ${appPid}`);
  await app.pageUp(90_000);
  page = await Page.connect();
  await sleep(1500);
}
async function killMine() {
  for (const pid of [appPid, devChild?.pid, viteChild?.pid, moverChild?.pid]) if (pid) await run("taskkill", ["/PID", String(pid), "/T", "/F"]).catch(() => {});
}

// ---------- settings navigation ----------
// The first-run "Getting Started" guide is modal and covers the screenshots; close it the way a user would (its Close button).
async function dismissGuide() {
  for (let i = 0; i < 6; i++) {
    const r = await page.eval(`(()=>{const sk=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Skip'); if(sk){sk.click(); return true} const b=document.querySelector('.guide[role=dialog] button[title^="Close"], .onb[role=dialog] button[aria-label="Close setup"]'); if(!b) return false; b.click(); return true})()`);
    if (!r) break;
    await sleep(700);
  }
  const left = await page.eval(`document.querySelectorAll('.guide[role=dialog], .onb[role=dialog]').length`);
  if (left) log(`NOTE: ${left} modal guide element(s) still present`);
}
async function openSettings(pageName) {
  await dismissGuide();
  if (!(await exists(".settings[role=dialog]"))) {
    await page.key(",", "Comma", 188, 2);
    await until("the Settings dialog", () => exists('.settings[role=dialog][aria-label="Settings"]'), 10000);
  }
  await clickText(".settings-nav button", new RegExp(`^\\s*${pageName}\\s*$`));
  await sleep(600);
}
const openFolds = () => page.eval(`document.querySelectorAll(".ct-fold").forEach(d => d.open = true)`);
const scrollTo = (sel, block = "start") => page.eval(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({block:${JSON.stringify(block)}})`);
const noteText = () => page.eval(`document.querySelector('[data-section="custom-themes"] [role=status]:not(.ct-chip)')?.textContent ?? ""`);
const swatches = () => page.eval(`[...document.querySelectorAll('[role=radiogroup][aria-label="Colour theme"] button.custom')].map(b => b.getAttribute("aria-label") + (b.getAttribute("aria-checked")==="true"?"*":""))`);
const chips = () => page.eval(`[...document.querySelectorAll(".ct-chip")].map(c => ({ cls: c.className, text: c.textContent.trim() }))`);
const hex = (s) => (s ?? "").toLowerCase();
const diskSettings = () => {
  const f = `${profile}/settings.json`;
  return existsSync(f) ? readFileSync(f, "utf8") : "";
};

// ================= the run =================
async function main() {
  if (!(await portFree(9297)) || !(await portFree(1477))) throw new Error("port 9297 or 1477 is not free; stopping");
  prepare();
  app = createApp({ root: ROOT, port: PORT, cdp: CDP, identifier: IDENT, temp: TEMP, suffix: ".live57", log });
  const moverFile = `${BASE}/mover.ps1`;
  writeFileSync(moverFile, MOVER_PS);
  writeFileSync(MOVER_LOG, "");
  writeFileSync(SIZE_FILE, "");
  moverChild = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", moverFile], { windowsHide: true, stdio: "ignore" });
  log(`mover pid ${moverChild.pid}`);

  await launch();
  await sleep(2500);
  const winPos = readFileSync(MOVER_LOG, "utf8");
  log("mover log so far: " + winPos.replace(/\r?\n/g, " | ").slice(0, 300));
  const ver = await page.eval("navigator.userAgent");
  log("UA " + ver);

  // ---- baseline at 1400 ----
  await setWidth(1400);
  await openSettings("Appearance");
  await until("the theme editor", () => exists('[data-section="custom-themes"]'), 20000);
  const accent0 = await rootVar("--accent");
  const bg0 = await rootVar("--app-bg");
  await scrollTo('[data-section="theme"]');
  let s = await page.shot("01-appearance-default-1400");
  log(`default theme: accent ${accent0}, app-bg ${bg0}; swatches ${JSON.stringify(await swatches())}`);
  rec("A built-in theme leaves --accent unset (only a custom theme that sets one defines it)", "1400", accent0 === "", `--accent on the root with Classic: "${accent0}"`, s);

  // ---- 1. New theme, accent, preview, rename ----
  await clickText('[data-section="custom-themes"] .ct-bar button', /^\s*New theme\s*$/);
  await until("a custom theme to be current", async () => (await swatches()).some((x) => x.endsWith("*")), 8000);
  await sleep(800);
  const prevAccentBefore = await previewVar("--accent");
  await scrollTo('[data-section="theme"]');
  s = await page.shot("02-new-theme-1400");
  const created = await swatches();
  rec("New theme creates a custom theme and selects it", "1400", created.length === 1 && created[0].endsWith("*"), `swatches ${JSON.stringify(created)}; note "${await noteText()}"`, s);

  const NEW_ACCENT = "#ff3366";
  await setColour("accent", NEW_ACCENT);
  await sleep(1200);
  const rootAcc = await rootVar("--accent");
  const prevAcc = await previewVar("--accent");
  await scrollTo('[data-section="theme"]');
  s = await page.shot("03-accent-changed-1400");
  rec("Changing the accent updates the live preview and the whole window", "1400", prevAcc === NEW_ACCENT && rootAcc === NEW_ACCENT && prevAccentBefore !== NEW_ACCENT, `preview --accent ${prevAccentBefore} -> ${prevAcc}; window --accent ${accent0} -> ${rootAcc}`, s);

  await page.eval(`document.querySelector('input[aria-label="Theme name"]').focus()`);
  await setInput('input[aria-label="Theme name"]', "Live Proof Theme");
  await page.key("Enter", "Enter", 13);
  await sleep(1200);
  const afterRename = await swatches();
  s = await page.shot("04-renamed-1400");
  rec("Rename applies (swatch label, note)", "1400", afterRename.includes("Live Proof Theme*"), `swatches ${JSON.stringify(afterRename)}; note "${await noteText()}"`, s);

  await until("the theme on disk", () => /Live Proof Theme/.test(diskSettings()) && /ff3366/i.test(diskSettings()), 15000).catch(() => {});
  const disk = diskSettings();
  rec("Saved theme is written to the profile's settings.json", "1400", /Live Proof Theme/.test(disk) && /ff3366/i.test(disk), `settings.json ${disk.length} bytes; has name ${/Live Proof Theme/.test(disk)}; has #ff3366 ${/ff3366/i.test(disk)}`);

  // ---- reload app: persistence ----
  await relaunch();
  await setWidth(1400);
  await watchDownloads();
  const accentBoot = await rootVar("--accent");
  const bootHasSettings = await exists(".settings");
  await dismissGuide();
  s = await page.shot("05-after-restart-main-1400");
  rec("After a full app restart the saved theme is applied at start-up (before Settings is opened)", "1400", accentBoot === NEW_ACCENT && !bootHasSettings, `--accent at boot ${accentBoot} (expected ${NEW_ACCENT}); settings open at boot ${bootHasSettings}`, s);
  await openSettings("Appearance");
  await until("the theme editor", () => exists('[data-section="custom-themes"]'), 20000);
  const sw2 = await swatches();
  const nameField = await page.eval(`document.querySelector('input[aria-label="Theme name"]')?.value`);
  await scrollTo('[data-section="theme"]');
  s = await page.shot("06-after-restart-settings-1400");
  rec("After restart Settings shows the theme selected with its name", "1400", sw2.includes("Live Proof Theme*") && nameField === "Live Proof Theme", `swatches ${JSON.stringify(sw2)}; name field "${nameField}"`, s);

  // ---- low contrast ----
  await openFolds();
  const LOW = "#444444";
  await setColour("fg", LOW);
  await sleep(1200);
  const ch = await chips();
  const low = ch.filter((c) => /low/.test(c.cls));
  await scrollTo(".ct-chips", "center");
  s = await page.shot("07-low-contrast-warning-1400");
  rec("Low-contrast text colour shows the warning chip (below 4.5:1)", "1400", low.length > 0 && low.every((c) => /below 4\.5:1/.test(c.text)), `text ${LOW}; chips ${JSON.stringify(ch.map((c) => c.text))}`, s);

  // ---- width sweep with the warning visible ----
  for (const w of [900, 1400, 1920]) {
    const how = await setWidth(w);
    await openFolds();
    await scrollTo('[data-section="custom-themes"]');
    await sleep(300);
    const { m, noH, txt } = await measure();
    const cut = m.spillN === 0 && m.silentN === 0;
    s = await page.shot(`08-appearance-editor-${w}`);
    rec("Appearance + theme editor: no horizontal scroll", String(w), noH && m.hscrollN === 0 && m.inner === w, `${txt} (${how})`, s);
    rec("Appearance + theme editor: nothing cut off", String(w), cut, `elements past the content edge ${m.spillN} ${JSON.stringify(m.spill)}; silently clipped text ${m.silentN} ${JSON.stringify(m.silent)}`, s);
    await scrollTo(".ct-chips", "center");
    await page.shot(`09-appearance-warning-${w}`);
  }
  // ---- scaling at 1400 ----
  await setWidth(1400);
  for (const dsf of [1.25, 1.5]) {
    for (const css of [1400, Math.round(1400 / dsf)]) {
      await emulate(css, dsf);
      await openFolds();
      await scrollTo('[data-section="custom-themes"]');
      const { m, noH, txt } = await measure();
      s = await page.shot(`10-appearance-editor-${Math.round(dsf * 100)}pct-css${css}`);
      rec(`Appearance + theme editor at ${Math.round(dsf * 100)}% scaling${css === 1400 ? "" : " (effective css width = 1400/" + dsf + ")"}: no horizontal scroll, nothing cut off`, `${css} css, x${dsf}`, noH && m.hscrollN === 0 && m.spillN === 0 && m.silentN === 0, `${txt}; spill ${m.spillN}; silent ${m.silentN}`, s);
    }
  }
  await page.send("Emulation.clearDeviceMetricsOverride");
  await setWidth(1400);

  // ---- Fix button ----
  await scrollTo(".ct-chips", "center");
  let fixClicks = 0;
  for (let i = 0; i < 4 && (await exists(".ct-chip.low .ct-fix")); i++) {
    await clickText(".ct-chip.low .ct-fix", /Fix/);
    fixClicks++;
    await sleep(1000);
  }
  const ch2 = await chips();
  s = await page.shot("11-after-fix-1400");
  rec("The Fix button lifts the text above 4.5:1 and the warning goes", "1400", !ch2.some((c) => /low/.test(c.cls)), `Fix clicked ${fixClicks} time(s) (each failing chip has its own button); chips after ${JSON.stringify(ch2.map((c) => c.text))}`, s);

  // ---- export: the system Save dialog (theme_export_save), driven through UI Automation ----
  await page.eval(`window.__saveCalls = []; const inv = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__); window.__TAURI_INTERNALS__.invoke = (cmd, args, o) => { if (cmd === "theme_export_save") window.__saveCalls.push({ cmd, name: args && args.name, text: args && args.text }); return inv(cmd, args, o); }; true`);
  await scrollTo('[data-section="custom-themes"] .ct-head');
  const wanted = "kolux-theme-live-proof-theme.json";
  const target = `${DOWNLOADS}/${wanted}`.split("/").join("\\");
  rmSync(`${DOWNLOADS}/${wanted}`, { force: true });
  await clickText('[data-section="custom-themes"] .ct-head button', /^\s*Export\s*$/);
  const dlgRun = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-File", join(OUT, "save-dialog.ps1"), "-Path", target], { encoding: "utf8", timeout: 60000 });
  const dlg = `${dlgRun.stdout ?? ""} ${dlgRun.stderr ?? ""} exit ${dlgRun.status}`;
  log(`save dialog: ${dlg.replace(/\s+/g, " ")}`);
  try {
    await until("the saved file", () => existsSync(`${DOWNLOADS}/${wanted}`) && statSync(`${DOWNLOADS}/${wanted}`).size > 0, 12000);
  } catch {}
  await sleep(800);
  const calls = await page.eval(`window.__saveCalls`);
  const expNote = await noteText();
  // The system dialog opens in the folder it last used and a script cannot reliably retype its file name box, so the dialog is confirmed as offered (its suggested name) and the app's own note says where the file went. That file is read, copied to the downloads folder for the import step, and removed from where the dialog put it.
  const savedAt = (/Saved the theme to (.+).$/.exec(expNote) ?? [])[1] ?? "";
  let where = "";
  if (savedAt && existsSync(savedAt) && savedAt.endsWith(wanted)) {
    copyFileSync(savedAt, `${DOWNLOADS}/${wanted}`);
    rmSync(savedAt, { force: true });
    where = `${DOWNLOADS}/${wanted}`;
  }
  const onDisk = where ? readFileSync(where, "utf8") : null;
  const blobText = calls?.[0]?.text ?? null;
  let parsed = null;
  try {
    parsed = JSON.parse(onDisk ?? "");
  } catch {}
  s = await page.shot("12-exported-1400");
  rec("Export opens the system Save dialog and writes the theme file", "1400", /dialog found/.test(dlg) && /exit 0/.test(dlg) && !!parsed && parsed.format === "kolux-theme" && parsed.name === "Live Proof Theme" && parsed.overrides?.accent === "#ff3366", `dialog "${dlg.replace(/\s+/g, " ")}"; the app said it saved to ${savedAt || "nowhere"}; file ${where || "NOT FOUND"}; ${onDisk?.length ?? 0} bytes; keys ${parsed ? Object.keys(parsed).join(",") : "none"}; accent ${parsed?.overrides?.accent}; sent text matched file ${blobText === onDisk}; note "${expNote.slice(0, 120)}"`, s);
  if (onDisk) writeFileSync(`${OUT}/exported-theme-sample.json`, onDisk);
  const importPath = where;

  // ---- import ----
  const doc = await page.send("DOM.getDocument", {});
  const q = await page.send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: 'input[aria-label="Theme file to import"]' });
  await page.send("DOM.setFileInputFiles", { files: [importPath.replace(/\//g, "\\")], nodeId: q.result.nodeId });
  await sleep(1800);
  const sw3 = await swatches();
  const impNote = await noteText();
  await scrollTo('[data-section="theme"]');
  s = await page.shot("13-imported-1400");
  rec("Import brings the file back as a second theme", "1400", sw3.length === 2 && sw3.some((x) => /^Live Proof Theme 2/.test(x)), `swatches ${JSON.stringify(sw3)}; note "${impNote}"`, s);

  // ---- delete the imported one (it is current), reset, delete the original ----
  await clickText('[data-section="custom-themes"] .ct-head button', /^\s*Delete\s*$/);
  await sleep(300);
  s = await page.shot("14-delete-confirm-1400");
  await clickText('[data-section="custom-themes"] .ct-head button', /^\s*Delete .*Live Proof Theme 2/);
  await sleep(1200);
  const sw4 = await swatches();
  rec("Delete (with confirm) removes the imported theme", "1400", sw4.length === 1 && !sw4.some((x) => /Live Proof Theme 2/.test(x)), `swatches ${JSON.stringify(sw4)}; note "${await noteText()}"`, s);

  await page.eval(`document.querySelector('[role=radiogroup][aria-label="Colour theme"] button.custom')?.click()`);
  await sleep(1000);
  const accentSel = await rootVar("--accent");
  await clickText('[data-section="custom-themes"] .ct-bar button', /^\s*Reset to default\s*$/);
  await sleep(1500);
  const accentReset = await rootVar("--accent");
  const sw5 = await swatches();
  const checkedBuiltin = await page.eval(`document.querySelector('[role=radiogroup][aria-label="Colour theme"] button[aria-checked=true]')?.getAttribute("aria-label")`);
  await scrollTo('[data-section="theme"]');
  s = await page.shot("15-reset-1400");
  rec("Reset to default returns to Classic and keeps the saved theme in the list", "1400", accentReset === accent0 && accentSel !== accentReset && sw5.length === 1 && checkedBuiltin === "Classic", `--accent ${accentSel} -> ${accentReset} (default was ${accent0}); checked "${checkedBuiltin}"; swatches ${JSON.stringify(sw5)}; note "${await noteText()}"`, s);

  await page.eval(`document.querySelector('[role=radiogroup][aria-label="Colour theme"] button.custom')?.click()`);
  await sleep(800);
  await clickText('[data-section="custom-themes"] .ct-head button', /^\s*Delete\s*$/);
  await sleep(300);
  await clickText('[data-section="custom-themes"] .ct-head button', /^\s*Delete Live Proof/);
  await sleep(1500);
  const sw6 = await swatches();
  const diskEnd = diskSettings();
  await scrollTo('[data-section="theme"]');
  s = await page.shot("16-all-deleted-1400");
  rec("Deleting the last theme empties the list and the file", "1400", sw6.length === 0 && !/Live Proof Theme/.test(diskEnd), `swatches ${JSON.stringify(sw6)}; name still in settings.json ${/Live Proof Theme/.test(diskEnd)}; --accent ${await rootVar("--accent")}`, s);

  // ---- Claude page ----
  await openSettings("Claude");
  let loaded = true;
  try {
    await until("the Claude page to load", async () => (await exists('.settings-main [data-section="model"]')) && !(await page.eval(`/Reading the Claude setup/.test(document.querySelector(".settings-main").textContent)`)), 20000);
  } catch {
    loaded = false;
  }
  const info = await page.eval(`(()=>{const m=document.querySelector(".settings-main"); const alert=m.querySelector('[role=alert]'); return { alert: alert?.textContent ?? null, sections: [...m.querySelectorAll("[data-section]")].map(e=>e.dataset.section), opens: [...m.querySelectorAll("button")].filter(b=>/^Open/.test(b.textContent.trim())).map(b=>b.title), text: m.textContent.length, secretLeak: /SHOULD-NOT-SHOW/.test(m.textContent) } })()`);
  const inScratch = info.opens.length > 0 && info.opens.every((p) => /live-57/i.test(p.replace(/\\/g, "/")));
  s = await page.shot("20-claude-page-1400");
  rec("Settings > Claude loads with no error", "1400", loaded && !info.alert && info.sections.length >= 8, `alert ${JSON.stringify(info.alert)}; sections ${info.sections.join(",")}; text ${info.text} chars`, s);
  rec("Claude page reads only the scratch config; open-file buttons carry scratch paths; secrets hidden", "1400", inScratch && !info.secretLeak, `${info.opens.length} Open buttons; paths e.g. ${JSON.stringify(info.opens.slice(0, 3))}; secret values shown: ${info.secretLeak}`, s);
  const rows = await page.eval(`(()=>{const m=document.querySelector(".settings-main"); const r=[...m.querySelectorAll("[data-source]")]; return { n: r.length, tip: r.filter(e=>e.title==="Set in "+e.dataset.source).length, open: r.filter(e=>[...e.querySelectorAll("button")].some(b=>b.textContent.trim()==="Open"&&b.title===e.dataset.source)).length, sample: r.slice(0,2).map(e=>e.title) } })()`);
  rec("Claude page: each setting row has its source file as a tooltip and an Open button for that file", "1400", rows.n > 0 && rows.tip === rows.n && rows.open === rows.n && rows.sample.every((t) => /live-57/i.test(t)), `${rows.n} rows; ${rows.tip} with a "Set in <file>" tooltip; ${rows.open} with an Open button for the same file; e.g. ${JSON.stringify(rows.sample)}`, s);
  for (const w of [900, 1400, 1920]) {
    const how = await setWidth(w);
    await page.eval(`document.querySelectorAll(".settings-main details").forEach(d => d.open = true); document.querySelector(".settings-main").scrollTop = 0`);
    await sleep(400);
    const { m, noH, txt } = await measure();
    s = await page.shot(`21-claude-top-${w}`);
    await page.eval(`document.querySelector(".settings-main").scrollTop = 99999`);
    await page.shot(`22-claude-bottom-${w}`);
    await page.eval(`document.querySelector(".settings-main").scrollTop = 0`);
    rec("Claude page: no horizontal scroll", String(w), noH && m.hscrollN === 0 && m.inner === w, `${txt} (${how})`, s);
    rec("Claude page: nothing cut off", String(w), m.spillN === 0 && m.silentN === 0, `elements past the content edge ${m.spillN} ${JSON.stringify(m.spill)}; silently clipped text ${m.silentN} ${JSON.stringify(m.silent)}`, s);
    rec("Claude page: long values truncate with an ellipsis and a full-text tooltip", String(w), m.ellipsed > 0 && m.ellipsedTitled === m.ellipsed, `${m.ellipsed} elements truncated, ${m.ellipsedTitled} of them with a title tooltip holding the full text`, s);
  }
  await setWidth(1400);
  for (const dsf of [1.25, 1.5]) {
    for (const css of [1400, Math.round(1400 / dsf)]) {
      await emulate(css, dsf);
      await page.eval(`document.querySelector(".settings-main").scrollTop = 0`);
      const { m, noH, txt } = await measure();
      s = await page.shot(`23-claude-${Math.round(dsf * 100)}pct-css${css}`);
      rec(`Claude page at ${Math.round(dsf * 100)}% scaling${css === 1400 ? "" : " (effective css width = 1400/" + dsf + ")"}: no horizontal scroll, nothing cut off`, `${css} css, x${dsf}`, noH && m.hscrollN === 0 && m.spillN === 0 && m.silentN === 0, `${txt}; spill ${m.spillN}; silent ${m.silentN}; truncated ${m.ellipsed}/${m.ellipsedTitled} titled`, s);
    }
  }
  await page.send("Emulation.clearDeviceMetricsOverride");

  // ---- tooltip really shows (hover) ----
  const tip = await page.eval(`(()=>{const e=[...document.querySelectorAll(".settings-main [title]")].find(x=>x.scrollWidth>x.clientWidth+1 && getComputedStyle(x).textOverflow==="ellipsis"); return e? {title: e.title.length, text: e.textContent.length} : null})()`);
  log("tooltip sample: " + JSON.stringify(tip));

  const moverLog = readFileSync(MOVER_LOG, "utf8");
  const lines = moverLog.split(/\r?\n/).filter(Boolean);
  rec("Window stayed off-screen (mover loop)", "-", lines.length > 0, `mover log ${lines.length} move events; first: ${lines[0]?.slice(0, 160)}; last: ${lines.at(-1)?.slice(0, 160)}`);
}

let failed = null;
try {
  await main();
} catch (e) {
  failed = e;
  log("ERROR " + (e.stack ?? e));
  try {
    if (page) await page.shot("99-error-state");
  } catch {}
}
await killMine();
const rows = results.map((r) => `| ${r.check} | ${r.width} | ${r.pass ? "PASS" : "FAIL"} | ${r.numbers.replace(/\|/g, "/")} | ${r.shot ? "`" + r.shot + "`" : ""} |`).join("\n");
writeFileSync(
  `${OUT}/RESULT.md`,
  `# Wave UI D: live proof of s-57/settings (custom themes + Settings > Claude)\n\nRun ${new Date().toISOString()}; command: \`node evidence/wave-ui-D/live-wave-ui-D.mjs\` from ${ROOT}\n\nScratch: ${BASE} (CLAUDE_CONFIG_DIR=${CLAUDE_CFG}); vite ${PORT}, CDP ${CDP}; window kept at -12000,-12000; shots via Page.captureScreenshot.\n${failed ? `\n**RUN ABORTED:** ${String(failed.message).slice(0, 300)}\n` : ""}\n| Check | Width / scale | Result | Measured | Screenshot |\n|---|---|---|---|---|\n${rows}\n\n## Log\n\n\`\`\`\n${logLines.join("\n").slice(0, 20000)}\n\`\`\`\n`,
);
console.log(`RESULT.md written; ${results.filter((r) => r.pass).length} pass, ${results.filter((r) => !r.pass).length} fail`);
process.exit(failed ? 1 : 0);
