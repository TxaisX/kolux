import { describe, expect, it } from 'vitest'
import {
  redactUrlUserinfo,
  validateGithubRepoName,
  validateRemoteUrl
} from './publish-remote-input-validation'

describe('validateGithubRepoName', () => {
  it('accepts a normal name', () => {
    expect(validateGithubRepoName('my-project_1.0')).toBeNull()
  })
  it('rejects empty', () => {
    expect(validateGithubRepoName('   ')).toBe('Repository name is required')
  })
  it('rejects a leading dash (argument injection)', () => {
    expect(validateGithubRepoName('-x')).toBe('Repository name cannot start with "-"')
  })
  it('rejects disallowed characters', () => {
    expect(validateGithubRepoName('repo name; rm -rf')).toMatch(/can only contain/)
  })
  it('rejects embedded control characters', () => {
    expect(validateGithubRepoName('repo\r\nname')).toBe('Repository name cannot contain control characters')
    expect(validateGithubRepoName('repo\x00name')).toBe('Repository name cannot contain control characters')
  })
})

describe('validateRemoteUrl', () => {
  it('accepts https', () => {
    expect(validateRemoteUrl('https://gitlab.com/owner/repo.git')).toBeNull()
  })
  it('accepts ssh://', () => {
    expect(validateRemoteUrl('ssh://git@example.com/owner/repo.git')).toBeNull()
  })
  it('accepts git@ scp-style', () => {
    expect(validateRemoteUrl('git@example.com:owner/repo.git')).toBeNull()
  })
  it('rejects empty', () => {
    expect(validateRemoteUrl('  ')).toBe('Remote URL is required')
  })
  it('rejects a leading dash (argument injection)', () => {
    expect(validateRemoteUrl('-oProxyCommand=x')).toBe('Remote URL is invalid')
  })
  it('rejects a disallowed scheme', () => {
    expect(validateRemoteUrl('file:///etc/passwd')).toMatch(/must start with/)
    expect(validateRemoteUrl('ext::sh -c evil')).toMatch(/must start with/)
    expect(validateRemoteUrl('/local/path/repo.git')).toMatch(/must start with/)
  })
  it('rejects embedded control characters', () => {
    expect(validateRemoteUrl('https://example.com/repo.git\r\nHost: evil')).toBe(
      'Remote URL cannot contain control characters'
    )
    expect(validateRemoteUrl('https://example.com/\x00repo.git')).toBe(
      'Remote URL cannot contain control characters'
    )
  })
  it('rejects a URL longer than the max length', () => {
    const url = `https://example.com/${'a'.repeat(2100)}.git`
    expect(validateRemoteUrl(url)).toBe('Remote URL is too long')
  })
  it('rejects a URL with an embedded password credential', () => {
    expect(validateRemoteUrl('https://user:ghp_token@github.com/owner/repo.git')).toMatch(
      /cannot include a password/
    )
  })
  it('still allows the normal bare ssh username form', () => {
    expect(validateRemoteUrl('ssh://git@example.com/owner/repo.git')).toBeNull()
    expect(validateRemoteUrl('git@example.com:owner/repo.git')).toBeNull()
  })
})

describe('redactUrlUserinfo', () => {
  it('redacts a user:password pair embedded in a URL', () => {
    expect(redactUrlUserinfo('Failed to push to https://user:token@host/repo.git: denied')).toBe(
      'Failed to push to https://***@host/repo.git: denied'
    )
  })
  it('redacts a bare username too', () => {
    expect(redactUrlUserinfo('remote: https://ghp_abc@github.com/owner/repo.git')).toBe(
      'remote: https://***@github.com/owner/repo.git'
    )
  })
  it('leaves text with no userinfo untouched', () => {
    expect(redactUrlUserinfo('Failed to push to https://github.com/owner/repo.git')).toBe(
      'Failed to push to https://github.com/owner/repo.git'
    )
  })
})
