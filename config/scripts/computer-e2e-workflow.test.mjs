import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')

// computer-e2e.yml was deleted at the fork split (only ci.yml and release.yml
// remain), so the workflow-wiring cases this file used to cover are gone.
// These cases assert real, still-live source instead of that workflow.
describe('computer-use e2e workflow', () => {
  it('runs computer-use e2e files serially because they share desktop focus', () => {
    const config = readFileSync(join(projectDir, 'tests/e2e/vitest.config.ts'), 'utf8')

    expect(config).toContain('fileParallelism: false')
  })

  it('guards e2e source against fragile waits and Windows Calculator drift', () => {
    const driver = readFileSync(join(projectDir, 'tests/e2e/helpers/computer-driver.ts'), 'utf8')
    const cliDriver = readFileSync(
      join(projectDir, 'tests/e2e/helpers/computer-cli-driver.ts'),
      'utf8'
    )
    const windowsStoreE2e = readFileSync(
      join(projectDir, 'tests/e2e/computer-windows-store.e2e.ts'),
      'utf8'
    )

    expect(driver).not.toContain('await delay(3500)')
    expect(driver).toContain("await waitForComputerWindowTitle('gedit', fileName, 15000)")
    expect(cliDriver).toContain('KOLUX_DEV_USER_DATA_PATH')
    expect(cliDriver).toContain('kolux-computer-runtime-')
    expect(cliDriver).toContain('retryMissingRuntimeMetadata')
    expect(cliDriver).toContain('Could not read Kolux runtime metadata')
    expect(cliDriver).toContain("'serve', '--no-pairing', '--json'")

    expect(windowsStoreE2e).toContain("app.bundleId === 'ApplicationFrameHost'")
    expect(windowsStoreE2e).toContain("app.bundleId === 'win32calc'")
    expect(windowsStoreE2e).toContain('buttonIndex >= 0')
    expect(windowsStoreE2e).toContain('pane(?:\\s|$)/m')
    expect(windowsStoreE2e).toContain('String(clickIndex)')
    expect(windowsStoreE2e).not.toContain(
      "for (const buttonName of ['One', 'Plus', 'Two', 'Equals'])"
    )
  })

  it('runs deterministic macOS owner-loss benchmark cleanup coverage', () => {
    const benchmark = readFileSync(
      join(projectDir, 'config/scripts/macos-computer-helper-owner-loss-benchmark.mjs'),
      'utf8'
    )
    const cleanup = readFileSync(
      join(projectDir, 'config/scripts/macos-computer-helper-owner-loss-trial-cleanup.mjs'),
      'utf8'
    )

    expect(benchmark).toContain('spawnBenchmarkProcess(executable, [launcherDir]')
    expect(benchmark).toContain("stdio: ['ignore', stdoutDescriptor, stderrDescriptor]")
    expect(benchmark).toContain('cleanupOwnerLossTrial({')
    const parseIndex = benchmark.indexOf('parseBenchmarkTrialResult(serializedResult)')
    const cleanupIndex = benchmark.indexOf('cleanupOwnerLossTrial({')
    expect(parseIndex).toBeGreaterThanOrEqual(0)
    expect(cleanupIndex).toBeGreaterThanOrEqual(0)
    expect(parseIndex).toBeLessThan(cleanupIndex)
    expect(benchmark).toContain('trialCleanupSha256: artifactSha256(trialCleanupPath)')
    expect(cleanup).toContain('killRecordedAndMatchingProcesses(options.recordPath')
    expect(cleanup).toContain("signalValidatedProcessGroup(options.pid, options.marker, 'SIGKILL'")
  })
})
