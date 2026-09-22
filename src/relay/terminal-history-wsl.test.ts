import { describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import type * as NodeOs from 'node:os'
import { join } from 'node:path'
import { hashWorktreeId } from '../main/terminal-history-id'

const FAKE_RELAY_HOME = 'C:\\Users\\relay'

// Why mocked rather than a real temp dir: the assertion is the Windows -> Linux
// path conversion, which only happens for a drive-letter root that cannot exist
// on the macOS/Linux runners this suite executes on.
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeOs>()),
  homedir: () => FAKE_RELAY_HOME
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  const dirStat = { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false }
  const fileStat = {
    isSymbolicLink: () => false,
    isDirectory: () => false,
    isFile: () => true,
    dev: 1n,
    ino: 2n
  }
  return {
    ...actual,
    constants: actual.constants,
    mkdirSync: vi.fn(),
    lstatSync: vi.fn((path: string) => (path.endsWith('terminal-history') ? dirStat : fileStat)),
    openSync: vi.fn(() => 42),
    fstatSync: vi.fn(() => fileStat),
    closeSync: vi.fn(),
    unlinkSync: vi.fn()
  }
})

const worktreeId = 'relay-wsl::/remote/worktree'
// Why join(), not a hardcoded separator: the module builds this root with the test
// runner's own host-native path.join, so the expectation has to match that, not a
// POSIX-only literal (this suite's fake homedir is Windows-shaped on purpose).
const historyRoot = join(FAKE_RELAY_HOME, '.kolux-remote', 'terminal-history')

describe('relay WSL shell history', () => {
  it('hands the guest a drvfs path for the host history file', async () => {
    const { injectRelayHistoryEnv } = await import('./terminal-history')
    const env: Record<string, string> = {}

    const root = injectRelayHistoryEnv(env, worktreeId, 'C:\\Windows\\System32\\wsl.exe', {
      wsl: true
    })

    expect(root).toBe(historyRoot)
    expect(env.HISTFILE).toBe(
      `/mnt/c/Users/relay/.kolux-remote/terminal-history/${hashWorktreeId(worktreeId)}-bash_history`
    )
    expect(env.KOLUX_HISTFILE).toBe(env.HISTFILE)
  })

  it('leaves a host shell on the untranslated host path', async () => {
    const { injectRelayHistoryEnv } = await import('./terminal-history')
    const env: Record<string, string> = {}

    injectRelayHistoryEnv(env, worktreeId, '/bin/bash')

    expect(env.HISTFILE).toBe(join(historyRoot, `${hashWorktreeId(worktreeId)}-bash_history`))
  })

  it('scopes nothing for wsl.exe when the caller does not flag it as WSL', async () => {
    const { injectRelayHistoryEnv } = await import('./terminal-history')
    const env: Record<string, string> = {}

    expect(injectRelayHistoryEnv(env, worktreeId, 'wsl.exe')).toBeNull()
    expect(env.HISTFILE).toBeUndefined()
  })
})
