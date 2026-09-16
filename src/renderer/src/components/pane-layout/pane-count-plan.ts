import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import { computeGridRows } from './preset-grid'
import { collectLeafGroupIds } from './tidy-layout'

export const PANE_COUNT_MIN = 1
export const PANE_COUNT_MAX = 9

export type PaneCountGroupInfo = {
  groupId: string
  tabIds: string[]
  activeTabId: string | null
  /** Safe to close outright once this group is down to its one tab: a pending
   *  agent-choice placeholder, or an idle terminal with no running agent.
   *  False for editor/browser/agent-session content and for a terminal
   *  actively running an agent — the caller derives this from live status. */
  soleTabClosable: boolean
}

export type PaneCountPlan = {
  /** The requested target, clamped to 1..9. */
  target: number
  /** Empty (pending agent-choice) groups to add, growing toward the target. */
  createGroups: number
  /** Existing groups to close, end-first, in the order to close them. */
  closeGroupIds: string[]
  /** Row layout (per computeGridRows) for the count actually reached. */
  rows: number[]
  /** The pane count actually reachable — below `target` only when a shrink stalled. */
  achievable: number
}

function isClosable(group: PaneCountGroupInfo | undefined): boolean {
  return !!group && group.tabIds.length <= 1 && group.soleTabClosable
}

/**
 * Pure plan for "choose how many panes": how many empty groups to add, which
 * existing groups to close, and the resulting grid. Target is clamped to
 * 1..9. Shrinking only ever closes a contiguous run from the end and never
 * closes a group holding more than one tab or a running agent — it stops at
 * the first group it can't close, and `achievable` reports what was reached.
 */
export function planPaneCount(
  current: { layout: TabGroupLayoutNode | null; groups: PaneCountGroupInfo[] },
  target: number
): PaneCountPlan {
  const clampedTarget = Math.min(PANE_COUNT_MAX, Math.max(PANE_COUNT_MIN, Math.floor(target)))
  const orderedIds = current.layout
    ? collectLeafGroupIds(current.layout)
    : current.groups.map((group) => group.groupId)
  const currentCount = orderedIds.length

  if (clampedTarget >= currentCount) {
    return {
      target: clampedTarget,
      createGroups: clampedTarget - currentCount,
      closeGroupIds: [],
      rows: computeGridRows(clampedTarget),
      achievable: clampedTarget
    }
  }

  const groupsById = new Map(current.groups.map((group) => [group.groupId, group]))
  const closeGroupIds: string[] = []
  let remaining = currentCount
  for (let i = orderedIds.length - 1; i >= 0 && remaining > clampedTarget; i--) {
    if (!isClosable(groupsById.get(orderedIds[i]))) {
      break
    }
    closeGroupIds.push(orderedIds[i])
    remaining -= 1
  }

  return {
    target: clampedTarget,
    createGroups: 0,
    closeGroupIds,
    rows: computeGridRows(remaining),
    achievable: remaining
  }
}
