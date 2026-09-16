import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import {
  deriveNotesSendAgentTargets,
  type NotesSendAgentTarget
} from '@/lib/notes-send-agent-targets'
import {
  orderSendTargetsByWorktreeAgentRows,
  type OrderedSendTarget
} from '@/components/editor/ReviewNotesSendMenuContent'
import { selectLivePtyIdsForWorktree } from '@/components/sidebar/worktree-card-status-inputs'
import { useWorktreeAgentRows } from '@/components/sidebar/useWorktreeAgentRows'
import { isTerminalLeafId, makePaneKey } from '../../../../shared/stable-pane-id'

export type WorkspaceComposerTarget = OrderedSendTarget
export type { NotesSendAgentTarget }

/** Every running agent of the workspace, ordered like the sidebar/dashboard rows. */
export function useWorkspaceComposerTargets(worktreeId: string): WorkspaceComposerTarget[] {
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const terminalLayoutsByTabId = useAppStore((s) => s.terminalLayoutsByTabId)
  const ptyIdsByTabId = useAppStore(useShallow((s) => selectLivePtyIdsForWorktree(s, worktreeId)))
  const runtimePaneTitlesByTabId = useAppStore((s) => s.runtimePaneTitlesByTabId)
  const agentStatusEpoch = useAppStore((s) => s.agentStatusEpoch)
  const agentRows = useWorktreeAgentRows(worktreeId)

  const sendTargets = useMemo(() => {
    // Why: stale-boundary timers bump this epoch without replacing the
    // status map, so eligibility must derive again when freshness flips.
    void agentStatusEpoch
    return deriveNotesSendAgentTargets(
      {
        agentStatusByPaneKey,
        tabsByWorktree,
        terminalLayoutsByTabId,
        ptyIdsByTabId,
        runtimePaneTitlesByTabId
      },
      worktreeId
    )
  }, [
    agentStatusEpoch,
    agentStatusByPaneKey,
    tabsByWorktree,
    terminalLayoutsByTabId,
    runtimePaneTitlesByTabId,
    ptyIdsByTabId,
    worktreeId
  ])

  return useMemo(
    () => orderSendTargetsByWorktreeAgentRows(sendTargets, agentRows),
    [agentRows, sendTargets]
  )
}

export type FocusedWorkspacePane = { tabId: string; leafId: string; paneKey: string }

/** The pane the workspace's terminal grid currently has focused, if any —
 *  used both as the composer's default-target rule and as where Escape
 *  should send keyboard focus back to. */
export function useFocusedWorkspacePane(worktreeId: string): FocusedWorkspacePane | null {
  const activeTabType = useAppStore((s) => s.activeTabType)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const activeTabIdByWorktree = useAppStore((s) => s.activeTabIdByWorktree)
  const terminalLayoutsByTabId = useAppStore((s) => s.terminalLayoutsByTabId)

  return useMemo(() => {
    const tabId =
      activeTabType === 'terminal'
        ? (activeTabId ?? activeTabIdByWorktree[worktreeId])
        : activeTabIdByWorktree[worktreeId]
    if (!tabId) {
      return null
    }
    const leafId = terminalLayoutsByTabId[tabId]?.activeLeafId
    if (!leafId || !isTerminalLeafId(leafId)) {
      return null
    }
    return { tabId, leafId, paneKey: makePaneKey(tabId, leafId) }
  }, [activeTabType, activeTabId, activeTabIdByWorktree, terminalLayoutsByTabId, worktreeId])
}
