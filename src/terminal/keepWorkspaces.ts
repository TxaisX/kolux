// Txais (2026-11-16): Kolux does not put tabs back across a close. A start opens with no tabs, and the Start form asks what to
// open. The saved tabs (`savedLayout`) are neither put back nor written. `keepWorkspaces: true` in settings.json brings the tab
// restore back; there is no page for it on purpose. The folder list is not part of this: folders stay listed across a restart
// (the start-up wipe of the folder list was removed in the slim-down), so this setting only gates tabs, layout and the Start choice.
import { LAYOUT_FIELD } from "./layout";
import { saveChanged } from "../settings/saveChanged";
import { invoke } from "@tauri-apps/api/core";

export const KEEP_WORKSPACES_FIELD = "keepWorkspaces";

/** `startForm.LAST_START_KEY`, spelled here so the first-load bundle does not pull the Start form in (a test keeps the two equal). */
export const LAST_START_FIELD = "lastStart";

export const keepsWorkspaces = (settings: Record<string, unknown> | null | undefined): boolean => settings?.[KEEP_WORKSPACES_FIELD] === true;

/** The settings the window starts with when nothing is kept: the last close's saved tabs and Start choice are not in them, so
 *  nothing reads them and a later save never writes them back (they are removed from the file by `forgetLastClose`). */
export function withoutLastClose(settings: Record<string, unknown>): Record<string, unknown> {
  const { [LAYOUT_FIELD]: _tabs, [LAST_START_FIELD]: _start, ...rest } = settings;
  void _tabs;
  void _start;
  return rest;
}

/** A start that keeps nothing: the last close's saved tabs and Start choice are dropped from the settings file, and the saved
 *  output of every tab is cleared. Only from settings really read (`saved` null: nothing is written). */
export function forgetLastClose(saved: Record<string, unknown> | null): void {
  if (!saved) return;
  const old: Record<string, unknown> = { [LAYOUT_FIELD]: saved[LAYOUT_FIELD], [LAST_START_FIELD]: saved[LAST_START_FIELD] };
  if (old[LAYOUT_FIELD] !== undefined || old[LAST_START_FIELD] !== undefined) void saveChanged(old, {}).catch(() => {});
  void invoke("terminal_prune_history", { keep: [] }).catch(() => {});
}
