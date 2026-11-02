// T-645 (lane C, wave UI): the figures the Insights panel shows, all pure so they test without the app.
// Right.tsx (the wiring builder) calls liveSessions(); the panel calls totals(), sessionsOf() and usageFor().
// Nothing here reads a log: the usage figures come from the saved scan (`token_usage`) the Usage page keeps.
import type { AgentState } from "../projects/rows";
import type { TurnInfo } from "../status/useAgentStatus";
import { askLine, chipOf } from "../board/chip";
import { estimate } from "../usage/pricing";
import { localDay, PROVIDERS, rangeStart, recentSessions, tokensOf, type Provider, type Row, type Usage } from "../usage/tokens";

/** One open agent pane, as the panel's "Now" list shows it. */
export type LiveSession = {
  key: number; // the pane's key, so a click can focus it
  agent: string; // agent id, e.g. "claude", "codex"
  workspace: string; // the folder name of the pane's cwd ("" when none)
  dir: string | null; // the pane's cwd
  session: string | null; // the agent's own session id when Kolux knows it (Pane.session)
  state: AgentState | undefined;
  running: boolean | undefined; // undefined: no process yet; false: the program ended (as the Tower reads it)
  stale: boolean; // the terminal has been quiet past the window
  turn: TurnInfo | undefined;
  action: string; // last action in plain words ("" when none)
  at: number | null; // ms epoch of the last status change, null when unknown
};

export type PaneLike = { key: number; cwd: string | null; agent: string; kind?: string; seats?: unknown; session?: string };

/** The same chip the Board and Tower show for this pane (VIEW-023). */
export const chipOfLive = (s: LiveSession, now: number) =>
  chipOf({ agent: s.agent, state: s.state, running: s.running, stale: s.stale, ...s.turn, since: s.at ?? 0 }, now);

