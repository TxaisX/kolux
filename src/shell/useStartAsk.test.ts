// Job 13 F4: the Start form's ask at open never jumps up over work. A first agent search that failed, or a user who
// has already started something, counts as answered; a later good search does not bring the form up. It also waits
// for the first-run state, which arrives from an async read (job 11 D-15). F5: a webview reload does not ask again.
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { installDom } from "../tasks/fakeDom";
import { askAtOpen, START_WAIT_MS } from "../launch/startForm";

import { handOver, isFirstWindow, ownPanes, resetStartAsk, useStartAsk } from "./useStartAsk";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mount: () => Root;
beforeAll(async () => {
  const { doc } = installDom();
  const { createRoot } = await import("react-dom/client");
  mount = () => createRoot(doc.createElement("div") as unknown as Element);
});
beforeEach(() => resetStartAsk());

test("Start form D: outside Tauri there is one window, so it counts as the first", () => {
  expect(isFirstWindow()).toBe(true);
});

const w = { on: true, firstWindow: true, asked: false, settingsRead: true, agentsDone: true, projectsRead: true, launching: false, sheetOpen: false, firstRunKnown: true };

test("F4: a failed first search or a user who moved on counts as answered; the first-run state is waited for", () => {
  expect(askAtOpen(w)).toBe("ask");
  expect(askAtOpen({ ...w, agentsDone: false, agentsFailed: true })).toBe("skip");
  expect(askAtOpen({ ...w, agentsDone: false, userActed: true })).toBe("skip");
  expect(askAtOpen({ ...w, firstRunKnown: false })).toBe("wait");
  expect(askAtOpen({ ...w, firstRunKnown: false, firstRun: true })).toBe("skip");
});

test("R1: until last time's layout is in, the form waits, even if panes came meanwhile", () => {
  expect(askAtOpen({ ...w, layoutIn: false, userActed: true })).toBe("wait");
  expect(askAtOpen({ ...w, layoutIn: false })).toBe("wait");
  expect(askAtOpen({ ...w, layoutIn: true })).toBe("ask");
});

test("R1: a slow start brings 3 saved panes back after the settings read: the form still asks once", () => {
  const open = vi.fn();
  const root = mount();
  act(() => root.render(createElement(Probe, { ...base(open), settingsRead: true, layoutIn: false, panes: 0 })));
  act(() => root.render(createElement(Probe, { ...base(open), layoutIn: true, panes: 3 })));
  act(() => root.render(createElement(Probe, { ...base(open), layoutIn: true, panes: 3, agentsDone: true })));
  expect(open).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

test("R1 case (c): a late draw with no saved layout: the form asks over 0 panes", () => {
  const open = vi.fn();
  const root = mount();
  act(() => root.render(createElement(Probe, { ...base(open), layoutIn: false, panes: 0 })));
  act(() => root.render(createElement(Probe, { ...base(open), layoutIn: true, panes: 0, agentsDone: true })));
  expect(open).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

test("job 37 A1: a slow start, the user opens a terminal before the saved tabs return: the form does not ask", () => {
  const open = vi.fn();
  const root = mount();
  act(() => root.render(createElement(Probe, { ...base(open), settingsRead: true, layoutIn: false, panes: 0 })));
  act(() => root.render(createElement(Probe, { ...base(open), layoutIn: false, panes: 1 })));
  act(() => root.render(createElement(Probe, { ...base(open), layoutIn: true, panes: 4, agentsDone: true })));
  expect(open).not.toHaveBeenCalled();
  act(() => root.unmount());
});

test("job 37 A1 mirror: a slow start, nothing added during the wait, 3 saved tabs land: the form asks once", () => {
  const open = vi.fn();
  const root = mount();
  act(() => root.render(createElement(Probe, { ...base(open), settingsRead: true, layoutIn: false, panes: 0 })));
  act(() => root.render(createElement(Probe, { ...base(open), layoutIn: false, panes: 0 })));
  act(() => root.render(createElement(Probe, { ...base(open), layoutIn: true, panes: 3, agentsDone: true })));
  expect(open).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

type In = Parameters<typeof useStartAsk>[0];
function Probe(p: In) {
  useStartAsk(p);
  return null;
}
const base = (open: () => void): In => ({ settings: {}, settingsRead: true, layoutIn: true, agentsDone: false, projectsRead: true, launching: false, sheetOpen: false, firstRun: false, firstRunKnown: true, agentsFailed: false, panes: 2, open });

test("F4: the first search fails, a later search works: the form does not come up", () => {
  const open = vi.fn();
  const root = mount();
  act(() => root.render(createElement(Probe, base(open))));
  act(() => root.render(createElement(Probe, { ...base(open), agentsFailed: true })));
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true })));
  expect(open).not.toHaveBeenCalled();
  act(() => root.unmount());
});

test("job 22: the first-run screens hand over to the form; the ask at open never opens a second one", () => {
  const open = vi.fn();
  const root = mount();
  // the first-run state is read, the screens are up, the search is still running
  act(() => root.render(createElement(Probe, { ...base(open), firstRunKnown: false, firstRun: false })));
  act(() => root.render(createElement(Probe, { ...base(open), firstRun: true })));
  act(() => root.render(createElement(Probe, { ...base(open), firstRun: true, agentsDone: true })));
  // the main button: the screens close and the hand-over opens the form, then the user closes it
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true, sheetOpen: true })));
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true })));
  expect(open).not.toHaveBeenCalled();
  act(() => root.unmount());
});


