import { describe, expect, it } from 'vitest'
import { GitCapabilityCache } from '../../shared/git-capability-cache'
import { predictMergeTreeConflict, type MergeTreeConflictExec } from './worktree-merge-tree-prediction'

function execReturning(stdout: string): MergeTreeConflictExec {
  return async () => ({ stdout })
}

function execThrowing(error: Error & { stdout?: string }): MergeTreeConflictExec {
  return async () => {
    throw error
  }
}

describe('predictMergeTreeConflict', () => {
  it('reports clean when merge-tree exits 0', async () => {
    const result = await predictMergeTreeConflict(
      execReturning('tree-oid\0'),
      new GitCapabilityCache(),
      'a',
      'b'
    )
    expect(result).toEqual({ prediction: 'clean', conflictingFiles: [] })
  })

  it('reports conflicts and the conflicting paths when merge-tree exits 1 with a file list', async () => {
    const error = Object.assign(new Error('exit 1'), { stdout: 'tree-oid\0src/a.ts\0src/b.ts\0' })
    const result = await predictMergeTreeConflict(execThrowing(error), new GitCapabilityCache(), 'a', 'b')
    expect(result).toEqual({ prediction: 'conflicts', conflictingFiles: ['src/a.ts', 'src/b.ts'] })
  })

  it('falls back to unverifiable when --write-tree is unsupported (Git < 2.38)', async () => {
    const error = new Error("error: unknown option `write-tree'")
    const result = await predictMergeTreeConflict(execThrowing(error), new GitCapabilityCache(), 'a', 'b')
    expect(result).toEqual({ prediction: 'unverifiable', conflictingFiles: [] })
  })

  it('remembers an unsupported capability and skips re-probing on the next call', async () => {
    const capabilities = new GitCapabilityCache()
    let calls = 0
    const runGit: MergeTreeConflictExec = async () => {
      calls++
      throw new Error("error: unknown option `write-tree'")
    }
    await predictMergeTreeConflict(runGit, capabilities, 'a', 'b')
    const second = await predictMergeTreeConflict(runGit, capabilities, 'a', 'b')
    expect(second).toEqual({ prediction: 'unverifiable', conflictingFiles: [] })
    expect(calls).toBe(1)
  })

  it('fails closed to unverifiable on an unrelated execution error, never clean', async () => {
    const result = await predictMergeTreeConflict(
      execThrowing(new Error('fatal: not a valid object name a')),
      new GitCapabilityCache(),
      'a',
      'b'
    )
    expect(result.prediction).toBe('unverifiable')
  })
})
