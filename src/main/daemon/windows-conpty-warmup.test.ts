import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as pty from 'node-pty'
import {
  _resetWindowsConptyWarmupStateForTest,
  getInFlightWindowsConptyWarmup,
  warmWindowsConptyOnce
} from './windows-conpty-warmup'

function setPlatform(platform: NodeJS.Platform): () => void {
  const original = process.platform
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  return () => Object.defineProperty(process, 'platform', { configurable: true, value: original })
}

function flushImmediates(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

let restorePlatform: (() => void) | null = null
afterEach(() => {
  restorePlatform?.()
  restorePlatform = null
  vi.restoreAllMocks()
  // Why: module-level warm-up state (see windows-conpty-warmup.ts) would
  // otherwise leak a never-settled promise into other test files sharing this
  // worker -- e.g. the "never exits" test's fake proc never fires onExit.
  _resetWindowsConptyWarmupStateForTest()
})

function makeFakePty(): { proc: pty.IPty; fireExit: () => void } {
  let exitListener: (() => void) | null = null
  const proc = {
    pid: 4321,
    kill: vi.fn(),
    onExit: vi.fn((listener: () => void) => {
      exitListener = listener
      return { dispose: () => undefined }
    })
  } as unknown as pty.IPty
  return { proc, fireExit: () => exitListener?.() }
}

describe('warmWindowsConptyOnce', () => {
  it('is a no-op off Windows', async () => {
    restorePlatform = setPlatform('darwin')
    const spawnPty = vi.fn() as unknown as typeof pty.spawn

    warmWindowsConptyOnce(spawnPty)
    await flushImmediates()

    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('spawns a short-lived powershell.exe with the bundled ConPTY on Windows', async () => {
    restorePlatform = setPlatform('win32')
    const { proc, fireExit } = makeFakePty()
    const spawnPty = vi.fn(() => proc) as unknown as typeof pty.spawn

    warmWindowsConptyOnce(spawnPty)
    await flushImmediates()

    expect(spawnPty).toHaveBeenCalledTimes(1)
    const [file, args, options] = vi.mocked(spawnPty).mock.calls[0]
    // Why powershell.exe and not cmd.exe: it's resolvePtyShellPath's actual
    // Windows default (shell-ready.ts) -- the binary a plain new terminal
    // really launches, so warming it (not cmd.exe) is the point of this fix.
    expect(String(file).toLowerCase()).toContain('powershell')
    expect(args).toEqual(['-NoLogo', '-NoProfile', '-Command', 'exit'])
    expect(options).toMatchObject({ useConptyDll: true, cols: 2, rows: 1 })

    // A clean exit must not leave the kill timer to fire later.
    fireExit()
    expect(proc.kill).not.toHaveBeenCalled()
  })

  it('kills the warm-up shell if it never exits', async () => {
    restorePlatform = setPlatform('win32')
    vi.useFakeTimers()
    try {
      const { proc } = makeFakePty()
      const spawnPty = vi.fn(() => proc) as unknown as typeof pty.spawn

      warmWindowsConptyOnce(spawnPty)
      await vi.runOnlyPendingTimersAsync()
      vi.advanceTimersByTime(10_000)

      expect(proc.kill).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('swallows spawn failures', async () => {
    restorePlatform = setPlatform('win32')
    const spawnPty = vi.fn(() => {
      throw new Error('conpty unavailable')
    }) as unknown as typeof pty.spawn

    expect(() => warmWindowsConptyOnce(spawnPty)).not.toThrow()
    await flushImmediates()
  })
})

describe('getInFlightWindowsConptyWarmup', () => {
  it('returns null when no warm-up was ever scheduled (e.g. off Windows)', () => {
    restorePlatform = setPlatform('darwin')
    expect(getInFlightWindowsConptyWarmup()).toBeNull()
  })

  it('returns the in-flight promise while the warm-up shell is starting, then null once it settles', async () => {
    restorePlatform = setPlatform('win32')
    const { proc, fireExit } = makeFakePty()
    const spawnPty = vi.fn(() => proc) as unknown as typeof pty.spawn

    warmWindowsConptyOnce(spawnPty)
    await flushImmediates()

    // Still mid-warm-up: a real spawn checking this must get a promise to
    // queue behind, not null (which would make it race the warm-up).
    const inFlight = getInFlightWindowsConptyWarmup()
    expect(inFlight).not.toBeNull()

    let settled = false
    void inFlight?.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    fireExit()
    await inFlight
    expect(settled).toBe(true)
    // Once settled, later callers see "nothing to wait for" again.
    expect(getInFlightWindowsConptyWarmup()).toBeNull()
  })
})
