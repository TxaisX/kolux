import { expect, test } from "vitest";
import { READINESS_TTL_MS, REVIEW_HINT, assess, canStartReview, confirmed, createBlock, dismiss, errorShown, offerFor, offerOf, offerUi, raise, readinessKey, type Offer } from "./startPr";
import type { Status } from "./model";

const st = (over: Partial<Status> = {}): Status =>
  ({ branch: "feat", upstream: "origin/feat", ahead: 0, behind: 0, rewritten: false, base: "origin/main", head: "abc", staged: [], changed: [], untracked: [], conflicts: [], operation: null, resolved: [], ...over }) as Status;

test("VIEW-074 a pushed, clean branch is ready and offers the composer", () => {
  const r = assess("/w", st(), 1000);
  expect(r.reason).toBeNull();
  expect(offerFor(r, readinessKey("/w", st()), 1000)).toEqual({ kind: "create" });
});

test("VIEW-074 an unpushed branch offers one combined push-and-create action, but only when the rest is in order", () => {
  const r = assess("/w", st({ upstream: null }), 0);
  expect(offerFor(r, readinessKey("/w", st({ upstream: null })), 0)).toEqual({ kind: "push-create", push: "publish" });
  const ahead = assess("/w", st({ ahead: 2 }), 0);
  expect(offerFor(ahead, readinessKey("/w", st({ ahead: 2 })), 0)).toEqual({ kind: "push-create", push: "push" });
  const dirty = assess("/w", st({ upstream: null, changed: [{ path: "a" } as never] }), 0);
  expect(dirty.reason).toBe("Commit your changes first");
  expect(assess("/w", st({ upstream: null, base: null }), 0).reason).toBe("No base branch on the remote");
});

test("VIEW-074 behind, on the base branch or conflicted is blocked with its reason", () => {
  expect(assess("/w", st({ behind: 1 }), 0).reason).toMatch(/Sync first/);
  expect(assess("/w", st({ branch: "main", upstream: "origin/main", base: "origin/main" }), 0).reason).toBe("Move to a feature branch first");
  expect(assess("/w", st({ conflicts: [{ path: "a" } as never] }), 0).reason).toBe("Resolve the conflicts first");
});

test("VIEW-074 an answer goes stale after five minutes and does not carry to another git state or worktree", () => {
  const r = assess("/w", st(), 0);
  const key = readinessKey("/w", st());
  expect(confirmed(r, key, READINESS_TTL_MS - 1)).toBe(true);
  expect(confirmed(r, key, READINESS_TTL_MS)).toBe(false);
  expect(offerFor(r, key, READINESS_TTL_MS)).toEqual({ kind: "check" });
  expect(offerFor(r, readinessKey("/w", st({ head: "def" })), 10)).toEqual({ kind: "check" });
  expect(offerFor(r, readinessKey("/other", st()), 10)).toEqual({ kind: "check" });
});

test("VIEW-074 a hard error clears when the state is fixed and a check for one worktree never clears another's", () => {
  const kA = readinessKey("/a", st({ ahead: 1 }));
  let book = raise({}, "/a", kA, "gh: could not create");
  book = raise(book, "/b", "kb", "other failure");
  expect(errorShown(book, "/a", kA)).toBe("gh: could not create");
  expect(errorShown(book, "/a", readinessKey("/a", st())), "the state changed: the cause may be fixed").toBeNull();
  expect(errorShown(dismiss(book, "/b"), "/a", kA)).toBe("gh: could not create");
  expect(errorShown(dismiss(book, "/a"), "/b", "kb")).toBe("other failure");
});

test("VIEW-074 the review hint says the pull request opens in your browser", () => {
  expect(REVIEW_HINT).toContain("your browser");
});

