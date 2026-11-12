// SESS-022 / USAGE-010: the launch screen warns, without blocking, when a provider the chosen seats
// draw on has used 80 % or more of its usage window. Each provider's shortest window that has a
// figure is the one checked (5-hour, else weekly, else monthly). Providers with no figures yet and
// agents with no usage source give no line.
import { useEffect, useState } from "react";
import type { ClaudeLimit } from "./claude";
import { resetWords, type CodexUsage, type UsageWindow } from "./codex";

export const WARN_AT = 80;
export type ProviderUsage = { name: string; fiveHour?: UsageWindow | null; weekly?: UsageWindow | null; monthly?: UsageWindow | null };
/** Which provider's usage an agent draws on; agents not listed have no usage source. */
const PROVIDER: Record<string, string> = { claude: "claude", codex: "codex" };

/** One line per provider at or over the mark, in the order its first seat appears. */
export function launchWarnings(agentIds: Array<string | null>, usage: Record<string, ProviderUsage | undefined>, now: Date = new Date()): string[] {
  const seats = new Map<string, number>();
  for (const id of agentIds) {
    const p = id === null ? undefined : PROVIDER[id];
    if (p) seats.set(p, (seats.get(p) ?? 0) + 1);
  }
  const lines: string[] = [];
  for (const [p, n] of seats) {
    const u = usage[p];
    const [label, w] = (u && ([["5-hour", u.fiveHour], ["weekly", u.weekly], ["monthly", u.monthly]] as const).find(([, w]) => w)) || [];
    if (!u || !w || w.usedPercent < WARN_AT) continue;
    const who = n === 1 ? `This ${u.name} session` : `These ${n} ${u.name} sessions`;
    const reset = w.resetsAt == null ? "" : `, ${resetWords(w.resetsAt, now)}`;
    lines.push(`${u.name} has used ${Math.round(w.usedPercent)}% of its ${label} window${reset}. ${who} may stop early.`);
  }
  return lines;
}

/** The figures the top bar last read, shared so the launch screen does not read again. */
let figures: Record<string, ProviderUsage | undefined> = {};
const subs = new Set<() => void>();
function publish(provider: string, u: ProviderUsage | undefined) {
  figures = { ...figures, [provider]: u };
  subs.forEach((f) => f());
}
export const publishCodex = (u: CodexUsage | null) => publish("codex", u?.state === "ok" ? { name: "Codex", fiveHour: u.fiveHour, weekly: u.weekly } : undefined);
/** Claude's read limits as its 5-hour and weekly windows; none read gives no figures. */
export function claudeFigures(limits: ClaudeLimit[]): ProviderUsage | undefined {
  if (!limits.length) return undefined;
  const win = (kind: string) => {
    const l = limits.find((x) => x.kind === kind);
    // ClaudeLimit.resetsAt arrives in Unix ms (hooks.rs), while UsageWindow.resetsAt / resetWords() take Unix seconds.
    return l ? { usedPercent: l.usedPercent, resetsAt: l.resetsAt == null ? null : Math.round(l.resetsAt / 1000), windowMins: null } : null;
  };
  return { name: "Claude", fiveHour: win("five_hour"), weekly: win("seven_day") };
}
export const publishClaude = (limits: ClaudeLimit[]) => publish("claude", claudeFigures(limits));
// Dev builds only: the live check sets figures a real account cannot be pushed to on demand.
if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as Record<string, unknown>).__koluxUsage = publish;
/** Calls `f` with every new set of figures; returns the unsubscribe. `onFigures.current()` reads them now. */
export function onFigures(f: (all: Record<string, ProviderUsage | undefined>) => void): () => void {
  const g = () => f(figures);
  subs.add(g);
  return () => void subs.delete(g);
}
onFigures.current = () => figures;
export function useLaunchUsage(): Record<string, ProviderUsage | undefined> {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return figures;
}
