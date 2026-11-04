// The tools over a rendered note (markdown preview and rich view): the find bar (EDIT-017) and
// the contents panel (EDIT-016).
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Close } from "../chrome/icons";
import { paint, rangesIn } from "./notefind";
import { foldKey, hasChildren, headingIndex, loadFolded, outline, saveFolded, visibleEntries } from "./toc";

/** What opened the bar: replace or not, the text to start with, and a count so a repeat refocuses. */
export type FindOpen = { replace: boolean; seed: string | null; n: number };

/** The explicit selection inside `root`, when it is one line of at most 100 characters. */
export function selectedIn(root: HTMLElement | null): string | null {
  const sel = document.getSelection();
  if (!root || !sel || sel.isCollapsed || !sel.rangeCount || !root.contains(sel.getRangeAt(0).commonAncestorContainer)) return null;
  const text = sel.toString();
  return text && text.length <= 100 && !text.includes("\n") ? text : null;
}

let lastQuery = "";

type FindProps = {
  pane: number;
  root: () => HTMLElement | null;
  open: FindOpen;
  /** Present in the rich view: replaces ranges with the text. */
  replace?: (ranges: Range[], text: string) => void;
  onClose: () => void;
};

export function FindBar({ pane, root, open, replace, onClose }: FindProps) {
  const [query, setQuery] = useState(open.seed ?? lastQuery);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [withReplace, setWithReplace] = useState(open.replace && !!replace);
  const [replacement, setReplacement] = useState("");
  const [cur, setCur] = useState(0);
  const [version, setVersion] = useState(0); // bumped when the page changes under the bar
  const box = useRef<HTMLInputElement>(null);
  const swap = useRef<HTMLInputElement>(null);

  // Mod+F again (or the replace chord) refocuses and takes a new selection.
  useEffect(() => {
    if (open.seed) setQuery(open.seed);
    if (open.replace && replace) setWithReplace(true);
    const input = open.replace && replace ? swap.current : box.current;
    input?.focus();
    input?.select();
  }, [open.n]);

  useEffect(() => {
    if (query) lastQuery = query;
  }, [query]);

  useEffect(() => {
    const el = root();
    if (!el) return;
    let frame = 0;
    const watch = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setVersion((v) => v + 1));
    });
    watch.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  }, [root]);

  const ranges = useMemo(() => {
    try {
      return rangesIn(root(), query, { matchCase, wholeWord });
    } catch {
      return []; // whatever the page holds, the search only finds nothing
    }
  }, [query, matchCase, wholeWord, version, root]);
  const at = ranges.length ? Math.min(cur, ranges.length - 1) : -1;

  useEffect(() => {
    paint(pane, ranges, at);
    return () => paint(pane, [], -1);
  }, [pane, ranges, at]);

  const go = (step: number) => {
    if (!ranges.length) return;
    const next = (at + step + ranges.length) % ranges.length;
    setCur(next);
    ranges[next].startContainer.parentElement?.scrollIntoView({ block: "center" });
  };
  const close = () => {
    onClose();
    root()?.focus();
  };
  // Enter and Escape belong to the input method while it is composing characters.
  const composing = (e: React.KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;
  const onKey = (e: React.KeyboardEvent, enter: () => void) => {
    if (composing(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // the first Escape closes the bar and goes no further
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      enter();
    }
  };

  return (
    <div className="note-find" role="search" aria-label="Find in note">
      <div className="row">
        <input ref={box} className="textfield" aria-label="Find" placeholder="Find" value={query} onChange={(e) => (setQuery(e.target.value), setCur(0))} onKeyDown={(e) => onKey(e, () => go(e.shiftKey ? -1 : 1))} />
        <button className="opt" aria-pressed={matchCase} title="Match case" onClick={() => setMatchCase((v) => !v)}>
          Aa
        </button>
        <button className="opt" aria-pressed={wholeWord} title="Whole word" onClick={() => setWholeWord((v) => !v)}>
          ab
        </button>
        <span className="count" aria-live="polite">
          {query ? (ranges.length ? `${at + 1} of ${ranges.length}` : "No results") : ""}
        </span>
        <button className="ib up" title="Previous match (Shift+Enter)" aria-label="Previous match" onClick={() => go(-1)}>
          <ChevronDown size={12} />
        </button>
        <button className="ib" title="Next match (Enter)" aria-label="Next match" onClick={() => go(1)}>
          <ChevronDown size={12} />
        </button>
        <button className="ib" title="Close (Esc)" aria-label="Close find" onClick={close}>
          <Close size={12} />
        </button>
      </div>
      {withReplace && replace && (
        <div className="row">
          <input ref={swap} className="textfield" aria-label="Replace" placeholder="Replace" value={replacement} onChange={(e) => setReplacement(e.target.value)} onKeyDown={(e) => onKey(e, () => at >= 0 && replace([ranges[at]], replacement))} />
          <button className="btn" disabled={at < 0} onClick={() => replace([ranges[at]], replacement)}>
            Replace
          </button>
          <button className="btn" disabled={!ranges.length} onClick={() => replace(ranges, replacement)}>
            Replace all
          </button>
        </div>
      )}
    </div>
  );
}

const HEADS = "h1,h2,h3,h4,h5,h6";

/** EDIT-016: the note's headings beside it; a click scrolls there, and levels fold. */
export function Contents({ md, path, root, onClose }: { md: string; path: string; root: () => HTMLElement | null; onClose: () => void }) {
  const list = useMemo(() => outline(md), [md]);
  const [folded, setFolded] = useState(() => loadFolded(path));
  useEffect(() => setFolded(loadFolded(path)), [path]);
  const toggle = (i: number) => {
    const next = new Set(folded);
    const k = foldKey(list[i]);
    if (!next.delete(k)) next.add(k);
    saveFolded(path, next);
    setFolded(next);
  };
  const top = Math.min(...list.map((e) => e.level));
  // FIX-5 (council P2 P8): the heading with the entry's own level and words, not the one at its place in the list.
  const jump = (i: number) => {
    const found = Array.from(root()?.querySelectorAll(HEADS) ?? []);
    const at = headingIndex(list, i, found.map((h) => ({ level: Number(h.tagName.slice(1)), text: h.textContent ?? "" })));
    // Words that differ in the drawn page (an entity, an embedded element) fall back to the place in
    // the list, which is reliable only when the page draws exactly as many headings as the outline has.
    const target = at >= 0 ? found[at] : found.length === list.length ? found[i] : undefined;
    target?.scrollIntoView({ block: "start" });
  };
  return (
    <nav className="note-toc" aria-label="Contents">
      <div className="head">
        <span>Contents</span>
        <button className="ib" title="Close contents" aria-label="Close contents" onClick={onClose}>
          <Close size={12} />
        </button>
      </div>
      <ul>
        {visibleEntries(list, folded).map((i) => {
          const e = list[i];
          const kids = hasChildren(list, i);
          const shut = folded.has(foldKey(e));
          return (
            <li key={i} style={{ paddingLeft: `${(e.level - top) * 12}px` }}>
              {kids ? (
                <button className={`fold${shut ? " shut" : ""}`} aria-expanded={!shut} aria-label={shut ? `Unfold ${e.text}` : `Fold ${e.text}`} onClick={() => toggle(i)}>
                  <ChevronDown size={11} />
                </button>
              ) : (
                <span className="fold" />
              )}
              <button className="entry" title={e.text} onClick={() => jump(i)}>
                {e.text || "(untitled)"}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
