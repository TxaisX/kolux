// GIT-051 (T-232-c): the full pull request page: Conversation, Checks and Files changed tabs.
// Everything is read and written through the pr_* commands (pull_requests.rs), one gh call each.
// Merging asks first on the page itself and is only sent after the confirm button, pinned to the head
// commit the page showed, and only for a repository added in Kolux.
// The tab last open on a pull request is remembered (localStorage, per pull request).
// T-232-d: viewed marks synced with GitHub (GIT-052), "Fix with AI" on a failed check, an editable
// description and labels, a fork's parent, Start/Resume workspace, and recent editors as reviewer picks.
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Close } from "../chrome/icons";
import { inTextField, overlayShowing } from "../chrome/fullPage";
import GhBanner, { classify } from "./GhBanner";
import Markdown from "./MarkdownView";
import { safeHref } from "./markdown";
import MentionField from "./MentionField";
import type { TaskLabel } from "./model";
import { askForReview, editReviewers, failedChecks, fixBlocker, fixText, headLabel, heldWords, isEditor, labelsToAdd, lineageNote, NO_REVIEWER_EDIT, type ReviewerEdit, settleReviewers, undoReviewers, withReviewers, MERGE_METHODS, mergeBox, type PrCheck, type PrFiles, type PrPageData, type PrTab, type PrThreads, type PrViewed, REACTION_EMOJI, REVIEW_LABEL, rerunTargets, reviewerSuggestions, saveTab, savedTab, summarizeChecks, type Target, viewedLine, viewedOf, withViewed } from "./prModel";
import { escapeStep, partialNote } from "./prPageState";
import type { Person } from "./repoFacts";

const NO_THREADS: PrThreads = { threads: [], truncated: false, limit: 0 };
const say = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "That did not work.");

/** `added`: the repository is added in Kolux (a project's checkout is here); without it the page reads but does not merge.
 * `workspace`: the folder of this pull request's workspace (Fix with AI sends there), else null; `work`: Start or Resume it. */
