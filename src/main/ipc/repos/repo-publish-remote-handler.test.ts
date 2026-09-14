/**
 * repos:publishRemote — first push to a brand-new remote. The 'url' provider is proven
 * against a real local bare repo (git plumbing only — see publishToRemoteUrl, which
 * bypasses the production URL-scheme allowlist deliberately so this test doesn't have to
 * weaken it); the 'github' provider is proven against a stubbed `gh`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Repo } from '../../../shared/repo-types'
import type * as GitRunnerModule from '../../git/runner'

const { handleMock, ghExecFileAsyncMock, diagnoseGhAuthMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  ghExecFileAsyncMock: vi.fn(),
  diagnoseGhAuthMock: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: handleMock, removeHandler: vi.fn() } }))
vi.mock('./repos-changed-notification', () => ({ notifyReposChanged: vi.fn() }))
vi.mock('../worktree-remote', () => ({ notifyWorktreesChanged: vi.fn() }))
vi.mock('../../github/auth-diagnose', () => ({ diagnoseGhAuth: diagnoseGhAuthMock }))
vi.mock('../../git/runner', async (importOriginal) => {
  const actual = await importOriginal<typeof GitRunnerModule>()
  return { ...actual, ghExecFileAsync: ghExecFileAsyncMock }
})

import { registerRepoPublishRemoteHandler, publishToRemoteUrl } from './repo-publish-remote-handler'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' })
}

describe('publishToRemoteUrl (real git plumbing)', () => {
  let root: string
  let bareRoot: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'nightshift-publish-url-source-'))
    bareRoot = await mkdtemp(join(tmpdir(), 'nightshift-publish-url-bare-'))
    git(['init', '-q'], root)
    git(['config', 'user.email', 'test@example.com'], root)
    git(['config', 'user.name', 'Test'], root)
    await writeFile(join(root, 'app.js'), 'noop')
    git(['add', '-A'], root)
    git(['commit', '-q', '-m', 'add app'], root)
    git(['init', '-q', '--bare'], bareRoot)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(bareRoot, { recursive: true, force: true })
  })

  it('adds origin and pushes, landing the commit in the bare repo with upstream set', async () => {
    const url = pathToFileURL(bareRoot).toString()
    const outcome = await publishToRemoteUrl(root, url)
    expect(outcome).toEqual({ ok: true })

    const bareLog = git(['log', '--oneline'], bareRoot).trim()
    expect(bareLog).toContain('add app')
    const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], root).trim()
    expect(upstream.startsWith('origin/')).toBe(true)
  })

  it('rolls the remote back when the push fails', async () => {
    // Why: an empty, non-git directory is a deterministic push failure — `remote add`
    // never validates the target, only `push` actually talks to it.
    const notARepo = await mkdtemp(join(tmpdir(), 'nightshift-publish-url-not-a-repo-'))
    const url = pathToFileURL(notARepo).toString()

    const outcome = await publishToRemoteUrl(root, url)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/Failed to push/)
    }
    expect(() => git(['remote', 'get-url', 'origin'], root)).toThrow()
    await rm(notARepo, { recursive: true, force: true })
  })
})

describe('repos:publishRemote (github provider, stubbed gh)', () => {
  const handlers = new Map<string, (event: unknown, args: unknown) => unknown>()
  const mockWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } }
  let root: string
  let repo: Repo
  let store: { getRepo: (id: string) => Repo | undefined }

  const call = (args: unknown): Promise<{ repo: Repo } | { error: string }> => {
    const handler = handlers.get('repos:publishRemote')
    if (!handler) {
      throw new Error('repos:publishRemote handler was never registered')
    }
    return handler(null, args) as Promise<{ repo: Repo } | { error: string }>
  }

  beforeEach(async () => {
    handlers.clear()
    handleMock.mockReset()
    ghExecFileAsyncMock.mockReset()
    diagnoseGhAuthMock.mockReset()
    handleMock.mockImplementation((channel: string, handler: (...a: unknown[]) => unknown) => {
      handlers.set(channel, handler as (event: unknown, args: unknown) => unknown)
    })

    root = await mkdtemp(join(tmpdir(), 'nightshift-publish-gh-'))
    git(['init', '-q'], root)
    git(['config', 'user.email', 'test@example.com'], root)
    git(['config', 'user.name', 'Test'], root)
    git(['commit', '--allow-empty', '-q', '-m', 'Initial commit'], root)
    repo = {
      id: 'repo-1',
      path: root,
      displayName: 'my-project',
      badgeColor: '#000',
      addedAt: Date.now(),
      kind: 'git'
    } as Repo
    store = { getRepo: (id) => (id === repo.id ? repo : undefined) }
    registerRepoPublishRemoteHandler(mockWindow as never, store as never)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('refuses without confirmation', async () => {
    const result = await call({ repoId: repo.id, provider: 'github', confirmed: false })
    expect(result).toEqual({ error: 'Confirmation is required before publishing' })
    expect(diagnoseGhAuthMock).not.toHaveBeenCalled()
  })

  it('refuses when gh is not installed', async () => {
    diagnoseGhAuthMock.mockResolvedValue({ ghAvailable: false, activeAccount: null })
    const result = await call({ repoId: repo.id, provider: 'github', confirmed: true })
    expect(result).toMatchObject({ error: expect.stringContaining('not installed') })
    expect(ghExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('refuses when gh is installed but not authenticated', async () => {
    diagnoseGhAuthMock.mockResolvedValue({ ghAvailable: true, activeAccount: null })
    const result = await call({ repoId: repo.id, provider: 'github', confirmed: true })
    expect(result).toMatchObject({ error: expect.stringContaining('gh auth login') })
    expect(ghExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('creates a private repo by default, using the folder name, with the exact expected argv', async () => {
    diagnoseGhAuthMock.mockResolvedValue({ ghAvailable: true, activeAccount: { host: 'github.com' } })
    ghExecFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })

    const result = await call({ repoId: repo.id, provider: 'github', confirmed: true })

    expect(ghExecFileAsyncMock).toHaveBeenCalledWith(
      [
        'repo',
        'create',
        basename(root),
        '--private',
        '--source',
        root,
        '--remote',
        'origin',
        '--push'
      ],
      { cwd: root }
    )
    expect(result).toEqual({ repo })
  })

  it('creates a public repo and a custom name when requested', async () => {
    diagnoseGhAuthMock.mockResolvedValue({ ghAvailable: true, activeAccount: { host: 'github.com' } })
    ghExecFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })

    await call({
      repoId: repo.id,
      provider: 'github',
      visibility: 'public',
      name: 'custom-name',
      confirmed: true
    })

    expect(ghExecFileAsyncMock).toHaveBeenCalledWith(
      expect.arrayContaining(['custom-name', '--public']),
      { cwd: root }
    )
  })

  it('rejects a repo name that looks like argument injection, without calling gh', async () => {
    diagnoseGhAuthMock.mockResolvedValue({ ghAvailable: true, activeAccount: { host: 'github.com' } })
    const result = await call({ repoId: repo.id, provider: 'github', name: '-x', confirmed: true })
    expect(result).toMatchObject({ error: expect.stringContaining('cannot start with') })
    expect(ghExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('rejects a "url" provider value that fails the scheme allowlist, without touching git', async () => {
    const result = await call({
      repoId: repo.id,
      provider: 'url',
      url: pathToFileURL(root).toString(),
      confirmed: true
    })
    expect(result).toMatchObject({ error: expect.stringContaining('must start with') })
    expect(() => git(['remote', 'get-url', 'origin'], root)).toThrow()
  })

  it('refuses when the repo already has a remote', async () => {
    git(['remote', 'add', 'origin', 'https://example.com/owner/repo.git'], root)
    const result = await call({ repoId: repo.id, provider: 'github', confirmed: true })
    expect(result).toMatchObject({ error: expect.stringContaining('already published') })
    expect(diagnoseGhAuthMock).not.toHaveBeenCalled()
  })
})
