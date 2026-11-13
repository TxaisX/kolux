// SAFE-002..004: the plan review sheet. It slides in from the right with the plan as formatted
// markdown, one block per section; each block takes comments, a note sits at the foot, and the
// two answers are Approve and Request changes. SAFE-006: a plan cut to fit says so; SAFE-007: once
// the pane stops waiting on this plan, the sheet says the prompt closed and both answers go dead.
import { useMemo, useState } from "react";
import { renderMarkdown } from "../editor/PreviewPane";
import { Dialog } from "../ui/Dialog";
import type { CloseWhy } from "../ui/layer";
import { canRequest, planSections, sectionQuote, type PlanDraft } from "./planReview";

type Props = {
  title: string;
  plan: string;
  draft: PlanDraft;
  onDraft: (d: PlanDraft) => void;
  onApprove: () => void;
  onRequest: () => void;
  onClose: () => void;
  /** SAFE-006: the plan was trimmed to fit its status update. */
  cut?: boolean;
  /** SAFE-007: the pane no longer waits on this plan. */
  closed?: boolean;
  /** T-032-b: Request changes is waiting to send; both answers are held and Cancel stops it. */
  sending?: boolean;
  onCancel?: () => void;
};

export default function PlanSheet({ title, plan, draft, onDraft, onApprove, onRequest, onClose, cut = false, closed = false, sending = false, onCancel }: Props) {
  const sections = useMemo(() => planSections(plan), [plan]);
  const [writing, setWriting] = useState<number | null>(null);
  const [text, setText] = useState("");
  // T-032-b: closing while a send waits stops that send first, so it never runs on with its Cancel gone.
  const close = () => {
    if (sending) onCancel?.();
    onClose();
  };
  // The sheet sits beside the terminal, which stays usable while it is open: a press outside it does not close it.
  // Escape does (src/ui's layer, from anywhere), and Close.
  const dismiss = (why: CloseWhy) => why !== "outside" && close();
  const add = (i: number) => {
    const s = sections[i];
    if (!text.trim()) return;
    onDraft({ ...draft, comments: [...draft.comments, { id: `${s.start}-${Date.now()}`, start: s.start, end: s.end, quote: sectionQuote(s.text), text: text.trim() }] });
    setText("");
    setWriting(null);
  };
  const range = (s: { start: number; end: number }) => (s.start === s.end ? `Line ${s.start}` : `Lines ${s.start}-${s.end}`);
  const count = draft.comments.length;
  return (
    <Dialog modal={false} onClose={dismiss} label={`Review the plan for ${title}`} className="plan-sheet" initialFocus={false}>
      <header className="plan-sheet-head">
        <h3>Review the plan</h3>
        <span className="muted">{title}</span>
        <button className="btn" onClick={close} title={sending ? "Close (Esc) stops the waiting send; your feedback is kept" : "Close (Esc); comments are kept for this plan"}>
          Close
        </button>
      </header>
      {closed && (
        <div className="note warn plan-sheet-note" role="status">
          The plan prompt has closed, so this plan can no longer be approved or sent back. Your comments are kept.
        </div>
      )}
      {sending && (
        <div className="note plan-sheet-note" role="status">
          Sending your feedback: Claude&apos;s plan prompt is dismissed first, then your feedback is typed and sent a moment later. Cancel, Close or Esc stops it before it is sent, though it may already be typed in Claude&apos;s prompt.
        </div>
      )}
      {cut && <div className="note plan-sheet-note">This plan is too long to show whole, so it is cut short here. The whole plan is in the terminal.</div>}
      <div className="plan-sheet-body">
        {sections.length === 0 && <p className="muted">The plan is empty.</p>}
        {sections.map((s, i) => (
          <section key={s.start} className="plan-block" aria-label={range(s)}>
            <div className="plan-block-head">
              <span className="muted">{range(s)}</span>
              {writing !== i && (
                <button className="btn link" onClick={() => (setWriting(i), setText(""))}>
                  Add comment
                </button>
              )}
            </div>
            <div className="md-preview" onClick={(e) => (e.target as HTMLElement).closest("a") && e.preventDefault()} dangerouslySetInnerHTML={{ __html: renderMarkdown(s.text) }} />
            {draft.comments
              .filter((c) => c.start === s.start)
              .map((c) => (
                <div key={c.id} className="plan-comment">
                  <span>{c.text}</span>
                  <button className="btn link" onClick={() => onDraft({ ...draft, comments: draft.comments.filter((x) => x.id !== c.id) })}>
                    Remove
                  </button>
                </div>
              ))}
            {writing === i && (
              <div className="plan-write">
                <textarea autoFocus aria-label={`Comment on ${range(s)}`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && add(i)} />
                <button className="btn" disabled={!text.trim()} onClick={() => add(i)}>
                  Add
                </button>
                <button className="btn link" onClick={() => setWriting(null)}>
                  Cancel
                </button>
              </div>
            )}
          </section>
        ))}
      </div>
      <footer className="plan-sheet-foot">
        <textarea aria-label="Overall feedback" placeholder="Overall feedback (optional)" value={draft.note} onChange={(e) => onDraft({ ...draft, note: e.target.value })} />
        <div className="plan-sheet-actions">
          {sending && onCancel && (
            <button className="btn" onClick={onCancel}>
              Cancel sending
            </button>
          )}
          <button className="btn" disabled={sending || closed || !canRequest(draft.comments, draft.note)} onClick={onRequest}>
            {sending ? "Sending…" : count > 0 ? `Request changes (${count})` : "Request changes"}
          </button>
          <button className="btn primary" disabled={sending || closed} onClick={onApprove}>
            Approve
          </button>
        </div>
      </footer>
    </Dialog>
  );
}
