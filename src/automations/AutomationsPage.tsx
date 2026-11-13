// The Automations page (AUTO-016, AUTO-019): a table of every automation with sorting, filters
// and search, a quick-actions menu on each row (Run now, pause / resume, Edit, Delete), and the
// selected automation's prompt and numbered runs below. The page reloads itself whenever the
// back end says an automation or a run changed, so a run's status moves without a refresh.
// New Automation and Edit open the dialog of AUTO-005; Runs opens the dashboard of AUTO-015.
// AUTO-017: Up and Down move the selection, Enter opens the automation as its own page, Left and
// Right switch Overview and Runs, Escape steps back to the list and then closes the page.
// AUTO-018: the Overview tab, with a long prompt folded behind an expand control.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Ask from "../chrome/Ask";
import { Close, Dots, Plus, Refresh, Search } from "../chrome/icons";
import { ADD_PROJECT } from "../onboarding/firstRun";
import type { AgentInfo } from "../launch/PlusMenu";
import type { Project } from "../projects/model";
import AutomationDialog, { TemplateCards } from "./AutomationDialog";
import type { Template } from "./timetable";
import RunsDashboard, { Breadcrumb, RunPage } from "./RunsDashboard";
import { Detail } from "./AutomationDetail";
import { PROVIDERS, type Usage } from "../usage/tokens";
import { agentChoices, ago, CONFIRM_DELETE_KEY, confirmDelete, deleteWords, failedLoad, holdWhile, joinNotes, runsKey, rowActions, splitWarnings, whereItRuns, keepSelection, lastRun, pageKey, matches, noFilters, normalizeQuery, passes, sortRows, statusWord, triggerLabel, upcoming, type Automation, type Filters, type Names, type Run, type SortKey } from "./model";
import { Select } from "../ui/Select";
import { Menu, MenuItem } from "../ui/Menu";

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
  initial?: { data?: Data; error?: string; runs?: boolean; open?: string; usage?: Usage; menu?: string; asking?: string; note?: { text: string; bad?: boolean }; running?: string[]; refreshing?: boolean };
  /** AUTO-013: whether a run's own terminal is still open, and how View run and Resume workspace get there. */
  liveRun?: (r: Run) => boolean;
  onViewRun?: (r: Run) => void;
  onResume?: (r: Run) => void;
};

