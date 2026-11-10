// S11 footprint: what the app itself costs, per phase, so a fix lane can re-run this AFTER and diff against a BEFORE file.
// "The app" = the window kolux-rs.exe, the detached terminal service kolux-rs.exe (--terminal-service; only present with
// KOLUX_TERMINAL_SERVICE=1 since DT-C27, so normally absent and the panes' ptys live in the window process) and every msedgewebview2.exe
// under the window. Shells, conhost and agents in the panes are NOT the app. Per process role it records working set MB, private MB,
// CPU (% of one core and % of the whole machine, averaged over the window) and GPU process memory; per phase also the page's JS heap,
// canvas count and document.visibilityState. Phases (each: a settle period, then a sampling window):
//   a idle, 1 shell pane   b 6 idle panes   c 6 panes each printing ~20 lines/s   d 12 idle panes, window minimized (runs after e)   e 12 idle panes
//   f 12 panes + 3 embedded browser tabs (a page on this machine's network address, so the loopback exemption does not apply) hidden by
//     switching to a terminal tab
// d and f are hidden phases: a short sample 10 s after the hide ("early", before the 30 s / 60 s give-back timers of DT-C229, DT-C236, DT-C237)
// for contrast, then the settle runs until --settle-hidden seconds after the hide and the sampling window follows (so it sees the state
// after the memory-LOW point at 60 s and the browser-tab suspension at 60 s). The page in f counts its own timer ticks on the local
// server (1 per second per tab while awake, 0 once the page is suspended): "hidden tab page ticks/s" in the report.
// Build: the debug dev build by default (pnpm tauri dev, the web view loads the vite dev server); --release runs the shipped build
// (pnpm tauri build --no-bundle, see lib.mjs). The build kind is in the json ("build", "buildKind") and the txt.
// --repeat N runs the whole scenario N times, each on a fresh app launch, and reports the MEDIAN per metric (min and max beside it);
// the json "phases" hold the medians (same shape as a single run, so an older single-run file still compares), "runs" the raw repeats.
// Output: the table in evidence/stress-s11-<sha>.txt (written by run.mjs) and evidence/stress-s11-<sha>.json (machine-readable).
// Options: --window 60 (seconds sampled per phase) --settle 20 --settle-hidden 70 --repeat 1
//          --compare <before.json> (prints per-phase deltas of the medians against a BEFORE run)
//          --tag <text> (appended to the json/txt file names, e.g. release-after, so a second run does not overwrite the first).
// This scenario measures only; its checks are "ran to the end, the panes were there, the app's processes were found".
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { FOOTPRINT_ROLES, PAGE_STATS_JS, TERM, addProjectAndOpen, fmt, footprint, gitInit, removeTemp, seedOnboardingDone, seedProfile, nudgeWindow, restoreWindow, showWindow, slash, typeInto } from "./lib.mjs";

export const title = "app footprint (idle, 6 panes, streaming, 12 panes, minimized, hidden browser tabs)";
// The first-run wizard is marked done in the seed (see seedOnboardingDone): idle numbers must not include its pulsing dots.
export const seed = (app, settings) => {
  const base = seedProfile(app, settings);
  return () => {
    base();
    seedOnboardingDone(app.paths.profile);
  };
};
const argv = process.argv.slice(2);
const opt = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const WINDOW_S = Number(opt("window", 60));
const SETTLE_S = Number(opt("settle", 20));
const SETTLE_HIDDEN_S = Number(opt("settle-hidden", 70));
const REPEAT = Math.max(1, Math.floor(Number(opt("repeat", 1))));
const EARLY_AT_S = 10; // the short contrast sample starts this long after a hide ...
const EARLY_S = 10; // ... and lasts this long
const COMPARE = opt("compare", null);
const TAG = opt("tag", "");
const unwrap = (v) => (v && typeof v === "object" && "result" in v && v.result && "value" in v.result ? v.result.value : v);
const PHASE_ORDER = ["a", "b", "c", "d", "e", "f"];

