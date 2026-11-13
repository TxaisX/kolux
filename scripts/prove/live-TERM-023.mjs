// LIVE proof, TERM-023 box 1 (spec/03): a pane that finished 3 minutes ago, unseen, shows Done with "3m" and a glow.
// Hidden app, two cells. The stand-in claude.cmd (banner, 20 s, exit 0) runs in cell 2 while the user's focus is on
// cell 1; nothing is touched afterwards. The header text and the pane's class are read right after the finish and
// again when the age label reaches "3m ago".
import { reporter, startPlain, finish, sleep, waitFor, TERM } from "./live-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
let ctx;
let ok = false;
const asserts = [];
const check = (name, pass, detail) => {
  asserts.push(pass);
  log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
const CLAUDE = 'section.pane[data-agent*="claude"]';
try {
  ctx = await startPlain("TERM-023", { report: rep, standin: ["echo finishing in 20 seconds", "ping -n 21 127.0.0.1 >nul", "echo finished", "exit /b 0"] });
  const { app } = ctx;
  await sleep(3000);
  await app.focusPane(TERM, 0, ".xterm-helper-textarea");
  await app.click('.pane.focused button[title^="Split right"]');
  await waitFor("two shells", async () => (await app.shown(TERM)) === 2, 30000);
  await sleep(3000);
  // Claude Code as a new tab in the focused (second) cell.
  // The pane header's plus opens the New session menu (button.newtab went with the old tab strip).
  await app.focusPane("section.pane[data-agent]", 0, ".xterm-helper-textarea");
  await app.click('[data-testid="terminal-pane"].focused [data-testid="pane-new-session"]');
  await waitFor("the New tab menu", () => app.exists('[data-testid="new-session-menu"]'), 5000);
  await app.clickWhere('[data-testid="new-session-menu"] [role="menuitem"]', "/^\\s*Claude Code\\s*$/");
  await waitFor("a Claude pane", () => app.shown(CLAUDE), 20000);
  // The user's focus goes back to cell 1 (the first shell) before the stand-in finishes.
  await app.focusPane(TERM, 0, ".xterm-helper-textarea");
  await sleep(1000);
  const state = () =>
    app.evalJs(`(() => { const s = document.querySelector(${JSON.stringify(CLAUDE)}); if (!s) return null; return { cls: s.className, status: s.querySelector(".st")?.getAttribute("aria-label") ?? null, header: (s.querySelector("header")?.innerText ?? "").replace(/\\s+/g, " ").trim(), focusedInside: s.contains(document.activeElement), shown: s.offsetParent !== null }; })()`);
  log(`after the focus moved away: ${JSON.stringify(await state())}`);
  let t0 = null;
  const done = await waitFor("the Claude pane to read Done", async () => {
    const s = await state();
    if (s && /status: Done/.test(s.status ?? "")) return s;
    return null;
  }, 90000, 1000);
  t0 = Date.now();
  log(`finished: ${JSON.stringify(done)}`);
  check("the pane finished while unfocused and unseen (focus was elsewhere)", done.focusedInside === false, `focusedInside ${done.focusedInside}`);
  check("right after the finish: Done, a glow, and the age reads just now", /glow/.test(done.cls) && /just now/.test(done.header), `${done.cls} | ${done.header}`);
  await ctx.shot("TERM-023-just-finished");
  // Wait until the age reads 3m without ever focusing the pane.
  const three = await waitFor("the age to read 3m ago", async () => {
    const s = await state();
    return s && /3m ago/.test(s.header) ? s : null;
  }, 330000, 5000).catch(() => null);
  const last = three ?? (await state());
  log(`${((Date.now() - t0) / 1000).toFixed(0)} s after Done: ${JSON.stringify(last)}`);
  check("about 3 minutes after the finish, still unseen: status Done, age 3m ago, and the glow class", !!three && /status: Done/.test(three.status ?? "") && /glow/.test(three.cls) && three.focusedInside === false, JSON.stringify(last));
  log(`screenshot: ${await ctx.shot("TERM-023-three-minutes")}`);
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "TERM-023", ev, ok) : 1);
