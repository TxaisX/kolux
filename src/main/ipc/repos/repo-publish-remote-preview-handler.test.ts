import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Repo } from '../../../shared/repo-types'

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: handleMock, removeHandler: vi.fn() } }))

import { registerRepoPublishRemotePreviewHandler } from './repo-publish-remote-preview-handler'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' })
}

describe('repos:previewPublish', () => {
  const handlers = new Map<string, (event: unknown, args: unknown) => unknown>()
  let root: string
  let repo: Repo
  let store: { getRepo: (id: string) => Repo | undefined }

  const call = (args: unknown): Promise<unknown> => {
    const handler = handlers.get('repos:previewPublish')
    if (!handler) {
      throw new Error('repos:previewPublish handler was never registered')
    }
    return Promise.resolve(handler(null, args))
  }

  beforeEach(async () => {
    handlers.clear()
    handleMock.mockReset()
    handleMock.mockImplementation((channel: string, handler: (...a: unknown[]) => unknown) => {
      handlers.set(channel, handler as (event: unknown, args: unknown) => unknown)
    })
    root = await mkdtemp(join(tmpdir(), 'kolux-preview-publish-'))
    git(['init', '-q'], root)
    git(['config', 'user.email', 'test@example.com'], root)
    git(['config', 'user.name', 'Test'], root)
    git(['commit', '--allow-empty', '-q', '-m', 'Initial commit'], root)
    repo = {
      id: 'repo-1',
      path: root,
      displayName: 'repo-1',
      badgeColor: '#000',
      addedAt: Date.now(),
      kind: 'git'
    } as Repo
    store = { getRepo: (id) => (id === repo.id ? repo : undefined) }
    registerRepoPublishRemotePreviewHandler(store as never)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('returns commit and file counts for a repo with no remote', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(root, 'a.js'), 'x')
    await writeFile(join(root, 'b.js'), 'y')
    git(['add', '-A'], root)
    git(['commit', '-q', '-m', 'add files'], root)

    const result = await call({ repoId: repo.id })
    expect(result).toEqual({ commitCount: 2, fileCount: 2 })
  })

  it('refuses when a remote is already configured', async () => {
    git(['remote', 'add', 'origin', 'https://example.com/owner/repo.git'], root)
    const result = await call({ repoId: repo.id })
    expect(result).toMatchObject({ error: expect.stringContaining('already published') })
  })

  it('rejects a non-local repo', async () => {
    repo.connectionId = 'ssh-1'
    const result = await call({ repoId: repo.id })
    expect(result).toMatchObject({ error: expect.stringContaining('local projects') })
  })
})
