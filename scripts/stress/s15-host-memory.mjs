// S15 host memory: what Kolux itself (kolux.exe and its msedgewebview2 tree) holds in three everyday states, for the WebView
// memory study (docs/research/webview-memory-2026-11-11.md). Panes run plain shells, never agents, so runs compare and no login is used;
// each pane first prints an agent-like screenful (colours, bold, box drawing, symbols) so the glyph atlas and scrollback are not empty.
// Phases (each: settle, then a sampling window of private bytes per process role, from footprint() in lib.mjs):
//   a  1 window, 2 shell panes side by side, both shown
//   b  4 panes: a new terminal tab (Mod+T) in each of the two cells, so the first two are on hidden tabs; an early sample 10 s
//      after the hide (before the 30 s GPU give-back of DT-C229), then the main sample from --settle-hidden-tab s after the hide
//   c  the same 4 panes, window minimized; an early sample 10 s after the minimize, then the main sample from --settle-hidden s after
//      (past the 60 s memory-LOW point of DT-C236)
// Options: --window 30 --settle 15 --settle-hidden-tab 40 --settle-hidden 75 --repeat 1 --tag <text>
// Output: the table in evidence/stress-s15-<sha>[-tag].txt (run.mjs) and evidence/stress-s15-<sha>[-tag].json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FOOTPRINT_ROLES, NEW_TERMINAL_JS, PAGE_STATS_JS, TERM, addProjectAndOpen, fmt, footprint, gitInit, removeTemp, seedOnboardingDone, seedProfile, showWindow, slash, typeInto } from "./lib.mjs";

export const title = "host memory (2 panes, 4 panes with 2 on hidden tabs, minimized)";
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
const WINDOW_S = Number(opt("window", 30));
const SETTLE_S = Number(opt("settle", 15));
const SETTLE_TAB_S = Number(opt("settle-hidden-tab", 40));
const SETTLE_HIDDEN_S = Number(opt("settle-hidden", 75));
const REPEAT = Math.max(1, Math.floor(Number(opt("repeat", 1))));
const TAG = opt("tag", "");
const EARLY_AT_S = 10;
const EARLY_S = 8;
const unwrap = (v) => (v && typeof v === "object" && "result" in v && v.result && "value" in v.result ? v.result.value : v);

// About what an agent's screen holds: 1500 lines in 24 truecolour shades, bold every third line, box drawing and the symbols agents use.
const GLYPHS_JS = `const sym = "●○◐✻⎿│├└─┌┐┘┬┴┼═║╭╮╯╰▶▸✓✗→←↑↓…·•※★☆";
const words = ["const", "return", "function", "import", "export", "await", "Promise", "string", "number", "undefined", "README.md", "src/terminal/renderer.ts"];
for (let i = 0; i < 1500; i++) {
  const h = (i * 37) % 360, r = Math.round(128 + 127 * Math.sin(h)), g = Math.round(128 + 127 * Math.sin(h + 2)), b = Math.round(128 + 127 * Math.sin(h + 4));
  const bold = i % 3 === 0 ? "\\x1b[1m" : "";
  const line = sym[i % sym.length] + " " + words.map((w, k) => words[(i + k) % words.length]).join(" ") + " " + sym.slice(i % 7, (i % 7) + 9) + " " + i;
  console.log(bold + "\\x1b[38;2;" + r + ";" + g + ";" + b + "m" + line + "\\x1b[0m");
}
`;

