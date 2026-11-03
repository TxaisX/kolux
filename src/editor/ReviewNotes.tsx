// GIT-042: the note popover beside the selection and the tray that keeps the notes until they are
// copied as one Markdown block. EDIT-020: or sent to an agent running in this worktree, picked
// from the Send menu.
import { useState } from "react";
import { useMenuKeys } from "./menuKeys";
import { Close } from "../chrome/icons";
import { baseName } from "./buffers";
import { notesMarkdown, type Note, type Picked, type SendTarget, type StartChoice } from "./notes";

/** What the tray says about copying; the failure text points at the Markdown below, which the tray then shows. */
export const COPY_OK = "Copied the notes as Markdown";
export const COPY_FAILED = "Could not copy; select the text below instead";
/** What the tray says when a send or a start threw instead of answering. */
export const sendThrew = (e: unknown) => `The notes were not sent, so they are kept: ${e instanceof Error ? e.message : String(e)}`;

type Props = {
  picked: Picked | null;
  notes: Note[];
  onAdd: (n: Note) => void;
  onCancel: () => void;
  onRemove: (i: number) => void;
  onClear: () => void;
  /** EDIT-020: the Send menu's agents, and whether the menu is open. */
  targets: SendTarget[];
  menu: boolean;
  onMenu: (open: boolean) => void;
  /** Sends every note to that agent; the promise gives the reason when nothing was sent. */
  onSend: (key: number) => Promise<string | null>;
  /** EDIT-020: the agents the menu can start with the notes as the first prompt, and the start. */
  starters?: StartChoice[];
  onStart?: (id: string) => Promise<string | null>;
};

export default function ReviewNotes({ picked, notes, onAdd, onCancel, onRemove, onClear, targets, menu, onMenu, onSend, starters = [], onStart }: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [sure, setSure] = useState(false); // the X asks once before it drops every note
  const { box, remember } = useMenuKeys(menu, () => onMenu(false));
  // A send or a start that throws says so in the tray instead of leaving an unhandled rejection.
  const go = async (run: () => Promise<string | null>) => {
    onMenu(false);
    try {
      setSaid(await run());
    } catch (e) {
      setSaid(sendThrew(e));
    }
  };
  const add = () => {
    if (!picked || !text.trim()) return;
    onAdd({ ...picked.draft, note: text, time: Date.now() });
    setText("");
  };
  const copy = () =>
    navigator.clipboard.writeText(notesMarkdown(notes)).then(
      () => setSaid(COPY_OK),
      () => (setOpen(true), setSaid(COPY_FAILED)),
    );
  return (
    <>
      {picked && (
        <div className="review-pop" role="dialog" aria-label="Add review note" style={{ left: Math.min(picked.x, window.innerWidth - 340), top: Math.min(picked.y + 6, window.innerHeight - 220) }}>
          <div className="review-where">
            {baseName(picked.draft.path)} line {picked.draft.line}
          </div>
          <blockquote className="review-quote">{picked.draft.quote}</blockquote>
          <textarea
            className="field multi"
            aria-label="review note"
            placeholder="Note for the agent"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add();
            }}
          />
          <div className="btn-row">
            <button className="btn primary" data-note-add disabled={!text.trim()} onClick={add}>
              Add note
            </button>
            <button className="btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {notes.length > 0 && (
        <div className="review-tray" role="region" aria-label="Review notes">
          <div className="review-head">
            <button className="review-count" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {notes.length === 1 ? "1 review note" : `${notes.length} review notes`}
            </button>
            <button
              className="btn primary"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={(e) => {
                remember(e.currentTarget); // before the menu opens: its first row takes focus at once
                onMenu(!menu);
              }}
            >
              Send…
            </button>
            <button className="btn" data-notes-copy onClick={() => void copy()}>
              Copy as Markdown
            </button>
            <button className="ib" title="Clear the notes" aria-label="Clear all notes" onClick={() => setSure(true)}>
              <Close size={12} />
            </button>
          </div>
          {sure && (
            <div className="sb-hint" role="alert">
              Clear all {notes.length === 1 ? "1 note" : `${notes.length} notes`}? This cannot be undone.
              <span className="btn-row">
                <button className="btn" autoFocus onClick={() => setSure(false)}>
                  Keep them
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setSure(false);
                    onClear();
                  }}
                >
                  Clear all
                </button>
              </span>
            </div>
          )}
          {menu && (
            <div ref={box} className="review-send" role="menu" aria-label="Send the notes to">
              {targets.length === 0 && <div className="sb-hint">{starters.length > 0 && onStart ? "No agent is running in this worktree. Start one below, or copy the notes instead." : "No agent is running in this worktree. Start one, or copy the notes instead."}</div>}
              {targets.map((t) => (
                <button
                  key={t.key}
                  role="menuitem"
                  className="review-send-item"
                  onClick={() => void go(() => onSend(t.key))}
                >
                  <span className="name">{t.label}</span>
                  <span className="muted">{t.since}</span>
                </button>
              ))}
              {onStart && starters.length > 0 && (
                <>
                  <div className="review-send-head muted">Start a new agent</div>
                  {starters.map((s) => (
                    <button
                      key={s.id}
                      role="menuitem"
                      className="review-send-item"
                      data-start-agent={s.id}
                      onClick={() => void go(() => onStart(s.id))}
                    >
                      <span className="name">{s.label}</span>
                      <span className="muted">new</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
          {said && <div className="sb-hint">{said}</div>}
          {open && <pre className="review-md" data-notes-markdown>{notesMarkdown(notes)}</pre>}
          {open &&
            notes.map((n, i) => (
              <div key={n.time + n.path + i} className="review-row">
                <span className="where">
                  {baseName(n.path)}:{n.line}
                </span>
                <span className="txt">{n.note}</span>
                <button className="ib" title="Remove this note" aria-label={`Remove the note on ${baseName(n.path)} line ${n.line}`} onClick={() => onRemove(i)}>
                  <Close size={10} />
                </button>
              </div>
            ))}
        </div>
      )}
    </>
  );
}