test("F4: a pane added while the search runs, or a launch that ended: the form does not come up later", () => {
  for (const moved of [{ panes: 3 }, { launching: true }]) {
    resetStartAsk();
    const open = vi.fn();
    const root = mount();
    act(() => root.render(createElement(Probe, base(open))));
    act(() => root.render(createElement(Probe, { ...base(open), ...moved })));
    act(() => root.render(createElement(Probe, { ...base(open), ...moved, launching: false, agentsDone: true })));
    expect(open).not.toHaveBeenCalled();
    act(() => root.unmount());
  }
});

test("F4: the form waits for the first-run state, then asks once", () => {
  const open = vi.fn();
  const root = mount();
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true, firstRunKnown: false })));
  expect(open).not.toHaveBeenCalled();
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true, firstRunKnown: true })));
  expect(open).toHaveBeenCalledTimes(1);
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true, panes: 4 })));
  expect(open).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

const g = globalThis as { sessionStorage?: unknown };
afterEach(() => void delete g.sessionStorage);

test("F5: a page reload in the same run does not ask again; refused storage still asks once", async () => {
  const kept = new Map<string, string>();
  g.sessionStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
  const open = vi.fn();
  let root = mount();
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true })));
  expect(open).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
  // the reload: a fresh copy of the module, the same session storage
  vi.resetModules();
  const fresh = await import("./useStartAsk");
  const Again = (p: In) => (fresh.useStartAsk(p), null);
  root = mount();
  act(() => root.render(createElement(Again, { ...base(open), agentsDone: true })));
  expect(open).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
  // storage that throws: the form still works and asks once
  g.sessionStorage = { getItem: () => { throw new Error("refused"); }, setItem: () => { throw new Error("refused"); }, removeItem: () => { throw new Error("refused"); } };
  vi.resetModules();
  const bare = await import("./useStartAsk");
  const Third = (p: In) => (bare.useStartAsk(p), null);
  const open2 = vi.fn();
  root = mount();
  act(() => root.render(createElement(Third, { ...base(open2), agentsDone: true })));
  act(() => root.render(createElement(Third, { ...base(open2), agentsDone: true, panes: 5 })));
  expect(open2).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

// Job 47 item 1: the wait at open has a limit. After START_WAIT_MS the form asks with what is known, so one read that
// never answers cannot stop it for good. Every "skip" rule still holds. The clock starts at the hook's first run.
const local = (m: Map<string, string> | null) =>
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: m && { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } });
afterEach(() => (vi.useRealTimers(), local(null)));
const stuckCases: [string, Partial<In>][] = [
  ["the settings are never read", { settingsRead: false, layoutIn: false, agentsDone: true }],
  ["the settings are read but last time's layout never comes in", { settingsRead: true, layoutIn: false, agentsDone: true }],
  ["the agent search never answers", { agentsDone: false }],
  ["the folder list is never read", { agentsDone: true, projectsRead: false }],
  ["the first-run state never settles", { agentsDone: true, firstRunKnown: false }],
];
for (const [name, stuck] of stuckCases)
  test(`job 47: ${name}: no form before the limit, the form asks once after it`, () => {
    vi.useFakeTimers();
    resetStartAsk();
    const open = vi.fn();
    const root = mount();
    act(() => root.render(createElement(Probe, { ...base(open), ...stuck })));
    act(() => void vi.advanceTimersByTime(START_WAIT_MS - 1));
    expect(open).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(open).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(START_WAIT_MS));
    act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true, panes: 5 })));
    expect(open).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

test("job 47: the user switched the ask off last time and the settings never come: no form after the limit", () => {
  vi.useFakeTimers();
  local(new Map());
  const open = vi.fn();
  let root = mount();
  act(() => root.render(createElement(Probe, { ...base(open), settings: { askWhatToOpen: false }, agentsDone: true })));
  act(() => root.unmount());
  resetStartAsk(); // the next app start: the module is fresh, the browser storage is kept
  root = mount();
  act(() => root.render(createElement(Probe, { ...base(open), settingsRead: false, layoutIn: false, agentsDone: true })));
  act(() => void vi.advanceTimersByTime(START_WAIT_MS * 2));
  expect(open).not.toHaveBeenCalled();
  act(() => root.unmount());
});

