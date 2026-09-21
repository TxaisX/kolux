import { describe, expect, it } from 'vitest'
import {
  LEGACY_DEFAULT_TERMINAL_THEME_DARK,
  KOLUX_DEFAULT_TERMINAL_THEME_DARK,
  migrateTerminalThemeDarkDefault
} from './terminal-theme-default-migration'

describe('migrateTerminalThemeDarkDefault', () => {
  it('moves the persisted Ghostty default to Kolux Dark once', () => {
    expect(
      migrateTerminalThemeDarkDefault({ terminalThemeDark: LEGACY_DEFAULT_TERMINAL_THEME_DARK })
    ).toEqual({
      terminalThemeDark: KOLUX_DEFAULT_TERMINAL_THEME_DARK,
      terminalThemeDarkDefaultedToKolux: true,
      changed: true
    })
  })

  it('fills a missing theme with Kolux Dark', () => {
    expect(migrateTerminalThemeDarkDefault(undefined)).toMatchObject({
      terminalThemeDark: KOLUX_DEFAULT_TERMINAL_THEME_DARK,
      changed: true
    })
  })

  it('leaves a theme the user picked alone and sets the guard', () => {
    expect(migrateTerminalThemeDarkDefault({ terminalThemeDark: 'Tokyo Night' })).toEqual({
      terminalThemeDark: 'Tokyo Night',
      terminalThemeDarkDefaultedToKolux: true,
      changed: false
    })
  })

  it('never touches a guarded profile, even one back on Ghostty', () => {
    expect(
      migrateTerminalThemeDarkDefault({
        terminalThemeDark: LEGACY_DEFAULT_TERMINAL_THEME_DARK,
        terminalThemeDarkDefaultedToKolux: true
      })
    ).toEqual({
      terminalThemeDark: LEGACY_DEFAULT_TERMINAL_THEME_DARK,
      terminalThemeDarkDefaultedToKolux: true,
      changed: false
    })
  })
})
