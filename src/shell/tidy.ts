// TERM-008 / TERM-016: tidy the grid, and move a split pane into the tab strip of its neighbour. Pure; the window applies the result.
import { cellsOf, groupOf, type Tabbed } from "../terminal/grid";
import { dropTab } from "../terminal/rearrange";
import { sameDir, viewOf } from "../workspaces";

/**
 * TERM-008: drops every dragged column and row weight of one folder's grid, whatever the pane count was when it was dragged,
 * so each pane in a row is the same width again. Only sizes: panes are never closed, restarted or reordered.
 * Weight keys read `${dir}|${axis}|${count}`; other folders keep theirs.
 */
export function tidyWeights(weights: Record<string, number[]>, dir: string | null): Record<string, number[]> {
  const prefix = `${dir ?? ""}|`;
  return Object.fromEntries(Object.entries(weights).filter(([k]) => !k.startsWith(prefix)));
}

/** The cell a pane moves into: the cell before its own in the same folder, else the one after. Null when it has no neighbour. */
export function neighbourCell<P extends Tabbed & { cwd: string | null }>(panes: P[], key: number): number | null {
  const me = panes.find((p) => p.key === key);
  if (!me) return null;
  const cells = cellsOf(panes.filter((p) => sameDir(viewOf(p), viewOf(me)))); // its grid (DT-C274)
  const i = cells.findIndex((c) => c.group === groupOf(me));
  const near = cells[i - 1] ?? cells[i + 1];
  return i < 0 || !near ? null : near.group;
}

/**
 * TERM-016: the pane `key` leaves its cell and becomes a tab of the neighbouring cell, so the grid shrinks back by one cell.
 * Only the `group` field changes: the key, and so the running session, its scrollback and the run a finished agent's result
 * belongs to, stay exactly as they were (one entry, however many times the pane is moved). Null when there is no neighbour.
 */
export function moveToTab<P extends Tabbed & { cwd: string | null }>(panes: P[], key: number): { panes: P[]; group: number } | null {
  const to = neighbourCell(panes, key);
  const last = to === null ? undefined : (cellsOf(panes).find((c) => c.group === to)?.panes ?? []).slice(-1)[0];
  return last ? dropTab(panes, key, { kind: "tab", key: last.key, half: "after" }) : null;
}
