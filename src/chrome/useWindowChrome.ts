// The window's small chrome effects, moved out of App.tsx as they were (cycle 2, the App.tsx split): the
// waiting count in the title, the shortcuts file's notice, Classic's one screen
// and Settings links. Called where they sat, so the window's hook order is unchanged.
import type { WindowState } from "../shell/windowStore";
import { windowTitle } from "../app-info";
import { ringsBell } from "../status/chip";
import { OPEN_SETTINGS, type SettingsTarget } from "../settings/pages";
import { needsYouCount } from "../terminal/status";
import { useEffect } from "react";

export function useWindowChrome({ classic, info, keymap, needs, panes, setNotice, setScreen, setSettingsAt, setSettingsOpen, statusOf }: Pick<WindowState, "classic" | "info" | "keymap" | "needs" | "panes" | "setNotice" | "setScreen" | "setSettingsAt" | "setSettingsOpen" | "statusOf">) {
  // ux fix 2: one count of waiting panes feeds the window title. Review of PR #16: a stop (blocked, interrupted) still counts, as on main.
  // Review of PR #16 (c): the bell also rings for a pane whose header flags it, a failed start included, as on main.
  const needing = needsYouCount(panes.map((p) => p.key), new Set(panes.filter((p) => ringsBell(statusOf(p), needs[p.key] ?? false)).map((p) => p.key)));
  useEffect(() => {
    document.title = windowTitle(info, needing);
  }, [info, needing]);

  // T-005: the shortcuts file is read at start; what it got wrong is said once, in the notice.
  const keymapNotice = keymap.errors.join(" ");
  useEffect(() => {
    if (keymapNotice) setNotice(keymapNotice);
  }, [keymapNotice]);
  // SET-037: under Classic there is only the Terminals screen.
  useEffect(() => {
    if (classic) setScreen("terminals");
  }, [classic]);
  // SET-006: a link anywhere in the app opens Settings at its page and section.
  useEffect(() => {
    const open = (e: Event) => {
      setSettingsAt((a) => ({ target: (e as CustomEvent<SettingsTarget>).detail, n: a.n + 1 }));
      setSettingsOpen(true);
    };
    window.addEventListener(OPEN_SETTINGS, open);
    return () => window.removeEventListener(OPEN_SETTINGS, open);
  }, []);
  return {
    needing, keymapNotice,
  };
}

export type WindowChrome = ReturnType<typeof useWindowChrome>;
