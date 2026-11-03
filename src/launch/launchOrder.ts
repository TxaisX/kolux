// SESS-026 (T-150): setup scripts and hook trust are settled before any agent starts. The order is
// fixed: each new workspace's setup settles first (its trust question answered, then its Setup
// terminal opened, or a visible reason why it did not run), then the agent's hook trust is written,
// then the agents start. A project set to ask about setup for each workspace cannot be
// bulk-launched: the launch is refused before any workspace is made or any agent starts.
import { waitsForSetup, type SetupLine, type SetupWhere } from "../projects/model";

/** Where a repository's setup opens in a new workspace (Rust's setup launch mode); `ask` asks each time. */
export type SetupMode = SetupWhere | "ask";
/** SESS-026 / TERM-121: a new tab unless the repository chose otherwise. */
export const DEFAULT_SETUP_MODE: SetupMode = "tab";
const MODES: readonly SetupMode[] = ["tab", "right", "down", "ask"];

/** The mode repo_setup_get reports; anything else, or nothing (an older back end), is a new tab. */
export function setupMode(v: unknown): SetupMode {
  return MODES.includes(v as SetupMode) ? (v as SetupMode) : DEFAULT_SETUP_MODE;
}

/** Where the New workspace dialog's "setup opens in" starts: the repository's own mode; the dialog is itself the ask, so `ask` starts at a tab. */
export function dialogWhere(mode: SetupMode): SetupWhere {
  return mode === "ask" ? "tab" : mode;
}

/** The error a bulk launch shows, or null when it may go ahead. Only a launch that makes new
 *  workspaces is refused: seats in a workspace that already exists run no setup. */
export function bulkRefusal(project: string, mode: SetupMode, makesWorkspaces: boolean): string | null {
  if (mode !== "ask" || !makesWorkspaces) return null;
  return `${project} asks about setup for each new workspace, so it cannot be bulk-launched; nothing was started. Set its setup to open in a new tab in Settings > Repositories, or make the workspaces one at a time.`;
}

export type NewPlace = { cwd: string; branch: string | null };

/** The failure sentence, plus what happened to the workspaces made before it. */
export function failureNote(err: unknown, made: number): string {
  const text = String(err);
  return made > 0 ? `${text} ${made} new ${made === 1 ? "workspace was" : "workspaces were"} already made; ${made === 1 ? "it is" : "they are"} in the sidebar.` : text;
}

export type SetupSteps = {
  /** The trust question (only for the repository's shared script) and the Setup terminal's line;
   *  null when there is no script or the user said Don't run. */
  line: (dir: string) => Promise<SetupLine | null>;
  /** Opens the Setup terminal; the promise settles when the script ends. */
  open: (dir: string, branch: string | null, line: SetupLine, where: SetupWhere) => Promise<void>;
  /** Shows why a setup did not run; the launch goes on. */
  say: (message: string) => void;
};

export type Settled = { dir: string; ran: boolean; failed?: string };

function folder(dir: string): string {
  return dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || dir;
}

/** Settles each new workspace's setup in turn, so trust questions come one at a time and all before
 *  any agent starts. A workspace listed twice (seats sharing one folder) is set up once. When the
 *  repository says the agent waits (new-tab mode only, PROJ-033), this also waits for the script to
 *  end, whatever its exit code. A setup that cannot start is said, and its agent starts without it. */
export async function settleSetups(places: NewPlace[], mode: SetupMode, wait: boolean, steps: SetupSteps): Promise<Settled[]> {
  const where: SetupWhere = mode === "ask" ? "tab" : mode;
  const done = new Set<string>();
  const out: Settled[] = [];
  for (const { cwd, branch } of places) {
    if (done.has(cwd)) continue;
    done.add(cwd);
    try {
      const line = await steps.line(cwd);
      if (!line) {
        out.push({ dir: cwd, ran: false });
        continue;
      }
      const ended = steps.open(cwd, branch, line, where);
      if (waitsForSetup(where, wait, true, true)) await ended;
      else ended.catch(() => undefined);
      out.push({ dir: cwd, ran: true });
    } catch (err) {
      const why = (err instanceof Error ? err.message : String(err)).replace(/\.\s*$/, "");
      const failed = `Setup for ${folder(cwd)} did not run (${why}); its agent starts without it.`;
      steps.say(failed);
      out.push({ dir: cwd, ran: false, failed });
    }
  }
  return out;
}

export type LaunchSteps<T> = SetupSteps & {
  /** Writes the agents' hook and folder trust (SAFE-023); best effort, never stops the launch. */
  trustHooks: () => Promise<void>;
  /** Builds the start lines and starts the agents. */
  start: () => Promise<T>;
};

/** The whole order for one launch: setups settled, then hook trust, then the agents. */
export async function launchInOrder<T>(places: NewPlace[], mode: SetupMode, wait: boolean, steps: LaunchSteps<T>): Promise<T> {
  await settleSetups(places, mode, wait, steps);
  await steps.trustHooks();
  return steps.start();
}
