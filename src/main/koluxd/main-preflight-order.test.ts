import { describe, expect, it, vi } from 'vitest'

/**
 * The precondition is only worth anything if it runs first. A loader failure is not
 * catchable, so a preflight that lands after `main()` has already reached
 * `await import('../ipc/pty')` prevents nothing.
 */
const order: string[] = []

vi.mock('./koluxd-native-preflight', () => ({
  runKoluxdNativePreflight: () => {
    order.push('preflight')
    return true
  }
}))

vi.mock('./koluxd-entry', () => ({
  main: async () => {
    order.push('main')
  }
}))

describe('koluxd entry', () => {
  it('runs the native preflight before starting the runtime', async () => {
    await import('./main')
    await vi.waitFor(() => expect(order).toContain('main'))

    expect(order).toEqual(['preflight', 'main'])
  })
})
