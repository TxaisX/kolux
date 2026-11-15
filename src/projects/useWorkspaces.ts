// T-543: the window's projects and workspaces, moved out of App.tsx as they were. Two hooks, called
// where the code used to sit: useWorkspaces holds the lists and requests (the window's state slot),
// useWorkspaceActions opens, sets up and removes workspaces over the window's panes (the slot where
// the setup terminal's code was). The grid's own state (stacked pairs, weights) stays in the window.
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Pane } from "../App";
import type { Screen } from "../chrome/TopBar";
import type { Page } from "./ProjectsPanel";
import type { PendingCreate, Project, SetupLine, SetupWhere } from "./model";
import { EMPTY_HISTORY } from "./nav";
import { cellsOf, DEFAULT_PANES_FIELD, groupOf, MAX_PANES, seedCount } from "../terminal/grid";
import { activeAfterRemove, focusIn, gridOf, panesIn, sameDir, withoutDir } from "../workspaces";
import { forgetStartDirs, startDirOf } from "./worktreeGrid";
import { readLook } from "../settings/general";
import { seatDefault, seatStart } from "../launch/defaultSeat";
import { emptySeat } from "../launch/seats";
import { startPanes, type StartPrefill } from "./workspaceStart";
import { selectView } from "./rows";

/** Job 13 F1: the window reads the project list once at start, so the Start form knows the folders even with the
 *  sidebar hidden or on the Agents screen. The sidebar's panel keeps writing the same list after that; a list it has
 *  already written is not replaced. `done` runs whether the read worked or not. */
export function readProjectsOnce(list: () => Promise<Project[]>, set: Dispatch<SetStateAction<Project[]>>, done: () => void, live: () => boolean = () => true): Promise<void> {
  return Promise.resolve()
    .then(list)
    .then((l) => void (live() && set((cur) => (cur.length ? cur : l))), () => {})
    .finally(() => void (live() && done()));
}

export function useWorkspaces(activeDir: string | null) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsRead, setProjectsRead] = useState(false);
  useEffect(() => {
    let live = true;
    void readProjectsOnce(() => invoke<Project[]>("project_list"), setProjects, () => setProjectsRead(true), () => live);
    return () => void (live = false);
  }, []);
  const [owner, setOwner] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({}); // workspace folder -> the name typed for it (PROJ-021)
  const [refresh, setRefresh] = useState(0);
  const [deleteRequest, setDeleteRequest] = useState(0); // PROJ-070: Mod+Shift+Backspace asks to delete the shown workspace
  const recentDirs = useRef<string[]>([]); // PROJ-070: workspaces shown, newest first
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeDir;
  const [createRequest, setCreateRequest] = useState(0); // PROJ-020: Mod+N opens the sidebar's name field
  const [standIns, setStandIns] = useState<PendingCreate[]>([]); // PROJ-020: creates Git is still working on
  const [createName, setCreateName] = useState(""); // PROJ-057: the palette's typed name, prefilled there
  const [hist, setHist] = useState(EMPTY_HISTORY); // VIEW-046: workspaces and pages shown, for back and forward
  return { projects, setProjects, projectsRead, owner, setOwner, names, setNames, refresh, setRefresh, deleteRequest, setDeleteRequest, recentDirs, activeRef, createRequest, setCreateRequest, standIns, setStandIns, createName, setCreateName, hist, setHist };
}

type ActionDeps = {
  panes: Pane[];
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  setFocused: Dispatch<SetStateAction<number>>;
  setActiveDir: Dispatch<SetStateAction<string | null>>;
  setStacked: Dispatch<SetStateAction<Record<string, boolean>>>;
  nextKey: MutableRefObject<number>;
  settings: Record<string, unknown>;
  screen: Screen;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setPage: Dispatch<SetStateAction<Page | null>>;
  owner: Record<string, string>;
  recentDirs: MutableRefObject<string[]>;
  activeRef: MutableRefObject<string | null>;
};

