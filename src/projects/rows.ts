// What a sidebar row knows about its workspace beyond the worktree itself (PROJ-045, PROJ-050,
// PROJ-063): the strongest live agent state, when it last changed, and its pull request. Pure,
// so the ordering and grouping rules are tested on their own.
// ponytail: today the only live states are working / done / idle, read from whether an agent
// pane's program is up; permission, blocked, waiting and interrupted arrive with the status hooks
// (STAT-001, T-025), and the pull-request state with GIT-025 (T-229). The rules here take them already.
import { shortcodes } from "./model";
import { closesWith, goesWith, gridOf, panesIn, sameDir } from "../workspaces";

export type AgentState = "permission" | "blocked" | "waiting" | "interrupted" | "working" | "queued" | "done" | "idle";
export type PrState = "open" | "draft" | "merged" | "closed" | "suppressed" | null;
/** `cache`: when the prompt cache of its idle Claude agents runs out (SET-059), null when none counts. */
export type RowInfo = { state: AgentState; changed: number; pr: PrState; cache?: number | null;
  /** STAT-036: how many agents are working in the workspace, split panes counted apart (status/working). */
  working?: number };
export type GroupBy = "none" | "project" | "status" | "pr";
/** "manual" is PROJ-049's Manual order; "activity" is PROJ-051's Recent; the old stored "recent" is PROJ-050's and moves to Smart once. */
export type SortBy = "smart" | "name" | "activity" | "manual";

export const GROUP_SETTING = "workspaceGroupBy";
export const SORT_SETTING = "workspaceSort";
/** PROJ-046: the pinned workspaces' paths, and whether a pinned row also shows in its own group. */
export const PIN_SETTING = "pinnedWorkspaces";
export const PIN_COPIES_SETTING = "pinnedCopies";

/** AUTO-024: the sidebar switch that hides worktrees made by automation runs. */
export const HIDE_AUTOMATION_SETTING = "hideAutomationWorktrees";

type Made = { path: string; madeBy?: string | null };

/** AUTO-024: each project's list without the worktrees automation runs made, while the switch is on. */
export function withoutAutomationMade<W extends Made>(lists: Record<string, W[]>, hide: boolean): Record<string, W[]> {
  if (!hide) return lists;
  return Object.fromEntries(Object.entries(lists).map(([id, ws]) => [id, ws.filter((w) => w.madeBy !== "automation")]));
}

/** DT-C274: the worktrees an own-folder team launch made (launch/launchActions.ts startSeats). The team is shown as
 *  one grid in the folder its chooser was in, so these are left out of the sidebar's workspace rows. */
export const TEAM_WORKTREES_SETTING = "teamWorktrees";

/** DT-C274: one recorded team worktree and the folder whose grid shows its agent. `view` is null for a record saved as
 *  a bare path (before the grid was recorded): it is still left out of the sidebar, but no grid is known for it. */
export type TeamFolder = { path: string; view: string | null };
type TeamRecord = string | { path: string; view: string };

/** DT-C274: the recorded team worktrees, as saved (`{ path, view }`, or an older bare path); anything else reads as none. */
export function teamFoldersOf(v: unknown): TeamFolder[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((d): TeamFolder[] => {
    if (typeof d === "string") return [{ path: d, view: null }];
    if (d && typeof d === "object" && typeof (d as { path?: unknown }).path === "string") {
      const view = (d as { view?: unknown }).view;
      return [{ path: (d as { path: string }).path, view: typeof view === "string" ? view : null }];
    }
    return [];
  });
}

const recordOf = (t: TeamFolder): TeamRecord => (t.view === null ? t.path : { path: t.path, view: t.view });

/** DT-C274: the record with `add` put in, each path once (a path already there takes the new grid). */
export function addTeamFolders(v: unknown, add: { path: string; view: string }[]): TeamRecord[] {
  const had = teamFoldersOf(v).filter((t) => !add.some((a) => sameDir(a.path, t.path)));
  const fresh = add.filter((a, i) => add.findIndex((b) => sameDir(a.path, b.path)) === i);
  return [...had.map(recordOf), ...fresh.map((a) => ({ path: a.path, view: a.view }))];
}

/** DT-C274 (Row 794-c): the record on disk laid under the latest one: every path once, the latest record's entry winning. */
export function mergedTeamFolders(disk: unknown, latest: unknown): TeamRecord[] {
  const now = teamFoldersOf(latest);
  return [...teamFoldersOf(disk).filter((d) => !now.some((t) => sameDir(t.path, d.path))), ...now].map(recordOf);
}

