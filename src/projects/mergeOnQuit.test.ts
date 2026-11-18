import { expect, test } from "vitest";
import { MERGE_ON_QUIT_FIELD, MERGE_ON_QUIT_NOTE, mergesOnQuit } from "./mergeOnQuit";

test("merging on quit is on unless the setting is saved as false", () => {
  expect(MERGE_ON_QUIT_FIELD).toBe("workspacesMergeOnQuit");
  expect(mergesOnQuit({})).toBe(true);
  expect(mergesOnQuit({ workspacesMergeOnQuit: true })).toBe(true);
  expect(mergesOnQuit({ workspacesMergeOnQuit: "no" })).toBe(true);
  expect(mergesOnQuit({ workspacesMergeOnQuit: false })).toBe(false);
});

test("the note is plain words and says nothing is pushed", () => {
  expect(MERGE_ON_QUIT_NOTE).toContain("Nothing goes to GitHub.");
  expect(MERGE_ON_QUIT_NOTE).not.toMatch(/worktree|rebase|fast-forward/i);
});

test("the note says ignored build output inside a merged workspace is deleted and local secrets keep it", () => {
  expect(MERGE_ON_QUIT_NOTE).toContain("Files Git ignores inside a merged workspace, such as build output, are deleted with it.");
  expect(MERGE_ON_QUIT_NOTE).toContain("passwords, keys or local settings that are not saved in Git stays");
});
