import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUS_BAR_ITEMS } from '../../../../../shared/constants'
import { migrateStatusBarItems } from './ui-slice-hydration-sanitizers'

describe('migrateStatusBarItems', () => {
  it('drops retired items such as opencode-go from a persisted profile', () => {
    expect(migrateStatusBarItems(['claude', 'opencode-go', 'codex'])).toEqual(['claude', 'codex'])
  })

  it('maps legacy memory/sessions to resource-usage once', () => {
    expect(migrateStatusBarItems(['memory', 'sessions', 'ports'])).toEqual([
      'resource-usage',
      'ports'
    ])
  })

  it('falls back to the defaults when nothing is persisted', () => {
    expect(migrateStatusBarItems(undefined)).toEqual(DEFAULT_STATUS_BAR_ITEMS)
  })
})
