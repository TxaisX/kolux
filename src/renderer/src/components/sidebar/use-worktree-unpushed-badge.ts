import { useEffect, useSyncExternalStore } from 'react'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { WorktreeUnpushedStatus } from '../../../../shared/git-unpushed-status'
import { registerWorktreeForUnpushedStatus } from './worktree-unpushed-status-registry'
import {
  getWorktreeUnpushedStatusSnapshot,
  subscribeWorktreeUnpushedStatus
} from './worktree-unpushed-status-store'

/** Registers a git worktree card for background unpushed-status evaluation and returns its
 *  latest known status (undefined until the first fetch resolves). Skip folder workspaces by
 *  passing null — nothing is registered and nothing renders. */
export function useWorktreeUnpushedBadge(worktree: {
  id: string
  repoId: string
  path: string
  hostId?: ExecutionHostId
  isMainWorktree: boolean
} | null): WorktreeUnpushedStatus | undefined {
  const worktreeId = worktree?.id
  const repoId = worktree?.repoId
  const path = worktree?.path
  const hostId = worktree?.hostId
  const isMainWorktree = worktree?.isMainWorktree

  useEffect(() => {
    if (!worktreeId || !repoId || !path) {
      return
    }
    return registerWorktreeForUnpushedStatus({
      worktreeId,
      repoId,
      path,
      hostId,
      isMainWorktree: isMainWorktree ?? false
    })
  }, [worktreeId, repoId, path, hostId, isMainWorktree])

  const getSnapshot = (): WorktreeUnpushedStatus | undefined =>
    worktreeId ? getWorktreeUnpushedStatusSnapshot(worktreeId) : undefined
  // Why a server snapshot: some card tests render through react-dom/server, which throws
  // without one; there is no server-side badge data, so it's always undefined there.
  return useSyncExternalStore(subscribeWorktreeUnpushedStatus, getSnapshot, () => undefined)
}
