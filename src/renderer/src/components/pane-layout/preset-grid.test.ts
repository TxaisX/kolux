import { describe, expect, it } from 'vitest'
import { computeGridRows, DOCUMENTED_PRESET_COUNTS } from './preset-grid'

describe('computeGridRows', () => {
  it('returns the expected grid for every documented preset count', () => {
    const expected: Record<number, number[]> = {
      1: [1],
      2: [2],
      4: [2, 2],
      6: [3, 3],
      8: [3, 3, 2],
      10: [4, 3, 3],
      12: [4, 4, 4],
      14: [4, 4, 3, 3],
      16: [4, 4, 4, 4]
    }
    for (const count of DOCUMENTED_PRESET_COUNTS) {
      expect(computeGridRows(count)).toEqual(expected[count])
    }
  })

  it('handles a single pane', () => {
    expect(computeGridRows(1)).toEqual([1])
  })

  it('produces a sensible arrangement for odd/in-between counts, never ragged', () => {
    for (const count of [3, 5, 7, 9, 11, 13, 15]) {
      const rows = computeGridRows(count)
      const total = rows.reduce((sum, cols) => sum + cols, 0)
      // No pane is dropped or duplicated by the grid math.
      expect(total).toBe(count)
      // No row is left more than one pane short of the widest row (no ragged tail).
      expect(Math.max(...rows) - Math.min(...rows)).toBeLessThanOrEqual(1)
    }
  })

  it('clamps non-positive or fractional input to a valid single pane', () => {
    expect(computeGridRows(0)).toEqual([1])
    expect(computeGridRows(-3)).toEqual([1])
    expect(computeGridRows(1.9)).toEqual([1])
  })
})
