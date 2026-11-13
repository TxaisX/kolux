// One session per cell (owner decision 2026-11-12, PR #255): layouts written by older Kolux versions, while a grid cell
// could hold several tabs, reopen with every tab in a cell of its own and nothing lost. The fixtures in __fixtures__ were
// written by each version's own layoutOf (scripts/layout-fixtures.mjs), from the same window: a cell of five tabs (two
// agents with sessions, a file, a staged diff, a named shell; three pinned or coloured), an empty chooser cell, a lone
// coloured shell, a cell of a preview, a named shell and a check, a team agent with a shell tab, and a stacked second
// folder with one cell of three tabs. The v0.1.5 profile fixture is read the same way in layout.app048.test.ts.
import { expect, test } from "vitest";
import { panesIn, viewOf } from "../workspaces";
import { cellsOf } from "./grid";
import { freshShells, layoutOf, marksOf, restoreLayout, reviveSaved, stillThere, type SavedPane } from "./layout";
import v011 from "./__fixtures__/layout-v0.1.1.json";
import v0114 from "./__fixtures__/layout-v0.1.14.json";
import wave1 from "./__fixtures__/layout-wave-1.json";

type Fixture = { ref: string; commit: string; savedLayout: { panes: SavedPane[]; activeTab: Record<string, number>; focused: number; activeDir: string; stacked: Record<string, boolean> } };
const APP = "C:/fixture/app";
const LIB = "C:/fixture/lib";
const TEAM_WT = "C:/fixture/app-wt-1";

// Each version's grids after the restore, cell by cell. An old cell's tabs take the cells where the cell was, in the
// order its strip drew them: pinned tabs first (1 and 8; 12), then the rest as saved. v0.1.1 still wrote a check tab
// (10) down, with nothing to rebuild it from (no check, no path); the reader has always dropped that entry (wave-1's
// readPane too), and later versions do not write a check at all. The team agent's grid: v0.1.1 and v0.1.14 did not save
// `view`, so the worktree is a grid of its own; wave-1 saved it, so the agent and its shell tab sit in the app grid.
const CASES: { name: string; fx: Fixture; grids: Record<string, number[]>; unreadable: number[] }[] = [
  { name: "v0.1.1", fx: v011 as Fixture, grids: { [APP]: [1, 8, 5, 6, 7, 2, 3, 4, 9], [LIB]: [12, 11, 13], [TEAM_WT]: [14, 15] }, unreadable: [10] },
  { name: "v0.1.14", fx: v0114 as Fixture, grids: { [APP]: [1, 8, 5, 6, 7, 2, 3, 4, 9], [LIB]: [12, 11, 13], [TEAM_WT]: [14, 15] }, unreadable: [] },
  { name: "wave-1", fx: wave1 as Fixture, grids: { [APP]: [1, 8, 5, 6, 7, 2, 3, 4, 9, 14, 15], [LIB]: [12, 11, 13] }, unreadable: [] },
];

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const withoutCell = ({ group: _cell, ...rest }: SavedPane): SavedPane => rest;

test.each(CASES)("$name: the fixture is the old shape, with cells of several tabs and an active tab each", ({ fx }) => {
  const cells = new Map<number, number>();
  for (const p of fx.savedLayout.panes) cells.set(p.group ?? p.key, (cells.get(p.group ?? p.key) ?? 0) + 1);
  expect(Math.max(...cells.values())).toBe(5);
  expect(Object.keys(fx.savedLayout.activeTab).length).toBeGreaterThan(0);
  expect(fx.savedLayout.panes.some((p) => p.chooser)).toBe(true);
});

test.each(CASES)("$name: every saved tab reopens in a cell of its own, in its old cell's place and strip order", ({ fx, grids, unreadable }) => {
  const l = restoreLayout(copy(fx.savedLayout))!;
  expect(l).not.toBeNull();
  for (const [dir, keys] of Object.entries(grids)) {
    const cells = cellsOf(panesIn(l.panes, dir));
    expect(cells.map((c) => c.group), dir).toEqual(keys);
    expect(cells.every((c) => c.panes.length === 1)).toBe(true);
  }
  const saved = fx.savedLayout.panes.map((p) => p.key).filter((k) => !unreadable.includes(k));
  expect(Object.values(grids).flat().sort((a, b) => a - b)).toEqual(saved.sort((a, b) => a - b));
});

