import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../../../shared/constants'
import type { WorkspaceVisibleTabType } from '../../../../../../shared/tab-types'
import type { EditorSlice } from '../types/editor-slice'

// Why no group-reuse resolver lives here anymore: every pane holds exactly one
// session now, so "which group should this open reuse" stopped being a
// question worth guessing at — see openWorkspaceEditorItem, which refocuses an
// already-open entity or splits a fresh pane instead.

export function buildEditorActiveResult(
  state: Pick<EditorSlice, 'activeFileIdByWorktree' | 'activeTabTypeByWorktree'>,
  worktreeId: string,
  fileId: string
): {
  activeFileId?: string
  activeTabType?: 'editor'
  activeFileIdByWorktree: Record<string, string | null>
  activeTabTypeByWorktree: Record<string, WorkspaceVisibleTabType>
} {
  return {
    // Why: floating markdown tabs must not become the worktree's active editor, so update only the per-worktree maps.
    ...(worktreeId === FLOATING_TERMINAL_WORKTREE_ID
      ? {}
      : { activeFileId: fileId, activeTabType: 'editor' as const }),
    activeFileIdByWorktree: { ...state.activeFileIdByWorktree, [worktreeId]: fileId },
    activeTabTypeByWorktree: { ...state.activeTabTypeByWorktree, [worktreeId]: 'editor' }
  }
}
