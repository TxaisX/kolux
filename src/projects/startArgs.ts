import type { CliWorkspace } from "./model";

/** T-172-e: the variable a worker start puts in its first session's environment (the runtime's DISPATCH_ENV). */
export const DISPATCH_ENV = "KOLUX_DISPATCH_ID";
/** T-690: the variable an automation run's pane carries, so the runtime credits the pane to that run (automations::RUN_ENV). */
export const RUN_ENV = "KOLUX_RUN_ID";

type StartLine = [string, string][];

/**
 * cli FIX-7: the environment the agent's first session starts with. A worker start (it has a
 * dispatch id) ends the list with its own KOLUX_DISPATCH_ID, and any entry for that name the
 * agent's settings already held is dropped, so the runtime reads the real dispatch and a value the
 * user set can never stand in for it. T-690: an automation run's start does the same with its run
 * id, and a KOLUX_RUN_ID from the agent's settings is always dropped, so a tab the user opens is
 * never credited to a run by it. A start with neither (a tab the user opens) is otherwise unchanged.
 */
export function sessionEnv(env: StartLine, dispatch?: string, run?: string): StartLine {
  const own: StartLine = [];
  if (dispatch) own.push([DISPATCH_ENV, dispatch]);
  if (run) own.push([RUN_ENV, run]);
  if (!own.length && !env.some(([k]) => k === RUN_ENV)) return env;
  return [...env.filter(([k]) => k !== RUN_ENV && !own.some(([o]) => o === k)), ...own];
}

/** What the "start" notice from the runtime hands startIn after the folder: prompt, show, extra, title, dispatch, run. */
export function startTail(p: Extract<CliWorkspace, { kind: "start" }>): [string, boolean, string[], string | undefined, string | undefined, string | undefined] {
  return [p.prompt, false, p.extra, p.title ?? undefined, p.dispatch, p.runId];
}

/** The start line the back end builds for an agent (the shape App's start line has). */
export type AgentLine = { args: string[]; typed: string | null; program: string | null; env: [string, string][] };

/**
 * cli FIX-8: the pane fields a start takes from its start line: the program, its arguments, the
 * environment (with the worker's dispatch id and an automation's run id, see sessionEnv) and the
 * text typed first. The pane hands `env` to terminal_spawn as it is, so this is what the runtime
 * reads the dispatch and the run from.
 */
export function startFields(line: AgentLine, agentProgram: string | null, dispatch?: string, run?: string) {
  return { program: line.program ?? agentProgram, args: line.args, env: sessionEnv(line.env, dispatch, run), typed: line.typed ?? undefined };
}
