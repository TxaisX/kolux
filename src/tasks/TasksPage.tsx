// VIEW-010 / GIT-043: the Tasks page, opened from the sidebar's Tasks row or the view.tasks
// shortcut: a preset or a typed GitHub search over the workspace's repository, 25 to a page.
// T-314: the default preset is a setting (GIT-044), PR filter pickers rewrite the query (GIT-054),
// and a fork may take its issues from its parent (GIT-055); T-314-c adds the Projects tab (GIT-056).
// T-231-e: the repository picker (GIT-043) chooses several GitHub projects at once, remembered in
// the tasksRepos setting; a host that cannot be reached is named without blanking the others; an
// item offers start or resume of its workspace (GIT-049). Clicking an item opens its preview
// (GIT-050, TaskDialog).
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Refresh, Search } from "../chrome/icons";
import { SINGLE_FOLDER } from "../projects/singleFolder";
import GhBanner, { classify } from "./GhBanner";
import { emptyReason } from "./emptyState";
import { taskSource } from "./taskSource";
import { applyEdits, editAssign, editLabels, editState, type Edits, leavesFilter, settle, undoAssign, undoLabels, undoState } from "./edits";
import type { Worktree } from "../projects/model";
import { useSettings } from "../settings/useSettings";
import { beyondWindow, defaultPreset, FILTERS, type FilterKey, filterValue, issueSource, listState, pageButtons, pageCount, PER_PAGE, PRESETS, showPager, setFilter, type Task, type TaskDetail, type TaskLabel, type TaskPage, taskKind, taskQueries } from "./model";
import NewIssueDialog from "./NewIssueDialog";
import { closesDialog, createdHere } from "./newIssue";
import { type GhRepo, loadRepoFacts, type ParentRead, type Person, resetFacts } from "./repoFacts";
import { byHost, chosenRows, hostWarnings, mergePages, newIssueTargets, type PickerProject, type PickerRow, pickerLabel, pickerRows, REPOS_SETTING, type RemoteRead, repoAdded, repoWarnings, rowKey, savedChoice, toggled } from "./repoPicker";
import ProjectsView from "./ProjectsView";
import PullRequestPage from "./PullRequestPage";
import { itemOfTarget, pasteLine, pastedWork, rowForNumber } from "./pasteWork";
import { parseGitHubUrl, type Target } from "./prModel";
import TaskDialog from "./TaskDialog";
import { startFromItem } from "../agentstart/host";
import { existingWorkspace, linkKey, linkedRows, workItem, type WorkItem, workLabel } from "./workStart";
import "./tasks.css";

/** GIT-043: preset, query, page and scroll survive leaving the page and coming back (app session);
 * GIT-044: the first visit of the session opens on the saved default preset. */
const kept: { preset: string | null; query: string; page: number; scroll: number; tab: "items" | "projects" } = { preset: null, query: "", page: 1, scroll: 0, tab: "items" };

/** GIT-054: one filter picker; typing or picking a suggestion sets its part of the query on Enter or
 * on leaving the field, and the cross clears only that part. */
function FilterPicker({ k, label, query, options, onSet }: { k: FilterKey; label: string; query: string; options: string[]; onSet: (k: FilterKey, v: string) => void }) {
  const now = filterValue(query, k);
  const [text, setText] = useState(now);
  useEffect(() => setText(now), [now]);
  const commit = () => text.trim() !== now && onSet(k, text);
  return (
    <label className={`tasks-filter${now ? " set" : ""}`} data-filter={k}>
      <span>{label}</span>
      {k === "state" ? (
        <select className="field" value={now} onChange={(e) => onSet(k, e.target.value)} aria-label={label}>
          <option value="">Any</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="merged">Merged</option>
        </select>
      ) : (
        <>
          <input className="field" list={`tasks-${k}-list`} value={text} placeholder="Anyone" aria-label={label} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
          <datalist id={`tasks-${k}-list`}>
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </>
      )}
      {now && (
        <button type="button" className="ib" title={`Clear ${label.toLowerCase()}`} aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onSet(k, "")}>
          ×
        </button>
      )}
    </label>
  );
}

