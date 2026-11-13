// One workspace per project (Txais, 2026-11-13): the sessions of every worktree of a project show in that project's one
// grid. This is the pure part: which project folder a worktree's grid is, the colour that tells one worktree's
// sessions from another's, the label the pane header wears, and where a new session opens. No React, no invoke.
import { TAB_COLORS } from "../terminal/tabColor";
import { dirKey, sameDir, viewOf } from "../workspaces";
import { folderName } from "./model";

/** Each worktree folder (the project's own folder left out) and the project folder whose grid shows it. */
export function gridRootsOf(projects: { id: string; path: string }[], owner: Record<string, string>): Record<string, string> {
  const roots: Record<string, string> = {};
  for (const [dir, id] of Object.entries(owner)) {
    const p = projects.find((x) => x.id === id);
    if (p && !sameDir(dir, p.path)) roots[dir] = p.path;
  }
  return roots;
}

/** The colours a worktree can wear: the theme's own tab tones, grey kept for the project's main checkout. */
const TONES = TAB_COLORS.filter((c) => c.id !== "grey").map((c) => c.css);
const MAIN_TONE = TAB_COLORS.find((c) => c.id === "grey")?.css ?? "#8b8f98";

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** A colour per worktree folder of one project, by `dirKey`: the main checkout is grey; each other worktree takes the
 *  tone its path hashes to, and steps to the next free one when a sibling already has it (siblings taken in path order, so
 *  the same folders always get the same colours, in every pane header and on every screen). */
export function worktreeColors(mainPath: string | null, worktrees: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<number>();
  for (const w of [...worktrees].sort((a, b) => dirKey(a).localeCompare(dirKey(b)))) {
    const k = dirKey(w);
    if (k in out) continue;
    if (mainPath !== null && sameDir(w, mainPath)) {
      out[k] = MAIN_TONE;
      continue;
    }
    let i = hash(k) % TONES.length;
    for (let n = 0; n < TONES.length && used.has(i); n++) i = (i + 1) % TONES.length;
    used.add(i);
    out[k] = TONES[i];
  }
  return out;
}

/** What a pane header shows for the worktree its session runs in. */
export type WorktreeTag = {
  /** The worktree's folder. */
  path: string;
  /** The words on the chip: the name typed for the worktree, else its branch, else its folder's name. */
  label: string;
  /** The hover text: the full label, the branch and the folder. */
  tip: string;
  color: string;
  /** The label is a name typed for the worktree (it wins over the live branch). */
  typed: boolean;
  isMain: boolean;
};

export type TagContext = {
  projects: { id: string; path: string }[];
  owner: Record<string, string>;
  names: Record<string, string>;
};

/** The tag for a session running in `cwd`, or null when the folder belongs to no project (nothing to tell apart). `branch`
 *  is the one the session's header already knows. Colours are worked out over every worktree the window knows of the project. */
export function worktreeTag(cwd: string | null, branch: string | null, ctx: TagContext): WorktreeTag | null {
  if (cwd === null) return null;
  const id = Object.entries(ctx.owner).find(([dir]) => sameDir(dir, cwd))?.[1];
  const project = ctx.projects.find((p) => p.id === id);
  if (!project) return null;
  const siblings = Object.entries(ctx.owner).filter(([, o]) => o === project.id).map(([dir]) => dir);
  const color = worktreeColors(project.path, siblings)[dirKey(cwd)];
  const typed = Object.entries(ctx.names).find(([dir]) => sameDir(dir, cwd))?.[1];
  const label = typed || branch || folderName(cwd);
  const tip = [label, branch && branch !== label ? `branch ${branch}` : null, cwd].filter(Boolean).join("\n");
  return { path: cwd, label, tip, color, typed: !!typed, isMain: sameDir(cwd, project.path) };
}

// Where a new session of a project opens: its main checkout unless a worktree was picked (the pane-header menu's
// "Start new sessions here"). One pick per project folder, kept for this window session.
const starts = new Map<string, string>();

/** Pick the worktree new sessions of the project folder `root` open in; the main checkout (or the same worktree again) clears it. */
export function setStartDir(root: string, dir: string | null): void {
  if (dir === null || sameDir(dir, root)) starts.delete(dirKey(root));
  else starts.set(dirKey(root), dir);
}

/** The folder a new session opens in for the grid `root`: the picked worktree, else `root` itself. */
export const startDirOf = (root: string | null): string | null => (root === null ? null : (starts.get(dirKey(root)) ?? root));

