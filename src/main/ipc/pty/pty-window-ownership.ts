import type { BrowserWindow, WebContents } from 'electron'
import {
  getTerminalSessionWindowEntry,
  listTerminalSessionWindowEntries
} from '../../window/terminal-session-window-registry'

// Why: each pty belongs to exactly one terminal window once opened there, so a
// flat ptyId -> sessionKey map is enough — no per-window bucket needed.
const sessionKeyByPtyId = new Map<string, string>()

export function setPtyWindowOwner(ptyId: string, sessionKey: string): void {
  sessionKeyByPtyId.set(ptyId, sessionKey)
}

export function clearPtyWindowOwner(ptyId: string): void {
  sessionKeyByPtyId.delete(ptyId)
}

export function getPtyWindowOwnerSessionKey(ptyId: string): string | undefined {
  return sessionKeyByPtyId.get(ptyId)
}

/** The owning terminal window, or null when unowned or its window is gone (registry self-cleans destroyed entries). */
export function getPtyOwnerWindow(ptyId: string): BrowserWindow | null {
  const sessionKey = sessionKeyByPtyId.get(ptyId)
  if (!sessionKey) {
    return null
  }
  return getTerminalSessionWindowEntry(sessionKey)?.window ?? null
}

/** Where this pty's IPC traffic should go: its owning terminal window if alive, else the main window (today's single-window behavior). */
export function resolvePtyDeliveryWindow(ptyId: string, mainWindow: BrowserWindow): BrowserWindow {
  return getPtyOwnerWindow(ptyId) ?? mainWindow
}

/** True when the resolved delivery target for this pty cannot receive anything right now. */
export function isPtyDeliveryWindowDestroyed(ptyId: string, mainWindow: BrowserWindow): boolean {
  const target = resolvePtyDeliveryWindow(ptyId, mainWindow)
  // Why webContents as well: a window outlives its renderer during teardown, and sending to a
  // destroyed WebContents throws. Checking only the window reopened that hole.
  return target.isDestroyed() || target.webContents.isDestroyed()
}

/** True when mainWindow is gone AND no terminal window remains — the only time a session-wide (not per-pty) delivery mechanism has nothing left to reach. */
export function hasAnyPtyDeliveryTarget(mainWindow: BrowserWindow): boolean {
  return !mainWindow.isDestroyed() || listTerminalSessionWindowEntries().length > 0
}

export function sessionKeyForWebContents(webContents: WebContents): string | null {
  for (const entry of listTerminalSessionWindowEntries()) {
    if (entry.window.webContents === webContents) {
      return entry.sessionKey
    }
  }
  return null
}

/** True for any tracked terminal window's renderer — used to widen pty IPC trust boundaries beyond the main window alone. */
export function isTerminalSessionWindowWebContents(webContents: WebContents): boolean {
  return sessionKeyForWebContents(webContents) !== null
}

/**
 * True when `sender` is allowed to act on this ptyId: the owning terminal
 * window if one is recorded, else the main window (today's sole legitimate
 * sender). Guards credit-bearing IPC (acks) so window A can't move window B's
 * accounting by naming its ptyId.
 */
export function isAuthorizedPtySender(
  sender: WebContents,
  ptyId: string,
  mainWindow: BrowserWindow
): boolean {
  const owner = getPtyOwnerWindow(ptyId)
  return owner ? sender === owner.webContents : sender === mainWindow.webContents
}

/** The renderer behind a pty IPC call, falling back to the main window when there is no
 *  event at all. A real ipcMain call always carries an event, so "no event" means the
 *  handler was invoked directly (as the suite does) and never a foreign renderer. */
export function ptySenderOrMain(
  event: { sender: WebContents } | null | undefined,
  mainWindow: BrowserWindow
): WebContents {
  return event?.sender ?? mainWindow.webContents
}

/** Test-only: the ownership map is a module-level singleton. */
export function resetPtyWindowOwnershipForTests(): void {
  sessionKeyByPtyId.clear()
}
