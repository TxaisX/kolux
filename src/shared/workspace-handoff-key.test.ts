import { describe, expect, it } from 'vitest'
import { WORKSPACE_HANDOFF_KEY_PATTERN, buildWorkspaceHandoffKey } from './workspace-handoff-key'

describe('buildWorkspaceHandoffKey', () => {
  it('matches the validated key shape', () => {
    const key = buildWorkspaceHandoffKey({ hostId: 'local', path: 'C:/repo/worktree' })
    expect(key).toMatch(WORKSPACE_HANDOFF_KEY_PATTERN)
  })

  it('is stable for the same host and path', () => {
    const a = buildWorkspaceHandoffKey({ hostId: 'local', path: 'C:/repo/worktree' })
    const b = buildWorkspaceHandoffKey({ hostId: 'local', path: 'C:/repo/worktree' })
    expect(a).toBe(b)
  })

  it('differs across hosts for the same path', () => {
    const local = buildWorkspaceHandoffKey({ hostId: 'local', path: '/home/user/repo' })
    const ssh = buildWorkspaceHandoffKey({ hostId: 'ssh:box', path: '/home/user/repo' })
    expect(local).not.toBe(ssh)
  })

  it('differs across paths for the same host', () => {
    const a = buildWorkspaceHandoffKey({ hostId: 'local', path: '/repo/a' })
    const b = buildWorkspaceHandoffKey({ hostId: 'local', path: '/repo/b' })
    expect(a).not.toBe(b)
  })

  it('normalizes slash direction and a trailing slash', () => {
    const withBackslashes = buildWorkspaceHandoffKey({ hostId: 'local', path: 'C:\\repo\\tree\\' })
    const withForwardSlashes = buildWorkspaceHandoffKey({ hostId: 'local', path: 'C:/repo/tree' })
    expect(withBackslashes).toBe(withForwardSlashes)
  })

  it('does not merge a folder workspace with a worktree at an unrelated path', () => {
    const folder = buildWorkspaceHandoffKey({ hostId: 'local', path: '/home/user/scratch' })
    const worktree = buildWorkspaceHandoffKey({ hostId: 'local', path: '/home/user/repo/tree' })
    expect(folder).not.toBe(worktree)
  })
})
