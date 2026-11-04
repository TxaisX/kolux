// USAGE-012 / USAGE-013: usage analytics on Settings > Usage. A provider picker (Overview, Claude,
// Codex); only the panel picked is drawn and scanned. Saved figures show at once, a rescan follows
// for the tracked providers shown, and tracking is opt-in for each provider.
// USAGE-014: the Claude and Codex panels add a range (7 / 30 / 90 days or all time) and a scope
// (Kolux worktrees, or every local use), a chart by day, a breakdown by model and recent sessions.
// ponytail: Grok's credits panel is T-137-b; the activity counts above the analytics are T-136-c.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Segmented } from "../settings/GeneralPage";
import { locale } from "../language";
import { estimate } from "./pricing";
import ShareCard from "./ShareCard";
import { loadFailedText, scanFailedNote, scopeFailedNote, trackFailedNote } from "./analyticsNotes";
import { byModel, daily, filterRows, grid, NAMES, overview, panelState, recentSessions, rowsOf, shownProviders, type Filters, type Pick, type Provider, type Range, type Row, type Saved, type Scope, type Usage } from "./tokens";

const PICKS: Array<{ id: Pick; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
];
const LOGS: Record<Provider, string> = { claude: "Claude Code", codex: "Codex" };
const WEEKS = 26;
const RANGES: Array<{ id: Range; label: string }> = [
  { id: "7", label: "Last 7 days" },
  { id: "30", label: "Last 30 days" },
  { id: "90", label: "Last 90 days" },
  { id: "all", label: "All time" },
];
const SCOPES: Array<{ id: Scope; label: string }> = [
  { id: "kolux", label: "Kolux workspaces" },
  { id: "all", label: "Every local use" },
];
export const DEFAULT_FILTERS: Filters = { range: "30", scope: "kolux", roots: [] };

const count = (n: number) => new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);
const money = (usd: number, partial: boolean) => (partial && usd === 0 ? "n/a" : new Intl.NumberFormat(locale(), { style: "currency", currency: "USD" }).format(usd));
const share = (x: number) => new Intl.NumberFormat(locale(), { style: "percent", maximumFractionDigits: 1 }).format(x);
const dayText = (day: string) => new Date(day + "T12:00:00").toLocaleDateString(locale(), { dateStyle: "medium" });
/** usage-status.md:17: the figure a heatmap cell or a chart bar shows on hover, said to a screen reader too. */
export const figureLabel = (day: string, tokens: number) => `${dayText(day)}: ${count(tokens)} tokens`;

type ViewProps = {
  usage: Usage;
  pick: Pick;
  scanning: string[];
  today: Date;
  onPick: (p: Pick) => void;
  onTrack: (p: Provider, on: boolean) => void;
  onRefresh: () => void;
  filters: Filters;
  onFilters: (f: Partial<Filters>) => void;
  /** usage-status.md:4/10: what went wrong behind the panel (a rescan, the tracking switch, the project list); one line each. */
  notices?: string[];
};

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="ta-stat">
      <span className="ta-stat-label">{label}</span>
      <span className="ta-stat-value">{value}</span>
      {note && <span className="ta-stat-note">{note}</span>}
    </div>
  );
}

function Failed({ usage, providers }: { usage: Usage; providers: Provider[] }) {
  return (
    <>
      {providers.map((p) => {
        const s = usage[p];
        return s?.error && s.rows.length > 0 ? (
          <p key={p} className="conn-detail warn" role="status">
            Could not read {LOGS[p]}'s logs just now ({s.error}); these are the last figures.
          </p>
        ) : null;
      })}
    </>
  );
}

const WHY = "Kolux reads only the logs these agents already keep on this computer; nothing is sent anywhere.";

