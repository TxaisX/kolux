// Board cards (VIEW-023) and the one line under each session (VIEW-016): which lane a session
// sits in, one of a fixed set of words, and a short line saying what the agent is doing, all from
// the signals the window already has. Pure, tested on its own.

import type { AgentState } from "../projects/rows";
import { stopLine, type StopInfo } from "../terminal/notify";
import { IDLE, shownAgent, type Identity } from "../terminal/shellMarks";
import { launchedAgent, type LaunchRecord } from "../status/credit";
import type { Agent } from "../chrome/VendorMark";

export type Lane = "needs" | "working" | "done" | "stopped" | "idle";
export const LANES: Array<{ id: Lane; title: string }> = [
  { id: "needs", title: "Needs you" },
  { id: "working", title: "Working" },
  { id: "done", title: "Done" },
  { id: "stopped", title: "Stopped" },
  { id: "idle", title: "Idle" },
];

export type Signal = {
  agent: string;
  /** The hook-fed state; undefined before the first event. */
  state?: AgentState;
  /** undefined: no process yet; false: the program ended. */
  running?: boolean;
  /** STAT-045: the terminal has printed nothing for the quiet window. */
  stale: boolean;
  tool?: string;
  detail?: string;
  reply?: string;
  /** STAT-022: why the session is stopped, while it is. */
  stop?: StopInfo;
  /** The newest file the agent wrote this session. */
  wrote?: string;
  /** When the state last moved; 0 when unknown. */
  since: number;
  /** STAT-024: the turn is over and Kolux is watching the agent's background tasks. */
  monitoring?: boolean;
  /** STAT-027: the whole question the agent is waiting on, one question per line. */
  ask?: string;
};
export type Chip = { lane: Lane; word: string; line: string; file?: string; answer: boolean };

