// The Kolux side of every src/ui popup. Base UI traps focus, moves it in and hands it back, names the popup for a
// screen reader and closes on a click outside. Two things stay Kolux's own, so a migrated popup and a hand-rolled one
// (chrome/dialogFocus.ts) agree while both kinds are on screen:
//   - Escape is caught on the window in the capture phase and stopped there (switcher/accounts watchEscape). Escape is
//     also the key that interrupts an agent's turn in the terminal underneath, so it must never travel past a popup.
//   - The popup joins the one modal stack (chrome/modalStack.ts): only the newest popup on screen answers Escape, and a
//     hand-rolled dialog under it stands down its own Tab and Escape handling while it is up.
import { useEffect, useRef, type RefObject } from "react";
import { watchEscape } from "../switcher/accounts";
import { isTopModal, pushModal, type Modal } from "../chrome/modalStack";

/** Why a popup is asked to close: Escape (caught here), a press outside it, or Base UI's own reasons (a picked row, focus
 *  leaving a non-modal popover). A popup that steps back one level on Escape (closes a question inside it first) reads it. */
export type CloseWhy = "escape" | "outside" | "other";

/** While `open`, the popup drawn into `box` is the newest layer: Escape anywhere runs `onClose("escape")` (read fresh
 *  each render). */
export function useLayer(open: boolean, onClose: (why: CloseWhy) => void, box?: RefObject<Element | null>, fieldEscape?: () => boolean): void {
  const close = useRef(onClose);
  close.current = onClose;
  // A field in the popup that uses Escape itself (a search box holding text clears it): while this says so, the key is
  // left to the field, and the next Escape closes the popup.
  const field = useRef(fieldEscape);
  field.current = fieldEscape;
  useEffect(() => {
    if (!open) return;
    // A popup inside a hidden pane (panes stay mounted while another is shown) leaves the keys alone.
    const modal: Modal = { shown: () => !box?.current?.closest?.("[hidden]") };
    let composing = false;
    const release = pushModal(modal);
    // An input method that is composing owns Escape (it drops the candidate), so the key is left to it. The note is
    // taken first: listeners on the same target run in the order they were added.
    const note = (e: Event) => void (composing = (e as KeyboardEvent).isComposing || (e as KeyboardEvent).keyCode === 229);
    window.addEventListener("keydown", note, { capture: true });
    const stopNote = () => window.removeEventListener("keydown", note, { capture: true });
    const stop = watchEscape(window, () => close.current("escape"), () => isTopModal(modal) && !composing && !field.current?.());
    return () => {
      stop();
      stopNote();
      release();
    };
  }, [open, box]);
}

/** A point on screen (a right-click) as the anchor Base UI's positioner reads. */
export const pointAnchor = (x: number, y: number) => ({
  getBoundingClientRect: () => ({ x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect,
});
