// The window's state, moved out of App.tsx as it was (cycle 2, the App.tsx split; the T-543 pattern).
// useWindowStore holds the state and the hooks that sat first in the window, in their order;
// useWindowStoreTail the ones after the pull-request rows (scm/usePrRows), which the window still
// calls between the two, so the window's hook and effect order is unchanged.
import type { Pane } from "../App";
import type { AppInfo } from "../app-info";
import { paneAgent, paneStatus } from "../board/chip";
import type { ShellInfo } from "../chrome/LayoutStrip";
import type { Screen } from "../chrome/TopBar";
import { useChrome } from "../chrome/useChrome";
import { useFileMoves } from "../editor/useFileMoves";
import { useKeymap } from "../keys/KeymapContext";
import type { AgentInfo } from "../launch/PlusMenu";
import { FIRST_PASS, defaultAgentId, offeredAgents, type AgentPass } from "../launch/agents";
import { useTeamsHost, withTeams } from "../launch/teams";
import type { Page } from "../projects/ProjectsPanel";
import type { AgentState, RowInfo } from "../projects/rows";
import { useWorkspaces } from "../projects/useWorkspaces";
import { openPageAt, startScreen } from "../settings/general";
import type { SettingsTarget } from "../settings/pages";
import { useAppSettings } from "../settings/useAppSettings";
import { useAgentStatusState } from "../status/useAgentStatus";
import { useAccountSwitcher } from "../switcher/AccountSwitcher";
import type { CodexAccount } from "../terminal/accountChange";
import { groupOf, type Zoom } from "../terminal/grid";
import { marksOf, reviveSaved, type SavedLayout } from "../terminal/layout";
import type { PendingSend, PlanDraft } from "../terminal/planReview";
import type { Zone } from "../terminal/rearrange";
import type { Identity } from "../terminal/shellMarks";
import type { TabColors } from "../terminal/tabColor";
import type { Switcher } from "../terminal/tabCycle";
import { usePlan } from "../usage/plan";
import { installTapReset } from "./inputExtras";
import { applyDensity, installTabWheel } from "./paneChrome";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RunTabs } from "../automations/runTab";
import type { Note, Picked } from "../editor/notes";
import { usePromptScan } from "../status/promptScan";
import { pickWithNotice } from "../switcher/accounts";
import type { Gap } from "../terminal/dividers";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isNarrow, nextLeft, type RightAside } from "./window/narrow";

