import { afterEach, expect, test } from "vitest";
import { clearStartDirs, gridRootsOf, setStartDir, startDirOf, worktreeColors, worktreeTag } from "./worktreeGrid";
import { gridOf, panesIn, setGridRoots, viewOf } from "../workspaces";
import { TAB_COLORS } from "../terminal/tabColor";

const P = { id: "p1", path: "G:\\Dev\\kolux" };
const B = { id: "p2", path: "G:\\Dev\\Txais Brain" };
const A = "G:\\Dev\\kolux-lanes\\one-ws";
const C = "G:\\Dev\\kolux-lanes\\other";
const OUT = "D:\\elsewhere\\from-outside-kolux";
const owner = { [P.path]: "p1", [A]: "p1", [C]: "p1", [OUT]: "p1", [B.path]: "p2" };

afterEach(() => {
  setGridRoots({});
  clearStartDirs();
});

test("every worktree of a project, outside its folder too, maps to the one project folder; the project itself maps to nothing", () => {
  const roots = gridRootsOf([P, B], owner);
  expect(Object.keys(roots).sort()).toEqual([A, C, OUT].sort());
  expect(Object.values(roots).every((r) => r === P.path)).toBe(true);
});

test("a worktree outside the project folder adds no project, so the sidebar (one row per project) gains no row", () => {
  const projects = [P, B];
  const roots = gridRootsOf(projects, owner);
  expect(roots[OUT]).toBe(P.path);
  expect(projects).toHaveLength(2);
});

test("sessions from two worktrees of one project both show in that project's grid, and the other project's do not", () => {
  setGridRoots(gridRootsOf([P, B], owner));
  const panes = [
    { key: 1, cwd: P.path },
    { key: 2, cwd: A },
    { key: 3, cwd: C },
    { key: 4, cwd: OUT },
    { key: 5, cwd: B.path },
    { key: 6, cwd: "G:\\Dev\\kolux-lanes\\fresh", view: P.path },
  ];
  expect(panesIn(panes, P.path).map((p) => p.key)).toEqual([1, 2, 3, 4, 6]);
  expect(panesIn(panes, A).map((p) => p.key)).toEqual([1, 2, 3, 4, 6]); // asking for a worktree shows the project's grid
  expect(panesIn(panes, B.path).map((p) => p.key)).toEqual([5]);
  expect(gridOf(A.toLowerCase().replace(/\\/g, "/"))).toBe(P.path);
  expect(viewOf({ cwd: OUT })).toBe(P.path);
});

test("no project list known: a folder is its own grid, as before", () => {
  expect(panesIn([{ key: 1, cwd: A }, { key: 2, cwd: P.path }], A).map((p) => p.key)).toEqual([1]);
});

test("each worktree of a project has a different label and colour; the same worktree has the same ones every time", () => {
  const ctx = { projects: [P, B], owner, names: { [A]: "one workspace" } };
  const tags = [P.path, A, C, OUT].map((d) => worktreeTag(d, d === A ? "feat/one-workspace" : d === C ? "integration/wave" : "main", ctx)!);
  expect(new Set(tags.map((t) => t.color)).size).toBe(4);
  expect(tags.map((t) => t.label)).toEqual(["main", "one workspace", "integration/wave", "main"]);
  expect(tags[1].typed).toBe(true);
  expect(tags[0].isMain).toBe(true);
  expect(tags[0].color).toBe(TAB_COLORS.find((c) => c.id === "grey")!.css);
  const again = worktreeTag(A, "feat/one-workspace", ctx)!;
  expect(again.color).toBe(tags[1].color);
  expect(tags[2].tip).toContain("integration/wave");
  expect(tags[2].tip).toContain(C);
});

test("colours are theme tones, one per worktree up to the palette, in any order of asking", () => {
  const all = [A, C, OUT, "X:\\a", "X:\\b", "X:\\c", "X:\\d", "X:\\e"];
  const one = worktreeColors(P.path, [P.path, ...all]);
  const rev = worktreeColors(P.path, [...all].reverse().concat(P.path));
  expect(one).toEqual(rev);
  const tones = new Set(TAB_COLORS.map((c) => c.css));
  expect(Object.values(one).every((c) => tones.has(c))).toBe(true);
  expect(new Set(Object.values(one)).size).toBe(Object.keys(one).length);
});

test("a folder outside any project has no tag", () => {
  expect(worktreeTag("C:\\Users\\x", "main", { projects: [P], owner, names: {} })).toBeNull();
  expect(worktreeTag(null, null, { projects: [P], owner, names: {} })).toBeNull();
});

test("new sessions open in the project's main checkout unless a worktree was picked; picking the main checkout clears it", () => {
  expect(startDirOf(P.path)).toBe(P.path);
  setStartDir(P.path, A);
  expect(startDirOf(P.path)).toBe(A);
  expect(startDirOf(B.path)).toBe(B.path);
  setStartDir(P.path, P.path);
  expect(startDirOf(P.path)).toBe(P.path);
  expect(startDirOf(null)).toBeNull();
});
