// The usage meters (USAGE-005): how a session's context reading and its agent's plan figures
// become the Board card's meter, the tab ring and the pane header's percentage.
import type { ClaudeLimit } from "./claude";
import { resetWords, type CodexUsage } from "./codex";

export type ContextReading = { tokens: number; window: number };
export type PlanFigures = { fiveHour: number | null; weekly: number | null };
export type Meter = { context?: ContextReading & { percent: number }; plan?: PlanFigures };

/** USAGE-006: the window every session is held to while the cap is on. */
export const CAP = 200_000;
/** USAGE-006: the cap setting; never saved means on. */
export const CAP_FIELD = "contextCap200k";
export const capOn = (settings: Record<string, unknown>): boolean => settings[CAP_FIELD] !== false;

/** Context fill, 0 to 100, against the effective window: the cap while it is on, else the model's own. */
// ponytail: the cap is always on until T-041 wires the USAGE-006 switch through this argument.
export function contextFill(r: ContextReading, capped = true): number {
  const window = capped ? CAP : r.window;
  if (window <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((r.tokens / window) * 100)));
}

/** 84k, 1.3M, 950. */
export function shortTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}

/** USAGE-002: yellow at 70%, red past 90%, the same scale on the card bar and the pane header. */
export const tone = (percent: number): "" | "warn" | "danger" => (percent > 90 ? "danger" : percent >= 70 ? "warn" : "");

/** USAGE-025: the Appearance choice of how plan percentages read; missing or unknown means used. */
export const PERCENT_FIELD = "usagePercentages";
export type PercentMode = "used" | "remaining";
export const percentMode = (v: unknown): PercentMode => (v === "remaining" ? "remaining" : "used");
/** A used percentage as the choice reads it: rounded, held to 0..100, a broken value 0. Only the
 *  Agents screen's usage footer (T-040-b) follows it; the top pill always reads left. */
export function shownPercent(used: number, mode: PercentMode): number {
  if (!Number.isFinite(used)) return 0;
  const u = Math.min(100, Math.max(0, Math.round(used)));
  return mode === "remaining" ? 100 - u : u;
}

const pct = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? null : Math.min(100, Math.max(0, Math.round(n))));

/** The plan figures for a session's agent: Claude to the Claude account, Codex to Codex, none for the rest or when the read failed. */
export function planOf(agent: string, claude: ClaudeLimit[], codex: CodexUsage | null): PlanFigures | null {
  let p: PlanFigures | null = null;
  if (agent === "claude") p = { fiveHour: pct(claude.find((l) => l.kind === "five_hour")?.usedPercent), weekly: pct(claude.find((l) => l.kind === "seven_day")?.usedPercent) };
  if (agent === "codex" && codex?.state === "ok") p = { fiveHour: pct(codex.fiveHour?.usedPercent), weekly: pct(codex.weekly?.usedPercent) };
  return p && (p.fiveHour !== null || p.weekly !== null) ? p : null;
}

/** T-548: the Codex figures a pane may carry. src/usage holds the figures of the ACTIVE Codex account
 *  only, so a Codex pane begun on another account (`paneAccount` a different id, or null = Codex's own
 *  sign-in while a managed one is active) gets none rather than the active account's under its name.
 *  A pane with no recorded account yet (undefined) is unknown, so nothing is hidden; other agents pass through.
 *  T-548-b: `by` holds the figures read for the other accounts; a pane on one of them gets its own. */
export function codexOf(agent: string, paneAccount: string | null | undefined, active: string | null, codex: CodexUsage | null, by?: CodexByAccount): CodexUsage | null {
  if (agent !== "codex" || paneAccount === undefined) return codex;
  if (paneAccount === active) return codex;
  // T-548-b: the figures read for the pane's own account, when there are any
  return by?.[accountKey(paneAccount)] ?? null;
}

/** T-548-b: the Claude windows a pane may carry, the Claude half of `codexOf`. src/usage holds the windows of the
 *  ACTIVE Claude account (the pill); a pane begun on another account (or on Claude's own sign-in while a managed
 *  one is active) gets the windows read for its own config folder (`by`), or none (empty) until they are read.
 *  A pane with no recorded account yet (undefined) is unknown, so nothing is hidden; other agents pass through. */
export function claudeOf(agent: string, paneAccount: string | null | undefined, active: string | null, claude: ClaudeLimit[], by?: ClaudeByAccount): ClaudeLimit[] {
  if (agent !== "claude" || paneAccount === undefined) return claude;
  if (paneAccount === active) return claude;
  return by?.[accountKey(paneAccount)] ?? [];
}

/** T-548-b: Claude windows read per account, keyed by `accountKey`. */
export type ClaudeByAccount = Record<string, ClaudeLimit[]>;
/** T-548-b: Codex figures read per account, keyed by `accountKey`. */
export type CodexByAccount = Record<string, CodexUsage>;
/** The key of an account in a `CodexByAccount` map: its id, or "" for the system default sign-in. */
export const accountKey = (id: string | null): string => id ?? "";

/** The card's meter, or null when there is neither a context reading nor plan figures (USAGE-002). */
export function meterOf(ctx: ContextReading | undefined, agent: string, claude: ClaudeLimit[], codex: CodexUsage | null, capped = true): Meter | null {
  const m: Meter = {};
  if (ctx) m.context = { ...ctx, percent: contextFill(ctx, capped) };
  const plan = planOf(agent, claude, codex);
  if (plan) m.plan = plan;
  return m.context || m.plan ? m : null;
}

/** The hover text shared by the card meter, the tab ring and the header gauge. */
export function meterText(m: Meter): string {
  const lines: string[] = [];
  if (m.context) lines.push(`Context ${shortTokens(m.context.tokens)} / ${shortTokens(m.context.window)} (${m.context.percent}%)`);
  if (m.plan) lines.push([m.plan.fiveHour !== null && `5-hour ${m.plan.fiveHour}%`, m.plan.weekly !== null && `Weekly ${m.plan.weekly}%`].filter(Boolean).join(" · "));
  return lines.join("\n");
}

/** USAGE-025: the settings key for how usage reads; `left` or anything else (= used). The Appearance control is T-263. */
export const READS_FIELD = "usageReads";
export const readsLeft = (settings: Record<string, unknown>): boolean => settings[READS_FIELD] === "left" || percentMode(settings[PERCENT_FIELD]) === "remaining"; // MERGE 13: the T-263 Appearance pick (PERCENT_FIELD) counts too

/** USAGE-004 / VIEW-018: the Agents footer, "Claude 38% used · resets today 15:00"; the provider's
 *  5-hour window as used or left (a broken value reads 0, never NaN); empty for a provider with no
 *  5-hour window, a failed read, or a plain shell. */
export function usageLine(agent: string, claude: ClaudeLimit[], codex: CodexUsage | null, left: boolean, now: Date = new Date()): string {
  let five: { name: string; used: number; at: number | null } | null = null;
  if (agent === "claude") {
    const w = claude.find((l) => l.kind === "five_hour");
    if (w) five = { name: "Claude", used: w.usedPercent, at: w.resetsAt === null ? null : w.resetsAt / 1000 };
  }
  if (agent === "codex" && codex?.state === "ok" && codex.fiveHour) five = { name: "Codex", used: codex.fiveHour.usedPercent, at: codex.fiveHour.resetsAt };
  if (!five) return "";
  const used = pct(five.used) ?? 0;
  return `${five.name} ${left ? 100 - used : used}% ${left ? "left" : "used"} · ${resetWords(five.at, now)}`;
}