/** DT-C274: the folder whose grid shows the agent of team worktree `dir`; undefined when `dir` is no recorded team
 *  worktree, or its grid was not recorded. */
export function teamViewOf(settings: Record<string, unknown>, dir: string | null): string | undefined {
  if (dir === null) return undefined;
  return teamFoldersOf(settings[TEAM_WORKTREES_SETTING]).find((t) => sameDir(t.path, dir))?.view ?? undefined;
}

/** DT-C274: the team grid select() shows team worktree `dir` in: its recorded grid while that grid still has panes;
 *  undefined for a plain workspace, and for a stranded team worktree (its grid empty), which is shown as itself. */
export function selectView(settings: Record<string, unknown>, panes: { key: number; cwd: string | null; view?: string | null }[], dir: string): string | undefined {
  const view = teamViewOf(settings, dir);
  return view !== undefined && panesIn(panes, view).length > 0 ? view : undefined;
}

/** DT-C274: whether a command-line file request for worktree `dir` can open in the shown grid `active`: the worktree
 *  itself, or its team's grid when `dir` is a recorded team worktree (select() shows that grid instead; a stranded one,
 *  with no pane left in that grid, is shown as itself). One workspace per project: a linked worktree of a project is
 *  shown in the project's grid (`gridOf`), so its file is ready once that grid is in front. */
export function cliFileShown(settings: Record<string, unknown>, dir: string, active: string | null): boolean {
  if (sameDir(dir, active) || sameDir(gridOf(dir), active)) return true;
  const view = teamViewOf(settings, dir);
  return view !== undefined && sameDir(view, active);
}

/** DT-C274 (STAT-039): a moved folder takes its records along, as the worktree and as the grid; null when none named it. */
export function movedTeamFolders(v: unknown, from: string, to: string): TeamRecord[] | null {
  const had = teamFoldersOf(v);
  if (!had.some((t) => sameDir(t.path, from) || (t.view !== null && sameDir(t.view, from)))) return null;
  return had.map((t) => recordOf({ path: sameDir(t.path, from) ? to : t.path, view: t.view !== null && sameDir(t.view, from) ? to : t.view }));
}

/** DT-C274: the record without the worktrees no longer listed (`listed`: every worktree a full scan found); null when
 *  nothing goes, so nothing is written. Only a worktree already recorded when the scan began (`began`) can go: one a
 *  team launch made while the scan ran may be missing from it. */
export function prunedTeamFolders(v: unknown, listed: string[], began: unknown = v): TeamRecord[] | null {
  const had = teamFoldersOf(v);
  const old = teamFoldersOf(began);
  const kept = had.filter((t) => listed.some((d) => sameDir(d, t.path)) || !old.some((o) => sameDir(o.path, t.path)));
  return kept.length === had.length ? null : kept.map(recordOf);
}

/** DT-C274: the team worktrees the sidebar leaves out. One is shown again when it is stranded: nothing is shown in its
 *  team's grid any more and nothing runs in it (`open`: every folder a pane runs in or is shown in). */
export function hiddenTeamFolders(v: unknown, open: string[]): string[] {
  const used = (d: string | null) => d !== null && open.some((o) => sameDir(o, d));
  return teamFoldersOf(v).filter((t) => used(t.path) || used(t.view)).map((t) => t.path);
}

/** DT-C274: each project's list without the worktrees a team launch made. A main checkout is never left out. */
export function withoutTeamMade<W extends { path: string; isMain?: boolean }>(lists: Record<string, W[]>, team: string[], same: (a: string, b: string) => boolean): Record<string, W[]> {
  if (team.length === 0) return lists;
  return Object.fromEntries(Object.entries(lists).map(([id, ws]) => [id, ws.filter((w) => w.isMain || !team.some((d) => same(d, w.path)))]));
}

/** AUTO-024: moving to a worktree the switch hides (View run, the palette) turns the switch off so it can be seen. */
export function jumpUnhides(prev: string | null, next: string | null, lists: Record<string, Made[]>, hide: boolean, same: (a: string, b: string) => boolean): boolean {
  if (!hide || next === null || (prev !== null && same(prev, next))) return false;
  return Object.values(lists).some((ws) => ws.some((w) => w.madeBy === "automation" && same(w.path, next)));
}

