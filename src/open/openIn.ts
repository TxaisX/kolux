// EDIT-043 (T-237-a): Open in another editor or the file manager. The apps come from General
// settings (`openInApps`, a list of { label, command }); out of the box that is VS Code. The
// system file manager is always offered last. Rows lacking a label or a command are discarded and
// the list holds at most MAX_APPS; an app whose command is empty at launch falls back to VS Code's.
// The folder is opened by the open_in command (files.rs), which refuses relative or missing paths
// and reports a launch that fails. Managing the list in General settings is T-237-b.
import { invoke } from "@tauri-apps/api/core";
import { readOpenIn } from "../settings/openIn";

export type App = { label: string; command: string };
export type Target = App & { files?: true };

export const SETTING = "openInApps";
export const MAX_APPS = 12;
export const VS_CODE: App = { label: "VS Code", command: "code" };
/** Ready-made presets the settings list offers to add (T-237-b). */
export const PRESETS: App[] = [VS_CODE, { label: "Cursor", command: "cursor" }, { label: "Windsurf", command: "windsurf" }, { label: "Zed", command: "zed" }, { label: "Sublime Text", command: "subl" }];
export const FILE_MANAGER: Target = { label: "File Explorer", command: "", files: true };

/** The stored list, kept to the rules: trimmed, rows without a label or a command dropped, capped. */
export function cleanApps(raw: unknown): App[] {
  if (!Array.isArray(raw)) return [VS_CODE];
  const rows = raw
    .map((r) => ({ label: typeof r?.label === "string" ? r.label.trim() : "", command: typeof r?.command === "string" ? r.command.trim() : "" }))
    .filter((r) => r.label && r.command);
  return rows.slice(0, MAX_APPS);
}

/** What the Open in menu offers (T-323-b): the apps of General settings in the user's order, File Explorer being the system file manager. */
export const targetsOf = (settings: Record<string, unknown> | null | undefined): Target[] =>
  readOpenIn(settings ?? {})
    .map((a): Target => (a.id === "explorer" ? FILE_MANAGER : { label: a.name, command: a.command }))
    .slice(0, MAX_APPS);

/** The command a target launches with; an app with none falls back to VS Code's; the file manager has none. */
export const commandOf = (t: Target): string | null => (t.files ? null : t.command.trim() || VS_CODE.command);

/** Opens `folder` in `t`; rejects with the reason a launch failed. */
export const openIn = (folder: string, t: Target): Promise<void> => invoke<void>("open_in", { path: folder, command: commandOf(t) });

/** The menu's targets, read from the settings now. */
export const loadTargets = (): Promise<Target[]> =>
  invoke<Record<string, unknown>>("get_settings").then(targetsOf, () => targetsOf(null));

/** T-323-b: the apps a single file can be opened in, as the Open in list holds them (the file manager is not one: the row menu has its own Reveal). */
export const fileTargetsOf = (settings: Record<string, unknown> | null | undefined): App[] =>
  readOpenIn(settings ?? {})
    .filter((a) => a.id !== "explorer")
    .map((a) => ({ label: a.name, command: a.command }))
    .slice(0, MAX_APPS);

/** `file` as a path relative to `root` (slashes forward), or null when it is not inside it. */
export function relInside(root: string, file: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const [r, f] = [norm(root), norm(file)];
  const same = (a: string, b: string) => (/^[A-Za-z]:/.test(r) ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (!r || f.length <= r.length + 1 || f[r.length] !== "/" || !same(f.slice(0, r.length), r)) return null;
  const rel = f.slice(r.length + 1);
  return rel.split("/").some((s) => s === "" || s === "..") ? null : rel;
}

/** Opens one file of the worktree `root` in `app` (scm_open_with: the app must be one of the saved list, the file a plain path inside root). */
export const openFileIn = (root: string, file: string, app: App): Promise<void> => {
  const rel = relInside(root, file);
  return rel === null ? Promise.reject(new Error(`${file} is not inside ${root}`)) : invoke<void>("scm_open_with", { worktree: root, path: rel, command: commandOf(app) });
};
