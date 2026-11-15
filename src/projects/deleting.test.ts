import { describe, expect, test } from "vitest";
import { asksBeforeDelete, blocker, commitsNote, isClean, isTextField, keepsAtFirst, pointerDelete, shownChanges, shownCommits, skipsQuestion, type RemoveCheck } from "./deleting";

const clean: RemoveCheck = { changes: [], locked: null, nested: [], stamp: "h|" };

test("the question is skipped only for a clean workspace with the setting off", () => {
  expect(asksBeforeDelete({})).toBe(true);
  expect(asksBeforeDelete({ confirmWorkspaceDelete: false })).toBe(false);
  expect(skipsQuestion(clean, {})).toBe(false);
  expect(skipsQuestion(clean, { confirmWorkspaceDelete: false })).toBe(true);
  expect(skipsQuestion({ ...clean, changes: ["?? a"] }, { confirmWorkspaceDelete: false })).toBe(false);
  expect(skipsQuestion({ ...clean, locked: "" }, { confirmWorkspaceDelete: false })).toBe(false);
});

test("a lock or a nested workspace blocks, changes only warn", () => {
  expect(blocker(clean)).toBeNull();
  expect(blocker({ ...clean, changes: ["?? a"] })).toBeNull();
  expect(isClean({ ...clean, changes: ["?? a"] })).toBe(false);
  expect(blocker({ ...clean, locked: "" })).toMatch(/locked\. Kolux never/);
  expect(blocker({ ...clean, locked: "usb" })).toMatch(/locked \(usb\)/);
  expect(blocker({ ...clean, nested: ["C:/w/a/b"], locked: "x" })).toMatch(/C:\/w\/a\/b/);
});

test("at most five changes are listed, with a count of the rest", () => {
  const many = { ...clean, changes: ["1", "2", "3", "4", "5", "6", "7"] };
  expect(shownChanges(many)).toEqual({ lines: ["1", "2", "3", "4", "5"], more: 2 });
  expect(shownChanges(clean)).toEqual({ lines: [], more: 0 });
});

test("T-613: commits found on no other branch and no remote are named, keep the branch at first, and always ask", () => {
  const three = { ...clean, commits: ["c3c3c3c fix step 3", "b2b2b2b fix step 2", "a1a1a1a fix step 1"] };
  expect(skipsQuestion(three, { confirmWorkspaceDelete: false }), "the skip setting never covers them").toBe(false);
  expect(isClean(three), "nothing uncommitted: they never count as changes to force away").toBe(true);
  expect(commitsNote(three)).toBe("3 commits are on no other branch and were never pushed; deleting the branch loses them:");
  expect(commitsNote({ ...clean, commits: ["a1a1a1a only"] })).toBe("1 commit is on no other branch and was never pushed; deleting the branch loses it:");
  expect(commitsNote(clean)).toBeNull();
  expect(shownCommits({ ...clean, commits: ["1", "2", "3", "4", "5", "6", "7"] })).toEqual({ lines: ["1", "2", "3", "4", "5"], more: 2 });
  expect(shownCommits(clean)).toEqual({ lines: [], more: 0 });
  expect(keepsAtFirst(three), "Keep the branch starts ticked").toBe(true);
  expect(keepsAtFirst(clean), "otherwise the workspace's own record decides").toBeUndefined();
});

describe("PROJ-075: delete the workspace under the pointer", () => {
  const none = new Set<string>();
  const wt = { path: "G:/ws/app/fix", isMain: false, head: "abc1234" };
  const folder = { path: "G:/notes/drafts", isMain: false, head: "" };
  const main = { path: "G:/src/app", isMain: true, head: "abc1234" };
  test("a hovered worktree starts its delete; a folder workspace is only taken out of Kolux", () => {
    expect(pointerDelete(wt, { fieldFocused: false, deleting: none })).toEqual({ action: "delete", path: wt.path });
    expect(pointerDelete(folder, { fieldFocused: false, deleting: none })).toEqual({ action: "forget", path: folder.path });
  });
  test("nothing on the main checkout, on a row already deleting, while a text field has focus, or with no row", () => {
    expect(pointerDelete(main, { fieldFocused: false, deleting: none })).toBeNull();
    expect(pointerDelete(wt, { fieldFocused: false, deleting: new Set(["G:\\WS\\app\\fix\\"]) })).toBeNull();
    expect(pointerDelete(wt, { fieldFocused: true, deleting: none })).toBeNull();
    expect(pointerDelete(null, { fieldFocused: false, deleting: none })).toBeNull();
  });
  test("text fields are told apart from other focused controls", () => {
    const el = (tag: string, attrs: Record<string, string> = {}) => ({ tagName: tag.toUpperCase(), type: attrs.type ?? "", isContentEditable: attrs.ce === "1", getAttribute: (n: string) => (n === "contenteditable" && attrs.ce === "1" ? "true" : null) }) as unknown as Element;
    expect(isTextField(el("input"))).toBe(true);
    expect(isTextField(el("input", { type: "search" }))).toBe(true);
    expect(isTextField(el("input", { type: "checkbox" }))).toBe(false);
    expect(isTextField(el("textarea"))).toBe(true);
    expect(isTextField(el("div", { ce: "1" }))).toBe(true);
    expect(isTextField(el("button"))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});
