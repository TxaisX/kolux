// W201 B2: one stack for the dialogs that are open. A dialog mounted later draws and answers over the ones
// before it, so the key handling that sits on the window (Tab wrap, Escape) belongs to the newest one alone.
// Without this a question asked from a dialog that stays mounted underneath it (the workspace delete question
// asking about unsaved text) lost Tab and Escape to the dialog below the scrim. Dialogs join in mount order;
// an entry leaves with its dialog, so no stale top is left behind.
import { useEffect, type RefObject } from "react";

/** An open dialog's place in the stack. `shown` is false while its pane is hidden (panes stay mounted). */
export type Modal = { shown: () => boolean };

const open: Modal[] = [];

/** Registers a dialog as the newest open one; returns the release, which takes it out wherever it sits. */
export function pushModal(modal: Modal): () => void {
  open.push(modal);
  return () => {
    const at = open.indexOf(modal);
    if (at >= 0) open.splice(at, 1);
  };
}

/** True when `modal` is the newest open dialog that is still on screen: only that one takes Tab and Escape. */
export function isTopModal(modal: Modal): boolean {
  for (let i = open.length - 1; i >= 0; i -= 1) if (open[i].shown()) return open[i] === modal;
  return false;
}

/** The place in the stack of a dialog that handles its own Tab and Escape (trapTab in its onKeyDown), while
 *  `open`: the window-level handling of a dialog under it stands down, and it answers first while it is up. */
export function useModalSlot(box: RefObject<Partial<Element> | null>, isOpen: boolean): void {
  useEffect(() => (isOpen ? pushModal({ shown: () => !box.current?.closest?.("[hidden]") }) : undefined), [box, isOpen]);
}
