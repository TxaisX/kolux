import { useCallback } from 'react'
import { toast } from 'sonner'
import { useAppStore, type AppState } from '../../store'
import { EQUALIZE_PANES_EVENT } from '@/constants/terminal'
import { selectLiveTabAgentPanes } from '@/lib/tab-agent-status-index'
import { translate } from '@/i18n/i18n'
import { closeTerminalTab } from '../terminal/terminal-tab-actions'
import { buildGridLayout } from '../pane-layout/grid-layout'
import { collectLeafGroupIds } from '../pane-layout/tidy-layout'
import { computeGridRows } from '../pane-layout/preset-grid'
import {
  PANE_COUNT_MAX,
  PANE_COUNT_MIN,
  planPaneCount,
  type PaneCountGroupInfo
} from '../pane-layout/pane-count-plan'

const T = (id: string, fallback: string): string =>
  translate(`auto.components.tab.group.usePaneCountCommand.${id}`, fallback)

export type PaneCountCommand = {
  count: number
  setCount: (target: number) => void
  increment: () => void
  decrement: () => void
  max: number
  min: number
}

function buildGroupInfo(state: AppState, worktreeId: string): PaneCountGroupInfo[] {
  const groups = state.groupsByWorktree[worktreeId] ?? []
  const unifiedTabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  return groups.map((group) => {
    const soleTab =
      group.tabOrder.length === 1
        ? unifiedTabs.find((tab) => tab.id === group.tabOrder[0])
        : undefined
    const soleTabClosable = Boolean(
      soleTab &&
        soleTab.contentType === 'terminal' &&
        selectLiveTabAgentPanes(state.agentStatusByPaneKey, soleTab.id).length === 0
    )
    return {
      groupId: group.id,
      tabIds: group.tabOrder,
      activeTabId: group.activeTabId,
      soleTabClosable
    }
  })
}

/** Rebuilds the worktree's tab-group tree into a balanced grid for whatever
 *  leaves currently exist, and re-broadcasts Tidy so per-tab panes even out
 *  too (see useTidyLayoutCommand) — growing/shrinking changes leaf count, so
 *  presets' exact-match rebuild doesn't apply here. */
function regridToCurrentLeaves(setTabGroupLayout: AppState['setTabGroupLayout'], worktreeId: string): void {
  const layout = useAppStore.getState().layoutByWorktree[worktreeId]
  if (!layout) {
    return
  }
  const leafIds = collectLeafGroupIds(layout)
  const nextLayout = buildGridLayout(leafIds, computeGridRows(leafIds.length))
  if (nextLayout) {
    setTabGroupLayout(worktreeId, nextLayout)
  }
  window.dispatchEvent(new Event(EQUALIZE_PANES_EVENT))
}

/** Surfaces the one case planPaneCount can't fully satisfy: a shrink that
 *  stopped early because the next pane in line has more than one tab or a
 *  running agent, leaving more panes than requested. */
function notifyIfShrinkStalled(target: number, achievable: number): void {
  if (achievable === target) {
    return
  }
  toast.message(
    translate(
      'auto.components.tab.group.usePaneCountCommand.shrinkStopped',
      'Stopped at {{achievable}} panes',
      { achievable }
    ),
    {
      description: T(
        'shrinkStoppedDescription',
        'The next pane has more than one tab or a running agent — close it first.'
      )
    }
  )
}

/**
 * "Choose how many panes": grows the worktree's tab-group tree with fresh
 * agent-picker panes, or shrinks it by closing trailing groups the plan
 * marked safe — then regrids to a balanced layout. See pane-count-plan.ts
 * for the pure decision of what to create/close.
 */
export function usePaneCountCommand(worktreeId: string): PaneCountCommand {
  const setTabGroupLayout = useAppStore((state) => state.setTabGroupLayout)
  const createEmptySplitGroup = useAppStore((state) => state.createEmptySplitGroup)
  const closeEmptyGroup = useAppStore((state) => state.closeEmptyGroup)
  const createTab = useAppStore((state) => state.createTab)
  const count = useAppStore((state) => {
    const layout = state.layoutByWorktree[worktreeId]
    return layout ? collectLeafGroupIds(layout).length : 0
  })

  const setCount = useCallback(
    (target: number) => {
      const state = useAppStore.getState()
      const layout = state.layoutByWorktree[worktreeId] ?? null
      const plan = planPaneCount({ layout, groups: buildGroupInfo(state, worktreeId) }, target)

      if (plan.createGroups > 0) {
        const sourceGroupId = layout ? collectLeafGroupIds(layout)[0] : undefined
        for (let i = 0; i < plan.createGroups && sourceGroupId; i++) {
          const newGroupId = createEmptySplitGroup(worktreeId, sourceGroupId, 'right', {
            activate: false
          })
          if (!newGroupId) {
            break
          }
          createTab(worktreeId, newGroupId, undefined, {
            pendingAgentChoice: true,
            activate: false,
            recordInteraction: false
          })
        }
        regridToCurrentLeaves(setTabGroupLayout, worktreeId)
        return
      }

      if (plan.closeGroupIds.length === 0) {
        notifyIfShrinkStalled(plan.target, plan.achievable)
        return
      }
      let pending = plan.closeGroupIds.length
      const settle = (): void => {
        pending -= 1
        if (pending === 0) {
          regridToCurrentLeaves(setTabGroupLayout, worktreeId)
          const finalLayout = useAppStore.getState().layoutByWorktree[worktreeId]
          const finalCount = finalLayout ? collectLeafGroupIds(finalLayout).length : 0
          notifyIfShrinkStalled(plan.target, finalCount)
        }
      }
      for (const groupId of plan.closeGroupIds) {
        const group = (useAppStore.getState().groupsByWorktree[worktreeId] ?? []).find(
          (candidate) => candidate.id === groupId
        )
        const soleTab = group?.tabOrder[0]
          ? (useAppStore.getState().unifiedTabsByWorktree[worktreeId] ?? []).find(
              (tab) => tab.id === group.tabOrder[0]
            )
          : undefined
        if (!soleTab) {
          closeEmptyGroup(worktreeId, groupId)
          settle()
          continue
        }
        // Why: goes through the same guarded close every tab-strip close uses
        // (pinned/running-process confirmation), so a plan built from stale
        // status still respects a live confirmation if one turns out needed.
        closeTerminalTab(soleTab.entityId, {
          onClosed: () => {
            closeEmptyGroup(worktreeId, groupId)
            settle()
          },
          onCancel: settle
        })
      }
    },
    [closeEmptyGroup, createEmptySplitGroup, createTab, setTabGroupLayout, worktreeId]
  )

  return {
    count,
    setCount,
    increment: useCallback(() => setCount(count + 1), [setCount, count]),
    decrement: useCallback(() => setCount(count - 1), [setCount, count]),
    max: PANE_COUNT_MAX,
    min: PANE_COUNT_MIN
  }
}
