// The Automations page (AUTO-016, AUTO-019): a table of every automation with sorting, filters
// and search, a quick-actions menu on each row (Run now, pause / resume, Edit, Delete), and the
// selected automation's prompt and numbered runs below. The page reloads itself whenever the
// back end says an automation or a run changed, so a run's status moves without a refresh.
// New Automation and Edit open the dialog of AUTO-005; Runs opens the dashboard of AUTO-015.
// AUTO-017: Up and Down move the selection, Enter opens the automation as its own page, Left and
// Right switch Overview and Runs, Escape steps back to the list and then closes the page.
// AUTO-018: the Overview tab, with a long prompt folded behind an expand control.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Ask from "../chrome/Ask";
import { Dots, Plus, Refresh, Search } from "../chrome/icons";
import type { AgentInfo } from "../launch/PlusMenu";
import type { Project } from "../projects/model";
import AutomationDialog, { TemplateCards } from "./AutomationDialog";
import type { Template } from "./timetable";
import RunsDashboard, { Breadcrumb, RunPage } from "./RunsDashboard";
import { totalUsage } from "./usage";
import { PROVIDERS, type Usage } from "../usage/tokens";
import { folderName } from "../projects/model";
import { ago, CONFIRM_DELETE_KEY, confirmDelete, keepSelection, lastRun, runActions, runStep, startedBy, type RunAction, pageKey, matches, noFilters, normalizeQuery, passes, sortRows, statusWord, triggerLabel, upcoming, graceWord, precheckWord, type Automation, type Filters, type Names, type Run, type SortKey } from "./model";

/** `runsError` says the history could not be read (AUTO-018: the run count then reads unknown). */
export type Data = { automations: Automation[]; runs: Run[]; runsError?: string };

type Props = {
  projects: Project[];
  agents: AgentInfo[];
  settings: Record<string, unknown>;
  onSettings: (next: Record<string, unknown>) => void;
  /** Escape on the list closes the page (AUTO-017). */
  onClose?: () => void;
  /** Seeds the page without asking the back end (tests render it to HTML); `open` opens one automation. */
  initial?: { data?: Data; error?: string; runs?: boolean; open?: string; usage?: Usage };
  /** AUTO-013: whether a run's own terminal is still open, and how View run and Resume workspace get there. */
  liveRun?: (r: Run) => boolean;
  onViewRun?: (r: Run) => void;
  onResume?: (r: Run) => void;
};

const columns: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "Name" },
  { key: "trigger", label: "Timetable or trigger" },
  { key: "agent", label: "Agent" },
  { key: "project", label: "Project" },
  { key: "lastRun", label: "Last run" },
  { key: "nextRun", label: "Upcoming" },
];

const results: Array<{ value: Filters["result"]; label: string }> = [
  { value: "all", label: "Any result" },
  { value: "never", label: "Never ran" },
  { value: "completed", label: "Completed" },
  { value: "dispatched", label: "Running" },
  { value: "pending", label: "Queued" },
  { value: "skipped", label: "Skipped" },
  { value: "failed", label: "Failed" },
];

