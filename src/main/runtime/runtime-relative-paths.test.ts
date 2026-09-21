import { describe, expect, it } from 'vitest'
import { joinWorktreeRelativePath } from './runtime-relative-paths'

describe('joinWorktreeRelativePath', () => {
  it('rejects a parent-traversal sub-path', () => {
    expect(() => joinWorktreeRelativePath('/repo', '../x')).toThrow('invalid_relative_path')
    expect(() => joinWorktreeRelativePath('/repo', 'a/../../x')).toThrow('invalid_relative_path')
  })

  it('rejects an absolute sub-path', () => {
    expect(() => joinWorktreeRelativePath('/repo', '/etc/passwd')).toThrow('invalid_relative_path')
    expect(() => joinWorktreeRelativePath('C:/repo', 'C:/Windows')).toThrow('invalid_relative_path')
  })

  it('still joins an ordinary sub-path', () => {
    expect(joinWorktreeRelativePath('/repo', '.kolux/issue-command')).toBe(
      '/repo/.kolux/issue-command'
    )
  })

  it('still allows an empty sub-path (root of the worktree)', () => {
    expect(joinWorktreeRelativePath('/repo', '')).toBe('/repo')
  })
})
