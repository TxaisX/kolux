// Cycle 2 (the App.tsx split): what the window's action factories (launch/launchActions.ts,
// terminal/paneActions.ts, terminal/reviewActions.ts) read from the window when an action runs, not when
// they are made. In App.tsx these actions were closures over values the window makes further down its
// render (a later hook, a later ref); the window now hands the factories one object per render, `w`,
// and fills it before it draws, so an action made in a render reads that render's values, as before.
// ponytail: the values are typed here by hand, where the factories' own types would be circular; a new
// late value needs a line here. Upgrade path: move the hooks that make them above the factories.
import type { Kept } from "../inbox/exitedPrompt";
import type { Lineup } from "../launch/seats";
import type { useWorkspaceActions } from "../projects/useWorkspaces";
import type { useAgentEvents } from "../status/useAgentStatus";

type WorkspaceActions = ReturnType<typeof useWorkspaceActions>;

export type WindowLate = Pick<WorkspaceActions, "projectOf" | "select"> & {
  /** SESS-021: lineups waiting for their first agent to start, by batch. */
  pendingLineup: { current: Record<number, { pid: string; lineup: Lineup }> };
  /** PROJ-077: the command line's handlers, read through a ref so its listener never goes stale. */
  cli: { current: Pick<WorkspaceActions, "select"> };
  /** T-035-b: the prompt an exited program left open. */
  exitedPrompt: { current: Kept };
  setReveal: (next: number | ((n: number) => number)) => void;
  panesRef: ReturnType<typeof useAgentEvents>["panesRef"];
};
