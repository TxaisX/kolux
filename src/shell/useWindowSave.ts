// What the window writes down and asks before it closes, moved out of App.tsx as it was (cycle 2, the App.tsx
// split): the open page and the screen (VIEW-011, VIEW-005), another window's screen (VIEW-007), the quit and
// Force Reload questions (VIEW-107, APP-006), the layout writes (PROJ-067, T-075) and back and forward stops
// (VIEW-046). Called where it sat, so the window's hook order is unchanged.
import { screens, type Screen } from "../chrome/TopBar";
import { baseName } from "../editor/buffers";
import { visit } from "../projects/nav";
import { applySetting } from "../projects/settingWrite";
import { useWindowSync } from "../sessions/windowSync";
import { LAST_SCREEN_FIELD, OPEN_PAGE_FIELD, lastWriter, saveLayout } from "../settings/general";
import { saveChanged } from "../settings/saveChanged";
import { asksBeforeClose } from "../terminal/closing";
import { LAYOUT_FIELD, layoutOf, panesWantingListedSession, withListedSession, type SavedLayout } from "../terminal/layout";
import { layoutWriter } from "../terminal/layoutSave";
import { losable, runningAgents, type Losable } from "./closeAsk";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import type { WindowState } from "./windowStore";
import type { Plumbing } from "../settings/useSettingsPlumbing";

/** T-066-e: a pane whose sessions list gave nothing is not asked again for this long; a layout write comes with
 *  every focus move, and each ask runs the agent's own program. */
export const LISTED_ASK_AGAIN_MS = 30_000;

