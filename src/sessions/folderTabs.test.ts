import { expect, test } from "vitest";
import type { Worktree } from "../projects/model";
import { FOLDER_TABS, GIT_TABS, isFolderWorkspace, offeredTabs, readFolderTabs, rememberTab, tabFor } from "./folderTabs";

const wt = (over: Partial<Worktree>): Worktree => ({ path: "C:/w/app", branch: "main", head: "abc123", isMain: true, ...over });
const folder = wt({ path: "C:/notes", branch: null, head: "" });

test("VIEW-057: a project without Git is a folder workspace, a repository's main folder and a detached head are not", () => {
  expect(isFolderWorkspace("c:\\notes\\", [folder])).toBe(true);
  expect(isFolderWorkspace("C:/w/app", [wt({})])).toBe(false);
  expect(isFolderWorkspace("C:/w/app", [wt({ branch: null, head: "abc123" })])).toBe(false);
  expect(isFolderWorkspace("C:/w/app", [wt({ branch: null, head: "", isMain: false })])).toBe(false);
  expect(isFolderWorkspace("C:/elsewhere", [folder])).toBe(false);
  expect(isFolderWorkspace(null, [folder])).toBe(false);
});

test("VIEW-057: a folder workspace hides the git tabs and shows Attached worktrees and PR Checks", () => {
  expect(offeredTabs(true)).toEqual(FOLDER_TABS);
  expect(FOLDER_TABS).not.toContain("scm" as never); // T-644: Source Control left the layout
  expect(FOLDER_TABS).not.toContain("checks");
  expect(FOLDER_TABS).toEqual(expect.arrayContaining(["attached", "prchecks", "explorer", "agents", "insights"]));
  expect(offeredTabs(false)).toEqual(GIT_TABS);
  expect(GIT_TABS).toEqual(["explorer", "insights", "checks", "agents"]);
  expect(offeredTabs(true)).toContain("insights"); // T-646: Insights is app-wide, so a folder workspace offers it too
});

test("VIEW-057: a remembered tab that is not offered here gives the first one offered", () => {
  expect(tabFor({}, "C:/notes", "checks", FOLDER_TABS)).toBe("explorer");
  expect(tabFor({}, "C:/notes", "agents", FOLDER_TABS)).toBe("agents");
  expect(tabFor({}, "C:/w/app", "attached", GIT_TABS)).toBe("explorer");
  expect(tabFor({}, "C:/w/app", "checks", GIT_TABS)).toBe("checks");
});

test("VIEW-057: a folder workspace's remembered PR Checks wins over the window's tab, and only there", () => {
  const saved = { "C:/notes": "prchecks" };
  expect(tabFor(saved, "c:\\notes", "explorer", FOLDER_TABS)).toBe("prchecks");
  expect(tabFor(saved, "C:/notes", "agents", FOLDER_TABS)).toBe("prchecks");
  expect(tabFor(saved, "C:/other", "explorer", FOLDER_TABS)).toBe("explorer");
  expect(tabFor(saved, "C:/notes", "explorer", GIT_TABS)).toBe("explorer");
});

test("VIEW-057: choosing PR Checks is remembered for that folder, choosing another tab forgets it, bad saved values read as none", () => {
  const one = rememberTab({}, "C:/notes", "prchecks");
  expect(one).toEqual({ "c:\\notes": "prchecks" });
  expect(tabFor(one, "C:/notes", "explorer", FOLDER_TABS)).toBe("prchecks");
  expect(rememberTab(one, "C:/Notes/", "agents")).toEqual({});
  expect(rememberTab(one, "C:/two", "prchecks")).toEqual({ "c:\\notes": "prchecks", "c:\\two": "prchecks" });
  expect(readFolderTabs(null)).toEqual({});
  expect(readFolderTabs(["x"])).toEqual({});
  expect(readFolderTabs({ "C:/a": "insights", " ": "prchecks", "C:/b": 3 })).toEqual({});
});
