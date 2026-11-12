// Owner change 2026-11-06: what the strip above the terminals shows: the tokens and estimated
// spend of the workspace in front, across every terminal and session that worked in it. The rows
// are the saved scan (token_usage) the Usage page keeps; nothing here reads a log. A folder counts
// when it is the workspace or inside it, so a session in a subfolder counts toward its workspace
// and a session in another folder does not.
import { estimate } from "./pricing";
import { anyTracked, dueForScan, folderName, localDay, PROVIDERS, rangeStart, tokensOf, type Provider, type Row, type Usage } from "./tokens";
import { underDir } from "../workspaces";

/** Tokens and their estimated cost; `partial` is a floor because some model has no published price. */
export type SpendFigure = { tokens: number; usd: number; partial: boolean };
export type SpendProvider = SpendFigure & { provider: Provider };
export type SpendDay = SpendFigure & { day: string };

export type WorkspaceSpend = {
  /** A workspace to scope to. */
  dir: string;
  /** Whether any provider is tracked at all; when false the ribbon offers the way to turn it on. */
  tracked: boolean;
  /** How many worktree folders besides the workspace's own were counted. */
  worktrees: number;
  /** Distinct agent sessions that worked in the folder (a provider prefix keeps two providers apart). */
  sessions: number;
  /** The oldest saved count (ms epoch) the figures come from, null when a tracked provider has no count yet. */
  scannedAt: number | null;
  /** Why the latest read of one tracked provider failed, when it did; the last good rows may still show. */
  error: string | null;
  all: SpendFigure;
  today: SpendFigure;
  /** The last seven local days, today included. */
  week: SpendFigure;
  /** One line per tracked provider that has tokens, largest first. */
  providers: SpendProvider[];
  /** The last `span` local days, oldest first, so the strip can draw a daily gauge. */
  days: SpendDay[];
};

const zero = (): SpendFigure => ({ tokens: 0, usd: 0, partial: false });

const add = (into: SpendFigure, f: SpendFigure): void => {
  into.tokens += f.tokens;
  into.usd += f.usd;
  into.partial ||= f.partial;
};

const figureOf = (provider: Provider, rows: Row[]): SpendFigure => {
  const cost = estimate(provider, rows);
  return {
    tokens: rows.reduce((n, r) => n + tokensOf(r), 0),
    usd: cost.usd,
    partial: cost.unpriced.length > 0,
  };
};

const dayKeys = (today: Date, span: number): string[] =>
  Array.from({ length: span }, (_, i) => localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (span - 1 - i))));

/** The last folder of a path, whichever slash style it uses; "" for none. */
export const workspaceName = folderName;

/** Owner change 2026-11-07: Kolux keeps a repo's worktrees under `…/workspaces/<repo>/<name>`, so a
 *  session in a worktree that was since removed (git no longer lists it) still counts toward its repo. */
export function inKoluxWorktree(cwd: string, dir: string): boolean {
  const repo = workspaceName(dir).toLowerCase();
  if (!repo) return false;
  const parts = cwd.toLowerCase().split(/[\\/]+/).filter(Boolean);
  return parts.some((p, i) => p === "workspaces" && parts[i + 1] === repo && i + 2 < parts.length);
}

/** Whether a session folder belongs to the workspace: the folder itself, one of its worktrees, or a Kolux worktree of the repo. */
export function inWorkspace(cwd: string, dir: string, worktrees: string[] = []): boolean {
  if (cwd === "") return false;
  return underDir(cwd, dir) || worktrees.some((w) => underDir(cwd, w)) || inKoluxWorktree(cwd, dir);
}

/** The tracked providers whose rows worked in the workspace (see `inWorkspace`). */
function rowsIn(usage: Usage, dir: string, worktrees: string[]): Array<{ provider: Provider; rows: Row[] }> {
  const out: Array<{ provider: Provider; rows: Row[] }> = [];
  for (const provider of PROVIDERS) {
    const saved = usage[provider];
    if (!usage.tracking[provider] || !saved) continue;
    out.push({ provider, rows: saved.rows.filter((r) => inWorkspace(r.cwd, dir, worktrees)) });
  }
  return out;
}

/** The workspace's figures, split into all time, today and the last seven days, with a daily gauge series. */
export function workspaceSpend(usage: Usage, dir: string, today: Date, span = 14, worktrees: string[] = []): WorkspaceSpend {
  const tracked = anyTracked(usage);
  const day = localDay(today);
  const from = rangeStart("7", today);
  const keys = dayKeys(today, span);
  const keySet = new Set(keys);
  const all = zero();
  const todayFigure = zero();
  const week = zero();
  const providers: SpendProvider[] = [];
  const sessions = new Set<string>();
  const days = new Map<string, Partial<Record<Provider, Row[]>>>();
  for (const k of keys) days.set(k, {});

  for (const { provider, rows } of rowsIn(usage, dir, worktrees)) {
    const f = figureOf(provider, rows);
    add(all, f);
    if (f.tokens > 0) providers.push({ provider, ...f });
    add(todayFigure, figureOf(provider, rows.filter((r) => r.day === day)));
    add(week, figureOf(provider, rows.filter((r) => r.day >= from)));
    for (const r of rows) {
      if (r.session) sessions.add(`${provider}:${r.session}`);
      if (!keySet.has(r.day)) continue;
      const byProvider = days.get(r.day)!;
      (byProvider[provider] ??= []).push(r);
    }
  }

  const stamps = PROVIDERS.filter((p) => usage.tracking[p]).map((p) => usage[p]?.scannedAt ?? 0);
  // A tracked provider with no count yet makes the total incomplete: no "Counted …" claim then.
  const scannedAt = stamps.length && stamps.every((at) => at > 0) ? Math.min(...stamps) : null;
  const error = PROVIDERS.filter((p) => usage.tracking[p])
    .map((p) => usage[p]?.error)
    .find((e): e is string => typeof e === "string" && e.length > 0) ?? null;

  return {
    dir,
    tracked,
    worktrees: worktrees.filter((w) => !underDir(w, dir) && !underDir(dir, w)).length,
    sessions: sessions.size,
    scannedAt,
    error,
    all,
    today: todayFigure,
    week,
    providers: providers.sort((a, b) => b.tokens - a.tokens),
    days: keys.map((k) => {
      const byProvider = days.get(k) ?? {};
      const f = zero();
      for (const provider of PROVIDERS) add(f, figureOf(provider, byProvider[provider] ?? []));
      return { day: k, ...f };
    }),
  };
}

/** Tracked providers whose saved count is missing or older than `maxAge`: the strip asks for an
 *  incremental rescan. A failed scan is left out, so a missing logs folder is not retried every minute. */
export { dueForScan };
