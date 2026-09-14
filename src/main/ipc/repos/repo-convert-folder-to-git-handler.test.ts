/**
 * repos:convertFolderToGit — the context-menu "Make it a git repo" for an already
 * tracked folder project. Runs the real empty-commit `git init` (same as repos:initGit)
 * against a real temp folder, then hands off to `upgradeFolderRepo` — mocked here since
 * its own correctness (kind flip, extra-workspace guard, notifications) is already
 * covered end to end by folder-repo-git-upgrade.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Repo } from '../../../shared/repo-types'

const { handleMock, upgradeFolderRepoMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  upgradeFolderRepoMock: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: handleMock, removeHandler: vi.fn() } }))
vi.mock('../folder-repo-git-upgrade', () => ({ upgradeFolderRepo: upgradeFolderRepoMock }))

import { registerRepoConvertFolderToGitHandler } from './repo-convert-folder-to-git-handler'

describe('repos:convertFolderToGit', () => {
  const handlers = new Map<string, (event: unknown, args: unknown) => unknown>()
  const mockWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } }
  let root: string
  let repo: Repo
  let store: { getRepo: ReturnType<typeof vi.fn> }

  const call = (args: unknown): Promise<{ repo: Repo } | { error: string }> => {
    const handler = handlers.get('repos:convertFolderToGit')
    if (!handler) {
      throw new Error('repos:convertFolderToGit handler was never registered')
    }
    return handler(null, args) as Promise<{ repo: Repo } | { error: string }>
  }

  beforeEach(async () => {
    handlers.clear()
    handleMock.mockReset()
    upgradeFolderRepoMock.mockReset()
    handleMock.mockImplementation((channel: string, handler: (...a: unknown[]) => unknown) => {
      handlers.set(channel, handler as (event: unknown, args: unknown) => unknown)
    })

    root = await mkdtemp(join(tmpdir(), 'nightshift-convert-folder-to-git-'))
    repo = {
      id: 'repo-1',
      path: root,
      displayName: 'repo-1',
      badgeColor: '#000',
      addedAt: Date.now(),
      kind: 'folder'
    } as Repo
    store = { getRepo: vi.fn((id: string) => (id === repo.id ? repo : undefined)) }

    registerRepoConvertFolderToGitHandler(mockWindow as never, store as never)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('rejects an unknown repo', async () => {
    expect(await call({ repoId: 'missing' })).toEqual({ error: 'Project not found' })
  })

  it('rejects a non-local (SSH) repo without touching git', async () => {
    repo.connectionId = 'ssh-1'
    const result = await call({ repoId: repo.id })
    expect(result).toMatchObject({ error: expect.stringContaining('local projects') })
    expect(upgradeFolderRepoMock).not.toHaveBeenCalled()
  })

  it('rejects a repo that is already git-kind', async () => {
    repo.kind = 'git'
    const result = await call({ repoId: repo.id })
    expect(result).toMatchObject({ error: expect.stringContaining('already a git repository') })
    expect(upgradeFolderRepoMock).not.toHaveBeenCalled()
  })

  it('rejects a folder whose path already has a .git dir, without touching it', async () => {
    execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' })
    const result = await call({ repoId: repo.id })
    expect(result).toMatchObject({ error: expect.stringContaining('already a git repository') })
    expect(upgradeFolderRepoMock).not.toHaveBeenCalled()
  })

  it('runs a real empty-commit git init, then converts via upgradeFolderRepo', async () => {
    upgradeFolderRepoMock.mockImplementation(async () => {
      repo.kind = 'git'
      return 'upgraded'
    })

    const result = await call({ repoId: repo.id })

    expect(
      execFileSync('git', ['log', '--oneline'], { cwd: root, encoding: 'utf-8' }).trim()
    ).toContain('Initial commit')
    expect(
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf-8' })
    ).toBe('')
    expect(upgradeFolderRepoMock).toHaveBeenCalledWith(
      { store, mainWindow: mockWindow, disposed: false },
      repo.id
    )
    expect(result).toEqual({ repo })
  })

  it('surfaces a clean error when the upgrade is blocked (e.g. extra folder workspaces), and removes the .git it just created', async () => {
    upgradeFolderRepoMock.mockResolvedValueOnce('blocked')
    const result = await call({ repoId: repo.id })
    expect(result).toEqual({ error: 'Could not finish converting this project to a git repository' })
    expect(existsSync(join(root, '.git'))).toBe(false)
  })

  it('surfaces a git init failure (missing directory) without calling upgradeFolderRepo', async () => {
    repo.path = join(root, 'does-not-exist')
    const result = await call({ repoId: repo.id })
    expect(result).toMatchObject({ error: expect.stringContaining('Failed to initialize') })
    expect(upgradeFolderRepoMock).not.toHaveBeenCalled()
  })
})
