import { useAppStore } from '@/store'
import { agentTypeToIconAgent } from '@/lib/agent-status'
import { agentRowDotState } from '@/lib/agent-row-dot-state'
import type { AgentDotState } from '@/components/AgentStateDot'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { TerminalLeafId } from '../../../../shared/stable-pane-id'
import type { TuiAgent } from '../../../../shared/tui-agent'

export type TerminalPaneHeaderAgent = {
  /** The agent running in this specific pane, null when unknown/plain shell. */
  agent: TuiAgent | null
  dotState: AgentDotState
}

/**
 * Resolves which agent a single pane is running, for the header's logo mark.
 * A tab can hold several panes running different agents, so identity is
 * per-pane: live hook evidence (agentStatusByPaneKey, keyed by leafId) first,
 * then the tab's launch intent — same fallback order as
 * prepareAgentSessionForkFromPane (terminal-agent-session-fork.ts).
 */
export function useTerminalPaneHeaderAgent(
  tabId: string,
  worktreeId: string,
  leafId: TerminalLeafId
): TerminalPaneHeaderAgent {
  const paneKey = makePaneKey(tabId, leafId)
  const entry = useAppStore((s) => s.agentStatusByPaneKey[paneKey])
  const launchAgent = useAppStore(
    (s) => s.tabsByWorktree[worktreeId]?.find((tab) => tab.id === tabId)?.launchAgent ?? null
  )
  const agent = agentTypeToIconAgent(entry?.agentType) ?? launchAgent
  const dotState = entry ? agentRowDotState(entry.state, entry.workingMode) : 'idle'
  return { agent, dotState }
}
