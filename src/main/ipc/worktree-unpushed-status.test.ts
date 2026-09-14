import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitStatusResult } from '../../shared/git-status-types'
import type { Repo } from '../../shared/repo-types'

const { getStatusMock, gitExecFileAsyncMock, getSshGitProviderMock } = vi.hoisted(() => ({
  getStatusMock: vi.fn(),
  gitExecFileAsyncMock: vi.fn(),
  getSshGitProviderMock: vi.fn()
}))

vi.mock('../git/status', () => ({ getStatus: getStatusMock }))
vi.mock('../git/runner', () => ({ gitExecFileAsync: gitExecFileAsyncMock }))
vi.mock('../providers/ssh-git-dispatch', () => ({
  getSshGitProvider: getSshGitProviderMock,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE: 'SSH git provider unavailable.'
}))

import { resolveWorktreeUnpushedStatus } from './worktree-unpushed-status'

const LOCAL_REPO: Repo = {
  id: 'repo-1',
  path: '/repo',
  displayName: 'Repo',
  badgeColor: '#000',
  addedAt: 0
}

const SSH_REPO: Repo = {
  ...LOCAL_REPO,
  id: 'repo-ssh',
  connectionId: 'conn-1'
}

const WORKTREE = { path: '/repo/tree', hostId: undefined, isMainWorktree: false }

function status(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    entries: [],
    conflictOperation: 'unknown',
    ...overrides
  } as GitStatusResult
}

describe('resolveWorktreeUnpushedStatus', () => {
  beforeEach(() => {
    getStatusMock.mockReset()
    gitExecFileAsyncMock.mockReset()
    getSshGitProviderMock.mockReset()
  })

  it('reports ahead with the upstream count for a local worktree', async () => {
    getStatusMock.mockResolvedValue(
      status({ upstreamStatus: { hasUpstream: true, ahead: 2, behind: 0 } })
    )

    await expect(resolveWorktreeUnpushedStatus(WORKTREE, LOCAL_REPO)).resolves.toEqual({
      kind: 'ahead',
      count: 2
    })
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('reports synced when upstream exists and ahead is zero', async () => {
    getStatusMock.mockResolvedValue(
      status({ upstreamStatus: { hasUpstream: true, ahead: 0, behind: 1 } })
    )

    await expect(resolveWorktreeUnpushedStatus(WORKTREE, LOCAL_REPO)).resolves.toEqual({
      kind: 'synced'
    })
  })

  it('reads the unpublished commit count only when there is no upstream, dirty or not', async () => {
    getStatusMock.mockResolvedValue(
      status({
        entries: [
          { path: 'a.txt', status: 'modified', area: 'unstaged' }
        ] as GitStatusResult['entries'],
        upstreamStatus: { hasUpstream: false, ahead: 0, behind: 0 }
      })
    )
    gitExecFileAsyncMock.mockResolvedValue({ stdout: '3\n', stderr: '' })

    await expect(resolveWorktreeUnpushedStatus(WORKTREE, LOCAL_REPO)).resolves.toEqual({
      kind: 'unpublished',
      count: 3
    })
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['rev-list', '--count', 'HEAD', '--not', '--remotes'],
      expect.objectContaining({ cwd: WORKTREE.path })
    )
  })

  it('reports synced for a never-published branch with no local commits', async () => {
    getStatusMock.mockResolvedValue(
      status({ upstreamStatus: { hasUpstream: false, ahead: 0, behind: 0 } })
    )
    gitExecFileAsyncMock.mockResolvedValue({ stdout: '0\n', stderr: '' })

    await expect(resolveWorktreeUnpushedStatus(WORKTREE, LOCAL_REPO)).resolves.toEqual({
      kind: 'synced'
    })
  })

  it('reports unknown when the status read throws', async () => {
    getStatusMock.mockRejectedValue(new Error('boom'))

    await expect(resolveWorktreeUnpushedStatus(WORKTREE, LOCAL_REPO)).resolves.toEqual({
      kind: 'unknown'
    })
  })

  it('reports unknown for an unreachable SSH host rather than reading locally', async () => {
    getSshGitProviderMock.mockReturnValue(undefined)

    await expect(resolveWorktreeUnpushedStatus(WORKTREE, SSH_REPO)).resolves.toEqual({
      kind: 'unknown'
    })
    expect(getStatusMock).not.toHaveBeenCalled()
  })

  it('routes an SSH worktree through its own host provider', async () => {
    const providerGetStatus = vi
      .fn()
      .mockResolvedValue(status({ upstreamStatus: { hasUpstream: true, ahead: 1, behind: 0 } }))
    getSshGitProviderMock.mockReturnValue({ getStatus: providerGetStatus })

    await expect(resolveWorktreeUnpushedStatus(WORKTREE, SSH_REPO)).resolves.toEqual({
      kind: 'ahead',
      count: 1
    })
    expect(providerGetStatus).toHaveBeenCalledWith(
      WORKTREE.path,
      expect.objectContaining({ includeLineStats: false })
    )
    expect(getStatusMock).not.toHaveBeenCalled()
  })
})
