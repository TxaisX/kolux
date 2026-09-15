import type { GitBranchCompareResult, GitBranchChangeEntry } from '../../../shared/git-diff-compare-types'
import type { GitBranchChangeStatus, GitStatusEntry, GitStatusResult } from '../../../shared/git-status-types'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type {
  RuntimeWorktreeChangeFile,
  RuntimeWorktreeChangesResult,
  WorktreeChangeFileStatus
} from '../../../shared/runtime-worktree-contracts'

/** The subset of `RuntimeWorktreeRecord` this file and `worktree-overlap-computation.ts` need. */
export type WorktreeSummary = {
  id: string
  repoId: string
  branch: string
  path: string
  head: string
  hostId?: ExecutionHostId
  /** Intended create base, persisted metadata (`meta.baseRef` / `meta.sparseBaseRef`). */
  baseRef?: string
  sparseBaseRef?: string
}

export type WorktreeChangesRuntimeHost = {
  showManagedWorktree(worktreeSelector: string): Promise<WorktreeSummary>
  showRepo(repoSelector: string): Promise<{ worktreeBaseRef?: string }>
  getRepoBaseRefDefault(
    repoSelector: string
  ): Promise<{ defaultBaseRef: string | null; remoteCount: number }>
  getRuntimeGitStatus(
    worktreeSelector: string,
    options: { admissionTier: 'status' }
  ): Promise<GitStatusResult>
  getRuntimeGitBranchCompare(
    worktreeSelector: string,
    baseRef: string,
    admissionTier: 'status'
  ): Promise<GitBranchCompareResult>
}

/**
 * Same fallback chain BASE DRIFT resolves a worktree's base ref with (see
 * `runtime-worktree-drift-probe.ts`), minus the remote-tracking fetch: a persisted worktree
 * base, then the repo's configured default, then the repo's own detected default branch.
 * Unlike drift probing this also resolves for local-only and SSH-hosted repos, which have no
 * remote-tracking counterpart to probe.
 */
async function resolveWorktreeChangesBaseRef(
  host: WorktreeChangesRuntimeHost,
  worktree: WorktreeSummary
): Promise<string | null> {
  if (worktree.baseRef) {
    return worktree.baseRef
  }
  if (worktree.sparseBaseRef) {
    return worktree.sparseBaseRef
  }
  const repoSelector = `id:${worktree.repoId}`
  const repo = await host.showRepo(repoSelector).catch(() => null)
  if (repo?.worktreeBaseRef) {
    return repo.worktreeBaseRef
  }
  const defaultResult = await host.getRepoBaseRefDefault(repoSelector).catch(() => null)
  return defaultResult?.defaultBaseRef ?? null
}

function toChangeFileStatus(status: GitBranchChangeStatus | GitStatusEntry['status']): WorktreeChangeFileStatus {
  // Why: the public contract has no 'copied' bucket; a copy is a rename for this purpose.
  return status === 'copied' ? 'renamed' : status
}

function mergeChangeFiles(
  committed: GitBranchChangeEntry[],
  uncommitted: GitStatusEntry[]
): RuntimeWorktreeChangeFile[] {
  const byPath = new Map<string, RuntimeWorktreeChangeFile>()
  for (const entry of committed) {
    byPath.set(entry.path, {
      path: entry.path,
      status: toChangeFileStatus(entry.status),
      committed: true,
      uncommitted: false
    })
  }
  for (const entry of uncommitted) {
    const existing = byPath.get(entry.path)
    byPath.set(entry.path, {
      path: entry.path,
      status: toChangeFileStatus(entry.status),
      committed: existing !== undefined,
      uncommitted: true
    })
  }
  return Array.from(byPath.values())
}

/**
 * Committed changes (vs the merge-base with the worktree's resolved base ref) unioned with
 * uncommitted working-tree changes. `base` is null when it could not be resolved (no persisted,
 * configured, or detectable default base ref) — the result still carries uncommitted changes
 * in that case.
 */
export async function computeWorktreeChanges(
  host: WorktreeChangesRuntimeHost,
  worktreeSelector: string
): Promise<RuntimeWorktreeChangesResult> {
  const worktree = await host.showManagedWorktree(worktreeSelector)
  const base = await resolveWorktreeChangesBaseRef(host, worktree)
  const [status, compare] = await Promise.all([
    host.getRuntimeGitStatus(worktreeSelector, { admissionTier: 'status' }),
    base
      ? host.getRuntimeGitBranchCompare(worktreeSelector, base, 'status').catch(() => null)
      : Promise.resolve(null)
  ])
  return {
    worktree: { id: worktree.id, branch: worktree.branch, path: worktree.path },
    base,
    files: mergeChangeFiles(compare?.entries ?? [], status.entries)
  }
}