export function useWindowSave({ activeDir, activeTab, classic, dirty, focused, page, panes, pinned, read, running, saveSetting, screen, setHist, setNotice, setPanes, setScreen, setSettings, settings, settingsRead, settingsRef, stacked, tabColors }: Pick<WindowState, "activeDir" | "activeTab" | "classic" | "dirty" | "focused" | "page" | "panes" | "pinned" | "running" | "screen" | "setHist" | "setNotice" | "setPanes" | "setScreen" | "setSettings" | "settings" | "settingsRead" | "stacked" | "tabColors"> & Pick<Plumbing, "saveSetting" | "settingsRef"> & { read: boolean }) {
  // VIEW-011: the open page is written down, so it is shown again after a restart.
  useEffect(() => {
    if ((settings[OPEN_PAGE_FIELD] ?? null) !== page) saveSetting(OPEN_PAGE_FIELD, page);
  }, [page]);
  // VIEW-005: the screen in front is written down too, a burst of switches as one write and a
  // pending one before the window closes. The start screen itself is not written back.
  const screenWriter = useRef(
    lastWriter((s: Screen) => {
      // Row 794-d: moves the ref too, so a saveSetting before the next render keeps the last screen.
      setSettings(applySetting(settingsRef, LAST_SCREEN_FIELD, s).next);
      saveChanged({}, { [LAST_SCREEN_FIELD]: s }).catch((err) => setNotice(String(err)));
    }),
  ).current;
  const shownScreen = useRef(screen);
  useEffect(() => {
    if (shownScreen.current === screen) return;
    shownScreen.current = screen;
    screenWriter.set(screen);
  }, [screen]);
  // VIEW-007: another window changing its screen moves this one too, unless a page (Tasks, Automations, ...)
  // is open here; the followed screen counts as already saved, so it is not written back.
  useWindowSync({
    field: LAST_SCREEN_FIELD,
    valid: screens.map((x) => x.id),
    screen,
    page,
    ready: settingsRead,
    onScreen: (to) => {
      shownScreen.current = to;
      setScreen(classic && (to === "agents" || to === "board") ? "terminals" : to);
    },
  });
  // VIEW-107: closing the window writes what is pending first; unsaved editor text stops the quit
  // and asks, so nothing is lost without the user saying so.
  // T-182 (APP-006): agents still running are asked about too (while TERM-045's switch is on).
  const [quitAsk, setQuitAsk] = useState<Losable | null>(null);
  const [reloadAsking, setReloadAsk] = useState<string[] | null>(null); // Review of PR #16 (a): Force Reload's question
  const unsaved = useRef<string[]>([]);
  unsaved.current = panes.filter((p) => dirty[p.key]).map((p) => baseName(p.path ?? p.title ?? "Untitled"));
  const busyAgents = useRef<string[]>([]);
  busyAgents.current = runningAgents(panes, running, asksBeforeClose(settings));
  const quitting = useRef(false);
  // T-075 (APP-048 / APP-050): a burst of layout changes is one write, and the pending one is
  // flushed before the window closes, so a change made right before quitting is back on relaunch.
  const layoutSaver = useRef(layoutWriter((l: SavedLayout) => saveLayout(l, (v) => saveChanged({}, { [LAYOUT_FIELD]: v })).catch((err) => { setNotice(String(err)); throw err; }))).current;
  useEffect(() => {
    const off = getCurrentWindow().onCloseRequested(async (e) => {
      // T-182 (APP-006): the page answers at once; a page that cannot is closed for by the Rust side.
      void invoke("close_alive").catch(() => {});
      screenWriter.flush();
      const saved = layoutSaver.flush();
      if (quitting.current) {
        // after-list #37: the window closes only once the last layout write has landed (or failed).
        await saved;
        return;
      }
      // APP-007: with "Closing the window keeps Kolux in the tray" on, the window hides instead (tray.rs
      // decides: Windows, option on, tray icon present, no quit under way); nothing is lost, so the
      // unsaved-changes question is skipped. Quit from the tray and File > Exit report `quitting` and
      // go on to the question below, exactly as the close button does.
      const tray = await invoke<{ hid: boolean; quitting: boolean }>("tray_close_requested").catch(() => ({ hid: false, quitting: false }));
      if (tray.hid) {
        e.preventDefault();
        return;
      }
      const l = losable(unsaved.current, busyAgents.current);
      if (l) {
        e.preventDefault();
        setQuitAsk(l);
        return;
      }
      // after-list #37: the window closes only once the last layout write has landed (or failed).
      await saved;
    });
    return () => void off.then((f) => f()).catch(() => {});
  }, []);
  // PROJ-067: the tabs and layout are written down as they change, so they come back after a restart.
  // VIEW-107 (T-069-b): not before the saved tabs are back (`read`): a start that timed out has not put
  // them back, so writing its layout would drop them, even once its own settings read lands (T-597:
  // main.tsx draws the window again with them when the settings answer). A failed write is retried
  // once, then only the durable part is written.
  // T-066-e (SESS-030, source 2): before the layout goes out, a tab of an agent with a sessions command that
  // holds no session id yet is asked for the one the command lists for its folder (terminal_listed_session:
  // the newest one no other pane holds). The id goes on the pane as a listed guess (it may be the folder's
  // previous session: the tab is asked when it is opened, before its agent has made one), so the write that
  // follows carries it and a restart resumes the tab the way a hook-fed one is. The pane is asked again (its
  // own guess left out of its ask) so the session its agent made since replaces the guess, and the id the
  // agent prints itself when it exits wins over it (useCliBridge). One round at a time, the panes in turn,
  // each answer added to `taken` so two panes never get one session; an id the agent named itself is never
  // replaced; a pane is left alone for LISTED_ASK_AGAIN_MS after each ask.
  const askingListed = useRef(false);
  const askedListed = useRef(new Map<number, number>());
  const askListedSessions = (now = Date.now()) => {
    if (askingListed.current) return;
    const want = panesWantingListedSession(panes);
    const asks = want.asks.filter((a) => now - (askedListed.current.get(a.key) ?? -Infinity) >= LISTED_ASK_AGAIN_MS);
    if (asks.length === 0) return;
    askingListed.current = true;
    const taken = [...want.taken];
    void (async () => {
      for (const a of asks) {
        askedListed.current.set(a.key, Date.now());
        const id = await invoke<string | null>("terminal_listed_session", { agent: a.agent, folder: a.folder, taken: taken.filter((t) => t !== a.own) }).catch(() => null);
        if (!id) continue;
        if (!taken.includes(id)) taken.push(id);
        setPanes((ps) => withListedSession(ps, a.key, id));
      }
    })().finally(() => {
      askingListed.current = false;
    });
  };
  useEffect(() => {
    if (!read) return;
    const l = layoutOf(panes, activeTab, focused, activeDir, stacked, { pinned, colors: tabColors });
    if (JSON.stringify(settings[LAYOUT_FIELD] ?? null) === JSON.stringify(l)) return;
    const next = { ...settingsRef.current, [LAYOUT_FIELD]: l };
    settingsRef.current = next;
    setSettings(next);
    layoutSaver.set(l);
    askListedSessions();
  }, [panes, activeTab, focused, activeDir, stacked, pinned, tabColors]);

  // VIEW-046: every workspace and page shown is a stop for back and forward; a step back lands on
  // the place already current, which visit leaves alone.
  useEffect(() => setHist((h) => visit(h, { dir: activeDir, page })), [activeDir, page]);
  return {
    screenWriter, shownScreen, quitAsk, setQuitAsk, reloadAsking, setReloadAsk, unsaved, busyAgents, quitting, layoutSaver,
  };
}

export type WindowSave = ReturnType<typeof useWindowSave>;
