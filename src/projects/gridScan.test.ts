import { beforeEach, expect, test, vi } from "vitest";

const calls: string[] = [];
let answers: Record<string, unknown> = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: { projectId?: string }) => {
    calls.push(args?.projectId ? `${cmd}:${args.projectId}` : cmd);
    if (cmd === "project_list") return [{ id: "p1", name: "kolux", path: "G:\\Dev\\kolux" }, { id: "p2", name: "brain", path: "G:\\Dev\\Txais Brain" }];
    const a = answers[args?.projectId ?? ""];
    if (a instanceof Error) throw a;
    return a;
  },
}));

import { scanGridOwners } from "./gridScan";
import { EMPTY_GRID_MAP, mergeGridMap } from "./worktreeGrid";

const wt = (path: string, isMain = false) => ({ path, branch: "b", head: "h", isMain });

beforeEach(() => {
  calls.length = 0;
  answers = {};
});

test("P1-2: the start scan finds each project's worktrees (listed and unseen) with no sidebar involved", async () => {
  answers = {
    p1: { list: [wt("G:\\Dev\\kolux", true), wt("G:\\Dev\\kolux-lanes\\one-ws")], unseen: [wt("D:\\out\\side")] },
    p2: { list: [wt("G:\\Dev\\Txais Brain", true)], unseen: [] },
  };
  const { projects, owner } = await scanGridOwners();
  expect(projects.map((p) => p.id)).toEqual(["p1", "p2"]);
  const map = mergeGridMap(EMPTY_GRID_MAP, projects, owner);
  expect(map.worktrees["G:\\Dev\\kolux-lanes\\one-ws"]).toBe("G:\\Dev\\kolux");
  expect(map.worktrees["D:\\out\\side"]).toBe("G:\\Dev\\kolux");
  expect(map.worktrees["G:\\Dev\\kolux"]).toBeUndefined(); // a project's own folder is its grid, not a worktree of it
  expect(map.roots).toEqual(["G:\\Dev\\kolux", "G:\\Dev\\Txais Brain"]);
});

test("P1-2: a project whose scan fails adds nothing and stops nothing; the others still answer", async () => {
  answers = { p1: new Error("git not found"), p2: { list: [wt("G:\\Dev\\Txais Brain", true), wt("G:\\Dev\\brain-wt")], unseen: [] } };
  const { projects, owner } = await scanGridOwners();
  expect(calls).toEqual(expect.arrayContaining(["workspace_scan:p1", "workspace_scan:p2"]));
  expect(Object.values(owner)).not.toContain("p1");
  const known = mergeGridMap({ roots: ["G:\\Dev\\kolux", "G:\\Dev\\Txais Brain"], worktrees: { "G:\\Dev\\kolux-lanes\\one-ws": "G:\\Dev\\kolux" } }, projects, owner);
  expect(known.worktrees["G:\\Dev\\kolux-lanes\\one-ws"]).toBe("G:\\Dev\\kolux"); // what was known about p1 stays through its failed scan
  expect(known.worktrees["G:\\Dev\\brain-wt"]).toBe("G:\\Dev\\Txais Brain");
});
