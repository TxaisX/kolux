// LIVE proof, TERM-041 box 1 (spec/03): choosing Claude from the New tab menu opens a tab whose header shows Claude starting.
// Hidden app; agentOptions.claude.command is a stand-in claude.cmd (banner only, no sign-in). A MutationObserver
// records every status word the Claude pane's header shows from the click on.
import { reporter, startPlain, finish, sleep, waitFor } from "./live-common.mjs";

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
  ctx = await startPlain("TERM-041", { report: rep, standin: [] });
  const { app } = ctx;
  await sleep(2000);
  // Recorder: every status label / title text seen in a Claude pane header, with the time since the click.
  await app.evalJs(`(() => { window.__seen = []; window.__t0 = Date.now(); const snap = () => { for (const s of document.querySelectorAll(${JSON.stringify(CLAUDE)})) { const st = s.querySelector(".st")?.getAttribute("aria-label"); const mark = s.querySelector(".agent-mark")?.getAttribute("title"); const head = s.querySelector("header")?.innerText.replace(/\\s+/g, " ").trim(); const rec = JSON.stringify([st, mark, head]); if (window.__seen[window.__seen.length - 1]?.rec !== rec) window.__seen.push({ ms: Date.now() - window.__t0, rec, st, mark, head, agent: s.getAttribute("data-agent"), label: s.getAttribute("aria-label") }); } }; new MutationObserver(snap).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); return "ok"; })()`);
  // The pane header's plus opens the New session menu (button.newtab went with the old tab strip).
  await app.focusPane("section.pane[data-agent]", 0, ".xterm-helper-textarea");
  await app.click('[data-testid="terminal-pane"].focused [data-testid="pane-new-session"]');
  await waitFor("the New tab menu", () => app.exists('[data-testid="new-session-menu"]'), 5000);
  const items = await app.evalJs(`[...document.querySelectorAll('[data-testid="new-session-menu"] [role="menuitem"] .name')].map(e => e.textContent.trim())`);
  log(`New tab menu items: ${JSON.stringify(items)}`);
  await app.evalJs(`window.__t0 = Date.now()`);
  await app.clickWhere('[data-testid="new-session-menu"] [role="menuitem"]', "/^\\s*Claude Code\\s*$/");
  await waitFor("a Claude pane", () => app.shown(CLAUDE), 20000);
  await sleep(4000);
  const seen = await app.evalJs(`window.__seen`);
  for (const s of seen) log(`  +${s.ms} ms  status=${s.st}  mark=${s.mark}  header="${s.head}"  data-agent=${s.agent}`);
  const final = seen.at(-1);
  check("a Claude pane is shown and its header names Claude", !!final && /claude/i.test(`${final.mark} ${final.head} ${final.label}`), JSON.stringify({ mark: final?.mark, label: final?.label }));
  check("the header showed the Starting state for Claude", seen.some((s) => s.st === "status: Starting"), `states seen: ${JSON.stringify(seen.map((s) => s.st))}`);
  const text = await ctx.text(0, CLAUDE);
  log(`stand-in banner on screen: ${JSON.stringify((text ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(-3))}`);
  log(`screenshot: ${await ctx.shot("TERM-041-claude-tab")}`);
  ok = asserts.every(Boolean);
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "TERM-041", ev, ok) : 1);