export function useWorkspaceActions({ panes, setPanes, setFocused, setActiveDir, setStacked, nextKey, settings, screen, setScreen, setPage, owner, recentDirs, activeRef }: ActionDeps) {
  // T-614: the panes as last drawn, for a removal that finishes after long awaits (git takes seconds
  // on Windows) and must see the tabs as they are then, not as they were when it was clicked.
  const panesNow = useRef(panes);
  panesNow.current = panes;
  // PROJ-033 / SESS-037: the setup script runs in a Setup terminal of the new workspace: a tab
  // beside its first pane, or a cell of its own to the right or below. `then` runs once it ends
  // (the agent waiting for setup), whatever its exit code, and lands as a tab beside it.
  const afterSetup = useRef<Record<number, () => void>>({});
  // DT-C274: `view`, the grid a team worktree is shown in (as openDefaultTabs takes it): the Setup terminal runs in
  // `dir`, is shown there, and is always a tab: of the cell of the pane running in `dir`, else of cell `group` (the chooser's), else of the grid's first cell.
  const startSetup = (dir: string, branch: string | null, line: SetupLine, where: SetupWhere, show: boolean, then?: () => Promise<unknown> | void, view?: string | null, group?: number) => {
    const key = nextKey.current++;
    setPanes((ps) => {
      if (view !== undefined) {
        const shown = cellsOf(panesIn(ps, view));
        const cell = shown.find((c) => c.panes.some((p) => sameDir(p.cwd, dir))) ?? shown.find((c) => c.group === group) ?? shown[0];
        return [...ps, { key, cwd: dir, view, branch, agent: "shell", program: line.program, args: line.args, title: "Setup", setupScript: true, word: line.program.split(/[\\/]/).pop()?.replace(/\.exe$/i, ""), group: cell?.group }];
      }
      const cells = cellsOf(panesIn(ps, dir));
      const tab = where === "tab" || cells.length >= MAX_PANES;
      if (!tab && where === "down" && cells.length === 1) setStacked((st) => ({ ...st, [dir]: true }));
      return [...ps, { key, cwd: dir, branch, agent: "shell", program: line.program, args: line.args, title: "Setup", setupScript: true, word: line.program.split(/[\\/]/).pop()?.replace(/\.exe$/i, ""), group: tab ? cells[0]?.group : undefined }];
    });
    if (then)
      afterSetup.current[key] = () =>
        void Promise.resolve(then()).then((k) => {
          if (typeof k === "number") setPanes((ps) => ps.map((p) => (p.key === k ? { ...p, group: groupOf(ps.find((x) => x.key === key) ?? p) } : p)));
        });
    if (show) {
      setActiveDir(view === undefined ? dir : view);
      setFocused(key);
    }
    return key;
  };

  // PROJ-066: a click on a workspace row shows that workspace on the same click. Its panes were
  // kept while hidden, so they come back as they were; a workspace with no pane yet gets the launch chooser (T-569), not a terminal.
  // TERM-005: `fresh` says the workspace was just made: its grid starts with the default pane
  // count. Only then, so nothing re-seeds later.
  // T-664 (b): `prefill` (a front create from the new-workspace form) puts the picked AI in Seat 1 (with the default
  // model and effort, as a dropdown pick would, so Start is ready) and the note in the task; it only matters when the workspace has no pane yet, and nothing runs until Start.
  // DT-C274: a team worktree (an own-folder team's) is shown in its team's grid, with the pane running in it focused; a
  // chooser made for it there runs in the worktree.
  const select = (dir: string, branch: string | null, fresh = false, prefill?: StartPrefill) => {
    setPage(null);
    // A stranded team worktree (no pane left in its team's grid) is shown as a plain workspace of its own.
    const view = selectView(settings, panes, dir);
    const at = view === undefined ? dir : view;
    recentDirs.current = [at, ...recentDirs.current.filter((d) => !sameDir(d, at))].slice(0, 20);
    setActiveDir(at);
    if (screen === "artifacts" || screen === "skills") setScreen("terminals");
    const shown = panesIn(panes, at);
    const mine = sameDir(gridOf(at), dir) ? undefined : shown.find((p) => sameDir(p.cwd, dir) && !p.kind); // a worktree's own grid is its project's: its session in that grid is the one focused
    if (mine) setFocused(mine.key);
    else if (shown.length > 0) setFocused((f) => focusIn(panes, at, f));
    else {
      const made = startPanes(startDirOf(dir) ?? dir, branch, fresh ? seedCount(settings[DEFAULT_PANES_FIELD], readLook(settings) === "classic") : 1, () => nextKey.current++, prefill && { seat: prefill.agent ? { ...emptySeat(), ...seatStart(prefill.agent, seatDefault(settings)) } : emptySeat(), task: prefill.task }).map((p) => (view === undefined ? p : { ...p, view }));
      setPanes((ps) => [...ps, ...made]);
      setFocused(made[0].key);
    }
  };

  // PROJ-066: removing a workspace closes every pane in it, wherever it was; the view stays
  // unless it was the one removed, then it falls back to the home group.
  // PROJ-070: the removed one gives way to the sibling used last that still has panes; the shown
  // workspace is read when the delete finishes, so a user who went elsewhere meanwhile stays there.
  // PROJ-053: putting workspaces to sleep closes their panes the same way, all at once.
  // T-614: the panes are updated from the newest list, so a tab opened meanwhile stays (and its
  // process lives) and a tab removed earlier never comes back; several removals are one call.
  const removedAll = (paths: string[]) => {
    if (paths.length === 0) return;
    forgetStartDirs(paths); // a worktree that is gone is no longer where new sessions start
    const without = (ps: Pane[]) => paths.reduce((x, d) => withoutDir(x, d), ps);
    const left = without(panesNow.current);
    const gone = (d: string) => paths.some((x) => sameDir(d, x));
    const pid = projectOf(paths[0]);
    const siblings = Object.entries(owner).filter(([d, p]) => p === pid && !gone(d) && panesIn(left, d).length > 0).map(([d]) => d);
    const hit = paths.find((x) => activeRef.current !== null && activeAfterRemove(activeRef.current, x) !== activeRef.current);
    const next = hit === undefined ? activeRef.current : activeAfterRemove(activeRef.current, hit, recentDirs.current.filter((d) => !gone(d)), siblings);
    setPanes(without);
    setActiveDir(next);
    setFocused((f) => focusIn(left, next, f));
  };
  const removed = (path: string) => removedAll([path]);
  const projectOf = (cwd: string | null): string | null => (cwd ? (Object.entries(owner).find(([dir]) => sameDir(dir, cwd))?.[1] ?? null) : null);
  return { afterSetup, startSetup, select, removedAll, removed, projectOf };
}

export type WorkspaceActions = ReturnType<typeof useWorkspaceActions>;
