import { describe, expect, it, vi } from 'vitest'
import { readRepoConfigYaml } from './repo-config-yaml-fallback'
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

describe('readRepoConfigYaml', () => {
  it('reads kolux.yaml when present', async () => {
    const provider = makeProvider({ '/repo/kolux.yaml': 'scripts: {}\n' })
    const result = await readRepoConfigYaml(provider as IFilesystemProvider, '/repo')
    expect(result?.content).toBe('scripts: {}\n')
  })

  it('falls back to nightshift.yaml when kolux.yaml is missing', async () => {
    const provider = makeProvider({ '/repo/nightshift.yaml': 'scripts: {}\n' })
    const result = await readRepoConfigYaml(provider as IFilesystemProvider, '/repo')
    expect(result?.content).toBe('scripts: {}\n')
  })

  it('returns null when neither file exists', async () => {
    const provider = makeProvider({})
    const result = await readRepoConfigYaml(provider as IFilesystemProvider, '/repo')
    expect(result).toBeNull()
  })

  it('rethrows a non-ENOENT error from the primary read without falling back', async () => {
    const provider: Pick<IFilesystemProvider, 'readFile'> = {
      readFile: vi.fn(async () => {
        throw new Error('boom')
      })
    }
    await expect(readRepoConfigYaml(provider as IFilesystemProvider, '/repo')).rejects.toThrow(
      'boom'
    )
  })
})
