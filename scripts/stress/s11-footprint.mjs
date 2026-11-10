// S11 footprint: what the app itself costs, per phase, so a fix lane can re-run this AFTER and diff against a BEFORE file.
// "The app" = the window kolux.exe, the detached terminal service kolux.exe (--terminal-service; only present with
// KOLUX_TERMINAL_SERVICE=1 since DT-C27, so normally absent and the panes' ptys live in the window process) and every msedgewebview2.exe
// under the window. Shells, conhost and agents in the panes are NOT the app. Per process role it records working set MB, private MB,
// CPU (% of one core and % of the whole machine, averaged over the window) and GPU process memory; per phase also the page's JS heap
// and canvas count. Phases (each: a settle period, then a sampling window):
//   a idle, 1 shell pane   b 6 idle panes   c 6 panes each printing ~20 lines/s   d 6 idle panes, window minimized   e 12 idle panes
// Output: the table in evidence/stress-s11-<sha>.txt (written by run.mjs) and evidence/stress-s11-<sha>.json (machine-readable).
// Options: --window 60 (seconds sampled per phase) --settle 20 --compare <before.json> (prints per-phase deltas against a BEFORE run)
//          --tag <text> (appended to the json/txt file names, e.g. run2, so a second run does not overwrite the first).
// This scenario measures only; its checks are "ran to the end, the panes were there, the app's processes were found".
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FOOTPRINT_ROLES, PAGE_STATS_JS, TERM, addProjectAndOpen, fmt, footprint, gitInit, seedProfile, showWindow, slash, typeInto } from "./lib.mjs";

export const title = "app footprint (idle, 6 panes, streaming, minimized, 12 panes)";
export const seed = seedProfile;
const argv = process.argv.slice(2);
const opt = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const WINDOW_S = Number(opt("window", 60));
const SETTLE_S = Number(opt("settle", 20));
const COMPARE = opt("compare", null);
const TAG = opt("tag", "");
const unwrap = (v) => (v && typeof v === "object" && "result" in v && v.result && "value" in v.result ? v.result.value : v);

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

const ORDER = [...FOOTPRINT_ROLES, "total"];
const col = (s, w) => String(s).padStart(w);
function table(phases) {
  const L = [];
  for (const ph of phases) {
    L.push(`${ph.id}) ${ph.title}  [panes ${ph.page.panes} (${ph.page.shownPanes} shown); sampled ${ph.fp.seconds.toFixed(0)} s, ${ph.fp.ticks} ticks, ${ph.fp.cores} logical cores]`);
    L.push(`   ${"process".padEnd(18)}${col("count", 6)}${col("WS MB", 9)}${col("priv MB", 9)}${col("CPU %1core", 12)}${col("CPU %all", 10)}${col("GPUded MB", 11)}${col("GPUshr MB", 11)}${col("GPUeng %", 10)}`);
    for (const r of ORDER) {
      const x = ph.fp.perRole[r];
      if (!x) continue;
      L.push(`   ${r.padEnd(18)}${col(fmt(x.n, 1), 6)}${col(fmt(x.wsMB, 1), 9)}${col(fmt(x.privMB, 1), 9)}${col(fmt(x.cpuCorePct, 2), 12)}${col(fmt(x.cpuTotalPct, 3), 10)}${col(fmt(x.gpuDedMB, 1), 11)}${col(fmt(x.gpuSharedMB, 1), 11)}${col(fmt(x.gpuEngPct, 2), 10)}`);
    }
    L.push(`   page: JS heap used ${fmt(ph.page.jsHeapUsedMB, 1)} MB (total ${fmt(ph.page.jsHeapTotalMB, 1)} MB), canvases ${ph.page.canvases}, DOM nodes ${ph.page.domNodes}`);
    L.push("");
  }
  return L;
}
function compareLines(before, now) {
  const d = (a, b, dig = 1) => `${fmt(a, dig)} -> ${fmt(b, dig)} (${b - a >= 0 ? "+" : ""}${fmt(b - a, dig)})`;
  const L = [`compare: BEFORE ${before.sha} (${before.when}) -> NOW ${now.sha} (${now.when}); now minus before`, "total app (window + service + web view):"];
  for (const ph of now.phases) {
    const b = before.phases.find((p) => p.id === ph.id);
    if (!b) continue;
    const t0 = b.fp.perRole.total;
    const t1 = ph.fp.perRole.total;
    L.push(`   ${ph.id}) WS MB ${d(t0.wsMB, t1.wsMB)} | priv MB ${d(t0.privMB, t1.privMB)} | CPU %1core ${d(t0.cpuCorePct, t1.cpuCorePct, 2)} | GPU ded MB ${d(t0.gpuDedMB, t1.gpuDedMB)} | JS heap MB ${d(b.page.jsHeapUsedMB, ph.page.jsHeapUsedMB)} | canvases ${b.page.canvases} -> ${ph.page.canvases}`);
  }
  L.push("", "per process role, before -> now:");
  for (const ph of now.phases) {
    const b = before.phases.find((p) => p.id === ph.id);
    if (!b) continue;
    L.push(`   ${ph.id}) ${ph.title}`);
    for (const r of ORDER) {
      const x = ph.fp.perRole[r];
      const y = b.fp.perRole[r];
      if (!x || !y) continue;
      L.push(`      ${r.padEnd(18)} WS ${fmt(y.wsMB, 1)} -> ${fmt(x.wsMB, 1)} | priv ${fmt(y.privMB, 1)} -> ${fmt(x.privMB, 1)} | cpu ${fmt(y.cpuCorePct, 2)} -> ${fmt(x.cpuCorePct, 2)}`);
    }
  }
  L.push("");
  return L;
}

