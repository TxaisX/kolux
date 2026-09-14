import { describe, expect, it } from 'vitest'
import { validateGithubRepoName, validateRemoteUrl } from './publish-remote-input-validation'

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
})