// ~20 lines per second like an agent working; exits when the stop file appears (no key needs to reach the pane).
const STREAM_JS = `const fs = require("fs");
const stop = process.argv[3];
fs.writeFileSync(stop + "." + process.argv[2] + ".started", "1");
let i = 0;
const t = setInterval(() => {
  if (fs.existsSync(stop)) { clearInterval(t); return; }
  i++;
  const body = "stream " + process.argv[2] + " line " + i + " " + "abcdefghij".repeat(5);
  console.log(i % 20 === 0 ? "\\x1b[32m" + body + "\\x1b[0m" : body);
}, 50);
`;

// ---------- statistics over repeats ----------
const median = (v) => {
  const a = v.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const lo = (v) => Math.min(...v.filter(Number.isFinite));
const hi = (v) => Math.max(...v.filter(Number.isFinite));
const METRICS = ["n", "wsMB", "privMB", "cpuCorePct", "cpuTotalPct", "gpuDedMB", "gpuSharedMB", "gpuCommitMB", "gpuEngPct", "handles", "threads"];
const PAGE_METRICS = ["jsHeapUsedMB", "jsHeapTotalMB", "canvases", "panes", "shownPanes", "domNodes"];
// Median and min/max of one sampled window across the repeats: { fp (same shape as footprint()), spread: {role: {metric: [min, max]}} }.
function aggFp(fps) {
  const perRole = {};
  const spread = {};
  for (const role of new Set(fps.flatMap((f) => Object.keys(f.perRole)))) {
    perRole[role] = {};
    spread[role] = {};
    for (const m of METRICS) {
      const v = fps.map((f) => f.perRole[role]?.[m]);
      perRole[role][m] = median(v);
      spread[role][m] = [lo(v), hi(v)];
    }
  }
  const fp = { cores: fps[0].cores, gpuRows: median(fps.map((f) => f.gpuRows)), gpuErr: fps.map((f) => f.gpuErr).filter(Boolean)[0] ?? "", perRole, ticks: median(fps.map((f) => f.ticks)), seconds: median(fps.map((f) => f.seconds)) };
  return { fp, spread };
}
function aggPage(pages) {
  const o = {};
  for (const m of PAGE_METRICS) o[m] = median(pages.map((p) => p[m]));
  const seen = {};
  for (const p of pages) seen[p.visibility ?? "?"] = (seen[p.visibility ?? "?"] ?? 0) + 1;
  o.wizard = pages.some((p) => p.wizard);
  o.visibility = Object.entries(seen).map(([k, n]) => (pages.length > 1 ? `${k} x${n}` : k)).join(", ");
  return o;
}
function aggregate(runs) {
  return PHASE_ORDER.flatMap((id) => {
    const ps = runs.map((r) => r.find((p) => p.id === id)).filter(Boolean);
    if (!ps.length) return [];
    const main = aggFp(ps.map((p) => p.fp));
    const out = { id, title: ps[0].title, repeats: ps.length, fp: main.fp, spread: main.spread, page: aggPage(ps.map((p) => p.page)) };
    if (ps.every((p) => p.early)) {
      const e = aggFp(ps.map((p) => p.early.fp));
      out.early = { fp: e.fp, spread: e.spread, page: aggPage(ps.map((p) => p.early.page)) };
    }
    if (ps.every((p) => p.tabs)) out.tabs = { url: ps[0].tabs.url, exemptLoopback: ps[0].tabs.exemptLoopback, earlyRates: ps.map((p) => p.tabs.earlyRates), mainRates: ps.map((p) => p.tabs.mainRates), targets: ps.map((p) => p.tabs.targets) };
    out.procs = ps.map((p) => p.fp.procs); // per process rows of each repeat (pid, role, mean WS / private MB, CPU, GPU)
    return [out];
  });
}

// ---------- the report ----------
const ORDER = [...FOOTPRINT_ROLES, "total"];
const col = (s, w) => String(s).padStart(w);
const rng = (ph, role, m, dig) => {
  const r = ph.spread?.[role]?.[m];
  return r && ph.repeats > 1 ? ` [${fmt(r[0], dig)}-${fmt(r[1], dig)}]` : "";
};
function table(phases) {
  const L = [];
  const block = (fp, page, label, spread, repeats) => {
    L.push(`${label}  [panes ${page.panes} (${page.shownPanes} shown); visibility ${page.visibility}; first-run wizard ${page.wizard ? "OPEN" : "closed"}; sampled ${fp.seconds.toFixed(0)} s, ${fp.ticks} ticks, ${fp.cores} logical cores]`);
    L.push(`   ${"process".padEnd(18)}${col("count", 6)}${col("WS MB", 9)}${col("priv MB", 9)}${col("CPU %1core", 12)}${col("CPU %all", 10)}${col("GPUded MB", 11)}${col("GPUshr MB", 11)}${col("GPUeng %", 10)}`);
    for (const r of ORDER) {
      const x = fp.perRole[r];
      if (!x) continue;
      L.push(`   ${r.padEnd(18)}${col(fmt(x.n, 1), 6)}${col(fmt(x.wsMB, 1), 9)}${col(fmt(x.privMB, 1), 9)}${col(fmt(x.cpuCorePct, 2), 12)}${col(fmt(x.cpuTotalPct, 3), 10)}${col(fmt(x.gpuDedMB, 1), 11)}${col(fmt(x.gpuSharedMB, 1), 11)}${col(fmt(x.gpuEngPct, 2), 10)}`);
    }
    const t = spread?.total;
    if (t && repeats > 1) L.push(`   total min-max over ${repeats} repeats: WS ${fmt(t.wsMB[0], 1)}-${fmt(t.wsMB[1], 1)} MB | priv ${fmt(t.privMB[0], 1)}-${fmt(t.privMB[1], 1)} MB | CPU ${fmt(t.cpuCorePct[0], 2)}-${fmt(t.cpuCorePct[1], 2)} % of a core | GPU ded ${fmt(t.gpuDedMB[0], 1)}-${fmt(t.gpuDedMB[1], 1)} MB | GPU eng ${fmt(t.gpuEngPct[0], 2)}-${fmt(t.gpuEngPct[1], 2)} %`);
  };
  const rates = (rows) => rows.map((r) => `[${r.map((x) => fmt(x, 2)).join(" ")}]`).join(" ");
  for (const ph of phases) {
    block(ph.fp, ph.page, `${ph.id}) ${ph.title}`, ph.spread, ph.repeats);
    L.push(`   page: JS heap used ${fmt(ph.page.jsHeapUsedMB, 1)} MB (total ${fmt(ph.page.jsHeapTotalMB, 1)} MB), canvases ${ph.page.canvases}, DOM nodes ${ph.page.domNodes}`);
    if (ph.early) {
      L.push("");
      block(ph.early.fp, ph.early.page, `   ${ph.id}) early sample, ${EARLY_AT_S}-${EARLY_AT_S + EARLY_S} s after the hide (before the give-back timers)`, ph.early.spread, ph.repeats);
      L.push(`   page: canvases ${ph.early.page.canvases}`);
    }
    if (ph.tabs) {
      L.push(`   hidden tab page ticks/s (3 tabs, one bracket per repeat; about 1.00 awake, 0 suspended): ${EARLY_AT_S}-${EARLY_AT_S + EARLY_S} s after the hide ${rates(ph.tabs.earlyRates)}; in the main window ${rates(ph.tabs.mainRates)}${ph.tabs.exemptLoopback ? "  (loopback page: exempt from suspension by design)" : ""}`);
      L.push(`   page targets in the web view while sampled: ${ph.tabs.targets.join(", ")}`);
      L.push(`   per process in the last repeat (pid, role, WS MB, private MB, CPU % of a core, GPU ded MB):`);
      for (const p of ph.procs[ph.procs.length - 1].filter((q) => q.role === "renderer" || q.role === "gpu-process")) L.push(`      ${String(p.pid).padStart(7)} ${p.role.padEnd(12)}${col(fmt(p.wsMB, 1), 8)}${col(fmt(p.privMB, 1), 8)}${col(fmt(p.cpuCorePct, 2), 7)}${col(fmt(p.gpuDedMB, 1), 8)}`);
    }
    L.push("");
  }
  return L;
}
function compareLines(before, now) {
  const d = (a, b, dig = 1, pa = "", pb = "") => `${fmt(a, dig)}${pa} -> ${fmt(b, dig)}${pb} (${b - a >= 0 ? "+" : ""}${fmt(b - a, dig)})`;
  const L = [`compare (medians; before x${before.repeat ?? 1}, now x${now.repeat ?? 1}, [min-max] beside each when repeated): BEFORE ${before.sha} (${before.when}, ${before.buildKind ?? before.build}) -> NOW ${now.sha} (${now.when}, ${now.buildKind ?? now.build}); now minus before`, "total app (window + service + web view):"];
  for (const ph of now.phases) {
    const b = before.phases.find((p) => p.id === ph.id);
    if (!b) {
      L.push(`   ${ph.id}) no BEFORE phase of this id (phase added later): not compared`);
      continue;
    }
    const t0 = b.fp.perRole.total;
    const t1 = ph.fp.perRole.total;
    const c = (m, dig) => d(t0[m], t1[m], dig, rng(b, "total", m, dig), rng(ph, "total", m, dig));
    L.push(`   ${ph.id}) WS MB ${c("wsMB", 1)} | priv MB ${c("privMB", 1)} | CPU %1core ${c("cpuCorePct", 2)} | GPU ded MB ${c("gpuDedMB", 1)} | GPU eng % ${c("gpuEngPct", 2)} | JS heap MB ${d(b.page.jsHeapUsedMB, ph.page.jsHeapUsedMB)} | canvases ${b.page.canvases} -> ${ph.page.canvases} | visibility ${b.page.visibility ?? "n/a"} -> ${ph.page.visibility}`);
    if (b.early && ph.early) {
      const e0 = b.early.fp.perRole.total;
      const e1 = ph.early.fp.perRole.total;
      L.push(`      early (${EARLY_AT_S}-${EARLY_AT_S + EARLY_S} s after the hide): WS MB ${d(e0.wsMB, e1.wsMB)} | priv MB ${d(e0.privMB, e1.privMB)} | CPU %1core ${d(e0.cpuCorePct, e1.cpuCorePct, 2)} | GPU ded MB ${d(e0.gpuDedMB, e1.gpuDedMB)}`);
    }
  }
  L.push("", "per process role, before -> now (medians):");
  for (const ph of now.phases) {
    const b = before.phases.find((p) => p.id === ph.id);
    if (!b) continue;
    L.push(`   ${ph.id}) ${ph.title}`);
    for (const r of ORDER) {
      const x = ph.fp.perRole[r];
      const y = b.fp.perRole[r];
      if (!x || !y) continue;
      L.push(`      ${r.padEnd(18)} WS ${fmt(y.wsMB, 1)} -> ${fmt(x.wsMB, 1)} | priv ${fmt(y.privMB, 1)} -> ${fmt(x.privMB, 1)} | cpu ${fmt(y.cpuCorePct, 2)} -> ${fmt(x.cpuCorePct, 2)} | gpu ded ${fmt(y.gpuDedMB, 1)} -> ${fmt(x.gpuDedMB, 1)}`);
    }
  }
  L.push("");
  return L;
}

// ---------- a page on this machine's network address for the embedded browser tabs (no internet) ----------
// The tab suspension (DT-C237) spares loopback pages, so the page is served on the machine's own non-loopback IPv4 address (bound to that
// address only). It counts its own timer ticks: the page asks /tick?id=<tab> once a second; a suspended page stops asking.
function lanAddress() {
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) return a.address;
  return null;
}
async function startPageServer() {
  const host = lanAddress() ?? "127.0.0.1";
  const hits = new Map(); // tab id -> [ms of each tick]
  const html = `<!doctype html><meta charset="utf-8"><title>bench page</title><body style="font:16px sans-serif;background:#fff;color:#111"><h1>bench page</h1><p>A small static page for the footprint benchmark.</p><script>const id = new URLSearchParams(location.search).get("id");setInterval(() => fetch("/tick?id=" + id).catch(() => {}), 1000);</script>`;
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    if (u.pathname === "/tick") {
      const id = u.searchParams.get("id") ?? "?";
      if (!hits.has(id)) hits.set(id, []);
      hits.get(id).push(Date.now());
      res.writeHead(204).end();
    } else if (u.pathname === "/page") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(html);
    } else res.writeHead(404).end();
  });
  await new Promise((ok, bad) => (server.once("error", bad), server.listen(0, host, ok)));
  const port = server.address().port;
  return { base: `http://${host}:${port}`, exemptLoopback: host.startsWith("127."), hits, rate: (id, t0, t1) => (hits.get(id) ?? []).filter((t) => t >= t0 && t < t1).length / ((t1 - t0) / 1000), close: () => server.close() };
}

