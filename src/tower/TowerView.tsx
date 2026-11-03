// The control tower (OD-09 / DT-C35, T-546): a full-width switcher screen in the main window (T-546-c:
// Own window also opens it in a window of its own, on the second screen; ownWindow.ts). Usage per provider across the top, then every
// agent pane as one row, needs-you first.
// One click on a row (or Enter on the selected one) jumps to that pane; Up, Down, Home and End walk the rows.
// The rows come from `towerRows` in tower.ts; the window computes each pane's chip and meter the
// same way the Board does, so the two never disagree.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import "./tower.css";
import { LANES, span, type Lane } from "../board/chip";
import { settle } from "../inbox/inbox";
import { StatusGlyph, type GlyphName } from "../chrome/icons";
import VendorMark, { type Agent } from "../chrome/VendorMark";
import { programWord } from "../launch/PlusMenu";
import { folderName } from "../projects/model";
import { meterText, tone } from "../usage/meter";
import { refreshAll } from "../usage/refresh";
import { OWN_WINDOW_WIRED, openTowerWindow } from "./ownWindow";
import Ring from "../usage/Ring";
import { emptyWords, laneCounts, refreshLabel, revealRow, selectionForKey, type AccountUsage, type Row } from "./tower";

/** T-546-c: `detached` = drawn in the Tower's own window (no Own window button; Refresh asks the main window). */
/** `ownWindow` = offer the Own window button (FIX-2: only once T-546-c's window side is wired). */
type Props = { rows: Row[]; usage: AccountUsage[]; now: number; onOpen: (key: number) => void; detached?: boolean; onRefresh?: () => void; ownWindow?: boolean; loading?: boolean };

/** T-546-c: the words when the Tower's own window could not open; the Tower stays on this screen. */
export const NO_WINDOW = "The Tower could not open in its own window here, so it stays on this screen.";

/** The glyph for a row: its lane, with the stale and stopped words told apart. */
function glyphOf(r: Row): GlyphName {
  if (r.lane === "needs") return "attention";
  if (r.lane === "working") return r.word === "No recent update" ? "stale" : r.word === "Queued" ? "idle" : "spinner";
  if (r.lane === "done") return "check";
  if (r.lane === "stopped") return r.line === "Interrupted" ? "interrupted" : "failed";
  return "idle";
}

const laneTitle = (lane: Lane) => LANES.find((l) => l.id === lane)?.title ?? lane;

