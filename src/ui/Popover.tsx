// A popover over Base UI's Popover, drawn as Kolux's .menu box. Non-modal by default (the window stays usable, as
// the status bar's popovers are); focus moves in on open and back to the anchor on close. Escape is layer.ts's.
// Base UI itself is read on demand (part.ts).
import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useLayer, type CloseWhy } from "./layer";
import { useBase } from "./part";
import type { Place } from "./base";
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
  /** Or fixed window numbers for the box's edges (left or right, top or bottom), for a box that opens exactly where it
   *  always did: Base UI's placement snaps to device pixels and keeps the box on screen; this does neither. */
  place?: Place | null;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  offset?: number;
  className?: string;
  style?: CSSProperties;
  modal?: boolean | "trap-focus";
  /** The control that takes focus on open (default: the popover itself). */
  initialFocus?: Focus;
  /** Where focus goes on close (default: the anchor, else what had it before). */
  finalFocus?: Focus;
  /** While true, Escape is left to the focused field (a search box holding text clears it); the next one closes. */
  fieldEscape?: () => boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  /** The popover box, for a caller that moves focus to it (a row whose focused button went away). */
  boxRef?: RefObject<HTMLDivElement | null>;
  "data-testid"?: string;
  children: ReactNode;
};

export function Popover({ open, onClose, side = "top", align = "start", offset = 4, modal = false, boxRef, fieldEscape, ...p }: PopoverProps) {
  const own = useRef<HTMLDivElement>(null);
  const popup = boxRef ?? own;
  useLayer(open, onClose, popup, fieldEscape);
  const base = useBase(open);
  return base && open ? <base.PopoverBox popup={popup} onClose={onClose} side={side} align={align} offset={offset} modal={modal} {...p} /> : null;
}
