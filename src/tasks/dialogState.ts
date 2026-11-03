// UX-audit fixes for the task dialog (tasks.md rows 5-7), kept out of the component so they are tested:
// what the description area shows while the item is read, the unsaved description draft that
// survives the dialog being closed, and when focus has been lost inside the dialog.

/** What the description area shows: still reading, the read failed (a Retry is offered), or the text. */
export function bodyView(detail: unknown | null, error: string | null): "loading" | "failed" | "ready" {
  if (detail !== null) return "ready";
  return error ? "failed" : "loading";
}

// An edit of an item's description that was closed without saving, by item address.
const drafts = new Map<string, string>();

/** Remember (or forget) the unsaved description of one item when its dialog closes: kept only when
 *  it differs from what GitHub last said. */
export function stashDraft(url: string, draft: string | null, saved: string | null): void {
  if (draft !== null && draft !== (saved ?? "")) drafts.set(url, draft);
  else drafts.delete(url);
}

/** The unsaved description left behind the last time this item's dialog closed, if any. */
export function peekDraft(url: string): string | null {
  return drafts.get(url) ?? null;
}

/** Whether focus has fallen to nothing (a clicked button was removed or disabled), so it must be put back.
 *  Focus somewhere else on purpose (the palette, another window part) is left alone. */
export function focusLost<T>(active: T | null, body: T): boolean {
  return active === null || active === body;
}
