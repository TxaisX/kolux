import type { AppState } from '../../types'

/**
 * Where a freshly-opened terminal, browser tab, markdown file, or editor/diff
 * tab should land now that the tab bar is gone and every pane holds exactly
 * one session: split a new pane off the worktree's active group instead of
 * appending another tab to it. The one place every "open X" store action
 * routes through — see TabGroupPanel.tsx for why there's no strip left to
 * append to, and openWorkspaceEditorItem for the file/diff callers.
 */
export function resolveNewPaneTargetGroupId(
  state: Pick<
    AppState,
    | 'activeGroupIdByWorktree'
    | 'groupsByWorktree'
    | 'createEmptySplitGroup'
    | 'ensureWorktreeRootGroup'
  >,
  worktreeId: string
): string | undefined {
  const groups = state.groupsByWorktree?.[worktreeId] ?? []
  const sourceGroupId = state.activeGroupIdByWorktree?.[worktreeId] ?? groups[0]?.id
  if (!sourceGroupId) {
    // Why: a worktree with no groups yet (its first tab ever) has nothing to
    // split — seed its root group instead of splitting nothing. Optional
    // chaining throughout: a handful of narrowly-scoped store tests build a
    // state slice with no tabs-group wiring at all, and this must degrade to
    // "no target group" the same way the old resolver's data-only reads did.
    return state.ensureWorktreeRootGroup?.(worktreeId)
  }
  return state.createEmptySplitGroup?.(worktreeId, sourceGroupId, 'right') ?? sourceGroupId
}
