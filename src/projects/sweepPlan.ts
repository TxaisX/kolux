/** LAG-06: which projects the sidebar's 5 s poll asks git about on a given tick.
 *  Before this the poll sent one `workspace_scan` per project every 5 s (10 projects = 120 git scans a
 *  minute), all of them all the time, even for the projects nobody is looking at. Now the project the
 *  active folder belongs to is still scanned every tick (a branch switch inside it still shows within
 *  seconds), every other project is scanned on one tick in twelve (once a minute), and those slow scans
 *  are staggered over the minute instead of arriving together. A hidden window scans nothing.
 *  Pure functions only: no React, no `invoke`, no timers, so the plan can be counted in a test. */
import type { Project, Worktree } from "./model";
import type { Pushed } from "../scm/model";
import { underDir } from "../workspaces";

/** The poll period in ms (unchanged from today's 5 s). */
export const SWEEP_TICK_MS = 5000;
/** A project that is not active is scanned on one tick in every 12: once a minute at 5 s a tick. */
export const SWEEP_IDLE_EVERY = 12;

/** Is this the project the active folder belongs to? True when the active folder is the project's own
 *  folder (or inside it), or when one of the project's known worktrees holds the active folder. A step
 *  out to a parent folder is not enough: `C:/w` is not `C:/w/app1`'s active folder. Paths are compared
 *  the way the rest of the app does (`underDir`: any slash style, any case, no trailing-slash trouble,
 *  and `C:/w/app10` is not inside `C:/w/app1`). */
export function isActiveProject(p: Project, activeDir: string | null, known: Record<string, Worktree[]>): boolean {
  if (activeDir === null) return false;
  if (underDir(activeDir, p.path)) return true;
  return (known[p.id] ?? []).some((w) => underDir(activeDir, w.path));
}

/** The projects the poll scans on tick number `tick` (0 or more): the active ones, plus every project
 *  whose position `i` in `projects` is due on this tick (`(tick + i) % 12 === 0`), in list order and as
 *  the same objects. Several projects can be active at once (a project folder nested in another): all
 *  of them are due on every tick. A hidden window is due nothing. */
export function dueOnTick(projects: Project[], tick: number, activeDir: string | null, known: Record<string, Worktree[]>, visible: boolean): Project[] {
  if (!visible) return [];
  return projects.filter((p, i) => isActiveProject(p, activeDir, known) || (tick + i) % SWEEP_IDLE_EVERY === 0);
}

/** The unpushed badges after a partial sweep: every folder the sweep did not ask about keeps its badge,
 *  the asked folders take the answer, and a folder asked about that no longer has an answer loses its
 *  badge. `old` is not changed. */
export function mergePushed(old: Record<string, Pushed>, fresh: Pushed[], asked: string[]): Record<string, Pushed> {
  const askedSet = new Set(asked);
  const out: Record<string, Pushed> = {};
  for (const [path, badge] of Object.entries(old)) if (!askedSet.has(path)) out[path] = badge;
  for (const badge of fresh) out[badge.path] = badge;
  return out;
}
