// The window: top bar, then the sidebar card beside the content column (layout strip over the
// pane grid), then the status bar. Agents is an empty screen for now; Board lists every pane as
// a card and a card can show its live terminal without moving it (T-011); Terminals holds
// the pane list and the sidebar. The list starts with one PowerShell pane (T-002); the plus
// menu adds an agent pane in a fresh creature-named workspace (T-004). The grid shows one
// workspace at a time; the other workspaces' panes stay mounted but hidden, so switching back
// finds every terminal as it was (T-006). The grid tiles 1..12 cells in balanced rows; the
// layout strip sets the count, a pane splits right or down and closes (T-009, src/terminal/grid.ts).
// A cell holds tabs: Ctrl+T or the strip's "New tab" menu adds a shell or an agent beside the
// focused pane, started in the workspace folder (T-010). A browser tab is a pane whose page is
// a child web view laid over its body by the back end (T-012-a, src/browser/BrowserPane.tsx);
// its shortcuts (bar, back, forward, reload) apply while a browser pane is focused (T-012-b).
// Source Control is a card on the right (Mod+Shift+G, Mod+L or the top bar's panel button): the
// workspace in front's changes, staging and a commit box; its draft message is kept here per
// worktree (T-018-a, src/scm/SourceControlPanel.tsx).
// An editor tab is one file in CodeMirror (T-093-a, src/editor/EditorPane.tsx): "File..." in the
// New tab menu opens one, and Mod+S saves the focused editor while the terminals screen is up.
// Markdown (T-093-b): Mod+Shift+V opens a read-only preview tab, Mod+Shift+O picks one of the
// worktree's markdown files, Mod+Shift+M makes a new untitled note at the worktree root.
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useRenameOnFirstPrompt } from "./projects/renameOnWork";
import { usePrRows } from "./scm/usePrRows";
import { useDesktopDrops } from "./editor/desktopDrops";
import { sendTargets } from "./editor/notes";
import { useCloseGuard } from "./editor/CloseDialog";
import { useSessionNames } from "./sessions/tabTitles";
import { type Agent } from "./chrome/VendorMark";
import { type Kept } from "./inbox/exitedPrompt";
import { type Copies, type Seat, type Shape, type Lineup } from "./launch/seats";
import { panesIn } from "./workspaces";
import { type SavedLayout } from "./terminal/layout";
import { KeymapProvider } from "./keys/KeymapContext";
import { useAgentEvents } from "./status/useAgentStatus";
import { useWindowStore, useWindowStoreTail } from "./shell/windowStore";
import { launchActions } from "./launch/launchActions";
import { paneActions } from "./terminal/paneActions";
import { reviewActions } from "./editor/reviewActions";
import { useWindowSave } from "./shell/useWindowSave";
import { useCliBridge } from "./projects/useCliBridge";
import { useScreens } from "./chrome/useScreens";
import { useStatusSurfaces } from "./status/useStatusSurfaces";
import { paneGrid } from "./terminal/paneGrid";
import { useRailAndTower } from "./agents/useRailAndTower";
import { useLayoutReport } from "./terminal/useLayoutReport";
import { nextScreen, useWindowKeys } from "./keys/useWindowKeys";
import type { WindowBag } from "./shell/windowBag";
import { windowView } from "./shell/WindowView";
import { tabName } from "./terminal/tabName";
import { useWindowStart } from "./shell/useWindowStart";
import { useSettingsPlumbing } from "./settings/useSettingsPlumbing";
import { useWindowChrome } from "./chrome/useWindowChrome";
import { useBrowserChords } from "./browser/useBrowserChords";
import { useRestoredStatus } from "./status/useRestoredStatus";
import { useGone } from "./status/gone";
import { useWorkspaceActions } from "./projects/useWorkspaces";
import { useWizard } from "./onboarding/useWizard";
import { hooksOn } from "./onboarding/hooksOn";
import { startWatch } from "./launch/startWatch";
import { hearStates, setHooksOn } from "./chat/send";

export type ShellTarget = { dir: string | null; branch: string | null };

