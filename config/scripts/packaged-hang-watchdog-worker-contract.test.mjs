import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Why no PR-workflow wiring case here: pr.yml was deleted at the fork split
// (only ci.yml and release.yml remain), so this only asserts the smoke
// script's own source, not how a workflow invokes it.
describe('packaged hang watchdog worker contract', () => {
  it('boots the worker from app.asar', () => {
    const smokeSource = readFileSync(
      'config/scripts/smoke-packaged-hang-watchdog-worker.mjs',
      'utf8'
    )

    expect(smokeSource).toContain(
      "process.platform === 'linux' ? ['--no-sandbox', launcherDir] : [launcherDir]"
    )
    expect(smokeSource).toContain('const LAUNCH_TIMEOUT_MS = 30_000')
    expect(smokeSource).toContain('timeout: LAUNCH_TIMEOUT_MS')
  })

  // Why: Electron ignores process.exitCode, so the gate needs app.exit plus a stdout assertion.
  it('fails the smoke when the packaged worker never reports success', () => {
    const smokeSource = readFileSync(
      'config/scripts/smoke-packaged-hang-watchdog-worker.mjs',
      'utf8'
    )

    expect(smokeSource).toContain('app.exit(1)')
    expect(smokeSource).not.toContain('app.quit()')
    expect(smokeSource).toContain('if (!result.stdout.includes(SUCCESS_LINE))')
  })
})
