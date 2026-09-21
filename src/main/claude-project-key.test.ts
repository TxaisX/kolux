import { describe, expect, it } from 'vitest'
import { toClaudeProjectKey } from './claude-trust-preset'

describe('toClaudeProjectKey', () => {
  it('writes Windows keys with forward slashes, the only form Claude looks up', () => {
    expect(
      toClaudeProjectKey('G:\\Dev\\kolux-workspaces\\six-agent-retest\\cornetfish', 'win32')
    ).toBe('G:/Dev/kolux-workspaces/six-agent-retest/cornetfish')
  })

  it('keeps drive-letter casing as the filesystem reported it', () => {
    expect(toClaudeProjectKey('C:\\Users\\Me\\repo', 'win32')).toBe('C:/Users/Me/repo')
  })

  it('leaves POSIX keys unchanged', () => {
    expect(toClaudeProjectKey('/home/me/repo/worktree', 'linux')).toBe('/home/me/repo/worktree')
    expect(toClaudeProjectKey('/Users/me/repo', 'darwin')).toBe('/Users/me/repo')
  })
})
