import { afterEach, expect, test } from "vitest";
import { setGridRoots } from "../workspaces";
import { addTeamFolders, groupRows, hiddenTeamFolders, jumpUnhides, mergedTeamFolders, movedTeamFolders, paneState, prunedTeamFolders, sessionsUnder, smartOrder, sortFromSetting, strongest, TEAM_WORKTREES_SETTING, teamFoldersOf, teamViewOf, withoutAutomationMade, withoutTeamMade, type RowInfo } from "./rows";

const at = (state: RowInfo["state"], changed: number, pr: RowInfo["pr"] = null): RowInfo => ({ state, changed, pr });

test("a row shows the strongest live state among its panes, a permission request first (PROJ-063)", () => {
  expect(strongest(["working", "permission", "done"])).toBe("permission");
  expect(strongest(["done", "working"])).toBe("working");
  expect(strongest(["idle", "done"])).toBe("done");
  expect(strongest([])).toBe("idle");
  expect(paneState("shell", true)).toBe("idle");
  expect(paneState("claude", undefined)).toBe("working");
  expect(paneState("claude", false)).toBe("done");
});

test("smart sort: needs-you first, then done, working, idle; newest change on top within a class (PROJ-050)", () => {
  const rows = { done: at("done", 900), blocked: at("blocked", 100), working: at("working", 950), idle: at("idle", 999), waiting: at("waiting", 50), interrupted: at("interrupted", 10) };
  const order = smartOrder(Object.keys(rows), (k) => rows[k as keyof typeof rows]);
  expect(order).toEqual(["blocked", "waiting", "interrupted", "done", "working", "idle"]);
  // an interrupted agent is never among the done ones, whatever changed last
  expect(order.indexOf("interrupted")).toBeLessThan(order.indexOf("done"));
});

test("grouping: a merged pull request is done, a suppressed one in progress, queued stands alone (PROJ-045)", () => {
  const rows = { a: at("working", 1, "merged"), b: at("working", 2, "suppressed"), c: at("queued", 3, null), d: at("permission", 4, "open"), e: at("idle", 5, "closed") };
  const info = (k: string) => rows[k as keyof typeof rows];
  expect(groupRows(Object.keys(rows), "pr", info, () => "").map((g) => [g.title, g.rows])).toEqual([
    ["In progress", ["b", "d"]],
    ["Done", ["a"]],
    ["Closed", ["e"]],
    ["No pull request", ["c"]],
  ]);
  expect(groupRows(Object.keys(rows), "status", info, () => "").map((g) => [g.title, g.rows])).toEqual([
    ["Needs you", ["d"]],
    ["Working", ["a", "b"]],
    ["Queued", ["c"]],
    ["Idle", ["e"]],
  ]);
  expect(groupRows(["a", "b"], "project", info, (k) => (k === "a" ? "app" : "web")).map((g) => g.title)).toEqual(["app", "web"]);
  expect(groupRows(["a", "b"], "none", info, () => "x")).toEqual([{ title: "", rows: ["a", "b"] }]);
});

test("the sort setting: Smart by default, and an old Recent choice is moved over to Smart", () => {
  expect(sortFromSetting(undefined)).toBe("smart");
  expect(sortFromSetting("recent")).toBe("smart");
  expect(sortFromSetting("name")).toBe("name");
  expect(sortFromSetting("bogus")).toBe("smart");
});

test("AUTO-024: the switch hides worktrees made by automations, and jumping to one turns it off", () => {
  const run = { path: "C:/r/wts/otter", madeBy: "automation" };
  const hand = { path: "C:/r/wts/lead", madeBy: "app" };
  const lists = { p1: [run, hand, { path: "C:/r", madeBy: null }] };
  expect(withoutAutomationMade(lists, true).p1.map((w) => w.path)).toEqual(["C:/r/wts/lead", "C:/r"]);
  expect(withoutAutomationMade(lists, false)).toBe(lists);
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  // Moving to a hidden run worktree turns the switch off; staying on it, or the switch off, does nothing.
  expect(jumpUnhides("C:/r/wts/lead", "c:/R/wts/otter", lists, true, same)).toBe(true);
  expect(jumpUnhides("C:/r/wts/otter", "C:/r/wts/otter", lists, true, same)).toBe(false);
  expect(jumpUnhides("C:/r/wts/lead", "C:/r/wts/otter", lists, false, same)).toBe(false);
  expect(jumpUnhides("C:/r/wts/otter", "C:/r/wts/lead", lists, true, same)).toBe(false);
  expect(jumpUnhides(null, null, lists, true, same)).toBe(false);
});

