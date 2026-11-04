// VIEW-115 (T-276): the Agents tab redraws only when something it shows has changed. The window's
// settings object is replaced whenever any setting is saved; the list cares about two of its keys,
// so a change to anything else (or to app state that is not ours) leaves the list untouched.
import { SCOPE_KEY, VIEW_KEY } from "./prefs";

/** The settings the list reads. */
export const WATCHED_SETTINGS = [SCOPE_KEY, VIEW_KEY] as const;

const sameValue = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);
const sameList = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => sameValue(v, b[i]));

type Shown = { settings: Record<string, unknown>; activeDir: string | null; projectDirs: string[]; projects?: { path: string }[]; rescanKey: number; visible: boolean; shell: string | null; openPanes?: readonly [string, string][] };

/** Whether two sets of props draw the same list. Functions are left out: the panel calls the latest ones. */
export function sameShown(a: Shown, b: Shown): boolean {
  return (
    a.activeDir === b.activeDir &&
    a.rescanKey === b.rescanKey &&
    a.visible === b.visible &&
    a.shell === b.shell &&
    sameList(a.projectDirs, b.projectDirs) &&
    sameList(a.projects ?? [], b.projects ?? []) &&
    // C28-R5-01: a row's "open in a pane" reading comes from this list, so a change to it redraws the list.
    sameList(a.openPanes ?? [], b.openPanes ?? []) &&
    WATCHED_SETTINGS.every((k) => sameValue(a.settings[k], b.settings[k]))
  );
}
