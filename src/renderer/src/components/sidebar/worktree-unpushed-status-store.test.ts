import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyWorktreeUnpushedStatuses,
  clearWorktreeUnpushedStatusStoreForTests,
  deleteWorktreeUnpushedStatus,
  getWorktreeUnpushedStatusSnapshot,
  subscribeWorktreeUnpushedStatus
} from './worktree-unpushed-status-store'

describe('worktree unpushed status store', () => {
  afterEach(() => {
    clearWorktreeUnpushedStatusStoreForTests()
  })

  it('returns undefined for a worktree with no known status', () => {
    expect(getWorktreeUnpushedStatusSnapshot('missing')).toBeUndefined()
  })

  it('stores and returns an applied status', () => {
    applyWorktreeUnpushedStatuses({ 'w-1': { kind: 'ahead', count: 2 } })
    expect(getWorktreeUnpushedStatusSnapshot('w-1')).toEqual({ kind: 'ahead', count: 2 })
  })

  it('notifies subscribers only when a status actually changes', () => {
    const listener = vi.fn()
    subscribeWorktreeUnpushedStatus(listener)

    applyWorktreeUnpushedStatuses({ 'w-1': { kind: 'ahead', count: 2 } })
    expect(listener).toHaveBeenCalledTimes(1)

    applyWorktreeUnpushedStatuses({ 'w-1': { kind: 'ahead', count: 2 } })
    expect(listener).toHaveBeenCalledTimes(1)

    applyWorktreeUnpushedStatuses({ 'w-1': { kind: 'ahead', count: 3 } })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('drops a worktree entry and notifies subscribers', () => {
    applyWorktreeUnpushedStatuses({ 'w-1': { kind: 'ahead', count: 2 } })
    const listener = vi.fn()
    subscribeWorktreeUnpushedStatus(listener)

    deleteWorktreeUnpushedStatus('w-1')

    expect(getWorktreeUnpushedStatusSnapshot('w-1')).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does nothing when deleting a worktree with no known status', () => {
    const listener = vi.fn()
    subscribeWorktreeUnpushedStatus(listener)

    deleteWorktreeUnpushedStatus('missing')

    expect(listener).not.toHaveBeenCalled()
  })

  it('stops notifying a listener after it unsubscribes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeWorktreeUnpushedStatus(listener)
    unsubscribe()

    applyWorktreeUnpushedStatuses({ 'w-1': { kind: 'synced' } })
    expect(listener).not.toHaveBeenCalled()
  })
})
