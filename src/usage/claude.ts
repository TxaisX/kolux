// Claude's rate-limit windows as the usage pill shows them (STAT-040, USAGE-008). Claude Code
// reports them through its status line; the Rust side keeps the last report and this file turns
// the weekly window into words.
export type ClaudeLimit = { kind: string; usedPercent: number; resetsAt: number | null };

const left = (used: number) => `${Math.max(0, Math.round(100 - used))}% left`;

/** The pill's window: the weekly one alone (USAGE-008); the 5-hour window never shows here. */
export const weeklyOf = (limits: ClaudeLimit[]): ClaudeLimit | undefined => limits.find((l) => l.kind === "seven_day");

/** "2d 4h", "4h 5m", "12m", "under 1m", or "now" once the time has come; rounded down, zero parts
 *  dropped (USAGE-024). */
export function countdown(at: number, now: number = Date.now()): string {
  if (at <= now) return "now";
  const mins = Math.floor((at - now) / 60_000);
  if (mins === 0) return "under 1m";
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const parts = d > 0 ? [[d, "d"], [h, "h"]] : [[h, "h"], [m, "m"]];
  return parts.filter(([n]) => n).map(([n, u]) => `${n}${u}`).join(" ");
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
/** USAGE-024: ms until the nearest future reset's countdown next changes, a little after the
 *  change: each minute within a day of it, each hour further out. null with nothing to count. */
export function nextTick(resets: (number | null | undefined)[], now: number = Date.now()): number | null {
  const ahead = resets.filter((r): r is number => typeof r === "number" && r > now);
  if (!ahead.length) return null;
  const left = Math.min(...ahead) - now;
  const unit = left <= 86_400_000 ? MINUTE : HOUR;
  // A remainder of 0 means the countdown changes within the next millisecond, so wait a moment
  // rather than a whole unit (T5-F01).
  return (left % unit) + 250;
}

/** The hover line both pills share: the weekly limit, what is left, and when it resets. */
export const weeklyLine = (used: number, resetsAt: number | null, now: number = Date.now()): string =>
  `Weekly limit: ${left(used)}, ${resetsAt ? `resets ${resetsAt <= now ? "now" : `in ${countdown(resetsAt, now)}`}` : "reset time unknown"}`;

export function pillText(limits: ClaudeLimit[]): string {
  const w = weeklyOf(limits);
  return w ? `Claude ${left(w.usedPercent)}` : "Claude · unknown";
}

export function pillDetail(limits: ClaudeLimit[], now: number = Date.now()): string {
  const w = weeklyOf(limits);
  if (!w) return "Claude's weekly limit appears once a Claude Code session reports it through its status line.";
  return weeklyLine(w.usedPercent, w.resetsAt, now);
}
