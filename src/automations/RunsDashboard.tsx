// The Runs dashboard (AUTO-015): every automation's runs in one table, newest first, with a
// search, a status filter, success and failure tiles for the last 24 hours and 7 days, and
// Refresh. Rows arrive 100 at a time as the list is scrolled to its end, and only the rows on
// screen are drawn, so a long history scrolls smoothly. Clicking a run opens it as a full page
// (RunPage) whose breadcrumb leads back to Runs and then to Automations.
import { useLayoutEffect, useRef, useState } from "react";
import { Refresh, Search } from "../chrome/icons";
import type { Usage } from "../usage/tokens";
import { runUsage, usageWord } from "./usage";
import { ago, dashboardRows, onScreen, outputNote, RUN_BATCH, runTiles, startedBy, statusWord, triggerLabel, type Automation, type Run, type RunFilter } from "./model";

const ROW = 33; // .autos-table td: 32 px and a 1 px rule
const filters: Array<{ value: RunFilter; label: string }> = [
  { value: "all", label: "Any status" },
  { value: "progress", label: "In progress" },
  { value: "success", label: "Successful" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped" },
];

/** An event-started run's tooltip names the event its automation waits for. */
const eventTip = (r: Run, a: Automation | undefined) => (r.trigger === "event" ? (r.eventDetail ?? (a?.trigger?.kind === "event" ? triggerLabel(a) : "Started by an event")) : undefined);

type Crumbs = { onAutomations: () => void; onRuns?: () => void; last: string };
export function Breadcrumb({ onAutomations, onRuns, last }: Crumbs) {
  return (
    <nav className="runs-crumbs" aria-label="Breadcrumb">
      <button className="link" onClick={onAutomations}>
        Automations
      </button>
      <span aria-hidden>›</span>
      {onRuns ? (
        <>
          <button className="link" onClick={onRuns}>
            Runs
          </button>
          <span aria-hidden>›</span>
        </>
      ) : null}
      <h2 aria-current="page">{last}</h2>
    </nav>
  );
}

type Props = {
  runs: Run[];
  automations: Automation[];
  now: number;
  /** The runs could not be read: said plainly, never as "No runs yet" with zero counts. */
  error?: string;
  onRefresh: () => void;
  onAutomations: () => void;
  onOpen: (run: Run) => void;
  hidden?: boolean;
  /** Seeds the filter (tests render the dashboard to HTML). */
  initialFilter?: RunFilter;
};

export default function RunsDashboard({ runs, automations, now, error, onRefresh, onAutomations, onOpen, hidden, initialFilter = "all" }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RunFilter>(initialFilter);
  const [shown, setShown] = useState(RUN_BATCH); // leaving the dashboard drops this: back from Automations starts at the newest
  const [view, setView] = useState({ top: 0, height: 600 });
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hidden]);

  const byId = new Map(automations.map((a) => [a.id, a]));
  const name = (id: string) => byId.get(id)?.name ?? "Deleted automation";
  const all = dashboardRows(runs, name, filter, query);
  const loaded = all.slice(0, shown);
  const [start, end] = onScreen(view.top, view.height, ROW, loaded.length);
  const tiles = runTiles(runs, now);
  const narrow = (f: () => void) => {
    f();
    setShown(RUN_BATCH);
    if (box.current) box.current.scrollTop = 0;
  };
  const scrolled = (el: HTMLDivElement) => {
    setView({ top: el.scrollTop, height: el.clientHeight });
    if (shown < all.length && el.scrollTop + el.clientHeight > el.scrollHeight - 4 * ROW) setShown((s) => s + RUN_BATCH);
  };

  return (
    <section className="runs" hidden={hidden} aria-label="Runs">
      <div className="autos-bar">
        <Breadcrumb onAutomations={onAutomations} last="Runs" />
        <label className="autos-search">
          <Search />
          <input className="field" placeholder="Search automation, status, workspace" value={query} onChange={(e) => narrow(() => setQuery(e.target.value))} aria-label="Search runs" />
        </label>
        <select className="field" aria-label="Status" value={filter} onChange={(e) => narrow(() => setFilter(e.target.value as RunFilter))}>
          {filters.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <span className="autos-gap" />
        <button className="ib" title="Refresh" onClick={onRefresh}>
          <Refresh />
        </button>
      </div>
      {!error && (
      <div className="runs-tiles">
        <div className="runs-tile ok">
          <b>{tiles.day.ok}</b> succeeded in 24 h
        </div>
        <div className="runs-tile bad">
          <b>{tiles.day.failed}</b> failed in 24 h
        </div>
        <div className="runs-tile ok">
          <b>{tiles.week.ok}</b> succeeded in 7 days
        </div>
        <div className="runs-tile bad">
          <b>{tiles.week.failed}</b> failed in 7 days
        </div>
      </div>
      )}
      {error ? (
        <div className="empty" role="alert">
          <h2>The runs could not be read</h2>
          <p>{error}</p>
          <button className="btn" onClick={onRefresh}>
            Retry
          </button>
        </div>
      ) : runs.length === 0 ? (
        <div className="empty">
          <h2>No runs yet</h2>
          <p>Each time an automation starts, by hand, on its timetable or on an event, its run is listed here.</p>
        </div>
      ) : all.length === 0 ? (
        <div className="empty">
          <h2>Nothing matches</h2>
          <p>No run fits this search and this status.</p>
        </div>
      ) : (
        <div className="autos-table-wrap" ref={box} onScroll={(e) => scrolled(e.currentTarget)}>
          <table className="autos-table runs-table">
            <thead>
              <tr>
                <th>Automation</th>
                <th>Run</th>
                <th>How it started</th>
                <th>Started</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {start > 0 && <tr style={{ height: start * ROW }} aria-hidden />}
              {loaded.slice(start, end).map((r) => (
                <tr key={r.id} className="runs-row" onClick={() => onOpen(r)}>
                  <td>
                    <button
                      className="btn link"
                      aria-label={`Open run #${r.number} of ${name(r.automationId)}`}
                      onClick={(e) => {
                        e.stopPropagation(); // the row's own click would open it a second time
                        onOpen(r);
                      }}
                    >
                      {name(r.automationId)}
                    </button>
                  </td>
                  <td>#{r.number}</td>
                  <td title={eventTip(r, byId.get(r.automationId))}>{startedBy(r)}</td>
                  <td title={new Date(r.at).toLocaleString()}>{ago(r.at, now)}</td>
                  <td className={`runs-status ${r.status}`}>{statusWord(r)}</td>
                </tr>
              ))}
              {end < loaded.length && <tr style={{ height: (loaded.length - end) * ROW }} aria-hidden />}
            </tbody>
          </table>
          <p className="runs-count">{loaded.length < all.length ? `${loaded.length} of ${all.length} runs · scroll for the next ${Math.min(RUN_BATCH, all.length - loaded.length)}` : `${all.length} run${all.length === 1 ? "" : "s"}`}</p>
        </div>
      )}
    </section>
  );
}

