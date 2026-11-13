// The automation page's detail half (audit N-39): the selected automation's Overview and Runs tabs,
// and a Hermes job's saved runs. Both take props only, so they live beside the page rather than in it.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { folderName } from "../projects/model";
import type { Usage } from "../usage/tokens";
import { ago, graceWord, precheckWord, rowActions, runActions, runStep, startedBy, statusWord, triggerLabel, upcoming, whereItRuns, type Automation, type Run, type RunAction } from "./model";
import { totalUsage } from "./usage";
import { Tab, TabList, TabPanel, Tabs } from "../ui/Tabs";

export type DetailProps = { a: Automation; running?: boolean; onEdit?: () => void; onDelete?: () => void; runs: Run[]; runsError?: string; now: number; usage: Usage | null; agent: string; tab: "overview" | "runs"; onTab: (t: "overview" | "runs") => void; onRun: () => void; onToggle: () => void; live?: (r: Run) => boolean; onView?: (r: Run) => void; onResume?: (r: Run) => void; onCancel?: (r: Run) => void; onRetry: () => void };
export function Detail({ a, running = false, onEdit, onDelete, runs, runsError, now, usage, agent, tab, onTab, onRun, onToggle, live, onView, onResume, onCancel, onRetry }: DetailProps) {
  const mine = runs.filter((r) => r.automationId === a.id).sort((x, y) => y.number - x.number);
  // AUTO-018: a prompt that does not fit is folded; the guess holds until the box is measured, and
  // a narrower window brings the control up. The control stays put when used, so focus stays on it.
  const [unfolded, setUnfolded] = useState(false);
  // AUTO-013: the selected run, the run whose saved output is open, and a rerun held as pending a moment.
  // The selection follows the run, not its place, so a new run arriving on top does not move it.
  const [sel, setSel] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const runList = useRef<HTMLOListElement>(null);
  const found = mine.findIndex((r) => r.id === sel);
  const at = found < 0 ? null : found;
  const actionsOf = (r: Run) => runActions(r, { live: live?.(r) ?? false, exists: true });
  const doAction = (r: Run, what: RunAction) => {
    if (what === "view") onView?.(r);
    else if (what === "resume") onResume?.(r);
    else if (what === "cancel") onCancel?.(r);
    else if (what === "snapshot") setShown((x) => (x === r.id ? null : r.id));
    else {
      setPending(r.id);
      window.setTimeout(() => setPending((x) => (x === r.id ? null : x)), 1500);
      onRun();
    }
  };
  const runKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (e.target !== e.currentTarget && (e.key === "Enter" || e.key === " ")) return; // a focused button does its own thing
    const step = runStep({ key: e.key, mods: e.altKey || e.ctrlKey || e.metaKey || e.shiftKey, composing: e.nativeEvent.isComposing }, at, mine.length);
    if (step === null) return;
    e.preventDefault();
    if (step === "open") {
      const r = mine[at ?? 0];
      const first = actionsOf(r).find((x) => x !== "rerun");
      if (first) doAction(r, first);
    } else {
      setSel(mine[step].id);
      runList.current?.children[step]?.scrollIntoView({ block: "nearest" });
    }
  };
  const [overflows, setOverflows] = useState(() => a.prompt.split("\n").length > 6 || a.prompt.length > 600);
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || unfolded || typeof ResizeObserver === "undefined") return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [a.prompt, unfolded]);
  return (
    <section className="autos-detail" aria-label={`${a.name} overview`}>
      <div className="autos-detail-head">
        <h3>{a.name}</h3>
        {!a.enabled && <span className="chip">Paused</span>}
        {rowActions(a).includes("toggle") && (
          <label className="autos-switch">
            <input type="checkbox" role="switch" checked={a.enabled} onChange={onToggle} /> {a.enabled ? "On" : "Paused"}
          </label>
        )}
        {rowActions(a).includes("run") && (
          <button className="btn" disabled={!!a.problem || running} title={a.problem ? `Run now is blocked: ${a.problem}` : running ? "Run now is already being started" : undefined} onClick={onRun}>
            {running ? "Starting…" : "Run now"}
          </button>
        )}
        {onEdit && rowActions(a).includes("edit") && (
          <button className="btn" onClick={onEdit}>
            Edit
          </button>
        )}
        {onDelete && rowActions(a).includes("delete") && (
          <button className="btn" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
      {a.source && (
        <div className="note" role="status">
          {whereItRuns(a)}. Kolux lists it and can start, pause or remove it; its schedule and its history stay in {a.source === "hermes" ? "Hermes, and Runs shows its last ten saved runs" : "OpenClaw"}.
        </div>
      )}
      {a.problem && (
        <div className="note warn" role="status">
          This automation cannot run: {a.problem}. Run now is blocked and timed runs are logged as skipped until it is fixed.
        </div>
      )}
      {/* A src/ui tab set: the strip has one tab stop and the arrow keys move between Overview and Runs. Both panels
          stay on the page, the closed one hidden, so the runs list keeps its place. */}
      <Tabs value={tab} onValue={onTab}>
      <TabList className="autos-tabs" label="Automation views">
        {(["overview", "runs"] as const).map((t) => (
          <Tab key={t} value={t} selected={tab === t} className="btn">
            {t === "overview" ? "Overview" : "Runs"}
          </Tab>
        ))}
      </TabList>
      <TabPanel value="overview" label="Overview" hidden={tab !== "overview"}>
        <dl className="autos-facts">
          <dt>Timetable or trigger</dt>
          <dd>{triggerLabel(a)}</dd>
          <dt>Upcoming</dt>
          <dd>{upcoming(a, now)}</dd>
          {a.source ? (
            <>
              <dt>Last result</dt>
              <dd>{a.lastRunAt ? `${a.lastStatus ?? "Ran"}, ${ago(a.lastRunAt, now)}` : "Never ran"}</dd>
              {a.pausedReason && (
                <>
                  <dt>Paused because</dt>
                  <dd>{a.pausedReason}</dd>
                </>
              )}
            </>
          ) : (
            <>
              <dt>Workspace</dt>
              <dd>{a.workspaceMode === "new-per-run" ? "A new one for every run" : a.workspace ? folderName(a.workspace) : "Not chosen"}</dd>
              <dt>If Kolux was away</dt>
              <dd>{graceWord(a.missedRunGraceMinutes)}</dd>
            </>
          )}
          {a.precheck && (
            <>
              <dt>Precheck</dt>
              <dd>
                <code>{a.precheck}</code> (up to {precheckWord(a.precheckTimeoutSeconds)}, timed runs only)
              </dd>
            </>
          )}
          <dt>Agent</dt>
          <dd>{agent}</dd>
          <dt>Runs</dt>
          <dd>{runsError ? "unknown" : mine.length}</dd>
          <dt>Usage</dt>
          <dd>{runsError ? "unknown" : totalUsage(mine, usage, agent, a.workspaceMode)}</dd>
        </dl>
        {runsError && <div className="note warn">The run history could not be read: {runsError}</div>}
        <pre ref={box} className={`autos-prompt${unfolded ? "" : " folded"}`}>{a.prompt}</pre>
        {(overflows || unfolded) && (
          <button className="btn link autos-fold" aria-expanded={unfolded} onClick={() => setUnfolded(!unfolded)}>
            {unfolded ? "Fold the prompt" : "Show the whole prompt"}
          </button>
        )}
      </TabPanel>
      <TabPanel value="runs" label="Runs" hidden={tab !== "runs"}>
      {a.source === "hermes" && a.jobId ? (
        <HermesRuns jobId={a.jobId} show={tab === "runs"} />
      ) : runsError ? (
        <div className="note warn" role="alert">
          The run history could not be read: {runsError}{" "}
          <button className="btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : mine.length === 0 ? (
        <p className="autos-none">No runs yet.</p>
      ) : (
        <ol ref={runList} className="autos-runs" role="listbox" aria-label={`${a.name} runs`} tabIndex={0} aria-activedescendant={at !== null ? `run-${mine[at]?.id}` : undefined} onKeyDown={runKey}>
          {mine.map((r, i) => (
            <li key={r.id} id={`run-${r.id}`} role="option" aria-selected={at === i} onClick={() => setSel(r.id)}>
              <span className="num">#{r.number}</span>
              <span>{statusWord(r)}</span>
              <span className="muted">{startedBy(r)}</span>
              <span className="muted">{r.lastAt ? `first ${ago(r.at, now)}, last ${ago(r.lastAt, now)}` : ago(r.at, now)}</span>
              {r.worktreeName && <span className="chip">{r.worktreeName}</span>}
              {r.detail && <span className="muted">{r.detail}</span>}
              {actionsOf(r).map((what) => (
                <button key={what} className="btn" disabled={what === "rerun" && pending === r.id} aria-expanded={what === "snapshot" ? shown === r.id : undefined} onClick={() => doAction(r, what)}>
                  {what === "view" ? "View run" : what === "resume" ? "Resume workspace" : what === "snapshot" ? "Saved output" : what === "cancel" ? "Cancel run" : pending === r.id ? "Rerun pending" : "Rerun"}
                </button>
              ))}
              {r.worktreeGone && shown === r.id && (
                <div className="autos-snapshot">
                  <p className="note">A snapshot: the workspace {r.worktreeName ?? ""} is gone, so this is what was saved when the run ended, not a live terminal.</p>
                  {r.output ? <pre className="auto-output">{r.output}</pre> : <p className="muted">No terminal output was saved for this run.</p>}
                </div>
              )}
              {r.output && !r.worktreeGone && r.outputFrom === undefined && <pre className="auto-output">{r.output}</pre>}
            </li>
          ))}
        </ol>
      )}
      </TabPanel>
      </Tabs>
    </section>
  );
}

type HermesRun = { file: string; sections: { title: string; body: string }[] };
/** null while loading; `error` when Hermes' run files could not be read. */
export type HermesState = { runs: HermesRun[] } | { error: string } | null;

/** T-749 (DT-C185): a Hermes job's saved runs, newest first, read from Hermes' own output folder when Runs is shown. Hermes owns the files, so there is no clear here. */
export function HermesRuns({ jobId, show, initial = null }: { jobId: string; show: boolean; initial?: HermesState }) {
  const [state, setState] = useState<HermesState>(initial);
  const load = () => {
    setState(null);
    invoke<{ runs: HermesRun[] }>("automation_external_history", { id: jobId }).then(
      (h) => setState({ runs: h.runs }),
      (e) => setState({ error: String(e) }),
    );
  };
  // Detail is keyed by the automation, so a new job remounts this; the first showing of Runs reads once.
  useEffect(() => {
    if (show && !state) load();
  }, [show, jobId]);
  if (!state) return <p className="autos-none">Reading Hermes' runs…</p>;
  if ("error" in state)
    return (
      <div className="note warn" role="alert">
        Hermes' runs could not be read: {state.error}{" "}
        <button className="btn" onClick={load}>
          Try again
        </button>
      </div>
    );
  if (!state.runs.length) return <p className="autos-none">Hermes has no saved runs for this job yet.</p>;
  return (
    <div className="autos-snapshot">
      {state.runs.map((r) => (
        <details key={r.file}>
          <summary>{r.file}</summary>
          {r.sections.map((s, i) => (
            <div key={i}>
              {s.title && <strong>{s.title}</strong>}
              <pre className="auto-output">{s.body}</pre>
            </div>
          ))}
        </details>
      ))}
    </div>
  );
}