/** GIT-043: the repository picker: one row per GitHub project (checkouts folded), several choosable. */
function RepoPicker({ rows, chosen, onToggle }: { rows: PickerRow[]; chosen: PickerRow[]; onToggle: (key: string) => void }) {
  const on = new Set(chosen.map((r) => r.key));
  return (
    <details className="tasks-picker" data-repo-picker>
      <summary className="btn" title="Which repositories the list covers">
        {pickerLabel(chosen)}
      </summary>
      <ul className="tasks-picker-list">
        {rows.map((r) => (
          <li key={r.key} data-row={r.key}>
            <label title={r.projects.map((p) => p.path).join("\n")}>
              <input type="checkbox" checked={on.has(r.key)} disabled={r.checking} onChange={() => onToggle(r.key)} />
              <span>{r.label}</span>
              {r.checking && <span className="muted"> checking…</span>}
              {!r.checking && r.host.toLowerCase() !== "github.com" && <span className="muted"> {r.host}</span>}
              {r.projects.length > 1 && <span className="muted"> {r.projects.length} checkouts</span>}
            </label>
          </li>
        ))}
        {rows.length === 0 && <li className="muted">No project here has a GitHub remote.</li>}
      </ul>
    </details>
  );
}

export type TasksWork = { onStart?: (item: WorkItem) => void; onResume?: (dir: string) => void };

