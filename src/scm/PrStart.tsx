// VIEW-074: the Checks panel's empty state for a branch with no pull request. It reads the
// worktree's git state, offers the create composer only when readiness is confirmed (an answer is
// tied to the exact worktree, branch and git state and goes stale after about five minutes), and
// when only a push is missing offers one combined push-and-create action. Rules live in startPr.ts.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ActionOutcome, Pr, Status } from "./model";
import { restoreFocus } from "../shell/paletteCaps";
import { escapeClosesForm, hideDraft, keepDraft, shownDraft, startDraft, writeMayTouchDraft, type DraftBook } from "./panelUx";
import SearchPick from "../editor/SearchPick";
import { needsOneClick, useOneClick } from "./oneClick";
import OneClickNotice from "./OneClickNotice";
import { draftOffered, draftPrText, draftRunning, draftSubscribe, draftVersion, readDraftGate, settleDraft, startGatedOneClick } from "./prDraft";
import { readReview, reviewKey, reviewLines, reviewSettle, reviewShown, type ReviewSlot } from "./prFind";
import { assess, blockHint, canStartReview, confirmed, createBlock, dismiss, errorShown, offerOf, raise, readinessKey, type ErrorBook, type Offer, type Readiness } from "./startPr";

// `provider`/`host` come with the Checks answer (known before the lookup below), so a non-GitHub remote never shows a create action.
type Props = { dir: string; provider?: string; host?: string | null; onCreated: (pr: Pr) => void };
type Draft = { title: string; body: string; base: string; draft: boolean };

/** Hard errors by worktree live outside the component so another worktree's panel never clears them. */
let errors: ErrorBook = {};
/** The composer's text by folder, so another folder's panel never shows (or loses) this one's draft. */
const drafts: DraftBook = new Map();

