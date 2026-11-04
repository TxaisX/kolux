// VIEW-080 / VIEW-083 / VIEW-085 (T-168, T-169): the Agents tab of the right sidebar, the past
// sessions of every agent in this scope. The list refreshes when the tab is shown or the window is
// refocused (from cache), when the Refresh button is pressed (a full rescan) and a moment after an
// agent starts; results are drawn only once typing has paused. Resume opens a terminal in the
// session's folder; Copy command copies the same command for the shell the tab runs.
import { askCarry } from "../agentstart/host";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./sessions.css";
import { asListing, NO_REPORT, notices, type Listing, type ScanReport } from "./notices";
import { sameShown } from "./redraw";
import { ago, filterSessions, groupSessions, MAX_QUERY, parseQuery, shortLabel, sortSessions, type GroupBy, type Project, type Session, type SortBy } from "./model";
import { chooseScope, DEFAULT_VIEW, DEPTHS, differing, effectiveScope, readScope, readView, SCOPE_KEY, VIEW_KEY, type Scope, type ViewPrefs } from "./prefs";
import { AFTER_START_MS, publishDelay, recall, remember, RescanLimiter } from "./refresh";
import { dragPayload, planFor, resumeBlock, SESSION_DRAG, type ResumePlan } from "./resume";
import { chatResumeBlock } from "./chatResume";
import { InFlight } from "./inflight";
import SessionDetail from "./SessionDetail";
import SessionFiles from "./SessionFiles";

export type PanelProps = {
  /** The window's settings and the way to save one (the view options and the scope live there, so every window sees them). */
  settings: Record<string, unknown>;
  onSave: (key: string, value: unknown) => void;
  /** The workspace in front, and every workspace folder of its project (worktrees and the root). */
  activeDir: string | null;
  projectDirs: string[];
  /** Every project (its root folder), so "repo:" and grouping by project know what a repo is. */
  projects?: Project[];
  /** Changes whenever an agent starts in Kolux; the list rescans a moment later, at most every few seconds. */
  rescanKey: number;
  visible: boolean;
  /** The program of the shell the new tab runs, so the copied command is written for it. */
  shell: string | null;
  onResume: (s: Session, plan: ResumePlan) => void;
  /** VIEW-086 (T-146-d): resume in a new tab and bring the Agents (chat) screen to the front; the button shows only when this is given. */
  onResumeChat?: (s: Session, plan: ResumePlan) => void;
  /** VIEW-084: every workspace folder open in Kolux, and the way to go to one (the row's worktree line). */
  openDirs?: string[];
  onJump?: (dir: string) => void;
};

/** What the back end is asked for under the saved scope and depth. */
export function request(settings: Record<string, unknown>, activeDir: string | null, projectDirs: string[]): { dirs: string[]; all: boolean; depth: number | null; scope: Scope } {
  const scope = effectiveScope(readScope(settings[SCOPE_KEY]), { workspace: activeDir !== null, project: projectDirs.length > 0 });
  const dirs = scope === "workspace" ? (activeDir === null ? [] : [activeDir]) : scope === "project" ? projectDirs : [];
  return { dirs, all: scope === "all", depth: readView(settings[VIEW_KEY]).depth, scope };
}

const NO_PROJECTS: Project[] = [];
const SORT_LABELS: [SortBy, string][] = [["recent", "Newest first"], ["oldest", "Oldest first"], ["title", "By title"]];
const GROUP_LABELS: [GroupBy, string][] = [["none", "No grouping"], ["folder", "By folder"], ["agent", "By agent"], ["project", "By project"]];
const SCOPE_LABELS: [Scope, string][] = [["workspace", "This workspace"], ["project", "This project"], ["all", "All sessions"]];

const scopeKey = (p: { dirs: string[]; all: boolean; depth: number | null }) => JSON.stringify([p.all, p.all ? [] : p.dirs, p.depth]);

/** The time of the last key pressed anywhere in the window (terminal typing included). */
function useLastKey() {
  const at = useRef(0);
  useEffect(() => {
    const on = () => void (at.current = Date.now());
    document.addEventListener("keydown", on, true);
    return () => document.removeEventListener("keydown", on, true);
  }, []);
  return at;
}

