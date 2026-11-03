// UX lane A (shell.md row 17): a failed settings read keeps what the window already holds. Replacing it with {}
// made the next save write the defaults over the saved settings.

/** Reads the settings with `load` and hands them to `apply`. A failed read hands nothing on, so the window keeps
 *  the settings it holds. */
export const readSettingsInto = <T>(load: () => Promise<T>, apply: (s: T) => void): Promise<void> =>
  load()
    .then(apply)
    .catch(() => {});
