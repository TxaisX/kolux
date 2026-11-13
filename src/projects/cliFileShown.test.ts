import { afterEach, expect, test } from "vitest";
import { cliFileShown } from "./rows";
import { gridRootsOf } from "./worktreeGrid";
import { gridOf, setGridRoots } from "../workspaces";

const P = { id: "p1", path: "G:\\Dev\\kolux" };
const W = "G:\\Dev\\kolux-lanes\\one-ws";
const owner = { [P.path]: "p1", [W]: "p1" };

afterEach(() => setGridRoots({}));

// P1-A: `kolux file open/diff` for a linked worktree. The window shows the project's one grid (activeDir is the project
// folder), so the file must count as shown there or its queue entry never becomes ready and the command line waits forever.
test("P1-A: a linked worktree's file is ready once its project's grid is in front", () => {
  setGridRoots(gridRootsOf([P], owner), [P.path]);
  expect(gridOf(W)).toBe(P.path);
  expect(cliFileShown({}, W, P.path)).toBe(true); // activeDir = the project folder
  expect(cliFileShown({}, `${W}\\`, "g:/dev/kolux")).toBe(true); // whichever way the folder is written
  expect(cliFileShown({}, W, W)).toBe(true);
  expect(cliFileShown({}, W, "G:\\Dev\\other")).toBe(false); // another project in front: select() brings this one up first
  expect(cliFileShown({}, W, null)).toBe(false);
});

test("P1-A: before the worktree is known to any project it is ready only as itself", () => {
  expect(cliFileShown({}, W, P.path)).toBe(false);
  expect(cliFileShown({}, W, W)).toBe(true);
});
