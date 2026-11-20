// FT-1 (review 0.2.0, follow-up): what WindowPane hands each pane body as `hidden`, drawn for real under the window
// store. The terminal, the check tab and the placeholder for a tab that lost its data all read the one in-view answer:
// another folder's top tab, a zoomed-away cell and a tab under another tab are hidden; the shown top tab is not.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const seen: { who: string; hidden: unknown }[] = [];
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => new Promise(() => {}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("./TerminalMemo", () => ({ default: (p: { hidden: unknown }) => (seen.push({ who: "terminal", hidden: p.hidden }), null) }));
vi.mock("../../lazy/panes", () => ({ CheckPane: (p: { hidden: unknown }) => (seen.push({ who: "check", hidden: p.hidden }), null) }));
// Only the placeholder for a tab that lost its data (LostPane) is stubbed; every other deferred surface stays as it is.
vi.mock("../../lazy/deferred", async (original) => {
  const real = await original<typeof import("../../lazy/deferred")>();
  const stub = (p: { hidden: unknown }) => (seen.push({ who: "lost", hidden: p.hidden }), null);
  return { ...real, deferred: ((load: () => Promise<unknown>, ...rest: unknown[]) => (String(load).includes("LostPane") ? stub : (real.deferred as (...a: unknown[]) => unknown)(load, ...rest))) as typeof real.deferred };
});
import type { Pane } from "../../App";
import { cellsOf } from "../../terminal/grid";
import type { WindowBag } from "../windowBag";
import WindowPane from "./Pane";
import { WindowStoreProvider } from "./store";

const here = "C:\work\a";
const there = "C:\work\b";
const mk = (key: number, cwd: string, extra: Partial<Pane> = {}): Pane => ({ key, cwd, branch: null, agent: "shell", program: null, args: [], ...extra });

function bagFor(panes: Pane[], over: Record<string, unknown>) {
  const cells = cellsOf(panes);
  return {
    terminals: true, activeDir: here, zoomed: null, cells, panes, shown: cells, gridCount: cells.length, classic: false,
    focused: null, settings: {}, titles: {}, liveIds: {}, projects: [], owner: {}, names: {}, agents: [], context: {}, hook: {}, turn: {}, crew: {},
    unreadPanes: new Set<number>(), askName: {}, shells: [], notices: {}, dragging: { current: null },
    restoredKeys: { current: new Set<number>() }, liveRef: { current: {} }, hookRef: { current: {} }, muteRef: { current: {} }, runRef: { current: {} },
    ptys: { current: {} }, report: { current: () => {} }, savedName: () => undefined, noticeFor: () => undefined, launching: false, defaultId: null,
    ...over,
  } as unknown as WindowBag;
}

function draw(pane: Pane, active: number, panes: Pane[], over: Record<string, unknown> = {}) {
  seen.length = 0;
  renderToStaticMarkup(createElement(WindowStoreProvider, { store: bagFor(panes, over), children: createElement(WindowPane, { pane, active }) }));
  return seen.map((s) => s.hidden);
}

beforeEach(() => void (seen.length = 0));

test("FT-1: the shown top tab of the folder in front is not hidden", () => {
  const a = mk(1, here);
  expect(draw(a, 1, [a])).toEqual([false]);
});

test("FT-1: another folder's top tab is hidden", () => {
  const a = mk(1, here);
  const b = mk(2, there);
  expect(draw(b, 2, [a, b])).toEqual([true]);
});

test("FT-1: a pane in a zoomed-away cell is hidden, the zoomed one is not", () => {
  const a = mk(1, here);
  const b = mk(2, here);
  expect(draw(a, 1, [a, b], { zoomed: 2 })).toEqual([true]);
  expect(draw(b, 2, [a, b], { zoomed: 2 })).toEqual([false]);
});

test("FT-1: a tab under another tab is hidden", () => {
  const a = mk(1, here);
  const b = mk(2, here, { group: 1 });
  expect(draw(a, 2, [a, b])).toEqual([true]);
  expect(draw(b, 2, [a, b])).toEqual([false]);
});

test("FT-1: the check tab and the placeholder for a tab that lost its data read the same answer", () => {
  const a = mk(1, here);
  const check = mk(2, here, { kind: "check", check: {} as never });
  const lost = mk(3, here, { kind: "editor" });
  const panes = [a, check, lost];
  // each is its own cell; zoom keeps cell 1 only
  expect(draw(check, 2, panes, { zoomed: 1 })).toEqual([true]);
  expect(draw(lost, 3, panes, { zoomed: 1 })).toEqual([true]);
  expect(draw(check, 2, panes)).toEqual([false]);
  expect(draw(lost, 3, panes)).toEqual([false]);
  const elsewhere = mk(4, there, { kind: "editor" });
  expect(draw(elsewhere, 4, [a, elsewhere])).toEqual([true]);
});
