// The Code chord is Mod+Shift+3; on US layouts Shift+3 reports "#" as the logical key,
// so the match must survive via the physical Digit code.
import { describe, expect, it } from 'vitest'
import { getEffectiveKeybindingsForAction, keybindingMatchesAction } from './keybindings'

const shifted = (key: string, code: string, platform: 'win32' | 'linux' | 'darwin') => ({
  key,
  code,
  control: platform !== 'darwin',
  meta: platform === 'darwin',
  alt: false,
  shift: true
})

describe('mode view keybindings', () => {
  it('leaves Inbox and Floor unbound and keeps Code on Mod+Shift+3', () => {
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
      expect(getEffectiveKeybindingsForAction('view.inbox', platform)).toEqual([])
      expect(getEffectiveKeybindingsForAction('view.floor', platform)).toEqual([])
      expect(getEffectiveKeybindingsForAction('view.code', platform)).toEqual(['Mod+Shift+3'])
    }
  })

  it('match the shifted punctuation a US layout reports for Shift+digit', () => {
    expect(keybindingMatchesAction('view.code', shifted('#', 'Digit3', 'linux'), 'linux')).toBe(
      true
    )
    expect(keybindingMatchesAction('view.code', shifted('#', 'Digit3', 'darwin'), 'darwin')).toBe(
      true
    )
  })

  it('match when the platform reports the plain digit as the logical key', () => {
    expect(keybindingMatchesAction('view.code', shifted('3', 'Digit3', 'win32'), 'win32')).toBe(
      true
    )
  })

  it('do not cross-match a neighbouring digit', () => {
    expect(keybindingMatchesAction('view.code', shifted('@', 'Digit2', 'win32'), 'win32')).toBe(
      false
    )
  })
})