function OverviewPanel({ usage, today, onTrack }: { usage: Usage; today: Date; onTrack: ViewProps["onTrack"] }) {
  const state = panelState(usage, "overview");
  if (state === "off")
    return (
      <section className="conn-card" data-panel="overview">
        <h2 className="conn-name">Token tracking is off</h2>
        <p className="conn-detail">See how many tokens your agents used and what that would cost. {WHY}</p>
        <div className="btn-row">
          {(["claude", "codex"] as Provider[]).map((p) => (
            <button key={p} className="btn" onClick={() => onTrack(p, true)}>
              {`Enable ${NAMES[p]}`}
            </button>
          ))}
        </div>
      </section>
    );
  const shown = shownProviders(usage, "overview");
  if (state === "empty")
    return (
      <section className="conn-card" data-panel="overview">
        <h2 className="conn-name">No figures yet</h2>
        <p className="conn-detail">Tracking is on for {shown.map((p) => NAMES[p]).join(" and ")}. Figures arrive after the next agent session.</p>
      </section>
    );
  const o = overview(Object.fromEntries(shown.map((p) => [p, rowsOf(usage, p)])));
  const cols = grid(o.days, today, WEEKS, o.best?.day);
  const mixTotal = o.tokens || 1;
  const mix: Array<[keyof typeof o.mix, string]> = [
    ["fresh", "Fresh input"],
    ["cache", "Cache"],
    ["output", "Output"],
    ["reasoning", "Reasoning"],
  ];
  return (
    <section className="conn-card ta-card" data-panel="overview">
      <div className="ta-stats">
        <Stat label="Total tokens" value={count(o.tokens)} />
        <Stat label="Estimated cost" value={money(o.usd, o.partial)} note={o.partial ? "partial: some models have no known price" : undefined} />
        <Stat label="Active days" value={String(o.activeDays)} />
        <Stat label="From cache" value={share(o.cacheShare)} />
      </div>
      <div className="ta-grid-wrap">
        <div className="ta-grid" data-activity-grid role="group" aria-label={`Tokens per day for the last ${WEEKS} weeks`}>
          {cols.map((col, i) => (
            <div key={i} className="ta-col">
              {col.map((c) => (
                <span key={c.day} className={`ta-cell l${c.level}${c.best ? " best" : ""}${c.future ? " future" : ""}`} title={c.future ? undefined : figureLabel(c.day, c.tokens)} {...(c.future ? { "aria-hidden": true } : { role: "img", "aria-label": figureLabel(c.day, c.tokens) })} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {o.best && (
        <p className="conn-detail">
          Best day: {dayText(o.best.day)}, {count(o.best.tokens)} tokens
        </p>
      )}
      <div className="ta-mix" aria-label="Token mix">
        {mix.map(([k]) => (o.mix[k] > 0 ? <span key={k} className={`ta-mix-part ${k}`} style={{ flexGrow: o.mix[k] / mixTotal }} /> : null))}
      </div>
      <div className="ta-legend">
        {mix.map(([k, label]) => (
          <span key={k}>
            <i className={`ta-swatch ${k}`} />
            {label} {count(o.mix[k])}
          </span>
        ))}
      </div>
      <p className="conn-detail">
        {o.providers === 1 ? "1 provider" : `${o.providers} providers`} contributing
      </p>
      <Failed usage={usage} providers={shown} />
    </section>
  );
}

const timeText = (ms: number) => (ms ? new Date(ms).toLocaleTimeString(locale(), { timeStyle: "short" }) : "");

function Figures({ p, rows, filters, today }: { p: Provider; rows: Row[]; filters: Filters; today: Date }) {
  const sum = (k: "input" | "output" | "cacheRead" | "cacheWrite") => rows.reduce((t, r) => t + r[k], 0);
  const cost = estimate(p, rows);
  const bars = daily(rows, filters.range, today);
  const top = Math.max(1, ...bars.map((b) => b.tokens));
  return (
    <>
      <div className="ta-stats">
        <Stat label="Input" value={count(sum("input"))} />
        <Stat label="Output" value={count(sum("output"))} />
        <Stat label="Cache reads" value={count(sum("cacheRead"))} />
        <Stat label="Cache writes" value={count(sum("cacheWrite"))} />
        <Stat label="Estimated cost" value={money(cost.usd, cost.unpriced.length > 0)} note={cost.unpriced.length ? "partial: some models have no known price" : undefined} />
      </div>
      <div className="ta-chart" data-day-chart role="group" aria-label="Tokens by day">
        {bars.map((b) => (
          <span key={b.day} className={`ta-bar${b.tokens ? "" : " none"}`} style={{ height: `${(b.tokens / top) * 100}%` }} title={figureLabel(b.day, b.tokens)} role="img" aria-label={figureLabel(b.day, b.tokens)} />
        ))}
      </div>
      <h3 className="ta-sub">By model</h3>
      <ul className="ta-list">
        {byModel(p, rows).map((m) => (
          <li key={m.model}>
            <span className="ta-model">{m.model}</span>
            <span>{`${count(m.tokens)} tokens`}</span>
            <span>{m.sessions === 1 ? "1 session" : `${m.sessions} sessions`}</span>
            <span>{m.price === "none" ? "n/a" : m.price === "inferred" ? `${money(m.usd, false)} (inferred)` : money(m.usd, false)}</span>
          </li>
        ))}
      </ul>
      <h3 className="ta-sub">Recent sessions</h3>
      <ul className="ta-list sessions">
        {recentSessions(p, rows).map((s) => (
          <li key={s.session}>
            <span>{`${dayText(s.day)} ${timeText(s.last)}`}</span>
            <span className="ta-model">{s.models.join(", ")}</span>
            <span>{`${count(s.tokens)} tokens`}</span>
            <span>{s.partial && s.usd === 0 ? "n/a" : s.partial ? `${money(s.usd, false)} (partial)` : money(s.usd, false)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function ProviderPanel({ usage, p, today, filters, onTrack, onFilters }: { usage: Usage; p: Provider; today: Date; filters: Filters; onTrack: ViewProps["onTrack"]; onFilters: ViewProps["onFilters"] }) {
  const [sharing, setSharing] = useState(false);
  const on = usage.tracking[p];
  const state = panelState(usage, p);
  // usage-status.md:18: kept between renders, so the share card's picture is not redrawn by every unrelated render.
  const rows = useMemo(() => filterRows(rowsOf(usage, p), { ...filters, today }), [usage, p, filters, today]);
  return (
    <section className="conn-card ta-card" data-panel={p}>
      <header className="conn-head">
        <h2 className="conn-name">{NAMES[p]} tokens</h2>
        {state === "figures" && rows.length > 0 && (
          <button type="button" className="btn" onClick={() => setSharing(true)}>
            Share
          </button>
        )}
        <label className="conn-switch ta-switch">
          <input type="checkbox" role="switch" checked={on} onChange={(e) => onTrack(p, e.target.checked)} />
          {`Track ${NAMES[p]} tokens`}
        </label>
      </header>
      {sharing && <ShareCard provider={p} rows={rows} range={filters.range} today={today} onClose={() => setSharing(false)} />}
      {state === "off" && <p className="conn-detail">Turn this on to see {NAMES[p]}'s token use on this computer. {WHY}</p>}
      {state === "empty" && <p className="conn-detail">No {LOGS[p]} logs on this computer yet. Figures arrive after the next {NAMES[p]} session.</p>}
      {state === "figures" && (
        <>
          <div className="ta-filters">
            <Segmented label="Range" options={RANGES} value={filters.range} onPick={(range) => onFilters({ range })} />
            <Segmented label="Scope" options={SCOPES} value={filters.scope} onPick={(scope) => onFilters({ scope })} />
          </div>
          {rows.length > 0 ? (
            <Figures p={p} rows={rows} filters={filters} today={today} />
          ) : (
            <p className="conn-detail">
              {filters.scope === "kolux" ? `No use inside Kolux in this range. Pick Every local use to see ${NAMES[p]} sessions run outside Kolux.` : "No use in this range."}
            </p>
          )}
          <Failed usage={usage} providers={[p]} />
        </>
      )}
    </section>
  );
}

export function TokenAnalyticsView({ usage, pick, scanning, today, onPick, onTrack, onRefresh, filters, onFilters, notices }: ViewProps) {
  const shown = shownProviders(usage, pick);
  const busy = shown.some((p) => scanning.includes(p));
  return (
    <div className="ta">
      <div className="ta-head">
        <Segmented label="Usage analytics" options={PICKS} value={pick} onPick={onPick} />
        <button className="btn" disabled={busy || shown.length === 0} title={shown.length ? undefined : "Nothing to refresh: token tracking is off"} onClick={onRefresh}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {/* One live region that is always there, so a notice that appears in it is announced. */}
      <div className="ta-notices" role="status">
        {(notices ?? []).map((n) => (
          <p key={n} className="conn-detail warn" data-ta-notice>
            {n}
          </p>
        ))}
      </div>
      {pick === "overview" ? <OverviewPanel usage={usage} today={today} onTrack={onTrack} /> : <ProviderPanel usage={usage} p={pick} today={today} filters={filters} onTrack={onTrack} onFilters={onFilters} />}
    </div>
  );
}

/** usage-status.md:3: the saved figures could not be read: the error and a way to try again, not a blank panel. */
export function LoadFailed({ error, onRetry, busy = false }: { error: string; onRetry: () => void; busy?: boolean }) {
  return (
    <section className="conn-card" data-panel="load-failed">
      <p className="conn-detail warn" role="alert">
        {loadFailedText(error)}
      </p>
      <div className="btn-row">
        {/* aria-disabled, not disabled: a focused button that becomes disabled loses focus, and the keyboard user with it. */}
        <button type="button" className="btn" aria-disabled={busy} onClick={busy ? undefined : onRetry}>
          {busy ? "Retrying…" : "Retry"}
        </button>
      </div>
    </section>
  );
}

export default function TokenAnalytics() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  // One line per thing that failed behind the panel, keyed so the next try replaces or clears it.
  const [notes, setNotes] = useState<Record<string, string>>({});
  const note = useCallback((key: string, text: string | null) => {
    setNotes((n) => {
      const next = { ...n };
      if (text) next[key] = text;
      else delete next[key];
      return next;
    });
  }, []);
  const [pick, setPick] = useState<Pick>("overview");
  const [scanning, setScanning] = useState<Provider[]>([]);
  const scanned = useRef(new Set<Provider>());
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  const scan = useCallback((ps: Provider[]) => {
    for (const p of ps) {
      scanned.current.add(p);
      setScanning((s) => [...s, p]);
      note(`scan:${p}`, null);
      invoke<Saved>("token_usage_scan", { provider: p })
        .then((saved) => setUsage((u) => (u ? { ...u, [p]: saved } : u)))
        .catch((e) => note(`scan:${p}`, scanFailedNote(p, e)))
        .finally(() => setScanning((s) => s.filter((x) => x !== p)));
    }
  }, [note]);

  const load = useCallback(() => {
    // The error stays until the read works, so Retry does not blank the panel while it runs; Retry shows
    // "Retrying…" and ignores presses meanwhile, so a read that fails again the same way still shows it ran.
    setLoading(true);
    invoke<Usage>("token_usage")
      .then((u) => { setUsage(u); setLoadError(""); }, (e) => setLoadError(String(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    // Kolux scope: the registered projects, their own workspaces folders and the global one.
    // usage-status.md:10: when the list cannot be read the scope falls back to every local use and says so,
    // instead of reading "No use inside Kolux" for good.
    Promise.all([invoke<Array<{ path: string; workspacesDir?: string | null }>>("project_list"), invoke<{ dir: string }>("workspaces_place_get")])
      .then(([projects, place]) => setFilters((f) => ({ ...f, roots: [...projects.flatMap((p) => [p.path, p.workspacesDir ?? ""]), place.dir].filter(Boolean) })))
      .catch((e) => {
        setFilters((f) => ({ ...f, scope: "all" }));
        note("scope", scopeFailedNote(e));
      });
  }, [note]);
  // Saved figures are drawn first; each tracked provider the picked panel shows is rescanned once.
  useEffect(() => {
    if (usage) scan(shownProviders(usage, pick).filter((p) => !scanned.current.has(p)));
  }, [usage, pick, scan]);

  const track = (p: Provider, on: boolean) => {
    note("track", null);
    invoke("token_tracking_set", { provider: p, on })
      .then(() => {
        setUsage((u) => (u ? { ...u, tracking: { ...u.tracking, [p]: on } } : u));
        if (on) scanned.current.delete(p);
      })
      .catch((e) => note("track", trackFailedNote(p, on, e)));
  };

  // usage-status.md:18: one `today` per load of the figures, not a new Date on every render (it broke the card's memo).
  const today = useMemo(() => new Date(), [usage, pick]);
  if (!usage) return loadError ? <LoadFailed error={loadError} onRetry={load} busy={loading} /> : null;
  return <TokenAnalyticsView usage={usage} pick={pick} scanning={scanning} today={today} notices={Object.values(notes)} onPick={setPick} onTrack={track} onRefresh={() => scan(shownProviders(usage, pick).filter((p) => !scanning.includes(p)))} filters={filters} onFilters={(f) => setFilters((x) => ({ ...x, ...f }))} />;
}
