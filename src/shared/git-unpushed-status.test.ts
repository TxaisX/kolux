import { describe, expect, it } from 'vitest'
import { classifyWorktreeUnpushedStatus } from './git-unpushed-status'
import type { GitUpstreamStatus } from './git-status-types'

function upstream(overrides: Partial<GitUpstreamStatus>): GitUpstreamStatus {
  return { hasUpstream: true, ahead: 0, behind: 0, ...overrides }
}

describe('classifyWorktreeUnpushedStatus', () => {
  it('reports unverifiable when the upstream status is missing', () => {
    expect(classifyWorktreeUnpushedStatus(undefined, null)).toEqual({ kind: 'unverifiable' })
  })

  it('reports ahead with the commit count when upstream exists and is ahead', () => {
    expect(classifyWorktreeUnpushedStatus(upstream({ ahead: 3 }), null)).toEqual({
      kind: 'ahead',
      count: 3
    })
  })

  it('reports synced when upstream exists and ahead is zero', () => {
    expect(classifyWorktreeUnpushedStatus(upstream({ ahead: 0 }), null)).toEqual({
      kind: 'synced'
    })
  })

  it('reports unverifiable for a never-published branch when the commit count could not be read', () => {
    expect(
      classifyWorktreeUnpushedStatus(upstream({ hasUpstream: false, ahead: 0, behind: 0 }), null)
    ).toEqual({ kind: 'unverifiable' })
  })

  it('reports unpublished with the count for a never-published branch with local commits', () => {
    expect(
      classifyWorktreeUnpushedStatus(upstream({ hasUpstream: false, ahead: 0, behind: 0 }), 5)
    ).toEqual({ kind: 'unpublished', count: 5 })
  })

  it('reports synced for a never-published branch with no local commits', () => {
    expect(
      classifyWorktreeUnpushedStatus(upstream({ hasUpstream: false, ahead: 0, behind: 0 }), 0)
    ).toEqual({ kind: 'synced' })
  })
})
