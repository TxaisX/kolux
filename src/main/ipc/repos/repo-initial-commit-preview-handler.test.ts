import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Repo } from '../../../shared/repo-types'

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: handleMock, removeHandler: vi.fn() } }))

import { registerRepoInitialCommitPreviewHandler } from './repo-initial-commit-preview-handler'

function gitInit(repoPath: string): void {
  execFileSync('git', ['init', '-q'], { cwd: repoPath, stdio: 'ignore' })
}

describe('repos:previewInitialCommit', () => {
  const handlers = new Map<string, (event: unknown, args: unknown) => unknown>()
  let root: string
  let repo: Repo
  let store: { getRepo: (id: string) => Repo | undefined }

  const call = (args: unknown): Promise<unknown> => {
    const handler = handlers.get('repos:previewInitialCommit')
    if (!handler) {
      throw new Error('repos:previewInitialCommit handler was never registered')
    }
    return Promise.resolve(handler(null, args))
  }

  beforeEach(async () => {
    handlers.clear()
    handleMock.mockReset()
    handleMock.mockImplementation((channel: string, handler: (...a: unknown[]) => unknown) => {
      handlers.set(channel, handler as (event: unknown, args: unknown) => unknown)
    })
    root = await mkdtemp(join(tmpdir(), 'kolux-preview-initial-commit-handler-'))
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
    registerRepoInitialCommitPreviewHandler(store as never)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('rejects a missing repoId', async () => {
    expect(await call({ repoId: '' })).toEqual({ error: 'repoId is required' })
  })

  it('rejects an unknown repo', async () => {
    expect(await call({ repoId: 'missing' })).toEqual({ error: 'Project not found' })
  })

  it('rejects a repo that is not local', async () => {
    repo.connectionId = 'ssh-1'
    expect(await call({ repoId: repo.id })).toMatchObject({
      error: expect.stringContaining('local projects')
    })
  })

  it('rejects a folder-kind repo (not yet a git repo)', async () => {
    repo.kind = 'folder'
    expect(await call({ repoId: repo.id })).toMatchObject({
      error: expect.stringContaining('not a git repository yet')
    })
  })

  it('returns the real preview for a valid local git repo', async () => {
    await writeFile(join(root, 'app.js'), 'noop')
    const result = await call({ repoId: repo.id })
    expect(result).toMatchObject({ files: [{ path: 'app.js' }], hasWarnings: false })
  })
})
