import { describe, expect, it } from 'vitest'
import {
  cycleComposerTargetPaneKey,
  isComposerSendEnabled,
  resolveDefaultComposerTargetPaneKey
} from './workspace-composer-model'

describe('resolveDefaultComposerTargetPaneKey', () => {
  it('picks the focused pane when it is a target, even if disabled', () => {
    const targets = [
      { paneKey: 'a', status: 'eligible' as const },
      { paneKey: 'b', status: 'disabled' as const }
    ]
    expect(resolveDefaultComposerTargetPaneKey(targets, 'b')).toBe('b')
  })

  it('falls back to the first eligible target when focus is not a target', () => {
    const targets = [
      { paneKey: 'a', status: 'disabled' as const },
      { paneKey: 'b', status: 'eligible' as const }
    ]
    expect(resolveDefaultComposerTargetPaneKey(targets, 'nope')).toBe('b')
  })

  it('falls back to the first eligible target when there is no focus', () => {
    const targets = [
      { paneKey: 'a', status: 'disabled' as const },
      { paneKey: 'b', status: 'eligible' as const }
    ]
    expect(resolveDefaultComposerTargetPaneKey(targets, null)).toBe('b')
  })

  it('returns null when there is no eligible target and focus is not a target', () => {
    const targets = [{ paneKey: 'a', status: 'disabled' as const }]
    expect(resolveDefaultComposerTargetPaneKey(targets, null)).toBeNull()
  })

  it('returns null with no targets at all', () => {
    expect(resolveDefaultComposerTargetPaneKey([], 'a')).toBeNull()
  })
})

describe('cycleComposerTargetPaneKey', () => {
  const targets = [
    { paneKey: 'a', status: 'eligible' as const },
    { paneKey: 'b', status: 'disabled' as const },
    { paneKey: 'c', status: 'eligible' as const }
  ]

  it('advances to the next target', () => {
    expect(cycleComposerTargetPaneKey(targets, 'a')).toBe('b')
  })

  it('wraps from the last target back to the first', () => {
    expect(cycleComposerTargetPaneKey(targets, 'c')).toBe('a')
  })

  it('lands on the first target when the current selection is unknown', () => {
    expect(cycleComposerTargetPaneKey(targets, 'missing')).toBe('a')
    expect(cycleComposerTargetPaneKey(targets, null)).toBe('a')
  })

  it('returns null when there are no targets', () => {
    expect(cycleComposerTargetPaneKey([], 'a')).toBeNull()
  })
})

describe('isComposerSendEnabled', () => {
  it('requires non-blank text and an eligible target', () => {
    expect(isComposerSendEnabled('hello', 'eligible')).toBe(true)
    expect(isComposerSendEnabled('   ', 'eligible')).toBe(false)
    expect(isComposerSendEnabled('hello', 'disabled')).toBe(false)
    expect(isComposerSendEnabled('hello', undefined)).toBe(false)
  })
})
