import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginWorktreeMutationGate,
  isWorktreeMutationGated,
  onWorktreeMutationGateRelease
} from './worktree-refresh-mutation-gate'

describe('worktree-refresh-mutation-gate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is not gated for a repo with no in-flight mutation', () => {
    expect(isWorktreeMutationGated('repo-idle')).toBe(false)
  })

  it('gates a repo for the duration of the mutation and releases callbacks once', () => {
    const release = beginWorktreeMutationGate('repo-1')
    expect(isWorktreeMutationGated('repo-1')).toBe(true)

    const callback = vi.fn()
    onWorktreeMutationGateRelease('repo-1', callback)
    expect(callback).not.toHaveBeenCalled()

    release()
    expect(isWorktreeMutationGated('repo-1')).toBe(false)
    expect(callback).toHaveBeenCalledTimes(1)

    // Calling release again must not re-run callbacks.
    release()
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('runs the callback immediately when the repo is not gated', () => {
    const callback = vi.fn()
    onWorktreeMutationGateRelease('repo-2', callback)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('keeps the gate held while a second overlapping mutation is still in flight', () => {
    const releaseFirst = beginWorktreeMutationGate('repo-3')
    const releaseSecond = beginWorktreeMutationGate('repo-3')

    releaseFirst()
    expect(isWorktreeMutationGated('repo-3')).toBe(true)

    const callback = vi.fn()
    onWorktreeMutationGateRelease('repo-3', callback)

    releaseSecond()
    expect(isWorktreeMutationGated('repo-3')).toBe(false)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('leaves unrelated repos ungated', () => {
    beginWorktreeMutationGate('repo-4')
    expect(isWorktreeMutationGated('repo-4')).toBe(true)
    expect(isWorktreeMutationGated('repo-5')).toBe(false)
  })

  it('force-releases a wedged mutation after the hard timeout', () => {
    beginWorktreeMutationGate('repo-6')
    const callback = vi.fn()
    onWorktreeMutationGateRelease('repo-6', callback)

    vi.advanceTimersByTime(10 * 60 * 1000 - 1)
    expect(isWorktreeMutationGated('repo-6')).toBe(true)
    expect(callback).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(isWorktreeMutationGated('repo-6')).toBe(false)
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
