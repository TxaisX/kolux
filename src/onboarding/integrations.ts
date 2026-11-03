// ONB-018: the Connect integrations step. A review step (GitHub signed in and its token accepted)
// and a task-source step that waits behind it. The rebuild keeps GitHub only (ONB-019 dropped the
// other providers). Pure rules, so they are tested without a browser; IntegrationsPanel (in
// StepPanels.tsx) draws them.
/** One check's standing. "stale" is an answer from before the latest Re-check began: it is not trusted. */
export type Check = "pending" | "ok" | "failed" | "stale";
/** What was seen of GitHub: the account gh is signed in as (from gh's own config, no network), whether
 *  its token was accepted (a call to the API) and whether the tracker (the search budget) answered. */
export type Seen = { account: string | null; token: Check; tracker: Check };
export const UNSEEN: Seen = { account: null, token: "pending", tracker: "pending" };

export type IntState = "active" | "waiting" | "done";
export type Steps = { review: IntState; tasks: IntState; source: string | null; reviewNote: string | null; tasksNote: string | null };

/** ONB-018: the review step is active first; the task step waits (folded, but openable). A cached sign-in
 *  is not connected while its token check is stale, pending or failed, and a failed token sign-in does
 *  not count as ready for review. A connected code host completes the task step only once review is
 *  connected and the tracker checks have finished; then the step folds into a summary naming the source. */
/** The command the Connect GitHub button types into the small terminal (the user presses Enter). */
export const GH_LOGIN = "gh auth login";

export function integrationSteps(s: Seen): Steps {
  const review: IntState = s.account && s.token === "ok" ? "done" : "active";
  const reviewNote =
    review === "done"
      ? null
      : !s.account
        ? "GitHub is not connected. Run gh auth login in a terminal, then check again."
        : s.token === "failed"
          ? "GitHub did not accept the sign-in. Run gh auth login again, then check again."
          : "Checking the GitHub sign-in...";
  if (review !== "done") return { review, tasks: "waiting", source: null, reviewNote, tasksNote: null };
  if (s.tracker === "ok") return { review, tasks: "done", source: "GitHub", reviewNote, tasksNote: null };
  return {
    review,
    tasks: "active",
    source: null,
    reviewNote,
    tasksNote: s.tracker === "failed" ? "GitHub's task search did not answer. Check again in a moment." : "Checking GitHub's task search...",
  };
}

/** The summary the folded task step shows. */
export const taskSummary = (s: Steps, account: string | null): string | null =>
  s.source ? `Tasks come from ${s.source}${account ? ` (${account})` : ""}` : null;

/** Re-check begins: every answer so far is stale until the new one lands. */
export const restale = (s: Seen): Seen => ({
  account: s.account,
  token: s.token === "pending" ? "pending" : "stale",
  tracker: s.tracker === "pending" ? "pending" : "stale",
});

type Call = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
export type Row = { name: string };

/** What gh says when GitHub turned the sign-in down (a revoked or expired token, a logged-out gh), as
 *  against any other failure (offline, a timeout, gh could not run), which says nothing about the token. */
const REJECTED = /\b40[13]\b|bad credentials|requires authentication|gh auth login|not logged in|sign in to github|token/i;

/** One look at GitHub. `offline` is true when the budget call failed for a reason other than the sign-in
 *  being turned down: the answer is then "could not tell", which a caller may cover with an earlier one. */
async function look(call: Call): Promise<{ seen: Seen; offline: boolean }> {
  const account = await call<string | null>("scm_gh_account", { host: "github.com" }).catch(() => null);
  if (!account) return { seen: { account: null, token: "pending", tracker: "pending" }, offline: false };
  let said = "";
  const rows = await call<Row[]>("scm_gh_budget").catch((e) => ((said = String(e instanceof Error ? e.message : e)), null));
  if (!rows || rows.length === 0) return { seen: { account, token: "failed", tracker: "failed" }, offline: !rows && !REJECTED.test(said) };
  // The Rust side names the budgets REST, Search and GraphQL.
  return { seen: { account, token: "ok", tracker: rows.some((r) => r.name.toLowerCase() === "search") ? "ok" : "failed" }, offline: false };
}

