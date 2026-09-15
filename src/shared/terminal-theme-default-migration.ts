import type { GlobalSettings } from './global-settings-types'

export const LEGACY_DEFAULT_TERMINAL_THEME_DARK = 'Ghostty Default Style Dark'
export const NIGHTSHIFT_DEFAULT_TERMINAL_THEME_DARK = 'Nightshift Dark'

type TerminalThemeDarkSettings = Pick<
  GlobalSettings,
  'terminalThemeDark' | 'terminalThemeDarkDefaultedToNightshift'
>

/**
 * Moves a profile still on the old Ghostty dark default to Nightshift Dark, once.
 * Why: the default name was written to disk verbatim, so it cannot be told apart from a
 * deliberate choice except by this guard; the guard is set on the first live user update too.
 */
export function migrateTerminalThemeDarkDefault(
  settings: Partial<TerminalThemeDarkSettings> | undefined
): TerminalThemeDarkSettings & { changed: boolean } {
  const guarded = settings?.terminalThemeDarkDefaultedToNightshift === true
  const current = settings?.terminalThemeDark
  if (guarded) {
    return {
      terminalThemeDark: current || NIGHTSHIFT_DEFAULT_TERMINAL_THEME_DARK,
      terminalThemeDarkDefaultedToNightshift: true,
      changed: false
    }
  }
  const shouldMove = !current || current === LEGACY_DEFAULT_TERMINAL_THEME_DARK
  return {
    terminalThemeDark: shouldMove ? NIGHTSHIFT_DEFAULT_TERMINAL_THEME_DARK : current,
    terminalThemeDarkDefaultedToNightshift: true,
    changed: shouldMove && current !== NIGHTSHIFT_DEFAULT_TERMINAL_THEME_DARK
  }
}
