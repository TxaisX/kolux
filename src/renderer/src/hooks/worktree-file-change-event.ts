import type { FsChangedPayload } from '../../../shared/filesystem-entry-types'

export const KOLUX_WORKTREE_FILE_CHANGE_EVENT = 'kolux:worktree-file-change'

export type WorktreeFileChangeEventDetail = {
  payload: FsChangedPayload
  runtimeEnvironmentId: string | null
}
