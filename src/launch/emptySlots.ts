// T-745 (DT-C181): the layout strip's "6" fills the grid with new-session choosers at once, and six full sheets
// are too cramped to use (Folders and Task clipped at 1400 px). Only one cell shows the sheet; the others are
// empty slots until clicked. The chooser stays mounted as a slot, so nothing set up in it is lost.
import { sameDir } from "../workspaces";

type Cell = { panes: { key: number; cwd: string | null; seats?: unknown }[] };
type Grid<C extends Cell> = { terminals: boolean; board: boolean; agentsScreen: boolean; zoomed: unknown; activeDir: string | null; focused: number; cells: C[]; activeOf: (c: C) => number };

// ponytail: one remembered chooser for the window; keep one per workspace if switching workspaces makes the sheet hop.
let last: number | null = null;

/**
 * The chooser that shows the sheet in the terminal grid: the focused one, else the last one focused, else the
 * first. Null when fewer than two choosers are in front in this workspace's grid (no slots then).
 */
export function gridSheet<C extends Cell>(w: Grid<C>): number | null {
  if (!w.terminals || w.board || w.agentsScreen || w.zoomed !== null) return null;
  const keys = w.cells
    .filter((c) => sameDir(c.panes[0].cwd, w.activeDir))
    .map((c) => c.panes.find((p) => p.key === w.activeOf(c)) ?? c.panes[0])
    .filter((p) => p.seats)
    .map((p) => p.key);
  if (keys.length < 2) return null;
  if (keys.includes(w.focused)) last = w.focused;
  return last !== null && keys.includes(last) ? last : keys[0];
}