/** The last answer for a scope, from memory. */
const cached = (key: string): Listing | null => {
  const c = recall<unknown>(key);
  return c === undefined ? null : asListing(c);
};

/**
 * VIEW-115: the panel redraws only when what it shows changes (its two settings, the folders, the
 * shell, the visible flag, the rescan key). The callbacks the window passes are new on every render,
 * so the memoised view reads the latest ones through stable wrappers instead of comparing them.
 */
function AgentsPanel(props: PanelProps) {
  const latest = useRef(props);
  latest.current = props;
  const onSave = useCallback((key: string, value: unknown) => latest.current.onSave(key, value), []);
  const onResume = useCallback((s: Session, plan: ResumePlan) => latest.current.onResume(s, plan), []);
  const onResumeChat = useCallback((s: Session, plan: ResumePlan) => latest.current.onResumeChat?.(s, plan), []);
  return <AgentsView {...props} onSave={onSave} onResume={onResume} onResumeChat={props.onResumeChat ? onResumeChat : undefined} />;
}

const AgentsView = memo(AgentsPanelBody, (a, b) => sameShown(a, b));
/** T-746: how many past sessions are drawn before Show more. */
const ROWS = 200;

export default AgentsPanel;

function AgentsPanelBody(props: PanelProps) {
  const { settings, onSave, activeDir, projectDirs, rescanKey, visible, shell, onResume, onResumeChat } = props;
  const projects = props.projects ?? NO_PROJECTS;
  const { dirs, all, depth, scope } = request(settings, activeDir, projectDirs);
  const view = readView(settings[VIEW_KEY]);
  const scopePref = readScope(settings[SCOPE_KEY]);
  const [query, setQuery] = useState("");
  // T-746: rows are drawn ROWS at a time, so Unlimited (VIEW-082) does not draw thousands at once.
  const [rows, setRows] = useState(ROWS);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const key = scopeKey({ dirs, all, depth });
  // A new search, scope or view starts from the first ROWS again.
  useEffect(() => setRows(ROWS), [key, query, settings[VIEW_KEY]]);
  const [list, setList] = useState<Session[] | null>(() => cached(key)?.sessions ?? null);
  const [report, setReport] = useState<ScanReport>(() => cached(key)?.report ?? NO_REPORT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const lastKey = useLastKey();
  const live = useRef({ key, dirs, all, depth });
  live.current = { key, dirs, all, depth };
  const timer = useRef<number | null>(null);
  const limiter = useRef(new RescanLimiter());

  const load = useCallback(
    (force: boolean) => {
      const asked = live.current;
      // Refresh shows "Scanning…" for a rescan the person asked for, not for the quiet reads on every window focus.
      if (force) setBusy(true);
      invoke<unknown>("sessions_list", { dirs: asked.dirs, all: asked.all, depth: asked.depth, force })
        .then((raw) => {
          const got = asListing(raw);
          const arrived = Date.now();
          const publish = () => {
            timer.current = null;
            remember(asked.key, got);
            if (live.current.key === asked.key) {
              setList(got.sessions);
              setReport(got.report);
              setError(null);
            }
            setBusy(false);
          };
          if (timer.current !== null) window.clearTimeout(timer.current);
          // VIEW-083: results wait for a pause in typing, at most one second.
          timer.current = window.setTimeout(publish, publishDelay(Date.now(), lastKey.current, arrived));
        })
        .catch((err) => {
          setError(String(err));
          setBusy(false);
        });
    },
    [lastKey],
  );

  useEffect(() => () => void (timer.current !== null && window.clearTimeout(timer.current)), []);
  // Showing the tab, or another scope, reads from cache; the last results for that scope show at once.
  useEffect(() => {
    setList(cached(key)?.sessions ?? null);
    setReport(cached(key)?.report ?? NO_REPORT);
    if (visible) load(false);
  }, [key, visible, load]);
  useEffect(() => {
    if (!visible) return;
    const on = () => load(false);
    window.addEventListener("focus", on);
    return () => window.removeEventListener("focus", on);
  }, [visible, load]);
  // An agent started: its session file appears a moment later; at most one rescan per interval.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!visible || !limiter.current.allow(Date.now())) return;
    const t = window.setTimeout(() => load(false), AFTER_START_MS);
    return () => window.clearTimeout(t);
  }, [rescanKey]);

  // A double click on Resume opens one terminal, not two.
  const inflight = useRef(new InFlight());
  const resumeWith = (s: Session, kind: string, go: (plan: ResumePlan) => void) => {
    const id = `${kind}:${s.agent}:${s.id}`;
    if (!inflight.current.start(id)) return;
    setNote(null);
    planFor(s, activeDir, shell)
      .then(go, (err) => setNote(String(err)))
      .finally(() => inflight.current.done(id));
  };
  const resume = (s: Session) => resumeWith(s, "term", (plan) => onResume(s, plan));
  const resumeChat = (s: Session) => resumeWith(s, "chat", (plan) => onResumeChat?.(s, plan));
  const copy = (s: Session) => {
    setNote(null);
    planFor(s, activeDir, shell).then(
      (plan) => navigator.clipboard.writeText(plan.copy).then(() => setNote("Resume command copied."), () => setNote(`Copy it from here: ${plan.copy}`)),
      (err) => setNote(String(err)),
    );
  };
  const now = Date.now();
  const parsed = useMemo(() => parseQuery(query), [query]);
  const shown = useMemo(() => sortSessions(filterSessions(list ?? [], { query, hiddenAgents: view.hiddenAgents, hideEmpty: view.hideEmpty }, projects), view.sort), [list, query, settings[VIEW_KEY], projects]);
  const groups = useMemo(() => groupSessions(shown, view.group, projects), [shown, view.group, projects]);
  let room = rows;
  const drawn = groups.map((g) => {
    const d = g.sessions.slice(0, Math.max(0, room));
    room -= d.length;
    return d;
  });
  const agentsSeen = [...new Set([...(list ?? []).map((s) => s.agent), ...view.hiddenAgents])].sort();
  const changed = differing(view);
  const total = list?.length ?? 0;
  const setView = (patch: Partial<ViewPrefs>) => onSave(VIEW_KEY, { ...view, ...patch });
  const count = list === null ? (error === null ? "Looking for past sessions…" : "") : shown.length === total ? `${total} past session${total === 1 ? "" : "s"}` : `${shown.length} of ${total} past sessions`;

  return (
    <div className="agents-panel">
      <div className="agents-bar">
        <span className="agents-count">{count}</span>
        <button type="button" className="btn" title="Rescan every session folder" disabled={busy} onClick={() => load(true)}>
          {busy ? "Scanning…" : "Refresh"}
        </button>
      </div>
      <div className="agents-tools">
        <input
          type="search"
          className="agents-search"
          placeholder="Search: words, &quot;a phrase&quot;, repo:name, path:folder"
          aria-label="Search past sessions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="agents-select" aria-label="Which sessions to list" value={scopePref.scope} onChange={(e) => onSave(SCOPE_KEY, chooseScope(e.target.value as Scope))}>
          {SCOPE_LABELS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button type="button" className="btn" aria-expanded={optionsOpen} title="Sort, group, hide agents, how many to list" onClick={() => setOptionsOpen(!optionsOpen)}>
          {changed > 0 ? `Options (${changed})` : "Options"}
        </button>
      </div>
      {scope !== scopePref.scope && <div className="sb-hint">{scopePref.scope === "workspace" ? "No workspace is open, so every session is listed." : "This folder is in no project, so every session is listed."}</div>}
      {parsed.tooLong && (
        <div className="sb-hint warn" role="status">
          That search is longer than {MAX_QUERY} characters, so nothing matches. Shorten it.
        </div>
      )}
      {optionsOpen && (
        <div className="agents-options" aria-label="View options">
          <label>
            Order
            <select className="agents-select" value={view.sort} onChange={(e) => setView({ sort: e.target.value as SortBy })}>
              {SORT_LABELS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Group
            <select className="agents-select" value={view.group} onChange={(e) => setView({ group: e.target.value as GroupBy })}>
              {GROUP_LABELS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            List at most
            <select className="agents-select" value={view.depth === null ? "all" : String(view.depth)} onChange={(e) => setView({ depth: e.target.value === "all" ? null : Number(e.target.value) })}>
              {DEPTHS.map((d) => (
                <option key={d === null ? "all" : d} value={d === null ? "all" : String(d)}>
                  {d === null ? "Unlimited" : `${d} per agent`}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={view.hideEmpty} onChange={(e) => setView({ hideEmpty: e.target.checked })} />
            Hide empty sessions
          </label>
          {agentsSeen.map((a) => (
            <label key={a}>
              <input type="checkbox" checked={!view.hiddenAgents.includes(a)} onChange={(e) => setView({ hiddenAgents: e.target.checked ? view.hiddenAgents.filter((h) => h !== a) : [...view.hiddenAgents, a] })} />
              Show {a}
            </label>
          ))}
          <div className="btn-row">
            <button type="button" className="btn" disabled={changed === 0} title="Back to the defaults for every option above" onClick={() => onSave(VIEW_KEY, DEFAULT_VIEW)}>
              Reset
            </button>
          </div>
        </div>
      )}
      {error !== null && (
        <div className="sb-hint warn" role="alert">
          Past sessions could not be read: {error}
        </div>
      )}
      {note !== null && (
        <div className="sb-hint" role="status">
          {note}
        </div>
      )}
      {list !== null &&
        notices(report, total).map((n) => (
          <div key={n.id} className="sb-hint" role="status" data-scan-notice>
            {n.text}
          </div>
        ))}
      {list !== null && total === 0 && error === null && <div className="sb-hint">No past sessions here yet. Sessions of Claude and Codex show up once they have run.</div>}
      {list !== null && total > 0 && shown.length === 0 && !parsed.tooLong && <div className="sb-hint">No session matches the search and options.</div>}
      <ul className="agents-list">
        {groups.map((g, i) => drawn[i].length > 0 && [
          view.group !== "none" && (
            <li key={`g:${g.key}`} className="agents-group" role="presentation" title={g.key}>
              {g.label === "" ? shortLabel(null) : g.label} ({g.sessions.length})
            </li>
          ),
          ...drawn[i].map((s) => {
          const block = resumeBlock(s);
          const chatBlock = onResumeChat ? (block ?? chatResumeBlock(s, activeDir)) : null;
          // Why a disabled button is disabled, in view and not only in its tooltip.
          const why = block ?? chatBlock;
          return (
            <li key={`${s.agent}:${s.id}`} className="agents-row" draggable onDragStart={(e) => e.dataTransfer.setData(SESSION_DRAG, dragPayload(s))}>
              <div className="agents-title" title={s.title}>
                {s.title === "" ? "Untitled session" : s.title}
              </div>
              <div className="agents-meta">
                {s.agent} · {ago(s.modifiedMs, now)} · {s.turns} message{s.turns === 1 ? "" : "s"}
              </div>
              <SessionDetail session={s} activeDir={activeDir} openDirs={props.openDirs ?? projectDirs} onJump={props.onJump} />
              <div className="agents-actions">
                <button type="button" className="btn" disabled={block !== null} title={block ?? "Open a terminal and continue this session"} onClick={() => resume(s)}>
                  Resume
                </button>
                {onResumeChat && (
                  <button type="button" className="btn" disabled={chatBlock !== null} title={chatBlock ?? "Continue this session in the Agents chat"} onClick={() => resumeChat(s)}>
                    Resume as chat
                  </button>
                )}
                <button type="button" className="btn" title="Copy the command that resumes this session" onClick={() => copy(s)}>
                  Copy command
                </button>
                <button type="button" className="btn" title="Start a new session in the agent you pick, carrying this conversation" onClick={() => askCarry({ agent: s.agent, id: s.id, title: s.title })}>
                  Continue with…
                </button>
                <SessionFiles session={s} onNote={setNote} onDeleted={() => { setList((l) => l && l.filter((x) => x.agent !== s.agent || x.id !== s.id)); load(false); }} />
              </div>
              {why !== null && <div className="sb-hint agents-why">{block === null ? `Resume as chat is off: ${why}` : why}</div>}
            </li>
          );
          }),
        ])}
      </ul>
      {shown.length > rows && (
        <button type="button" className="btn" onClick={() => setRows(rows + ROWS)}>
          Show more ({shown.length - rows} not shown)
        </button>
      )}
    </div>
  );
}
