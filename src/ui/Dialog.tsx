// A dialog over Base UI's Dialog, drawn with Kolux's own classes. Two layouts exist in the app and both are kept:
//   viewport: a full-window layer that holds and centres the dialog (.ask-backdrop)
//   backdrop: a layer behind a dialog that places itself (.menu-backdrop behind .about-panel)
// Escape and stacking are Kolux's (layer.ts); focus trap, initial and final focus, aria and click-outside are Base UI's.
// Base UI itself is read on demand (part.ts): a closed dialog costs nothing, not even its code.
import { useRef, type HTMLAttributes, type ReactNode, type RefObject } from "react";
import { useLayer, type CloseWhy } from "./layer";
import { useBase } from "./part";

type Focus = boolean | RefObject<HTMLElement | null> | (() => HTMLElement | null | boolean | void);

export type DialogProps = Omit<HTMLAttributes<HTMLDivElement>, "role" | "children" | "className"> & {
  /** Default true: a dialog that is mounted only while shown needs no open state. */
  open?: boolean;
  /** Escape, a click outside, or Base UI's own close all land here. */
  onClose: (why: CloseWhy) => void;
  /** The dialog's accessible name. */
  label: string;
  /** The dialog box's class, e.g. "ask" or "menu about-panel". */
  className?: string;
  viewport?: string;
  backdrop?: string;
  /** Draw as an alert dialog: a question that needs an answer. */
  alert?: boolean;
  /** Default true: focus is trapped, the rest of the window is inert. "trap-focus" keeps the window clickable. */
  modal?: boolean | "trap-focus";
  /** The control that takes focus on open (default: the first focusable). */
  initialFocus?: Focus;
  /** Where focus goes on close (default: what had it before the dialog opened). */
  finalFocus?: Focus;
  /** The dialog box, for a caller that moves focus to it (a busy dialog whose buttons are all off). */
  boxRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
};

export function Dialog({ open = true, onClose, alert = false, modal = true, boxRef, ...p }: DialogProps) {
  const own = useRef<HTMLDivElement>(null);
  const popup = boxRef ?? own;
  useLayer(open, onClose, popup);
  const base = useBase(open);
  return base && open ? <base.DialogBox popup={popup} onClose={onClose} alert={alert} modal={modal} {...p} /> : null;
}

/** A question that needs an answer before work goes on (an alert dialog). */
export const AlertDialog = (p: Omit<DialogProps, "alert">) => <Dialog {...p} alert />;
