// addWorktree: creations on one repo run one at a time so they never collide on .git/config.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { gitExecFileAsyncMock } = vi.hoisted(() => ({ gitExecFileAsyncMock: vi.fn() }))

vi.mock('./runner', () => ({
  gitExecFileAsync: gitExecFileAsyncMock,
  gitExecFileSync: vi.fn(),
  translateWslOutputPaths: (output: string) => output
}))

import { addWorktree } from './worktree-add'

type Deferred = { resolve: () => void }

function isWorktreeAdd(args: string[]): boolean {
  return args.includes('worktree') && args.includes('add')
}

describe('addWorktree serialization', () => {
  const pendingAdds: Deferred[] = []

  beforeEach(() => {
    pendingAdds.length = 0
    gitExecFileAsyncMock.mockReset()
    gitExecFileAsyncMock.mockImplementation((args: string[]) => {
      if (isWorktreeAdd(args)) {
        return new Promise((resolve) => {
          pendingAdds.push({ resolve: () => resolve({ stdout: '' }) })
        })
      }
      if (args.includes('--get')) {
        return Promise.reject(Object.assign(new Error('unset'), { code: 1 }))
      }
      return Promise.resolve({ stdout: '' })
    })
  })

  const addCallCount = () =>
    gitExecFileAsyncMock.mock.calls.filter(([args]) => isWorktreeAdd(args as string[])).length

  it('waits for one worktree on a repo to finish before starting the next', async () => {
    const first = addWorktree('/repo', '/wt/a', 'a')
    const second = addWorktree('/repo', '/wt/b', 'b')
    await vi.waitFor(() => expect(addCallCount()).toBe(1))
    // Why: give the second call every chance to start early if it were not queued.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(addCallCount()).toBe(1)

    pendingAdds[0]?.resolve()
    await first
    await vi.waitFor(() => expect(addCallCount()).toBe(2))
    pendingAdds[1]?.resolve()
    await second
  })

  it('still creates worktrees for different repos in parallel', async () => {
    const a = addWorktree('/repo-one', '/wt/a', 'a')
    const b = addWorktree('/repo-two', '/wt/b', 'b')
    await vi.waitFor(() => expect(addCallCount()).toBe(2))
    for (const pending of pendingAdds) {
      pending.resolve()
    }
    await Promise.all([a, b])
  })

  it('lets the next creation run after one fails', async () => {
    gitExecFileAsyncMock.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    await expect(addWorktree('/repo', '/wt/a', 'a')).rejects.toThrow('boom')
    const next = addWorktree('/repo', '/wt/b', 'b')
    await vi.waitFor(() => expect(addCallCount()).toBe(2))
    pendingAdds[0]?.resolve()
    await next
  })
})
