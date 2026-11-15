// Start form D (Txais 2026-11-15): when Kolux starts, the main window asks once which folders to open, how
// many agents and which AI, in front of whatever was restored. The rule is askAtOpen (launch/startForm.ts);
// this hook only feeds it the window's state. "Keep what was open" and Escape close the form and change nothing.
import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { askAtOpen, asksAtStart } from "../launch/startForm";

/** Once per app start: module state lives as long as the webview, so a second window never asks again. */
let asked = false;
/** Tests only. */
export const resetStartAsk = () => void (asked = false);

/** The first window is the one Tauri labels "main" (TowerWindow uses the same label). */
export function isFirstWindow(): boolean {
  try {
    return getCurrentWindow().label === "main";
  } catch {
    return true; // outside Tauri (tests, the browser preview) there is one window
  }
}

export function useStartAsk(o: {
  settings: Record<string, unknown>; settingsRead: boolean; agentsDone: boolean; projectsRead: boolean; launching: boolean; sheetOpen: boolean;
  firstRun?: boolean; firstRunKnown?: boolean; agentsFailed?: boolean; panes?: number; open: () => void;
}) {
  const { settings, settingsRead, agentsDone, projectsRead, launching, sheetOpen, firstRun, firstRunKnown, agentsFailed, panes = 0 } = o;
  const open = useRef(o.open);
  open.current = o.open;
  // Job 13 F4: the user has moved on: a launch, a form they opened, or a pane added after the settings were read.
  const acted = useRef(false);
  const base = useRef<number | null>(null);
  useEffect(() => {
    if (launching || sheetOpen) acted.current = true;
    if (base.current === null) base.current = settingsRead ? panes : null;
    else if (panes > base.current) acted.current = true;
    const now = askAtOpen({ on: asksAtStart(settings), firstWindow: isFirstWindow(), asked, settingsRead, agentsDone, projectsRead, launching, sheetOpen, firstRun, firstRunKnown, agentsFailed, userActed: acted.current });
    if (now === "wait") return;
    asked = true;
    if (now === "ask") open.current();
  }, [settings, settingsRead, agentsDone, projectsRead, launching, sheetOpen, firstRun, firstRunKnown, agentsFailed, panes]);
}
