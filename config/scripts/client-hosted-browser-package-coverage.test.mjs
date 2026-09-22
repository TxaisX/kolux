import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')

describe('client-hosted browser package coverage', () => {
  it('bundles the WSL browser-network relay with its version stamp', () => {
    const relayBuild = readFileSync(join(projectDir, 'config/scripts/build-relay.mjs'), 'utf8')

    expect(relayBuild).toContain("outfile: join(outDir, 'wsl-browser-network-relay.js')")
    expect(relayBuild).toContain("join(outDir, '.browser-network-version')")
  })
})
