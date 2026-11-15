// C13-R1-01: Open in Code and Review changes must leave a full page behind.
import { expect, test, vi } from "vitest";
import type { WindowState } from "../shell/windowStore";
import type { WindowLate } from "../shell/windowLate";
import { paneActions } from "./paneActions";

function state() {
  const setPage = vi.fn();
  const setScreen = vi.fn();
  const setActiveDir = vi.fn();
  const setFocused = vi.fn();
  const setPanes = vi.fn();
  const pane = { key: 5, cwd: "C:\\w", branch: null, agent: "shell", program: null, args: [] };
  const s = { panes: [pane], activeDir: "C:\\w", setPage, setScreen, setActiveDir, setFocused, setPanes, nextKey: { current: 9 } } as unknown as WindowState;
  const late = { setReveal: vi.fn() } as unknown as WindowLate;
  const a = paneActions(s, {} as never, {} as never, late);
  return { a, setPage, setScreen, setPanes };
}

test("C13-R1-01: Open in Code clears the full page before showing Terminals", () => {
  const { a, setPage, setScreen } = state();
  a.openPane(5);
  expect(setScreen).toHaveBeenCalledWith("terminals");
  expect(setPage).toHaveBeenCalledWith(null);
});

test("C13-R1-01: Review changes on a new tab clears the full page", () => {
  const { a, setPage, setScreen, setPanes } = state();
  a.reviewChanges(5);
  expect(setPanes).toHaveBeenCalled();
  expect(setScreen).toHaveBeenCalledWith("terminals");
  expect(setPage).toHaveBeenCalledWith(null);
});

// Two panes of one launch fail to start before the window draws again: both go, neither comes back dead.
test("two start failures in a row remove both panes", () => {
  let list = [5, 6, 7].map((key) => ({ key, cwd: "C:\\w", branch: null, agent: "claude", program: null, args: [], batch: 1 }));
  const setPanes = vi.fn((v: unknown) => (list = typeof v === "function" ? (v as (ps: typeof list) => typeof list)(list) : (v as typeof list)));
  const s = { panes: list, activeDir: "C:\\w", setPanes, setFocused: vi.fn(), setToast: vi.fn(), restoredKeys: { current: new Set() }, cliFailed: { current: {} } } as unknown as WindowState;
  // both callbacks come from the same render, as two failures that land before React draws again
  const a = paneActions(s, {} as never, {} as never, {} as WindowLate);
  a.failedPane(5, "not found");
  a.failedPane(6, "not found");
  expect(list.map((p) => p.key)).toEqual([7]);
});

// CLI-026: a split from the command line of a lone pane in a workspace not in front stacks that workspace, not the one in front.
test("a command-line split down stacks the split pane's own workspace", () => {
  let stacked: Record<string, boolean> = { "C:\\front": false };
  const setStacked = vi.fn((f: (st: typeof stacked) => typeof stacked) => (stacked = f(stacked)));
  const panes = [
    { key: 1, cwd: "C:\\front", branch: null, agent: "shell", program: null, args: [] },
    { key: 2, cwd: "C:\\front", branch: null, agent: "shell", program: null, args: [] },
    { key: 5, cwd: "C:\\other", branch: null, agent: "shell", program: null, args: [] },
  ];
  const s = { panes, activeDir: "C:\\front", setPanes: vi.fn(), setFocused: vi.fn(), setStacked, setToast: vi.fn(), cliFailed: { current: {} }, nextKey: { current: 9 } } as unknown as WindowState;
  const a = paneActions(s, {} as never, {} as never, {} as WindowLate);
  a.splitPane(5, "down", { ask: "q", command: null });
  expect(stacked).toEqual({ "C:\\front": false, "C:\\other": true });
});

