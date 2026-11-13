// A tooltip over Base UI's Tooltip, drawn as Kolux's .tip. Shown on hover and on keyboard focus (a title attribute
// is shown on hover only, and never to a keyboard user). One TooltipProvider near the root shares the delay, so moving
// along a row of buttons shows the next tip at once.
import type { ReactElement, ReactNode } from "react";
import { Tooltip as Base } from "@base-ui/react/tooltip";
import "./ui.css";

export const TooltipProvider = ({ children }: { children: ReactNode }) => <Base.Provider delay={500}>{children}</Base.Provider>;

/** `children` is the one element the tip describes; it is rendered as the trigger (no wrapper element). */
export function Tooltip({ tip, side = "bottom", children }: { tip: ReactNode; side?: "top" | "bottom" | "left" | "right"; children: ReactElement }) {
  return (
    <Base.Root>
      <Base.Trigger render={children} />
      <Base.Portal>
        <Base.Positioner className="ui-positioner ui-tip-positioner" side={side} sideOffset={6} collisionPadding={8}>
          <Base.Popup className="tip ui-tip">{tip}</Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
