// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import { useAppStore } from '../../store'
import { collectLeafGroupIds } from '../pane-layout/tidy-layout'
import { useLayoutPresetsCommand } from './useLayoutPresetsCommand'

const WORKTREE = 'preset-worktree'
const setTabGroupLayout = vi.fn()

function groupLayout(groupIds: string[]): TabGroupLayoutNode {
  if (groupIds.length === 1) {
    return { type: 'leaf', groupId: groupIds[0] }
  }
  return {
    type: 'split',
    direction: 'horizontal',
    first: { type: 'leaf', groupId: groupIds[0] },
    second: groupLayout(groupIds.slice(1))
  }
}

beforeEach(() => {
  setTabGroupLayout.mockClear()
  useAppStore.setState({ setTabGroupLayout })
})

describe('useLayoutPresetsCommand', () => {
  it('offers no inert preset for one group, even when its active tab has split panes', () => {
    useAppStore.setState({
      layoutByWorktree: { [WORKTREE]: groupLayout(['g1']) },
      terminalLayoutsByTabId: {
        'tab-1': {
          root: {
            type: 'split',
            direction: 'horizontal',
            first: { type: 'leaf', leafId: 'pane-1' },
            second: { type: 'leaf', leafId: 'pane-2' }
          },
          activeLeafId: 'pane-1',
          expandedLeafId: null
        }
      }
    })
    const { result } = renderHook(() => useLayoutPresetsCommand(WORKTREE))
    expect(result.current).toEqual([])
  })

  it('rearranges existing groups without changing their identities', () => {
    const groupIds = ['g1', 'g2', 'g3', 'g4']
    useAppStore.setState({ layoutByWorktree: { [WORKTREE]: groupLayout(groupIds) } })
    const { result } = renderHook(() => useLayoutPresetsCommand(WORKTREE))
    expect(result.current.map(({ rows }) => rows)).toEqual([[2, 2]])

    act(() => result.current[0].apply())
    expect(setTabGroupLayout).toHaveBeenCalledTimes(1)
    expect(setTabGroupLayout).toHaveBeenCalledWith(WORKTREE, expect.any(Object))
    expect(collectLeafGroupIds(setTabGroupLayout.mock.calls[0][1])).toEqual(groupIds)
  })
})
