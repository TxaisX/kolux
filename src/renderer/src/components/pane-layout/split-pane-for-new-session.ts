import type { AppState } from '@/store/types'
import { EQUALIZE_PANES_EVENT } from '@/constants/terminal'
import { buildGridLayout } from './grid-layout'
import { computeGridRows } from './preset-grid'
import { collectLeafGroupIds } from './tidy-layout'

type PaneSplitState = Pick<
  AppState,
  'layoutByWorktree' | 'createEmptySplitGroup' | 'setTabGroupLayout'
>

/** Rebuilds the worktree's tab-group tree into a balanced grid for whatever
 *  leaves currently exist, and re-broadcasts Tidy so per-tab panes even out
 *  too (see useTidyLayoutCommand). */
export function regridToCurrentLeaves(state: PaneSplitState, worktreeId: string): void {
  const layout = state.layoutByWorktree[worktreeId]
  if (!layout) {
    return
  }
  const leafIds = collectLeafGroupIds(layout)
  const nextLayout = buildGridLayout(leafIds, computeGridRows(leafIds.length))
  if (nextLayout) {
    state.setTabGroupLayout(worktreeId, nextLayout)
  }
  // Why: store-level tests stub `window` without a DOM; the broadcast is UI-only.
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(EQUALIZE_PANES_EVENT))
  }
}

/**
 * Every new session gets its own pane: splits a fresh group off `sourceGroupId`
 * and regrids the workspace so all running sessions stay visible at once, rather
 * than stacking as tabs in one strip. Returns the group to create the session in;
 * falls back to the source group when the layout cannot be split.
 */
export function splitPaneForNewSession(
  getState: () => PaneSplitState,
  worktreeId: string,
  sourceGroupId: string
): string {
  const newGroupId = getState().createEmptySplitGroup(worktreeId, sourceGroupId, 'right', {
    activate: true
  })
  if (!newGroupId) {
    return sourceGroupId
  }
  regridToCurrentLeaves(getState(), worktreeId)
  return newGroupId
}
