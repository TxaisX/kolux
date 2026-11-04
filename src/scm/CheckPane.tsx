// T-235-b (EDIT-030): a CI check's tab, opened from the Checks panel: the check's steps with their status,
// its annotations (a click opens that file at that line, only inside the worktree), a button that copies the
// whole card, and Fix with AI for a failed check whose pull request is open. The header carries the check's
// name and no path. One tab per check per worktree (paneActions.openCheck).
import { useKeymap } from "../keys/KeymapContext";
import { withChord } from "../terminal/PaneMenu";
import { labelOf } from "../keys/keymap";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { Close, CheckCircle } from "../chrome/icons";
import { fixText } from "../tasks/prModel";
import type { CheckDetail, CheckRef } from "./checkCard";
import { asPrCheck, cardText, checkKey, fixBlockerFor, insideWorktree } from "./checkText";
import { REFRESH, RETRY } from "./panelUx";
import "./scmUx.css";

type CardProps = {
  check: CheckRef;
  cwd: string;
  detail: CheckDetail | null;
  error: string | null;
  loading: boolean;
  /** Why Fix with AI is off, or null when it can go. */
  fixBlocker: string | null;
  busy: boolean;
  note: string | null;
  onCopy: () => void;
  onFix: () => void;
  onOpenFile: (path: string, line?: number) => void;
  /** Reads the check again. Without it the card has no Refresh or Retry (a card drawn from fixed data). */
  onRefresh?: () => void;
};

const OUTSIDE = "Outside this workspace, so it is not opened.";