/** A pane with `seats` is a chooser (SESS-007): nothing runs in it until Start. */
export type Pane = { /** EDIT-026: an editor tab that follows a growing log (read-only). */ follow?: boolean; key: number; cwd: string | null; branch: string | null; agent: Agent; agentId?: string; program: string | null; args: string[]; session?: string; /** T-066-e: `session` is the agent's sessions list's guess, not the agent's own word (terminal/layout.ts). */ sessionListed?: boolean; forkOf?: string; resumed?: boolean; env?: [string, string][]; account?: string | null; /** T-139-d: the Codex setup (command, arguments, variables, permissions) it started with. */ setup?: string; seats?: Seat[]; copies?: Copies; shape?: Shape; task?: string; title?: string; word?: string; batch?: number; typed?: string; group?: number; kind?: "browser" | "editor" | "preview" | "diff" | "changes"; path?: string; url?: string; staged?: boolean; ask?: string; preview?: boolean; jump?: { line: number; at: number; col?: number; side?: "old" } };

/** Columns for a pane count: 1, side by side for 2, two rows for 3-4, then three across. */
/** `initial`: the settings read before the first frame (main.tsx), so the first screen is right at once. */
export default function App({ initial = {}, layout = null, read = true }: { initial?: Record<string, unknown>; layout?: SavedLayout | null; read?: boolean }) {
  return (
    <KeymapProvider>
      <Window initial={initial} layout={layout} read={read} />
    </KeymapProvider>
  );
}

/** The next screen in the Agents / Board / Terminals cycle (keys/useWindowKeys.ts). */
export { nextScreen };