test("DT-C274: the worktrees a team launch made are left out of the sidebar; the main checkout and hand-made ones stay", () => {
  const lists = {
    p1: [{ path: "C:/r", isMain: true }, { path: "C:/r/wts/one" }, { path: "C:/r/wts/two" }, { path: "C:/r/wts/mine" }],
    p2: [{ path: "D:/q", isMain: true }],
  };
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const team = addTeamFolders(undefined, [{ path: "C:/R/wts/one", view: "C:/r" }, { path: "C:/r/wts/two", view: "C:/r" }, { path: "C:/r/wts/two", view: "C:/r" }]);
  expect(team).toEqual([{ path: "C:/R/wts/one", view: "C:/r" }, { path: "C:/r/wts/two", view: "C:/r" }]); // each once
  // a path already there takes the new grid; a new one is put at the end
  expect(addTeamFolders(team, [{ path: "C:/r/wts/two", view: "C:/x" }, { path: "C:/r/wts/three", view: "C:/r" }])).toEqual([
    { path: "C:/R/wts/one", view: "C:/r" },
    { path: "C:/r/wts/two", view: "C:/x" },
    { path: "C:/r/wts/three", view: "C:/r" },
  ]);
  const paths = teamFoldersOf(team).map((t) => t.path);
  const shown = withoutTeamMade(lists, paths, same);
  expect(shown.p1.map((w) => w.path)).toEqual(["C:/r", "C:/r/wts/mine"]);
  expect(shown.p2).toEqual(lists.p2);
  // a main checkout is never hidden, even if its path was recorded
  expect(withoutTeamMade(lists, ["C:/r"], same).p1.map((w) => w.path)).toEqual(["C:/r", "C:/r/wts/one", "C:/r/wts/two", "C:/r/wts/mine"]);
  // nothing recorded, or a damaged setting: the lists are untouched
  expect(withoutTeamMade(lists, teamFoldersOf(undefined).map((t) => t.path), same)).toBe(lists);
  expect(teamFoldersOf("C:/r/wts/one")).toEqual([]);
  expect(teamFoldersOf([{ path: "C:/r/wts/one", view: "C:/r" }, 3, null, { view: "C:/r" }])).toEqual([{ path: "C:/r/wts/one", view: "C:/r" }]);
});

test("DT-C274: an older record of bare paths still hides its worktrees but maps to no grid", () => {
  const old = ["C:/r/wts/one", { path: "C:/r/wts/two", view: "C:/r" }];
  expect(teamFoldersOf(old)).toEqual([{ path: "C:/r/wts/one", view: null }, { path: "C:/r/wts/two", view: "C:/r" }]);
  expect(teamViewOf({ [TEAM_WORKTREES_SETTING]: old }, "c:\\R\\wts\\two")).toBe("C:/r");
  expect(teamViewOf({ [TEAM_WORKTREES_SETTING]: old }, "C:/r/wts/one")).toBeUndefined();
  expect(teamViewOf({ [TEAM_WORKTREES_SETTING]: old }, "C:/r/wts/mine")).toBeUndefined();
  expect(teamViewOf({}, "C:/r/wts/two")).toBeUndefined();
  expect(teamViewOf({ [TEAM_WORKTREES_SETTING]: old }, null)).toBeUndefined();
  // a bare path is written back as a bare path when the record is rewritten
  expect(addTeamFolders(old, [{ path: "C:/r/wts/three", view: "C:/r" }])).toEqual([...old, { path: "C:/r/wts/three", view: "C:/r" }]);
});