// ---------- one pass through the phases on a fresh app ----------
async function onePass(ctx, rep, server) {
  const { launch, checks, opts } = ctx;
  const sfx = REPEAT > 1 ? ` (repeat ${rep}/${REPEAT})` : "";
  const app = await launch("s11", { terminalGpu: "auto" }); // the shipped default (the stress profile otherwise forces the DOM renderer)
  ctx.buildKind ??= app.buildKind;
  console.log(`  build: ${app.buildKind}`);
  const repo = join(app.temp, "repo");
  await gitInit(app, repo, "s11");
  const files = join(app.temp, "files");
  mkdirSync(files, { recursive: true });
  const stopFile = slash(join(files, "stop"));
  writeFileSync(join(files, "stream.js"), STREAM_JS);
  await addProjectAndOpen(app, repo);

  const phases = [];
  const sleepUntil = (ms) => app.sleep(Math.max(0, ms - Date.now()));
  const shown = async () => Number(unwrap(await app.shown(TERM)));
  const growTo = async (want) => {
    for (let n = await shown(); n < want; n++) {
      await app.focusPane(TERM, 0, ".xterm-helper-textarea");
      await app.click('.pane.focused button[title^="Split right"]');
      await app.waitFor(`${n + 1} shell panes`, async () => (await shown()) === n + 1, 30000);
    }
    for (let i = 0; i < want; i++) await app.waitFor(`pane ${i + 1}'s input field`, async () => unwrap(await app.evalJs(`!!([...document.querySelectorAll(${JSON.stringify(TERM)})].filter((e) => e.offsetParent !== null)[${i}]?.querySelector(".xterm-helper-textarea"))`)), 20000);
    await app.sleep(4000); // the shells reach their prompts
  };
  const report = (id, fp, page, tag = "") => {
    const t = fp.perRole.total;
    console.log(`  phase ${id}${tag}${sfx}: total WS ${fmt(t.wsMB, 1)} MB, private ${fmt(t.privMB, 1)} MB, CPU ${fmt(t.cpuCorePct, 2)} % of one core, GPU ded ${fmt(t.gpuDedMB, 1)} MB, JS heap ${fmt(page.jsHeapUsedMB, 1)} MB, canvases ${page.canvases}, panes ${page.shownPanes}, ${page.visibility}`);
  };
  const verify = (id, expectPanes, fp, page) => {
    checks.add(`phase ${id}: no first-run wizard open (.onb-backdrop absent)${sfx}`, "absent", page.wizard ? "PRESENT" : "absent", !page.wizard);
    if (id !== "d") checks.add(`phase ${id}: the page is in sight (visibilityState visible) while sampled${sfx}`, "visible", String(page.visibility), page.visibility === "visible");
    checks.add(`phase ${id}: ${expectPanes} panes shown while sampled${sfx}`, `${expectPanes}`, `${page.shownPanes}`, page.shownPanes === expectPanes);
    checks.add(`phase ${id}: the app's processes were found${sfx}`, "window + web view renderer (the terminal service is not started by default since DT-C27; it is listed when present)", Object.keys(fp.perRole).filter((r) => r !== "total").join(", "), !!fp.perRole.window && !!fp.perRole.renderer);
  };
  // Visible phases: settle, then sample.
  const measure = async (id, ttl, expectPanes) => {
    console.log(`  phase ${id}${sfx}: ${ttl}; settle ${SETTLE_S} s, sample ${WINDOW_S} s`);
    await app.sleep(SETTLE_S * 1000);
    const fp = await footprint(app, WINDOW_S, 2);
    const page = unwrap(await app.evalJs(PAGE_STATS_JS));
    phases.push({ id, title: ttl, fp, page });
    report(id, fp, page);
    verify(id, expectPanes, fp, page);
  };
  // Hidden phases: a short sample EARLY_AT_S after the hide for contrast, then the settle runs to SETTLE_HIDDEN_S after the hide, then the window.
  const measureHidden = async (id, ttl, expectPanes, hiddenAt, tabs) => {
    console.log(`  phase ${id}${sfx}: ${ttl}; early sample at ${EARLY_AT_S} s, settle to ${SETTLE_HIDDEN_S} s after the hide, sample ${WINDOW_S} s`);
    await sleepUntil(hiddenAt + EARLY_AT_S * 1000);
    const e0 = Date.now();
    const efp = await footprint(app, EARLY_S, 2);
    const e1 = Date.now();
    const epage = unwrap(await app.evalJs(PAGE_STATS_JS));
    report(id, efp, epage, " early");
    await sleepUntil(hiddenAt + SETTLE_HIDDEN_S * 1000);
    const m0 = Date.now();
    const fp = await footprint(app, WINDOW_S, 2);
    const m1 = Date.now();
    const page = unwrap(await app.evalJs(PAGE_STATS_JS));
    // An app that never tells the page it is out of sight (builds before the view-visibility change) reads visible all the way: that is a result, recorded as is.
    // A page that changes its mind in the middle of the stay is a disturbed run: thrown away and redone.
    if (id === "d" && page.visibility !== epage.visibility) throw new Error(`phase d: the page read ${epage.visibility} early and ${page.visibility} at the end of the hidden stay`);
    const ph = { id, title: ttl, fp, page, early: { fp: efp, page: epage } };
    if (tabs) {
      const targets = await (await fetch(`http://127.0.0.1:${opts.cdp}/json`)).json().catch(() => []);
      ph.tabs = { url: server.base, exemptLoopback: server.exemptLoopback, earlyRates: tabs.map((t) => server.rate(t, e0, e1)), mainRates: tabs.map((t) => server.rate(t, m0, m1)), targets: targets.filter((x) => x.type === "page").length };
    }
    phases.push(ph);
    report(id, fp, page);
    verify(id, expectPanes, fp, page);
    return ph;
  };

  await app.sleep(4000);
  await measure("a", "idle, 1 project, 1 shell pane", 1);

  await growTo(6);
  await measure("b", "6 shell panes, idle", 6);

  for (let k = 0; k < 6; k++) await typeInto(app, k, `node '${slash(join(files, "stream.js"))}' ${k} '${stopFile}'`);
  await app.sleep(4000);
  for (let i = 0; i < 60 && ![0, 1, 2, 3, 4, 5].every((k) => existsSync(`${stopFile}.${k}.started`)); i++) await app.sleep(500);
  const fed = [0, 1, 2, 3, 4, 5].map((k) => existsSync(`${stopFile}.${k}.started`));
  checks.add(`6 panes each print the ~20 lines/s stream${sfx}`, "6 of 6", `${fed.filter(Boolean).length} of 6`, fed.every(Boolean));
  await measure("c", "6 panes, each printing ~20 lines/s", 6);

  writeFileSync(stopFile, "stop\n"); // the streams end on their own
  await app.sleep(4000);
  // e before d: a window restored from a minimize stayed hidden for the web view on this off-screen setup, so e would have sampled a view nobody sees.
  // d is therefore the same 12 panes, minimized (it was 6 panes when it came before e).
  await growTo(12);
  await measure("e", "12 shell panes, idle", 12);
  let mini = "skipped";
  const dims = String(unwrap(await app.evalJs("Math.round(outerWidth * devicePixelRatio) + 'x' + Math.round(outerHeight * devicePixelRatio)").catch(() => ""))).match(/^(\d+)x(\d+)$/);
  const [winW, winH] = dims ? [Number(dims[1]), Number(dims[2])] : [1200, 800];
  let hiddenAt = Date.now();
  try {
    mini = await showWindow(app, 6);
    hiddenAt = Date.now();
  } catch (e) {
    mini = `failed: ${e.message.slice(0, 100)}`;
  }
  checks.note(`minimize${sfx}: ${mini}`);
  await measureHidden("d", `12 panes idle, window minimized (${mini})`, 12, hiddenAt);
  // Back on screen: f must see a visible page (a hidden one would give the GPU numbers of a window nobody sees).
  try {
    await restoreWindow(app);
    await app.moveWindow(app.pid);
  } catch (e) {
    checks.note(`restore${sfx}: ${e.message.slice(0, 100)}`);
  }
  let vis = "?";
  for (let i = 0; i < 30; i++) {
    vis = unwrap(await app.evalJs("document.visibilityState").catch(() => "?"));
    if (vis === "visible") break;
    if (i === 3 || i === 9 || i === 15) {
      checks.note(`restore${sfx}: still hidden after ${i} s, putting the window on screen for a moment (${await nudgeWindow(app, winW, winH).catch((e) => e.message.slice(0, 80))})`);
      await app.moveWindow(app.pid).catch(() => {});
    }
    await app.sleep(1000);
  }
  checks.note(`after the restore${sfx}: document.visibilityState = ${vis}`);
  // Not fatal: opening the browser tabs below brings the page back (checked there).


  // f: three browser tabs on the local page, then a terminal tab brought forward so all three are hidden.
  const ids = [0, 1, 2].map((n) => `r${rep}t${n}`);
  const browsers = async () => Number(unwrap(await app.evalJs(`document.querySelectorAll("section.pane.browser").length`)));
  for (let n = 0; n < 3; n++) {
    const url = `${server.base}/page?id=${ids[n]}`;
    await app.evalJs(`(window.dispatchEvent(new CustomEvent("kolux-open-in-browser", { detail: { url: ${JSON.stringify(url)}, title: "bench ${n}" } })), null)`);
    await app.waitFor(`browser tab ${n + 1}`, async () => (await browsers()) === n + 1, 20000);
    await app.waitFor(`browser tab ${n + 1}'s page to run`, async () => (server.hits.get(ids[n])?.length ?? 0) >= 2, 30000);
  }
  {
    const vNow = unwrap(await app.evalJs("document.visibilityState"));
    if (vNow !== "visible") throw new Error(`the page reads ${vNow} with the browser tabs open; phase f would measure a window nobody sees`);
  }
  // The tab strip of the cell that holds the browser tabs: its first tab is the terminal; a press on it (the tab's own mousedown handler) brings it forward.
  const pressed = unwrap(await app.evalJs(`(() => { const strips = [...document.querySelectorAll(".tabs")]; const t = strips.find((e) => e.parentElement && e.parentElement.querySelector("section.pane.browser")) ?? strips.find((e) => e.querySelectorAll('[role="tab"]').length >= 4); if (!t) return "no tab strip"; t.querySelector('[role="tab"]').dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); return "pressed"; })()`));
  hiddenAt = Date.now();
  let away = "hidden";
  try {
    await app.waitFor("all three browser tabs hidden", async () => unwrap(await app.evalJs(`[...document.querySelectorAll("section.pane.browser")].every((e) => e.offsetParent === null)`)), 10000, 250);
  } catch {
    away = `NOT hidden (${pressed})`;
  }
  const nTabs = await browsers();
  checks.add(`phase f: 3 browser tabs open and hidden behind a terminal tab${sfx}`, "3 tabs, all hidden", `${nTabs} tabs, ${away}`, nTabs === 3 && away === "hidden");
  const phf = await measureHidden("f", `12 shell panes + 3 hidden browser tabs${server.exemptLoopback ? " (loopback page: exempt from suspension)" : ""}`, 12, hiddenAt, ids);
  checks.note(`phase f${sfx}: hidden tab page ticks/s ${EARLY_AT_S}-${EARLY_AT_S + EARLY_S} s after the hide [${phf.tabs.earlyRates.map((x) => x.toFixed(2)).join(" ")}], in the main window [${phf.tabs.mainRates.map((x) => x.toFixed(2)).join(" ")}] (about 1 awake, 0 suspended)`);
  return phases;
}

