import { describe, expect, it } from 'vitest'
import {
  LEGACY_DEFAULT_TERMINAL_THEME_DARK,
  NIGHTSHIFT_DEFAULT_TERMINAL_THEME_DARK,
  migrateTerminalThemeDarkDefault
} from './terminal-theme-default-migration'

describe('migrateTerminalThemeDarkDefault', () => {
  it('moves the persisted Ghostty default to Nightshift Dark once', () => {
    expect(
      migrateTerminalThemeDarkDefault({ terminalThemeDark: LEGACY_DEFAULT_TERMINAL_THEME_DARK })
    ).toEqual({
      terminalThemeDark: NIGHTSHIFT_DEFAULT_TERMINAL_THEME_DARK,
      terminalThemeDarkDefaultedToNightshift: true,
      changed: true
    })
  })

  it('fills a missing theme with Nightshift Dark', () => {
    expect(migrateTerminalThemeDarkDefault(undefined)).toMatchObject({
      terminalThemeDark: NIGHTSHIFT_DEFAULT_TERMINAL_THEME_DARK,
      changed: true
    })
  })

  it('leaves a theme the user picked alone and sets the guard', () => {
    expect(migrateTerminalThemeDarkDefault({ terminalThemeDark: 'Tokyo Night' })).toEqual({
      terminalThemeDark: 'Tokyo Night',
      terminalThemeDarkDefaultedToNightshift: true,
      changed: false
    })
  })

  it('never touches a guarded profile, even one back on Ghostty', () => {
    expect(
      migrateTerminalThemeDarkDefault({
        terminalThemeDark: LEGACY_DEFAULT_TERMINAL_THEME_DARK,
        terminalThemeDarkDefaultedToNightshift: true
      })
    ).toEqual({
      terminalThemeDark: LEGACY_DEFAULT_TERMINAL_THEME_DARK,
      terminalThemeDarkDefaultedToNightshift: true,
      changed: false
    })
  })
})
