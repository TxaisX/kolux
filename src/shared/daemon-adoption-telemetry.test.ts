import { describe, expect, it } from 'vitest'
import { classifyDaemonPtyCwd, classifyDaemonSpawnerPath } from './daemon-adoption-telemetry'
import { eventSchemas } from './telemetry-event-registry'

describe('classifyDaemonSpawnerPath', () => {
  const alwaysExists = () => true

  it('classifies the installed app, the ShipIt staging area, and everything else', () => {
    expect(
      classifyDaemonSpawnerPath('/Applications/Kolux.app/Contents/MacOS/Kolux', alwaysExists)
    ).toBe('applications')
    expect(
      classifyDaemonSpawnerPath(
        '/private/Applications/Kolux.app/Contents/MacOS/Kolux',
        alwaysExists
      )
    ).toBe('applications')
    expect(
      classifyDaemonSpawnerPath(
        '/Users/a/Library/Caches/com.txais.kolux.ShipIt/update.abc/Kolux.app/Contents/MacOS/Kolux',
        alwaysExists
      )
    ).toBe('updater-cache')
    expect(
      classifyDaemonSpawnerPath(
        '/Users/a/Applications/Kolux.app/Contents/MacOS/Kolux',
        alwaysExists
      )
    ).toBe('other')
    expect(classifyDaemonSpawnerPath('/tmp/KoluxA.app/Contents/MacOS/Kolux', alwaysExists)).toBe(
      'other'
    )
  })

  it('reports a deleted spawner as missing and an unrecorded one as unknown', () => {
    expect(
      classifyDaemonSpawnerPath('/Applications/Kolux.app/Contents/MacOS/Kolux', () => false)
    ).toBe('missing')
    expect(classifyDaemonSpawnerPath(null, alwaysExists)).toBe('unknown')
  })
})

describe('classifyDaemonPtyCwd', () => {
  it('maps the TCC-protected home folders and separates the rest of home from outside it', () => {
    expect(classifyDaemonPtyCwd('/Users/a/Documents/repo', '/Users/a')).toBe('documents')
    expect(classifyDaemonPtyCwd('/Users/a/Desktop', '/Users/a/')).toBe('desktop')
    expect(classifyDaemonPtyCwd('/Users/a/Downloads/x/y', '/Users/a')).toBe('downloads')
    expect(classifyDaemonPtyCwd('/Users/a/projects/repo', '/Users/a')).toBe('other-home')
    expect(classifyDaemonPtyCwd('/Users/a', '/Users/a')).toBe('other-home')
    expect(classifyDaemonPtyCwd('/Volumes/ext/repo', '/Users/a')).toBe('outside-home')
    // A sibling home that merely shares the prefix is not inside this home.
    expect(classifyDaemonPtyCwd('/Users/ab/Documents', '/Users/a')).toBe('outside-home')
  })
})

// Privacy invariant: enum-only. A raw path, version, or exact count must be rejected by .strict().
describe('daemon_adopted / daemon_pty_cwd_denied schemas', () => {
  const adopted = {
    app_version_match: 'different',
    spawner_path_class: 'updater-cache',
    tcc_attribution: 'intact',
    live_session_count_bucket: '2-5'
  }
  const denied = {
    cwd_class: 'documents',
    app_version_match: 'different',
    spawner_path_class: 'updater-cache'
  }

  it('accepts the enum payloads', () => {
    expect(eventSchemas.daemon_adopted.safeParse(adopted).success).toBe(true)
    expect(eventSchemas.daemon_pty_cwd_denied.safeParse(denied).success).toBe(true)
  })

  it('rejects leaked paths, versions, counts, and unknown enum values', () => {
    for (const leak of [
      { spawner_exec_path: '/Users/alice/Library/Caches/ShipIt/Kolux.app' },
      { app_version: '1.4.187' },
      { live_session_count: 3 },
      { cwd: '/Users/alice/Documents' }
    ]) {
      expect(eventSchemas.daemon_adopted.safeParse({ ...adopted, ...leak }).success).toBe(false)
      expect(eventSchemas.daemon_pty_cwd_denied.safeParse({ ...denied, ...leak }).success).toBe(
        false
      )
    }
    expect(
      eventSchemas.daemon_adopted.safeParse({ ...adopted, spawner_path_class: '/Applications' })
        .success
    ).toBe(false)
    expect(
      eventSchemas.daemon_pty_cwd_denied.safeParse({ ...denied, cwd_class: 'Documents' }).success
    ).toBe(false)
  })
})
