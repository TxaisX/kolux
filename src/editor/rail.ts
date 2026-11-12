// EDIT-020 (T-132-b): the margin rail beside a rich Markdown note. A review note sits beside the text
// it quotes; notes that would overlap are pushed down so each one stays readable, in source order.
import { editedText } from "./diffNotes";
import { keyOf } from "./buffers";
import type { Note } from "./notes";

/** One rail card: where its quoted text sits (px from the top of the document) and its height. */
export type RailItem = { id: string; top: number; height: number };

/** The notes that belong on this file's rail, in the order of their source lines then the time
 * they were made. Paths compare as buffers.ts keys them (audit N-11): a Windows path without letter
 * case or slash kind, and a WSL path either share name by its Linux path, so a note made through
 * `\\wsl$\<distro>` still sits beside the file opened as `\\wsl.localhost\<distro>`. */
export function railNotes(notes: Note[], path: string): Note[] {
  return notes.filter((n) => keyOf(n.path) === keyOf(path)).sort((a, b) => a.line - b.line || a.time - b.time);
}

/** Each card's final top: as close to its text as it can be, never above the one before it plus a
 * gap. Items keep their given order (source order); a card never moves up past its own text. */
export function placeRail(items: RailItem[], gap = 6): Record<string, number> {
  const out: Record<string, number> = {};
  let floor = -Infinity;
  for (const it of items) {
    const top = Math.max(it.top, floor);
    out[it.id] = top;
    floor = top + it.height + gap;
  }
  return out;
}

/** The index of the first piece of text that holds the first non-empty line of the quote, or -1.
 * The rich view drops markup, so the quote is looked for as written in what the view shows. */
export function anchorIndex(texts: string[], quote: string): number {
  const first = quote.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!first) return -1;
  const i = texts.findIndex((t) => t.includes(first));
  if (i >= 0) return i;
  const words = first.split(/\s+/).slice(0, 3).join(" ");
  return words ? texts.findIndex((t) => t.includes(words)) : -1;
}

/** Where a note's quote starts inside the rich view, in px from the top of its scrolled content;
 * null when the text is no longer there (the note then sits at the end of the rail). */
export function quoteTop(host: HTMLElement, quote: string): number | null {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const at = anchorIndex(nodes.map((n) => n.data), quote);
  if (at < 0) return null;
  const range = document.createRange();
  range.selectNodeContents(nodes[at]);
  return range.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop;
}

/** Rail items for a list of notes given where each one's text is; a note whose text is gone goes
 * below the last placed one. `height` is one card height for all, or each card's own (a card grows
 * to fit its text); a card with no height given counts as 0. */
export function railItems(notes: Note[], tops: (number | null)[], height: number | number[]): RailItem[] {
  let last = 0;
  return notes.map((n, i) => {
    const top = tops[i] ?? last;
    last = Math.max(last, top);
    return { id: `${n.time}:${i}`, top, height: typeof height === "number" ? height : (height[i] ?? 0) };
  });
}

/** What leaving a card's edit does: nothing when the text is unchanged, a refusal when it is empty
 * (an empty note is removed with the x, not saved), else the trimmed text to save. */
export function railEdit(draft: string, current: string): { save: string } | { same: true } | { refused: true } {
  const text = editedText(draft);
  if (text === null) return { refused: true };
  return text === current.trim() ? { same: true } : { save: text };
}
