import { expect, test } from "vitest";
import { CodexSignInScan, plain, TAIL_BYTES, tailBytes, REPORT_EVERY_MS } from "./codexSignInScan";

// DT-C246: chunks reach the scan as bytes.
const b64 = (s: string) => new TextEncoder().encode(s);
// The wording Codex prints when its sign-in can no longer be refreshed (public source in PROVENANCE.md).
const ERROR = "Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.";

test("only a pane registered with a managed Codex account is scanned", () => {
  const s = new CodexSignInScan();
  s.watch(1, null); // Codex's system-default login: never flagged
  expect(s.feed(1, b64(ERROR), 0)).toBeNull();
  expect(s.feed(2, b64(ERROR), 0)).toBeNull(); // never registered (a shell, a Claude pane)
  s.watch(3, "c1");
  expect(s.feed(3, b64(ERROR), 0)).toBe("c1");
});

test("the phrase is found through colours, cursor moves and a line wrap", () => {
  const s = new CodexSignInScan();
  s.watch(1, "c1");
  const drawn = "\x1b[31mYour access token could not\x1b[0m\r\n\x1b[2;4Hbe   refreshed. Please log out and sign in again.";
  expect(s.feed(1, b64(drawn), 0)).toBe("c1");
});

test("a phrase split across two chunks is still caught", () => {
  const s = new CodexSignInScan();
  s.watch(1, "c1");
  expect(s.feed(1, b64("...Your access token could n"), 0)).toBeNull();
  expect(s.feed(1, b64("ot be refreshed. Please sign in again."), 10)).toBe("c1");
});

test("ordinary output and a user's own words about tokens raise nothing", () => {
  const s = new CodexSignInScan();
  s.watch(1, "c1");
  for (const t of ["Please sign in to GitHub", "token refreshed fine", "could not be refreshed: cache", "\x1b[2J\x1b[H> "]) {
    expect(s.feed(1, b64(t), 0)).toBeNull();
  }
});

test("one report per pane per minute, then again after the minute", () => {
  const s = new CodexSignInScan();
  s.watch(1, "c1");
  expect(s.feed(1, b64(ERROR), 0)).toBe("c1");
  expect(s.feed(1, b64(ERROR), 1000)).toBeNull();
  expect(s.feed(1, b64(ERROR), REPORT_EVERY_MS - 1)).toBeNull();
  expect(s.feed(1, b64(ERROR), REPORT_EVERY_MS + 1)).toBe("c1");
});

test("only the last bytes of a big chunk are read, and the carried window stays short", () => {
  const s = new CodexSignInScan();
  s.watch(1, "c1");
  // The phrase sits before the tail of a large chunk: not read (the scan is bounded).
  expect(s.feed(1, b64(ERROR + "x".repeat(TAIL_BYTES * 4)), 0)).toBeNull();
  expect(tailBytes(b64("y".repeat(TAIL_BYTES * 10))).length).toBe(TAIL_BYTES);
  expect(s.carried(1)).toBeLessThanOrEqual(64);
  // ...while the phrase at the end of a large chunk is caught.
  expect(s.feed(1, b64("x".repeat(TAIL_BYTES * 4) + ERROR), 0)).toBe("c1");
});

test("an ended or re-registered pane forgets its window and account", () => {
  const s = new CodexSignInScan();
  s.watch(1, "c1");
  s.feed(1, b64("Your access token could n"), 0);
  s.forget(1);
  expect(s.carried(1)).toBe(0);
  expect(s.feed(1, b64("ot be refreshed"), 0)).toBeNull();
  s.watch(1, "c2");
  expect(s.feed(1, b64(ERROR), 0)).toBe("c2");
});

test("plain() drops escapes and spacing and lower-cases", () => {
  expect(plain("\x1b[1mAccess\x1b[0m  Token\r\n\x1b]0;title\x07Could")).toBe("accesstokencould");
});