export default function AutomationsPage({ projects, agents, settings, onSettings, onClose, initial, liveRun, onViewRun, onResume }: Props) {
  const [data, setData] = useState<Data | null>(initial?.data ?? null);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });
  const [selected, setSelected] = useState<string | null>(initial?.open ?? null);
  // AUTO-017: the automation opened as its own page, and the detail's tab.
  const [opened, setOpened] = useState<string | null>(initial?.open ?? null);
  const [tab, setTab] = useState<"overview" | "runs">("overview");
  const root = useRef<HTMLDivElement>(null);
  const lastIndex = useRef(0);
  const keyRef = useRef<(e: globalThis.KeyboardEvent) => void>(() => {});
  const [menu, setMenu] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null); // the automation whose delete waits for a yes
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // The dialog: undefined shut, null a new automation, else the latest saved copy being edited.
  const [dialog, setDialog] = useState<Automation | null | undefined>(undefined);
  const [template, setTemplate] = useState<Template | null>(null);
  const open = (t: Template | null) => {
    setTemplate(t);
    setDialog(null);
  };
  const search = useRef<HTMLInputElement>(null);
  // AUTO-015: the Runs dashboard, and the run opened from it as a full page.
  const [runsView, setRunsView] = useState(initial?.runs ?? false);
  const [openRun, setOpenRun] = useState<string | null>(null);
  // AUTO-014: the token usage Kolux reads from the agents' logs, matched to finished runs.
  const [usage, setUsage] = useState<Usage | null>(initial?.usage ?? null);

  const load = () =>
    invoke<Data>("automations_list")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  useEffect(() => {
    if (initial) return;
    void load();
    search.current?.focus(); // the search box has focus when the page opens
    // T-140-d: a run that moved may have new usage to match, so the saved usage is read again too.
    const off = listen("automations-changed", () => {
      void load();
      invoke<Usage>("token_usage").then(setUsage, () => {});
    });
    // AUTO-014: the saved usage at once, then a fresh read of each tracked agent's logs.
    invoke<Usage>("token_usage")
      .then((u) => {
        setUsage(u);
        const scans = PROVIDERS.filter((p) => u.tracking[p]).map((p) => invoke("token_usage_scan", { provider: p }));
        if (scans.length) void Promise.allSettled(scans).then(() => invoke<Usage>("token_usage").then(setUsage, () => {}));
      })
      .catch(() => {});
    const tick = window.setInterval(() => setNow(Date.now()), 30000);
    return () => {
      window.clearInterval(tick);
      void off.then((u) => u());
    };
  }, []);

  const names: Names = useMemo(
    () => ({ project: (id) => projects.find((p) => p.id === id)?.name ?? "Project gone", agent: (id) => agents.find((a) => a.id === id)?.name ?? id }),
    [projects, agents],
  );
  const q = normalizeQuery(query);
  const all = data?.automations ?? [];
  const runs = data?.runs ?? [];
  const rows = q === null ? [] : sortRows(all.filter((a) => passes(a, filters, runs) && matches(a, q, names)), runs, sort.key, sort.desc, names);
  // Opening the page selects the first automation; a selection that left the list moves to the row
  // now in its place (AUTO-017).
  const currentId = keepSelection(
    rows.map((a) => a.id),
    selected,
    lastIndex.current,
  );
  const current = rows.find((a) => a.id === currentId) ?? null;
  lastIndex.current = Math.max(0, rows.findIndex((a) => a.id === currentId));
  const openedA = opened === null ? undefined : all.find((a) => a.id === opened);
  const rowEl = (id: string) => root.current?.querySelector<HTMLElement>(`tr[data-id="${id}"]`);
  // A row that vanished took the focus with it; the row now selected gets it.
  useEffect(() => {
    if (currentId && (document.activeElement === document.body || document.activeElement === null)) rowEl(currentId)?.focus();
  }, [currentId]);
  keyRef.current = (e) => {
    const t = e.target as HTMLElement;
    if (runsView || (t !== document.body && !root.current?.contains(t))) return;
    const overlay = dialog !== undefined || asking !== null || menu !== null || t.closest('[role="dialog"],[role="menu"],[role="listbox"]:not(.autos-runs),[role="alertdialog"]') !== null || document.querySelector('[aria-modal="true"]') !== null;
    const control = t.closest("input,textarea,select,button,a,[contenteditable]") !== null;
    const what = pageKey({ key: e.key, mods: e.altKey || e.ctrlKey || e.metaKey || e.shiftKey, control, search: t === search.current, row: t.tagName === "TR", overlay, opened: openedA !== undefined });
    if (!what) return;
    if (what === "close") {
      if (onClose) onClose();
      return;
    }
    e.preventDefault();
    if (what === "back") {
      setOpened(null);
      window.setTimeout(() => currentId && rowEl(currentId)?.focus(), 0);
    } else if (what === "tab") setTab((x) => (x === "overview" ? "runs" : "overview"));
    else if (what === "open") {
      if (current) setOpened(current.id);
    } else if (!openedA && rows.length > 0) {
      const at = Math.min(rows.length - 1, Math.max(0, lastIndex.current + (what === "down" ? 1 : -1)));
      const id = rows[at].id;
      setSelected(id);
      window.setTimeout(() => {
        const el = rowEl(id);
        el?.scrollIntoView({ block: "nearest" });
        if (t.tagName === "TR") el?.focus();
      }, 0);
    }
  };
  useEffect(() => {
    const on = (e: globalThis.KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  const agentIds = [...new Set(all.map((a) => a.provider))];

  const act = (p: Promise<unknown>) => p.then(() => load()).catch((e) => setNote(String(e)));
  const runNow = (a: Automation) => {
    setMenu(null);
    setNote(`Run now: ${a.name} is queued`);
    void act(invoke("automation_run_now", { id: a.id }));
  };
  const toggle = (a: Automation) => {
    setMenu(null);
    void act(invoke("automation_set_enabled", { id: a.id, enabled: !a.enabled }));
  };
  const remove = (a: Automation) => {
    setMenu(null);
    if (confirmDelete(settings)) setAsking(a.id);
    else void act(invoke("automation_delete", { id: a.id }));
  };
  // VIEW-116: the don't-ask-again tick counts only when the delete is confirmed.
  const confirmRemove = (id: string, dontAsk: boolean) => {
    setAsking(null);
    if (dontAsk) onSettings({ ...settings, [CONFIRM_DELETE_KEY]: false });
    void act(invoke("automation_delete", { id }));
  };
  // AUTO-005: Edit fetches the latest saved copy before the dialog appears.
  const edit = (a: Automation) => {
    setMenu(null);
    invoke<Data>("automations_list")
      .then((d) => {
        setData(d);
        const latest = d.automations.find((x) => x.id === a.id);
        if (latest) setDialog(latest);
        else setNote(`${a.name} was deleted elsewhere`);
      })
      .catch((e) => setNote(String(e)));
  };
  const saved = (a: Automation) => {
    setSelected(a.id);
    setNote(`Saved ${a.name}`);
    void load();
  };
  // A failed refresh keeps the rows already shown and says so, rather than emptying the dashboard.
  const refreshRuns = () =>
    invoke<Data>("automations_list")
      .then((d) => {
        setData(d);
        setNote(null);
      })
      .catch((e) => setNote(`Refresh failed: ${String(e)}`));
  if (runsView) {
    const shown = runs.find((r) => r.id === openRun);
    const toAutomations = () => {
      setOpenRun(null);
      setRunsView(false);
      setNote(null);
    };
    return (
      <div className="autos">
        {note && (
          <div className="note warn" role="status">
            {note}
          </div>
        )}
        <RunsDashboard runs={runs} automations={all} now={now} onRefresh={() => void refreshRuns()} onAutomations={toAutomations} onOpen={(r) => setOpenRun(r.id)} hidden={shown !== undefined} />
        {shown && <RunPage run={shown} automation={all.find((a) => a.id === shown.automationId)} now={now} usage={usage} agentName={names.agent(shown.provider ?? "")} onRuns={() => setOpenRun(null)} onAutomations={toAutomations} />}
      </div>
    );
  }
  const sortBy = (key: SortKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }));
  const filtered = filters.state !== "all" || filters.result !== "all" || filters.agents.length > 0 || (q ?? "") !== "";

  if (openedA) {
    return (
      <div className="autos" ref={root}>
        <div className="autos-bar">
          <Breadcrumb onAutomations={() => setOpened(null)} last={openedA.name} />
        </div>
        <Detail key={openedA.id} a={openedA} runs={runs} runsError={data?.runsError} now={now} usage={usage} agent={names.agent(openedA.provider)} tab={tab} onTab={setTab} onRun={() => runNow(openedA)} onToggle={() => toggle(openedA)} live={liveRun} onView={onViewRun} onResume={onResume} onRetry={() => void load()} />
        {dialog !== undefined && <AutomationDialog projects={projects} agents={agents} editing={dialog} template={template} onClose={() => setDialog(undefined)} onSaved={saved} />}
      </div>
    );
  }

  return (
    <div className="autos" ref={root}>
      <div className="autos-bar">
        <h2>Automations</h2>
        <label className="autos-search">
          <Search />
          <input ref={search} className="field" placeholder="Search name, project, agent, prompt" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search automations" />
        </label>
        <select className="field" aria-label="On or paused" value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value as Filters["state"] })}>
          <option value="all">On and paused</option>
          <option value="on">On</option>
          <option value="paused">Paused</option>
        </select>
        <select className="field" aria-label="Last run result" value={filters.result} onChange={(e) => setFilters({ ...filters, result: e.target.value as Filters["result"] })}>
          {results.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        {agentIds.length > 1 && (
          <span className="autos-agents" role="group" aria-label="Agents">
            {agentIds.map((id) => (
              <button key={id} className="btn" aria-pressed={filters.agents.includes(id)} onClick={() => setFilters({ ...filters, agents: filters.agents.includes(id) ? filters.agents.filter((x) => x !== id) : [...filters.agents, id] })}>
                {names.agent(id)}
              </button>
            ))}
          </span>
        )}
        <span className="autos-gap" />
        <button className="ib" title="Refresh" onClick={() => void load()}>
          <Refresh />
        </button>
        <button className="btn" title="Every automation's runs in one place" onClick={() => setRunsView(true)}>
          Runs
        </button>
        <button className="btn primary" disabled={projects.length === 0} title={projects.length === 0 ? "Add a project first" : undefined} onClick={() => open(null)}>
          <Plus size={12} />
          New Automation
        </button>
      </div>
      {q === null && <div className="note warn">That search is too long; shorten it.</div>}
      {note && (
        <div className="note ok" role="status">
          {note}
        </div>
      )}
      {asking && (
        <Ask
          key={asking}
          title={`Delete ${all.find((a) => a.id === asking)?.name ?? "this automation"}?`}
          body="Its run history goes with it."
          confirm="Delete"
          dontAsk
          onConfirm={(dontAsk) => confirmRemove(asking, dontAsk)}
          onCancel={() => setAsking(null)}
        />
      )}
      {error !== null ? (
        <div className="empty" role="alert">
          <h2>Automations could not be loaded</h2>
          <p>{error}</p>
          <button className="btn" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : data === null ? (
        <div className="empty">
          <p>Loading…</p>
        </div>
      ) : all.length === 0 ? (
        <div className="empty">
          <h2>No automations yet</h2>
          <p>An automation starts an agent with a saved prompt on a timetable or when something happens in a project. Start from one of these, or from blank:</p>
          <TemplateCards onPick={open} disabled={projects.length === 0} />
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <h2>Nothing matches</h2>
          <p>No automation fits this search and these filters.</p>
          {filtered && (
            <button
              className="btn"
              onClick={() => {
                setQuery("");
                setFilters(noFilters);
              }}
            >
              Clear search and filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="autos-table-wrap">
            <table className="autos-table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} aria-sort={sort.key === c.key ? (sort.desc ? "descending" : "ascending") : "none"}>
                      <button onClick={() => sortBy(c.key)}>
                        {c.label}
                        {sort.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                      </button>
                    </th>
                  ))}
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const last = lastRun(a.id, runs);
                  return (
                    <tr key={a.id} data-id={a.id} tabIndex={current?.id === a.id ? 0 : -1} aria-selected={current?.id === a.id} onClick={() => setSelected(a.id)} onDoubleClick={() => setOpened(a.id)}>
                      <td>
                        <span className={`dot${a.enabled ? " live" : ""}`} title={a.enabled ? "On" : "Paused"} />
                        {a.name}
                      </td>
                      <td>{triggerLabel(a)}</td>
                      <td>{names.agent(a.provider)}</td>
                      <td>{names.project(a.projectId)}</td>
                      <td>{last ? `${statusWord(last)} · ${ago(last.lastAt ?? last.at, now)}` : "Never"}</td>
                      <td>{upcoming(a, now)}</td>
                      <td className="autos-act">
                        <button
                          className="ib"
                          title="Quick actions"
                          aria-haspopup="menu"
                          onClick={(e) => {
                            e.stopPropagation(); // opening the menu does not select the row
                            setMenu(menu === a.id ? null : a.id);
                          }}
                        >
                          <Dots />
                        </button>
                        {menu === a.id && (
                          <div className="menu autos-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                            <button className="menu-item" role="menuitem" disabled={!!a.problem} title={a.problem ? `Run now is blocked: ${a.problem}` : undefined} onClick={() => runNow(a)}>
                              <span className="name">Run now</span>
                            </button>
                            <button className="menu-item" role="menuitem" onClick={() => toggle(a)}>
                              <span className="name">{a.enabled ? "Pause" : "Resume"}</span>
                            </button>
                            <button className="menu-item" role="menuitem" onClick={() => edit(a)}>
                              <span className="name">Edit</span>
                            </button>
                            <button className="menu-item" role="menuitem" onClick={() => remove(a)}>
                              <span className="name">Delete</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {current && <Detail key={current.id} a={current} runs={runs} runsError={data?.runsError} now={now} usage={usage} agent={names.agent(current.provider)} tab={tab} onTab={setTab} onRun={() => runNow(current)} onToggle={() => toggle(current)} live={liveRun} onView={onViewRun} onResume={onResume} onRetry={() => void load()} />}
        </>
      )}
      {dialog !== undefined && <AutomationDialog projects={projects} agents={agents} editing={dialog} template={template} onClose={() => setDialog(undefined)} onSaved={saved} />}
    </div>
  );
}

type DetailProps = { a: Automation; runs: Run[]; runsError?: string; now: number; usage: Usage | null; agent: string; tab: "overview" | "runs"; onTab: (t: "overview" | "runs") => void; onRun: () => void; onToggle: () => void; live?: (r: Run) => boolean; onView?: (r: Run) => void; onResume?: (r: Run) => void; onRetry: () => void };
function Detail({ a, runs, runsError, now, usage, agent, tab, onTab, onRun, onToggle, live, onView, onResume, onRetry }: DetailProps) {
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
        <label className="autos-switch">
          <input type="checkbox" role="switch" checked={a.enabled} onChange={onToggle} /> {a.enabled ? "On" : "Paused"}
        </label>
        <button className="btn" disabled={!!a.problem} title={a.problem ? `Run now is blocked: ${a.problem}` : undefined} onClick={onRun}>
          Run now
        </button>
      </div>
      {a.problem && (
        <div className="note warn" role="status">
          This automation cannot run: {a.problem}. Run now is blocked and timed runs are logged as skipped until it is fixed.
        </div>
      )}
      <div className="autos-tabs" role="tablist" aria-label="Automation views">
        {(["overview", "runs"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className="btn" onClick={() => onTab(t)}>
            {t === "overview" ? "Overview" : "Runs"}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label="Overview" hidden={tab !== "overview"}>
        <dl className="autos-facts">
          <dt>Timetable or trigger</dt>
          <dd>{triggerLabel(a)}</dd>
          <dt>Upcoming</dt>
          <dd>{upcoming(a, now)}</dd>
          <dt>Worktree</dt>
          <dd>{a.workspaceMode === "new-per-run" ? "A new one for every run" : a.workspace ? folderName(a.workspace) : "Not chosen"}</dd>
          <dt>If Kolux was away</dt>
          <dd>{graceWord(a.missedRunGraceMinutes)}</dd>
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
      </div>
      <div role="tabpanel" aria-label="Runs" hidden={tab !== "runs"}>
      {runsError ? (
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
                  {what === "view" ? "View run" : what === "resume" ? "Resume workspace" : what === "snapshot" ? "Saved output" : pending === r.id ? "Rerun pending" : "Rerun"}
                </button>
              ))}
              {r.worktreeGone && shown === r.id && (
                <div className="autos-snapshot">
                  <p className="note">A snapshot: the worktree {r.worktreeName ?? ""} is gone, so this is what was saved when the run ended, not a live terminal.</p>
                  {r.output ? <pre className="auto-output">{r.output}</pre> : <p className="muted">No terminal output was saved for this run.</p>}
                </div>
              )}
              {r.output && !r.worktreeGone && r.outputFrom === undefined && <pre className="auto-output">{r.output}</pre>}
            </li>
          ))}
        </ol>
      )}
      </div>
    </section>
  );
}
