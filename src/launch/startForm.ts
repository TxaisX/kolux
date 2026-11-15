// The Start form (Txais 2026-11-15): one question, asked once, for every pane. Which folders, how many in each,
// and which AI, model and effort; that one answer is applied to every seat. The per-seat rows of SESS-007 sit
// behind "Make each one different". These are the form's pure rules; ChooserPane draws them, SeatChooser and
// the window wire them (startSeats runs once per ticked folder).
import type { Pane } from "../App";
import { MAX_PANES } from "../terminal/grid";
import { sameDir } from "../workspaces";
import { seatStart, type SeatDefault } from "./defaultSeat";
import { applyLineup, emptySeat, MAX_SESSIONS, resizeLineup, TERMINAL, type Lineup, type Seat, type Shape } from "./seats";

/** Settings switch "Ask what to open when Kolux starts"; anything but an explicit false is on. */
export const START_ASK_KEY = "askWhatToOpen";
/** The folders (project ids) and the per-folder count of the last Start, so the form opens on them again. */
export const LAST_START_KEY = "lastStart";

/** The New session sheet's state: a chooser pane plus the ticked folders, and whether it is the at-open ask. */
export type StartSheet = Pane & { folders?: string[]; atOpen?: boolean };

export const asksAtStart = (settings: Record<string, unknown>): boolean => settings[START_ASK_KEY] !== false;

export type LastStart = { folders: string[]; count: number };
export function lastStart(settings: Record<string, unknown>): LastStart | null {
  const v = settings[LAST_START_KEY] as Partial<LastStart> | undefined;
  if (!v || !Array.isArray(v.folders) || typeof v.count !== "number" || !Number.isFinite(v.count)) return null;
  return { folders: v.folders.filter((f): f is string => typeof f === "string"), count: Math.min(MAX_SESSIONS, Math.max(1, Math.round(v.count))) };
}

/** What the one "Which AI / Model / Effort" row shows. */
export type OnePick = Pick<Seat, "agent" | "model" | "effort" | "fast">;
const pickOf = (s: Seat): OnePick => ({ agent: s.agent, model: s.model, effort: s.effort, fast: s.fast });
const samePick = (a: OnePick, b: OnePick) => a.agent === b.agent && a.model === b.model && (a.effort ?? "") === (b.effort ?? "") && !!a.fast === !!b.fast;

/** The single row's value: the seats' shared pick, or "mixed" when they differ. */
export function oneForAll(seats: Seat[]): OnePick | "mixed" {
  if (seats.length === 0) return { agent: null, model: null };
  const first = pickOf(seats[0]);
  return seats.every((s) => samePick(pickOf(s), first)) ? first : "mixed";
}

/** The single row sets every seat at once; roles, job titles and prompts stay per seat. */
export const setAll = (seats: Seat[], pick: OnePick): Seat[] => seats.map((s) => ({ ...s, agent: pick.agent, model: pick.model, effort: pick.effort, fast: pick.fast }));

/** A new "How many" keeps the one answer: when every seat holds the same pick, the added seats get it too.
 * Seats that differ are resized as before (job 13 F2). */
export function recountAll(shape: Shape, seats: Seat[], n: number): { shape: Shape; seats: Seat[] } {
  const one = oneForAll(seats);
  const next = resizeLineup(shape, seats, n);
  return one === "mixed" || one.agent === null ? next : { shape: next.shape, seats: setAll(next.seats, one) };
}

/** Picking an AI in the single row: every seat starts on it with the default model and effort (T-571). */
export const pickForAll = (seats: Seat[], agent: string, d: SeatDefault, saved?: Parameters<typeof seatStart>[2]): Seat[] => setAll(seats, seatStart(agent, d, saved));

/** T-809 for the Start form: blank seats all start on the default agent once detection answers, or null for no change. */
export function everySeatStart(seats: Seat[], defaultId: string, agents: { id: string; installed: boolean }[], d: SeatDefault, saved?: Parameters<typeof seatStart>[2]): Seat[] | null {
  if (defaultId === "" || !agents.some((a) => a.id === defaultId && a.installed)) return null;
  if (seats.length === 0 || seats.some((s) => s.agent !== null)) return null;
  return pickForAll(seats, defaultId, d, saved);
}

export type FolderRow = { id: string; name: string; path: string };

