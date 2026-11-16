// Which panes belong to which workspace (PROJ-066). A workspace is a folder: a project's main
// checkout or one of its worktrees. The window shows one workspace at a time; the others keep
// their panes mounted but hidden, so switching back finds every terminal exactly as it was.
// `null` is the home group: panes that were opened in no workspace (the first PowerShell pane).

// DT-C274: a pane may be shown in another folder's grid than the one it runs in (`view`): an own-folder team runs
// each agent in its own worktree but shows the whole team in the one grid the chooser was in. No `view` (every
// pane before DT-C274): the pane is shown in its own folder's grid.
export type PaneLike = { key: number; cwd: string | null; view?: string | null };

// One workspace per project (Txais, 2026-11-13): every worktree of a project shows in the project folder's one grid. The
// window hands over which folder each worktree belongs to and the project folders themselves; `gridOf` answers with the
// project folder for a worktree of it, for a folder inside a worktree and for a folder inside a project folder (the
// longest known folder wins), and a folder that is none of those answers as itself. Module state, set by the window.
let gridRoots: Record<string, string> = {};
let gridAnswers = new Map<string, string>();
let gridSig = "[]";

/** The worktree folders and the project folder whose grid each one shows in, and the project folders (a folder under one
 *  of them shows in its grid too). Keys go through `dirKey`. */
export function setGridRoots(roots: Record<string, string>, projectFolders: string[] = []): void {
  const next: Record<string, string> = {};
  for (const root of projectFolders) next[dirKey(root)] = root;
  // R71-02: a project folder keeps its own grid; a worktree entry for it (a map saved before this rule) does not move it.
  const own = new Set(Object.keys(next));
  for (const [dir, root] of Object.entries(roots)) if (!own.has(dirKey(dir))) next[dirKey(dir)] = root;
  const sig = JSON.stringify(Object.entries(next).sort(([x], [y]) => (x < y ? -1 : 1)));
  if (sig === gridSig) return; // the window calls this every render; the answers are kept while the lists are the same
  gridSig = sig;
  gridRoots = next;
  gridAnswers = new Map();
}

/** The folder whose grid shows `dir`: the project folder for a worktree of it (or a folder inside either), else `dir` as given. */
export const gridOf = (dir: string | null): string | null => {
  if (dir === null) return null;
  const k = dirKey(dir);
  const known = gridAnswers.get(k);
  if (known !== undefined) return known === "" ? dir : known;
  let best: string | undefined;
  let bestLen = -1;
  for (const e of Object.keys(gridRoots)) if ((k === e || k.startsWith(e + "\\")) && e.length > bestLen) (best = e), (bestLen = e.length);
  const answer = best === undefined ? "" : gridRoots[best];
  gridAnswers.set(k, answer);
  return answer === "" ? dir : answer;
};

/** DT-C274: the folder whose grid shows the pane: its `view` when it has one, else the folder it runs in; a worktree
 *  of a project shows in the project's grid (`gridOf`). */
export const viewOf = (p: { cwd: string | null; view?: string | null }): string | null => gridOf(p.view !== undefined ? p.view : p.cwd);

/** One spelling per folder: backslashes, no trailing slash, any case, "." and ".." worked out
 *  (USAGE-017: a path that climbs out of a folder is not inside it). The key for a folder in a set or map. */
export const dirKey = (p: string): string => {
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
  return dirKey(a) === dirKey(b);
}

/** Is `path` the folder `root` or inside it? */
export function underDir(path: string | null, root: string): boolean {
  if (path === null) return false;
  const p = dirKey(path);
  const r = dirKey(root);
  return p === r || p.startsWith(r + "\\");
}

/** PROJ 008 / F21: does `dir` go when the `removed` folders leave Kolux and the `staying` ones (the folders and worktrees of
 *  the projects that remain) do not? The deepest listed folder that holds `dir` owns it; a tie goes to the removed one, as the
 *  back end's does. With no staying folders this is `underDir` against the removed ones. */
export function goesWith(dir: string | null, removed: string[], staying: string[] = []): boolean {
  const depth = (list: string[]) => list.reduce((n, r) => (underDir(dir, r) ? Math.max(n, dirKey(r).length) : n), -1);
  const gone = depth(removed);
  return gone >= 0 && gone >= depth(staying);
}

/** PROJ 008 / F21 (job 64's F1): the folders that go with a removed project, asked before `goesWith` and `sessionsUnder`.
 *  Two projects can sit on one Git repository (a main checkout and a linked worktree of it), and Git lists every worktree
 *  to both, so each lists the other's own folder and the worktrees they share. A listed folder goes only when it is the
 *  project's own (`own`) or no staying project lists it (`staying`: their folders and worktrees). */
export function goingFolders(own: string, listed: string[], staying: string[]): string[] {
  return listed.filter((d) => sameDir(d, own) || !staying.some((s) => sameDir(s, d)));
}

/** The panes shown for a workspace (DT-C274: by the grid they are shown in, `viewOf`). */
export function panesIn<P extends PaneLike>(panes: P[], dir: string | null): P[] {
  const at = gridOf(dir);
  return panes.filter((p) => sameDir(viewOf(p), at));
}

/** Keeps the focus where it is when that pane is shown, else moves it to the first shown pane. */
export function focusIn(panes: PaneLike[], dir: string | null, focused: number): number {
  const shown = panesIn(panes, dir);
  if (shown.some((p) => p.key === focused)) return focused;
  return shown[0]?.key ?? focused;
}

/** Removing a workspace closes every pane in it (PROJ-066: none of its tabs remain anywhere). DT-C274: the panes
 *  shown in its grid close with it too, a team whose agents run in worktrees of their own included. PROJ 008 / F21: a pane
 *  of a `staying` folder inside it (a nested project that stays) stays (`goesWith`). */
export function withoutDir<P extends PaneLike>(panes: P[], root: string, staying: string[] = []): P[] {
  return panes.filter((p) => !closesWith(p, [root], staying));
}

/** R83-04: the pane's own folder stays: it lies in a folder a staying project lists, deeper than any removed folder it lies in. */
export function staysOwn(dir: string | null, removed: string[], staying: string[]): boolean {
  const depth = (list: string[]) => list.reduce((n, r) => (underDir(dir, r) ? Math.max(n, dirKey(r).length) : n), -1);
  const kept = depth(staying);
  return kept >= 0 && kept > depth(removed);
}

/** Whether removing `removed` closes the pane (`withoutDir`), asks about its folder (`askedOf`) and counts it
 *  (`sessionsUnder`): its own folder goes, or the grid that shows it goes. R83-04: a pane with no `view` whose own folder
 *  stays (`staysOwn`: a worktree a staying project also lists) is kept, whichever grid showed it. A pane whose `view`
 *  names a going grid still closes with it. */
export function closesWith(p: { cwd: string | null; view?: string | null }, removed: string[], staying: string[] = []): boolean {
  return goesWith(p.cwd, removed, staying) || (goesWith(viewOf(p), removed, staying) && (p.view != null || !staysOwn(p.cwd, removed, staying)));
}

/** Where to go when the shown workspace is removed: stay unless it was the one removed, then the
 * most recently used sibling in the same project (PROJ-070), else the home group. */
// R71-05: `staying` are folders inside `removed` that stay (`goesWith`); one of them may be the fallback.
export function activeAfterRemove(active: string | null, removed: string, recent: string[] = [], siblings: string[] = [], staying: string[] = []): string | null {
  if (active === null || !goesWith(active, [removed], staying)) return active;
  return recent.find((d) => !goesWith(d, [removed], staying) && siblings.some((s) => sameDir(s, d))) ?? null;
}