/** Strongest first: a permission request outranks everything. */
const RANK: AgentState[] = ["permission", "blocked", "waiting", "interrupted", "working", "queued", "done", "idle"];

export function strongest(states: AgentState[]): AgentState {
  return states.reduce<AgentState>((best, s) => (RANK.indexOf(s) < RANK.indexOf(best) ? s : best), "idle");
}

/** A pane's state from what the window knows: a shell is idle; an agent is working until its program ends. */
export function paneState(agent: string, running: boolean | undefined): AgentState {
  if (agent === "shell") return "idle";
  return running === false ? "done" : "working";
}

/** Smart classes (PROJ-050): what needs you, then finished, then working, then idle. An interrupted agent needs you; it is never done. */
export function smartClass(s: AgentState): number {
  if (s === "permission" || s === "blocked" || s === "waiting" || s === "interrupted") return 0;
  if (s === "done") return 1;
  if (s === "working" || s === "queued") return 2;
  return 3;
}

export function smartOrder<T>(rows: T[], info: (row: T) => RowInfo): T[] {
  return [...rows].sort((a, b) => {
    const [ia, ib] = [info(a), info(b)];
    return smartClass(ia.state) - smartClass(ib.state) || ib.changed - ia.changed;
  });
}

const STATUS_GROUPS = ["Needs you", "Working", "Queued", "Done", "Idle"];
const PR_GROUPS = ["In progress", "Done", "Closed", "No pull request"];

export function statusGroup(s: AgentState): string {
  if (s === "queued") return "Queued";
  return ["Needs you", "Done", "Working", "Idle"][smartClass(s)];
}

/** A merged pull request is done; a suppressed one still counts as in progress (PROJ-045). */
export function prGroup(pr: PrState): string {
  if (pr === "merged") return "Done";
  if (pr === "closed") return "Closed";
  if (pr === null) return "No pull request";
  return "In progress";
}

export function groupRows<T>(rows: T[], by: GroupBy, info: (row: T) => RowInfo, project: (row: T) => string): { title: string; rows: T[] }[] {
  if (by === "none") return [{ title: "", rows }];
  const titles = by === "status" ? STATUS_GROUPS : by === "pr" ? PR_GROUPS : [...new Set(rows.map(project))];
  const key = (r: T) => (by === "status" ? statusGroup(info(r).state) : by === "pr" ? prGroup(info(r).pr) : project(r));
  return titles.map((title) => ({ title, rows: rows.filter((r) => key(r) === title) })).filter((g) => g.rows.length > 0);
}

export function sortFromSetting(v: unknown): SortBy {
  return v === "name" || v === "activity" || v === "manual" ? v : "smart";
}

export function groupFromSetting(v: unknown): GroupBy {
  return v === "none" || v === "status" || v === "pr" ? v : "project";
}

