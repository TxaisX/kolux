// perf-webview runtime proofs, run against the dev app launched by wv.mjs. Writes a log and frames under
// EVID. usage: node proof.mjs all | vis | tab
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Where wv.mjs and frames.ps1 live (the harness folder) and where the log and frames go:
// PERF_WEBVIEW_HARNESS and PERF_WEBVIEW_EVIDENCE, or this file's own folder for both.
const HERE = dirname(fileURLToPath(import.meta.url));
const SP = process.env.PERF_WEBVIEW_HARNESS ?? HERE;
const WV = join(SP, "wv.mjs");
const EVID = process.env.PERF_WEBVIEW_EVIDENCE ?? HERE;
const LOG = join(EVID, "runtime-proof.log");
const PAGE = "http://127.0.0.1:18090/counter.html";
const TAB = 9901;
mkdirSync(EVID, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (file, a) => new Promise((res) => execFile(file, a, { maxBuffer: 1 << 26 }, (e, stdout, stderr) => res({ code: e?.code ?? 0, out: String(stdout).trim(), err: String(stderr).trim() })));
const wv = async (...a) => (await run("node", [WV, ...a])).out;
const ev = async (js) => wv("eval", js);
const tab = async (js) => wv("tabeval", "127.0.0.1:18090", js);
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (s) => { const line = `[${stamp()}] ${s}`; console.log(line); appendFileSync(LOG, line + "\n"); };
const pid = () => JSON.parse(readFileSync(join(SP, "wv-temp/state.json"), "utf8")).pid;
const renderers = async () => (await wv("renderers")).split(/\r?\n/).filter(Boolean);
const invoke = (cmd, args) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}).then(() => "ok", (e) => "ERR " + String(e))`);

async function vis() {
  log("== item 1/2/4: main view out of sight ==");
  log("visibilityState shown: " + (await ev("document.visibilityState")));
  log("marker set: " + (await ev("(window.__pwMark = 'before-minimise', window.__pwMark)")));
  log("renderers before minimise: " + JSON.stringify(await renderers()));
  log("minimize: " + (await wv("minimize")));
  await sleep(1500);
  log("visibilityState minimised (1.5 s): " + (await ev("document.visibilityState")) + " hidden=" + (await ev("document.hidden")));
  await sleep(60_000);
  log("renderers 60 s minimised: " + JSON.stringify(await renderers()));
  log("visibilityState minimised (60 s): " + (await ev("document.visibilityState")));
  await sleep(65_000);
  log("renderers 125 s minimised (memory LOW should be in effect since ~60 s): " + JSON.stringify(await renderers()));
  const frames = await run("powershell", ["-NoProfile", "-NonInteractive", "-File", join(SP, "frames.ps1"), "-ProcId", String(pid()), "-Out", join(EVID, "restore-frame"), "-Hwnd", await wv("hwnd")]);
  log("restore frames:\n" + frames.out + (frames.err ? "\nERR " + frames.err : ""));
  log("visibilityState restored: " + (await ev("document.visibilityState")));
  log("first paint after restore (rAF within): " + (await ev("new Promise(r => { const t = performance.now(); requestAnimationFrame(() => r((performance.now() - t).toFixed(0) + ' ms')); setTimeout(() => r('no frame in 1000 ms'), 1000); })")));
  log("marker after restore (same page, no reload): " + (await ev("window.__pwMark")));
  await sleep(3000);
  log("renderers 3 s after restore (memory NORMAL): " + JSON.stringify(await renderers()));
}

async function tabProof() {
  log("== item 3: hidden tab suspended ==");
  log("open tab: " + (await invoke("browser_open", { id: TAB, url: PAGE, spot: { x: 40, y: 80, w: 500, h: 300 }, background: null, shown: true, profile: null, rebuild: null })));
  await sleep(4000);
  log("targets: " + (await wv("targets")).replace(/\r?\n/g, " || "));
  log("counter running: " + (await tab("window.n")) + " then " + (await (sleep(1000), tab("window.n"))));
  log("typed into input: " + (await tab("(document.getElementById('f').value = 'kept while suspended', document.getElementById('f').value)")));
  const n0 = Number(await tab("window.n"));
  log("hide tab: " + (await invoke("browser_bounds", { id: TAB, spot: { x: 0, y: 0, w: 0, h: 0 }, shown: false, background: null })) + " n0=" + n0);
  log("renderers right after hide: " + JSON.stringify(await renderers()));
  await sleep(30_000);
  log("30 s hidden (not yet suspended, counter still running): n=" + (await tab("window.n")));
  await sleep(60_000);
  log("90 s hidden; suspended since ~60 s, so n should sit near n0+600: n=" + (await Promise.race([tab("window.n"), sleep(5000).then(() => "no answer in 5 s")])));
  log("renderers 90 s hidden: " + JSON.stringify(await renderers()));
  const tShow = Date.now();
  log("show tab: " + (await invoke("browser_bounds", { id: TAB, spot: { x: 40, y: 80, w: 500, h: 300 }, shown: true, background: null })));
  const n1 = Number(await tab("window.n"));
  const input = await tab("document.getElementById('f').value");
  log(`after show: n1=${n1} (n1-n0=${n1 - n0}; unsuspended would be ~900, suspended at 60 s gives ~600), input='${input}'`);
  await sleep(2000);
  const n2 = Number(await tab("window.n"));
  log(`2 s later: n2=${n2} (counting again: ${n2 > n1}) show->eval took ${Date.now() - tShow} ms total`);
  log("close tab: " + (await invoke("browser_close", { id: TAB })));
}

const what = process.argv[2] ?? "all";
writeFileSync(LOG, `perf-webview runtime proofs ${new Date().toISOString()} pid=${pid()}\n`, { flag: "a" });
if (what === "all" || what === "vis") await vis();
if (what === "all" || what === "tab") await tabProof();
log("done " + what);
