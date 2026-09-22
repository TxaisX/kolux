import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')

// The release-cut.yml / release-mac-build.yml / unit-tests.yml / pr.yml /
// terminal-perf.yml / golden-e2e-experiment.yml / homebrew-bump.yml workflows
// this file used to contract-test were deleted at the fork split (only ci.yml
// and release.yml remain). This case is the only one that asserted real,
// still-live source rather than a deleted workflow.
describe('Electron runtime package contract: release workflows', () => {
  it('keeps Linux postinstall repairing Chromium sandbox permissions', () => {
    const afterInstallScript = readFileSync(
      join(projectDir, 'resources/linux/packaging/after-install.sh'),
      'utf8'
    )

    expect(afterInstallScript).toContain('chrome-sandbox')
    expect(afterInstallScript).toContain('chmod 4755 "$sandbox"')
    expect(afterInstallScript).not.toContain('chmod 0755 "$sandbox"')
    expect(afterInstallScript).toContain('is_owned_link()')
    expect(afterInstallScript).toContain('readlink -f -- "$link"')
    expect(afterInstallScript).toContain('[ ! -e "$link" ] && [ ! -L "$link" ]')
    expect(afterInstallScript).not.toContain('[ ! -e "$link" ] || [ -L "$link" ]')
  })
})
