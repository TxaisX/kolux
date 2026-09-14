import { getStatus } from '../git/status'
import { listWorktrees } from '../git/worktree'
import { areWorktreePathsEqual } from '../git/worktree-path-comparison'
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
  resolveWorkspaceCleanupWorktreeGitRoute,
  type WorkspaceCleanupGitRoute
} from './workspace-cleanup-git-route'

export type UnpushedStatusWorktreeInput = Pick<Worktree, 'path' | 'hostId' | 'isMainWorktree'>

/**
 * The renderer-supplied `path` (and `hostId`, checked separately via the host-mismatch
 * route) is untrusted — without this check a compromised renderer could point `git status`
 * at an arbitrary local (or SSH) path. Only a path that is actually one of the repo's own
 * worktrees, per the repo's own worktree listing, is allowed through.
 */
async function isKnownWorktreePath(
  route: WorkspaceCleanupGitRoute,
  repoPath: string,
  candidatePath: string,
  signal?: AbortSignal
): Promise<boolean> {
  const known =
    route.kind === 'ssh'
      ? route.provider
        ? await route.provider.listWorktrees(repoPath, { signal }).catch(() => [])
        : []
      : await listWorktrees(repoPath, { signal }).catch(() => [])
  return known.some((worktree) => areWorktreePathsEqual(worktree.path, candidatePath))
}

/**
 * Resolves one worktree's unpushed-work status for the sidebar badge, reusing the same
 * execution-host routing and git commands as workspace cleanup's evidence reader, but
 * without cleanup's "only when clean" gate — the badge needs an answer for dirty
 * worktrees too. Never guesses: any routing/host problem resolves to `unverifiable`.
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
      return { kind: 'unverifiable' }
    }
    if (!(await isKnownWorktreePath(route, repo.path, worktree.path, signal))) {
      return { kind: 'unverifiable' }
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
    return { kind: 'unverifiable' }
  }
}
