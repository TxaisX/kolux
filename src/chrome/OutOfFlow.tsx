// DT-C269: a menu, picker or palette is put in the page inside this empty box, which stands outside the layout.
// Its contents are fixed to the window, so where the box sits does not move them; what it changes is the cost.
// Put straight into a pane or into the window's body, a menu made WebKit lay that whole flex row out again and
// redraw what it holds (terminals included) when the menu came and again when it went: about 25 ms each way
// on the Linux harness. Put into a box that is itself out of the flow, only that box is laid out again.
import type { ReactNode } from "react";

export default function OutOfFlow({ children }: { children: ReactNode }) {
  return <div className="out-of-flow">{children}</div>;
}
