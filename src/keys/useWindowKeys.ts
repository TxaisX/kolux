// The window's key handling, moved out of App.tsx as it was (cycle 2, the App.tsx split): the global-scope
// shortcuts (SET-009, SET-014, TERM-030..062, ...) and the Ctrl+Tab switcher's release (TERM-050). The hook sits
// where the two effects sat, so the window's effect order is unchanged; each effect takes the window's values
// for its render from `w` (shell/windowBag.ts) when it runs, as its closure took them in App.tsx.
import type { Pane } from "../App";
import type { WindowBag } from "../shell/windowBag";
import type { Page } from "../projects/ProjectsPanel";
import { needsYou } from "../board/chip";
import { screens, type Screen } from "../chrome/TopBar";
import { SCREEN_OF } from "../chrome/reach";
import { closedPanes, folderKind, paneFor, placement } from "../chrome/reopenTab";
import { isMarkdown } from "../editor/mdFiles";
import { copiers, diffNav, editors } from "../keys/handles";
import { NOTHING_TO_SEND, sendRoute } from "../editor/noteCommands";
import { reviewOn, selections } from "../editor/notes";
import { navTarget, stepAllowed } from "../projects/nav";
import { SHOW_SLEEPING_SETTING, showSleepingFrom } from "../projects/rows";
import { stepZoom, type ZoomStep } from "../settings/zoom";
import { openTabSearch } from "../shell/findTab";
import { cycleTarget } from "../switcher/accounts";
import { cellsOf, groupOf } from "../terminal/grid";
import { editorCloseSet } from "../terminal/pin";
import { nextNeedsYou } from "../terminal/status";
import { chosenTab, cycleTab, openSwitcher, stepSwitcher, switchOrderOf, tabAtDigit, type CycleMode } from "../terminal/tabCycle";
import { panesIn, sameDir, viewOf } from "../workspaces";
import { actionById } from "./actions";
import { forceReload, windowCommand } from "./commands";
import { worktreesOffNote } from "../projects/singleFolder";
import { isTextField } from "../projects/deleting";
import { scopesFor } from "./keyScopes";
import { matchEvent, type KeyLike, type Keymap } from "./keymap";
import { kPalette, richKeyTaken } from "./paletteKey";
import { recording } from "./record";
import { runningCommand } from "./runCommand";
import { tapHit, windowTaps } from "./tapHit";
import { heldByTerminal } from "./terminalPolicy";
import { settingsShown } from "../onboarding/settingsShown";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";

type Root = Pick<ParentNode, "querySelector" | "querySelectorAll">;

export const SHOW_PROJECTS_EVENT = "kolux:show-projects";
/** UX lane C (request from D): Ctrl+W asks the pane first. A pane with its own close path (a warning before it
 * closes) listens for this event on window, calls preventDefault and closes itself. */
export const PANE_CLOSE_EVENT = "kolux:pane-close";
export function paneCloseClaimed(paneId: number): boolean {
  return !window.dispatchEvent(new CustomEvent(PANE_CLOSE_EVENT, { detail: { paneId }, cancelable: true }));
}

/** UX lane C (keyboard F2): a global shortcut waits while a menu, popover or dialog is up (the same overlays as
 *  chrome/fullPage.ts), so Mod+T never opens a tab behind a question. The Settings page is a page, not an overlay, so
 *  only overlays inside it count while it shows; the Ctrl+Tab list's own steps go on.
 *  ponytail: an overlay outside an open Settings page (rare) does not hold keys; collect both roots if it matters. */
