// A popover over Base UI's Popover, drawn as Kolux's .menu box. Non-modal by default (the window stays usable, as
// the status bar's popovers are); focus moves in on open and back to the anchor on close. Escape is layer.ts's.
import { useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Popover as Base } from "@base-ui/react/popover";
import { useLayer } from "./layer";
import "./ui.css";

export type PopoverProps = {
  open: boolean;
  onClose: () => void;
  label: string;
  /** The button that opened it: the popover hangs from it and focus returns to it. */
  anchor: RefObject<Element | null>;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  offset?: number;
  className?: string;
  style?: CSSProperties;
  modal?: boolean | "trap-focus";
  "data-testid"?: string;
  children: ReactNode;
};

export function Popover({ open, onClose, label, anchor, side = "top", align = "start", offset = 4, className, style, modal = false, children, ...p }: PopoverProps) {
  const popup = useRef<HTMLDivElement>(null);
  useLayer(open, onClose, popup);
  return (
    <Base.Root open={open} modal={modal} onOpenChange={(next) => !next && onClose()}>
      <Base.Portal>
        <Base.Positioner className="ui-positioner" anchor={anchor} side={side} align={align} sideOffset={offset} collisionPadding={8} positionMethod="fixed">
          <Base.Popup ref={popup} className={className ? `menu ${className}` : "menu"} role="dialog" aria-label={label} style={style} finalFocus={anchor as RefObject<HTMLElement | null>} {...p}>
            {children}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
