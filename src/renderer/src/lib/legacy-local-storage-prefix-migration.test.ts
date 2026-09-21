import { describe, expect, it } from 'vitest'
import { migrateLegacyLocalStoragePrefixes } from './legacy-local-storage-prefix-migration'

/** Minimal in-memory Storage so this test doesn't depend on a jsdom environment. */
function createFakeStorage(seed: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(seed))
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key)
    },
    setItem: (key, value) => {
      data.set(key, value)
    }
  }
}

describe('migrateLegacyLocalStoragePrefixes', () => {
  it('copies dot-prefixed, colon-prefixed, and floating-terminal keys forward', () => {
    const storage = createFakeStorage({
      'nightshift.web.settings.v1': '{"a":1}',
      'nightshift:desktopStructuredAgentSessionOutbox:v1:abc': '{"b":2}',
      'nightshift-floating-terminal-panel-bounds-v1': '{"x":0}',
      // Untouched: not one of the migrated prefixes.
      unrelatedKey: 'unrelated-value'
    })

    migrateLegacyLocalStoragePrefixes(storage)

    expect(storage.getItem('kolux.web.settings.v1')).toBe('{"a":1}')
    expect(storage.getItem('kolux:desktopStructuredAgentSessionOutbox:v1:abc')).toBe('{"b":2}')
    expect(storage.getItem('kolux-floating-terminal-panel-bounds-v1')).toBe('{"x":0}')
    // Old entries are left in place, never deleted.
    expect(storage.getItem('nightshift.web.settings.v1')).toBe('{"a":1}')
    expect(storage.getItem('unrelatedKey')).toBe('unrelated-value')
  })

  it('never clobbers a current-prefixed key that already has a value', () => {
    const storage = createFakeStorage({
      'nightshift.web.settings.v1': '{"stale":true}',
      'kolux.web.settings.v1': '{"fresh":true}'
    })

    migrateLegacyLocalStoragePrefixes(storage)

    expect(storage.getItem('kolux.web.settings.v1')).toBe('{"fresh":true}')
  })

  it('is idempotent: a second call is a fast no-op once the completion flag is set', () => {
    const storage = createFakeStorage({ 'nightshift.web.settings.v1': '{"a":1}' })

    migrateLegacyLocalStoragePrefixes(storage)
    storage.removeItem('kolux.web.settings.v1')
    migrateLegacyLocalStoragePrefixes(storage)

    // Second call short-circuited on the completion flag, so it never re-copied the value.
    expect(storage.getItem('kolux.web.settings.v1')).toBeNull()
  })

  it('does nothing on a fresh profile with no legacy-prefixed keys', () => {
    const storage = createFakeStorage({ 'kolux.web.settings.v1': '{"a":1}' })

    expect(() => migrateLegacyLocalStoragePrefixes(storage)).not.toThrow()
    expect(storage.getItem('kolux.web.settings.v1')).toBe('{"a":1}')
  })

  it('swallows a storage access failure instead of throwing', () => {
    const throwingStorage: Storage = {
      length: 0,
      clear: () => {},
      key: () => null,
      getItem: () => {
        throw new Error('SecurityError')
      },
      removeItem: () => {},
      setItem: () => {
        throw new Error('SecurityError')
      }
    }

    expect(() => migrateLegacyLocalStoragePrefixes(throwingStorage)).not.toThrow()
  })
})