export async function run(ctx) {
  const { checks, opts, sha } = ctx;
  ctx.fileTag = TAG ? `-${TAG}` : "";
  const server = await startPageServer();
  checks.note(`browser-tab page: ${server.base}${server.exemptLoopback ? " (no non-loopback address found: the page is exempt from suspension)" : ""}`);
  const runs = [];
  try {
    for (let rep = 1; rep <= REPEAT; rep++) {
      if (rep > 1) {
        // The previous app closes by its own path and its scratch folder is cleared; the next repeat is a fresh launch.
        const closed = await ctx.app.closeApp();
        if (closed) checks.add(`app closes by its own path and leaves no process behind (repeat ${rep - 1}/${REPEAT})`, "0 survivors", closed[1], closed[0]);
        removeTemp(ctx.app.temp);
      }
      let done = false;
      for (let attempt = 1; attempt <= 2 && !done; attempt++) {
        const mark = checks.list.length;
        try {
          runs.push(await onePass(ctx, rep, server));
          done = true;
        } catch (e) {
          if (attempt === 1) {
            // One pass that could not hold its own conditions (window state) is thrown away and redone on a fresh launch; the note keeps the reason.
            checks.list.length = mark;
            checks.note(`repeat ${rep}/${REPEAT}: attempt 1 discarded (${e.message.slice(0, 160)}); redone on a fresh launch`);
            await ctx.app.closeApp().catch(() => ctx.app.forceStop());
            removeTemp(ctx.app.temp);
            continue;
          }
          if (!runs.length) throw e;
          checks.add(`repeat ${rep}/${REPEAT} ran to the end`, "no exception", e.message.slice(0, 200), false);
        }
      }
      if (!done) break;
    }
  } finally {
    server.close();
  }
  const phases = aggregate(runs);
  const doc = { sha, when: new Date().toISOString(), window_s: WINDOW_S, settle_s: SETTLE_S, settle_hidden_s: SETTLE_HIDDEN_S, early_at_s: EARLY_AT_S, early_s: EARLY_S, repeat: runs.length, repeat_asked: REPEAT, build: ctx.buildKind, buildKind: /^release/.test(ctx.buildKind) ? "release" : "debug", phases, runs: runs.map((r) => r.map(({ id, title: t, fp, page, early, tabs }) => ({ id, title: t, fp, page, early, tabs }))) };
  mkdirSync(join(opts.root, "evidence"), { recursive: true });
  const jsonFile = join(opts.root, "evidence", `stress-s11-${sha}${ctx.fileTag}.json`);
  writeFileSync(jsonFile, JSON.stringify(doc, null, 1));
  ctx.report = [`=== footprint table (${WINDOW_S} s windows, ${SETTLE_S} s settle, hidden phases ${SETTLE_HIDDEN_S} s after the hide; ${runs.length} run(s), medians${runs.length > 1 ? " with min-max" : ""}) ===`, `build: ${ctx.buildKind}`, "", ...table(phases)];
  if (COMPARE) {
    if (!existsSync(COMPARE)) throw new Error(`--compare file not found: ${COMPARE}`);
    ctx.report.push(...compareLines(JSON.parse(readFileSync(COMPARE, "utf8")), doc));
  }
  ctx.report.push(`json: ${jsonFile}`);
}