/** The last folder of a path, either slash; "" for none. */
export function folderOf(path: string | null | undefined): string {
  const parts = (path ?? "").split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

const MAX_ACTION = 80;
const clip = (s: string) => (s.length > MAX_ACTION ? `${s.slice(0, MAX_ACTION - 1)}…` : s);

/** What the agent is doing, in a few plain words: its tool and detail, else the question it asks, else nothing. */
export function actionOf(t: TurnInfo | undefined): string {
  if (!t) return "";
  const step = [t.tool, t.detail].map((s) => (s ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).join(": ");
  return clip(step || askLine(t.ask));
}

const rank = (s: LiveSession) => {
  const lane = chipOfLive(s, 0)?.lane;
  return lane === "needs" ? 0 : lane === "working" ? 1 : 2;
};

/** The open agent panes across every workspace (shells, seat choosers and browser/editor tabs left out, as in the Tower). */
export function liveSessions<P extends PaneLike>(
  panes: P[],
  agentOf: (p: P) => string,
  statusOf: (p: P) => AgentState | undefined,
  turn: Record<number, TurnInfo>,
  stamp: Record<number, { at: number }>,
  running: Record<number, boolean | undefined> = {},
  stale: Record<number, boolean> = {},
): LiveSession[] {
  const out: LiveSession[] = [];
  for (const p of panes) {
    if (p.kind || p.seats) continue;
    const agent = agentOf(p);
    if (agent === "shell") continue;
    out.push({
      key: p.key,
      agent,
      workspace: folderOf(p.cwd),
      dir: p.cwd,
      session: p.session ?? null,
      state: statusOf(p),
      running: running[p.key],
      stale: stale[p.key] ?? false,
      turn: turn[p.key],
      action: actionOf(turn[p.key]),
      at: stamp[p.key]?.at ?? null,
    });
  }
  // Needs you first, then working, then the rest (by the Tower's own lane); each group newest change first, unknown times last.
  return out.sort((a, b) => rank(a) - rank(b) || (b.at ?? -1) - (a.at ?? -1) || a.key - b.key);
}

export type Figure = { tokens: number; usd: number; /** some model had no published price, so usd is a floor */ partial: boolean };
export type Totals = { today: Figure; week: Figure; all: Figure };

/** The providers whose scan is shown: tracking on and a scan saved. */
export function trackedRows(usage: Usage): Partial<Record<Provider, Row[]>> {
  const sets: Partial<Record<Provider, Row[]>> = {};
  for (const p of PROVIDERS) {
    const saved = usage[p];
    if (usage.tracking[p] && saved) sets[p] = saved.rows;
  }
  return sets;
}

/** Whether any provider is tracked at all (the panel says tracking is off when none is). */
export const anyTracked = (usage: Usage): boolean => PROVIDERS.some((p) => usage.tracking[p]);

function figure(sets: Partial<Record<Provider, Row[]>>, keep: (r: Row) => boolean): Figure {
  let tokens = 0;
  let usd = 0;
  let partial = false;
  for (const p of PROVIDERS) {
    const rows = (sets[p] ?? []).filter(keep);
    const cost = estimate(p, rows);
    tokens += rows.reduce((n, r) => n + tokensOf(r), 0);
    usd += cost.usd;
    partial ||= cost.unpriced.length > 0;
  }
  return { tokens, usd, partial };
}

/** Today, the last 7 local days (today included) and all time, summed over every tracked provider and workspace. */
export function totals(usage: Usage, today: Date): Totals {
  const sets = trackedRows(usage);
  const day = localDay(today);
  const from = rangeStart("7", today);
  return {
    today: figure(sets, (r) => r.day === day),
    week: figure(sets, (r) => r.day >= from),
    all: figure(sets, () => true),
  };
}

export type SessionRow = { session: string; provider: Provider; workspace: string; cwd: string; day: string; last: number; tokens: number; usd: number; partial: boolean };

/** The most recent sessions across every tracked provider, newest first. */
export function sessionsOf(usage: Usage, limit = 8): SessionRow[] {
  const all: SessionRow[] = [];
  const sets = trackedRows(usage);
  for (const p of PROVIDERS) {
    const rows = sets[p];
    if (!rows?.length) continue;
    const cwdOf = new Map<string, string>();
    for (const r of rows) if (r.cwd && !cwdOf.has(r.session)) cwdOf.set(r.session, r.cwd);
    for (const s of recentSessions(p, rows, Infinity)) {
      const cwd = cwdOf.get(s.session) ?? "";
      all.push({ session: s.session, provider: p, workspace: folderOf(cwd), cwd, day: s.day, last: s.last, tokens: s.tokens, usd: s.usd, partial: s.partial });
    }
  }
  return all.sort((a, b) => b.day.localeCompare(a.day) || b.last - a.last).slice(0, limit);
}

/** What a live pane has used so far: the usage lines of its session id, or null when Kolux does not know it. */
export function usageFor(live: Pick<LiveSession, "session">, lines: SessionRow[]): SessionRow | null {
  if (!live.session) return null;
  return lines.find((l) => l.session === live.session) ?? null;
}

/** How a cost reads: "none" when tokens exist but no model has a price (shown as a dash, never $0.00),
 *  "partial" when some models have none (a floor: "at least"), else "exact" (still only an estimate). */
export function costKind(usd: number, partial: boolean, tokens: number): "none" | "partial" | "exact" {
  if (tokens <= 0) return "exact";
  if (partial && usd <= 0) return "none";
  return partial ? "partial" : "exact";
}

/** When the oldest tracked provider was last counted (ms epoch), null when none has a saved count. */
export function countedAt(usage: Usage): number | null {
  const at = PROVIDERS.filter((p) => usage.tracking[p]).map((p) => usage[p]?.scannedAt ?? null).filter((x): x is number => x !== null);
  return at.length ? Math.min(...at) : null;
}

/** Tracked providers whose saved count is missing or older than maxAge: the panel asks for a (cached, incremental) rescan. */
export const dueForCount = (usage: Usage, now: number, maxAge: number): Provider[] =>
  PROVIDERS.filter((p) => usage.tracking[p] && now - (usage[p]?.scannedAt ?? 0) > maxAge);
