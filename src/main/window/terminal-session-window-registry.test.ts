import { afterEach, describe, expect, it } from 'vitest'
import {
  isTerminalSessionWindowRendererForPty,
  resetTerminalSessionWindowRegistryForTests,
  trackTerminalSessionWindow
} from './terminal-session-window-registry'

function fakeWindow(): { webContents: object; isDestroyed: () => boolean } {
  return { webContents: {}, isDestroyed: () => false }
}

afterEach(() => resetTerminalSessionWindowRegistryForTests())

describe('isTerminalSessionWindowRendererForPty', () => {
  it('admits a terminal window only for the pty it was opened on', () => {
    const window = fakeWindow()
    trackTerminalSessionWindow({
      sessionKey: 'wt::tab',
      worktreeId: 'wt',
      tabId: 'tab',
      ptyId: 'pty-1',
      window: window as never
    })

    expect(isTerminalSessionWindowRendererForPty(window.webContents as never, 'pty-1')).toBe(true)
    expect(isTerminalSessionWindowRendererForPty(window.webContents as never, 'pty-2')).toBe(false)
    expect(isTerminalSessionWindowRendererForPty({} as never, 'pty-1')).toBe(false)
  })
})
