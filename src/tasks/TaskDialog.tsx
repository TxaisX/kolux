// GIT-050: the preview dialog for one issue or pull request, opened by clicking it in Tasks: its
// description, timeline, labels and assignees. The description shows GitHub's latest version (read
// again every 15 seconds while the dialog is open) unless it is being edited, and an edit keeps its
// unsaved draft until it is saved or cancelled.
// GIT-053 (T-314-b): typing @ in the description editor offers this repository's people.
// GIT-047 (T-231-c): an issue can be closed (completed, not planned, duplicate), reopened and commented on.
// T-232-c: the description is drawn as markdown (MarkdownView.tsx, never HTML), assignees can be added and
// removed, a workspace can be started or resumed from here, and a pull request opens its full page.
import { trapTab } from "../chrome/dialogFocus";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { Close } from "../chrome/icons";
import { restoreFocus } from "../shell/paletteCaps";
import { bodyView, focusLost, peekDraft, stashDraft } from "./dialogState";
import { type IssueAction, runAction } from "./issueActions";
import Markdown from "./MarkdownView";
import MentionField from "./MentionField";
import { type Edit, withAssignees, withLabels } from "./edits";
import { duplicateQuery, eventLine, issueNumber, type Task, type TaskDetail, type TaskLabel, type TaskPage, taskKind } from "./model";
import type { Person } from "./repoFacts";

const FRESH_MS = 15_000;

