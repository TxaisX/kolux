import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { gitExecFileAsync } from '../../git/runner'

export type GitInitEmptyCommitResult = { ok: true } | { ok: false; error: string }

const IDENTITY_ERROR_HINT =
  'Git author identity is not configured. Run `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`, then try again.'

/**
 * `git init` + an empty initial commit so HEAD has a branch ref for worktrees.
 * Shared by repos:create (fresh directory) and repos:initGit (existing folder) —
 * never stages or commits any pre-existing files, only ever an empty commit.
 * On a commit failure the half-init'd `.git/` is removed; the target directory itself
 * is left untouched since callers may own a pre-existing folder.
 */
export async function initGitRepoWithEmptyCommit(
  targetPath: string
): Promise<GitInitEmptyCommitResult> {
  let step: 'init' | 'commit' = 'init'
  try {
    await gitExecFileAsync(['init'], { cwd: targetPath })
    step = 'commit'
    await gitExecFileAsync(['commit', '--allow-empty', '-m', 'Initial commit'], {
      cwd: targetPath
    })
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (step === 'commit') {
      await rm(join(targetPath, '.git'), { recursive: true, force: true }).catch(() => {})
      if (/Please tell me who you are|user\.name|user\.email/i.test(message)) {
        return { ok: false, error: IDENTITY_ERROR_HINT }
      }
    }
    const stepLabel =
      step === 'init' ? 'Failed to initialize git repository' : 'Failed to create initial commit'
    return { ok: false, error: `${stepLabel}: ${message}` }
  }
}
