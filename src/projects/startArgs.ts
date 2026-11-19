import type { CliWorkspace } from "./model";

/** T-172-e: the variable a worker start puts in its first session's environment (the runtime's DISPATCH_ENV). */
export const DISPATCH_ENV = "KOLUX_DISPATCH_ID";

type StartLine = [string, string][];

/**
 * cli FIX-7: the environment the agent's first session starts with. A worker start (it has a
 * dispatch id) ends the list with its own KOLUX_DISPATCH_ID, and any entry for that name the
 * agent's settings already held is dropped, so the runtime reads the real dispatch and a value the
 * user set can never stand in for it. A start without one (a tab the user opens) is unchanged.
 */
export function sessionEnv(env: StartLine, dispatch?: string): StartLine {
  if (!dispatch) return env;
  return [...env.filter(([k]) => k !== DISPATCH_ENV), [DISPATCH_ENV, dispatch]];
}

/** What the "start" notice from the runtime hands startIn after the folder: prompt, show, extra, title, dispatch. */
export function startTail(p: Extract<CliWorkspace, { kind: "start" }>): [string, boolean, string[], string | undefined, string | undefined] {
  return [p.prompt, false, p.extra, p.title ?? undefined, p.dispatch];
}

/** The start line the back end builds for an agent (the shape App's start line has). */
export type AgentLine = { args: string[]; typed: string | null; program: string | null; env: [string, string][] };

/**
 * cli FIX-8: the pane fields a start takes from its start line: the program, its arguments, the
 * environment (with the worker's dispatch id, see sessionEnv) and the text typed first. The pane
 * hands `env` to terminal_spawn as it is, so this is what the runtime reads the dispatch from.
 */
export function startFields(line: AgentLine, agentProgram: string | null, dispatch?: string) {
  return { program: line.program ?? agentProgram, args: line.args, env: sessionEnv(line.env, dispatch), typed: line.typed ?? undefined };
}
