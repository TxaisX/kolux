// APP-070: the app sends no usage data; Send feedback is a link the browser opens, not a request.
// scripts/privacy-audit.test.mjs checks the source for any network client the statement does not name.
import { expect, test } from "vitest";
import { OUTBOUND } from "./outbound";
import { FEEDBACK_REPO, feedbackUrl, URL_CAP } from "./privacy";

test("app070: Send feedback is a pre-filled new-issue address carrying the version, trimmed to fit", () => {
  const u = new URL(feedbackUrl("0.1.0", "Win32", "The pane froze\nafter a resize"));
  expect(u.origin + u.pathname).toBe(FEEDBACK_REPO);
  expect(u.searchParams.get("title")).toBe("[Feedback] The pane froze");
  expect(u.searchParams.get("body")).toContain("The pane froze\nafter a resize");
  expect(u.searchParams.get("body")).toContain("Kolux RS 0.1.0 on Win32");
  expect(new URL(feedbackUrl("0.1.0", "Win32")).searchParams.get("title")).toBe("[Feedback]");
  expect(new URL(feedbackUrl("0.1.0", "Win32", "y".repeat(200))).searchParams.get("title")).toHaveLength(80);
  const long = feedbackUrl("0.1.0", "Win32", "x".repeat(20000));
  expect(long.length).toBeLessThanOrEqual(URL_CAP);
  const body = new URL(long).searchParams.get("body") ?? "";
  expect(body).toContain("trimmed to fit in a browser address");
  expect(body).toContain("Kolux RS 0.1.0 on Win32");
  expect(OUTBOUND.map((o) => o.to).join(" ")).toMatch(/GitHub Releases/);
});

test("app037: the footer carries the extra lines the message box adds, and the trim keeps them", () => {
  const extra = "System: Windows 10.0.26200 (x86_64)\nGitHub: octo-fake";
  const body = new URL(feedbackUrl("0.1.0", "Win32", "hello", extra)).searchParams.get("body");
  expect(body).toBe("hello\n\n---\nKolux RS 0.1.0 on Win32\nSystem: Windows 10.0.26200 (x86_64)\nGitHub: octo-fake");
  const long = feedbackUrl("0.1.0", "Win32", "x".repeat(20000), extra);
  expect(long.length).toBeLessThanOrEqual(URL_CAP);
  expect(new URL(long).searchParams.get("body")).toContain("GitHub: octo-fake");
});

// FIX-1 (council review of 9b6e5841, FIX-BEFORE 2): a cut never splits an emoji, which made
// encodeURIComponent throw and left the Open on GitHub button doing nothing.
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test("fix1: an emoji at the 80-character title cut is kept whole or left out, never split", () => {
  // "[Feedback] " is 11 characters, so 68 letters put the first emoji across the old cut at 80
  const url = feedbackUrl("0.1", "Win32", "a".repeat(68) + "\u{1F600}\u{1F600}", "x");
  const title = new URL(url).searchParams.get("title") ?? "";
  expect(LONE.test(title), JSON.stringify(title)).toBe(false);
  expect(Array.from(title).length).toBeLessThanOrEqual(80);
  expect(title.startsWith("[Feedback] " + "a".repeat(68))).toBe(true);
  // every other position of the cut
  for (let pad = 60; pad < 80; pad++) {
    const t = new URL(feedbackUrl("0.1", "Win32", "b".repeat(pad) + "\u{1F600}".repeat(5))).searchParams.get("title") ?? "";
    expect(LONE.test(t), `pad ${pad}`).toBe(false);
    expect(t.length).toBeLessThanOrEqual(160);
  }
});

test("fix1: a long report of emoji is trimmed to the address cap without splitting one", () => {
  const url = feedbackUrl("0.1", "Win32", "short\n" + "\u{1F600}".repeat(3000), "System: x");
  expect(url.length).toBeLessThanOrEqual(URL_CAP);
  const body = new URL(url).searchParams.get("body") ?? "";
  expect(LONE.test(body)).toBe(false);
  expect(body).toContain("trimmed to fit in a browser address");
  expect(body).toContain("Kolux RS 0.1 on Win32");
  expect(body).toContain("\u{1F600}");
});

test("fix1: a stray half of an emoji in the text itself is replaced, not thrown on", () => {
  for (const text of ["bad \uD83D end", "bad \uDE00 end", "tail\uD83D"]) {
    const url = feedbackUrl("0.1", "Win32", text);
    const body = new URL(url).searchParams.get("body") ?? "";
    expect(LONE.test(body), JSON.stringify(text)).toBe(false);
    expect(body).toContain("�");
  }
});

test("t547: the statement names the two providers a usage check asks, and when", () => {
  const row = OUTBOUND.find((o) => o.to.includes("api.moonshot.ai"));
  expect(row?.to).toBe("Kimi (api.moonshot.ai) and MiniMax (www.minimax.io)");
  expect(row?.when).toBe("only when you press Check now in Settings > AI connections with a key you added");
});

test("t634: the statement names SmartScreen, which checks the browser pane's pages and downloads", () => {
  const row = OUTBOUND.find((o) => o.to.includes("SmartScreen"));
  expect(row?.to).toBe("Microsoft Defender SmartScreen, from the browser pane");
  expect(row?.when).toMatch(/pages you open and of files you download/);
});
