// A small keyboard layer for the editor's popup menus (the Explorer's Open-in menu, the diff's
// actions menu): while one is open the first row takes focus, Escape closes it from anywhere,
// the arrow keys walk the rows, and closing puts focus back where it was.
import { useEffect, type RefObject } from "react";
import { menuStep } from "../terminal/LinkActionMenu";

/** The viewport-safe left/top for a menu of about `w` by `h` that wants to open at `x`,`y`. */
export function clampMenu(x: number, y: number, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  return { left: Math.max(8, Math.min(x, vw - w - 8)), top: Math.max(8, Math.min(y, vh - h - 8)) };
}

export function useMenuKeys(box: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, back?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const rows = () => [...(box.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    rows()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      const list = rows();
      const next = menuStep(list.length, list.indexOf(document.activeElement as HTMLElement), e.key);
      if (next === null) return;
      e.preventDefault();
      e.stopPropagation();
      list[next]?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const to = back?.current ?? prev;
      if (to && to.isConnected) to.focus();
    };
  }, [open]);
}
