// LIVE proof, STAT-053 box 2 (spec/04): in the Agents view, move keyboard focus to a Thought row, Space opens it, Enter closes it.
// A stand-in claude pane (started the way Kolux starts Claude) is followed; its transcript is a scratch jsonl in the scratch Claude config folder.
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { reporter, startPlain, finish, sleep, poll, checker, STANDIN_BODY, norm } from "./live-proj-common.mjs";
import { allPaneBuffers, rowsOf } from "./live-common.mjs";

const THOUGHT = ".chat-thought button.chat-fold-head";
const state = (app) =>
  app.evalJs(`(() => { const a = document.activeElement; const all = [...document.querySelectorAll(${JSON.stringify(THOUGHT)})]; return { thoughts: all.length, expanded: all.map(b => b.getAttribute("aria-expanded")), activeIsThought: !!a && a.matches(${JSON.stringify(THOUGHT)}), activeExpanded: a?.getAttribute?.("aria-expanded") ?? null, activeIndex: all.indexOf(a) }; })()`);

export async function run053(ctx, { check, log }) {
  const { app } = ctx;
  // A Claude pane started by Kolux in worktree a, in view.
  // The setup made worktree a with `kolux-dev worktree create --name a --agent claude --prompt hi --activate`; the command
  // line is gone, so this proof needs its setup done through the window before it can run again.
  throw new Error("the setup used the retired kolux command line; make worktree a and its Claude pane through the window first");
  const pane = await poll(async () => (await allPaneBuffers(app, 'section.pane[data-agent*="claude"]')).find((b) => b.text?.includes("CWD:")) ?? null, 40000, 800);
  const cwd = pane?.text.split("\n").find((l) => l.startsWith("CWD:"))?.slice(4).trim();
  check("setup: the stand-in Claude pane is up in a's folder", !!cwd && norm(cwd) === norm(pa), `cwd=${cwd ? "found" : "none"}`);
  if (!cwd) return;

  // The transcript the agent would have written: two reasoning messages and replies (scratch text only).
  const folder = cwd.replace(/[^A-Za-z0-9]/g, "-");
  const dir = `${ctx.app.paths.claudeConfig.replace(/\\/g, "/")}/projects/${folder}`;
  mkdirSync(dir, { recursive: true });
  const at = (s) => new Date(Date.now() + s * 1000).toISOString();
  const msg = (n, role, content, s) => JSON.stringify({ type: role, uuid: `00000000-0000-4000-8000-00000000000${n}`, timestamp: at(s), isSidechain: false, message: { id: `m${n}`, role, content, ...(role === "assistant" ? { stop_reason: "end_turn" } : {}) } });
  writeFileSync(`${dir}/live-stat053.jsonl`, [
    msg(1, "user", [{ type: "text", text: "add a note" }], 0),
    msg(2, "assistant", [{ type: "thinking", thinking: "scratch reasoning one", signature: "x" }, { type: "text", text: "First reply." }], 1),
    msg(3, "user", [{ type: "text", text: "and another" }], 2),
    msg(4, "assistant", [{ type: "thinking", thinking: "scratch reasoning two", signature: "x" }, { type: "text", text: "Second reply." }], 3),
  ].join("\n") + "\n");
  log(`scratch transcript written under <scratch>/claude-config/projects/<folder>/ (4 lines)`);

  // The Agents view.
  const opened = await app.evalJs(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Agents"); if (!b) return false; b.click(); return true; })()`);
  log(`Agents switcher clicked: ${opened}`);
  const s0 = await poll(async () => { const s = await state(app); return s.thoughts >= 2 ? s : null; }, 60000, 1000);
  log(`Thought rows in the Agents view: ${JSON.stringify(s0)}`);
  check("setup: the Agents view shows two Thought rows, both collapsed", !!s0 && s0.thoughts === 2 && s0.expanded.every((e) => e === "false"), JSON.stringify(s0));
  if (!s0) { log(`screenshot: ${await ctx.shot("STAT-053-fail")}`); return; }

  // Keyboard focus to a Thought row: Tab from the top of the view until one is focused.
  await app.evalJs(`(() => { document.activeElement?.blur?.(); const c = document.querySelector(".chat-thought")?.closest("[class*=chat]"); window.scrollTo(0, 0); })()`);
  let s = await state(app);
  let tabs = 0;
  while (!s.activeIsThought && tabs < 80) {
    await ctx.rawKey({ key: "Tab", code: "Tab", vk: 9 });
    tabs++;
    s = await state(app);
  }
  log(`Tab presses to reach a Thought row: ${s.activeIsThought ? tabs : "not reached in " + tabs}`);
  let how = `Tab x${tabs}`;
  if (!s.activeIsThought) {
    await app.evalJs(`document.querySelector(${JSON.stringify(THOUGHT)}).focus()`);
    s = await state(app);
    how = "focus() on the first row (Tab did not reach it)";
  }
  check("focus is on a Thought row, collapsed", s.activeIsThought && s.activeExpanded === "false", `${how}; ${JSON.stringify(s)}`);
  const idx = s.activeIndex;
  await ctx.rawKey({ key: " ", code: "Space", vk: 32, text: " " });
  await sleep(500);
  const afterSpace = await state(app);
  log(`after Space: ${JSON.stringify(afterSpace)}`);
  check("Space opens it (aria-expanded=true)", afterSpace.activeIsThought && afterSpace.activeExpanded === "true" && afterSpace.expanded[idx] === "true", `expanded=${JSON.stringify(afterSpace.expanded)}`);
  log(`screenshot open: ${await ctx.shot("STAT-053-open")}`);
  await ctx.rawKey({ key: "Enter", code: "Enter", vk: 13, text: "\r" });
  await sleep(500);
  const afterEnter = await state(app);
  log(`after Enter: ${JSON.stringify(afterEnter)}`);
  check("Enter closes it (aria-expanded=false)", afterEnter.activeIsThought && afterEnter.activeExpanded === "false" && afterEnter.expanded.every((e) => e === "false"), `expanded=${JSON.stringify(afterEnter.expanded)}`);
  log(`screenshot closed: ${await ctx.shot("STAT-053-closed")}`);
  log(`real agent programs under the app: ${JSON.stringify(await ctx.realAgents())}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rep = reporter();
  const { log, lines: ev } = rep;
  const chk = checker(log);
  let ctx;
  let ok = false;
  try {
    ctx = await startPlain("STAT-053", { report: rep, standin: STANDIN_BODY });
    log(`real agent programs at start: ${JSON.stringify(await ctx.realAgents())}`);
    await sleep(3000);
    await run053(ctx, { check: chk.check, log });
    ok = chk.allPassed();
  } catch (e) {
    log(`ERROR ${e.stack ?? e}`);
  }
  process.exit(ctx ? await finish(ctx, "STAT-053", ev, ok) : 1);
}
