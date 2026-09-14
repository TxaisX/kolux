import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Store } from '../../persistence'
import type { Repo } from '../../../shared/repo-types'
import type { CommitInitialFilesArgs } from '../../../shared/repo-git-publish-types'
import { gitExecFileAsync } from '../../git/runner'
import { notifyReposChanged } from './repos-changed-notification'
import { notifyWorktreesChanged } from '../worktree-remote'
import { DEFAULT_GITIGNORE_CONTENT } from './initial-commit-defaults'
import { computeInitialCommitPreview } from './initial-commit-preview'
import { resolveLocalRepo } from './local-repo-host-guard'

/**
 * `repos:commitInitialFiles` — the explicit opt-in that actually stages and commits the
 * user's real files, gated on the caller having acknowledged any preview warnings
 * (secrets, oversized files). Never runs implicitly off `repos:initGit`.
 */
export function registerRepoCommitInitialFilesHandler(mainWindow: BrowserWindow, store: Store): void {
  ipcMain.handle(
    'repos:commitInitialFiles',
    async (_event, args: CommitInitialFilesArgs): Promise<{ repo: Repo } | { error: string }> => {
      const repoId = args?.repoId?.trim() ?? ''
      if (!repoId) {
        return { error: 'repoId is required' }
      }
      const resolved = resolveLocalRepo(store, repoId, 'git')
      if ('error' in resolved) {
        return resolved
      }
      const { repo } = resolved

      const preview = await computeInitialCommitPreview(repo.path)
      if ('error' in preview) {
        return preview
      }
      if (preview.hasWarnings && !args?.acknowledgedWarnings) {
        return { error: 'Review the flagged files before committing' }
      }

      const gitignorePath = join(repo.path, '.gitignore')
      if (args?.writeDefaultGitignore && !existsSync(gitignorePath)) {
        await writeFile(gitignorePath, DEFAULT_GITIGNORE_CONTENT, 'utf-8')
      }

      try {
        await gitExecFileAsync(['add', '-A'], { cwd: repo.path })
        await gitExecFileAsync(['commit', '-m', 'Add project files'], { cwd: repo.path })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const stdout =
          err && typeof err === 'object' && 'stdout' in err
            ? String((err as { stdout?: unknown }).stdout ?? '')
            : ''
        if (/nothing to commit/i.test(`${message}\n${stdout}`)) {
          return { error: 'There are no files to commit' }
        }
        return { error: `Failed to commit project files: ${message}` }
      }

      notifyReposChanged(mainWindow)
      notifyWorktreesChanged(mainWindow, repo.id)
      return { repo }
    }
  )
}
