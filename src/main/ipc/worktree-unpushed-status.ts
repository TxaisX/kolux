import { getStatus } from '../git/status'
import type { Repo } from '../../shared/repo-types'
import type { Worktree } from '../../shared/worktree/types'
import {
  classifyWorktreeUnpushedStatus,
  type WorktreeUnpushedStatus
} from '../../shared/git-unpushed-status'
import {
  readUnpushedCommitCount,
  requireWorkspaceCleanupGitProvider
} from './workspace-cleanup-git-evidence'
import {
  resolveWorkspaceCleanupRepoGitRoute,
  resolveWorkspaceCleanupWorktreeGitRoute
} from './workspace-cleanup-git-route'

export type UnpushedStatusWorktreeInput = Pick<Worktree, 'path' | 'hostId' | 'isMainWorktree'>

/**
 * Resolves one worktree's unpushed-work status for the sidebar badge, reusing the same
 * execution-host routing and git commands as workspace cleanup's evidence reader, but
 * without cleanup's "only when clean" gate — the badge needs an answer for dirty
 * worktrees too. Never guesses: any routing/host problem resolves to `unknown`.
 */
export async function resolveWorktreeUnpushedStatus(
  worktree: UnpushedStatusWorktreeInput,
  repo: Repo,
  signal?: AbortSignal
): Promise<WorktreeUnpushedStatus> {
  try {
    const repoRoute = resolveWorkspaceCleanupRepoGitRoute(repo)
    const route = resolveWorkspaceCleanupWorktreeGitRoute(repoRoute, worktree, repo)
    if (route.kind === 'host-mismatch') {
      return { kind: 'unknown' }
    }
    const status =
      route.kind === 'ssh'
        ? await requireWorkspaceCleanupGitProvider(route).getStatus(worktree.path, {
            includeLineStats: false,
            signal
          })
        : await getStatus(worktree.path, { includeLineStats: false, signal })

    if (!status.upstreamStatus || status.upstreamStatus.hasUpstream) {
      return classifyWorktreeUnpushedStatus(status.upstreamStatus, null)
    }
    const unpublishedCount = await readUnpushedCommitCount(worktree, route, signal)
    return classifyWorktreeUnpushedStatus(status.upstreamStatus, unpublishedCount)
  } catch {
    return { kind: 'unknown' }
  }
}
