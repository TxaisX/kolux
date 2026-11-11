// TERM-123 / HID-028 (T-817; Txais 2026-11-09: "Build it, off by default"; 2026-11-10: "Default on"): agent sleep, the rules.
// An agent pane left idle past the chosen delay is put to sleep to free memory. The idle clock counts
// from the agent's last state change (stamp); a finished turn (done or idle) makes the pane eligible.
// Never eligible: the agent is working, waiting on a question or a permission, the pane's message box
// holds unsent text (kept or too long to keep), the pane is drawn in a visible window, the program is
// not running (a shell or another command is in front), or no resumable session id is known (none
// reported, a fork's parent id, or an id guessed from the session list). When in doubt, the pane stays
// awake. The Rust side re-checks what it alone knows (agent_pane_sleep): the terminal, the agent in
// front, the time since the terminal last printed or was typed in, and the live status row, before
// anything is recorded or ended.
import type { Pane } from "../App";
import type { AgentState } from "../projects/rows";
import { resumeId } from "../sessions/ownership";

export const SLEEP_ON_FIELD = "agentSleep";
export const SLEEP_MINUTES_FIELD = "agentSleepIdleMinutes";
export const IDLE = { min: 5, max: 240, base: 30 } as const;
/** One check per minute at most, only while the switch is on; no per-pane timers. */
export const TICK_MS = 60_000;
/** Development builds only (import.meta.env.DEV): `agentSleepTestFast: true` in the settings file makes the
 *  idle delay 20 seconds and the check every 5 seconds, so the sleep can be watched. A release build never
 *  reads it: the shortest delay users can set stays 5 minutes. */
export const TEST_FAST_FIELD = "agentSleepTestFast";
const FAST = { idleMs: 20_000, tickMs: 5_000 } as const;

/** The switch: on unless saved `false` (Txais 2026-11-10: "Default on"); a missing key or another type reads
 *  as on, and an old profile's own sleep key (HID-028 Compat: it had another name) is never read. */
export const sleepOn = (settings: Record<string, unknown>): boolean => settings[SLEEP_ON_FIELD] !== false;

/** The delay as saved: 30 when missing or unreadable, else held between 5 and 240 (whole minutes). */
export function clampIdleMinutes(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return IDLE.base;
  return Math.min(IDLE.max, Math.max(IDLE.min, Math.round(n)));
}
export const idleMinutes = (settings: Record<string, unknown>): number => clampIdleMinutes(settings[SLEEP_MINUTES_FIELD]);
/** The text typed in the minutes box as a delay, or null when it is not a number (the box then keeps the saved one). */
export const minutesFromText = (text: string): number | null => (text.trim() !== "" && Number.isFinite(Number(text)) ? clampIdleMinutes(Number(text)) : null);

export const testFast = (settings: Record<string, unknown>, dev: boolean = import.meta.env.DEV): boolean => dev && settings[TEST_FAST_FIELD] === true;
/** How long a pane must be idle, and how often the check runs. */
export function timing(settings: Record<string, unknown>, dev?: boolean): { idleMs: number; tickMs: number } {
  return testFast(settings, dev) ? FAST : { idleMs: idleMinutes(settings) * 60_000, tickMs: TICK_MS };
}

/** What the check knows about one pane. */
export type PaneView = {
  /** The pane's last hook-fed state; none when no hook has reported. */
  state: AgentState | undefined;
  /** When that state was last set (Date.now()), none when never. */
  changedAt: number | undefined;
  /** The program (the agent) is running in the pane: false when it ended, undefined while it starts. */
  running: boolean | undefined;
  /** A question or permission the turn is waiting on, or background tasks still going (STAT-024). */
  ask: string | undefined;
  monitoring: boolean | undefined;
  /** The pane's message box holds unsent text (chat/composer.ts hasUnsent: a kept draft or one too long to keep). */
  draft: boolean;
  /** The pane is drawn (inView) and the document is visible: someone may be reading it, focused or not. */
  visible: boolean;
};

/** Only these hook states are a finished turn. */
export const FINISHED: readonly AgentState[] = ["done", "idle"];