export default function TowerView({ rows, usage, now, onOpen, detached = false, onRefresh = refreshAll, ownWindow: offerOwn = OWN_WINDOW_WIRED, loading = false }: Props) {
  const [noWindow, setNoWindow] = useState(false);
  const ownWindow = () => void openTowerWindow().then((r) => setNoWindow(r === "failed"));
  const [selected, setSelected] = useState<number | null>(null);
  const keys = rows.map((r) => r.key);
  const current = settle(keys, selected);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => list.current?.focus(), []);
  // Arrow keys move the selection; keep the selected row on screen.
  useEffect(() => void revealRow(list.current, current), [current]);
  // Refresh shows it is working (and cannot be pressed again) for a moment, then settles.
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  const refresh = () => {
    setRefreshing(true);
    const done = () => window.setTimeout(() => alive.current && setRefreshing(false), 800);
    Promise.resolve(onRefresh()).then(done, done);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const pick = selectionForKey(e.key, keys, current);
    if (pick) setSelected(pick.to);
    else if (e.key === "Enter" && current !== null) onOpen(current);
    else return;
    e.preventDefault();
  };

  const counts = laneCounts(rows).filter((c) => c.count > 0);
  const needs = counts.find((c) => c.lane === "needs")?.count ?? 0;
  return (
    <div className={`tower${detached ? " detached" : ""}`}>
      <div className="top">
        <div className={`card summary${needs ? " needs" : ""}`} role="status" aria-label="Tower summary">
          <span className="big">{rows.length}</span>
          <span className="what">{rows.length === 1 ? "agent" : "agents"}</span>
          <span className="counts">
            {counts.map((c) => (
              <span key={c.lane} className={`count ${c.lane}`}>
                <b>{c.count}</b> {laneTitle(c.lane).toLowerCase()}
              </span>
            ))}
          </span>
          {/* USAGE-023 (T-070): a manual refresh reads every provider at once, past the debounce and any retry-after. */}
          <button type="button" className="refresh" title="Read the usage figures again now" disabled={refreshing} aria-busy={refreshing} onClick={refresh}>
            {refreshLabel(refreshing)}
          </button>
          {/* T-546-c: the Tower in its own window, for a second screen; it stays here when that window cannot open. */}
          {!detached && offerOwn && (
            <button type="button" className="refresh own" title="Open the Tower in its own window, on the second screen when there is one" onClick={ownWindow}>
              Own window
            </button>
          )}
          {noWindow && <span className="nowin" role="status">{NO_WINDOW}</span>}
        </div>
        {usage.map((u) => {
          // T-546-b (2): one card per provider; the accounts its panes run on are listed under it, and
          // the figures (one set per provider until T-548) are never repeated under a second name.
          const named = u.accounts.filter((a) => a.account !== null);
          return (
            <div key={u.agent} className="card usage" aria-label={`${programWord(u.agent as Agent)} usage`}>
              <div className="who">
                <VendorMark agent={u.agent as Agent} size={14} />
                <span className="name">{programWord(u.agent as Agent)}</span>
                <span className="panes">
                  {u.panes} {u.panes === 1 ? "pane" : "panes"}
                </span>
              </div>
              {named.length > 0 && (
                <div className="accts" aria-label="Accounts in use">
                  {u.accounts.map((a) => (
                    <span key={a.account ?? ""} className="acct">
                      {a.account ?? "default"} <b>{a.panes}</b>
                    </span>
                  ))}
                </div>
              )}
              {u.figures ? (
                <>
                  <Bar label="5-hour" percent={u.figures.fiveHour} />
                  <Bar label="Weekly" percent={u.figures.weekly} />
                </>
              ) : (
                <div className="none">No usage figures yet</div>
              )}
              {/* T-548: whose figures these are, and the panes that are on another account (their figures are not read yet). */}
              {u.forAccount !== undefined && u.figures && <div className="none">{`Figures for ${u.forAccount ?? "the system default"}`}</div>}
              {/* T-548-b: the accounts other than the one above whose own figures have been read */}
              {u.accounts.filter((x) => x.figures).map((x) => (
                <div key={x.account ?? ""} className="none" data-account-figures>{`${x.account ?? "The system default"}: ${meterText({ plan: x.figures })}`}</div>
              ))}
              {!!u.elsewhere && <div className="none">{`${u.elsewhere} ${u.elsewhere === 1 ? "pane" : "panes"} on other accounts: not read yet`}</div>}
            </div>
          );
        })}
      </div>
      {/* council AFTER 2 (MERGE 42 review): the listbox is the list of rows only; each lane is a group of options. */}
      <div className="list" ref={list} tabIndex={0} role="listbox" aria-label="Control tower" aria-activedescendant={current === null ? undefined : `tower-${current}`} onKeyDown={onKeyDown}>
        {rows.length === 0 && (
          <div className="clear" role="status">
            <StatusGlyph glyph="check" size={14} />
            {emptyWords(loading)}
          </div>
        )}
        {LANES.map((l) => {
          const group = rows.filter((r) => r.lane === l.id);
          if (group.length === 0) return null;
          return (
            <section key={l.id} role="group" aria-label={l.title}>
              <h3>
                {l.title} <span className="n">{group.length}</span>
              </h3>
              {group.map((r) => (
                <div key={r.key} id={`tower-${r.key}`} role="option" aria-selected={r.key === current} className={`row ${r.lane}`} title={`Open the ${r.title} pane`} onClick={() => (setSelected(r.key), onOpen(r.jump))}>
                  <span className="st">
                    <StatusGlyph glyph={glyphOf(r)} size={12} />
                  </span>
                  <span className="name">{r.title}</span>
                  <span className="agent">
                    <VendorMark agent={r.agent as Agent} size={12} />
                    {programWord(r.agent as Agent)}
                    {r.account && <span className="acct">{r.account}</span>}
                  </span>
                  <span className="where">{[r.branch, r.cwd ? folderName(r.cwd) : null].filter(Boolean).join(" · ") || "—"}</span>
                  <span className="doing">
                    <span className="word">{r.word}</span>
                    {r.line && <span className="line">{r.line}</span>}
                    {r.file && <span className="file">{r.file}</span>}
                  </span>
                  <span className="use">
                    {r.meter?.context && (
                      <span className={`ctx ${tone(r.meter.context.percent)}`} title={`Context ${r.meter.context.percent}% of the window`}>
                        <Ring percent={r.meter.context.percent} size={11} />
                        {r.meter.context.percent}%
                      </span>
                    )}
                    {r.meter?.plan && (
                      <span className="plan">
                        {r.meter.plan.fiveHour !== null && <span className={tone(r.meter.plan.fiveHour)}>5h {r.meter.plan.fiveHour}%</span>}
                        {r.meter.plan.weekly !== null && <span className={tone(r.meter.plan.weekly)}>wk {r.meter.plan.weekly}%</span>}
                      </span>
                    )}
                  </span>
                  <span className="when">{r.since > 0 ? span(now - r.since) : ""}</span>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Bar({ label, percent }: { label: string; percent: number | null }) {
  if (percent === null) return null;
  return (
    <div className={`bar ${tone(percent)}`}>
      <span className="lbl">{label}</span>
      <span className="track">
        <span className="fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="pct">{percent}%</span>
    </div>
  );
}
