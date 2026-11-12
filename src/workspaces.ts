// Which panes belong to which workspace (PROJ-066). A workspace is a folder: a project's main
// checkout or one of its worktrees. The window shows one workspace at a time; the others keep
// their panes mounted but hidden, so switching back finds every terminal exactly as it was.
// `null` is the home group: panes that were opened in no workspace (the first PowerShell pane).

// DT-C274: a pane may be shown in another folder's grid than the one it runs in (`view`): an own-folder team runs
// each agent in its own worktree but shows the whole team in the one grid the chooser was in. No `view` (every
// pane before DT-C274): the pane is shown in its own folder's grid.
export type PaneLike = { key: number; cwd: string | null; view?: string | null };

/** DT-C274: the folder whose grid shows the pane: its `view` when it has one, else the folder it runs in. */
export const viewOf = (p: { cwd: string | null; view?: string | null }): string | null => (p.view !== undefined ? p.view : p.cwd);

// One spelling per folder: backslashes, no trailing slash, any case, "." and ".." worked out
// (USAGE-017: a path that climbs out of a folder is not inside it).
const trim = (p: string) => {
  const out: string[] = [];
  for (const part of p.replace(/\//g, "\\").toLowerCase().split("\\")) {
    if (part === "..") {
      if (out.length > 1) out.pop();
    } else if (part !== ".") out.push(part);
  }
  return out.join("\\").replace(/\\+$/, "");
};

/** PROJ-021: the name typed for the workspace a pane runs in, exactly as typed; nothing for a folder with no typed name. */
export function nameOf(names: Record<string, string>, cwd: string | null): string | undefined {
  if (!cwd) return undefined;
  return Object.entries(names).find(([dir]) => sameDir(dir, cwd))?.[1];
}

/** Same folder, whichever slash style or trailing slash either side uses. */
export function sameDir(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return trim(a) === trim(b);
}

/** Is `path` the folder `root` or inside it? */
export function underDir(path: string | null, root: string): boolean {
  if (path === null) return false;
  const p = trim(path);
  const r = trim(root);
  return p === r || p.startsWith(r + "\\");
}

/** The panes shown for a workspace (DT-C274: by the grid they are shown in, `viewOf`). */
export function panesIn<P extends PaneLike>(panes: P[], dir: string | null): P[] {
  return panes.filter((p) => sameDir(viewOf(p), dir));
}

/** Keeps the focus where it is when that pane is shown, else moves it to the first shown pane. */
export function focusIn(panes: PaneLike[], dir: string | null, focused: number): number {
  const shown = panesIn(panes, dir);
  if (shown.some((p) => p.key === focused)) return focused;
  return shown[0]?.key ?? focused;
}

/** Removing a workspace closes every pane in it (PROJ-066: none of its tabs remain anywhere). DT-C274: the panes
 *  shown in its grid close with it too, a team whose agents run in worktrees of their own included. */
export function withoutDir<P extends PaneLike>(panes: P[], root: string): P[] {
  return panes.filter((p) => !underDir(p.cwd, root) && !underDir(viewOf(p), root));
}

/** Where to go when the shown workspace is removed: stay unless it was the one removed, then the
 * most recently used sibling in the same project (PROJ-070), else the home group. */
export function activeAfterRemove(active: string | null, removed: string, recent: string[] = [], siblings: string[] = []): string | null {
  if (active === null || !underDir(active, removed)) return active;
  return recent.find((d) => !underDir(d, removed) && siblings.some((s) => sameDir(s, d))) ?? null;
}
