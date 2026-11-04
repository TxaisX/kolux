// The window's settings plumbing, moved out of App.tsx as it was (cycle 2, the App.tsx split; the T-543 pattern):
// the settings ref every write builds on, the review notes kept in settings, the right sidebar's state and
// the menu bar. Called where it sat, so the window's hook order is unchanged.
import type { WindowState } from "../shell/windowStore";
import { editChatBox } from "../chat/menuEdit";
import { RIGHT_KEYS, readLeft, readRight, type RightTab } from "../chrome/RightSidebar";
import { menuBarState, menuEdit, menuScreen, menuSettingFlip } from "../chrome/chromeItems";
import { useMenuBar } from "../chrome/useChrome";
import { LINE_NOTES_KEY, lineNotesOf, type LineNote, withLineNotes } from "../editor/diffNotes";
import { useRepoless } from "../editor/fileNotes";
import { DEFAULT_AGENT_KEY } from "../launch/agents";
import { applySetting, rebaseSettings } from "../projects/settingWrite";
import { FOLDER_TAB_KEY, offeredTabs, tabFor } from "../sessions/folderTabs";
import { useWorkspaceKind } from "../sessions/useWorkspaceKind";
import { ABOUT_MENU_ID, openAbout } from "../shell/about";
import { focusedTerminalEdit } from "../terminal/TerminalPane";
import { sameDir } from "../workspaces";
import { saveChanged } from "./saveChanged";
import { stepZoom, type ZoomStep } from "./zoom";
import { useRef } from "react";

