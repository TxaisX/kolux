// T-699 (DT-C135): in a window under 900 CSS px (the app's minimum width at 100 % zoom, so reached by zooming in
// or a small window) the two side panels take turns. styles.css hides the left sidebar while the right sidebar is
// showing; this keeps the left toggle honest about that, and every path that opens the left sidebar brings it back.
export const NARROW_PX = 900;
const query = () => globalThis.matchMedia?.(`(max-width: ${NARROW_PX - 1}px)`);
/** True while the window is under NARROW_PX CSS px wide, read live (the setters use it). */
export const isNarrow = () => !!query()?.matches;
/** T-705 (DT-C141): the subscribe half of useSyncExternalStore(watchNarrow, isNarrow), so the top bar redraws when the
 *  window crosses NARROW_PX and the left toggle's pressed state follows the step-aside at once. One listener on the
 *  breakpoint, not on every resize; each matchMedia call returns its own list, so its onchange slot is ours alone. */
export const watchNarrow = (f: () => void) => {
  (query() ?? ({} as MediaQueryList)).onchange = f;
  // ponytail: no unsubscribe (first-load budget, +100 B). The top bar lives as long as its window, and a late call only
  // asks React to redraw a top bar that is gone (a no-op). Clear the slot here if a surface that unmounts ever uses this.
  return () => {};
};

/** Whether the left sidebar is in view: open, and not stepped aside for the right sidebar in a narrow window. */
export const leftShown = (open: boolean, narrow: boolean, rightShown: boolean) => open && !(narrow && rightShown);

/** The right sidebar as the left one's setter sees it (App.tsx keeps it current): `shown` is in view now, `open` is
 *  its saved state, which shows again on the Terminals screen. */
export type RightAside = { shown: boolean; open: boolean; close: () => void };
/** The left sidebar's next open state, for every path that sets it (shell/windowStore.ts): a toggle `(o) => !o` reads
 *  what is in view, and opening it in a narrow window while the right sidebar is open closes the right one. From another
 *  screen that closes its saved state, so it stays closed when Terminals comes back (the create rows switch there at once). */
export const nextLeft = (open: boolean, v: boolean | ((shown: boolean) => boolean), narrow: boolean, right: RightAside) => {
  const next = typeof v === "function" ? v(leftShown(open, narrow, right.shown)) : v;
  if (next && narrow && right.open) right.close();
  return next;
};
