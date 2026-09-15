import { useAppStore } from '@/store'
import { suggestionPathBasename } from '../../../../shared/worktree-name-suggestion'

/**
 * `new-worktree` isolation creates each seat's worktree and initial tab in the
 * background (`runBackgroundWorktreeCreation`), asynchronously and in no
 * guaranteed order. Rather than re-deriving that creation, this watches the
 * existing `pendingWorktreeCreations` lifecycle for one seat to conclude, then
 * hands its resulting session straight to its own terminal window. A seat
 * whose create fails (`status: 'error'`) is left for the creation panel's
 * Retry — no window opens for it.
 */
// ponytail: bounds the wait for a seat whose pending entry vanished without ever
// producing a matching worktree/tab (should not happen, but a leaked subscriber
// would otherwise never stop watching store updates). Raise this if creation
// preflight for a very large wave can legitimately take longer.
const WAIT_TIMEOUT_MS = 60_000

export function openTerminalWindowWhenSeatIsReady(
  creationId: string,
  repoId: string,
  seatName: string
): void {
  const startedAt = Date.now()
  const tryOpen = (): boolean => {
    const state = useAppStore.getState()
    const pending = state.pendingWorktreeCreations[creationId]
    if (pending?.status === 'error') {
      return true
    }
    const worktree = (state.worktreesByRepo[repoId] ?? []).find(
      (candidate) => suggestionPathBasename(candidate.path) === seatName
    )
    const tab = worktree ? state.tabsByWorktree[worktree.id]?.[0] : undefined
    if (worktree && tab) {
      void window.api.terminalWindows.open({ worktreeId: worktree.id, tabId: tab.id })
      return true
    }
    return Date.now() - startedAt > WAIT_TIMEOUT_MS
  }
  if (tryOpen()) {
    return
  }
  const unsubscribe = useAppStore.subscribe(() => {
    if (tryOpen()) {
      unsubscribe()
    }
  })
}

/**
 * `shared-checkout` isolation starts its terminal synchronously (no worktree
 * create to wait on), so the caller already has both ids the moment the tab
 * exists — no polling needed. Opening the same `${worktreeId}::${tabId}`
 * session key twice focuses the existing window instead of duplicating it.
 */
export function openTerminalWindowForSharedCheckoutSeat(worktreeId: string, tabId: string): void {
  void window.api.terminalWindows.open({ worktreeId, tabId })
}
