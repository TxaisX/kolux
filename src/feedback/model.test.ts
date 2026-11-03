// APP-037 (the Send Feedback message box) and PROJ-089 (feedback opens already filled in; text typed
// above the pre-filled block is kept). The model has no network client: every test runs with fetch and
// XMLHttpRequest made to throw.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { URL_CAP, type FeedbackFacts } from "../settings/privacy";
import { block, closed, issue, MARK, NOTE_POS, reduce, restoreFocus, tabTarget, typedText, withBlock } from "./model";

const facts: FeedbackFacts = { version: "0.1.0", platform: "Win32", release: "Windows 10.0.26200", arch: "x86_64", login: "octo-fake" };

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("the feedback box made a network request");
  });
  vi.stubGlobal("XMLHttpRequest", function () {
    throw new Error("the feedback box made a network request");
  });
});
afterEach(() => vi.unstubAllGlobals());

const params = (url: string) => new URL(url).searchParams;
const ok = (r: ReturnType<typeof issue>) => {
  expect(r.ok, r.ok ? "" : `refused: ${r.error}`).toBe(true);
  return r as Extract<ReturnType<typeof issue>, { ok: true }>;
};

test("app037: empty text is refused with an error, whether blank, only spaces or only the pre-filled block", () => {
  for (const draft of ["", "   \n  ", `${MARK}${block(facts, false)}`, withBlock("  ", facts, false)]) {
    const r = issue(draft, facts, false);
    expect(r.ok, JSON.stringify(draft)).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/write|empty|something/i);
  }
});

test("app037: the title is [Feedback] plus the first line, never past 80 characters", () => {
  const r = ok(issue(withBlock("The pane froze\nafter a resize", facts, false), facts, false));
  expect(params(r.url).get("title")).toBe("[Feedback] The pane froze");
  expect(params(r.url).get("body")).toContain("The pane froze\nafter a resize");
  const long = ok(issue(withBlock("y".repeat(200), facts, false), facts, false));
  expect(params(long.url).get("title")).toHaveLength(80);
  expect(params(long.url).get("title")?.startsWith("[Feedback] ")).toBe(true);
});

test("app037: the body names the version, platform, system release and architecture, plus the GitHub login", () => {
  const body = params(ok(issue(withBlock("it broke", facts, false), facts, false)).url).get("body") ?? "";
  for (const want of ["0.1.0", "Win32", "Windows 10.0.26200", "x86_64", "octo-fake"]) expect(body, want).toContain(want);
});

test("app037: Submit anonymously leaves the login out of the whole address", () => {
  const url = ok(issue(withBlock("it broke", facts, true), facts, true)).url;
  expect(decodeURIComponent(url)).not.toContain("octo-fake");
  const body = params(url).get("body") ?? "";
  for (const want of ["0.1.0", "Win32", "Windows 10.0.26200", "x86_64"]) expect(body, want).toContain(want);
  // no login known at all: nothing is invented
  const none = params(ok(issue("it broke", { ...facts, login: null }, false)).url).get("body") ?? "";
  expect(none).not.toMatch(/GitHub/i);
});

test("app037: paths and secrets never reach the address, not even in the title", () => {
  const text = "password: hunter2 broke C:\\Users\\me\\proj\\a.ts\nsecond line ghp_FAKEFAKEFAKEFAKE1234567890 in /home/me/x/y";
  const url = ok(issue(withBlock(text, facts, false), facts, false)).url;
  const all = decodeURIComponent(url);
  for (const gone of ["hunter2", "C:\\Users", "a.ts", "ghp_FAKE", "/home/me"]) expect(all, gone).not.toContain(gone);
  expect(params(url).get("title")).toBe("[Feedback] password: [masked] broke [path]");
});

test("app037: a very long report is trimmed to fit the address, says so, and keeps the facts", () => {
  const r = ok(issue(withBlock("x".repeat(20000), facts, false), facts, false));
  expect(r.url.length).toBeLessThanOrEqual(URL_CAP);
  expect(r.trimmed).toBe(true);
  const body = params(r.url).get("body") ?? "";
  expect(body).toContain("trimmed to fit in a browser address");
  for (const want of ["0.1.0", "Windows 10.0.26200", "x86_64", "octo-fake"]) expect(body, want).toContain(want);
  expect(ok(issue(withBlock("short", facts, false), facts, false)).trimmed).toBe(false);
});

test("proj089: opening feedback already has the version and operating system in it", () => {
  const s = reduce(closed, { t: "open", facts });
  expect(s.open).toBe(true);
  for (const want of ["0.1.0", "Windows 10.0.26200", "Win32", "x86_64", "octo-fake"]) expect(s.draft, want).toContain(want);
  expect(typedText(s.draft)).toBe("");
});

test("proj089: text typed above the block is kept when the block is rewritten", () => {
  let s = reduce(closed, { t: "open", facts });
  s = reduce(s, { t: "type", draft: `The pane froze\r\nafter a resize${s.draft}` });
  expect(typedText(s.draft)).toBe("The pane froze\r\nafter a resize");
  s = reduce(s, { t: "anon", on: true });
  expect(s.anonymous).toBe(true);
  expect(typedText(s.draft)).toBe("The pane froze\r\nafter a resize");
  expect(s.draft).not.toContain("octo-fake");
  s = reduce(s, { t: "anon", on: false });
  expect(s.draft).toContain("octo-fake");
  s = reduce(s, { t: "facts", facts: { ...facts, version: "0.2.0" } });
  expect(typedText(s.draft)).toBe("The pane froze\r\nafter a resize");
  expect(s.draft).toContain("0.2.0");
  expect(s.draft).not.toContain("0.1.0");
});

