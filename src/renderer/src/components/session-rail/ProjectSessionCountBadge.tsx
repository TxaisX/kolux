import React from 'react'
import { useAppStore } from '@/store'
import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import { SessionCountBadge } from './SessionCountBadge'

/**
 * Live-session count for a whole project row — the sum of every workspace
 * under that header. Lets a collapsed project still say how many sessions are
 * running inside it, the same badge the workspace rows use. Quiet at zero.
 *
 * The selector returns a number, so a store change that does not move the
 * count re-renders nothing.
 */
export function ProjectSessionCountBadge({
  worktreeIds
}: {
  worktreeIds: readonly string[]
}): React.JSX.Element | null {
  const count = useAppStore((s) => {
    let live = 0
    for (const worktreeId of worktreeIds) {
      for (const tab of s.tabsByWorktree?.[worktreeId] ?? []) {
        if (tabHasLivePty(s.ptyIdsByTabId, tab.id)) {
          live += 1
        }
      }
    }
    return live
  })
  return <SessionCountBadge count={count} />
}
