// UX lane A (keyboard.md row 3, shell.md row 8): the tab right-click menu is reachable and leavable from the
// keyboard. Opening it puts focus on its first enabled row and keeps it inside the window; the arrows, Home and
// End move between the rows (the same keys as the link menu); Escape closes it without reaching the pane under it;
// closing it gives focus back to where it came from, unless a row already moved focus on (Change Title).
import { useLayoutEffect, type RefObject } from "react";
import { watchEscape } from "../../switcher/accounts";
import { menuStep } from "../../terminal/LinkActionMenu";
import { fitIn } from "../../terminal/PaneMenu";
import { restoreFocus } from "../paletteCaps";

type El = { focus: () => void; isConnected: boolean };
type Box = {
  getBoundingClientRect: () => { top: number; left: number; width: number; height: number };
  style: { top: string; left: string };
  querySelectorAll: (selector: string) => ArrayLike<El>;
};
type Doc = { activeElement: unknown; body: unknown; querySelector: (selector: string) => El | null };
type Win = Pick<EventTarget, "addEventListener" | "removeEventListener"> & { innerWidth: number; innerHeight: number };

/** The menu's focusable rows, in order: every enabled button (rows and colour swatches). */
export const ROWS = "button:not(:disabled)";

/** Whether closing the menu should give focus back: only when focus is nowhere (it left with the menu), never when
 *  a row's action already put it somewhere, as Change Title does in the tab's name field. */
export const focusIsLost = (active: unknown, body: unknown): boolean => active === null || active === undefined || active === body;

/** Opens the keyboard side of the menu `box`: fit it in the window, focus the first row, listen for the arrows and
 *  Escape. Returns the stop, which also hands focus back. */
export function openTabMenu(box: Box, win: Win, doc: Doc, onClose: () => void): () => void {
  const prev = (doc.activeElement ?? null) as El | null;
  const r = box.getBoundingClientRect();
  box.style.top = `${fitIn(r.top, r.height, win.innerHeight)}px`;
  box.style.left = `${fitIn(r.left, r.width, win.innerWidth)}px`;
  const rows = () => Array.from(box.querySelectorAll(ROWS));
  rows()[0]?.focus();
  const stopEscape = watchEscape(win, onClose);
  const onKey = (e: Event) => {
    const k = e as KeyboardEvent;
    const list = rows();
    const to = menuStep(list.length, list.indexOf(doc.activeElement as El), k.key);
    if (to === null) return;
    k.preventDefault();
    k.stopPropagation();
    list[to].focus();
  };
  win.addEventListener("keydown", onKey, { capture: true });
  return () => {
    stopEscape();
    win.removeEventListener("keydown", onKey, { capture: true });
    // after the menu is gone, so a row that opened a field has had its turn to take focus
    queueMicrotask(() => {
      if (focusIsLost(doc.activeElement, doc.body)) restoreFocus(prev, (s) => doc.querySelector(s));
    });
  };
}

/** The menu `box` (attached to the open menu's element) is keyboard-driven while `open`. */
export function useTabMenuKeys(open: boolean, box: RefObject<HTMLDivElement | null>, onClose: () => void): void {
  useLayoutEffect(() => {
    const el = box.current;
    if (!open || !el) return;
    return openTabMenu(el as unknown as Box, window as unknown as Win, document as unknown as Doc, onClose);
  }, [open]);
}
