// PKG-2 (narrow the redraw): the callers keep one identity and always run the newest function; the comparators
// redraw on every data change and never on a new closure alone; a prop nobody listed always redraws.
import { createElement, memo, StrictMode, act, useLayoutEffect } from "react";
import type { Root } from "react-dom/client";
import { beforeAll, expect, test } from "vitest";
import { installDom } from "../../tasks/fakeDom";
import { callers, sameData, sameProps, tally, useStableFns } from "./stable";
import { sameCard, sameSettings, sameNotice, sameTerminal, type TerminalProps } from "./terminalProps";
import { sameProjects, type ProjectsProps } from "./projectsProps";
import { sameExplorer, type ExplorerProps } from "./explorerProps";

// The repo has no jsdom: src/tasks/fakeDom is the page, enough for components that draw nothing.
let mount: () => Root;
beforeAll(async () => {
  const { doc } = installDom();
  const { createRoot } = await import("react-dom/client");
  mount = () => createRoot(doc.createElement("div") as unknown as Element);
});

test("a caller keeps its identity and runs the newest function it was given", () => {
  let bag = { add: (n: number) => n + 1, name: "a" };
  const c = callers(() => bag);
  const add = c.add;
  expect(add(1)).toBe(2);
  bag = { add: (n: number) => n + 10, name: "b" };
  expect(c.add).toBe(add);
  expect(add(1)).toBe(11);
});

test("useStableFns: the same callers every render, each running that render's closure (StrictMode on)", () => {
  const seen: unknown[] = [];
  const got: string[] = [];
  function Probe({ word }: { word: string }) {
    const fns = useStableFns({ say: () => got.push(word) });
    seen.push(fns.say);
    useLayoutEffect(() => void fns.say());
    return null;
  }
  const root = mount();
  act(() => root.render(createElement(StrictMode, null, createElement(Probe, { word: "one" }))));
  act(() => root.render(createElement(StrictMode, null, createElement(Probe, { word: "two" }))));
  expect(new Set(seen).size).toBe(1);
  expect(got[got.length - 1]).toBe("two");
  act(() => root.unmount());
});

test("sameData compares plain data by value and anything else by identity", () => {
  expect(sameData({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] })).toBe(true);
  expect(sameData({ a: [1, { b: "x" }] }, { a: [1, { b: "y" }] })).toBe(false);
  expect(sameData([1, 2], [1, 2, 3])).toBe(false);
  expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  expect(sameData(null, {})).toBe(false);
  const f = () => 1;
  expect(sameData({ f }, { f })).toBe(true);
  expect(sameData({ f }, { f: () => 1 })).toBe(false);
  expect(sameData(new Set([1]), new Set([1]))).toBe(false);
});

test("sameProps: a prop the rules do not list counts as changed", () => {
  const same = sameProps<{ a: number; b?: string }>({ a: "same", b: "same" });
  expect(same({ a: 1 }, { a: 1 })).toBe(true);
  expect(same({ a: 1 }, { a: 2 })).toBe(false);
  expect(same({ a: 1, b: "x" }, { a: 1 })).toBe(false);
  expect(same({ a: 1 }, { a: 1, extra: true } as { a: number })).toBe(false);
});

// A terminal pane's props as Pane.tsx builds them, with a fresh set of closures each time.
const settings = {};
const fixed = { focus: () => {}, close: () => {}, toggle: () => {}, answer: () => {}, review: () => {}, expand: () => {}, primary: () => {} };
const props = (over: Partial<TerminalProps> = {}, fns = fixed): TerminalProps => ({
  hidden: false, focused: false, cwd: "C:/w", branch: "main", agent: "claude", program: "claude", args: ["--x"], env: [["A", "1"]], name: "Claude", title: "w",
  hook: "working", unread: false, number: 3, usage: { tokens: 10, window: 200, costUsd: null, left: false }, crew: [{ id: "c", kind: "task", state: "working" }],
  entryTabs: [{ key: 3, name: "w" }], keySettings: settings, onFocus: fns.focus, onClose: fns.close,
  card: { expanded: false, onToggle: fns.toggle, chip: { lane: "working", word: "Working", line: "", answer: false }, column: 1, onAnswer: fns.answer, onReview: fns.review, meter: { context: { tokens: 10, window: 200, percent: 5 } } },
  expand: { on: false, can: true, toggle: fns.expand },
  notice: { title: "t", body: "b", primary: "Restart", onPrimary: fns.primary },
  ...over,
});

