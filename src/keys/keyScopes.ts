// APP-013 (T-248-c): which command groups the window-level key handler tries for the surface that has focus.
// Tab switching (Ctrl+Tab, tab numbers, stepping) belongs to every surface of the terminals screen, the
// explorer tree included, so the tree never swallows it.
import type { Scope } from "./actions";

export type KeySurface = { screen: string; kind?: "browser" | "editor" | "preview" | "diff" | "changes" | "check"; inTree: boolean };

export function scopesFor({ screen, kind, inTree }: KeySurface): Scope[] {
  if (inTree) return ["global", "tabs"]; // the explorer's own keys come with T-094-b
  if (kind === "editor" || kind === "diff") return ["editor", "global", "tabs"];
  if (kind === "preview" || kind === "check") return ["global", "tabs"];
  return screen === "terminals" ? ["global", "terminal", "tabs"] : ["global"];
}
