import type { BrowserWindow, WebContents } from 'electron'

export type TerminalSessionWindowEntry = {
  sessionKey: string
  worktreeId: string
  tabId: string
  /** The pty this window was opened on — the only one it may drive. */
  ptyId?: string
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

/** True when `sender` is a terminal window opened on exactly this pty. */
export function isTerminalSessionWindowRendererForPty(sender: WebContents, ptyId: string): boolean {
  return listTerminalSessionWindowEntries().some(
    (entry) => entry.ptyId === ptyId && entry.window.webContents === sender
  )
}

export function terminalSessionWindowCount(): number {
  return listTerminalSessionWindowEntries().length
}

/** Test-only: the registry is a module-level singleton, so suites must reset it between cases. */
export function resetTerminalSessionWindowRegistryForTests(): void {
  windowsBySessionKey.clear()
}
