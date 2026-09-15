import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPtyWindowOwner,
  getPtyOwnerWindow,
  getPtyWindowOwnerSessionKey,
  hasAnyPtyDeliveryTarget,
  isAuthorizedPtySender,
  isTerminalSessionWindowWebContents,
  resetPtyWindowOwnershipForTests,
  resolvePtyDeliveryWindow,
  sessionKeyForWebContents,
  setPtyWindowOwner
} from './pty-window-ownership'
import {
  resetTerminalSessionWindowRegistryForTests,
  trackTerminalSessionWindow
} from '../../window/terminal-session-window-registry'

function makeWindow(destroyed = false): {
  isDestroyed: () => boolean
  webContents: { id: string }
} {
  const webContents = { id: Math.random().toString(36) }
  return { isDestroyed: () => destroyed, webContents } as never
}

afterEach(() => {
  resetPtyWindowOwnershipForTests()
  resetTerminalSessionWindowRegistryForTests()
  vi.restoreAllMocks()
})

describe('resolvePtyDeliveryWindow', () => {
  it('targets the main window for an unowned pty', () => {
    const mainWindow = makeWindow()
    expect(resolvePtyDeliveryWindow('pty-1', mainWindow as never)).toBe(mainWindow)
  })

  it('targets the owning terminal window once one is recorded', () => {
    const mainWindow = makeWindow()
    const ownerWindow = makeWindow()
    trackTerminalSessionWindow({
      sessionKey: 'wt1::tab1',
      worktreeId: 'wt1',
      tabId: 'tab1',
      window: ownerWindow as never
    })
    setPtyWindowOwner('pty-1', 'wt1::tab1')

    expect(resolvePtyDeliveryWindow('pty-1', mainWindow as never)).toBe(ownerWindow)
    // A different, unowned pty still goes to main.
    expect(resolvePtyDeliveryWindow('pty-2', mainWindow as never)).toBe(mainWindow)
  })

  it('falls back to the main window without throwing once the owner is destroyed', () => {
    const mainWindow = makeWindow()
    const ownerWindow = makeWindow(true)
    trackTerminalSessionWindow({
      sessionKey: 'wt1::tab1',
      worktreeId: 'wt1',
      tabId: 'tab1',
      window: ownerWindow as never
    })
    setPtyWindowOwner('pty-1', 'wt1::tab1')

    expect(() => resolvePtyDeliveryWindow('pty-1', mainWindow as never)).not.toThrow()
    expect(resolvePtyDeliveryWindow('pty-1', mainWindow as never)).toBe(mainWindow)
    expect(getPtyOwnerWindow('pty-1')).toBeNull()
  })
})

describe('clearPtyWindowOwner', () => {
  it('drops the association so the pty falls back to main', () => {
    const mainWindow = makeWindow()
    const ownerWindow = makeWindow()
    trackTerminalSessionWindow({
      sessionKey: 'wt1::tab1',
      worktreeId: 'wt1',
      tabId: 'tab1',
      window: ownerWindow as never
    })
    setPtyWindowOwner('pty-1', 'wt1::tab1')
    expect(getPtyWindowOwnerSessionKey('pty-1')).toBe('wt1::tab1')

    clearPtyWindowOwner('pty-1')

    expect(getPtyWindowOwnerSessionKey('pty-1')).toBeUndefined()
    expect(resolvePtyDeliveryWindow('pty-1', mainWindow as never)).toBe(mainWindow)
  })
})

describe('isAuthorizedPtySender', () => {
  it('requires the main window for an unowned pty', () => {
    const mainWindow = makeWindow()
    const other = makeWindow()
    expect(
      isAuthorizedPtySender(mainWindow.webContents as never, 'pty-1', mainWindow as never)
    ).toBe(true)
    expect(isAuthorizedPtySender(other.webContents as never, 'pty-1', mainWindow as never)).toBe(
      false
    )
  })

  it('rejects an ack from a window that does not own this ptyId', () => {
    const mainWindow = makeWindow()
    const windowA = makeWindow()
    const windowB = makeWindow()
    trackTerminalSessionWindow({
      sessionKey: 'wt1::tabA',
      worktreeId: 'wt1',
      tabId: 'tabA',
      window: windowA as never
    })
    trackTerminalSessionWindow({
      sessionKey: 'wt1::tabB',
      worktreeId: 'wt1',
      tabId: 'tabB',
      window: windowB as never
    })
    setPtyWindowOwner('pty-a', 'wt1::tabA')
    setPtyWindowOwner('pty-b', 'wt1::tabB')

    // Window B naming pty A's id must not be authorized to credit it.
    expect(isAuthorizedPtySender(windowB.webContents as never, 'pty-a', mainWindow as never)).toBe(
      false
    )
    expect(isAuthorizedPtySender(windowA.webContents as never, 'pty-a', mainWindow as never)).toBe(
      true
    )
  })
})

describe('sessionKeyForWebContents / isTerminalSessionWindowWebContents', () => {
  it('identifies a tracked terminal window and rejects everything else', () => {
    const ownerWindow = makeWindow()
    const other = makeWindow()
    trackTerminalSessionWindow({
      sessionKey: 'wt1::tab1',
      worktreeId: 'wt1',
      tabId: 'tab1',
      window: ownerWindow as never
    })

    expect(sessionKeyForWebContents(ownerWindow.webContents as never)).toBe('wt1::tab1')
    expect(isTerminalSessionWindowWebContents(ownerWindow.webContents as never)).toBe(true)
    expect(sessionKeyForWebContents(other.webContents as never)).toBeNull()
    expect(isTerminalSessionWindowWebContents(other.webContents as never)).toBe(false)
  })
})

describe('hasAnyPtyDeliveryTarget', () => {
  it('is true while the main window is alive, regardless of terminal windows', () => {
    expect(hasAnyPtyDeliveryTarget(makeWindow(false) as never)).toBe(true)
  })

  it('is true once the main window is gone if a terminal window remains', () => {
    trackTerminalSessionWindow({
      sessionKey: 'wt1::tab1',
      worktreeId: 'wt1',
      tabId: 'tab1',
      window: makeWindow() as never
    })
    expect(hasAnyPtyDeliveryTarget(makeWindow(true) as never)).toBe(true)
  })

  it('is false once nothing is left to deliver to', () => {
    expect(hasAnyPtyDeliveryTarget(makeWindow(true) as never)).toBe(false)
  })
})
