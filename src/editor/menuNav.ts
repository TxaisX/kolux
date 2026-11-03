// A small keyboard layer for the editor's popup menus (the Explorer's Open-in menu, the diff's
// actions menu): while one is open the first row takes focus, Escape closes it from anywhere,
// the arrow keys walk the rows, and closing puts focus back where it was.
import { useEffect, type RefObject } from "react";
import { restoreFocus } from "../shell/paletteCaps";
import { watchEscape } from "../switcher/accounts";
import { menuStep } from "../terminal/LinkActionMenu";

/** The viewport-safe left/top for a menu of about `w` by `h` that wants to open at `x`,`y`. */
export function clampMenu(x: number, y: number, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  return { left: Math.max(8, Math.min(x, vw - w - 8)), top: Math.max(8, Math.min(y, vh - h - 8)) };
}

/** The row an arrow/Home/End key moves to, or null when the key is not for the menu: focus must be inside the menu,
 *  so once Tab has taken it to the editor or a terminal those keys are left alone. */
export function menuKeyTarget(rows: readonly unknown[], active: unknown, inside: boolean, key: string): number | null {
  return inside ? menuStep(rows.length, rows.indexOf(active), key) : null;
}

export function useMenuKeys(box: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, back?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const rows = () => [...(box.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    rows()[0]?.focus();
    const stopEsc = watchEscape(document, onClose);
    const onKey = (e: KeyboardEvent) => {
      const list = rows();
      const active = document.activeElement;
      const next = menuKeyTarget(list, active, !!box.current?.contains(active), e.key);
      if (next === null) return;
      e.preventDefault();
      e.stopPropagation();
      list[next]?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      stopEsc();
      document.removeEventListener("keydown", onKey, true);
      restoreFocus(back?.current ?? prev, (sel) => document.querySelector<HTMLElement>(sel));
    };
  }, [open]);
}
