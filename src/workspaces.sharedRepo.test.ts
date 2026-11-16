// PROJ 008 / F21 (job 64's F1, the page's side): two Kolux projects on ONE Git repository. A is the main checkout, B a
// linked worktree of it; `git worktree list` from either names every worktree, so each project's list holds the other's
// own folder and every worktree both share. A shared folder goes with a removed project only when it is that project's
// own folder. The removed list goes through `goingFolders` before `goesWith` and `sessionsUnder` are asked.
import { afterEach, describe, expect, test } from "vitest";
import { closesWith, gridOf, goesWith, goingFolders, setGridRoots, withoutDir } from "./workspaces";
import { gridRootsOf, mergeGridMap } from "./projects/worktreeGrid";
import { sessionsUnder } from "./projects/rows";

const A = "C:/r/app";
const B = "C:/r/app-b";
const W = "C:/r/wt3";
const lists: Record<string, string[]> = { A: [A, B, W], B: [B, A, W] };
const own: Record<string, string> = { A, B };
const at = (cwd: string) => ({ cwd, running: true });

/** What removing `gone` (the rest stay) asks about, closes and counts, for terminals in `open`. Asked as `askedOf` in
 *  ProjectsPanel asks; closed as `removedAll` closes, handed the going folders (F88-01: `withoutDir` per going folder). */
function remove(gone: string[], open: string[], all = lists, owner = own) {
  const staying = Object.keys(all).filter((k) => !gone.includes(k)).flatMap((k) => all[k]);
  const going = gone.flatMap((k) => goingFolders(owner[k], all[k], staying));
  const listed = gone.flatMap((k) => all[k]);
  const asked = open.filter((d) => goesWith(d, going, staying) || (goesWith(d, listed, staying) && closesWith({ cwd: d }, going, staying)));
  const panes = open.map((cwd, i) => ({ key: i, cwd }));
  const kept = going.reduce((ps, d) => withoutDir(ps, d, staying), panes);
  const closed = panes.filter((p) => !kept.includes(p)).map((p) => p.cwd);
  return { going, asked, closed, counted: sessionsUnder(going, open.map(at), staying) };
}

describe("goingFolders: two projects on one repository", () => {
  test("g. remove B: B's own folder goes; A's folder and the shared worktree are not counted and not asked about", () => {
    const r = remove(["B"], [A, B, W]);
    expect(r.going).toEqual([B]);
    expect(r.asked).toEqual([B]);
    expect(r.counted).toBe(1);
  });
  test("h. remove A: A's own folder goes; B's folder and the shared worktree stay", () => {
    const r = remove(["A"], [A, B, W]);
    expect(r.going).toEqual([A]);
    expect(r.asked).toEqual([A]);
    expect(r.counted).toBe(1);
  });
  test("i. B's worktree folder lies inside A's folder; remove A: B's folder stays", () => {
    const inB = "C:/r/app/.wt/b";
    const r = remove(["A"], [A, inB, `${inB}/src`, W], { A: [A, inB, W], B: [inB, A, W] }, { A, B: inB });
    expect(r.going).toEqual([A]);
    expect(r.asked).toEqual([A]);
    expect(r.counted).toBe(1);
  });
  test("j. one project alone on its repository with two worktrees: all three folders go, as today", () => {
    const r = remove(["A"], [A, B, W], { A: [A, B, W] }, { A });
    expect(r.going).toEqual([A, B, W]);
    expect(r.asked).toEqual([A, B, W]);
    expect(r.counted).toBe(3);
  });
  test("k. a group delete that removes A and B together: every folder goes", () => {
    const r = remove(["A", "B"], [A, B, W]);
    expect(r.asked).toEqual([A, B, W]);
    expect(r.counted).toBe(3);
  });
  test("l. letter case and slash style differ between the two lists: the same answers", () => {
    const odd = { A: [A, B, W], B: ["c:\\R\\APP-B\\", "C:\\r\\App", "c:/R/WT3/"] };
    const b = remove(["B"], [A, B, W], odd, { A, B: "c:\\R\\APP-B\\" });
    expect(b.asked).toEqual([B]);
    expect(b.counted).toBe(1);
    const a = remove(["A"], [A, B, W], odd, { A: "c:/r/APP/", B });
    expect(a.asked).toEqual([A]);
    expect(a.counted).toBe(1);
  });
});

