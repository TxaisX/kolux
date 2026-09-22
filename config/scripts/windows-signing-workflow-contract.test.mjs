import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')

// The release-cut.yml / windows-signing-rehearsal.yml SignPath CI pipeline this
// file used to contract-test was deleted at the fork split (only ci.yml and
// release.yml remain). electron-builder.config.cjs still wires a sign hook for
// it, so that wiring is the one thing left worth asserting here.
describe('Windows NSIS uninstaller signing', () => {
  it('wires the electron-builder sign hook that the relay depends on', () => {
    const require = createRequire(import.meta.url)
    const configPath = resolve(projectDir, 'config/electron-builder.config.cjs')
    delete require.cache[require.resolve(configPath)]
    const config = require(configPath)

    expect(typeof config.win.signtoolOptions.sign).toBe('function')
    delete require.cache[require.resolve(configPath)]
  })
})
