import React from 'react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { AgentStateDot, type AgentDotState } from '@/components/AgentStateDot'
import { formatCompactDuration } from '@/lib/agent-row-decay-state'
import type { InboxGroups, InboxItem, InboxItemKind } from './inbox-items'

const KIND_DOT_STATE: Record<InboxItemKind, AgentDotState> = {
  question: 'permission',
  permission: 'permission',
  running: 'working',
  unverifiable: 'unverifiable',
  done: 'done'
}

const KIND_BAR_CLASS: Record<InboxItemKind, string> = {
  question: 'border-l-agent-question',
  permission: 'border-l-agent-question',
  running: 'border-l-status-success',
  unverifiable: 'border-l-border',
  done: 'border-l-border'
}

function kindLabel(kind: InboxItemKind): string {
  switch (kind) {
    case 'question':
      return translate('components.inbox.list.kind.question', 'Question')
    case 'permission':
      return translate('components.inbox.list.kind.permission', 'Permission')
    case 'running':
      return translate('components.inbox.list.kind.running', 'Running')
    case 'unverifiable':
      return translate('components.inbox.list.kind.unverifiable', 'Unverifiable')
    case 'done':
      return translate('components.inbox.list.kind.done', 'Done')
  }
}

function InboxRow({
  item,
  selected,
  onSelect
}: {
  item: InboxItem
  selected: boolean
  onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid="inbox-row"
      aria-selected={selected}
      onClick={() => onSelect(item.id)}
      className={cn(
        'flex w-full flex-col gap-1 border-l-[3px] px-3 py-2 text-left text-sm hover:bg-accent/60',
        KIND_BAR_CLASS[item.kind],
        selected && 'bg-accent'
      )}
    >
      <div className="flex items-baseline gap-1.5 truncate">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {kindLabel(item.kind)}
        </span>
        <span className="truncate font-medium text-foreground">{item.title}</span>
      </div>
      <div className="flex items-center gap-1.5 truncate font-mono text-xs text-muted-foreground">
        <AgentStateDot state={KIND_DOT_STATE[item.kind]} size="sm" />
        <span className="truncate">{item.workspaceLabel}</span>
      </div>
      <div className="flex items-center justify-between gap-2 truncate text-xs text-muted-foreground/80">
        <span className="truncate">{item.lastMessage}</span>
        <span className="shrink-0 tabular-nums">{formatCompactDuration(item.ageMs)}</span>
      </div>
    </button>
  )
}

function InboxSection({
  label,
  items,
  selectedId,
  onSelect
}: {
  label: string
  items: InboxItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}): React.JSX.Element | null {
  if (items.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col">
      <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {label}
      </div>
      {items.map((item) => (
        <InboxRow key={item.id} item={item} selected={item.id === selectedId} onSelect={onSelect} />
      ))}
    </div>
  )
}

export function InboxList({
  groups,
  selectedId,
  onSelect
}: {
  groups: InboxGroups
  selectedId: string | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="flex w-80 shrink-0 flex-col border-r border-border min-h-0">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-sm font-medium">
        <span>{translate('components.inbox.list.title', 'Inbox')}</span>
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {groups.needs.length > 0
            ? translate('components.inbox.list.needsCount', '{{value0}} needs you', {
                value0: groups.needs.length
              })
            : translate('components.inbox.list.allClear', 'All clear')}
        </span>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        <InboxSection
          label={translate('components.inbox.list.section.needs', 'Needs you')}
          items={groups.needs}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        <InboxSection
          label={translate('components.inbox.list.section.waiting', 'Waiting on agent')}
          items={groups.waiting}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        <InboxSection
          label={translate('components.inbox.list.section.done', 'Done today')}
          items={groups.done}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        {groups.needs.length + groups.waiting.length + groups.done.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            {translate('components.inbox.list.empty', 'Nothing needs you right now.')}
          </div>
        ) : null}
      </div>
    </div>
  )
}