export default function TasksPage({ repo, onStart, onResume }: { repo: { dir: string; name: string } | null } & TasksWork) {
  const { settings, save } = useSettings();
  const [projects, setProjects] = useState<PickerProject[]>([]);
  const [reads, setReads] = useState<Record<string, RemoteRead>>({});
  const [active, setActive] = useState<string | null>(null);
  const [hostFail, setHostFail] = useState<{ host: string; error: string }[]>([]);
  const [linked, setLinked] = useState<Record<string, Worktree[]>>({});
  const [note, setNote] = useState<string | null>(null);
  const [pr, setPr] = useState<Target | null>(null);
  const [pasted, setPasted] = useState("");
  // GIT-059 (T-232-d): a pasted issue address, with its title once read, ready to start or resume work on.
  const [pastedItem, setPastedItem] = useState<{ target: Target; title: string | null } | null>(null);
  const seq = useRef(0);
  const [gh, setGh] = useState<GhRepo | null | undefined>(undefined);
  const [login, setLogin] = useState<string | null>(null);
  const [preset, setPreset] = useState<string | null>(kept.preset);
  const [{ parent, failed: parentFailed }, setParent] = useState<ParentRead>({ parent: undefined, failed: false });
  const [people, setPeople] = useState<Person[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [typed, setTyped] = useState(kept.query);
  const [query, setQuery] = useState(kept.query);
  const [page, setPage] = useState(kept.page);
  const [result, setResult] = useState<TaskPage | null>(null);
  // GIT-048: edits shown at once, laid over what the search returned (edits.ts).
  const [edits, setEdits] = useState<Edits>({});
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Task | null>(null);
  const [newIssue, setNewIssue] = useState(false);
  // FIX-4 (review AFTER 5): which opening of the New issue dialog is on screen, so a create that
  // comes back for an older opening never closes the dialog the user has opened since.
  const opening = useRef(0);
  // FIX-3: an issue created for another workspace than the one on screen (the user switched while
  // gh was slow) is reported here, never added to this list.
  const [elsewhere, setElsewhere] = useState<string | null>(null);
  const here = useRef<{ host: string; repos: string[] } | null>(null);
  // T-314-c: Issues and pull requests, or GitHub Projects (GIT-056).
  const [tab, setTab] = useState(kept.tab);
  const list = useRef<HTMLUListElement>(null);
  const restore = useRef(kept.scroll);
  Object.assign(kept, { preset, query, page, tab });

  useEffect(() => {
    if (preset === null && settings) setPreset(defaultPreset(settings));
  }, [settings]);

  // GIT-043: every project's GitHub remote, read once; the picker rows come from them.
  useEffect(() => {
    let live = true;
    invoke<PickerProject[]>("project_list")
      .then((list) => {
        if (!live) return;
        setProjects(list);
        setReads(Object.fromEntries(list.map((p) => [p.path, undefined])));
        for (const p of list) {
          invoke<GhRepo | null>("scm_github_repo", { worktree: p.path }).then(
            (g) => live && setReads((r) => ({ ...r, [p.path]: g })),
            () => live && setReads((r) => ({ ...r, [p.path]: null })),
          );
        }
      })
      .catch(() => live && setProjects([]));
    return () => {
      live = false;
    };
  }, []);
  // The repository the workspace on screen belongs to: what the choice falls back to.
  useEffect(() => {
    setActive(null);
    if (!repo) return;
    let live = true;
    invoke<GhRepo | null>("scm_github_repo", { worktree: repo.dir }).then(
      (g) => live && setActive(g ? rowKey(g) : null),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [repo?.dir]);
  const rows = pickerRows(projects, reads);
  const saved = savedChoice(settings?.[REPOS_SETTING]);
  const chosen = chosenRows(rows, saved, active);
  // The facts (parent, people, labels, new issue) follow the first chosen repository's checkout.
  const factsDir = chosen[0]?.projects[0]?.path ?? repo?.dir ?? null;

  useEffect(() => {
    const set = { gh: setGh, login: setLogin, parent: setParent, people: setPeople, labels: setLabels };
    resetFacts(set);
    setElsewhere(null);
    if (!factsDir) return;
    let live = true;
    void loadRepoFacts(invoke, factsDir, () => live, set);
    return () => {
      live = false;
    };
  }, [factsDir]);

  const own = gh ? `${gh.owner}/${gh.name}` : "";
  const sourceKey = gh ? `${gh.host}/${own}` : "";
  const source = issueSource(settings, sourceKey, own, parent, parentFailed);
  // No picker rows yet (projects still loading): the repository facts alone stand for the choice.
  const groups = byHost(chosen.length ? chosen : gh ? [{ key: rowKey(gh), host: gh.host, repo: own, checking: false, label: own, projects: [] }] : []);
  const groupsKey = JSON.stringify(groups);
  here.current = gh ? { host: gh.host, repos: [...new Set([own, source.repo, ...(groups[0]?.repos ?? [])])] } : null;
  const mine = opening.current;
  const wanted = preset === null ? null : listState(preset, query);
  const savedSources = (settings?.tasksIssueSource ?? {}) as Record<string, unknown>;
  const chosenSource = savedSources[sourceKey] === "upstream" ? "upstream" : "fork";
  const load = () => {
    if (!gh || preset === null || !settings || tab !== "items" || groups.length === 0) return;
    setError(null);
    const mineSeq = ++seq.current;
    // One search per host; a host that fails is named and the others still fill the list.
    Promise.all(
      groups.map((g) =>
        invoke<TaskPage>("scm_tasks_search", { host: g.host, queries: taskQueries(preset, query, g.repos, g.repos.map((r) => (r === own ? source.repo : r))), page }).then(
          (p) => ({ p, host: g.host }),
          (e) => ({ host: g.host, error: String(e) }),
        ),
      ),
    ).then((rs) => {
      if (mineSeq !== seq.current) return;
      const answered = rs.flatMap((r) => ("p" in r ? [r] : []));
      const failed = rs.flatMap((r) => ("p" in r ? [] : [r]));
      setHostFail(failed);
      if (answered.length === 0) return setError(failed[0]?.error ?? "Nothing answered.");
      // Each row remembers the host that answered with it (FIX-1): the dialog, the full page and
      // workspace start use it, never the first chosen repository's host.
      const merged = mergePages(answered.map((r) => r.p), answered.map((r) => r.host));
      setResult(merged);
      setEdits((e) => settle(e, merged.items, Date.now()));
    });
  };
  useEffect(load, [gh, preset, query, page, source.repo, settings === null, tab, groupsKey]);
  // GIT-049: the workspaces already made for the chosen repositories' checkouts, so an item that
  // has one offers resume instead of start.
  // An opened or pasted address adds its own repository when the picker has not chosen it (after-list 477).
  const asked = [pr, pastedItem?.target].filter((t): t is Target => !!t);
  const askedKey = asked.map((t) => linkKey(t.host, t.repo)).join(",");
  const loadLinked = () => {
    const all = linkedRows(chosen, rows, asked).flatMap((r) => r.projects.map((p) => ({ repo: linkKey(r.host, r.repo), id: p.id })));
    void Promise.all(all.map((x) => invoke<Worktree[]>("workspace_list", { projectId: x.id }).then((w) => [x.repo, w] as const, () => [x.repo, [] as Worktree[]] as const))).then((got) => {
      const next: Record<string, Worktree[]> = {};
      for (const [r, w] of got) next[r] = [...(next[r] ?? []), ...w];
      setLinked(next);
    });
  };
  useEffect(loadLinked, [groupsKey, result, askedKey, askedKey === "" ? "" : rows.length]);
  const resumeDir = (t: Task) => existingWorkspace(linked[linkKey(t.host ?? gh?.host ?? "", t.repo)] ?? [], t.number);
  /** The workspace already made for a pasted or opened address, for any repository Kolux has a project for. */
  const resumeTarget = (x: Target) => existingWorkspace(linked[linkKey(x.host, x.repo)] ?? [], x.number);
  const workOn = (dir: string | null, item: WorkItem | null, repo: string, number: number) => {
    if (dir) return onResume ? onResume(dir) : setNote(`Workspace already made for #${number}: ${dir}`);
    if (!item) return setNote(`${repo} is not a repository name Kolux can start from.`);
    if (onStart) return onStart(item);
    invoke<{ path: string }>("workspace_from_item", { item })
      .then((made) => {
        setNote(`Workspace made for #${number}: ${made.path}`);
        loadLinked();
      })
      .catch((e) => setNote(String(e)));
  };
  const work = (t: Task) => workOn(resumeDir(t), workItem(t, gh?.host ?? "github.com"), t.repo, t.number);
  const workTarget = (x: Target) => workOn(resumeTarget(x), itemOfTarget(x), x.repo, x.number);
  const workOfTarget = (x: Target) => ({ label: workLabel(resumeTarget(x), { kind: x.kind === "issue" ? "issue" : "pr" }), run: () => workTarget(x) });
  /** GIT-059: what a paste into the address box starts. A pull request address opens its page, an issue
   * address shows its strip, `#12` opens the one item on screen with that number. Returns false for ordinary text. */
  const takePaste = (text: string): boolean => {
    const got = pastedWork(text);
    if (!got) return false;
    setNote(null);
    setPasted("");
    if (got.kind === "refused") {
      setNote(got.reason);
    } else if (got.kind === "item" && got.target.kind === "pull") {
      setPastedItem(null);
      setPr(got.target);
    } else if (got.kind === "item") {
      setPastedItem({ target: got.target, title: null });
      void invoke<{ title: string }>("scm_task_detail", { host: got.target.host, repo: got.target.repo, number: got.target.number }).then(
        (d) => setPastedItem((c) => (c && c.target.number === got.target.number && c.target.repo === got.target.repo ? { ...c, title: d.title } : c)),
        (e) => setNote(String(e)),
      );
    } else {
      const hit = rowForNumber(result?.items ?? [], got.number);
      if (hit) {
        setPastedItem(null);
        setOpen(hit);
      } else setNote(`#${got.number} is not the only item with that number on screen. Paste its address instead.`);
    }
    return true;
  };
  useLayoutEffect(() => {
    if (result && list.current && restore.current) {
      list.current.scrollTop = restore.current;
      restore.current = 0;
    }
  }, [result]);

  const pages = result ? pageCount(result.deepest) : 1;
  const go = (n: number) => {
    kept.scroll = 0;
    setPage(n);
  };
  const setOne = (k: FilterKey, v: string) => {
    const next = setFilter(query, k, v);
    setTyped(next);
    setQuery(next);
    go(1);
  };
  const isDefault = preset === defaultPreset(settings);
  const whoOptions = ["@me", ...people.map((p) => p.login)];
  const tabs = (
    <div className="tasks-tabs" role="tablist">
      {([["items", "Issues & pull requests"], ["projects", "Projects"]] as const).map(([id, label]) => (
        <button key={id} role="tab" className="btn" aria-selected={tab === id} data-tab={id} onClick={() => setTab(id)}>
          {label}
        </button>
      ))}
    </div>
  );
  if (tab === "projects") {
    return (
      <div className="autos tasks" data-tasks>
        <div className="autos-bar">
          <h2>Tasks</h2>
          {tabs}
        </div>
        <ProjectsView host={gh?.host ?? "github.com"} owner={gh?.owner ?? "@me"} settings={settings} save={save} />
      </div>
    );
  }
  return (
    <div className="autos tasks" data-tasks>
      <div className="autos-bar">
        <h2>Tasks</h2>
        {tabs}
        <select
          className="field"
          aria-label="Preset"
          value={preset ?? ""}
          onChange={(e) => {
            setPreset(e.target.value);
            go(1);
          }}
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button className="btn tasks-default" aria-pressed={isDefault} disabled={isDefault || preset === null} title="Open Tasks on this preset next time" onClick={() => preset && void save({ tasksDefaultPreset: preset })}>
          {isDefault ? "Default view" : "Make default"}
        </button>
        <form
          className="autos-search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(typed.trim());
            go(1);
          }}
        >
          <Search />
          <input className="field" placeholder="GitHub search, such as is:pr label:bug" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Search issues and pull requests" />
        </form>
        <span className="autos-gap" />
        {gh && (parent || chosenSource === "upstream") && (
          <label className="tasks-source" title="Where this fork's issues come from">
            <span>Issues from</span>
            <select
              className="field"
              aria-label="Issues from"
              value={chosenSource}
              onChange={(e) => {
                const all = { ...savedSources };
                if (e.target.value === "upstream") all[sourceKey] = "upstream";
                else delete all[sourceKey];
                void save({ tasksIssueSource: all });
                go(1);
              }}
            >
              <option value="fork">this fork ({own})</option>
              <option value="upstream">{parent ? `upstream (${parent})` : "upstream"}</option>
            </select>
          </label>
        )}
        {source.split && (
          <span className="tasks-split" data-split title="Issues and pull requests come from different repositories">
            issues {source.repo} · pull requests {own}
          </span>
        )}
        {rows.length > 0 && <RepoPicker rows={rows} chosen={chosen} onToggle={(k) => void save({ [REPOS_SETTING]: toggled(chosen.map((r) => r.key), k) })} />}
        {gh && (
          <span className="tasks-repo" title="Where the list comes from">
            {groups.length > 1 ? groups.map((g) => g.host).join(", ") : gh.host} · {taskSource(settings, login).text} · {chosen.length > 1 ? pickerLabel(chosen) : `${gh.owner}/${gh.name}`}
          </span>
        )}
        <button className="btn" data-new-issue-open disabled={!gh} onClick={() => {
            opening.current += 1;
            setNewIssue(true);
          }}>
          New issue
        </button>
        <button
          className="ib"
          title="Refresh"
          disabled={!gh}
          onClick={() => {
            // GIT-048: a hard refresh takes GitHub's current state again.
            setEdits({});
            load();
          }}
        >
          <Refresh />
        </button>
      </div>
      <input
        className="field tasks-paste"
        aria-label="Paste a GitHub address"
        placeholder="Paste a pull request or issue address…"
        value={pasted}
        onPaste={(e) => {
          if (takePaste(e.clipboardData.getData("text"))) e.preventDefault();
        }}
        onChange={(e) => {
          const hit = parseGitHubUrl(e.target.value);
          if (hit && hit.kind === "pull") {
            setPasted("");
            setPr(hit);
          } else setPasted(e.target.value);
        }}
      />
      {pastedItem && (
        <div className="note" role="status" data-pasted-item>
          {pasteLine(pastedItem.target, pastedItem.title)}{" "}
          <button className="btn primary" onClick={() => workTarget(pastedItem.target)}>
            {workOfTarget(pastedItem.target).label}
          </button>{" "}
          <button className="btn" onClick={() => setPastedItem(null)}>
            Dismiss
          </button>
        </div>
      )}
      {gh && (
        <div className="tasks-filters" data-filters>
          {FILTERS.map((f) => (
            <FilterPicker key={f.key} k={f.key} label={f.label} query={query} options={f.key === "label" ? labels : whoOptions} onSet={setOne} />
          ))}
        </div>
      )}
      {elsewhere && (
        <div className="note warn" role="status" data-created-elsewhere>
          {elsewhere}{" "}
          <button className="task-x" aria-label="Dismiss this note" title="Dismiss" onClick={() => setElsewhere(null)}>
            ×
          </button>
        </div>
      )}
      {repoWarnings(result?.failed).map((w) => (
        <div key={w} className="note warn" role="status" data-repo-warning>
          {w}
        </div>
      ))}
      {hostWarnings(hostFail).map((w) => (
        <div key={w} className="note warn" role="status" data-host-warning>
          {w}
        </div>
      ))}
      {note && (
        <div className="note" role="status" data-work-note>
          {note}{" "}
          <button className="task-x" aria-label="Dismiss this note" title="Dismiss" onClick={() => setNote(null)}>
            ×
          </button>
        </div>
      )}
      {source.warning && (
        <div className="note warn" role="status" data-source-warning>
          {source.warning}
        </div>
      )}
      {!repo || gh === null ? (
        <div className="autos-none tasks-none">{emptyReason({ project: repo?.name ?? null, remote: false, loaded: false, count: 0, query, page })}</div>
      ) : error !== null ? (
        // GIT-028: GitHub out of reach (limit, outage, slow, signed out, no gh) gets a banner and, when it is the user to fix, the sign-in help.
        classify(error, login === null ? false : undefined) !== "other" ? (
          <GhBanner error={error} signedIn={login === null ? false : undefined} host={gh?.host} onRetry={load} />
        ) : (
          <div className="note warn" role="status">
            {error}
          </div>
        )
      ) : result === null || result.items.length === 0 ? (
        <div className="autos-none tasks-none">{emptyReason({ project: repo.name, remote: true, loaded: result !== null, count: result?.items.length ?? 0, query, page })}</div>
      ) : (
        <ul className="tasks-list" ref={list} onScroll={(e) => (kept.scroll = e.currentTarget.scrollTop)}>
          {applyEdits(result.items, edits).map((t) => (
            <li key={t.url} title={t.url} className={leavesFilter(t, wanted) ? "leaving" : undefined} data-task={`${t.kind}-${t.number}`} tabIndex={0} onClick={() => setOpen(t)} onKeyDown={(e) => e.key === "Enter" && setOpen(t)}>
              <span className={`dot ${t.kind} ${t.state}${t.draft ? " draft" : ""}`} title={t.draft ? "draft" : t.state} />
              <span className="tasks-title">{t.title}</span>
              {t.labels.map((l) => (
                <span key={l.name} className="tasks-label" style={l.color ? { borderColor: `#${l.color}` } : undefined}>
                  {l.color && <i style={{ background: `#${l.color}` }} />}
                  {l.name}
                </span>
              ))}
              {t.assignees.length > 0 && <span className="tasks-who">{t.assignees.map((a) => `@${a}`).join(", ")}</span>}
              {t.checks && <span className={`tasks-checks ${t.checks}`}>{t.checks}</span>}
              <span className="tasks-kind">{taskKind(t)}</span>
              <span className="tasks-when">{t.updated.slice(0, 10)}</span>
              {t.state === "open" && (
                <button
                  className="btn tasks-work"
                  data-work={`${t.kind}-${t.number}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    work(t);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {workLabel(resumeDir(t), t)}
                </button>
              )}
              {!SINGLE_FOLDER && t.state === "open" && workItem(t, gh?.host ?? "github.com") && (
                <button
                  className="btn tasks-work"
                  data-work-agent={`${t.kind}-${t.number}`}
                  title="Make a workspace for this and start an agent on it"
                  onClick={(e) => {
                    e.stopPropagation();
                    const item = workItem(t, gh?.host ?? "github.com");
                    if (item) void startFromItem({ item, title: t.title, existing: resumeDir(t) });
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  Start with an agent
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {result && showPager(result.items.length, page) && error === null && (
        <div className="tasks-foot">
          <span className="tasks-count">{result.total === 1 ? "1 result" : `${result.total.toLocaleString()} results`}</span>
          <span className="autos-gap" />
          {pageButtons(page, pages).map((n, i) =>
            n === null ? (
              <span key={`gap${i}`} className="tasks-gap">
                …
              </span>
            ) : (
              <button key={n} className="btn" aria-current={n === page ? "page" : undefined} onClick={() => go(n)}>
                {n}
              </button>
            ),
          )}
          {beyondWindow(result.deepest) && <span className="tasks-count tasks-window">Results past {pages * PER_PAGE} are beyond GitHub search and cannot be reached; narrow the search.</span>}
        </div>
      )}
      {newIssue && gh && (
        <NewIssueDialog
          key={opening.current}
          host={gh.host}
          targets={newIssueTargets(chosen.length ? chosen : [{ key: "", host: gh.host, repo: own, checking: false, label: own, projects: [] }], source.repo !== own ? source.repo : undefined)}
          saved={settings?.tasksIssueDraft}
          save={save}
          factsRepo={own}
          labels={labels}
          people={people.map((x) => x.login)}
          onClose={() => setNewIssue(false)}
          onCreated={(t: Task, host: string) => {
            // Close only the dialog that sent this create (an older opening's create is finished
            // with its own dialog), or any dialog when the issue belongs on this screen.
            const local = createdHere(here.current, host, t.repo);
            if (closesDialog(local, mine, opening.current)) setNewIssue(false);
            if (!local) {
              setElsewhere(`Issue #${t.number} was created in ${t.repo} on ${host} (${t.url}). This workspace is somewhere else now, so it is not added to this list.`);
              return;
            }
            const made = { ...t, host };
            setResult((r) => r && { ...r, items: [made, ...r.items.filter((x) => x.url !== t.url)] });
            setOpen(made);
          }}
        />
      )}
      {pr && <PullRequestPage key={`${pr.host}/${pr.repo}#${pr.number}`} target={pr} added={repoAdded(rows, pr.host, pr.repo)} onClose={() => setPr(null)} workspace={resumeTarget(pr)} work={workOfTarget(pr)} />}
      {open && gh && (
        <TaskDialog
          task={applyEdits([open], edits)[0]}
          edit={edits[open.url]}
          host={open.host ?? gh.host}
          onClose={() => setOpen(null)}
          work={open.state === "open" ? { label: workLabel(resumeDir(open), open), run: () => work(open) } : undefined}
          onPage={open.kind === "pr" ? () => { setPr({ host: open.host ?? gh.host, repo: open.repo, number: open.number, kind: "pull" }); setOpen(null); } : undefined}
          onLabels={(labels: TaskLabel[]) => {
            setResult((r) => r && { ...r, items: r.items.map((x) => (x.url === open.url ? { ...x, labels } : x)) });
            setEdits((e) => settle(e, [{ ...open, labels }], Date.now()));
          }}
          onEditLabels={(add: TaskLabel[], remove: string[]) => setEdits((e) => editLabels(e, open.url, add, remove, Date.now()))}
          onUndoLabels={(add: string[], remove: string[]) => setEdits((e) => undoLabels(e, open.url, add, remove))}
          onState={(d: TaskDetail) => {
            setResult((r) => r && { ...r, items: r.items.map((x) => (x.url === open.url ? { ...x, state: d.state, assignees: d.assignees } : x)) });
            setEdits((e) => settle(e, [{ url: open.url, state: d.state, assignees: d.assignees, labels: d.labels }], Date.now()));
          }}
          onAssign={(add: string[], remove: string[]) => setEdits((e) => editAssign(e, open.url, add, remove, Date.now()))}
          onUndoAssign={(add: string[], remove: string[]) => setEdits((e) => undoAssign(e, open.url, add, remove))}
          onShowState={(state: string) => setEdits((e) => editState(e, open.url, state, Date.now()))}
          onUndoState={() => setEdits((e) => undoState(e, open.url))}
        />
      )}
    </div>
  );
}
