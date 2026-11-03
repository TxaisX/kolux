// UX lane A (palette.md row 14): the tab search box gives focus back when it is dismissed (Escape, a click outside),
// the way the palette does (VIEW-039): to the element it was opened from, else a terminal, else an editor. Picking a
// tab does not: the jump puts focus in the pane it lands on.
import { restoreFocus } from "./paletteCaps";

type Focusable = { isConnected: boolean; focus: () => void };

/** Called when the box closes. `picked`: a tab was chosen, so the jump owns focus. Otherwise focus returns after the box is gone. */
export function leaveTabSearch(prev: Focusable | null, picked: boolean, find: (selector: string) => Focusable | null, later: (f: () => void) => void = queueMicrotask): void {
  if (picked) return;
  later(() => void restoreFocus(prev, find));
}