export async function run(ctx) {
  const { launch, checks, opts, sha } = ctx;
  ctx.fileTag = TAG ? `-${TAG}` : "";
  const app = await launch("s11", { terminalGpu: "auto" }); // the shipped default (the stress profile otherwise forces the DOM renderer)
  const repo = join(app.temp, "repo");
  await gitInit(app, repo, "s11");
  const files = join(app.temp, "files");
  mkdirSync(files, { recursive: true });
  const stopFile = slash(join(files, "stop"));
  writeFileSync(join(files, "stream.js"), STREAM_JS);
  await addProjectAndOpen(app, repo);

  const phases = [];
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
  const measure = async (id, ttl, expectPanes) => {
    console.log(`  phase ${id}: ${ttl}; settle ${SETTLE_S} s, sample ${WINDOW_S} s`);
    await app.sleep(SETTLE_S * 1000);
    const fp = await footprint(app, WINDOW_S, 2);
    const page = unwrap(await app.evalJs(PAGE_STATS_JS));
    phases.push({ id, title: ttl, fp, page });
    const t = fp.perRole.total;
    console.log(`  phase ${id}: total WS ${fmt(t.wsMB, 1)} MB, private ${fmt(t.privMB, 1)} MB, CPU ${fmt(t.cpuCorePct, 2)} % of one core, JS heap ${fmt(page.jsHeapUsedMB, 1)} MB, canvases ${page.canvases}, panes ${page.shownPanes}`);
    checks.add(`phase ${id}: ${expectPanes} panes shown while sampled`, `${expectPanes}`, `${page.shownPanes}`, page.shownPanes === expectPanes);
    checks.add(`phase ${id}: the app's processes were found`, "window + web view renderer (the terminal service is not started by default since DT-C27; it is listed when present)", Object.keys(fp.perRole).filter((r) => r !== "total").join(", "), !!fp.perRole.window && !!fp.perRole.renderer);
  };

  await app.sleep(4000);
  await measure("a", "idle, 1 project, 1 shell pane", 1);

  await growTo(6);
  await measure("b", "6 shell panes, idle", 6);

  for (let k = 0; k < 6; k++) await typeInto(app, k, `node '${slash(join(files, "stream.js"))}' ${k} '${stopFile}'`);
  await app.sleep(4000);
  for (let i = 0; i < 60 && ![0, 1, 2, 3, 4, 5].every((k) => existsSync(`${stopFile}.${k}.started`)); i++) await app.sleep(500);
  const fed = [0, 1, 2, 3, 4, 5].map((k) => existsSync(`${stopFile}.${k}.started`));
  checks.add("6 panes each print the ~20 lines/s stream", "6 of 6", `${fed.filter(Boolean).length} of 6`, fed.every(Boolean));
  await measure("c", "6 panes, each printing ~20 lines/s", 6);

  writeFileSync(stopFile, "stop\n"); // the streams end on their own
  await app.sleep(4000);
  let mini = "skipped";
  try {
    mini = await showWindow(app, 6);
  } catch (e) {
    mini = `failed: ${e.message.slice(0, 100)}`;
  }
  checks.note(`minimize: ${mini}`);
  await measure("d", `6 panes idle, window minimized (${mini})`, 6);
  try {
    await showWindow(app, 9);
    await app.moveWindow(app.pid);
  } catch (e) {
    checks.note(`restore: ${e.message.slice(0, 100)}`);
  }

  await growTo(12);
  await measure("e", "12 shell panes, idle", 12);

  const doc = { sha, when: new Date().toISOString(), window_s: WINDOW_S, settle_s: SETTLE_S, build: "debug dev build (pnpm tauri dev: the web view loads the vite dev server)", phases };
  mkdirSync(join(opts.root, "evidence"), { recursive: true });
  const jsonFile = join(opts.root, "evidence", `stress-s11-${sha}${ctx.fileTag}.json`);
  writeFileSync(jsonFile, JSON.stringify(doc, null, 1));
  ctx.report = [`=== footprint table (${WINDOW_S} s windows, ${SETTLE_S} s settle; debug dev build) ===`, "", ...table(phases)];
  if (COMPARE) {
    if (!existsSync(COMPARE)) throw new Error(`--compare file not found: ${COMPARE}`);
    ctx.report.push(...compareLines(JSON.parse(readFileSync(COMPARE, "utf8")), doc));
  }
  ctx.report.push(`json: ${jsonFile}`);
}
