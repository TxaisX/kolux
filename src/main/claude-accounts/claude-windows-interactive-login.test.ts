import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { restorePlatform, setPlatform } from './claude-account-service-test-harness'

vi.mock('../codex-cli/command', () => ({
  resolveClaudeCommand: vi.fn(() => 'C:\\Tools\\claude.exe')
}))

const configDir = { windowsPath: 'C:\\tmp\\claude-auth', linuxPath: null, wslDistro: null }

function createLoginChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
    pid: 0
  })
}

describe('Claude Windows host browser login', () => {
  afterEach(() => {
    restorePlatform()
    vi.useRealTimers()
    vi.doUnmock('node:child_process')
  })

  it('keeps browser callback stdin open and captures output without a console window', async () => {
    setPlatform('win32')
    vi.resetModules()
    const child = createLoginChild()
    const spawnMock = vi.fn(() => child)
    vi.doMock('node:child_process', () => ({ spawn: spawnMock }))
    const { runClaudeCommandProcess } = await import('./claude-command-process')
    const login = runClaudeCommandProcess(['auth', 'login', '--claudeai'], configDir, 1000, {
      keepStdinOpen: true
    })
    expect(child.stdin.destroyed).toBe(false)
    expect(spawnMock).toHaveBeenCalledWith(
      'C:\\Tools\\claude.exe',
      ['auth', 'login', '--claudeai'],
      expect.objectContaining({
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: expect.objectContaining({ CLAUDE_CONFIG_DIR: configDir.windowsPath })
      })
    )
    child.emit('exit', 0)
    await expect(login).resolves.toBe('')
    expect(child.stdin.destroyed).toBe(true)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('times out browser authorization that never completes', async () => {
    setPlatform('win32')
    vi.resetModules()
    vi.useFakeTimers()
    const child = createLoginChild()
    vi.doMock('node:child_process', () => ({ spawn: vi.fn(() => child) }))
    const { runClaudeCommandProcess } = await import('./claude-command-process')
    const login = runClaudeCommandProcess(['auth', 'login', '--claudeai'], configDir, 1000)
    const rejection = expect(login).rejects.toThrow('Claude sign-in took too long to finish.')
    await vi.advanceTimersByTimeAsync(3000)
    await rejection
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('does not put authorization URLs or codes into failed login errors', async () => {
    setPlatform('win32')
    vi.resetModules()
    const child = createLoginChild()
    vi.doMock('node:child_process', () => ({ spawn: vi.fn(() => child) }))
    const { runClaudeCommandProcess } = await import('./claude-command-process')
    const login = runClaudeCommandProcess(['auth', 'login', '--claudeai'], configDir, 1000)
    child.stderr.write('https://claude.ai/oauth/authorize?code=secret-token')
    child.emit('exit', 1)
    await expect(login).rejects.toThrow(
      'Claude sign-in did not complete. Please try again in your browser.'
    )
    await expect(login).rejects.not.toThrow('secret-token')
  })
})
