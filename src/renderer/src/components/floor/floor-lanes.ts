import { AGENT_STATUS_STALE_AFTER_MS, type AgentStatusEntry } from '../../../../shared/agent-status-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { isExplicitAgentStatusFresh } from '@/lib/agent-status'
import { resolveDecayedAgentRowState, type AgentRowState } from '@/lib/agent-row-decay-state'
import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import { buildLaneSegments, floorLaneStatusText, floorSegmentKind } from './floor-lane-segments'
import { groupFloorLanesByHost, type FloorRawLane } from './floor-lane-tree'
import { resolveFloorRange } from './floor-range'
import type {
  FloorLanesResult,
  FloorRange,
  FloorTabInput,
  FloorWorktreeInput
} from './floor-types'

export type {
  FloorHost,
  FloorLane,
  FloorLanesResult,
  FloorRange,
  FloorSegment,
  FloorSegmentKind,
  FloorTabInput,
  FloorWorktreeInput
} from './floor-types'
export { buildFloorAxisTicks, resolveFloorRange, type FloorAxisTick } from './floor-range'

/** Resolve the tab id a pane belongs to: the entry's own attribution first,
 *  falling back to the pane key's embedded tab id. */
function resolvePaneTabId(paneKey: string, entry: AgentStatusEntry): string | null {
  return entry.tabId ?? parsePaneKey(paneKey)?.tabId ?? null
}

/** Current row state after applying the same staleness decay as the sidebar
 *  (isExplicitAgentStatusFresh + resolveDecayedAgentRowState). */
function resolveCurrentRowState(
  entry: AgentStatusEntry,
  hasLivePty: boolean,
  now: number
): AgentRowState {
  if (isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS)) {
    return entry.state
  }
  if (entry.state === 'working' || entry.state === 'blocked' || entry.state === 'waiting') {
    return resolveDecayedAgentRowState(entry, hasLivePty)
  }
  return entry.state
}

export function buildFloorLanes(args: {
  statuses: Record<string, AgentStatusEntry>
  tabsById: Record<string, FloorTabInput>
  worktreesById: Record<string, FloorWorktreeInput>
  ptyIdsByTabId?: Record<string, string[]>
  range: FloorRange
  now: number
}): FloorLanesResult {
  const rangeWindow = resolveFloorRange(args.range, args.now)
  const ptyIdsByTabId = args.ptyIdsByTabId ?? {}
  const rawLanes: FloorRawLane[] = []

  for (const [paneKey, entry] of Object.entries(args.statuses)) {
    const tabId = resolvePaneTabId(paneKey, entry)
    if (!tabId) {
      continue
    }
    const tab = args.tabsById[tabId]
    const worktreeId = entry.worktreeId ?? tab?.worktreeId
    const worktree = worktreeId ? args.worktreesById[worktreeId] : undefined
    if (!worktree) {
      // No worktree context to place this lane on the Floor (e.g. archived,
      // or a race between hook attribution and tab/worktree removal).
      continue
    }

    const hasLivePty = tabHasLivePty(ptyIdsByTabId, tabId)
    const rowState = resolveCurrentRowState(entry, hasLivePty, args.now)
    const state = floorSegmentKind(rowState)
    const statusText = floorLaneStatusText(entry, rowState, args.now)
    const segments = buildLaneSegments(entry, rowState, statusText, rangeWindow, args.now)
    const parentPaneKey = entry.orchestration?.parentPaneKey
    const role = entry.orchestration?.taskTitle ?? entry.orchestration?.displayName
    const startedAt = entry.stateHistory[0]?.startedAt ?? entry.stateStartedAt

    rawLanes.push({
      paneKey,
      tabId,
      worktreeId: worktree.id,
      repoId: worktree.repoId,
      repoName: worktree.repoName,
      branch: worktree.branch,
      title: tab?.title ?? worktree.name,
      agent: entry.agentType ?? 'unknown',
      role,
      parentPaneKey: parentPaneKey !== paneKey ? parentPaneKey : undefined,
      state,
      statusText,
      startedAt,
      prompt: entry.prompt?.trim() || entry.lastCompletedAssistantMessage?.trim() || undefined,
      segments,
      children: [],
      hostId: worktree.hostId,
      hostLabel: worktree.hostLabel,
      hostLive: worktree.hostLive
    })
  }

  return {
    hosts: groupFloorLanesByHost(rawLanes),
    range: rangeWindow
  }
}
