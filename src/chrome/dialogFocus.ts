// Keyboard focus for the chrome's popups. A dialog (useDialogFocus) takes focus when it opens, keeps Tab and
// Shift+Tab inside, closes on Escape from anywhere and hands focus back to where it came from. A menu
// (useMenuFocus) does the same without the Tab trap and adds the arrow keys. Escape is caught on the window in the
// capture phase and stopped there (switcher/accounts watchEscape), because Escape is also the key that interrupts
// an agent's turn in the terminal underneath.
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { watchEscape } from "../switcher/accounts";
import { restoreFocus } from "../shell/paletteCaps";
import { menuStep } from "../terminal/LinkActionMenu";

/** What a keyboard user can land on inside a popup. */
export const FOCUSABLE = 'a[href],button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

/** Where Tab (or Shift+Tab) goes from `at` among `items`: the element to focus, or null to let the browser step
 * on its own (the middle of the list). `prevent` says whether the key must be stopped (always, when there is
 * nothing to land on, so focus cannot leave the dialog). */
export function tabTarget<T>(items: T[], at: unknown, shift: boolean): { to: T | null; prevent: boolean } {
  if (items.length === 0) return { to: null, prevent: true };
  const i = items.indexOf(at as T);
  if (i < 0) return { to: shift ? items[items.length - 1] : items[0], prevent: true };
  if (shift && i === 0) return { to: items[items.length - 1], prevent: true };
  if (!shift && i === items.length - 1) return { to: items[0], prevent: true };
  return { to: null, prevent: false };
}

type Box = Pick<HTMLElement, "querySelectorAll" | "contains">;

/** Focus goes back only when nobody took it meanwhile: it is on the page body (the popup's own element left) or still inside the popup. */
function giveBack(prev: Element | null, box: Box) {
  const now = document.activeElement;
  if (now && now !== document.body && !box.contains(now)) return;
  restoreFocus(prev as HTMLElement | null, (sel) => document.querySelector<HTMLElement>(sel));
}

/** Opens the keyboard side of a popup: focus moves in (`first`, else the first focusable), Escape runs `onClose`
 * from anywhere, and `keys` may handle more keys. Returns the stop, which puts focus back where it was. */
function openPopup(box: Box, onClose: () => void, first: () => HTMLElement | null, extra: (e: KeyboardEvent) => void): () => void {
  const prev = document.activeElement;
  (first() ?? Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE))[0])?.focus();
  // A popup inside a hidden pane (panes stay mounted while another is shown) leaves every key alone.
  const shown = () => !(box as Partial<Element>).closest?.("[hidden]");
  const stopEscape = watchEscape(window, onClose, shown);
  const keys = (e: Event) => shown() && extra(e as KeyboardEvent);
  window.addEventListener("keydown", keys, true);
  return () => {
    stopEscape();
    window.removeEventListener("keydown", keys, true);
    giveBack(prev, box);
  };
}

/** Where Tab (or Shift+Tab) goes from `at` among `items`, wrapping at both ends: the element to focus, or null when
 *  there is nothing to land on. Unlike tabTarget this never leaves the step to the browser, which is what a dialog
 *  needs when the focused element cancels Tab itself (the terminal's textarea does, in its own capture listener). */
export function tabStep<T>(items: T[], at: unknown, shift: boolean): T | null {
  if (items.length === 0) return null;
  const i = items.indexOf(at as T);
  if (i < 0) return shift ? items[items.length - 1] : items[0];
  return items[(i + (shift ? -1 : 1) + items.length) % items.length];
}

/** Tab and Shift+Tab wrap inside `box`. */
function wrapTab(box: Box, e: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">) {
  if (e.key !== "Tab") return;
  const { to, prevent } = tabTarget(Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)), document.activeElement, e.shiftKey);
  if (prevent) e.preventDefault();
  to?.focus();
}

/** T-714: the Tab trap alone, as an onKeyDown, for an aria-modal dialog that handles its own Escape and focus
 * (useDialogFocus would take Escape from it on the window: no find bar, menu or typed-text rule could keep it).
 * A Tab a dialog inside it already wrapped (default prevented) is left alone. The box needs tabIndex -1, so a click
 * on its text keeps focus in it and the key still reaches it. */
export const trapTab = (e: ReactKeyboardEvent<Element>) => e.defaultPrevented || wrapTab(e.currentTarget, e);

/** A modal dialog's keyboard: see the file header. Tab and Shift+Tab wrap inside `box`. Returns the stop. */
export function trapDialog(box: Box, onClose: () => void, initial?: () => HTMLElement | null): () => void {
  return openPopup(box, onClose, initial ?? (() => null), (e) => wrapTab(box, e));
}

/** The height a menu may take: the room from its top to the window's bottom, or from the window's top to its bottom when it opens upward. */
export const menuRoom = (r: { top: number; bottom: number }, windowHeight: number, upward: boolean): number =>
  Math.max(80, (upward ? r.bottom : windowHeight - r.top) - 8);

/** The rows a menu's arrow keys move between (a disabled row cannot take focus). */
export const MENU_ROWS = '[role^="menuitem"]:not(:disabled):not([aria-disabled="true"])';

/** A menu's keyboard: focus on the first row, arrows / Home / End move between the rows (wrapping), Tab closes it
 * (T-720: focus goes back to where it was, as for Escape and the pane menu). Keys pressed while focus is outside the
 * menu are left alone. Returns the stop. */
export function trapMenu(box: Box, onClose: () => void): () => void {
  const rows = () => Array.from(box.querySelectorAll<HTMLElement>(MENU_ROWS));
  // A menu scrolls inside the space it has instead of running off a short window: below its top when it opens
  // downward, above its bottom when it is anchored by its bottom and opens upward (the status bar's).
  const el = box as Partial<HTMLElement>;
  if (el.style && el.getBoundingClientRect) el.style.maxHeight = `${menuRoom(el.getBoundingClientRect(), window.innerHeight, !!el.style.bottom)}px`;
  const onArrow = (e: KeyboardEvent) => {
    if (!box.contains(document.activeElement)) return;
    if (e.key === "Tab") {
      e.preventDefault();
      return onClose();
    }
    const all = rows();
    const to = menuStep(all.length, all.indexOf(document.activeElement as HTMLElement), e.key);
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    all[to].focus();
  };
  return openPopup(box, onClose, () => rows()[0] ?? null, onArrow);
}

/** Hook form of trapDialog for the dialog drawn into `box` while `open` (default: always, for a dialog that is only mounted while shown).
 * `initial` picks the control that gets focus (default: the first focusable). */
export function useDialogFocus(box: RefObject<HTMLElement | null>, onClose: () => void, initial?: () => HTMLElement | null, open = true) {
  const close = useRef(onClose);
  close.current = onClose;
  const pick = useRef(initial);
  pick.current = initial;
  useEffect(() => (open && box.current ? trapDialog(box.current, () => close.current(), () => pick.current?.() ?? null) : undefined), [box, open]);
}

/** Hook form of trapMenu for the menu drawn into `box` while `open`. */
export function useMenuFocus(box: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => (open && box.current ? trapMenu(box.current, () => close.current()) : undefined), [box, open]);
}
