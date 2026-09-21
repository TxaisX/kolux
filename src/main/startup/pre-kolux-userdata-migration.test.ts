import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type * as NodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const busyFileState = vi.hoisted(() => ({ path: null as string | null }))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  // Why case-insensitive: the source deliberately walks both 'Nightshift' and 'nightshift'
  // candidate roots, which are the same physical directory/file on a case-insensitive
  // filesystem (Windows) — a real lock on the file is a lock regardless of which casing
  // reaches it, so the simulation must match that or it under-reports the lock on the
  // second (differently-cased) pass.
  const isBusy = (path: unknown): boolean =>
    busyFileState.path !== null &&
    typeof path === 'string' &&
    path.toLowerCase() === busyFileState.path.toLowerCase()
  const busyError = (): NodeJS.ErrnoException =>
    Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
  return {
    ...actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (isBusy(args[0])) {
        throw busyError()
      }
      return actual.renameSync(...args)
    },
    cpSync: (...args: Parameters<typeof actual.cpSync>) => {
      if (isBusy(args[0])) {
        throw busyError()
      }
      return actual.cpSync(...args)
    }
  }
})

import {
  migrateLegacyNightshiftUserData,
  translatedSymlinkTarget
} from './pre-kolux-userdata-migration'

describe('migrateLegacyNightshiftUserData', () => {
  let root: string
  let appDataDir: string
  let newUserData: string
  let homeDir: string

  beforeEach(() => {
    busyFileState.path = null
    root = mkdtempSync(join(tmpdir(), 'kolux-legacy-migration-'))
    appDataDir = join(root, 'AppData')
    newUserData = join(appDataDir, 'Kolux')
    homeDir = join(root, 'home')
    mkdirSync(appDataDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function writeOldUserData(): string {
    const oldUserData = join(appDataDir, 'Nightshift')
    mkdirSync(oldUserData, { recursive: true })
    writeFileSync(join(oldUserData, 'nightshift-data.json'), '{"settings":{}}')
    writeFileSync(join(oldUserData, 'nightshift-data.json.bak.1'), '{"settings":{}}')
    writeFileSync(join(oldUserData, 'nightshift-stats.json'), '{}')
    mkdirSync(join(oldUserData, 'profiles', 'p1'), { recursive: true })
    writeFileSync(join(oldUserData, 'profiles', 'p1', 'nightshift-data.json'), '{"p":1}')
    mkdirSync(join(oldUserData, 'codex-runtime-home', 'home'), { recursive: true })
    writeFileSync(
      join(oldUserData, 'codex-runtime-home', 'home', '.nightshift-managed-home'),
      'owner\n'
    )
    return oldUserData
  }

  it('old-only: renames files and directories into the new root', () => {
    writeOldUserData()

    migrateLegacyNightshiftUserData(newUserData, { homeDir })

    expect(readFileSync(join(newUserData, 'kolux-data.json'), 'utf-8')).toBe('{"settings":{}}')
    expect(existsSync(join(newUserData, 'kolux-data.json.bak.1'))).toBe(true)
    expect(existsSync(join(newUserData, 'kolux-stats.json'))).toBe(true)
    expect(readFileSync(join(newUserData, 'profiles', 'p1', 'kolux-data.json'), 'utf-8')).toBe(
      '{"p":1}'
    )
    expect(existsSync(join(newUserData, 'codex-runtime-home', 'home', '.kolux-managed-home'))).toBe(
      true
    )
    expect(existsSync(join(newUserData, '.kolux-legacy-rename-migration-complete'))).toBe(true)
  })

  it('both-present: never clobbers an existing new-side file', () => {
    const oldUserData = writeOldUserData()
    mkdirSync(newUserData, { recursive: true })
    writeFileSync(join(newUserData, 'kolux-data.json'), '{"already":"kolux"}')

    migrateLegacyNightshiftUserData(newUserData, { homeDir })

    expect(readFileSync(join(newUserData, 'kolux-data.json'), 'utf-8')).toBe('{"already":"kolux"}')
    // Old file untouched (never deleted), a sibling that wasn't already present did migrate.
    expect(existsSync(join(oldUserData, 'nightshift-data.json'))).toBe(true)
    expect(existsSync(join(newUserData, 'kolux-stats.json'))).toBe(true)
  })

  it('is idempotent: a second run is a no-op once the marker is written', () => {
    writeOldUserData()
    migrateLegacyNightshiftUserData(newUserData, { homeDir })
    const markerPath = join(newUserData, '.kolux-legacy-rename-migration-complete')
    const firstMarker = readFileSync(markerPath, 'utf-8')

    // Mutate the old dir after migration to prove a second run does nothing.
    writeFileSync(join(appDataDir, 'Nightshift', 'nightshift-devices.json'), '{}')
    migrateLegacyNightshiftUserData(newUserData, { homeDir })

    expect(readFileSync(markerPath, 'utf-8')).toBe(firstMarker)
    expect(existsSync(join(newUserData, 'kolux-devices.json'))).toBe(false)
  })

  it('crash-resume: a partial prior run (no marker) is safely resumed, not redone', () => {
    writeOldUserData()
    // Simulate a partial migration left by a crash: kolux-data.json already carried over,
    // but the rest of the tree (and the marker) never got written.
    mkdirSync(newUserData, { recursive: true })
    writeFileSync(join(newUserData, 'kolux-data.json'), '{"settings":{}}')

    migrateLegacyNightshiftUserData(newUserData, { homeDir })

    expect(existsSync(join(newUserData, 'kolux-stats.json'))).toBe(true)
    expect(existsSync(join(newUserData, '.kolux-legacy-rename-migration-complete'))).toBe(true)
  })

  it('locked-folder fallback: a file the old app still has open is skipped (not lost), retried later', () => {
    writeOldUserData()
    busyFileState.path = join(appDataDir, 'Nightshift', 'nightshift-stats.json')

    migrateLegacyNightshiftUserData(newUserData, { homeDir })

    // The busy file did not migrate, and nothing pretends it did.
    expect(existsSync(join(newUserData, 'kolux-stats.json'))).toBe(false)
    expect(existsSync(busyFileState.path)).toBe(true)
    // Because one entry failed, the whole run stays retryable: no completion marker yet.
    expect(existsSync(join(newUserData, '.kolux-legacy-rename-migration-complete'))).toBe(false)
    // Everything else that wasn't busy did migrate.
    expect(existsSync(join(newUserData, 'kolux-data.json'))).toBe(true)

    // Next launch: the lock is gone, so a retry finishes the job and writes the marker.
    busyFileState.path = null
    migrateLegacyNightshiftUserData(newUserData, { homeDir })
    expect(existsSync(join(newUserData, 'kolux-stats.json'))).toBe(true)
    expect(existsSync(join(newUserData, '.kolux-legacy-rename-migration-complete'))).toBe(true)
  })

  it('leaves user paths that merely contain the word "nightshift" untouched', () => {
    writeOldUserData()
    mkdirSync(join(appDataDir, 'Nightshift', 'profiles', 'p1', 'repos'), { recursive: true })
    // A repo display name / worktree path is user content, not a filename this migration owns.
    writeFileSync(
      join(appDataDir, 'Nightshift', 'profiles', 'p1', 'nightshift-workspaces-nightshift.txt'),
      'G:\\Dev\\nightshift-workspaces\\nightshift'
    )

    migrateLegacyNightshiftUserData(newUserData, { homeDir })

    const migratedPath = join(newUserData, 'profiles', 'p1', 'nightshift-workspaces-nightshift.txt')
    expect(existsSync(migratedPath)).toBe(true)
    expect(readFileSync(migratedPath, 'utf-8')).toBe('G:\\Dev\\nightshift-workspaces\\nightshift')
  })

  it('is fast when there is nothing to migrate: writes a marker without an old root', () => {
    migrateLegacyNightshiftUserData(newUserData, { homeDir })
    expect(existsSync(join(newUserData, '.kolux-legacy-rename-migration-complete'))).toBe(true)
  })

  it('carries ~/.nightshift into ~/.kolux under the supplied home', () => {
    mkdirSync(join(homeDir, '.nightshift'), { recursive: true })
    writeFileSync(join(homeDir, '.nightshift', 'keybindings.json'), '[]')

    migrateLegacyNightshiftUserData(newUserData, { homeDir })

    expect(readFileSync(join(homeDir, '.kolux', 'keybindings.json'), 'utf-8')).toBe('[]')
  })

  it('does nothing under a test runner without an explicit sandbox home', () => {
    writeOldUserData()

    migrateLegacyNightshiftUserData(newUserData)

    expect(existsSync(join(appDataDir, 'Nightshift', 'nightshift-data.json'))).toBe(true)
    expect(existsSync(newUserData)).toBe(false)
  })

  it('never migrates into a dev or E2E root, including ~/.nightshift', () => {
    writeOldUserData()
    mkdirSync(join(homeDir, '.nightshift'), { recursive: true })
    writeFileSync(join(homeDir, '.nightshift', 'keybindings.json'), '[]')

    migrateLegacyNightshiftUserData(join(appDataDir, 'kolux-dev'), { homeDir })

    expect(existsSync(join(homeDir, '.nightshift', 'keybindings.json'))).toBe(true)
    expect(existsSync(join(homeDir, '.kolux'))).toBe(false)
    expect(existsSync(join(appDataDir, 'Nightshift', 'nightshift-data.json'))).toBe(true)
  })
})

describe('translatedSymlinkTarget', () => {
  // Why: a relative symlink whose target names a sibling this migration itself renames must
  // point at the new-side name, or the recreated link dangles once the sibling is migrated.
  it('translates a bare relative target that matches a renamed basename', () => {
    expect(translatedSymlinkTarget('.nightshift-managed-home')).toBe('.kolux-managed-home')
  })

  it('translates every renamed segment of a multi-level relative target', () => {
    expect(translatedSymlinkTarget('../.nightshift-managed-home/nightshift-data.json')).toBe(
      '../.kolux-managed-home/kolux-data.json'
    )
    expect(translatedSymlinkTarget('..\\.nightshift-managed-home\\nightshift-stats.json')).toBe(
      '..\\.kolux-managed-home\\kolux-stats.json'
    )
  })

  it('leaves segments with no rename-map entry untouched', () => {
    expect(translatedSymlinkTarget('../profiles/p1/repo.txt')).toBe('../profiles/p1/repo.txt')
  })

  it('leaves an absolute target untouched', () => {
    expect(translatedSymlinkTarget('/Users/me/.nightshift-managed-home')).toBe(
      '/Users/me/.nightshift-managed-home'
    )
    expect(translatedSymlinkTarget('C:\\Users\\me\\.nightshift-managed-home')).toBe(
      'C:\\Users\\me\\.nightshift-managed-home'
    )
  })
})
