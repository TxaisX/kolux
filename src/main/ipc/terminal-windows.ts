import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import {
  closeTerminalSessionWindow,
  focusTerminalSessionWindow,
  listTerminalSessionWindows,
  openOrFocusTerminalSessionWindow,
  type OpenTerminalSessionWindowArgs
} from '../window/terminal-session-window'
import { restoreLiveTerminalSessionWindows } from '../window/terminal-session-window-restore'
import { setPtyWindowOwner } from './pty/pty-window-ownership'
import { isValidTerminalWindowIdPart } from '../../shared/terminal-window-session-key'

const MAX_SESSION_KEY_LENGTH = 1025 // two 512-char id parts + the "::" separator

function isOpenArgs(value: unknown): value is OpenTerminalSessionWindowArgs {
  if (!value || typeof value !== 'object') {
    return false
  }
  const { worktreeId, tabId, ptyId } = value as Record<string, unknown>
  if (!isValidTerminalWindowIdPart(worktreeId) || !isValidTerminalWindowIdPart(tabId)) {
    return false
  }
  return ptyId === undefined || typeof ptyId === 'string'
}

function isSessionKeyArgs(value: unknown): value is { sessionKey: string } {
  if (!value || typeof value !== 'object') {
    return false
  }
  const { sessionKey } = value as Record<string, unknown>
  return (
    typeof sessionKey === 'string' &&
    sessionKey.length > 0 &&
    sessionKey.length <= MAX_SESSION_KEY_LENGTH
  )
}

export function registerTerminalWindowsHandlers(store: Store | null): void {
  ipcMain.removeHandler('terminalWindows:open')
  ipcMain.removeHandler('terminalWindows:close')
  ipcMain.removeHandler('terminalWindows:focus')
  ipcMain.removeHandler('terminalWindows:list')

  ipcMain.handle(
    'terminalWindows:open',
    (_event, args: unknown): { ok: true; sessionKey: string } | { error: string } => {
      if (!isOpenArgs(args)) {
        return { error: 'invalid-args' }
      }
      const { sessionKey } = openOrFocusTerminalSessionWindow(store, args)
      if (args.ptyId) {
        setPtyWindowOwner(args.ptyId, sessionKey)
      }
      return { ok: true, sessionKey }
    }
  )

  ipcMain.handle('terminalWindows:close', (_event, args: unknown): { ok: true } => {
    // Why: close is idempotent — a malformed or already-gone key is a no-op, not a rejection.
    if (isSessionKeyArgs(args)) {
      closeTerminalSessionWindow(args.sessionKey)
    }
    return { ok: true }
  })

  ipcMain.handle(
    'terminalWindows:focus',
    (_event, args: unknown): { ok: true } | { error: string } => {
      if (!isSessionKeyArgs(args)) {
        return { error: 'invalid-args' }
      }
      return focusTerminalSessionWindow(args.sessionKey) ? { ok: true } : { error: 'not-found' }
    }
  )

  ipcMain.handle('terminalWindows:list', () => ({ sessions: listTerminalSessionWindows() }))

  restoreLiveTerminalSessionWindows(store)
}
