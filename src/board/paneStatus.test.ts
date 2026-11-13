// T-608 (brief "Path to an A", Phase 0): the Board, the Tower, the Inbox, the needs strip and the bell read
// one status per pane, the title guess included, so they never disagree. Each surface is built here the way
// the window builds it (evidence/product-ux-App.patch): the Board and the Tower from chipOf, the Inbox from
// sourceOf and inboxItems, the strip from waitingInGrid and the bell from needsYouCount over needsYou, all
// over the one paneStatus.
import { expect, test } from "vitest";
import { chipOf, forget, hooksMuted, needsAttention, needsYou, paneAgent, paneStatus, promptReturned, ringsBell, type Lane } from "./chip";
import { IDLE, reduceIdentity, type Identity } from "../terminal/shellMarks";
import type { Agent } from "../chrome/VendorMark";
import { windowSource as app } from "../shell/windowSource";
import { towerRows } from "../tower/tower";
import { inboxItems, sourceOf, type Group } from "../inbox/inbox";
import type { AgentState } from "../projects/rows";
import { tabBadge, waitingInGrid } from "../terminal/tabs";
import { headerOf, needsYouCount, nextNeedsYou } from "../terminal/status";
import { paneState, strongest } from "../projects/rows";

const now = 1_000_000;
type Case = { agent?: string; agentId?: string; program?: string | null; live?: Identity; hook?: AgentState; guess?: AgentState | null; running: boolean | undefined };

/** One pane drawn on all five surfaces from the same signals (the Tower lists agent panes only, App.tsx towerNow). */
function surfaces(c: Case) {
  // The window reads the agent a pane shows (App.tsx agentOf): a plain terminal's live program counts.
  const agent = paneAgent({ agent: (c.agent ?? "claude") as Agent, agentId: c.agentId, program: c.program ?? null }, c.live);
  const state = paneStatus(agent, c.hook, c.guess, c.running);
  const chip = chipOf({ agent, state, running: c.running, stale: false, since: now - 60_000 }, now);
  const board: Lane = chip?.lane ?? "idle";
  const tower = agent === "shell" ? "idle" : towerRows([{ key: 1, agent, title: "Claude 1", branch: null, cwd: null, account: null, chip, meter: null, since: now - 60_000 }])[0].lane;
  const inboxRow = inboxItems([sourceOf({ key: 1, agent, branch: null, cwd: null }, "Claude 1", state, c.running, { at: now - 60_000, interrupted: false })], now)[0];
  const inbox: Group | null = inboxRow?.group ?? null;
  const strip = waitingInGrid([1], { 1: state }).length === 1;
  const bell = needsYouCount([1], new Set(needsAttention(state) ? [1] : [])); // App.tsx needing (as on main: a stop counts)
  // The sidebar row (App.tsx byDir): the one status, else what the program says.
  const sidebar = strongest([state ?? paneState(agent, c.running)]);
  return { board, tower, inbox, strip, bell, sidebar, state };
}

/** What needs you, said the same way by every surface. */
const needs = (s: ReturnType<typeof surfaces>) => [s.board === "needs", s.tower === "needs", s.inbox === "needs", s.strip, s.bell === 1];

test("T-608: a permission or a question needs you on all five surfaces", () => {
  for (const hook of ["permission", "waiting"] as const) expect(needs(surfaces({ hook, running: true }))).toEqual([true, true, true, true, true]);
});

test("T-608: the title guess feeds the same state: a guessed permission needs you on all five, not only on the bell", () => {
  expect(needs(surfaces({ guess: "permission", running: true }))).toEqual([true, true, true, true, true]);
});

test("T-608: the hook's word wins over the title guess everywhere", () => {
  const s = surfaces({ hook: "working", guess: "permission", running: true });
  expect(needs(s)).toEqual([false, false, false, false, false]);
  expect([s.board, s.tower, s.inbox]).toEqual(["working", "working", "waiting"]);
});

