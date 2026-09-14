import type { GitUpstreamStatus } from './git-status-types'
import type { ExecutionHostId } from './execution-host'

// Why: the sidebar badge and any other "is this worktree pushed" surface must
// agree on one vocabulary. `unverifiable` covers SSH/host reads that could not be
// obtained — never guess a state here (matches the ssh-execution-boundary verdict vocabulary).
export type WorktreeUnpushedStatus =
  | { kind: 'ahead'; count: number }
  | { kind: 'unpublished'; count: number }
  | { kind: 'synced' }
  | { kind: 'unverifiable' }

/** What the renderer sends to ask the main process for one worktree's unpushed status. */
export type WorktreeUnpushedStatusQuery = {
  worktreeId: string
  repoId: string
  path: string
  hostId?: ExecutionHostId
  isMainWorktree: boolean
}

/**
 * Classifies unpushed work from an already-read upstream status.
 * `unpublishedCommitCount` is the `git rev-list --count HEAD --not --remotes`
 * result and is only consulted when there is no upstream; pass null when it
 * was not read (hasUpstream case) or could not be read (e.g. unreachable SSH host).
 */
export function classifyWorktreeUnpushedStatus(
  upstreamStatus: GitUpstreamStatus | undefined,
  unpublishedCommitCount: number | null
): WorktreeUnpushedStatus {
  if (!upstreamStatus) {
    return { kind: 'unverifiable' }
  }
  if (upstreamStatus.hasUpstream) {
    return upstreamStatus.ahead > 0
      ? { kind: 'ahead', count: upstreamStatus.ahead }
      : { kind: 'synced' }
  }
  if (unpublishedCommitCount === null) {
    return { kind: 'unverifiable' }
  }
  return unpublishedCommitCount > 0
    ? { kind: 'unpublished', count: unpublishedCommitCount }
    : { kind: 'synced' }
}