function Window({ initial, layout, read }: { initial: Record<string, unknown>; layout: SavedLayout | null; read: boolean }) {
  // Cycle 2: everything this render makes, filled at the end; the actions, the key handler and the drawing read it (shell/windowBag.ts).
  const w = {} as WindowBag;
  // The window's state and its first hooks, in their order (shell/windowStore.ts).
  const store = useWindowStore(initial, layout);
  const {
    keymap, info, setInfo, screen, setScreen, settingsOpen, setSettingsOpen, setSettingsAt, zoom, setSidebarOpen, page, setPage, setExplorerFocus, dragLeft,
    panes, setPanes, focused, setFocused, activeTab, setActiveTab, agentSel, setAgentSel, activeDir, setActiveDir, running, reviewing, plan, accountSwitcher,
    needs, hook, setHook, stamp, setStamp, turn, setTurn, stale, setStale, context, setContext, setCrew, hookRef, unreadPanes, setUnreadPanes, winFocused,
    markDir, rowRef, ptys, cliFailed, pinned, tabColors, titles, setTitles, liveIds, muteRef, guess, agentOf, statusOf, setAgents, agentPass, setAgentPass,
    setShells, settings, setSettings, settingsRead, setSettingsRead, classic, agents, dirty, installedIds, owner, refresh, setRefresh, recentDirs, activeRef,
    setHist, stacked, setStacked, palette, setNotice, setToast
  } = store;
  const prRows = usePrRows(palette, (dir) => { setScreen("terminals"); select(dir, null); }); // VIEW-043: pull requests found by number or title, with their checks
  // The rest of the window's state (shell/windowStore.ts), after the pull-request rows.
  const tail = useWindowStoreTail({ accountSwitcher, ptys, setNotice }, layout, read);
  const { weights, setWeights, dragRef, sendMenu, nextKey, runPanes, runTabs } = tail;
  const state = { ...store, ...tail };

  // App info, agents, shells and settings, read at start (shell/useWindowStart.ts).
  const start = useWindowStart({
    activeDir, agentPass, focused, installedIds, nextKey, panes, setAgentPass, setAgents, setFocused, setInfo, setPanes, setSettings, setSettingsRead,
    setShells
  });
  // The settings writes, review notes, the right sidebar and the menu bar (settings/useSettingsPlumbing.ts).
  const plumb = useSettingsPlumbing({
    activeDir, classic, dragLeft, keymap, owner, refresh, screen, setExplorerFocus, setNotice, setScreen, setSettings, setSettingsAt, setSettingsOpen,
    setSidebarOpen, setToast, settings
  });
  const { settingsRef, saveSetting } = plumb;
  // The title's waiting count, page titles, the shortcuts notice, Classic and Settings links (chrome/useWindowChrome.ts).
  const chrome = useWindowChrome({ classic, info, keymap, needs, panes, setNotice, setScreen, setSettingsAt, setSettingsOpen, setTitles, statusOf });

  // BROW-003, BROW-005: the browser chords (browser/useBrowserChords.ts).
  const chords = useBrowserChords({ setFocused });

  // The global shortcuts and the Ctrl+Tab switcher (keys/useWindowKeys.ts), read from `w` when they run.
  useWindowKeys(w);

  // The launch and pane actions (launch/launchActions.ts, terminal/paneActions.ts).
  const launchA = launchActions(state, plumb, w);
  const { startIn, runSetup, gateSetup } = launchA;
  const paneA = paneActions(state, plumb, launchA, { prRows }, w);
  const { openFile, openDiff, openPreview, splitPane, keyOfHandle, termCreate, termSwitch, termRename, dropPane, closeTab, leavePage, openPane } = paneA;
  // EDIT-039: a file dragged in from the desktop opens here; a folder on the project list is added there.
  useDesktopDrops((path) => openFile(path), setToast);

  // APP-019: markdown files the system handed to the app open as previews, at start and on each later ask.
  const openFiles = useRef(openPreview);
  openFiles.current = openPreview;
  useEffect(() => {
    const drain = () => void invoke<string[]>("open_files_take").then((fs) => fs.forEach((f) => openFiles.current(f))).catch(() => undefined);
    const off = listen("open-files", drain);
    drain();
    return () => void off.then((f) => f()).catch(() => undefined);
  }, []);

  // SESS-021: a lineup is kept per project once one of its agent seats has really started (its
  // pane reports a running program); until then it waits here under its batch.
  const pendingLineup = useRef<Record<number, { pid: string; lineup: Lineup }>>({});

  // SESS-005 (T-163): every shown agent pane is watched for a terminal process from the moment it
  // is shown; onPty marks it seen, and a pane with none after five seconds gets a warning toast.
  useEffect(() => {
    const here = panesIn(panes, activeDir).filter((p) => p.agentId && p.program && !p.seats && !p.kind);
    startWatch.prune(here.map((p) => p.key));
    for (const p of here) startWatch.arm(p.key, agents.find((a) => a.id === p.agentId)?.name ?? String(p.agentId), setToast);
  }, [panes, activeDir, agents]);
  // STAT-039 (T-110-b): a prompt typed into an agent started without one names the branch too.
  useRenameOnFirstPrompt((key) => panes.find((p) => p.key === key)?.cwd ?? undefined, settings);
  // VIEW-093 (T-127-b): an agent tab takes its session's name (the user's own tab name still wins).
  useSessionNames(panes);
  const workspaceActions = useWorkspaceActions({ panes, setPanes, setFocused, setActiveDir, setStacked, nextKey, settings, screen, setScreen, setPage, owner, recentDirs, activeRef });
  const { startSetup, select, removed } = workspaceActions;
  const setupExits = useRef<Record<number, (code: number | null) => void>>({});
  // The page, screen and layout writes, and the quit question (shell/useWindowSave.ts).
  const save = useWindowSave({
    activeDir, activeTab, classic, dirty, focused, page, panes, pinned, read, running, saveSetting, screen, setHist, setNotice, setPanes, setScreen, setSettings,
    settings, settingsRead, settingsRef, stacked, tabColors
  });

  // The command line's requests: files, terminals, workspaces, worker starts (projects/useCliBridge.ts).
  const cliBridge = useCliBridge({
    activeDir, activeRef, agents, dropPane, focused, gateSetup, keyOfHandle, openDiff, openFile, pinned, ptys, removed, runPanes, runSetup, runTabs, select,
    setPanes, setRefresh, setupExits, splitPane, startIn, startSetup, termCreate, termRename, termSwitch
  });

  const wizardState = useWizard({ setToast, agents, settings, activeDir, startIn });

  useEffect(() => void hearStates(listen).catch(() => {}), []);
  // Stand-in review of 1e9613e, FIX-SOON 2: hooks off in Settings drop the chat's readings.
  useEffect(() => setHooksOn(hooksOn(settings)), [settings]);

  // T-035-b: the question or permission a program left open when it exited; only the Inbox reads it (inbox/exitedPrompt).
  const exitedPrompt = useRef<Kept>({});

  const guard = useCloseGuard({ panes, dirty, close: (keys) => void closeTab(keys, true), toast: setToast });

  // The screen in front, tab labels, the clock and full pages (chrome/useScreens.tsx).
  const screenState = useScreens({ classic, hook, leavePage, liveIds, page, panes, ptys, screen, settings, settingsOpen, titles });
  const { terminals, board, agentsScreen, now } = screenState;
  // The Inbox's sources and the sidebar rows' states (status/useStatusSurfaces.ts).
  const surfaces = useStatusSurfaces({ agentOf, exitedPrompt, hook, liveIds, panes, rowRef, running, settings, stamp, statusOf, titles });
  // The grid's cells, weights, dividers and the needs strip (terminal/paneGrid.ts).
  const grid = paneGrid({ activeDir, activeTab, dragRef, panes, setActiveTab, setFocused, setPanes, setWeights, settings, stacked, statusOf, terminals, weights, zoom });
  const { cells, activeOf } = grid;
  // The Agents rail, the Board's chips and lanes and the Tower (agents/useRailAndTower.ts).
  const rail = useRailAndTower({
    accountSwitcher, agentOf, agentSel, agents, agentsScreen, board, context, guess, hook, liveIds, now, openPane, panes, plan, running, setAgentSel, settings,
    stale, stamp, statusOf, titles, turn
  });
  // Answers, the plan sheet and review notes (editor/reviewActions.ts).
  const reviewA = reviewActions(state, plumb, launchA, w);
  const { inWorktree } = reviewA;
  const reviewTargets = sendMenu ? sendTargets(panes, inWorktree, stamp, Date.now(), (p) => tabName(p, titles)) : [];
  const reviewPane = reviewing && panes.find((p) => p.key === reviewing.key);
  // What is in view, and the layout report for the command line (terminal/useLayoutReport.ts).
  const layoutReport = useLayoutReport({ activeDir, activeOf, board, cells, cliFailed, ptys, terminals, titles });
  const { inView } = layoutReport;
  const { noticed, panesRef } = useAgentEvents({ panes, setPanes, titles, settings, inView, setToast, tabName, setCrew, setTurn, setStale, hookRef, setHook, stamp, setStamp, setContext, unreadPanes, setUnreadPanes, winFocused, markDir, muted: muteRef });
  useRestoredStatus({ panes, hookRef, setHook, setStale, setCrew, setTurn });
  useGone({ panes, running, hook, setHook, setTurn, setCrew }); // STAT-031 / T-275: gone agents stop reporting
  // STAT-044: a clicked notification focuses the pane that raised it (notification_clicked emits the pane).
  useEffect(() => {
    const off = listen<{ pane: string }>("notification-click", (e) => {
      const key = Number(e.payload.pane);
      if (panesRef.current.some((x) => x.key === key)) setFocused(key);
    });
    return () => {
      void off.then((f) => f());
    };
  }, [panesRef]);
  // Cycle 2: everything this render made, for the actions, the key handler and the drawing (shell/windowBag.ts).
  const bag: WindowBag = {
    ...state, ...plumb, ...chrome, ...start, ...chords, ...launchA, ...paneA, ...reviewA, ...workspaceActions, ...save, ...cliBridge, ...wizardState,
    ...screenState, ...surfaces, ...grid, ...rail, ...layoutReport, prRows, noticed, reviewTargets, reviewPane, pendingLineup, setupExits, exitedPrompt, guard, panesRef,
  };
  Object.assign(w, bag);
  // The drawing (shell/WindowView.tsx).
  return windowView(w);
}
