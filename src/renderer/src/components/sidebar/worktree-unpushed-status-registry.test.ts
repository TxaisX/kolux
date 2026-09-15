// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorktreeUnpushedBadge } from './use-worktree-unpushed-badge'
import {
  fetchWorktreeUnpushedStatuses,
  registerWorktreeForUnpushedStatus,
  resetWorktreeUnpushedStatusPollingForTests
} from './worktree-unpushed-status-registry'
import {
  clearWorktreeUnpushedStatusStoreForTests,
  getWorktreeUnpushedStatusSnapshot
} from './worktree-unpushed-status-store'
import type {
  WorktreeUnpushedStatus,
  WorktreeUnpushedStatusQuery
} from '../../../../shared/git-unpushed-status'

const unpushedStatusMock = vi.fn<
  (args: { worktrees: WorktreeUnpushedStatusQuery[] }) => Promise<
    Record<string, WorktreeUnpushedStatus>
  >
>()
const mountedRoots: Root[] = []

let latestHookResult: WorktreeUnpushedStatus | undefined
function HookProbe({ worktreeId }: { worktreeId: string }): null {
  latestHookResult = useWorktreeUnpushedBadge({
    id: worktreeId,
    repoId: 'repo-1',
    path: `/repo/${worktreeId}`,
    isMainWorktree: false
  })
  return null
}

async function mount(worktreeId: string): Promise<Root> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  await act(async () => {
    root.render(createElement(HookProbe, { worktreeId }))
  })
  return root
}

describe('worktree unpushed status registry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    unpushedStatusMock.mockReset().mockResolvedValue({})
    latestHookResult = undefined
    clearWorktreeUnpushedStatusStoreForTests()
    resetWorktreeUnpushedStatusPollingForTests()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { worktrees: { unpushedStatus: unpushedStatusMock } }
    })
  })

  afterEach(async () => {
    await act(async () => {
      for (const root of mountedRoots.splice(0)) {
        root.unmount()
      }
    })
    document.body.innerHTML = ''
    resetWorktreeUnpushedStatusPollingForTests()
    vi.useRealTimers()
  })

  it('fetches nothing until a worktree registers', async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(unpushedStatusMock).not.toHaveBeenCalled()
  })

  it('debounces a burst of mounts into one batched fetch', async () => {
    unpushedStatusMock.mockResolvedValue({
      'w-1': { kind: 'ahead', count: 2 },
      'w-2': { kind: 'unpublished', count: 1 }
    })

    await mount('w-1')
    await mount('w-2')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    expect(unpushedStatusMock).toHaveBeenCalledTimes(1)
    const requested = unpushedStatusMock.mock.calls[0][0].worktrees.map((w) => w.worktreeId)
    expect(requested.sort()).toEqual(['w-1', 'w-2'])
    expect(getWorktreeUnpushedStatusSnapshot('w-1')).toEqual({ kind: 'ahead', count: 2 })
  })

  it('exposes the fetched status through the hook', async () => {
    unpushedStatusMock.mockResolvedValue({ 'w-1': { kind: 'ahead', count: 5 } })

    await mount('w-1')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    expect(latestHookResult).toEqual({ kind: 'ahead', count: 5 })
  })

  it('stops requesting a worktree after its card unmounts', async () => {
    unpushedStatusMock.mockResolvedValue({})
    const root = await mount('w-1')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    unpushedStatusMock.mockClear()

    await act(async () => {
      root.unmount()
    })
    mountedRoots.splice(mountedRoots.indexOf(root), 1)

    await act(async () => {
      await fetchWorktreeUnpushedStatuses()
    })
    expect(unpushedStatusMock).not.toHaveBeenCalled()
  })

  it('clears the cached status when a card unmounts', async () => {
    unpushedStatusMock.mockResolvedValue({ 'w-1': { kind: 'ahead', count: 2 } })
    const root = await mount('w-1')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(getWorktreeUnpushedStatusSnapshot('w-1')).toEqual({ kind: 'ahead', count: 2 })

    await act(async () => {
      root.unmount()
    })
    mountedRoots.splice(mountedRoots.indexOf(root), 1)

    expect(getWorktreeUnpushedStatusSnapshot('w-1')).toBeUndefined()
  })

  it('refreshes on window focus', async () => {
    registerWorktreeForUnpushedStatus({
      worktreeId: 'w-1',
      repoId: 'repo-1',
      path: '/repo/w-1',
      isMainWorktree: false
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    unpushedStatusMock.mockClear()

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })

    expect(unpushedStatusMock).toHaveBeenCalledTimes(1)
  })

  it('polls on a slow interval while the window stays visible', async () => {
    registerWorktreeForUnpushedStatus({
      worktreeId: 'w-1',
      repoId: 'repo-1',
      path: '/repo/w-1',
      isMainWorktree: false
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    unpushedStatusMock.mockClear()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(unpushedStatusMock).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the desktop bridge has no unpushedStatus method', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { worktrees: {} }
    })

    registerWorktreeForUnpushedStatus({
      worktreeId: 'w-1',
      repoId: 'repo-1',
      path: '/repo/w-1',
      isMainWorktree: false
    })

    await expect(
      act(async () => {
        await vi.advanceTimersByTimeAsync(150)
      })
    ).resolves.not.toThrow()
  })
})
