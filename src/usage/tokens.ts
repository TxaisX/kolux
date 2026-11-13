// USAGE-012 / USAGE-013: the token figures the Usage page draws, from the rows the backend scans out
// of Claude Code's and Codex's own logs (src-tauri/src/token_usage.rs). Cached input is its own
// count in every row, so adding providers never counts it twice; reasoning sits inside output.
import { costOf, estimate } from "./pricing";
import { underDir } from "../workspaces";

export type Provider = "claude" | "codex";
export const PROVIDERS: Provider[] = ["claude", "codex"];
export const NAMES: Record<Provider, string> = { claude: "Claude", codex: "Codex" };
export type Pick = "overview" | Provider;

export type Row = { day: string; session: string; model: string; cwd: string; band: number; input: number; output: number; cacheRead: number; cacheWrite: number; cacheWrite1h: number; reasoning: number; last: number };
export type Saved = { scannedAt: number; rows: Row[]; error: string | null };
export type Usage = { tracking: Record<Provider, boolean>; claude: Saved | null; codex: Saved | null };

export const tokensOf = (r: Row) => r.input + r.cacheRead + r.cacheWrite + r.output;

export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type Overview = {
  tokens: number;
  usd: number;
  partial: boolean;
  activeDays: number;
  /** The share of all input read back from the cache (writes are input sent fresh). */
  cacheShare: number;
  mix: { fresh: number; cache: number; output: number; reasoning: number };
  providers: number;
  days: Record<string, number>;
  best: { day: string; tokens: number } | null;
};

export function overview(sets: Partial<Record<Provider, Row[]>>): Overview {
  const mix = { fresh: 0, cache: 0, output: 0, reasoning: 0 };
  const days: Record<string, number> = {};
  let usd = 0;
  let partial = false;
  let providers = 0;
  let reads = 0;
  for (const p of PROVIDERS) {
    const rows = sets[p] ?? [];
    if (rows.some((r) => tokensOf(r) > 0)) providers++;
    const cost = estimate(p, rows);
    usd += cost.usd;
    partial ||= cost.unpriced.length > 0;
    for (const r of rows) {
      mix.fresh += r.input;
      mix.cache += r.cacheRead + r.cacheWrite;
      reads += r.cacheRead;
      mix.output += r.output - r.reasoning;
      mix.reasoning += r.reasoning;
      days[r.day] = (days[r.day] ?? 0) + tokensOf(r);
    }
  }
  const tokens = mix.fresh + mix.cache + mix.output + mix.reasoning;
  const active = Object.entries(days).filter(([, t]) => t > 0);
  const best = active.reduce<Overview["best"]>((b, [day, t]) => (b && b.tokens >= t ? b : { day, tokens: t }), null);
  return { tokens, usd, partial, activeDays: active.length, cacheShare: mix.fresh + mix.cache ? reads / (mix.fresh + mix.cache) : 0, mix, providers, days, best };
}

export type Cell = { day: string; tokens: number; level: 0 | 1 | 2 | 3 | 4; best: boolean; future: boolean };

/** `weeks` columns of seven local days (Sunday first), the last holding today. */
export function grid(days: Record<string, number>, today: Date, weeks: number, best?: string): Cell[][] {
  const top = Math.max(0, ...Object.values(days));
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() - (weeks - 1) * 7);
  const now = localDay(today);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const day = localDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d));
      const tokens = days[day] ?? 0;
      const level = (tokens > 0 && top > 0 ? Math.max(1, Math.ceil((tokens / top) * 4)) : 0) as Cell["level"];
      return { day, tokens, level, best: day === best, future: day > now };
    }),
  );
}

const rowsOf = (u: Usage, p: Provider) => u[p]?.rows ?? [];

/** The providers a panel reads (and rescans): the tracked ones it shows. */
export function shownProviders(u: Usage, pick: Pick): Provider[] {
  return (pick === "overview" ? PROVIDERS : [pick]).filter((p) => u.tracking[p]);
}

export function panelState(u: Usage, pick: Pick): "off" | "empty" | "figures" {
  const shown = shownProviders(u, pick);
  if (!shown.length) return "off";
  return shown.some((p) => rowsOf(u, p).length > 0) ? "figures" : "empty";
}

export { rowsOf };

