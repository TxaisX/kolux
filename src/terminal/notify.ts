// STAT-041: the words of a finish-and-bell note. The in-window toast and the desktop notification
// say the same thing; the window decides from a status change whether there is anything to say.
import type { AgentState } from "../projects/rows";

/** STAT-022: why a session stopped, the agent's own words, and when a limit lifts (ms since the epoch). */
export type StopInfo = { cause: "limit" | "signin" | "error" | "restart"; detail?: string; resetsAt?: number };
export type Turn = { state: AgentState; interrupted: boolean; boundary: boolean; monitoring?: boolean; reply?: string; child?: string; stop?: StopInfo };
/** `stopped` marks a note the 'Agent Stopped' switch gates (STAT-023) rather than 'Agent Task Complete'. */
export type Note = { what: string; body: string; stopped?: true };

const CAUSE: Record<StopInfo["cause"], string> = { limit: "limit reached", signin: "sign in again", error: "the AI hit an error", restart: "restart this terminal" };

/** "3:05 PM" today, "Tue 3:05 PM" another day. */
export function resetWords(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/** The short wording the Board chips and the stopped notification share (STAT-022). */
export function stopLine(stop: StopInfo): string {
  const head = CAUSE[stop.cause];
  const tail = stop.resetsAt ? `resets at ${resetWords(stop.resetsAt)}` : stop.detail;
  return `${head[0].toUpperCase()}${head.slice(1)}${tail ? ` · ${tail}` : ""}`;
}

/** One line of a reply, cut to fit a notification. */
export function preview(reply: string): string {
  const line = reply.replace(/\s+/g, " ").trim();
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

/**
 * What a status change says about the pane, or null when it is not worth a note: session boundaries
 * and replayed events say nothing, nor does plain progress; a finish, a permission request, a block
 * and an interrupt do, and every sub-agent turn is a note of its own.
 */
export function turnNote(prev: AgentState | undefined, t: Turn): Note | null {
  if (t.boundary) return null;
  const body = t.reply ? preview(t.reply) : "";
  if (t.child) return { what: `${t.child} finished`, body };
  if (prev === t.state) return null;
  switch (t.state) {
    case "done":
      return prev === undefined ? null : { what: "finished", body };
    case "interrupted":
      return { what: "was interrupted", body: "" };
    case "permission":
      return { what: "needs permission", body: "" };
    case "blocked": {
      // STAT-023: says why it stopped, with the reset time when known; never reads like a finish.
      const stop = t.stop ?? { cause: "error" as const };
      return { what: `stopped: ${CAUSE[stop.cause]}`, body: stop.resetsAt ? `Resets at ${resetWords(stop.resetsAt)}` : (stop.detail ?? body), stopped: true };
    }
    default:
      return null;
  }
}

/** "repo · tab finished" when several repositories have agents running, else "tab finished". */
export function noteTitle(tab: string, repo: string | null, what: string): string {
  return `${repo ? `${repo} · ` : ""}${tab} ${what}`;
}
