// The window's pane and tab actions, moved out of App.tsx as they were (cycle 2, the App.tsx split): new tabs,
// files, diffs and previews (TERM-040, EDIT-001/012/027), the cell count and splits (TERM-001/006/013), back
// and forward (VIEW-046), the palette's rows (PROJ-057), the command line's terminal requests (CLI-026),
// closing and moving tabs (TERM-014/044/045/054), Open in Code (EDIT-041). A plain function the window calls
// each render, as the closures were made each render; what the window makes later in its render is read
// from `late` when an action runs (shell/windowLate.ts).
import type { Pane } from "../App";
import type { WindowState } from "../shell/windowStore";
import type { useSettingsPlumbing } from "../settings/useSettingsPlumbing";
import type { launchActions } from "../launch/launchActions";
import type { WindowLate } from "../shell/windowLate";
import { forgetRunTab, runPaneKey } from "../automations/runTab";
import { needsYou } from "../board/chip";
import { reviewTab } from "../board/review";
import { openExternal } from "../open/openExternal";
import { fileJump } from "../chat/chatLinks";
import { savedArgs } from "../chat/controls";
import type { NewTab } from "./newTab";
import { screenRows } from "../chrome/reach";
import { closedPanes } from "../chrome/reopenTab";
import { keyOf } from "../editor/buffers";
import { missingFileToast } from "../editor/missingFile";
import type { Action } from "../editor/noteLinks";
import { trashUnusedNotes } from "../editor/trashUnused";
import { discardDraftsOf } from "../editor/useFileMoves";
import { onClose } from "../inbox/exitedPrompt";
import { dirsToClear } from "../notify/seen";
import { commandRows } from "../keys/commands";
import { runCommand } from "../keys/runCommand";
import { actionById } from "../keys/actions";
import { openTabSearch, TAB_SEARCH_ACTION } from "../shell/findTab";
import { paneMark } from "../launch/PlusMenu";
import { seatDefault, seatStart } from "../launch/defaultSeat";
import { removeShortcutAsk } from "../launch/removeAsk";
import { emptySeat, offeredLineup, removeTarget, sheetStart, type Seat, withoutFailed } from "../launch/seats";
import { lastStart, prefill, stripAsk, type StartSheet } from "../launch/startForm";
import { startWatch } from "../launch/startWatch";
import type { Page } from "../projects/ProjectsPanel";
import { projectRows } from "./projectRows";
import type { PaletteItem } from "../projects/WorktreePalette";
import { folderName } from "../projects/model";
import { stepAllowed, travel, type Place } from "../projects/nav";
import { findCheckPane, type CheckRef } from "../scm/checkCard";
import { DIFF_SPLIT_KEY, diffSplitOf, targetCell } from "../scm/split";
import { PAGES, openSettings, type PageId } from "../settings/pages";
import { toggleSkills } from "../skills/nav";
import { paletteRows } from "../switcher/accounts";
import { focusIn, panesIn, sameDir, underDir, viewOf } from "../workspaces";
import { startDirOf } from "../projects/worktreeGrid";
import { teamViewOf } from "../projects/rows";
import type { PaneNotice } from "./TerminalPane";
import { accountLabel, accountPrompt, codexSetup, setupChanged } from "./accountChange";
import { asksBeforeClose, busyCheck, closeQuestion } from "./closing";
import { MAX_PANES, blocking, canExpand, cellsOf, columnsFor, groupOf, insertBefore, resizePlan, splitIndex, toggleZoom } from "./grid";
import { closeOne, pinQuestion, stripOrderOf } from "./pin";
import { cancelHandOver, handOver, movedKeys } from "./handover";
import { dropCell, dropTab, type Zone } from "./rearrange";
import { classify, removePlan, shellInAgentPane } from "./remove";
import { returnTab } from "./tabClose";
import { forgetColors } from "./tabColor";
import { tabName, type StartLine } from "./tabName";
import { splitTabOut } from "./tabSplit";
import { tabBadge } from "./tabs";
import { forgetView } from "./viewKeep";
import { invoke } from "@tauri-apps/api/core";
import { singleFolder } from "../projects/singleFolder";

/** Other words that find a Settings page in the palette. */
const SETTINGS_WORDS: Partial<Record<PageId, string>> = { appearance: "theme dark light colours colors font" };

