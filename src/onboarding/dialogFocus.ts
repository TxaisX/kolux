// 49-ux2: a modal dialog that takes the focus when it opens, closes on Escape wherever the focus is
// (not only inside it), and gives the focus back when it goes. Built from the helpers the rest of the
// window already uses: watchEscape (switcher/accounts.ts) and restoreFocus (shell/paletteCaps.ts).
import { useEffect, type RefObject } from "react";
import { watchEscape } from "../switcher/accounts";
import { restoreFocus } from "../shell/paletteCaps";
import { OPEN_SETTINGS } from "../settings/pages";

/** Settings opened without OPEN_SETTINGS (the Ctrl+, key; the native menu once lane E1 sends it too). */
export const SETTINGS_SHOWN = "kolux-settings-shown";

/** Says Settings is showing: Ctrl+, sends it (src/keys/useWindowKeys.ts). */
export const settingsShown = (w: EventTarget = window): void => void w.dispatchEvent(new Event(SETTINGS_SHOWN));

/** What Explore and the Setup Guide do when Settings opens: Explore closes; the guide closes only when it is open, and then
 *  tells the sidebar as its own close does. */
export function stepAside(guideOpen: boolean, closeExplore: () => void, closeGuide: () => void): void {
  closeExplore();
  if (guideOpen) closeGuide();
}

/** An onboarding dialog steps aside when Settings opens (its own Open Settings button, a palette page, Ctrl+,), so
 *  Settings is not left behind it. Returns the unsubscribe. */
export function closeOnSettings(close: () => void, w: EventTarget = window): () => void {
  w.addEventListener(OPEN_SETTINGS, close);
  w.addEventListener(SETTINGS_SHOWN, close);
  return () => {
    w.removeEventListener(OPEN_SETTINGS, close);
    w.removeEventListener(SETTINGS_SHOWN, close);
  };
}

/** Escape belongs to the top dialog only: a confirmation opened over this one answers it first. */
export const isTopDialog = (root: Element | null, dialogs: ArrayLike<Element>): boolean => root !== null && dialogs.length > 0 && dialogs[dialogs.length - 1] === root;

/** Only a dialog that says aria-modal="true", or a confirmation (alertdialog), holds Escape back from the dialog the user
 *  opened. A docked tip card (aria-modal="false") and a panel that stays on the page (the floating workspace, a review
 *  pop) never do, even when they come later in the page. */
export const isModal = (el: { getAttribute: (n: string) => string | null }): boolean =>
  el.getAttribute("aria-modal") === "true" || el.getAttribute("role") === "alertdialog";

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
  /** What has the focus now (null for nothing or the page body). */
  focused?: () => unknown;
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
    // Something that opened in the same moment (Settings over Explore) has taken the focus: leave it there. Restoring
    // anyway could fall back to a terminal behind Settings.
    queueMicrotask(() => {
      const now = d.focused?.() ?? null;
      if (now && !root?.contains?.(now as Node)) return;
      void restoreFocus(d.active, d.find);
    });
  };
}

/** The dialog's ref goes on its role="dialog" element, which needs tabIndex={-1} so it can take the focus. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return enterDialog(
      { root: ref.current, active, win: window, dialogs: () => [...document.querySelectorAll("[role=dialog], [role=alertdialog]")].filter((el) => isModal(el) && !el.closest("[hidden]")), find: (s) => document.querySelector<HTMLElement>(s), inTerminal: () => !!document.activeElement?.closest(".xterm"), focused: () => (document.activeElement === document.body ? null : document.activeElement) },
      () => onClose(),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
