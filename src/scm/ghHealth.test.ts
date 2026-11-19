import { expect, test } from "vitest";
import { classify as kindOf } from "./ghHealth";
import { bannerOf, classify, minutesUntil, resetOf, waitMs } from "./ghHealth";

test("GIT-028: gh's own words sort into the kinds of trouble", () => {
  expect(classify("github.com: API rate limit exceeded for user ID 1.")).toBe("rate-limit");
  expect(classify("github.com: gh did not answer within 30 seconds; try again in a moment")).toBe("timeout");
  expect(classify("github.com: Sign in to GitHub first: run gh auth login")).toBe("signed-out");
  expect(classify("Kolux only talks to GitHub hosts gh is signed in to, and ghe.corp is not one of them (gh auth login --hostname ghe.corp signs in).")).toBe("signed-out");
  expect(classify("The GitHub CLI (gh) is not installed; install it, then run gh auth login")).toBe("no-gh");
  expect(classify("github.com: HTTP 502: Bad Gateway")).toBe("outage");
  expect(classify("dial tcp: lookup api.github.com: no such host")).toBe("outage");
  expect(classify("something odd")).toBe("other");
});

test("GIT-028: a failure with no account on the header reads as a sign-in problem, one with an account does not", () => {
  expect(classify("something odd", false)).toBe("signed-out");
  expect(classify("something odd", true)).toBe("other");
  expect(classify("API rate limit exceeded", false)).toBe("rate-limit");
});

test("GIT-028: the rate-limit banner says when the list loads again, and there is a time to wait for", () => {
  const now = 1_000_000_000_000;
  const b = bannerOf("rate-limit", now, now / 1000 + 600)!;
  expect(b.title).toBe("GitHub is unavailable for now");
  expect(b.body).toContain("about 10 min");
  expect(waitMs(b, now)).toBe(600_000 + 1500);
  // a reset already past or unknown: no timer, the user asks
  expect(waitMs(bannerOf("rate-limit", now, now / 1000 - 5)!, now)).toBeNull();
  expect(waitMs(bannerOf("rate-limit", now)!, now)).toBeNull();
  expect(minutesUntil(now / 1000 + 1, now)).toBe(1);
});

test("GIT-028: the sign-in help walks through gh auth login, with the host when it is not github.com", () => {
  const plain = bannerOf("signed-out", 0)!;
  expect(plain.steps).toHaveLength(4);
  expect(plain.steps[1]).toBe("Run: gh auth login");
  expect(bannerOf("signed-out", 0, undefined, "ghe.corp")!.steps[1]).toBe("Run: gh auth login --hostname ghe.corp");
  expect(bannerOf("no-gh", 0)!.steps.join(" ")).toContain("https://cli.github.com");
  expect(bannerOf("other", 0)).toBeNull();
  expect(waitMs(plain, 0)).toBeNull();
});

test("GIT-028: the budget that ends the wait is the used-up one, else Search", () => {
  const rows = [
    { name: "REST", limit: 5000, remaining: 0, reset: 200 },
    { name: "Search", limit: 30, remaining: 0, reset: 260 },
    { name: "GraphQL", limit: 5000, remaining: 100, reset: 900 },
  ];
  expect(resetOf(rows)).toBe(260);
  expect(resetOf(rows.map((r) => ({ ...r, remaining: 5 })))).toBe(260);
  expect(resetOf([])).toBeUndefined();
  expect(resetOf(null)).toBeUndefined();
});

test("T-281 (GIT-045): an account without access and an expired sign-in are told apart from a rate limit", () => {
  expect(kindOf("The account gh is signed in with cannot see this repository: run gh auth status to check which account it is, or gh auth login with one that has access")).toBe("no-access");
  expect(kindOf("HTTP 403: Resource not accessible by integration")).toBe("no-access");
  expect(kindOf("HTTP 403: API rate limit exceeded for user")).toBe("rate-limit");
  expect(kindOf("HTTP 403: You have triggered an abuse detection mechanism")).toBe("rate-limit");
  expect(kindOf("gh's sign-in no longer works (it expired or was revoked): run gh auth login again")).toBe("signed-out");
  const b = bannerOf("no-access", 0, undefined, "ghe.example.com");
  expect(b?.title).toBe("This account cannot see the repository");
  expect(b?.steps.join(" ")).toContain("gh auth status --hostname ghe.example.com");
  expect(bannerOf("signed-out", 0)?.body).toContain("sign-in expired");
});
