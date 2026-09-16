import { useAppStore } from '../../store'
import { computeGridRows, DOCUMENTED_PRESET_COUNTS } from '../pane-layout/preset-grid'
import { buildGridLayout } from '../pane-layout/grid-layout'
import { collectLeafGroupIds } from '../pane-layout/tidy-layout'

export type LayoutPresetOption = {
  count: number
  rows: number[]
  apply: () => void
}

/**
 * Layout presets for the current worktree's pane count. A documented preset
 * count is only offered when it equals the current number of panes exactly
 * — applying it then just rearranges those same leaves into a balanced grid,
 * so no pane is ever invented or dropped.
 */
export function useLayoutPresetsCommand(worktreeId: string): LayoutPresetOption[] {
  const setTabGroupLayout = useAppStore((state) => state.setTabGroupLayout)
  const leafCount = useAppStore((state) => {
    const layout = state.layoutByWorktree[worktreeId]
    return layout ? collectLeafGroupIds(layout).length : 0
  })

  return DOCUMENTED_PRESET_COUNTS.filter((count) => count === leafCount).map((count) => ({
    count,
    rows: computeGridRows(count),
    apply: () => {
      const layout = useAppStore.getState().layoutByWorktree[worktreeId]
      if (!layout) {
        return
      }
      const leafIds = collectLeafGroupIds(layout)
      const nextLayout = buildGridLayout(leafIds, computeGridRows(count))
      if (nextLayout) {
        setTabGroupLayout(worktreeId, nextLayout)
      }
    }
  }))
}
