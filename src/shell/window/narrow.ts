// T-699 (DT-C135): in a window under 900 CSS px (the app's minimum width at 100 % zoom, so reached by zooming in
// or a small window) the two side panels take turns. styles.css hides the left sidebar while the right sidebar is
// showing; this keeps the left toggle honest about that, and every path that opens the left sidebar brings it back.
export const NARROW_PX = 900;
/** True while the window is under NARROW_PX CSS px wide. Read at render, not subscribed (first-load budget): the left
 *  toggle's pressed state catches up with a resize on the top bar's next render; the setters read it live. */
export const isNarrow = () => !!globalThis.matchMedia?.(`(max-width: ${NARROW_PX - 1}px)`)?.matches;

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