test("DT-C274 (Row 794-c): the record on disk is kept under the window's latest one", () => {
  const disk = [{ path: "C:/r/wts/other", view: "C:/r" }, { path: "C:/r/wts/one", view: "C:/old" }];
  const latest = [{ path: "C:/r/wts/one", view: "C:/r" }];
  expect(mergedTeamFolders(disk, latest)).toEqual([{ path: "C:/r/wts/other", view: "C:/r" }, { path: "C:/r/wts/one", view: "C:/r" }]);
  expect(mergedTeamFolders(null, latest)).toEqual(latest);
  expect(mergedTeamFolders(disk, undefined)).toEqual(disk);
});

test("DT-C274: a moved folder takes its records along, as the worktree and as the grid", () => {
  const rec = [{ path: "C:/r/wts/one", view: "C:/r" }, "C:/r/wts/two", { path: "D:/q/wts/x", view: "D:/q" }];
  expect(movedTeamFolders(rec, "C:/r/wts/one", "C:/r/wts/uno")).toEqual([{ path: "C:/r/wts/uno", view: "C:/r" }, "C:/r/wts/two", { path: "D:/q/wts/x", view: "D:/q" }]);
  expect(movedTeamFolders(rec, "C:/r", "C:/s")).toEqual([{ path: "C:/r/wts/one", view: "C:/s" }, "C:/r/wts/two", { path: "D:/q/wts/x", view: "D:/q" }]);
  expect(movedTeamFolders(rec, "C:/r/wts/two", "C:/r/wts/dos")).toEqual([{ path: "C:/r/wts/one", view: "C:/r" }, "C:/r/wts/dos", { path: "D:/q/wts/x", view: "D:/q" }]);
  expect(movedTeamFolders(rec, "E:/none", "E:/else")).toBeNull(); // nothing named: nothing written
});

test("DT-C274: worktrees no longer listed leave the record; one recorded while the scan ran stays", () => {
  const rec = [{ path: "C:/r/wts/one", view: "C:/r" }, { path: "C:/r/wts/two", view: "C:/r" }];
  expect(prunedTeamFolders(rec, ["C:/r", "C:/r/wts/one", "C:/r/wts/two"])).toBeNull(); // all listed: nothing written
  expect(prunedTeamFolders(rec, ["C:/r", "C:/R/wts/one"])).toEqual([{ path: "C:/r/wts/one", view: "C:/r" }]);
  // "two" was made after the scan began: it is not in this scan, but stays
  expect(prunedTeamFolders(rec, ["C:/r", "C:/r/wts/one"], [{ path: "C:/r/wts/one", view: "C:/r" }])).toBeNull();
  expect(prunedTeamFolders(undefined, [])).toBeNull();
});

test("DT-C274: a team worktree is shown in the sidebar again when its grid is empty and nothing runs in it", () => {
  const rec = [{ path: "C:/r/wts/one", view: "C:/r" }, { path: "C:/r/wts/two", view: "C:/r" }, "C:/q/wts/old"];
  // the grid has panes: all stay hidden (a bare path has no grid; it stays hidden while something runs in it)
  expect(hiddenTeamFolders(rec, ["C:/r", "C:/q/wts/old"])).toEqual(["C:/r/wts/one", "C:/r/wts/two", "C:/q/wts/old"]);
  // the grid is closed but a pane still runs in "two" (moved elsewhere): only "two" stays hidden
  expect(hiddenTeamFolders(rec, ["C:/r/wts/two"])).toEqual(["C:/r/wts/two"]);
  // nothing open: every one is stranded and shown again
  expect(hiddenTeamFolders(rec, [])).toEqual([]);
});

