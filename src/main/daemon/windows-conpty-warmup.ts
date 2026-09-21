import os from 'node:os'
import * as pty from 'node-pty'

const WARMUP_KILL_TIMEOUT_MS = 10_000

// Why module-level: a real spawn landing while the warm-up shell is still
// starting used to run its own concurrent, fully-redundant cold start of the
// SAME shell binary. `waitForWindowsConptyWarmup` lets that real spawn queue
// behind the one already-in-flight warm-up instead of racing it.
let warmupPromise: Promise<void> | null = null

// Why powershell.exe, not cmd.exe: resolvePtyShellPath's Windows default (see
// shell-ready.ts) is 'powershell.exe' -- that is what a plain new terminal
// actually launches. An earlier version of this warm-up spawned cmd.exe: cheap,
// but not the binary real spawns use, so it warmed the wrong process and the
// user's actual first terminal still paid the full cold-start cost itself
// (measured ~5s here vs ~70-100ms once warm). This does not attempt to guess
// pwsh.exe vs powershell.exe (that probe is itself a slow, best-effort child
// spawn -- see isPwshAvailable in ../pwsh.ts): on a machine where pwsh.exe is
// the resolved default this warms the wrong binary again, same as cmd.exe did,
// which is a wash, not a regression.
const WARMUP_SHELL = 'powershell.exe'

/**
 * Pays the one-time cost of the first spawn of the shell a plain new terminal
 * actually launches -- ConPTY native module load, plus (measured, not
 * assumed) Windows' first-execution cost for that binary -- at daemon boot
 * instead of on the user's first terminal.
 */
export function warmWindowsConptyOnce(spawnPty: typeof pty.spawn = pty.spawn): void {
  if (process.platform !== 'win32') {
    return
  }
  const promise = new Promise<void>((resolve) => {
    // Why: setImmediate keeps the ready/handshake path ahead of the warm-up; a
    // real spawn arriving first now awaits this same promise (see
    // getInFlightWindowsConptyWarmup) instead of paying its own redundant cost.
    setImmediate(() => {
      const settle = (): void => {
        // Why clear here: once settled, later callers should see "nothing to
        // wait for" (null), not an already-resolved promise that still costs
        // an await tick -- see getInFlightWindowsConptyWarmup.
        if (warmupPromise === promise) {
          warmupPromise = null
        }
        resolve()
      }
      try {
        const proc = spawnPty(WARMUP_SHELL, ['-NoLogo', '-NoProfile', '-Command', 'exit'], {
          name: 'xterm-256color',
          cols: 2,
          rows: 1,
          cwd: os.homedir(),
          env: process.env as Record<string, string>,
          // Match real terminal spawns so the bundled ConPTY binaries are the
          // ones warmed, not the legacy system ConPTY.
          useConptyDll: true
        })
        const killTimer = setTimeout(() => {
          try {
            proc.kill()
          } catch {
            /* best-effort cleanup of a stuck warm-up shell */
          }
        }, WARMUP_KILL_TIMEOUT_MS)
        killTimer.unref?.()
        proc.onExit(() => {
          clearTimeout(killTimer)
          settle()
        })
      } catch {
        /* warm-up is best-effort; real spawns surface their own errors */
        settle()
      }
    })
  })
  warmupPromise = promise
}

/**
 * The in-flight warm-up promise, or null when there is nothing to wait for
 * (non-Windows, warm-up already settled, or never scheduled). A real spawn
 * that lands while the warm-up is still starting its ConPTY awaits this
 * (when non-null) so it inherits the now-warm process state instead of
 * racing the warm-up for the same one-time cost. Returning null rather than
 * an already-resolved promise matters: callers only `await` when this is
 * non-null, so the overwhelmingly common already-settled case costs no extra
 * microtask tick (existing spawn-cancellation tests are sensitive to that).
 */
export function getInFlightWindowsConptyWarmup(): Promise<void> | null {
  return warmupPromise
}

/** Test seam: module state is module-level and can otherwise leak a
 *  never-settled warm-up (e.g. a fake-proc that never fires onExit) across
 *  test files sharing a worker. */
export function _resetWindowsConptyWarmupStateForTest(): void {
  warmupPromise = null
}
