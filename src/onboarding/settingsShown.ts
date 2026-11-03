// 49-ux2: the signal Ctrl+, sends when it opens Settings, on its own so the window keys (loaded at start) do not
// carry the dialog helper (dialogFocus.ts) that only the setup dialogs use.

/** Settings opened without OPEN_SETTINGS (the Ctrl+, key; the native menu once lane E1 sends it too). */
export const SETTINGS_SHOWN = "kolux-settings-shown";

/** Says Settings is showing: Ctrl+, sends it (src/keys/useWindowKeys.ts). */
export const settingsShown = (w: EventTarget = window): void => void w.dispatchEvent(new Event(SETTINGS_SHOWN));
