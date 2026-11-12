// TERM-015 / TERM-054 / TERM-049 (T-102-b, T-102-c): moving panes and tabs around the grid. The
// grid is a flat list of cells (cellsOf: panes sharing a `group` are one cell's tabs, cells run in
// the order their first pane appears), so every move here is a reorder of the pane list plus a
// `group` change. Pure: the window hands in the panes and applies what comes back. A move that
// would leave the layout as it is returns null, so a self-drop does nothing.
import { cellsOf, groupOf, MAX_PANES, type Tabbed } from "./grid";
import { sameDir, viewOf } from "../workspaces";

/** TERM-015: the drag handle shows only when the workspace holds more than one cell. */
export const showsDragHandle = (cells: number): boolean => cells > 1;

/** The part of a cell a drag hovers: the centre or tab strip adds to its group, an outer band splits. */
export type Zone = "centre" | "strip" | "left" | "right" | "top" | "bottom";

/** Share of the cell's width/height that counts as the outer band on each side. */
export const EDGE_BAND = 0.2;

type Rect = { left: number; top: number; width: number; height: number };

/** TERM-054: which zone the pointer is in. Over the tab strip the top band never splits. */
export function zoneOf(x: number, y: number, r: Rect, overStrip: boolean): Zone {
  if (r.width <= 0 || r.height <= 0) return "centre";
  const fx = (x - r.left) / r.width;
  const fy = (y - r.top) / r.height;
  if (fx < EDGE_BAND) return "left";
  if (fx > 1 - EDGE_BAND) return "right";
  if (overStrip) return "strip";
  if (fy < EDGE_BAND) return "top";
  if (fy > 1 - EDGE_BAND) return "bottom";
  return "centre";
}

/** TERM-054: the right half of a tab places the dragged one after it, the left half before. */
export const halfOf = (x: number, r: { left: number; width: number }): "before" | "after" => (x - r.left >= r.width / 2 ? "after" : "before");

export type Target =
  | { kind: "tab"; key: number; half: "before" | "after" }
  | { kind: "cell"; group: number; zone: Zone };

const layoutOf = <P extends Tabbed>(panes: P[]): string => JSON.stringify(cellsOf(panes).map((c) => c.panes.map((p) => p.key)));

/** The group id a lone pane `key` takes when it leaves a group it was the root of: the group's other
 *  members move to their first member's key so no group id outlives the pane it came from. */
export function rehome<P extends Tabbed>(panes: P[], key: number): P[] {
  const g = panes.find((p) => p.key === key);
  if (!g) return panes;
  const gid = groupOf(g);
  const rest = panes.filter((p) => p.key !== key && groupOf(p) === gid);
  if (rest.length === 0 || gid !== key) return panes;
  const to = rest[0].key;
  return panes.map((p) => (p.key !== key && groupOf(p) === gid ? { ...p, group: to } : p));
}

/** Put the panes `moving` (in order) before/after the whole cell `group`, as members of `into`. */
export function place<P extends Tabbed>(panes: P[], moving: P[], at: { before?: number; after?: number }, into: number | "own"): P[] {
  const gone = new Set(moving.map((p) => p.key));
  const kept = panes.filter((p) => !gone.has(p.key));
  const cellOf = (g: number) => kept.filter((p) => groupOf(p) === g);
  const placed = moving.map((p) => {
    const next = { ...p } as P;
    if (into === "own") next.group = moving[0].key;
    else next.group = into;
    return next;
  });
  if (at.before !== undefined) {
    const first = cellOf(at.before)[0];
    const i = kept.indexOf(first);
    return [...kept.slice(0, i), ...placed, ...kept.slice(i)];
  }
  const cell = cellOf(at.after as number);
  const i = kept.indexOf(cell[cell.length - 1]) + 1;
  return [...kept.slice(0, i), ...placed, ...kept.slice(i)];
}

/** The cells of the grid shown in folder `dir` (DT-C274: by `viewOf`). */
export function cellsHere<P extends Tabbed & { cwd: string | null; view?: string | null }>(panes: P[], dir: string | null): number {
  return cellsOf(panes.filter((p) => sameDir(viewOf(p), dir))).length;
}

/**
 * TERM-054: drop tab `key` on `target`. A tab dropped on another tab goes before or after it (in
 * that tab's cell); on a cell's centre or strip it joins that cell; on an outer band it opens a new
 * cell on that side. Null when the drop changes nothing (itself, or a layout it already has).
 */
export function dropTab<P extends Tabbed & { cwd: string | null }>(panes: P[], key: number, target: Target): { panes: P[]; group: number } | null {
  const me = panes.find((p) => p.key === key);
  if (!me) return null;
  let dest: number;
  let at: { before?: number; after?: number };
  let into: number | "own";
  if (target.kind === "tab") {
    if (target.key === key) return null;
    const t = panes.find((p) => p.key === target.key);
    if (!t) return null;
    const kept = rehome(panes, key);
    dest = groupOf(kept.find((p) => p.key === target.key) as P);
    const moving = kept.find((p) => p.key === key) as P;
    const rest = kept.filter((p) => p.key !== key);
    const i = rest.findIndex((p) => p.key === target.key);
    const j = target.half === "after" ? i + 1 : i;
    const next = [...rest.slice(0, j), { ...moving, group: dest } as P, ...rest.slice(j)];
    if (layoutOf(next) === layoutOf(panes)) return null;
    return { panes: next, group: dest };
  }
  const tg = cellsOf(panes).find((c) => c.group === target.group);
  if (!tg || !sameDir(viewOf(tg.panes[0]), viewOf(me))) return null;
  const base = rehome(panes, key);
  const moving = base.find((p) => p.key === key) as P;
  const others = base.filter((p) => p.key !== key);
  const sole = groupOf(me) === target.group && others.every((p) => groupOf(p) !== target.group);
  if (target.zone === "centre" || target.zone === "strip") {
    dest = target.group;
    const cell = others.filter((p) => groupOf(p) === dest);
    if (cell.length === 0) return null;
    const next = place(base, [moving], { after: dest }, dest);
    return layoutOf(next) === layoutOf(panes) ? null : { panes: next, group: dest };
  }
  // an outer band: a new cell beside the target
  if (sole) return null;
  at = target.zone === "left" || target.zone === "top" ? { before: target.group } : { after: target.group };
  into = "own";
  const next = place(base, [moving], at, into);
  if (layoutOf(next) === layoutOf(panes) || cellsHere(next, viewOf(me)) > MAX_PANES) return null;
  return { panes: next, group: moving.key };
}

/**
 * TERM-015: drag a whole cell (its pane header) onto another cell. An outer band puts it before
 * (left, top) or after (right, bottom) the target; the centre or strip folds its tabs into the target.
 */
export function dropCell<P extends Tabbed & { cwd: string | null }>(panes: P[], group: number, target: { group: number; zone: Zone }): P[] | null {
  if (group === target.group) return null;
  const from = cellsOf(panes).find((c) => c.group === group);
  const to = cellsOf(panes).find((c) => c.group === target.group);
  if (!from || !to || !sameDir(viewOf(from.panes[0]), viewOf(to.panes[0]))) return null;
  let next: P[];
  if (target.zone === "centre" || target.zone === "strip") next = place(panes, from.panes, { after: target.group }, target.group);
  else next = place(panes, from.panes, target.zone === "left" || target.zone === "top" ? { before: target.group } : { after: target.group }, group);
  // placing under its own group id keeps the cell's group; a cell folded in takes the target's
  return layoutOf(next) === layoutOf(panes) ? null : next;
}
