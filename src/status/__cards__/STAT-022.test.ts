// STAT-022 acceptance, the window side: a rate-limit failure reaches the real agent-status listener as a
// blocked status carrying its stop (the shape src-tauri/tests/cards_04.rs shows Session::apply produces).
// The pane reads Stopped for the limit with its reset time, no task-complete note is raised, and a later
// turn that completes carries no stop. React stand-in as in STAT-007.test.ts.
import { beforeEach, expect, test, vi } from "vitest";

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
const sent: { cmd: string; args: Record<string, unknown> }[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    sent.push({ cmd, args });
    return Promise.resolve();
  },
}));
const { useAgentEvents } = await import("../useAgentStatus");
const { resetPacer } = await import("../../settings/notifications");
const { resetWords, stopLine } = await import("../../terminal/notify");
const { chipOf } = await import("../chip");

const pane = (key: number, cwd: string) => ({ key, cwd, branch: null, agent: "claude", program: null, args: [] });
const noop = () => {};
const turns: Record<string, unknown>[] = [];
const hookRef = { current: { 1: "working", 2: "working" } as Record<number, string> };
const render = () => {
  ri = 0;
  ei = 0;
  useAgentEvents({ panes: [pane(1, "C:/work/active"), pane(2, "C:/work/other")] as never, setPanes: noop, titles: {}, settings: {}, inView: (k) => k === 1, setToast: noop, tabName: (p) => `Claude ${p.key}`, setCrew: noop, setTurn: ((f: (t: Record<number, unknown>) => Record<number, unknown>) => turns.push(f({}))) as never, setStale: noop, hookRef: hookRef as never, setHook: ((f: (h: Record<number, string>) => Record<number, string>) => (hookRef.current = f(hookRef.current))) as never, setStamp: noop, setContext: noop as never, unreadPanes: new Set(), setUnreadPanes: noop as never, winFocused: false, markDir: noop });
  due.splice(0).forEach((f) => f());
};
const desktop = () => sent.filter((s) => s.cmd === "notify" || s.cmd === "notify_event");
const tick = () => new Promise((r) => setTimeout(r, 30));
const resetsAt = Date.now() + 3_600_000;
const limit = { paneKey: 2, state: "blocked", interrupted: false, boundary: false, children: [], stop: { cause: "limit", detail: "5-hour limit", resetsAt } };

beforeEach(() => {
  refs.length = 0;
  effs.length = 0;
  sent.length = 0;
  turns.length = 0;
  hookRef.current = { 1: "working", 2: "working" };
  resetPacer();
});

test("box 1: a rate-limit failure reads stopped for the limit with its reset time, and raises no task-complete notification", async () => {
  render();
  bus["agent-status"]({ payload: limit });
  await tick();
  // The window keeps the stop with the turn, and the board chip says Stopped, never Done.
  expect(turns[0][2]).toMatchObject({ stop: { cause: "limit", resetsAt } });
  const chip = chipOf({ agent: "claude", state: "blocked", running: true, stale: false, stop: limit.stop as never, since: 0 }, Date.now());
  expect(chip).toMatchObject({ lane: "stopped", word: "Stopped" });
  expect(chip?.line).toBe(`Limit reached · resets at ${resetWords(resetsAt)}`);
  expect(stopLine(limit.stop as never)).toBe(chip?.line);
  // One desktop note: the stop kind, naming the limit and the reset time; no finish note.
  expect(desktop()).toHaveLength(1);
  expect(desktop()[0].args).toMatchObject({ title: "other · Claude 2 stopped: limit reached", body: `Resets at ${resetWords(resetsAt)}`, kind: "stop" });
  expect(desktop().filter((s) => s.args.kind === "finish")).toHaveLength(0);
  expect(hookRef.current[2]).toBe("blocked");
});

test("box 2: a new prompt that completes carries no stop, so the stop reason is gone", async () => {
  render();
  bus["agent-status"]({ payload: limit });
  bus["agent-status"]({ payload: { paneKey: 2, state: "working", interrupted: false, boundary: false, children: [] } });
  bus["agent-status"]({ payload: { paneKey: 2, state: "done", interrupted: false, boundary: false, children: [], reply: "All good." } });
  await tick();
  expect(turns).toHaveLength(3);
  expect(turns[0][2]).toMatchObject({ stop: { cause: "limit" } });
  expect((turns[2][2] as { stop?: unknown }).stop).toBeUndefined();
  const chip = chipOf({ agent: "claude", state: "done", running: true, stale: false, reply: "All good.", since: 0 }, Date.now());
  expect(chip).toMatchObject({ lane: "done", word: "Done" });
});
