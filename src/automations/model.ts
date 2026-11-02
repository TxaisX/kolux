import { locale } from "../language";
// The Automations list (AUTO-016) as pure functions: rows, sorting, filters and search, so the
// rules are tested without a window. The rows come from the back end (src-tauri/src/automations.rs).

export type Trigger = { kind: "schedule"; cron?: string; timezone?: string } | { kind: "event"; event: "pr-opened" | "checks-failed" | "agent-finished" };

export type Automation = {
  id: string;
  name: string;
  prompt: string;
  provider: string;
  projectId: string;
  workspaceMode?: "existing" | "new-per-run";
  workspace?: string | null;
  trigger?: Trigger;
  enabled: boolean;
  /** When the clock will start it next; milliseconds since 1970. */
  nextRunAt?: number | null;
  /** AUTO-005: the branch a new-per-run worktree is cut from; empty means the project's default. */
  baseBranch?: string;
  /** AUTO-010: whether each new-per-run worktree runs the project setup; missing means skip. */
  runSetup?: boolean;
  /** AUTO-009: an existing-worktree automation continues in the session its last run left open, when that is free. */
  reuseSession?: boolean;
  /** AUTO-007: how many minutes late a missed run may still start; 0 skips it. */
  missedRunGraceMinutes?: number;
  precheck?: string;
  precheckTimeoutSeconds?: number;
  /** From the back end (AUTO-022): what keeps it from running (project, worktree or sign-in). */
  problem?: string | null;
  /** From the back end (AUTO-001): the timetable in words, e.g. "Monday to Friday at 09:00 (UTC)". */
  timetable?: string;
  /** From the back end: the next run in the timetable's zone, e.g. "Monday 09:00". */
  nextRunLabel?: string;
  /** From the back end: what the dialog's timetable fields open with. */
  form?: ScheduleForm;
};

export type Preset = "hourly" | "daily" | "weekdays" | "weekly" | "custom";
/** The dialog's timetable fields: `time` is HH:MM (minutes past for hourly), `day` 0-6 from Sunday. */
export type ScheduleForm = { preset: Preset; time: string; day: number | null; custom: string };
export const defaultForm: ScheduleForm = { preset: "weekdays", time: "09:00", day: 1, custom: "" };

/** AUTO-012's states; `cause` says why a run was skipped. */
export type RunStatus = "pending" | "dispatching" | "dispatched" | "completed" | "skipped" | "failed";
export type Run = { id: string; reused?: boolean; automationId: string; number: number; trigger: "manual" | "schedule" | "event"; status: RunStatus; at: number; cause?: string; detail?: string; exitCode?: number | null; timedOut?: boolean; output?: string; worktree?: string; worktreeName?: string; repeats?: number; lastAt?: number; eventDetail?: string; worktreeGone?: boolean; dispatchedAt?: number; finishedAt?: number; provider?: string; outputFrom?: "screen" | "transcript" | "replay"; outputCut?: boolean; sessionId?: string; paneEnded?: boolean; reconnected?: boolean; terminal?: number | null };

export type SortKey = "name" | "trigger" | "agent" | "project" | "lastRun" | "nextRun";
export type Filters = { state: "all" | "on" | "paused"; result: "all" | "never" | RunStatus; agents: string[] };
export const noFilters: Filters = { state: "all", result: "all", agents: [] };

/** Search looks at this much of a prompt (AUTO-016). */
export const PROMPT_SEARCH_CHARS = 2048;
/** A query longer than this is refused rather than run. */
export const MAX_QUERY = 200;

let collator: [string, Intl.Collator] | null = null;
/** Names sort the way people count: "Run 2" before "Run 10", case ignored, in the interface
 * language's own order (SET-017). */
export const naturalCompare = (a: string, b: string): number => {
  const l = locale();
  if (collator?.[0] !== l) collator = [l, new Intl.Collator(l, { numeric: true, sensitivity: "base" })];
  return collator[1].compare(a, b);
};

/** The newest run of an automation, or none when it never ran. */
export function lastRun(id: string, runs: Run[]): Run | undefined {
  let best: Run | undefined;
  for (const r of runs) if (r.automationId === id && (!best || r.at > best.at || (r.at === best.at && r.number > best.number))) best = r;
  return best;
}