export function paneActions(s: WindowState, _plumb: ReturnType<typeof useSettingsPlumbing>, la: ReturnType<typeof launchActions>, late: WindowLate) {
  const {
    accountSwitcher, activeDir, workDir, activeTab, asking, classic, cliFailed, codex, dirty, focused, hist, hook, installedIds, kept, keptSetup, keymap, nextKey,
    owner, panes, pinned, ptys, recentDirs, recentTabs, restoredKeys, runPanes, runTabs, running, screen, setActiveDir, setActiveTab, setAgentSel, setAsking, setCreateName,
    setCreateRequest, setDeleteRequest, setDirty, setFocused, setHist, setKept, setKeptSetup, setNotice, setPage, setPanes, setPicking, setRunning, setScreen,
    setSettingsOpen, setSheet, setSidebarOpen, setStacked, setTabColors, setToast, setZoom, settings, settingsOpen, stamp, statusOf, switchAccount, titles,
    unreadPanes, setUnreadPanes, markDir
  } = s;
  const { inGitFor, launch, lineupsOf, pretrust, projectFor } = la;
  const addShell = (dir: string | null, branch: string | null) => {
    const key = nextKey.current++;
    setPanes((ps) => [...ps, { key, cwd: dir, branch, agent: "shell", program: null, args: [] }]);
    setFocused(key);
  };

  // SESS-007: a pane that asks what to run, in the workspace in front. SESS-008: a grid holds
  // up to MAX_PANES.
  const addChooser = () => {
    if (cellsOf(panesIn(panes, activeDir)).length >= MAX_PANES) return setToast(`A workspace holds up to ${MAX_PANES} panes.`);
    if (!classic) return openStart({ here: true });
    const key = nextKey.current++;
    setPanes((ps) => [...ps, { key, cwd: startDirOf(activeDir), branch: null, agent: "shell", program: null, args: [], seats: [emptySeat()] }]);
    setFocused(key);
  };
  // Start form (2026-11-15): the one form for every pane, opened prefilled (rule F): the folders and count of the last
  // Start, the AI, model and effort of the first folder's last lineup. `here` ticks the project in front instead;
  // `count` is the layout strip's empty cells (rule E); `atOpen` is the ask at app open (rule D).
  const openStart = (o: { here?: boolean; count?: number; atOpen?: boolean } = {}) => {
    const pid = late.projectOf(activeDir) ?? null;
    const lineups = lineupsOf(settings);
    const base = { projects: s.projects, folders: o.here ? (pid ? [pid] : []) : null, count: o.count ?? null, last: lastStart(settings), installed: installedIds };
    const first = prefill({ ...base, lineup: null }).folders[0] ?? projectFor(null) ?? "";
    const lineup = offeredLineup(lineups[first], installedIds);
    const f = prefill({ ...base, lineup });
    const proj = s.projects.find((p) => p.id === f.folders[0]);
    const cwd = proj && pid !== proj.id ? proj.path : startDirOf(activeDir);
    const at: Pane = { key: 0, cwd, branch: null, agent: "shell", program: null, args: [] };
    const copies = sheetStart(lineups[first], inGitFor(at)).copies;
    const next: StartSheet = { ...at, key: nextKey.current++, seats: f.seats, shape: f.shape, copies, folders: f.folders, atOpen: o.atOpen };
    setSheet(next);
  };
  // VIEW-036 / SESS-008: the remove-session shortcut closes the newest chooser pane in front, else the focused
  // session, and always asks first (launch/removeAsk.ts), an empty chooser too. A lone chooser stays, so the
  // grid never drops below one pane.
  const removeSession = async () => {
    const t = removeTarget(panesIn(panes, activeDir), focused);
    if (!t) return;
    const pane = panes.find((p) => p.key === t.key);
    if (!pane) return;
    // TERM-003: what the pane holds only changes the wording; the shortcut asks for every kind.
    const id = ptys.current[t.key];
    const busy = t.chooser || id === undefined ? false : ((await invoke<boolean[]>("terminal_busy", { ids: [id] }).catch(() => [false]))[0] ?? false);
    const kind = t.chooser ? "unstarted" : classify(pane, busy, running[t.key], shellInAgentPane.has(t.key)); // T-151-c: an ended agent pane reads as ended; a still-starting one (undefined) as running; an agent pane running a shell as a shell
    // TERM-003: "Stop without asking" (Settings > Terminal) stops a started session straight away; otherwise it asks.
    if (removePlan(settings, kind) === "stop") return dropPanes([t.key]);
    if (!asking) setAsking({ keys: [t.key], ...removeShortcutAsk(tabName(pane, titles), kind) }); // at most one question per press
  };
  // TERM-040 / TERM-041: a new tab joins the focused pane's cell (or opens its own cell) and
  // starts in the workspace folder; an agent tab runs the agent's start line there. Outside any
  // workspace an agent has no folder to work in, so it gets a fresh worktree instead (SESS-004).
  // EDIT-035: the explorer's "Open in terminal": a shell tab beside the focused pane. A pane belongs to its worktree by its folder, so a
  // folder inside the worktree opens the shell at the worktree with a `cd` into that folder typed ahead (the quoted relative path).
  // DT-C274: a tab opened beside a pane of an own-folder team runs where that pane runs (its worktree) and is shown
  // in the same grid; beside any other pane it runs in the shown workspace, as before.
  const besideOf = (here: Pane | undefined): { cwd: string | null; view?: string | null; branch: string | null } =>
    here?.view !== undefined ? { cwd: here.cwd, view: here.view, branch: here.branch } : { cwd: here?.cwd ?? activeDir, branch: here?.branch ?? null }; // beside a pane in a worktree: that worktree, not the project's main folder
  const openTerminalIn = (dir: string) => {
    if (!activeDir) return;
    const here = panes.find((p) => p.key === focused && sameDir(viewOf(p), activeDir));
    const key = nextKey.current++;
    // DT-C274: beside a team pane, a folder inside its worktree opens there; any other folder opens in the shown workspace.
    // A team pane's own branch is its worktree's; a tab in the shown workspace takes the branch of a pane running there.
    const at = here && here.cwd !== null && underDir(dir, here.cwd) ? besideOf(here) : { cwd: activeDir, branch: here?.view !== undefined ? (panes.find((p) => sameDir(p.cwd, activeDir))?.branch ?? null) : (here?.branch ?? null) };
    const root = at.cwd ?? activeDir;
    const rel = sameDir(dir, root) ? "" : dir.slice(root.length).replace(/^[\\/]+/, "");
    setPanes((ps) => [...ps, { key, ...at, group: here ? groupOf(here) : undefined, agent: "shell", program: null, args: [], typed: rel ? `cd "${rel}"` : undefined }]);
    setFocused(key);
  };
  const newTab = async (what: NewTab) => {
    if (what === "diff") {
      if (!activeDir) setToast("Open a workspace to pick one of its changed files.");
      else setPicking("change");
      return;
    }
    if (what === "changes") {
      // EDIT-029: one All Changes tab per cell; an open one comes to the front.
      if (!activeDir) return setToast("Open a workspace to see its changes.");
      const here = panes.find((p) => p.key === focused && sameDir(viewOf(p), activeDir));
      const same = here && panes.find((p) => p.kind === "changes" && groupOf(p) === groupOf(here));
      if (same) return setFocused(same.key);
      const key = nextKey.current++;
      setPanes((ps) => [...ps, { key, ...besideOf(here), group: here ? groupOf(here) : undefined, agent: "shell", program: null, args: [], kind: "changes" }]);
      setFocused(key);
      return;
    }
    if (what === "chooser") return addChooser();
    if (what === "markdown-open") {
      if (!activeDir) setToast("Open a workspace to pick from its markdown files.");
      else setPicking("markdown");
      return;
    }
    if (what === "markdown-new") {
      if (!activeDir) setToast("Open a workspace to start a markdown note in it.");
      else setPicking("template"); // EDIT-055: TemplatePicker makes a blank note at once when there are no templates
      return;
    }
    if (what !== null && typeof what === "object" && "shell" in what) {
      // SESS-006: another installed shell, as a tab beside the focused pane.
      const here = panes.find((p) => p.key === focused && sameDir(viewOf(p), activeDir));
      const key = nextKey.current++;
      setPanes((ps) => [...ps, { key, ...besideOf(here), group: here ? groupOf(here) : undefined, agent: "shell", program: what.shell.program, args: what.shell.args, word: what.shell.name }]);
      setFocused(key);
      return;
    }
    if (what === "file") {
      // ACCT-055: Kolux shows the picker itself, so only the chosen file is granted to the window.
      const path = await invoke<string | null>("file_pick", { defaultPath: workDir }).catch((err) => (setToast(String(err)), null));
      if (typeof path === "string") openFile(path);
      return;
    }
    const a = what;
    if (a && activeDir === null) return launch(a, null);
    const here = panes.find((p) => p.key === focused && sameDir(viewOf(p), activeDir));
    const key = nextKey.current++;
    const base = { key, ...besideOf(here), group: here ? groupOf(here) : undefined };
    try {
      if (a) await pretrust(a.id, [base.cwd ?? activeDir]);
      const line = a ? await invoke<StartLine>("agent_start_line", { id: a.id, extra: savedArgs(a.id), prompt: "" }) : null;
      const pane: Pane = a && line ? { ...base, agent: paneMark(a, line), agentId: a.id, program: line.program ?? a.program, args: line.args, env: line.env, typed: line.typed ?? undefined } : { ...base, agent: "shell", program: null, args: [] };
      setPanes((ps) => [...ps, pane]);
      setFocused(key);
    } catch (err) {
      setNotice(String(err));
    }
  };

  // EDIT-001: a file opens as a tab beside the focused pane; a file already open in that cell
  // comes to the front instead of opening twice.
  // C09-R5-01: the tab is drawn in the grid, so a link in an agent reply leaves the Agents screen
  // that covers it, and closes a full page (Tasks, Automations) that covers it too; both paths
  // below do, or the click looks like nothing happened.
  // EDIT-026 (T-317): `follow` opens the file as a read-only log tab that keeps adding lines as the file grows (a caller such as an AI Vault "View Log" button passes true).
  // `root`: the worktree the file belongs to when the caller knows it (a command-line file of a linked worktree); the tab
  // then runs there, as a diff's does, not where the focused pane runs.
  const openFile = (path: string, line?: number, column?: number, follow?: boolean, root?: string | null) => {
    setScreen("terminals");
    setPage(null);
    const here = panes.find((p) => p.key === focused && sameDir(viewOf(p), activeDir));
    const same = here && panes.find((p) => p.kind === "editor" && groupOf(p) === groupOf(here) && keyOf(p.path ?? "") === keyOf(path) && !!p.follow === !!follow);
    // CHAT-025: a file link names a line; the pane keeps it as `jump` (the editor pane reads it once it takes that prop).
    // T-329-b: the column of path:line:column counts too (fileJump turns it into the editor's own, from 0).
    const spot = fileJump(line, column);
    const jump = spot ? { ...spot, at: Date.now() } : undefined;
    if (same) {
      if (jump) setPanes((ps) => ps.map((p) => (p.key === same.key ? { ...p, jump } : p)));
      return setFocused(same.key);
    }
    const key = nextKey.current++;
    const at = root !== undefined && root !== null && !sameDir(root, here?.cwd ?? null) ? { cwd: root, branch: panes.find((p) => sameDir(p.cwd, root))?.branch ?? null } : besideOf(here);
    setPanes((ps) => [...ps, { key, ...at, group: here ? groupOf(here) : undefined, agent: "shell", program: null, args: [], kind: "editor", path, jump, ...(follow ? { follow: true } : {}) }]);
    setFocused(key);
  };
  // EDIT-014: a Mod+clicked link in a note. Web links open in the system browser,
  // notes inside the worktree as previews, anything else as an editor tab at its line.
  const followLink = (a: Action) => {
    if (a.kind === "web") return void openExternal(a.url).catch((err) => setToast(String(err)));
    // EDIT-014: a link to a file that is not there shows a toast instead of an empty tab
    if (a.kind === "file") return void missingFileToast(a.path, (ps) => invoke<unknown[]>("file_stamps", { paths: ps })).then((gone) => (gone ? setToast(gone) : a.how === "preview" ? openPreview(a.path) : openFile(a.path, a.line)));
  };

  // EDIT-027: a changed file's diff opens as a tab beside the focused pane; its staged and
  // unstaged diffs are separate tabs, and one already open in that cell comes to the front.
  // GIT-037: a click in Source Control opens it as the cell's preview tab, which the next click
  // reuses unless it holds unsaved edits.
  // DT-C274: `root`, the folder whose change it is when the caller knows it (the changed-file picker lists the shown
  // workspace's); else the diff runs where the focused pane runs (an All Changes tab of a team worktree).
  const openDiff = (path: string, staged: boolean, preview = false, line?: number, side?: "old", root?: string | null) => {
    const here = panes.find((p) => p.key === focused && sameDir(viewOf(p), activeDir));
    const jump = line === undefined ? undefined : { line, at: Date.now(), ...(side ? { side } : {}) };
    // GIT-037 (T-033-c): the cell the diff opens in follows the "Open diffs in" choice of Source Control.
    const cell = here ? targetCell(cellsOf(panesIn(panes, activeDir)).map((c) => c.group), groupOf(here), diffSplitOf(settings[DIFF_SPLIT_KEY])) : undefined;
    // DT-C274: where the diff runs; a team grid holds several worktrees, so a tab is reused only for the same one.
    const at = root !== undefined && !sameDir(root, here?.cwd ?? null) ? { cwd: root, branch: panes.find((p) => sameDir(p.cwd, root))?.branch ?? null } : besideOf(here);
    const same = cell !== undefined && panes.find((p) => p.kind === "diff" && !!p.staged === staged && groupOf(p) === cell && keyOf(p.path ?? "") === keyOf(path) && sameDir(p.cwd, at.cwd));
    if (same) {
      if (jump) setPanes((ps) => ps.map((p) => (p.key === same.key ? { ...p, jump } : p)));
      return setFocused(same.key);
    }
    const old = preview && cell !== undefined && panes.find((p) => p.kind === "diff" && p.preview && groupOf(p) === cell && !dirty[p.key] && sameDir(p.cwd, at.cwd));
    if (old) {
      setPanes((ps) => ps.map((p) => (p.key === old.key ? { ...p, path, staged, jump } : p)));
      return setFocused(old.key);
    }
    const key = nextKey.current++;
    setPanes((ps) => [...ps, { key, ...at, group: cell, agent: "shell", program: null, args: [], kind: "diff", path, staged, preview: preview || undefined, jump }]);
    setFocused(key);
  };

  // EDIT-012: Mod+Shift+V shows the file in a read-only preview tab beside it; a preview tab
  // already in that cell is reused for the new file.
  const openPreview = (path: string) => {
    const here = panes.find((p) => p.key === focused && sameDir(viewOf(p), activeDir));
    const old = here && panes.find((p) => p.kind === "preview" && groupOf(p) === groupOf(here));
    if (old) {
      setPanes((ps) => ps.map((p) => (p.key === old.key ? { ...p, path } : p)));
      return setFocused(old.key);
    }
    const key = nextKey.current++;
    setPanes((ps) => [...ps, { key, cwd: workDir, branch: here?.branch ?? null, group: here ? groupOf(here) : undefined, agent: "shell", program: null, args: [], kind: "preview", path }]);
    setFocused(key);
  };
  // T-235-b (EDIT-030): a CI check opens as its own tab beside the focused pane. One tab per check per
  // worktree, found by the check's id (never its name); opening it again brings that tab forward.
  const openCheck = (check: CheckRef) => {
    const here = panes.find((p) => p.key === focused && sameDir(viewOf(p), activeDir));
    const same = findCheckPane(panes, workDir, check.id);
    if (same) {
      setPanes((ps) => ps.map((p) => (p.key === same.key ? { ...p, check } : p)));
      return setFocused(same.key);
    }
    const key = nextKey.current++;
    setPanes((ps) => [...ps, { key, cwd: workDir, branch: here?.branch ?? null, group: here ? groupOf(here) : undefined, agent: "shell", program: null, args: [], kind: "check", check }]);
    setFocused(key);
  };
  // TERM-001: the layout strip sets how many cells the workspace in front holds. Growing opens the
  // Start form for the cells it adds (nothing starts on its own); shrinking drops unstarted cells newest
  // first and leaves started sessions alone: the ask before removing a started session is
  // TERM-003 on T-151, so until then the toast names the session in the way.
  const setCount = (n: number) => {
    const shown = cellsOf(panesIn(panes, activeDir));
    const cells = shown.map((c) => ({ key: c.group, started: c.panes.some((p) => !p.seats) }));
    const { add, drop } = resizePlan(cells, n);
    const stuck = blocking(cells, n);
    if (stuck.length) {
      const first = shown.find((c) => c.group === stuck[0])?.panes[0];
      setToast(`Close ${first ? tabName(first, titles) : "a pane"} first to use fewer panes.${stuck.length > 1 ? ` (${stuck.length} in the way.)` : ""}`);
      if (add === 0 && drop.length === 0) return;
    }
    // Start form E: growing asks once, on the Start form, with How many set to the empty cells; Start fills them.
    // No chooser panes or "pick me" slots are added.
    const ask = stripAsk(add);
    if (ask > 0) openStart({ here: true, count: ask });
    if (drop.length === 0) return;
    const rest = panes.filter((p) => !drop.includes(groupOf(p)));
    // Push 1 item 3: the functional form, so another update made in the same tick is not overwritten.
    setPanes((ps) => ps.filter((p) => !drop.includes(groupOf(p))));
    // `drop` names cells; a cell of two chooser tabs goes whole, so the focus is checked against every pane leaving
    const leaving = panes.filter((p) => drop.includes(groupOf(p))).map((p) => p.key);
    setFocused((f) => (leaving.includes(f) ? focusIn(rest, activeDir, f) : f));
  };

  // TERM-006: a split opens a shell in the pane's own folder, beside it (right) or under it.
  // CLI-026: a split from the command line works on the pane named, wherever it is, and leaves the
  // active tab and the focus alone.
  // TERM-013: the pane's cell fills the grid (alone in the clean look, the whole workspace area);
  // again restores every pane to its place. Nothing restarts: the other cells are only hidden.
  const expandPane = (key: number) => {
    const p = panes.find((x) => x.key === key);
    if (!p) return;
    const groups = cellsOf(panesIn(panes, viewOf(p))).map((c) => c.group);
    if (canExpand(groups.length, classic)) setZoom((z) => toggleZoom(z, viewOf(p) ?? "", groupOf(p), groups.length));
  };
  const splitPane = (key: number, dir: "right" | "down", cli?: { ask: string; command: string | null }, over?: Partial<Pane>) => {
    const src = panes.find((p) => p.key === key);
    if (!src) {
      if (cli) cliFailed.current[cli.ask] = "that terminal is not in the window";
      return;
    }
    const shown = cellsOf(panesIn(panes, viewOf(src))); // DT-C274: the grid the pane is shown in
    if (shown.length >= MAX_PANES) {
      if (cli) cliFailed.current[cli.ask] = `its workspace already holds ${MAX_PANES} panes; open a tab with terminal create instead`;
      else setToast(`A workspace holds up to ${MAX_PANES} panes.`);
      return;
    }
    // DT-C274: the new shell runs in the pane's own folder and is shown in the same grid.
    const pane: Pane = { key: nextKey.current++, cwd: src.cwd, ...(src.view !== undefined ? { view: src.view } : {}), branch: src.branch, agent: "shell", program: null, args: [], typed: cli?.command ?? undefined, ask: cli?.ask, ...over };
    // one pane split down becomes a stacked pair; a split right puts the pair side by side again
    const stack = dir === "down" && shown.length === 1;
    // the split pane's own workspace: a split from the command line may name a pane in a workspace not in front
    const dirKey = sameDir(viewOf(src), activeDir) ? (activeDir ?? "") : (viewOf(src) ?? "");
    setStacked((st) => ({ ...st, [dirKey]: stack }));
    const at = splitIndex(shown.map((c) => c.group), groupOf(src), dir, columnsFor(shown.length + 1, stack));
    setPanes(insertBefore(panes, shown[at]?.panes[0], pane));
    if (!cli) setFocused(pane.key);
  };

  const setChooser = (key: number, patch: Partial<StartSheet>) => {
    setPanes((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
    setSheet((s) => (s && s.key === key ? { ...s, ...patch } : s));
  };
  const setSeats = (key: number, seats: Seat[]) => setChooser(key, { seats });
  // Deleted workspaces are skipped: a place counts while some project still lists its folder.
  const stillThere = (p: Place) => p.dir === null || Object.keys(owner).some((d) => sameDir(d, p.dir));
  const step = (dir: 1 | -1) => {
    if (!stepAllowed(screen === "terminals", settingsOpen)) return false;
    const i = travel(hist, dir, stillThere);
    if (i === null) return false;
    const p = hist.list[i];
    setHist({ ...hist, at: i });
    setScreen("terminals");
    if (p.dir === null) setActiveDir(null);
    else if (!sameDir(p.dir, activeDir)) late.select(p.dir, null);
    setPage(p.page as Page | null);
    return true;
  };
  // PROJ-057 / VIEW-037: the palette's rows besides worktrees and projects (the pull requests, VIEW-043, are added by the
  // palette's own surface, shell/window/Dialogs.tsx, which reads them only while it is open).
  const paletteItems = (): PaletteItem[] => [
    ...panes
      .filter((p) => !p.seats)
      .map((p) => ({
        section: "Open tabs",
        label: tabName(p, titles),
        hint: p.cwd ? folderName(p.cwd) : "Home",
        // VIEW-040: the tab's own badge, with how long it has been in that state.
        ...(!p.kind ? { mark: tabBadge(p.agent, running[p.key], needsYou(statusOf(p)), unreadPanes.has(p.key), hook[p.key]), since: stamp[p.key]?.at ?? 0 } : {}),
        dir: p.cwd ?? undefined,
        run: () => {
          setScreen("terminals");
          if (!sameDir(viewOf(p), activeDir)) {
            setPage(null);
            setActiveDir(viewOf(p));
          }
          setFocused(p.key);
        },
      })),
    ...(Object.keys(PAGES) as PageId[]).map((id) => ({ section: "Settings", label: PAGES[id], hint: "Settings page", keywords: SETTINGS_WORDS[id], run: () => openSettings(id) })),
    ...paletteRows(accountSwitcher.groups, switchAccount), // T-548: Switch Claude to ...
    // T-708: New terminal tab and Search open tabs are their Commands rows (with their keys), no longer second hand-built rows
    ...commandRows(keymap, installedIds, setToast, (id, i) => (id === TAB_SEARCH_ACTION ? openTabSearch() : runCommand(id, i, { scope: actionById.get(id)?.scope, unanswered: setToast }))), // T-611: every command, the unbound ones included, run as its shortcut runs; T-708: Search open tabs from any screen (TERM-053)
    ...screenRows((s) => (s === "skills" ? toggleSkills(screen, setScreen) : setScreen(s === screen ? "terminals" : s)), classic), // T-610 / T-708: every screen; T-756: a page already up closes, as Show Skills does; C12-R5-01: Classic keeps its one view
    { section: "Quick actions", label: "New session", run: () => addChooser() },
    // The workspace's All Changes (review, stage, commit) without waiting for an agent to finish: the same tab the
    // Board's Review changes opens, in the focused cell, one per cell.
    { section: "Quick actions", label: "Open All Changes", keywords: "review changes diff commit stage git", needs: "worktree" as const, run: () => (setPage(null), setScreen("terminals"), void newTab("changes")) },
    // palette.md:7: the sidebar's Add project, New group and Scan for repos, with the sidebar shown so its panel hears them
    ...projectRows(() => (setScreen("terminals"), setSidebarOpen(true))),
    // VIEW-042: actions on the worktree in front, not runnable while none is open
    // T-798 (P4B-01): both rows are left out while worktrees are off, as their chords and menu items are.
    ...(singleFolder() ? [] : [{
      section: "Quick actions",
      label: "Delete this worktree",
      needs: "worktree" as const,
      run: () => {
        setScreen("terminals");
        setSidebarOpen(true);
        setDeleteRequest((n) => n + 1);
      },
    },
    {
      section: "Quick actions",
      label: "New workspace",
      run: () => {
        setScreen("terminals");
        setSidebarOpen(true);
        setCreateName("");
        setCreateRequest((n) => n + 1);
      },
    }]),
  ];
  // PROJ-077: a workspace made or removed from the command line shows up like one made here;
  // the handlers are read through a ref so the one listener never goes stale.
  // CLI-026, CLI-027: the terminal commands. A new terminal joins the worktree's last pane as a
  // tab; unless asked to come into view it leaves that pane's shown tab and the focus as they were.
  const keyOfHandle = (h: string) => Number(Object.keys(ptys.current).find((k) => `term-${ptys.current[Number(k)]}` === h) ?? NaN);
  const showDir = (dir: string | null) => {
    setPage(null);
    if (dir !== null) recentDirs.current = [dir, ...recentDirs.current.filter((d) => !sameDir(d, dir))].slice(0, 20);
    setActiveDir(dir);
    setScreen("terminals");
  };
  // DT-C274: a terminal made in a team worktree is shown in its team's grid, as a tab of the cell its live agent is in.
  const termCreate = (c: { path: string; branch: string | null; command: string | null; title: string | null; focus: boolean; ask: string }) => {
    const view = teamViewOf(settings, c.path);
    const at = view === undefined ? c.path : view;
    const here = cellsOf(panesIn(panes, at));
    const mine = view === undefined ? undefined : here.find((cell) => cell.panes.some((p) => !p.kind && sameDir(p.cwd, c.path) && running[p.key] !== false));
    const last = mine ?? here[here.length - 1];
    const key = nextKey.current++;
    if (last && !c.focus) {
      const on = last.panes.some((p) => p.key === activeTab[last.group]) ? activeTab[last.group] : last.panes[last.panes.length - 1].key;
      setActiveTab((m) => ({ ...m, [last.group]: on }));
    }
    setPanes((ps) => [...ps, { key, cwd: c.path, ...(view === undefined ? {} : { view }), branch: c.branch, agent: "shell", program: null, args: [], typed: c.command ?? undefined, title: c.title ?? undefined, ask: c.ask, group: last?.group }]);
    if (c.focus) {
      showDir(at);
      setFocused(key);
    }
  };
  const termSwitch = (handle: string) => {
    const p = panes.find((x) => x.key === keyOfHandle(handle));
    if (!p) return;
    showDir(viewOf(p)); // DT-C274: the grid the pane is shown in
    setFocused(p.key);
  };
  const renamePane = (key: number, title: string | undefined) => setPanes((ps) => ps.map((p) => (p.key === key ? { ...p, title } : p)));
  const termRename = (handle: string, title: string | null) => {
    const key = keyOfHandle(handle);
    setPanes((ps) => ps.map((p) => (p.key === key ? { ...p, title: title ?? undefined } : p)));
  };
  // TERM-014: closing a pane ends its program (the pane's own cleanup kills it); the next tab of
  // its cell takes over, else the neighbouring cells take the space; closing the last pane leaves
  // the workspace's empty placeholder.
  // SESS-024: a pane whose session failed to start goes away, with the reason in a toast.
  const failedPane = (key: number, error: string) => {
    // C24-R1-01: a tab that came back from the saved layout and has not settled yet keeps its place
    // when its session does not start; dropping it would rewrite the layout without its key and the
    // next start would prune its saved output. The key leaves restoredKeys once the tab has its
    // terminal (Pane.tsx onPty), so a later failure of the same tab still drops it.
    if (restoredKeys.current.has(key)) {
      restoredKeys.current.delete(key);
      setToast(`This agent didn't start. Try again, or open Settings > Agents. (${error})`);
      return;
    }
    startWatch.seen(key); // SESS-005: its own toast says why; no five-second warning on top
    const ask = panes.find((p) => p.key === key)?.ask;
    if (ask) cliFailed.current[ask] = error;
    const { panes: rest, batchEmpty } = withoutFailed(panes, key);
    // from the latest list: several panes of one launch can fail before the window draws again, and each
    // removal must stand (a list from this render would bring the pane that failed first back, dead)
    setPanes((ps) => withoutFailed(ps, key).panes);
    setFocused((f) => (f === key ? focusIn(rest, activeDir, f) : f));
    setToast(batchEmpty ? `Nothing started: ${error}` : `This agent didn't start. Try again, or open Settings > Agents. (${error})`);
  };

  // ACCT-064: Restart starts the program again in the same slot (a new key remounts the pane, which
  // ends the old program) on the account active now; a split beside it is not touched.
  const restartPane = (key: number) => {
    const fresh = nextKey.current++;
    delete ptys.current[key];
    // audit F1: the pane keeps its cell (its tabs are grouped under the old key) and its pin, colour and active-tab mark
    setPanes((ps) => ps.map((p) => (p.key === key ? { ...p, key: fresh, group: p.group ?? key, account: undefined, setup: undefined, typed: undefined } : p)));
    s.setPinned((pn) => (pn.has(key) ? new Set([...pn].map((k) => (k === key ? fresh : k))) : pn));
    s.setTabColors((c) => (key in c ? { ...forgetColors(c, [key]), [fresh]: c[key] } : c));
    setActiveTab((m) => Object.fromEntries(Object.entries(m).map(([g, k]) => [g, k === key ? fresh : k])));
    setRunning((r) => {
      const { [key]: _gone, ...rest } = r;
      return rest;
    });
    setFocused((f) => (f === key ? fresh : f));
  };
  const noticeFor = (p: Pane): PaneNotice | null => {
    const prompt = accountPrompt(p, !!running[p.key], codex.active, codex.accounts, kept[p.key]);
    if (!prompt) {
      // T-139-d: the Codex command, arguments, variables or permissions changed in Settings since this pane started.
      const now = codexSetup(settings);
      return setupChanged(p, !!running[p.key], now, keptSetup[p.key])
        ? { title: "The Codex setup changed", body: "This pane still runs on the old setup. Restart to use the new one, or keep it here.", primary: "Restart", onPrimary: () => restartPane(p.key), secondary: "Keep this setup", onSecondary: () => setKeptSetup((k) => ({ ...k, [p.key]: now })) }
        : null;
    }
    if (prompt.kind === "removed")
      return prompt.to === null
        ? { title: "This pane's Codex account was removed", body: "Add or pick a Codex account in Settings, then restart this pane.", primary: "Open Settings", onPrimary: () => openSettings("accounts", "codex") }
        : { title: "This pane's Codex account was removed", body: `Restart to run Codex as ${prompt.to}.`, primary: "Restart", onPrimary: () => restartPane(p.key) };
    return {
      title: "The Codex account changed",
      body: `This pane still runs as ${prompt.from}. Restart to run as ${prompt.to}, or keep ${prompt.from} here.`,
      primary: "Restart",
      onPrimary: () => restartPane(p.key),
      secondary: `Keep ${accountLabel(p.account ?? null, codex.accounts)}`,
      onSecondary: () => setKept((k) => ({ ...k, [p.key]: codex.active })),
    };
  };

  /** TERM-044: the tab strip's order for the cell holding pane `key`, pinned tabs first as drawn
   *  (C06-R1-01: the close rows and Select Tab measure the strip, not the pane array). */
  const orderOf = (key: number) => stripOrderOf(panes, key, pinned);
  // TERM-044: the closed tabs leave together; focus returns to the tab used before the active one,
  // else its right neighbour (left if it was last), never to a tab that is closing.
  const dropPanes = (keys: number[]) => {
    const gone = new Set(keys);
    // EDIT-004: a tab closed on purpose keeps no draft; a file another open tab still shows keeps its copy
    discardDraftsOf(panes.filter((p) => gone.has(p.key)), panes.filter((p) => !gone.has(p.key)));
    trashUnusedNotes(panes.filter((p) => gone.has(p.key)), panes.filter((p) => !gone.has(p.key)), setToast); // EDIT-031: a new note never typed in goes with its tab
    late.exitedPrompt.current = onClose(late.exitedPrompt.current, keys);
    cancelHandOver(keys); // DT-C248: a closing tab reaps its terminal even if a move was marked for it
    // DT-C248 review 2: a tab closed while its terminal was still on its way back to its view (moved, or back
    // from the saved layout) has no id yet to kill by; the close ends what still runs for the key. Here and
    // not in the pane's unmount: the key leaves the layout with the close, so no later mount can own that
    // terminal, while the dev double mount and a second move unmount a pane whose next mount takes it.
    keys.forEach((k) => void invoke("terminal_reap_pane", { paneKey: k }).catch(() => {}));
    keys.forEach((k) => delete ptys.current[k]);
    keys.forEach((k) => (runTabs.current = forgetRunTab(runTabs.current, k)));
    keys.forEach(forgetView); // T-102-b: a closed tab's kept editor state goes with it
    setTabColors((c) => forgetColors(c, keys));
    // TERM-106: a tab closed on purpose is not brought back after a restart.
    keys.forEach((k) => void invoke("terminal_forget_history", { paneKey: k }).catch(() => {}));
    closedPanes.remember(panes, keys); // TERM-047: a terminal tab closed on purpose can be reopened (Reopen Closed Tab)
    setPanes((ps) => ps.filter((p) => !gone.has(p.key)));
    setRunning((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !gone.has(Number(k)))));
    setDirty((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !gone.has(Number(k)))));
    // TERM-118: a tab closed unread takes its mark along, and its workspace dot when no unread tab stays there
    if (keys.some((k) => unreadPanes.has(k))) {
      for (const d of dirsToClear(panes.map((x) => ({ key: x.key, cwd: viewOf(x) })), unreadPanes, keys)) markDir(d, false);
      setUnreadPanes((u) => new Set([...u].filter((k) => !gone.has(k))));
    }
    const rest = panes.filter((p) => !gone.has(p.key));
    setFocused((f) => {
      if (!gone.has(f)) return f;
      const next = returnTab(orderOf(f), [f, ...keys.filter((k) => k !== f)], recentTabs.current);
      return next ?? focusIn(rest, activeDir, f);
    });
  };

  const dropPane = (key: number) => dropPanes([key]);

  // TERM-054: a tab dropped on a tab or a cell; TERM-015: a cell dropped on another cell. A drop that
  // would leave the layout as it is returns nothing, so nothing happens. DT-C248: a pane that lands in
  // another cell is drawn anew by React; its key is handed over first so its terminal keeps running.
  const dropTabOn = (key: number, target: Parameters<typeof dropTab>[2]) => {
    const r = dropTab(panes, key, target);
    if (!r) return;
    handOver(movedKeys(panes, r.panes));
    setPanes(r.panes);
    setActiveTab((m) => ({ ...m, [r.group]: key }));
    setFocused(key);
  };
  const dropCellOn = (group: number, target: { group: number; zone: Zone }) => {
    const next = dropCell(panes, group, target);
    if (!next) return;
    handOver(movedKeys(panes, next));
    setPanes(next);
  };
  // TERM-049: Split Right / Down on a tab's menu moves the tab into a cell of its own.
  const splitTab = (key: number, dir: "right" | "down") => {
    const r = splitTabOut(panes, key, dir);
    if (!r) return;
    handOver(movedKeys(panes, r.panes)); // DT-C248: the tab moves to a cell of its own; its terminal stays
    const me = panes.find((p) => p.key === key)!; // audit F8: the tab's own grid, keyed as splitPane keys it
    const grid = sameDir(viewOf(me), activeDir) ? (activeDir ?? "") : (viewOf(me) ?? "");
    setStacked((st) => ({ ...st, [grid]: r.stack }));
    setPanes(r.panes);
    setActiveTab((m) => ({ ...m, [key]: key }));
    setFocused(key);
  };
  // TERM-045: every close (keyboard, a tab's x, the pane header) asks first when a program would
  // stop; a tab's panes are checked together so a split tab asks once. Idle or switched off:
  // the tab closes at once. A failed check asks too (UX audit terminal F3).
  // EDIT-031: a tab with unsaved text asks Save / Don't save / Cancel first; the dialog closes through closeTab(keys, true).
  const closeTab = async (keys: number[], checked = false) => {
    if (!checked && late.guard.request(keys)) return;
    const first = panes.find((p) => p.key === keys[0]);
    // TERM-046: a pinned tab asks before it closes (setting, on by default).
    if (first && keys.length === 1 && closeOne(first.key, pinned, settings) === "ask") return setAsking({ keys, ...pinQuestion(tabName(first, titles)) });
    const ids = keys.map((k) => ptys.current[k]).filter((id): id is number => id !== undefined);
    const { busy, failed } = asksBeforeClose(settings) ? await busyCheck(ids, (ids) => invoke<boolean[]>("terminal_busy", { ids })) : { busy: 0, failed: false };
    if (busy === 0 || !first) return dropPanes(keys);
    setAsking({ keys, ...closeQuestion(tabName(first, titles), busy, keys.length, failed) });
  };
  const closePane = (key: number) => void closeTab([key]);
  const leavePage = () => {
    setSettingsOpen(false);
    setPage(null);
    setScreen("terminals");
  };
  // AUTO-013: a run's terminal counts as live only while its pane is still open in the run's worktree.
  // T-031-b: after a restart the window remembers no pane, so the run row's re-attached terminal finds it.
  const runPane = (r: { id: string; worktree?: string; terminal?: number | null }) => {
    const key = runPaneKey(runPanes.current, r, ptys.current);
    return panes.find((x) => x.key === key && !!r.worktree && sameDir(x.cwd, r.worktree));
  };
  // EDIT-041: Open in Code goes to the Code view, the pane's workspace (its sidebar row scrolled
  // into sight by ProjectsPanel) and the pane itself, its tab brought to the top.
  // TERM-036: a copied id says so; a clipboard that refuses says that instead, never both.
  const copyId = (p: Pane, what: "session" | "terminal" | "pane") => {
    const label = { session: "session ID", terminal: "terminal ID", pane: "pane ID" }[what];
    const pty = ptys.current[p.key];
    const text = what === "session" ? p.session : what === "pane" ? String(p.key) : pty === undefined ? undefined : `term-${pty}`;
    if (!text) return setToast(`Could not copy the ${label}: this pane has none yet.`);
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => setToast(`Copied the ${label}: ${text}`),
        () => setToast(`Could not copy the ${label}: the clipboard is not available.`),
      );
  };
  // TERM-096: a printed handle opens its pane when it names an open terminal.
  const findHandle = (h: string) => {
    const k = keyOfHandle(h);
    return Number.isNaN(k) ? undefined : () => openPane(k);
  };
  const openPane = (key: number) => {
    const p = panes.find((x) => x.key === key);
    if (!p) return;
    setPage(null); // C13-R1-01: Open in Code leaves a full page (Automations, Tasks, Routing) behind
    setScreen("terminals");
    if (!sameDir(viewOf(p), activeDir)) setActiveDir(viewOf(p)); // DT-C274: the grid the pane is shown in
    setFocused(key);
    late.setReveal((n) => n + 1);
  };
  // T-609: Review changes on a Board Done card or an Inbox row: that pane's worktree in All Changes (EDIT-029).
  const reviewChanges = (key: number) => {
    const r = reviewTab(panes, key);
    if (!r) return;
    if ("focus" in r) return openPane(r.focus);
    const k = nextKey.current++;
    const shownIn = viewOf(r.open); // DT-C274: a team pane's review opens in its cell of the team grid
    setPanes((ps) => [...ps, { key: k, cwd: r.open.cwd, ...(r.open.view !== undefined ? { view: r.open.view } : {}), branch: r.open.branch, group: r.open.group, agent: "shell", program: null, args: [], kind: "changes" }]);
    setPage(null); // C13-R1-01: the new All Changes tab is not drawn behind a full page
    setScreen("terminals");
    if (!sameDir(shownIn, activeDir)) setActiveDir(shownIn);
    setFocused(k);
    late.setReveal((n) => n + 1);
  };
  // The sidebar row's Review changes: workspace `dir` comes to the front on Terminals with its All Changes, an open
  // one focused, else a new one in the cell the focus lands on there (as the Board's Review changes opens it). Shown
  // without the starter pane a workspace with no tabs would get: All Changes is what was asked for.
  const openChangesIn = (dir: string, branch: string | null) => {
    const here = panesIn(panes, dir);
    const same = here.find((p) => p.kind === "changes");
    const at = here.find((p) => p.key === focusIn(panes, dir, focused));
    const key = same?.key ?? nextKey.current++;
    if (!same) setPanes((ps) => [...ps, { key, cwd: dir, branch: at?.branch ?? branch, group: at ? groupOf(at) : undefined, agent: "shell", program: null, args: [], kind: "changes" }]);
    showDir(dir);
    setFocused(key);
    late.setReveal((n) => n + 1);
  };
  const addPreset = (id: string) => {
    const key = nextKey.current++;
    setPanes((ps) => [...ps, { key, cwd: startDirOf(activeDir), branch: null, agent: "shell", agentId: id, program: null, args: [], seats: [seatStart(id, seatDefault(settings))] }]);
    setAgentSel(key);
    setFocused(key);
  };
  return {
    addShell, addChooser, openStart, removeSession, openTerminalIn, newTab, openFile, followLink, openDiff, openPreview, openCheck, setCount, expandPane, splitPane, setChooser,
    setSeats, stillThere, step, paletteItems, keyOfHandle, showDir, termCreate, termSwitch, renamePane, termRename, failedPane, restartPane, noticeFor,
    orderOf, dropPanes, dropPane, dropTabOn, dropCellOn, splitTab, closeTab, closePane, leavePage, runPane, copyId, findHandle, openPane, reviewChanges, openChangesIn,
    addPreset,
  };
}

export type PaneActions = ReturnType<typeof paneActions>;