test("T-608 / review of PR #16: a stop is Stopped on the Board and Tower and not on the strip, but the bell still counts it, and the Inbox lists a blocked one, as on main", () => {
  const blocked = surfaces({ hook: "blocked", running: true });
  expect([blocked.board, blocked.tower]).toEqual(["stopped", "stopped"]);
  expect(needs(blocked)).toEqual([false, false, true, false, true]);
  const interrupted = surfaces({ hook: "interrupted", running: true });
  expect([interrupted.board, interrupted.tower]).toEqual(["stopped", "stopped"]);
  expect(needs(interrupted)).toEqual([false, false, false, false, true]);
  expect(interrupted.inbox).toBeNull();
});

test("T-608: a guessed done or working puts the card in the lane the Inbox groups it under", () => {
  const done = surfaces({ guess: "done", running: true });
  expect([done.board, done.tower, done.inbox]).toEqual(["done", "done", "done"]);
  const working = surfaces({ guess: "working", running: true });
  expect([working.board, working.tower, working.inbox]).toEqual(["working", "working", "waiting"]);
});

test("T-608: a title guess counts only while the program runs: starting or ended, nothing needs you anywhere", () => {
  for (const running of [undefined, false]) expect(needs(surfaces({ guess: "permission", running }))).toEqual([false, false, false, false, false]);
  expect(surfaces({ guess: "permission", running: undefined }).board).toBe("working"); // Starting
  expect(surfaces({ guess: "permission", running: false }).board).toBe("stopped");
});

test("T-608: a plain terminal with nothing running in it has no status on any of the five, whatever a hook or its title said last", () => {
  for (const hook of [undefined, "permission", "waiting", "done"] as const)
    for (const guess of [null, "permission"] as const) {
      const s = surfaces({ agent: "shell", hook, guess, running: true });
      expect(needs(s), `${hook}/${guess}`).toEqual([false, false, false, false, false]);
      expect([s.board, s.inbox], `${hook}/${guess}`).toEqual(["idle", null]);
    }
});

test("T-608: every live state reads one way on every surface (the Board and the Tower show the same lane; the Inbox groups it to match)", () => {
  const inboxOf: Record<Lane, Group | null> = { needs: "needs", working: "waiting", done: "done", stopped: null, idle: null };
  const states: Array<AgentState | undefined> = [undefined, "permission", "blocked", "waiting", "interrupted", "working", "queued", "done", "idle"];
  for (const hook of states)
    for (const guess of [null, "permission", "working", "done"] as const) {
      const s = surfaces({ hook, guess, running: true });
      expect(s.tower, `${hook}/${guess}`).toBe(s.board);
      if (s.state !== "blocked" && s.state !== "interrupted") {
        expect(s.inbox, `${hook}/${guess}`).toBe(inboxOf[s.board]);
        expect(new Set(needs(s)).size, `${hook}/${guess}`).toBe(1);
      }
    }
});

test("T-608 (ACCT-050, DT-C11): an agent started by hand in a plain terminal is credited: its permission needs you on all five, and back at the prompt on none", () => {
  const claude = reduceIdentity(reduceIdentity(IDLE, { kind: "start" }), { kind: "title", text: "✳ Claude Code" });
  expect(claude.agent).toBe("claude");
  const asking = surfaces({ agent: "shell", live: claude, hook: "permission", running: true });
  expect(needs(asking)).toEqual([true, true, true, true, true]);
  const back = reduceIdentity(claude, { kind: "end", code: 0 });
  expect(needs(surfaces({ agent: "shell", live: back, hook: "permission", running: true }))).toEqual([false, false, false, false, false]);
});

test("T-608 review: a Kolux-launched agent with no vendor mark (Gemini: agent shell plus agentId) asking a permission needs you on all five surfaces and the sidebar", () => {
  for (const program of [null, "gemini"]) {
    const s = surfaces({ agent: "shell", agentId: "gemini", program, hook: "permission", running: true });
    expect(needs(s), String(program)).toEqual([true, true, true, true, true]);
    expect(s.sidebar, String(program)).toBe("permission");
  }
});