// TERM-118: closing an unread tab without looking at it drops its mark, and the workspace dot once no unread tab stays.
test("closing unread tabs drops their marks and the workspace dot only when none stays unread", () => {
  const tab = (key: number, cwd: string) => ({ key, cwd, branch: null, agent: "claude", program: null, args: [] });
  const panes = [tab(1, "C:\\a"), tab(2, "C:\\a"), tab(3, "C:\\b")];
  let unread = new Set([1, 2, 3]);
  const cleared: string[] = [];
  const s = {
    panes, activeDir: "C:\\a", focused: 1, unreadPanes: unread, markDir: (d: string, un: boolean) => void (!un && cleared.push(d)),
    setUnreadPanes: vi.fn((f: (u: Set<number>) => Set<number>) => (unread = f(unread))), setPanes: vi.fn(), setRunning: vi.fn(), setDirty: vi.fn(), setFocused: vi.fn(), setTabColors: vi.fn(), setToast: vi.fn(),
    ptys: { current: {} }, runTabs: { current: {} }, recentTabs: { current: [] }, pinned: new Set(),
  } as unknown as WindowState;
  const late = { exitedPrompt: { current: {} } } as unknown as WindowLate;
  const a = paneActions(s, {} as never, {} as never, late);
  a.dropPanes([1, 3]);
  expect([...unread]).toEqual([2]);
  expect(cleared).toEqual(["C:\\b"]); // pane 2 in C:\\a is still unread, so that dot stays
});

// TERM-001: shrinking drops a cell of two unstarted chooser tabs; the focus on its second tab moves to a pane that stays.
test("shrinking the pane count moves the focus off a removed chooser tab", () => {
  const chooser = (key: number, group?: number) => ({ key, cwd: "C:\\w", branch: null, agent: "shell", program: null, args: [], seats: [{}], group });
  const panes = [{ key: 1, cwd: "C:\\w", branch: null, agent: "shell", program: null, args: [] }, chooser(2), chooser(3, 2)];
  let focused = 3;
  const s = { panes, activeDir: "C:\\w", setPanes: vi.fn(), setToast: vi.fn(), titles: {}, nextKey: { current: 9 }, setFocused: vi.fn((f: (k: number) => number) => (focused = f(focused))) } as unknown as WindowState;
  const a = paneActions(s, {} as never, {} as never, {} as WindowLate);
  a.setCount(1);
  expect(focused).toBe(1);
});

// D-14 (wave 2 item 4): the layout strip never leaves empty "choose what to run" panes. Growing from one
// started pane to four adds no pane at all; it opens the Start form once with How many set to the 3 new cells.
test("growing the layout opens the Start form for the new cells and adds no chooser panes", () => {
  const started = { key: 1, cwd: "C:\w", branch: null, agent: "shell", program: null, args: [] };
  const setPanes = vi.fn();
  const setSheet = vi.fn();
  const s = { panes: [started], activeDir: "C:\w", projects: [], settings: {}, agents: [], installedIds: [], setPanes, setSheet, setToast: vi.fn(), titles: {}, nextKey: { current: 9 }, setFocused: vi.fn() } as unknown as WindowState;
  const la = { lineupsOf: () => ({}), projectFor: () => null, inGitFor: () => false, launch: vi.fn(), pretrust: vi.fn() };
  const a = paneActions(s, {} as never, la as never, { projectOf: () => null } as unknown as WindowLate);
  a.setCount(4);
  expect(setPanes).not.toHaveBeenCalled();
  expect(setSheet).toHaveBeenCalledTimes(1);
  expect(setSheet.mock.calls[0][0].seats).toHaveLength(3);
});

// The palette reaches All Changes without a finished agent, and finds pages and commands by the words people type.
test("the palette finds All Changes, the Appearance page and the new shell command by everyday words", async () => {
  const { resolve } = await import("../keys/keymap");
  const { paletteRows, nothingFound } = await import("../projects/WorktreePalette");
  const s = {
    panes: [], activeDir: "C:\\\\w", keymap: resolve(null, "win32"), accountSwitcher: { groups: [] }, installedIds: [], screen: "terminals", classic: false,
    titles: {}, running: {}, hook: {}, stamp: {}, unreadPanes: new Set(), setPage: vi.fn(), setScreen: vi.fn(), setToast: vi.fn(), setFocused: vi.fn(), setPanes: vi.fn(), nextKey: { current: 9 },
  } as unknown as WindowState;
  const a = paneActions(s, {} as never, {} as never, {} as WindowLate);
  const items = a.paletteItems();
  const top = (q: string) => paletteRows(items, q).map((r) => r.label);
  for (const q of ["changes", "review", "diff", "commit", "stage"]) expect(top(q)).toContain("Open All Changes");
  expect(top("theme")).toContain("Appearance");
  expect(top("new shell")).toContain("New terminal tab");
  expect(nothingFound(paletteRows(items, "zzzqq").length, "zzzqq")).toBe(true);
  expect(nothingFound(0, "")).toBe(false);
});