test("proj089: a block the user edited or deleted is rebuilt from the real facts, never trusted", () => {
  const edited = `my note${MARK}Kolux RS 9.9.9 on Plan9\nGitHub: somebody-else`;
  const fixed = withBlock(edited, facts, false);
  expect(typedText(fixed)).toBe("my note");
  expect(fixed).not.toContain("9.9.9");
  expect(fixed).not.toContain("somebody-else");
  const url = ok(issue(edited, facts, false)).url;
  expect(decodeURIComponent(url)).not.toContain("9.9.9");
  expect(decodeURIComponent(url)).toContain("0.1.0");
  const gone = ok(issue("no block at all", facts, false)).url;
  expect(decodeURIComponent(gone)).toContain("0.1.0");
});

test("app037: a refused send keeps the dialog open with the text and the error; a sent one closes it with a note", () => {
  let s = reduce(closed, { t: "open", facts, text: "hello" });
  expect(typedText(s.draft)).toBe("hello");
  s = reduce(s, { t: "fail", error: "Write something first." });
  expect(s.open).toBe(true);
  expect(s.error).toBe("Write something first.");
  expect(typedText(s.draft)).toBe("hello");
  s = reduce(s, { t: "type", draft: `hello again${MARK}x` });
  expect(s.error).toBe("");
  s = reduce(s, { t: "sent", trimmed: true });
  expect(s.open).toBe(false);
  expect(s.note).toMatch(/trimmed/i);
  expect(reduce(s, { t: "open", facts }).note).toBe("");
});

// FIX-1 (council review of 9b6e5841)
const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test("fix1: a report with an emoji at the 80-character title cut still opens", () => {
  const r = ok(issue(withBlock("a".repeat(68) + "\u{1F600}\u{1F600} and more", facts, false), facts, false));
  const title = params(r.url).get("title") ?? "";
  expect(LONE.test(title)).toBe(false);
  expect(Array.from(title).length).toBeLessThanOrEqual(80);
});

test("fix1: a very long report of emoji opens, trimmed, with no half emoji in it", () => {
  const r = ok(issue(withBlock("short\n" + "\u{1F600}".repeat(3000), facts, false), facts, false));
  expect(r.url.length).toBeLessThanOrEqual(URL_CAP);
  expect(r.trimmed).toBe(true);
  expect(LONE.test(params(r.url).get("body") ?? "")).toBe(false);
});

test("fix1: building the address can never throw: any failure comes back as a refusal the dialog shows", () => {
  const broken = {
    ...facts,
    get login(): string | null {
      throw new Error("boom");
    },
  };
  let r: ReturnType<typeof issue> | undefined;
  expect(() => {
    r = issue(withBlock("hello", facts, false), broken, false);
  }).not.toThrow();
  expect(r?.ok).toBe(false);
  if (r && !r.ok) expect(r.error).toMatch(/boom/);
});

test("fix1: closing the box with a report typed keeps it for the next open, a sent report does not", () => {
  let s = reduce(closed, { t: "open", facts });
  s = reduce(s, { t: "type", draft: `half a report${s.draft}` });
  s = reduce(s, { t: "close" }); // a stray click on the dark background
  expect(s.open).toBe(false);
  const again = reduce(s, { t: "open", facts });
  expect(typedText(again.draft)).toBe("half a report");
  expect(again.draft).toContain("0.1.0"); // the block is rebuilt, not trusted
  // text handed in on purpose (the crash report) replaces the old draft
  expect(typedText(reduce(s, { t: "open", facts, text: "crash text" }).draft)).toBe("crash text");
  // once sent, the next open is empty
  const sent = reduce(again, { t: "sent", trimmed: false });
  expect(typedText(reduce(sent, { t: "open", facts }).draft)).toBe("");
  // an empty box stays empty
  expect(typedText(reduce(reduce(reduce(closed, { t: "open", facts }), { t: "close" }), { t: "open", facts }).draft)).toBe("");
});

// APP-037 review item: the box is modal, so Tab stays inside it and wraps at both ends.
test("tab order wraps inside the box and starts at an end when nothing inside has focus", () => {
  expect([0, 1, 2, 3].map((at) => tabTarget(4, at, false))).toEqual([1, 2, 3, 0]);
  expect([0, 1, 2, 3].map((at) => tabTarget(4, at, true))).toEqual([3, 0, 1, 2]);
  expect([tabTarget(4, -1, false), tabTarget(4, -1, true), tabTarget(0, 0, false)]).toEqual([0, 3, -1]);
});

test("a send in flight blocks a second one until it fails or finishes", () => {
  let s = reduce(closed, { t: "open", facts, text: "hello" });
  expect(s.sending).toBe(false);
  s = reduce(s, { t: "send" });
  expect(s.sending).toBe(true);
  expect(reduce(s, { t: "fail", error: "x" }).sending).toBe(false);
  const sent = reduce(s, { t: "sent", trimmed: false });
  expect(sent.sending).toBe(false);
  expect(reduce(s, { t: "open", facts }).sending).toBe(false);
});

test("focus goes back to what opened the box, only if it is still on the page", () => {
  let n = 0;
  expect(restoreFocus({ isConnected: true, focus: () => void n++ })).toBe(true);
  expect(n).toBe(1);
  expect(restoreFocus({ isConnected: false, focus: () => void n++ })).toBe(false);
  expect(restoreFocus(null)).toBe(false);
  expect(n).toBe(1);
});

test("the sent note sits right of the update card and above the 24px status bar", () => {
  expect(NOTE_POS.bottom).toBeGreaterThanOrEqual(40);
  expect(NOTE_POS.right).toBe(16);
});
