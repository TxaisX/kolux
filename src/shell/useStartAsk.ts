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

export function useStartAsk(o: { settings: Record<string, unknown>; settingsRead: boolean; agentsDone: boolean; launching: boolean; sheetOpen: boolean; firstRun?: boolean; open: () => void }) {
  const { settings, settingsRead, agentsDone, launching, sheetOpen, firstRun } = o;
  const open = useRef(o.open);
  open.current = o.open;
  useEffect(() => {
    const now = askAtOpen({ on: asksAtStart(settings), firstWindow: isFirstWindow(), asked, settingsRead, agentsDone, launching, sheetOpen, firstRun });
    if (now === "wait") return;
    asked = true;
    if (now === "ask") open.current();
  }, [settings, settingsRead, agentsDone, launching, sheetOpen, firstRun]);
}
