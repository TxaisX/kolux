// EDIT-031 for whole workspaces: deleting, forgetting or sleeping a workspace closes every tab in it,
// so a dirty editor tab in that workspace must hold the removal until the user chose Save, Don't save
// or Cancel. These are the decisions App.tsx uses to build the question and the delete dialog's list.
import { describe, expect, it } from "vitest";
import type { GuardPane } from "../editor/closeGuard";
import { mayRemove } from "../editor/closeGuard";
import { sameDir } from "../workspaces";
import { namesOf, panesInDirs, unsavedInDirs } from "./wsUnsaved";

const panes: GuardPane[] = [
  { key: 1, kind: "editor", path: "C:/w/ws/fix/a.ts", cwd: "C:/w/ws/fix" },
  { key: 2, kind: "editor", path: "C:/w/ws/fix/b.md", cwd: "C:/w/ws/fix" },
  { key: 3, kind: "editor", path: "C:/w/ws/other/c.ts", cwd: "C:/w/ws/other" },
  { key: 4, cwd: "C:/w/ws/fix" }, // a terminal in the workspace
  { key: 5, kind: "diff", path: "C:/w/ws/fix/d.ts", cwd: "C:/w/ws/fix" },
  { key: 6, kind: "editor", path: "C:/w/home/e.ts", cwd: null }, // home, in no workspace
  { key: 7, kind: "editor", path: "C:/w/ws/fix/a-other.ts", cwd: "C:/w/ws/fix" }, // clean twin of a.ts's folder
];
const dirty = { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: false };

describe("EDIT-031 a workspace's unsaved editor tabs hold its removal", () => {
  it("finds every pane in the workspace, whatever the slash style or case", () => {
    expect(panesInDirs(panes, ["C:/w/ws/fix"], sameDir)).toEqual([1, 2, 4, 5, 7]);
    expect(panesInDirs(panes, ["c:\\W\\ws\\FIX\\"], sameDir)).toEqual([1, 2, 4, 5, 7]);
  });

  it("finds the dirty file tabs in the target workspace only, once each, and names their files", () => {
    const u = unsavedInDirs(panes, dirty, ["C:/w/ws/fix"], sameDir);
    expect(u.map((x) => x.key)).toEqual([1, 2, 5]);
    expect(namesOf(u)).toEqual(["a.ts", "b.md", "d.ts"]);
    // the same file in two tabs shows once
    expect(namesOf([...u, { key: 99, path: "C:/w/ws/fix/a.ts", root: "C:/w/ws/fix" }])).toEqual(["a.ts", "b.md", "d.ts"]);
    // another workspace's dirty tab never belongs to this question
    expect(unsavedInDirs(panes, dirty, ["C:/w/ws/other"], sameDir).map((x) => x.key)).toEqual([3]);
  });

  it("asks nothing when the workspace holds no unsaved text", () => {
    expect(unsavedInDirs(panes, dirty, ["C:/w/ws/fix"], sameDir).length).toBeGreaterThan(0); // so the question is asked
    expect(unsavedInDirs(panes, { 7: false }, ["C:/w/ws/fix"], sameDir)).toEqual([]);
    expect(unsavedInDirs(panes, dirty, ["C:/w/nowhere"], sameDir)).toEqual([]);
  });

  it("lets the removal go only on an explicit choice, and Save only when every file saved", () => {
    const u = unsavedInDirs(panes, dirty, ["C:/w/ws/fix"], sameDir);
    expect(mayRemove("cancel", u, new Set())).toBe(false); // Cancel: nothing is removed, no draft dropped
    expect(mayRemove("save", u, new Set())).toBe(false); // a failed save still holds it
    expect(mayRemove("save", u, new Set([1, 2]))).toBe(false);
    expect(mayRemove("save", u, new Set(u.map((x) => x.key)))).toBe(true);
    expect(mayRemove("discard", u, new Set())).toBe(true); // Don't save drops the text on purpose
  });
});
