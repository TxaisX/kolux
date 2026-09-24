import { describe, expect, it, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mirrorEntry } from '../pty/overlay-mirror'
import { cleanupRetiredOpenCodeUserData } from './retired-opencode-cleanup'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}

describe('cleanupRetiredOpenCodeUserData', () => {
  it('removes the three retired leftovers, never follows a junction/symlink into an outside dir, and is a no-op on the second run', () => {
    const userDataDir = makeTempDir('kolux-retired-opencode-userdata-')
    // A dir fully outside userData — this is what the safety guarantee protects, analogous
    // to the user's real ~/.config/opencode that this cleanup must never touch.
    const sentinelDir = makeTempDir('kolux-retired-opencode-sentinel-')
    const sentinelFile = join(sentinelDir, 'do-not-delete.txt')
    writeFileSync(sentinelFile, 'sentinel')

    const hooksDir = join(userDataDir, 'opencode-hooks')
    mkdirSync(hooksDir, { recursive: true })
    writeFileSync(join(hooksDir, 'plugin.js'), 'hook plugin')

    const overlaysDir = join(userDataDir, 'opencode-config-overlays')
    mkdirSync(overlaysDir, { recursive: true })
    writeFileSync(join(overlaysDir, 'manifest.json'), '{}')
    // Junction on Windows, symlink elsewhere — same mechanism the real overlay used to mirror
    // a source dir. safeRemoveTree must unlink this link, never descend into what it targets.
    mirrorEntry(sentinelDir, join(overlaysDir, 'source-link'))

    const usageFile = join(userDataDir, 'kolux-opencode-usage.json')
    writeFileSync(usageFile, '{"sessions":[]}')

    cleanupRetiredOpenCodeUserData(userDataDir)

    expect(existsSync(hooksDir)).toBe(false)
    expect(existsSync(overlaysDir)).toBe(false)
    expect(existsSync(usageFile)).toBe(false)
    // The sentinel dir and its file survive untouched — the junction was unlinked, not followed.
    expect(existsSync(sentinelDir)).toBe(true)
    expect(readFileSync(sentinelFile, 'utf-8')).toBe('sentinel')

    const markerPath = join(userDataDir, '.kolux-retired-opencode-cleanup-complete')
    expect(existsSync(markerPath)).toBe(true)
    const markerContents = readFileSync(markerPath, 'utf-8')

    // Second run: recreate a leftover to prove the marker short-circuits the whole scan
    // rather than the no-op just meaning "nothing was left to find".
    writeFileSync(usageFile, '{"sessions":["should survive"]}')
    cleanupRetiredOpenCodeUserData(userDataDir)

    expect(existsSync(usageFile)).toBe(true)
    expect(readFileSync(markerPath, 'utf-8')).toBe(markerContents)
  })

  it('is a no-op when none of the retired leftovers exist', () => {
    const userDataDir = makeTempDir('kolux-retired-opencode-userdata-empty-')

    expect(() => cleanupRetiredOpenCodeUserData(userDataDir)).not.toThrow()
    expect(existsSync(join(userDataDir, '.kolux-retired-opencode-cleanup-complete'))).toBe(true)
  })
})
