// T-272-c (BROW-016): when a page in this tab asks for more tabs than its family's allowance, the
// toolbar says so. The note stays as long as the allowance window (10 s) after the last refusal,
// counting the refusals meanwhile; the user's own navigation clears it.

export const BLOCKED_SHOW_MS = 10_000;
/** UX audit: how long the pane's one-line notice stays before it clears itself (it also has a close button). */
export const NOTICE_MS = 12_000;

export type Blocked = { count: number; at: number } | null;

/** One more refusal at `now`: counts on from a note still showing, else starts at one. */
export function blockedAgain(b: Blocked, now: number): Blocked {
  return { count: b && now - b.at < BLOCKED_SHOW_MS ? b.count + 1 : 1, at: now };
}

/** The toolbar text, or null once the note has run its time. */
export function blockedLabel(b: Blocked, now: number): string | null {
  if (!b || now - b.at >= BLOCKED_SHOW_MS) return null;
  return b.count === 1 ? "Popup blocked" : `${b.count} popups blocked`;
}
