import type { FloorRange } from './floor-types'

const MINUTE_MS = 60_000

/** Visible [start, end] window for a Floor range preset, ending at `now`. */
export function resolveFloorRange(range: FloorRange, now: number): { start: number; end: number } {
  if (range === 'today') {
    const startOfDay = new Date(now)
    startOfDay.setHours(0, 0, 0, 0)
    return { start: startOfDay.getTime(), end: now }
  }
  const minutes = range === '15m' ? 15 : 60
  return { start: now - minutes * MINUTE_MS, end: now }
}

/** Position of an epoch ms timestamp as a 0–100 percentage across the range,
 *  clamped so a segment that starts before the visible window still renders
 *  flush against the left edge instead of off-screen. */
export function floorTimePercent(at: number, range: { start: number; end: number }): number {
  const span = range.end - range.start
  if (span <= 0) {
    return 0
  }
  return Math.min(100, Math.max(0, ((at - range.start) / span) * 100))
}

export type FloorAxisTick = { at: number; label: string }

/** Evenly spaced tick marks across the range, oldest first, excluding the
 *  trailing edge (t=end/now) so the axis reads as "time before now" instead
 *  of ending on a redundant "now" label right next to the live edge. */
export function buildFloorAxisTicks(
  range: { start: number; end: number },
  count = 6
): FloorAxisTick[] {
  const span = Math.max(0, range.end - range.start)
  const ticks: FloorAxisTick[] = []
  for (let i = 0; i < count; i++) {
    const at = range.start + (i * span) / count
    const minutesAgo = Math.round((range.end - at) / MINUTE_MS)
    ticks.push({ at, label: minutesAgo <= 0 ? 'now' : `−${minutesAgo}m` })
  }
  return ticks
}
