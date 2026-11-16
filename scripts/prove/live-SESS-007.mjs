// LIVE proof, SESS-007 box 3 (spec/02): a chooser left as the grid's only pane has no close button.
// Usage: node live-SESS-007.mjs [classic|new]. Classic opens the chooser as a grid pane; the New look is probed the same way and its placement logged.
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, STANDIN_BODY, panes } from "./live-proj-common.mjs";
import { PLUS } from "./live-SESS-004.mjs";

const CHOOSER = 'section.pane.chooser[aria-label$="chooser"]';
const CLOSE_CHOOSER = `${CHOOSER} button.ib[title="Close this chooser"]`;
const SHEET = "section.pane.chooser.sheet";

/** New look: the chooser opens as the New session sheet over the page, not as a grid pane; the card says the sheet keeps its own close button. */
async function checkSheet(ctx, { check, log }) {
  const { app } = ctx;
  const up = await poll(() => app.exists(SHEET), 10000, 300);
  const gridChoosers = await app.evalJs(`document.querySelectorAll(${JSON.stringify(CHOOSER)}).length`);
  const closes = await app.evalJs(`[...document.querySelectorAll(${JSON.stringify(SHEET + " button")})].filter(b => /close/i.test((b.title || "") + " " + (b.getAttribute("aria-label") || ""))).map(b => b.title || b.getAttribute("aria-label"))`);
  log(`new look: chooser sheet present=${!!up}; grid-pane choosers=${gridChoosers}; close buttons on the sheet: ${JSON.stringify(closes)}`);
  check("new look: the chooser is a sheet, not a grid pane (the box's lone grid chooser does not exist here)", !!up && gridChoosers === 0, `sheet=${!!up} gridChoosers=${gridChoosers}`);
  check("new look: the sheet keeps its own close button (the card's other half)", closes.length > 0, JSON.stringify(closes));
  log(`screenshot: ${await ctx.shot("SESS-007-new")}`);
}

export async function run007b3(ctx, { check, log }, lookName = "classic") {
  const { app } = ctx;
  const look = await app.evalJs(`document.documentElement.getAttribute("data-look") ?? document.body.className ?? null`);
  log(`look marker: ${JSON.stringify(look)}`);
  await app.evalJs(`document.querySelector(${JSON.stringify(PLUS)}).click()`);
  await poll(() => app.exists('[role=menu][aria-label="New session"]'), 8000, 300);
  await app.evalJs(`(() => { const b = [...document.querySelectorAll('[role=menu][aria-label="New session"] [role=menuitem]')].find(b => /^(Open a pane that asks|Pick folders)/.test(b.title)); b.click(); return true; })()`);
  if (lookName === "new") return checkSheet(ctx, { check, log });
  const up = await poll(() => app.exists(CHOOSER), 10000, 300);
  check(`a chooser pane is in the grid (${lookName} look)`, !!up, `chooser present=${!!up}`);
  log(`chooser ancestry: ${await app.evalJs(`(() => { const out = []; for (let e = document.querySelector(${JSON.stringify(CHOOSER)}); e && out.length < 6; e = e.parentElement) out.push(e.tagName.toLowerCase() + "." + String(e.className).split(" ").filter(Boolean).slice(0, 3).join(".") + (e.getAttribute("role") ? "[" + e.getAttribute("role") + "]" : "")); return out.join(" < "); })()`)}`);
  const two = await panes(app);
  log(`panes with a chooser added: ${JSON.stringify(two)}`);
  const withMate = await app.exists(CLOSE_CHOOSER);
  log(`close button while the shell pane is still there: ${withMate}`);
  // Close every other pane so the chooser stands alone.
  for (let i = 0; i < 4; i++) {
    const others = await app.evalJs(`[...document.querySelectorAll("section.pane[data-agent]")].filter(e => !e.classList.contains("chooser") && e.offsetParent !== null).length`);
    if (!others) break;
    await app.evalJs(`(() => { const e = [...document.querySelectorAll("section.pane[data-agent]")].find(e => !e.classList.contains("chooser") && e.offsetParent !== null); e.querySelector('button.ib[title^="Close pane"]').click(); return true; })()`);
    await sleep(1500);
    await app.evalJs(`(() => { const d = document.querySelector("[role=alertdialog]"); if (!d) return false; const b = [...d.querySelectorAll("button")].find(b => /close|end|remove|yes/i.test(b.textContent)); if (b) b.click(); return !!b; })()`);
    await sleep(1500);
  }
  await sleep(1000);
  const left = await app.evalJs(`[...document.querySelectorAll("section.pane")].filter(e => e.offsetParent !== null).map(e => ({ cls: e.className, label: e.getAttribute("aria-label"), buttons: [...e.querySelectorAll(".pane-head button")].map(b => b.title) }))`);
  log(`visible panes now: ${JSON.stringify(left)}`);
  const lone = left.length === 1 && /chooser/.test(left[0].cls);
  check("the chooser is the grid's only pane", lone, JSON.stringify(left.map((l) => l.label)));
  const btn = await app.exists(CLOSE_CHOOSER);
  log(`close button on the lone chooser: ${btn}`);
  check("the lone chooser has no close button", lone && !btn, `button present=${btn}`);
  log(`screenshot: ${await ctx.shot(`SESS-007-${lookName}`)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    const lookName = process.argv[2] === "new" ? "new" : "classic";
    ctx = await startPlain(`SESS-007-${lookName}`, { report: rep, standin: STANDIN_BODY, settings: { uiLook: lookName } });
    await sleep(3000);
    await run007b3(ctx, { check: chk.check, log }, lookName);
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, `SESS-007-${process.argv[2] === "new" ? "new" : "classic"}`, ev, ok) : 1);
}
