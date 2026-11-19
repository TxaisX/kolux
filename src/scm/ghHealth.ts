// T-176-d (GIT-028): what Tasks (and the Checks panel) say when GitHub cannot be reached. A failed gh
// call is sorted by what gh printed into a kind of trouble; each kind has a banner in plain words, and
// a signed-out gh gets a short walk through signing in. Pure, tested on its own.

export type Trouble = "rate-limit" | "timeout" | "outage" | "signed-out" | "no-access" | "no-gh" | "other";

/** The one `scm_gh_budget` row shape this file needs (the same as scm/model.ts Budget). */
export type BudgetRow = { name: string; limit: number; remaining: number; reset: number };

/**
 * Sorts a failed call by what gh printed (the Rust side already puts gh's words through `gh_words`).
 * `signedIn` false (the account line reads "not signed in") turns an unknown failure into a sign-in problem.
 */
export function classify(error: string, signedIn?: boolean): Trouble {
  const t = error.toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  if (has("is not installed", "gh: command not found")) return "no-gh";
  // T-281 (GIT-045): signed in, but as an account that cannot see this repository (its words also name gh auth login).
  if (has("cannot see this repository") || (has("resource not accessible", "http 403") && !has("rate limit", "abuse detection"))) return "no-access";
  if (has("gh auth login", "not logged in", "sign in to github", "bad credentials", "http 401", "requires authentication", "gh is signed in to")) return "signed-out";
  if (has("rate limit", "abuse detection", "retry-after")) return "rate-limit";
  if (has("did not answer within", "gh did not finish")) return "timeout";
  if (has("http 500", "http 502", "http 503", "http 504", "bad gateway", "service unavailable", "could not resolve host", "network is unreachable", "connection refused", "connection reset", "timed out", "dial tcp", "tls handshake", "no such host")) return "outage";
  return signedIn === false ? "signed-out" : "other";
}

export type Banner = {
  kind: Exclude<Trouble, "other">;
  title: string;
  body: string;
  /** A numbered walk-through, for a problem the user fixes themselves. */
  steps: string[];
  /** When it is worth asking again by itself (ms since the epoch); undefined: only when the user asks. */
  until?: number;
};

const SLACK_MS = 1500;

/** The budget whose reset ends the wait: any used-up budget (the latest reset), else the Search one (what Tasks uses). */
export function resetOf(budgets: BudgetRow[] | null | undefined): number | undefined {
  if (!budgets || budgets.length === 0) return undefined;
  const spent = budgets.filter((b) => b.remaining === 0);
  if (spent.length > 0) return Math.max(...spent.map((b) => b.reset));
  return budgets.find((b) => b.name === "Search")?.reset ?? budgets[0].reset;
}

export function minutesUntil(resetSec: number, nowMs: number): number {
  return Math.max(1, Math.ceil((resetSec * 1000 - nowMs) / 60_000));
}

/** The banner for a kind of trouble; null for an error that is not about GitHub being out of reach. */
export function bannerOf(kind: Trouble, nowMs: number, resetSec?: number, host = "github.com"): Banner | null {
  switch (kind) {
    case "rate-limit": {
      const future = resetSec !== undefined && resetSec * 1000 > nowMs;
      return {
        kind,
        title: "GitHub is unavailable for now",
        body: future
          ? `GitHub's request limit is used up. Kolux waits instead of asking again, and loads the list by itself in about ${minutesUntil(resetSec, nowMs)} min.`
          : "GitHub's request limit is used up. Kolux waits instead of asking again; press Refresh in a few minutes.",
        steps: [],
        until: future ? resetSec * 1000 + SLACK_MS : undefined,
      };
    }
    case "timeout":
      return { kind, title: "GitHub is taking too long to answer", body: "The GitHub CLI did not answer in time, so Kolux stopped waiting. Nothing was changed. Press Refresh to try again.", steps: [] };
    case "outage":
      return { kind, title: "GitHub is unavailable for now", body: "GitHub, or the network between you and it, is not answering. Press Refresh to try again.", steps: [] };
    case "signed-out":
      return {
        kind,
        title: "Sign in to GitHub",
        body: "Kolux reads GitHub through the GitHub CLI (gh), and gh is not signed in here, or its sign-in expired.",
        steps: [
          "Open a terminal pane in Kolux.",
          host === "github.com" ? "Run: gh auth login" : `Run: gh auth login --hostname ${host}`,
          "Choose the host, then HTTPS, and sign in with the browser when it asks.",
          "Come back here and press Refresh.",
        ],
      };
    case "no-access":
      return {
        kind,
        title: "This account cannot see the repository",
        body: "gh is signed in, but with an account that has no access to this repository.",
        steps: [
          "Open a terminal pane in Kolux.",
          host === "github.com" ? "Run: gh auth status, to see which account gh uses" : `Run: gh auth status --hostname ${host}, to see which account gh uses`,
          host === "github.com" ? "Run: gh auth login, with an account that has access" : `Run: gh auth login --hostname ${host}, with an account that has access`,
          "Come back here and press Refresh.",
        ],
      };
    case "no-gh":
      return {
        kind,
        title: "The GitHub CLI is not installed",
        body: "Kolux reads GitHub through the GitHub CLI (gh), which this computer does not have.",
        steps: ["Install it from https://cli.github.com.", "Open a terminal pane in Kolux and run: gh auth login", "Come back here and press Refresh."],
      };
    default:
      return null;
  }
}

/** How long to wait before asking again by itself, or null when the banner has no time. */
export function waitMs(b: Banner | null, nowMs: number): number | null {
  return b?.until === undefined ? null : Math.max(0, b.until - nowMs);
}