test.each(CASES)("$name: nothing a user saved is lost: titles, sessions, accounts, files, the chooser, pins and colours", ({ fx, unreadable }) => {
  const l = restoreLayout(copy(fx.savedLayout))!;
  const kept = fx.savedLayout.panes.filter((p) => !unreadable.includes(p.key));
  expect(l.panes).toHaveLength(kept.length);
  const back = new Map(l.panes.map((p) => [p.key, p]));
  for (const was of kept) {
    const now = back.get(was.key)!;
    // Only the cell id goes; a shell tab of a team cell saved without a grid of its own keeps the grid its cell was in.
    expect({ ...now, view: undefined }, `pane ${was.key}`).toEqual({ ...withoutCell(was), view: undefined });
    if (was.view !== undefined) expect(now.view).toBe(was.view);
  }
  expect(l.panes.some((p) => p.group !== undefined)).toBe(false);
  const marks = marksOf(l.panes);
  expect([...marks.pinned].sort((a, b) => a - b)).toEqual([1, 8, 12]);
  expect(marks.colors).toEqual({ 1: "blue", 3: "purple", 5: "green", 8: "red", 12: "teal" });
  // The empty chooser cell stays an empty cell: it comes back as a chooser, not a shell.
  expect(reviveSaved(back.get(2)!)).toMatchObject({ key: 2, seats: [{ agent: null, model: null }] });
});

test.each(CASES)("$name: the focus, the folder in front and the stacked folder come back; the old tab in front is read past", ({ fx }) => {
  const l = restoreLayout(copy(fx.savedLayout))!;
  expect(l.focused).toBe(6); // the tab in front of the focused cell had the focus, and keeps it
  expect(l.activeDir).toBe(APP);
  expect(l.stacked).toEqual({ [LIB]: true });
  expect(l).not.toHaveProperty("activeTab");
  // Every tab a cell showed in front is still on screen: each is in its own cell of the grid in front or its own grid.
  for (const k of Object.values(fx.savedLayout.activeTab)) expect(l.panes.some((p) => p.key === k)).toBe(true);
});

test.each(CASES)("$name: the whole start path keeps every tab, and the next write is in the new form", ({ fx, grids }) => {
  // main.tsx settle(): restore, drop tabs whose folder is gone (none here), agents back as plain shells (DT-C27).
  const l = freshShells(stillThere(restoreLayout(copy(fx.savedLayout))!, () => true));
  const live = l.panes.map(reviveSaved);
  for (const [dir, keys] of Object.entries(grids)) expect(cellsOf(panesIn(live, dir)).map((c) => c.group), dir).toEqual(keys);
  expect(live.find((p) => p.key === 1)).toMatchObject({ agent: "shell", program: null, title: "Fix login", pinned: true, color: "blue" });
  expect(live.find((p) => p.key === 6)).toMatchObject({ kind: "editor", path: `${APP}/README.md` });
  expect(live.find((p) => p.key === 7)).toMatchObject({ kind: "diff", staged: true });
  // The window writes it back with its marks; that layout has no cell ids and no tab in front, and reads back as written.
  const written = layoutOf(live, l.focused, l.activeDir, l.stacked, marksOf(l.panes));
  expect(JSON.stringify(written)).not.toMatch(/"group"|"activeTab"/);
  expect(written.panes.map((p) => p.key)).toEqual(l.panes.map((p) => p.key));
  expect(restoreLayout(copy(written))).toEqual(written);
  // The grid a team tab is shown in is unchanged by the round trip.
  for (const p of written.panes) expect(viewOf(p)).toBe(viewOf(l.panes.find((x) => x.key === p.key)!));
});

test.each(CASES)("$name: a folder that is gone takes only its own tabs with it", ({ fx, grids }) => {
  const l = stillThere(restoreLayout(copy(fx.savedLayout))!, (d) => d !== LIB);
  expect(panesIn(l.panes, LIB)).toEqual([]);
  expect(cellsOf(panesIn(l.panes, APP)).map((c) => c.group)).toEqual(grids[APP]);
});
