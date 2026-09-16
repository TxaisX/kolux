import { useAppStore } from '@/store'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { collectLeafGroupIds } from '../pane-layout/tidy-layout'
import {
  regridToCurrentLeaves,
  splitPaneForNewSession
} from '../pane-layout/split-pane-for-new-session'
import type { TuiAgent } from '../../../../shared/tui-agent'

export type LaunchAgentSession = { agent: TuiAgent; prompt: string }

/**
 * Opens one pane per session inside `worktreeId` — never a new workspace —
 * keeping the grid balanced as it grows. Returns how many sessions launched.
 */
export function launchAgentsIntoWorkspace(
  worktreeId: string,
  sessions: readonly LaunchAgentSession[]
): number {
  let launched = 0
  for (const session of sessions) {
    const layout = useAppStore.getState().layoutByWorktree[worktreeId]
    const sourceGroupId = layout ? collectLeafGroupIds(layout)[0] : undefined
    // Why: a workspace with no panes yet gets its first group from createTab itself.
    const groupId = sourceGroupId
      ? splitPaneForNewSession(useAppStore.getState, worktreeId, sourceGroupId)
      : null
    const result = launchAgentInNewTab({
      agent: session.agent,
      worktreeId,
      ...(groupId ? { groupId } : {}),
      prompt: session.prompt,
      // Why: a role brief plus the shared task is a generated multi-line prompt — too
      // big for argv, and the wave is useless if it lands as an unsent draft.
      ...(session.prompt.trim() ? { promptDelivery: 'submit-after-ready' as const } : {}),
      launchSource: 'sidebar'
    })
    if (!result) {
      if (groupId && groupId !== sourceGroupId) {
        useAppStore.getState().closeEmptyGroup(worktreeId, groupId)
        regridToCurrentLeaves(useAppStore.getState(), worktreeId)
      }
      continue
    }
    launched += 1
  }
  return launched
}
