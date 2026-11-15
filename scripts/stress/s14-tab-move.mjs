// S14 (DT-C248): moving panes between cells keeps their programs running. Four Claude Code stand-in panes and
// one PowerShell pane are each opened in a cell of their own, then folded together with the pane menu's Move to
// Tab (TERM-016), a tab dragged onto another cell and a tab dragged onto another tab (TERM-054). Each move used
// to end the pane's program and start a fresh one (S13, Round 7): the pane is drawn anew in its new cell, and
// before DT-C248 it reaped its terminal on the way out. The run counts stand-in starts (the stand-in logs each
// start with its pid and session id), checks the pids outlive every move, that each moved pane still shows the
// output it had (the session banner), and that the moved shell still takes a command and prints its answer.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addProjectAndOpen, gitInit, paneProcs, seedOnboardingDone, seedProfile, snapshot } from "./lib.mjs";

export const title = "pane moves keep the program running: Move to tab and tab drags with Claude Code stand-ins and a shell (DT-C248)";

const unwrap = (v) => (v && typeof v === "object" && "result" in v && v.result && "value" in v.result ? v.result.value : v);
const STANDIN_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "prove", "agent-sleep-standin.cjs");
const PLUS = 'section.pane[data-agent] button.ib[title^="New session"]';
const NAMES = ["A", "B", "C", "D"];

