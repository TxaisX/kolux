// TERM-015 (T-102-b): moving panes around the grid. One session per cell (owner decision 2026-11-12): the grid
// is a flat list of cells, one pane each, in pane order, so every move here is a reorder of the pane list. Pure:
// the window hands in the panes and applies what comes back. A move that would leave the layout as it is
// returns null, so a self-drop does nothing.
import { sameDir, viewOf } from "../workspaces";

/** TERM-015: the drag handle shows only when the workspace holds more than one cell. */
export const showsDragHandle = (cells: number): boolean => cells > 1;

/** The part of a cell a drag hovers: the centre swaps the two panes, an outer band moves the dragged one to that side. */
export type Zone = "centre" | "left" | "right" | "top" | "bottom";

/** Share of the cell's width/height that counts as the outer band on each side. */
export const EDGE_BAND = 0.2;

type Rect = { left: number; top: number; width: number; height: number };

/** TERM-015: which zone the pointer is in. */
export function zoneOf(x: number, y: number, r: Rect): Zone {
  if (r.width <= 0 || r.height <= 0) return "centre";
  const fx = (x - r.left) / r.width;
  const fy = (y - r.top) / r.height;
  if (fx < EDGE_BAND) return "left";
  if (fx > 1 - EDGE_BAND) return "right";
  if (fy < EDGE_BAND) return "top";
  if (fy > 1 - EDGE_BAND) return "bottom";
  return "centre";
}

/**
 * TERM-015: drag pane `key` (by its header grip) onto the cell of pane `target.group`. The centre swaps the two
 * panes' cells; an outer band puts the dragged pane before (left, top) or after (right, bottom) the target. Only
 * panes of the same grid (DT-C274: by `viewOf`) move. Null when the drop changes nothing.
 */
export function dropCell<P extends { key: number; cwd: string | null; view?: string | null }>(panes: P[], key: number, target: { group: number; zone: Zone }): P[] | null {
  if (key === target.group) return null;
  const from = panes.findIndex((p) => p.key === key);
  const to = panes.findIndex((p) => p.key === target.group);
  if (from < 0 || to < 0 || !sameDir(viewOf(panes[from]), viewOf(panes[to]))) return null;
  if (target.zone === "centre") {
    const next = [...panes];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  }
  const moving = panes[from];
  const rest = panes.filter((p) => p.key !== key);
  const at = rest.findIndex((p) => p.key === target.group) + (target.zone === "left" || target.zone === "top" ? 0 : 1);
  const next = [...rest.slice(0, at), moving, ...rest.slice(at)];
  return next.every((p, i) => p === panes[i]) ? null : next;
}
