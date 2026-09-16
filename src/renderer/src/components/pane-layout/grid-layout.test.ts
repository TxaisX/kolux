import { describe, expect, it } from 'vitest'
import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import { computeGridRows, DOCUMENTED_PRESET_COUNTS } from './preset-grid'
import { collectLeafGroupIds } from './tidy-layout'
import { buildGridLayout } from './grid-layout'

function countLeaves(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `pane-${i}`)
}

describe('buildGridLayout', () => {
  it('preserves every leaf, in order, for each documented preset count', () => {
    for (const count of DOCUMENTED_PRESET_COUNTS) {
      const leafIds = countLeaves(count)
      const tree = buildGridLayout(leafIds, computeGridRows(count))
      expect(tree).not.toBeNull()
      expect(collectLeafGroupIds(tree!)).toEqual(leafIds)
    }
  })

  it('never invents or drops a leaf — leaf count always matches the input', () => {
    for (const count of [1, 2, 3, 5, 8, 13]) {
      const leafIds = countLeaves(count)
      const tree = buildGridLayout(leafIds, computeGridRows(count))
      expect(collectLeafGroupIds(tree!).length).toBe(count)
    }
  })

  it('is a no-op for a single pane', () => {
    const tree = buildGridLayout(['solo'], computeGridRows(1))
    expect(tree).toEqual({ type: 'leaf', groupId: 'solo' })
  })

  it('matches the computeGridRows shape for each documented count', () => {
    for (const count of DOCUMENTED_PRESET_COUNTS) {
      const rows = computeGridRows(count)
      const leafIds = countLeaves(count)
      const tree = buildGridLayout(leafIds, rows)
      // Reconstruct row membership by walking the vertical chain, then each
      // row's horizontal chain, and check row sizes match computeGridRows.
      const rowSizes: number[] = []
      let node: TabGroupLayoutNode = tree!
      while (node.type === 'split' && node.direction === 'vertical') {
        rowSizes.push(collectLeafGroupIds(node.first).length)
        node = node.second
      }
      rowSizes.push(collectLeafGroupIds(node).length)
      expect(rowSizes).toEqual(rows)
    }
  })

  it('refuses a mismatched leaf/shape pairing rather than ship a lossy tree', () => {
    expect(buildGridLayout(countLeaves(5), computeGridRows(8))).toBeNull()
  })
})
