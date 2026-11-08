// USAGE-034: the pieces of the full usage readout in an agent pane's header, as plain functions:
// which plan windows a pane shows, how each figure reads, which pieces fit the header's measured
// width, the hover lines, and the clock that keeps the countdowns moving. The component that draws
// them is UsageReadout.tsx.
import { locale } from "../language";
import { CAP, contextLimit, shortTokens, shownPercent, tone, type ContextReading } from "../usage/meter";
import type { ClaudeLimit } from "../usage/claude";
import type { CodexUsage } from "../usage/codex";

/** One plan window of the pane's provider. `resetsAt` is in ms, null when the report gave none. */
export type PlanWindow = { label: "5h" | "wk"; name: "5-hour" | "Weekly"; usedPercent: number; resetsAt: number | null };

/** The plan windows a pane's agent shows: Claude's two from its status-line report, Codex's two
 * when its read is ok; none for a shell or a failed read. A window never named is left out. */
export function windowsOf(agent: string, claude: ClaudeLimit[], codex: CodexUsage | null): PlanWindow[] {
  const out: PlanWindow[] = [];
  if (agent === "claude") {
    const five = claude.find((l) => l.kind === "five_hour");
    const week = claude.find((l) => l.kind === "seven_day");
    if (five) out.push({ label: "5h", name: "5-hour", usedPercent: five.usedPercent, resetsAt: five.resetsAt });
    if (week) out.push({ label: "wk", name: "Weekly", usedPercent: week.usedPercent, resetsAt: week.resetsAt });
  }
  if (agent === "codex" && codex?.state === "ok") {
    const sec = (s: number | null) => (s === null ? null : s * 1000);
    if (codex.fiveHour) out.push({ label: "5h", name: "5-hour", usedPercent: codex.fiveHour.usedPercent, resetsAt: sec(codex.fiveHour.resetsAt) });
    if (codex.weekly) out.push({ label: "wk", name: "Weekly", usedPercent: codex.weekly.usedPercent, resetsAt: sec(codex.weekly.resetsAt) });
  }
  return out;
}

/** A plan figure as the used-or-left choice reads it (USAGE-025); the tint always follows how
 * much is used, so a nearly spent window is red whichever way the number reads. */
export function planFigure(w: PlanWindow, left: boolean): { text: string; tone: "" | "warn" | "danger" } {
  const used = Number.isFinite(w.usedPercent) ? w.usedPercent : 0;
  return { text: `${shownPercent(used, left ? "remaining" : "used")}%`, tone: tone(used) };
}

/** "155k/200k". */
export const tokensText = (used: number, window: number): string => `${shortTokens(used)}/${shortTokens(window)}`;

/** The session's cost in US dollars, two decimals; null (no chip) for no report or a broken figure. */
export function costText(usd: number | null | undefined): string | null {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) return null;
  return `$${usd.toFixed(2)}`;
}

/** What the window hands a pane's header: the pane's reading (tokens against the effective
 * window, cost) and the used-or-left choice. `tokens` is null until the first report. */
export type Readout = { tokens: number | null; window: number; costUsd: number | null; left: boolean };
export function readoutOf(r: (ContextReading & { costUsd?: number }) | undefined, capped: boolean, left: boolean): Readout {
  if (!r) return { tokens: null, window: contextLimit(CAP, capped), costUsd: null, left };
  return { tokens: r.tokens, window: contextLimit(r.window, capped), costUsd: r.costUsd ?? null, left };
}

// Measured by eye on the real header, in px. BASE is everything else the header holds at the
// widest (status mark, vendor mark, a readable title, the program word, the status word, the
// pane buttons); the rest are the readout's own pieces.
const BASE = 400;
const RING = 46;
const TOKENS = 90;
const PLAN = 52;
const COUNTDOWN = 66;
const COST = 56;
/** The header width at which a pane with a reading, two plan windows and a cost shows everything. */
export const FULL_WIDTH = BASE + RING + TOKENS + 2 * PLAN + 2 * COUNTDOWN + COST;

export type Pieces = { tokens: boolean; plan: boolean; countdowns: boolean; cost: boolean };

/** Which pieces fit a header of this measured width (not the window's: a split pane is narrow in
 * a wide window). Pieces go in a fixed order as the header narrows, the cost first, then the
 * countdowns, then the plan figures, then the tokens, so the ring and percentage always remain.
 * A piece with nothing to show takes no room. Unmeasured (undefined) shows everything there is. */
export function piecesFor(width: number | undefined, have: { tokens: boolean; windows: number; cost: boolean }): Pieces {
  // The card: a pane with no plan figures shows only the gauge (Decisions made for Txais, FIX-5).
  if (have.windows === 0) return { tokens: false, plan: false, countdowns: false, cost: false };
  if (width === undefined) return { tokens: have.tokens, plan: have.windows > 0, countdowns: have.windows > 0, cost: have.cost };
  let need = BASE + RING;
  const fits = (more: number) => {
    need += more;
    return width >= need;
  };
  // Each piece is added in keep order, and a piece that does not fit ends the list.
  const tokens = have.tokens && fits(TOKENS);
  const plan = (have.tokens ? tokens : true) && have.windows > 0 && fits(have.windows * PLAN);
  const countdowns = plan && fits(have.windows * COUNTDOWN);
  const cost = (have.windows > 0 ? countdowns : have.tokens ? tokens : true) && have.cost && fits(COST);
  return { tokens, plan, countdowns, cost };
}

/** "3:40 PM", with a weekday in front when the time is not today. */
function resetClock(at: number, now: Date): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString(locale(), { weekday: "short" })} ${time}`;
}

/** The hover: the gauge's line, then one line per window, "5-hour: 34% used, resets 3:40 PM". */
export function hoverLines(base: string, windows: PlanWindow[], left: boolean, now: Date = new Date()): string[] {
  return [
    base,
    ...windows.map((w) => {
      const f = planFigure(w, left).text;
      const reset = w.resetsAt === null ? "reset time unknown" : `resets ${resetClock(w.resetsAt, now)}`;
      return `${w.name}: ${f} ${left ? "left" : "used"}, ${reset}`;
    }),
  ];
}

/** USAGE-034: the countdowns tick at least every 30 s without a new turn. Returns the stop function. */
export function startTicker(onTick: (now: number) => void, everyMs = 30_000): () => void {
  const id = setInterval(() => onTick(Date.now()), everyMs);
  return () => clearInterval(id);
}
