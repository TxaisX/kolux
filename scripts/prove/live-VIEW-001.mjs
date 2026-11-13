// LIVE proof, VIEW-001 box 1 + 2 (spec/05): (1) New look: click Agents, Board, Terminals -> each screen renders and the
// clicked label is the highlighted one; (2) an agent (stand-in claude) running on Terminals, switch to Board and back ->
// same pane element, same scrollback, process still running. Hidden app, over CDP.
import { reporter, startPlain, finish, sleep, waitFor, TERM, snap, pickScreen, checker } from "./live-views-dom.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
let ctx;
let ok = false;
const stamp = Date.now().toString(36).slice(-4);
const M = `V1${stamp}-END`;
try {
  ctx = await startPlain("VIEW-001", { report: rep, standin: [] });
  const { app } = ctx;
  await sleep(3000);
  log(`start: ${JSON.stringify(await snap(app))}`);

  // ---- box 1: each of the three labels in the New look
  const want = { Agents: (s) => s.agentsGrid || s.rail, Board: (s) => s.board, Terminals: (s) => s.grid && s.worktreeSidebar };
  const first = await snap(app);
  check("the new look shows the top bar with Agents, Board, Terminals labels", first.labels.join(",") === "Agents,Board,Terminals" || first.labels.slice(0, 3).join(",") === "Agents,Board,Terminals", JSON.stringify(first.labels));
  for (const label of ["Agents", "Board", "Terminals"]) {
    await pickScreen(app, label);
    await sleep(1200);
    const s = await snap(app);
    log(`click ${label}: ${JSON.stringify(s)}`);
    check(`${label}: its screen renders`, want[label](s), JSON.stringify({ board: s.board, grid: s.grid, agentsGrid: s.agentsGrid, rail: s.rail, worktreeSidebar: s.worktreeSidebar }));
    check(`${label}: exactly that label is highlighted`, s.pressed.length === 1 && s.pressed[0] === label, JSON.stringify(s.pressed));
    log(`screenshot: ${await ctx.shot(`VIEW-001-${label}`)}`);
  }

  // ---- box 2: an agent on Terminals survives Board and back
  await pickScreen(app, "Terminals");
  await sleep(1000);
  // The pane header's plus opens the New session menu (button.newtab went with the old tab strip).
  await app.focusPane("section.pane[data-agent]", 0, ".xterm-helper-textarea");
  await app.click('[data-testid="terminal-pane"].focused [data-testid="pane-new-session"]');
  await waitFor("the New tab menu", () => app.exists('[data-testid="new-session-menu"]'), 5000);
  await app.clickWhere('[data-testid="new-session-menu"] [role="menuitem"]', "/^\\s*Claude Code\\s*$/");
  await waitFor("a Claude stand-in pane", () => app.shown('section.pane[data-agent*="claude"]'), 20000);
  await waitFor("its input", () => app.exists('section.pane[data-agent*="claude"] .xterm-helper-textarea'), 20000);
  const CL = 'section.pane[data-agent*="claude"]';
  const lines = async () => {
    const r = await ctx.lines(0, CL);
    return r ? r.lines.map((l) => l.trim()) : [];
  };
  await waitFor("the stand-in banner", async () => (await lines()).some((l) => /stand-in for Claude Code/.test(l)), 30000, 500);
  // The stand-in is a batch file waiting on ping; its output is the banner. A marker is printed from a plain shell pane's
  // sibling is not needed: scrollback = the banner lines, tagged with the element identity.
  const tag = `tag-${stamp}`;
  await app.evalJs(`(() => { const p = [...document.querySelectorAll(${JSON.stringify(CL)})].find((e) => e.offsetParent !== null); p.__proveTag = ${JSON.stringify(tag)}; const s = document.querySelector(${JSON.stringify(CL)}); return !!s; })()`);
  const bannerBefore = (await lines()).filter(Boolean);
  const pidsBefore = await app.treeOf(app.pid);
  const procBefore = pidsBefore.filter((p) => /^(cmd|ping)\.exe$/i.test(p.name)).map((p) => `${p.name}:${p.pid}`).sort();
  log(`agent stand-in processes before: ${procBefore.join(" ")}`);
  check("setup: an agent pane runs on Terminals with its banner and a live process", bannerBefore.length > 0 && procBefore.length > 0, `${bannerBefore.length} rows; ${procBefore.join(" ")}`);

  await pickScreen(app, "Board");
  await sleep(2000);
  const onBoard = await snap(app);
  log(`on Board: ${JSON.stringify(onBoard)}`);
  await pickScreen(app, "Terminals");
  await sleep(2500);
  const back = await snap(app);
  log(`back on Terminals: ${JSON.stringify(back)}`);
  const tagAfter = await app.evalJs(`(() => { const p = [...document.querySelectorAll(${JSON.stringify(CL)})].find((e) => e.offsetParent !== null); return p ? p.__proveTag ?? null : "no visible claude pane"; })()`);
  const bannerAfter = (await lines()).filter(Boolean);
  const procAfter = (await app.treeOf(app.pid)).filter((p) => /^(cmd|ping)\.exe$/i.test(p.name)).map((p) => `${p.name}:${p.pid}`).sort();
  log(`agent stand-in processes after: ${procAfter.join(" ")}`);
  check("Board was really shown in between", onBoard.board && onBoard.pressed[0] === "Board", JSON.stringify(onBoard.pressed));
  check("same pane element (the tag set before is still on the visible agent pane)", tagAfter === tag, `tag ${tagAfter}`);
  check("same scrollback (every banner row from before is still there, in order)", JSON.stringify(bannerAfter) === JSON.stringify(bannerBefore), `${bannerBefore.length} before, ${bannerAfter.length} after`);
  check("process still running (same cmd/ping pids)", procBefore.join() === procAfter.join(), `${procBefore.join(" ")} -> ${procAfter.join(" ")}`);
  log(`screenshot: ${await ctx.shot("VIEW-001-after-roundtrip")}`);
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "VIEW-001", ev, ok) : 1);
