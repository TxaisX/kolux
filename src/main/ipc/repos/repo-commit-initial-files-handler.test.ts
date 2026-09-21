/**
 * Real-git integration tests for repos:commitInitialFiles — the explicit opt-in that
 * stages and commits a folder-turned-git repo's real files (unlike repos:initGit, which
 * only ever creates an empty commit). Pins: refusal without acknowledging warnings,
 * the default .gitignore only ever gets written when one is missing, and node_modules
 * never lands in the commit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Repo } from '../../../shared/repo-types'

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock, removeHandler: vi.fn() }
}))
vi.mock('./repos-changed-notification', () => ({ notifyReposChanged: vi.fn() }))
vi.mock('../worktree-remote', () => ({ notifyWorktreesChanged: vi.fn() }))

import { registerRepoCommitInitialFilesHandler } from './repo-commit-initial-files-handler'
import { DEFAULT_GITIGNORE_CONTENT } from './initial-commit-defaults'

function gitInit(repoPath: string): void {
  execFileSync('git', ['init', '-q'], { cwd: repoPath, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoPath })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoPath })
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'Initial commit'], { cwd: repoPath })
}

function commitCount(repoPath: string): number {
  return Number.parseInt(
    execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: repoPath,
      encoding: 'utf-8'
    }).trim(),
    10
  )
}

function trackedFiles(repoPath: string): string[] {
  return execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], {
    cwd: repoPath,
    encoding: 'utf-8'
  })
    .split('\n')
    .filter(Boolean)
}

describe('repos:commitInitialFiles', () => {
  const handlers = new Map<string, (event: unknown, args: unknown) => unknown>()
  const mockWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } }
  let root: string
  let repo: Repo
  let store: { getRepo: (id: string) => Repo | undefined }

  const call = (args: unknown): Promise<{ repo: Repo } | { error: string }> => {
    const handler = handlers.get('repos:commitInitialFiles')
    if (!handler) {
      throw new Error('repos:commitInitialFiles handler was never registered')
    }
    return handler(null, args) as Promise<{ repo: Repo } | { error: string }>
  }

  beforeEach(async () => {
    handlers.clear()
    handleMock.mockReset()
    handleMock.mockImplementation((channel: string, handler: (...a: unknown[]) => unknown) => {
      handlers.set(channel, handler as (event: unknown, args: unknown) => unknown)
    })

    root = await mkdtemp(join(tmpdir(), 'kolux-commit-initial-files-'))
    gitInit(root)
    repo = {
      id: 'repo-1',
      path: root,
      displayName: 'repo-1',
      badgeColor: '#000',
      addedAt: Date.now(),
      kind: 'git'
    } as Repo
    store = { getRepo: (id) => (id === repo.id ? repo : undefined) }

    registerRepoCommitInitialFilesHandler(mockWindow as never, store as never)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('refuses an unknown repoId', async () => {
    const result = await call({ repoId: 'nope', writeDefaultGitignore: false })
    expect(result).toEqual({ error: 'Project not found' })
  })

  it('refuses a repo that is not a git repo yet', async () => {
    repo.kind = 'folder'
    const result = await call({ repoId: repo.id, writeDefaultGitignore: false })
    expect(result).toMatchObject({ error: expect.stringContaining('not a git repository yet') })
  })

  it('refuses to commit flagged files without acknowledgement, and commits nothing', async () => {
    await writeFile(join(root, 'id_rsa'), 'fake key')
    const result = await call({ repoId: repo.id, writeDefaultGitignore: false })
    expect(result).toEqual({ error: 'Review the flagged files before committing' })
    expect(commitCount(root)).toBe(1)
  })

  it('commits once acknowledged, writes the default .gitignore, and excludes node_modules', async () => {
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'dep.js'), 'noop')
    await writeFile(join(root, 'id_rsa'), 'fake key')
    await writeFile(join(root, 'app.js'), 'console.log(1)')

    const result = await call({
      repoId: repo.id,
      writeDefaultGitignore: true,
      acknowledgedWarnings: true
    })
    expect(result).toMatchObject({ repo: { id: repo.id } })
    expect(commitCount(root)).toBe(2)

    const files = trackedFiles(root)
    expect(files).toContain('app.js')
    expect(files).toContain('id_rsa')
    expect(files).toContain('.gitignore')
    expect(files.some((f) => f.startsWith('node_modules'))).toBe(false)
    expect(await readFile(join(root, '.gitignore'), 'utf-8')).toBe(DEFAULT_GITIGNORE_CONTENT)
  })

  it('never overwrites an existing .gitignore', async () => {
    await writeFile(join(root, '.gitignore'), 'my-custom-rule\n')
    await writeFile(join(root, 'app.js'), 'noop')

    const result = await call({ repoId: repo.id, writeDefaultGitignore: true })
    expect(result).toMatchObject({ repo: { id: repo.id } })
    expect(await readFile(join(root, '.gitignore'), 'utf-8')).toBe('my-custom-rule\n')
  })

  it('commits without acknowledgement when there are no warnings', async () => {
    await writeFile(join(root, 'app.js'), 'noop')
    const result = await call({ repoId: repo.id, writeDefaultGitignore: false })
    expect(result).toMatchObject({ repo: { id: repo.id } })
    expect(commitCount(root)).toBe(2)
  })

  it('reports a clean error when there is nothing to commit', async () => {
    const result = await call({ repoId: repo.id, writeDefaultGitignore: false })
    expect(result).toEqual({ error: 'There are no files to commit' })
    expect(existsSync(join(root, '.gitignore'))).toBe(false)
  })
})
