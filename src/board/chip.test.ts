import { expect, test } from "vitest";
import { chipOf, firstLine, span, type Signal } from "./chip";

const MIN = 60_000;
const now = 10_000 * MIN;
const sig = (extra: Partial<Signal>): Signal => ({ agent: "claude", running: true, stale: false, since: now - 4 * MIN, ...extra });

test("an approval names what it asks for and offers the answer; a question needs you too (VIEW-016, VIEW-025)", () => {
  expect(chipOf(sig({ state: "permission", tool: "Write", detail: "C:/x/hello.txt" }), now)).toEqual({ lane: "needs", word: "Needs you", line: "Write: C:/x/hello.txt", file: undefined, answer: true });
  expect(chipOf(sig({ state: "waiting" }), now)).toMatchObject({ lane: "needs", line: "Question", answer: false });
});

test("a permission printed in band (OSC 9999) needs you but never lights Approve/Deny without a hook PermissionRequest (T-124-c)", () => {
  // The in-band status names no tool; only a hook PermissionRequest carries the pending tool to answer.
  expect(chipOf(sig({ state: "permission" }), now)).toEqual({ lane: "needs", word: "Needs you", line: "Permission", file: undefined, answer: false });
  expect(chipOf(sig({ state: "permission", tool: "Bash", detail: "cargo build" }), now)).toMatchObject({ lane: "needs", answer: true });
});

test("a question shows every line it asked, not only the first (STAT-027)", () => {
  const ask = "Which framework?\nWhich database?\n\n  Deploy where?  ";
  expect(chipOf(sig({ state: "waiting", tool: "AskUserQuestion", detail: "Which framework?", ask }), now)).toMatchObject({ lane: "needs", word: "Needs you", line: "Which framework? · Which database? · Deploy where?", answer: false });
  // Without the whole question the card falls back to the step's first line; a permission never shows a stale question.
  expect(chipOf(sig({ state: "waiting", tool: "AskUserQuestion", detail: "Which framework?" }), now)).toMatchObject({ line: "AskUserQuestion: Which framework?" });
  expect(chipOf(sig({ state: "permission", tool: "Bash", detail: "rm -rf build", ask }), now)).toMatchObject({ line: "Bash: rm -rf build", answer: true });
  expect(chipOf(sig({ state: "working", tool: "Read", detail: "auth.rs", ask }), now)).toMatchObject({ line: "4m · Read: auth.rs" });
});

test("working shows how long and the current step; a stale working signal never shows Working (VIEW-023)", () => {
  expect(chipOf(sig({ state: "working", tool: "Bash", detail: "ls -la" }), now)).toMatchObject({ lane: "working", word: "Working", line: "4m · Bash: ls -la" });
  expect(chipOf(sig({ state: "working", stale: true }), now)).toMatchObject({ lane: "working", word: "No recent update", line: "no status for 4m" });
  expect(chipOf(sig({ state: undefined, since: 0 }), now)).toMatchObject({ word: "Working", line: "" });
});

test("a limit stop reads Stopped, never Done; a finish shows the first line of the last message and the file it wrote (VIEW-023)", () => {
  expect(chipOf(sig({ state: "blocked", detail: "rate limit reached" }), now)).toMatchObject({ lane: "stopped", word: "Stopped", line: "rate limit reached" });
  expect(chipOf(sig({ state: "blocked", stop: { cause: "limit", detail: "rate_limit" } }), now)).toMatchObject({ lane: "stopped", word: "Stopped", line: "Limit reached · rate_limit" });
  expect(chipOf(sig({ state: "interrupted" }), now)).toMatchObject({ lane: "stopped", line: "Interrupted" });
  // T-167-b: a restored row after an upgrade asks for a restart; it never blames the AI
  expect(chipOf(sig({ state: "blocked", stop: { cause: "restart", detail: "Kolux was updated" } }), now)).toMatchObject({ lane: "stopped", word: "Stopped", line: "Restart this terminal · Kolux was updated" });
  expect(chipOf(sig({ state: "done", reply: "\n  All three tests pass.\nDetails below.", wrote: "G:/repo/src/b.ts" }), now)).toEqual({ lane: "done", word: "Done", line: "All three tests pass.", file: "G:/repo/src/b.ts", answer: false });
  expect(chipOf(sig({ state: "done", running: false }), now)).toMatchObject({ lane: "done" });
});

test("a plain shell gets no chip; no process yet is Starting; an ended program is Stopped; idle says how long (VIEW-016, VIEW-023)", () => {
  expect(chipOf(sig({ agent: "shell", state: "idle" }), now)).toBeNull();
  expect(chipOf(sig({ running: undefined }), now)).toMatchObject({ lane: "working", word: "Starting" });
  expect(chipOf(sig({ state: "working", running: false }), now)).toMatchObject({ lane: "stopped", word: "Stopped", line: "Exited" });
  expect(chipOf(sig({ state: "idle", since: now - 12 * MIN }), now)).toMatchObject({ lane: "idle", word: "Idle", line: "12m" });
});

test("spans read 59s, 1m, 1h and 1h 5m; the first line skips blank lines", () => {
  expect([span(59_000), span(60_000), span(60 * MIN), span(65 * MIN)]).toEqual(["59s", "1m", "1h", "1h 5m"]);
  expect(firstLine("\n\n  hi \nthere")).toBe("hi");
  expect(firstLine("")).toBe("");
});

test("a session watching its background tasks says so in the Working lane (STAT-024)", () => {
  expect(chipOf(sig({ state: "working", monitoring: true, tool: "Bash", detail: "npm run soak" }), now)).toMatchObject({ lane: "working", word: "Working", line: "Watching background tasks" });
  // A quiet terminal still reads as no recent update first.
  expect(chipOf(sig({ state: "working", monitoring: true, stale: true }), now)).toMatchObject({ word: "No recent update" });
});
