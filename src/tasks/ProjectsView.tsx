// T-314-c: GitHub Projects inside Tasks (GIT-056): pick a project (pinned, recent, browsing an owner,
// or a pasted URL / owner and number), open one of its views, and read and edit it as a table whose
// columns sort and group. Board views are marked unsupported in the picker and in the view alike;
// roadmap views are drawn as a timeline (T-549; GIT-057, one rule for both: viewSupport).
// T-314-d: the assignee and issue-type cells are the issue's own fields (edited on the issue, not through
// the project), and a row of a repository that is not open in Kolux offers to add it (the clone dialog).
import { invoke } from "@tauri-apps/api/core";
import { Fragment, useEffect, useRef, useState } from "react";
import AddRepo from "./AddRepo";
import { Refresh } from "../chrome/icons";
import type { Project as KoluxProject } from "../projects/model";
import Timeline from "./RoadmapTimeline";
import { chosenDefault, applyAssignees, applyCellEdit, assigneeChange, cellEditable, cloneAddress, cellKey, cellText, endSave, isSaving, newBook, readBackFresh, readBackLost, readBackStart, sendEdit, settleEdit, type Saving, startSave, GROUPABLE, groupItems, labelChange, openingView, parseProjectRef, type Project, projectHostRefused, type ProjectField, type ProjectItem, projectKey, type ProjectRef, pushRecent, refsFrom, type Scope, scopeItems, sortItems, togglePin, viewLabel, viewSupport, viewUrl } from "./projects";

type Settings = Record<string, unknown> | null;
type Save = (patch: Record<string, unknown>) => Promise<unknown> | void;

/** The open project and table state survive leaving the page and coming back (app session). */
const kept: { ref: ProjectRef | null; sort: { field: string; dir: 1 | -1 } | null; group: string; scope: Scope } = { ref: null, sort: null, group: "", scope: { mode: "all" } };

/** The GitHub repositories (owner/name, lower case) of the projects open in Kolux. */
async function koluxRepos(): Promise<string[]> {
  const list = await invoke<KoluxProject[]>("project_list");
  const repos = await Promise.all(list.map((p) => invoke<{ owner: string; name: string } | null>("scm_github_repo", { worktree: p.path }).catch(() => null)));
  return repos.flatMap((r) => (r ? [`${r.owner}/${r.name}`.toLowerCase()] : []));
}

function CellEditor({ item, field, host, start, onDone }: { item: ProjectItem; field: ProjectField; host: string; start?: string; onDone: (value: string | null) => void }) {
  const now = field.kind === "single_select" || field.kind === "iteration" ? (item.values[field.id]?.id ?? "") : field.kind === "assignees" ? item.assignees.join(", ") : field.kind === "issue_type" ? item.issueType : cellText(item, field);
  const [text, setText] = useState(start ?? now);
  // T-314-d: what the repository offers for this cell (its issue types; the people who can be assigned).
  const [offered, setOffered] = useState<string[]>([]);
  useEffect(() => {
    if (field.kind !== "issue_type" && field.kind !== "assignees") return;
    let live = true;
    const ask = field.kind === "issue_type" ? invoke<string[]>("github_issue_types", { host, repo: item.repo }) : invoke<{ login: string }[]>("github_people", { host, repo: item.repo }).then((p) => p.map((x) => x.login));
    ask.then((o) => live && setOffered(o), () => {});
    return () => {
      live = false;
    };
  }, [field.kind, host, item.repo]);
  if (field.kind === "issue_type") {
    return (
      <select className="field" autoFocus value={text} aria-label={field.name} onChange={(e) => onDone(e.target.value)} onBlur={() => onDone(null)} onKeyDown={(e) => e.key === "Escape" && onDone(null)}>
        <option value="">No issue type</option>
        {[...new Set([...(item.issueType ? [item.issueType] : []), ...offered])].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === "single_select" || field.kind === "iteration") {
    return (
      <select className="field" autoFocus value={text} aria-label={field.name} onChange={(e) => onDone(e.target.value)} onBlur={() => onDone(null)} onKeyDown={(e) => e.key === "Escape" && onDone(null)}>
        <option value="">No {field.name.toLowerCase()}</option>
        {field.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.start ? ` (${o.start})` : ""}
          </option>
        ))}
      </select>
    );
  }
  const type = field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text";
  const commit = () => onDone(text === now ? null : text);
  return (
    <>
      <input
        className="field"
        autoFocus
        type={type}
        value={text}
        aria-label={field.name}
        placeholder={field.kind === "labels" ? "bug, docs" : field.kind === "assignees" ? "ana, bo" : undefined}
        list={field.kind === "assignees" ? "projects-people" : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") onDone(null);
        }}
      />
      {field.kind === "assignees" && (
        <datalist id="projects-people">
          {offered.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      )}
    </>
  );
}

