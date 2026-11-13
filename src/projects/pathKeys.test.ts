// c2-agents audit 19: the projects helpers compare folders with the one shared rule (workspaces.ts
// sameDir / dirKey), so a path written with `/` and the same path with `\` are one folder.
import { expect, test } from "vitest";
import { pointerDelete } from "./deleting";
import { begin, take } from "./scanView";
import { openedWorktree, type Worktree } from "./model";
import { dirKey } from "../workspaces";

test("audit 19: a row already being deleted is matched whichever slash style either side uses", () => {
  const row = { path: "C:/w/one/", isMain: false, head: "abc" };
  expect(pointerDelete(row, { fieldFocused: false, deleting: new Set(["c:\\W\\one"]) })).toBeNull();
  expect(pointerDelete(row, { fieldFocused: false, deleting: new Set(["C:\\w\\two"]) })).toEqual({ action: "delete", path: "C:/w/one/" });
});

test("audit 19: the scan lists a repository once even when it arrives with the other slash style", () => {
  const ev = (path: string) => ({ scanId: 1, found: { path, name: "one", bare: false, linked: null }, visited: 1, count: 1, done: false, stopped: false, limit: null });
  const s = take(take(begin(1), ev("C:\\w\\one")), ev("c:/w/one"));
  expect(s.found).toHaveLength(1);
});

test("audit 19: the worktree opened after adding a project is found across slash styles", () => {
  const list = [{ path: "C:\\w\\main", isMain: true }, { path: "C:\\w\\feature", isMain: false }] as Worktree[];
  expect(openedWorktree(list, "c:/w/feature/")?.path).toBe("C:\\w\\feature");
  expect(dirKey("C:/w/./a/../feature/")).toBe(dirKey("c:\\w\\feature"));
});
