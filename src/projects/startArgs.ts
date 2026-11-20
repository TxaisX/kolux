/** The start line the back end builds for an agent (the shape App's start line has). */
export type AgentLine = { args: string[]; typed: string | null; program: string | null; env: [string, string][] };

/**
 * cli FIX-8: the pane fields a start takes from its start line: the program, its arguments, the
 * environment and the text typed first. The pane hands `env` to terminal_spawn as it is.
 */
export function startFields(line: AgentLine, agentProgram: string | null) {
  return { program: line.program ?? agentProgram, args: line.args, env: line.env, typed: line.typed ?? undefined };
}
