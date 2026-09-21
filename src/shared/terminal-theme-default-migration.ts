import type { GlobalSettings } from './global-settings-types'

export const LEGACY_DEFAULT_TERMINAL_THEME_DARK = 'Ghostty Default Style Dark'
export const KOLUX_DEFAULT_TERMINAL_THEME_DARK = 'Kolux Dark'

type TerminalThemeDarkSettings = Pick<
  GlobalSettings,
  'terminalThemeDark' | 'terminalThemeDarkDefaultedToKolux'
>

/**
 * Moves a profile still on the old Ghostty dark default to Kolux Dark, once.
 * Why: the default name was written to disk verbatim, so it cannot be told apart from a
 * deliberate choice except by this guard; the guard is set on the first live user update too.
 */
export function migrateTerminalThemeDarkDefault(
  settings: Partial<TerminalThemeDarkSettings> | undefined
): TerminalThemeDarkSettings & { changed: boolean } {
  const guarded = settings?.terminalThemeDarkDefaultedToKolux === true
  const current = settings?.terminalThemeDark
  if (guarded) {
    return {
      terminalThemeDark: current || KOLUX_DEFAULT_TERMINAL_THEME_DARK,
      terminalThemeDarkDefaultedToKolux: true,
      changed: false
    }
  }
  const shouldMove = !current || current === LEGACY_DEFAULT_TERMINAL_THEME_DARK
  return {
    terminalThemeDark: shouldMove ? KOLUX_DEFAULT_TERMINAL_THEME_DARK : current,
    terminalThemeDarkDefaultedToKolux: true,
    changed: shouldMove && current !== KOLUX_DEFAULT_TERMINAL_THEME_DARK
  }
}
