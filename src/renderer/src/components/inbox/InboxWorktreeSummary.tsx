import React from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { InboxItem } from './inbox-items'

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-xs">{value}</span>
    </div>
  )
}

/**
 * Right column for the selected Inbox item. The real Source Control panel
 * (`right-sidebar/source-control/panel/panel.tsx`) reads the globally active
 * worktree only (`useSourceControlPanelFoundation` takes no worktree id), so it
 * cannot be mounted here for an arbitrary item — this renders a short summary
 * instead and links out to the full panel via Open in Code.
 */
export function InboxWorktreeSummary({ item }: { item: InboxItem | null }): React.JSX.Element {
  const changedFileCount = useAppStore((s) =>
    item ? (s.gitStatusByWorktree[item.worktreeId]?.length ?? null) : null
  )

  if (!item) {
    return (
      <div className="flex w-72 shrink-0 flex-col border-l border-border p-3 text-xs text-muted-foreground min-h-0">
        {translate('components.inbox.summary.empty', 'Select an item to see its changes.')}
      </div>
    )
  }

  const [, branchChip] = item.workspaceLabel.split(' › ')

  return (
    <div className="scrollbar-sleek flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border p-3 min-h-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {translate('components.inbox.summary.title', 'Changes')}
      </div>
      <div className="flex flex-col gap-1.5 text-sm">
        <SummaryRow
          label={translate('components.inbox.summary.branch', 'Branch')}
          value={<span className="font-mono">{branchChip ?? '—'}</span>}
        />
        <SummaryRow label={translate('components.inbox.summary.host', 'Host')} value={item.hostLabel} />
        <SummaryRow
          label={translate('components.inbox.summary.filesChanged', 'Files changed')}
          value={<span className="tabular-nums">{changedFileCount ?? '—'}</span>}
        />
        {item.diff ? (
          <SummaryRow
            label={translate('components.inbox.summary.lines', 'Lines')}
            value={
              <span className="tabular-nums">
                <span className="text-[color:var(--git-decoration-added)]">+{item.diff.added}</span>{' '}
                <span className="text-[color:var(--git-decoration-deleted)]">-{item.diff.removed}</span>
              </span>
            }
          />
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {translate(
          'components.inbox.summary.limitation',
          'This is a summary only — open the item in Code for the full Source Control panel.'
        )}
      </p>
    </div>
  )
}
