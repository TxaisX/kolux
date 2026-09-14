import { describe, expect, it } from 'vitest'
import { computeWorktreeChanges, type WorktreeChangesRuntimeHost } from './worktree-changes-computation'

function makeHost(overrides: Partial<WorktreeChangesRuntimeHost> = {}): WorktreeChangesRuntimeHost {
  return {
    showManagedWorktree: async () => ({
      id: 'repo-1::/w',
      repoId: 'repo-1',
      branch: 'agent-a',
      path: '/w',
      head: 'head-a',
      baseRef: 'main'
    }),
    showRepo: async () => ({}),
    getRepoBaseRefDefault: async () => ({ defaultBaseRef: null, remoteCount: 0 }),
    getRuntimeGitStatus: async () => ({ entries: [], conflictOperation: 'unknown' }),
    getRuntimeGitBranchCompare: async () => ({
      summary: {
        baseRef: 'main',
        baseOid: 'a',
        compareRef: 'HEAD',
        headOid: 'b',
        mergeBase: 'a',
        changedFiles: 0,
        status: 'ready'
      },
      entries: []
    }),
    ...overrides
  }
}

describe('computeWorktreeChanges', () => {
  it('unions committed and uncommitted files, flagging each independently', async () => {
    const host = makeHost({
      getRuntimeGitStatus: async () => ({
        entries: [
          { path: 'a.ts', status: 'modified', area: 'unstaged' },
          { path: 'b.ts', status: 'untracked', area: 'untracked' }
        ],
        conflictOperation: 'unknown'
      }),
      getRuntimeGitBranchCompare: async () => ({
        summary: {
          baseRef: 'main',
          baseOid: 'a',
          compareRef: 'HEAD',
          headOid: 'b',
          mergeBase: 'a',
          changedFiles: 2,
          status: 'ready'
        },
        entries: [
          { path: 'a.ts', status: 'modified' },
          { path: 'c.ts', status: 'added' }
        ]
      })
    })

    const result = await computeWorktreeChanges(host, 'id:repo-1::/w')

    expect(result.base).toBe('main')
    expect(result.files.sort((x, y) => x.path.localeCompare(y.path))).toEqual([
      { path: 'a.ts', status: 'modified', committed: true, uncommitted: true },
      { path: 'b.ts', status: 'untracked', committed: false, uncommitted: true },
      { path: 'c.ts', status: 'added', committed: true, uncommitted: false }
    ])
  })

  it('maps a committed copy to renamed, which the public contract does not carry', async () => {
    const host = makeHost({
      getRuntimeGitBranchCompare: async () => ({
        summary: {
          baseRef: 'main',
          baseOid: 'a',
          compareRef: 'HEAD',
          headOid: 'b',
          mergeBase: 'a',
          changedFiles: 1,
          status: 'ready'
        },
        entries: [{ path: 'copy.ts', status: 'copied', oldPath: 'orig.ts' }]
      })
    })
    const result = await computeWorktreeChanges(host, 'id:repo-1::/w')
    expect(result.files).toEqual([
      { path: 'copy.ts', status: 'renamed', committed: true, uncommitted: false }
    ])
  })

  it('falls back through sparseBaseRef, repo.worktreeBaseRef, then the repo default, in order', async () => {
    const noPersistedBase = makeHost({
      showManagedWorktree: async () => ({
        id: 'repo-1::/w',
        repoId: 'repo-1',
        branch: 'agent-a',
        path: '/w',
        head: 'head-a',
        sparseBaseRef: 'sparse-main'
      })
    })
    expect((await computeWorktreeChanges(noPersistedBase, 'id:repo-1::/w')).base).toBe('sparse-main')

    const repoConfiguredBase = makeHost({
      showManagedWorktree: async () => ({
        id: 'repo-1::/w',
        repoId: 'repo-1',
        branch: 'agent-a',
        path: '/w',
        head: 'head-a'
      }),
      showRepo: async () => ({ worktreeBaseRef: 'develop' })
    })
    expect((await computeWorktreeChanges(repoConfiguredBase, 'id:repo-1::/w')).base).toBe('develop')

    const detectedDefaultOnly = makeHost({
      showManagedWorktree: async () => ({
        id: 'repo-1::/w',
        repoId: 'repo-1',
        branch: 'agent-a',
        path: '/w',
        head: 'head-a'
      }),
      getRepoBaseRefDefault: async () => ({ defaultBaseRef: 'trunk', remoteCount: 0 })
    })
    expect((await computeWorktreeChanges(detectedDefaultOnly, 'id:repo-1::/w')).base).toBe('trunk')
  })

  it('reports base: null and falls back to uncommitted-only when no base ref resolves at all', async () => {
    const host = makeHost({
      showManagedWorktree: async () => ({
        id: 'repo-1::/w',
        repoId: 'repo-1',
        branch: 'agent-a',
        path: '/w',
        head: 'head-a'
      }),
      getRuntimeGitStatus: async () => ({
        entries: [{ path: 'a.ts', status: 'modified', area: 'unstaged' }],
        conflictOperation: 'unknown'
      })
    })
    const result = await computeWorktreeChanges(host, 'id:repo-1::/w')
    expect(result.base).toBeNull()
    expect(result.files).toEqual([
      { path: 'a.ts', status: 'modified', committed: false, uncommitted: true }
    ])
  })

  it('falls back to uncommitted-only when the branch compare itself fails', async () => {
    const host = makeHost({
      getRuntimeGitBranchCompare: async () => {
        throw new Error('boom')
      },
      getRuntimeGitStatus: async () => ({
        entries: [{ path: 'a.ts', status: 'added', area: 'untracked' }],
        conflictOperation: 'unknown'
      })
    })
    const result = await computeWorktreeChanges(host, 'id:repo-1::/w')
    expect(result.base).toBe('main')
    expect(result.files).toEqual([
      { path: 'a.ts', status: 'added', committed: false, uncommitted: true }
    ])
  })
})
