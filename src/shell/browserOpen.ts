// UX lane A (shell.md row 3): "Open in browser" and the Preview button add a browser tab to the focused
// split (useWindowStart.ts). The tab sits in the Terminals grid, so a window on Board, Tower, Inbox or a
// page over the grid must come back to Terminals, or the click seems to do nothing.
import { useEffect } from "react";
import { OPEN_IN_BROWSER } from "../browser/openIn";

/** Runs `show` for every request to open a page in the built-in browser. Returns the stop. */
export function watchBrowserOpen(target: Pick<EventTarget, "addEventListener" | "removeEventListener">, show: () => void): () => void {
  target.addEventListener(OPEN_IN_BROWSER, show);
  return () => target.removeEventListener(OPEN_IN_BROWSER, show);
}

/** Brings the Terminals screen to the front, closing any page over its grid. */
export function useShowTerminalsOnBrowserOpen(setScreen: (s: "terminals") => void, setPage: (p: null) => void): void {
  useEffect(
    () =>
      watchBrowserOpen(window, () => {
        setScreen("terminals");
        setPage(null);
      }),
    [],
  );
}
