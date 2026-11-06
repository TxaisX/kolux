// APP-037 (the Send Feedback message box) and PROJ-089 (feedback opens already filled in; text typed
// above the pre-filled block is kept). Everything here is pure: the dialog component only wires it
// to the screen and hands the finished address to the browser. The app makes no network request.
import { feedbackUrl, type FeedbackFacts } from "../settings/privacy";
import { scrub } from "./scrub";

/** What stands between the user's text and the block the app adds. */
export const MARK = "\n\n---\n";
/** The first words of the block: how a block is told from a rule the user typed. */
const BLOCK_START = "Kolux ";
const TRIM_NOTE = "trimmed to fit in a browser address";

export type Issue = { ok: true; url: string; trimmed: boolean } | { ok: false; error: string };

export type State = { open: boolean; draft: string; anonymous: boolean; facts: FeedbackFacts | null; error: string; note: string; sending: boolean };
export type Act =
  | { t: "open"; facts: FeedbackFacts; text?: string }
  | { t: "facts"; facts: FeedbackFacts }
  | { t: "type"; draft: string }
  | { t: "anon"; on: boolean }
  | { t: "send" }
  | { t: "sent"; trimmed: boolean; extra?: string }
  | { t: "fail"; error: string }
  | { t: "close" };

export const closed: State = { open: false, draft: "", anonymous: false, facts: null, error: "", note: "", sending: false };

/** The lines after the first one: the system, and the GitHub login unless the user is anonymous. */
function extra(f: FeedbackFacts, anonymous: boolean): string {
  const lines = [`System: ${f.release} (${f.arch})`];
  if (f.login && !anonymous) lines.push(`GitHub: ${f.login}`);
  return lines.join("\n");
}

/** The block the app adds under the text: version, platform, system release, architecture, login. */
export function block(f: FeedbackFacts, anonymous: boolean): string {
  return `${BLOCK_START}${f.version} on ${f.platform}\n${extra(f, anonymous)}`;
}

/** What the user wrote: everything above the block. A block they deleted leaves the whole text. */
export function typedText(draft: string): string {
  const at = draft.lastIndexOf(MARK + BLOCK_START);
  return at < 0 ? draft : draft.slice(0, at);
}

/** `draft` with its block rebuilt from the real facts; the text above it is kept as typed. */
export function withBlock(draft: string, f: FeedbackFacts, anonymous: boolean): string {
  return typedText(draft) + MARK + block(f, anonymous);
}

/** The new-issue address for a draft, or why there is none. The block under the text is always
 *  rebuilt from the real facts, and the text is scrubbed of paths and secrets first. */
export function issue(draft: string, f: FeedbackFacts, anonymous: boolean): Issue {
  try {
    const typed = typedText(draft);
    if (typed.trim() === "") return { ok: false, error: "Write something first: an empty report is not opened on GitHub." };
    const url = feedbackUrl(f.version, f.platform, scrub(typed), extra(f, anonymous));
    const trimmed = (new URL(url).searchParams.get("body") ?? "").includes(TRIM_NOTE);
    return { ok: true, url, trimmed };
  } catch (e) {
    // FIX-1: a failure here must show in the box, never leave the button doing nothing
    return { ok: false, error: `Could not build the report: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export const SENT = "A new-issue page opened in your browser; the app sent nothing. Read it over there, then submit it or close it.";

export function reduce(s: State, a: Act): State {
  switch (a.t) {
    case "open": {
      // FIX-1: a report closed unsent (Cancel, Escape, a stray click on the background) is still there
      // at the next open; text handed in on purpose, such as a crash report, replaces it
      const keep = !a.text && typedText(s.draft).trim() !== "";
      return { open: true, draft: withBlock(keep ? typedText(s.draft) : (a.text ?? ""), a.facts, keep && s.anonymous), anonymous: keep && s.anonymous, facts: a.facts, error: "", note: "", sending: false };
    }
    case "facts":
      return { ...s, facts: a.facts, draft: withBlock(s.draft, a.facts, s.anonymous) };
    case "type":
      return { ...s, draft: a.draft, error: "" };
    case "anon":
      return { ...s, anonymous: a.on, draft: s.facts ? withBlock(s.draft, s.facts, a.on) : s.draft };
    case "send":
      return { ...s, sending: true, error: "" };
    case "sent":
      return { ...s, sending: false, open: false, draft: "", error: "", note: (a.trimmed ? `${SENT} Your report was long, so it was ${TRIM_NOTE}.` : SENT) + (a.extra ? ` ${a.extra}` : "") };
    case "fail":
      return { ...s, sending: false, error: a.error };
    case "close":
      // C04-R4-01: a close ends the send it was waiting on, so the state never claims one is running.
      return { ...s, open: false, sending: false };
  }
}

/** Which of `count` controls takes focus when Tab (Shift+Tab: `shift`) leaves control `at` (-1: none): focus wraps at both ends. */
export function tabTarget(count: number, at: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (at < 0) return shift ? count - 1 : 0;
  return (at + (shift ? count - 1 : 1)) % count;
}

/** Where the "sent" note sits: bottom-right, 40px up. The update card and notice take the bottom-left at the same 40px
 *  (update/update.css), above the 24px status bar, so the two never overlap and neither covers the bar. */
export const NOTE_POS = { right: 16, bottom: 40 } as const;

/** Puts focus back on what had it before the box opened, when that is still on the page. */
export function restoreFocus(prev: { isConnected: boolean; focus: () => void } | null): boolean {
  if (!prev || !prev.isConnected) return false;
  prev.focus();
  return true;
}
