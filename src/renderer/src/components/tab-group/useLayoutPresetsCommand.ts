import { useAppStore } from '../../store'
import { computeGridRows, DOCUMENTED_PRESET_COUNTS } from '../pane-layout/preset-grid'
import { buildGridLayout } from '../pane-layout/grid-layout'
import { collectLeafGroupIds } from '../pane-layout/tidy-layout'
import { collectLeafIdsInOrder } from '../terminal-pane/terminal-layout-leaf-ids'
import { ARRANGE_TERMINAL_PANE_GRID_EVENT } from '@/constants/terminal'

export type LayoutPresetOption = {
  count: number
  rows: number[]
  target: 'terminal-panes' | 'tab-groups'
  apply: () => void
}

/**
 * Layout presets for the current worktree's tab-group count. A documented preset
 * count is only offered when it equals the current number of groups exactly
 * — applying it then just rearranges those same leaves into a balanced grid,
 * so no group is ever invented or dropped. A single group has no layout to arrange.
 */
export function useLayoutPresetsCommand(
  worktreeId: string,
  activeTerminalTabId?: string | null
): LayoutPresetOption[] {
  const setTabGroupLayout = useAppStore((state) => state.setTabGroupLayout)
  const terminalPaneCount = useAppStore((state) =>
    activeTerminalTabId
      ? collectLeafIdsInOrder(state.terminalLayoutsByTabId[activeTerminalTabId]?.root).length
      : 0
  )
  const leafCount = useAppStore((state) => {
    const layout = state.layoutByWorktree[worktreeId]
    return layout ? collectLeafGroupIds(layout).length : 0
  })

  const target = terminalPaneCount > 1 ? 'terminal-panes' : 'tab-groups'
  const visibleCount = terminalPaneCount > 1 ? terminalPaneCount : leafCount
  return DOCUMENTED_PRESET_COUNTS.filter((count) => count > 1 && count === visibleCount).map(
    (count) => ({
      count,
      rows: computeGridRows(count),
      target,
      apply: () => {
        if (target === 'terminal-panes' && activeTerminalTabId) {
          window.dispatchEvent(
            new CustomEvent(ARRANGE_TERMINAL_PANE_GRID_EVENT, {
              detail: { tabId: activeTerminalTabId, rows: computeGridRows(count) }
            })
          )
          return
        }
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
    })
  )
}
