// T-800 (P4B-13): "Go to / Run a command" opens on Ctrl+Shift+J, Ctrl+Shift+P and Ctrl+K. Ctrl+K stays Clear active
// pane's chord in the table (COMPAT.md; a chord has one owner per live scope set, T-717), so the palette takes it by
// this rule: Ctrl+K opens the palette wherever Clear active pane does not apply. Not in a terminal, where it clears,
// and not in a rich Markdown view, where it opens the Link box. While Clear active pane has another chord, the
// palette has no Ctrl+K either, and neither has it once the user rebinds or unbinds the palette itself.
import { useEffect, useState } from "react";
import { chordsOf, labelOf, labelParts, type KeyLike, type Keymap, type Match } from "./keymap";

const PALETTE = "worktree.palette";
const CLEAR = "terminal.clear";
const K = "Mod+K";

/** Ctrl+K belongs to Clear active pane in the table, and the user has not given the palette keys of their own. */
const kFree = (map: Keymap): boolean => chordsOf(map, CLEAR).includes(K) && !map.bindings.get(PALETTE)?.custom;

/** Plain Ctrl+K (Cmd+K on a Mac): the key the table gives to Clear active pane. */
const isModK = (map: Keymap, e: KeyLike): boolean =>
  e.key.toLowerCase() === "k" && !e.shiftKey && !e.altKey && (map.platform === "darwin" ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

/** The window handler's match after the Ctrl+K rule: the palette when Ctrl+K lands outside a terminal and a rich view,
 *  else `hit` as it was (no hit stays no hit). `active`: the element with focus. */
export function kPalette<T extends Match | null | undefined | false>(hit: T, map: Keymap, e: KeyLike, active: Element | null): T | Match {
  if (hit && hit.id !== CLEAR) return hit;
  if (!isModK(map, e) || !kFree(map)) return hit;
  if (kTaken(active)) return hit;
  return { id: PALETTE };
}

/** Where Ctrl+K keeps its own meaning: a terminal clears, a rich Markdown view opens its Link box. */
export const kTaken = (active: Element | null | undefined): boolean => typeof active?.closest === "function" && !!(active.closest(".xterm") || active.closest(".md-rich"));

const ANYWHERE = "Mod+Shift+P";

/** What the top-bar box shows: Ctrl+K while that opens the palette from where the focus is (`active`), else the
 *  palette's own chord: in a terminal or a rich view, Ctrl+Shift+P when it is bound (it opens the palette there too),
 *  else its first chord (none: Unassigned). */
export const paletteHint = (map: Keymap, active: Element | null = null): string[] => {
  if (kFree(map) && !kTaken(active)) return labelParts(K, map.platform);
  const own = chordsOf(map, PALETTE);
  return kTaken(active) && own.includes(ANYWHERE) ? labelParts(ANYWHERE, map.platform) : labelOf(map, PALETTE);
};

/** The top-bar box's chord, kept true to where the focus is: it changes only when the focus moves into or out of a
 *  terminal or a rich view (one state flip, not a render per focus move). */
export function usePaletteHint(map: Keymap): string[] {
  const [taken, setTaken] = useState(() => typeof document !== "undefined" && kTaken(document.activeElement));
  useEffect(() => {
    // focusout fires before the next element has focus: look once the move has landed
    const look = () => queueMicrotask(() => setTaken(kTaken(document.activeElement)));
    document.addEventListener("focusin", look);
    document.addEventListener("focusout", look);
    return () => {
      document.removeEventListener("focusin", look);
      document.removeEventListener("focusout", look);
    };
  }, []);
  return paletteHint(map, taken ? TAKEN_STAND_IN : null);
}

/** Stands for "the focus is in a terminal" when paletteHint is asked from the hook's flag. */
const TAKEN_STAND_IN = { closest: (s: string) => (s === ".xterm" ? {} : null) } as unknown as Element;
