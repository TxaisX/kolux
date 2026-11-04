// T-231-d (GIT-046): create a GitHub issue from Tasks. The draft is saved as it is typed (settings
// key tasksIssueDraft) and comes back when the dialog is opened again; one too long for settings is
// held in memory for the run. FIX-2 (council FS 1-2, AFTER 2): one create runs at a time even across
// close and reopen, the dialog cannot be closed or edited while it runs, a draft belongs to its
// GitHub host (shown beside Repository), and closing saves at once with typed label/assignee text.
import { trapTab } from "../chrome/dialogFocus";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { actionError } from "./issueActions";
import { noteUse } from "../onboarding/features";
import type { Task } from "./model";
import { closingDraft, createBusy, createOnce, draftFrom, draftToSave, emptyDraft, type IssueDraft, names, openDraft, pickableLabels, TITLE_MAX, titleLength, lastCreateFailure, createResetsDialog, watchCreate, withRepo } from "./newIssue";

/** The draft kept for this run (also one too long for settings); null after an issue is created.
 * The one-create-at-a-time flag lives next to it, in newIssue.ts (createOnce). */
let held: IssueDraft | null = null;

export default function NewIssueDialog(p: {
  host: string;
  targets: string[];
  saved: unknown;
  save: (patch: Record<string, unknown>) => Promise<unknown> | void;
  factsRepo: string;
  labels: string[];
  people: string[];
  onClose: () => void;
  onCreated: (t: Task, host: string) => void;
}) {
  const [start] = useState(() => openDraft(held ?? draftFrom(p.saved), p.targets, p.host));
  const [d, setD] = useState<IssueDraft>(start.draft);
  const [labelText, setLabelText] = useState(d.labels.join(", "));
  const [peopleText, setPeopleText] = useState(d.assignees.join(", "));
  const [busy, setBusy] = useState(createBusy);
  // FIX-4: a create that failed while no dialog was open (the user had left Tasks) still shows here.
  // FIX-5: only a failure sent to this host and repository (scoped in newIssue.ts).
  // FIX-6 (council AFTER 3): read for the repository selected now (not the one the dialog opened
  // on) each time the dialog draws; `failedTick` makes it draw when a create settles.
  const [, failedTick] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  // Nothing is saved until the user changes something, so opening the dialog in a workspace on
  // another host never overwrites the draft kept for the first host.
  const touched = useRef(false);
  // The repository the dialog is aimed at now, for the failure watcher below.
  const repoNow = useRef(d.repo);
  repoNow.current = d.repo;
  const pending = useRef<IssueDraft | null | undefined>(undefined);
  const save = useRef(p.save);
  save.current = p.save;
  const out = draftToSave(d);
  const keep = (next: IssueDraft) => {
    held = next;
    const v = draftToSave(next);
    pending.current = undefined;
    if (v !== "too-long") void save.current({ tasksIssueDraft: v });
  };
  // FIX-3 (review A4): closing the dialog returns focus to what had it before (declared before the
  // effect that moves focus into the dialog, so it reads the opener first).
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => {
      if (before?.isConnected) before.focus?.();
    };
  }, []);
  useEffect(() => box.current?.focus(), []);
  // A create still out from an earlier opening of this dialog: wait for it, and start a fresh
  // draft when it went through.
  useEffect(
    () =>
      watchCreate((e, _err, scope) => {
        setBusy(e === "busy");
        // A create started by an earlier opening of this dialog failed (or timed out): say so here
        // too, or the user would click Create again on a gh that may have opened the issue.
        // FIX-5: and only when it was sent to this dialog's own host and repository.
        if (e === "failed") failedTick((n) => n + 1);
        // FIX-6 (council AFTER 2): and a create that went through resets only the dialog it was sent to.
        if (e === "created" && createResetsDialog(scope, p.host, repoNow.current)) {
          touched.current = false;
          setD((x) => emptyDraft(p.host, x.repo));
          setLabelText("");
          setPeopleText("");
        }
      }),
    [p.host],
  );
  useEffect(() => {
    if (!touched.current) return;
    held = d;
    if (out === "too-long") return;
    pending.current = out;
    const t = setTimeout(() => {
      pending.current = undefined;
      void save.current({ tasksIssueDraft: out });
    }, 400);
    return () => clearTimeout(t);
  }, [d]);
  // Leaving Tasks with the dialog open still keeps the last edit (council AFTER 2).
  useEffect(
    () => () => {
      if (pending.current !== undefined) void save.current({ tasksIssueDraft: pending.current });
    },
    [],
  );

  const edit = (next: IssueDraft) => {
    touched.current = true;
    setD(next);
  };
  const put = (next: IssueDraft) => {
    edit(next);
    setLabelText(next.labels.join(", "));
    setPeopleText(next.assignees.join(", "));
  };
  const close = () => {
    if (busy) return;
    if (touched.current || labelText !== d.labels.join(", ") || peopleText !== d.assignees.join(", ")) keep(closingDraft(d, labelText, peopleText));
    p.onClose();
  };
  const create = () => {
    const f = closingDraft(d, labelText, peopleText);
    void createOnce(() => invoke<{ number: number; url: string; title: string }>("github_issue_create", { host: p.host, repo: f.repo, title: f.title, body: f.body, labels: f.labels, assignees: f.assignees }), { host: p.host, repo: f.repo }).then((r) => {
      if (!r) return;
      if (!r.ok) return failedTick((n) => n + 1);
      held = null;
      pending.current = undefined;
      void save.current({ tasksIssueDraft: null });
      const c = r.value;
      noteUse("tasks");
      p.onCreated({ kind: "issue", number: c.number, title: c.title || f.title.trim(), url: c.url, repo: f.repo, state: "open", draft: false, labels: f.labels.map((name) => ({ name, color: "" })), assignees: f.assignees, updated: new Date().toISOString(), checks: null }, p.host);
    });
  };
  const gone = lastCreateFailure(p.host, d.repo);
  const error = gone ? actionError(gone, "create") : null;
  const facts = d.repo === p.factsRepo;
  const other = start.elsewhere;
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={box} tabIndex={-1} className="auto-dialog task-dialog" role="dialog" aria-modal="true" aria-label="New issue" aria-busy={busy} data-new-issue onKeyDown={(e) => (trapTab(e), e.key === "Escape" && close())}>
        <div className="auto-dialog-head">
          <h2>New issue</h2>
          <button className="task-x" title={busy ? "Wait until the issue is created" : "Close (the draft is kept)"} disabled={busy} onClick={close}>
            ×
          </button>
        </div>
        <label>
          Repository{" "}
          <select className="field" value={d.repo} disabled={busy} onChange={(e) => put(withRepo(d, e.target.value))}>
            {p.targets.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>{" "}
          <span className="tasks-count" data-issue-host title="The GitHub host this issue goes to">
            on {p.host}
          </span>
        </label>
        {other && !touched.current && (
          <div className="tasks-count" data-draft-elsewhere>
            Your unfinished draft for {other.repo} on {other.host} is kept for that host; starting one here replaces it.
          </div>
        )}
        <input className="field" aria-label="Title" placeholder="Title" disabled={busy} value={d.title} onChange={(e) => edit({ ...d, title: e.target.value })} />
        <textarea className="field" aria-label="Description" placeholder="Description (Markdown)" rows={8} disabled={busy} value={d.body} onChange={(e) => edit({ ...d, body: e.target.value })} />
        <input className="field" aria-label="Labels" placeholder="Labels, comma separated" list="new-issue-labels" disabled={busy} value={labelText} onChange={(e) => setLabelText(e.target.value)} onBlur={() => edit({ ...d, labels: names(labelText) })} />
        <input className="field" aria-label="Assignees" placeholder="Assignees (logins), comma separated" list="new-issue-people" disabled={busy} value={peopleText} onChange={(e) => setPeopleText(e.target.value)} onBlur={() => edit({ ...d, assignees: names(peopleText) })} />
        <datalist id="new-issue-labels">{facts && pickableLabels(p.labels).map((l) => <option key={l} value={l} />)}</datalist>
        <datalist id="new-issue-people">{facts && p.people.map((l) => <option key={l} value={l} />)}</datalist>
        {titleLength(d.title) > TITLE_MAX && (
          <div className="tasks-warn" role="alert" data-title-long>
            GitHub titles can be at most {TITLE_MAX} characters; this one has {titleLength(d.title)}.
          </div>
        )}
        {out === "too-long" && (
          <div className="tasks-count" data-draft-memory>
            This draft is too long to keep after Kolux closes; it is kept until then, and creating the issue still works.
          </div>
        )}
        {error && (
          <div className="tasks-warn" role="alert">
            {error}
          </div>
        )}
        <button className="btn primary" disabled={busy || !d.title.trim() || titleLength(d.title) > TITLE_MAX || !d.repo} onClick={create}>
          {busy ? "Creating…" : "Create issue"}
        </button>
      </div>
    </div>
  );
}
