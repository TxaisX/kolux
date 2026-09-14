import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitStatusResult } from '../../shared/git-status-types'
import type { Repo } from '../../shared/repo-types'

const { getStatusMock, gitExecFileAsyncMock, getSshGitProviderMock, listWorktreesMock } = vi.hoisted(
  () => ({
    getStatusMock: vi.fn(),
    gitExecFileAsyncMock: vi.fn(),
    getSshGitProviderMock: vi.fn(),
    listWorktreesMock: vi.fn()
  })
)

vi.mock('../git/status', () => ({ getStatus: getStatusMock }))
vi.mock('../git/runner', () => ({ gitExecFileAsync: gitExecFileAsyncMock }))
vi.mock('../git/worktree', () => ({ listWorktrees: listWorktreesMock }))
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

const KNOWN_LOCAL_WORKTREES = [
  { path: '/repo', head: 'a', branch: 'main', isBare: false, isMainWorktree: true },
  { path: '/repo/tree', head: 'b', branch: 'feature', isBare: false, isMainWorktree: false }
]

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
    listWorktreesMock.mockReset()
    listWorktreesMock.mockResolvedValue(KNOWN_LOCAL_WORKTREES)
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

  it('reports unverifiable when the status read throws', async () => {
    getStatusMock.mockRejectedValue(new Error('boom'))

    await expect(resolveWorktreeUnpushedStatus(WORKTREE, LOCAL_REPO)).resolves.toEqual({
      kind: 'unverifiable'
    })
  })

  it('reports unverifiable for an unreachable SSH host rather than reading locally', async () => {
    getSshGitProviderMock.mockReturnValue(undefined)

    await expect(resolveWorktreeUnpushedStatus(WORKTREE, SSH_REPO)).resolves.toEqual({
      kind: 'unverifiable'
    })
    expect(getStatusMock).not.toHaveBeenCalled()
  })

  it('routes an SSH worktree through its own host provider', async () => {
    const providerGetStatus = vi
      .fn()
      .mockResolvedValue(status({ upstreamStatus: { hasUpstream: true, ahead: 1, behind: 0 } }))
    const providerListWorktrees = vi.fn().mockResolvedValue(KNOWN_LOCAL_WORKTREES)
    getSshGitProviderMock.mockReturnValue({
      getStatus: providerGetStatus,
      listWorktrees: providerListWorktrees
    })

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

  it('reports unverifiable for a path outside the repo\'s known worktrees, without reading git status', async () => {
    listWorktreesMock.mockResolvedValue(KNOWN_LOCAL_WORKTREES)
    const outsideWorktree = { path: '/etc/passwd-lookalike', hostId: undefined, isMainWorktree: false }

    await expect(resolveWorktreeUnpushedStatus(outsideWorktree, LOCAL_REPO)).resolves.toEqual({
      kind: 'unverifiable'
    })
    expect(getStatusMock).not.toHaveBeenCalled()
  })

  it('reports unverifiable for an SSH path outside the repo\'s known worktrees', async () => {
    const providerListWorktrees = vi.fn().mockResolvedValue(KNOWN_LOCAL_WORKTREES)
    getSshGitProviderMock.mockReturnValue({
      getStatus: vi.fn(),
      listWorktrees: providerListWorktrees
    })
    const outsideWorktree = { path: '/repo/not-a-real-worktree', hostId: undefined, isMainWorktree: false }

    await expect(resolveWorktreeUnpushedStatus(outsideWorktree, SSH_REPO)).resolves.toEqual({
      kind: 'unverifiable'
    })
    expect(getStatusMock).not.toHaveBeenCalled()
  })
})
