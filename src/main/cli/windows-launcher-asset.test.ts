import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('packaged Windows CLI launcher asset', () => {
  it('keeps the batch compatibility shim behind the newline-safe native launcher', () => {
    const launcherPath = join(process.cwd(), 'resources', 'win32', 'bin', 'kolux.cmd')
    const launcher = readFileSync(launcherPath, 'utf8')

    expect(launcher).toContain('set "LAUNCHER=%SCRIPT_DIR%kolux.exe"')
    expect(launcher).toContain('kolux.cmd cannot safely forward orchestration message bodies')
    expect(launcher).not.toContain('"%ELECTRON%" "%CLI%" %*')
  })

  it('marks the packaged child and propagates its exact exit status', () => {
    const sourcePath = join(process.cwd(), 'native', 'windows-cli-launcher', 'KoluxCliLauncher.cs')
    const source = readFileSync(sourcePath, 'utf8')

    // Why: the marker and command name must ride the launcher's own environment, never
    // ProcessStartInfo's case-insensitive copy of a PATH/Path block (TxaisX/kolux#12046).
    expect(source).toContain(
      'Environment.SetEnvironmentVariable("KOLUX_WINDOWS_PACKAGED_CLI_LAUNCHER", "1");'
    )
    expect(source).toContain(
      'string requestedCliCommand = Environment.GetEnvironmentVariable("KOLUX_CLI_COMMAND");'
    )
    expect(source).toContain('requestedCliCommand == "kolux-ide" ? "kolux-ide" : "kolux"')
    expect(source).toContain('child.WaitForExit();')
    expect(source).toContain('return child.ExitCode;')
  })
})
