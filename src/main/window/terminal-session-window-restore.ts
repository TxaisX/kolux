import type { Store } from '../persistence'
import { openOrFocusTerminalSessionWindow } from './terminal-session-window'
import { setPtyWindowOwner } from '../ipc/pty/pty-window-ownership'

/**
 * Reopen a window for every session that is still live, at its remembered
 * bounds (openOrFocusTerminalSessionWindow falls back to a cascade position
 * when none are recorded — e.g. the first restart after this feature ships).
 *
 * ponytail: liveness = the persisted tab still carries a bound ptyId
 * (`store.getWorkspaceSession().tabsByWorktree`), the same signal the old
 * single-window restore used to decide which tabs to redraw. Swap for a
 * runtime-confirmed post-reattachment signal if this proves stale once the
 * daemon has had a chance to reconcile.
 */
export function restoreLiveTerminalSessionWindows(store: Store | null): void {
  if (!store) {
    return
  }
  const tabsByWorktree = store.getWorkspaceSession().tabsByWorktree ?? {}
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    for (const tab of tabs ?? []) {
      if (!tab.ptyId) {
        continue
      }
      const { sessionKey } = openOrFocusTerminalSessionWindow(store, { worktreeId, tabId: tab.id })
      setPtyWindowOwner(tab.ptyId, sessionKey)
    }
  }
}
