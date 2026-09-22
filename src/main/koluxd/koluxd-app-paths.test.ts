import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppPathName } from '../../shared/app-environment'
import {
  resolveKoluxdInstallRoot,
  resolveKoluxdPath,
  resolveUserDataPath
} from './koluxd-app-paths'

const ALL_PATH_NAMES: AppPathName[] = [
  'userData',
  'home',
  'appData',
  'temp',
  'downloads',
  'logs',
  'exe'
]

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value })
}

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.unstubAllEnvs()
})

describe('resolveUserDataPath', () => {
  it('prefers KOLUX_USER_DATA, then XDG_DATA_HOME, then ~/.kolux', () => {
    vi.stubEnv('KOLUX_USER_DATA', join(sep, 'srv', 'kolux-state'))
    vi.stubEnv('XDG_DATA_HOME', join(sep, 'xdg'))
    expect(resolveUserDataPath()).toBe(join(sep, 'srv', 'kolux-state'))

    vi.stubEnv('KOLUX_USER_DATA', '')
    expect(resolveUserDataPath()).toBe(join(sep, 'xdg', 'Kolux'))

    vi.stubEnv('XDG_DATA_HOME', '')
    expect(resolveUserDataPath()).toBe(join(homedir(), '.kolux'))
  })
})

describe('resolveKoluxdPath', () => {
  it('answers every path name without ever falling back to the data directory', () => {
    vi.stubEnv('KOLUX_USER_DATA', join(sep, 'srv', 'kolux-state'))
    const answers = new Map(ALL_PATH_NAMES.map((name) => [name, resolveKoluxdPath(name)]))

    for (const [name, answer] of answers) {
      expect(answer, `${name} answered nothing`).toBeTruthy()
      if (name !== 'userData') {
        // The catch-all this replaced returned the data directory for four of seven
        // names, 'exe' included — a data directory is not an executable.
        expect(answer, `${name} answered the userData directory`).not.toBe(
          join(sep, 'srv', 'kolux-state')
        )
      }
    }
  })

  it("answers 'exe' with the Node binary running this process", () => {
    expect(resolveKoluxdPath('exe')).toBe(process.execPath)
  })

  it("keeps 'logs' inside the data root so the whole deployment is one directory", () => {
    vi.stubEnv('KOLUX_USER_DATA', join(sep, 'srv', 'kolux-state'))
    expect(resolveKoluxdPath('logs')).toBe(join(sep, 'srv', 'kolux-state', 'logs'))
  })

  it("answers 'home' and 'temp' from the OS", () => {
    expect(resolveKoluxdPath('home')).toBe(homedir())
    expect(resolveKoluxdPath('temp')).toBe(tmpdir())
  })

  it("answers 'appData' with the per-user application-data root of each platform", () => {
    setPlatform('darwin')
    expect(resolveKoluxdPath('appData')).toBe(join(homedir(), 'Library', 'Application Support'))

    setPlatform('win32')
    vi.stubEnv('APPDATA', join('C:', 'Users', 'kolux', 'AppData', 'Roaming'))
    expect(resolveKoluxdPath('appData')).toBe(join('C:', 'Users', 'kolux', 'AppData', 'Roaming'))
    vi.stubEnv('APPDATA', '')
    expect(resolveKoluxdPath('appData')).toBe(join(homedir(), 'AppData', 'Roaming'))

    setPlatform('linux')
    vi.stubEnv('XDG_CONFIG_HOME', join(sep, 'xdg-config'))
    expect(resolveKoluxdPath('appData')).toBe(join(sep, 'xdg-config'))
    vi.stubEnv('XDG_CONFIG_HOME', '')
    expect(resolveKoluxdPath('appData')).toBe(join(homedir(), '.config'))
  })

  it("answers 'downloads' from XDG_DOWNLOAD_DIR before the home default", () => {
    vi.stubEnv('XDG_DOWNLOAD_DIR', join(sep, 'srv', 'incoming'))
    expect(resolveKoluxdPath('downloads')).toBe(join(sep, 'srv', 'incoming'))

    vi.stubEnv('XDG_DOWNLOAD_DIR', '')
    expect(resolveKoluxdPath('downloads')).toBe(join(homedir(), 'Downloads'))
  })
})

describe('resolveKoluxdInstallRoot', () => {
  it('is the directory holding the running bundle, not the working directory', () => {
    // Why resolve(), not join(sep, ...): `sep`-joined segments are drive-relative on
    // Windows, not absolute, so resolve() here mirrors the fully-qualified path the
    // function itself produces instead of asserting a POSIX-only shape.
    const scriptPath = resolve(sep, 'opt', 'kolux', 'koluxd.js')
    expect(resolveKoluxdInstallRoot(scriptPath)).toBe(dirname(scriptPath))
  })

  it('absolutizes a relative script path against the working directory', () => {
    expect(resolveKoluxdInstallRoot(join('out', 'koluxd', 'koluxd.js'))).toBe(
      join(process.cwd(), 'out', 'koluxd')
    )
  })

  it('refuses instead of guessing when the process has no main script', () => {
    const originalArgv = process.argv
    // `node -e` leaves argv[1] unset; cwd would be a guess, not an answer.
    process.argv = [process.execPath]
    try {
      expect(() => resolveKoluxdInstallRoot()).toThrow(/koluxd_install_root_unavailable/)
    } finally {
      process.argv = originalArgv
    }
  })
})
