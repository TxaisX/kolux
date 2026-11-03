// 49-ux2: a modal dialog that takes the focus when it opens, closes on Escape wherever the focus is
// (not only inside it), and gives the focus back when it goes. Built from the helpers the rest of the
// window already uses: watchEscape (switcher/accounts.ts) and restoreFocus (shell/paletteCaps.ts).
import { useEffect, type RefObject } from "react";
import { watchEscape } from "../switcher/accounts";
import { restoreFocus } from "../shell/paletteCaps";

/** Escape belongs to the top dialog only: a confirmation opened over this one answers it first. */
export const isTopDialog = (root: Element | null, dialogs: ArrayLike<Element>): boolean => root !== null && dialogs.length > 0 && dialogs[dialogs.length - 1] === root;

/** A docked tip card says aria-modal="false": it never holds Escape back from the dialog the user opened. */
export const isModal = (el: { getAttribute: (n: string) => string | null }): boolean => el.getAttribute("aria-modal") !== "false";

/** Where Tab goes from the edge of the dialog: the other end, or null to let the browser move inside it. */
export function wrapTab<T>(items: readonly T[], current: unknown, back: boolean): T | null {
  if (items.length === 0) return null;
  const first = items[0];
  const last = items[items.length - 1];
  const inside = items.includes(current as T);
  if (back) return !inside || current === first ? last : null;
  return !inside || current === last ? first : null;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Focusable = { isConnected: boolean; focus: () => void };
export type DialogDeps = {
  root: (Element & { focus: () => void }) | null;
  active: Focusable | null;
  win: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  dialogs: () => ArrayLike<Element>;
  find: (selector: string) => Focusable | null;
  /** True while the keyboard is in a terminal inside the dialog (a sign-in): its Escape is the terminal's. */
  inTerminal?: () => boolean;
};

/** Focuses the dialog, starts the Escape watch; returns the cleanup that stops it and restores the focus. */
export function enterDialog(d: DialogDeps, onClose: () => void): () => void {
  d.root?.focus();
  const stop = watchEscape(d.win, onClose, () => isTopDialog(d.root, d.dialogs()) && !d.inTerminal?.());
  const root = d.root as (Element & { focus: () => void }) | null;
  const onTab = (e: Event) => {
    const k = e as KeyboardEvent;
    if (k.key !== "Tab" || !root?.querySelectorAll) return;
    const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    const to = wrapTab(items, root.ownerDocument?.activeElement ?? null, k.shiftKey);
    if (!to) return;
    k.preventDefault();
    to.focus();
  };
  root?.addEventListener?.("keydown", onTab);
  return () => {
    stop();
    root?.removeEventListener?.("keydown", onTab);
    queueMicrotask(() => void restoreFocus(d.active, d.find));
  };
}

/** The dialog's ref goes on its role="dialog" element, which needs tabIndex={-1} so it can take the focus. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return enterDialog(
      { root: ref.current, active, win: window, dialogs: () => [...document.querySelectorAll("[role=dialog], [role=alertdialog]")].filter(isModal), find: (s) => document.querySelector<HTMLElement>(s), inTerminal: () => !!document.activeElement?.closest(".xterm") },
      () => onClose(),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
