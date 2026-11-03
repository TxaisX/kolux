// EDIT-020 (T-132-b): review notes in a margin rail beside the rich Markdown view, each tied to the
// text it quotes. The rail follows the document's scroll; a click on a card brings its text into view.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Close } from "../chrome/icons";
import type { Note } from "./notes";
import { placeRail, quoteTop, railEdit, railItems } from "./rail";

/** The least a card takes in px, and what it counts as before it is measured; a longer note makes its card grow. */
export const CARD_HEIGHT = 58;

/** Whether a key press brings a card's text into view, as a click on the card does: Enter or Space on the card itself
 *  (not on a button or box inside it, which keep their own keys). */
export function cardKey(key: string, onCard: boolean): boolean {
  return onCard && (key === "Enter" || key === " ");
}

type Props = {
  host: RefObject<HTMLElement | null>;
  notes: Note[];
  /** The note's text, so a change in the document re-places the cards. */
  version: string;
  onRemove?: (n: Note) => void;
  /** Saves a card edited in place; the new text is trimmed and never empty. */
  onEdit?: (n: Note, text: string) => void;
};

export default function NoteRail({ host, notes, version, onRemove, onEdit }: Props) {
  const [tops, setTops] = useState<Record<string, number>>({});
  const [scroll, setScroll] = useState(0);
  const [frame, setFrame] = useState({ top: 0, height: 0 });
  const [heights, setHeights] = useState<number[]>([]);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const [editing, setEditing] = useState<{ note: Note; draft: string; refused: boolean } | null>(null);
  // A card is as tall as its text (or its edit box), measured after every render; unchanged heights set nothing.
  useLayoutEffect(() => {
    const h = notes.map((_, i) => Math.max(CARD_HEIGHT, cards.current[i]?.offsetHeight ?? CARD_HEIGHT));
    setHeights((old) => (old.length === h.length && old.every((v, i) => v === h[i]) ? old : h));
  });
  const save = () => {
    if (!editing) return;
    const r = railEdit(editing.draft, editing.note.note);
    if ("refused" in r) return setEditing({ ...editing, refused: true });
    if ("save" in r) onEdit?.(editing.note, r.save);
    setEditing(null);
  };
  const place = () => {
    const el = host.current;
    if (!el) return;
    setFrame({ top: el.offsetTop, height: el.clientHeight });
    setScroll(el.scrollTop);
    setTops(placeRail(railItems(notes, notes.map((n) => quoteTop(el, n.quote)), notes.map((_, i) => heights[i] ?? CARD_HEIGHT))));
  };
  useLayoutEffect(place, [notes, version, heights]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onScroll = () => setScroll(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", place);
    };
  }, [host, notes]);
  const items = railItems(notes, notes.map(() => null), CARD_HEIGHT);
  const bringIntoView = (top: number) => host.current && host.current.scrollTo({ top: Math.max(0, top - 40), behavior: "smooth" });
  return (
    <div className="note-rail" role="complementary" aria-label="Review notes" style={{ top: frame.top, height: frame.height }}>
      {notes.map((n, i) => {
        const top = tops[items[i].id] ?? i * (CARD_HEIGHT + 6);
        const mine = editing?.note === n ? editing : null;
        return (
          <div
            key={`${n.time}:${i}`}
            ref={(el) => void (cards.current[i] = el)}
            className="rail-card"
            role="group"
            tabIndex={0}
            aria-label={`Review note on line ${n.line}`}
            title="Click, or press Enter, to show the text this note is about"
            style={{ transform: `translateY(${top - scroll}px)`, minHeight: CARD_HEIGHT }}
            onClick={() => !mine && bringIntoView(top)}
            onKeyDown={(e) => {
              if (!mine && cardKey(e.key, e.target === e.currentTarget)) (e.preventDefault(), bringIntoView(top));
            }}
          >
            <span className="rail-where">
              Line {n.line}
              {onEdit && !mine && (
                <button
                  className="link rail-edit"
                  title="Edit this note"
                  aria-label="Edit this note"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing({ note: n, draft: n.note, refused: false });
                  }}
                >
                  Edit
                </button>
              )}
            </span>
            {mine ? (
              <div className="rail-editor" onClick={(e) => e.stopPropagation()}>
                <textarea
                  className="field multi"
                  aria-label="Edit the note"
                  autoFocus
                  rows={Math.min(8, mine.draft.split("\n").length + 1)}
                  value={mine.draft}
                  onChange={(e) => setEditing({ ...mine, draft: e.target.value, refused: false })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") setEditing(null);
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
                  }}
                />
                {mine.refused && <span className="rail-where warn">A note cannot be empty; remove it with the x.</span>}
                <span className="btn-row">
                  <button className="btn primary" onClick={save}>
                    Save
                  </button>
                  <button className="btn" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </span>
              </div>
            ) : (
              <span className="rail-text" onDoubleClick={() => onEdit && setEditing({ note: n, draft: n.note, refused: false })}>
                {n.note}
              </span>
            )}
            {onRemove && (
              <button
                className="ib rail-x"
                title="Remove this note"
                aria-label="Remove this note"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(n);
                }}
              >
                <Close size={10} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
