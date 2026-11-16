// PROJ-066: each workspace keeps its own panes; switching shows one set and hides the rest;
// removing a workspace drops every pane inside it.
import { expect, test } from "vitest";
import { activeAfterRemove, focusIn, goesWith, nameOf, panesIn, sameDir, underDir, viewOf, withoutDir } from "./workspaces";

const panes = [
  { key: 1, cwd: null },
  { key: 2, cwd: "C:\\repo\\ws\\alpha" },
  { key: 3, cwd: "C:/repo/ws/alpha/" },
  { key: 4, cwd: "C:\\repo\\ws\\beta" },
  { key: 5, cwd: "C:\\repo" },
];

test("folders compare by content, not by slash style, case or trailing slash", () => {
  expect(sameDir("C:\\Repo\\WS\\alpha", "c:/repo/ws/alpha/")).toBe(true);
  expect(sameDir("C:\\repo\\ws\\alpha", "C:\\repo\\ws\\alphabet")).toBe(false);
  expect(sameDir(null, null)).toBe(true);
  expect(sameDir(null, "C:\\repo")).toBe(false);
  expect(underDir("C:\\repo\\ws\\alpha\\src", "C:\\repo\\ws\\alpha")).toBe(true);
  expect(underDir("C:\\repo\\ws\\alphabet", "C:\\repo\\ws\\alpha")).toBe(false);
  expect(underDir(null, "C:\\repo")).toBe(false);
});

test("switching shows one workspace's panes and keeps the others for later", () => {
  expect(panesIn(panes, "C:\\repo\\ws\\alpha").map((p) => p.key)).toEqual([2, 3]);
  expect(panesIn(panes, "C:\\repo\\ws\\beta").map((p) => p.key)).toEqual([4]);
  expect(panesIn(panes, "C:\\repo").map((p) => p.key)).toEqual([5]);
  expect(panesIn(panes, null).map((p) => p.key)).toEqual([1]);
  expect(panesIn(panes, "C:\\nowhere")).toEqual([]);
  // The list itself is untouched: every pane is still there to come back to.
  expect(panes.length).toBe(5);
});

test("focus stays on a shown pane, else lands on the first one shown", () => {
  expect(focusIn(panes, "C:\\repo\\ws\\alpha", 3)).toBe(3);
  expect(focusIn(panes, "C:\\repo\\ws\\alpha", 4)).toBe(2);
  expect(focusIn(panes, "C:\\nowhere", 4)).toBe(4);
});

test("removing a workspace drops every pane in it and nothing else; the view falls back to home", () => {
  const left = withoutDir(panes, "C:\\repo\\ws\\alpha");
  expect(left.map((p) => p.key)).toEqual([1, 4, 5]);
  // The main checkout is not "under" a worktree folder and a worktree is not removed with main here.
  expect(withoutDir(panes, "C:\\repo\\ws\\beta").map((p) => p.key)).toEqual([1, 2, 3, 5]);
  expect(activeAfterRemove("C:/repo/ws/alpha", "C:\\repo\\ws\\alpha")).toBeNull();
  expect(activeAfterRemove("C:\\repo\\ws\\beta", "C:\\repo\\ws\\alpha")).toBe("C:\\repo\\ws\\beta");
  expect(activeAfterRemove(null, "C:\\repo\\ws\\alpha")).toBeNull();
});

test("removing the shown workspace moves to the most recently used sibling in its project", () => {
  const recent = ["C:/repo/ws/alpha", "D:/other/x", "C:/repo/ws/gamma", "C:/repo/ws/beta"];
  const siblings = ["C:/repo", "C:/repo/ws/beta", "C:/repo/ws/gamma"];
  expect(activeAfterRemove("C:/repo/ws/alpha", "C:/repo/ws/alpha", recent, siblings)).toBe("C:/repo/ws/gamma");
  // a user who went elsewhere meanwhile stays there
  expect(activeAfterRemove("D:/other/x", "C:/repo/ws/alpha", recent, siblings)).toBe("D:/other/x");
  // no sibling used yet: the home group
  expect(activeAfterRemove("C:/repo/ws/alpha", "C:/repo/ws/alpha", ["C:/repo/ws/alpha"], siblings)).toBeNull();
});

test("a pane's header takes the typed workspace name of its folder, whatever the slash or case (T-013-fix-b)", () => {
  const names = { "C:\\ws\\app\\ship-it": "Ship it \u{1F9D1}\u{200D}\u{1F4BB}" };
  expect(nameOf(names, "c:/ws/app/ship-it/")).toBe("Ship it \u{1F9D1}\u{200D}\u{1F4BB}");
  expect(nameOf(names, "C:\\ws\\app\\other")).toBeUndefined();
  expect(nameOf(names, null)).toBeUndefined();
});

