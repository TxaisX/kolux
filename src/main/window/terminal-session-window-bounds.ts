import type { Store } from '../persistence'
import { rectHasVisibleAreaOnAnyDisplay } from './window-bounds-validation'

export type TerminalWindowBounds = {
  x: number
  y: number
  width: number
  height: number
  maximized?: boolean
}

export const TERMINAL_WINDOW_MIN_WIDTH = 400
export const TERMINAL_WINDOW_MIN_HEIGHT = 300

/** Restored bounds for this sessionKey, or null when absent/off-screen (mirrors dashboard-popout's guard). */
export function getPersistedTerminalWindowBounds(
  store: Store | null,
  sessionKey: string
): TerminalWindowBounds | null {
  const raw = store?.getUI().terminalWindowBoundsBySessionKey?.[sessionKey] ?? null
  if (
    raw &&
    raw.width >= TERMINAL_WINDOW_MIN_WIDTH &&
    raw.height >= TERMINAL_WINDOW_MIN_HEIGHT &&
    rectHasVisibleAreaOnAnyDisplay(
      raw,
      TERMINAL_WINDOW_MIN_WIDTH / 2,
      TERMINAL_WINDOW_MIN_HEIGHT / 2
    )
  ) {
    return raw
  }
  if (raw) {
    console.warn('[terminal-window] Discarding off-screen/near-min bounds for', sessionKey, raw)
  }
  return null
}

export function saveTerminalWindowBounds(
  store: Store | null,
  sessionKey: string,
  bounds: TerminalWindowBounds
): void {
  if (!store) {
    return
  }
  const current = store.getUI().terminalWindowBoundsBySessionKey ?? {}
  store.updateUI({
    terminalWindowBoundsBySessionKey: { ...current, [sessionKey]: bounds }
  })
}
