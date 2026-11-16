// LIVE proof, SESS-018 box 1 (spec/02): on the New look, opening New session shows a full-page sheet that fills the workspace area
// (headed "New session", the project and its path), not a dialog.
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, STANDIN_BODY } from "./live-proj-common.mjs";
import { PLUS } from "./live-SESS-004.mjs";

/** Opens the New session page from the pane header's plus menu (its "Choose" item). */
export async function openSheet(app) {
  await app.evalJs(`document.querySelector(${JSON.stringify(PLUS)}).click()`);
  await poll(() => app.exists('[role=menu][aria-label="New session"]'), 8000, 300);
  await app.evalJs(`(() => { const b = [...document.querySelectorAll('[role=menu][aria-label="New session"] [role=menuitem]')].find(b => /^(Open a pane that asks|Pick folders)/.test(b.title)); b.click(); return true; })()`);
  return poll(() => app.exists('.sheet-wrap section[aria-label="New session"]'), 10000, 300);
}

export async function run018(ctx, { check, log }) {
  const { app } = ctx;
  const opened = await openSheet(app);
  check("the New session page is up (a section labelled New session inside .sheet-wrap)", !!opened, `opened=${opened}`);
  await sleep(800);
  const r = await app.evalJs(`(() => {
    const c = document.querySelector(".content").getBoundingClientRect(), w = document.querySelector(".sheet-wrap").getBoundingClientRect(), s = document.querySelector('.sheet-wrap section[aria-label="New session"]');
    const sr = s.getBoundingClientRect();
    return { content: [c.left, c.top, c.right, c.bottom].map(Math.round), wrap: [w.left, w.top, w.right, w.bottom].map(Math.round), sheet: [sr.left, sr.top, sr.right, sr.bottom].map(Math.round),
      heading: s.querySelector("h2")?.textContent ?? null, project: s.querySelector(".sheet-project")?.textContent ?? null, path: s.querySelector(".sheet-path")?.textContent ?? null,
      dialogs: document.querySelectorAll('[role=dialog],[role=alertdialog]').length, cls: s.className, aria: s.getAttribute("aria-label") };
  })()`);
  log(`geometry: ${JSON.stringify(r)}`);
  const edge = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 8.5);
  const inset = [r.content[0] + 8, r.content[1] + 8, r.content[2] - 8, r.content[3] - 8];
  check("the sheet fills the workspace area (each edge within 8 px of the .content edges)", edge(r.sheet, inset) && r.sheet[0] >= r.content[0] && r.sheet[1] >= r.content[1] && r.sheet[2] <= r.content[2] && r.sheet[3] <= r.content[3], `sheet ${r.sheet} vs content ${r.content}`);
  const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
  check("it covers at least 95% of the workspace area", area(r.sheet) / area(r.content) >= 0.95, `ratio ${(area(r.sheet) / area(r.content)).toFixed(3)}`);
  check("it is headed New session and names the project and its path", r.heading === "New session" && !!r.project && !!r.path, `${r.heading} / ${r.project} / ${r.path}`);
  check("it is a page, not a dialog", r.dialogs === 0 && /\bsheet\b/.test(r.cls), `dialogs=${r.dialogs} class=${r.cls}`);
  log(`screenshot: ${await ctx.shot("SESS-018")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("SESS-018", { report: rep, standin: STANDIN_BODY });
    await sleep(3000);
    await run018(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "SESS-018", ev, ok) : 1);
}
