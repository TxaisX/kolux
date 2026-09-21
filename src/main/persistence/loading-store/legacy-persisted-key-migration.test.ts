import { describe, expect, it } from 'vitest'
import { migrateLegacyPersistedKeysAndValues } from './legacy-persisted-key-migration'

describe('migrateLegacyPersistedKeysAndValues', () => {
  it('renames a known top-level legacy key to its current spelling', () => {
    const parsed: Record<string, unknown> = { trustedNightshiftHooks: ['a', 'b'] }

    const changed = migrateLegacyPersistedKeysAndValues(parsed)

    expect(changed).toBe(true)
    expect(parsed.trustedKoluxHooks).toEqual(['a', 'b'])
    expect(parsed).not.toHaveProperty('trustedNightshiftHooks')
  })

  it('does not overwrite a current-named key that is already present', () => {
    const parsed: Record<string, unknown> = {
      trustedNightshiftHooks: ['stale'],
      trustedKoluxHooks: ['fresh']
    }

    migrateLegacyPersistedKeysAndValues(parsed)

    expect(parsed.trustedKoluxHooks).toEqual(['fresh'])
  })

  it('renames legacy worktree metadata keys nested arbitrarily deep', () => {
    const parsed = {
      worktreeMeta: {
        'wt2:host:instance': {
          nightshiftCreatedAt: 1700000000000,
          nightshiftCreationSource: 'add-existing',
          nightshiftCreationWorkspaceLayout: 'flat'
        }
      }
    }

    const changed = migrateLegacyPersistedKeysAndValues(parsed)

    expect(changed).toBe(true)
    const row = parsed.worktreeMeta['wt2:host:instance'] as Record<string, unknown>
    expect(row.koluxCreatedAt).toBe(1700000000000)
    expect(row.koluxCreationSource).toBe('add-existing')
    expect(row.koluxCreationWorkspaceLayout).toBe('flat')
    expect(row).not.toHaveProperty('nightshiftCreatedAt')
  })

  it('renames profile id keys', () => {
    const parsed: Record<string, unknown> = {
      nightshiftProfileId: 'p1',
      activeNightshiftProfileId: 'p1'
    }

    migrateLegacyPersistedKeysAndValues(parsed)

    expect(parsed.koluxProfileId).toBe('p1')
    expect(parsed.activeKoluxProfileId).toBe('p1')
  })

  it('rewrites known enum values only under their known field name', () => {
    const parsed = {
      terminalThemeDark: 'Nightshift Dark',
      terminalShortcutPolicy: 'nightshift-first',
      ownership: 'nightshift-managed',
      checkoutMode: 'nightshift-worktree',
      recipeCheckoutMode: 'nightshift-worktree',
      customSoundId: 'nightshift',
      linearMode: 'in-nightshift'
    }

    migrateLegacyPersistedKeysAndValues(parsed)

    expect(parsed.terminalThemeDark).toBe('Kolux Dark')
    expect(parsed.terminalShortcutPolicy).toBe('kolux-first')
    expect(parsed.ownership).toBe('kolux-managed')
    expect(parsed.checkoutMode).toBe('kolux-worktree')
    expect(parsed.recipeCheckoutMode).toBe('kolux-worktree')
    expect(parsed.customSoundId).toBe('kolux')
    expect(parsed.linearMode).toBe('in-kolux')
  })

  it('never rewrites a value merely because it contains the word "nightshift"', () => {
    const parsed = {
      repos: [
        {
          path: 'G:\\Dev\\nightshift-workspaces\\nightshift',
          displayName: 'nightshift'
        }
      ],
      // A field NOT in the known enum-rename table must be left untouched even though its
      // value happens to collide with a renamed value elsewhere.
      someUnrelatedField: 'nightshift'
    }

    const changed = migrateLegacyPersistedKeysAndValues(parsed)

    expect(changed).toBe(false)
    expect(parsed.repos[0].path).toBe('G:\\Dev\\nightshift-workspaces\\nightshift')
    expect(parsed.repos[0].displayName).toBe('nightshift')
    expect(parsed.someUnrelatedField).toBe('nightshift')
  })

  it('is idempotent: running twice produces the same result and reports no further change', () => {
    const parsed: Record<string, unknown> = {
      trustedNightshiftHooks: ['a'],
      terminalThemeDark: 'Nightshift Dark'
    }

    migrateLegacyPersistedKeysAndValues(parsed)
    const second = migrateLegacyPersistedKeysAndValues(parsed)

    expect(second).toBe(false)
    expect(parsed.trustedKoluxHooks).toEqual(['a'])
    expect(parsed.terminalThemeDark).toBe('Kolux Dark')
  })

  it('returns false and leaves a fresh (never pre-rename) install untouched', () => {
    const parsed = { trustedKoluxHooks: [], terminalThemeDark: 'Kolux Dark' }

    expect(migrateLegacyPersistedKeysAndValues(parsed)).toBe(false)
  })
})
