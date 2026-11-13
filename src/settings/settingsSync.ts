// SET-035 (T-181): how a window keeps its copy of the settings in step with the others.
// The backend broadcasts every save as "settings-saved" with the keys that changed (secrets taken
// out); a window lays that over its copy, or reads again when the broadcast carries nothing.
import { tidySettings } from "./tidy";

type Settings = Record<string, unknown>;

/** The settings fields that hold secrets; the window never holds them (mirror of the backend's
 * list, so a payload that somehow carried one is still stripped here). */
export const SECRET_KEYS = ["claudeOauthToken", "xaiApiKey", "httpProxy", "minimaxCookie", "minimaxApiKey", "moonshotApiKey"] as const;

export type Broadcast = { set: Settings; remove: string[] };

/** `settings` with the secret fields taken out. */
export function withoutSecrets(settings: Settings): Settings {
  const out = { ...settings };
  for (const k of SECRET_KEYS) delete out[k];
  return out;
}

/** What a "settings-saved" event carried, or null when it carried no usable change (the window then
 * reads the settings again). Secrets are dropped even if the sender left one in. */
export function readBroadcast(payload: unknown): Broadcast | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { set?: unknown; remove?: unknown };
  if (!p.set || typeof p.set !== "object" || Array.isArray(p.set)) return null;
  const remove = Array.isArray(p.remove) ? p.remove.filter((k): k is string => typeof k === "string") : [];
  return { set: withoutSecrets(p.set as Settings), remove: remove.filter((k) => !(SECRET_KEYS as readonly string[]).includes(k)) };
}

/** The settings the window writes by itself as it is used: the pane layout (every tab opened or closed), the screen
 *  in front, and which worktree belongs to which project (`worktreeGrids`, projects/worktreeGrid.ts). A save of only
 *  these changes no account, key or choice, so a reader of those need not ask again. */
export const WINDOW_STATE_KEYS: readonly string[] = ["savedLayout", "lastScreen", "worktreeGrids"];

/** True when a "settings-saved" event carried only window state (WINDOW_STATE_KEYS); anything else, or an event
 *  that carried nothing usable, is false, so the caller reads again as before. */
export function onlyWindowState(payload: unknown): boolean {
  const b = readBroadcast(payload);
  const keys = b ? [...Object.keys(b.set), ...b.remove] : [];
  return keys.length > 0 && keys.every((k) => WINDOW_STATE_KEYS.includes(k));
}

/** A window's copy after another window's save. */
export function applyBroadcast(current: Settings, b: Broadcast): Settings {
  const next = { ...current, ...b.set };
  for (const k of b.remove) delete next[k];
  return tidySettings(next);
}

/** SET-035: a change made while the settings are still loading wins over the load that arrives
 * afterwards. Collect changes with `change`, then pass what was read to `loaded`. */
export function createLoadRace() {
  let done = false;
  const pending: Settings[] = [];
  return {
    change(patch: Settings) {
      if (!done) pending.push(patch);
    },
    loaded(stored: Settings): Settings {
      done = true;
      const mine = pending.splice(0); // only the first read is overlaid; a later re-read is plain
      return tidySettings(Object.assign({}, withoutSecrets(stored), ...mine));
    },
  };
}

/** After a save (done or failed), the window's copy with only the keys of that save set to what is
 * really stored; every other setting (saved fine, or changed by another window) stays as it is, so
 * a failed save never reverses a setting that saved fine. */
export function adoptStored(current: Settings, stored: Settings, saved: Settings): Settings {
  const next = { ...current };
  for (const k of Object.keys(saved)) {
    if (k in stored) next[k] = stored[k];
    else delete next[k];
  }
  return next;
}
