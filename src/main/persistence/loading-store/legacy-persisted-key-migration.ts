/**
 * Translates JSON key names and enum string values written by pre-rename ("Nightshift") builds
 * into their current ("Kolux") spelling, in a freshly-parsed (not yet typed) persisted-state
 * object. Narrow by design: only these exact known keys are renamed (anywhere in the tree — the
 * names are specific enough not to collide with user content), and only these exact known values
 * under these exact known keys are rewritten. A repo path or display name containing the word
 * "nightshift" is never touched, because nothing here does a substring/blanket replace.
 */

const LEGACY_KEY_RENAMES: Readonly<Record<string, string>> = {
  trustedNightshiftHooks: 'trustedKoluxHooks',
  terminalThemeDarkDefaultedToNightshift: 'terminalThemeDarkDefaultedToKolux',
  nightshiftCreatedAt: 'koluxCreatedAt',
  nightshiftCreationSource: 'koluxCreationSource',
  nightshiftCreationWorkspaceLayout: 'koluxCreationWorkspaceLayout',
  nightshiftProfileId: 'koluxProfileId',
  activeNightshiftProfileId: 'activeKoluxProfileId'
}

// Scoped to the (post-rename) key name so an unrelated field holding the literal string
// "nightshift" is never rewritten.
const LEGACY_ENUM_VALUE_RENAMES_BY_KEY: Readonly<Record<string, Record<string, string>>> = {
  terminalThemeDark: { 'Nightshift Dark': 'Kolux Dark' },
  terminalShortcutPolicy: { 'nightshift-first': 'kolux-first' },
  ownership: { 'nightshift-managed': 'kolux-managed' },
  checkoutMode: { 'nightshift-worktree': 'kolux-worktree' },
  recipeCheckoutMode: { 'nightshift-worktree': 'kolux-worktree' },
  customSoundId: { nightshift: 'kolux' },
  linearMode: { 'in-nightshift': 'in-kolux' }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Mutates `value` in place, returning whether anything changed. Safe to call on every load —
 * once persisted data has been migrated, none of the old key/value spellings appear again.
 */
export function migrateLegacyPersistedKeysAndValues(value: unknown): boolean {
  let changed = false
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (migrateLegacyPersistedKeysAndValues(entry)) {
        changed = true
      }
    }
    return changed
  }
  if (!isPlainObject(value)) {
    return false
  }
  for (const key of Object.keys(value)) {
    const renamedKey = LEGACY_KEY_RENAMES[key]
    if (renamedKey && !(renamedKey in value)) {
      value[renamedKey] = value[key]
      delete value[key]
      changed = true
    }
  }
  for (const [key, valueRenames] of Object.entries(LEGACY_ENUM_VALUE_RENAMES_BY_KEY)) {
    const current = value[key]
    if (typeof current === 'string' && current in valueRenames) {
      value[key] = valueRenames[current]
      changed = true
    }
  }
  for (const key of Object.keys(value)) {
    if (migrateLegacyPersistedKeysAndValues(value[key])) {
      changed = true
    }
  }
  return changed
}
