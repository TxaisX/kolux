// "Open in Code": switch to Code mode and focus the item's worktree + pane.
// Mirrors the terminal-handle-link activation sequence (terminal-handle-links.ts)
// so Inbox reuses the same worktree/tab-activation actions rather than a parallel path.
import { useAppStore } from '@/store'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { InboxItem } from './inbox-items'

export function openInboxItemInCode(
  item: Pick<InboxItem, 'worktreeId' | 'tabId' | 'paneKey'>
): void {
  const store = useAppStore.getState()
  store.setActiveWorktree(item.worktreeId)
  store.markWorktreeVisited(item.worktreeId)
  store.setActiveView('terminal')
  store.revealWorktreeInSidebar(item.worktreeId)
  const leafId = parsePaneKey(item.paneKey)?.leafId ?? null
  activateTabAndFocusPane(item.tabId, leafId)
}
