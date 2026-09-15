import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { Store } from '../persistence'
import { isBackgroundLaunch, showWindowWithoutStealingFocus } from './foreground-activation-policy'
import { installPrivilegedWindowNavigationPolicy } from './privileged-window-navigation'
import {
  getTerminalSessionWindowEntry,
  listTerminalSessionWindowEntries,
  terminalSessionWindowCount,
  trackTerminalSessionWindow,
  untrackTerminalSessionWindow
} from './terminal-session-window-registry'
import {
  getPersistedTerminalWindowBounds,
  saveTerminalWindowBounds,
  TERMINAL_WINDOW_MIN_HEIGHT,
  TERMINAL_WINDOW_MIN_WIDTH
} from './terminal-session-window-bounds'
import { makeTerminalWindowSessionKey } from '../../shared/terminal-window-session-key'

const DEFAULT_WIDTH = 900
const DEFAULT_HEIGHT = 600
const CASCADE_STEP = 32
const CASCADE_MARGIN = 48
const TERMINAL_WINDOW_PARTITION = 'nightshift-terminal-window'
const BOUNDS_SAVE_DEBOUNCE_MS = 500

export type OpenTerminalSessionWindowArgs = {
  worktreeId: string
  tabId: string
  /** Not yet routed to the renderer's query string; reserved for wiring the pty stream to this window. */
  ptyId?: string
}

export type TerminalSessionWindowSummary = {
  sessionKey: string
  worktreeId: string
  tabId: string
  focused: boolean
}

function loadTerminalWindow(
  window: BrowserWindow,
  sessionKey: string,
  worktreeId: string,
  tabId: string
): void {
  const search =
    `sessionKey=${encodeURIComponent(sessionKey)}` +
    `&worktreeId=${encodeURIComponent(worktreeId)}` +
    `&tabId=${encodeURIComponent(tabId)}`
  // Why: mirrors loadMainWindow/loadDashboardPopout's dev/prod branch.
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/terminal-window.html?${search}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/terminal-window.html'), { search })
  }
}

/** Offsets each new (bounds-less) window from the last so windows never open in a perfect stack. */
function computeCascadeOrigin(): { x: number; y: number } {
  const workArea = screen.getPrimaryDisplay().workArea
  const maxSteps = Math.max(
    1,
    Math.floor(
      Math.min(workArea.width - DEFAULT_WIDTH, workArea.height - DEFAULT_HEIGHT) / CASCADE_STEP
    )
  )
  const step = terminalSessionWindowCount() % maxSteps
  return {
    x: workArea.x + CASCADE_MARGIN + step * CASCADE_STEP,
    y: workArea.y + CASCADE_MARGIN + step * CASCADE_STEP
  }
}

function createTerminalWindow(
  store: Store | null,
  sessionKey: string,
  worktreeId: string,
  tabId: string
): BrowserWindow {
  const savedBounds = getPersistedTerminalWindowBounds(store, sessionKey)
  const origin = savedBounds ? null : computeCascadeOrigin()

  const window = new BrowserWindow({
    width: savedBounds?.width ?? DEFAULT_WIDTH,
    height: savedBounds?.height ?? DEFAULT_HEIGHT,
    ...(savedBounds
      ? { x: savedBounds.x, y: savedBounds.y }
      : origin
        ? { x: origin.x, y: origin.y }
        : {}),
    minWidth: TERMINAL_WINDOW_MIN_WIDTH,
    minHeight: TERMINAL_WINDOW_MIN_HEIGHT,
    title: 'Nightshift Terminal',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      // Why: an isolated session per terminal-window class (not per instance) keeps this
      // surface's zoom/storage separate from the main window and the dashboard pop-out.
      partition: TERMINAL_WINDOW_PARTITION,
      webviewTag: false
    }
  })
  installPrivilegedWindowNavigationPolicy(window.webContents)
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  )
  window.webContents.session.setPermissionCheckHandler(() => false)

  if (savedBounds?.maximized) {
    window.maximize()
  }

  trackTerminalSessionWindow({ sessionKey, worktreeId, tabId, window })

  window.once('ready-to-show', () => showWindowWithoutStealingFocus(window))

  let boundsTimer: ReturnType<typeof setTimeout> | null = null
  let closing = false
  const persistBounds = (): void => {
    if (boundsTimer) {
      clearTimeout(boundsTimer)
    }
    boundsTimer = setTimeout(() => {
      boundsTimer = null
      if (closing || window.isDestroyed() || window.isFullScreen()) {
        return
      }
      const maximized = window.isMaximized()
      const bounds = window.getBounds()
      if (bounds.width < TERMINAL_WINDOW_MIN_WIDTH || bounds.height < TERMINAL_WINDOW_MIN_HEIGHT) {
        return
      }
      saveTerminalWindowBounds(store, sessionKey, { ...bounds, maximized })
    }, BOUNDS_SAVE_DEBOUNCE_MS)
  }
  window.on('resize', persistBounds)
  window.on('move', persistBounds)
  window.on('maximize', persistBounds)
  window.on('unmaximize', persistBounds)

  // Why: teardown emits resize/move so freeze the save before it can clobber remembered bounds.
  window.on('close', () => {
    closing = true
    if (boundsTimer) {
      clearTimeout(boundsTimer)
      boundsTimer = null
    }
  })
  // Why: closing this window must not touch the session/pty — only untrack the OS window.
  window.on('closed', () => {
    untrackTerminalSessionWindow(sessionKey)
  })

  loadTerminalWindow(window, sessionKey, worktreeId, tabId)
  return window
}

/** Open a terminal window for this session, or focus the existing one for the same sessionKey. */
export function openOrFocusTerminalSessionWindow(
  store: Store | null,
  args: OpenTerminalSessionWindowArgs
): { sessionKey: string } {
  const sessionKey = makeTerminalWindowSessionKey(args.worktreeId, args.tabId)
  if (getTerminalSessionWindowEntry(sessionKey)) {
    focusTerminalSessionWindow(sessionKey)
    return { sessionKey }
  }
  createTerminalWindow(store, sessionKey, args.worktreeId, args.tabId)
  return { sessionKey }
}

export function focusTerminalSessionWindow(sessionKey: string): boolean {
  const entry = getTerminalSessionWindowEntry(sessionKey)
  if (!entry) {
    return false
  }
  if (entry.window.isMinimized()) {
    entry.window.restore()
  }
  showWindowWithoutStealingFocus(entry.window)
  if (!isBackgroundLaunch()) {
    entry.window.focus()
  }
  return true
}

/** Closes the OS window only. The underlying session/pty is untouched and stays reopenable. */
export function closeTerminalSessionWindow(sessionKey: string): void {
  getTerminalSessionWindowEntry(sessionKey)?.window.close()
}

export function listTerminalSessionWindows(): TerminalSessionWindowSummary[] {
  return listTerminalSessionWindowEntries().map((entry) => ({
    sessionKey: entry.sessionKey,
    worktreeId: entry.worktreeId,
    tabId: entry.tabId,
    focused: entry.window.isFocused()
  }))
}

export function getOpenTerminalSessionWindowCount(): number {
  return terminalSessionWindowCount()
}
