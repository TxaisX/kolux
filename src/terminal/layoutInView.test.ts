// FT-1 (review 0.2.0, follow-up): the window's in-view test (notifications, unread marks, agent sleep, the layout report)
// must count zoom, as the pane's `hidden` does: a pane in a zoomed-away cell is not in view.
import { expect, test } from "vitest";
import { layoutInView } from "./useLayoutReport";
import app from "../App.tsx?raw";

const here = "C:\work\a";
const cells = [
  { group: 1, panes: [{ key: 1, cwd: here }, { key: 2, cwd: here }] },
  { group: 2, panes: [{ key: 3, cwd: here }] },
];
const top = (c: { group: number; panes: { key: number }[] }) => (c.group === 1 ? 2 : c.panes[0].key);
const w = { terminals: true, activeDir: here, zoomed: null as number | null };

test("FT-1: with nothing zoomed, each cell's top tab is in view and a tab under another is not", () => {
  expect(layoutInView(cells, top, 2, w)).toBe(true);
  expect(layoutInView(cells, top, 3, w)).toBe(true);
  expect(layoutInView(cells, top, 1, w)).toBe(false);
});

test("FT-1: a pane in a zoomed-away cell is not in view; the zoomed cell's top tab is", () => {
  expect(layoutInView(cells, top, 3, { ...w, zoomed: 1 })).toBe(false);
  expect(layoutInView(cells, top, 2, { ...w, zoomed: 1 })).toBe(true);
  expect(layoutInView(cells, top, 2, { ...w, zoomed: 2 })).toBe(false);
});

test("FT-1: a key in no cell, and any pane off the terminals screen, are not in view", () => {
  expect(layoutInView(cells, top, 99, w)).toBe(false);
  expect(layoutInView(cells, top, 2, { ...w, terminals: false })).toBe(false);
});

test("FT-1: App.tsx hands the grid's zoom to the layout report", () => {
  expect(app).toMatch(/useLayoutReport\(\{[^}]*zoomed: grid\.zoomed/);
});