// Panels that stay on screen while the user works (an agent's question card, a plan under review, the update card, a docked tip or tour (aria-modal="false"), an
// inline sidebar form: projects (and its found-issues list), source control, the pull request draft) carry role="dialog" too but are not in the way: they hold nothing, so the key a tip names still works.
export const OVERLAYS = '.menu, [role="menu"], [role="dialog"], [aria-modal="true"], .pick-list, .font-list, .popover, .palette';
// A terminal pane's own questions (a dead shell's exit code, Paste N lines?, an account notice) are aria-modal but cover
// only that pane: the rest of the window, and Ctrl+W on that pane, keep working.
export const PANE_LOCAL = ".pane-ask";
export const STAYS_OPEN = '.chat-question, .plan-sheet, .upd-card, [aria-modal="false"], .sb-form, .scm-ask, .found-list';
// Only the app's own chords wait. An editor or explorer chord is the focused pane's or the overlay's own and falls through as before.
const HELD_SCOPES = new Set(["global", "tabs", "terminal"]);
// Of the terminal chords, only the ones this window runs itself wait. The rest (copy, paste, select all, find, clear)
// go to whatever has focus, so Ctrl+V still pastes a link into the worktree palette on the Terminals screen.
export const WINDOW_TERMINAL = new Set([
  "terminal.closePane", "terminal.setTitle", "terminal.clearPaneTitle", "terminal.focusNextPane",
  "terminal.focusPreviousPane", "terminal.expandPane", "terminal.splitRight", "terminal.splitDown",
  "terminal.equalizePaneSizes",
]);
/** Audit F28: the commands that close, end or delete something. While a plain text field has the focus they do not
 *  run, so Ctrl+W typed in a settings box or the palette never closes the pane behind it. R54-01: a command picked
 *  in the palette is no key typed into the field, so it always runs. */
export const CLOSING_KEYS = new Set(["tab.close", "terminal.closePane", "tab.closeAll", "workspace.delete", "sessions.remove"]);
/** The terminal's hidden text area, the code editor and the rich Markdown view are text fields too, but keep their own key rules.
 *  R54-05: so does a terminal's own Find box, part of its pane: Ctrl+W there closes that pane. */
const OWN_KEY_RULES = ".xterm, .cm-editor, .md-rich, .term-find";
export const typingHolds = (id: string, active: Element | null): boolean =>
  !runningCommand() && CLOSING_KEYS.has(id) && isTextField(active) && !active?.closest(OWN_KEY_RULES);

/** The explorer's own Mod+Shift+F listener fires unless a menu or modal dialog holds the chord. It does not test
 *  defaultPrevented: a focused terminal cancels every Kolux chord (the shell never sees it) and the search still opens. */
export const explorerSearchKey = (map: Keymap, e: KeyLike, doc: Root = document): boolean =>
  matchEvent(map, e, ["global"])?.id === "sidebar.search.toggle" && !heldByOverlay("sidebar.search.toggle", false, doc);

// Audit F12: since one grid per project (2026-11-13) the sidebar shows only project folder rows; the old
// main and worktree rows stay in the page but hidden, so keyboard moves walk the folder rows alone.
export const WORKSPACE_ROWS = ".sidebar .proj.folder[data-path]";
/** The top bar's first control that takes focus: a disabled button (the sign-in mark while signed out) is passed over. */
export const CHROME_FIRST = "header[data-tauri-drag-region] button:not(:disabled), header[data-tauri-drag-region] [tabindex='0']";
export const focusChrome = (doc: Pick<ParentNode, "querySelector"> = document): void => doc.querySelector<HTMLElement>(CHROME_FIRST)?.focus();

/** The native menu items that come to the page: Force Reload asks over unsaved editor text; View > Workspace View > Space
 *  (the classic layout has one view, as every other screen item). */
export function menuAction(
  id: string,
  b: { unsaved: { current: readonly string[] }; setReloadAsk: (files: string[]) => void; setScreen: (s: Screen) => void; classic: boolean },
  reload: () => void = () => location.reload(),
): void {
  if (id === "app.forceReload") forceReload(b.unsaved.current, b.setReloadAsk, reload);
  else if (id === "screen.space") b.setScreen(b.classic ? "terminals" : "space");
}

export function heldByOverlay(id: string, switcherOpen: boolean, doc: Root = document): boolean {
  if (switcherOpen && (id === "tab.previousRecent" || id === "tab.nextRecent")) return false;
  const scope = actionById.get(id)?.scope;
  if (scope && !HELD_SCOPES.has(scope)) return false;
  if (scope === "terminal" && !WINDOW_TERMINAL.has(id)) return false;
  const root = doc.querySelector(".settings[role='dialog']") ?? doc;
  return [...root.querySelectorAll(OVERLAYS)].some((el) => {
    const h = el as HTMLElement;
    return h.getClientRects().length > 0 && !h.closest(`[hidden], ${PANE_LOCAL}`) && !h.matches(STAYS_OPEN);
  });
}

