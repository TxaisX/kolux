import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { Store } from '../../persistence'
import type { Repo } from '../../../shared/repo-types'
import { isGitRepo } from '../../git/repo'
import { invalidateAuthorizedRootsCache } from '../registered-worktree-roots-cache'
import { addLocalRepoFromPath } from './local-repo-registration'
import { emitRepoAdded } from './repo-added-telemetry'
import { notifyReposChanged } from './repos-changed-notification'
import { initGitRepoWithEmptyCommit } from './git-init-with-empty-commit'

/**
 * Turns an existing local, non-git folder into a git repo so it can host worktrees
 * (nightshift "Make it a git repo" flow off the non-git-folder dialog). Only ever an
 * empty initial commit — the user's existing files are never staged or committed.
 */
export function registerRepoInitGitHandler(mainWindow: BrowserWindow, store: Store): void {
  ipcMain.handle(
    'repos:initGit',
    async (_event, args: { path: string }): Promise<{ repo: Repo } | { error: string }> => {
      const path = args?.path?.trim() ?? ''
      if (!path) {
        return { error: 'Path is required' }
      }
      // Why: block CWD-relative paths at the IPC boundary, same as repos:create.
      if (!isAbsolute(path)) {
        return { error: 'Path must be an absolute path' }
      }

      let stats
      try {
        stats = await stat(path)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { error: `Cannot access path: ${message}` }
      }
      if (!stats.isDirectory()) {
        return { error: 'Path is not a directory' }
      }
      if (isGitRepo(path)) {
        return { error: 'This folder is already a git repository' }
      }

      const initResult = await initGitRepoWithEmptyCommit(path)
      if (!initResult.ok) {
        return { error: initResult.error }
      }

      const result = await addLocalRepoFromPath(store, path, 'git')
      if ('error' in result) {
        return result
      }
      invalidateAuthorizedRootsCache()
      notifyReposChanged(mainWindow)
      emitRepoAdded('folder_picker', result.alreadyExisted, true)
      return { repo: result.repo }
    }
  )
}
