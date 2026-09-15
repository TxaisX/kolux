import { useAppStore } from '@/store'
import { revealDashboardAgent } from '@/components/dashboard/reveal-dashboard-agent'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { FloorLane } from './floor-types'

/** "Open in Code": switch to Code mode and activate the lane's worktree/tab,
 *  reusing the same reveal path the Agent Dashboard uses. */
export function openFloorLaneInCode(lane: FloorLane, hostId: string): void {
  useAppStore.getState().setActiveView('terminal')
  revealDashboardAgent({
    repoId: lane.repoId,
    worktreeId: lane.worktreeId,
    executionHostId: hostId as ExecutionHostId,
    tabId: lane.tabId,
    leafId: parsePaneKey(lane.paneKey)?.leafId ?? null
  })
}

/** "Open in Inbox": the Inbox page selects its own item, so switching modes is enough. */
export function openFloorLaneInInbox(): void {
  useAppStore.getState().setActiveView('inbox')
}
