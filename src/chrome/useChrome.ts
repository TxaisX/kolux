// T-543: the window's passing chrome state, moved out of App.tsx as it was: the worktree palette's
// open flag, the notice line and the toast that clears itself.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { helpAction, readSynced, REPORT_CRASH_EVENT, type HelpAction, type MenuBarState, type NativeChord } from "./chromeItems";
import { openExplore, openGuide } from "../onboarding/guide";
import { requestUpdateCheck } from "../update/UpdateCenter";
import { openAbout } from "../shell/about";

export function useChrome() {
  const [palette, setPalette] = useState(false); // PROJ-057 / VIEW-037: the worktree palette is open
  const [notice, setNotice] = useState<string | null>(null);
  // A toast is a passing note (SESS-024 "starting 3 sessions"); it clears itself.
  const [toast, setToastText] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const setToast = (text: string) => {
    setToastText(text);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastText(null), 4000);
  };
  return { palette, setPalette, notice, setNotice, toast, setToast };
}

// SET-010 / T-248-b: the chords the system menu owns, as menu_sync last reported them. The Shortcuts page reads
// them here, so no other file has to carry them.
let native: NativeChord[] = [];
const nativeWatchers = new Set<() => void>();
function setNative(next: NativeChord[]) {
  if (JSON.stringify(next) === JSON.stringify(native)) return;
  native = next;
  nativeWatchers.forEach((w) => w());
}
export function useNativeChords(): NativeChord[] {
  return useSyncExternalStore(
    (w) => {
      nativeWatchers.add(w);
      return () => void nativeWatchers.delete(w);
    },
    () => native,
    () => native,
  );
}

/** APP-009 Help: opens what a help.* menu click names. */
export function runHelp(what: HelpAction) {
  if (what === "guide") openGuide();
  else if (what === "explore") openExplore();
  else if (what === "updates") requestUpdateCheck();
  else if (what === "about") openAbout(); // VIEW-106
  else window.dispatchEvent(new Event(REPORT_CRASH_EVENT));
}

/** APP-009 / T-248-a: keeps the native menu bar a picture of `state` (rebuilt only when it changes)
 *  and hands every menu click the page carries out to `onAction` with the item id (help.* clicks are
 *  carried out here). */
export function useMenuBar(state: MenuBarState, onAction: (id: string) => void) {
  const act = useRef(onAction);
  act.current = onAction;
  const key = JSON.stringify(state);
  useEffect(() => {
    invoke<unknown>("menu_sync", { state: JSON.parse(key) })
      .then((v) => setNative(readSynced(v).native))
      .catch(() => {}); // a menu that fails to build leaves the last one
  }, [key]);
  useEffect(() => {
    const off = listen<{ id: string }>("menu-action", (e) => {
      const help = helpAction(e.payload.id);
      if (help) runHelp(help);
      else act.current(e.payload.id);
    });
    return () => void off.then((f) => f());
  }, []);
}

/** APP-009: opens the app menu at (x, y) in the window's own pixels (Windows and Linux, where the
 *  frameless window has no native bar to draw it in). */
/** (x, y) in CSS pixels; `zoom` is the interface zoom (SET-019), since the menu opens in window pixels. */
/** The note shown when the menu cannot open (the mark is the only in-window way to File, Edit, View and Help). */
export const APP_MENU_FAILED = "The app menu could not open. Try again, and restart the app if it keeps happening.";

/** `onFail` runs when the menu could not open, so the click is never silent. */
export function popAppMenu(x: number, y: number, zoom = 1, onFail?: () => void) {
  invoke("menu_popup", { x: x * zoom, y: y * zoom }).catch(() => onFail?.());
}
