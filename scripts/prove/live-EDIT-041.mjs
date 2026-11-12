// LIVE proof, EDIT-041 box 1 (spec/12): an Inbox item for a waiting agent -> Open in Code -> Code view, correct worktree, correct pane focused.
// The agent is a stand-in claude.cmd that posts a UserPromptSubmit hook event through the same endpoint the installed hook script uses
// (no sign-in); the pane's status turns Working, so the Inbox lists it under "Waiting on agent". A second worktree makes "correct" mean something.
import { reporter, startPlain, finish, sleep, poll, checker, tabs } from "./live-edit-common.mjs";

const rep = reporter();
const { log, lines: ev } = rep;
const { check, allPassed } = checker(log);
const post =
  'type "%~dp0prompt.json" | curl.exe -s -m 1.5 --connect-timeout 0.5 --noproxy "*" -X POST -H "Content-Type: application/json" -H "X-Kolux-Token: %KT%" -H "X-Kolux-Pane: %KOLUX_HOOK_IDENTITY%" -H "X-Kolux-Config: %CLAUDE_CONFIG_DIR%" --data-binary @- -o NUL "http://127.0.0.1:%KP%/claude" >NUL 2>&1';
const standin = [
  '>"%~dp0prompt.json" echo {"hook_event_name":"UserPromptSubmit","session_id":"live-041","prompt":"review the change"}',
  'if "%KOLUX_PANE_KEY%"=="" (echo not in a Kolux pane & exit /b 0)',
  'set "KP=%KOLUX_AGENT_HOOK_PORT%"',
  'set "KT=%KOLUX_AGENT_HOOK_TOKEN%"',
  'if not "%KOLUX_HOOK_ENDPOINT%"=="" if exist "%KOLUX_HOOK_ENDPOINT%" for /f "usebackq tokens=1,2" %%a in ("%KOLUX_HOOK_ENDPOINT%") do (set "KP=%%a" & set "KT=%%b")',
  post,
  "echo hook event posted; staying up",
];
const CLAUDE = 'section.pane[data-agent*="claude"]';
let ctx;
let ok = false;
try {
  ctx = await startPlain("EDIT-041", { report: rep, standin });
  const { app } = ctx;
  await sleep(2500);
  // Which worktree row is selected: the main one is the project's branch button, the others are [data-worktree] rows.
  const selected = () => app.evalJs(`(()=>{const m=document.querySelector("button.branch.sel"); if(m) return "main"; const o=[...document.querySelectorAll("[data-worktree]")].find(e=>e.querySelector(".sess.sel")); return o?o.dataset.worktree:null;})()`);
  const labels = () => app.evalJs(`[...document.querySelectorAll("button.branch .name, [data-worktree]")].map(e=>e.dataset&&e.dataset.worktree?e.dataset.worktree:e.textContent.trim())`);
  // The second worktree is made the way a person makes one: the + on the project header, a name, Enter.
  await app.click('.proj button.ib[title^="New workspace"]');
  await app.waitFor("the workspace name field", () => app.exists('input[aria-label="workspace name"]'), 8000);
  await app.focusField('input[aria-label="workspace name"]');
  // A suggested name is filled in a moment after the form opens; wait for it, then replace it.
  await sleep(1500);
  await app.evalJs(`document.querySelector('input[aria-label="workspace name"]').select()`);
  await app.cdp("insert", "wt-b");
  log(`field now: ${JSON.stringify(await app.evalJs(`[document.querySelector('input[aria-label="workspace name"]').value, [...document.querySelectorAll(".sb-form .preview")].map(e=>e.textContent)]`))}`);
  await app.waitFor("the preview names wt-b", async () => (await app.evalJs(`document.querySelector(".sb-form .preview")?.textContent||""`)).startsWith("branch wt-b"), 8000);
  await app.cdp("key", "Enter");
  await sleep(5000);
  log(`after the create: form ${await app.exists('input[aria-label="workspace name"]')}, notes ${JSON.stringify(await app.evalJs(`[...document.querySelectorAll(".sb-list .note, .sb-list .preview, .toast")].map(e=>e.textContent.trim().slice(0,200))`))}`);
  const made = await poll(async () => (await labels()).includes("wt-b"), 30000, 800);
  await sleep(2500);
  log(`worktrees in the sidebar: ${JSON.stringify(await labels())}; selected: ${await selected()}`);
  check("setup: the second worktree (wt-b) exists and is the one shown", !!made && (await selected()) === "wt-b", `labels=${JSON.stringify(await labels())} selected=${await selected()}`);
  // The pane header's plus opens the New session menu (button.newtab went with the old tab strip).
  await app.focusPane("section.pane[data-agent]", 0, ".xterm-helper-textarea");
  await app.click('[data-testid="terminal-pane"].focused [data-testid="pane-new-session"]');
  await app.waitFor("the New tab menu", () => app.exists('[data-testid="new-session-menu"]'), 5000);
  await app.clickWhere('[data-testid="new-session-menu"] [role="menuitem"]', "/^ *Claude Code *$/");
  await app.waitFor("a Claude pane", () => app.shown(CLAUDE), 20000);
  const working = await poll(() => app.evalJs(`[...document.querySelectorAll(${JSON.stringify(CLAUDE + " .st")})].some(e=>e.getAttribute("aria-label")==="status: Working")`), 30000, 500);
  log(`Claude pane working: ${!!working}; tabs in wt-b ${JSON.stringify(await tabs(app))}`);
  check("setup: the stand-in's hook event turned the Claude pane to Working", !!working, `working=${working}`);

  // Look away: the main worktree, then the Inbox.
  await app.evalJs(`document.querySelector("button.branch").click()`);
  await sleep(1500);
  const away = { selected: await selected(), claudeShown: await app.shown(CLAUDE) };
  log(`looking away: ${JSON.stringify(away)}`);
  check("setup: the main worktree is shown and the Claude pane is not on screen", away.selected === "main" && away.claudeShown === 0, JSON.stringify(away));
  await app.evalJs(`document.querySelector("button.bell").click()`);
  await sleep(1500);
  const inbox = await app.evalJs(`(()=>{const l=document.querySelector(".inbox"); if(!l) return null; return {groups:[...l.querySelectorAll("section[aria-label]")].map(s=>s.getAttribute("aria-label")+":"+[...s.querySelectorAll("[role=option]")].map(o=>o.textContent.trim()).join(" || ")), pressed:[...document.querySelectorAll(".switcher button[aria-pressed=true]")].map(b=>b.textContent.trim())};})()`);
  log(`inbox: ${JSON.stringify(inbox)}`);
  const waiting = inbox?.groups.find((g) => g.startsWith("Waiting on agent:"));
  check("the Inbox lists the agent under Waiting on agent", !!waiting && /Claude/i.test(waiting), JSON.stringify(inbox));
  log(`screenshot: ${await ctx.shot("EDIT-041-inbox")}`);
  await app.evalJs(`[...document.querySelectorAll(".inbox section[aria-label='Waiting on agent'] [role=option]")][0].click()`);
  await sleep(800);
  const btn = await app.evalJs(`document.querySelector(".inbox .detail button.btn.primary")?.textContent ?? null`);
  log(`detail button: ${btn}`);
  check("the detail button reads Open in Code", btn === "Open in Code", String(btn));
  await app.evalJs(`document.querySelector(".inbox .detail button.btn.primary").click()`);
  await sleep(2500);
  const landed = await app.evalJs(`(()=>{const f=[...document.querySelectorAll("section.pane")].find(p=>p.offsetParent!==null&&p.classList.contains("focused")); return {pressed:[...document.querySelectorAll(".switcher button[aria-pressed=true]")].map(b=>b.textContent.trim()), focusedPane:f?{agent:f.dataset.agent, cls:f.className}:null, visibleClaude:[...document.querySelectorAll(${JSON.stringify(CLAUDE)})].filter(p=>p.offsetParent!==null).length};})()`);
  const now = { selected: await selected(), tabs: await tabs(app) };
  log(`after Open in Code: ${JSON.stringify(landed)}; ${JSON.stringify(now)}`);
  check("Code view is shown", landed.pressed[0] === "Terminals", JSON.stringify(landed.pressed));
  check("the agent's worktree (wt-b) is the one shown, not the main one", now.selected === "wt-b", JSON.stringify(now));
  check("the agent's tab is in front and its pane has the focus", landed.visibleClaude === 1 && /claude/i.test(landed.focusedPane?.agent ?? "") && now.tabs.some((t) => /^Claude/.test(t) && t.endsWith(":true")), JSON.stringify({ landed, tabs: now.tabs }));
  log(`screenshot: ${await ctx.shot("EDIT-041-landed")}`);
  ok = allPassed();
} catch (e) {
  log(`ERROR ${e.stack ?? e}`);
}
process.exit(ctx ? await finish(ctx, "EDIT-041", ev, ok) : 1);