/** The next screen in the Agents / Board / Terminals cycle. */
export function nextScreen(s: Screen): Screen {
  return screens[(screens.findIndex((x) => x.id === s) + 1) % screens.length].id;
}

export function useWindowKeys(w: WindowBag) {
  // The listener belongs to the window, not to a render: it is added once and reads the latest
  // bag on each key. Re-subscribing a capture listener every render was the hot path.
  const bag = useRef(w);
  bag.current = w;
  // Global-scope shortcuts are pressed here, wherever focus is; with Terminal first (SET-014) a
  // focused terminal keeps every chord that is not marked safe for terminals. Only actions that exist today do something; the rest are matched and left alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const {
        accountSwitcher, activeDir, activeOf, addChooser, agentPass, agents, classic, closePane, closeTab, defaultId, equalizePanes, expandPane,
        focused, keymap, leavePage, newTab, nextKey, notes, notesFor, openPane, openPreview, orderOf, panes, pinned, recentTabs, removeSession, renamePane,
        right, saveRight, saveSetting, screen, sendNotes, setActiveDir, setAskName, setBoardOpen, setCreateName, setCreateRequest, setDeleteRequest,
        setFocused, setNotice, setPage, setPalette, setPanes, setPicked, setPicking, setReloadAsk, setRenameRequest, setRenamingTab, setScreen, setSendMenu,
        setSettingsAt, setSettingsOpen, setSidebarOpen, setSwitcher, setToast, settings, settingsOpen, showRight, splitPane, statusOf, step, switchAccount,
        switcherRef, terminals, toggleExplorer, unsaved, workDir
      } = bag.current;
      // SET-009: while Settings > Shortcuts records a chord, the press is the recorder's alone.
      if (recording.on) return;
      // VIEW-109 (T-253): while an input method is composing every key is its own, shortcut chords included.
      if (e.isComposing || e.keyCode === 229) return;
      const kind = screen === "terminals" ? panes.find((p) => p.key === focused)?.kind : undefined;
      const inTree = !!document.activeElement?.closest(".explorer"); // the explorer's own keys (EDIT-034) come with T-094-b
      // EDIT-001: in an editor the editor shortcuts come first and terminal ones do not apply;
      // the ones Kolux has no action for yet are left to CodeMirror.
      // SET-009: a modifier tapped twice runs the command bound to "Double+<modifier>" (keys/tapHit.ts).
      const found =
        tapHit(windowTaps, keymap, e) ||
        matchEvent(keymap, e, scopesFor({ screen, kind, inTree })) ||
        // GIT-042: a preview tab takes the one editor shortcut that applies to it.
        (kind === "preview" && [matchEvent(keymap, e, ["editor"])].find((h) => h?.id === "editor.addReviewNote"));
      // T-800: Ctrl+K opens the palette except in a terminal (Clear active pane) and a rich view (the Link box).
      const hit = kPalette(found, keymap, e, document.activeElement);
      if (!hit || heldByTerminal(hit.id, settings) || richKeyTaken(keymap, e, document.activeElement)) return; // F22: Ctrl+B in a rich view is bold
      if (typingHolds(hit.id, document.activeElement)) {
        // F28: the key stays with the text field. R54-04: the webview's own action for it does not run either, except
        // for a key the field edits with (Backspace, Delete, Ctrl+A/C/V/X/Y/Z), which the field keeps.
        if (!/^(Backspace|Delete|[acvxyz])$/i.test(e.key)) e.preventDefault();
        return;
      }
      if (heldByOverlay(hit.id, !!switcherRef.current)) {
        e.preventDefault(); // the overlay's own key handlers still see it; the webview's built-in action does not run
        return;
      }
      const inFront = panesIn(panes, activeDir).some((p) => p.key === focused);
      // T-798 (P4B-01): worktrees are off, so Ctrl+N, rename and delete say so instead of opening a hidden form.
      const offNote = worktreesOffNote(hit.id);
      if (offNote) {
        e.preventDefault();
        setToast(offNote);
        return;
      }
      switch (hit.id) {
        case "focus.chrome":
          // UX lane C: out of a terminal (or anywhere) to the top bar's first control; Tab goes on from there.
          e.preventDefault();
          focusChrome();
          break;
        case "app.settings":
          if (!settingsOpen) setSettingsAt((a) => ({ target: null, n: a.n }));
          setSettingsOpen(true);
          settingsShown(); // 49-ux2: Explore and the Setup Guide step aside
          break;
        case "editor.save": {
          const save = editors.get(focused);
          if (!save) return;
          void save();
          break;
        }
        case "sidebar.explorer.toggle":
          toggleExplorer();
          break;
        case "sidebar.left.toggle":
          setSidebarOpen((o) => !o);
          break;
        case "sidebar.right.toggle":
          if (terminals && right.open) saveRight({ open: false });
          else showRight(right.tab);
          break;
        case "workspace.delete":
          setScreen("terminals");
          setSidebarOpen(true);
          setDeleteRequest((n) => n + 1);
          break;
        case "workspace.create":
          setScreen("terminals");
          setSidebarOpen(true);
          setCreateName("");
          setCreateRequest((n) => n + 1);
          break;
        case "worktree.palette":
          setPalette(true);
          break;
        // PROJ-055 / VIEW-046: keyboard moves follow the sidebar list as shown (a project's main
        // checkout row, then its workspace rows), so folded rows are skipped; the sidebar is
        // brought up first so there is a list to follow.
        case "worktree.navigateUp":
        case "worktree.navigateDown":
        case "workspace.selectByIndex":
        case "sidebar.focusWorktreeList": {
          flushSync(() => {
            setScreen("terminals");
            setSidebarOpen(true);
          });
          const rows = [...document.querySelectorAll<HTMLElement>(WORKSPACE_ROWS)];
          const at = rows.findIndex((r) => r.classList.contains("sel"));
          if (hit.id === "sidebar.focusWorktreeList") {
            // VIEW-050: a sidebar just opened lists its rows a moment later, so look again for up to a second.
            const focusList = (tries: number) => {
              const list = [...document.querySelectorAll<HTMLElement>(WORKSPACE_ROWS)];
              if (list.length) (list.find((r) => r.classList.contains("sel")) ?? list[0]).focus();
              else if (tries > 0) setTimeout(() => focusList(tries - 1), 50);
            };
            focusList(20);
            break;
          }
          const i = navTarget(rows.length, at, hit.id === "workspace.selectByIndex" ? { index: hit.index ?? 0 } : { step: hit.id === "worktree.navigateDown" ? 1 : -1 });
          if (i === null) return;
          rows[i].click();
          rows[i].scrollIntoView({ block: "nearest" });
          break;
        }
        case "worktree.history.back":
        case "worktree.history.forward":
          if (!step(hit.id === "worktree.history.back" ? -1 : 1)) {
            if (settingsOpen) setToast("Close Settings to go back or forward.");
            else if (!stepAllowed(screen === "terminals", settingsOpen)) setToast("Back and Forward work on the Terminals screen.");
            else setToast(hit.id === "worktree.history.back" ? "No earlier workspace to go back to." : "No later workspace to go forward to.");
            return;
          }
          break;
        case "view.cycleWorkspaceView":
          if (classic) setToast("The classic layout has one view; turn it off in Settings > Appearance to switch views.");
          else setScreen((s) => nextScreen(s));
          break;
        case "view.tasks":
        case "view.automations":
        case "view.routing": {
          // UX lane C (palette F2): Automations gets a command (and so a palette row), as Tasks has.
          const page = hit.id.slice(5) as Page; // the id after "view." names the page (T-727 adds routing)
          setScreen("terminals");
          setPage((p) => (terminals && p === page ? null : page));
          break;
        }
        case "sidebar.sleeping.toggle":
          saveSetting(SHOW_SLEEPING_SETTING, !showSleepingFrom(settings[SHOW_SLEEPING_SETTING]));
          break;
        case "workspace.openBoard":
          setBoardOpen((o) => !o);
          break;
        case "account.switchClaude":
        case "account.switchCodex": {
          // T-548: one key moves new panes to the provider's next account (wrapping through System default).
          const group = accountSwitcher.groups.find((g) => g.provider === (hit.id === "account.switchClaude" ? "claude" : "codex"));
          const to = group ? cycleTarget(group) : undefined;
          if (!group || to === undefined) {
            setToast(`No ${hit.id === "account.switchClaude" ? "Claude" : "Codex"} account to switch to. Add one in Settings > Accounts.`);
            return;
          }
          switchAccount(group.provider, to);
          break;
        }
        case "view.code":
          leavePage();
          break;
        case "zoom.in":
        case "zoom.out":
        case "zoom.reset":
          // CHAT-026 (T-334): inside a chat the same chords zoom the chat text; the chat hears them itself.
          if (document.activeElement?.closest(".chat")) return;
          // A terminal is left alone: TERM-078 sizes every terminal from one saved setting, so Mod+= never shrinks one pane.
          break;
        case "ui.zoomIn":
        case "ui.zoomOut":
        case "ui.zoomReset":
          // SET-019 (T-246-c): the saved interface zoom, which has keys of its own apart from the pane zoom above.
          stepZoom(hit.id.slice(7).toLowerCase() as ZoomStep, setToast); // ui.zoomIn / ui.zoomOut / ui.zoomReset
          break;
        case "tab.newTerminal":
          void newTab(null);
          break;
        case "tab.nextSameType":
        case "tab.previousSameType":
        case "tab.nextAllTypes":
        case "tab.previousAllTypes":
        case "tab.nextTerminal":
        case "tab.previousTerminal":
        case "tab.selectByIndex": {
          // TERM-051 / TERM-052: the tabs of the front cell in strip order. C01-R1-01: `hit.index` is
          // already the 1-based position Alt+1..Alt+9 names; adding one selected the next tab (Alt+9, 10).
          const strip = orderOf(focused).map((k) => panes.find((x) => x.key === k)).filter((x): x is Pane => !!x);
          const to =
            hit.id === "tab.selectByIndex"
              ? tabAtDigit(strip, hit.index)
              : cycleTab(strip, focused, hit.id.startsWith("tab.next") ? 1 : -1, (hit.id.endsWith("SameType") ? "same" : hit.id.endsWith("AllTypes") ? "all" : "terminals") as CycleMode);
          if (to === null) return;
          setFocused(to);
          break;
        }
        case "tab.previousRecent": {
          // TERM-050: the first press opens the list on the tab used just before; each press while Ctrl is held steps on, and letting go switches.
          const open = switcherRef.current;
          const next = open ? stepSwitcher(open, 1) : openSwitcher(panesIn(panes, activeDir).map((x) => x.key), recentTabs.current, focused, switchOrderOf(settings));
          if (!next) return;
          setSwitcher(next);
          break;
        }
        case "tab.nextRecent": {
          // AFTER 119: Ctrl+Shift+Tab steps the open switcher back; with it closed it opens on the oldest tab.
          const open = switcherRef.current;
          const first = open ? null : openSwitcher(panesIn(panes, activeDir).map((x) => x.key), recentTabs.current, focused, switchOrderOf(settings));
          const next = open ? stepSwitcher(open, -1) : first ? stepSwitcher({ ...first, at: 0 }, -1) : null;
          if (!next) return;
          setSwitcher(next);
          break;
        }
        case "editor.copyContext":
          if (!copiers.get(focused)?.()) return;
          break;
        case "sourceControl.sendReviewNotes": {
          // GIT-041 (T-034-b): the Markdown notes go through the Send menu; a workspace's line notes
          // are pasted into its agent at once.
          if (!reviewOn(settings)) return;
          // Line notes are kept under the folder their pane runs in, so a worktree's are read and sent from the focused pane's folder.
          const how = sendRoute(true, notes.length, workDir === null ? 0 : notesFor(workDir).length);
          if (how === "menu") setSendMenu(true);
          else if (how === "lines" && workDir !== null) void sendNotes(workDir).then((why) => setToast(why ?? "The review notes were sent to the agent."));
          else setToast(NOTHING_TO_SEND);
          break;
        }
        case "editor.addReviewNote": {
          // EDIT-020: holding the keys adds one note.
          if (e.repeat) break;
          // With nothing selected, or the review tools off, the shortcut does nothing.
          const got = reviewOn(settings) ? selections.get(focused)?.() : null;
          if (!got) return;
          setPicked(got);
          break;
        }
        case "editor.nextChange":
        case "editor.previousChange": {
          const step = diffNav.get(focused);
          if (!step) return;
          step(hit.id === "editor.nextChange" ? 1 : -1);
          break;
        }
        case "editor.markdownPreview": {
          const p = panes.find((x) => x.key === focused);
          if (!p?.path || !isMarkdown(p.path)) return;
          openPreview(p.path);
          break;
        }
        case "worktree.quickOpen":
          if (!activeDir) setToast("Open a workspace to find a file in it.");
          else setPicking("file");
          break;
        case "tab.openMarkdown":
          void newTab("markdown-open");
          break;
        case "tab.newMarkdown":
          void newTab("markdown-new");
          break;
        case "sessions.add":
          addChooser();
          break;
        case "sessions.remove":
          removeSession();
          break;
        case "tab.newAgent": {
          if (agentPass.error) {
            setNotice(`Kolux could not look for agents (${agentPass.error}). Refresh agents, then try again.`);
            break;
          }
          // SET-027 / SESS-010: with no default, the first agent available
          const a = defaultId ? agents.find((x) => x.id === defaultId && x.installed) : agents.find((x) => x.installed);
          if (!a) setNotice(defaultId ? `The default agent (${defaultId}) is not installed or is switched off.` : "No agent is installed and switched on.");
          else void newTab(a);
          break;
        }
        case "tab.close":
        case "terminal.closePane":
          if (!inFront) return;
          if (paneCloseClaimed(focused)) break;
          closePane(focused);
          break;
        case "tab.reopenClosed": {
          // TERM-047: the tab closed last comes back: a terminal in its folder (or the shown workspace when that is gone).
          void closedPanes.take(folderKind, activeDir).then((r) => {
            if (r.kind === "terminal") {
              const key = nextKey.current++;
              const dir = viewOf({ cwd: r.pane.cwd || null, view: r.pane.view }); // DT-C274: the grid it was shown in
              setPanes((ps) => [...ps, paneFor(r.pane, key, placement(ps, focused, dir))]);
              setScreen("terminals");
              if (!sameDir(dir, activeDir)) setActiveDir(dir);
              setFocused(key);
            }
          });
          break;
        }
        case "tab.closeAll": {
          // C01-R4-01: COMPAT's `tab.closeAll` is "Close all editor tabs", so the chord takes the
          // focused strip's editor tabs through one close question and leaves every terminal
          // tab alone. The tab menu's own "Close all" still takes the whole strip.
          if (!inFront) return;
          const editors = editorCloseSet(orderOf(focused), panes, pinned);
          if (editors.length > 0) void closeTab(editors);
          break;
        }
        case "terminals.focusNextNeedsYou": {
          // TERM-030: cycle through the panes waiting on the user in grid order, across workspaces;
          // with none waiting, focus stays where it is. DT-C52: a permission or a question only (the one status).
          const k = nextNeedsYou(panes.map((p) => p.key), new Set(panes.filter((p) => needsYou(statusOf(p))).map((p) => p.key)), focused);
          if (k === null) {
            setToast("Nothing needs you right now.");
            return;
          }
          openPane(k); // EDIT-041: the same jump as Open in Code
          break;
        }
        case "tab.search": // TERM-053
          openTabSearch();
          break;
        case "terminal.setTitle":
        case "terminal.clearPaneTitle":
        case "tab.rename": {
          // TERM-027, TERM-048: name the focused chat or terminal; in a cell with tabs, the tab
          // strip takes the rename, else the pane header does. No default key on Windows.
          const p = inFront ? panes.find((x) => x.key === focused && !x.kind) : undefined;
          if (!p) return;
          if (hit.id === "terminal.clearPaneTitle") {
            if (!p.title) return;
            renamePane(p.key, undefined);
          } else if (hit.id === "tab.rename" && panes.filter((x) => groupOf(x) === groupOf(p)).length > 1) setRenamingTab(p.key);
          else setAskName((m) => ({ ...m, [p.key]: (m[p.key] ?? 0) + 1 }));
          break;
        }
        case "terminal.focusNextPane":
        case "terminal.focusPreviousPane": {
          // TERM-012: the next or previous cell in grid order, wrapping; its tab on top takes focus.
          if (!inFront) return;
          const order = cellsOf(panesIn(panes, activeDir)).map(activeOf);
          const at = cellsOf(panesIn(panes, activeDir)).findIndex((c) => c.panes.some((p) => p.key === focused));
          const t = navTarget(order.length, at, { step: hit.id === "terminal.focusNextPane" ? 1 : -1 });
          if (t === null) return;
          setFocused(order[t]);
          break;
        }
        case "terminal.expandPane":
          if (!inFront) return;
          expandPane(focused);
          break;
        case "terminal.splitRight":
        case "terminal.splitDown":
          if (!inFront) return;
          splitPane(focused, hit.id === "terminal.splitRight" ? "right" : "down");
          break;
        case "terminal.equalizePaneSizes":
          if (!inFront) return;
          equalizePanes();
          break;
        default: {
          // T-610: a command that shows a screen (chrome/reach.ts) toggles it with Terminals.
          const to = SCREEN_OF[hit.id];
          if (to) {
            setScreen((s) => (s === to ? "terminals" : to));
            break;
          }
          // T-611: the commands this switch had no case for (keys/commands.ts).
          if (windowCommand(hit.id, {
            toggleRight: (tab) => (terminals && right.open && right.tab === tab ? saveRight({ open: false }) : showRight(tab)),
            renameWorkspace: () => {
              setScreen("terminals");
              setSidebarOpen(true);
              setRenameRequest((n) => n + 1);
            },
            // Review of PR #16 (a): unsaved editor text is asked about first, in the app's own question, else it reloads at once.
            reload: () => void forceReload(unsaved.current, setReloadAsk, () => location.reload()),
          })) break;
          // TERM-041: one unbound command per installed agent, `tab.newAgent.<id>`.
          const id = hit.id.startsWith("tab.newAgent.") ? hit.id.slice("tab.newAgent.".length) : null;
          const a = id ? agents.find((x) => x.id === id && x.installed) : undefined;
          if (!a) return;
          void newTab(a);
        }
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // UX lane C (menu.rs:229): the menu's Force Reload comes to the page and runs the chord's reload, so unsaved
  // editor text is asked about first instead of being thrown away by a native reload. View > Workspace View > Space
  // lands here too (chrome/chromeItems MENU_SCREENS lists only the switcher screens).
  useEffect(() => {
    const off = listen<{ id: string }>("menu-action", (e) => menuAction(e.payload.id, bag.current));
    // UX lane C (request from D-ux3, editor/AddProjectRow): a folder added while the project list is not shown opens it.
    const showProjects = () => { bag.current.setScreen("terminals"); bag.current.setSidebarOpen(true); };
    window.addEventListener(SHOW_PROJECTS_EVENT, showProjects);
    return () => { void off.then((f) => f()); window.removeEventListener(SHOW_PROJECTS_EVENT, showProjects); };
  }, []);

  // TERM-050: letting go of Ctrl switches to the chosen tab; Escape or leaving the window drops the list.
  useEffect(() => {
    const { setFocused, setSwitcher, switcherRef } = w;
    const done = (go: boolean) => {
      const s = switcherRef.current;
      if (!s) return;
      setSwitcher(null);
      if (go) setFocused(chosenTab(s));
    };
    const up = (e: KeyboardEvent) => e.key === "Control" && done(true);
    const down = (e: KeyboardEvent) => e.key === "Escape" && switcherRef.current && (e.preventDefault(), e.stopPropagation(), done(false));
    const lost = () => done(false);
    window.addEventListener("keyup", up, true);
    window.addEventListener("keydown", down, true);
    window.addEventListener("blur", lost);
    return () => {
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("blur", lost);
    };
  }, []);
}