export default function ProjectsView({ host, owner, settings, save }: { host: string; owner: string; settings: Settings; save: Save }) {
  const pinned = refsFrom(settings?.tasksProjectsPinned);
  const recent = refsFrom(settings?.tasksProjectsRecent);
  const lastViews = (settings?.tasksProjectsLastView ?? {}) as Record<string, unknown>;
  const timelines = (settings?.tasksProjectsTimeline ?? {}) as Record<string, unknown>;
  const [ref, setRef] = useState<ProjectRef | null>(kept.ref);
  const [project, setProject] = useState<Project | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What the error banner's Retry sends again: the project read, the owner's list, or nothing (a pasted address that cannot be opened).
  const [retryOp, setRetryOp] = useState<"load" | "browse" | null>(null);
  const [typed, setTyped] = useState("");
  const [browseOwner, setBrowseOwner] = useState(owner);
  const [browsed, setBrowsed] = useState<{ projects: { owner: string; number: number; title: string; closed: boolean }[]; more: boolean } | null>(null);
  const [sort, setSort] = useState(kept.sort);
  const [group, setGroup] = useState(kept.group);
  const [scope, setScope] = useState<Scope>(kept.scope);
  const [inKolux, setInKolux] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ item: string; field: string } | null>(null);
  // T-314-d: the repository (owner/name) whose "add to Kolux" copy dialog is open.
  const [adding, setAdding] = useState<string | null>(null);
  const [cellError, setCellError] = useState<string | null>(null);
  // C15-R4-01: the typed value of a write GitHub rejected, by cell, so the editor reopens on it with
  // the reason on the cell instead of the draft dying with the editor that sent it.
  const [rejected, setRejected] = useState<{ item: string; field: string; value: string; why: string } | null>(null);
  // FIX-1 (council FS 1): the cells whose edit is still on its way to GitHub (a call can take 30 s).
  // FIX-2 (council AFTER 3): one entry per edit, so a second edit of the same cell keeps its mark.
  const [saving, setSaving] = useState<Saving[]>([]);
  const editIds = useRef({ next: 1, book: newBook() });
  Object.assign(kept, { ref, sort, group, scope });

  useEffect(() => setBrowseOwner(owner), [owner]);
  useEffect(() => {
    let live = true;
    koluxRepos()
      .then((r) => live && setInKolux(r))
      .catch(() => live && setInKolux([]));
    return () => {
      live = false;
    };
  }, []);

  const load = (r: ProjectRef | null = ref, wantView: number | null = null) => {
    setProject(null);
    setError(null);
    setRetryOp(null);
    setEditing(null);
    setRejected(null);
    if (!r) return () => {};
    let live = true;
    invoke<Project>("github_project", { host: r.host, owner: r.owner, number: r.number })
      .then((p) => {
        if (!live) return;
        setProject(p);
        const remembered = lastViews[projectKey(r)];
        setView(openingView(p, wantView ?? (typeof remembered === "number" ? remembered : null)));
        const named = { ...r, title: p.title };
        void save({ tasksProjectsRecent: pushRecent(recent, named) });
      })
      .catch((e) => live && (setError(String(e)), setRetryOp("load")));
    return () => {
      live = false;
    };
  };
  useEffect(() => load(), [ref ? projectKey(ref) : ""]);

  const open = (text: string) => {
    setRetryOp(null);
    const away = projectHostRefused(text, host);
    if (away) return setError(`Kolux opens projects on github.com or on this workspace's host (${host}), not on ${away}.`);
    const p = parseProjectRef(text, host);
    if (!p) return setError("Paste a project address (…/orgs/<owner>/projects/<number>) or an owner and a number, such as acme 3.");
    const r = { host: p.host, owner: p.owner, number: p.number, title: "" };
    if (ref && projectKey(ref) === projectKey(r)) load(r, p.view);
    else {
      if (p.view !== null) void save({ tasksProjectsLastView: { ...lastViews, [projectKey(r)]: p.view } });
      setRef(r);
    }
  };
  const pickView = (n: number) => {
    setView(n);
    if (ref) void save({ tasksProjectsLastView: { ...lastViews, [projectKey(ref)]: n } });
  };
  const browse = () => {
    setBrowsed(null);
    setError(null);
    setRetryOp(null);
    invoke<{ projects: { owner: string; number: number; title: string; closed: boolean }[]; more: boolean }>("github_projects", { host, owner: browseOwner.trim() || "@me" })
      .then(setBrowsed)
      .catch((e) => (setError(String(e)), setRetryOp("browse")));
  };

  const edit = (item: ProjectItem, field: ProjectField, value: string | null) => {
    setEditing(null);
    if (value === null || !project || !ref) return;
    setCellError(null);
    const put = (patch: Partial<ProjectItem>) => setProject((p) => p && { ...p, items: p.items.map((x) => (x.id === item.id ? { ...x, ...patch } : x)) });
    const cell = cellKey(item.id, field.id);
    const id = editIds.current.next++;
    const begin = () => {
      sendEdit(editIds.current.book, cell, id);
      setSaving((s) => startSave(s, id, cell));
      setRejected(null);
    };
    const end = () => setSaving((s) => endSave(s, id));
    // FIX-4 (review AFTER 6): after a burst of edits to one cell GitHub may not have applied them in
    // the order sent, so the project is read back and shown as GitHub holds it.
    const readBack = () => {
      const book = editIds.current.book;
      // FIX-5: not while another edit is out, and not shown if one was sent since (it would put
      // GitHub's older value of that cell back over the newer edit).
      // FIX-6: a read held back or dropped stays due; the settle of the last edit out (or, when none
      // is out, a read sent again at once) delivers it, so the correction is never lost.
      const token = readBackStart(book);
      if (token === null) return;
      invoke<Project>("github_project", { host: ref.host, owner: ref.owner, number: ref.number })
        .then((p) => {
          if (readBackFresh(book, token)) setProject((cur) => (cur && cur.id === p.id ? p : cur));
          else if (readBackLost(book)) readBack();
        })
        .catch(() => {});
    };
    const settle = (ok: boolean, apply: () => void) => {
      if (settleEdit(editIds.current.book, cell, id, ok, apply)) readBack();
    };
    // C15-R4-01: a rejected write reopens the cell's editor on the typed value with the reason on the
    // cell, so nothing typed is lost and the retry is in reach.
    const reject = (e: unknown) => {
      setRejected({ item: item.id, field: field.id, value, why: String(e) });
      setEditing({ item: item.id, field: field.id });
      settle(false, () => {});
    };
    if (field.kind === "labels") {
      const { add, remove } = labelChange(item.labels, value);
      if (add.length + remove.length === 0) return;
      begin();
      invoke<{ name: string }[]>("scm_task_labels", { host: ref.host, repo: item.repo, number: item.number, add, remove })
        .then((l) => settle(true, () => put({ labels: l.map((x) => x.name) })))
        .catch(reject)
        .finally(end);
      return;
    }
    if (field.kind === "assignees") {
      const change = assigneeChange(item.assignees, value);
      if (change.bad.length > 0) return setCellError(`${item.title}: ${change.bad.join(", ")} ${change.bad.length === 1 ? "is not a GitHub login" : "are not GitHub logins"}`);
      if (change.add.length + change.remove.length === 0) return;
      begin();
      invoke("pr_assignees", { host: ref.host, repo: item.repo, number: item.number, add: change.add, remove: change.remove })
        .then(() => settle(true, () => put({ assignees: applyAssignees(item.assignees, change) })))
        .catch(reject)
        .finally(end);
      return;
    }
    if (field.kind === "issue_type") {
      if (value === item.issueType) return;
      begin();
      invoke<string>("github_issue_type_set", { host: ref.host, repo: item.repo, number: item.number, name: value })
        .then((now) => settle(true, () => put({ issueType: now })))
        .catch(reject)
        .finally(end);
      return;
    }
    begin();
    invoke("github_project_set", { host: ref.host, project: project.id, item: item.id, field: field.id, kind: field.kind, value })
      .then(() => settle(true, () => setProject((p) => p && applyCellEdit(p, item.id, field, value))))
      .catch(reject)
      .finally(end);
  };

  const current = project?.views.find((v) => v.number === view) ?? null;
  const columns = project ? [...project.fields.filter((f) => f.kind === "title"), ...project.fields.filter((f) => f.kind !== "title")] : [];
  const sortField = columns.find((f) => f.id === sort?.field);
  const groupField = columns.find((f) => f.id === group && GROUPABLE.has(f.kind));
  const rows = project ? scopeItems(sortField && sort ? sortItems(project.items, sortField, sort.dir) : project.items, scope, inKolux) : [];
  const repos = project ? [...new Set(project.items.map((i) => i.repo).filter(Boolean))].sort() : [];
  const isPinned = !!ref && pinned.some((p) => projectKey(p) === projectKey(ref));
  const link = project ? viewUrl(project, view) : null;
  const tableView = project?.views.find((v) => viewSupport(v.layout) === "table");

  const row = (it: ProjectItem) => (
    <tr key={it.id} data-item={it.id} className={it.kind === "restricted" ? "restricted" : undefined}>
      {columns.map((f) => {
        const isEditing = editing?.item === it.id && editing.field === f.id;
        const can = cellEditable(it, f);
        if (f.kind === "title") {
          return (
            <td key={f.id} className="projects-title">
              {it.kind === "restricted" ? (
                <em title="You do not have access to this item">Restricted item</em>
              ) : (
                <>
                  <span className={`dot ${it.kind === "pr" ? "pr" : "issue"} ${it.state}`} />
                  {it.url ? (
                    <a href={it.url} target="_blank" rel="noreferrer">
                      {it.title}
                    </a>
                  ) : (
                    it.title
                  )}
                  {it.number !== null && <span className="tasks-kind"> #{it.number}</span>}
                  {it.repo && scope.mode === "all" && inKolux.length > 0 && !inKolux.includes(it.repo.toLowerCase()) && (
                    <span className="projects-away" title="This repository is not open in Kolux">
                      not in Kolux
                      {ref && cloneAddress(ref.host, it.repo) && (
                        <button className="btn" data-add-repo={it.repo} title={`Copy ${it.repo} from GitHub and add it to Kolux`} onClick={() => setAdding(it.repo)}>
                          Add
                        </button>
                      )}
                    </span>
                  )}
                </>
              )}
            </td>
          );
        }
        return (
          <td key={f.id} data-kind={f.kind} className={can ? "editable" : undefined} tabIndex={can ? 0 : undefined} onClick={() => can && setEditing({ item: it.id, field: f.id })} onKeyDown={(e) => can && e.key === "Enter" && e.target === e.currentTarget && setEditing({ item: it.id, field: f.id })}>
            {isEditing ? <CellEditor item={it} field={f} host={ref?.host ?? host} start={rejected?.item === it.id && rejected.field === f.id ? rejected.value : undefined} onDone={(v) => edit(it, f, v)} /> : cellText(it, f)}
            {isSaving(saving, cellKey(it.id, f.id)) &&<span className="tasks-kind" data-saving title="Saving to GitHub">{" "}saving…</span>}
            {rejected?.item === it.id && rejected.field === f.id && (
              <span className="tasks-kind" role="status" data-cell-error>
                {" "}Not saved: {rejected.why}
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );

  return (
    <div className="projects" data-projects>
      {adding && ref && cloneAddress(ref.host, adding) && (
        <AddRepo
          url={cloneAddress(ref.host, adding)!}
          onClose={() => setAdding(null)}
          onAdded={() => {
            setAdding(null);
            koluxRepos().then(setInKolux, () => {});
          }}
        />
      )}
      <div className="projects-pick">
        <form
          className="autos-search"
          onSubmit={(e) => {
            e.preventDefault();
            open(typed);
          }}
        >
          <input className="field" placeholder="Paste a project URL, or owner and number (acme 3)" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Project address" />
          <button className="btn">Open</button>
        </form>
        <form
          className="projects-browse"
          onSubmit={(e) => {
            e.preventDefault();
            browse();
          }}
        >
          <input className="field" value={browseOwner} placeholder="@me" onChange={(e) => setBrowseOwner(e.target.value)} aria-label="Browse projects of" />
          <button className="btn">Browse</button>
        </form>
        {[...pinned.map((p) => ({ p, pin: true })), ...recent.filter((r) => !pinned.some((p) => projectKey(p) === projectKey(r))).map((p) => ({ p, pin: false }))].map(({ p, pin }) => (
          <button key={projectKey(p)} className="btn projects-chip" data-pinned={pin || undefined} aria-current={ref && projectKey(ref) === projectKey(p) ? "true" : undefined} title={`${p.owner} project ${p.number} on ${p.host}`} onClick={() => setRef(p)}>
            {pin ? "★ " : ""}
            {p.title || `${p.owner} #${p.number}`}
          </button>
        ))}
      </div>
      {browsed && (
        <ul className="projects-browsed" data-browsed>
          {browsed.projects.length === 0 && <li className="autos-none">No projects.</li>}
          {browsed.projects.map((b) => (
            <li key={`${b.owner}/${b.number}`}>
              <button
                className="btn"
                onClick={() => {
                  setBrowsed(null);
                  setRef({ host, owner: b.owner, number: b.number, title: b.title });
                }}
              >
                {b.title || `#${b.number}`} <span className="tasks-kind">{b.owner} #{b.number}{b.closed ? " · closed" : ""}</span>
              </button>
            </li>
          ))}
          {browsed.more && <li className="tasks-count" data-browse-more>Showing the 30 most recently changed projects; paste a project's address to open one that is not listed.</li>}
        </ul>
      )}
      {error && (
        <div className="note warn" role="alert">
          {error}
          {retryOp && (
            <>
              {" "}
              <button className="btn" onClick={() => (retryOp === "load" ? void load() : browse())}>
                Retry
              </button>
            </>
          )}
        </div>
      )}
      {cellError && (
        <div className="note warn" role="status" data-cell-error>
          {cellError}
        </div>
      )}
      {!ref ? (
        <div className="autos-none tasks-none">Open a GitHub project to see it as a table: paste its address, browse an owner's projects, or pick a recent one.</div>
      ) : !project ? (
        !error && <div className="autos-none tasks-none">Loading…</div>
      ) : (
        <>
          <div className="projects-bar">
            <strong>{project.title}</strong>
            <select className="field" aria-label="View" value={view ?? ""} onChange={(e) => pickView(Number(e.target.value))}>
              {project.views.map((v) => (
                <option key={v.number} value={v.number}>
                  {viewLabel(v)}
                </option>
              ))}
            </select>
            {current && viewSupport(current.layout) !== "unsupported" && (
              <>
                {viewSupport(current.layout) === "table" && <select className="field" aria-label="Group by" value={groupField?.id ?? ""} onChange={(e) => setGroup(e.target.value)}>
                  <option value="">No grouping</option>
                  {columns
                    .filter((f) => GROUPABLE.has(f.kind))
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        Group by {f.name}
                      </option>
                    ))}
                </select>}
                <select
                  className="field"
                  aria-label="Repositories"
                  value={scope.mode}
                  onChange={(e) => setScope(e.target.value === "chosen" ? { mode: "chosen", repos: chosenDefault(repos, inKolux) } : { mode: e.target.value as "all" | "kolux" })}
                >
                  <option value="all">All repositories</option>
                  <option value="kolux">Repositories open in Kolux</option>
                  <option value="chosen">Chosen repositories</option>
                </select>
              </>
            )}
            <span className="autos-gap" />
            <button className="btn" aria-pressed={isPinned} onClick={() => ref && void save({ tasksProjectsPinned: togglePin(pinned, { ...ref, title: project.title }) })}>
              {isPinned ? "Unpin" : "Pin"}
            </button>
            {link && (
              <a className="btn" href={link} target="_blank" rel="noreferrer">
                Open on GitHub
              </a>
            )}
            <button className="ib" title="Refresh" onClick={() => load()}>
              <Refresh />
            </button>
          </div>
          {scope.mode === "chosen" && (
            <div className="tasks-filters" data-chosen>
              {repos.map((r) => (
                <label key={r} className="tasks-filter">
                  <input
                    type="checkbox"
                    checked={scope.repos.includes(r)}
                    onChange={(e) => setScope({ mode: "chosen", repos: e.target.checked ? [...scope.repos, r] : scope.repos.filter((x) => x !== r) })}
                  />
                  <span>{r}</span>
                </label>
              ))}
            </div>
          )}
          {current && viewSupport(current.layout) === "timeline" ? (
            <Timeline fields={project.fields} items={rows} saved={ref ? timelines[projectKey(ref)] : undefined} onPick={(pick) => ref && void save({ tasksProjectsTimeline: { ...timelines, [projectKey(ref)]: pick } })} />
          ) : current && viewSupport(current.layout) !== "table" ? (
            <div className="note" role="status" data-unsupported>
              {current.name} is a {current.layout} view, which Kolux does not show yet. {tableView ? "Switch to a table view to see and edit this project's items." : "This project has no table view; add one on GitHub to see it here."}
              {tableView && (
                <button className="btn" onClick={() => pickView(tableView.number)}>
                  Switch to {tableView.name}
                </button>
              )}
            </div>
          ) : (
            <div className="projects-table">
              <table>
                <thead>
                  <tr>
                    {columns.map((f) => (
                      <th key={f.id} aria-sort={sort?.field === f.id ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                        <button className="projects-sort" onClick={() => setSort(sort?.field === f.id ? (sort.dir === 1 ? { field: f.id, dir: -1 } : null) : { field: f.id, dir: 1 })}>
                          {f.name}
                          {sort?.field === f.id ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupField
                    ? groupItems(rows, groupField).map((g) => (
                        <Fragment key={g.key || "none"}>
                          <tr className="projects-group">
                            <th colSpan={columns.length}>
                              {g.label} <span className="tasks-kind">{g.items.length}</span>
                            </th>
                          </tr>
                          {g.items.map(row)}
                        </Fragment>
                      ))
                    : rows.map(row)}
                </tbody>
              </table>
              {rows.length === 0 && <div className="autos-none tasks-none">No items{scope.mode !== "all" ? " in these repositories" : ""}.</div>}
            </div>
          )}
          {/* FIX-1 (council FS 3): the cut-off shows under the table and the timeline alike. */}
          {project.more && <div className="tasks-count tasks-window" data-more>This project has more items than Kolux reads (the first 500 are shown).</div>}
        </>
      )}
    </div>
  );
}