test("sameTerminal: equal data with fresh objects (card, meter, usage, tab list) does not redraw", () => {
  expect(sameTerminal(props(), props())).toBe(true);
});

test("sameTerminal: a change in any piece of data the pane shows redraws it", () => {
  const base = props();
  const changes: Partial<TerminalProps>[] = [
    { hidden: true }, { focused: true }, { hook: "permission" }, { unread: true }, { title: "x" }, { name: "Codex" }, { branch: "dev" },
    { args: ["--y"] }, { env: [["A", "2"]] }, { usage: { tokens: 11, window: 200, costUsd: null, left: false } }, { crew: [] }, { entryTabs: [{ key: 3, name: "renamed" }] },
    { keySettings: { linksOpenInKolux: true } }, { stop: { cause: "limit" } }, { pendingTool: "Bash" }, { renameAsk: 1 }, { restored: true }, { account: "a@b" },
    { card: { ...base.card!, expanded: true } }, { card: { ...base.card!, column: 2 } }, { card: { ...base.card!, chip: { lane: "done", word: "Done", line: "", answer: false } } },
    { card: { ...base.card!, meter: { context: { tokens: 99, window: 200, percent: 50 } } } }, { card: undefined },
    { expand: { on: true, can: true, toggle: fixed.expand } }, { notice: null }, { notice: { ...base.notice!, body: "other" } }, { notice: { ...base.notice!, secondary: "Keep", onSecondary: fixed.primary } },
    { onReviewPlan: fixed.review }, { onEqualize: fixed.review }, { dragCell: { onStart: fixed.focus, onEnd: fixed.close } },
  ];
  for (const c of changes) expect(sameTerminal(base, { ...base, ...c }), JSON.stringify(Object.keys(c))).toBe(false);
});

test("sameTerminal: a new closure where a fixed caller belongs redraws (never ignored), so staleness cannot hide", () => {
  const fresh = { ...fixed, focus: () => {}, toggle: () => {}, primary: () => {} };
  expect(sameTerminal(props(), props({}, fresh))).toBe(false);
  expect(sameCard(props().card!, props({}, fresh).card!)).toBe(false);
  expect(sameNotice(props().notice!, props({}, fresh).notice!)).toBe(false);
});

test("a memoised pane draws again on a data change and not on a parent render with equal props", () => {
  const Pane = memo(function Pane(_: TerminalProps) {
    tally("probe");
    return null;
  }, sameTerminal);
  const t = { probe: 0 };
  (globalThis as { __kxRenders?: Record<string, number> }).__kxRenders = t;
  const root = mount();
  act(() => root.render(createElement(Pane, props())));
  act(() => root.render(createElement(Pane, props())));
  expect(t.probe).toBe(1);
  act(() => root.render(createElement(Pane, props({ focused: true }))));
  expect(t.probe).toBe(2);
  act(() => root.unmount());
  delete (globalThis as { __kxRenders?: unknown }).__kxRenders;
});

test("the tally costs nothing and counts nothing unless the harness turns it on", () => {
  delete (globalThis as { __kxRenders?: unknown }).__kxRenders;
  expect(() => tally("x")).not.toThrow();
});

