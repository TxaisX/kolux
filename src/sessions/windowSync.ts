// VIEW-007 (T-168): screen and sidebar preferences stay in step across windows. Every window
// re-reads the saved settings when another one saves (the "settings-saved" event). The sleeping
// toggle and the sidebar choices are plain settings, so they follow by themselves; the screen is
// window state, so this decides when a saved screen may move the window: only when the saved
// value changed since this window last saw it (any other save leaves the window alone), and
// never off a page the user is on.
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { onlyWindowState, readBroadcast } from "../settings/settingsSync";

/** The screen to move to, or null. `seen` is the saved value this window last looked at: a save that
 * left it unchanged (a different setting) never moves the window, and neither does a page being open. */
export function syncedScreen<S extends string>(saved: unknown, seen: unknown, current: S, page: unknown, valid: readonly S[]): S | null {
  if (saved === seen) return null;
  if (page !== null && page !== undefined) return null;
  return typeof saved === "string" && saved !== current && (valid as readonly string[]).includes(saved) ? (saved as S) : null;
}

type Args<S extends string> = {
  field: string;
  valid: readonly S[];
  screen: S;
  page: unknown;
  /** Called with the screen to show; the caller marks it as already saved so it is not written back. */
  onScreen: (s: S) => void;
  /** False until the window has read its own settings once, so the first read never counts as a sync. */
  ready: boolean;
};

/** Follows other windows' saved screen. Listens for the settings event and reads the settings itself. */
export function useWindowSync<S extends string>({ field, valid, screen, page, onScreen, ready }: Args<S>) {
  const now = useRef({ screen, page, ready, onScreen, valid, field });
  now.current = { screen, page, ready, onScreen, valid, field };
  // The saved value this window last saw; undefined until the first read after `ready`.
  const seen = useRef<{ v: unknown } | null>(null);
  useEffect(() => {
    if (!ready || seen.current !== null) return;
    void invoke<Record<string, unknown>>("get_settings")
      .then((s) => void (seen.current ??= { v: s[field] }))
      .catch(() => {});
  }, [ready, field]);
  useEffect(() => {
    const off = listen("settings-saved", (e) => {
      const c = now.current;
      if (!c.ready) return;
      // a save of only window state that did not touch this field (a layout write per tab opened) moves no screen
      const b = readBroadcast(e?.payload);
      if (b && onlyWindowState(e?.payload) && !(c.field in b.set) && !b.remove.includes(c.field)) return;
      void invoke<Record<string, unknown>>("get_settings")
        .then((s) => {
          const saved = s[c.field];
          const before = seen.current;
          seen.current = { v: saved };
          if (before === null) return;
          const next = syncedScreen(saved, before.v, now.current.screen, now.current.page, c.valid);
          if (next !== null) now.current.onScreen(next);
        })
        .catch(() => {});
    });
    return () => void off.then((u) => u()).catch(() => {});
  }, []);
}
