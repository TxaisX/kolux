// TERM-049 (T-102-c): Split Right / Split Down on the tab menu, and the close set of a split cell.
import { cellsOf, groupOf, MAX_PANES, splitIndex, columnsFor, type Tabbed } from "./grid";
import { rehome } from "./rearrange";
import { sameDir, viewOf } from "../workspaces";

/**
 * TERM-049: Split Right / Split Down on a tab menu moves the tab out of its cell into a cell of its
 * own, next to the one it left (below it when the grid is a stacked pair). Null for a cell with a
 * single tab (nothing to split from) or a full workspace.
 */
export function splitTabOut<P extends Tabbed & { cwd: string | null }>(panes: P[], key: number, dir: "right" | "down"): { panes: P[]; stack: boolean } | null {
  const me = panes.find((p) => p.key === key);
  if (!me) return null;
  const mine = cellsOf(panes.filter((p) => sameDir(viewOf(p), viewOf(me)))); // its grid (DT-C274)
  const cell = mine.find((c) => c.group === groupOf(me));
  if (!cell || cell.panes.length < 2 || mine.length >= MAX_PANES) return null;
  const stack = dir === "down" && mine.length === 1; // as splitPane: only a lone cell split down stacks
  const groups = mine.map((c) => c.group);
  const at = splitIndex(groups, groupOf(me), dir, columnsFor(mine.length + 1, stack));
  const base = rehome(panes, key);
  const moving = { ...(base.find((p) => p.key === key) as P), group: key } as P;
  const rest = base.filter((p) => p.key !== key);
  const nextCell = mine[at]?.group;
  // after the removal a cell that lost its first pane may start later; find the target by group
  const firstOf = nextCell === undefined ? undefined : rest.find((p) => groupOf(p) === nextCell);
  const i = firstOf ? rest.indexOf(firstOf) : rest.length;
  return { panes: [...rest.slice(0, i), moving, ...rest.slice(i)], stack };
}

/** TERM-049: the entries Split Right / Split Down offer, disabled when the tab is alone in its cell or the grid is full. */
export function splitMenuState<P extends Tabbed & { cwd: string | null }>(panes: P[], key: number): { enabled: boolean; why: string | null } {
  const me = panes.find((p) => p.key === key);
  if (!me) return { enabled: false, why: "that tab is gone" };
  const mine = cellsOf(panes.filter((p) => sameDir(viewOf(p), viewOf(me)))); // its grid (DT-C274)
  const cell = mine.find((c) => c.group === groupOf(me));
  if (!cell || cell.panes.length < 2) return { enabled: false, why: "this tab is alone in its pane" };
  if (mine.length >= MAX_PANES) return { enabled: false, why: `a workspace holds up to ${MAX_PANES} panes` };
  return { enabled: true, why: null };
}

/** TERM-049 / TERM-045: closing a cell that holds several tabs closes them as one set, asked once. */
export const cellKeys = <P extends Tabbed>(panes: P[], key: number): number[] => {
  const me = panes.find((p) => p.key === key);
  return me ? panes.filter((p) => groupOf(p) === groupOf(me)).map((p) => p.key) : [];
};
