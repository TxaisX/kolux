// EDIT-010 (T-234-b): the language label over a code block in the rich view. Pointing at a block shows its
// language in a small choice list at the block's top-right corner; picking one rewrites the fence. A
// language the list does not know is shown as typed, with Plain text one choice away.
import { useEffect, useState } from "react";
import type { LexicalEditor } from "lexical";
import { codeBlocks, languageChoices, setCodeLanguage } from "./richCode";

type Spot = { key: string; language: string; right: number; top: number };

export default function CodeLabel({ editor }: { editor: LexicalEditor | null }) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [busy, setBusy] = useState(false); // the list is open or focused: keep the label where it is
  useEffect(() => {
    if (!editor || busy) return;
    let frame = 0;
    // selectionchange fires on every caret move: a spot that is the same as the one showing is not set again.
    const keep = (n: Spot) => setSpot((s) => (s && s.key === n.key && s.language === n.language && s.right === n.right && s.top === n.top ? s : n));
    const move = (e: MouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const b of codeBlocks(editor)) {
          const r = b.el?.getBoundingClientRect();
          if (!r) continue;
          // a few pixels of slack above the block, so the label under the pointer keeps it
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 4 && e.clientY <= r.bottom) return keep({ key: b.key, language: b.language, right: r.right, top: r.top });
        }
        setSpot(null);
      });
    };
    // The keyboard path: a caret inside a code block shows the same language list (Tab then reaches it).
    const caret = () => {
      const n = document.getSelection()?.anchorNode;
      if (!n) return;
      for (const b of codeBlocks(editor)) {
        const r = b.el?.contains(n) ? b.el.getBoundingClientRect() : null;
        if (r) return keep({ key: b.key, language: b.language, right: r.right, top: r.top });
      }
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("selectionchange", caret);
    return () => {
      document.removeEventListener("selectionchange", caret);
      cancelAnimationFrame(frame);
      document.removeEventListener("mousemove", move);
    };
  }, [editor, busy]);
  if (!spot || !editor) return null;
  const choices = languageChoices(spot.language);
  return (
    <select
      className="code-label"
      aria-label="Code language"
      title="Language of this code block"
      value={spot.language}
      style={{ left: Math.max(8, spot.right - 150), top: spot.top + 4 }}
      onFocus={() => setBusy(true)}
      onBlur={() => (setBusy(false), setSpot(null))}
      onChange={(e) => {
        setCodeLanguage(editor, spot.key, e.target.value);
        setSpot({ ...spot, language: e.target.value });
        editor.focus();
      }}
    >
      {choices.map((c) => (
        <option key={c.id || "plain"} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
