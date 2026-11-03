// 49-ux2: the agent the wizard's Open a session would start (the default first), or null when none is
// installed and switched on. One rule shared by useWizard (what the click does) and Wizard (when the
// last button is held back), so the two never disagree.
import type { AgentInfo } from "../launch/PlusMenu";
import { defaultAgentId, menuAgents, offeredAgents } from "../launch/agents";

export const sessionAgent = (agents: AgentInfo[], settings: Record<string, unknown> | null | undefined): AgentInfo | null =>
  menuAgents(offeredAgents(agents, settings ?? {}), defaultAgentId(settings))[0] ?? null;

/** Why the last button picks a folder instead of opening a session while no agent is installed. */
export const NO_AGENT_WHY = "No AI agent is installed yet, so this opens a plain terminal in a folder. Install one in Settings > Agents, then check again.";

/** The wizard's last button: an agent session when one is installed, otherwise a folder (a plain terminal needs no agent). */
export const lastMain = (noAgent: boolean): "Open a session" | "Pick a folder" => (noAgent ? "Pick a folder" : "Open a session");

/** Reads the agent list now and again whenever another view installs or changes one (agents-changed). Returns the stop. */
export function followAgents(
  read: () => Promise<AgentInfo[]>,
  on: (cb: (list: unknown) => void) => Promise<() => void>,
  set: (list: AgentInfo[]) => void,
): () => void {
  let alive = true;
  const load = () => void read().then((l) => alive && set(l), () => {});
  load();
  const off = on((l) => alive && (Array.isArray(l) ? set(l as AgentInfo[]) : load()));
  return () => {
    alive = false;
    void off.then((f) => f());
  };
}
