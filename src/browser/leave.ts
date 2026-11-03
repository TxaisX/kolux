// T-661 (DT-C97, audit backlog row 57): a page's request that acts outside Kolux (the system browser, or
// dropping trust in a certificate) is never carried out on the page's word plus a click, because a page
// can steer where a click lands. Kolux asks first, in its own bar above the page, naming the host.

export type LeaveWhat = "system" | "revoke";
/** `at` is when the ask appeared (performance.now()); the confirm counts only LEAVE_ARM_MS after it. */
export type Leave = { what: LeaveWhat; url: string; host: string; at: number };

/** The ask for `url`, or null when it is not an http(s) address (nothing is offered then). The host is
 * the parsed one (punycode, no user name), so `https://kolux@other.example/` names other.example, and the
 * address kept is the parsed one with any user name dropped, so what the bar shows is what is handed over. */
export function leaveAsk(what: LeaveWhat, url: string, at = performance.now()): Leave | null {
  if (!/^https?:/i.test(url)) return null;
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    return u.host ? { what, url: u.href, host: u.host, at } : null;
  } catch {
    return null;
  }
}

/** Whether two addresses are the same site (scheme, host and port); false when either does not parse. */
export function sameOrigin(a: string, b: string) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** How long the confirm button stays off after an ask appears, so a click already on its way (the
 * page's lure) cannot land on it; a new ask, even one replacing another, starts the wait again. */
export const LEAVE_ARM_MS = 600;

/** Whether a confirm at `now` counts: the ask's own clock, so a swapped ask is never armed early. */
export const leaveReady = (l: Leave, now = performance.now()) => now - l.at >= LEAVE_ARM_MS;

/** The longest address the bar shows in full; past it the bar shows the start and an ellipsis. */
export const LEAVE_URL_SHOWN = 300;

/** The question as one string (`question`, the bar's label) and around the host (`lead`, `tail`). The
 * confirm button names the host too, so nothing laid over the question can hide where it goes. */
export function leaveText(l: Leave): { question: string; lead: string; tail: string; confirm: string; shown: string } {
  const [lead, tail, verb] =
    l.what === "system" ? ["Open ", " in your default browser?", "Open"] : ["Stop trusting the certificate of ", "?", "Stop trusting"];
  const shown = l.url.length > LEAVE_URL_SHOWN ? `${l.url.slice(0, LEAVE_URL_SHOWN)}…` : l.url;
  return { question: `${lead}${l.host}${tail}`, lead, tail, confirm: `${verb} ${l.host}`, shown };
}
