// The settings copy the window already holds (App's, through useSettingsPlumbing), kept here so a Settings page can
// draw from it at once instead of waiting for its own read (useSettings). No imports: the window's first load
// carries only this holder, never the pages.

let held: Record<string, unknown> | null = null;

/** The window's copy, set on each of its renders. */
export const holdWindowSettings = (s: Record<string, unknown> | null): void => void (held = s);
/** The window's copy, or null before the window has one. */
export const windowSettings = (): Record<string, unknown> | null => held;
