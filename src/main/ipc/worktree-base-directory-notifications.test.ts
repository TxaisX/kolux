import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

vi.mock('./worktree-remote', () => ({
  notifyWorktreeGitStatusMetadataChanged: vi.fn(),
  notifyWorktreesChanged: vi.fn()
}))
vi.mock('./watched-worktree-catalog-notification', () => ({
  notifyWatchedWorktreeCatalogChanged: vi.fn()
}))
vi.mock('./worktree-head-identity-refresh', () => ({
  refreshWorktreeHeadIdentities: vi.fn(async () => {})
}))

import { notifyWorktreeGitStatusMetadataChanged } from './worktree-remote'
import { notifyWatchedWorktreeCatalogChanged } from './watched-worktree-catalog-notification'
import {
  scheduleWorktreeBaseNotification,
  type WorktreeBaseNotificationWatch
} from './worktree-base-directory-notifications'
import { beginWorktreeMutationGate } from './worktree-refresh-mutation-gate'
import { EMPTY_HEAD_IDENTITY_SCOPE } from './worktree-head-identity-scope'

function makeWatch(): WorktreeBaseNotificationWatch {
  return {
    key: 'watch-1',
    kind: 'base',
    path: '/workspace',
    repos: new Map(),
    mainWindow: { isDestroyed: () => false } as unknown as BrowserWindow,
    notifyTimer: null,
    pendingStructureRepoIds: new Set(),
    pendingGitStatusRepoIds: new Set(),
    pendingHeadIdentityRepoIds: new Set(),
    pendingHeadIdentityScope: EMPTY_HEAD_IDENTITY_SCOPE,
    headIdentityRefresh: {} as WorktreeBaseNotificationWatch['headIdentityRefresh'],
    disposed: false
  }
}

describe('scheduleWorktreeBaseNotification mutation gate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes immediately for a repo with no in-flight mutation', () => {
    const watch = makeWatch()
    scheduleWorktreeBaseNotification(watch, { structureRepoIds: ['repo-1'] })
    vi.advanceTimersByTime(250)
    expect(notifyWatchedWorktreeCatalogChanged).toHaveBeenCalledWith(
      watch.mainWindow,
      'repo-1',
      undefined
    )
  })

  it('holds the notification while gated and flushes once on release', () => {
    const watch = makeWatch()
    const release = beginWorktreeMutationGate('repo-gated')

    scheduleWorktreeBaseNotification(watch, { structureRepoIds: ['repo-gated'] })
    vi.advanceTimersByTime(250)
    expect(notifyWatchedWorktreeCatalogChanged).not.toHaveBeenCalled()

    release()
    vi.advanceTimersByTime(250)
    expect(notifyWatchedWorktreeCatalogChanged).toHaveBeenCalledTimes(1)
    expect(notifyWatchedWorktreeCatalogChanged).toHaveBeenCalledWith(
      watch.mainWindow,
      'repo-gated',
      undefined
    )
  })

  it('does not hold notifications for an unrelated, ungated repo', () => {
    const watch = makeWatch()
    const release = beginWorktreeMutationGate('repo-busy')

    scheduleWorktreeBaseNotification(watch, {
      structureRepoIds: ['repo-busy'],
      gitStatusRepoIds: ['repo-idle']
    })
    vi.advanceTimersByTime(250)

    expect(notifyWatchedWorktreeCatalogChanged).not.toHaveBeenCalled()
    expect(notifyWorktreeGitStatusMetadataChanged).toHaveBeenCalledWith(
      watch.mainWindow,
      'repo-idle'
    )
    release()
  })

  it('force-flushes a held repo after the gates hard timeout', () => {
    const watch = makeWatch()
    beginWorktreeMutationGate('repo-wedged')

    scheduleWorktreeBaseNotification(watch, { structureRepoIds: ['repo-wedged'] })
    vi.advanceTimersByTime(250)
    expect(notifyWatchedWorktreeCatalogChanged).not.toHaveBeenCalled()

    vi.advanceTimersByTime(10 * 60 * 1000)
    vi.advanceTimersByTime(250)
    expect(notifyWatchedWorktreeCatalogChanged).toHaveBeenCalledWith(
      watch.mainWindow,
      'repo-wedged',
      undefined
    )
  })

  it('flushes on release even when the gated mutation failed', async () => {
    const watch = makeWatch()
    const release = beginWorktreeMutationGate('repo-failed')

    scheduleWorktreeBaseNotification(watch, { structureRepoIds: ['repo-failed'] })
    vi.advanceTimersByTime(250)
    expect(notifyWatchedWorktreeCatalogChanged).not.toHaveBeenCalled()

    async function failingMutation(): Promise<void> {
      try {
        throw new Error('worktree add failed')
      } finally {
        release()
      }
    }
    await expect(failingMutation()).rejects.toThrow('worktree add failed')

    vi.advanceTimersByTime(250)
    expect(notifyWatchedWorktreeCatalogChanged).toHaveBeenCalledTimes(1)
  })
})
