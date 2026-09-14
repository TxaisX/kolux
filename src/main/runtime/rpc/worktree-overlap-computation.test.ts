import { describe, expect, it, vi } from 'vitest'
import { computeWorktreeOverlap, type WorktreeOverlapRuntimeHost } from './worktree-overlap-computation'
import type { WorktreeSummary } from './worktree-changes-computation'
import * as mergeTreePrediction from '../../git/worktree-merge-tree-prediction'

const TARGET: WorktreeSummary = {
  id: 'repo-1::/target',
  repoId: 'repo-1',
  branch: 'agent-a',
  path: '/target',
  head: 'head-a'
}
const SIBLING: WorktreeSummary = {
  id: 'repo-1::/sibling',
  repoId: 'repo-1',
  branch: 'agent-b',
  path: '/sibling',
  head: 'head-b'
}

function makeHost(overrides: Partial<WorktreeOverlapRuntimeHost> = {}): WorktreeOverlapRuntimeHost {
  return {
    showManagedWorktree: async () => TARGET,
    listDetectedManagedWorktrees: async () => ({ authoritative: true, worktrees: [TARGET, SIBLING] }),
    showRepo: async () => ({}),
    getRepoBaseRefDefault: async () => ({ defaultBaseRef: null, remoteCount: 0 }),
    getRuntimeGitStatus: async () => ({ entries: [], conflictOperation: 'unknown' }),
    getRuntimeGitBranchCompare: async () => ({
      summary: {
        baseRef: 'main',
        baseOid: null,
        compareRef: 'HEAD',
        headOid: null,
        mergeBase: null,
        changedFiles: 0,
        status: 'ready'
      },
      entries: []
    }),
    ...overrides
  }
}

describe('computeWorktreeOverlap', () => {
  it('excludes the target from its own siblings and reports the file overlap', async () => {
    const statusByWorktree: Record<string, { path: string; status: 'modified'; area: 'unstaged' }[]> = {
      'id:repo-1::/target': [{ path: 'a.ts', status: 'modified', area: 'unstaged' }],
      'id:repo-1::/sibling': [
        { path: 'a.ts', status: 'modified', area: 'unstaged' },
        { path: 'b.ts', status: 'modified', area: 'unstaged' }
      ]
    }
    vi.spyOn(mergeTreePrediction, 'predictWorktreeMergeTreeConflict').mockResolvedValue({
      prediction: 'clean',
      conflictingFiles: []
    })
    const host = makeHost({
      getRuntimeGitStatus: async (selector) => ({
        entries: statusByWorktree[selector] ?? [],
        conflictOperation: 'unknown'
      })
    })

    const result = await computeWorktreeOverlap(host, 'id:repo-1::/target')

    expect(result.worktree).toEqual({ id: TARGET.id, branch: TARGET.branch })
    expect(result.siblings).toEqual([
      {
        id: SIBLING.id,
        branch: SIBLING.branch,
        sharedFiles: ['a.ts'],
        conflictPrediction: 'clean',
        conflictingFiles: []
      }
    ])
    vi.restoreAllMocks()
  })

  it('reports unverifiable without running merge-tree when a sibling is SSH-hosted', async () => {
    const spy = vi.spyOn(mergeTreePrediction, 'predictWorktreeMergeTreeConflict')
    const host = makeHost({
      listDetectedManagedWorktrees: async () => ({
        authoritative: true,
        worktrees: [TARGET, { ...SIBLING, hostId: 'ssh:box-1' }]
      })
    })

    const result = await computeWorktreeOverlap(host, 'id:repo-1::/target')

    expect(result.siblings).toEqual([
      {
        id: SIBLING.id,
        branch: SIBLING.branch,
        sharedFiles: [],
        conflictPrediction: 'unverifiable',
        conflictingFiles: []
      }
    ])
    expect(spy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('reports no siblings, not a false-empty guess, when the scan is not authoritative', async () => {
    const host = makeHost({
      listDetectedManagedWorktrees: async () => ({ authoritative: false, worktrees: [TARGET, SIBLING] })
    })
    const result = await computeWorktreeOverlap(host, 'id:repo-1::/target')
    expect(result.siblings).toEqual([])
  })
})
