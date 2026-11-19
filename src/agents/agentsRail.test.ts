import { expect, test } from "vitest";
import { chipOf, type Signal } from "../status/chip";
import { rowStatus } from "./rail";

// VIEW-016: the line under each rail session is the Board chip's line, from the same signal.
const NOW = Date.parse("2026-10-26T12:00:00Z");
const sig = (over: Partial<Signal>): Signal => ({ agent: "claude", running: true, stale: false, since: 0, ...over });
const rowOf = (over: Partial<Signal>) => rowStatus({}, chipOf(sig(over), NOW));

test("VIEW-016: the rail's line equals the Board chip's line for the same session data", () => {
  for (const over of [
    { state: "permission", tool: "Write", detail: "src/app.ts" },
    { state: "working", tool: "Bash", detail: "cargo build", since: NOW - 240_000 },
    { state: "done", reply: "Fixed the login form.\nMore text." },
    { state: "idle", since: NOW - 60_000 },
    { state: "blocked", detail: "rate limit reached" },
  ] as Partial<Signal>[]) expect(rowOf(over).line).toBe(chipOf(sig(over), NOW)?.line);
});

test("VIEW-016: an agent waiting on a file-edit approval has a line that names the approval", () => {
  const r = rowOf({ state: "permission", tool: "Edit", detail: "src/app.ts" });
  expect(r.word).toBe("Needs you");
  expect(r.line).toBe("Edit: src/app.ts");
});

test("VIEW-016: an agent idle 12 minutes reads Idle with the duration", () => {
  const r = rowOf({ state: "idle", since: NOW - 12 * 60_000 });
  expect(r.word).toBe("Idle");
  expect(r.line).toBe("12m");
});

test("VIEW-016: with no evidence, and for a never-started preset, the line stays empty", () => {
  expect(rowStatus({}, null).line).toBe("");
  expect(rowStatus({ seats: [{ agent: "claude" }] }, chipOf(sig({ state: "permission", tool: "Edit" }), NOW)).line).toBe("");
  expect(rowOf({ state: undefined, since: 0 }).line).toBe("");
});