/** One run as a full page; its breadcrumb goes back to Runs, then to Automations. */
export function RunPage({ run, automation, now, usage = null, agentName, onRuns, onAutomations }: { run: Run; automation: Automation | undefined; now: number; usage?: Usage | null; agentName?: string; onRuns: () => void; onAutomations: () => void }) {
  // AUTO-014: the run's tokens and spend when they can be tied to it; unknown reads unavailable.
  const used = runUsage(run, usage, agentName, automation?.workspaceMode);
  const name = automation?.name ?? "Deleted automation";
  const facts: Array<[string, string | undefined]> = [
    ["Automation", name],
    ["Status", statusWord(run)],
    ["How it started", run.trigger === "event" ? `${startedBy(run)}: ${eventTip(run, automation)}` : startedBy(run)],
    ["Started", `${new Date(run.at).toLocaleString()} (${ago(run.at, now)})`],
    ["Workspace", run.worktreeName ?? run.worktree],
    ["Detail", run.detail],
    ["Tokens and cost", used ? usageWord(used) : undefined],
  ];
  return (
    <section className="runs" aria-label={`${name} run ${run.number}`}>
      <div className="autos-bar">
        <Breadcrumb onAutomations={onAutomations} onRuns={onRuns} last={`${name} #${run.number}`} />
      </div>
      <dl className="run-facts">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {run.outputFrom && (
        <div className="run-output">
          <h3>{run.outputFrom === "replay" ? "Output so far" : "Saved output"}</h3>
          <p className="muted">{outputNote(run)}</p>
          <pre className="auto-output">{run.output}</pre>
        </div>
      )}
      {!run.outputFrom && !run.output && run.paneEnded && <p className="muted">No output was saved for this run: its terminal had closed before the run ended.</p>}
    </section>
  );
}
