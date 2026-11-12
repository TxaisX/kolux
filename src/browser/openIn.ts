// Goal 0 (Txais, 2026-11-12): Kolux draws no web pages of its own, so an address opens in the user's
// own browser (src/open/openExternal.ts). This module is what is left of the pane's address plumbing:
// the terminal panes, the window and the shortcut router still import these three names, so they keep
// working, and every one of them now opens the system browser. c3-terminal moves those imports to
// openExternal; then this file goes with them. No DOM, no webview, no browser IPC.
import { openExternal } from "../open/openExternal";

/** The old window event, kept only so the window's listener still has a name to compare. Nothing sends it. */
export const OPEN_IN_BROWSER = "kolux-open-in-browser";

export type OpenInBrowser = string | { url: string; title: string };

/** Opens `url` in the system browser. `_title` named the old in-app tab; there is no tab to name now. */
export const openInBrowser = (url: string, _title?: string) => {
  void openExternal(url);
};

/** The address and title of an `OpenInBrowser`, whichever shape was sent. */
export const openDetail = (d: OpenInBrowser): { url: string; title?: string } => (typeof d === "string" ? { url: d } : d);