// R71-02: a project's own folder is shown in its own grid, never in the other project's. The owner map is built as the
// sidebar builds it (`ProjectsPanel`, one entry per scanned worktree, the last project in the list wins).
describe("R71-02: the grid map with two projects on one repository", () => {
  const pa = { id: "A", path: A };
  const pb = { id: "B", path: B };
  const ownerOf = (order: { id: string; path: string }[]) => {
    const owner: Record<string, string> = {};
    for (const p of order) for (const d of lists[p.id]) owner[d] = p.id;
    return owner;
  };
  afterEach(() => setGridRoots({}));

  test.each([
    ["[A, B]", [pa, pb]],
    ["[B, A]", [pb, pa]],
  ])("order %s: each project's own folder maps to its own grid, the shared worktree to one of them", (_, order) => {
    const roots = gridRootsOf(order, ownerOf(order));
    expect(roots[A]).toBeUndefined();
    expect(roots[B]).toBeUndefined();
    expect([A, B]).toContain(roots[W]);
    setGridRoots(roots, order.map((p) => p.path));
    expect(gridOf(A)).toBe(A);
    expect(gridOf(B)).toBe(B);
    expect([A, B]).toContain(gridOf(W));
  });

  test("a map saved before this fix (B's folder under A's grid) still answers each project's own folder as its own grid", () => {
    setGridRoots({ [B]: A, [W]: A }, [A, B]);
    expect(gridOf(B)).toBe(B);
    expect(gridOf(A)).toBe(A);
    expect(gridOf(W)).toBe(A);
  });

  // R74-01 (coordinator): the saved map keeps old entries (mergeGridMap), so an old entry naming one project folder under
  // the other project's grid is still handed in. Both project orders, both directions: the own folder wins and its pane stays.
  test.each([
    ["[A, B], saved B and W under A", [A, B], { [B]: A, [W]: A }, A, B],
    ["[B, A], saved B and W under A", [B, A], { [B]: A, [W]: A }, A, B],
    ["[A, B], saved A and W under B", [A, B], { [A]: B, [W]: B }, B, A],
    ["[B, A], saved A and W under B", [B, A], { [A]: B, [W]: B }, B, A],
  ])("R74-01 %s: the moved folder is its own grid, and removing the other project keeps its pane", (_, folders, saved, gone, kept) => {
    setGridRoots(saved, folders);
    expect(gridOf(kept)).toBe(kept);
    expect(gridOf(gone)).toBe(gone);
    const panes = [{ key: 1, cwd: gone }, { key: 2, cwd: kept }];
    expect(withoutDir(panes, gone, lists[kept === A ? "A" : "B"]).map((p) => p.key)).toEqual([2]);
  });

  test.each([
    ["[A, B]", [pa, pb]],
    ["[B, A]", [pb, pa]],
  ])("order %s: removing A keeps B's pane, removing B keeps A's pane", (_, order) => {
    setGridRoots(gridRootsOf(order, ownerOf(order)), order.map((p) => p.path));
    const panes = [{ key: 1, cwd: A }, { key: 2, cwd: B }];
    expect(withoutDir(panes, A, lists.B).map((p) => p.key)).toEqual([2]);
    expect(withoutDir(panes, B, lists.A).map((p) => p.key)).toEqual([1]);
  });
});

// R83-04: a pane closes when its OWN folder goes. The shared worktree W is listed by the staying project, so its pane is
// kept, not asked about and not counted, whichever grid showed it; after the remove it shows in the staying project's grid.
describe("R83-04: a worktree a staying project also lists stays open", () => {
  const pa = { id: "A", path: A };
  const pb = { id: "B", path: B };
  const ownerOf = (order: { id: string; path: string }[]) => {
    const owner: Record<string, string> = {};
    for (const p of order) for (const d of lists[p.id]) owner[d] = p.id;
    return owner;
  };
  afterEach(() => setGridRoots({}));

  test.each([
    ["[A, B]", "A", [pa, pb]],
    ["[A, B]", "B", [pa, pb]],
    ["[B, A]", "A", [pb, pa]],
    ["[B, A]", "B", [pb, pa]],
  ])("order %s, remove %s: only its own folder closes, is asked about and is counted; W then shows in the other's grid", (_, gone, order) => {
    const prev = mergeGridMap({ roots: [], worktrees: {} }, order, ownerOf(order));
    setGridRoots(prev.worktrees, prev.roots);
    const r = remove([gone], [A, B, W]);
    expect(r.closed).toEqual([own[gone]]);
    expect(r.asked).toEqual([own[gone]]);
    expect(r.counted).toBe(1);
    // the project list read again: the removed project is gone, the old W entry in the saved map is dropped
    const left = order.filter((p) => p.id !== gone);
    const next = mergeGridMap(prev, left, ownerOf(left));
    setGridRoots(next.worktrees, next.roots);
    expect(gridOf(W)).toBe(left[0].path);
  });

  test("j. one project alone on its repository still closes, asks about and counts all three", () => {
    setGridRoots({ [B]: A, [W]: A }, [A]);
    const r = remove(["A"], [A, B, W], { A: [A, B, W] }, { A });
    expect(r.closed).toEqual([A, B, W]);
    expect(r.asked).toEqual([A, B, W]);
    expect(r.counted).toBe(3);
  });

  test("F88-01: a worktree only the removed project lists, under a staying project's folder, closes, is asked about and is counted", () => {
    const P = "C:/x";
    const W9 = "C:/x/wt9";
    setGridRoots({ [W9]: A }, [A, P]);
    const r = remove(["A"], [A, W9, P], { A: [A, W9], P: [P] }, { A, P });
    expect(r.going).toEqual([A, W9]);
    expect(r.closed).toEqual([A, W9]);
    expect(r.asked).toEqual([A, W9]);
    expect(r.counted).toBe(2);
  });

  test("known limit: a pane in W with an explicit view naming the going grid still closes and is counted", () => {
    setGridRoots({ [W]: B }, [A, B]);
    const pane = { key: 1, cwd: W, view: A };
    expect(withoutDir([pane], A, lists.B)).toEqual([]);
    expect(sessionsUnder([A], [pane], lists.B)).toBe(1);
  });
});
