import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { openOrFocusMock, listLiveMock, ownerMock } = vi.hoisted(() => ({
  openOrFocusMock: vi.fn((_store: unknown, args: { worktreeId: string; tabId: string }) => ({
    sessionKey: `${args.worktreeId}::${args.tabId}`
  })),
  listLiveMock: vi.fn<() => Promise<string[] | null>>(),
  ownerMock: vi.fn()
}))
vi.mock('./terminal-session-window', () => ({
  openOrFocusTerminalSessionWindow: openOrFocusMock
}))
vi.mock('../daemon/daemon-provider-state', () => ({ listLiveDaemonPtyIds: listLiveMock }))
vi.mock('../ipc/pty/pty-window-ownership', () => ({ setPtyWindowOwner: ownerMock }))
vi.mock('../startup/main-process-state', () => ({
  mainProcessState: { localPtyProviderStartupReady: Promise.resolve() }
}))

import { restoreLiveTerminalSessionWindows } from './terminal-session-window-restore'

type FakeTab = { id: string; ptyId: string | null }

function makeStore(tabsByWorktree: Record<string, FakeTab[]>): {
  getWorkspaceSession: () => { tabsByWorktree: Record<string, FakeTab[]> }
} {
  return { getWorkspaceSession: () => ({ tabsByWorktree }) }
}

beforeEach(() => {
  listLiveMock.mockResolvedValue(['pty-1', 'pty-a', 'pty-b'])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('restoreLiveTerminalSessionWindows', () => {
  it('reopens a window only for tabs still bound to a pty', async () => {
    const store = makeStore({
      wt1: [
        { id: 'tab-live', ptyId: 'pty-1' },
        { id: 'tab-closed', ptyId: null }
      ]
    })

    await restoreLiveTerminalSessionWindows(store as never)

    expect(openOrFocusMock).toHaveBeenCalledTimes(1)
    expect(openOrFocusMock).toHaveBeenCalledWith(store, { worktreeId: 'wt1', tabId: 'tab-live' })
    expect(ownerMock).toHaveBeenCalledWith('pty-1', 'wt1::tab-live')
  })

  it('reopens every live session across multiple worktrees', async () => {
    const store = makeStore({
      wt1: [{ id: 'tab-a', ptyId: 'pty-a' }],
      wt2: [{ id: 'tab-b', ptyId: 'pty-b' }]
    })

    await restoreLiveTerminalSessionWindows(store as never)

    expect(openOrFocusMock).toHaveBeenCalledTimes(2)
  })

  it('skips tabs whose persisted pty the daemon no longer reports', async () => {
    const store = makeStore({ wt1: [{ id: 'tab-stale', ptyId: 'pty-gone' }] })

    await restoreLiveTerminalSessionWindows(store as never)

    expect(openOrFocusMock).not.toHaveBeenCalled()
  })

  it('reopens nothing when the daemon inventory is unavailable', async () => {
    listLiveMock.mockResolvedValue(null)
    const store = makeStore({ wt1: [{ id: 'tab-live', ptyId: 'pty-1' }] })

    await restoreLiveTerminalSessionWindows(store as never)

    expect(openOrFocusMock).not.toHaveBeenCalled()
  })

  it('is a no-op with a null store', async () => {
    await expect(restoreLiveTerminalSessionWindows(null)).resolves.toBeUndefined()
    expect(openOrFocusMock).not.toHaveBeenCalled()
  })
})