test("review of PR #16: when the prompt returns in a plain terminal, the quit agent's hook word and guess are cleared, so the next agent there does not inherit Needs you", () => {
  const shell = { agent: "shell" as Agent, program: null };
  const claude = reduceIdentity(reduceIdentity(IDLE, { kind: "start" }), { kind: "title", text: "✳ Claude Code" });
  let hook: Record<number, AgentState> = { 1: "permission", 2: "waiting" };
  let guess: Record<number, AgentState | null> = { 1: "permission" };
  const back = reduceIdentity(claude, { kind: "prompt" });
  expect(promptReturned(shell, claude, back)).toBe(true);
  hook = forget(hook, 1);
  guess = forget(guess, 1);
  expect(hook).toEqual({ 2: "waiting" }); // another pane keeps its own
  expect(guess).toEqual({});
  // The next agent started there has said nothing yet: it needs you nowhere.
  const again = reduceIdentity(reduceIdentity(back, { kind: "start" }), { kind: "title", text: "✳ Claude Code" });
  expect(needs(surfaces({ agent: "shell", live: again, hook: hook[1], guess: guess[1], running: true }))).toEqual([false, false, false, false, false]);
  // Not cleared: a pane Kolux launched an agent in, a prompt with no agent before it, or an agent still running.
  expect(promptReturned({ agent: "claude" as Agent, program: null }, claude, back)).toBe(false);
  expect(promptReturned({ agent: "shell" as Agent, agentId: "gemini", program: null }, claude, back)).toBe(false);
  expect(promptReturned(shell, IDLE, back)).toBe(false);
  expect(promptReturned(shell, claude, claude)).toBe(false);
});

// DT-C52 (Txais answered the three T-608 questions, 2026-10-31).
test("DT-C52 answer 1: a pane blocked by a usage limit or a sign-in still counts as needing you in the Inbox and on the bell; the Board and the Tower say Stopped", () => {
  for (const cause of ["limit", "signin"] as const) {
    const s = surfaces({ hook: "blocked", running: true });
    expect([s.inbox, s.bell], cause).toEqual(["needs", 1]);
    expect([s.board, s.tower, s.strip], cause).toEqual(["stopped", "stopped", false]);
    const chip = chipOf({ agent: "claude", state: "blocked", running: true, stale: false, since: now - 60_000, stop: { cause } }, now)!;
    expect([chip.lane, chip.word], cause).toEqual(["stopped", "Stopped"]);
    expect(needsAttention("blocked"), cause).toBe(true); // App.tsx needing: the bell's rule
  }
});

test("DT-C52 answer 2: an agent whose program has exited is Stopped in the Inbox, as on the Board and the Tower, never Done today", () => {
  const exited = surfaces({ running: false });
  expect([exited.board, exited.tower, exited.inbox]).toEqual(["stopped", "stopped", "stopped"]);
  const row = inboxItems([sourceOf({ key: 1, agent: "claude", branch: null, cwd: null }, "Claude 1", undefined, false, { at: now - 60_000, interrupted: false })], now)[0];
  expect(row).toMatchObject({ group: "stopped", label: "Stopped", state: "stopped" });
  // A turn that is over while the program still runs is still Done today.
  expect(surfaces({ hook: "done", running: true }).inbox).toBe("done");
});

/** App.tsx: what Ctrl+J (terminals.focusNextNeedsYou) visits and the tab badge, from the one status (DT-C52). */
const jump = (hooks: Array<AgentState | undefined>, focused: number) => {
  const keys = hooks.map((_, i) => i + 1);
  return nextNeedsYou(keys, new Set(keys.filter((k) => needsYou(paneStatus("claude", hooks[k - 1], null, true)))), focused);
};

