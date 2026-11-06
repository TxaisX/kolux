// The pane grid's arithmetic (TERM-001, TERM-004, TERM-006, TERM-040): how many cells a workspace
// may hold, how they tile, what a resize adds or drops, where a split lands, and which panes share
// a cell as tabs. Pure, so it is tested without a browser; the window applies the plan.
import { MAX_SESSIONS } from "../launch/seats";
import type { PaneLike } from "../workspaces";

/** TERM-040: panes with the same group share one grid cell as tabs; a pane without one is its own cell. */
export type Tabbed = PaneLike & { group?: number };

export const groupOf = (p: { key: number; group?: number }): number => p.group ?? p.key;

/** The grid cells, in the order their first pane appears. */
export function cellsOf<P extends Tabbed>(panes: P[]): { group: number; panes: P[] }[] {
  const cells: { group: number; panes: P[] }[] = [];
  for (const p of panes) {
    const g = groupOf(p);
    const cell = cells.find((c) => c.group === g);
    if (cell) cell.panes.push(p);
    else cells.push({ group: g, panes: [p] });
  }
  return cells;
}

/** VIEW-026: one Board card at a time shows its live terminal; the same card again collapses it. */
export const toggleCard = (expanded: number | null, key: number): number | null => (expanded === key ? null : key);

/** The tab that takes over when `key` closes: the one after it, else the one before, else none. */
export function neighbourTab(keys: number[], key: number): number | null {
  const i = keys.indexOf(key);
  const rest = keys.filter((k) => k !== key);
  return i < 0 ? null : (rest[Math.min(i, rest.length - 1)] ?? null);
}

/** TERM-001: a workspace holds at least one pane, and every seat one launch can ask for
 * (SESS-013) fits: the strip's free field is not limited to the quick counts. */
export const MAX_PANES = MAX_SESSIONS;

export function clampCount(n: number): number {
  const whole = Math.floor(n);
  return Number.isFinite(whole) ? Math.max(1, Math.min(MAX_PANES, whole)) : 1;
}

/** TERM-004: columns for a pane count, so rows stay roughly even (1, 2, 2x2, 3x2, 3x3, 4x3).
 * TERM-006: a pair made by splitting a single pane down is stacked (one column, two rows). */
export function columnsFor(count: number, stacked = false): number {
  return count <= 1 ? 1 : count === 2 && stacked ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
}

export function rowsFor(count: number, stacked = false): number {
  return Math.max(1, Math.ceil(count / columnsFor(count, stacked)));
}

/** TERM-001: growing adds empty panes; shrinking drops unstarted panes first, newest first, and
 * never a started session (TERM-003's "ask first" is T-151; until then `blocking` names the
 * sessions in the way), so `drop` may fall short of the request. */
export function resizePlan(shown: { key: number; started: boolean }[], n: number): { add: number; drop: number[] } {
  const want = clampCount(n);
  if (want >= shown.length) return { add: want - shown.length, drop: [] };
  const drop = shown
    .filter((p) => !p.started)
    .map((p) => p.key)
    .reverse()
    .slice(0, shown.length - want);
  return { add: 0, drop };
}

/** The started sessions a shrink to `n` would have to remove, newest first: empty until T-151 asks. */
export function blocking(shown: { key: number; started: boolean }[], n: number): number[] {
  const short = shown.length - clampCount(n) - resizePlan(shown, n).drop.length;
  return short <= 0 ? [] : shown.filter((p) => p.started).map((p) => p.key).reverse().slice(0, short);
}

/** TERM-006: where a pane split from `key` lands in the shown order: right is the next cell,
 * down is the cell below in a grid `cols` wide. */
// ponytail: the grid is uniform cells, so "below" is an index jump, not a nested split tree.
export function splitIndex(shownKeys: number[], key: number, dir: "right" | "down", cols: number): number {
  const i = shownKeys.indexOf(key);
  if (i < 0) return shownKeys.length;
  return Math.min(shownKeys.length, dir === "right" ? i + 1 : i + cols);
}

/** Puts `pane` just before `next` (at the end when there is none); every other pane keeps its place. */
export function insertBefore<P>(panes: P[], next: P | undefined, pane: P): P[] {
  const i = next ? panes.indexOf(next) : -1;
  return i < 0 ? [...panes, pane] : [...panes.slice(0, i), pane, ...panes.slice(i)];
}

/** TERM-005: the pane counts a new workspace may start with, and the setting that holds the pick. */
export const PANE_COUNTS = [1, 2, 4, 6, 9, 12];
export const DEFAULT_PANES_FIELD = "defaultPaneCount";

/** TERM-005: how many panes a new workspace starts with: the saved count, 1 when unset or odd,
 * and always 1 in the classic look. */
export const seedCount = (saved: unknown, classic: boolean): number => (classic || !PANE_COUNTS.includes(Number(saved)) ? 1 : Number(saved));

/** TERM-007: the first cell that is free for a new session: a lone pane that has not started
 * (a chooser). None when every cell holds a session. */
export function freeCell<P extends Tabbed & { seats?: unknown }>(cells: { panes: P[] }[]): P | undefined {
  return cells.find((c) => c.panes.length === 1 && c.panes[0].seats)?.panes[0];
}

/** TERM-013: the expanded cell of each workspace, with how many cells it had when expanded. */
export type Zoom = Record<string, { group: number; cells: number }>;

/** TERM-013: the cell that fills the grid, or null. A pane added or closed since restores the layout. */
export function zoomedGroup(zoom: Zoom, groups: number[]): number | null {
  const z = Object.values(zoom).find((x) => groups.includes(x.group));
  return z && z.cells === groups.length ? z.group : null;
}

/** TERM-013: one expanded cell per workspace; the expanded one again restores the layout. */
export function toggleZoom(zoom: Zoom, dir: string, group: number, cells: number): Zoom {
  const { [dir]: was, ...rest } = zoom;
  return was && was.group === group && was.cells === cells ? rest : { ...rest, [dir]: { group, cells } };
}

/** TERM-025: a lone pane cannot expand in the classic look; in the clean look it fills the workspace area. */
export const canExpand = (cells: number, classic: boolean): boolean => cells > 1 || !classic;
