// T-699 (DT-C135): in a window under 900 CSS px (the app's minimum width at 100 % zoom, so reached by zooming in
// or a small window) the two side panels take turns. styles.css hides the left sidebar while the right sidebar is
// showing; this keeps the left toggle honest about that and lets it bring the left sidebar back.
import { useSyncExternalStore } from "react";

export const NARROW_PX = 900;
const QUERY = `(max-width: ${NARROW_PX - 1}px)`;
const query = () => (typeof matchMedia === "function" ? matchMedia(QUERY) : null);
const subscribe = (cb: () => void) => {
  const m = query();
  m?.addEventListener("change", cb);
  return () => m?.removeEventListener("change", cb);
};
/** True while the window is under NARROW_PX CSS px wide. */
export const isNarrow = () => !!query()?.matches;
/** isNarrow as React state: re-renders when the window crosses NARROW_PX. */
export const useNarrow = () => useSyncExternalStore(subscribe, isNarrow, () => false);

/** Whether the left sidebar is in view: open, and not stepped aside for the right sidebar in a narrow window. */
export const leftShown = (open: boolean, narrow: boolean, rightShown: boolean) => open && !(narrow && rightShown);

/** What the left toggle does: hide a shown sidebar; otherwise show it, closing the right sidebar if the two cannot fit. */
export const toggleLeft = (open: boolean, narrow: boolean, rightShown: boolean) =>
  leftShown(open, narrow, rightShown) ? { left: false, closeRight: false } : { left: true, closeRight: narrow && rightShown };
