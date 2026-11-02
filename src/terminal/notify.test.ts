import { afterEach, expect, test, vi } from "vitest";
import { noteTitle, preview, stopLine, turnNote } from "./notify";

const turn = (state: string, extra: object = {}) => ({ state, interrupted: false, boundary: false, ...extra }) as Parameters<typeof turnNote>[1];

afterEach(() => void vi.useRealTimers());

test("a finish, a permission request and a block are notes; boundaries, replays and plain progress are not (STAT-041)", () => {
  expect(turnNote("working", turn("done", { reply: "All tests pass.\n\nNext: ship it." }))).toEqual({ what: "finished", body: "All tests pass. Next: ship it." });
  expect(turnNote("working", turn("permission"))).toEqual({ what: "needs permission", body: "" });
  expect(turnNote("working", turn("blocked", { reply: "Usage limit reached" }))).toEqual({ what: "stopped: the AI hit an error", body: "Usage limit reached", stopped: true });
  expect(turnNote("working", turn("interrupted"))).toEqual({ what: "was interrupted", body: "" });
  expect(turnNote("working", turn("done", { boundary: true }))).toBeNull();
  expect(turnNote(undefined, turn("done"))).toBeNull();
  expect(turnNote("done", turn("done"))).toBeNull();
  expect(turnNote("working", turn("working"))).toBeNull();
  expect(turnNote("working", turn("waiting"))).toBeNull();
});

test("every sub-agent turn is a note of its own, even while the lead stays working (STAT-041)", () => {
  expect(turnNote("working", turn("working", { child: "code-reviewer", reply: "Two findings." }))).toEqual({ what: "code-reviewer finished", body: "Two findings." });
});

test("the title carries the repository only when several have agents; long replies are cut (STAT-041)", () => {
  expect(noteTitle("Claude 2", null, "finished")).toBe("Claude 2 finished");
  expect(noteTitle("Claude 2", "kolux-rs", "finished")).toBe("kolux-rs · Claude 2 finished");
  expect(preview("x".repeat(200))).toHaveLength(120);
  expect(preview("x".repeat(200)).endsWith("…")).toBe(true);
});

test("a stop names its cause and the reset time, never reads like a finish, and is one note per episode (STAT-022, STAT-023)", () => {
  const at = new Date().setHours(15, 5, 0, 0); // today at 3:05 PM, whatever the date
  expect(turnNote("working", turn("blocked", { stop: { cause: "limit", resetsAt: at } }))).toEqual({ what: "stopped: limit reached", body: "Resets at 3:05 PM", stopped: true });
  expect(turnNote("working", turn("blocked", { stop: { cause: "signin", detail: "authentication_failed" } }))).toEqual({ what: "stopped: sign in again", body: "authentication_failed", stopped: true });
  expect(turnNote("blocked", turn("blocked", { stop: { cause: "signin" } }))).toBeNull();
  expect(turnNote("working", turn("done", { reply: "ok" }))).toEqual({ what: "finished", body: "ok" });
  expect(stopLine({ cause: "limit", resetsAt: at })).toBe("Limit reached · resets at 3:05 PM");
  expect(stopLine({ cause: "error", detail: "overloaded" })).toBe("The AI hit an error · overloaded");
  expect(stopLine({ cause: "signin" })).toBe("Sign in again");
});

test("t167b: a stop that means restart this terminal never says the AI hit an error", () => {
  expect(stopLine({ cause: "restart" })).toBe("Restart this terminal");
  expect(stopLine({ cause: "restart", detail: "Kolux was updated" })).toBe("Restart this terminal · Kolux was updated");
  const note = turnNote("working", turn("blocked", { stop: { cause: "restart", detail: "Kolux was updated" } }));
  expect(note).toEqual({ what: "stopped: restart this terminal", body: "Kolux was updated", stopped: true });
  expect(JSON.stringify(note)).not.toMatch(/error/i);
});