export type SleepRefusal =
  | "not a terminal"
  | "not an agent pane"
  | "already asleep"
  | "no resumable session"
  | "program not running"
  | "no state yet"
  | "not finished"
  | "waiting on the user"
  | "background tasks"
  | "unsent draft"
  | "visible"
  | "not idle long enough";

/** Why pane `p` stays awake now, or null when it may sleep. Every rule of TERM-123 and the brief's NEVER list. */
export type SleepPane = Pick<Pane, "kind" | "seats" | "agent" | "agentId" | "program" | "session" | "sessionListed" | "forkOf" | "asleep">;
export function sleepRefusal(p: SleepPane, v: PaneView, now: number, idleMs: number): SleepRefusal | null {
  if (p.kind || p.seats) return "not a terminal";
  if (p.agent === "shell" || !p.agentId || p.program === null) return "not an agent pane";
  if (p.asleep) return "already asleep";
  // T-066-e: an id picked from the session list is a guess, not the agent's own report; never resume it blind.
  if (resumeId(p) === null || p.sessionListed) return "no resumable session";
  if (v.running !== true) return "program not running";
  if (v.state === undefined || v.changedAt === undefined) return "no state yet";
  if (v.state === "permission" || v.state === "waiting" || v.ask) return "waiting on the user";
  if (!FINISHED.includes(v.state)) return "not finished";
  if (v.monitoring) return "background tasks";
  if (v.draft) return "unsent draft";
  if (v.visible) return "visible";
  if (now - v.changedAt < idleMs) return "not idle long enough";
  return null;
}

/** The keys of the panes due for sleep, in pane order. */
export function dueForSleep<P extends SleepPane & Pick<Pane, "key">>(panes: P[], view: (key: number) => PaneView, now: number, idleMs: number): number[] {
  return panes.filter((p) => sleepRefusal(p, view(p.key), now, idleMs) === null).map((p) => p.key);
}

/** What a sleeping pane carries: when it slept, how long it had been idle (for the placeholder), and the
 *  session id the Rust side recorded at sleep, which Wake resumes. Not saved with the layout: after a
 *  restart the pane comes back as a plain shell like every agent tab (DT-C27), so there is nothing to wake. */
export type Asleep = { since: number; idleMin: number; session: string };
export const asleepNow = (now: number, changedAt: number | undefined, session: string): Asleep => ({ since: now, idleMin: changedAt === undefined ? 0 : Math.max(0, Math.round((now - changedAt) / 60_000)), session });
/** What `agent_pane_sleep` answers: the terminal to end and the session it recorded. */
export type Slept = { terminal: number; session: string };
/** A check whose real gap is far past the tick (the machine slept) is skipped; the next tick measures afresh. */
export const tickSkipped = (gap: number, tickMs: number): boolean => gap > tickMs * 3;
/** The idle minutes the placeholder shows: the minutes before sleep plus the time asleep, so the count keeps moving. */
export const idleShown = (a: Asleep, now: number): number => a.idleMin + Math.max(0, Math.round((now - a.since) / 60_000));

/** The Rust side's start line for a restored tab (main.tsx asks the same): the agent's standing line plus
 *  its resume form for `session`. */
export type StartLine = { args: string[]; program: string | null; env: [string, string][]; resumed: boolean };

/** The pane fields a wake sets from the restored-tab line (the same path a restored tab takes at start):
 *  the resume line replaces the launch line, so the opening prompt (`typed`, delivered once by Pane.tsx
 *  onPty) and the prompt the launch `args` may carry (agents.rs) never run a second time. The pane's
 *  session becomes the recorded one. No line (the Rust side refused) is not a wake: the caller keeps the
 *  pane asleep and says why (useAgentSleep.wakePane). */
export function wokenFields<P extends Pick<Pane, "program" | "args" | "env" | "asleep" | "typed" | "session">>(p: P, line: StartLine): P & { asleep: undefined; typed: undefined; resumed: boolean } {
  return { ...p, asleep: undefined, typed: undefined, session: p.asleep?.session ?? p.session, args: line.args, program: line.program ?? p.program, env: line.env, resumed: line.resumed };
}
