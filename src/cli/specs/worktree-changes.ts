import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const WORKTREE_CHANGES_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['worktree', 'changes'],
    summary: "Show a worktree's committed + uncommitted file changes since its base",
    usage: 'kolux worktree changes [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: [
      'Read-only: unlike `file open-changed`, this never opens editor tabs.',
      'Defaults --worktree to the active/current worktree (same convention as other worktree-scoped commands).',
      'files is the union of committed changes (vs the merge-base with the resolved base ref) and uncommitted working-tree changes; each entry reports committed/uncommitted independently.',
      'base is null only when no base ref could be resolved at all (no persisted, configured, or detectable default); files still reports uncommitted changes in that case.',
      'A folder workspace (a plain folder Kolux manages, not a git worktree) returns unsupported: "folder" with no files, instead of failing.'
    ],
    examples: ['kolux worktree changes --json', 'kolux worktree changes --worktree active --json']
  },
  {
    path: ['worktree', 'overlap'],
    summary:
      'Compare a worktree against its sibling worktrees for shared files and merge conflicts',
    usage: 'kolux worktree overlap [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: [
      'Read-only. Run before editing: a non-empty sharedFiles for a sibling means coordinate before touching those files.',
      "sharedFiles come from each worktree's `worktree changes` file set (committed + uncommitted).",
      'conflictPrediction compares committed branch tips only, via `git merge-tree --write-tree`; it does not see uncommitted changes on either side.',
      'conflictPrediction is "unverifiable" on Git before 2.38 (no `--write-tree`), when either worktree is SSH-hosted, or if the check itself fails — never reported as "clean" in those cases.',
      "Bounded to the target worktree's own repo; it never scans other repos or refs. Includes every git worktree of that repo, including ones hidden from the sidebar.",
      'A folder workspace returns unsupported: "folder" with no siblings, instead of failing.'
    ],
    examples: ['kolux worktree overlap --json', 'kolux worktree overlap --worktree active --json']
  }
]
