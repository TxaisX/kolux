// A workspace that fails to be made must not eat what was typed. The form clears at once so a
// second one can be started (PROJ-020); on a failure the typed words are put back, but only into
// fields still empty, so anything typed since is kept.
export const restoreField = (now: string, saved: string): string => now || saved;