const ORDER = [...FOOTPRINT_ROLES, "total"];
const col = (s, w) => String(s).padStart(w);
const median = (v) => {
  const a = v.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
function rows(label, fps, pages) {
  const L = [`${label}  [shown panes ${pages.map((p) => p.shownPanes).join("/")}, panes ${pages.map((p) => p.panes).join("/")}, canvases ${pages.map((p) => p.canvases).join("/")}, visibility ${pages.map((p) => p.visibility).join("/")}, JS heap ${pages.map((p) => fmt(p.jsHeapUsedMB, 1)).join("/")} MB, status bar ${pages.map((p) => fmt(p.statusBarMB, 1)).join("/")} MB; ${fps.length} run(s), medians]`];
  L.push(`   ${"process".padEnd(18)}${col("count", 6)}${col("priv MB", 9)}${col("WS MB", 9)}${col("GPUded MB", 11)}`);
  for (const r of ORDER) {
    const xs = fps.map((f) => f.perRole[r]).filter(Boolean);
    if (!xs.length) continue;
    L.push(`   ${r.padEnd(18)}${col(fmt(median(xs.map((x) => x.n)), 1), 6)}${col(fmt(median(xs.map((x) => x.privMB)), 1), 9)}${col(fmt(median(xs.map((x) => x.wsMB)), 1), 9)}${col(fmt(median(xs.map((x) => x.gpuDedMB)), 1), 11)}`);
  }
  return L;
}

async function onePass(ctx, rep) {
  const { launch, checks } = ctx;
  const app = await launch("s15", { terminalGpu: "auto" }); // the shipped default (the stress profile otherwise forces the DOM renderer)
  ctx.buildKind ??= app.buildKind;
  const repo = join(app.temp, "repo");
  await gitInit(app, repo, "s15");
  const files = join(app.temp, "files");
  mkdirSync(files, { recursive: true });
  const glyphs = slash(join(files, "glyphs.js"));
  writeFileSync(glyphs, GLYPHS_JS);
  await addProjectAndOpen(app, repo);
  const out = {};
  const shown = async () => Number(unwrap(await app.shown(TERM)));
  const total = async () => Number(unwrap(await app.evalJs(`document.querySelectorAll(${JSON.stringify(TERM)}).length`)));
  const sample = async (id, s) => {
    const fp = await footprint(app, s, 2);
    const page = unwrap(await app.evalJs(PAGE_STATS_JS));
    const t = fp.perRole.total;
    // The status bar's own figure (process_memory), read once at the end of the window, beside the tree total.
    const bar = Number(unwrap(await app.evalJs(`(async () => { try { return await window.__TAURI_INTERNALS__.invoke("process_memory"); } catch { return null; } })()`)));
    page.statusBarMB = Number.isFinite(bar) && bar > 0 ? bar / 1048576 : NaN;
    console.log(`  ${id} (repeat ${rep}): status bar ${fmt(page.statusBarMB, 1)} MB, private ${fmt(t.privMB, 1)} MB, WS ${fmt(t.wsMB, 1)} MB, gpu-process private ${fmt(fp.perRole["gpu-process"]?.privMB, 1)} MB, canvases ${page.canvases}, shown ${page.shownPanes}/${page.panes}, ${page.visibility}`);
    out[id] = { fp, page };
  };
  const waitInput = async (n) => {
    for (let i = 0; i < n; i++) await app.waitFor(`pane ${i + 1}'s input field`, async () => unwrap(await app.evalJs(`!!([...document.querySelectorAll(${JSON.stringify(TERM)})].filter((e) => e.offsetParent !== null)[${i}]?.querySelector(".xterm-helper-textarea"))`)), 20000);
  };

  await app.sleep(4000);
  // a: split to two shown panes, each prints the agent-like screenful.
  await app.focusPane(TERM, 0, ".xterm-helper-textarea");
  await app.click('.pane.focused button[title^="Split right"]');
  await app.waitFor("2 shell panes", async () => (await shown()) === 2, 30000);
  await waitInput(2);
  await app.sleep(4000);
  for (let k = 0; k < 2; k++) await typeInto(app, k, `node '${glyphs}'`);
  await app.sleep(SETTLE_S * 1000);
  await sample("a", WINDOW_S);
  checks.add(`a: 2 panes shown (repeat ${rep})`, "2", String(out.a.page.shownPanes), out.a.page.shownPanes === 2);

  // b: a new terminal tab in each cell hides the first two panes.
  for (let k = 0; k < 2; k++) {
    const before = await total();
    await app.focusPane(TERM, k, ".xterm-helper-textarea");
    await app.evalJs(`(async () => { ${NEW_TERMINAL_JS}; return newTerminal((ms) => new Promise((r) => setTimeout(r, ms))); })()`);
    await app.waitFor(`pane ${before + 1}`, async () => (await total()) === before + 1, 30000);
  }
  const hiddenAt = Date.now();
  await app.waitFor("2 shown of 4", async () => (await shown()) === 2 && (await total()) === 4, 20000);
  await waitInput(2);
  await app.sleep(3000);
  for (let k = 0; k < 2; k++) await typeInto(app, k, `node '${glyphs}'`);
  await app.sleep(Math.max(0, hiddenAt + EARLY_AT_S * 1000 - Date.now()));
  await sample("b-early", EARLY_S);
  await app.sleep(Math.max(0, hiddenAt + SETTLE_TAB_S * 1000 - Date.now()));
  await sample("b", WINDOW_S);
  checks.add(`b: 4 panes, 2 shown (repeat ${rep})`, "2 of 4", `${out.b.page.shownPanes} of ${out.b.page.panes}`, out.b.page.shownPanes === 2 && out.b.page.panes === 4);

  // c: minimized.
  const mini = await showWindow(app, 6).catch((e) => `failed: ${e.message.slice(0, 80)}`);
  const minAt = Date.now();
  checks.note(`minimize (repeat ${rep}): ${mini}`);
  await app.sleep(Math.max(0, minAt + EARLY_AT_S * 1000 - Date.now()));
  await sample("c-early", EARLY_S);
  await app.sleep(Math.max(0, minAt + SETTLE_HIDDEN_S * 1000 - Date.now()));
  await sample("c", WINDOW_S);
  checks.add(`c: the page is hidden while minimized (repeat ${rep})`, "hidden", String(out.c.page.visibility), out.c.page.visibility === "hidden");
  return out;
}

export async function run(ctx) {
  const { checks, opts } = ctx;
  ctx.fileTag = TAG ? `-${TAG}` : "";
  const runs = [];
  for (let rep = 1; rep <= REPEAT; rep++) {
    if (rep > 1) {
      const closed = await ctx.app.closeApp();
      if (closed) checks.add(`app closes and leaves no process behind (repeat ${rep - 1})`, "0 survivors", closed[1], closed[0]);
      removeTemp(ctx.app.temp);
    }
    runs.push(await onePass(ctx, rep));
  }
  const ids = ["a", "b-early", "b", "c-early", "c"];
  const titles = { a: "a) 2 panes, both shown", "b-early": "b) early: 4 panes, 2 on hidden tabs, 10 s after the hide", b: `b) 4 panes, 2 on hidden tabs, ${SETTLE_TAB_S} s after the hide`, "c-early": "c) early: minimized, 10 s after", c: `c) 4 panes, window minimized, ${SETTLE_HIDDEN_S} s after` };
  const report = [`=== host memory (${WINDOW_S} s windows; ${runs.length} run(s)) ===`, `build: ${ctx.buildKind}`, ""];
  for (const id of ids) report.push(...rows(titles[id], runs.map((r) => r[id].fp), runs.map((r) => r[id].page)), "");
  const jsonFile = join(opts.root, "evidence", `stress-s15-${ctx.sha}${ctx.fileTag}.json`);
  mkdirSync(join(opts.root, "evidence"), { recursive: true });
  writeFileSync(jsonFile, JSON.stringify({ sha: ctx.sha, when: new Date().toISOString(), build: ctx.buildKind, window_s: WINDOW_S, runs: runs.map((r) => Object.fromEntries(ids.map((id) => [id, { perRole: r[id].fp.perRole, procs: r[id].fp.procs, page: r[id].page }]))) }, null, 1));
  report.push(`json: ${jsonFile}`);
  ctx.report = report;
}
