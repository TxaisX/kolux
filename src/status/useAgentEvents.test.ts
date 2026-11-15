import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Reading } from "./useAgentStatus";

// USAGE-001 (stand-in review of lane/marks ee2bfbc, FIX-SOON 7): the window's own wiring, not just
// its helpers. A tiny stand-in for React keeps refs and effects across renders (an effect runs when
// its dependencies change), and the event bus is caught, so the real listeners are driven.
const refs: { current: unknown }[] = [];
const effs: { deps?: unknown[]; clean?: () => void }[] = [];
const due: (() => void)[] = [];
let ri = 0;
let ei = 0;
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useRef: (v: unknown) => (refs[ri] ??= { current: v }, refs[ri++]),
  useEffect: (f: () => void | (() => void), deps?: unknown[]) => {
    const i = ei++;
    const old = effs[i];
    if (old && deps && old.deps && deps.every((d, k) => d === old.deps?.[k])) return;
    due.push(() => {
      old?.clean?.();
      const c = f();
      effs[i] = { deps, clean: typeof c === "function" ? c : undefined };
    });
  },
}));
const bus: Record<string, (e: { payload: unknown }) => void> = {};
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, f: (e: { payload: unknown }) => void) => ((bus[name] = f), Promise.resolve(() => {})) }));
const sent = vi.hoisted(() => [] as unknown[][]); // audit F10: the back-end calls made
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => (sent.push(a), Promise.resolve()) }));
const { useAgentEvents } = await import("./useAgentStatus");

let context: Record<number, Reading> = {};
// When set, every state update is also run once more on another state, as React may run an
// updater again (Strict Mode, or a rebase over an earlier update); an updater must stay pure.
let replay: Record<number, Reading> | null = null;
const setContext = (u: Record<number, Reading> | ((c: Record<number, Reading>) => Record<number, Reading>)) => {
  if (typeof u !== "function") return void (context = u);
  context = u(context);
  if (replay) u(replay);
};
const none = () => {};
const pane = (key: number) => ({ key, cwd: null, branch: null, agent: "claude", program: null, args: [] });
const render = (keys: number[], over: Record<string, unknown> = {}) => {
  ri = 0;
  ei = 0;
  const panes = keys.map(pane) as never;
  useAgentEvents({ panes, setPanes: none, titles: {}, settings: {}, inView: () => true, setToast: none, tabName: () => "Claude 1", setCrew: none, setTurn: none, setStale: none, hookRef: { current: {} }, setHook: none, setStamp: none, setContext: setContext as never, unreadPanes: new Set(), setUnreadPanes: none, winFocused: false, markDir: none, ...over });
  due.splice(0).forEach((f) => f());
};
const usage = (paneKey: number, tokens: number, session?: string, at?: number) => bus["claude-usage"]({ payload: { paneKey, contextTokens: tokens, contextWindow: 200_000, session, at } });
const clear = (paneKey: number) => bus["agent-status"]({ payload: { paneKey, state: "done", interrupted: false, boundary: true, children: [] } });
// A Claude SessionStart from a start or a resume: a new agent process (`fresh`, marks-FIX-1-hooks.patch).
const resume = (paneKey: number) => bus["agent-status"]({ payload: { paneKey, state: "done", interrupted: false, boundary: true, fresh: true, session: "s1", children: [] } });

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  refs.length = 0;
  effs.length = 0;
  context = {};
  replay = null;
});

test("the listener drops a report for a pane that is not open (USAGE-001)", () => {
  render([1]);
  usage(2, 50_000);
  expect(context).toEqual({});
  usage(1, 50_000);
  expect(context[1]?.tokens).toBe(50_000);
});

test("a clear forgets the reading and sets the floor: a straggler from before it stays out (USAGE-001)", () => {
  render([1]);
  usage(1, 90_000, "s1@2", 60_000);
  clear(1);
  expect(context[1]).toBeUndefined();
  usage(1, 88_000, "s1@2", 59_000);
  usage(1, 90_000, "s1@2", 60_000);
  expect(context[1]).toBeUndefined();
  usage(1, 10_000, "s1@2", 65_000);
  expect(context[1]).toEqual({ tokens: 10_000, window: 200_000, session: "s1@2", at: 65_000 });
});

test("closing a pane forgets its reading and its floor (USAGE-001)", () => {
  render([1, 2]);
  usage(1, 90_000, "s1@2", 60_000);
  usage(2, 40_000);
  clear(1);
  usage(1, 70_000, "s1@2", 61_000);
  render([2]);
  expect(Object.keys(context)).toEqual(["2"]);
  // Back with the same key, nothing of the old pane holds a report back.
  render([1, 2]);
  usage(1, 5_000, "s1@2", 1_000);
  expect(context[1]?.tokens).toBe(5_000);
});

