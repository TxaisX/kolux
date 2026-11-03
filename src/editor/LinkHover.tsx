// EDIT-014 (T-234-b): the bubble over a link in the rich view: Open, Edit and Copy. It appears while the pointer is on a
// link (or on the bubble), above the link, and above the side panels. Edit turns the bubble into one address box; Enter
// saves (one undo step), Escape leaves it as it was.
import { useEffect, useRef, useState } from "react";
import type { LexicalEditor } from "lexical";
import { bubblePlace, cleanHref, linkKeyAt, setLinkUrl } from "./linkBubble";

type Spot = { key: string; href: string; left: number; top: number };

export default function LinkHover({ editor, host, onOpen, onToast }: { editor: LexicalEditor | null; host: HTMLElement | null; onOpen: (href: string, shift: boolean) => void; onToast?: (t: string) => void }) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  useEffect(() => {
    if (!editor || !host) return;
    const show = (a: Element) => {
      window.clearTimeout(timer.current);
      const key = linkKeyAt(editor, a);
      if (!key) return;
      const r = a.getBoundingClientRect();
      const p = bubblePlace(r, { w: 230, h: 34 }, { w: window.innerWidth, h: window.innerHeight });
      setSpot((s) => (s?.key === key ? s : { key, href: a.getAttribute("href") ?? "", left: p.left, top: p.top }));
      setEdit(null);
    };
    const over = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (a && host.contains(a)) show(a);
    };
    // The keyboard path: a caret that moves into a link shows the same bubble (Tab then reaches its buttons).
    const caret = () => {
      const n = document.getSelection()?.anchorNode;
      const a = (n && n.nodeType === 1 ? (n as Element) : n?.parentElement)?.closest?.("a[href]");
      if (a && host.contains(a)) show(a);
      // The caret moved to text that is not a link: the bubble goes, unless it is being used.
      else if (n && host.contains(n) && edit === null && !box.current?.contains(document.activeElement)) setSpot(null);
    };
    const out = (e: MouseEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && box.current?.contains(to)) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setSpot((s) => (edit === null ? null : s)), 350);
    };
    host.addEventListener("mouseover", over);
    host.addEventListener("mouseout", out);
    document.addEventListener("selectionchange", caret);
    return () => {
      document.removeEventListener("selectionchange", caret);
      window.clearTimeout(timer.current);
      host.removeEventListener("mouseover", over);
      host.removeEventListener("mouseout", out);
    };
  }, [editor, host, edit]);
  if (!spot || !editor) return null;
  const stay = () => window.clearTimeout(timer.current);
  const copy = () => {
    const done = () => onToast?.("Link copied");
    navigator.clipboard?.writeText(spot.href).then(done, () => onToast?.("Could not copy the link"));
  };
  const save = () => {
    if (edit !== null && cleanHref(edit) !== null && setLinkUrl(editor, spot.key, edit)) setSpot(null);
    else if (edit !== null && cleanHref(edit) === null) onToast?.("That address cannot be used");
    setEdit(null);
  };
  return (
    <div ref={box} className="link-bubble" style={{ left: spot.left, top: spot.top }} onMouseEnter={stay} onMouseLeave={() => (timer.current = window.setTimeout(() => setSpot(null), 350))} onKeyDown={(e) => e.key === "Escape" && edit === null && (e.stopPropagation(), setSpot(null), editor.focus())}>
      {edit === null ? (
        <>
          <span className="link-bubble-href" title={spot.href}>{spot.href}</span>
          <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={(e) => onOpen(spot.href, e.shiftKey)}>Open</button>
          <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => setEdit(spot.href)}>Edit</button>
          <button className="btn" onMouseDown={(e) => e.preventDefault()} onClick={copy}>Copy</button>
        </>
      ) : (
        <input
          className="link-bubble-input"
          aria-label="Link address"
          autoFocus
          value={edit}
          onChange={(e) => setEdit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            else if (e.key === "Escape") (setEdit(null), editor.focus());
          }}
          onBlur={() => setEdit(null)}
        />
      )}
    </div>
  );
}
