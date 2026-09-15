import React, { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useWorktreeAgentRows } from './useWorktreeAgentRows'
import { selectLivePtyIdsForWorktree } from './worktree-card-status-inputs'
import { selectTerminalLayoutsForWorktree } from './worktree-agent-row-selectors'
import { EMPTY_TABS } from './WorktreeCardHelpers'
import { CompactAgentExpansion } from './worktree-card-compact-agents'
import { useWorktreeAgentExpansionState } from './worktree-card-agents-expansion-state'
import {
  aggregateWorktreeSessionState,
  buildWorktreeSessionRows,
  totalSessionTerminalCount
} from './worktree-session-rows'
import { WorktreeSessionRowView, WorktreeSessionSummaryButton } from './worktree-card-session-row'

type Props = {
  worktreeId: string
  className?: string
}

/** Inline SESSION list rendered inside WorktreeCard when 'inline-agents' is enabled — one row per open tab, never per agent. */
const WorktreeCardSessions = React.memo(function WorktreeCardSessions({
  worktreeId,
  className
}: Props) {
  const tabs = useAppStore((s) => s.tabsByWorktree[worktreeId] ?? EMPTY_TABS)
  const ptyIdsByTabId = useAppStore(useShallow((s) => selectLivePtyIdsForWorktree(s, worktreeId)))
  const terminalLayoutsByTabId = useAppStore(
    useShallow((s) => selectTerminalLayoutsForWorktree(s, worktreeId))
  )
  const generatedTitlesEnabled = useAppStore((s) => s.settings?.tabAutoGenerateTitle === true)
  // Why: reuse the same per-worktree agent rows the dashboard uses instead of
  // re-deriving agent state, then collapse per-agent state to a per-session dot.
  const agents = useWorktreeAgentRows(worktreeId)
  const { compactRootListExpanded, toggleCompactRootList } =
    useWorktreeAgentExpansionState(worktreeId)

  const sessions = useMemo(
    () =>
      buildWorktreeSessionRows({
        tabs,
        agents,
        ptyIdsByTabId,
        terminalLayoutsByTabId,
        generatedTitlesEnabled
      }),
    [tabs, agents, ptyIdsByTabId, terminalLayoutsByTabId, generatedTitlesEnabled]
  )

  const handleActivate = useCallback(
    (tabId: string) => {
      // Why: every terminal lives in its own OS window now — a session row opens or
      // focuses that window instead of switching the (terminal-free) main window.
      void window.api.terminalWindows.open({
        worktreeId,
        tabId,
        ptyId: ptyIdsByTabId[tabId]?.[0]
      })
    },
    [worktreeId, ptyIdsByTabId]
  )

  const stopBubble = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  if (sessions.length === 0) {
    return null
  }

  const aggregateState = aggregateWorktreeSessionState(sessions)
  const totalTerminalCount = totalSessionTerminalCount(sessions)

  return (
    <div
      className={cn('flex flex-col mt-1 gap-0.5', className)}
      onClick={stopBubble}
      onDoubleClick={stopBubble}
      onMouseDown={stopBubble}
      onPointerDown={stopBubble}
      role="group"
      aria-label={translate('auto.components.sidebar.WorktreeCardSessions.9a5f2c6b1d', 'Sessions')}
      data-compact-session-list="true"
    >
      <div
        className={cn(
          'compact-agent-summary-panel',
          compactRootListExpanded && 'compact-agent-summary-panel-expanded'
        )}
      >
        <WorktreeSessionSummaryButton
          sessionCount={sessions.length}
          totalTerminalCount={totalTerminalCount}
          aggregateState={aggregateState}
          expanded={compactRootListExpanded}
          onToggle={toggleCompactRootList}
        />
        <CompactAgentExpansion expanded={compactRootListExpanded}>
          {sessions.map((session) => (
            <WorktreeSessionRowView
              key={session.tabId}
              session={session}
              onActivate={handleActivate}
            />
          ))}
        </CompactAgentExpansion>
      </div>
    </div>
  )
})

export default WorktreeCardSessions