test("different clock strings are separate clocks: a floor on one never holds back the other (USAGE-001)", () => {
  render([1]);
  usage(1, 90_000, "s1@2", 60_000);
  clear(1);
  // The hook server stamps the clock as the session with the terminal that ran it; the resumed
  // Claude's running time starts over, below the floor the clear left.
  usage(1, 30_000, "s1@5", 1_200);
  expect(context[1]).toEqual({ tokens: 30_000, window: 200_000, session: "s1@5", at: 1_200 });
  usage(1, 29_000, "s1@5", 900);
  expect(context[1]?.at).toBe(1_200);
});

test("a resume in the same terminal forgets the reading without a floor: the restarted running time is taken (USAGE-001)", () => {
  // Stand-in review of lane/marks 3efef76, FIX-SOON 1: `claude`, 40 minutes, /exit, then
  // `claude --continue` in the same pane. Same session id, same terminal, so the same clock, and the
  // new process may count its running time from zero again.
  render([1]);
  usage(1, 90_000, "s1@2", 2_400_000);
  resume(1);
  expect(context[1]).toBeUndefined();
  usage(1, 30_000, "s1@2", 1_200);
  expect(context[1]).toEqual({ tokens: 30_000, window: 200_000, session: "s1@2", at: 1_200 });
  // Within the new process the newest still wins.
  usage(1, 29_000, "s1@2", 900);
  expect(context[1]?.at).toBe(1_200);
});

test("a resume also lifts a floor an earlier clear left, even with nothing on screen (USAGE-001)", () => {
  render([1]);
  usage(1, 90_000, "s1@2", 2_400_000);
  clear(1);
  resume(1);
  usage(1, 12_000, "s1@2", 800);
  expect(context[1]?.tokens).toBe(12_000);
});

test("the clear's floor comes from what the pane showed, never from a state update run again (USAGE-001)", () => {
  // Stand-in review of lane/marks 243736d, AFTER 10: the floor was written inside a setContext
  // updater, so React running that updater again on another state moved the floor.
  render([1]);
  usage(1, 90_000, "s1@2", 60_000);
  replay = { 1: { tokens: 1, window: 200_000, session: "x@9", at: 5 } };
  clear(1);
  replay = null;
  usage(1, 88_000, "s1@2", 59_000);
  expect(context[1]).toBeUndefined();
});

test("a late report from the old process after a fresh start is ignored, the new process's reports are taken (USAGE-001)", () => {
  // Stand-in review of lane/marks 54b27f5e, AFTER 1: `claude` for 40 minutes, /exit, `claude --continue`
  // in the same pane; a status-line report from the old process is still in flight and lands after
  // the new process's SessionStart, on the same `<id>@N` clock.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
  render([1]);
  usage(1, 90_000, "s1@2", 2_400_000);
  resume(1);
  vi.setSystemTime(1_000_800);
  usage(1, 91_000, "s1@2", 2_400_900);
  expect(context[1]).toBeUndefined();
  // The new process restarts its running time; without the guard its figures would be thrown away
  // as older than the late report until it passed 40 minutes.
  vi.setSystemTime(1_002_000);
  usage(1, 30_000, "s1@2", 1_200);
  expect(context[1]).toEqual({ tokens: 30_000, window: 200_000, session: "s1@2", at: 1_200 });
  usage(1, 31_000, "s1@2", 3_300);
  expect(context[1]?.at).toBe(3_300);
});

test("the late-report guard lasts only a moment after the start: later large running times are ordinary (USAGE-001)", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
  render([1]);
  resume(1);
  // A long session where Claude keeps counting across a resume (UNKNOWN), reported a minute on.
  vi.setSystemTime(1_060_000);
  usage(1, 50_000, "s1@2", 2_400_000);
  expect(context[1]?.at).toBe(2_400_000);
});

test("closing a pane forgets its fresh mark: the same key back is not guarded (USAGE-001)", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
  render([1]);
  resume(1);
  render([]);
  render([1]);
  vi.setSystemTime(1_000_500);
  usage(1, 50_000, "s1@2", 2_400_000);
  expect(context[1]?.at).toBe(2_400_000);
});

// Stand-in review of lane/marks c75f5900, FIX-SOON 1: a report the guard holds back is the first
// word of the new process when Claude's running time keeps counting across a resume, or when the
// start hook fired late. It is kept as a candidate, not thrown away.
test("a held first report is shown when the window ends and nothing else has come (USAGE-001)", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  render([1]);
  usage(1, 90_000, "s1@2", 2_400_000);
  resume(1);
  vi.setSystemTime(1_000_800);
  usage(1, 91_000, "s1@2", 2_400_900);
  expect(context[1]).toBeUndefined();
  vi.advanceTimersByTime(28_000);
  expect(context[1]).toBeUndefined();
  vi.advanceTimersByTime(2_000);
  // Shown without its clock, so whatever the new process reports next is taken and never held back.
  expect(context[1]).toEqual({ tokens: 91_000, window: 200_000 });
  usage(1, 30_000, "s1@2", 1_200);
  expect(context[1]).toEqual({ tokens: 30_000, window: 200_000, session: "s1@2", at: 1_200 });
});

