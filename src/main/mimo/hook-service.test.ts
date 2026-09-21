import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setAppEnvironment } from '../../shared/app-environment'

const { getPathMock } = vi.hoisted(() => ({
  getPathMock: vi.fn<(name: string) => string>()
}))

import { MimoCodeHookService } from './hook-service'

describe('MimoCodeHookService buildPtyEnv', () => {
  let userDataDir: string
  let mimocodeHome: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'kolux-mimocode-userdata-'))
    getPathMock.mockImplementation((name) => {
      if (name === 'userData') {
        return userDataDir
      }
      throw new Error(`unexpected getPath: ${name}`)
    })
    setAppEnvironment({
      getPath: getPathMock,
      getAppPath: () => process.cwd(),
      getVersion: () => '0.0.0-test',
      isPackaged: () => false,
      onWillQuit: () => {},
      exit: () => {},
      getAppMetrics: () => []
    })

    mimocodeHome = mkdtempSync(join(tmpdir(), 'kolux-mimocode-home-'))
    const configDir = join(mimocodeHome, 'config')
    mkdirSync(join(configDir, 'plugins'), { recursive: true })
    writeFileSync(join(configDir, 'mimocode.json'), '{"theme":"dark"}')
    writeFileSync(join(configDir, 'plugins', 'user-plugin.js'), 'export default () => {}')
    writeFileSync(join(configDir, 'plugins', 'kolux-mimocode-status.js'), 'USER PLUGIN')
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(mimocodeHome, { recursive: true, force: true })
  })

  it('mirrors user config into shared overlay and installs Kolux status plugin', () => {
    const service = new MimoCodeHookService()
    const env = service.buildPtyEnv('pty-1', mimocodeHome)

    const overlayHome = join(userDataDir, 'mimocode-hooks', 'shared')
    expect(env.MIMOCODE_HOME).toBe(overlayHome)
    expect(readFileSync(join(overlayHome, 'config', 'mimocode.json'), 'utf8')).toBe(
      '{"theme":"dark"}'
    )
    expect(readFileSync(join(overlayHome, 'config', 'plugins', 'user-plugin.js'), 'utf8')).toBe(
      'export default () => {}'
    )

    const koluxPlugin = join(overlayHome, 'config', 'plugins', 'kolux-mimocode-status.js')
    expect(existsSync(koluxPlugin)).toBe(true)
    const pluginSource = readFileSync(koluxPlugin, 'utf8')
    expect(pluginSource).toContain('/hook/mimo-code')
    expect(pluginSource).not.toContain('post("SessionStart"')

    expect(
      readFileSync(join(mimocodeHome, 'config', 'plugins', 'kolux-mimocode-status.js'), 'utf8')
    ).toBe('USER PLUGIN')
  })

  it('reuses the overlay home on a second buildPtyEnv call', () => {
    const service = new MimoCodeHookService()
    const first = service.buildPtyEnv('pty-1', mimocodeHome)
    const second = service.buildPtyEnv('pty-2', mimocodeHome)

    const overlayHome = join(userDataDir, 'mimocode-hooks', 'shared')
    expect(first.MIMOCODE_HOME).toBe(overlayHome)
    expect(second.MIMOCODE_HOME).toBe(overlayHome)
    expect(
      readFileSync(join(overlayHome, 'config', 'plugins', 'kolux-mimocode-status.js'), 'utf8')
    ).toContain('/hook/mimo-code')
  })
})
