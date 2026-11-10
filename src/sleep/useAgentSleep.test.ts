// TERM-123 (T-817, review F2, F4, F5, F6, F8): the sleep check and Wake as they run in the window, with the
// Tauri calls faked. The check re-reads the latest state right before and right after the Rust call, ends
// only the terminal it checked and only after the pane's re-render settled, and stores the recorded session;
// a refused Wake keeps the pane asleep and says why; a wake restarts the idle clock.
import { expect, test, vi } from "vitest";
import type { Pane } from "../App";
import { keepDraft } from "../chat/composer";
import { sleepCheck, wakeOnce, type Invoke, type SleepDeps, type Stamp } from "./useAgentSleep";

const MIN = 60_000;
const IDLE_MS = 30 * MIN;
let now = 10_000_000;
const clock = () => now;

type Call = [string, Record<string, unknown> | undefined];

/** A fake window: the latest state lives in `s`, setters update it the way React would. */
function world(over: Partial<SleepDeps> = {}) {
  const s = {
    panes: [{ key: 1, agent: "claude", agentId: "claude", program: "claude", args: ["--x", "do the task"], env: [], typed: "do the task", session: "s-1" }] as unknown as Pane[],
    hook: { 1: "done" } as SleepDeps["hook"],
    stamp: { 1: { at: now - IDLE_MS - MIN, interrupted: false } } as Record<number, Stamp>,
    turn: {} as SleepDeps["turn"],
    running: { 1: true } as Record<number, boolean>,
    toasts: [] as string[],
  };
  const ptys = { current: { 1: 41 } as Record<number, number> };
  const restoredKeys = { current: new Set<number>() };
  const apply = <T>(set: T | ((prev: T) => T), prev: T): T => (typeof set === "function" ? (set as (p: T) => T)(prev) : set);
  const deps: SleepDeps = {
    get panes() {
      return s.panes;
    },
    setPanes: (set) => (s.panes = apply(set, s.panes)),
    get hook() {
      return s.hook;
    },
    get stamp() {
      return s.stamp;
    },
    setStamp: (set) => (s.stamp = apply(set, s.stamp)),
    get turn() {
      return s.turn;
    },
    get running() {
      return s.running;
    },
    setRunning: (set) => (s.running = apply(set, s.running)),
    inView: () => false,
    settings: { agentSleep: true, agentSleepIdleMinutes: 30 },
    restoredKeys,
    ptys,
    setToast: (t) => s.toasts.push(t),
    ...over,
  };
  return { s, deps, ptys, restoredKeys };
}

/** A fake Rust side: answers by command, records every call. */
function rust(answers: Record<string, (args: Record<string, unknown> | undefined) => unknown>) {
  const calls: Call[] = [];
  const invoke: Invoke = <T>(cmd: string, args?: Record<string, unknown>) => {
    calls.push([cmd, args]);
    const a = answers[cmd];
    if (!a) return Promise.reject(new Error(`no answer for ${cmd}`));
    try {
      return Promise.resolve(a(args) as T);
    } catch (e) {
      return Promise.reject(e);
    }
  };
  return { calls, invoke };
}

const settled = vi.fn(() => Promise.resolve());

test("T-817 TERM-123: a due pane is recorded with the window's delay, marked asleep with the recorded session, then its terminal is ended after the re-render settled", async () => {
  const w = world();
  const r = rust({ agent_pane_sleep: () => ({ terminal: 41, session: "s-recorded" }), terminal_kill: () => null });
  const order: string[] = [];
  const settle = () => {
    order.push("settled");
    return Promise.resolve();
  };
  await expect(sleepCheck(() => w.deps, IDLE_MS, r.invoke, clock, settle)).resolves.toEqual([1]);
  expect(r.calls[0]).toEqual(["agent_pane_sleep", { paneKey: 1, idleMinutes: 30 }]);
  expect(r.calls[1]).toEqual(["terminal_kill", { id: 41 }]);
  expect(order).toEqual(["settled"]); // F8: the kill goes out after the unmount, not into the live view
  expect(w.s.panes[0].asleep).toEqual({ since: now, idleMin: 31, session: "s-recorded" }); // F5: Wake resumes this id, not a guess
  expect(w.ptys.current[1]).toBeUndefined();
  expect(w.s.running[1]).toBeUndefined();
});

