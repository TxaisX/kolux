// START-03: a pane's conversation id is saved only once the conversation exists. Claude writes a
// conversation down at its first message, so an id taken from a bare SessionStart (a tab opened and
// never used) resumes nothing: `claude --resume <that id>` answers "No conversation found" and exits,
// every start. The hook report already says which reports are session boundaries (hooks.rs
// claude_change / codex_change marks a SessionStart and a manual compact `boundary: true`), so a
// report may claim its id only when it is not a boundary. Pure; the wiring is the claim call in
// status/useAgentStatus.ts.

import { claim } from "../sessions/ownership";

/** One agent-status report, as much of it as the claim decision reads: which pane it is for, the
 *  agent's conversation id when it named one, and whether the report is a session boundary. */
export type HookReport = { paneKey: number; session?: string; boundary?: boolean };

/** The id a report may claim: its trimmed `session` when it names one and is not a session boundary
 *  (a fresh start, a /clear or a resume is; so is a manual compact). Null otherwise, so SessionStart
 *  alone saves nothing and an empty or blank id claims nothing. A missing `boundary` is not a
 *  boundary. */
export function claimable(e: HookReport): string | null {
  const id = e.session?.trim() ?? "";
  return id !== "" && e.boundary !== true ? id : null;
}

/** The panes after report `e`: the same array when it claims nothing, otherwise `claim`'s result
 *  (ACCT-063: the pane that claims an id takes it, any other pane holding it lets go, and an unknown
 *  pane changes nothing). */
export function claimFrom<P extends { key: number; session?: string }>(panes: P[], e: HookReport): P[] {
  const id = claimable(e);
  return id === null ? panes : claim(panes, e.paneKey, id);
}