/** One key per folder, however Git or Windows spelled it; the backend's activity map uses the same. */
export function pathKey(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** PROJ-051: latest activity first; rows never seen keep their order at the end. */
export function recentOrder<T>(rows: T[], stamp: (row: T) => number): T[] {
  return [...rows].sort((a, b) => stamp(b) - stamp(a));
}

/** PROJ-046: the pinned paths and every workspace made from them, at any depth, as path keys. */
export function pinnedSet(pins: string[], ws: { path: string; parent?: string | null }[]): Set<string> {
  const out = new Set(pins.map(pathKey));
  for (let grew = true; grew; ) {
    grew = false;
    for (const w of ws) {
      const k = pathKey(w.path);
      if (w.parent && !out.has(k) && out.has(pathKey(w.parent))) grew = !!out.add(k);
    }
  }
  return out;
}

/** PROJ-053: the sleeping workspaces' path keys, and VIEW-053: whether sleeping rows show. */
export const SLEEP_SETTING = "sleepingWorkspaces";
export const SHOW_SLEEPING_SETTING = "showSleeping";

/** VIEW-053: shown on a fresh profile; an explicit "hide" is kept. */
export const showSleepingFrom = (v: unknown) => v !== false;

/** PROJ-053: sleeping takes the workspaces made from this one along; waking wakes only this one. */
export function asleepAfter(asleep: string[], ws: { path: string; parent?: string | null }[], path: string, sleep: boolean): string[] {
  const k = pathKey(path);
  if (!sleep) return asleep.filter((x) => x !== k);
  return [...new Set([...asleep, ...pinnedSet([path], ws)])];
}

/** A key on a workspace row: only the row itself answers (Enter or Space shows it, F2 renames); the same key on a button inside it belongs to that button. */
export function rowKey(key: string, onRow: boolean): "show" | "rename" | null {
  if (!onRow) return null;
  if (key === "Enter" || key === " ") return "show";
  return key === "F2" ? "rename" : null;
}

/** Escape closes the Add project form, except while an edited workspaces-folder field is still reverting itself or an IME is composing. */
export const closeAddOnEscape = (key: string, composing: boolean, editingRoot: boolean): boolean => key === "Escape" && !composing && !editingRoot;

/**
 * The group to take away when its form closes unsaved: only one still in the list. A group the user already
 * deleted from its own form is gone, and deleting it a second time would replace the green note with an error.
 */
export const freshGroupToDrop = (fresh: string | null, open: string | null, ids: string[]): string | null => (fresh !== null && open !== fresh && ids.includes(fresh) ? fresh : null);

/** A failed create puts the typed words back only where nobody has moved on: no form open, or this project's own. */
export const mayRestoreDraft = (creating: string | null, projectId: string): boolean => creating === null || creating === projectId;

/** What sleeping `path` would newly put to sleep: the new asleep list and the folders that change. */
export function sleepPlan(asleep: string[], ws: { path: string; parent?: string | null; isMain?: boolean }[], path: string): { next: string[]; paths: string[] } {
  const next = asleepAfter(asleep, ws.filter((x) => !x.isMain), path, true);
  return { next, paths: ws.map((x) => x.path).filter((d) => next.includes(pathKey(d)) && !asleep.includes(pathKey(d))) };
}

/** TERM-045 / DT-C274: how many of `sessions` are under `roots`, counting a session once when the folder it runs in
 *  or the folder whose grid shows it is under one (an own-folder team's agents close with their grid's folder).
 *  PROJ 008 / F21: a session of a `staying` folder deeper than the removed one (a nested project that stays) is not counted. */
export function sessionsUnder(roots: string[], sessions: { cwd: string | null; view?: string | null }[], staying: string[] = []): number {
  const key = pathKey;
  const under = (c: string | null | undefined) => typeof c === "string" && (staying.length ? goesWith(c, roots, staying) : roots.some((p) => key(c) === key(p) || key(c).startsWith(key(p) + "/")));
  // R74-02: and by the grid that shows it (`viewOf`), as `withoutDir` closes it: a shared worktree shown in the removed grid.
  // R83-04: `closesWith` keeps a session whose own folder a staying project lists, whichever grid shows it.
  return sessions.filter((s) => under(s.cwd) || under(s.view) || closesWith(s, roots, staying)).length;
}

/** The sentence a sleep or removal question adds when terminals would be closed; empty for none. */
export function closingNote(n: number): string {
  return n ? ` ${n} terminal${n === 1 ? " is" : "s are"} still running and will be closed.` : "";
}

/** PROJ-059: the name Enter saves (trimmed, shortcodes turned into emoji), or null to cancel. */
export function renameTo(typed: string, current: string): string | null {
  const n = shortcodes(typed).trim();
  return n === "" || n === current ? null : n;
}

export type AddOutcome = { path: string; kind: "added" | "plain" | "failed"; error?: string };

/** Several folders added at once: the first plain folder is asked about now; the others and any failures are counted in one note. */
export function addReport(outs: AddOutcome[]): { ask: string | null; note: string | null; kind: "ok" | "warn" | "error" } {
  const plain = outs.filter((o) => o.kind === "plain");
  const failed = outs.filter((o) => o.kind === "failed");
  const added = outs.filter((o) => o.kind === "added").length;
  const parts = [
    added ? `${added} project${added === 1 ? "" : "s"} added.` : "",
    plain.length > 1 ? `${plain.length - 1} more folder${plain.length === 2 ? " is" : "s are"} ${plain.length === 2 ? "not a Git repository" : "not Git repositories"}: add ${plain.length === 2 ? "it" : "them"} one at a time.` : "",
    failed.length ? `${failed.length} could not be added (${failed[0].path}: ${failed[0].error ?? "unknown error"}${failed.length > 1 ? ", and others" : ""}).` : "",
  ].filter(Boolean);
  return { ask: plain[0]?.path ?? null, note: parts.length ? parts.join(" ") : null, kind: failed.length ? "error" : plain.length > 1 ? "warn" : "ok" };
}