// The sidebar row's Review changes: the workspace comes to the front with its All Changes, opened once.
test("Review changes from a workspace row opens that workspace's All Changes, or focuses the open one", () => {
  const run = (panes: unknown[]) => {
    let list = panes as { key: number; kind?: string; cwd: string | null; group?: number }[];
    const calls = { setActiveDir: vi.fn(), setFocused: vi.fn(), setScreen: vi.fn(), setPage: vi.fn() };
    const s = { panes: list, activeDir: "C:\\\\front", focused: 1, recentDirs: { current: [] }, nextKey: { current: 9 }, setPanes: vi.fn((f: (ps: typeof list) => typeof list) => (list = f(list))), ...calls } as unknown as WindowState;
    const a = paneActions(s, {} as never, {} as never, { setReveal: vi.fn() } as unknown as WindowLate);
    a.openChangesIn("C:\\\\w", "main");
    return { list, ...calls };
  };
  const front = { key: 1, cwd: "C:\\\\front", branch: null, agent: "shell", program: null, args: [] };
  const empty = run([front]);
  expect(empty.list.map((p) => [p.key, p.kind, p.cwd])).toEqual([[1, undefined, "C:\\\\front"], [9, "changes", "C:\\\\w"]]);
  expect(empty.setActiveDir).toHaveBeenCalledWith("C:\\\\w");
  expect(empty.setFocused).toHaveBeenCalledWith(9);
  expect(empty.setScreen).toHaveBeenCalledWith("terminals");
  const open = run([front, { key: 4, cwd: "C:\\\\w", branch: "main", agent: "shell", program: null, args: [] }, { key: 5, cwd: "C:\\\\w", branch: "main", agent: "shell", program: null, args: [], kind: "changes", group: 4 }]);
  expect(open.list).toHaveLength(3);
  expect(open.setFocused).toHaveBeenCalledWith(5);
});

// DT-C274: a team grid shows panes of several worktrees; a diff tab of one is never reused for the same path of another.
test("a diff of a team worktree reuses only a tab of that worktree, never one of a sibling worktree in the same cell", () => {
  const team = (key: number, cwd: string, extra = {}) => ({ key, cwd, view: "C:\\r", branch: null, agent: "shell", program: null, args: [], ...extra });
  const panes = [
    team(1, "C:\\r\\wts\\wt1", { agent: "claude" }),
    team(2, "C:\\r\\wts\\wt2", { kind: "diff", path: "src/a.ts", staged: false, group: 1 }),
    team(3, "C:\\r\\wts\\wt2", { kind: "diff", path: "src/b.ts", staged: false, preview: true, group: 1 }),
  ];
  const setPanes = vi.fn();
  const setFocused = vi.fn();
  const s = { panes, activeDir: "C:\\r", focused: 1, settings: {}, dirty: {}, setPanes, setFocused, nextKey: { current: 9 } } as unknown as WindowState;
  const a = paneActions(s, {} as never, {} as never, {} as WindowLate);
  a.openDiff("src/a.ts", false);
  expect(setFocused).toHaveBeenLastCalledWith(9); // a new tab, not wt2's tab 2
  const made = (setPanes.mock.calls[0][0] as (ps: typeof panes) => typeof panes)(panes).find((p) => p.key === 9);
  expect(made).toMatchObject({ cwd: "C:\\r\\wts\\wt1", view: "C:\\r", kind: "diff", path: "src/a.ts" });
  // the preview tab of wt2 is not taken over by a preview of wt1 either
  a.openDiff("src/c.ts", false, true);
  expect(setFocused).toHaveBeenLastCalledWith(10);
  // the same worktree's tab is reused
  a.openDiff("src/a.ts", false, false, undefined, undefined, "C:\\r\\wts\\wt2");
  expect(setFocused).toHaveBeenLastCalledWith(2);
});
