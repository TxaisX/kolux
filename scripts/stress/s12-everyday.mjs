// S12 everyday: what Kolux costs on an ordinary working day, shells included, so a before and an after build can be compared on the
// whole footprint and not only on the window and web view (S11). One pass:
//   6 shell panes, each running a light ticker (one short line every 2 s, like a log tail or a watch), the window on screen (off-screen
//   but not minimised, so the page is visible), then the window minimised for --hidden seconds (120 by default). The three embedded
//   browser tabs this used to open retired with the web pane (Goal 0, Txais 2026-11-12).
// Phases: v (window shown; settle --settle s, then a --window s sample) and m (minimised; the sample is the last --window s of the stay).
// Per phase it records, per process role, working set and private bytes (Win32_Process PrivatePageCount):
//   the app's own processes from footprint() (window, terminal service when present, web view browser/renderer/gpu/utility/crashpad,
//   with CPU and GPU as in S11), and the pane processes from snapshot() of the app's whole process tree, taken at the start and the end
//   of the sample and averaged: shells (powershell/pwsh/cmd), console hosts (conhost/OpenConsole) and the panes' own workload (node, the
//   ticker). "Kolux total" = app + shells + console hosts; the workload is what the user runs and is reported beside it, not in it.
// --repeat N runs N fresh launches and reports the median per metric. --tag <text> names the files; --compare <before.json> adds deltas.
// Output: evidence/stress-s12-<sha><tag>.json and the txt table (run.mjs writes evidence/stress-S12-<sha>.txt).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FOOTPRINT_ROLES, PAGE_STATS_JS, TERM, addProjectAndOpen, fmt, footprint, gitInit, memByRole, removeTemp, seedOnboardingDone, seedProfile, showWindow, slash, snapshot, typeInto } from "./lib.mjs";

export const title = "everyday footprint (6 shells with light output, window shown, then minimised)";
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
const HIDDEN_S = Number(opt("hidden", 120));
const REPEAT = Math.max(1, Math.floor(Number(opt("repeat", 1))));
const COMPARE = opt("compare", null);
const TAG = opt("tag", "");
const unwrap = (v) => (v && typeof v === "object" && "result" in v && v.result && "value" in v.result ? v.result.value : v);

// One short line every 2 s, like a log tail; exits when the stop file appears.
const TICKER_JS = `const fs = require("fs");
const stop = process.argv[3];
fs.writeFileSync(stop + "." + process.argv[2] + ".started", "1");
let i = 0;
const t = setInterval(() => {
  if (fs.existsSync(stop)) { clearInterval(t); return; }
  i++;
  console.log(new Date().toISOString().slice(11, 19) + " ticker " + process.argv[2] + " ok " + i);
}, 2000);
`;

// The pane processes by kind (snapshot roles are the process names without .exe).
const PANE_KIND = { powershell: "shells", pwsh: "shells", cmd: "shells", conhost: "console hosts", OpenConsole: "console hosts", node: "workload (ticker)" };
const PANE_ORDER = ["shells", "console hosts", "workload (ticker)"];
function paneRoles(snaps) {
  const out = {};
  for (const s of snaps) {
    const byRole = memByRole(s.filter((p) => PANE_KIND[p.role]));
    for (const [role, v] of Object.entries(byRole)) {
      const k = PANE_KIND[role];
      const e = (out[k] ??= { n: 0, wsMB: 0, privMB: 0 });
      e.n += v.n / snaps.length;
      e.wsMB += v.wsMB / snaps.length;
      e.privMB += v.privMB / snaps.length;
    }
  }
  return out;
}
// The phase's per-role rows: app roles from footprint(), pane kinds from the snapshots, and the totals.
function rowsOf(fp, panes) {
  const rows = {};
  for (const r of FOOTPRINT_ROLES) if (fp.perRole[r]) rows[r] = { n: fp.perRole[r].n, wsMB: fp.perRole[r].wsMB, privMB: fp.perRole[r].privMB };
  rows["app total"] = { n: fp.perRole.total.n, wsMB: fp.perRole.total.wsMB, privMB: fp.perRole.total.privMB };
  for (const k of PANE_ORDER) rows[k] = panes[k] ?? { n: 0, wsMB: 0, privMB: 0 };
  const sum = (m) => rows["app total"][m] + rows.shells[m] + rows["console hosts"][m];
  rows["Kolux total"] = { n: sum("n"), wsMB: sum("wsMB"), privMB: sum("privMB") };
  rows["with workload"] = { n: rows["Kolux total"].n + rows["workload (ticker)"].n, wsMB: rows["Kolux total"].wsMB + rows["workload (ticker)"].wsMB, privMB: rows["Kolux total"].privMB + rows["workload (ticker)"].privMB };
  return rows;
}
const ROW_ORDER = [...FOOTPRINT_ROLES, "app total", ...PANE_ORDER, "Kolux total", "with workload"];