/** Forget every pick (a test, a window reset). */
export const clearStartDirs = (): void => starts.clear();


/** A removed worktree is no longer a place new sessions can start: a pick naming it (or a folder inside it) is dropped. */
export function forgetStartDirs(removed: string[]): void {
  for (const [root, dir] of [...starts]) if (removed.some((r) => dirKey(dir) === dirKey(r) || dirKey(dir).startsWith(dirKey(r) + "\\"))) starts.delete(root);
}

/** The folder the focused pane works in, for what acts on files and Git (Explorer, quick open, changes, Checks, a new
 *  preview or check pane): its own folder, which is its worktree when it runs in one. The grid's folder (`activeDir`)
 *  only says which panes are shown, so with the project's one grid it would always be the main checkout. */
export function focusDirOf(panes: { key: number; cwd: string | null; view?: string | null }[], focused: number, activeDir: string | null): string | null {
  const p = panes.find((x) => x.key === focused && sameDir(viewOf(x), activeDir));
  return p?.cwd ?? activeDir;
}

// What the window knows of which worktree belongs to which project, kept so that it does not depend on the sidebar being
// open: written to the settings, read at start, and only ever added to by a scan (an empty or failed scan removes nothing).
export const GRID_MAP_SETTING = "worktreeGrids";
export type GridMap = { roots: string[]; worktrees: Record<string, string> };
export const EMPTY_GRID_MAP: GridMap = { roots: [], worktrees: {} };

/** The saved map, or an empty one when nothing (or something unusable) was saved. */
export function readGridMap(settings: Record<string, unknown>): GridMap {
  const v = settings[GRID_MAP_SETTING] as Partial<GridMap> | undefined;
  if (!v || typeof v !== "object") return EMPTY_GRID_MAP;
  const roots = Array.isArray(v.roots) ? v.roots.filter((r): r is string => typeof r === "string") : [];
  const worktrees: Record<string, string> = {};
  if (v.worktrees && typeof v.worktrees === "object") for (const [d, r] of Object.entries(v.worktrees)) if (typeof r === "string") worktrees[d] = r;
  return { roots, worktrees };
}

export const sameGridMap = (a: GridMap, b: GridMap): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The known map plus what the project list now says. A project list that is empty (not loaded yet, or a failed scan)
 *  changes nothing; a worktree is forgotten only when its project is no longer in a list that has projects. */
export function mergeGridMap(prev: GridMap, projects: { id: string; path: string }[], owner: Record<string, string>): GridMap {
  const roots = projects.length > 0 ? projects.map((p) => p.path) : prev.roots;
  const keep = new Set(roots.map(dirKey));
  const found = new Map<string, [string, string]>();
  for (const [d, r] of Object.entries(prev.worktrees)) if (projects.length === 0 || keep.has(dirKey(r))) found.set(dirKey(d), [d, r]);
  for (const [d, r] of Object.entries(gridRootsOf(projects, owner))) found.set(dirKey(d), [d, r]);
  const worktrees: Record<string, string> = {};
  for (const [d, r] of [...found.values()].sort(([x], [y]) => (dirKey(x) < dirKey(y) ? -1 : 1))) worktrees[d] = r;
  const next = { roots, worktrees };
  return sameGridMap(prev, next) ? prev : next;
}

/** The map a project list and its worktree owners describe, nothing kept from before. */
export const gridMapOf = (projects: { id: string; path: string }[], owner: Record<string, string>): GridMap => ({ roots: projects.map((p) => p.path), worktrees: gridRootsOf(projects, owner) });

/** The known map after one more look. `scan` (the start-up scan, given once, on the render it arrives) is only added to
 *  the map, never made the project list: a project added or removed since is the live `projects`' to say, so that list
 *  and its owners are what prunes. */
export function foldGridMap(prev: GridMap, projects: { id: string; path: string }[], owner: Record<string, string>, scan: { projects: { id: string; path: string }[]; owner: Record<string, string> } | null): GridMap {
  return mergeGridMap(scan ? unionGridMaps(prev, gridMapOf(scan.projects, scan.owner)) : prev, projects, owner);
}

/** Two maps as one: every project folder and worktree either knows. */
export function unionGridMaps(a: GridMap, b: GridMap): GridMap {
  const roots = [...new Set([...a.roots, ...b.roots])];
  const worktrees = { ...a.worktrees, ...b.worktrees };
  const next = { roots, worktrees };
  return sameGridMap(a, next) ? a : next;
}
