import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import type { Store } from '../../persistence'
import type { Repo } from '../../../shared/repo-types'
import { isGitRepo } from '../../git/repo'
import { upgradeFolderRepo } from '../folder-repo-git-upgrade'
import { resolveLocalRepo } from './local-repo-host-guard'
import { initGitRepoWithEmptyCommit } from './git-init-with-empty-commit'

/**
 * `repos:convertFolderToGit` — the context-menu "Make it a git repo" action for a
 * project already tracked as a folder project (unlike `repos:initGit`, which only
 * ever handles a not-yet-tracked path). Runs the same empty-commit `git init` as
 * initGit, then reuses `upgradeFolderRepo` — the same routine the background watcher
 * uses for an externally-run `git init` — to flip `kind` on the existing repo record
 * in place instead of registering a second, duplicate project.
 */
export function registerRepoConvertFolderToGitHandler(mainWindow: BrowserWindow, store: Store): void {
  ipcMain.handle(
    'repos:convertFolderToGit',
    async (_event, args: { repoId: string }): Promise<{ repo: Repo } | { error: string }> => {
      const repoId = args?.repoId?.trim() ?? ''
      if (!repoId) {
        return { error: 'repoId is required' }
      }
      const resolved = resolveLocalRepo(store, repoId, 'folder')
      if ('error' in resolved) {
        return resolved
      }
      const { repo } = resolved

      if (isGitRepo(repo.path)) {
        return { error: 'This folder is already a git repository' }
      }

      const initResult = await initGitRepoWithEmptyCommit(repo.path)
      if (!initResult.ok) {
        return { error: initResult.error }
      }

      const outcome = await upgradeFolderRepo({ store, mainWindow, disposed: false }, repoId)
      if (outcome !== 'upgraded') {
        return { error: 'Could not finish converting this project to a git repository' }
      }
      const upgraded = store.getRepo(repoId)
      return upgraded ? { repo: upgraded } : { error: 'Project could not be reloaded after conversion' }
    }
  )
}
