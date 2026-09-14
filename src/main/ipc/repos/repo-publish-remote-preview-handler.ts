import { ipcMain } from 'electron'
import type { Store } from '../../persistence'
import type { PublishPreviewResult } from '../../../shared/repo-git-publish-types'
import { gitExecFileAsync } from '../../git/runner'
import { resolveLocalRepo } from './local-repo-host-guard'
import { repoHasAnyRemote } from './repo-remote-presence'

/**
 * `repos:previewPublish` — read-only counts ("N commits, N files") the Publish dialog
 * shows before the user confirms uploading to a brand-new remote.
 */
export function registerRepoPublishRemotePreviewHandler(store: Store): void {
  ipcMain.handle(
    'repos:previewPublish',
    async (_event, args: { repoId: string }): Promise<PublishPreviewResult> => {
      const repoId = args?.repoId?.trim() ?? ''
      if (!repoId) {
        return { error: 'repoId is required' }
      }
      const resolved = resolveLocalRepo(store, repoId, 'git')
      if ('error' in resolved) {
        return resolved
      }
      const { repo } = resolved

      if (await repoHasAnyRemote(repo.path)) {
        return { error: 'This project is already published — a remote is already configured.' }
      }

      try {
        const [commitCountResult, fileListResult] = await Promise.all([
          gitExecFileAsync(['rev-list', '--count', 'HEAD'], { cwd: repo.path }),
          gitExecFileAsync(['ls-files', '-z'], { cwd: repo.path })
        ])
        const commitCount = Number.parseInt(commitCountResult.stdout.trim(), 10) || 0
        const fileCount = fileListResult.stdout.split('\0').filter(Boolean).length
        return { commitCount, fileCount }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { error: `Failed to inspect the repository: ${message}` }
      }
    }
  )
}
