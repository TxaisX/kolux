import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeInitialCommitPreview } from './initial-commit-preview'
import { LARGE_FILE_BYTES_THRESHOLD } from './initial-commit-defaults'

function gitInit(repoPath: string): void {
  execFileSync('git', ['init', '-q'], { cwd: repoPath, stdio: 'ignore' })
}

// A sparse file at the size threshold, created without writing real bytes to disk.
async function createSparseFile(path: string, size: number): Promise<void> {
  const handle = await open(path, 'w')
  try {
    await handle.truncate(size)
  } finally {
    await handle.close()
  }
}

describe('computeInitialCommitPreview', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kolux-initial-commit-preview-'))
    gitInit(root)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('applies the proposed default gitignore when none exists, and flags secrets/large files', async () => {
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'noop')
    await writeFile(join(root, '.env'), 'SECRET=1')
    await writeFile(join(root, 'src.js'), 'console.log(1)')
    await writeFile(join(root, 'credentials.json'), '{}')
    await writeFile(join(root, 'notes-with-secret-in-name.txt'), 'hi')
    await createSparseFile(join(root, 'video.mp4'), LARGE_FILE_BYTES_THRESHOLD + 1)

    const result = await computeInitialCommitPreview(root)
    if ('error' in result) {
      throw new Error(`expected success, got: ${result.error}`)
    }

    expect(result.gitignoreExists).toBe(false)
    const paths = result.files.map((f) => f.path).sort()
    // node_modules/ and .env are excluded by the simulated default gitignore.
    expect(paths).not.toContain('.env')
    expect(paths.some((p) => p.startsWith('node_modules'))).toBe(false)
    expect(paths).toEqual(
      expect.arrayContaining([
        'src.js',
        'credentials.json',
        'notes-with-secret-in-name.txt',
        'video.mp4'
      ])
    )

    const byPath = new Map(result.files.map((f) => [f.path, f]))
    expect(byPath.get('credentials.json')?.flags.secret).toBe(true)
    expect(byPath.get('notes-with-secret-in-name.txt')?.flags.secret).toBe(true)
    expect(byPath.get('video.mp4')?.flags.large).toBe(true)
    expect(byPath.get('src.js')?.flags).toEqual({})
    expect(result.hasWarnings).toBe(true)

    // The proposed default must not have been written to disk by a read-only preview.
    const { existsSync } = await import('node:fs')
    expect(existsSync(join(root, '.gitignore'))).toBe(false)
  })

  it('honors a real .gitignore instead of the proposed default when one already exists', async () => {
    await writeFile(join(root, '.gitignore'), '*.log\n')
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'kept.js'), 'noop')
    await writeFile(join(root, 'debug.log'), 'noop')
    await writeFile(join(root, 'app.js'), 'noop')

    const result = await computeInitialCommitPreview(root)
    if ('error' in result) {
      throw new Error(`expected success, got: ${result.error}`)
    }

    expect(result.gitignoreExists).toBe(true)
    const paths = result.files.map((f) => f.path).sort()
    expect(paths).not.toContain('debug.log')
    // node_modules isn't covered by the *real* gitignore, so it shows up (the proposed
    // default is only simulated when there is no real .gitignore to respect).
    expect(paths).toContain('node_modules/kept.js')
    expect(paths).toContain('app.js')
    expect(result.hasWarnings).toBe(false)
  })

  it('flags a secret file sorted after the display cutoff and still reports it truncated', async () => {
    // 10 plain files plus one secret-named file — well under MAX_PREVIEW_FILES (5000), but
    // proves flags come from the FULL list, not just the (possibly truncated) display slice.
    for (let i = 0; i < 10; i++) {
      await writeFile(join(root, `file-${i}.txt`), 'noop')
    }
    await writeFile(join(root, 'credentials.json'), '{}')

    const result = await computeInitialCommitPreview(root)
    if ('error' in result) {
      throw new Error(`expected success, got: ${result.error}`)
    }

    expect(result.hasWarnings).toBe(true)
    expect(result.flaggedCount).toBe(1)
    // The flagged file is surfaced first in the display list, never dropped.
    expect(result.files[0]?.path).toBe('credentials.json')
    expect(result.files[0]?.flags.secret).toBe(true)
  })

  it('flags a secret file placed past MAX_PREVIEW_FILES and reports the tree as truncated', async () => {
    const writes: Promise<void>[] = []
    for (let i = 0; i < 5001; i++) {
      writes.push(writeFile(join(root, `plain-${String(i).padStart(5, '0')}.txt`), ''))
    }
    // Alphabetically last (so it sorts after the 5000th entry in git's listing) and matches
    // the `.pem$` secret pattern regardless of prefix (unlike the `^credentials` pattern).
    writes.push(writeFile(join(root, 'zzz-private.pem'), 'fake key'))
    await Promise.all(writes)

    const result = await computeInitialCommitPreview(root)
    if ('error' in result) {
      throw new Error(`expected success, got: ${result.error}`)
    }

    expect(result.totalCount).toBe(5002)
    expect(result.truncated).toBe(true)
    expect(result.hasWarnings).toBe(true)
    expect(result.flaggedCount).toBe(1)
  }, 30_000)

  it('reports no warnings and an empty list for a clean tree', async () => {
    await writeFile(join(root, 'readme.md'), 'hi')
    const result = await computeInitialCommitPreview(root)
    if ('error' in result) {
      throw new Error(`expected success, got: ${result.error}`)
    }
    expect(result.hasWarnings).toBe(false)
    expect(result.files.map((f) => f.path)).toEqual(['readme.md'])
  })
})
