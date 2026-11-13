// A popover over Base UI's Popover, drawn as Kolux's .menu box. Non-modal by default (the window stays usable, as
// the status bar's popovers are); focus moves in on open and back to the anchor on close. Escape is layer.ts's.
// Base UI itself is read on demand (part.ts).
import { useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useLayer, type CloseWhy } from "./layer";
import { useBase } from "./part";
import "./ui.css";

type Focus = boolean | RefObject<HTMLElement | null> | (() => HTMLElement | null | boolean | void);

export type PopoverProps = {
  open: boolean;
  onClose: (why: CloseWhy) => void;
  label: string;
  /** The button that opened it: the popover hangs from it and focus returns to it (none: focus returns to what had it). */
  anchor?: RefObject<Element | null>;
  /** Or a point on screen it hangs from instead, for a box placed where it always was (the anchor, if any, still
   *  toggles it and takes focus back). */
  at?: { x: number; y: number } | null;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  offset?: number;
  className?: string;
  style?: CSSProperties;
  modal?: boolean | "trap-focus";
  /** The control that takes focus on open (default: the popover itself). */
  initialFocus?: Focus;
  /** The popover box, for a caller that moves focus to it (a row whose focused button went away). */
  boxRef?: RefObject<HTMLDivElement | null>;
  "data-testid"?: string;
  children: ReactNode;
};

export function Popover({ open, onClose, side = "top", align = "start", offset = 4, modal = false, boxRef, ...p }: PopoverProps) {
  const own = useRef<HTMLDivElement>(null);
  const popup = boxRef ?? own;
  useLayer(open, onClose, popup);
  const base = useBase(open);
  return base && open ? <base.PopoverBox popup={popup} onClose={onClose} side={side} align={align} offset={offset} modal={modal} {...p} /> : null;
}
