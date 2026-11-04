// C26-R2-01: a clicked toast must land on the pane, not just focus it. The listener is caught from
// a mocked event bus and the jump is a spy, so the real hook runs: the click has to reach the jump
// with the key the notification names, and a stale id must do nothing at all.
import { beforeEach, expect, test, vi } from "vitest";
import app from "../App.tsx?raw";

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
const { useNotificationClick } = await import("./notificationClick");

const pane = (key: number) => ({ key, cwd: `C:\\w${key}`, branch: null, agent: "shell", program: null, args: [] });

function mount(panes: { key: number }[], jump: (key: number) => void) {
  ri = 0;
  ei = 0;
  const panesRef = { current: panes };
  useNotificationClick(panesRef, { current: jump });
  due.splice(0).forEach((f) => f());
  return panesRef;
}

beforeEach(() => {
  refs.length = 0;
  effs.length = 0;
  due.length = 0;
});

test("C26-R2-01: a clicked toast jumps to the pane it names, not just its focus", () => {
  const jump = vi.fn();
  mount([pane(1), pane(2)], jump);
  bus["notification-click"]({ payload: { pane: "2" } });
  expect(jump).toHaveBeenCalledTimes(1);
  expect(jump).toHaveBeenCalledWith(2);
});

test("C26-R2-01: a click for a pane that is no longer open lands nowhere", () => {
  const jump = vi.fn();
  mount([pane(1), pane(2)], jump);
  bus["notification-click"]({ payload: { pane: "9" } });
  expect(jump).not.toHaveBeenCalled();
});

test("C26-R2-01: the jump reads the live pane list, so a pane opened after the first render still lands", () => {
  const jump = vi.fn();
  const panesRef = mount([pane(1)], jump);
  panesRef.current = [pane(1), pane(2)];
  bus["notification-click"]({ payload: { pane: "2" } });
  expect(jump).toHaveBeenCalledWith(2);
});

test("C26-R2-01: the App's jump is the page-clearing openPane, so the click lands on the pane", () => {
  expect(app).toMatch(/useNotificationClick\(panesRef, jumpToPane\)/);
  expect(app).toMatch(/jumpToPane\.current = \(key\) => \{\s*leavePage\(\);\s*openPane\(key\);/);
  expect(app).not.toMatch(/notification-click[\s\S]{0,200}setFocused\(key\)/);
});
