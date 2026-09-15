import React, { useCallback } from 'react'
import { ChevronDown, CircleDashed } from 'lucide-react'
import { AgentQuestionIcon } from '@/components/AgentQuestionIcon'
import { SessionCountBadge } from '@/components/session-rail/SessionCountBadge'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { WorktreeSessionRow, WorktreeSessionState } from './worktree-session-rows'

function stopActivationKeyPropagation(e: React.KeyboardEvent): void {
  // Why: the surrounding worktree list handles Enter/Space as row activation.
  if (e.key === 'Enter' || e.key === ' ') {
    e.stopPropagation()
  }
}

function stopPointerPropagation(e: React.SyntheticEvent): void {
  e.stopPropagation()
}

// Why: colors reuse the exact tokens AgentStateDot already uses for these same
// meanings — never invent a new color for the session vocabulary.
export function WorktreeSessionStateDot({
  state
}: {
  state: WorktreeSessionState
}): React.JSX.Element {
  if (state === 'needs you') {
    return (
      <span className="inline-flex size-2.5 shrink-0 items-center justify-center">
        <AgentQuestionIcon className="size-2.5" />
      </span>
    )
  }
  if (state === 'unverifiable') {
    return (
      <span className="inline-flex size-2.5 shrink-0 items-center justify-center">
        <CircleDashed className="size-2.5 text-amber-500" aria-hidden="true" />
      </span>
    )
  }
  return (
    <span className="inline-flex size-2.5 shrink-0 items-center justify-center">
      <span
        className={cn(
          'block size-1.5 rounded-full',
          state === 'live' ? 'bg-emerald-500' : 'bg-neutral-500/40'
        )}
      />
    </span>
  )
}

// Why: middle-truncation (head ellipsizes, tail stays whole) reads better than
// end-truncation for names like "Work on Terminal retry errors in Support" —
// the distinguishing tail survives instead of getting clipped.
const MIDDLE_TRUNCATE_TAIL_LENGTH = 10

function splitForMiddleTruncation(text: string): { head: string; tail: string } {
  if (text.length <= MIDDLE_TRUNCATE_TAIL_LENGTH) {
    return { head: text, tail: '' }
  }
  return {
    head: text.slice(0, text.length - MIDDLE_TRUNCATE_TAIL_LENGTH),
    tail: text.slice(text.length - MIDDLE_TRUNCATE_TAIL_LENGTH)
  }
}

type WorktreeSessionRowProps = {
  session: WorktreeSessionRow
  onActivate: (tabId: string) => void
}

export const WorktreeSessionRowView = React.memo(function WorktreeSessionRowView({
  session,
  onActivate
}: WorktreeSessionRowProps): React.JSX.Element {
  const { head, tail } = splitForMiddleTruncation(session.title)
  const handleActivate = useCallback(() => onActivate(session.tabId), [onActivate, session.tabId])
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        onActivate(session.tabId)
      }
    },
    [onActivate, session.tabId]
  )
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={false}
      title={session.title}
      className="worktree-session-row worktree-agent-row-hover flex h-6 min-w-0 cursor-pointer items-center gap-1 rounded-sm px-1 text-[11px] leading-none text-muted-foreground"
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
      onMouseDown={stopPointerPropagation}
      onPointerDown={stopPointerPropagation}
      onDragStart={stopPointerPropagation}
    >
      <WorktreeSessionStateDot state={session.state} />
      <span className="flex min-w-0 flex-1 overflow-hidden">
        <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {head}
        </span>
        {tail && <span className="shrink-0 whitespace-nowrap">{tail}</span>}
      </span>
      {/* Why: SessionCountBadge already renders nothing at 0 — feed it 0 to hide a boring "1". */}
      <SessionCountBadge count={session.terminalCount > 1 ? session.terminalCount : 0} />
    </div>
  )
})

type WorktreeSessionSummaryButtonProps = {
  sessionCount: number
  totalTerminalCount: number
  aggregateState: WorktreeSessionState
  expanded: boolean
  onToggle: () => void
}

export function WorktreeSessionSummaryButton({
  sessionCount,
  totalTerminalCount,
  aggregateState,
  expanded,
  onToggle
}: WorktreeSessionSummaryButtonProps): React.JSX.Element {
  const handleToggle = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      onToggle()
    },
    [onToggle]
  )
  const label =
    sessionCount === 1
      ? translate('auto.components.sidebar.worktree.card.session.row.f3a1c9a204', '1 session')
      : translate(
          'auto.components.sidebar.worktree.card.session.row.6b9d2e7c1a',
          '{{value0}} sessions',
          { value0: sessionCount }
        )
  return (
    <button
      type="button"
      draggable={false}
      className={cn(
        'compact-agent-summary-button group/agent-summary flex h-6 w-full min-w-0 items-center gap-1 rounded-sm',
        'px-1 text-left text-[11px] leading-none text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring',
        'hover:bg-worktree-sidebar-accent/55 dark:hover:bg-worktree-sidebar-foreground/[0.035]',
        expanded
          ? 'compact-agent-summary-button-expanded'
          : 'border border-worktree-sidebar-border/70 bg-worktree-sidebar-accent/35'
      )}
      aria-label={
        expanded
          ? translate(
              'auto.components.sidebar.worktree.card.session.row.6ef1a6e7be',
              'Collapse {{value0}}',
              { value0: label }
            )
          : translate(
              'auto.components.sidebar.worktree.card.session.row.6f6a4f4ea3',
              'Expand {{value0}}',
              { value0: label }
            )
      }
      aria-expanded={expanded}
      onClick={handleToggle}
      onKeyDown={stopActivationKeyPropagation}
      onMouseDown={stopPointerPropagation}
      onPointerDown={stopPointerPropagation}
      onDragStart={stopPointerPropagation}
    >
      <WorktreeSessionStateDot state={aggregateState} />
      <span className="min-w-0 flex-1 truncate px-1 font-medium text-muted-foreground">
        {label}
      </span>
      <SessionCountBadge count={totalTerminalCount} />
      <ChevronDown
        className={cn(
          'size-3 shrink-0 transition-transform duration-150',
          !expanded && '-rotate-90'
        )}
        aria-hidden
      />
    </button>
  )
}