export default function PullRequestPage({ target, added, onClose, workspace = null, work }: { target: Target; added: boolean; onClose: () => void; workspace?: string | null; work?: { label: string; run: () => void } }) {
  const args = { host: target.host, repo: target.repo, number: target.number };
  const [page, setPage] = useState<PrPageData | null>(null);
  const [tab, setTab] = useState<PrTab>(() => savedTab(window.localStorage, target));
  const [checks, setChecks] = useState<PrCheck[]>([]);
  const [files, setFiles] = useState<PrFiles | null>(null);
  const [threads, setThreads] = useState<PrThreads>(NO_THREADS);
  const [people, setPeople] = useState<Person[]>([]);
  const [typed, setTyped] = useState("");
  const [assignee, setAssignee] = useState("");
  const [replying, setReplying] = useState<{ id: number; text: string } | null>(null);
  const [method, setMethod] = useState<"merge" | "squash" | "rebase">("squash");
  const [sure, setSure] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The checks or review threads that could not be read on the last load (the page still shows the rest).
  const [partial, setPartial] = useState<string | null>(null);
  // GIT-039: diffs the user asked for after they were held back (by file name), and the ones being read.
  const [loaded, setLoaded] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ReviewerEdit>(NO_REVIEWER_EDIT);
  // T-232-d: the viewed marks (null until read), the description draft (null = not editing), the repository's labels,
  // the fork's lineage, the recent editors of the changed files (null until asked), and the check being fixed.
  const [viewed, setViewed] = useState<PrViewed | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [offer, setOffer] = useState<TaskLabel[]>([]);
  const [lineage, setLineage] = useState<string | null>(null);
  const [editors, setEditors] = useState<string[] | null>(null);
  const [fixing, setFixing] = useState<number | null>(null);

  // The head commit the page last showed. When a reload finds another one, the files read for the
  // old head are dropped and a merge confirm still open is closed, so a merge never pins a commit
  // whose files were not shown (stand-in review FIX-BEFORE 1).
  const shown = useRef<string | null>(null);
  // Counts the head changes seen. A files read remembers the count it started under and is dropped
  // when the count has moved, so a late answer for an old head never replaces the dropped files
  // (stand-in review FIX-SOON 3); the count is also state so the files effect reads them again.
  const headChanges = useRef(0);
  const [headEpoch, setHeadEpoch] = useState(0);
  const reload = useCallback(async () => {
    try {
      const p = await invoke<PrPageData>("pr_page", args);
      if (shown.current !== null && shown.current !== p.headSha) {
        headChanges.current += 1;
        setHeadEpoch(headChanges.current);
        setFiles(null);
        setViewed(null);
        setEditors(null);
        setSure(false);
        setNote("New commits were pushed since you opened this page; check Files changed again.");
      }
      shown.current = p.headSha;
      setPage(p);
      setPending((r) => settleReviewers(p.reviewers, r));
      const failed: string[] = [];
      setChecks(await invoke<PrCheck[]>("pr_checks", { host: args.host, repo: args.repo, sha: p.headSha }).catch((e) => (failed.push(`the checks (${say(e)})`), [])));
      setThreads(await invoke<PrThreads>("pr_threads", args).catch((e) => (failed.push(`the review threads (${say(e)})`), NO_THREADS)));
      setPartial(partialNote(failed));
    } catch (e) {
      setNote(say(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.host, target.repo, target.number]);

  useEffect(() => {
    void reload();
    void invoke<Person[]>("github_people", { host: target.host, repo: target.repo }).then(setPeople, () => setPeople([]));
  }, [reload, target.host, target.repo]);
  useEffect(() => {
    void invoke<TaskLabel[]>("scm_repo_labels", { host: target.host, repo: target.repo }).then((o) => setOffer(Array.isArray(o) ? o : []), () => setOffer([]));
  }, [target.host, target.repo]);
  // GIT-060: the branch's repository (the fork, when it is one) says whose fork it is.
  const headRepo = page?.headRepo || target.repo;
  useEffect(() => {
    let live = true;
    void invoke<{ fork: boolean; parent: string | null; parentOwner: string | null }>("github_repo_lineage", { host: target.host, repo: headRepo }).then(
      (l) => live && setLineage(lineageNote(l)),
      () => live && setLineage(null),
    );
    return () => {
      live = false;
    };
  }, [target.host, headRepo]);
  // GIT-052: the viewed marks are read with the files and again after a new head commit.
  useEffect(() => {
    if (tab !== "files" || viewed !== null) return;
    const started = headChanges.current;
    void invoke<PrViewed>("pr_viewed", args).then(
      (v) => started === headChanges.current && setViewed(v),
      (e) => setNote(say(e)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, viewed, headEpoch]);
  useEffect(() => {
    if (tab !== "files" || files !== null) return;
    const started = headChanges.current;
    const current = () => started === headChanges.current;
    void invoke<PrFiles>("pr_files", args).then(
      (f) => current() && setFiles(f),
      (e) => current() && (setFiles({ files: [], truncated: false, limit: 0, diffLimits: { lines: 0, chars: 0, budget: 0 } }), setNote(say(e))),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, files, headEpoch]);

  // Escape steps back to Tasks, unless it belongs to a text field, a menu or dialog above the page, an edit
  // in progress (those have their own Cancel), or an open merge confirm, which it closes first.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const step = escapeStep({ confirming: sure, typing: inTextField(e.target as HTMLElement | null), overlay: overlayShowing(), editing: draft !== null || replying !== null });
      if (step === "stay") return;
      e.preventDefault(); // the screen's own Escape (leave the page) must not also run
      if (step === "cancel-merge") setSure(false);
      else if (step === "back") onClose();
    };
    // Capture phase: the Tasks screen's "Escape leaves the page" listener sits on window in the bubble phase
    // and was added first, so a bubble listener here would run after it and could not hold it back.
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [sure, draft, replying, onClose]);

  /** Read the page again from GitHub (a new head commit drops the files read for the old one). */
  const refresh = () => void act(async () => {});

  /** GIT-039: reads one held-back file's diff when the user asks. */
  const loadPatch = (filename: string) => {
    setLoading(filename);
    invoke<string>("pr_file_patch", { ...args, filename }).then(
      (p) => setLoaded((l) => ({ ...l, [filename]: p || "No text diff." })),
      (e) => setNote(say(e)),
    ).finally(() => setLoading(null));
  };

  /** One write, then read the page again; its error shows in the note. */
  const act = async (f: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setNote(null);
    try {
      await f();
      if (done) setNote(done);
      await reload();
    } catch (e) {
      setNote(say(e));
    } finally {
      setBusy(false);
    }
  };
  /** GIT-052: shown at once, sent to GitHub, and put back when GitHub refuses. */
  const mark = (path: string, on: boolean) => {
    if (!viewed) return;
    setViewed(withViewed(viewed, path, on));
    invoke("pr_set_viewed", { ...args, path, viewed: on }).catch((e) => {
      setViewed((v) => (v ? withViewed(v, path, !on) : v));
      setNote(say(e));
    });
  };
  /** GIT-051: the failing output goes to this pull request's workspace agent, with the Git panel's own prompt. */
  const fix = async (c: PrCheck) => {
    if (!workspace) return;
    setFixing(c.id);
    setNote(null);
    try {
      const log = await invoke<string>("scm_check_log", { worktree: workspace, link: c.url });
      await invoke("scm_review_send", { worktree: workspace, text: fixText(c, log) });
      setNote(`Sent the failing output of "${c.name}" to the workspace's agent.`);
    } catch (e) {
      setNote(say(e));
    } finally {
      setFixing(null);
    }
  };
  const saveBody = () => {
    if (draft === null) return;
    void act(async () => {
      await invoke("scm_task_body", { ...args, body: draft });
      setDraft(null);
    });
  };
  const editLabels = (add: string[], remove: string[]) =>
    void act(async () => {
      const l = await invoke<TaskLabel[]>("scm_task_labels", { ...args, add, remove });
      setPage((x) => x && { ...x, labels: l });
    });
  const pick = (t: PrTab) => {
    setTab(t);
    saveTab(window.localStorage, target, t);
  };

  if (!page) {
    return (
      <div className="pr-page">
        <div className="pr-head">
          <button className="btn" title="Back to Tasks" aria-label="Back to Tasks" onClick={onClose}>
            <ArrowLeft /> Back
          </button>
          <span role={note ? "alert" : undefined}>{note ?? `Reading ${target.repo}#${target.number}...`}</span>
          {note && (
            <button className="btn" onClick={() => void reload()}>
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }
  const sum = summarizeChecks(checks);
  const box = mergeBox(page, added);
  const pageUrl = safeHref(page.url);
  const mine = (n: string) => ({ ...args, add: [], remove: [n] });
  const copy = () => void navigator.clipboard.writeText(page.url).then(() => setNote("Link copied."), () => setNote(page.url));
  const reviewers = withReviewers(page.reviewers, pending);
  const suggestions = typed.trim() || (editors && editors.length) ? reviewerSuggestions(people, { author: page.author, reviewers }, typed, 8, editors ?? []) : [];
  const more = labelsToAdd(offer, page.labels);
  // GIT-048: shown at once, not behind `busy`; a failed write is put back and says so.
  const review = (add: string[], remove: string[]) => {
    setNote(null);
    setPending((r) => editReviewers(r, add, remove));
    invoke("pr_reviewers", { ...args, add, remove }).then(reload, (e) => {
      setPending((r) => undoReviewers(r, add, remove));
      setNote(`The reviewer change was undone: ${say(e)}`);
    });
  };
  const askFor = (login: string) => {
    const r = askForReview({ reviewers }, [login]);
    if (!r.ok) return setNote(r.reason);
    setTyped("");
    if (r.add.length) review(r.add, []);
  };

  return (
    <div className="pr-page">
      <div className="pr-head">
        <button className="btn" title="Back to Tasks (Esc)" aria-label="Back to Tasks" onClick={onClose}>
          <ArrowLeft /> Back
        </button>
        <h2>
          <span className={`task-state pull ${page.state}`}>{page.draft ? "draft" : page.state}</span> {page.title} <span className="tasks-kind">#{page.number}</span>
        </h2>
        <span className="tasks-kind">
          {target.repo} · {headLabel(target.repo, page)} into {page.baseRef} · +{page.additions} -{page.deletions} in {page.changedFiles} files
        </span>
        {lineage && <span className="tasks-kind">{lineage}</span>}
        {work && (
          <button className="btn primary" onClick={work.run}>
            {work.label}
          </button>
        )}
        <button className="btn" disabled={busy} onClick={refresh} title="Read this pull request again from GitHub">
          Refresh
        </button>
        <button className="btn" onClick={copy}>
          Copy link
        </button>
        {pageUrl && (
          <a className="btn" href={pageUrl} target="_blank" rel="noreferrer">
            Open on GitHub
          </a>
        )}
        {page.state !== "merged" && (
          <button className="btn" disabled={busy} onClick={() => void act(() => invoke("pr_set_state", { ...args, open: page.state !== "open" }))}>
            {page.state === "open" ? "Close pull request" : "Reopen"}
          </button>
        )}
      </div>
      {note && classify(note) !== "other" ? (
        <GhBanner error={note} host={target.host} />
      ) : (
        note && (
          <div className="note warn" role="status">
            {note}
          </div>
        )
      )}
      {partial && (
        <div className="note warn" role="status">
          {partial}
        </div>
      )}
      <div className="pr-tabs" role="tablist">
        {(["conversation", "checks", "files"] as PrTab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => pick(t)}>
            {t === "conversation" ? "Conversation" : t === "checks" ? `Checks · ${sum.label}` : `Files changed · ${page.changedFiles}`}
          </button>
        ))}
      </div>
      {tab === "conversation" && (
        <div className="pr-body">
          <div className="pr-main">
            {draft !== null ? (
              <>
                <MentionField className="task-body-edit" label="Description" value={draft} onChange={setDraft} people={people} />
                <button className="btn primary" disabled={busy} onClick={saveBody}>
                  Save
                </button>
                <button className="btn" disabled={busy} onClick={() => setDraft(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                {page.body.trim() ? <Markdown text={page.body} /> : <p className="tasks-kind">No description.</p>}
                <button className="btn" disabled={busy} onClick={() => setDraft(page.body)}>
                  Edit description
                </button>
              </>
            )}
            <div className="pr-reactions">
              {page.reactions.map((r) => (
                <span key={r.content} className="pr-reaction">
                  {REACTION_EMOJI[r.content] ?? r.content} {r.count}
                </span>
              ))}
              {Object.keys(REACTION_EMOJI).map((c) => (
                <button key={c} className="ib" title={`React ${c}`} disabled={busy} onClick={() => void act(() => invoke("pr_react", { ...args, content: c }))}>
                  {REACTION_EMOJI[c]}
                </button>
              ))}
            </div>
            <h3>Review threads</h3>
            {threads.threads.length === 0 && <p className="tasks-kind">No review comments.</p>}
            {threads.truncated && <p className="tasks-kind">Showing the first {threads.limit} review comments; the rest are on GitHub.</p>}
            {threads.threads.map((t) => (
              <div key={t.id} className="pr-thread">
                <div className="tasks-kind">
                  {t.path}
                  {t.line ? `:${t.line}` : ""}
                </div>
                {t.comments.map((c) => (
                  <div key={c.id} className="pr-comment">
                    <strong>{c.author}</strong> <span className="tasks-kind">{c.at.slice(0, 10)}</span>
                    <Markdown text={c.body} />
                  </div>
                ))}
                {replying?.id === t.id ? (
                  <>
                    <textarea value={replying.text} onChange={(e) => setReplying({ id: t.id, text: e.target.value })} rows={3} aria-label="Reply" />
                    <button className="btn primary" disabled={busy || !replying.text.trim()} onClick={() => void act(async () => { await invoke("pr_reply", { ...args, comment: t.id, body: replying.text }); setReplying(null); })}>
                      Reply
                    </button>
                    <button className="btn" onClick={() => setReplying(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button className="btn" onClick={() => setReplying({ id: t.id, text: "" })}>
                    Reply
                  </button>
                )}
              </div>
            ))}
          </div>
          <aside className="pr-side">
            <h3>Reviewers</h3>
            {page.reviewsTruncated && <p className="tasks-kind">Showing the first {page.reviewsLimit} reviews; some reviewers may be missing.</p>}
            {reviewers.map((r) => (
              <div key={r.login} className="pr-person">
                {r.login} <span className={`pr-review ${r.state}`}>{REVIEW_LABEL[r.state] ?? r.state}</span>
                {r.state === "requested" && (
                  <button className="ib" title={`Take back the request to ${r.login}`} onClick={() => review([], [r.login])}>
                    <Close />
                  </button>
                )}
              </div>
            ))}
            <input value={typed} onChange={(e) => setTyped(e.target.value)} onFocus={() => editors === null && void invoke<string[]>("pr_editors", args).then(setEditors, () => setEditors([]))} placeholder="Ask for a review..." aria-label="Ask for a review" onKeyDown={(e) => e.key === "Enter" && typed.trim() && askFor(typed.trim().replace(/^@/, ""))} />
            {suggestions.map((p) => (
              <button key={p.login} className="btn" title={isEditor(editors ?? [], p.login) ? "Recently edited these files" : undefined} onClick={() => askFor(p.login)}>
                {p.login}
                {isEditor(editors ?? [], p.login) ? " (edited these files)" : ""}
              </button>
            ))}
            <h3>Assignees</h3>
            {page.assignees.map((a) => (
              <div key={a} className="pr-person">
                {a}
                <button className="ib" title={`Unassign ${a}`} disabled={busy} onClick={() => void act(() => invoke("pr_assignees", mine(a)))}>
                  <Close />
                </button>
              </div>
            ))}
            <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Assign someone..." aria-label="Assign someone" onKeyDown={(e) => { if (e.key === "Enter" && assignee.trim()) { const a = assignee.trim().replace(/^@/, ""); setAssignee(""); void act(() => invoke("pr_assignees", { ...args, add: [a], remove: [] })); } }} />
            <h3>Labels</h3>
            <div>
              {page.labels.length ? (
                page.labels.map((l) => (
                  <span key={l.name} className="tasks-label" style={{ borderColor: `#${l.color}` }}>
                    {l.name}
                    <button className="task-x" title={`Remove ${l.name}`} disabled={busy} onClick={() => editLabels([], [l.name])}>
                      ×
                    </button>
                  </span>
                ))
              ) : (
                <span className="tasks-kind">None</span>
              )}
            </div>
            <select aria-label="Add a label" value="" disabled={busy || more.length === 0} onChange={(e) => e.target.value && editLabels([e.target.value], [])}>
              <option value="">{more.length ? "Add a label…" : "No more labels"}</option>
              {more.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <h3>Merge</h3>
            <p className="tasks-kind">{box.reason}</p>
            {box.canMerge && (
              <>
                <select value={method} onChange={(e) => { setMethod(e.target.value as typeof method); setSure(false); }} aria-label="How to merge">
                  {MERGE_METHODS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {!sure ? (
                  <button className="btn primary" onClick={() => setSure(true)}>
                    Merge...
                  </button>
                ) : (
                  <div role="alertdialog" aria-label="Confirm merge">
                    <p>
                      This {method}s #{page.number} into {page.baseRef} on GitHub. It cannot be undone from here.
                    </p>
                    <button className="btn danger" disabled={busy} onClick={() => void act(async () => { try { await invoke("pr_merge", { ...args, method, confirmed: true, sha: page.headSha }); } finally { setSure(false); } }, "Merged.")}>
                      Yes, merge it
                    </button>
                    <button className="btn" onClick={() => setSure(false)}>
                      Cancel
                    </button>
                  </div>
                )}
              </>
            )}
          </aside>
        </div>
      )}
      {tab === "checks" && (
        <div className="pr-body">
          <div className="pr-main">
            <div className={`pr-checks-sum ${sum.tone}`}>{sum.label}</div>
            <button className="btn" disabled={busy || !rerunTargets(checks, false).length} onClick={() => void act(async () => { for (const run of rerunTargets(checks, false)) await invoke("pr_rerun", { host: args.host, repo: args.repo, runId: run, failedOnly: false }); }, "Asked GitHub to rerun all checks.")}>
              Rerun all checks
            </button>
            <button className="btn" disabled={busy || !rerunTargets(checks, true).length} onClick={() => void act(async () => { for (const run of rerunTargets(checks, true)) await invoke("pr_rerun", { host: args.host, repo: args.repo, runId: run, failedOnly: true }); }, "Asked GitHub to rerun the failed checks.")}>
              Rerun failed checks
            </button>
            <ul className="pr-checks">
              {checks.map((c) => (
                <li key={c.id} className={c.status === "completed" ? c.conclusion : "running"}>
                  {safeHref(c.url) ? (
                    <a href={safeHref(c.url) ?? undefined} target="_blank" rel="noreferrer">
                      {c.name}
                    </a>
                  ) : (
                    c.name
                  )}{" "}
                  <span className="tasks-kind">{c.status === "completed" ? c.conclusion : c.status}</span>
                  {failedChecks([c]).length > 0 && (
                    <button className="btn" disabled={busy || fixing !== null || fixBlocker(c, workspace) !== null} title={fixBlocker(c, workspace) ?? "Send this check's failing output to the workspace's agent"} onClick={() => void fix(c)}>
                      {fixing === c.id ? "Sending..." : "Fix with AI"}
                    </button>
                  )}
                  {failedChecks([c]).length > 0 && fixBlocker(c, workspace) && <span className="tasks-kind"> {fixBlocker(c, workspace)}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {tab === "files" && (
        <div className="pr-body">
          <div className="pr-main">
            {files === null && <p className="tasks-kind">Reading files...</p>}
            {files?.truncated && <p className="tasks-kind">Showing the first {files.limit} files; the rest are on GitHub.</p>}
            {files && viewed && <p className="tasks-kind" role="status">{viewedLine(files.files, viewed)}{viewed.truncated ? ` (marks for the first ${viewed.limit} files are read)` : ""}</p>}
            {files?.files.map((f) => (
              <details key={f.filename} className="pr-file">
                <summary>
                  <label className="hit-box"><input type="checkbox" aria-label={`Viewed ${f.filename}`} disabled={!viewed} checked={viewedOf(viewed, f.filename) === "viewed"} onChange={(e) => mark(f.filename, e.target.checked)} /></label>{" "}
                  {f.filename}{viewedOf(viewed, f.filename) === "dismissed" ? <span className="tasks-kind"> changed since viewed</span> : null} <span className="tasks-kind">{f.status} +{f.additions} -{f.deletions}</span>
                </summary>
                {f.held && loaded[f.filename] === undefined ? (
                  <div className="note warn" data-held={f.held}>
                    <p>{heldWords(f, files.diffLimits)}</p>
                    <button className="btn" disabled={loading === f.filename} onClick={() => loadPatch(f.filename)}>
                      {loading === f.filename ? "Loading..." : "Load this diff"}
                    </button>
                  </div>
                ) : (
                  <pre className="md-code">{loaded[f.filename] ?? (f.patch || "No text diff (binary or renamed).")}</pre>
                )}
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
