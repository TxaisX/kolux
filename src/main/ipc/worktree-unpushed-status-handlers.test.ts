import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { Repo } from '../../shared/repo-types'
import type { WorktreeUnpushedStatusQuery } from '../../shared/git-unpushed-status'

const { resolveWorktreeUnpushedStatusMock } = vi.hoisted(() => ({
  resolveWorktreeUnpushedStatusMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn()
  }
}))

vi.mock('./worktree-unpushed-status', () => ({
  resolveWorktreeUnpushedStatus: resolveWorktreeUnpushedStatusMock
}))

import { registerWorktreeUnpushedStatusHandlers } from './worktree-unpushed-status-handlers'

const GIT_REPO: Repo = {
  id: 'repo-1',
  path: '/repo',
  displayName: 'Repo',
  badgeColor: '#000',
  addedAt: 0
}

const FOLDER_REPO: Repo = { ...GIT_REPO, id: 'repo-folder', kind: 'folder' }

function getRegisteredHandler(): (
  event: unknown,
  args?: { worktrees?: WorktreeUnpushedStatusQuery[] }
) => Promise<Record<string, unknown>> {
  const call = vi
    .mocked(ipcMain.handle)
    .mock.calls.find(([channel]) => channel === 'worktrees:unpushedStatus')
  if (!call) {
    throw new Error('worktrees:unpushedStatus handler was not registered')
  }
  return call[1] as never
}

function makeStore(repos: Record<string, Repo>): Store {
  return { getRepo: (id: string) => repos[id] } as unknown as Store
}

describe('registerWorktreeUnpushedStatusHandlers', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockReset()
    vi.mocked(ipcMain.removeHandler).mockReset()
    resolveWorktreeUnpushedStatusMock.mockReset()
  })

  it('resolves a status per query, keyed by worktreeId', async () => {
    const store = makeStore({ 'repo-1': GIT_REPO })
    resolveWorktreeUnpushedStatusMock.mockResolvedValue({ kind: 'ahead', count: 2 })
    registerWorktreeUnpushedStatusHandlers(store)

    const result = await getRegisteredHandler()(undefined, {
      worktrees: [
        { worktreeId: 'w-1', repoId: 'repo-1', path: '/repo/w-1', isMainWorktree: false }
      ]
    })

    expect(result).toEqual({ 'w-1': { kind: 'ahead', count: 2 } })
    expect(resolveWorktreeUnpushedStatusMock).toHaveBeenCalledWith(
      { path: '/repo/w-1', hostId: undefined, isMainWorktree: false },
      GIT_REPO
    )
  })

  it('reports unknown without reading git for a folder repo', async () => {
    const store = makeStore({ 'repo-folder': FOLDER_REPO })
    registerWorktreeUnpushedStatusHandlers(store)

    const result = await getRegisteredHandler()(undefined, {
      worktrees: [
        { worktreeId: 'w-1', repoId: 'repo-folder', path: '/folder', isMainWorktree: true }
      ]
    })

    expect(result).toEqual({ 'w-1': { kind: 'unknown' } })
    expect(resolveWorktreeUnpushedStatusMock).not.toHaveBeenCalled()
  })

  it('reports unknown for a repo that no longer exists', async () => {
    const store = makeStore({})
    registerWorktreeUnpushedStatusHandlers(store)

    const result = await getRegisteredHandler()(undefined, {
      worktrees: [{ worktreeId: 'w-1', repoId: 'gone', path: '/gone', isMainWorktree: false }]
    })

    expect(result).toEqual({ 'w-1': { kind: 'unknown' } })
  })

  it('tolerates a malformed request instead of throwing', async () => {
    registerWorktreeUnpushedStatusHandlers(makeStore({}))

    await expect(getRegisteredHandler()(undefined, undefined)).resolves.toEqual({})
  })
})
