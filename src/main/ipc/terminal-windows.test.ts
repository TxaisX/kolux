import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, ipcMainMock, openMock, closeMock, focusMock, listMock, restoreMock } = vi.hoisted(
  () => {
    const handlerMap = new Map<string, (event: unknown, args?: unknown) => unknown>()
    return {
      handlers: handlerMap,
      ipcMainMock: {
        handle: vi.fn((channel: string, listener: (event: unknown, args?: unknown) => unknown) => {
          handlerMap.set(channel, listener)
        }),
        removeHandler: vi.fn((channel: string) => {
          handlerMap.delete(channel)
        })
      },
      openMock: vi.fn(),
      closeMock: vi.fn(),
      focusMock: vi.fn(),
      listMock: vi.fn(),
      restoreMock: vi.fn(() => Promise.resolve())
    }
  }
)
vi.mock('electron', () => ({ ipcMain: ipcMainMock }))
vi.mock('../window/terminal-session-window', () => ({
  openOrFocusTerminalSessionWindow: openMock,
  closeTerminalSessionWindow: closeMock,
  focusTerminalSessionWindow: focusMock,
  listTerminalSessionWindows: listMock
}))
vi.mock('../window/terminal-session-window-restore', () => ({
  restoreLiveTerminalSessionWindows: restoreMock
}))

import { registerTerminalWindowsHandlers } from './terminal-windows'

function invoke(channel: string, args?: unknown): unknown {
  return handlers.get(channel)?.({}, args)
}

beforeEach(() => {
  handlers.clear()
  registerTerminalWindowsHandlers(null)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('registerTerminalWindowsHandlers', () => {
  it('restores live sessions once on registration', () => {
    expect(restoreMock).toHaveBeenCalledTimes(1)
  })

  describe('terminalWindows:open', () => {
    it('rejects malformed args instead of opening a window', () => {
      expect(invoke('terminalWindows:open', { worktreeId: 'wt1' })).toEqual({
        error: 'invalid-args'
      })
      expect(invoke('terminalWindows:open', { worktreeId: 'wt1', tabId: 'a::b' })).toEqual({
        error: 'invalid-args'
      })
      expect(openMock).not.toHaveBeenCalled()
    })

    it('opens and returns the sessionKey on valid args', () => {
      openMock.mockReturnValue({ sessionKey: 'wt1::tab1' })
      expect(invoke('terminalWindows:open', { worktreeId: 'wt1', tabId: 'tab1' })).toEqual({
        ok: true,
        sessionKey: 'wt1::tab1'
      })
    })
  })

  describe('terminalWindows:close', () => {
    it('always resolves ok, even for a malformed key (idempotent no-op)', () => {
      expect(invoke('terminalWindows:close', { sessionKey: 123 })).toEqual({ ok: true })
      expect(closeMock).not.toHaveBeenCalled()

      expect(invoke('terminalWindows:close', { sessionKey: 'wt1::tab1' })).toEqual({ ok: true })
      expect(closeMock).toHaveBeenCalledWith('wt1::tab1')
    })
  })

  describe('terminalWindows:focus', () => {
    it('rejects malformed args', () => {
      expect(invoke('terminalWindows:focus', {})).toEqual({ error: 'invalid-args' })
      expect(focusMock).not.toHaveBeenCalled()
    })

    it('reports not-found when the session has no window', () => {
      focusMock.mockReturnValue(false)
      expect(invoke('terminalWindows:focus', { sessionKey: 'wt1::tab1' })).toEqual({
        error: 'not-found'
      })
    })

    it('resolves ok when the window was focused', () => {
      focusMock.mockReturnValue(true)
      expect(invoke('terminalWindows:focus', { sessionKey: 'wt1::tab1' })).toEqual({ ok: true })
    })
  })

  describe('terminalWindows:list', () => {
    it('returns the tracked sessions', () => {
      listMock.mockReturnValue([
        { sessionKey: 'wt1::tab1', worktreeId: 'wt1', tabId: 'tab1', focused: true }
      ])
      expect(invoke('terminalWindows:list')).toEqual({
        sessions: [{ sessionKey: 'wt1::tab1', worktreeId: 'wt1', tabId: 'tab1', focused: true }]
      })
    })
  })
})
