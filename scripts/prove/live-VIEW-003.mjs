// LIVE proof, VIEW-003 box 1 (spec/05): New look, click the top bar's search hint -> the worktree palette opens with the
// keyboard focus in its input. Hidden app, over CDP.
import { reporter, startPlain, finish, sleep, waitFor, checker } from "./live-views-dom.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
let ctx;
let ok = false;
try {
  ctx = await startPlain("VIEW-003", { report: rep });
  const { app } = ctx;
  await sleep(3000);
  const hint = await app.evalJs(`(() => { const b = document.querySelector(".searchbox"); if (!b) return null; const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  log(`search hint: ${JSON.stringify(hint)}`);
  check("setup: the top bar shows the search hint", !!hint && hint.w > 0, JSON.stringify(hint));
  const closedBefore = await app.exists('[role="dialog"][aria-label="Switch workspace"]');
  // Park the keyboard focus on the page body first, so a focused input afterwards can only come from the click.
  await app.evalJs(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`);
  await app.click(".searchbox");
  await waitFor("the worktree palette", () => app.exists('[role="dialog"][aria-label="Switch workspace"]'), 8000);
  await sleep(600);
  const st = await app.evalJs(`(() => { const a = document.activeElement; const dlg = document.querySelector('[role="dialog"][aria-label="Switch workspace"]'); return { tag: a?.tagName, cls: a?.className ?? "", inDialog: !!dlg && dlg.contains(a), placeholder: a?.getAttribute?.("placeholder") ?? null }; })()`);
  log(`palette open before the click: ${closedBefore}; focus after: ${JSON.stringify(st)}`);
  check("the palette was closed before the click", !closedBefore, String(closedBefore));
  check("clicking the hint opens the worktree palette with focus in its input", st.tag === "INPUT" && /picker-input/.test(st.cls) && st.inDialog, JSON.stringify(st));
  // Typing goes into that input with no further click.
  await app.cdp("insert", "zz");
  await sleep(400);
  const typed = await app.evalJs(`document.querySelector('[role="dialog"][aria-label="Switch workspace"] input.picker-input')?.value`);
  check("typing without another click lands in the palette input", typed === "zz", JSON.stringify(typed));
  log(`screenshot: ${await ctx.shot("VIEW-003-palette")}`);
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "VIEW-003", ev, ok) : 1);
