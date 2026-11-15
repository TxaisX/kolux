import { dirMark, dirMonitoring, type RowAt } from "../../projects/WorktreePalette";
import { paneState, strongest, type AgentState, type RowInfo } from "../../projects/rows";
import { sameDir } from "../../workspaces";

type PalettePane = { key: number; cwd: string | null; agent: string; seats?: unknown };

/** VIEW-040 / STAT-024: the palette's mark for one folder row. A pane counts on the row of the folder it runs in
 *  (`p.cwd`), not the grid it is shown in, so a worktree row shows its own panes and the project row only its own. */
export function paletteAt<P extends PalettePane>(
  d: string,
  panes: P[],
  statusOf: (p: P) => AgentState | null | undefined,
  running: Record<number, boolean>,
  unreadPanes: Set<number>,
  hook: Record<number, AgentState | undefined>,
  turn: Record<number, { monitoring?: boolean } | undefined>,
  rowStates: Record<string, RowInfo>,
): RowAt {
  const mine = panes.filter((p) => sameDir(p.cwd, d));
  const states = mine.filter((p) => !p.seats).map((p) => statusOf(p) ?? paneState(p.agent, running[p.key]));
  const state = states.length > 0 ? strongest(states) : null;
  const watching = dirMonitoring(mine.map((p) => ({ state: hook[p.key], monitoring: turn[p.key]?.monitoring })));
  const mark = dirMark(state, mine.some((p) => unreadPanes.has(p.key)), watching);
  if (!mark) return null;
  // The age is the grid row's while it says the same thing; a worktree row has no grid row, so no age.
  const row = Object.entries(rowStates).find(([x]) => sameDir(x, d))?.[1];
  return { mark, since: row && row.state === state ? row.changed : 0 };
}
