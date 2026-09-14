import { ipcMain } from 'electron'
import type { Store } from '../../persistence'
import type { InitialCommitPreviewResult } from '../../../shared/repo-git-publish-types'
import { computeInitialCommitPreview } from './initial-commit-preview'
import { resolveLocalRepo } from './local-repo-host-guard'

/**
 * `repos:previewInitialCommit` — read-only look at what "Commit files…" would stage,
 * so a folder-turned-git repo never gets a surprise commit of the user's real files.
 */
export function registerRepoInitialCommitPreviewHandler(store: Store): void {
  ipcMain.handle(
    'repos:previewInitialCommit',
    async (_event, args: { repoId: string }): Promise<InitialCommitPreviewResult> => {
      const repoId = args?.repoId?.trim() ?? ''
      if (!repoId) {
        return { error: 'repoId is required' }
      }
      const resolved = resolveLocalRepo(store, repoId, 'git')
      if ('error' in resolved) {
        return resolved
      }
      return computeInitialCommitPreview(resolved.repo.path)
    }
  )
}
