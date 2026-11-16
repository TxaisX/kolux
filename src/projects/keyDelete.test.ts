// Audit F13/F14: Delete Workspace (Ctrl+Shift+Backspace) and Rename worktree lost their target when worktrees
// stopped having sidebar rows. With no worktree row under the pointer they now act on the folder the focused
// pane works in, through the same route as the pane's worktree label menu, and never on a main folder.
import { expect, test } from "vitest";
import { keyDeleteTarget, notInWorktree } from "./deleting";
import panelSrc from "./ProjectsPanel.tsx?raw";
import sidebarSrc from "../shell/window/Sidebar.tsx?raw";

const same = (a: string, b: string) => a.toLowerCase().replace(/[\\/]+$/, "") === b.toLowerCase().replace(/[\\/]+$/, "");
const main = { path: "C:/code/app", isMain: true };
const wt1 = { path: "C:/code/app-fix", isMain: false };
const wt2 = { path: "C:/code/app-docs", isMain: false };
const rows = [main, wt1, wt2];

test("with nothing under the pointer, the focused pane's worktree is the target", () => {
  expect(keyDeleteTarget(null, "C:/code/app-fix", rows, same)).toEqual({ w: wt1, hovered: false });
});

test("a worktree row under the pointer wins; the project row under the pointer does not", () => {
  expect(keyDeleteTarget("C:/code/app-docs", "C:/code/app-fix", rows, same)).toEqual({ w: wt2, hovered: true });
  expect(keyDeleteTarget("C:/code/app", "C:/code/app-fix", rows, same)).toEqual({ w: wt1, hovered: false });
});

test("a project's main folder is never a target", () => {
  expect(keyDeleteTarget(null, "C:/code/app", rows, same)).toBeNull();
  expect(keyDeleteTarget("C:/code/app", "C:/code/app", rows, same)).toBeNull();
  expect(keyDeleteTarget(null, null, rows, same)).toBeNull();
  expect(keyDeleteTarget(null, "C:/elsewhere", rows, same)).toBeNull();
});

test("a pane not in a worktree gets one plain line", () => {
  expect(notInWorktree("delete")).toBe("The pane you are in is not in a worktree, so there is nothing to delete.");
  expect(notInWorktree("rename")).toBe("The pane you are in is not in a worktree, so there is nothing to rename.");
});

const effect = (start: string) => panelSrc.slice(panelSrc.indexOf(start), panelSrc.indexOf("}, [", panelSrc.indexOf(start)));
const delEffect = effect("// VIEW-048: the row under the pointer");
const renameEffect = effect("if (renameRequest === 0) return;");

test("the delete shortcut takes the pane menu's route: startDelete, which asks first and names the worktree", () => {
  expect(delEffect).toContain("keyDeleteTarget(waited ? null : hovered, workDir ?? activeDir, rows, same)");
  expect(delEffect).toContain("void startDelete(p, w, { always: true });"); // R27-05: the shortcut always asks
  expect(delEffect).toContain('say("warn", unlisted ? NOT_LISTED_WORKTREE : notInWorktree("delete"))'); // R27-02: a hidden or unreviewed worktree gets its own line
  // The pane label menu's Delete item goes the same way.
  expect(panelSrc).toContain('else if (id === "delete") await startDelete(p, w);');
  // startDelete asks the question with the worktree's name (or the children-first batch question).
  const start = panelSrc.slice(panelSrc.indexOf("const startDelete = async"), panelSrc.indexOf("const labelOf ="));
  expect(start).toContain("await ask(p.id, w.path, worktreeLabel(w), opts)");
  expect(start).toContain("setBatch(");
});

test("the unsaved-tabs check still runs before a single or batch delete", () => {
  const remove = panelSrc.slice(panelSrc.indexOf("const remove = async (c = confirm)"), panelSrc.indexOf('setBusy("removing")', panelSrc.indexOf("const remove = async (c = confirm)")));
  expect(remove).toContain("if (!(await onAskUnsaved([c.path]))) return;");
  const batch = panelSrc.slice(panelSrc.indexOf("const removeBatch = async"));
  expect(batch.slice(0, 400)).toContain("onAskUnsaved(b.order)");
});

test("an old press is not replayed when the sidebar opens again", () => {
  expect(panelSrc).toContain("let servedDelete = 0;");
  expect(delEffect).toContain("deleteRequest === servedDelete) return;");
  expect(delEffect).toContain("servedDelete = deleteRequest;");
});

test("Rename worktree aims at the focused pane's folder and refuses a main folder", () => {
  expect(renameEffect).toContain("renameTarget(workDir ?? activeDir, projects, worktrees, same)");
  expect(renameEffect).toContain('if (w === "none" || w.isMain) say("warn", notInWorktree("rename"));');
  expect(sidebarSrc).toContain("workDir={workDir}");
});
