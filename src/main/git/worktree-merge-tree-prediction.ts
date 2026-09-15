import type { GitCapabilityCache } from '../../shared/git-capability-cache'
import {
  getGitCommandStdout,
  isUnsupportedMergeTreeWriteTreeError,
  parseMergeTreeNameOnlyOutput
} from '../../shared/git-merge-tree-capability'
import { gitExecFileAsync } from './runner'
import { withLocalGitCapabilityCacheForExecution } from './git-capability-state'

export type WorktreeConflictPrediction = 'conflicts' | 'clean' | 'unverifiable'

export type MergeTreeConflictExec = (argv: string[]) => Promise<{ stdout: string }>

export type MergeTreePrediction = {
  prediction: WorktreeConflictPrediction
  conflictingFiles: string[]
}

/**
 * Predicts whether merging `headB` into `headA` would conflict, using the two-tip form of
 * `git merge-tree --write-tree` (Git derives the merge base itself, so only the
 * `merge-tree-write-tree` capability applies — not `merge-tree-merge-base`).
 *
 * Committed work only: this compares branch tips, not working-tree changes. Fails closed to
 * 'unverifiable' on capability rejection (Git < 2.38) or any other execution failure — never
 * silently reports 'clean' when the check could not run.
 */
export async function predictMergeTreeConflict(
  runGit: MergeTreeConflictExec,
  capabilities: GitCapabilityCache,
  headA: string,
  headB: string
): Promise<MergeTreePrediction> {
  const args = ['merge-tree', '--write-tree', '--name-only', '-z', '--no-messages', headA, headB]
  try {
    return await capabilities.runWithFallback(
      'merge-tree-write-tree',
      async () => {
        try {
          // Why: exit 0 means Git wrote a clean merge tree with no conflicts.
          await runGit(args)
          return { prediction: 'clean' as const, conflictingFiles: [] }
        } catch (error) {
          if (isUnsupportedMergeTreeWriteTreeError(error)) {
            throw error
          }
          // Why: `merge-tree --write-tree` exits 1 for conflicts but still writes the
          // useful file list on stdout; only option rejection should reach fallback.
          const stdout = getGitCommandStdout(error)
          if (!stdout) {
            throw error
          }
          const files = parseMergeTreeNameOnlyOutput(stdout)
          return {
            prediction: (files.length > 0 ? 'conflicts' : 'clean') as WorktreeConflictPrediction,
            conflictingFiles: files
          }
        }
      },
      async () => ({ prediction: 'unverifiable' as const, conflictingFiles: [] }),
      isUnsupportedMergeTreeWriteTreeError
    )
  } catch {
    return { prediction: 'unverifiable', conflictingFiles: [] }
  }
}

/** Local-only convenience wrapper: routes through the host-scoped capability cache so a
 *  rejected `--write-tree` is remembered per native/WSL execution host, not re-probed. */
export function predictWorktreeMergeTreeConflict(
  repoPath: string,
  headA: string,
  headB: string,
  gitOptions: { wslDistro?: string } = {}
): Promise<MergeTreePrediction> {
  return withLocalGitCapabilityCacheForExecution(
    { cwd: repoPath, wslDistro: gitOptions.wslDistro },
    (capabilities) =>
      predictMergeTreeConflict(
        (argv) => gitExecFileAsync(argv, { cwd: repoPath, ...gitOptions }),
        capabilities,
        headA,
        headB
      )
  )
}
