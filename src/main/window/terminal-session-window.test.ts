import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Display = { workArea: { x: number; y: number; width: number; height: number } }

const {
  instances,
  BrowserWindowMock,
  getPrimaryDisplayMock,
  getAllDisplaysMock,
  installNavigationPolicyMock,
  isMock
} = vi.hoisted(() => {
  const created: FakeWindow[] = []

  class FakeWindow {
    options: Electron.BrowserWindowConstructorOptions
    private handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
    private onceHandlers: Record<string, ((...args: unknown[]) => void)[]> = {}
    destroyed = false
    minimized = false
    fullscreen = false
    maximized = false
    focused = false
    bounds = { x: 100, y: 100, width: 900, height: 600 }
    webContents = {
      session: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn()
      }
    }
    focus = vi.fn(() => {
      this.focused = true
    })
    show = vi.fn()
    showInactive = vi.fn()
    restore = vi.fn(() => {
      this.minimized = false
    })
    maximize = vi.fn(() => {
      this.maximized = true
    })
    loadURL = vi.fn()
    loadFile = vi.fn()
    close = vi.fn(() => {
      this.destroyed = true
      this.emit('close')
      this.emit('closed')
    })

    constructor(options: Electron.BrowserWindowConstructorOptions) {
      this.options = options
      created.push(this)
    }

    on(event: string, cb: (...args: unknown[]) => void): this {
      ;(this.handlers[event] ||= []).push(cb)
      return this
    }
    once(event: string, cb: (...args: unknown[]) => void): this {
      ;(this.onceHandlers[event] ||= []).push(cb)
      return this
    }
    emit(event: string, ...args: unknown[]): void {
      for (const cb of this.handlers[event] ?? []) {
        cb(...args)
      }
      for (const cb of this.onceHandlers[event] ?? []) {
        cb(...args)
      }
    }
    isDestroyed(): boolean {
      return this.destroyed
    }
    isFocused(): boolean {
      return this.focused
    }
    isMinimized(): boolean {
      return this.minimized
    }
    isFullScreen(): boolean {
      return this.fullscreen
    }
    isMaximized(): boolean {
      return this.maximized
    }
    getBounds(): { x: number; y: number; width: number; height: number } {
      return this.bounds
    }
  }

  return {
    instances: created,
    BrowserWindowMock: FakeWindow,
    getPrimaryDisplayMock: vi.fn((): Display => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 }
    })),
    getAllDisplaysMock: vi.fn((): Display[] => [
      { workArea: { x: 0, y: 0, width: 1920, height: 1080 } }
    ]),
    installNavigationPolicyMock: vi.fn(),
    isMock: { dev: false } as { dev: boolean }
  }
})

vi.mock('electron', () => ({
  BrowserWindow: BrowserWindowMock,
  screen: { getPrimaryDisplay: getPrimaryDisplayMock, getAllDisplays: getAllDisplaysMock }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: isMock }))
vi.mock('./privileged-window-navigation', () => ({
  installPrivilegedWindowNavigationPolicy: installNavigationPolicyMock
}))

import {
  closeTerminalSessionWindow,
  focusTerminalSessionWindow,
  listTerminalSessionWindows,
  openOrFocusTerminalSessionWindow
} from './terminal-session-window'
import { resetTerminalSessionWindowRegistryForTests } from './terminal-session-window-registry'
import { makeTerminalWindowSessionKey } from '../../shared/terminal-window-session-key'

function makeStore(
  bounds: Record<string, unknown> = {},
  tabsByWorktree: Record<string, { id: string; ptyId: string | null }[]> = {}
): {
  getUI: () => Record<string, unknown>
  updateUI: ReturnType<typeof vi.fn>
  getWorkspaceSession: () => { tabsByWorktree: typeof tabsByWorktree }
} {
  const ui: Record<string, unknown> = { terminalWindowBoundsBySessionKey: bounds }
  return {
    getUI: () => ui,
    getWorkspaceSession: () => ({ tabsByWorktree }),
    updateUI: vi.fn((patch: Record<string, unknown>) => Object.assign(ui, patch))
  }
}

