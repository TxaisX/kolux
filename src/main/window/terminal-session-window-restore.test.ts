import { afterEach, describe, expect, it, vi } from 'vitest'

const { openOrFocusMock } = vi.hoisted(() => ({ openOrFocusMock: vi.fn() }))
vi.mock('./terminal-session-window', () => ({
  openOrFocusTerminalSessionWindow: openOrFocusMock
}))

import { restoreLiveTerminalSessionWindows } from './terminal-session-window-restore'

type FakeTab = { id: string; ptyId: string | null }

function makeStore(tabsByWorktree: Record<string, FakeTab[]>): {
  getWorkspaceSession: () => { tabsByWorktree: Record<string, FakeTab[]> }
} {
  return { getWorkspaceSession: () => ({ tabsByWorktree }) }
}

afterEach(() => {
  openOrFocusMock.mockClear()
})

describe('restoreLiveTerminalSessionWindows', () => {
  it('reopens a window only for tabs still bound to a pty', () => {
    const store = makeStore({
      wt1: [
        { id: 'tab-live', ptyId: 'pty-1' },
        { id: 'tab-closed', ptyId: null }
      ]
    })

    restoreLiveTerminalSessionWindows(store as never)

    expect(openOrFocusMock).toHaveBeenCalledTimes(1)
    expect(openOrFocusMock).toHaveBeenCalledWith(store, { worktreeId: 'wt1', tabId: 'tab-live' })
  })

  it('reopens every live session across multiple worktrees', () => {
    const store = makeStore({
      wt1: [{ id: 'tab-a', ptyId: 'pty-a' }],
      wt2: [{ id: 'tab-b', ptyId: 'pty-b' }]
    })

    restoreLiveTerminalSessionWindows(store as never)

    expect(openOrFocusMock).toHaveBeenCalledTimes(2)
    expect(openOrFocusMock).toHaveBeenCalledWith(store, { worktreeId: 'wt1', tabId: 'tab-a' })
    expect(openOrFocusMock).toHaveBeenCalledWith(store, { worktreeId: 'wt2', tabId: 'tab-b' })
  })

  it('does nothing when there are no live sessions', () => {
    const store = makeStore({ wt1: [{ id: 'tab-closed', ptyId: null }] })

    restoreLiveTerminalSessionWindows(store as never)

    expect(openOrFocusMock).not.toHaveBeenCalled()
  })

  it('is a no-op with a null store', () => {
    expect(() => restoreLiveTerminalSessionWindows(null)).not.toThrow()
    expect(openOrFocusMock).not.toHaveBeenCalled()
  })
})
