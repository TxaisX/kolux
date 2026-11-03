// UX-audit fixes for the pull request page (tasks.md rows 8-10), kept out of the component so they are
// tested: the line that says part of the page could not be read, and what Escape does on the page.

/** `parts` are the pieces that failed to read, each already worded ("the checks (gh could not ...)").
 *  Null when everything was read. */
export function partialNote(parts: string[]): string | null {
  if (parts.length === 0) return null;
  return `Could not read ${parts.join(" or ")}. What is shown for ${parts.length === 1 ? "it" : "them"} may be empty; press Refresh to try again.`;
}

/** What Escape does on the page, first match wins: stays put when the key belongs to a text field or a menu
 *  or dialog above the page; closes a merge confirm that is open; holds (stays, and keeps the page from
 *  leaving) during an edit, which has its own Cancel; else goes back to Tasks. */
export function escapeStep(o: { confirming: boolean; typing: boolean; overlay: boolean; editing: boolean }): "cancel-merge" | "stay" | "hold" | "back" {
  if (o.typing || o.overlay) return "stay";
  if (o.confirming) return "cancel-merge";
  if (o.editing) return "hold";
  return "back";
}