test("DT-C52 answer 3: Ctrl+J and the tab badges count only a permission or a question, not the header's attention flag", () => {
  // Panes 1 to 4: blocked, interrupted, permission, waiting. The header flags all four; Ctrl+J visits only 3 and 4.
  const hooks: AgentState[] = ["blocked", "interrupted", "permission", "waiting"];
  for (const h of hooks) expect(headerOf("claude", "running", undefined, false, null, 0, h).needsYou, h).toBe(true);
  expect(jump(hooks, 4)).toBe(3);
  expect(jump(hooks, 3)).toBe(4);
  expect(jump(["blocked", "interrupted", "working"], 1), "nothing but a stop: focus stays").toBeNull();
  // The tab badge: a question mark only for a permission or a question; a stop shows Stopped.
  const badge = (h: AgentState) => tabBadge("claude", true, needsYou(paneStatus("claude", h, null, true)), false, h);
  expect(hooks.map(badge)).toEqual(["stopped", "stopped", "permission", "permission"]);
  // A guessed permission (title only) counts, as on the other surfaces.
  expect(needsYou(paneStatus("claude", undefined, "permission", true))).toBe(true);
  // The window reads them so: Ctrl+J, the pane header's tab marks (one session per cell, shell/window/paneTab.ts, fed
  // statusOf by Pane.tsx) and the palette's tab rows take the one status, not `needs`.
  const ctrlJ = app.slice(app.indexOf('case "terminals.focusNextNeedsYou"'), app.indexOf('case "tab.search"'));
  expect(ctrlJ).toMatch(/needsYou\(statusOf\(p\)\)/);
  expect(ctrlJ).not.toMatch(/needs\[/);
  expect(app.match(/tabBadge\(p\.agent, running\[p\.key\], needsYou\(statusOf\(p\)\),/g)).toHaveLength(1);
  expect(app.match(/tabBadge\(p\.agent, w\.running\[p\.key\], needsYou\(w\.status\),/g)).toHaveLength(1);
  expect(app).toMatch(/tabMarksOf\(p, \{[\s\S]{0,200}status: statusOf\(p\),/);
  expect(app).not.toMatch(/tabBadge\([^)]*needs\[p\.key\]/);
});

test("review of PR #16 (c): a pane whose program failed to start rings the bell again, as on main before PR #16", () => {
  const failed = headerOf("claude", "failed", undefined, false, null, 0);
  expect(failed.needsYou).toBe(true);
  // The window has no hook word for it; its header's own flag rings the bell.
  expect(ringsBell(undefined, failed.needsYou)).toBe(true);
  expect(needsYouCount([1, 2], new Set([1, 2].filter((k) => ringsBell(undefined, k === 1 && failed.needsYou))))).toBe(1);
  // Nothing new rings: a working pane whose header is calm stays out; the bell's own rule (answer 1) is kept.
  expect(ringsBell("working", false)).toBe(false);
  expect(ringsBell("permission", false) && ringsBell("interrupted", false)).toBe(true);
  // The window's bell: the one status, or the header's own flag (`needs`), as on main.
  expect(app).toMatch(/ringsBell\(statusOf\(p\), needs\[p\.key\] \?\? false\)/);
});

test("review of PR #16 (d): once a plain terminal's prompt is back, its hook words are ignored until a new agent starts there", () => {
  const shell = { agent: "shell" as Agent, program: null };
  const claude = reduceIdentity(reduceIdentity(IDLE, { kind: "start" }), { kind: "title", text: "✳ Claude Code" });
  const back = reduceIdentity(claude, { kind: "prompt" });
  let muted = hooksMuted(false, shell, claude, back);
  expect(muted, "the prompt returned").toBe(true);
  // A plain command at the prompt keeps it muted (no agent is named).
  const ls = reduceIdentity(back, { kind: "start" });
  muted = hooksMuted(muted, shell, back, ls);
  expect(muted).toBe(true);
  muted = hooksMuted(muted, shell, ls, reduceIdentity(ls, { kind: "prompt" }));
  expect(muted).toBe(true);
  // A new agent is recognised: its hooks count again.
  const again = reduceIdentity(reduceIdentity(back, { kind: "start" }), { kind: "title", text: "✳ Claude Code" });
  expect(hooksMuted(muted, shell, back, again)).toBe(false);
  // A pane Kolux launched an agent in is never muted.
  expect(hooksMuted(false, { agent: "shell" as Agent, agentId: "gemini", program: null }, claude, back)).toBe(false);
  expect(hooksMuted(false, { agent: "claude" as Agent, program: null }, claude, back)).toBe(false);
});