test("the pane's settings: the window's saved layout and screen never redraw it; any other field does", () => {
  const a = { keyPolicy: "terminal", savedLayout: { panes: [1] }, lastScreen: "board", font: { size: 13 } };
  expect(sameSettings(a, { ...a, savedLayout: { panes: [1, 2] }, lastScreen: "terminals", font: { size: 13 } })).toBe(true);
  expect(sameSettings(a, { ...a, keyPolicy: "kolux" })).toBe(false);
  expect(sameSettings(a, { ...a, font: { size: 14 } })).toBe(false);
  expect(sameSettings(a, { savedLayout: a.savedLayout, lastScreen: "board", font: { size: 13 } })).toBe(false); // a field gone
  const base = props();
  expect(sameTerminal(base, { ...base, keySettings: { savedLayout: { panes: [9] } } })).toBe(true);
  expect(sameTerminal(base, { ...base, keySettings: { linksOpenInKolux: true } })).toBe(false);
});

test("sameProjects: fresh lists with the same rows do not redraw the project list; each change does", () => {
  const fn = () => {};
  const unread = new Set<string>();
  const settings = { sortBy: "smart", savedLayout: { a: 1 } };
  const agents: never[] = [];
  const base = (over: Partial<ProjectsProps> = {}): ProjectsProps => ({
    openDirs: ["C:/w"], sessions: [{ key: 1, agent: "claude", title: "w", cwd: "C:/w", running: true }], states: { "C:/w": { state: "working", changed: 5, pr: null } },
    unread, onUnread: fn, settings, onSetting: fn, activeDir: "C:/w", onSelect: fn, onRemoved: fn, onRemovedAll: fn, onSleep: fn, unsavedIn: fn as never, agents, launching: false,
    onLaunch: fn, defaultId: "claude", onSetDefault: fn, onChoose: fn, page: null, onPage: fn, refresh: 0, onIndex: fn, createRequest: 0, deleteRequest: 0,
    onStartIn: fn, nest: true, onNest: fn, artifactsOn: false, onArtifacts: fn, ...over,
  });
  expect(sameProjects(base(), base())).toBe(true);
  expect(sameProjects(base(), base({ settings: { ...settings, savedLayout: { a: 2 } } }))).toBe(true);
  const changes: Partial<ProjectsProps>[] = [
    { openDirs: ["C:/w", "C:/x"] }, { sessions: [{ key: 1, agent: "claude", title: "w", cwd: "C:/w", running: false }] },
    { states: { "C:/w": { state: "permission", changed: 6, pr: null } } }, { unread: new Set(["C:/w"]) }, { settings: { ...settings, sortBy: "manual" } },
    { activeDir: "C:/x" }, { page: "tasks" }, { refresh: 1 }, { createRequest: 1 }, { deleteRequest: 1 }, { renameRequest: 1 }, { reveal: 1 },
    { launching: true }, { defaultId: "codex" }, { agents: [] }, { nest: false }, { artifactsOn: true }, { skillsOn: true }, { allOff: true },
    { unsavedIn: (() => []) as never }, // the selector it calls while drawing: a new identity is new data
  ];
  for (const c of changes) expect(sameProjects(base(), base(c)), JSON.stringify(Object.keys(c))).toBe(false);
});

test("sameExplorer: the file tree redraws for a new folder, a hide or show and a focus request, not for a parent render", () => {
  const fn = () => {};
  const base: ExplorerProps = { root: "C:/w", hidden: false, focusAsk: 0, onOpen: fn, onClose: fn, onOpenTerminal: fn, onWake: fn };
  expect(sameExplorer(base, { ...base })).toBe(true);
  for (const c of [{ root: "C:/x" }, { hidden: true }, { focusAsk: 1 }, { onClose: () => {} }, { onWake: undefined }]) expect(sameExplorer(base, { ...base, ...c }), JSON.stringify(c)).toBe(false);
});

test("the harness's A/B switch makes every comparison redraw, and only while it is set", () => {
  const same = sameProps<{ a: number }>({ a: "same" });
  const g = globalThis as { __kxRenders?: Record<string, number> };
  g.__kxRenders = { off: 1 };
  expect(same({ a: 1 }, { a: 1 })).toBe(false);
  g.__kxRenders = {};
  expect(same({ a: 1 }, { a: 1 })).toBe(true);
  delete g.__kxRenders;
  expect(same({ a: 1 }, { a: 1 })).toBe(true);
});
