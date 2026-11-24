/** LAND-04 (owner decision, 2026-11-23): a workspace whose agent says its task is finished is sent to
 *  main by itself, as soon as it is finished, instead of merging every workspace only when Kolux closed.
 *  The backend decides (src-tauri/src/quit_merge.rs, `auto_land_wanted`); this file gives the same answer
 *  to the switch on Settings > Git and to the sidebar, including for values that are not true or false. */
export const AUTO_LAND_FIELD = "workspacesAutoLand";
/** The old switch's key, read only: until the new one is set, whoever turned the old one off keeps it off. */
export const AUTO_LAND_OLD_FIELD = "workspacesMergeOnQuit";
/** The switch's words, the same on Settings > Git and in the sidebar. */
export const AUTO_LAND_LABEL = "Send finished work to main by itself";

/** Whether finished work is sent to main by itself. Only an exact `true` or `false` on the new key counts;
 *  anything else (a string, a number, null, an object) falls through to the old key, where only an exact
 *  `false` turns it off. Always a real boolean, the way the backend reads it. */
export function autoLandWanted(settings: Record<string, unknown> | null | undefined): boolean {
  const s: Record<string, unknown> = settings ?? {};
  const now = s[AUTO_LAND_FIELD];
  if (now === true || now === false) return now;
  return s[AUTO_LAND_OLD_FIELD] !== false;
}

/** The line under the switch when it is on. */
const NOTE_ON =
  "On: when an agent says its task is finished, Kolux sends that workspace's work to main on this computer and brings the other workspaces up to date. Work that clashes with main stays in its workspace, marked Not in main. Nothing goes to GitHub.";
/** The line under the switch when it is off. */
const NOTE_OFF =
  "Off: an agent's finished work waits in its workspace, marked Not in main, until you choose Send to main in its pane menu. Nothing goes to GitHub.";

/** The one line under the switch, in plain words. */
export function autoLandNote(on: boolean): string {
  return on ? NOTE_ON : NOTE_OFF;
}
