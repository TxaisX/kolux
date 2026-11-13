import { afterEach, expect, test } from "vitest";
import { EMPTY_GRID_MAP, GRID_MAP_SETTING, clearStartDirs, focusDirOf, forgetStartDirs, gridRootsOf, mergeGridMap, readGridMap, setStartDir, startDirOf, unionGridMaps } from "./worktreeGrid";
import { gridOf, panesIn, setGridRoots } from "../workspaces";

const P = { id: "p1", path: "G:\\Dev\\kolux" };
const B = { id: "p2", path: "G:\\Dev\\Txais Brain" };
const A = "G:\\Dev\\kolux-lanes\\one-ws";
const C = "G:\\Dev\\kolux-lanes\\other";
const owner = { [P.path]: "p1", [A]: "p1", [C]: "p1", [B.path]: "p2" };

afterEach(() => {
  setGridRoots({});
  clearStartDirs();
});

// P1-1: the grid shown is the project's one grid, so what acts on files and Git follows the focused pane's own folder.
test("P1-1: with the focused pane in a worktree, the work folder is that worktree; with none focused or shown it is the project folder", () => {
  setGridRoots(gridRootsOf([P, B], owner), [P.path, B.path]);
  const panes = [
    { key: 1, cwd: P.path },
    { key: 2, cwd: A },
    { key: 3, cwd: B.path },
  ];
  expect(gridOf(A)).toBe(P.path); // the grid shown for the worktree pane is the project's, so activeDir alone would be the main checkout
  expect(focusDirOf(panes, 2, P.path)).toBe(A);
  expect(focusDirOf(panes, 1, P.path)).toBe(P.path);
  expect(focusDirOf(panes, 99, P.path)).toBe(P.path);
  expect(focusDirOf(panes, 3, P.path)).toBe(P.path); // focused, but shown in another project's grid
  expect(focusDirOf(panes, 2, null)).toBe(null);
  expect(focusDirOf([{ key: 4, cwd: null }], 4, P.path)).toBe(P.path); // a pane with no folder works where the grid is
});

test("P1-1: a pane shown in a grid through its view still reports its own folder", () => {
  setGridRoots(gridRootsOf([P], owner), [P.path]);
  expect(focusDirOf([{ key: 7, cwd: C, view: P.path }], 7, P.path)).toBe(C);
});

// P1-2: the worktree to project map no longer depends on the sidebar having scanned.
test("P1-2: a saved map answers before any scan, round-trips through the settings, and an empty or failed scan removes nothing", () => {
  const fresh = mergeGridMap(EMPTY_GRID_MAP, [P, B], owner);
  expect(fresh.worktrees[A]).toBe(P.path);
  expect(fresh.roots).toEqual([P.path, B.path]);
  const saved = readGridMap({ [GRID_MAP_SETTING]: JSON.parse(JSON.stringify(fresh)) });
  expect(saved).toEqual(fresh);
  // the window starts with the sidebar closed: nothing scanned, the saved map alone puts a worktree session in its project's grid
  const none = mergeGridMap(saved, [], {});
  expect(none).toBe(saved);
  setGridRoots(none.worktrees, none.roots);
  expect(gridOf(A)).toBe(P.path);
  expect(panesIn([{ key: 1, cwd: A }, { key: 2, cwd: B.path }], P.path).map((p) => p.key)).toEqual([1]);
  // a scan that found nothing for a project (failed or empty) keeps what was known; a later scan only adds
  expect(mergeGridMap(saved, [P, B], {}).worktrees).toEqual(saved.worktrees);
  const third = "G:\\Dev\\kolux-lanes\\third";
  const more = mergeGridMap(saved, [P, B], { ...owner, [third]: "p1" });
  expect(Object.keys(more.worktrees)).toContain(third);
  expect(more.worktrees[A]).toBe(P.path);
});

test("P1-2: a worktree is forgotten only when its project is gone from a project list that has projects", () => {
  const known = mergeGridMap(EMPTY_GRID_MAP, [P, B], { ...owner, "D:\\b\\wt": "p2" });
  const afterRemove = mergeGridMap(known, [P], owner);
  expect(afterRemove.worktrees["D:\\b\\wt"]).toBeUndefined();
  expect(afterRemove.worktrees[A]).toBe(P.path);
  expect(afterRemove.roots).toEqual([P.path]);
});

test("P1-2: unusable saved data reads as an empty map; two maps join without losing either", () => {
  expect(readGridMap({})).toEqual(EMPTY_GRID_MAP);
  expect(readGridMap({ [GRID_MAP_SETTING]: "nope" })).toEqual(EMPTY_GRID_MAP);
  expect(readGridMap({ [GRID_MAP_SETTING]: { roots: [1, "C:\\x"], worktrees: { "C:\\y": 3, "C:\\z": "C:\\x" } } })).toEqual({ roots: ["C:\\x"], worktrees: { "C:\\z": "C:\\x" } });
  const joined = unionGridMaps({ roots: [P.path], worktrees: { [A]: P.path } }, { roots: [B.path], worktrees: { [C]: P.path } });
  expect(joined).toEqual({ roots: [P.path, B.path], worktrees: { [A]: P.path, [C]: P.path } });
});

// P2-3: a folder inside a project or a worktree belongs to that project's grid.
test("P2-3: a folder inside a worktree or inside the project folder shows in the project's grid; the longest folder wins", () => {
  const nested = "G:\\Dev\\kolux\\apps\\inner";
  setGridRoots(gridRootsOf([P, B], owner), [P.path, B.path]);
  expect(gridOf(`${A}\\src\\shell`)).toBe(P.path);
  expect(gridOf("G:/Dev/kolux/src/")).toBe(P.path);
  expect(gridOf("G:\\Dev\\kolux-other")).toBe("G:\\Dev\\kolux-other"); // a name that only starts the same is not inside it
  setGridRoots(gridRootsOf([P, B], owner), [P.path, B.path, nested]);
  expect(gridOf(`${nested}\\src`)).toBe(nested);
});

// P2-1: a worktree that is removed is no longer where new sessions start.
test("P2-1: forgetting a removed worktree clears a pick that named it (or a folder in it), and leaves other picks", () => {
  setStartDir(P.path, A);
  setStartDir(B.path, B.path);
  forgetStartDirs([A]);
  expect(startDirOf(P.path)).toBe(P.path);
  setStartDir(P.path, `${A}\\sub`);
  forgetStartDirs([A]);
  expect(startDirOf(P.path)).toBe(P.path);
  setStartDir(P.path, C);
  forgetStartDirs([A]);
  expect(startDirOf(P.path)).toBe(C);
});
