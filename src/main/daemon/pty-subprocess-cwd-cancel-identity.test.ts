// A canceled cwd probe must leave the daemon as the one cancellation identity
// the wire carries. Clients key recovery off it, and an unrecognized message
// takes the rollback branch that closes a terminal the user still has (#7718).
import { describe, expect, it, vi } from 'vitest'
import type * as LocalPtyUtils from '../providers/local-pty-utils'

const {
  spawnMock,
  isPwshAvailableMock,
  validateWorkingDirectoryMock,
  validateWorkingDirectoryAsyncMock,
  resolveUnixShellPathMock,
  resolveAgentForegroundProcessMock
} = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  isPwshAvailableMock: vi.fn(),
  resolveUnixShellPathMock: vi.fn((shellPath: string) => shellPath),
  resolveAgentForegroundProcessMock: vi.fn(),
  validateWorkingDirectoryMock: vi.fn(),
  validateWorkingDirectoryAsyncMock: vi.fn()
}))

vi.mock('node-pty', () => ({ spawn: spawnMock }))
vi.mock('../pwsh', () => ({ isPwshAvailable: isPwshAvailableMock }))

vi.mock('../providers/local-pty-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof LocalPtyUtils>()
  return {
    ...actual,
    resolveUnixShellPath: resolveUnixShellPathMock,
    validateWorkingDirectory: validateWorkingDirectoryMock,
    validateWorkingDirectoryAsync: validateWorkingDirectoryAsyncMock
  }
})

vi.mock('../providers/agent-foreground-process', () => ({
  resolveAgentForegroundProcessWithAvailability: async (...args: unknown[]) => {
    const value = await resolveAgentForegroundProcessMock(...args)
    return value && typeof value === 'object' && 'available' in value
      ? value
      : { available: true, processName: value }
  }
}))

vi.mock('../providers/windows-pty-job-membership', () => ({
  readWindowsPtyJobProcessIds: () => new Set([12345]),
  isWindowsPtyJobReadable: () => true
}))

import { createPtySubprocess } from './pty-subprocess'
import { TerminalAttachCanceledError } from './daemon-errors'
import { WorkingDirectoryValidationAbortedError } from '../providers/working-directory-validation'
import { useDaemonPtySubprocessEnv } from './pty-subprocess-test-harness'

// Why platform-shaped: preflightPtySpawn only validates a POSIX-shaped cwd on win32 when it
// is a native Windows path (drive letter or UNC), so a bare '/Volumes/...' fixture would skip
// validation entirely there and never reach validateWorkingDirectoryAsync at all.
const deadCwd = process.platform === 'win32' ? 'C:\\Volumes\\dead\\repo' : '/Volumes/dead/repo'
const missingCwd = process.platform === 'win32' ? 'C:\\gone' : '/gone'

describe('createPtySubprocess cwd cancellation identity', () => {
  useDaemonPtySubprocessEnv({
    spawnMock,
    isPwshAvailableMock,
    resolveUnixShellPathMock,
    resolveAgentForegroundProcessMock,
    validateWorkingDirectoryMock
  })

  it('reports a canceled cwd probe as an attach cancellation, not a spawn failure', async () => {
    validateWorkingDirectoryAsyncMock.mockRejectedValue(
      new WorkingDirectoryValidationAbortedError(deadCwd)
    )
    const abort = new AbortController()
    abort.abort()

    await expect(
      createPtySubprocess({
        sessionId: 'canceled-cwd-session',
        cols: 80,
        rows: 24,
        cwd: deadCwd,
        cancelSignal: abort.signal
      })
    ).rejects.toThrow(TerminalAttachCanceledError)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('leaves a genuine missing-directory failure alone', async () => {
    validateWorkingDirectoryAsyncMock.mockRejectedValue(
      new Error(`Working directory "${missingCwd}" does not exist. It may have been deleted.`)
    )

    await expect(
      createPtySubprocess({
        sessionId: 'missing-cwd-session',
        cols: 80,
        rows: 24,
        cwd: missingCwd
      })
    ).rejects.toThrow(/does not exist/)
  })
})
