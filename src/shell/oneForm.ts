// UX live audit W3 F2 (T-693): the sidebar shows one form at a time. Whichever form opened last stays; the
// others that were open close, so the filter panel, a group's settings, the new-workspace form and a
// project's settings never stack and push the list out of a narrow sidebar.
import { useEffect, useRef } from "react";

/** The forms to close: every one open now except those that have just opened (the last opened wins). */
export function formsToClose(before: Record<string, boolean>, now: Record<string, boolean>): string[] {
  const opened = Object.keys(now).filter((k) => now[k] && !before[k]);
  return opened.length === 0 ? [] : Object.keys(now).filter((k) => now[k] && !opened.includes(k));
}

/** Closes the other open forms when one opens. `open` and `close` share their keys. */
export function useOneForm(open: Record<string, boolean>, close: Record<string, () => void>) {
  const before = useRef(open);
  const key = Object.keys(open).map((k) => (open[k] ? 1 : 0)).join("");
  useEffect(() => {
    for (const k of formsToClose(before.current, open)) close[k]();
    before.current = open;
    // runs when which forms are open changes, not on every render
  }, [key]);
}
