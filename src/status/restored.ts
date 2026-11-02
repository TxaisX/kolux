// STAT-030 / T-167-b: the status a pane had when Kolux last ran, shown unconfirmed until a live
// event arrives. A restored permission is shown as waiting and carries no tool, so it can never
// drive the approve buttons; a pane whose hooks are from an older Kolux shows a blocked row asking
// for a terminal restart. The model is pure; useRestoredStatus.ts feeds it the window's state.
import type { AgentState } from "../projects/rows";
import type { Crew } from "../terminal/status";
import type { StopInfo } from "../terminal/notify";

/** One row of `agent_status_saved` (saved.rs Restored). */
export type SavedRow = { paneKey: number; agent: string; state: string; at: number; sessionId?: string; children?: Crew; unconfirmed: boolean; restart: boolean };

export const RESTART_TEXT = "Kolux was updated and its status hooks are from the older version";

const STATES: readonly string[] = ["permission", "blocked", "waiting", "interrupted", "working", "queued", "done", "idle"];

export type Restoration = {
  hook: Record<number, AgentState>;
  stale: Record<number, boolean>;
  crew: Record<number, Crew>;
  turn: Record<number, { stop: StopInfo }>;
};

/** The state a restored row shows: a permission reads waiting (nothing names a tool to answer). */
export function shownState(state: string): AgentState | null {
  if (!STATES.includes(state)) return null;
  return state === "permission" ? "waiting" : (state as AgentState);
}

/** What to put on the panes that have loaded (`paneKeys`) and have no live reading yet (`live`). T-618: pane numbers
 *  are reused, so a row goes only to a pane that came back from the saved layout (`back`, each with the session it was
 *  saved with) and, when the row names a session, carries that session; a new tab never wears a closed tab's status. */
export function restoration(rows: readonly SavedRow[], paneKeys: ReadonlySet<number>, live: ReadonlySet<number>, back: ReadonlyMap<number, string | undefined>): Restoration {
  const out: Restoration = { hook: {}, stale: {}, crew: {}, turn: {} };
  for (const row of rows) {
    if (!row.unconfirmed || !paneKeys.has(row.paneKey) || live.has(row.paneKey)) continue;
    if (!back.has(row.paneKey) || (row.sessionId !== undefined && back.get(row.paneKey) !== row.sessionId)) continue;
    if (row.restart) {
      out.hook[row.paneKey] = "blocked";
      out.turn[row.paneKey] = { stop: { cause: "restart", detail: RESTART_TEXT } };
      out.stale[row.paneKey] = true;
      continue;
    }
    const state = shownState(row.state);
    if (state === null) continue;
    out.hook[row.paneKey] = state;
    out.stale[row.paneKey] = true;
    if (row.children?.length) out.crew[row.paneKey] = row.children;
  }
  return out;
}
