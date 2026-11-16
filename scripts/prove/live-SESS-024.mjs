// LIVE proof, SESS-024 box 1 (spec/02): launching 4 seats gives 4 new panes in a re-tiled grid, each tab named after its seat (job titles A,B,C,D).
// Default run: the New look (the launch screen is the New session page; a lone pane has no tab strip, so the pane header's title is the tab).
// "classic" run (node live-SESS-024.mjs classic): the Classic look, where every pane cell has a real tab strip (div[role=tab]) and the chooser is a pane.
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, STANDIN_BODY, tabLabels } from "./live-proj-common.mjs";
import { openSheet } from "./live-SESS-018.mjs";
import { PLUS } from "./live-SESS-004.mjs";

const rects = (app) =>
  app.evalJs(`[...document.querySelectorAll("section.pane[data-agent]")].filter(e => e.offsetParent !== null).map(e => { const r = e.getBoundingClientRect(); return { agent: e.getAttribute("data-agent"), label: e.getAttribute("aria-label"), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })`);
const distinct = (xs) => [...new Set(xs)];
const overlap = (a, b) => a.x < b.x + b.w - 2 && b.x < a.x + a.w - 2 && a.y < b.y + b.h - 2 && b.y < a.y + a.h - 2;

/** Classic look: the plus menu's Choose item adds a chooser pane to the grid. */
async function openChooserPane(app) {
  await app.evalJs(`document.querySelector(${JSON.stringify(PLUS)}).click()`);
  await poll(() => app.exists('[role=menu][aria-label="New session"]'), 8000, 300);
  await app.evalJs(`(() => { const b = [...document.querySelectorAll('[role=menu][aria-label="New session"] [role=menuitem]')].find(b => /^(Open a pane that asks|Pick folders)/.test(b.title)); b.click(); return true; })()`);
  return poll(() => app.exists('section.pane.chooser[aria-label$="chooser"]'), 10000, 300);
}

export async function run024(ctx, { check, log }, classic = false) {
  const { app } = ctx;
  const ROOT = classic ? "section.pane.chooser" : ".sheet-wrap";
  const R = JSON.stringify(ROOT);
  const beforeRects = await rects(app);
  log(`look: ${classic ? "classic" : "new"}; before: panes ${JSON.stringify(beforeRects)} tabs ${JSON.stringify(await tabLabels(app))}`);
  check(classic ? "a chooser pane opens in the grid" : "the New session page opens", !!(await (classic ? openChooserPane(app) : openSheet(app))), "");
  await sleep(500);
  await app.clickWhere(`${ROOT} [role=group][aria-label="How many sessions"] button`, "/^\\s*4\\s*$/");
  const seatsUp = await poll(async () => ((await app.evalJs(`document.querySelectorAll(${R} + ' [role=radiogroup][aria-label$=": which AI"]').length`)) === 4 ? true : null), 8000, 300);
  check("the count is 4: four seats are on the page", !!seatsUp, "");
  const names = ["A", "B", "C", "D"];
  for (let i = 1; i <= 4; i++) {
    await app.evalJs(`(() => { const g = document.querySelector(${R} + ' [role=radiogroup][aria-label="Seat ${i}: which AI"]'); const r = [...g.querySelectorAll("input[type=radio]")].pop(); r.click(); return true; })()`);
    await app.focusField(`${ROOT} input[aria-label="Seat ${i}: job title"]`);
    await app.cdp("insert", names[i - 1]);
  }
  const seatState = await app.evalJs(`[1,2,3,4].map(i => ({ job: document.querySelector(${R} + ' input[aria-label="Seat ' + i + ': job title"]').value, terminal: [...document.querySelectorAll(${R} + ' [role=radiogroup][aria-label="Seat ' + i + ': which AI"] input[type=radio]')].pop().checked }))`);
  log(`seats: ${JSON.stringify(seatState)}`);
  check("all four seats are Terminal and titled A, B, C, D", seatState.every((s, i) => s.terminal && s.job === names[i]), JSON.stringify(seatState));
  const start = await poll(async () => await app.evalJs(`(() => { const b = document.querySelector(${R} + " .chooser-foot .btn.primary"); return b && !b.disabled ? b.textContent.trim() : null; })()`), 20000, 400);
  log(`start button: ${JSON.stringify(start)}`);
  check("Start is enabled", !!start, String(start));
  await app.click(`${ROOT} .chooser-foot .btn.primary`);
  const gone = await poll(async () => ((await app.exists(`${ROOT} .chooser-foot`)) ? null : true), 20000, 400);
  check(classic ? "the chooser pane is replaced after Start" : "the page closes after Start", !!gone, "");
  await poll(async () => {
    const rs = await rects(app);
    return rs.length >= 4 ? rs : null;
  }, 30000, 500);
  await sleep(3000);
  const afterRects = await rects(app);
  const afterTabs = await tabLabels(app);
  const titles = afterRects.map((r) => String(r.label).replace(/ pane$/, ""));
  log(`after: panes ${JSON.stringify(afterRects)} tab strip ${JSON.stringify(afterTabs)} pane titles ${JSON.stringify(titles)}`);
  const newOnes = names.filter((n) => titles.includes(n));
  check("one new pane per seat appeared, each titled after its seat (A, B, C, D)", newOnes.length === 4, `titles ${JSON.stringify(titles)}`);
  if (classic) check("the tab strip reads the seat names (A, B, C, D among div[role=tab])", names.every((n) => afterTabs.some((t) => t.replace(/[×\s]+$/, "") === n)), JSON.stringify(afterTabs));
  let clash = false;
  for (let i = 0; i < afterRects.length; i++) for (let j = i + 1; j < afterRects.length; j++) if (overlap(afterRects[i], afterRects[j])) clash = true;
  const cols = distinct(afterRects.map((r) => r.x)).length, rows = distinct(afterRects.map((r) => r.y)).length;
  log(`grid after: ${cols} columns x ${rows} rows; overlaps=${clash}`);
  check("the grid re-tiled: panes do not overlap and the grid has more than one column and one row", !clash && cols >= 2 && rows >= 2, `${cols} columns x ${rows} rows, ${afterRects.length} panes`);
  log(`screenshot: ${await ctx.shot(classic ? "SESS-024c" : "SESS-024")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const classic = process.argv[2] === "classic";
  const id = classic ? "SESS-024c" : "SESS-024";
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain(id, { report: rep, standin: STANDIN_BODY, settings: classic ? { uiLook: "classic" } : {} });
    await sleep(3000);
    await run024(ctx, { check: chk.check, log }, classic);
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, id, ev, ok) : 1);
}