test("two held reports that agree on one running clock show the newer at once, with its clock (USAGE-001)", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  render([1]);
  resume(1);
  // A slow start hook: Kolux saw the start 3 s into a process whose running time already reads 15 s.
  vi.setSystemTime(1_003_000);
  usage(1, 40_000, "s1@2", 15_000);
  expect(context[1]).toBeUndefined();
  vi.setSystemTime(1_013_000);
  usage(1, 45_000, "s1@2", 25_000);
  expect(context[1]).toEqual({ tokens: 45_000, window: 200_000, session: "s1@2", at: 25_000 });
  // The candidate is spent: the window's end shows nothing new.
  vi.advanceTimersByTime(60_000);
  expect(context[1]?.tokens).toBe(45_000);
});

test("a report the guard does not hold takes the place of the candidate (USAGE-001)", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  render([1]);
  usage(1, 90_000, "s1@2", 2_400_000);
  resume(1);
  vi.setSystemTime(1_000_800);
  usage(1, 91_000, "s1@2", 2_400_900);
  vi.setSystemTime(1_002_000);
  usage(1, 30_000, "s1@2", 1_200);
  expect(context[1]?.tokens).toBe(30_000);
  vi.advanceTimersByTime(60_000);
  expect(context[1]?.tokens).toBe(30_000);
});

test("a clear or a closed pane drops the candidate: nothing shows when the window ends (USAGE-001)", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  render([1, 2]);
  resume(1);
  resume(2);
  vi.setSystemTime(1_000_500);
  usage(1, 91_000, "s1@2", 2_400_900);
  usage(2, 92_000, "s2@3", 2_400_900);
  clear(1);
  render([1]);
  vi.advanceTimersByTime(60_000);
  expect(context[1]).toBeUndefined();
  expect(context[2]).toBeUndefined();
});

test("the cost rides on the listener's reading and a clear takes it away with the gauge (USAGE-034)", () => {
  render([1]);
  bus["claude-usage"]({ payload: { paneKey: 1, contextTokens: 50_000, contextWindow: 200_000, session: "s1@2", at: 1_000, costUsd: 3.15 } });
  expect(context[1]).toEqual({ tokens: 50_000, window: 200_000, session: "s1@2", at: 1_000, costUsd: 3.15 });
  clear(1);
  expect(context[1]).toBeUndefined();
  bus["claude-usage"]({ payload: { paneKey: 1, contextTokens: 5_000, contextWindow: 200_000, session: "s9@2", at: 100 } });
  expect(context[1]?.costUsd).toBeUndefined();
});

// Stand-in review of lane/marks b08c624c, FIX-SOON 2: a limits-only report (no context) must not
// wipe the candidate a real first report left.
test("a held report with no context leaves the candidate in place (USAGE-001)", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  render([1]);
  resume(1);
  vi.setSystemTime(1_000_800);
  usage(1, 91_000, "s1@2", 2_400_900);
  vi.setSystemTime(1_002_000);
  bus["claude-usage"]({ payload: { paneKey: 1, contextTokens: null, contextWindow: null, session: "s1@2", at: 2_500_000 } });
  expect(context[1]).toBeUndefined();
  vi.advanceTimersByTime(30_000);
  expect(context[1]).toEqual({ tokens: 91_000, window: 200_000 });
});

// Stand-in review of lane/marks b08c624c, AFTER 1: the hook going away takes the candidate's timer with it.
test("unmounting the window clears the candidate's timer (USAGE-001)", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  render([1]);
  resume(1);
  vi.setSystemTime(1_000_800);
  usage(1, 91_000, "s1@2", 2_400_900);
  expect(vi.getTimerCount()).toBe(1);
  effs.forEach((e) => e?.clean?.());
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(60_000);
  expect(context[1]).toBeUndefined();
});

// Audit F9: a closed pane's state clock and quiet mark are let go, as its reading is.
test("closing a pane drops its stamp and its quiet mark", () => {
  type Rec = Record<number, unknown>;
  let stamp: Rec = { 1: { at: 1, interrupted: false }, 2: { at: 2, interrupted: false } };
  let stale: Rec = { 1: true, 2: true };
  const upd = (get: () => Rec, put: (r: Rec) => void) => (u: Rec | ((r: Rec) => Rec)) => put(typeof u === "function" ? u(get()) : u);
  const over = { setStamp: upd(() => stamp, (r) => (stamp = r)), setStale: upd(() => stale, (r) => (stale = r)) };
  render([1, 2], over);
  render([1], over);
  expect(Object.keys(stamp)).toEqual(["1"]);
  expect(Object.keys(stale)).toEqual(["1"]);
});

// Audit F10: the taskbar badge is sent only when its count changes, not on every pane or focus change.
test("the badge count is sent once while it stays the same", () => {
  sent.length = 0;
  render([1]);
  render([1, 2]);
  render([1, 2]);
  expect(sent.filter(([cmd]) => cmd === "badge_set")).toEqual([["badge_set", { count: 0 }]]);
});