/** The card itself: no state of its own, so it can be drawn from any data. */
export function CheckCard({ check, cwd, detail, error, loading, fixBlocker, busy, note, onCopy, onFix, onOpenFile, onRefresh }: CardProps) {
  return (
    <div className="pane-body check-card" data-check-card>
      <div className="check-card-head">
        <span className={`check-dot ${check.outcome}`} aria-hidden="true" />
        <strong className="check-card-name">{check.name}</strong>
        {check.workflow && <span className="wf">{check.workflow}</span>}
        <span className={`word ${check.outcome}`}>{check.outcome}</span>
        {check.pr && <span className="sb-hint">Pull request #{check.pr.number}</span>}
      </div>
      <div className="check-card-actions">
        <button className="btn" data-copy-card onClick={onCopy} title="Copy this whole card as text">
          Copy card
        </button>
        <button className="btn" data-fix-ai disabled={busy || fixBlocker !== null} title={fixBlocker ?? "Send this check's failing output to the workspace's agent"} onClick={onFix}>
          Fix with AI
        </button>
        {onRefresh && (
          <button className="btn" data-refresh disabled={loading} title="Read this check again" onClick={onRefresh}>
            {loading ? "Reading…" : REFRESH}
          </button>
        )}
        {fixBlocker && <span className="sb-hint" data-fix-reason>{fixBlocker}</span>}
      </div>
      {note && <div className="note">{note}</div>}
      {error ? (
        <div className="note error" role="alert">
          The check could not be read: {error}{" "}
          {onRefresh && (
            <button className="btn" data-retry disabled={loading} onClick={onRefresh}>
              {RETRY}
            </button>
          )}
        </div>
      ) : loading || !detail ? (
        <div className="sb-hint">Reading the check…</div>
      ) : (
        <>
          <section data-steps>
            <h4 className="check-group-title">
              Steps <span className="count">{detail.steps.length}</span>
            </h4>
            {detail.steps.length === 0 ? (
              <div className="sb-hint">No steps reported.</div>
            ) : (
              <ol className="check-steps">
                {detail.steps.map((s) => (
                  <li key={s.number} className="check-step" data-step={s.number}>
                    <span className={`check-dot ${stepDot(s.conclusion, s.status)}`} aria-hidden="true" />
                    <span className="name">
                      {s.number}. {s.name}
                    </span>
                    <span className="word">{s.conclusion ?? s.status}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section data-annotations>
            <h4 className="check-group-title">
              Annotations <span className="count">{detail.annotations.length}</span>
            </h4>
            {detail.annotations.length === 0 ? (
              <div className="sb-hint">No annotations.</div>
            ) : (
              detail.annotations.map((a, i) => {
                const file = insideWorktree(cwd, a.path);
                return (
                  <div key={i} className="check-annot" data-annotation-row>
                    <div className="check-annot-head">
                      <span className="word">{a.level}</span>
                      <button className="btn" data-annotation={String(i)} disabled={file === null} title={file === null ? OUTSIDE : `Open ${a.path} at line ${a.startLine}`} onClick={() => file !== null && onOpenFile(file, a.startLine > 0 ? a.startLine : undefined)}>
                        {`${a.path}:${a.startLine}`}
                      </button>
                      {file === null && <span className="sb-hint">{OUTSIDE}</span>}
                    </div>
                    {a.title && <strong>{a.title}</strong>}
                    <div className="check-annot-msg">{a.message}</div>
                  </div>
                );
              })
            )}
          </section>
        </>
      )}
    </div>
  );
}

const stepDot = (conclusion: string | null, status: string): string => (conclusion === "success" ? "passed" : conclusion === "failure" || conclusion === "cancelled" || conclusion === "timed_out" ? "failed" : conclusion === null && status !== "queued" ? "running" : "unresolved");

type Props = {
  id: number;
  check: CheckRef;
  cwd: string;
  hidden: boolean;
  focused: boolean;
  onFocus: () => void;
  onClose: () => void;
  onOpenFile: (path: string, line?: number) => void;
  onToast: (text: string) => void;
};

export default function CheckPane({ id, check, cwd, hidden, focused, onFocus, onClose, onOpenFile, onToast }: Props) {
  const keymap = useKeymap();
  const [detail, setDetail] = useState<CheckDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [again, setAgain] = useState(0); // bumped by Refresh and Retry
  const asked = useRef(0);
  useEffect(() => {
    const mine = ++asked.current;
    setLoading(true);
    invoke<CheckDetail>("scm_check_detail", { worktree: cwd, link: check.link, checkId: check.id })
      .then((d) => mine === asked.current && (setDetail(d), setError(null)))
      .catch((e) => mine === asked.current && setError(String(e)))
      .finally(() => mine === asked.current && setLoading(false));
    return () => void ++asked.current;
  }, [cwd, check.id, check.link, check.outcome, again]);

  const copy = () => {
    const text = cardText(check, detail);
    navigator.clipboard?.writeText(text).then(() => onToast("Copied the check card."), () => onToast("The card could not be copied."));
  };
  const fix = async () => {
    setBusy(true);
    setNote(null);
    try {
      const log = await invoke<string>("scm_check_log", { worktree: cwd, link: check.link });
      await invoke("scm_review_send", { worktree: cwd, text: fixText(asPrCheck(check), log) });
      setNote(`Sent the failing output of "${check.name}" to the workspace's agent.`);
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`pane editor check-pane${focused ? " focused" : ""}`} hidden={hidden} aria-label={`Check ${check.name}`} onMouseDown={onFocus} data-kind="check" data-key={id} data-check-key={checkKey(cwd, check.id)} tabIndex={-1}>
      <header className="pane-head">
        <span className="agent-mark" title="CI check">
          <CheckCircle size={13} />
        </span>
        <span className="title">{check.name}</span>
        <span className="preview-tag">Check</span>
        <span className="right">
          <button className="ib" onClick={onClose} title={withChord("Close tab", labelOf(keymap, "tab.close"))} aria-label={`Close the ${check.name} check tab`}>
            <Close size={12} />
          </button>
        </span>
      </header>
      <CheckCard check={check} cwd={cwd} detail={detail} error={error} loading={loading} fixBlocker={fixBlockerFor(check, cwd)} busy={busy} note={note} onCopy={copy} onFix={() => void fix()} onOpenFile={onOpenFile} onRefresh={() => setAgain((n) => n + 1)} />
    </section>
  );
}