export function useWindowStore(initial: Record<string, unknown>, layout: SavedLayout | null) {
  const keymap = useKeymap();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [screen, setScreen] = useState<Screen>(() => startScreen(initial)); // SET-037
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false); // T-142: the workspace board
  const [settingsAt, setSettingsAt] = useState<{ target: SettingsTarget | null; n: number }>({ target: null, n: 0 }); // SET-006: a link's page and section
  const [expanded, setExpanded] = useState<number | null>(null); // VIEW-026: the Board card showing its terminal
  const [zoom, setZoom] = useState<Zoom>({}); // TERM-013: each workspace's expanded cell
  const [sidebarOpen, setLeftState] = useState(true);
  // T-699 (DT-C135): every path that opens or toggles the left sidebar (top bar, Ctrl+B, the menu, the palette, the
  // create and rename rows) goes through nextLeft, which in a narrow window closes the right sidebar to make room.
  const rightAside = useRef({} as RightAside); // filled by App.tsx on every render, before any child draws or a key is pressed
  const leftNow = useRef(sidebarOpen);
  leftNow.current = sidebarOpen;
  const setSidebarOpen = useCallback((v: boolean | ((shown: boolean) => boolean)) => setLeftState((leftNow.current = nextLeft(leftNow.current, v, isNarrow(), rightAside.current))), []);
  // DT-17: Automations is a page of its own over the content column, opened from the sidebar;
  // the grid stays mounted (hidden) behind it.
  // SET-028: Model routing opens the same way until Settings > Agents exists.
  const [page, setPage] = useState<Page | null>(() => openPageAt(initial)); // VIEW-011: the page open at quit
  // GIT-004: a half-written commit message per worktree, kept through closing the panel.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // EDIT-033: a bump of explorerFocus moves focus into the explorer's tree.
  const [explorerFocus, setExplorerFocus] = useState(0);
  // VIEW-056: the right sidebar's width while its edge is being dragged; saved when let go.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [dragLeft, setDragLeft] = useState<number | null>(null); // VIEW-050: the left sidebar mid-drag
  // PROJ-067: the saved tabs and layout (already checked against the disk by main.tsx) are the starting state.
  const [panes, setPanes] = useState<Pane[]>(() => layout?.panes.map(reviveSaved) ?? []); // T-543-b: no pane until a workspace is opened
  useFileMoves(setPanes); // EDIT-032: editor tabs follow a renamed or moved file
  const [focused, setFocused] = useState(layout?.focused ?? 0);
  // TERM-040: which tab each cell shows; the focused pane's tab comes to the front, and a cell
  // whose active tab was closed falls back to its last tab.
  const [activeTab, setActiveTab] = useState<Record<number, number>>(layout?.activeTab ?? {});
  // VIEW-015: the session picked on the Agents screen, kept across screen switches.
  const [agentSel, setAgentSel] = useState<number | null>(null);
  useEffect(() => {
    const p = panes.find((x) => x.key === focused);
    if (p) setActiveTab((m) => (m[groupOf(p)] === focused ? m : { ...m, [groupOf(p)]: focused }));
  }, [focused, panes]);
  useEffect(() => {
    recentTabs.current = [focused, ...recentTabs.current.filter((k) => k !== focused)].slice(0, 50);
  }, [focused]);
  // The workspace the grid shows; null is the home group (panes opened in no workspace).
  // TERM-062: a half-finished double tap is forgotten when the window loses focus.
  useEffect(() => installTapReset(), []);
  const [activeDir, setActiveDir] = useState<string | null>(layout?.activeDir ?? null);
  const [running, setRunning] = useState<Record<number, boolean>>({});
  // ACCT-064: the managed Codex accounts and the active one, so panes left on another are asked.
  const [codex, setCodex] = useState<{ active: string | null; accounts: CodexAccount[] }>({ active: null, accounts: [] });
  // ACCT-064: per pane, the active account the user chose to keep away from (asked once per change).
  const [kept, setKept] = useState<Record<number, string | null>>({});
  // T-139-d: per pane, the Codex setup the user chose to keep it on (asked once per change).
  const [keptSetup, setKeptSetup] = useState<Record<number, string>>({});
  useEffect(() => {
    const read = () => void invoke<{ active: string | null; accounts: CodexAccount[] }>("codex_accounts").then((v) => setCodex({ active: v.active, accounts: v.accounts })).catch(() => {});
    read();
    const off = listen("codex-accounts", read);
    return () => void off.then((u) => u()).catch(() => {});
  }, []);
  // SAFE-002..004: the pane whose plan is open for review, and each plan's unsent comments.
  // SAFE-007: the sheet holds the plan it opened with, so it can tell when the pane moved on.
  // T-032-b: `send` is a Request changes still waiting to go out, which the sheet can cancel.
  const [reviewing, setReviewing] = useState<{ key: number; plan: string; cut: boolean; send?: PendingSend } | null>(null);
  const [planDrafts, setPlanDrafts] = useState<Record<string, PlanDraft>>({});
  const plan = usePlan(); // USAGE-002: the plan figures the pills read
  const accountSwitcher = useAccountSwitcher(); // T-548: the account new panes use, for the palette rows and the Board and Tower figures
  const { needs, setNeeds, hook, setHook, stamp, setStamp, turn, setTurn, stale, setStale, context, setContext, crew, setCrew, hookRef, runRef, unreadPanes, setUnreadPanes, unreadDirs, winFocused, markDir } = useAgentStatusState(running);
  const rowRef = useRef<Record<string, RowInfo>>({}); // PROJ-063: each folder's last row state, to keep its `changed` time
  const ptys = useRef<Record<number, number>>({}); // TERM-045: each pane's session id
  const cliFailed = useRef<Record<string, string>>({}); // CLI-026: command-line requests the window could not open
  const [asking, setAsking] = useState<{ keys: number[]; title: string; body: string; confirm?: string } | null>(null);
  // TERM-046: pinned tab keys live in window state, like the strip order (terminal/pin.ts).
  const [pinned, setPinned] = useState<Set<number>>(() => marksOf(layout?.panes ?? []).pinned); // after-list #100: saved with the layout
  const [switcher, setSwitcher] = useState<Switcher | null>(null); // TERM-050: the Ctrl+Tab list while Ctrl is held
  const switcherRef = useRef<Switcher | null>(null);
  switcherRef.current = switcher;
  const [tabMenu, setTabMenu] = useState<{ key: number; top: number; left: number } | null>(null); // TERM-049: the right-clicked tab
  const [tabColors, setTabColors] = useState<TabColors>(() => marksOf(layout?.panes ?? []).colors); // TERM-049: Tab Color, window state like pinned (terminal/tabColor.ts)
  // TERM-015 / TERM-054: what is being dragged (a tab, or a whole cell by its pane header) and where it would land.
  const dragging = useRef<{ tab: number } | { cell: number } | null>(null);
  const [dropHint, setDropHint] = useState<{ group: number; zone?: Zone; tab?: number; half?: "before" | "after" } | null>(null);
  const recentTabs = useRef<number[]>([]); // TERM-044: panes focused, newest first, so a closed tab returns to the one used before it
  // Escape, the arrows and focus for the tab menu are in window/tabMenuKeys.ts (UX lane A): it listens before a focused pane does.
  const [titles, setTitles] = useState<Record<number, string>>({}); // browser tabs' page titles
  const [liveIds, setLiveIds] = useState<Record<number, Identity>>({}); // TERM-058: terminal panes' running program, from the shell marks
  const liveRef = useRef(liveIds);
  liveRef.current = liveIds;
  // Review of PR #16 (d): plain terminal panes whose hand-started agent has gone; their hook words are ignored.
  const muteRef = useRef<Record<number, boolean>>({});
  const [guess, setGuess] = useState<Record<number, AgentState | null>>({}); // T-608: each pane's title guess, as its header shows it
  // T-608: the one status the Board, the Tower, the Inbox, the needs strip and the bell read (board/chip.ts).
  const agentOf = (p: Pane) => paneAgent(p, liveIds[p.key]); // ACCT-050: a hand-started agent counts, as its tab icon shows it
  const statusOf = (p: Pane) => paneStatus(agentOf(p), hook[p.key], guess[p.key], running[p.key]);
  const [allAgents, setAgents] = useState<AgentInfo[]>([]);
  const [agentPass, setAgentPass] = useState<AgentPass>(FIRST_PASS); // SESS-002
  const [shells, setShells] = useState<ShellInfo[]>([]); // SESS-006
  const { settings, setSettings, settingsRead, setSettingsRead, classic } = useAppSettings(initial);
  // TERM-026 pane header density from the saved setting; TERM-057 the wheel over the tab strip scrolls it sideways.
  useEffect(() => void applyDensity(settings), [settings]);
  useEffect(() => installTabWheel(), []);
  // SESS-018: on the New look a new session is chosen on a full-page sheet over the workspace,
  // held here rather than in the grid; Classic keeps the chooser pane (SESS-019).
  const [sheet, setSheet] = useState<Pane | null>(null);
  // SET-027: everywhere but Settings, only agents that are switched on are offered.
  const teamsHost = useTeamsHost();
  const agents = useMemo(() => withTeams(offeredAgents(allAgents, settings), settings, teamsHost), [allAgents, settings, teamsHost]);
  const [dirty, setDirty] = useState<Record<number, boolean>>({}); // EDIT-001: editor tabs with unsaved text
  const [picking, setPicking] = useState<"file" | "markdown" | "change" | "template" | null>(null); // EDIT-036 / EDIT-012 / EDIT-027: which file picker is open
  const defaultId = defaultAgentId(settings);
  const installedIds = agents.filter((a) => a.installed).map((a) => a.id);
  const [renameRequest, setRenameRequest] = useState(0); // T-611: workspace.rename (PROJ-059) asks the sidebar to rename the workspace in front
  const { projects, setProjects, owner, setOwner, names, setNames, refresh, setRefresh, deleteRequest, setDeleteRequest, recentDirs, activeRef, createRequest, setCreateRequest, standIns, setStandIns, createName, setCreateName, hist, setHist } = useWorkspaces(activeDir);
  const [stacked, setStacked] = useState<Record<string, boolean>>(layout?.stacked ?? {}); // TERM-006: a single pane split down makes a stacked pair
  const { palette, setPalette, notice, setNotice, toast, setToast } = useChrome();
  return {
    keymap, info, setInfo, screen, setScreen, settingsOpen, setSettingsOpen, boardOpen, setBoardOpen, settingsAt, setSettingsAt, expanded,
    setExpanded, zoom, setZoom, sidebarOpen, setSidebarOpen, rightAside, page, setPage, drafts, setDrafts, explorerFocus, setExplorerFocus, dragWidth,
    setDragWidth, dragLeft, setDragLeft, panes, setPanes, focused, setFocused, activeTab, setActiveTab, agentSel, setAgentSel, activeDir,
    setActiveDir, running, setRunning, codex, setCodex, kept, setKept, keptSetup, setKeptSetup, reviewing, setReviewing, planDrafts, setPlanDrafts,
    plan, accountSwitcher, needs, setNeeds, hook, setHook, stamp, setStamp, turn, setTurn, stale, setStale, context, setContext, crew, setCrew,
    hookRef, runRef, unreadPanes, setUnreadPanes, unreadDirs, winFocused, markDir, rowRef, ptys, cliFailed, asking, setAsking, pinned, setPinned,
    switcher, setSwitcher, switcherRef, tabMenu, setTabMenu, tabColors, setTabColors, dragging, dropHint, setDropHint, recentTabs, titles, setTitles,
    liveIds, setLiveIds, liveRef, muteRef, guess, setGuess, agentOf, statusOf, allAgents, setAgents, agentPass, setAgentPass, shells, setShells,
    settings, setSettings, settingsRead, setSettingsRead, classic, sheet, setSheet, teamsHost, agents, dirty, setDirty, picking, setPicking,
    defaultId, installedIds, renameRequest, setRenameRequest, projects, setProjects, owner, setOwner, names, setNames, refresh, setRefresh,
    deleteRequest, setDeleteRequest, recentDirs, activeRef, createRequest, setCreateRequest, standIns, setStandIns, createName, setCreateName, hist,
    setHist, stacked, setStacked, palette, setPalette, notice, setNotice, toast, setToast,
  };
}

