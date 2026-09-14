import { describe, expect, it } from 'vitest'
import { formatWorktreeOverlap } from './workspace-format'

describe('formatWorktreeOverlap', () => {
  it('prints "Could not verify" and never "No sibling worktrees" when the scan was not authoritative', () => {
    const output = formatWorktreeOverlap({
      worktree: { id: 'repo-1::/target', branch: 'agent-a' },
      siblings: [],
      siblingsUnverifiable: true
    })
    expect(output).toContain('Could not verify sibling worktrees (scan not authoritative).')
    expect(output).not.toContain('No sibling worktrees.')
  })

  it('prints "No sibling worktrees." when the scan was authoritative and found none', () => {
    const output = formatWorktreeOverlap({
      worktree: { id: 'repo-1::/target', branch: 'agent-a' },
      siblings: []
    })
    expect(output).toContain('No sibling worktrees.')
  })

  it('flags a sibling whose own changes computation failed', () => {
    const output = formatWorktreeOverlap({
      worktree: { id: 'repo-1::/target', branch: 'agent-a' },
      siblings: [
        {
          id: 'repo-1::/sibling',
          branch: 'agent-b',
          sharedFiles: [],
          changesUnverifiable: true,
          conflictPrediction: 'unverifiable',
          conflictingFiles: []
        }
      ]
    })
    expect(output).toContain('changes unverifiable')
  })
})
