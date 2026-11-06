// APP-070: the list of connections the app itself makes is OUTBOUND in outbound.ts. Feedback and
// crash reports open GitHub's new-issue page in the user's own browser: the app submits nothing
// (APP-037: the message box in src/feedback builds the address with feedbackUrl).

import { GITHUB_URL } from "../onboarding/links";

/** GitHub's new-issue page of the project (APP-037 Compat). */
export const FEEDBACK_REPO = `${GITHUB_URL}/issues/new`;
/** Browsers and GitHub take addresses this long; a longer report is trimmed with a note. */
export const URL_CAP = 8000;

/** What the feedback box adds under the user's text (APP-037): the system facts, and the GitHub login unless anonymous. */
export type FeedbackFacts = { version: string; platform: string; release: string; arch: string; login: string | null };

/** A stray half of an emoji (pasted or cut elsewhere) is replaced: encodeURIComponent throws on one. */
const wellFormed = (s: string) => s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");

/** The first `n` characters, counted by code point so an emoji is kept whole or left out, never split. */
const first = (s: string, n: number) => Array.from(s).slice(0, n).join("");

/** The pre-filled new-issue address: a [Feedback] title from the first line (80 characters at most),
 *  the text, then the version and platform. A cut never splits an emoji (FIX-1). */
export function feedbackUrl(version: string, platform: string, text = "", extra = ""): string {
  const clean = wellFormed(text.trim());
  const title = first(`[Feedback] ${clean.split(/\r?\n/)[0]}`.trim(), 80);
  const url = (body: string) => `${FEEDBACK_REPO}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  const foot = `\n\n---\nKolux ${version} on ${platform}${extra ? `\n${extra}` : ""}`;
  const whole = url(`${clean}${foot}`);
  if (whole.length <= URL_CAP) return whole;
  const note = "\n\n(trimmed to fit in a browser address)";
  let kept = Array.from(clean);
  while (kept.length > 0 && url(`${kept.join("")}${note}${foot}`).length > URL_CAP) kept = kept.slice(0, Math.floor(kept.length * 0.8));
  return url(`${kept.join("")}${note}${foot}`);
}
