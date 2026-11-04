// SET-036 (after-list row 502): a settings field that saves "on leaving the field" lost what was typed when
// the user changed page or closed Settings without leaving the field first: the page unmounts the input,
// and a removed input fires no blur. `useLeaveSave(save)` runs the field's own save (always the latest
// one) when its page goes away and when the window closes. Every save given to it must be a no-op when
// nothing changed, because it can run right after a blur that already saved.
import { useEffect, useRef } from "react";

type Target = { addEventListener(type: string, f: () => void): void; removeEventListener(type: string, f: () => void): void };

/** Saves on window close (beforeunload, pagehide); the returned cleanup unhooks and saves once more (the page went away). */
export function bindLeave(win: Target, save: () => void): () => void {
  win.addEventListener("beforeunload", save);
  win.addEventListener("pagehide", save);
  return () => {
    win.removeEventListener("beforeunload", save);
    win.removeEventListener("pagehide", save);
    save();
  };
}

export function useLeaveSave(save: () => void): void {
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => bindLeave(window, () => latest.current()), []);
}

/** C20-R4-01: a save made while its page goes away outlives the page. The write cannot finish inside
 *  a cleanup, so the text it was given and, when the write failed, why are kept here by key; the next
 *  mount of that page takes them back so nothing typed is lost and the failure is shown. */
export type Left = { value: string; error: string | null };
const left = new Map<string, Left>();

/** Puts the text aside before the write goes out. */
export function keepLeft(key: string, value: string): void {
  left.set(key, { value, error: null });
}

/** Records why the write failed, for the page's next mount. */
export function failLeft(key: string, error: string): void {
  const k = left.get(key);
  if (k) left.set(key, { ...k, error });
}

/** The write landed: nothing is left to put back. */
export function clearLeft(key: string): void {
  left.delete(key);
}

/** Takes what the page left behind, and empties it: it is shown once. */
export function takeLeft(key: string): Left | null {
  const k = left.get(key) ?? null;
  left.delete(key);
  return k;
}
