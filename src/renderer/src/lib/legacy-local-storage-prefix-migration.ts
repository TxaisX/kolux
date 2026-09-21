/**
 * One-time carry-forward of renderer localStorage entries written under the pre-rename
 * ("nightshift.") key prefixes into their current ("kolux.") spelling. localStorage is per
 * browser origin, so this must run in the renderer (the main process can't reach it) and once
 * per profile — guarded by a completion flag stored under a new-prefixed key so a normal launch
 * costs one getItem call.
 *
 * Old entries are left in place (never deleted): they're inert once nothing reads the old key,
 * and there's no atomic cross-key move in the Storage API to make deleting them safe against a
 * mid-migration crash anyway.
 */

const LEGACY_PREFIXES = ['nightshift.', 'nightshift:', 'nightshift-floating-terminal-'] as const
const NEW_PREFIXES = ['kolux.', 'kolux:', 'kolux-floating-terminal-'] as const
const MIGRATION_DONE_KEY = 'kolux.legacyLocalStoragePrefixMigration.v1'

function legacyToNewKey(key: string): string | null {
  for (let i = 0; i < LEGACY_PREFIXES.length; i++) {
    if (key.startsWith(LEGACY_PREFIXES[i])) {
      return NEW_PREFIXES[i] + key.slice(LEGACY_PREFIXES[i].length)
    }
  }
  return null
}

export function migrateLegacyLocalStoragePrefixes(storage: Storage = localStorage): void {
  try {
    if (storage.getItem(MIGRATION_DONE_KEY) !== null) {
      return
    }
    const legacyKeys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key && legacyToNewKey(key) !== null) {
        legacyKeys.push(key)
      }
    }
    for (const key of legacyKeys) {
      const newKey = legacyToNewKey(key)
      if (!newKey || storage.getItem(newKey) !== null) {
        continue
      }
      const value = storage.getItem(key)
      if (value !== null) {
        storage.setItem(newKey, value)
      }
    }
    storage.setItem(MIGRATION_DONE_KEY, '1')
  } catch {
    // localStorage can be unavailable (hardened context, quota); nothing persisted, nothing lost.
  }
}
