import React, { useMemo } from 'react'
import { useAppStore } from '@/store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { translate } from '@/i18n/i18n'
import { agentStateLabel, AgentStateDot, type AgentDotState } from '@/components/AgentStateDot'
import { formatCompactDuration } from '@/lib/agent-row-decay-state'
import { deriveRunningAgentSendTargets } from '@/lib/running-agent-targets'
import { parseInteractivePrompt } from '@/components/native-chat/native-chat-interactive-prompt'
import { useNativeChatInteractiveSend } from '@/components/native-chat/use-native-chat-interactive-send'
import { NativeChatQuestionCard } from '@/components/native-chat/NativeChatQuestionCard'
import { NativeChatApprovalCard } from '@/components/native-chat/NativeChatApprovalCard'
import { openInboxItemInCode } from './inbox-open-in-code'
import type { InboxItem, InboxItemKind } from './inbox-items'

const KIND_DOT_STATE: Record<InboxItemKind, AgentDotState> = {
  question: 'permission',
  permission: 'permission',
  running: 'working',
  unverifiable: 'unverifiable',
  done: 'done'
}

function OpenInCodeButton({ item }: { item: InboxItem }): React.JSX.Element {
  return (
    <Button variant="outline" size="sm" onClick={() => openInboxItemInCode(item)} className="gap-2">
      {translate('components.inbox.detail.openInCode', 'Open in Code')}
      <ShortcutKeyCombo keys={['Enter']} />
    </Button>
  )
}

/** Resolve the live ptyId for this item's pane via the same store-state fallback
 *  WorktreeCardAgents uses to send a message to a running agent without a mounted pane. */
function useInboxSendTarget(item: InboxItem): string | null {
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const terminalLayoutsByTabId = useAppStore((s) => s.terminalLayoutsByTabId)
  const ptyIdsByTabId = useAppStore((s) => s.ptyIdsByTabId)
  return useMemo(() => {
    const target = deriveRunningAgentSendTargets(
      { agentStatusByPaneKey, tabsByWorktree, terminalLayoutsByTabId, ptyIdsByTabId },
      item.worktreeId
    ).find((t) => t.paneKey === item.paneKey)
    return target?.ptyId ?? null
  }, [
    agentStatusByPaneKey,
    tabsByWorktree,
    terminalLayoutsByTabId,
    ptyIdsByTabId,
    item.worktreeId,
    item.paneKey
  ])
}

function DecisionSurface({ item }: { item: InboxItem }): React.JSX.Element | null {
  const entry = useAppStore((s) => s.agentStatusByPaneKey[item.paneKey])
  const targetPtyId = useInboxSendTarget(item)
  const parsed = useMemo(
    () => parseInteractivePrompt(entry?.interactivePrompt, entry?.toolName),
    [entry?.interactivePrompt, entry?.toolName]
  )
  const interactiveSend = useNativeChatInteractiveSend(
    item.tabId,
    item.paneKey,
    targetPtyId,
    entry?.agentType ?? 'unknown'
  )

  if (item.kind !== 'question' && item.kind !== 'permission') {
    return null
  }

  // A live pty is required to write an answer back; without one, send from Code instead.
  // Why not wired further: this reuses the interactive-send plumbing outside its usual
  // mounted-chat-pane host, and hasn't been runtime-verified in this environment (see report).
  const canSendHere = Boolean(targetPtyId) && parsed !== null

  if (canSendHere && parsed?.kind === 'question') {
    return (
      <NativeChatQuestionCard
        prompt={parsed.prompt}
        onAnswer={(selections) => interactiveSend.sendAnswer(parsed.prompt, selections)}
        onCancel={interactiveSend.cancel}
      />
    )
  }
  if (canSendHere && parsed?.kind === 'approval') {
    return <NativeChatApprovalCard approval={parsed.approval} onChoose={interactiveSend.sendRaw} />
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <p className="text-sm text-foreground">{item.title}</p>
      <Button size="sm" onClick={() => openInboxItemInCode(item)} className="w-fit">
        {translate('components.inbox.detail.answerInCode', 'Answer in Code')}
      </Button>
    </div>
  )
}

export function InboxDetail({ item }: { item: InboxItem | null }): React.JSX.Element {
  if (!item) {
    return (
      <div className="flex flex-1 min-w-0 min-h-0 items-center justify-center p-6 text-sm text-muted-foreground">
        {translate('components.inbox.detail.empty', 'Select an item from the Inbox.')}
      </div>
    )
  }

  const [workspaceChip, branchChip] = item.workspaceLabel.split(' › ')

  return (
    <div className="flex flex-1 min-w-0 min-h-0 flex-col gap-4 overflow-y-auto scrollbar-sleek p-4">
      <div className="flex flex-col gap-2">
        <h2 className="truncate text-base font-semibold text-foreground">{item.title}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{workspaceChip}</Badge>
          {branchChip ? (
            <Badge variant="outline" className="font-mono">
              {branchChip}
            </Badge>
          ) : null}
          <Badge variant="outline">{item.hostLabel}</Badge>
          <Badge variant="outline">{item.agent}</Badge>
        </div>
      </div>

      <DecisionSurface item={item} />

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <AgentStateDot state={KIND_DOT_STATE[item.kind]} size="sm" />
        <span>{agentStateLabel(KIND_DOT_STATE[item.kind])}</span>
        <span>·</span>
        <span>{formatCompactDuration(item.ageMs)}</span>
      </div>

      {item.lastMessage ? (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.lastMessage}</p>
      ) : null}

      <div>
        <OpenInCodeButton item={item} />
      </div>
    </div>
  )
}
