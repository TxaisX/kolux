import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type * as NodeOs from 'node:os'
import {
  createRateLimits,
  createCodexAuthJson,
  createRuntimeHome,
  createSettings,
  createStore,
  registerCodexAccountsTestHomes,
  testState
} from './service-test-harness'

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.userDataDir
  }
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('node:os')
  return {
    ...actual,
    homedir: () => testState.fakeHomeDir
  }
})

describe('Codex Windows host browser login', () => {
  registerCodexAccountsTestHomes()

  it('runs browser login hidden with isolated file credentials and captured output', async () => {
    vi.resetModules()
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough
      stderr: PassThrough
      kill: ReturnType<typeof vi.fn>
      pid: number
    }
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = vi.fn()
    child.pid = 4242
    const spawnMock = vi.fn(() => {
      writeFileSync(
        join(testState.fakeHomeDir, 'auth.json'),
        createCodexAuthJson('account@example.com', 'account-1', 'refresh-token')
      )
      queueMicrotask(() => child.emit('close', 0))
      return child
    })
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn(),
      spawn: spawnMock
    }))
    vi.doMock('../codex-cli/command', () => ({
      resolveCodexCommand: () => 'C:\\Tools\\codex.exe'
    }))

    try {
      const { CodexAccountService } = await import('./service')
      const service = new CodexAccountService(
        createStore(createSettings()) as never,
        createRateLimits() as never,
        createRuntimeHome() as never
      )
      await (
        service as unknown as {
          runCodexLogin(managedHomePath: string): Promise<void>
        }
      ).runCodexLogin(testState.fakeHomeDir)

      expect(spawnMock).toHaveBeenCalledWith(
        'C:\\Tools\\codex.exe',
        ['login', '-c', 'cli_auth_credentials_store="file"'],
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          env: expect.objectContaining({ CODEX_HOME: testState.fakeHomeDir })
        })
      )
      expect(child.kill).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform)
      vi.doUnmock('node:child_process')
      vi.doUnmock('../codex-cli/command')
    }
  })
})
