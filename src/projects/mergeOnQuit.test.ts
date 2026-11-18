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