/** Reads GitHub: the account first (cheap, from gh's config), then its API budget, which needs the token to work. */
export async function readSeen(call: Call): Promise<Seen> {
  return (await look(call)).seen;
}

/** How long a read of GitHub is trusted before gh is asked again. */
export const SEEN_FRESH_MS = 60_000;

/** Whether an answer is a complete good one: signed in, token accepted, task search answered. Only that is worth
 *  remembering; anything else (not connected, a token turned down, a half answer) is looked at again next time, so
 *  a sign-in done in a terminal shows on the very next focus, guide close or project add (FIX-2). */
const good = (s: Seen) => s.account !== null && s.token === "ok" && s.tracker === "ok";

/** FIX-1: `readSeen` with a memory. A good read is answered from memory for a minute, so opening the guide, focusing
 *  the window or adding a project does not start gh (and a network round trip) every time. When a later read fails
 *  on the network the last good answer for the same account stands, so the sidebar ring does not dip while offline.
 *  A token GitHub turns down, a different account or a sign-out is never covered up. `force` (the Re-check button)
 *  always asks again and reports what it finds, but a good answer it gets is remembered.
 *  FIX-2: only a good answer is held, and reads asked while one is running share it (a `force` read never joins an
 *  older one). The one gap left: a sign-out, a revoked token or an account switch (`gh auth switch`) inside the
 *  minute still reads as connected until the minute ends or Re-check is pressed.
 *  FIX-3: a read that was running when a newer one began is answered with the newer one's answer, in memory and for
 *  the caller alike, so a screen that shows what it gets (the guide, which asks without `force`) never lands on an
 *  older answer after the Integrations panel's Re-check showed a newer one. Every caller gets this from here, so none
 *  needs its own latest-wins counter. (StepPanels keeps its own `turn` counter for a different reason: it also ignores
 *  an answer that arrives after the panel was closed.)
 *  Cost of re-reading a not-good answer: each such read runs gh once (an account lookup and one API call). It is bounded
 *  by who asks, not by a timer: window focus is floored at 30 s (sidebar.ts FOCUS_FLOOR_MS), guide close and project add
 *  are user actions, and reads asked while one is running share it. A short hold for not-good answers was left out on
 *  purpose, so a sign-in done in a terminal is seen by the very next read and a failure is never held. */
export function createSeenReader(now: () => number = Date.now) {
  let kept: { at: number; seen: Seen } | null = null;
  let flying: Promise<Seen> | null = null;
  let newest: Promise<Seen> | null = null;
  let latest = 0;
  const run = async (call: Call, force: boolean, mine: number): Promise<Seen> => {
    const { seen, offline } = await look(call);
    // A newer read began while this one ran (a Re-check, or a read after this one failed): its answer stands for this caller too.
    // The wait is bounded in Rust (scm.rs: scm_gh_account stops gh at GH_ACCOUNT_LIMIT, 5 s; scm_gh_budget at GH_LIMIT, 30 s), so a hung gh ends in a failed answer, never a guide that waits for good (FIX-4).
    // An older good answer is dropped when the newest read is an offline failure with nothing kept to cover it: latest wins, and a not-good answer is never kept (FIX-2).
    if (mine !== latest && newest) return newest;
    if (offline && !force && kept?.seen.token === "ok" && kept.seen.account === seen.account) {
      kept = { at: now(), seen: kept.seen };
      return kept.seen;
    }
    kept = !offline && good(seen) ? { at: now(), seen } : null;
    return seen;
  };
  return (call: Call, opts: { force?: boolean } = {}): Promise<Seen> => {
    const force = opts.force === true;
    if (!force) {
      if (kept && now() - kept.at < SEEN_FRESH_MS) return Promise.resolve(kept.seen);
      if (flying) return flying;
    }
    const p: Promise<Seen> = run(call, force, ++latest).finally(() => {
      if (flying === p) flying = null;
    });
    flying = p;
    newest = p;
    return p;
  };
}

/** The window's one remembered read. */
export const readSeenCached = createSeenReader();

/** FIX-1: whether tasks and pull requests can come from GitHub, by the same rule as the Connect integrations
 *  step (the sign-in is accepted and the task search answered); null while nothing has been read. */
export const taskSourceOf = (s: Seen | null): boolean | null => (s ? integrationSteps(s).tasks === "done" : null);
