// PROJ-029: creating a workspace from a local base branch that is behind its remote shows a
// suggestion to bring the base up to date. It can be dismissed for good (remembered in the user's
// settings), and an opt-in setting updates the base automatically on create (off by default).
// The sentence itself is made when the workspace is created (see refresh_base in projects.rs); this
// is the part that tells it apart and keeps it quiet once dismissed.

/** The setting that turns the automatic update on create on: off unless it is exactly true. */
export const REFRESH_SETTING = "refreshBaseFirst";
/** The setting that remembers the hint was dismissed. */
export const HINT_DISMISSED_SETTING = "baseBehindHintDismissed";

/** The suggestion, as the create reports it: "<base> is <n> commit(s) behind <upstream>; update it, ...". */
export function isBehindHint(warning: string): boolean {
  return /^\S+ is \d+ commits? behind \S+; update it/.test(warning);
}

export const refreshesOnCreate = (settings: Record<string, unknown>): boolean => settings[REFRESH_SETTING] === true;
export const hintDismissed = (settings: Record<string, unknown>): boolean => settings[HINT_DISMISSED_SETTING] === true;

/** The suggestion in a create's notes, if there is one and it has not been dismissed. */
export function behindHint(warnings: string[], settings: Record<string, unknown>): string | null {
  return hintDismissed(settings) ? null : (warnings.find(isBehindHint) ?? null);
}
