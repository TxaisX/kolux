import { afterEach, expect, test } from "vitest";
import { chatResumeBlock, OTHER_WORKSPACE } from "./chatResume";
import { setGridRoots } from "../workspaces";

const ROOT = "G:\\Dev\\kolux";
const WT = "G:\\Dev\\kolux-lanes\\one-ws";
const claude = (dir: string | null) => ({ agent: "claude", dir, turns: 3 });

afterEach(() => setGridRoots({}));

// P2-A: the window shows one grid per project (activeDir is the project folder), so a Claude session that ran in one of
// the project's worktrees belongs to that workspace; it used to be refused as "another workspace".
test("P2-A: a Claude session of a linked worktree resumes as chat in its project's workspace", () => {
  setGridRoots({ [WT]: ROOT }, [ROOT]);
  expect(chatResumeBlock(claude(WT), ROOT)).toBeNull();
  expect(chatResumeBlock(claude(`${WT}\\src`), ROOT)).toBeNull(); // a folder inside the worktree
  expect(chatResumeBlock(claude(ROOT), ROOT)).toBeNull();
  expect(chatResumeBlock(claude("G:\\Dev\\other"), ROOT)).toBe(OTHER_WORKSPACE);
  expect(chatResumeBlock(claude(null), ROOT)).toBe(OTHER_WORKSPACE);
});

test("P2-A: a worktree no project owns is still another workspace", () => {
  expect(chatResumeBlock(claude(WT), ROOT)).toBe(OTHER_WORKSPACE);
});
