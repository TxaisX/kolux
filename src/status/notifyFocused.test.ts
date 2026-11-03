import { beforeEach, expect, test, vi } from "vitest";

// AFTER row 571 / STAT-042: the Notifications page's "quiet while the window has focus" switch
// (notifySuppressFocused, default on) is the one the status hook obeys. A small React stand-in keeps
// refs and effects across renders and the event bus is caught, so the real agent-status listener runs.
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
const sent: string[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    sent.push(cmd);
    return Promise.resolve();
  },
}));
const { useAgentEvents } = await import("./useAgentStatus");
const { resetPacer } = await import("../settings/notifications");

const none = () => {};
const pane = (key: number) => ({ key, cwd: null, branch: null, agent: "claude", program: null, args: [] });
const render = (settings: Record<string, unknown>, winFocused: boolean) => {
  ri = 0;
  ei = 0;
  useAgentEvents({ panes: [pane(1)] as never, setPanes: none, titles: {}, settings, inView: () => false, setToast: none, tabName: () => "Claude 1", setCrew: none, setTurn: none, setStale: none, hookRef: { current: {} }, setHook: none, setStamp: none, setContext: none as never, unreadPanes: new Set(), setUnreadPanes: none, winFocused, markDir: none });
  due.splice(0).forEach((f) => f());
};
const asksPermission = () => bus["agent-status"]({ payload: { paneKey: 1, state: "permission", interrupted: false, children: [] } });
const raised = async () => {
  await new Promise((r) => setTimeout(r, 0));
  return sent.includes("notify") || sent.includes("notify_event");
};

beforeEach(() => {
  refs.length = 0;
  effs.length = 0;
  sent.length = 0;
  resetPacer(); // the window-wide pacer merges repeats in one folder for 5 s
});

test("the quiet-while-focused switch is on by default: a focused window raises no desktop note (STAT-042)", async () => {
  render({}, true);
  asksPermission();
  expect(await raised()).toBe(false);
});

test("switching it off on the Notifications page lets a focused window be notified", async () => {
  render({ notifySuppressFocused: false }, true);
  asksPermission();
  expect(await raised()).toBe(true);
});

test("an unfocused window is always notified, switch or not", async () => {
  render({ notifySuppressFocused: true }, false);
  asksPermission();
  expect(await raised()).toBe(true);
});

test("a choice saved under the old key is read once when the page's key was never saved", async () => {
  render({ notifyQuietWhenFocused: false }, true);
  asksPermission();
  expect(await raised()).toBe(true);
});

test("the page's own key wins over the old one", async () => {
  render({ notifySuppressFocused: true, notifyQuietWhenFocused: false }, true);
  asksPermission();
  expect(await raised()).toBe(false);
});

test("T-692 (E1): a stop right after another note in the same worktree is still raised; it keeps its own cooldown", async () => {
  const at = (key: number) => ({ ...pane(key), cwd: "C:/w/a" });
  ri = 0;
  ei = 0;
  useAgentEvents({ panes: [at(1), at(2)] as never, setPanes: none, titles: {}, settings: { notifySuppressFocused: false }, inView: () => false, setToast: none, tabName: () => "Claude", setCrew: none, setTurn: none, setStale: none, hookRef: { current: {} }, setHook: none, setStamp: none, setContext: none as never, unreadPanes: new Set(), setUnreadPanes: none, winFocused: false, markDir: none });
  due.splice(0).forEach((f) => f());
  bus["agent-status"]({ payload: { paneKey: 1, state: "permission", interrupted: false, children: [] } });
  bus["agent-status"]({ payload: { paneKey: 2, state: "blocked", interrupted: false, children: [], stop: { cause: "limit" } } });
  await new Promise((r) => setTimeout(r, 0));
  expect(sent.filter((c) => c === "notify_event")).toHaveLength(2);
});