test("job 47: the user opened a pane while the form waited: no form after the limit", () => {
  for (const stuck of [{ settingsRead: true, layoutIn: false, agentsDone: true }, { agentsDone: false }] as Partial<In>[]) {
    vi.useFakeTimers();
    resetStartAsk();
    const open = vi.fn();
    const root = mount();
    act(() => root.render(createElement(Probe, { ...base(open), ...stuck })));
    act(() => root.render(createElement(Probe, { ...base(open), ...stuck, panes: 3 })));
    act(() => void vi.advanceTimersByTime(START_WAIT_MS * 2));
    expect(open).not.toHaveBeenCalled();
    act(() => root.unmount());
  }
});

test("job 47: a fast start asks at once, as before the limit", () => {
  vi.useFakeTimers();
  resetStartAsk();
  const open = vi.fn();
  const root = mount();
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true })));
  expect(open).toHaveBeenCalledTimes(1);
  act(() => void vi.advanceTimersByTime(START_WAIT_MS * 2));
  expect(open).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

// Job 47 A6: setup closed with no folder, then the first folder opens the Start form. The ask at open does not
// come a second time: the form being up counts as the user acting.
test("job 47 A6: the Start form the first folder opens is the one ask; the ask at open does not follow it", () => {
  resetStartAsk();
  const open = vi.fn();
  const root = mount();
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true, firstRun: true })));
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true, firstRun: false, sheetOpen: true })));
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true, firstRun: false, sheetOpen: false, panes: 3 })));
  vi.useFakeTimers();
  act(() => vi.advanceTimersByTime(START_WAIT_MS));
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true, firstRun: false, sheetOpen: false, panes: 3 })));
  expect(open).not.toHaveBeenCalled();
  act(() => root.unmount());
});

// Job 47 item 2 (job 41 F1): a file the system hands Kolux at start opens a preview pane. That pane is not the user
// acting, so a slow start and a fast start both ask, in front of it. A pane the user opens still counts.
const term = (key: number): { key: number; kind?: string; path?: string } => ({ key });
const handedPane = (key: number, path: string) => ({ key, kind: "preview", path });
test("job 47 F1: a slow start with a handed file: the form asks once", () => {
  resetStartAsk();
  const open = vi.fn();
  const root = mount();
  act(() => root.render(createElement(Probe, { ...base(open), layoutIn: false, panes: ownPanes([]) })));
  handOver("C:\notes\a.md");
  act(() => root.render(createElement(Probe, { ...base(open), layoutIn: false, panes: ownPanes([handedPane(9, "C:\notes\a.md")]) })));
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true, panes: ownPanes([term(1), term(2), term(3), handedPane(9, "C:\notes\a.md")]) })));
  expect(open).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

test("job 47 F1: a fast start with a handed file: the form asks", () => {
  resetStartAsk();
  const open = vi.fn();
  const root = mount();
  act(() => root.render(createElement(Probe, { ...base(open), panes: ownPanes([term(1), term(2)]) })));
  handOver("C:\notes\b.md");
  act(() => root.render(createElement(Probe, { ...base(open), panes: ownPanes([term(1), term(2), handedPane(9, "C:\notes\b.md")]) })));
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true, panes: ownPanes([term(1), term(2), handedPane(9, "C:\notes\b.md")]) })));
  expect(open).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

test("job 47 F1: a slow start where the user opens a terminal still skips, with or without a handed file", () => {
  for (const handed of [false, true]) {
    resetStartAsk();
    const open = vi.fn();
    const root = mount();
    const file = handed ? [handedPane(9, "C:\notes\c.md")] : [];
    if (handed) handOver("C:\notes\c.md");
    act(() => root.render(createElement(Probe, { ...base(open), layoutIn: false, panes: ownPanes(file) })));
    act(() => root.render(createElement(Probe, { ...base(open), layoutIn: false, panes: ownPanes([...file, term(5)]) })));
    act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true, panes: ownPanes([term(1), ...file, term(5)]) })));
    expect(open).not.toHaveBeenCalled();
    act(() => root.unmount());
  }
});

test("job 47 F1: a handed file and then a terminal the user opens on a fast start: skips", () => {
  resetStartAsk();
  const open = vi.fn();
  const root = mount();
  act(() => root.render(createElement(Probe, { ...base(open), panes: ownPanes([term(1), term(2)]) })));
  handOver("C:\notes\d.md");
  act(() => root.render(createElement(Probe, { ...base(open), panes: ownPanes([term(1), term(2), handedPane(9, "C:\notes\d.md")]) })));
  act(() => root.render(createElement(Probe, { ...base(open), panes: ownPanes([term(1), term(2), handedPane(9, "C:\notes\d.md"), term(10)]) })));
  act(() => root.render(createElement(Probe, { ...base(open), agentsDone: true, panes: ownPanes([term(1), term(2), handedPane(9, "C:\notes\d.md"), term(10)]) })));
  expect(open).not.toHaveBeenCalled();
  act(() => root.unmount());
});