const median = (v) => {
  const a = v.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
function aggregate(runs) {
  return ["v", "m"].flatMap((id) => {
    const ps = runs.map((r) => r.find((p) => p.id === id)).filter(Boolean);
    if (!ps.length) return [];
    const rows = {};
    const spread = {};
    for (const role of ROW_ORDER) {
      if (!ps.some((p) => p.rows[role])) continue;
      rows[role] = {};
      spread[role] = {};
      for (const m of ["n", "wsMB", "privMB"]) {
        const v = ps.map((p) => p.rows[role]?.[m] ?? 0);
        rows[role][m] = median(v);
        spread[role][m] = [Math.min(...v), Math.max(...v)];
      }
    }
    const cpu = median(ps.map((p) => p.cpuCorePct));
    return [{ id, title: ps[0].title, repeats: ps.length, rows, spread, cpuCorePct: cpu, page: { visibility: ps.map((p) => p.page.visibility).join(", "), jsHeapUsedMB: median(ps.map((p) => p.page.jsHeapUsedMB)), canvases: median(ps.map((p) => p.page.canvases)) } }];
  });
}
const col = (s, w) => String(s).padStart(w);
function table(phases) {
  const L = [];
  for (const ph of phases) {
    L.push(`${ph.id}) ${ph.title}  [${ph.repeats} run(s), medians; visibility ${ph.page.visibility}; page JS heap ${fmt(ph.page.jsHeapUsedMB, 1)} MB; canvases ${ph.page.canvases}; app CPU ${fmt(ph.cpuCorePct, 2)} % of a core]`);
    L.push(`   ${"role".padEnd(20)}${col("count", 6)}${col("WS MB", 9)}${col("priv MB", 9)}   min-max WS | priv`);
    for (const r of ROW_ORDER) {
      const x = ph.rows[r];
      if (!x) continue;
      const s = ph.spread[r];
      L.push(`   ${r.padEnd(20)}${col(fmt(x.n, 1), 6)}${col(fmt(x.wsMB, 1), 9)}${col(fmt(x.privMB, 1), 9)}   ${ph.repeats > 1 ? `${fmt(s.wsMB[0], 0)}-${fmt(s.wsMB[1], 0)} | ${fmt(s.privMB[0], 0)}-${fmt(s.privMB[1], 0)}` : ""}`);
    }
    L.push("");
  }
  return L;
}
function compareLines(before, now) {
  const L = [`compare (medians; before x${before.repeat}, now x${now.repeat}): BEFORE ${before.sha} (${before.buildKind}) -> NOW ${now.sha} (${now.buildKind}); now minus before`];
  for (const ph of now.phases) {
    const b = before.phases.find((p) => p.id === ph.id);
    if (!b) continue;
    L.push(`   ${ph.id}) ${ph.title}`);
    for (const r of ROW_ORDER) {
      const x = ph.rows[r];
      const y = b.rows[r];
      if (!x || !y) continue;
      const d = (m) => `${fmt(y[m], 1)} -> ${fmt(x[m], 1)} (${x[m] - y[m] >= 0 ? "+" : ""}${fmt(x[m] - y[m], 1)})`;
      L.push(`      ${r.padEnd(20)} WS ${d("wsMB")} | priv ${d("privMB")}`);
    }
    L.push(`      app CPU % of a core ${fmt(b.cpuCorePct, 2)} -> ${fmt(ph.cpuCorePct, 2)}`);
  }
  L.push("");
  return L;
}

async function onePass(ctx, rep) {
  const { launch, checks } = ctx;
  const sfx = REPEAT > 1 ? ` (repeat ${rep}/${REPEAT})` : "";
  const app = await launch("s12", { terminalGpu: "auto" }); // the shipped default renderer
  ctx.buildKind ??= app.buildKind;
  const repo = join(app.temp, "repo");
  await gitInit(app, repo, "s12");
  const files = join(app.temp, "files");
  mkdirSync(files, { recursive: true });
  const stopFile = slash(join(files, "stop"));
  writeFileSync(join(files, "ticker.js"), TICKER_JS);
  await addProjectAndOpen(app, repo);
  const shown = async () => Number(unwrap(await app.shown(TERM)));
  for (let n = await shown(); n < 6; n++) {
    await app.focusPane(TERM, 0, ".xterm-helper-textarea");
    await app.click('.pane.focused button[title^="Split right"]');
    await app.waitFor(`${n + 1} shell panes`, async () => (await shown()) === n + 1, 30000);
  }
  for (let i = 0; i < 6; i++) await app.waitFor(`pane ${i + 1}'s input field`, async () => unwrap(await app.evalJs(`!!([...document.querySelectorAll(${JSON.stringify(TERM)})].filter((e) => e.offsetParent !== null)[${i}]?.querySelector(".xterm-helper-textarea"))`)), 20000);
  await app.sleep(4000);
  for (let k = 0; k < 6; k++) await typeInto(app, k, `node '${slash(join(files, "ticker.js"))}' ${k} '${stopFile}'`);
  for (let i = 0; i < 60 && ![0, 1, 2, 3, 4, 5].every((k) => existsSync(`${stopFile}.${k}.started`)); i++) await app.sleep(500);
  const fed = [0, 1, 2, 3, 4, 5].filter((k) => existsSync(`${stopFile}.${k}.started`)).length;
  checks.add(`6 panes each run the light ticker${sfx}`, "6 of 6", `${fed} of 6`, fed === 6);

  const phases = [];
  const sample = async (id, ttl) => {
    const s0 = await snapshot(app);
    const t0 = Date.now();
    const fp = await footprint(app, WINDOW_S, 2);
    const t1 = Date.now();
    const s1 = await snapshot(app);
    const page = unwrap(await app.evalJs(PAGE_STATS_JS));
    const rows = rowsOf(fp, paneRoles([s0, s1]));
    phases.push({ id, title: ttl, rows, cpuCorePct: fp.perRole.total.cpuCorePct, page, procs: fp.procs });
    console.log(`  phase ${id}${sfx}: Kolux total WS ${fmt(rows["Kolux total"].wsMB, 1)} MB, private ${fmt(rows["Kolux total"].privMB, 1)} MB (app ${fmt(rows["app total"].privMB, 1)}, shells ${fmt(rows.shells.privMB, 1)}, console hosts ${fmt(rows["console hosts"].privMB, 1)}); workload ${fmt(rows["workload (ticker)"].privMB, 1)} MB; ${page.visibility}`);
    checks.add(`phase ${id}: 6 shells and 6 console hosts found${sfx}`, "6 + 6", `${fmt(rows.shells.n, 1)} + ${fmt(rows["console hosts"].n, 1)}`, rows.shells.n >= 6 && rows["console hosts"].n >= 6);
    return page;
  };
  console.log(`  phase v${sfx}: window shown; settle ${SETTLE_S} s, sample ${WINDOW_S} s`);
  await app.sleep(SETTLE_S * 1000);
  const pv = await sample("v", "window shown (off-screen, not minimised): 6 shells with light output");
  checks.add(`phase v: the page is visible while sampled${sfx}`, "visible", String(pv.visibility), pv.visibility === "visible");

  const mini = await showWindow(app, 6).catch((e) => `failed: ${e.message.slice(0, 100)}`);
  const hiddenAt = Date.now();
  checks.note(`minimise${sfx}: ${mini}`);
  console.log(`  phase m${sfx}: minimised (${mini}); sample the last ${WINDOW_S} s of a ${HIDDEN_S} s stay`);
  await app.sleep(Math.max(0, hiddenAt + (HIDDEN_S - WINDOW_S) * 1000 - Date.now()));
  const pm = await sample("m", `window minimised ${HIDDEN_S} s (sampled ${HIDDEN_S - WINDOW_S}-${HIDDEN_S} s after the hide)`);
  checks.add(`phase m: the window was minimised${sfx}`, "iconic=True", String(mini).trim(), /iconic=True/i.test(String(mini)));
  checks.note(`phase m${sfx}: page visibility ${pm.visibility}`);
  writeFileSync(stopFile, "stop\n");
  return phases;
}

export async function run(ctx) {
  const { checks, opts, sha } = ctx;
  ctx.fileTag = TAG ? `-${TAG}` : "";
  const runs = [];
  try {
    for (let rep = 1; rep <= REPEAT; rep++) {
      if (rep > 1) {
        const closed = await ctx.app.closeApp();
        if (closed) checks.add(`app closes by its own path and leaves no process behind (repeat ${rep - 1}/${REPEAT})`, "0 survivors", closed[1], closed[0]);
        removeTemp(ctx.app.temp);
      }
      runs.push(await onePass(ctx, rep));
    }
  } finally {
    // nothing to close: the app is closed by the ctx
  }
  const phases = aggregate(runs);
  const doc = { schema: 1, sha, when: new Date().toISOString(), window_s: WINDOW_S, settle_s: SETTLE_S, hidden_s: HIDDEN_S, repeat: runs.length, build: ctx.buildKind, buildKind: /^release/.test(ctx.buildKind) ? "release" : "debug", phases, runs };
  mkdirSync(join(opts.root, "evidence"), { recursive: true });
  const jsonFile = join(opts.root, "evidence", `stress-s12-${sha}${ctx.fileTag}.json`);
  writeFileSync(jsonFile, JSON.stringify(doc, null, 1));
  ctx.report = [`=== everyday footprint (${WINDOW_S} s windows, ${SETTLE_S} s settle, minimised ${HIDDEN_S} s; ${runs.length} run(s)) ===`, `build: ${ctx.buildKind}`, "", ...table(phases)];
  if (COMPARE) {
    if (!existsSync(COMPARE)) throw new Error(`--compare file not found: ${COMPARE}`);
    ctx.report.push(...compareLines(JSON.parse(readFileSync(COMPARE, "utf8")), doc));
  }
  ctx.report.push(`json: evidence/stress-s12-${sha}${ctx.fileTag}.json`);
}
