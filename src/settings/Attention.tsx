// ACCT-013: a needs-attention card states one plain reason and offers the one fix that fits it,
// or no button when the only fix is to wait (a usage limit shows when it lifts). An unknown
// reason is shown for information only. The back end names the reason; this file owns the words
// on the button.
import { invoke } from "@tauri-apps/api/core";
import { locale } from "../language";

export type Reason =
  | "browser-blocked"
  | "sign-in-refused"
  | "plan"
  | "not-found"
  | "smartscreen"
  | "usage-limit"
  | "key-expiring"
  | "key-expired"
  | "install-failed"
  | "install-unavailable"
  | "unknown";
export type Attention = { reason: Reason; message: string; resetsAt: number | null };
export type Fix = "Renew" | "Check again" | "Try installing again" | "Open install page" | "Try again" | "Use a 1-year key instead";
/** Where the card is: the Claude key card, the Claude accounts card, Codex or an install. */
export type Route = "claude-key" | "claude-account" | "codex" | "install";

const fixes: Record<Reason, Fix | null> = {
  "browser-blocked": "Try again",
  "sign-in-refused": "Try again",
  plan: "Check again",
  "not-found": "Check again",
  smartscreen: "Open install page",
  "usage-limit": null,
  "key-expiring": "Renew",
  "key-expired": "Renew",
  "install-failed": "Try installing again",
  "install-unavailable": "Open install page",
  unknown: null,
};

export function fixFor(a: Attention | null, route: Route): Fix | null {
  if (!a) return null;
  // An account sign-in the browser refused: the 1-year key is the other way in.
  if (route === "claude-account" && a.reason === "sign-in-refused") return "Use a 1-year key instead";
  return fixes[a.reason] ?? null;
}

/** "Open install page" opens the agent's own page; every other fix starts the card's sign-in again. */
export function openInstallPage(agent: "claude" | "codex" | "grok"): Promise<void> {
  return invoke("open_install_page", { agent });
}

/** "15:40", or "Fri 15:40" when it is not today. */
export function resetTime(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString(locale(), { weekday: "short" })} ${time}`;
}

export function attentionText(a: Attention, now = Date.now()): string {
  if (a.reason === "usage-limit" && a.resetsAt) return `${a.message} It can be used again at ${resetTime(a.resetsAt, now)}.`;
  return a.message;
}

/** ACCT-014: the window event "Check again" sends; the grid detects the agents afresh and every
 *  connection card re-reads its status on it. */
export const CHECK_AGAIN = "kolux-check-again";

/** What a fix button does. "check" detects afresh and clears the stale note (the card's Cancel),
 *  never starting a sign-in; "connect" starts the card's sign-in again. */
export function fixDoes(f: Fix): "check" | "install-page" | "key" | "connect" {
  return f === "Check again" ? "check" : f === "Open install page" ? "install-page" : f === "Use a 1-year key instead" ? "key" : "connect";
}

/** `offer` = false: the card's own buttons already cover it, so only the reason is shown.
 *  "Check again" also tells the grid and every card to detect afresh (see fixDoes). */
export function AttentionNote({ attention, route, busy, offer = true, onFix }: { attention: Attention | null; route: Route; busy?: boolean; offer?: boolean; onFix: (f: Fix) => void }) {
  if (!attention) return null;
  const fix = offer ? fixFor(attention, route) : null;
  return (
    <div className="attn" data-reason={attention.reason} role="alert">
      <p className="conn-detail warn">{attentionText(attention)}</p>
      {fix && (
        <button className="btn primary" disabled={busy} onClick={() => (fixDoes(fix) === "check" && window.dispatchEvent(new Event(CHECK_AGAIN)), onFix(fix))}>
          {fix}
        </button>
      )}
    </div>
  );
}