// USAGE-014: the Claude and Codex panels' range and scope.
export type Range = "7" | "30" | "90" | "all";
export type Scope = "kolux" | "all";
/** `roots` are the folders that count as Kolux: registered projects and the workspaces folders. */
export type Filters = { range: Range; scope: Scope; roots: string[] };

const shift = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

/** The first local day a range keeps, or "" for all time. */
export const rangeStart = (range: Range, today: Date) => (range === "all" ? "" : localDay(shift(today, 1 - Number(range))));

export function filterRows(rows: Row[], f: Filters & { today: Date }): Row[] {
  const from = rangeStart(f.range, f.today);
  return rows.filter((r) => r.day >= from && (f.scope === "all" || f.roots.some((root) => underDir(r.cwd || null, root))));
}

export type Bar = { day: string; tokens: number };

/** One bar per local day of the range; longer spans than a year are drawn as weekly bars (from their Sunday). */
export function daily(rows: Row[], range: Range, today: Date): Bar[] {
  const first = range === "all" ? rows.reduce((m, r) => (r.day < m ? r.day : m), localDay(today)) : rangeStart(range, today);
  const [y, m, d] = first.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const span = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const weekly = span > 366;
  const key = (day: string) => {
    if (!weekly) return day;
    const [a, b, c] = day.split("-").map(Number);
    const t = new Date(a, b - 1, c);
    return localDay(shift(t, -t.getDay()));
  };
  const bars = new Map<string, number>();
  for (let i = 0; i < span; i++) bars.set(key(localDay(shift(start, i))), 0);
  for (const r of rows) {
    const k = key(r.day);
    if (bars.has(k)) bars.set(k, bars.get(k)! + tokensOf(r));
  }
  return [...bars].map(([day, tokens]) => ({ day, tokens }));
}

export type ModelLine = { model: string; tokens: number; sessions: number; usd: number; price: "known" | "inferred" | "none" };

/** Tokens and cost by model; a session is counted once under each model it really used. */
export function byModel(p: Provider, rows: Row[]): ModelLine[] {
  const out = new Map<string, ModelLine & { ids: Set<string> }>();
  for (const r of rows) {
    const c = costOf(p, r);
    const m = out.get(r.model) ?? { model: r.model, tokens: 0, sessions: 0, usd: 0, price: c.priced ? (c.inferred ? "inferred" : "known") : "none", ids: new Set<string>() };
    m.tokens += tokensOf(r);
    m.usd += c.usd;
    m.ids.add(r.session);
    m.sessions = m.ids.size;
    out.set(r.model, m);
  }
  return [...out.values()].map(({ ids: _ids, ...m }) => m).sort((a, b) => b.tokens - a.tokens);
}

export type SessionLine = { session: string; last: number; day: string; tokens: number; usd: number; models: string[]; partial: boolean };

/** The most recent sessions first. */
export function recentSessions(p: Provider, rows: Row[], limit = 10): SessionLine[] {
  const out = new Map<string, SessionLine>();
  for (const r of rows) {
    const c = costOf(p, r);
    const s = out.get(r.session) ?? { session: r.session, last: 0, day: r.day, tokens: 0, usd: 0, models: [], partial: false };
    s.tokens += tokensOf(r);
    s.usd += c.usd;
    s.partial ||= !c.priced;
    if (!s.models.includes(r.model)) s.models.push(r.model);
    s.last = Math.max(s.last, r.last);
    if (r.day > s.day) s.day = r.day;
    out.set(r.session, s);
  }
  return [...out.values()].sort((a, b) => b.day.localeCompare(a.day) || b.last - a.last).slice(0, limit);
}

/** Whether any provider has token tracking enabled. */
export const anyTracked = (usage: Usage): boolean => PROVIDERS.some((p) => usage.tracking[p]);

/** Tracked providers whose saved scan is missing or older than `maxAge` (skips providers whose last scan failed). */
export const dueForScan = (usage: Usage, now: number, maxAge: number): Provider[] =>
  PROVIDERS.filter((p) => usage.tracking[p] && !usage[p]?.error && now - (usage[p]?.scannedAt ?? 0) > maxAge);

/** The last folder segment of a path (either slash style), or "" when empty. */
export function folderName(path: string | null | undefined): string {
  const parts = (path ?? "").split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}