export type WindowStore = ReturnType<typeof useWindowStore>;

export function useWindowStoreTail({ accountSwitcher, ptys, setNotice }: Pick<WindowStore, "accountSwitcher" | "ptys" | "setNotice">, layout: SavedLayout | null, read: boolean) {
  const switchAccount = useMemo(() => pickWithNotice(accountSwitcher.pick, setNotice), [accountSwitcher.pick, setNotice]); // T-548 FIX-1 (memoised at merge, FIX-3 note): a switch from a key or the palette that fails says why in the notice bar
  const [weights, setWeights] = useState<Record<string, number[]>>({}); // TERM-010: dragged column / row weights, per folder and pane count
  const dragRef = useRef<{ gap: Gap; at: number; start: number[]; px: number } | null>(null);
  const [launching, setLaunching] = useState(false);
  // GIT-042: review notes on Markdown, kept until copied or cleared.
  const [notes, setNotes] = useState<Note[]>([]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [sendMenu, setSendMenu] = useState(false);
  // TERM-027: a Set Title shortcut bumps the pane's counter, which opens its name field.
  const [askName, setAskName] = useState<Record<number, number>>({});
  // TERM-048: the tab whose name is being edited in the tab strip.
  const [renamingTab, setRenamingTab] = useState<number | null>(null);
  // TERM-048: the tab right-click menu, at the pointer.
  // T-597: a window drawn before the saved tabs are back (`read` false) hands out keys no saved tab holds:
  // panes attach to the terminal of their key, and the saved tabs' terminals outlive a quit (APP-052).
  // Those tabs are never saved, and terminal_prune_history drops their history at the next start.
  const nextKey = useRef(layout ? Math.max(1, ...layout.panes.map((p) => p.key)) + 1 : read ? 2 : 1_000_000);
  // TERM-106: the tabs that came back from the saved layout replay their saved output first.
  const restoredKeys = useRef(new Set((layout?.panes ?? []).filter((p) => !p.chooser).map((p) => p.key))); // a chooser has no terminal to wait for
  // ORCH-056 (row 219): open prompts read off each pane's screen mark it waiting (src/status/promptScan.ts).
  usePromptScan(ptys, restoredKeys);
  const runPanes = useRef<Record<string, number>>({});
  const runTabs = useRef<RunTabs>({}); // AUTO-011 (T-085-g): the agent tabs automation runs opened, and whether the user touched them
  return {
    switchAccount, weights, setWeights, dragRef, launching, setLaunching, notes, setNotes, picked, setPicked, sendMenu, setSendMenu, askName,
    setAskName, renamingTab, setRenamingTab, nextKey, restoredKeys, runPanes, runTabs,
  };
}

export type WindowStoreTail = ReturnType<typeof useWindowStoreTail>;
/** Everything the two store hooks hand the window. */
export type WindowState = WindowStore & WindowStoreTail;
