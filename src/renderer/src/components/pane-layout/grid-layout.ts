import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import { tidyLayout } from './tidy-layout'

/**
 * Pure tree-builder for "Layout presets": rebuilds the split tree into a
 * balanced grid (per `computeGridRows`) while preserving every existing
 * leaf, in order — only split nodes are created/removed, never leaves.
 *
 * `rows` must sum to `leafGroupIds.length`; a mismatch means the shape
 * doesn't fit these leaves without inventing or dropping one, so the
 * caller gets `null` back rather than a lossy tree.
 */
export function buildGridLayout(
  leafGroupIds: readonly string[],
  rows: readonly number[]
): TabGroupLayoutNode | null {
  const total = rows.reduce((sum, count) => sum + count, 0)
  if (rows.length === 0 || total !== leafGroupIds.length || leafGroupIds.some((id) => !id)) {
    return null
  }

  let cursor = 0
  const rowNodes: TabGroupLayoutNode[] = rows.map((count) => {
    const rowLeaves = leafGroupIds.slice(cursor, cursor + count)
    cursor += count
    return chain(rowLeaves, 'horizontal')
  })

  // Why: reuse tidyLayout to compute even flex ratios instead of
  // re-deriving the same first/(first+second) math here.
  return tidyLayout(chain(rowNodes, 'vertical', true))
}

/** Right-leaning chain of splits: leaf, or split(leaf, chain(rest)). */
function chain(
  items: readonly (TabGroupLayoutNode | string)[],
  direction: 'horizontal' | 'vertical',
  isNodes = false
): TabGroupLayoutNode {
  const toNode = (item: TabGroupLayoutNode | string): TabGroupLayoutNode =>
    isNodes ? (item as TabGroupLayoutNode) : { type: 'leaf', groupId: item as string }
  if (items.length === 1) {
    return toNode(items[0])
  }
  return {
    type: 'split',
    direction,
    first: toNode(items[0]),
    second: chain(items.slice(1), direction, isNodes),
    ratio: 0.5
  }
}
