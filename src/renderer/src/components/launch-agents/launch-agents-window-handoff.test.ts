// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockState = {
  pendingWorktreeCreations: Record<string, { status: 'creating' | 'error' }>
  worktreesByRepo: Record<string, { id: string; path: string }[]>
  tabsByWorktree: Record<string, { id: string }[]>
}

const mockStore = vi.hoisted(() => {
  let state: MockState = {
    pendingWorktreeCreations: {},
    worktreesByRepo: {},
    tabsByWorktree: {}
  }
  const listeners = new Set<() => void>()
  return {
    getState: (): MockState => state,
    setState: (patch: Partial<MockState>): void => {
      state = { ...state, ...patch }
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    listenerCount: (): number => listeners.size
  }
})

vi.mock('@/store', () => ({ useAppStore: mockStore }))

// eslint-disable-next-line import/first -- mocks above must register before the module under test loads
import {
  openTerminalWindowForSharedCheckoutSeat,
  openTerminalWindowWhenSeatIsReady
} from './launch-agents-window-handoff'

describe('openTerminalWindowWhenSeatIsReady', () => {
  const openMock = vi.fn()

  beforeEach(() => {
    mockStore.setState({ pendingWorktreeCreations: {}, worktreesByRepo: {}, tabsByWorktree: {} })
    openMock.mockClear()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only window.api shim ahead of the preload contract landing
    ;(window as any).api = { terminalWindows: { open: openMock } }
  })

  it('opens the seat window immediately when its worktree and tab already exist', () => {
    mockStore.setState({
      worktreesByRepo: { 'repo-1': [{ id: 'wt-1', path: 'C:/wt/otter' }] },
      tabsByWorktree: { 'wt-1': [{ id: 'tab-1' }] }
    })

    openTerminalWindowWhenSeatIsReady('creation-1', 'repo-1', 'otter')

    expect(openMock).toHaveBeenCalledTimes(1)
    expect(openMock).toHaveBeenCalledWith({ worktreeId: 'wt-1', tabId: 'tab-1' })
    expect(mockStore.listenerCount()).toBe(0)
  })

  it('waits for the async worktree create, opens exactly once, then stops watching', () => {
    mockStore.setState({ pendingWorktreeCreations: { 'creation-1': { status: 'creating' } } })

    openTerminalWindowWhenSeatIsReady('creation-1', 'repo-1', 'otter')
    expect(openMock).not.toHaveBeenCalled()

    // Worktree row lands before its initial tab does.
    mockStore.setState({
      pendingWorktreeCreations: {},
      worktreesByRepo: { 'repo-1': [{ id: 'wt-1', path: 'C:/wt/otter' }] }
    })
    expect(openMock).not.toHaveBeenCalled()

    mockStore.setState({ tabsByWorktree: { 'wt-1': [{ id: 'tab-1' }] } })
    expect(openMock).toHaveBeenCalledTimes(1)
    expect(openMock).toHaveBeenCalledWith({ worktreeId: 'wt-1', tabId: 'tab-1' })
    expect(mockStore.listenerCount()).toBe(0)

    // Further store churn must not open a second window for the same seat.
    mockStore.setState({ tabsByWorktree: { 'wt-1': [{ id: 'tab-1' }, { id: 'tab-2' }] } })
    expect(openMock).toHaveBeenCalledTimes(1)
  })

  it('gives up without opening a window when the seat creation errors', () => {
    mockStore.setState({ pendingWorktreeCreations: { 'creation-1': { status: 'creating' } } })
    openTerminalWindowWhenSeatIsReady('creation-1', 'repo-1', 'otter')

    mockStore.setState({ pendingWorktreeCreations: { 'creation-1': { status: 'error' } } })

    expect(openMock).not.toHaveBeenCalled()
    expect(mockStore.listenerCount()).toBe(0)
  })
})

describe('openTerminalWindowForSharedCheckoutSeat', () => {
  const openMock = vi.fn()

  beforeEach(() => {
    openMock.mockClear()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only window.api shim ahead of the preload contract landing
    ;(window as any).api = { terminalWindows: { open: openMock } }
  })

  it('opens the seat window immediately — no polling, since the tab already exists', () => {
    openTerminalWindowForSharedCheckoutSeat('wt-1', 'tab-1')
    expect(openMock).toHaveBeenCalledTimes(1)
    expect(openMock).toHaveBeenCalledWith({ worktreeId: 'wt-1', tabId: 'tab-1' })
  })
})