// USAGE-017: usage is credited to the worktree that really contains it: a path that only looks
// alike, one that climbs out with "..", and another drive get no credit; "." and ".." inside the
// worktree still count.
test("a path that climbs out of a folder is not inside it", () => {
  expect(underDir("C:/repo/ws/alpha/../beta", "C:/repo/ws/alpha")).toBe(false);
  expect(underDir("C:/repo/ws/alpha/src/.././lib", "C:/repo/ws/alpha/")).toBe(true);
  expect(underDir("D:/repo/ws/alpha", "C:/repo/ws/alpha")).toBe(false);
  expect(underDir("C:/repo/ws/alpha-2", "C:/repo/ws/alpha")).toBe(false);
});
test("DT-C274: a pane shown in another folder's grid is in that grid, not in its own folder's", () => {
  const team = [
    { key: 1, cwd: "C:/r" },
    { key: 2, cwd: "C:/r/wts/one", view: "C:/r" },
    { key: 3, cwd: "C:/r/wts/two", view: "c:/R/" },
    { key: 4, cwd: "C:/r/wts/one" },
    { key: 5, cwd: "C:/r/wts/two", view: null },
  ];
  expect(viewOf(team[0])).toBe("C:/r");
  expect(viewOf(team[1])).toBe("C:/r");
  expect(viewOf(team[4])).toBeNull(); // an explicit null view is the Home grid, not the pane's cwd
  expect(panesIn(team, "C:/r").map((p) => p.key)).toEqual([1, 2, 3]);
  expect(panesIn(team, "C:/r/wts/one").map((p) => p.key)).toEqual([4]);
  expect(panesIn(team, null).map((p) => p.key)).toEqual([5]);
  // the focus stays inside the grid shown: a team pane focused in the team's grid keeps it, one shown elsewhere does not
  expect(focusIn(team, "C:/r", 3)).toBe(3);
  expect(focusIn(team, "C:/r", 4)).toBe(1);
  expect(focusIn(team, "C:/r/wts/one", 2)).toBe(4);
});

test("DT-C274: removing a folder closes the panes running in it and the panes shown in its grid", () => {
  const team = [
    { key: 1, cwd: "C:/r" },
    { key: 2, cwd: "C:/r/wts/one", view: "C:/r" },
    { key: 3, cwd: "C:/other" },
  ];
  expect(withoutDir(team, "C:/r/wts/one").map((p) => p.key)).toEqual([1, 3]); // its worktree removed
  expect(withoutDir(team, "C:/r").map((p) => p.key)).toEqual([3]); // the folder its grid is in removed
});

// PROJ 008 / F21 (job 65): a folder belongs to the deepest removed or staying folder that holds it; it goes only with a removed owner.
test("goesWith: the deepest listed folder owns a folder; a nested project that stays keeps its own", () => {
  const A = "C:/x/a"; // the project being removed
  const B = "C:/x/a/inner"; // a project inside it that stays
  // a. a folder in A goes, a folder in B stays
  expect(goesWith("C:/x/a/src", [A], [B])).toBe(true);
  expect(goesWith("C:/x/a/inner/src", [A], [B])).toBe(false);
  expect(goesWith(B, [A], [B])).toBe(false);
  // b. a worktree of staying B that lies inside A stays
  expect(goesWith("C:/x/a/wts/b-one/src", [A], [B, "C:/x/a/wts/b-one"])).toBe(false);
  // c. a worktree of removed A that lies inside staying B's folder goes
  expect(goesWith("C:/x/b/wts/a-one", [A, "C:/x/b/wts/a-one"], ["C:/x/b"])).toBe(true);
  expect(goesWith("C:/x/b/src", [A, "C:/x/b/wts/a-one"], ["C:/x/b"])).toBe(false);
  // d. a tie: the same folder removed and staying goes
  expect(goesWith("C:/x/a/src", [A], [A])).toBe(true);
  // a staying folder above the removed one spares nothing inside it
  expect(goesWith("C:/x/a/src", [A], ["C:/x"])).toBe(true);
  expect(goesWith("C:/x/other", [A], ["C:/x"])).toBe(false);
  // f. letter case and slash style do not matter, and C:\x\ab is not inside C:\x\a
  expect(goesWith("c:\\X\\A\\Inner\\src\\", ["C:/x/a/"], ["c:\\x\\A\\INNER"])).toBe(false);
  expect(goesWith("C:\\X\\A\\SRC", ["c:/x/a"], ["C:/X/A/INNER"])).toBe(true);
  expect(goesWith("C:/x/ab", [A], [])).toBe(false);
  expect(goesWith(null, [A], [B])).toBe(false);
});

test("goesWith: with no staying folders it is underDir against the removed folders", () => {
  const removed = ["C:/x/a", "D:\\q"];
  for (const d of ["C:/x/a", "c:\\x\\a\\inner","C:/x/ab", "D:/q/z", "D:/", "E:/x/a", "C:/x/a/../b", "C:/x/a/./c"]) {
    expect(goesWith(d, removed)).toBe(removed.some((r) => underDir(d, r)));
    expect(goesWith(d, removed, [])).toBe(removed.some((r) => underDir(d, r)));
  }
});