test("DT-C274 (TERM-045): a session counts under a folder when it runs there or is shown in its grid, once", () => {
  const sessions = [
    { cwd: "C:/r/wts/one", view: "C:/r" }, // a team agent: runs in its worktree, shown in C:/r
    { cwd: "C:/r", view: undefined },
    { cwd: "C:/r/wts/two", view: "C:/r/wts/two" },
    { cwd: "D:/q", view: null },
    { cwd: null },
  ];
  expect(sessionsUnder(["C:/r"], sessions)).toBe(3); // "one" counted once, though both its folders are under C:/r
  expect(sessionsUnder(["C:/r/wts/one"], sessions)).toBe(1);
  expect(sessionsUnder(["D:/q"], sessions)).toBe(1);
  expect(sessionsUnder(["E:/none"], sessions)).toBe(0);
  // the old count by cwd alone missed the team agent shown in C:/s
  expect(sessionsUnder(["C:/s"], [{ cwd: "C:/r/wts/one", view: "C:/s" }])).toBe(1);
});

test("PROJ 008 / F21: a session of a nested project that stays is not counted; with no staying list the count is as before", () => {
  const sessions = [
    { cwd: "C:/r" }, // the removed project's own
    { cwd: "C:/r/wts/one", view: "C:/r" }, // its team agent
    { cwd: "C:/r/inner/src" }, // a nested project that stays
    { cwd: "C:/r/wts/inner-b", view: "C:/r/inner" }, // that project's worktree inside C:/r, shown in its grid
    { cwd: "D:/q/wts/r-two" }, // a worktree of the removed project inside a staying folder
  ];
  const staying = ["c:\\R\\Inner", "C:/r/wts/inner-b", "D:/q"];
  expect(sessionsUnder(["C:/r", "D:/q/wts/r-two"], sessions)).toBe(5);
  expect(sessionsUnder(["C:/r", "D:/q/wts/r-two"], sessions, [])).toBe(5);
  expect(sessionsUnder(["C:/r", "D:/q/wts/r-two"], sessions, staying)).toBe(3);
  expect(sessionsUnder(["C:/r"], sessions, ["C:/r"]), "a tie counts").toBe(4);
});

// R74-02: two projects on one repository (A main checkout, B a linked worktree of it); the shared worktree W shows in
// one project's grid. A session in W with no view closes with the project whose grid shows it, so that removal counts it.
afterEach(() => setGridRoots({}));
test.each([
  ["W shows in A's grid", "C:/w/app", 1],
  ["W shows in B's grid", "C:/w/app-b", 0],
])("R74-02 %s: removing A counts a session in W only when A's grid shows it", (_name, grid, count) => {
  const [A, B, W] = ["C:/w/app", "C:/w/app-b", "C:/w/wt3"];
  setGridRoots({ [W]: grid }, [A, B]);
  expect(sessionsUnder([A], [{ cwd: W }], [B, A, W])).toBe(count);
  expect(sessionsUnder([A], [{ cwd: A }, { cwd: B }], [B, A, W]), "the projects' own sessions as before").toBe(1);
});

// DT-C274: a command-line file of a team worktree opens once its team's grid is shown (select() shows that grid).
test("cliFileShown: a team worktree's file is ready in its team's grid or in the worktree itself", async () => {
  const { cliFileShown, selectView } = await import("./rows");
  const settings = { teamWorktrees: [{ path: "C:\\r\\wts\\wt1", view: "C:\\r" }] };
  expect(cliFileShown(settings, "C:\\r\\wts\\wt1", "C:\\r")).toBe(true);
  expect(cliFileShown(settings, "C:\\r\\wts\\wt1", "C:\\r\\wts\\wt1")).toBe(true);
  expect(cliFileShown(settings, "C:\\r\\wts\\wt1", "C:\\other")).toBe(false);
  expect(cliFileShown({}, "C:\\r\\wts\\wt1", "C:\\r")).toBe(false);
  // selectView: the team's grid while it has panes; none once it is empty (a stranded worktree)
  expect(selectView(settings, [{ key: 1, cwd: "C:\\r\\wts\\wt1", view: "C:\\r" }], "C:\\r\\wts\\wt1")).toBe("C:\\r");
  expect(selectView(settings, [], "C:\\r\\wts\\wt1")).toBeUndefined();
});
