import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetShellStartupEnvCache } from '../main/pty/shell-startup-env'
import { resolvePiSourceAgentDir } from './plugin-overlay-env'

describe('plugin overlay env source resolution', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'relay-plugin-overlay-env-'))
    __resetShellStartupEnvCache()
  })

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true })
    __resetShellStartupEnvCache()
  })

  it.skipIf(process.platform === 'win32')(
    'uses zsh startup exports before inherited public overlay env',
    () => {
      mkdirSync(join(homeDir, 'company-pi'), { recursive: true })
      writeFileSync(join(homeDir, '.zshrc'), 'export PI_CODING_AGENT_DIR="$HOME/company-pi"\n')

      const env = {
        HOME: homeDir,
        PI_CODING_AGENT_DIR: '/tmp/inherited-pi-overlay'
      }

      expect(resolvePiSourceAgentDir(env, '/bin/zsh', 'pi')).toBe(join(homeDir, 'company-pi'))
    }
  )

  it.skipIf(process.platform === 'win32')('resolves Prime from its independent env keys', () => {
    writeFileSync(
      join(homeDir, '.zshrc'),
      'export PRIME_AGENT_CODING_AGENT_DIR="$HOME/company-prime"\n'
    )

    expect(
      resolvePiSourceAgentDir(
        { HOME: homeDir, PRIME_AGENT_CODING_AGENT_DIR: '/tmp/inherited-prime' },
        '/bin/zsh',
        'prime-agent'
      )
    ).toBe(join(homeDir, 'company-prime'))
    expect(
      resolvePiSourceAgentDir(
        {
          HOME: homeDir,
          KOLUX_PRIME_AGENT_SOURCE_AGENT_DIR: '/remote/original-prime',
          PRIME_AGENT_CODING_AGENT_DIR: '/tmp/inherited-prime'
        },
        '/bin/zsh',
        'prime-agent'
      )
    ).toBe('/remote/original-prime')
  })
})