export default function PrStart({ dir, provider, host, onCreated }: Props) {
  const [seen, setSeen] = useState<{ dir: string; status: Status; ready: Readiness } | null>(null);
  const [, tick] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [branches, setBranches] = useState<string[]>([]); // EDIT-048: the Base box suggests from these
  const [aiOffered, setAiOffered] = useState(false); // GIT-024: the AI draft button follows the Source Control writer switches
  const [starting, setStarting] = useState<string | null>(null); // the worktree whose click is still reading the gate, before the draft is registered
  useSyncExternalStore(draftSubscribe, draftVersion);
  const [writeNote, setWriteNote] = useState<string | null>(null);
  const going = useOneClick(dir);
  const asking = useRef(dir);
  asking.current = dir;
  const latest = useRef<Draft | null>(null);
  latest.current = draft;
  /** Sets the composer's text and keeps it for this folder (null forgets it). */
  const setDraftFor = (d: Draft | null) => {
    keepDraft(drafts, dir, d);
    setDraft(d);
  };
  const opener = useRef<HTMLElement | null>(null); // what had focus when the composer was asked for, to give it back on dismiss
  const focusTitle = useRef(false);
  const titleBox = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<ReviewSlot>(null); // VIEW-074 / GIT-025: the linked-pull-request lookup, kept by worktree and branch
  const session = useRef(0); // bumped each time the composer opens or closes; a draft finishing in an older one is dropped

  const check = async (): Promise<{ status: Status; ready: Readiness } | null> => {
    try {
      const status = await invoke<Status>("scm_status", { worktree: dir });
      if (asking.current !== dir) return null;
      const got = { dir, status, ready: assess(dir, status, Date.now()) };
      setSeen(got);
      return got;
    } catch (err) {
      errors = raise(errors, dir, "status", `The branch could not be checked: ${String(err)}`);
      tick((n) => n + 1);
      return null;
    }
  };
  useEffect(() => {
    session.current++;
    const kept = shownDraft(drafts, dir); // this folder's composer, if it was open when the user left it
    setDraft(kept);
    if (kept) prepareComposer();
    setSeen(null);
    setWriteNote(null);
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir]);

  // The answer on screen is only ever this worktree's.
  const mine = seen && seen.dir === dir ? seen : null;
  // One lookup per worktree and branch change, no polling; a failure or an unsupported provider never blocks starting a pull request.
  const reviewAsk = mine?.status.branch ? reviewKey(dir, mine.status.branch) : null;
  const reviewNow = useRef<string | null>(null);
  reviewNow.current = reviewAsk;
  useEffect(() => {
    if (reviewAsk === null || !mine) return;
    void readReview(dir, mine.status).then((facts) => setReview((slot) => reviewSettle(slot, reviewAsk, facts, reviewNow.current)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewAsk]);
  const facts = reviewShown(review, reviewAsk);
  const linkedPr = facts?.lookup.kind === "found" && facts.lookup.pr.state === "OPEN" ? facts.lookup.pr : null;
  const key = mine ? readinessKey(dir, mine.status) : null;
  const lookup = facts?.lookup;
  const blockedBy = lookup?.kind === "unsupported" ? createBlock(lookup.provider, lookup.host) : createBlock(provider, host);
  const offer: Offer = offerOf({ linked: !!linkedPr, blockedBy, ready: mine?.ready ?? null, key, now: Date.now() });
  const failed = errorShown(errors, dir, key ?? "status");

  const fail = (message: string) => {
    errors = raise(errors, dir, key ?? "status", message);
    tick((n) => n + 1);
  };
  // The composer opens only on a confirmed answer; a stale one is read again first.
  const open = async () => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; // before the state change that opens the form
    errors = dismiss(errors, dir);
    if (blockedBy !== null) return;
    let now: { status: Status; ready: Readiness } | null = mine;
    if (!now || !confirmed(now.ready, readinessKey(dir, now.status), Date.now())) now = await check();
    if (!now || now.ready.reason !== null) return tick((n) => n + 1);
    session.current++;
    focusTitle.current = true;
    setDraftFor(startDraft(drafts, dir, { title: "", body: "", base: (now.status.base ?? "").replace(/^origin\//, ""), draft: false }));
    prepareComposer();
  };
  /** What the open composer needs: the branch suggestions for Base and whether the AI draft button is offered. */
  function prepareComposer() {
    invoke<string[]>("worktree_branches", { path: dir }).then((b) => asking.current === dir && setBranches(b), () => setBranches([]));
    setAiOffered(false);
    setWriteNote(null);
    void offerDraft();
  }
  /** Closes the composer. `keep` leaves what was typed for the next time (Escape); Cancel throws it away. Focus goes back to the button that opened it. */
  const closeComposer = (keep: boolean) => {
    session.current++;
    if (keep) hideDraft(drafts, dir);
    else keepDraft(drafts, dir, null);
    setDraft(null);
    setWriteNote(null);
    queueMicrotask(() => {
      const prev = opener.current;
      const again = document.querySelector<HTMLElement>("[data-pr-start] [data-pr-open]"); // the button is drawn again once the form is gone
      restoreFocus(prev && prev.isConnected ? prev : again, (sel) => document.querySelector<HTMLElement>(sel));
    });
  };
  // Escape closes the form only when pressed inside it (never taken from a terminal or anything else in the app); a list open inside it (the Base suggestions) takes the key first.
  const composerOpen = draft !== null;
  const formKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (busy || !escapeClosesForm(e, !!e.currentTarget.querySelector("[aria-expanded='true']"))) return;
    e.stopPropagation();
    e.preventDefault();
    closeComposer(true);
  };
  // The title box takes focus when the user opens the form (not when a kept form comes back with its folder).
  useEffect(() => {
    if (composerOpen && focusTitle.current) {
      focusTitle.current = false;
      titleBox.current?.focus();
    }
  }, [composerOpen]);
  const readGate = () => readDraftGate(dir);
  const offerDraft = async () => {
    const { settings, gate } = await readGate();
    if (asking.current === dir) setAiOffered(draftOffered(settings, gate.repo, gate.agents));
  };
  // GIT-024: the writer fills title and description; a failure is shown and the typed text stays.
  const write = async (d: Draft) => {
    const snap = { title: d.title, body: d.body };
    const started = session.current;
    setStarting(dir);
    setWriteNote(null);
    const { settings, gate } = await readGate();
    const pending = draftPrText(dir, d.base.trim(), settings, gate); // registers the run before its first await
    setStarting((s) => (s === dir ? null : s)); // another worktree's click may have taken the slot meanwhile
    const result = await pending;
    if (asking.current === dir) {
      if (result.state === "off") setAiOffered(false);
      if (session.current === started) {
        if (result.state === "off") setWriteNote("Writing with AI is switched off or has no usable writer, so nothing was written.");
        if (result.state === "failed") setWriteNote(result.message);
        if (result.state === "busy") setWriteNote("A draft is already being written for this workspace.");
      }
      // A composer closed (Escape keeps the draft) or reopened meanwhile keeps what it has: the finished write never touches the book then.
      if (writeMayTouchDraft(started, session.current)) {
        const out = settleDraft(latest.current, snap, result, started, session.current);
        setDraftFor(out.draft);
        if (out.note) setWriteNote(out.note);
      }
    }
  };
  const create = async (d: Draft, push: "none" | "publish" | "push") => {
    setBusy(true);
    errors = dismiss(errors, dir);
    try {
      if (push !== "none") {
        const out = await invoke<ActionOutcome>("scm_remote", { worktree: dir, action: push });
        if (!out.ok) return fail(`The push failed, so no pull request was created: ${out.output}`);
      }
      const pr = await invoke<Pr>("scm_pr_create", { worktree: dir, title: d.title, body: d.body, base: d.base, draft: d.draft });
      session.current++;
      setDraftFor(null);
      onCreated(pr);
    } catch (err) {
      fail(String(err));
    } finally {
      setBusy(false);
    }
  };
  const writingNow = starting === dir || draftRunning(dir); // the shared run set, so a remounted composer never shows a stuck or missing "Writing…"
  const push = mine && mine.ready.reason === null ? mine.ready.push : "none";
  // GIT-022: with work still to commit or push, one click does all of it and opens the review.
  const oneClick = async () => {
    errors = dismiss(errors, dir);
    if (blockedBy !== null) return;
    const { settings, gate } = await readGate();
    const done = await startGatedOneClick(dir, settings, gate);
    if (done.state === "done" && done.pr) onCreated(done.pr);
    void check();
  };

  return (
    <div className="pr-start" data-pr-start>
      {facts ? (
        <div className="pr-start-review" data-pr-review={facts.lookup.kind}>
          {reviewLines(facts, blockedBy !== null).map((line, i) => (
            <div key={i} className={facts.lookup.kind === "failed" && i === 0 ? "note warn" : "sb-hint"}>
              {line}
            </div>
          ))}
          {facts.lookup.kind === "found" && (
            <button type="button" className="btn" data-pr-linked-open onClick={() => void invoke("open_external", { url: facts.lookup.kind === "found" ? facts.lookup.pr.url : "" }).catch((err) => fail(String(err)))}>
              Open pull request
            </button>
          )}
        </div>
      ) : (
        <div className="sb-hint">{reviewAsk === null ? "There is no review for this branch: it has no pull request." : "Looking for this branch's pull request…"}</div>
      )}
      {failed && (
        <div className="note error" role="alert">
          {failed}
        </div>
      )}
      {!draft && !linkedPr && blockHint(offer, lookup) !== null && <div className="sb-hint">{blockHint(offer, lookup)}</div>}
      {mine && !draft && canStartReview(blockedBy, !!linkedPr) && offer.kind === "blocked" && going?.state !== "running" && needsOneClick(mine.status) && (
        <button className="btn primary" data-pr-one-click onClick={() => void oneClick()}>
          Commit, push and create pull request
        </button>
      )}
      <OneClickNotice dir={dir} />
      {offer.kind === "check" && !failed && <div className="sb-hint">Checking whether this branch is ready…</div>}
      {(offer.kind === "create" || offer.kind === "push-create") && !draft && (
        <button className="btn primary" data-pr-open onClick={() => void open()}>
          {offer.kind === "push-create" ? (offer.push === "publish" ? "Publish branch and create pull request" : "Push and create pull request") : "Create pull request"}
        </button>
      )}
      {draft && (
        <div className="scm-ask scm-pr" role="dialog" aria-label="Create pull request" onKeyDown={formKey}>
          <input ref={titleBox} className="field" aria-label="pull request title" placeholder="Title" value={draft.title} onChange={(e) => setDraftFor({ ...draft, title: e.target.value })} />
          <textarea className="field multi" aria-label="pull request description" placeholder="Description" value={draft.body} onChange={(e) => setDraftFor({ ...draft, body: e.target.value })} />
          {aiOffered && (
            <div className="btn-row">
              <button className="btn" data-pr-draft disabled={writingNow || busy || !draft.base.trim()} title="Write the title and description from this branch's changes" onClick={() => void write(draft)}>
                {writingNow ? "Writing…" : "Write with AI"}
              </button>
            </div>
          )}
          {writeNote && (
            <div className="note warn" role="status">
              {writeNote}
            </div>
          )}
          <label className="scm-pr-base">
            <span>Base</span>
            <SearchPick items={branches} label="base branch" value={draft.base} onChange={(base) => setDraftFor({ ...draft, base })} />
          </label>
          <label className="conn-switch">
            <input type="checkbox" checked={draft.draft} onChange={(e) => setDraftFor({ ...draft, draft: e.target.checked })} />
            <span>Open as a draft</span>
          </label>
          <div className="btn-row">
            <button className="btn primary" data-pr-create disabled={busy || !draft.title.trim() || !draft.base.trim()} title={!draft.title.trim() ? "Write a title first" : undefined} onClick={() => void create(draft, push)}>
              {busy ? "Creating…" : `${push === "none" ? "Create" : "Push and create"}${draft.draft ? " draft" : ""} pull request`}
            </button>
            <button className="btn" data-pr-cancel onClick={() => closeComposer(false)}>
              Cancel
            </button>
          </div>
          <div className="sb-hint">Esc closes this form and keeps what you typed; Cancel clears it.</div>
        </div>
      )}
    </div>
  );
}
