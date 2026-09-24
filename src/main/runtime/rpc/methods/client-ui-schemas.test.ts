import { describe, expect, it } from 'vitest'
import { UiUpdate } from './client-ui-schemas'

describe('UiUpdate.statusBarItems wire tolerance', () => {
  it('filters a retired id (e.g. an old client still sending opencode-go) instead of rejecting the whole ui.set payload', () => {
    const parsed = UiUpdate.parse({
      statusBarItems: ['claude', 'opencode-go', 'codex'],
      sidebarWidth: 240
    })

    expect(parsed.statusBarItems).toEqual(['claude', 'codex'])
    expect(parsed.sidebarWidth).toBe(240)
  })

  it('keeps an all-known list unchanged', () => {
    const parsed = UiUpdate.parse({ statusBarItems: ['claude', 'codex', 'ports'] })

    expect(parsed.statusBarItems).toEqual(['claude', 'codex', 'ports'])
  })
})
