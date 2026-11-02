// APP-070: nothing about the user's work leaves this computer on the app's behalf. This is the whole
// list of connections the app itself makes; privacy.test.ts checks the source for any other network
// client. Feedback and crash reports open GitHub's new-issue page in the user's own browser: the app
// submits nothing (APP-037: the message box in src/feedback builds the address with feedbackUrl).

export const OUTBOUND: ReadonlyArray<{ to: string; when: string }> = [
  { to: "GitHub Releases (TxaisX/kolux-rs)", when: "checking for a newer version, downloading it and reading its release notes" },
  { to: "the git remotes and the GitHub account you set up", when: "fetch, pull, push and ship, through git on this computer" },
  { to: "the AI providers you connected", when: "each agent's own command-line tool talks to its company with your account; the app neither relays nor records that traffic" },
  { to: "the sites you open in the browser pane", when: "browsing, as in any browser, and fetching the site icon each open page names, which may be on another site such as a CDN; the app fetches it itself, sends no cookies, and never from this computer or your local network unless the page itself is open at such an address" },
  { to: "script CDNs (cdnjs, jsdelivr, unpkg, tailwindcss, jquery)", when: "saving an artifact for offline use, to fetch the scripts its page names" },
  { to: "Kimi (api.moonshot.ai) and MiniMax (www.minimax.io)", when: "only when you press Check now in Settings > AI connections with a key you added" },
  { to: "Microsoft, from the WebView2 runtime", when: "the Edge engine that Windows lends the app's window keeps its own startup checks; they carry nothing of yours and the app neither uses nor can switch them off" },
];

/** GitHub's new-issue page of the project (APP-037 Compat). */
export const FEEDBACK_REPO = "https://github.com/TxaisX/kolux/issues/new";
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
  const foot = `\n\n---\nKolux RS ${version} on ${platform}${extra ? `\n${extra}` : ""}`;
  const whole = url(`${clean}${foot}`);
  if (whole.length <= URL_CAP) return whole;
  const note = "\n\n(trimmed to fit in a browser address)";
  let kept = Array.from(clean);
  while (kept.length > 0 && url(`${kept.join("")}${note}${foot}`).length > URL_CAP) kept = kept.slice(0, Math.floor(kept.length * 0.8));
  return url(`${kept.join("")}${note}${foot}`);
}
