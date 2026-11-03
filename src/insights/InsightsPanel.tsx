// T-646 (lane C, wave UI): the app-wide Insights panel in the right sidebar. Loaded lazily through
// src/lazy/pages.tsx. It reads the saved scan (`token_usage`), never a log; tracking is opt-in per provider.
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { locale } from "../language";
import { span, type Lane } from "../board/chip";
import { agents as AGENTS } from "../keys/actions";
import { NAMES, type Usage } from "../usage/tokens";
import { openSettings } from "../settings/pages";
import { anyTracked, chipOfLive, costKind, countedAt, dueForCount, sessionsOf, totals, usageFor, type Figure, type LiveSession } from "./model";
import "./insights.css";
import AutoPrStatus from "../scm/AutoPrStatus"; // T-655, plain import: this panel is already a lazy chunk

export type InsightsProps = {
  sessions: LiveSession[];
  /** Focus that pane (switch to its workspace and tab). */
  onJump?: (key: number) => void;
};

const REFRESH_MS = 60_000;
const TICK_MS = 30_000;
// A count older than this is redone (incremental: the scan keeps what it read) when the panel reads usage.
const COUNT_MS = 10 * 60_000;
const SESSION_ROWS = 8;
const compact = (n: number) => new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 }).format(n);
const money = (usd: number) => new Intl.NumberFormat(locale(), { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(usd);
const PRICE_NOTE = "Estimated from Kolux's local price table at list price. It is not a bill.";

/** "≈ $1.23 est.", "at least ≈ $1.23 est." when some model has no price, "—" when none has. */
function costText(usd: number, partial: boolean, tokens: number): string {
  const kind = costKind(usd, partial, tokens);
  if (kind === "none") return "—";
  return `${kind === "partial" ? "at least " : ""}≈ ${money(usd)} est.`;
}
const costTitle = (usd: number, partial: boolean, tokens: number) =>
  costKind(usd, partial, tokens) === "none"
    ? "No published price for these models, so no cost is estimated."
    : `${PRICE_NOTE}${costKind(usd, partial, tokens) === "partial" ? " Some models have no price, so this is a floor." : ""}`;

const agentName = (id: string) => AGENTS.find(([a]) => a === id)?.[1] ?? id;
const ago = (at: number | null, now: number) => (at === null ? "" : at > now - 5_000 ? "just now" : `${span(now - at)} ago`);

function Tile({ label, f }: { label: string; f: Figure }) {
  return (
    <div className="ins-tile" role="group" aria-label={label} title={costTitle(f.usd, f.partial, f.tokens)}>
      <span className="ins-tile-label">{label}</span>
      <b className="ins-tile-num">{compact(f.tokens)}</b>
      <span className="ins-tile-unit">tokens</span>
      <span className="ins-tile-cost">{costText(f.usd, f.partial, f.tokens)}</span>
    </div>
  );
}

/** usage-status.md:6: tracking is off; the way to turn it on is a button that opens Settings > Usage, not a sentence. */
export function TrackingOff({ onOpen }: { onOpen: () => void }) {
  return (
    <p className="ins-note">
      Token tracking is off.{" "}
      <button type="button" className="ins-link" onClick={onOpen}>
        Turn it on in Settings → Usage
      </button>
    </p>
  );
}

/** usage-status.md:20: the list stops at `shown` rows; when there are more, this opens Settings > Usage, the full usage view (with its own range and scope filters). */
export function MoreSessions({ total, shown, onOpen }: { total: number; shown: number; onOpen: () => void }) {
  if (total <= shown) return null;
  return (
    <p className="ins-note">
      <button type="button" className="ins-link" onClick={onOpen}>
        All usage in Settings → Usage
      </button>
    </p>
  );
}

export default function InsightsPanel({ sessions, onJump }: InsightsProps) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Reads the saved count; a tracked provider counted over COUNT_MS ago is counted again first. A failure keeps the last numbers.
  // ponytail: a scan that keeps failing is retried on every refresh; the scan joins a running one and reads only new lines.
  const load = useCallback(() => {
    const read = () => invoke<Usage>("token_usage");
    read()
      .then(async (u) => {
        const due = dueForCount(u, Date.now(), COUNT_MS);
        if (!due.length) return u;
        await Promise.allSettled(due.map((provider) => invoke("token_usage_scan", { provider })));
        return read();
      })
      .then(
        (u) => {
          setUsage(u);
          setLoadedAt(Date.now());
          setFailed(false);
        },
        () => setFailed(true),
      );
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const tracked = usage ? anyTracked(usage) : false;
  const sum = useMemo(() => (usage && tracked ? totals(usage, new Date(now)) : null), [usage, tracked, now]);
  const all = useMemo(() => (usage && tracked ? sessionsOf(usage, Infinity) : []), [usage, tracked]);
  const recent = all.slice(0, SESSION_ROWS);
  const counted = usage && tracked ? countedAt(usage) : null;

  return (
    <div className="insights">
      <section className="ins-sec" aria-labelledby="ins-totals">
        <h3 id="ins-totals">Usage</h3>
        {usage === null ? (
          <p className="ins-note">{failed ? "Usage could not be loaded." : "Loading usage…"}</p>
        ) : !tracked ? (
          <TrackingOff onOpen={() => openSettings("usage")} />
        ) : (
          sum && (
            <>
              <div className="ins-tiles">
                <Tile label="Today" f={sum.today} />
                <Tile label="7 days" f={sum.week} />
                <Tile label="All time" f={sum.all} />
              </div>
              <p className="ins-note ins-caveat">Costs are estimated at list price on this machine. The provider's bill is the real figure.</p>
              {counted !== null && <p className="ins-note ins-counted">Counted {ago(counted, now)}.</p>}
            </>
          )
        )}
        {failed && (
          <p className="ins-note ins-stale" role="status">
            <span>{loadedAt !== null ? `Updated ${span(now - loadedAt)} ago. Could not refresh.` : "Could not refresh."}</span>
            <button type="button" className="ins-refresh" onClick={load}>Refresh</button>
          </p>
        )}
      </section>

      <section className="ins-sec" aria-labelledby="ins-now">
        <h3 id="ins-now">Now</h3>
        {sessions.length === 0 ? (
          <p className="ins-note">No agents are open.</p>
        ) : (
          <ul className="ins-list">
            {sessions.map((s) => {
              const chip = chipOfLive(s, now);
              const lane: Lane = chip?.lane ?? "idle";
              const word = chip?.word ?? "Idle";
              const used = usage && tracked ? usageFor(s, all) : null;
              const name = agentName(s.agent);
              const when = ago(s.at, now);
              const label = `${name}${s.workspace ? ` in ${s.workspace}` : ""}, ${word}${s.action ? `, ${s.action}` : ""}${when ? `, ${when}` : ""}`;
              return (
                <li key={s.key}>
                  <button type="button" className={`ins-row ${lane}`} aria-label={label} title={s.dir ?? undefined} onClick={() => onJump?.(s.key)}>
                    <span className="ins-row-top">
                      <span className="ins-agent" title={name}>{name}</span>
                      <span className="ins-ws" title={s.workspace}>{s.workspace}</span>
                      <span className={`ins-pill ${lane}`}>{word}</span>
                    </span>
                    <span className="ins-row-sub">
                      <span className="ins-action" title={s.action}>{s.action || " "}</span>
                      {when && <span className="ins-when">{when}</span>}
                    </span>
                    {used && (
                      <span className="ins-row-use" title={costTitle(used.usd, used.partial, used.tokens)}>
                        {compact(used.tokens)} tokens · {costText(used.usd, used.partial, used.tokens)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="ins-sec" aria-labelledby="ins-sessions">
        <h3 id="ins-sessions">Sessions</h3>
        {usage === null || !tracked ? (
          <p className="ins-note">{usage === null ? "Loading sessions…" : "Shown once token tracking is on."}</p>
        ) : recent.length === 0 ? (
          <p className="ins-note">No sessions recorded yet.</p>
        ) : (
          <ul className="ins-list">
            {recent.map((r) => (
              <li key={`${r.provider}:${r.session}`} className="ins-sess" title={`${NAMES[r.provider]} session ${r.session}${r.cwd ? `\n${r.cwd}` : ""}`}>
                <span className="ins-row-top">
                  <span className="ins-agent">{NAMES[r.provider]}</span>
                  <span className="ins-ws">{r.workspace || "Unknown folder"}</span>
                  <span className="ins-when">{r.day}</span>
                </span>
                <span className="ins-row-sub">
                  <span className="ins-action">{compact(r.tokens)} tokens</span>
                  <span className="ins-cost" title={costTitle(r.usd, r.partial, r.tokens)}>{costText(r.usd, r.partial, r.tokens)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {usage !== null && tracked && <MoreSessions total={all.length} shown={SESSION_ROWS} onOpen={() => openSettings("usage")} />}
      </section>

      <section className="ins-sec" aria-labelledby="ins-auto-pr">
        <h3 id="ins-auto-pr">Pull requests</h3>
        <AutoPrStatus />
      </section>
    </div>
  );
}
