import { describe, expect, it } from 'vitest'
import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import { computeGridRows } from './preset-grid'
import { type PaneCountGroupInfo, planPaneCount } from './pane-count-plan'

function leaf(groupId: string): TabGroupLayoutNode {
  return { type: 'leaf', groupId }
}

function row(ids: string[]): TabGroupLayoutNode {
  return ids
    .map(leaf)
    .reduceRight((acc, node) =>
      acc ? { type: 'split', direction: 'horizontal', first: node, second: acc } : node
    )
}

function group(
  groupId: string,
  overrides: Partial<Omit<PaneCountGroupInfo, 'groupId'>> = {}
): PaneCountGroupInfo {
  return {
    groupId,
    tabIds: [`${groupId}-tab`],
    activeTabId: `${groupId}-tab`,
    soleTabClosable: true,
    ...overrides
  }
}

describe('planPaneCount', () => {
  it('clamps the target above the max to 9', () => {
    const layout = row(['g1', 'g2'])
    const groups = [group('g1'), group('g2')]
    const plan = planPaneCount({ layout, groups }, 99)
    expect(plan.createGroups).toBe(7)
    expect(plan.achievable).toBe(9)
    expect(plan.rows).toEqual(computeGridRows(9))
  })

  it('clamps the target below the min to 1', () => {
    const layout = row(['g1', 'g2', 'g3'])
    const groups = [group('g1'), group('g2'), group('g3')]
    const plan = planPaneCount({ layout, groups }, 0)
    expect(plan.closeGroupIds).toEqual(['g3', 'g2'])
    expect(plan.achievable).toBe(1)
    expect(plan.rows).toEqual(computeGridRows(1))
  })

  it('is a no-op when the target equals the current count', () => {
    const layout = row(['g1', 'g2'])
    const groups = [group('g1'), group('g2')]
    const plan = planPaneCount({ layout, groups }, 2)
    expect(plan).toEqual({
      target: 2,
      createGroups: 0,
      closeGroupIds: [],
      rows: computeGridRows(2),
      achievable: 2
    })
  })

  it('grows by adding empty groups and never closes anything', () => {
    const layout = row(['g1'])
    const groups = [group('g1')]
    const plan = planPaneCount({ layout, groups }, 4)
    expect(plan.createGroups).toBe(3)
    expect(plan.closeGroupIds).toEqual([])
    expect(plan.achievable).toBe(4)
    expect(plan.rows).toEqual(computeGridRows(4))
  })

  it('handles a null layout (no groups yet) as a zero count', () => {
    const plan = planPaneCount({ layout: null, groups: [] }, 3)
    expect(plan.createGroups).toBe(3)
    expect(plan.achievable).toBe(3)
  })

  it('shrinks from the end when every trailing group is closable', () => {
    const layout = row(['g1', 'g2', 'g3', 'g4'])
    const groups = [group('g1'), group('g2'), group('g3'), group('g4')]
    const plan = planPaneCount({ layout, groups }, 2)
    expect(plan.closeGroupIds).toEqual(['g4', 'g3'])
    expect(plan.createGroups).toBe(0)
    expect(plan.achievable).toBe(2)
    expect(plan.rows).toEqual(computeGridRows(2))
  })

  it('never closes a group with more than one tab, and stops shrinking there', () => {
    const layout = row(['g1', 'g2', 'g3'])
    const groups = [group('g1'), group('g2', { tabIds: ['a', 'b'] }), group('g3')]
    const plan = planPaneCount({ layout, groups }, 1)
    // g3 closes; g2 has two tabs and blocks further shrinking before g1 is reached.
    expect(plan.closeGroupIds).toEqual(['g3'])
    expect(plan.target).toBe(1)
    expect(plan.achievable).toBe(2)
    expect(plan.rows).toEqual(computeGridRows(2))
  })

  it('never closes a group with a running agent, and stops shrinking there', () => {
    const layout = row(['g1', 'g2', 'g3'])
    const groups = [group('g1'), group('g2', { soleTabClosable: false }), group('g3')]
    const plan = planPaneCount({ layout, groups }, 1)
    expect(plan.closeGroupIds).toEqual(['g3'])
    expect(plan.achievable).toBe(2)
  })

  it('reports achievable = current count when the very last group is not closable', () => {
    const layout = row(['g1', 'g2'])
    const groups = [group('g1'), group('g2', { soleTabClosable: false })]
    const plan = planPaneCount({ layout, groups }, 1)
    expect(plan.closeGroupIds).toEqual([])
    expect(plan.achievable).toBe(2)
    expect(plan.rows).toEqual(computeGridRows(2))
  })

  it('treats an unknown group id as not closable', () => {
    const layout = row(['g1', 'g2'])
    const groups = [group('g1')]
    const plan = planPaneCount({ layout, groups }, 1)
    expect(plan.closeGroupIds).toEqual([])
    expect(plan.achievable).toBe(2)
  })
})
