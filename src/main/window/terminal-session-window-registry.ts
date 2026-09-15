import type { BrowserWindow } from 'electron'

export type TerminalSessionWindowEntry = {
  sessionKey: string
  worktreeId: string
  tabId: string
  window: BrowserWindow
}

// Why: one process-wide map — every terminal window is a top-level BrowserWindow
// tracked by sessionKey so a second open() for the same key focuses instead of
// duplicating (module-level singleton, same pattern as dashboard-popout-window).
const windowsBySessionKey = new Map<string, TerminalSessionWindowEntry>()

export function getTerminalSessionWindowEntry(
  sessionKey: string
): TerminalSessionWindowEntry | null {
  const entry = windowsBySessionKey.get(sessionKey)
  if (!entry) {
    return null
  }
  if (entry.window.isDestroyed()) {
    windowsBySessionKey.delete(sessionKey)
    return null
  }
  return entry
}

export function trackTerminalSessionWindow(entry: TerminalSessionWindowEntry): void {
  windowsBySessionKey.set(entry.sessionKey, entry)
}

export function untrackTerminalSessionWindow(sessionKey: string): void {
  windowsBySessionKey.delete(sessionKey)
}

export function listTerminalSessionWindowEntries(): TerminalSessionWindowEntry[] {
  return [...windowsBySessionKey.values()].filter((entry) => !entry.window.isDestroyed())
}

export function terminalSessionWindowCount(): number {
  return listTerminalSessionWindowEntries().length
}

/** Test-only: the registry is a module-level singleton, so suites must reset it between cases. */
export function resetTerminalSessionWindowRegistryForTests(): void {
  windowsBySessionKey.clear()
}