/** "45s", "4m", "1h 5m". */
export function span(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** The opening line of a message, trimmed. */
export function firstLine(s: string): string {
  return s.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

/** STAT-027: the questions of a waiting agent as one line, blank lines dropped. */
export function askLine(ask: string | undefined): string {
  return (ask ?? "").split("\n").map((l) => l.trim()).filter(Boolean).join(" · ");
}

/** T-608: the one state every surface reads for a pane: the Board's lane and the Tower's row (chipOf), the
 *  Inbox's group, the needs strip and the bell. The hook's word wins; else, while the program runs, the title
 *  guess the pane header shows (STAT-033); undefined before either has spoken. `agent` is
 *  paneAgent's: a plain terminal with no agent running in it has none on any of them. */
/** T-608 (ACCT-050, DT-C11): the agent whose status a pane carries, the one its tab icon shows: its own agent,
 *  or in a plain terminal the agent running there now, from the shell marks (TERM-058). An agent started by hand
 *  is credited by its hooks on every surface, and forgotten when the prompt returns, so no last word lingers. */
/*  Review of PR #16: an agent Kolux launched with no vendor mark of its own (Gemini, Grok, Devin, Hermes, Pi...)
 *  runs as agent "shell" plus its agentId; its launch record names it, so it is credited before the shell marks. */
export const paneAgent = (p: LaunchRecord & { agent: Agent }, live: Identity | undefined): string => {
  if (p.agent !== "shell") return p.agent;
  return launchedAgent(p) ?? shownAgent(p.agent, live ?? IDLE);
};

/** Review of PR #16: the prompt came back in a plain terminal after a hand-started agent ran there. Its last hook
 *  word and title guess then go with it, so the next agent started in that pane does not inherit a stale Needs you. */
export function promptReturned(p: LaunchRecord & { agent: Agent }, before: Identity | undefined, now: Identity): boolean {
  return p.agent === "shell" && launchedAgent(p) === null && Boolean(before?.agent) && !now.running && now.agent === null;
}

/** The map without one pane's entry; the same map when it has none. */
export function forget<T>(m: Record<number, T>, key: number): Record<number, T> {
  if (!(key in m)) return m;
  const { [key]: _gone, ...rest } = m;
  return rest;
}

export function paneStatus(agent: string, hook: AgentState | undefined, guess: AgentState | null | undefined, running: boolean | undefined): AgentState | undefined {
  if (agent === "shell") return undefined;
  return hook ?? (running === true ? (guess ?? undefined) : undefined);
}

/** T-608: what needs you, the same on every surface: a permission or a question (STAT-050, VIEW-023, TERM-029).
 *  A stop (blocked, interrupted) reads Stopped on the Board and the Tower. DT-C52 (Txais, 2026-10-31): Ctrl+J
 *  (TERM-030) and the tab badges (TERM-055) count only this too, not the pane header's own attention flag. */
export const needsYou = (state: AgentState | undefined): boolean => state === "permission" || state === "waiting";

/** What the bell counts (the pane header's attention tone): a prompt, and also a stop (blocked: a limit or a
 *  sign-in; interrupted). DT-C52 (Txais, 2026-10-31): a blocked pane still counts as needing you on the bell and in
 *  the Inbox. */
export const needsAttention = (state: AgentState | undefined): boolean => needsYou(state) || state === "blocked" || state === "interrupted";

/** Review of PR #16 (c): whether a pane rings the bell, as on main before PR #16: its one status needs attention,
 *  or its header's own attention flag is up (TerminalPane onNeedsYou), which also covers a program that failed to
 *  start (status.ts headerOf "failed"). */
export const ringsBell = (state: AgentState | undefined, headerNeeds: boolean): boolean => needsAttention(state) || headerNeeds;

/** Review of PR #16 (d): whether a plain terminal pane ignores hook words now. Once a hand-started agent's prompt has
 *  returned (promptReturned), a late Stop or done hook from it is dropped, until a new agent is recognised in the
 *  pane (the shell marks name one). `was` is the pane's flag before this identity change. */
export function hooksMuted(was: boolean, p: LaunchRecord & { agent: Agent }, before: Identity | undefined, now: Identity): boolean {
  if (promptReturned(p, before, now)) return true;
  return now.agent !== null ? false : was;
}

/** The most urgent signal wins: an approval, then working, then done, then idle; with no evidence the line stays empty. */
export function chipOf(s: Signal, now: number): Chip | null {
  if (s.agent === "shell") return null;
  const chip = (lane: Lane, word: string, line: string, file?: string): Chip => ({ lane, word, line, file, answer: false });
  const since = s.since > 0 ? span(now - s.since) : "";
  const step = [s.tool, s.detail].filter(Boolean).join(": ");
  if (s.running === undefined) return chip("working", "Starting", "");
  if (s.running === false && s.state !== "done") return chip("stopped", "Stopped", "Exited");
  switch (s.state) {
    case "permission":
      // T-124-c: Approve/Deny only answer a hook PermissionRequest, which names its pending tool; a
      // permission printed in band (OSC 9999) names nothing to answer, so it needs you without buttons.
      return { ...chip("needs", "Needs you", step || "Permission"), answer: Boolean(s.tool) };
    case "waiting":
      // STAT-027: every question asked, on the one line the card has (its tooltip carries the same text).
      return chip("needs", "Needs you", askLine(s.ask) || step || "Question");
    // A stop caused by a limit or sign-in reads Stopped, never Done (STAT-022 names the cause).
    case "blocked":
      return chip("stopped", "Stopped", s.stop ? stopLine(s.stop) : (s.detail ?? ""));
    case "interrupted":
      return chip("stopped", "Stopped", "Interrupted");
    case "done":
      return chip("done", "Done", s.reply ? firstLine(s.reply) : "", s.wrote);
    case "idle":
      return chip("idle", "Idle", since);
    case "queued":
      return chip("working", "Queued", since);
    default:
      // A stale working signal never shows Working. It says what is missing, the status: a long tool
      // can stream output all along (T-124-c).
      if (s.stale) return chip("working", "Quiet for a while", since ? `no status for ${since}` : "");
      if (s.monitoring) return chip("working", "Working", "Watching background tasks");
      return chip("working", "Working", [since, step].filter(Boolean).join(" · "));
  }
}
