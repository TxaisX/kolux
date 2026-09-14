import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../shared/execution-host'
import type { RuntimeWorktreeOverlapResult } from '../../../shared/runtime-worktree-contracts'
import { predictWorktreeMergeTreeConflict } from '../../git/worktree-merge-tree-prediction'
import {
  computeWorktreeChanges,
  type WorktreeChangesRuntimeHost,
  type WorktreeSummary
} from './worktree-changes-computation'

// Why: overlap is bounded to one repo's own worktrees, never a fleet-wide scan.
const MAX_SIBLING_WORKTREES = 1_000

export type WorktreeOverlapRuntimeHost = WorktreeChangesRuntimeHost & {
  // Why detected, not the (visibility-filtered) managed list: a sibling an agent hid from the
  // sidebar can still hold real edits that would conflict at merge time.
  listDetectedManagedWorktrees(
    repoSelector: string
  ): Promise<{ authoritative: boolean; worktrees: WorktreeSummary[] }>
}

function isLocalHost(hostId: ExecutionHostId | undefined): boolean {
  return hostId === undefined || hostId === LOCAL_EXECUTION_HOST_ID
}

/**
 * Committed-only conflict prediction between two worktrees of the same repo, via
 * `git merge-tree --write-tree` on their current heads. Both worktrees must be locally
 * executable — an SSH-hosted worktree on either side reports 'unverifiable', since the check
 * runs local git against a repo path rather than dispatching to the owning host.
 */
async function predictSiblingConflict(
  target: WorktreeSummary,
  sibling: WorktreeSummary
): Promise<{ conflictPrediction: RuntimeWorktreeOverlapResult['siblings'][number]['conflictPrediction']; conflictingFiles: string[] }> {
  if (!isLocalHost(target.hostId) || !isLocalHost(sibling.hostId)) {
    return { conflictPrediction: 'unverifiable', conflictingFiles: [] }
  }
  try {
    const result = await predictWorktreeMergeTreeConflict(target.path, target.head, sibling.head)
    return { conflictPrediction: result.prediction, conflictingFiles: result.conflictingFiles }
  } catch {
    return { conflictPrediction: 'unverifiable', conflictingFiles: [] }
  }
}

export async function computeWorktreeOverlap(
  host: WorktreeOverlapRuntimeHost,
  worktreeSelector: string
): Promise<RuntimeWorktreeOverlapResult> {
  const target = await host.showManagedWorktree(worktreeSelector)
  const [targetChanges, listResult] = await Promise.all([
    computeWorktreeChanges(host, worktreeSelector),
    host.listDetectedManagedWorktrees(`id:${target.repoId}`)
  ])
  const targetFiles = new Set(targetChanges.files.map((file) => file.path))
  const siblings = listResult.authoritative
    ? listResult.worktrees.filter((worktree) => worktree.id !== target.id).slice(0, MAX_SIBLING_WORKTREES)
    : []

  const siblingResults = await Promise.all(
    siblings.map(async (sibling) => {
      const [siblingChanges, conflict] = await Promise.all([
        computeWorktreeChanges(host, `id:${sibling.id}`),
        predictSiblingConflict(target, sibling)
      ])
      const sharedFiles = siblingChanges.files
        .map((file) => file.path)
        .filter((path) => targetFiles.has(path))
      return {
        id: sibling.id,
        branch: sibling.branch,
        sharedFiles,
        ...conflict
      }
    })
  )

  return {
    worktree: { id: target.id, branch: target.branch },
    siblings: siblingResults
  }
}
