import type { DashboardAgentRow } from '@/components/dashboard/useDashboardData'
import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import { resolveTerminalTabTitle } from '../../../../shared/tab-title-resolution'
import type {
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode,
  TerminalTab
} from '../../../../shared/terminal-tab-types'
import { getAgentDotState } from './worktree-card-agent-summary'

// Why: the sidebar shows SESSIONS (tabs), not agents — this is the FROZEN
// four-word vocabulary for a session's dot, collapsed down from the much
// finer-grained per-agent AgentDotState.
export type WorktreeSessionState = 'live' | 'needs you' | 'unverifiable' | 'done'

export type WorktreeSessionRow = {
  tabId: string
  title: string
  terminalCount: number
  state: WorktreeSessionState
}

const NEEDS_YOU_AGENT_STATES = new Set(['waiting', 'blocked', 'permission'])
const LIVE_AGENT_STATES = new Set(['working', 'monitoring'])

function countTerminalLayoutLeaves(node: TerminalPaneLayoutNode | null | undefined): number {
  if (!node) {
    return 0
  }
  if (node.type === 'leaf') {
    return 1
  }
  return countTerminalLayoutLeaves(node.first) + countTerminalLayoutLeaves(node.second)
}

function sessionStateFromAgents(
  agents: readonly DashboardAgentRow[],
  hasLivePty: boolean
): WorktreeSessionState {
  let sawUnverifiable = false
  let sawLive = false
  let sawOutcome = false
  for (const agent of agents) {
    const state = getAgentDotState(agent)
    if (NEEDS_YOU_AGENT_STATES.has(state)) {
      return 'needs you'
    }
    if (state === 'unverifiable') {
      sawUnverifiable = true
    } else if (LIVE_AGENT_STATES.has(state)) {
      sawLive = true
    } else {
      // done / idle / interrupted / failed: an outcome, not live activity.
      sawOutcome = true
    }
  }
  if (sawUnverifiable) {
    return 'unverifiable'
  }
  if (sawLive) {
    return 'live'
  }
  if (sawOutcome) {
    return 'done'
  }
  return hasLivePty ? 'live' : 'done'
}

/** Build one row per open terminal tab (session) in a worktree — no per-agent or subagent rows. */
export function buildWorktreeSessionRows(args: {
  tabs: readonly TerminalTab[]
  agents: readonly DashboardAgentRow[]
  ptyIdsByTabId: Record<string, string[]>
  terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot | undefined>
  generatedTitlesEnabled: boolean
}): WorktreeSessionRow[] {
  const agentsByTabId = new Map<string, DashboardAgentRow[]>()
  for (const agent of args.agents) {
    const tabId = agent.tab?.id
    if (!tabId) {
      continue
    }
    const bucket = agentsByTabId.get(tabId)
    if (bucket) {
      bucket.push(agent)
    } else {
      agentsByTabId.set(tabId, [agent])
    }
  }
  return args.tabs.map((tab) => {
    const leafCount = countTerminalLayoutLeaves(args.terminalLayoutsByTabId[tab.id]?.root)
    return {
      tabId: tab.id,
      title: resolveTerminalTabTitle(tab, args.generatedTitlesEnabled, tab.title || 'Terminal'),
      terminalCount: leafCount > 0 ? leafCount : 1,
      state: sessionStateFromAgents(
        agentsByTabId.get(tab.id) ?? [],
        tabHasLivePty(args.ptyIdsByTabId, tab.id)
      )
    }
  })
}

const STATE_PRIORITY: readonly WorktreeSessionState[] = [
  'needs you',
  'unverifiable',
  'live',
  'done'
]

/** Worst-first rollup for the collapsed workspace-row dot. */
export function aggregateWorktreeSessionState(
  rows: readonly Pick<WorktreeSessionRow, 'state'>[]
): WorktreeSessionState {
  for (const state of STATE_PRIORITY) {
    if (rows.some((row) => row.state === state)) {
      return state
    }
  }
  return 'done'
}

/** Total terminal count across every session — the workspace-row badge value. */
export function totalSessionTerminalCount(
  rows: readonly Pick<WorktreeSessionRow, 'terminalCount'>[]
): number {
  return rows.reduce((sum, row) => sum + row.terminalCount, 0)
}