/** The known projects, the ones shown most recently first (the sidebar's PROJ-070 order), the rest as listed. */
export function recentFirst<P extends { path: string }>(projects: P[], recent: string[]): P[] {
  const rank = (p: P) => {
    const i = recent.findIndex((d) => sameDir(d, p.path) || d.toLowerCase().startsWith(p.path.toLowerCase().replace(/[\\/]+$/, "") + "\\") || d.toLowerCase().startsWith(p.path.toLowerCase().replace(/[\\/]+$/, "") + "/"));
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return projects.map((p, i) => ({ p, i, r: rank(p) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.p);
}

/** The whole launch across the ticked folders: its total, and why Start is off when it is. `used` is how many
 * cells each folder's grid already holds (SESS-008: a grid holds up to MAX_PANES). */
export function folderPlan(perFolder: number, folders: { name: string; used: number }[]): { total: number; problem: string | null } {
  const total = perFolder * folders.length;
  if (folders.length === 0) return { total, problem: "Tick at least one folder." };
  if (total > MAX_SESSIONS) return { total, problem: `${total} sessions is more than ${MAX_SESSIONS}, the most Kolux starts at once. Pick fewer, or untick a folder.` };
  const full = folders.find((f) => f.used + perFolder > MAX_PANES);
  if (full) return { total, problem: `${full.name} has room for ${Math.max(0, MAX_PANES - full.used)} more. A grid holds up to ${MAX_PANES}.` };
  return { total, problem: null };
}

/** The footer line in plain words: "6 sessions: Claude Code, Opus, High, in kolux". */
export function startSummary(perFolder: number, folderNames: string[], what: string[]): string {
  const total = perFolder * folderNames.length;
  const count = `${total} ${total === 1 ? "session" : "sessions"}`;
  const where =
    folderNames.length === 0 ? "" : folderNames.length === 1 ? `in ${folderNames[0]}` : `${perFolder} in each of ${folderNames.slice(0, -1).join(", ")} and ${folderNames[folderNames.length - 1]}`;
  return [`${count}${what.length || where ? ":" : ""}`, [...what, where].filter(Boolean).join(", ")].filter(Boolean).join(" ");
}

/** Rule D: the Start form opens by itself once per app start, in the first window, after the settings and the
 * first agent search have answered, unless switched off, already shown, a launch is under way or a sheet is open. */
export function askAtOpen(w: { on: boolean; firstWindow: boolean; asked: boolean; settingsRead: boolean; layoutIn?: boolean; agentsDone: boolean; projectsRead?: boolean; launching: boolean; sheetOpen: boolean; firstRun?: boolean; firstRunKnown?: boolean; agentsFailed?: boolean; userActed?: boolean }): "ask" | "wait" | "skip" {
  // D-15: the first-run screens hand over to the Start form themselves (job 22), so the ask at open stays away.
  if (w.asked || !w.firstWindow || w.firstRun) return "skip";
  // Job 29 R1: on a slow start the saved panes join after the settings read; until they are in, nothing counts as acted.
  if (w.layoutIn === false) return "wait";
  // Job 13 F4: it never jumps up over work. A first agent search that failed, or a user who has already started
  // something (a launch, a pane, a form), counts as answered: a later good search does not bring the form up.
  if (w.agentsFailed || w.userActed) return "skip";
  if (w.firstRunKnown === false) return "wait"; // the first-run screens' state comes from an async read (job 11 D-15)
  // Job 13 F1: the folders are read too, so the form never says "Add a folder first." or ticks none because the list came late.
  if (!w.settingsRead || !w.agentsDone || w.projectsRead === false) return "wait";
  if (!w.on || w.launching || w.sheetOpen) return "skip";
  return "ask";
}

/** Rule F: what the form opens on. Folders: the ones given (the project in front), else the last Start's that
 * still exist, else the first project. Count: the one given, else the last Start's, else the folder's last lineup,
 * else 1. Seats: the folder's last lineup (AI, model, effort) resized to the count, else blank (the default agent
 * fills them once detection answers, everySeatStart). */
export function prefill(o: { projects: { id: string }[]; folders?: string[] | null; count?: number | null; last: LastStart | null; lineup: Lineup | null; installed: string[] }): { folders: string[]; shape: Shape; seats: Seat[] } {
  const known = (ids: string[]) => ids.filter((id) => o.projects.some((p) => p.id === id));
  const given = known(o.folders ?? []);
  const kept = known(o.last?.folders ?? []);
  // Job 13 F7: a given list, even an empty one (New session with no project in front), is what gets ticked.
  const folders = o.folders ? given : kept.length ? kept : o.projects.length ? [o.projects[0].id] : [];
  const count = Math.min(MAX_SESSIONS, Math.max(1, o.count ?? o.last?.count ?? o.lineup?.seats.length ?? 1));
  if (o.lineup) {
    const back = applyLineup(o.lineup, o.installed);
    // One pick for all: the lineup's first seat with an AI is the pick every seat gets when the count changes it.
    const shared = oneForAll(back.seats);
    // Job 13 F9: a mixed lineup is not padded with blank seats; a remembered count stops at its length.
    const seats = back.seats.length === count || shared === "mixed" ? resizeLineup(back.shape, back.seats, shared === "mixed" && o.count == null ? Math.min(count, back.seats.length) : count) : resizeLineup(back.shape, setAll(Array.from({ length: count }, emptySeat), shared), count);
    if (seats.seats.some((s) => s.agent !== null)) return { folders, ...seats };
  }
  return { folders, shape: "custom", seats: Array.from({ length: count }, emptySeat) };
}

/** Rule E: the layout strip's count asks for the cells it adds, once, on the Start form (0 = nothing to ask). */
export const stripAsk = (add: number): number => Math.min(MAX_PANES, Math.max(0, add));

/** The plain words for the single row's pick, for the footer line. */
export function pickWords(pick: OnePick | "mixed", nameOf: (id: string) => string, modelLabel: (agent: string, model: string) => string): string[] {
  if (pick === "mixed") return ["each one different"];
  if (pick.agent === null) return [];
  if (pick.agent === TERMINAL) return ["plain terminal"];
  const words = [nameOf(pick.agent)];
  if (pick.model) words.push(modelLabel(pick.agent, pick.model));
  if (pick.effort) words.push(pick.effort[0].toUpperCase() + pick.effort.slice(1));
  if (pick.fast) words.push("fast");
  return words;
}

/** How one ticked folder's launch ended: `error` is null when it started, else why it did not, in plain words. */
export type FolderResult = { name: string; count: number; error: string | null };

/** Start form C (wave 2, item 2): every ticked folder is tried, one after another; a folder that is refused or fails
 * does not stop the ones after it. `run` resolves to null when the folder started, else the reason it did not. */
export async function startEach<T extends { name: string }>(folders: T[], count: number, run: (folder: T, n: number) => Promise<string | null>): Promise<FolderResult[]> {
  const out: FolderResult[] = [];
  for (const [n, f] of folders.entries()) {
    const error = await run(f, n).catch((e: unknown) => String(e));
    out.push({ name: f.name, count, error: error === null ? null : error.replace(/^Error: /, "") });
  }
  return out;
}

/** The one line after a launch across folders: null when every folder started; one folder says its own reason;
 * several say "4 of 6 started. 2 need you." and then each folder that did not start and why. */
export function acrossNote(results: FolderResult[]): string | null {
  const failed = results.filter((r) => r.error !== null);
  if (failed.length === 0) return null;
  if (results.length === 1) return failed[0].error;
  const total = results.reduce((n, r) => n + r.count, 0);
  const down = failed.reduce((n, r) => n + r.count, 0);
  return [`${total - down} of ${total} started. ${down} need${down === 1 ? "s" : ""} you.`, ...failed.map((r) => `${r.name} did not start: ${r.error}`)].join(" ");
}

/** Job 13 F1: the form's "Add folder" uses the one Add project dialog, which lives in the sidebar's project panel. When
 *  that panel is not drawn (sidebar hidden, or the Agents screen), it shows the panel first and fires the same request
 *  once the panel is there to hear it. False when the panel never came. */
export async function addFolderVia(h: { panelShown: () => boolean; showPanel: () => void; fire: () => void; wait: (ms: number) => Promise<void> }, tries = 20): Promise<boolean> {
  if (h.panelShown()) return void h.fire(), true;
  h.showPanel();
  for (let i = 0; i < tries; i++) {
    await h.wait(50);
    // one more wait after it shows, so the panel's listener (set after it draws) is there
    if (h.panelShown()) return await h.wait(50), h.fire(), true;
  }
  return false;
}