// Row 76: a remote that is not GitHub never gets a create action or the one-click button (the one-click path
// would commit, push and run the writer before gh failed on the address).
test("row 76 a non-GitHub provider blocks the create offer and the one-click, in its own words", () => {
  const ready = assess("/w", st(), 1000);
  const key = readinessKey("/w", st());
  expect(createBlock("github", null)).toBeNull();
  expect(createBlock(undefined, null)).toBeNull();
  expect(createBlock("gitlab", "gitlab.com")).toBe("Creating a pull request from Kolux needs a GitHub remote; gitlab.com is not one.");
  expect(createBlock("other", "code.example.org")).toContain("code.example.org is not one");
  expect(createBlock("none", null)).toBe("Creating a pull request from Kolux needs a GitHub remote; this repository has no remote.");
  const blocked = createBlock("gitlab", "gitlab.com");
  expect(offerOf({ linked: false, blockedBy: blocked, ready, key, now: 1000 })).toEqual({ kind: "blocked", reason: blocked });
  expect(canStartReview(blocked, false)).toBe(false);
  // GitHub, nothing linked: the same inputs still offer the composer and the one-click.
  expect(offerOf({ linked: false, blockedBy: null, ready, key, now: 1000 })).toEqual({ kind: "create" });
  expect(canStartReview(null, false)).toBe(true);
  expect(canStartReview(null, true)).toBe(false);
  expect(offerOf({ linked: true, blockedBy: null, ready, key, now: 1000 }).kind).toBe("blocked");
});

// N-20: the panel's gating, as one answer the JSX draws from. Each case names what the user sees.
test("N-20: nothing to click until an answer is confirmed, and the panel says it is checking", () => {
  const blank = { failed: false, draft: false, linked: false, hasStatus: false, canStart: true, wantsOneClick: false, running: false, lookup: undefined };
  expect(offerUi({ ...blank, offer: { kind: "check" } })).toEqual({ hint: null, checking: true, create: null, oneClick: false });
  // A hard error keeps the checking line away, so the error is the only thing said.
  expect(offerUi({ ...blank, offer: { kind: "check" }, failed: true })).toEqual({ hint: null, checking: false, create: null, oneClick: false });
});

test("N-20: a confirmed answer draws the create button, in the words the missing step needs", () => {
  const ready = { failed: false, draft: false, linked: false, hasStatus: true, canStart: true, wantsOneClick: false, running: false, lookup: undefined };
  expect(offerUi({ ...ready, offer: { kind: "create" } })).toMatchObject({ checking: false, create: "Create pull request" });
  expect(offerUi({ ...ready, offer: { kind: "push-create", push: "push" } }).create).toBe("Push and create pull request");
  expect(offerUi({ ...ready, offer: { kind: "push-create", push: "publish" } }).create).toBe("Publish branch and create pull request");
  // The reason it cannot, said once, and no button.
  expect(offerUi({ ...ready, offer: { kind: "blocked", reason: "Commit your changes first" } })).toMatchObject({ hint: "Commit your changes first", create: null, oneClick: false });
  // The lookup said why in one line already, so the block adds nothing.
  expect(offerUi({ ...ready, offer: { kind: "blocked", reason: "Commit your changes first" }, lookup: { kind: "unsupported", provider: "gitlab", host: "gitlab.com" } }).hint).toBeNull();
});

test("N-20: the composer, a linked pull request or a non-GitHub remote take the buttons away", () => {
  const base = { failed: false, draft: false, linked: false, hasStatus: true, canStart: true, wantsOneClick: true, running: false, lookup: undefined };
  const blocked: Offer = { kind: "blocked", reason: "Commit your changes first" };
  // Work still to commit: one click does all of it.
  expect(offerUi({ ...base, offer: blocked }).oneClick).toBe(true);
  expect(offerUi({ ...base, offer: blocked, running: true }).oneClick).toBe(false);
  expect(offerUi({ ...base, offer: blocked, hasStatus: false }).oneClick).toBe(false); // no status read yet: no promise to commit anything
  expect(offerUi({ ...base, offer: blocked, wantsOneClick: false }).oneClick).toBe(false); // nothing left to commit or push
  // An open composer is the only thing on offer, and an open pull request or a foreign remote stops it at the source.
  expect(offerUi({ ...base, offer: { kind: "create" }, draft: true })).toMatchObject({ create: null, oneClick: false });
  expect(offerUi({ ...base, offer: blocked, linked: true })).toMatchObject({ hint: null, create: null });
  expect(offerUi({ ...base, offer: blocked, canStart: false }).oneClick).toBe(false);
});
