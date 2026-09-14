import type { Store } from '../../persistence'
import type { Repo } from '../../../shared/repo-types'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import { isFolderRepo, isGitRepoKind } from '../../../shared/repo-kind'

/**
 * Shared boundary check for the folder-to-git and publish-to-remote IPC handlers: the
 * repo must exist, be local (no SSH/runtime host, matches NonGitFolderDialog's gating —
 * this pass doesn't support remote hosts), and be the right kind for the operation.
 */
export function resolveLocalRepo(
  store: Store,
  repoId: string,
  requireKind?: 'git' | 'folder'
): { repo: Repo } | { error: string } {
  const repo = store.getRepo(repoId)
  if (!repo) {
    return { error: 'Project not found' }
  }
  if (repo.connectionId || getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID) {
    return { error: 'This action is only supported for local projects' }
  }
  if (requireKind === 'git' && !isGitRepoKind(repo)) {
    return { error: 'This project is not a git repository yet' }
  }
  if (requireKind === 'folder' && !isFolderRepo(repo)) {
    return { error: 'This project is already a git repository' }
  }
  return { repo }
}
