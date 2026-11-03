// The Inbox view (STAT-050): three groups of rows on the left, the selected item's detail on the
// right. Up and Down walk the rows, Enter opens the selected one in its terminal pane. The rows
// come from `inboxItems` in inbox.ts; the detail reads the pane's history and the worktree's
// source-control status through the commands the window already has.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { changesLine, exitNote, fromDetail, GROUPS, moveSelection, openLabel, settle, type Item } from "./inbox";
import { VOCAB } from "../terminal/status";
import { StatusGlyph } from "../chrome/icons";
import type { Agent } from "../chrome/VendorMark";
import { programWord } from "../launch/PlusMenu";
import { folderName } from "../projects/model";
import type { Status } from "../scm/model";
import { canReview } from "../board/review";

type Entry = { state: string; prompt?: string; started: number; interrupted: boolean };
/** `onReview` (T-609): Review changes on a done row opens that worktree's All Changes (board/review.ts). */
type Props = { items: Item[]; now: number; onOpen: (key: number) => void; onReview?: (key: number) => void };

/** "just now", "3m ago", "1h ago". */
function ago(when: number, now: number): string {
  if (when <= 0) return "";
  const m = Math.floor((now - when) / 60_000);
  if (m < 1) return "just now";
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

export default function InboxView({ items, now, onOpen, onReview }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const keys = items.map((i) => i.key);
  const current = settle(keys, selected);
  const item = items.find((i) => i.key === current) ?? null;
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current?.focus(), []);
  // Arrow keys move the selection past the visible rows, so the selected row is scrolled into view.
  useEffect(() => {
    if (current !== null) document.getElementById(`inbox-${current}`)?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (fromDetail(e.target as HTMLElement | null)) return; // Enter and Space on a detail button belong to that button
    if (e.key === "ArrowDown" || e.key === "ArrowUp") setSelected(moveSelection(keys, current, e.key === "ArrowDown" ? 1 : -1));
    else if (e.key === "Enter" && current !== null) onOpen(current);
    else return;
    e.preventDefault();
  };

  const needs = items.filter((i) => i.group === "needs");
  return (
    <div className="inbox" ref={root} tabIndex={0} role="listbox" aria-label="Inbox" aria-activedescendant={current === null ? undefined : `inbox-${current}`} onKeyDown={onKeyDown}>
      <div className="list">
        {needs.length === 0 && (
          <div className="clear" role="status">
            <StatusGlyph glyph="check" size={14} />
            All clear. Nothing needs you.
          </div>
        )}
        {GROUPS.map((g) => {
          const rows = items.filter((i) => i.group === g.id);
          if (rows.length === 0) return null;
          return (
            <section key={g.id} aria-label={g.title}>
              <h3 title={g.about}>{g.title}</h3>
              {rows.map((i) => (
                <div key={i.key} id={`inbox-${i.key}`} role="option" aria-selected={i.key === current} className={`row ${VOCAB[i.state].tone}`} onClick={() => setSelected(i.key)} onDoubleClick={() => onOpen(i.key)}>
                  <span className="st" data-tip={VOCAB[i.state].explain}>
                    <StatusGlyph glyph={VOCAB[i.state].glyph} size={12} />
                  </span>
                  <span className="name">{i.title}</span>
                  <span className="lbl">{i.label}</span>
                  <span className="when">{ago(i.when, now)}</span>
                </div>
              ))}
            </section>
          );
        })}
      </div>
      {item ? <Detail item={item} onOpen={() => onOpen(item.key)} onReview={onReview && (() => onReview(item.key))} /> : <div className="detail empty">{items.length === 0 ? "Sessions show up here as they ask, run and finish." : "Pick a row, or press Down."}</div>}
    </div>
  );
}

// EDIT-041 (T-035-c): a prompt read off the pane's screen, with the answers it takes on the spot.
type Readable = { prompt: { kind: string; text: string; options: string[] }; choices: { label: string; keys: string }[] };

/** The detail's buttons: Open (or Answer) in Code, and T-609's Review changes on a done row with a workspace.
 *  A plain render helper (no hooks), drawn inline so the detail stays one tree. */
export function detailActions({ item, onOpen, onReview, changed = null }: { item: Item; onOpen: () => void; onReview?: () => void; changed?: number | null }) {
  return (
    <div className="actions">
      <button className="btn primary" onClick={onOpen} title="Go to the tab and pane where this agent runs (Enter)">
        {openLabel(item)}
      </button>
      {canReview(item.group, changed) && item.cwd && onReview && (
        <button className="btn" onClick={onReview} title="Read every file this agent changed, in All Changes">
          Review changes
        </button>
      )}
    </div>
  );
}

function Detail({ item, onOpen, onReview }: { item: Item; onOpen: () => void; onReview?: () => void }) {
  const [scm, setScm] = useState<Status | null>(null);
  const [last, setLast] = useState<Entry | null>(null);
  const [readable, setReadable] = useState<Readable | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [scmError, setScmError] = useState<string | null>(null);
  // T-035-c: a question or permission whose terminal is alive is read off its screen; when the
  // menu's keys are sure, the detail offers its options here, else only Answer in Code.
  const canRead = item.group === "needs" && !item.exited;
  useEffect(() => {
    setReadable(null);
    setNote(null);
    if (!canRead) return;
    invoke<Readable | null>("prompt_read", { paneKey: item.key }).then(setReadable).catch(() => setReadable(null));
  }, [item.key, item.state, canRead]);
  const answer = (choice: number) => {
    if (!readable) return;
    const text = readable.prompt.text;
    const label = readable.choices[choice]?.label ?? "";
    setReadable(null);
    invoke("prompt_answer", { paneKey: item.key, text, choice }).then(
      () => setNote(`Answered: ${label}`),
      (e) => setNote(typeof e === "string" ? e : "The answer did not reach the pane; answer it in Code."),
    );
  };
  useEffect(() => {
    setScm(null);
    setScmError(null);
    setLast(null);
    if (item.cwd) invoke<Status>("scm_status", { worktree: item.cwd }).then(setScm).catch((e) => setScmError(typeof e === "string" ? e : e instanceof Error ? e.message : "the status command failed"));
    invoke<Entry[]>("agent_history", { paneKey: item.key })
      .then((h) => setLast([...h].reverse().find((e) => e.prompt) ?? null))
      .catch(() => setLast(null));
  }, [item.key, item.cwd, item.state]);
  const changed = scm ? scm.staged.length + scm.changed.length + scm.untracked.length + scm.conflicts.length : null;
  const v = VOCAB[item.state];
  return (
    <div className="detail">
      <h2>
        {item.title}
        <span className={`status ${v.tone}`}>{item.label === "Done" ? v.word : item.label}</span>
      </h2>
      <dl>
        <dt>Agent</dt>
        <dd>{programWord(item.agent as Agent)}</dd>
        <dt>Branch</dt>
        <dd>{item.branch ?? scm?.branch ?? "—"}</dd>
        <dt>Workspace</dt>
        <dd>{item.cwd ? folderName(item.cwd) : "—"}</dd>
        <dt>Changes</dt>
        <dd>{changesLine({ hasCwd: !!item.cwd, changed, staged: scm?.staged.length ?? 0, failed: scmError })}</dd>
        {last?.prompt && (
          <>
            <dt>Prompt</dt>
            <dd className="prompt">{last.prompt}</dd>
          </>
        )}
      </dl>
      {exitNote(item) && <p className="exited">{exitNote(item)}</p>}
      {readable && (
        <div className="actions" data-prompt={readable.prompt.kind}>
          <span className="prompt">{readable.prompt.text}</span>
          {readable.choices.map((c, i) => (
            <button key={i} className="btn" onClick={() => answer(i)} title={`Type the answer into the agent's pane: ${c.label}`}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {note && <p className="exited">{note}</p>}
      {detailActions({ item, onOpen, onReview, changed })}
    </div>
  );
}
