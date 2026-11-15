// Start form D (Txais 2026-11-15): when Kolux starts, the main window asks once which folders to open, how
// many agents and which AI, in front of whatever was restored. The rule is askAtOpen (launch/startForm.ts);
// this hook only feeds it the window's state. "Keep what was open" and Escape close the form and change nothing.
import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { askAtOpen, asksAtStart } from "../launch/startForm";

/** Once per app start: module state lives as long as the webview, so a second window never asks again. A page reload
 *  in the same run keeps the answer in sessionStorage (job 13 F5); storage that is refused only loses that. */
const ASKED_KEY = "kolux.startAsked";
const store = (f: (s: Storage) => unknown) => {
  try {
    return f(sessionStorage);
  } catch {
    return null;
  }
};
let asked = store((s) => s.getItem(ASKED_KEY)) === "1";
/** Tests only. */
export const resetStartAsk = () => void ((asked = false), store((s) => s.removeItem(ASKED_KEY)));

/** The first window is the one Tauri labels "main" (TowerWindow uses the same label). */
export function isFirstWindow(): boolean {
  try {
    return getCurrentWindow().label === "main";
  } catch {
    return true; // outside Tauri (tests, the browser preview) there is one window
  }
}

export function useStartAsk(o: {
  settings: Record<string, unknown>; settingsRead: boolean; layoutIn: boolean; agentsDone: boolean; projectsRead: boolean; launching: boolean; sheetOpen: boolean;
  firstRun?: boolean; firstRunKnown?: boolean; agentsFailed?: boolean; panes: number; open: () => void;
}) {
  const { settings, settingsRead, layoutIn, agentsDone, projectsRead, launching, sheetOpen, firstRun, firstRunKnown, agentsFailed, panes } = o;
  const open = useRef(o.open);
  open.current = o.open;
  // Job 13 F4: the user has moved on: a launch, a form they opened, or a pane added after the settings were read.
  // Job 29 R1: the pane count is taken only once last time's layout is in, so restored panes never count as added.
  const acted = useRef(false);
  const base = useRef<number | null>(null);
  // Job 37 A1: the saved tabs and layoutIn land in one update, so a rise while layoutIn is false is the user's.
  const waitBase = useRef<number | null>(null);
  useEffect(() => {
    if (launching || sheetOpen) acted.current = true;
    if (!layoutIn && panes > (waitBase.current ??= panes)) acted.current = true;
    if (base.current === null) base.current = settingsRead && layoutIn ? panes : null;
    else if (panes > base.current) acted.current = true;
    const now = askAtOpen({ on: asksAtStart(settings), firstWindow: isFirstWindow(), asked, settingsRead, layoutIn, agentsDone, projectsRead, launching, sheetOpen, firstRun, firstRunKnown, agentsFailed, userActed: acted.current });
    if (now === "wait") return;
    asked = true;
    store((s) => s.setItem(ASKED_KEY, "1"));
    if (now === "ask") open.current();
  }, [settings, settingsRead, layoutIn, agentsDone, projectsRead, launching, sheetOpen, firstRun, firstRunKnown, agentsFailed, panes]);
}
