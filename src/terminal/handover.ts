// TERM-016 / TERM-054 / TERM-015 / TERM-049 (DT-C248): a pane that changes cell keeps its terminal.
//
// Grid.tsx draws one element per cell (keyed by group) and the panes inside it (keyed by key). React
// cannot move a child from one parent to another, so a pane whose group changes (Move to Tab, a tab
// dragged onto another cell, a cell folded into another, Split Right / Down on a tab) is unmounted and
// mounted again. Before DT-C248 the unmount reaped the terminal and the new mount started a fresh one,
// so an agent lost its conversation on every move. Now the window hands the pane's key over before it
// applies the layout: the unmounting pane leaves its terminal running, and the mounting pane of the
// same key takes it back the way a pane does after a window reload (APP-052: replay the saved output,
// then attach to the terminal the service still runs). The PTY, the program and its session stay.
//
// A key is handed over only when its group really changes, and a close takes the key back, so a pane
// that is closed never skips the reap because of a stale mark.

import { groupOf } from "./grid";

const moving = new Set<number>();

type Grouped = { key: number; group?: number };

/** The keys whose cell changes between `before` and `after`: the panes React will unmount and mount again.
 *  A cell whose group id is renumbered (its first tab dragged elsewhere, rearrange.ts rehome) counts as a
 *  change for every tab left in it, since the cell element is keyed by that id. */
export function movedKeys(before: readonly Grouped[], after: readonly Grouped[]): number[] {
  const was = new Map(before.map((p) => [p.key, groupOf(p)]));
  return after.filter((p) => was.has(p.key) && was.get(p.key) !== groupOf(p)).map((p) => p.key);
}

/** The window is about to apply a layout that moves these panes to other cells: their terminals go to the next mount. */
export function handOver(keys: readonly number[]): void {
  for (const k of keys) moving.add(k);
}

/** Whether the pane with this key is between its old mount and its new one (the unmount leaves the terminal running). */
export function handedOver(key: number | undefined): boolean {
  return key !== undefined && moving.has(key);
}

/** The new mount of the pane takes the hand-over: true once, then the key is plain again. */
export function takeOver(key: number | undefined): boolean {
  if (key === undefined || !moving.has(key)) return false;
  moving.delete(key);
  return true;
}

/** A tab that closes is no longer moving, whatever was marked: its terminal is reaped as usual. */
export function cancelHandOver(keys: readonly number[]): void {
  for (const k of keys) moving.delete(k);
}
