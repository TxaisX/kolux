// Keyboard and placement for the editor's popup menus (the Explorer's Open-in menu, the diff's actions menu, the
// preview's Send menu, the note actions menu): while a menu is open, Escape closes it and hands focus back to the button
// that opened it, and the arrow keys, Home and End move between its rows. Escape goes through watchEscape (capture
// phase, stops the key, so an agent pane behind the menu is not interrupted); the rows are stepped with the terminal
// link menu's menuStep. The opener is remembered by the caller BEFORE the state change that opens the menu: React
// applies autoFocus during the commit, ahead of any effect, so reading document.activeElement from an effect would find
// the menu's own first row, not the opener.
import { useEffect, useRef, type RefObject } from "react";
import { watchEscape } from "../switcher/accounts";
import { restoreFocus } from "../shell/paletteCaps";
import { menuStep } from "../terminal/LinkActionMenu";

/** The viewport-safe left/top for a menu of about `w` by `h` that wants to open at `x`,`y`. */
export function clampMenu(x: number, y: number, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  return { left: Math.max(8, Math.min(x, vw - w - 8)), top: Math.max(8, Math.min(y, vh - h - 8)) };
}

type Row = { focus: () => void };
type Target = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/** Wires the keys of one open menu on `win`; the returned function takes them off again. */
export function wireMenuKeys(
  win: Target,
  menu: {
    rows: () => Row[];
    /** The index of the focused row, -1 when focus is not on a row. */
    at: () => number;
    /** Whether focus is inside the menu, so the arrow keys are not taken from a box the user is typing in. */
    inside: () => boolean;
    /** Escape: close the menu. */
    close: () => void;
    /** Give focus back to the opener (runs after the close, deferred). */
    restore: () => void;
    /** False while the menu sits in a hidden pane (panes stay mounted): then every key is left alone. */
    shown?: () => boolean;
  },
): () => void {
  const shown = menu.shown ?? (() => true);
  const stopEscape = watchEscape(win, () => {
    menu.close();
    queueMicrotask(menu.restore);
  }, shown);
  const onKey = (e: Event) => {
    if (!shown() || !menu.inside()) return;
    const rows = menu.rows();
    const to = menuStep(rows.length, menu.at(), (e as KeyboardEvent).key);
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    rows[to].focus();
  };
  win.addEventListener("keydown", onKey, { capture: true });
  return () => {
    stopEscape();
    win.removeEventListener("keydown", onKey, { capture: true });
  };
}

/** After a close that was not Escape (a row chosen, a click on the backdrop) focus has dropped to the page body: give it
 *  back to the opener, deferred. Skipped when focus is somewhere real, so an action that opened a dialog keeps its focus. */
export function restoreIfLost(doc: { activeElement: unknown }, body: unknown, restore: () => void): void {
  queueMicrotask(() => {
    const at = doc.activeElement;
    if (at === null || at === undefined || at === body) restore();
  });
}

/** For a popup menu that is open while `open` is true. Put `box` on the menu, call `remember(event.currentTarget)`
 *  in the click that opens it, and pass the function that closes it. Opening moves focus to the first row. */
export function useMenuKeys(open: boolean, close: () => void): { box: RefObject<HTMLDivElement | null>; remember: (opener: Element | null) => void } {
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closer = useRef(close);
  closer.current = close;
  useEffect(() => {
    if (!open) return;
    const rows = () => Array.from(box.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    rows()[0]?.focus();
    const restore = () => void restoreFocus(opener.current, (s) => document.querySelector<HTMLElement>(s));
    const stop = wireMenuKeys(window, {
      rows,
      at: () => rows().indexOf(document.activeElement as HTMLElement),
      inside: () => !!box.current?.contains(document.activeElement),
      close: () => closer.current(),
      restore,
      shown: () => !box.current?.closest("[hidden]"),
    });
    return () => {
      stop();
      restoreIfLost(document, document.body, restore);
    };
  }, [open]);
  return { box, remember: (el) => void (opener.current = el instanceof HTMLElement ? el : null) };
}
