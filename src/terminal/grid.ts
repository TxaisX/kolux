// The pane grid's arithmetic (TERM-001, TERM-004, TERM-006, TERM-040): how many cells a workspace
// may hold, how they tile, what a resize adds or drops, where a split or a new pane lands. Pure, so it
// is tested without a browser; the window applies the plan.
// Owner decision 2026-11-12 (docs/plans/clean-ui-one-session-per-cell.md): one session per cell. A cell
// holds exactly one pane and there is no tab strip; a pane that used to open as a tab beside the focused
// one now takes the cell right after it (insertAfter). A cell's id is its pane's key.
import { MAX_SESSIONS } from "../launch/seats";

export const groupOf = (p: { key: number }): number => p.key;

/** The grid cells in pane order, one pane each. The `group` and the one-pane list keep the shape the grid,
 *  the zoom and the Board read; a cell never holds a second pane. */
export function cellsOf<P extends { key: number }>(panes: P[]): { group: number; panes: P[] }[] {
  return panes.map((p) => ({ group: p.key, panes: [p] }));
}

/** VIEW-026: one Board card at a time shows its live terminal; the same card again collapses it. */
export const toggleCard = (expanded: number | null, key: number): number | null => (expanded === key ? null : key);

/** TERM-001: a workspace holds at least one pane, and every seat one launch can ask for
 * (SESS-013) fits: the strip's free field is not limited to the quick counts.
 * One session per cell: the cap is on what a person adds (a new pane, a split, a file, a diff, a terminal from the
 * command line), refused with a toast at the cap. What comes back or opens on its own (a restored layout, a reopened
 * tab, kolux.yaml's default tabs, a setup tab) is never dropped for it, so such a grid can hold more for a while. */
export const MAX_PANES = MAX_SESSIONS;

/** Whether the grid of panes `inGrid` (one workspace's) has room for one more cell a person asks for. */
export const hasRoom = (inGrid: readonly unknown[]): boolean => inGrid.length < MAX_PANES;

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

/** One session per cell: panes opened beside pane `prev` (by key) take the cells right after it, in order, so they land
 *  next to the pane they were opened from; with no such pane they go last. Every other pane keeps its place (TERM-017). */
export function insertAfter<P extends { key: number }>(panes: P[], prev: number | undefined, ...added: P[]): P[] {
  const i = prev === undefined ? -1 : panes.findIndex((p) => p.key === prev);
  return i < 0 ? [...panes, ...added] : [...panes.slice(0, i + 1), ...added, ...panes.slice(i + 1)];
}

/** TERM-005: the pane counts a new workspace may start with, and the setting that holds the pick. */
export const PANE_COUNTS = [1, 2, 4, 6, 9, 12];
export const DEFAULT_PANES_FIELD = "defaultPaneCount";

/** TERM-005: how many panes a new workspace starts with: the saved count, 1 when unset or odd,
 * and always 1 in the classic look. */
export const seedCount = (saved: unknown, classic: boolean): number => (classic || !PANE_COUNTS.includes(Number(saved)) ? 1 : Number(saved));

/** TERM-007: the first cell that is free for a new session: a pane that has not started
 * (a chooser). None when every cell holds a session. */
export function freeCell<P extends { key: number; seats?: unknown }>(cells: { panes: P[] }[]): P | undefined {
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
