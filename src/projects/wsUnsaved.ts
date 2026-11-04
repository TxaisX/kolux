// EDIT-031 for whole workspaces: deleting, forgetting or sleeping a workspace closes every pane in it,
// so its unsaved editor tabs join the same question a closing tab gets. These are the decisions;
// App.tsx builds the question and hands it to the sidebar.
import { baseName } from "../editor/buffers";
import { unsavedTabs, type GuardPane, type Unsaved } from "../editor/closeGuard";

/** The panes a delete, forget or sleep of `paths` closes: every pane whose folder is one of them. */
export function panesInDirs(panes: GuardPane[], paths: string[], same: (a: string | null, b: string | null) => boolean): number[] {
  return panes.filter((p) => p.cwd != null && paths.some((d) => same(d, p.cwd ?? null))).map((p) => p.key);
}

/** The workspace's file tabs that hold unsaved text. Any of them holds the removal until the user chose. */
export function unsavedInDirs(panes: GuardPane[], dirty: Record<number, boolean>, paths: string[], same: (a: string | null, b: string | null) => boolean): Unsaved[] {
  return unsavedTabs(panesInDirs(panes, paths, same), panes, dirty);
}

/** The file names the question and the delete dialog show, once each. */
export function namesOf(unsaved: Unsaved[]): string[] {
  return [...new Set(unsaved.map((u) => baseName(u.path)))];
}
