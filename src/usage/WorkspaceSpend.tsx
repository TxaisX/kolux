// Owner change 2026-11-06: the token and spend ribbon at the right end of the layout strip, above
// the terminals. It totals the current workspace across every terminal and session that worked in
// it, and draws a small gauge of the last 14 days so the running spend has a shape, not just a
// number. The figures come from the saved scan (`token_usage`); a count older than ten minutes is
// refreshed incrementally first, so the ribbon keeps up with long sessions without reading a log on
// every render. Clicking the off state opens Settings > Usage.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { locale } from "../language";
import { openSettings } from "../settings/pages";
import { NAMES, type Usage } from "./tokens";
import { dueForScan, workspaceName, workspaceSpend, type SpendDay, type SpendFigure, type WorkspaceSpend as SpendFigures } from "./workspaceRibbon";

const REFRESH_MS = 60_000;
const SCAN_MS = 10 * 60_000;
const compact = (n: number) => new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);
const money = (usd: number) => new Intl.NumberFormat(locale(), { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(usd);

/** "≈ $4.20", "≥ $4.20" when a model has no price, "n/a" when none of them has one. */
export function costText(f: SpendFigure): string {
  if (f.tokens > 0 && f.partial && f.usd <= 0) return "n/a";
  return `${f.partial ? "≥ " : "≈ "}${money(f.usd)}`;
}

const costWords = (f: SpendFigure): string => {
  if (f.tokens > 0 && f.partial && f.usd <= 0) return "no known price";
  return `${f.partial ? "at least " : ""}${money(f.usd)}`;
};

/** The words a hover or screen reader gets: "≈ $4.20 estimated", or "no known price". */
const costLine = (f: SpendFigure): string => (f.tokens > 0 && f.partial && f.usd <= 0 ? "no known price" : `${costWords(f)} estimated`);

/** "just now", "3m ago", "2h ago"; nothing when the time is unknown. */
function ago(at: number | null, now: number): string {
  if (at === null) return "";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

const dayWords = (day: string): string => new Date(`${day}T12:00:00`).toLocaleDateString(locale(), { month: "short", day: "numeric" });

/** The gauge's bars: 14 local days, scaled by estimated spend (or tokens when no model has a price). */
export function SpendGauge({ days }: { days: SpendDay[] }) {
  const topUsd = Math.max(0, ...days.map((d) => (Number.isFinite(d.usd) ? d.usd : 0)));
  const topTokens = Math.max(0, ...days.map((d) => d.tokens));
  const top = topUsd > 0 ? topUsd : topTokens;
  const last = days[days.length - 1]?.day;
  return (
    <span className="strip-spend-gauge" aria-hidden="true">
      {days.map((d) => {
        const weight = topUsd > 0 ? d.usd : d.tokens;
        const height = top > 0 ? Math.max(8, Math.round((weight / top) * 100)) : 8;
        return (
          <span
            key={d.day}
            className={`spend-bar${weight > 0 ? " has" : ""}${d.day === last ? " today" : ""}`}
            style={{ height: `${height}%` }}
            title={`${dayWords(d.day)}: ${compact(d.tokens)} tokens · ${costText(d)}`}
            data-day={d.day}
          />
        );
      })}
    </span>
  );
}

/** usage-status.md:6: tracking is off; the way to turn it on is a button, not a sentence. */
export function TrackingOff({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="strip-spend-off" onClick={onOpen} title="Token tracking is off. Turn it on in Settings > Usage to see this workspace's spend.">
      Token tracking off
    </button>
  );
}

/** The ribbon for one workspace's figures; pure, so the strip's look tests without the app. */
export function WorkspaceSpendView({ spend, now = Date.now(), onOpenUsage = () => openSettings("usage") }: { spend: SpendFigures; now?: number; onOpenUsage?: () => void }) {
  if (!spend.tracked) return <TrackingOff onOpen={onOpenUsage} />;
  const name = workspaceName(spend.dir);
  const empty = spend.all.tokens === 0;
  const providerWords = spend.providers.map((p) => `${NAMES[p.provider]} ${compact(p.tokens)} tok · ${costLine(p)}`).join("\n");
  const title = [
    spend.dir,
    `${spend.all.tokens.toLocaleString(locale())} tokens across ${spend.sessions} session${spend.sessions === 1 ? "" : "s"}, ${costLine(spend.all)}`,
    `Today: ${spend.today.tokens.toLocaleString(locale())} tokens · ${costLine(spend.today)}`,
    `Last 7 days: ${spend.week.tokens.toLocaleString(locale())} tokens · ${costLine(spend.week)}`,
    providerWords,
    spend.all.partial ? "Some models have no published price, so the cost is a floor. Estimated at list price; not a bill." : "Estimated at list price from the logs on this computer; not a bill.",
    spend.scannedAt === null ? "" : `Counted ${ago(spend.scannedAt, now)}.`,
    spend.error ? `Could not read the token logs: ${spend.error}` : "",
    empty && !spend.error ? "No token use recorded for this workspace yet." : "",
  ].filter(Boolean).join("\n");
  const aria = `${spend.all.tokens.toLocaleString(locale())} tokens in ${name || spend.dir} across ${spend.sessions} session${spend.sessions === 1 ? "" : "s"}, ${costLine(spend.all)}${spend.all.partial && spend.all.usd <= 0 ? ", a floor" : ""}${spend.error ? "; the token logs could not be read, so the figure may be incomplete" : ""}`;
  return (
    <span className={`strip-spend${empty ? " empty" : ""}`} role="group" aria-label={aria} title={title}>
      <span className="strip-spend-label">Workspace</span>
      <span className="strip-spend-total">
        <b>{compact(spend.all.tokens)}</b> tok
      </span>
      <span className="strip-spend-cost" title="Estimated at list price from the logs on this computer; not a bill.">
        {costText(spend.all)}
      </span>
      <span className="strip-spend-today">
        today {compact(spend.today.tokens)} · {costText(spend.today)}
      </span>
      <SpendGauge days={spend.days} />
    </span>
  );
}

/** Reads the saved scan, refreshes a stale one, and redraws once a minute and whenever the workspace changes. */
export default function WorkspaceSpend({ workspace }: { workspace: string | null }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);
  // Only the newest read may write: a workspace switch or a slow scan can leave an older one in flight.
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!workspace) return;
    const id = ++seq.current;
    const read = () => invoke<Usage>("token_usage");
    read()
      .then(async (u) => {
        const due = dueForScan(u, Date.now(), SCAN_MS);
        if (!due.length) return u;
        await Promise.allSettled(due.map((provider) => invoke("token_usage_scan", { provider })));
        return read();
      })
      .then(
        (u) => {
          if (id !== seq.current) return;
          setUsage(u);
          setFailed(false);
        },
        () => id === seq.current && setFailed(true), // keep the last figures; the next minute tries again
      );
  }, [workspace]);
  useEffect(() => {
    if (!workspace) return;
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      seq.current += 1; // a read still in flight is no longer the newest
      clearInterval(timer);
    };
  }, [load, workspace]);
  const spend = useMemo(() => (usage && workspace ? workspaceSpend(usage, workspace, new Date()) : null), [usage, workspace]);
  if (spend) return <WorkspaceSpendView spend={spend} />;
  return failed && workspace ? (
    <span className="strip-spend-failed" title="Could not read the saved token figures. The strip tries again every minute.">
      usage unavailable
    </span>
  ) : null;
}
