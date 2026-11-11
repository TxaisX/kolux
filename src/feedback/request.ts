// The one-line request that opens the Send Feedback box. It lives apart from FeedbackDialog.tsx so the
// crash screen, Help and Settings can ask for the box without pulling the dialog's code into the first load.
export const FEEDBACK_EVENT = "kolux-feedback";

type Request = { text: string; crash: boolean };
/** A request made while no box was listening yet (its code was still arriving); the box takes it when it mounts. */
let parked: { at: number; r: Request } | null = null;
/** Longer than any read of the box's code; an older request is stale, not something the user is waiting on. */
const PARK_MS = 10_000;

/** Opens the message box, optionally with some text already above the block; `crash` marks a crash report. */
export function requestFeedback(text = "", crash = false) {
  parked = { at: Date.now(), r: { text, crash } };
  window.dispatchEvent(new CustomEvent(FEEDBACK_EVENT, { detail: { text, crash } }));
}

/** The box heard a request (or has just mounted): returns the one that is still waiting, once. */
export function takeParked(): Request | null {
  const p = parked;
  parked = null;
  return p && Date.now() - p.at < PARK_MS ? p.r : null;
}
