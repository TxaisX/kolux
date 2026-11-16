// Start form D (Txais 2026-11-15): when Kolux starts, the main window asks once which folders to open, how
// many agents and which AI, in front of whatever was restored. The rule is askAtOpen (launch/startForm.ts);
// this hook only feeds it the window's state. "Keep what was open" and Escape close the form and change nothing.
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { askAtOpen, asksAtStart, START_WAIT_MS } from "../launch/startForm";

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
/** Job 47: when the first run of the hook began (the wait's clock), and the switch's last known value, kept across
 *  app starts so a slow start does not ask a user who switched the ask off. Never stored means on. */
let started: number | null = null;
const ON_KEY = "kolux.askWhatToOpen";
const kept = (f: (s: Storage) => unknown) => {
  try {
    return f(localStorage);
  } catch {
    return null;
  }
};
/** Job 47 F1: files the system handed Kolux (App's open-files drain). Their preview panes are not the user acting,
 *  so the pane count the ask reads leaves them out. Paths, not a count: openPreview can reuse an open preview pane. */
const handed = new Set<string>();
export const handOver = (path: string) => void handed.add(path);
export const ownPanes = (ps: { kind?: string; path?: string }[]): number => ps.filter((p) => !(p.kind === "preview" && p.path !== undefined && handed.has(p.path))).length;
/** Tests only. */
export const resetStartAsk = () => void ((asked = false), (started = null), store((s) => s.removeItem(ASKED_KEY)));

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
  firstRun?: boolean; firstRunKnown?: boolean; agentsFailed?: boolean; panes: number; open: () => void; close?: () => void;
}) {
  const { settings, settingsRead, layoutIn, agentsDone, projectsRead, launching, sheetOpen, firstRun, firstRunKnown, agentsFailed, panes } = o;
  const open = useRef(o.open);
  open.current = o.open;
  // Job 57 F3: the form this ask opened, while it is up. A first-run answer that comes after the limit opened it
  // closes it, since setup is drawn next (and hands over to the form itself). A form opened by hand is never closed.
  const close = useRef(o.close);
  close.current = o.close;
  const mine = useRef<"opening" | "up" | null>(null);
  useEffect(() => {
    if (mine.current === "opening" && sheetOpen) mine.current = "up";
    else if (mine.current === "up" && !sheetOpen) mine.current = null;
    if (!firstRun || mine.current === null) return;
    mine.current = null;
    close.current?.();
  }, [firstRun, sheetOpen]);
  // Job 13 F4: the user has moved on: a launch, a form they opened, or a pane added after the settings were read.
  // Job 29 R1: the pane count is taken only once last time's layout is in, so restored panes never count as added.
  const acted = useRef(false);
  const base = useRef<number | null>(null);
  // Job 37 A1: the saved tabs and layoutIn land in one update, so a rise while layoutIn is false is the user's.
  const waitBase = useRef<number | null>(null);
  // Job 47: one timer runs the check again once the limit has passed; the clock is module state, so StrictMode's
  // second mount does not start it over.
  const [late, setLate] = useState(false);
  useEffect(() => {
    started ??= Date.now();
    if (asked) return;
    const t = setTimeout(() => setLate(true), Math.max(0, START_WAIT_MS - (Date.now() - started)));
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (launching || sheetOpen) acted.current = true;
    if (!layoutIn && panes > (waitBase.current ??= panes)) acted.current = true;
    if (base.current === null) base.current = settingsRead && layoutIn ? panes : null;
    else if (panes > base.current) acted.current = true;
    if (settingsRead) kept((s) => s.setItem(ON_KEY, asksAtStart(settings) ? "1" : "0"));
    const on = settingsRead ? asksAtStart(settings) : kept((s) => s.getItem(ON_KEY)) !== "0";
    const waitedOut = late || (started !== null && Date.now() - started >= START_WAIT_MS);
    const now = askAtOpen({ on, firstWindow: isFirstWindow(), asked, settingsRead, layoutIn, agentsDone, projectsRead, launching, sheetOpen, firstRun, firstRunKnown, agentsFailed, userActed: acted.current, waitedOut });
    if (now === "wait") return;
    asked = true;
    store((s) => s.setItem(ASKED_KEY, "1"));
    if (now !== "ask") return;
    mine.current = "opening";
    open.current();
  }, [settings, settingsRead, layoutIn, agentsDone, projectsRead, launching, sheetOpen, firstRun, firstRunKnown, agentsFailed, panes, late]);
}
