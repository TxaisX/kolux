// 49-ux2: a modal dialog that takes the focus when it opens, closes on Escape wherever the focus is
// (not only inside it), and gives the focus back when it goes. Built from the helpers the rest of the
// window already uses: watchEscape (switcher/accounts.ts) and restoreFocus (shell/paletteCaps.ts).
import { useEffect, type RefObject } from "react";
import { watchEscape } from "../switcher/accounts";
import { restoreFocus } from "../shell/paletteCaps";

/** Escape belongs to the top dialog only: a confirmation opened over this one answers it first. */
export const isTopDialog = (root: Element | null, dialogs: ArrayLike<Element>): boolean => root !== null && dialogs.length > 0 && dialogs[dialogs.length - 1] === root;

type Focusable = { isConnected: boolean; focus: () => void };
export type DialogDeps = {
  root: (Element & { focus: () => void }) | null;
  active: Focusable | null;
  win: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  dialogs: () => ArrayLike<Element>;
  find: (selector: string) => Focusable | null;
};

/** Focuses the dialog, starts the Escape watch; returns the cleanup that stops it and restores the focus. */
export function enterDialog(d: DialogDeps, onClose: () => void): () => void {
  d.root?.focus();
  const stop = watchEscape(d.win, onClose, () => isTopDialog(d.root, d.dialogs()));
  return () => {
    stop();
    queueMicrotask(() => void restoreFocus(d.active, d.find));
  };
}

/** The dialog's ref goes on its role="dialog" element, which needs tabIndex={-1} so it can take the focus. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return enterDialog(
      { root: ref.current, active, win: window, dialogs: () => document.querySelectorAll("[role=dialog]"), find: (s) => document.querySelector<HTMLElement>(s) },
      () => onClose(),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