test("T-817 TERM-123 (review F4): the decision is re-made against the latest state before the Rust call and again before anything ends", async () => {
  // Before the call: the pane became focused and visible since the tick's list was drawn (document is visible in this runner).
  const w = world({ inView: () => true });
  const r = rust({ agent_pane_sleep: () => ({ terminal: 41, session: "s" }), terminal_kill: () => null });
  await expect(sleepCheck(() => w.deps, IDLE_MS, r.invoke, clock, settled)).resolves.toEqual([]);
  expect(r.calls).toEqual([]);
  // During the call: the agent started working again. The record was made, but nothing ends and the pane stays awake.
  const w2 = world();
  const r2 = rust({
    agent_pane_sleep: () => {
      w2.s.hook = { 1: "working" };
      return { terminal: 41, session: "s" };
    },
    terminal_kill: () => null,
  });
  await expect(sleepCheck(() => w2.deps, IDLE_MS, r2.invoke, clock, settled)).resolves.toEqual([]);
  expect(r2.calls.map((c) => c[0])).toEqual(["agent_pane_sleep"]);
  expect(w2.s.panes[0].asleep).toBeUndefined();
  expect(w2.s.running[1]).toBe(true);
  // During the call: the pane was restarted on another terminal. The new terminal is never the one ended.
  const w3 = world();
  const r3 = rust({
    agent_pane_sleep: () => {
      w3.ptys.current[1] = 42;
      return { terminal: 41, session: "s" };
    },
    terminal_kill: () => null,
  });
  await expect(sleepCheck(() => w3.deps, IDLE_MS, r3.invoke, clock, settled)).resolves.toEqual([]);
  expect(r3.calls.map((c) => c[0])).toEqual(["agent_pane_sleep"]);
  expect(w3.s.panes[0].asleep).toBeUndefined();
});

test("T-817 TERM-123: a Rust refusal, a stale terminal id or an unsent draft leaves the pane as it was", async () => {
  const w = world();
  const r = rust({
    agent_pane_sleep: () => {
      throw new Error("the terminal printed or was typed in 3 s ago, less than the delay");
    },
  });
  await expect(sleepCheck(() => w.deps, IDLE_MS, r.invoke, clock, settled)).resolves.toEqual([]);
  expect(w.s.panes[0].asleep).toBeUndefined();
  expect(w.s.running[1]).toBe(true);
  // The Rust side answered for a terminal the pane no longer has.
  const w2 = world();
  const r2 = rust({ agent_pane_sleep: () => ({ terminal: 40, session: "s" }), terminal_kill: () => null });
  await expect(sleepCheck(() => w2.deps, IDLE_MS, r2.invoke, clock, settled)).resolves.toEqual([]);
  expect(r2.calls.map((c) => c[0])).toEqual(["agent_pane_sleep"]);
  // F3: text in the pane's message box, kept or too long to keep, keeps the pane awake (no Rust call at all).
  keepDraft(1, "x".repeat(70 * 1024));
  const w3 = world();
  const r3 = rust({ agent_pane_sleep: () => ({ terminal: 41, session: "s" }) });
  await expect(sleepCheck(() => w3.deps, IDLE_MS, r3.invoke, clock, settled)).resolves.toEqual([]);
  expect(r3.calls).toEqual([]);
  keepDraft(1, "");
});

test("T-817 TERM-123 (review F1, F5, F6): Wake asks for the recorded session's resume line, replaces the launch line and the opening prompt, marks the key restored and restarts the idle clock", async () => {
  const w = world();
  w.s.panes = [{ ...w.s.panes[0], asleep: { since: now - 5 * MIN, idleMin: 31, session: "s-recorded" } }];
  const r = rust({ agent_start_line: () => ({ args: ["--resume", "s-recorded"], program: "claude", env: [["A", "1"]], resumed: true }) });
  now += MIN;
  await expect(wakeOnce(w.deps, 1, r.invoke, clock)).resolves.toBe(true);
  expect(r.calls).toEqual([["agent_start_line", { id: "claude", extra: [], prompt: "", restore: true, session: "s-recorded" }]]);
  const p = w.s.panes[0];
  expect(p.asleep).toBeUndefined();
  expect(p.typed).toBeUndefined(); // F1: Pane.tsx onPty would type it into the new terminal
  expect(p.args).toEqual(["--resume", "s-recorded"]); // the launch args carried the prompt
  expect(p.session).toBe("s-recorded");
  expect(p.resumed).toBe(true);
  expect(w.restoredKeys.current.has(1)).toBe(true);
  expect(w.s.stamp[1]).toEqual({ at: now, interrupted: false }); // F6: not back to sleep within a minute
  expect(w.s.toasts).toEqual([]);
});

test("T-817 TERM-123 (review F2): a refused Wake keeps the pane asleep, spawns nothing and says why", async () => {
  const w = world();
  const before = { ...w.s.panes[0], asleep: { since: now, idleMin: 31, session: "s-recorded" } };
  w.s.panes = [before];
  const r = rust({
    agent_start_line: () => {
      throw "that agent is gone";
    },
  });
  await expect(wakeOnce(w.deps, 1, r.invoke, clock)).resolves.toBe(false);
  expect(w.s.panes[0]).toEqual(before); // still asleep: the launch args (with the task) never run again
  expect(w.restoredKeys.current.has(1)).toBe(false);
  expect(w.s.toasts).toEqual(["The sleeping agent did not wake: that agent is gone"]);
  // A pane that is not asleep is not woken.
  const w2 = world();
  const r2 = rust({ agent_start_line: () => ({ args: [], program: null, env: [], resumed: false }) });
  await expect(wakeOnce(w2.deps, 1, r2.invoke, clock)).resolves.toBe(false);
  expect(r2.calls).toEqual([]);
});
