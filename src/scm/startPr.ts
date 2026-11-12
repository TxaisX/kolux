// VIEW-074: starting a pull request from the Checks panel. The panel's empty state asks whether
// this branch is ready; a readiness answer is tied to the exact worktree, branch and git state and
// goes stale after about five minutes. The composer opens only when readiness is confirmed; when
// the only thing missing is a push, one combined push-and-create action is offered. A hard error is
// kept per worktree, shown only while the git state it was raised for is unchanged (fixing the
// cause clears it), and a check for one worktree never clears another worktree's error.
import { createBlock, prReason, type Status } from "./model";
import type { ReviewLookup } from "./prFind";

export const READINESS_TTL_MS = 5 * 60_000;

export type Readiness = { key: string; at: number; reason: string | null; push: "none" | "publish" | "push" };

/** The exact worktree, branch and git state an answer belongs to. */
export const readinessKey = (dir: string, s: Status): string => [dir, s.branch ?? "", s.upstream ?? "", s.head ?? "", s.ahead, s.behind, s.staged.length + s.changed.length, s.conflicts.length, s.base ?? ""].join("|");

const PUSH_REASON = /^(Push the branch first|Push \d+ commits? first)$/;

/** Reads a fresh status: ready, or what is missing. A missing push alone, with the rest in order, is its own state. */
export function assess(dir: string, s: Status, now: number): Readiness {
  const reason = prReason(s, { loading: false, pr: null, error: null });
  const key = readinessKey(dir, s);
  if (reason !== null && PUSH_REASON.test(reason)) {
    // Without a known base the combined action cannot be trusted.
    if (s.base === null) return { key, at: now, reason: "No base branch on the remote", push: "none" };
    return { key, at: now, reason: null, push: s.upstream === null ? "publish" : "push" };
  }
  return { key, at: now, reason, push: "none" };
}

/** An answer counts only for the same state and only for about five minutes. */
export const confirmed = (r: Readiness | null, key: string, now: number): r is Readiness => r !== null && r.key === key && now - r.at < READINESS_TTL_MS && r.reason === null;

export type Offer = { kind: "check" } | { kind: "create" } | { kind: "push-create"; push: "publish" | "push" } | { kind: "blocked"; reason: string };

/** What the empty state offers for the newest status: the composer, the combined action, the reason it cannot, or a fresh check. */
export function offerFor(r: Readiness | null, key: string | null, now: number): Offer {
  if (r === null || key === null || r.key !== key || now - r.at >= READINESS_TTL_MS) return { kind: "check" };
  if (r.reason !== null) return { kind: "blocked", reason: r.reason };
  return r.push === "none" ? { kind: "create" } : { kind: "push-create", push: r.push };
}

export { createBlock };

/** Row 953: the hint under the review note. Where the lookup is unsupported too, the review note already says it in one line, so the block adds nothing. */
export const blockHint = (offer: Offer, lookup: ReviewLookup | undefined): string | null => (offer.kind === "blocked" && offer.reason !== "" && lookup?.kind !== "unsupported" ? offer.reason : null);

/** Whether the empty state may offer to start a pull request: not on a non-GitHub remote, not with an open one already linked. */
export const canStartReview = (blockedBy: string | null, linked: boolean): boolean => blockedBy === null && !linked;

/** The empty state's offer: a linked pull request or a non-GitHub remote blocks it (the reason is shown for the remote only). */
export const offerOf = (i: { linked: boolean; blockedBy: string | null; ready: Readiness | null; key: string | null; now: number }): Offer =>
  i.blockedBy !== null ? { kind: "blocked", reason: i.blockedBy } : i.linked ? { kind: "blocked", reason: "" } : offerFor(i.ready, i.key, i.now);

/** Hard errors by worktree, each with the git state it was raised for. */
export type ErrorBook = Readonly<Record<string, { key: string; message: string }>>;
export const raise = (book: ErrorBook, dir: string, key: string, message: string): ErrorBook => ({ ...book, [dir]: { key, message } });
/** The error to show for `dir` in the state `key`; a changed state means the cause may be fixed, so it is gone. Other worktrees never matter. */
export const errorShown = (book: ErrorBook, dir: string, key: string | null): string | null => (book[dir] && book[dir].key === key ? book[dir].message : null);
export const dismiss = (book: ErrorBook, dir: string): ErrorBook => {
  const { [dir]: _gone, ...rest } = book;
  return rest;
};

/** The hint beside the review link. Kolux draws no web pages (Goal 0), so the review opens in the system browser, every click. */
export const REVIEW_HINT = "Opens in your browser";
