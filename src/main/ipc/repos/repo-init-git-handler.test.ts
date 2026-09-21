/**
 * Unit tests for repos:initGit — turning an existing local, non-git folder into a
 * git repo (kolux's "Make it a git repo" flow off the non-git-folder dialog).
 *
 * Pins the invariants that matter here:
 *   - Boundary validation (path required/absolute, exists, is a directory, not
 *     already a git repo) runs before any git command.
 *   - Only `git init` and an empty `git commit` ever run — the user's existing
 *     files are never staged (`git add` is never called).
 *   - A successful init registers the repo via the existing local registration path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'

const {
  handleMock,
  statMock,
  rmMock,
  gitExecFileAsyncMock,
  isGitRepoMock,
  addLocalRepoFromPathMock,
  invalidateAuthorizedRootsCacheMock,
  notifyReposChangedMock,
  emitRepoAddedMock
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  statMock: vi.fn(),
  rmMock: vi.fn(),
  gitExecFileAsyncMock: vi.fn(),
  isGitRepoMock: vi.fn(),
  addLocalRepoFromPathMock: vi.fn(),
  invalidateAuthorizedRootsCacheMock: vi.fn(),
  notifyReposChangedMock: vi.fn(),
  emitRepoAddedMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock, removeHandler: vi.fn() }
}))

vi.mock('node:fs/promises', () => ({
  stat: statMock,
  rm: rmMock
}))

vi.mock('../../git/runner', () => ({
  gitExecFileAsync: gitExecFileAsyncMock
}))

vi.mock('../../git/repo', () => ({
  isGitRepo: isGitRepoMock
}))

vi.mock('./local-repo-registration', () => ({
  addLocalRepoFromPath: addLocalRepoFromPathMock
}))

vi.mock('../registered-worktree-roots-cache', () => ({
  invalidateAuthorizedRootsCache: invalidateAuthorizedRootsCacheMock
}))

vi.mock('./repos-changed-notification', () => ({
  notifyReposChanged: notifyReposChangedMock
}))

vi.mock('./repo-added-telemetry', () => ({
  emitRepoAdded: emitRepoAddedMock
}))

import { registerRepoInitGitHandler } from './repo-init-git-handler'

type InitGitResult = { repo: Repo } | { error: string }

describe('repos:initGit', () => {
  const handlers = new Map<string, (event: unknown, args: unknown) => unknown>()
  const mockWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } }
  const mockStore = {} as never

  const callInitGit = (args: { path: string }): Promise<InitGitResult> => {
    const handler = handlers.get('repos:initGit')
    if (!handler) {
      throw new Error('repos:initGit handler was never registered')
    }
    return handler(null, args) as Promise<InitGitResult>
  }

  beforeEach(() => {
    handlers.clear()
    handleMock.mockReset()
    handleMock.mockImplementation((channel: string, handler: (...a: unknown[]) => unknown) => {
      handlers.set(channel, handler as (event: unknown, args: unknown) => unknown)
    })
    statMock.mockReset().mockResolvedValue({ isDirectory: () => true })
    rmMock.mockReset().mockResolvedValue(undefined)
    gitExecFileAsyncMock.mockReset().mockResolvedValue({ stdout: '', stderr: '' })
    isGitRepoMock.mockReset().mockReturnValue(false)
    addLocalRepoFromPathMock.mockReset().mockResolvedValue({
      repo: { id: 'r1', path: '/tmp/proj', kind: 'git' } as Repo,
      alreadyExisted: false
    })
    invalidateAuthorizedRootsCacheMock.mockReset()
    notifyReposChangedMock.mockReset()
    emitRepoAddedMock.mockReset()

    registerRepoInitGitHandler(mockWindow as never, mockStore)
  })

  it('registers the repos:initGit handler', () => {
    expect(handlers.has('repos:initGit')).toBe(true)
  })

  // ── input validation ──────────────────────────────────────────────

  it('rejects an empty path', async () => {
    const result = await callInitGit({ path: '   ' })
    expect(result).toEqual({ error: 'Path is required' })
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('rejects a relative path', async () => {
    const result = await callInitGit({ path: 'relative/project' })
    expect(result).toMatchObject({ error: expect.stringContaining('absolute') })
    expect(statMock).not.toHaveBeenCalled()
  })

  it('rejects a path that cannot be accessed', async () => {
    statMock.mockRejectedValueOnce(new Error('ENOENT'))
    const result = await callInitGit({ path: '/tmp/missing' })
    expect(result).toMatchObject({ error: expect.stringContaining('Cannot access path') })
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('rejects a path that is not a directory', async () => {
    statMock.mockResolvedValueOnce({ isDirectory: () => false })
    const result = await callInitGit({ path: '/tmp/a-file' })
    expect(result).toEqual({ error: 'Path is not a directory' })
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
  })

  it('rejects a folder that is already a git repository', async () => {
    isGitRepoMock.mockReturnValueOnce(true)
    const result = await callInitGit({ path: '/tmp/already-git' })
    expect(result).toMatchObject({ error: expect.stringContaining('already a git repository') })
    expect(gitExecFileAsyncMock).not.toHaveBeenCalled()
    expect(addLocalRepoFromPathMock).not.toHaveBeenCalled()
  })

  // ── happy path ─────────────────────────────────────────────────────

  it('runs git init and an empty commit, and never stages the user files', async () => {
    await callInitGit({ path: '/tmp/proj' })

    expect(gitExecFileAsyncMock).toHaveBeenNthCalledWith(1, ['init'], { cwd: '/tmp/proj' })
    expect(gitExecFileAsyncMock).toHaveBeenNthCalledWith(
      2,
      ['commit', '--allow-empty', '-m', 'Initial commit'],
      { cwd: '/tmp/proj' }
    )
    for (const call of gitExecFileAsyncMock.mock.calls) {
      expect(call[0]).not.toContain('add')
    }
  })

  it('registers the repo via the local registration path and returns it', async () => {
    const result = await callInitGit({ path: '/tmp/proj' })

    expect(addLocalRepoFromPathMock).toHaveBeenCalledWith(mockStore, '/tmp/proj', 'git')
    expect(invalidateAuthorizedRootsCacheMock).toHaveBeenCalledTimes(1)
    expect(notifyReposChangedMock).toHaveBeenCalledWith(mockWindow)
    expect(emitRepoAddedMock).toHaveBeenCalledWith('folder_picker', false, true)
    expect(result).toEqual({ repo: { id: 'r1', path: '/tmp/proj', kind: 'git' } })
  })

  // ── failure paths ──────────────────────────────────────────────────

  it('surfaces an init failure without registering the repo', async () => {
    gitExecFileAsyncMock.mockReset().mockRejectedValueOnce(new Error('init blew up'))

    const result = await callInitGit({ path: '/tmp/proj' })

    expect(result).toMatchObject({ error: expect.stringContaining('Failed to initialize') })
    expect(addLocalRepoFromPathMock).not.toHaveBeenCalled()
  })

  it('surfaces a friendly message when git author identity is missing', async () => {
    gitExecFileAsyncMock
      .mockReset()
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(new Error('Please tell me who you are.'))

    const result = await callInitGit({ path: '/tmp/proj' })

    expect(result).toMatchObject({
      error: expect.stringContaining('Git author identity is not configured')
    })
    expect(addLocalRepoFromPathMock).not.toHaveBeenCalled()
  })

  it('propagates an error from the local registration path', async () => {
    addLocalRepoFromPathMock.mockResolvedValueOnce({
      error: 'Not a valid git repository: /tmp/proj'
    })

    const result = await callInitGit({ path: '/tmp/proj' })

    expect(result).toEqual({ error: 'Not a valid git repository: /tmp/proj' })
    expect(notifyReposChangedMock).not.toHaveBeenCalled()
  })
})
