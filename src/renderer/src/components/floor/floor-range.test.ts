import { describe, expect, it } from 'vitest'
import { buildFloorAxisTicks, floorTimePercent, resolveFloorRange } from './floor-range'

const NOW = 1_700_000_000_000
const MIN = 60_000

describe('resolveFloorRange', () => {
  it('resolves 15m and 60m as a fixed window ending at now', () => {
    expect(resolveFloorRange('15m', NOW)).toEqual({ start: NOW - 15 * MIN, end: NOW })
    expect(resolveFloorRange('60m', NOW)).toEqual({ start: NOW - 60 * MIN, end: NOW })
  })

  it('resolves today as local midnight through now', () => {
    const { start, end } = resolveFloorRange('today', NOW)
    expect(end).toBe(NOW)
    expect(new Date(start).getHours()).toBe(0)
    expect(new Date(start).getMinutes()).toBe(0)
    expect(start).toBeLessThanOrEqual(NOW)
  })
})

describe('buildFloorAxisTicks', () => {
  it('produces 6 evenly spaced ticks by default, oldest first', () => {
    const range = { start: NOW - 60 * MIN, end: NOW }
    const ticks = buildFloorAxisTicks(range)
    expect(ticks).toHaveLength(6)
    expect(ticks[0].label).toBe('−60m')
    expect(ticks.at(-1)?.label).toBe('−10m')
    // Monotonically increasing timestamps (oldest tick first).
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].at).toBeGreaterThan(ticks[i - 1].at)
    }
  })

  it('honors a custom tick count', () => {
    const range = { start: NOW - 60 * MIN, end: NOW }
    expect(buildFloorAxisTicks(range, 3)).toHaveLength(3)
  })
})

describe('floorTimePercent', () => {
  const range = { start: NOW - 60 * MIN, end: NOW }

  it('maps range.start to 0 and range.end to 100', () => {
    expect(floorTimePercent(range.start, range)).toBe(0)
    expect(floorTimePercent(range.end, range)).toBe(100)
  })

  it('clamps timestamps outside the range instead of returning out-of-bounds percentages', () => {
    expect(floorTimePercent(range.start - MIN, range)).toBe(0)
    expect(floorTimePercent(range.end + MIN, range)).toBe(100)
  })

  it('interpolates linearly in between', () => {
    expect(floorTimePercent(range.start + 30 * MIN, range)).toBeCloseTo(50)
  })
})