/** One case, single spaces, no ends; null when the query is too long to take. */
export function normalizeQuery(q: string): string | null {
  const n = q.trim().replace(/\s+/g, " ").toLowerCase();
  return n.length > MAX_QUERY ? null : n;
}

export type Names = { project: (id: string) => string; agent: (id: string) => string };

/** Name, project, worktree, agent and the first 2,048 characters of the prompt. */
export function matches(a: Automation, q: string, names: Names): boolean {
  if (q === "") return true;
  const hay = [a.name, names.project(a.projectId), a.workspace ?? "", a.workspace ? folderOf(a.workspace) : "", names.agent(a.provider), a.provider, a.prompt.slice(0, PROMPT_SEARCH_CHARS)].join("\n");
  return hay.replace(/[ \t]+/g, " ").toLowerCase().includes(q);
}

export function folderOf(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function passes(a: Automation, f: Filters, runs: Run[]): boolean {
  if (f.state === "on" && !a.enabled) return false;
  if (f.state === "paused" && a.enabled) return false;
  if (f.agents.length > 0 && !f.agents.includes(a.provider)) return false;
  if (f.result !== "all") {
    const last = lastRun(a.id, runs);
    if (f.result === "never" ? last !== undefined : last?.status !== f.result) return false;
  }
  return true;
}

/** Sorted rows. By last run: newest first, and automations that never ran always go last. */
export function sortRows(list: Automation[], runs: Run[], key: SortKey, desc: boolean, names: Names): Automation[] {
  const text = (a: Automation): string => (key === "agent" ? names.agent(a.provider) : key === "project" ? names.project(a.projectId) : key === "trigger" ? triggerLabel(a) : a.name);
  return [...list].sort((x, y) => {
    if (key === "lastRun" || key === "nextRun") {
      const vx = key === "lastRun" ? lastRun(x.id, runs)?.at : (x.enabled ? x.nextRunAt : null) ?? undefined;
      const vy = key === "lastRun" ? lastRun(y.id, runs)?.at : (y.enabled ? y.nextRunAt : null) ?? undefined;
      if (vx === undefined || vy === undefined) return vx === vy ? naturalCompare(x.name, y.name) : vx === undefined ? 1 : -1;
      // Last run reads newest first by default; next run soonest first.
      const order = key === "lastRun" ? vy - vx : vx - vy;
      return (desc ? -order : order) || naturalCompare(x.name, y.name);
    }
    const order = naturalCompare(text(x), text(y)) || naturalCompare(x.name, y.name);
    return desc ? -order : order;
  });
}

const events: Record<string, string> = { "pr-opened": "When a pull request opens", "checks-failed": "When checks fail", "agent-finished": "When an agent finishes" };
/** AUTO-004: the three event triggers the dialog offers, in order, each with the note shown under the choice. */
export const EVENT_CHOICES: Array<{ value: "pr-opened" | "checks-failed" | "agent-finished"; label: string; help: string }> = [
  { value: "pr-opened", label: events["pr-opened"], help: "A pull request opened from one of this project's worktrees starts a run, with a line about it on the end of the prompt. Kolux spots one within about 15 minutes while it is open; after a run it rests five minutes." },
  { value: "checks-failed", label: events["checks-failed"], help: "A run starts when the checks of a pull request from one of this project's worktrees go from pending to failing, with a line about it on the end of the prompt. Kolux sees the change within about a minute while it is polling that branch; red checks that stay red start nothing more, and after a run it rests five minutes." },
  { value: "agent-finished", label: events["agent-finished"], help: "A run starts when an agent working in one of this project's worktrees finishes its turn, with a line about it on the end of the prompt. Interrupted turns, session starts and the panes automations open themselves never count; after a run it rests five minutes." },
];
/** The timetable or trigger in a few words; a timetable's sentence comes from the back end. */
export function triggerLabel(a: Automation): string {
  const t = a.trigger;
  if (!t) return "No timetable";
  if (t.kind === "event") return events[t.event] ?? "On an event";
  if (a.timetable) return a.timetable;
  const cron = (t.cron ?? "").trim().replace(/\s+/g, " ");
  return cron ? `Custom: ${cron}` : "No timetable";
}

const CAUSE: Record<string, string> = { missed: "Kolux was away", signin: "sign-in needed", precheck: "precheck failed" };

/** AUTO-008: how long a precheck may take, in seconds. */
export const PRECHECK: [number, string][] = [
  [60, "1 minute"],
  [120, "2 minutes"],
  [300, "5 minutes"],
  [600, "10 minutes"],
];
export const precheckWord = (s: number | undefined) => (PRECHECK.find((p) => p[0] === (s ?? 60)) ?? PRECHECK[0])[1];

/** AUTO-007's choices for a run missed while Kolux was away, in minutes. */
export const GRACE: [number, string][] = [
  [0, "Skip it"],
  [30, "Start it up to 30 minutes late"],
  [60, "Start it up to 1 hour late"],
  [180, "Start it up to 3 hours late"],
  [720, "Start it up to 12 hours late"],
  [1440, "Start it up to 24 hours late"],
  [2880, "Start it up to 48 hours late"],
];
export const graceWord = (m: number | undefined) => (GRACE.find((g) => g[0] === (m ?? 0)) ?? GRACE[0])[1];

export function statusWord(r: Run): string {
  switch (r.status) {
    case "pending":
      return "Queued";
    case "dispatching":
      return "Starting";
    case "dispatched":
      return "Running";
    case "completed":
      return "Completed";
    case "skipped":
      if (r.cause === "precheck" && r.timedOut) return "Skipped (precheck timed out)";
      return (r.cause ? `Skipped (${CAUSE[r.cause] ?? r.cause})` : "Skipped") + ((r.repeats ?? 1) > 1 ? ` · ${r.repeats} times` : "");
    case "failed":
      return r.dispatchedAt === undefined ? "Failed to start" : "Failed";
  }
}

export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  const m = Math.round(s / 60);
  const h = Math.round(m / 60);
  // SET-017: other languages say it their own way; English keeps its short words.
  if (locale() !== "en") {
    const r = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
    return s < 60 ? r.format(0, "second") : m < 60 ? r.format(-m, "minute") : h < 48 ? r.format(-h, "hour") : r.format(-Math.round(h / 24), "day");
  }
  if (s < 60) return "just now";
  if (m < 60) return `${m} min ago`;
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function upcoming(a: Automation, now: number): string {
  if (!a.enabled) return "Paused";
  if (a.trigger?.kind === "event") return "On the next event";
  if (!a.nextRunAt) return "Not scheduled";
  const mins = Math.max(0, Math.round((a.nextRunAt - now) / 60000));
  const h = Math.round(mins / 60);
  const rel = mins < 60 ? `in ${mins} min` : h < 48 ? `in ${h} h` : `in ${Math.round(h / 24)} days`;
  return a.nextRunLabel ? `${a.nextRunLabel} · ${rel}` : rel;
}

/** The delete confirmation is on out of the box (AUTO-019); settings can switch it off. */
export const CONFIRM_DELETE_KEY = "confirmAutomationDelete";
export const confirmDelete = (settings: Record<string, unknown>): boolean => settings[CONFIRM_DELETE_KEY] !== false;

/** The prompt editor's find bar: where the next match starts at or after `from`, wrapping round to
 * the top, case ignored; -1 when there is none. */
export function findNext(text: string, query: string, from: number): number {
  if (query === "") return -1;
  const hay = text.toLowerCase();
  const q = query.toLowerCase();
  const at = hay.indexOf(q, from);
  return at >= 0 ? at : hay.indexOf(q);
}

/** The workspace a new automation starts in (AUTO-005): the main worktree, or failing that the first. */
export function preselect(worktrees: Array<{ path: string; isMain: boolean }>): string {
  return (worktrees.find((w) => w.isMain) ?? worktrees[0])?.path ?? "";
}

/** AUTO-015: the Runs dashboard across every automation. */
export type RunFilter = "all" | "progress" | "success" | "failed" | "skipped";
export const RUN_BATCH = 100;
const group = (s: RunStatus): Exclude<RunFilter, "all"> => (s === "completed" ? "success" : s === "failed" ? "failed" : s === "skipped" ? "skipped" : "progress");
export const startedBy = (r: Run): string => (r.trigger === "manual" ? "by hand" : r.trigger === "event" ? "by an event" : "by the timetable");

/** AUTO-014 / T-085-h: what the saved output is: the end's text, the most recent part of it, what the agent itself said, or
 * the replay of a run that Kolux reconnected to after a restart and is still following. */
export const outputNote = (r: Run): string => {
  if (r.outputFrom === "transcript") return r.outputCut ? "The most recent of what the agent said; older text was left out." : "What the agent said during the run, from its transcript.";
  if (r.outputFrom === "replay") return r.outputCut ? "The most recent text the agent's terminal had shown when Kolux restarted; older lines were left out. The run carries on in that terminal." : "What the agent's terminal had shown when Kolux restarted. The run carries on in that terminal.";
  return r.outputCut ? "The most recent text the agent's terminal showed; older lines were left out." : "What the agent's terminal showed when the run ended.";
};

/** Every run that fits the filter and the search, newest first. */
export function dashboardRows(runs: Run[], automation: (id: string) => string, filter: RunFilter, query: string): Run[] {
  const q = query.trim().toLowerCase();
  return runs
    .filter((r) => filter === "all" || group(r.status) === filter)
    .filter((r) => q === "" || [automation(r.automationId), statusWord(r), startedBy(r), r.worktreeName ?? "", r.detail ?? ""].some((t) => t.toLowerCase().includes(q)))
    .sort((x, y) => y.at - x.at || y.number - x.number);
}

/** Successes and failures over the last 24 hours and 7 days; a run dated in the future counts in neither. */
export function runTiles(runs: Run[], now: number) {
  const count = (span: number, status: RunStatus) => runs.filter((r) => r.status === status && r.at <= now && r.at > now - span).length;
  const day = 86400000;
  return { day: { ok: count(day, "completed"), failed: count(day, "failed") }, week: { ok: count(7 * day, "completed"), failed: count(7 * day, "failed") } };
}

/** The rows a scrolled list draws, `[start, end)`: those on screen and a few spare either side. */
export function onScreen(scrollTop: number, height: number, rowHeight: number, total: number, spare = 5): [number, number] {
  return [Math.max(0, Math.floor(scrollTop / rowHeight) - spare), Math.min(total, Math.ceil((scrollTop + height) / rowHeight) + spare)];
}

/** AUTO-017: what a key does on the Automations page. `control` is focus in any field, button or
 *  link (the search box counts as `search` too), `row` is focus on a row itself, and `overlay` is a
 *  dialog, menu or confirmation on top of the page. Escape steps back from an opened automation
 *  to the list, then closes the page. */
export type PageKey = "up" | "down" | "open" | "tab" | "back" | "close";
export function pageKey(e: { key: string; mods: boolean; control: boolean; search: boolean; row: boolean; overlay: boolean; opened: boolean }): PageKey | null {
  if (e.mods || e.overlay) return null;
  if (e.control && !(e.search && ["ArrowUp", "ArrowDown", "Enter"].includes(e.key))) return null;
  if (e.key === "ArrowUp") return "up";
  if (e.key === "ArrowDown") return "down";
  if (e.key === "Enter" || (e.key === " " && e.row)) return e.opened ? null : "open";
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") return "tab";
  if (e.key === "Escape") return e.opened ? "back" : "close";
  return null;
}

/** AUTO-017: the selection stays put; when its row is gone it moves to the row now at its place. */
export const keepSelection = (rows: string[], selected: string | null, lastIndex: number): string | null =>
  rows.length === 0 ? null : selected !== null && rows.includes(selected) ? selected : rows[Math.min(lastIndex, rows.length - 1)];

/** AUTO-013: what a run in an automation's Runs tab offers. A run that never got a workspace
 *  (skipped ones included) shows its details only; Rerun is for a failed run of an automation
 *  that still exists. The first action is what Enter does. */
export type RunAction = "view" | "resume" | "snapshot" | "rerun";
export function runActions(r: Run, o: { live: boolean; exists: boolean }): RunAction[] {
  const out: RunAction[] = [];
  if (r.worktree) out.push(r.worktreeGone ? "snapshot" : o.live ? "view" : "resume");
  if (r.status === "failed" && o.exists) out.push("rerun");
  return out;
}

/** AUTO-013: Up and Down step through `count` runs (Down with none selected picks the first),
 *  Enter opens the selected one; a key with a modifier held or mid-composition does nothing. */
export function runStep(e: { key: string; mods: boolean; composing: boolean }, at: number | null, count: number): number | "open" | null {
  if (e.mods || e.composing || count === 0) return null;
  if (e.key === "ArrowDown") return at === null ? 0 : Math.min(count - 1, at + 1);
  if (e.key === "ArrowUp") return at === null ? 0 : Math.max(0, at - 1);
  if (e.key === "Enter") return at === null ? null : "open";
  return null;
}
