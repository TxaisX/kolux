import { describe, expect, it, vi } from 'vitest'
import { readRepoKoluxDirFile } from './repo-kolux-dir-fallback'
import type { IFilesystemProvider } from '../providers/filesystem-provider-contract'

function makeEnoentError(): Error {
  const error = new Error('ENOENT: no such file') as NodeJS.ErrnoException
  error.code = 'ENOENT'
  return error
}

function makeProvider(files: Record<string, string>): Pick<IFilesystemProvider, 'readFile'> {
  return {
    readFile: vi.fn(async (filePath: string) => {
      const content = files[filePath]
      if (content === undefined) {
        throw makeEnoentError()
      }
      return { content, isBinary: false } as Awaited<ReturnType<IFilesystemProvider['readFile']>>
    })
  }
}

describe('readRepoKoluxDirFile', () => {
  it('reads under .kolux when present', async () => {
    const provider = makeProvider({ '/repo/.kolux/issue-command': 'gh issue view\n' })
    const result = await readRepoKoluxDirFile(
      provider as IFilesystemProvider,
      '/repo',
      'issue-command'
    )
    expect(result).toBe('gh issue view')
  })

  it('falls back to .nightshift when .kolux is absent', async () => {
    const provider = makeProvider({ '/repo/.nightshift/issue-command': 'gh issue view\n' })
    const result = await readRepoKoluxDirFile(
      provider as IFilesystemProvider,
      '/repo',
      'issue-command'
    )
    expect(result).toBe('gh issue view')
  })

  it('returns null when neither location exists', async () => {
    const provider = makeProvider({})
    const result = await readRepoKoluxDirFile(
      provider as IFilesystemProvider,
      '/repo',
      'issue-command'
    )
    expect(result).toBeNull()
  })
})
