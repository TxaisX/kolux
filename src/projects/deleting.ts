// PROJ-070: deleting a workspace safely. What the backend found, what the question shows, and
// whether the question can be skipped.

/** What `workspace_remove_check` returns. T-613: `commits` are the ones on its branch (or detached HEAD)
 *  found on no other branch and on no remote, newest first, as `<short id> <subject>`. */
export type RemoveCheck = { changes: string[]; locked: string | null; nested: string[]; stamp: string; missing?: boolean; commits?: string[] };

/** Settings field: false skips the question for one clean workspace. */
export const CONFIRM_DELETE_FIELD = "confirmWorkspaceDelete";

export const asksBeforeDelete = (settings: Record<string, unknown>) => settings[CONFIRM_DELETE_FIELD] !== false;

/** Why the delete cannot happen at all (forcing does not help), or null. */
export function blocker(c: RemoveCheck): string | null {
  if (c.nested.length > 0) return `This folder holds another workspace (${c.nested[0]}). Delete that one first.`;
  if (c.locked !== null) return `This workspace is locked${c.locked ? ` (${c.locked})` : ""}. Kolux never force-deletes a locked workspace; unlock it with git worktree unlock first.`;
  return null;
}

export const isClean = (c: RemoveCheck) => c.changes.length === 0 && blocker(c) === null;

/** The question goes straight to deleting only for a clean workspace with the setting off, and
 *  (T-613) never when commits found nowhere else would go with its branch. */
export const skipsQuestion = (c: RemoveCheck, settings: Record<string, unknown>) => isClean(c) && (c.commits ?? []).length === 0 && !asksBeforeDelete(settings);

const firstOf = (lines: string[], max: number) => ({ lines: lines.slice(0, max), more: Math.max(0, lines.length - max) });

/** The first `max` change lines, and how many more there are. */
export function shownChanges(c: RemoveCheck, max = 5): { lines: string[]; more: number } {
  return firstOf(c.changes, max);
}

/** T-613: the first `max` commits only this branch holds, and how many more there are. */
export const shownCommits = (c: RemoveCheck, max = 5) => firstOf(c.commits ?? [], max);

/** T-613: what the question says about those commits, or null when there are none. */
export function commitsNote(c: RemoveCheck): string | null {
  const n = (c.commits ?? []).length;
  if (n === 0) return null;
  return n === 1 ? "1 commit is on no other branch and was never pushed; deleting the branch loses it:" : `${n} commits are on no other branch and were never pushed; deleting the branch loses them:`;
}

/** C05-R1-01: what the multi-select remove takes that its question used to leave out. The batch
 *  question has no per-row branch record, so the branch line is conditional for the whole selection
 *  rather than per row; it is still true of every row. */
export const BATCH_FOLDER_NOTE = "Removing these workspaces deletes their folders for good, with the files Git does not track or ignores (installed packages, local settings, build output).";
export const BATCH_BRANCH_NOTE = "Each branch is deleted too, unless the workspace was opened on a branch that already existed, or its branch holds commits no other branch and no remote has; those branches are kept and listed, so you can delete them later.";

/** T-613: Keep the branch starts ticked when deleting it would lose such commits; otherwise the
 *  workspace's own record decides (PROJ-030: opened on a branch that already existed). */
export const keepsAtFirst = (c: RemoveCheck): true | undefined => ((c.commits ?? []).length > 0 ? true : undefined);

/** VIEW-048: the workspace the delete shortcut acts on; the row under the pointer wins over the one shown. */
export const deleteTarget = (hovered: string | null, active: string | null) => hovered ?? active;

/** PROJ-075: the row the delete shortcut found under the pointer, as the sidebar knows it. */
export type PointerRow = { path: string; isMain: boolean; head: string };

/**
 * PROJ-075: what the delete shortcut does to the row under the pointer (the most deeply nested
 * one): a Git worktree starts its delete (the usual question), a folder workspace (a row that is
 * not a Git worktree: no commit) is taken out of Kolux with its folder left on disk. Nothing
 * happens on a main checkout, on a row already being deleted, or while a text field has focus.
 */
export function pointerDelete(row: PointerRow | null, opts: { fieldFocused: boolean; deleting: ReadonlySet<string> }): { action: "delete" | "forget"; path: string } | null {
  if (row === null || opts.fieldFocused || row.isMain) return null;
  const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  const k = norm(row.path);
  if ([...opts.deleting].some((d) => norm(d) === k)) return null;
  return { action: row.head === "" ? "forget" : "delete", path: row.path };
}

/** PROJ-075: a text field (input, text area, editable element) has the focus, so typing Delete edits text. */
export function isTextField(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(((el as HTMLInputElement).type || "text").toLowerCase());
  return (el as HTMLElement).isContentEditable === true || el.getAttribute("contenteditable") === "true";
}