// GIT-048 (T-281-b): `edit` is what is pending for this item (shown at once, on top of what GitHub last said); `onAssign`/`onUndoAssign`
// and `onShowState`/`onUndoState` hand a change to the page before and after GitHub answers; `onState` carries GitHub's answer.
export default function TaskDialog({ task, host, onClose, onLabels, onState, onAssign, onUndoAssign, onShowState, onUndoState, onEditLabels, onUndoLabels, edit, work, onPage }: { task: Task; host: string; onClose: () => void; onLabels: (labels: TaskLabel[]) => void; onState: (d: TaskDetail) => void; onAssign?: (add: string[], remove: string[]) => void; onUndoAssign?: (add: string[], remove: string[]) => void; onShowState?: (state: string) => void; onUndoState?: () => void; onEditLabels?: (add: TaskLabel[], remove: string[]) => void; onUndoLabels?: (add: string[], remove: string[]) => void; edit?: Edit; work?: { label: string; run: () => void }; onPage?: () => void }) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  // An unsaved description left when the dialog was last closed comes back in the editor.
  const [draft, setDraft] = useState<string | null>(() => peekDraft(task.url));
  const [offer, setOffer] = useState<TaskLabel[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [who, setWho] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const tell = useRef(onLabels);
  tell.current = onLabels;
  const args = { host, repo: task.repo, number: task.number };
  const unsaved = useRef({ url: task.url, draft, saved: detail?.body ?? null });
  unsaved.current = { url: task.url, draft, saved: detail?.body ?? null };

  // FIX-3 (review A4): closing the dialog returns focus to what had it before (declared before the
  // effect that moves focus into the dialog, so it reads the opener first). If the opener is gone
  // (its list row was redrawn), focus goes to the terminal or editor like the palette does.
  // An unsaved description is kept for the next time this item's dialog opens.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => {
      const u = unsaved.current;
      stashDraft(u.url, u.draft, u.saved);
      queueMicrotask(() => void restoreFocus(before, (s) => document.querySelector<HTMLElement>(s)));
    };
  }, []);
  // A button the dialog removed or disabled (a label ×, Close issue) leaves focus on nothing: put it back in the dialog.
  useEffect(() => {
    if (box.current && focusLost(document.activeElement, document.body)) box.current.focus();
  });
  const read = () =>
    invoke<TaskDetail>("scm_task_detail", args)
      .then((d) => {
        setDetail(d);
        setError(null);
        tell.current(d.labels);
      })
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void read();
    invoke<TaskLabel[]>("scm_repo_labels", { host, repo: task.repo })
      .then(setOffer)
      .catch(() => setOffer([]));
    // GIT-053: the people @ offers are this item's own repository's, on this item's host.
    let live = true;
    setPeople([]);
    invoke<Person[]>("github_people", { host, repo: task.repo }).then(
      (p) => live && setPeople(p),
      () => live && setPeople([]),
    );
    const timer = setInterval(read, FRESH_MS);
    box.current?.focus();
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [task.url]);

  // T-281 (GIT-048): a label edit shows at once like an assignee edit; a failed write puts back only itself and says so.
  const labels = (add: string[], remove: string[]) => {
    setError(null);
    onEditLabels?.(offer.filter((o) => add.includes(o.name)), remove);
    invoke<TaskLabel[]>("scm_task_labels", { ...args, add, remove })
      .then((l) => {
        setDetail((d) => d && { ...d, labels: l });
        onLabels(l);
      })
      .catch((e) => {
        setError(`The label change was undone: ${String(e)}`);
        onUndoLabels?.(add, remove);
      });
  };
  const save = () => {
    if (draft === null) return;
    setBusy(true);
    invoke<TaskDetail>("scm_task_body", { ...args, body: draft })
      .then((d) => {
        setDetail((x) => x && { ...x, body: d.body, updated: d.updated });
        setDraft(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  // GIT-048: shown at once; not behind `busy`, so a second edit made while the first is on its way is sent too
  // (each write names only its own people), and a failed one puts back only itself.
  const assign = (add: string[], remove: string[]) => {
    setError(null);
    onAssign?.(add, remove);
    invoke("pr_assignees", { ...args, add, remove })
      .then(refresh)
      .catch((e) => {
        setError(String(e));
        onUndoAssign?.(add, remove);
      });
  };
  // readBack rejects, so an issue action can say "it went through, but reading it back failed"; refresh shows the error itself.
  const readBack = () =>
    invoke<TaskDetail>("scm_task_detail", args).then((d) => {
      setDetail(d);
      onState(d);
    });
  const refresh = () => readBack().catch((e) => setError(String(e)));

  const view = bodyView(detail, error);
  const retry = () => {
    setError(null);
    void read();
  };
  const have = withLabels(detail?.labels ?? task.labels, edit);
  const more = offer.filter((o) => !have.some((h) => h.name === o.name));
  const state = edit?.state ?? detail?.state ?? task.state;
  const assignees = withAssignees(detail?.assignees ?? task.assignees, edit);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} className="auto-dialog task-dialog" role="dialog" aria-modal="true" aria-label={`${taskKind(task)} ${task.title}`} onKeyDown={(e) => (trapTab(e), e.key === "Escape" && draft === null && onClose())}>
        <div className="auto-dialog-head">
          <h2>
            <span className={`task-state ${task.kind} ${state}`}>{task.draft ? "draft" : state}</span> {detail?.title || task.title}
          </h2>
          <span className="tasks-kind">
            {taskKind(task)} · {task.repo}
          </span>
          {onPage && (
            <button className="btn" onClick={onPage}>
              Open full page
            </button>
          )}
          {work && (
            <button className="btn" onClick={work.run}>
              {work.label}
            </button>
          )}
          <a className="btn" href={task.url} target="_blank" rel="noreferrer">
            Open on GitHub
          </a>
          <button className="ib" title="Close" aria-label="Close" onClick={onClose}>
            <Close />
          </button>
        </div>
        {error && (
          <div className="note warn" role="status">
            {error}
          </div>
        )}
        <div className="auto-dialog-body">
          <div className="auto-dialog-main task-main">
            <div className="task-sect">
              <span className="task-cap">Description</span>
              {draft === null ? (
                <button className="btn" disabled={!detail} onClick={() => setDraft(detail?.body ?? "")}>
                  Edit
                </button>
              ) : (
                <>
                  <button className="btn primary" disabled={busy} onClick={save}>
                    Save
                  </button>
                  <button className="btn" disabled={busy} onClick={() => setDraft(null)}>
                    Cancel
                  </button>
                </>
              )}
            </div>
            {draft !== null ? (
              <MentionField className="task-body-edit" label="Description" value={draft} onChange={setDraft} people={people} />
            ) : (
              <div className="task-body" data-task-body>
                {view === "loading" ? "Loading…" : view === "failed" ? (
                  <span role="alert">
                    This could not be read from GitHub.{" "}
                    <button className="btn" onClick={retry}>
                      Retry
                    </button>
                  </span>
                ) : detail?.body ? <Markdown text={detail.body} /> : <span className="muted">No description.</span>}
              </div>
            )}
            <span className="task-cap">Timeline</span>
            <ul className="task-timeline">
              {(detail?.events ?? []).map((e, i) => (
                <li key={i} className={e.kind}>
                  <span className="task-line">{eventLine(e)}</span>
                  <span className="tasks-when">{e.at.slice(0, 10)}</span>
                </li>
              ))}
              {detail && detail.events.length === 0 && <li className="muted">Nothing has happened yet.</li>}
            </ul>
            {task.kind === "issue" && <IssueActions host={host} task={task} state={state} title={detail?.title || task.title} onDone={readBack} onShow={onShowState} onUndo={onUndoState} />}
          </div>
          <div className="auto-dialog-side">
            <span className="task-cap">Labels</span>
            <div className="task-labels">
              {have.map((l) => (
                <span key={l.name} className="tasks-label" style={l.color ? { borderColor: `#${l.color}` } : undefined}>
                  {l.color && <i style={{ background: `#${l.color}` }} />}
                  {l.name}
                  <button className="task-x" title={`Remove ${l.name}`} aria-label={`Remove label ${l.name}`} onClick={() => labels([], [l.name])}>
                    ×
                  </button>
                </span>
              ))}
              {have.length === 0 && <span className="muted">None</span>}
            </div>
            <select className="field" aria-label="Add a label" value="" disabled={more.length === 0} onChange={(e) => e.target.value && labels([e.target.value], [])}>
              <option value="">{more.length ? "Add a label…" : "No more labels"}</option>
              {more.map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name}
                </option>
              ))}
            </select>
            <span className="task-cap">Assignees</span>
            <div className="task-labels">
              {assignees.map((a) => (
                <span key={a} className="tasks-who">
                  @{a}
                  <button className="task-x" title={`Unassign ${a}`} aria-label={`Unassign ${a}`} onClick={() => assign([], [a])}>
                    ×
                  </button>
                </span>
              ))}
            </div>
            <input className="field" aria-label="Assign someone" placeholder="Assign someone…" value={who} onChange={(e) => setWho(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && who.trim()) { const a = who.trim().replace(/^@/, ""); setWho(""); assign([a], []); } }} />
            {assignees.length === 0 && <span className="muted">No one</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** GIT-047: close an issue (completed, not planned, or a duplicate of another number), reopen it, and
 * comment on it. A duplicate target is checked by github.rs before anything is sent; issues sharing
 * words of the title are offered as targets. */
function IssueActions({ host, task, state, title, onDone, onShow, onUndo }: { host: string; task: Task; state: string; title: string; onDone: () => Promise<unknown>; onShow?: (state: string) => void; onUndo?: () => void }) {
  const [reason, setReason] = useState("completed");
  const [dup, setDup] = useState("");
  const [like, setLike] = useState<Task[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const args = { host, repo: task.repo, number: task.number };
  useEffect(() => {
    const q = reason === "duplicate" ? duplicateQuery(task.repo, title) : null;
    if (!q) return setLike([]);
    let live = true;
    invoke<TaskPage>("scm_tasks_search", { host, queries: [q], page: 1 })
      .then((p) => live && setLike(p.items.filter((t) => t.kind === "issue" && t.number !== task.number).slice(0, 5)))
      .catch(() => live && setLike([]));
    return () => {
      live = false;
    };
  }, [reason, host, task.repo, task.number, title]);
  // FIX-1 (council FS 2): busy until the refreshed issue is back; a timeout says the write may have landed.
  // GIT-048: a close or reopen shows at once and is put back if GitHub refuses it.
  const run = (what: IssueAction, send: Promise<unknown>, after?: () => void, shows?: string) => {
    if (shows) onShow?.(shows);
    void runAction({ send, refresh: onDone, after, setBusy, setError, what, onFail: shows ? onUndo : undefined });
  };
  const dupNumber = issueNumber(dup);
  const close = () => {
    if (reason === "duplicate" && dupNumber === null) return setError("Give the number of the issue this one duplicates, such as 12 or #12.");
    run("close", invoke("github_issue_state", { ...args, open: false, reason, duplicateOf: reason === "duplicate" ? dupNumber : null }), undefined, "closed");
  };
  return (
    <div className="task-issue" data-issue-actions>
      {error && (
        <div className="note warn" role="status">
          {error}
        </div>
      )}
      <div className="task-sect">
        {state === "open" ? (
          <>
            <select className="field" aria-label="Close as" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)}>
              <option value="completed">Close as completed</option>
              <option value="not_planned">Close as not planned</option>
              <option value="duplicate">Close as duplicate</option>
            </select>
            {reason === "duplicate" && <input className="field" aria-label="Duplicate of" placeholder="Duplicate of #" value={dup} disabled={busy} onChange={(e) => setDup(e.target.value)} />}
            <button className="btn" disabled={busy} onClick={close}>
              Close issue
            </button>
          </>
        ) : (
          <button className="btn" disabled={busy} onClick={() => run("reopen", invoke("github_issue_state", { ...args, open: true, reason: "", duplicateOf: null }), undefined, "open")}>
            Reopen issue
          </button>
        )}
      </div>
      {state === "open" && reason === "duplicate" && like.length > 0 && (
        <div className="task-labels" role="group" aria-label="Possible duplicates">
          {like.map((t) => (
            <button key={t.number} className="btn" title={t.title} onClick={() => setDup(`#${t.number}`)}>
              #{t.number} {t.title.length > 40 ? `${t.title.slice(0, 40)}…` : t.title}
            </button>
          ))}
        </div>
      )}
      <textarea className="field task-comment" aria-label="Comment" placeholder="Leave a comment" value={comment} disabled={busy} onChange={(e) => setComment(e.target.value)} />
      <button className="btn primary" disabled={busy || !comment.trim()} onClick={() => run("comment", invoke("github_issue_comment", { ...args, body: comment }), () => setComment(""))}>
        Comment
      </button>
    </div>
  );
}
