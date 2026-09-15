import type { Store } from '../persistence'
import { listLiveDaemonPtyIds } from '../daemon/daemon-provider-state'
import { setPtyWindowOwner } from '../ipc/pty/pty-window-ownership'
import { mainProcessState } from '../startup/main-process-state'
import { openOrFocusTerminalSessionWindow } from './terminal-session-window'

/** Reopens a window for every persisted tab whose pty the daemon still reports live. */
export async function restoreLiveTerminalSessionWindows(store: Store | null): Promise<void> {
  if (!store) {
    return
  }
  await mainProcessState.localPtyProviderStartupReady
  // Why: persisted ptyIds outlive their ptys; null (no daemon / unreachable) can't prove any live, so reopen none.
  const livePtyIds = new Set(await listLiveDaemonPtyIds())
  const tabsByWorktree = store.getWorkspaceSession().tabsByWorktree ?? {}
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    for (const tab of tabs ?? []) {
      if (!tab.ptyId || !livePtyIds.has(tab.ptyId)) {
        continue
      }
      const { sessionKey } = openOrFocusTerminalSessionWindow(store, { worktreeId, tabId: tab.id })
      setPtyWindowOwner(tab.ptyId, sessionKey)
    }
  }
}
