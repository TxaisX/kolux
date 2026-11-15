import { describe, expect, it } from "vitest";
import { filterSessions, groupSessions, projectOf, type Session } from "./model";
import { setGridRoots } from "../workspaces";

// F26: a worktree in the default workspaces folder sits outside its project's folder. The grid knows it belongs to
// the project (setGridRoots, the same map `gridOf`/`viewOf` read); the session list should file it there too.
const PROJECT = "C:/w/app";
const TREE = "C:/Users/me/.kolux/workspaces/app/feat";
const projects = [{ path: PROJECT }, { path: "C:/w/other" }];
const s = (id: string, dir: string, modifiedMs: number): Session => ({ agent: "claude", id, title: id, modifiedMs, bytes: 1, turns: 1, dir });

describe("projectOf with worktrees outside the project folder (F26)", () => {
  setGridRoots({ [TREE]: PROJECT }, [PROJECT, "C:/w/other"]);

  it("resolves the worktree, and a folder inside it, to the project", () => {
    expect(projectOf(TREE, projects)).toBe("c:/w/app");
    expect(projectOf(`${TREE}/src`, projects)).toBe("c:/w/app");
  });

  it("keeps the old answers for folders inside a project and for unknown folders", () => {
    expect(projectOf("C:/w/app/sub", projects)).toBe("c:/w/app");
    expect(projectOf("D:/loose", projects)).toBe("d:/loose");
    expect(projectOf(null, projects)).toBeNull();
  });

  it("Group by project puts the worktree session under its project", () => {
    const groups = groupSessions([s("a", PROJECT, 2), s("b", TREE, 1)], "project", projects);
    expect(groups.map((g) => [g.key, g.sessions.map((x) => x.id)])).toEqual([["c:/w/app", ["a", "b"]]]);
  });

  it("a repo: search finds the worktree session", () => {
    expect(filterSessions([s("b", TREE, 1)], { query: "repo:app", hiddenAgents: [], hideEmpty: false }, projects).map((x) => x.id)).toEqual(["b"]);
  });
});
