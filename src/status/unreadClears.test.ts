// STAT-049 / TERM-118: an unread mark clears when the user looks at the pane, also when the mark came from an
// agent whose program exited (its hook state is gone, its stamp stays) or from a second note on a turn that was
// already acknowledged. Drives the real useAgentEvents (React stand-in as in terminal/__cards__/TERM-118.test.ts).
import { beforeEach, expect, test, vi } from "vitest";

const refs: { current: unknown }[] = [];
let ri = 0;
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useRef: (v: unknown) => (refs[ri] ??= { current: v }, refs[ri++]),
  // as React: an effect runs again only when one of its deps changed
  useEffect: (f: () => void | (() => void), deps?: unknown[]) => {
    const i = ei++;
    const old = effs[i];
    if (old && deps && old.deps && deps.length === old.deps.length && deps.every((d, k) => Object.is(d, old.deps?.[k]))) return;
    old?.clean?.();
    const c = f();
    effs[i] = { deps, clean: typeof c === "function" ? c : undefined };
  },
}));
const effs: { deps?: unknown[]; clean?: () => void }[] = [];
let ei = 0;
const bus: Record<string, (e: { payload: unknown }) => void> = {};
vi.mock("@tauri-apps/api/event", () => ({ listen: (name: string, f: (e: { payload: unknown }) => void) => ((bus[name] = f), Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve() }));
const { useAgentEvents } = await import("./useAgentStatus");
const { resetPacer } = await import("../settings/notifications");

const pane = (key: number, agent = "claude") => ({ key, cwd: "C:/w/a", branch: null, agent, program: null, args: [] });
const noop = () => {};

let unread = new Set<number>();
const setUnread = (f: Set<number> | ((u: Set<number>) => Set<number>)) => (unread = typeof f === "function" ? f(unread) : f);
let cleared: string[] = [];
const render = (o: { inView: boolean | ((k: number) => boolean); hook: Record<number, string>; stamp: Record<number, { at: number; interrupted: boolean }>; agent?: string; panes?: unknown[] }) => {
  ri = 0;
  ei = 0;
  const inView = typeof o.inView === "function" ? o.inView : () => o.inView as boolean;
  return useAgentEvents({ panes: (o.panes ?? [pane(2, o.agent)]) as never, setPanes: noop, titles: {}, settings: {}, inView, setToast: noop, tabName: () => "Tab", setCrew: noop, setTurn: noop, setStale: noop, hookRef: { current: o.hook } as never, setHook: noop, stamp: o.stamp, setStamp: noop, setContext: noop as never, unreadPanes: unread, setUnreadPanes: setUnread as never, winFocused: true, markDir: (d: string, un: boolean) => void (!un && cleared.push(d)) });
};

beforeEach(() => {
  refs.length = 0;
  effs.length = 0;
  cleared = [];
  unread = new Set();
  resetPacer();
});

test("an agent that exited in a hidden tab: looking at the tab clears its unread mark", () => {
  unread = new Set([2]);
  // the exit dropped the pane's hook state (Pane.tsx onRunning) and stamped the exit
  render({ inView: true, hook: {}, stamp: { 2: { at: 500, interrupted: false } } });
  expect([...unread]).toEqual([]);
});

test("a shell that rang its bell out of view: looking at it clears the mark", () => {
  unread = new Set([2]);
  render({ inView: true, hook: {}, stamp: { 2: { at: 100, interrupted: false } }, agent: "shell" });
  expect([...unread]).toEqual([]);
});

test("a second note on an acknowledged turn marks the tab again, and looking at it clears it again", () => {
  const stamp = { 2: { at: 500, interrupted: false } };
  unread = new Set([2]);
  render({ inView: true, hook: { 2: "done" }, stamp });
  expect([...unread]).toEqual([]);
  // the tab is hidden again and the agent rings its bell: same turn stamp
  const { noticed } = render({ inView: false, hook: { 2: "done" }, stamp });
  noticed(pane(2) as never, "rang the bell", "", "notifyBell");
  expect([...unread]).toEqual([2]);
  render({ inView: true, hook: { 2: "done" }, stamp });
  expect([...unread]).toEqual([]);
});

test("a pane with no status at all yet keeps its mark (STAT-049)", () => {
  unread = new Set([2]);
  render({ inView: true, hook: {}, stamp: {} });
  expect([...unread]).toEqual([2]);
});

test("looking at one unread pane keeps the workspace dot while another pane there is still unread", () => {
  unread = new Set([2, 3]);
  const stamp = { 2: { at: 500, interrupted: false }, 3: { at: 600, interrupted: false } };
  const panes = [pane(2), pane(3)];
  render({ inView: (k) => k === 2, hook: { 2: "done", 3: "done" }, stamp, panes });
  expect([...unread]).toEqual([3]);
  expect(cleared).toEqual([]);
  // the second one is looked at: now the dot goes
  render({ inView: (k) => k === 3, hook: { 2: "done", 3: "done" }, stamp, panes });
  expect([...unread]).toEqual([]);
  expect(cleared).toEqual(["C:/w/a"]);
});

test("the acknowledgement waits for what it reads to change, and runs again when the pane comes into view", () => {
  unread = new Set([2]);
  const stamp = { 2: { at: 500, interrupted: false } };
  const updates: unknown[] = [];
  const spy = setUnread;
  const counting = (f: Parameters<typeof setUnread>[0]) => (updates.push(f), spy(f));
  const draw = (inView: boolean) => {
    ri = 0;
    ei = 0;
    useAgentEvents({ panes: [pane(2)] as never, setPanes: noop, titles: {}, settings: {}, inView: () => inView, setToast: noop, tabName: () => "Tab", setCrew: noop, setTurn: noop, setStale: noop, hookRef: { current: { 2: "done" } } as never, setHook: noop, stamp, setStamp: noop, setContext: noop as never, unreadPanes: unread, setUnreadPanes: counting as never, winFocused: true, markDir: noop });
  };
  draw(false);
  draw(false); // nothing it reads changed: no second pass
  expect([...unread]).toEqual([2]);
  draw(true); // a new inView function that now says yes
  expect([...unread]).toEqual([]);
  expect(updates.length).toBe(1);
});