const standinDir = (app) => join(app.temp, "standin");
export const seed = (app) => {
  const dir = standinDir(app);
  mkdirSync(dir, { recursive: true });
  copyFileSync(STANDIN_SRC, join(dir, "claude.js"));
  const cmd = join(dir, "claude.cmd").replace(/\//g, "\\");
  writeFileSync(cmd, ["@echo off", 'node "%~dp0claude.js" %*', ""].join("\r\n"));
  // Every stand-in runs a turn that never finishes (a tool call), so each is a live, busy agent through the run.
  writeFileSync(join(dir, "modes.txt"), NAMES.map(() => "busy").join("\n") + "\n");
  process.env.PATH = `${dir.replace(/\//g, "\\")};${process.env.PATH}`;
  // The pane env carries the scratch CLAUDE_CONFIG_DIR: the user's registry environment overrides the app's own (Round 7).
  const base = seedProfile(app, { agentStatusHooks: true, agentOptions: { claude: { command: cmd, env: `CLAUDE_CONFIG_DIR=${app.paths.claudeConfig}` } } });
  return () => {
    base();
    seedOnboardingDone(app.paths.profile);
  };
};

const readLog = (app) => {
  const f = join(standinDir(app), "standin.log");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};
const starts = (app) => readLog(app).filter((e) => e.start);

const paneKeys = (app) => app.evalJs(`[...document.querySelectorAll('section.pane[data-agent][data-key]')].map((e) => ({ key: Number(e.getAttribute("data-key")), agent: e.getAttribute("data-agent"), shown: e.offsetParent !== null }))`).then(unwrap);
const paneTextByKey = (app, key) => app.evalJs(`(() => { const p = document.querySelector('section.pane[data-key="${key}"]'); return p ? (p.querySelector(".xterm-rows")?.innerText ?? "") : null; })()`).then(unwrap);
// The cells on screen and the keys of the panes each holds (Grid.tsx: one .cell per group, the panes inside it).
const cells = (app) => app.evalJs(`[...document.querySelectorAll(".grid > .cell")].map((c) => [...c.querySelectorAll(':scope > section.pane[data-key]')].map((p) => Number(p.getAttribute("data-key"))))`).then(unwrap);
const cellIndexOf = async (app, key) => (await cells(app)).findIndex((c) => c.includes(key));
// TERM-016 Move to tab, from the pane menu a right-click on the pane's header opens (TerminalPane.tsx).
const moveToTab = async (app, key) => {
  const r = unwrap(await app.evalJs(`(() => { const h = document.querySelector('section.pane[data-key="${key}"] header.pane-head'); if (!h) return "no header"; const b = h.getBoundingClientRect(); h.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: b.left + 40, clientY: b.top + b.height / 2 })); return "menu"; })()`));
  if (r !== "menu") return r;
  await app.sleep(400);
  return unwrap(await app.evalJs(`(() => { const i = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((e) => /^\\s*Move to tab/i.test(e.textContent)); if (!i) return "no Move to tab item: " + [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((e) => e.textContent.trim()).join("|"); i.click(); return "moved"; })()`));
};
// TERM-054: a tab dragged with the pointer. The strip's tab for pane `key` gets a dragstart (Grid.tsx remembers the
// dragged tab), then the target (the body of the cell holding pane `onto`, or the tab of pane `onto`) gets dragover and
// drop at the given point, the way the browser fires them for a real drag. A cell's tabs follow its panes' order
// (nothing is pinned here), so the tab of a pane is the strip entry at the pane's index in its cell.
const TAB_OF = (key) => `((k) => { const c = document.querySelector('section.pane[data-key="' + k + '"]')?.closest(".cell"); if (!c) return null; const ps = [...c.querySelectorAll(':scope > section.pane[data-key]')].map((p) => Number(p.getAttribute("data-key"))); return [...c.querySelectorAll(':scope > .tabs > [role="tab"]')][ps.indexOf(k)] ?? null; })(${key})`;
const DRAG_JS = (key, targetJs, where) => `(() => {
  const tab = ${TAB_OF(key)};
  if (!tab) return "no tab for ${key}";
  const target = ${targetJs};
  if (!target) return "no target";
  const dt = new DataTransfer();
  const ev = (type, el, x, y) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
  const r = target.getBoundingClientRect();
  const [x, y] = ${where};
  ev("dragstart", tab, 0, 0);
  ev("dragenter", target, x, y);
  ev("dragover", target, x, y);
  ev("drop", target, x, y);
  ev("dragend", tab, x, y);
  return "dropped";
})()`;
const dragTabOntoCell = (app, key, onto) => app.evalJs(DRAG_JS(key, `document.querySelector('section.pane[data-key="${onto}"]')?.closest(".cell")`, "[r.left + r.width / 2, r.top + r.height / 2]")).then(unwrap);
const dragTabOntoTab = (app, key, onto) => app.evalJs(DRAG_JS(key, TAB_OF(onto), "[r.left + r.width * 0.8, r.top + r.height / 2]")).then(unwrap);
const alivePids = async (app, pids) => {
  if (pids.length === 0) return {};
  const out = await app.ps(`@(${pids.join(",")}) | ForEach-Object { if (Get-Process -Id $_ -ErrorAction SilentlyContinue) { "$_|alive" } else { "$_|gone" } }`);
  return Object.fromEntries(out.split(/\r?\n/).filter(Boolean).map((l) => l.split("|")).map(([p, s]) => [Number(p), s === "alive"]));
};
// The PowerShell processes in the app's tree (the stand-ins run under cmd.exe and console hosts of their own, so those are left out).
const shellPids = async (app) => paneProcs(await snapshot(app)).filter((p) => /^(powershell|pwsh)\.exe$/i.test(p.name)).map((p) => p.pid).sort((a, b) => a - b);

export async function run(ctx) {
  const { checks } = ctx;
  const lines = [];
  const t0 = Date.now();
  const at = () => `+${((Date.now() - t0) / 1000).toFixed(0)} s`;
  const log = (s) => {
    lines.push(`${at()}  ${s}`);
    console.log(`  ${at()}  ${s}`);
  };
  ctx.report = lines;
  const app = await ctx.launch("tabmove");
  log(`build: ${ctx.app.buildKind}`);
  log("Claude Code is a STAND-IN (node script running Kolux's installed hooks, a tool call that never ends; no network, no account), not Claude Code");
  const repo = join(app.temp, "repo");
  await gitInit(app, repo, "tabmove");
  await addProjectAndOpen(app, repo);
  await app.sleep(2000);
  const shellKey = (await paneKeys(app)).find((p) => p.agent === "shell")?.key;
  const shells0 = await shellPids(app);
  log(`shell pane: key ${shellKey}, processes ${JSON.stringify(shells0)}`);

  // ---- four Claude panes, each in a cell of its own, each tied to its stand-in by start order ----
  const P = {};
  for (const name of NAMES) {
    const before = (await paneKeys(app)).map((p) => p.key);
    const n0 = starts(app).length;
    const r = unwrap(await app.evalJs(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(PLUS)})].find((e) => e.offsetParent !== null) ?? document.querySelector(${JSON.stringify(PLUS)}); if (!b) return "no plus"; b.click(); return "clicked"; })()`));
    if (r !== "clicked") throw new Error(`pane ${name}: ${r}`);
    await app.waitFor("the New session menu", async () => unwrap(await app.exists('[role=menu][aria-label="New session"] [role=menuitem]')), 8000, 250);
    await app.clickWhere('[role=menu][aria-label="New session"] [role=menuitem]', "/^\\s*Claude Code/");
    const { key } = await app.waitFor(`pane ${name}`, async () => (await paneKeys(app)).find((p) => !before.includes(p.key) && /claude/.test(p.agent ?? "")) ?? null, 30000, 300);
    await app.waitFor(`stand-in ${name} started`, async () => starts(app).length > n0, 30000, 300);
    const s = starts(app)[n0];
    P[name] = { key, pid: s.pid, session: s.session };
    const text = await app.waitFor(`pane ${name} banner`, async () => {
      const t = await paneTextByKey(app, key);
      return t && t.includes(s.session) ? t : null;
    }, 20000, 400).catch(() => "");
    log(`pane ${name}: key ${key}, stand-in pid ${s.pid}, session ${s.session}, banner shown ${!!text}`);
    await app.sleep(2500);
  }
  log(`cells before any move: ${JSON.stringify(await cells(app))}`);
  const startsBefore = starts(app).length;
  const pidsOf = (names) => names.map((n) => P[n].pid);

  // After a move: the pane is back on screen in its new cell, its stand-in is the same process, no new stand-in started,
  // and its screen still shows the session banner it printed at start (the saved output was replayed into the new view).
  const settle = async (what, names, expectCellOf) => {
    await app.sleep(1800);
    await app.waitFor(`${what}: the moved pane${names.length > 1 ? "s are" : " is"} running again`, async () => {
      const texts = await Promise.all(names.map((n) => paneTextByKey(app, P[n].key)));
      return texts.every((t, i) => t && t.includes(P[names[i]].session)) ? true : null;
    }, 15000, 400).catch(() => null);
    const alive = await alivePids(app, pidsOf(names));
    const fresh = starts(app).length - startsBefore;
    const banner = {};
    for (const n of names) banner[n] = String((await paneTextByKey(app, P[n].key)) ?? "").includes(P[n].session);
    const where = {};
    for (const n of names) where[n] = await cellIndexOf(app, P[n].key);
    const placed = expectCellOf === undefined || names.every((n) => where[n] === expectCellOf);
    log(`${what}: stand-in alive ${JSON.stringify(alive)}; new stand-in starts since the moves began: ${fresh}; banner still on screen ${JSON.stringify(banner)}; cell of each ${JSON.stringify(where)}; cells ${JSON.stringify(await cells(app))}`);
    return { alive: names.every((n) => alive[P[n].pid] === true), fresh, banner: names.every((n) => banner[n]), placed };
  };

  // ---- Move to tab (TERM-016): D folds into C's cell, then B into A's ----
  let r = await moveToTab(app, P.D.key);
  log(`Move to tab on D: ${r}`);
  const m1 = await settle("Move to tab D", ["D"], await cellIndexOf(app, P.C.key));
  r = await moveToTab(app, P.B.key);
  log(`Move to tab on B: ${r}`);
  const m2 = await settle("Move to tab B", ["B"], await cellIndexOf(app, P.A.key));
  checks.add("Move to tab keeps the agent running (TERM-016): no stand-in restarted", "0 restarts, both pids alive", `${m2.fresh} restart(s); pids alive: D ${m1.alive} B ${m2.alive}`, m1.alive && m2.alive && m2.fresh === 0);
  checks.add("a pane moved with Move to tab still shows its output and sits in the cell beside it", "banner on screen, in the neighbour's cell", `banner D ${m1.banner} B ${m2.banner}; placed D ${m1.placed} B ${m2.placed}`, m1.banner && m2.banner && m1.placed && m2.placed);

  // ---- tab drag onto a tab (TERM-054): B's tab (beside A) dropped after D's tab in C's cell ----
  r = await dragTabOntoTab(app, P.B.key, P.D.key);
  log(`drag B's tab onto D's tab: ${r}`);
  const d1 = await settle("tab drag onto a tab (B)", ["B"], await cellIndexOf(app, P.C.key));
  checks.add("a tab dropped on another cell's tab keeps its agent running (TERM-054)", "0 restarts, pid alive, banner kept, lands beside that tab", `${d1.fresh} restart(s) in all; B alive ${d1.alive}; banner ${d1.banner}; placed ${d1.placed}`, d1.alive && d1.fresh === 0 && d1.banner && d1.placed);

  // ---- tab drag onto another cell (TERM-054): D's tab (now with C and B) dropped on the body of A's cell ----
  r = await dragTabOntoCell(app, P.D.key, P.A.key);
  log(`drag D's tab onto A's cell: ${r}`);
  const d2 = await settle("tab drag onto a cell (D)", ["D"], await cellIndexOf(app, P.A.key));
  checks.add("a tab dragged onto another cell keeps its agent running (TERM-054)", "0 restarts, pid alive, banner kept, lands in that cell", `${d2.fresh} restart(s) in all; D alive ${d2.alive}; banner ${d2.banner}; placed ${d2.placed}`, d2.alive && d2.fresh === 0 && d2.banner && d2.placed);

  // ---- the plain shell: Move to tab, then a command typed into it must still answer ----
  if (shellKey !== undefined) {
    r = await moveToTab(app, shellKey);
    log(`Move to tab on the shell: ${r}`);
    await app.sleep(2500);
    const shells1 = await shellPids(app);
    const shellAlive = await alivePids(app, shells0);
    log(`shell processes after the move: ${JSON.stringify(shells1)}; before: ${JSON.stringify(shells0)}; alive ${JSON.stringify(shellAlive)}`);
    const shown = (await paneKeys(app)).filter((p) => p.shown).map((p) => p.key);
    const idx = unwrap(await app.evalJs(`[...document.querySelectorAll("section.pane[data-agent]")].filter((e) => e.offsetParent !== null).findIndex((e) => e.getAttribute("data-key") === "${shellKey}")`));
    let answered = false;
    if (shown.includes(shellKey) && idx >= 0) {
      await app.focusPane("section.pane[data-agent]", idx, ".xterm-helper-textarea");
      await app.cdp("insert", "Write-Output ('moved' + '-ok')", "enter");
      answered = !!(await app.waitFor("the moved shell's answer", async () => (String((await paneTextByKey(app, shellKey)) ?? "").match(/moved-ok/g) ?? []).length >= 1 ? true : null, 15000, 400).catch(() => null));
    }
    log(`typed into the moved shell: shown ${shown.includes(shellKey)}, answered ${answered}`);
    const samePids = JSON.stringify(shells1) === JSON.stringify(shells0) && shells0.every((p) => shellAlive[p]);
    checks.add("Move to tab keeps a plain shell running and answering", "same shell processes, command answered", `processes ${samePids ? "unchanged" : `${JSON.stringify(shells0)} -> ${JSON.stringify(shells1)}`}; answered ${answered}`, samePids && answered);
  }

  const fresh = starts(app).length - startsBefore;
  const aliveEnd = await alivePids(app, pidsOf(NAMES));
  log(`end: stand-in starts since the moves began ${fresh}; alive ${JSON.stringify(aliveEnd)}; cells ${JSON.stringify(await cells(app))}`);
  checks.add("no agent restarted anywhere in the run", "0 stand-in starts after the panes opened", `${fresh}; alive at the end: ${NAMES.map((n) => `${n} ${aliveEnd[P[n].pid]}`).join(" ")}`, fresh === 0 && NAMES.every((n) => aliveEnd[P[n].pid]));
}