beforeEach(() => {
  instances.length = 0
  isMock.dev = false
  resetTerminalSessionWindowRegistryForTests()
  vi.stubEnv('KOLUX_BACKGROUND_LAUNCH', undefined)
  vi.stubEnv('ELECTRON_RENDERER_URL', '')
})

afterEach(() => {
  resetTerminalSessionWindowRegistryForTests()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('openOrFocusTerminalSessionWindow', () => {
  it('creates a single-terminal window with the shared preload and no webview surface', () => {
    const store = makeStore()
    openOrFocusTerminalSessionWindow(store as never, { worktreeId: 'wt1', tabId: 'tab1' })

    expect(instances).toHaveLength(1)
    const opts = instances[0].options
    expect(opts.webPreferences?.sandbox).toBe(true)
    expect(opts.webPreferences?.webviewTag).toBe(false)
    expect(opts.webPreferences?.partition).toBe('kolux-terminal-window')
    expect(opts.webPreferences?.preload).toMatch(/preload[\\/]index\.js$/)
    expect(installNavigationPolicyMock).toHaveBeenCalledWith(instances[0].webContents)
  })

  it('attaches the persisted pty of the tab when the caller omits ptyId', () => {
    const store = makeStore({}, { 'repo::G:/wt1': [{ id: 'tab1', ptyId: 'pty-9' }] })
    openOrFocusTerminalSessionWindow(store as never, { worktreeId: 'repo::G:/wt1', tabId: 'tab1' })

    const search = new URLSearchParams(instances[0].loadFile.mock.calls[0][1].search)
    expect(search.get('worktreeId')).toBe('repo::G:/wt1')
    expect(search.get('ptyId')).toBe('pty-9')
  })

  it('focuses the existing window instead of opening a duplicate for the same sessionKey', () => {
    const store = makeStore()
    const first = openOrFocusTerminalSessionWindow(store as never, {
      worktreeId: 'wt1',
      tabId: 'tab1'
    })
    const second = openOrFocusTerminalSessionWindow(store as never, {
      worktreeId: 'wt1',
      tabId: 'tab1'
    })

    expect(instances).toHaveLength(1)
    expect(second.sessionKey).toBe(first.sessionKey)
    expect(instances[0].focus).toHaveBeenCalled()
  })

  it('opens a distinct window for a different sessionKey', () => {
    const store = makeStore()
    openOrFocusTerminalSessionWindow(store as never, { worktreeId: 'wt1', tabId: 'tab1' })
    openOrFocusTerminalSessionWindow(store as never, { worktreeId: 'wt1', tabId: 'tab2' })

    expect(instances).toHaveLength(2)
    expect(
      listTerminalSessionWindows()
        .map((s) => s.sessionKey)
        .sort()
    ).toEqual(
      [
        makeTerminalWindowSessionKey('wt1', 'tab1'),
        makeTerminalWindowSessionKey('wt1', 'tab2')
      ].sort()
    )
  })

  it('cascades new (bounds-less) windows instead of stacking them', () => {
    const store = makeStore()
    openOrFocusTerminalSessionWindow(store as never, { worktreeId: 'wt1', tabId: 'tab1' })
    openOrFocusTerminalSessionWindow(store as never, { worktreeId: 'wt1', tabId: 'tab2' })

    const [firstOpts, secondOpts] = instances.map((w) => w.options)
    expect(secondOpts.x).toBe((firstOpts.x ?? 0) + 32)
    expect(secondOpts.y).toBe((firstOpts.y ?? 0) + 32)
  })

  it('restores a window at its persisted bounds per sessionKey', () => {
    const sessionKey = makeTerminalWindowSessionKey('wt1', 'tab1')
    const store = makeStore({ [sessionKey]: { x: 200, y: 250, width: 1000, height: 700 } })

    openOrFocusTerminalSessionWindow(store as never, { worktreeId: 'wt1', tabId: 'tab1' })

    const opts = instances[0].options
    expect(opts.x).toBe(200)
    expect(opts.y).toBe(250)
    expect(opts.width).toBe(1000)
    expect(opts.height).toBe(700)
  })

  it('round-trips bounds: resizing saves them under this session’s key only', () => {
    vi.useFakeTimers()
    const store = makeStore()
    openOrFocusTerminalSessionWindow(store as never, { worktreeId: 'wt1', tabId: 'tab1' })
    const window = instances[0]
    window.bounds = { x: 10, y: 20, width: 950, height: 650 }
    window.emit('resize')
    vi.advanceTimersByTime(600)

    const sessionKey = makeTerminalWindowSessionKey('wt1', 'tab1')
    expect(store.updateUI).toHaveBeenCalledWith({
      terminalWindowBoundsBySessionKey: {
        [sessionKey]: { x: 10, y: 20, width: 950, height: 650, maximized: false }
      }
    })
    vi.useRealTimers()
  })
})

describe('closeTerminalSessionWindow', () => {
  it('closes only the targeted window, leaving other sessions tracked and untouched', () => {
    const store = makeStore()
    openOrFocusTerminalSessionWindow(store as never, { worktreeId: 'wt1', tabId: 'tab1' })
    openOrFocusTerminalSessionWindow(store as never, { worktreeId: 'wt1', tabId: 'tab2' })
    const sessionKeyToClose = makeTerminalWindowSessionKey('wt1', 'tab1')

    closeTerminalSessionWindow(sessionKeyToClose)

    expect(instances[0].close).toHaveBeenCalled()
    expect(instances[1].close).not.toHaveBeenCalled()
    const remaining = listTerminalSessionWindows()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].sessionKey).toBe(makeTerminalWindowSessionKey('wt1', 'tab2'))
  })

  it('reopening after close creates a fresh window for the same sessionKey (session stays reopenable)', () => {
    const store = makeStore()
    const { sessionKey } = openOrFocusTerminalSessionWindow(store as never, {
      worktreeId: 'wt1',
      tabId: 'tab1'
    })
    closeTerminalSessionWindow(sessionKey)
    expect(listTerminalSessionWindows()).toHaveLength(0)

    openOrFocusTerminalSessionWindow(store as never, { worktreeId: 'wt1', tabId: 'tab1' })
    expect(instances).toHaveLength(2)
    expect(listTerminalSessionWindows()).toHaveLength(1)
  })

  it('is a no-op for an unknown sessionKey', () => {
    expect(() => closeTerminalSessionWindow('missing::session')).not.toThrow()
  })
})

describe('focusTerminalSessionWindow', () => {
  it('returns false for an untracked sessionKey', () => {
    expect(focusTerminalSessionWindow('missing::session')).toBe(false)
  })

  it('restores a minimized window before focusing it', () => {
    const store = makeStore()
    openOrFocusTerminalSessionWindow(store as never, { worktreeId: 'wt1', tabId: 'tab1' })
    instances[0].minimized = true

    const sessionKey = makeTerminalWindowSessionKey('wt1', 'tab1')
    expect(focusTerminalSessionWindow(sessionKey)).toBe(true)
    expect(instances[0].restore).toHaveBeenCalled()
    expect(instances[0].focus).toHaveBeenCalled()
  })
})

describe('listTerminalSessionWindows', () => {
  it('reports focused state per window', () => {
    const store = makeStore()
    openOrFocusTerminalSessionWindow(store as never, { worktreeId: 'wt1', tabId: 'tab1' })
    instances[0].focused = true

    const [summary] = listTerminalSessionWindows()
    expect(summary).toMatchObject({ worktreeId: 'wt1', tabId: 'tab1', focused: true })
  })
})
