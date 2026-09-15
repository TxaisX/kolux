import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPtyIpcSession } from '../session'
import { sendModelRestoreNeededMarker, sendPtyDataToRenderer } from './payload'
import { resetPtyWindowOwnershipForTests, setPtyWindowOwner } from '../pty-window-ownership'
import {
  resetTerminalSessionWindowRegistryForTests,
  trackTerminalSessionWindow
} from '../../../window/terminal-session-window-registry'

function makeWindow(destroyed = false): {
  isDestroyed: () => boolean
  webContents: { send: ReturnType<typeof vi.fn> }
} {
  return { isDestroyed: () => destroyed, webContents: { send: vi.fn() } } as never
}

afterEach(() => {
  resetTerminalSessionWindowRegistryForTests()
  resetPtyWindowOwnershipForTests()
  vi.restoreAllMocks()
})

describe('sendPtyDataToRenderer', () => {
  it('sends an unowned pty to the main window', () => {
    const mainWindow = makeWindow()
    const session = createPtyIpcSession({ mainWindow: mainWindow as never })

    const result = sendPtyDataToRenderer(session, 'pty-1', { id: 'pty-1', data: 'hello' })

    expect(result.sent).toBe(true)
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('pty:data', {
      id: 'pty-1',
      data: 'hello'
    })
  })

  it('sends an owned pty to its owning window, not the main window', () => {
    const mainWindow = makeWindow()
    const ownerWindow = makeWindow()
    trackTerminalSessionWindow({
      sessionKey: 'wt1::tab1',
      worktreeId: 'wt1',
      tabId: 'tab1',
      window: ownerWindow as never
    })
    setPtyWindowOwner('pty-1', 'wt1::tab1')
    const session = createPtyIpcSession({ mainWindow: mainWindow as never })

    const result = sendPtyDataToRenderer(session, 'pty-1', { id: 'pty-1', data: 'hello' })

    expect(result.sent).toBe(true)
    expect(ownerWindow.webContents.send).toHaveBeenCalledWith('pty:data', {
      id: 'pty-1',
      data: 'hello'
    })
    expect(mainWindow.webContents.send).not.toHaveBeenCalled()
  })

  it('falls back to the main window without throwing once the owning window is destroyed', () => {
    const mainWindow = makeWindow()
    const ownerWindow = makeWindow(true)
    trackTerminalSessionWindow({
      sessionKey: 'wt1::tab1',
      worktreeId: 'wt1',
      tabId: 'tab1',
      window: ownerWindow as never
    })
    setPtyWindowOwner('pty-1', 'wt1::tab1')
    const session = createPtyIpcSession({ mainWindow: mainWindow as never })

    let result: ReturnType<typeof sendPtyDataToRenderer> | undefined
    expect(() => {
      result = sendPtyDataToRenderer(session, 'pty-1', { id: 'pty-1', data: 'hello' })
    }).not.toThrow()

    expect(result?.sent).toBe(true)
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('pty:data', {
      id: 'pty-1',
      data: 'hello'
    })
  })
})

describe('sendModelRestoreNeededMarker', () => {
  it('routes to the owning window for an owned pty', () => {
    const mainWindow = makeWindow()
    const ownerWindow = makeWindow()
    trackTerminalSessionWindow({
      sessionKey: 'wt1::tab1',
      worktreeId: 'wt1',
      tabId: 'tab1',
      window: ownerWindow as never
    })
    setPtyWindowOwner('pty-1', 'wt1::tab1')
    const session = createPtyIpcSession({ mainWindow: mainWindow as never })

    const sent = sendModelRestoreNeededMarker(session, 'pty-1', 'hidden-drop', undefined)

    expect(sent).toBe(true)
    expect(ownerWindow.webContents.send).toHaveBeenCalledWith(
      'pty:modelRestoreNeeded',
      expect.objectContaining({ id: 'pty-1', reason: 'hidden-drop' })
    )
    expect(mainWindow.webContents.send).not.toHaveBeenCalled()
  })
})