export function useSettingsPlumbing({ activeDir, classic, dragLeft, keymap, owner, refresh, screen, setExplorerFocus, setNotice, setScreen, setSettings, setSettingsAt, setSettingsOpen, setSidebarOpen, setToast, settings }: Pick<WindowState, "activeDir" | "classic" | "dragLeft" | "keymap" | "owner" | "refresh" | "screen" | "setExplorerFocus" | "setNotice" | "setScreen" | "setSettings" | "setSettingsAt" | "setSettingsOpen" | "setSidebarOpen" | "setToast" | "settings">) {
  // GIT-040 / GIT-041: review notes on diff lines, kept per workspace in settings. A save that fails
  // puts the notes back as they were and says so.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // GIT-041 (T-034-b): a folder workspace without Git keeps its notes too, made on a file's selection.
  const repoless = useRepoless(activeDir);
  const notesFor = (dir: string | null) => lineNotesOf(settingsRef.current[LINE_NOTES_KEY], dir);
  const saveNotes = (dir: string, notes: LineNote[]) => {
    const was = settingsRef.current;
    const next = { ...was, [LINE_NOTES_KEY]: withLineNotes(was[LINE_NOTES_KEY], dir, notes) };
    settingsRef.current = next;
    setSettings(next);
    saveChanged(was, next).catch((err) => {
      setSettings((s) => ({ ...s, [LINE_NOTES_KEY]: was[LINE_NOTES_KEY] }));
      setToast(`The review note was not saved, so the change was undone: ${String(err)}`);
    });
  };
  const putNote = (dir: string, n: LineNote) => saveNotes(dir, [...notesFor(dir).filter((x) => x.id !== n.id), n]);
  const dropNotes = (dir: string, ids: string[]) => saveNotes(dir, notesFor(dir).filter((x) => !ids.includes(x.id)));
  // Row 794: built on the latest settings, so writes before the next render (Clear filters, then a tick) all land.
  const saveSetting = (key: string, value: unknown) => {
    const { was, next } = applySetting(settingsRef, key, value);
    setSettings(next);
    saveChanged(was, next).catch((err) => setNotice(String(err)));
  };
  // Row 794-b: a page hands back the whole settings it built from its last render; only what it changed lands on the latest.
  const savePageSettings = (rendered: Record<string, unknown>, built: Record<string, unknown>) => {
    const { was, next } = rebaseSettings(settingsRef, rendered, built);
    setSettings(next);
    saveChanged(was, next).catch((err) => setNotice(String(err)));
  };
  // VIEW-056 / VIEW-057 (T-146-a): one right sidebar, its open state, tab and width kept in settings.
  // VIEW-057 (T-146-g): a folder workspace (a project without Git) offers Attached and PR Checks instead of the git tabs.
  const kindProject = activeDir ? (Object.entries(owner).find(([d]) => sameDir(d, activeDir))?.[1] ?? null) : null;
  const wsKind = useWorkspaceKind(kindProject, activeDir, refresh);
  const offeredRight = offeredTabs(wsKind.folder);
  const savedRight = readRight(settings);
  const right = { ...savedRight, tab: tabFor(settings[FOLDER_TAB_KEY], activeDir, savedRight.tab, offeredRight) };
  const leftWidth = dragLeft ?? readLeft(settings);
  const explorerOpen = right.open && right.tab === "explorer";
  const saveRight = (patch: Partial<Record<keyof typeof RIGHT_KEYS, unknown>>) => {
    const was = settingsRef.current;
    const next = { ...was };
    for (const [k, v] of Object.entries(patch)) next[RIGHT_KEYS[k as keyof typeof RIGHT_KEYS]] = v;
    settingsRef.current = next;
    setSettings(next);
    saveChanged(was, next).catch((err) => setNotice(String(err)));
  };
  const showRight = (tab: RightTab) => {
    setScreen("terminals");
    saveRight({ open: true, tab });
  };
  const toggleExplorer = () => {
    if (explorerOpen && document.activeElement?.closest(".explorer")) return saveRight({ open: false });
    showRight("explorer");
    setExplorerFocus((n) => n + 1);
  };
  // APP-009 / T-248-a: the menu mirrors the screen, the look, the chrome switches and the shortcuts;
  // a menu click the page carries out runs the same code as its shortcut.
  useMenuBar(menuBarState(settings, screen, (id) => keymap.bindings.get(id)?.chords, classic), (id) => {
    // CHAT-017: with the chat's message box on screen, Select All and Paste act on it (menuEdit.ts); anything else falls through.
    if ((id === "edit.selectAll" || id === "edit.paste") && editChatBox(id === "edit.paste" ? "paste" : "selectAll", document as never, () => navigator.clipboard.readText())) return;
    const flip = menuSettingFlip(settings, id);
    const to = menuScreen(id);
    const el = document.activeElement;
    const inField = !!el && !el.closest(".xterm") && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable);
    const ed = menuEdit(id, inField);
    if (flip) saveSetting(flip[0], flip[1]);
    else if (to) setScreen(classic ? "terminals" : to);
    else if (ed && "field" in ed) document.execCommand(ed.field);
    else if (ed) focusedTerminalEdit.current?.(ed.terminal);
    else if (id === "zoom.in" || id === "zoom.out" || id === "zoom.reset") stepZoom(id.slice(5) as ZoomStep, setToast);
    else if (id === ABOUT_MENU_ID) openAbout(); // VIEW-106
    else if (id === "app.settings") {
      setSettingsAt((a) => ({ target: null, n: a.n }));
      setSettingsOpen(true);
    } else if (id === "sidebar.left.toggle") setSidebarOpen((o) => !o);
    else if (id === "sidebar.right.toggle") {
      if (screen === "terminals" && right.open) saveRight({ open: false });
      else showRight(right.tab);
    }
    // edit.paste: the core lane's attachPaste paste(). help.*: T-248-b.
  });
  // SESS-004: the default agent is a settings key; the plus menu lists it first.
  const setDefault = (id: string) => saveSetting(DEFAULT_AGENT_KEY, id);
  return {
    settingsRef, repoless, notesFor, saveNotes, putNote, dropNotes, saveSetting, savePageSettings, kindProject, wsKind, offeredRight, savedRight, right,
    leftWidth, explorerOpen, saveRight, showRight, toggleExplorer, setDefault,
  };
}

export type Plumbing = ReturnType<typeof useSettingsPlumbing>;
