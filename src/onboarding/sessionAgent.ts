// 49-ux2: the agent the wizard's Open a session would start (the default first), or null when none is
// installed and switched on. One rule shared by useWizard (what the click does) and Wizard (when the
// last button is held back), so the two never disagree.
import type { AgentInfo } from "../launch/PlusMenu";
import { defaultAgentId, menuAgents, offeredAgents } from "../launch/agents";

export const sessionAgent = (agents: AgentInfo[], settings: Record<string, unknown> | null | undefined): AgentInfo | null =>
  menuAgents(offeredAgents(agents, settings ?? {}), defaultAgentId(settings))[0] ?? null;
