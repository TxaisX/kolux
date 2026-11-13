// One workspace per project (Txais, 2026-11-13): the sessions of every worktree of a project show in that project's one
// grid. This is the pure part: which project folder a worktree's grid is, the colour that tells one worktree's
// sessions from another's, the label the pane header wears, and where a new session opens. No React, no invoke.
import { TAB_COLORS } from "../terminal/tabColor";
import { dirKey, sameDir } from "../workspaces";
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
