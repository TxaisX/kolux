import { EventEmitter } from 'node:events'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { runCodexLoginSession, type CodexLoginChild } from './codex-login-session'
import { registerCodexAccountsTestHomes, testState } from './service-test-harness'

vi.mock('../codex-cli/command', () => ({ resolveCodexCommand: () => 'codex' }))

describe('Codex login credential verification', () => {
  registerCodexAccountsTestHomes()

  function login(code: number, output = ''): Promise<void> {
    const child = new EventEmitter() as EventEmitter & CodexLoginChild
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = vi.fn(() => true)
    return runCodexLoginSession(testState.fakeHomeDir, {
      wslCommand: 'wsl.exe',
      killProcessTree: vi.fn(),
      spawn: () => {
        queueMicrotask(() => {
          ;(child.stderr as PassThrough).emit('data', Buffer.from(output))
          child.emit('close', code)
        })
        return child
      }
    })
  }

  it('reports incomplete browser authorization instead of ENOENT after an empty successful exit', async () => {
    await expect(login(0)).rejects.toThrow('Codex sign-in did not save account credentials.')
  })

  it.each(['{}', '{"tokens": {}}', 'unfinished json'])(
    'rejects invalid persisted credentials: %s',
    async (contents) => {
      writeFileSync(join(testState.fakeHomeDir, 'auth.json'), contents)
      await expect(login(0)).rejects.toThrow('Codex sign-in did not save account credentials.')
    }
  )

  it('never reflects authorization URLs or tokens from CLI output into errors', async () => {
    const result = login(1, 'https://auth.openai.com/authorize?code=secret-token\nsecret-token')
    await expect(result).rejects.toThrow('Codex login exited with code 1.')
    await expect(result).rejects.not.toThrow('secret-token')
  })
})
