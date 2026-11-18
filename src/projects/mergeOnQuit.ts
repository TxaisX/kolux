/** Txais (2026-11-17): when Kolux closes for real, the workspaces it made are saved, merged into main on this
 *  computer and removed. On unless the setting is saved as `false`; a restart never does it (the backend decides). */
export const MERGE_ON_QUIT_FIELD = "workspacesMergeOnQuit";
export const mergesOnQuit = (settings: Record<string, unknown>): boolean => settings[MERGE_ON_QUIT_FIELD] !== false;
/** The one line under the switch, in plain words. */
export const MERGE_ON_QUIT_NOTE =
  "When you close Kolux, each workspace it made is saved, merged into main on this computer and removed. Files Git ignores inside a merged workspace, such as build output, are deleted with it. One that clashes, is locked, or holds passwords, keys or local settings that are not saved in Git stays, and Kolux tells you at the next start. Nothing goes to GitHub.";
