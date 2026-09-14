// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab, TabGroup, TabGroupLayoutNode } from '../../../../shared/tab-types'

const mocks = vi.hoisted(() => ({
  closeTerminalTab: vi.fn(
    (_tabId: string, opts?: { onClosed?: () => void; onCancel?: () => void }) => {
      opts?.onClosed?.()
    }
  ),
  toastMessage: vi.fn()
}))

vi.mock('../terminal/terminal-tab-actions', () => ({ closeTerminalTab: mocks.closeTerminalTab }))
vi.mock('sonner', () => ({ toast: { message: mocks.toastMessage } }))

import { useAppStore } from '../../store'
import { usePaneCountCommand } from './usePaneCountCommand'

const WORKTREE = 'wt-1'

function terminalTab(id: string, groupId: string): Tab {
  return {
    id,
    entityId: id,
    groupId,
    worktreeId: WORKTREE,
    contentType: 'terminal',
    label: id,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  } as Tab
}

function group(id: string, tabId: string): TabGroup {
  return { id, worktreeId: WORKTREE, activeTabId: tabId, tabOrder: [tabId] }
}

function seedTwoPanes(): void {
  const layout: TabGroupLayoutNode = {
    type: 'split',
    direction: 'horizontal',
    first: { type: 'leaf', groupId: 'g1' },
    second: { type: 'leaf', groupId: 'g2' }
  }
  useAppStore.setState({
    layoutByWorktree: { [WORKTREE]: layout },
    groupsByWorktree: { [WORKTREE]: [group('g1', 't1'), group('g2', 't2')] },
    unifiedTabsByWorktree: { [WORKTREE]: [terminalTab('t1', 'g1'), terminalTab('t2', 'g2')] },
    agentStatusByPaneKey: {}
  })
}

beforeEach(() => {
  mocks.closeTerminalTab.mockClear()
  mocks.toastMessage.mockClear()
  useAppStore.setState({
    setTabGroupLayout: vi.fn(),
    createEmptySplitGroup: vi.fn(() => 'g-new'),
    // Why a real (simplified) implementation, not a bare spy: the hook reads
    // layoutByWorktree back after closing to decide whether the shrink fully
    // landed, so the test needs that state to actually change on close.
    closeEmptyGroup: vi.fn((worktreeId: string, groupId: string) => {
      const state = useAppStore.getState()
      const remainingGroups = (state.groupsByWorktree[worktreeId] ?? []).filter(
        (candidate) => candidate.id !== groupId
      )
      // Why non-null: these tests always leave at least one group standing.
      const remainingLeaf = remainingGroups[0]!
      useAppStore.setState({
        groupsByWorktree: { ...state.groupsByWorktree, [worktreeId]: remainingGroups },
        layoutByWorktree: {
          ...state.layoutByWorktree,
          [worktreeId]: { type: 'leaf', groupId: remainingLeaf.id }
        }
      })
      return true
    }),
    createTab: vi.fn(() => ({}) as never)
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('usePaneCountCommand', () => {
  it('reports min/max so the stepper can disable both buttons at the edges', () => {
    seedTwoPanes()
    const { result } = renderHook(() => usePaneCountCommand(WORKTREE))
    expect(result.current.min).toBe(1)
    expect(result.current.max).toBe(9)
    expect(result.current.count).toBe(2)
  })

  it('decrementing at the min pane count is a no-op (nothing closes)', () => {
    useAppStore.setState({
      layoutByWorktree: { [WORKTREE]: { type: 'leaf', groupId: 'g1' } },
      groupsByWorktree: { [WORKTREE]: [group('g1', 't1')] },
      unifiedTabsByWorktree: { [WORKTREE]: [terminalTab('t1', 'g1')] },
      agentStatusByPaneKey: {}
    })
    const { result } = renderHook(() => usePaneCountCommand(WORKTREE))
    result.current.decrement()
    expect(mocks.closeTerminalTab).not.toHaveBeenCalled()
    expect(useAppStore.getState().closeEmptyGroup).not.toHaveBeenCalled()
    expect(mocks.toastMessage).not.toHaveBeenCalled()
  })

  it('incrementing at the max pane count is a no-op (nothing created)', () => {
    const ids = Array.from({ length: 9 }, (_, i) => `g${i}`)
    const layout: TabGroupLayoutNode = ids
      .map((id) => ({ type: 'leaf', groupId: id }) as TabGroupLayoutNode)
      .reduceRight((acc, node) => ({ type: 'split', direction: 'horizontal', first: node, second: acc }))
    useAppStore.setState({
      layoutByWorktree: { [WORKTREE]: layout },
      groupsByWorktree: { [WORKTREE]: ids.map((id) => group(id, `${id}-tab`)) },
      unifiedTabsByWorktree: {
        [WORKTREE]: ids.map((id) => terminalTab(`${id}-tab`, id))
      },
      agentStatusByPaneKey: {}
    })
    const { result } = renderHook(() => usePaneCountCommand(WORKTREE))
    expect(result.current.count).toBe(9)
    result.current.increment()
    expect(useAppStore.getState().createEmptySplitGroup).not.toHaveBeenCalled()
    expect(useAppStore.getState().setTabGroupLayout).not.toHaveBeenCalled()
  })

  it('closes the safe trailing group and regrids when shrinking succeeds', () => {
    seedTwoPanes()
    const { result } = renderHook(() => usePaneCountCommand(WORKTREE))
    result.current.setCount(1)
    expect(mocks.closeTerminalTab).toHaveBeenCalledWith('t2', expect.anything())
    expect(useAppStore.getState().closeEmptyGroup).toHaveBeenCalledWith(WORKTREE, 'g2')
    expect(useAppStore.getState().setTabGroupLayout).toHaveBeenCalled()
    expect(mocks.toastMessage).not.toHaveBeenCalled()
  })

  it('notifies when a running agent blocks the shrink short of the target', () => {
    seedTwoPanes()
    // g2's sole tab (t2) has a live (non-'done') agent — never safe to close.
    const leafId = '123e4567-e89b-12d3-a456-426614174000'
    useAppStore.setState({
      agentStatusByPaneKey: {
        [`t2:${leafId}`]: { agentType: 'claude', state: 'working', updatedAt: Date.now() } as never
      }
    })
    const { result } = renderHook(() => usePaneCountCommand(WORKTREE))
    result.current.setCount(1)
    expect(mocks.closeTerminalTab).not.toHaveBeenCalled()
    expect(mocks.toastMessage).toHaveBeenCalledTimes(1)
  })
})