/** The tools are asked once when the page first opens in this run; after that only Refresh asks again. */
let askedTools = false;

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
  const [menu, setMenu] = useState<string | null>(initial?.menu ?? null);
  const [asking, setAsking] = useState<string | null>(initial?.asking ?? null); // the automation whose delete waits for a yes
  // What the last action said; a failure (`bad`) reads as a warning, and shows in the opened page too.
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(initial?.note ? { text: initial.note.text, bad: !!initial.note.bad } : null);
  const say = (text: string) => setNote({ text, bad: false });
  const fail = (text: string) => setNote({ text, bad: true });
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
  // The automations whose Run now is still being asked for, so a second click cannot start the same job twice.
  const [running, setRunning] = useState<string[]>(initial?.running ?? []);
  const [refreshing, setRefreshing] = useState(initial?.refreshing ?? false);
  const dataRef = useRef<Data | null>(null);
  dataRef.current = data;
  // The dots button of the row whose menu is open: the menu hangs from it.
  const menuFrom = useRef<HTMLButtonElement | null>(null);

  // T-193-b: Refresh asks Hermes and OpenClaw again (their answers are kept until the next Refresh), then reads the list.
  // A failed ask is said in a note; the rows already shown stay.
  const refresh = () => {
    setRefreshing(true);
    return invoke("automations_external_refresh")
      .then(
        () => null,
        (e) => `Hermes and OpenClaw could not be asked again: ${String(e)}`,
      )
      .then((bad) => load().then((listed) => {
        const both = joinNotes(bad, listed);
        if (both) fail(both); // a failed list read does not hide the failed ask, or the other way round
      }))
      .finally(() => setRefreshing(false));
  };
  // A failed read keeps the rows already shown and says so; only a page with nothing yet shows the error.
  const load = () =>
    invoke<Data>("automations_list")
      .then((d) => {
        setData(d);
        setError(null);
        return null;
      })
      .catch((e) => {
        const f = failedLoad(dataRef.current !== null, String(e));
        setError(f.error);
        if (f.note) fail(f.note);
        return f.note;
      });
  useEffect(() => {
    if (initial) return;
    void load();
    if (!askedTools) {
      askedTools = true; // the first time the page opens in this run; later opens use the kept answers
      void refresh();
    }
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
  const { rows: all, warnings } = splitWarnings(data?.automations ?? []);
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
  const toAutomations = () => {
    setOpenRun(null);
    setRunsView(false);
    setNote(null);
  };
  keyRef.current = (e) => {
    const t = e.target as HTMLElement;
    if (t !== document.body && !root.current?.contains(t)) return;
    if (runsView) {
      // Escape steps back one level: a run page to Runs, Runs to Automations (never over a dialog or menu).
      const covered = t.closest('[role="dialog"],[role="menu"],[role="alertdialog"]') !== null || document.querySelector('[aria-modal="true"]') !== null;
      const what = runsKey({ key: e.key, mods: e.altKey || e.ctrlKey || e.metaKey || e.shiftKey, field: t.closest("input,textarea,select,[contenteditable]") !== null, overlay: covered, run: openRun !== null });
      if (!what) return;
      e.preventDefault();
      if (what === "run") setOpenRun(null);
      else toAutomations();
      return;
    }
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
  const agentIds = agentChoices(all);

  const act = (p: Promise<unknown>) => p.then(() => load()).catch((e) => fail(String(e)));
  // T-193-b: a Hermes or OpenClaw job is run, paused and deleted in its own tool, then the tools are asked again.
  // `refresh` reads the list itself, so this path does not (audit N-32: one read, not two).
  const external = (a: Automation, action: "run" | "pause" | "resume" | "delete") =>
    invoke("automation_external_act", { tool: a.source, action, id: a.jobId, input: null }).then(() => refresh()).catch((e) => fail(String(e)));
  const runNow = (a: Automation) => {
    setMenu(null);
    if (running.includes(a.id)) return; // the first ask is still on its way
    say(`Run now: ${a.name} is queued`);
    void holdWhile(setRunning, a.id, () => (a.source ? external(a, "run") : act(invoke("automation_run_now", { id: a.id }))));
  };
  // C25-R2-01: ends a run whose agent stopped working without its process ending. Its terminal is
  // the user's, so the pane keeps working; only the run stops holding its automation.
  const cancelRun = (r: Run) => act(invoke("automation_run_cancel", { id: r.id }));
  const toggle = (a: Automation) => {
    setMenu(null);
    void (a.source ? external(a, a.enabled ? "pause" : "resume") : act(invoke("automation_set_enabled", { id: a.id, enabled: !a.enabled })));
  };
  const remove = (a: Automation) => {
    setMenu(null);
    if (confirmDelete(settings)) setAsking(a.id);
    else void (a.source ? external(a, "delete") : act(invoke("automation_delete", { id: a.id })));
  };
  // VIEW-116: the don't-ask-again tick counts only when the delete is confirmed.
  const confirmRemove = (id: string, dontAsk: boolean) => {
    setAsking(null);
    if (dontAsk) onSettings({ ...settings, [CONFIRM_DELETE_KEY]: false });
    const a = all.find((x) => x.id === id);
    void (a?.source ? external(a, "delete") : act(invoke("automation_delete", { id })));
  };
  // AUTO-005: Edit fetches the latest saved copy before the dialog appears.
  const edit = (a: Automation) => {
    setMenu(null);
    invoke<Data>("automations_list")
      .then((d) => {
        setData(d);
        const latest = d.automations.find((x) => x.id === a.id);
        if (latest) setDialog(latest);
        else fail(`${a.name} was deleted elsewhere`);
      })
      .catch((e) => fail(String(e)));
  };
  const saved = (a: Automation) => {
    setSelected(a.id);
    say(`Saved ${a.name}`);
    void load();
  };
  const noteEl = note && (
    <div className={`note ${note.bad ? "warn" : "ok"}`} role={note.bad ? "alert" : "status"}>
      {note.text}
    </div>
  );
  const askedAuto = asking === null ? undefined : all.find((a) => a.id === asking);
  const askEl = asking && (
    <Ask key={asking} title={deleteWords(askedAuto).title} body={deleteWords(askedAuto).body} confirm="Delete" dontAsk onConfirm={(dontAsk) => confirmRemove(asking, dontAsk)} onCancel={() => setAsking(null)} />
  );
  // A failed refresh keeps the rows already shown and says so, rather than emptying the dashboard.
  const refreshRuns = () =>
    invoke<Data>("automations_list")
      .then((d) => {
        setData(d);
        setNote(null);
      })
      .catch((e) => fail(`Refresh failed: ${String(e)}`));
  if (runsView) {
    const shown = runs.find((r) => r.id === openRun);
    return (
      <div className="autos" ref={root}>
        {noteEl}
        <RunsDashboard runs={runs} automations={all} now={now} error={data?.runsError} onRefresh={() => void refreshRuns()} onAutomations={toAutomations} onOpen={(r) => setOpenRun(r.id)} hidden={shown !== undefined} />
        {shown && <RunPage run={shown} automation={all.find((a) => a.id === shown.automationId)} now={now} usage={usage} agentName={names.agent(shown.provider ?? "")} onRuns={() => setOpenRun(null)} onAutomations={toAutomations} />}
      </div>
    );
  }
  const addProject = () => window.dispatchEvent(new CustomEvent(ADD_PROJECT)); // opens the sidebar's Add Project dialog
  const sortBy = (key: SortKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }));
  const filtered = filters.state !== "all" || filters.result !== "all" || filters.agents.length > 0 || (q ?? "") !== "";

  if (openedA) {
    return (
      <div className="autos" ref={root}>
        <div className="autos-bar">
          <Breadcrumb onAutomations={() => setOpened(null)} last={openedA.name} />
        </div>
        {noteEl}
        {askEl}
        <Detail key={openedA.id} a={openedA} running={running.includes(openedA.id)} onEdit={() => edit(openedA)} onDelete={() => remove(openedA)} runs={runs} runsError={data?.runsError} now={now} usage={usage} agent={names.agent(openedA.provider)} tab={tab} onTab={setTab} onRun={() => runNow(openedA)} onToggle={() => toggle(openedA)} live={liveRun} onView={onViewRun} onResume={onResume} onCancel={cancelRun} onRetry={() => void load()} />
        {dialog !== undefined && <AutomationDialog projects={projects} agents={agents} editing={dialog} template={template} onClose={() => setDialog(undefined)} onSaved={saved} />}
      </div>
    );
  }

  return (
    <div className="autos" ref={root}>
      <div className="autos-bar">
        {onClose && (
          <button className="ib" title="Close (Esc)" aria-label="Close Automations" onClick={onClose}>
            <Close size={14} />
          </button>
        )}
        <h2>Automations</h2>
        <label className="autos-search">
          <Search />
          <input ref={search} className="field" placeholder="Search name, project, agent, prompt" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search automations" />
        </label>
        <Select label="On or paused" value={filters.state} onChange={(v) => setFilters({ ...filters, state: v as Filters["state"] })} options={[{ value: "all", label: "On and paused" }, { value: "on", label: "On" }, { value: "paused", label: "Paused" }]} className="field" />
        <Select label="Last run result" value={filters.result} onChange={(v) => setFilters({ ...filters, result: v as Filters["result"] })} options={results.map((r) => ({ value: r.value, label: r.label }))} className="field" />
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
        <button className="ib" title={refreshing ? "Refreshing…" : "Refresh"} aria-label="Refresh" aria-busy={refreshing} disabled={refreshing} onClick={() => void refresh()}>
          <Refresh />
        </button>
        <button className="btn" title="Every automation's runs in one place" onClick={() => setRunsView(true)}>
          Runs
        </button>
        {projects.length === 0 && (
          <button className="btn" onClick={addProject}>
            Add a project
          </button>
        )}
        <button className="btn primary" disabled={projects.length === 0} title={projects.length === 0 ? "Add a project first" : undefined} onClick={() => open(null)}>
          <Plus size={12} />
          New Automation
        </button>
      </div>
      {q === null && <div className="note warn">That search is too long; shorten it.</div>}
      {warnings.map((w) => (
        <div key={w} className="note warn" role="status">
          {w.replace(/[.!?…]+$/, "")}. Its automations show here once that is fixed (install the tool, sign it in, or check its setup); then{" "}
          <button className="btn link" aria-label="Refresh automations" disabled={refreshing} onClick={() => void refresh()}>
            refresh
          </button>
          .
        </div>
      ))}
      {noteEl}
      {askEl}
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
          {projects.length === 0 && (
            <p>
              Automations run inside a project, and none is added yet.{" "}
              <button className="btn primary" onClick={addProject}>
                Add a project
              </button>
            </p>
          )}
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
                        {a.source && <span className="chip">{whereItRuns(a)}</span>}
                      </td>
                      <td>{triggerLabel(a)}</td>
                      <td>{a.source ? (a.source === "hermes" ? "Hermes" : "OpenClaw") : names.agent(a.provider)}</td>
                      <td>{a.source ? "-" : names.project(a.projectId)}</td>
                      <td>{a.source ? (a.lastRunAt ? `${a.lastStatus ?? "Ran"} · ${ago(a.lastRunAt, now)}` : "Never") : last ? `${statusWord(last)} · ${ago(last.lastAt ?? last.at, now)}` : "Never"}</td>
                      <td>{upcoming(a, now)}</td>
                      <td className="autos-act">
                        <button
                          className="ib"
                          title="Quick actions"
                          aria-haspopup="menu"
                          aria-expanded={menu === a.id}
                          onClick={(e) => {
                            e.stopPropagation(); // opening the menu does not select the row
                            menuFrom.current = e.currentTarget;
                            setMenu(menu === a.id ? null : a.id);
                          }}
                        >
                          <Dots />
                        </button>
                        {menu === a.id && (
                          // A src/ui Menu hanging from the dots: Escape shuts it first, wherever focus is. A click in it
                          // crosses the portal up the React tree, so it stops here and never selects the row.
                          <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                            <Menu open onClose={() => setMenu(null)} label={`Actions for ${a.name}`} anchor={menuFrom} align="end" offset={2} className="autos-menu">
                              {rowActions(a).map((what) =>
                                what === "run" ? (
                                  <MenuItem key={what} disabled={!!a.problem || running.includes(a.id)} title={a.problem ? `Run now is blocked: ${a.problem}` : running.includes(a.id) ? "Run now is already being started" : undefined} onClick={() => runNow(a)}>
                                    <span className="name">Run now</span>
                                  </MenuItem>
                                ) : what === "toggle" ? (
                                  <MenuItem key={what} onClick={() => toggle(a)}>
                                    <span className="name">{a.enabled ? "Pause" : "Resume"}</span>
                                  </MenuItem>
                                ) : what === "edit" ? (
                                  <MenuItem key={what} onClick={() => edit(a)}>
                                    <span className="name">Edit</span>
                                  </MenuItem>
                                ) : (
                                  <MenuItem key={what} onClick={() => remove(a)}>
                                    <span className="name">Delete</span>
                                  </MenuItem>
                                ),
                              )}
                            </Menu>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {current && <Detail key={current.id} a={current} running={running.includes(current.id)} onEdit={() => edit(current)} onDelete={() => remove(current)} runs={runs} runsError={data?.runsError} now={now} usage={usage} agent={names.agent(current.provider)} tab={tab} onTab={setTab} onRun={() => runNow(current)} onToggle={() => toggle(current)} live={liveRun} onView={onViewRun} onResume={onResume} onCancel={cancelRun} onRetry={() => void load()} />}
        </>
      )}
      {dialog !== undefined && <AutomationDialog projects={projects} agents={agents} editing={dialog} template={template} onClose={() => setDialog(undefined)} onSaved={saved} />}
    </div>
  );
}
