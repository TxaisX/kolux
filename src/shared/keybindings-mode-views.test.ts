// The Inbox / Floor / Code chords are Mod+Shift+digit; on US layouts Shift+2 reports "@" as
// the logical key, so the match must survive via the physical Digit code.
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
  it('default to Mod+Shift+1/2/3 on every platform', () => {
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
      expect(getEffectiveKeybindingsForAction('view.inbox', platform)).toEqual(['Mod+Shift+1'])
      expect(getEffectiveKeybindingsForAction('view.floor', platform)).toEqual(['Mod+Shift+2'])
      expect(getEffectiveKeybindingsForAction('view.code', platform)).toEqual(['Mod+Shift+3'])
    }
  })

  it('match the shifted punctuation a US layout reports for Shift+digit', () => {
    expect(keybindingMatchesAction('view.inbox', shifted('!', 'Digit1', 'win32'), 'win32')).toBe(
      true
    )
    expect(keybindingMatchesAction('view.floor', shifted('@', 'Digit2', 'win32'), 'win32')).toBe(
      true
    )
    expect(keybindingMatchesAction('view.code', shifted('#', 'Digit3', 'linux'), 'linux')).toBe(
      true
    )
    expect(keybindingMatchesAction('view.floor', shifted('@', 'Digit2', 'darwin'), 'darwin')).toBe(
      true
    )
  })

  it('match when the platform reports the plain digit as the logical key', () => {
    expect(keybindingMatchesAction('view.floor', shifted('2', 'Digit2', 'win32'), 'win32')).toBe(
      true
    )
  })

  it('do not cross-match a neighbouring digit', () => {
    expect(keybindingMatchesAction('view.inbox', shifted('@', 'Digit2', 'win32'), 'win32')).toBe(
      false
    )
  })
})
