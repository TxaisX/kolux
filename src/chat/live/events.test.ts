// Slice 1 of chat panes: the engine's event stream folded into the rows the existing chat view draws.
// Each case here is a line shape docs/chat-engine.md prints, and the last tests prove the reducer's rows
// go through the same `combine` / `fold` the transcript chat uses, with no second renderer.
import { expect, test } from "vitest";
import { reduce, sessionChange, type ChatEvent } from "./events";
import { combine } from "../model";
import { fold, type Tool } from "../steps";

const tool = (over: Partial<Tool> = {}): Tool => ({ call: "t1", name: "Read", group: "read", preview: "README.md", done: false, failed: false, background: false, ...over });
const ev = (e: Partial<ChatEvent> & { kind: ChatEvent["kind"] }): ChatEvent => ({ chatId: "pane-3", ...e });

test("an assistant message's text, thought, tool call and plan become the chat's own rows", () => {
  const at = 1_000;
  const items = reduce(
    [],
    ev({
      kind: "assistant",
      messageId: "msg_1",
      blocks: [
        { type: "text", text: "Reading the readme first." },
        { type: "thinking", text: "Which file tells the most?" },
        { type: "toolUse", id: "t1", name: "Read", step: { kind: "tool", tool: tool() } },
        { type: "toolUse", id: "t2", name: "ExitPlanMode", step: { kind: "plan", text: "- [ ] read the tests" } },
      ],
    }),
    at,
    1,
  );
  expect(items.map((i) => [i.id, i.role, i.kind])).toEqual([
    ["msg_1:000", "assistant", "text"],
    ["msg_1:001", "assistant", "thought"],
    ["msg_1:002", "assistant", "tool"],
    ["msg_1:003", "assistant", "plan"],
  ]);
  // The tool row is Rust's own reading, untouched (its preview, its group, its diff cards).
  expect(items[2].tool).toEqual(tool());
  expect(items[3].text).toBe("- [ ] read the tests");
  expect(items.every((i) => i.at === at)).toBe(true);
});

test("a line that arrives twice replaces its rows instead of doubling them", () => {
  const line = ev({ kind: "assistant", messageId: "msg_1", blocks: [{ type: "text", text: "One answer." }] });
  const once = reduce([], line, 100, 1);
  const twice = reduce(once, line, 200, 2);
  expect(twice.map((i) => i.id)).toEqual(once.map((i) => i.id));
});

test("a tool result lands on its call's row and the turn folds into one steps row", () => {
  const at = 1_000;
  let items = reduce([], ev({ kind: "user", text: ["read the readme"] }), at, 1);
  items = reduce(items, ev({ kind: "assistant", messageId: "msg_1", blocks: [{ type: "toolUse", id: "t1", name: "Read", step: { kind: "tool", tool: tool() } }] }), at + 100, 2);
  items = reduce(items, ev({ kind: "user", text: [], toolResults: [{ toolUseId: "t1", output: "the file's words", isError: false }] }), at + 200, 3);
  // A send the pane is still waiting on is confirmed by the message the agent echoes back.
  const rows = combine(items, [], null, [{ id: "p1", text: "read the readme", at: at - 10 }]);
  expect(rows.some((r) => r.row === "pending")).toBe(false);
  const views = fold(rows, false);
  const steps = views.find((v) => v.row === "steps");
  expect(steps && steps.row === "steps" && steps.steps[0].tool).toMatchObject({ call: "t1", output: "the file's words", done: true, failed: false, endedAt: at + 200 });
});

test("a subagent's own words stay out: its Task call's row sums them up", () => {
  const items = reduce([], ev({ kind: "assistant", messageId: "msg_1", blocks: [{ type: "text", text: "In the main conversation." }] }), 1, 1);
  const sub = ev({ kind: "assistant", parentToolUseId: "t1", messageId: "msg_2", blocks: [{ type: "text", text: "A subagent's words." }] });
  expect(reduce(items, sub, 2, 2)).toBe(items);
});

test("a finished turn draws nothing of its own, and one that failed says how", () => {
  const items = reduce([], ev({ kind: "assistant", messageId: "msg_1", blocks: [{ type: "text", text: "Done." }] }), 1, 1);
  expect(reduce(items, ev({ kind: "result", subtype: "success" }), 2, 2)).toBe(items);
  const failed = reduce(items, ev({ kind: "result", isError: true, subtype: "error_max_turns", errors: ["ran out of turns"] }), 3, 3);
  expect(failed[1]).toMatchObject({ role: "status", kind: "notice", details: "ran out of turns" });
  // A turn the user stopped is marked as interrupted, so no "Worked for" line is claimed for it.
  const stopped = reduce(items, ev({ kind: "result", isError: true, subtype: "error_during_execution" }), 4, 4);
  expect(stopped[1]).toMatchObject({ role: "assistant", kind: "interrupted" });
});

test("a refused tool call and a retried request are said in the chat", () => {
  const denied = reduce([], ev({ kind: "permissionDenied", toolName: "Bash", message: "Permission to use Bash was denied.", decisionReason: "Bash(rm:*) is denied" }), 7, 1);
  expect(denied[0]).toMatchObject({ role: "status", kind: "notice", text: "Claude was not allowed to use Bash.", details: "Permission to use Bash was denied.\nBash(rm:*) is denied" });
  const retry = reduce([], ev({ kind: "apiRetry", attempt: 2, maxRetries: 10, errorStatus: 529, error: "overloaded" }), 8, 2);
  expect(retry[0].text).toBe("The request to Claude failed (529 overloaded). Trying again, attempt 2 of 10.");
});

test("a crashed process is a row; a sleep, a close and the engine's own line are not", () => {
  const crashed = reduce([], ev({ kind: "exit", code: 1, reason: "crashed" }), 9, 1);
  expect(crashed[0]).toMatchObject({ role: "status", kind: "notice", text: "Claude's process ended (code 1). Your next message starts it again." });
  const quiet = [ev({ kind: "exit", code: null, reason: "sleep" }), ev({ kind: "stopped" }), ev({ kind: "started" }), ev({ kind: "init" }), ev({ kind: "stderr", line: "a warning" }), ev({ kind: "raw", line: "{}" })];
  for (const e of quiet) expect(reduce(crashed, e, 10, 2), e.kind).toBe(crashed);
});

test("a chat that handed off says so, and starts fresh on the next message", () => {
  const items = reduce([], ev({ kind: "handoff", tokens: 171_240, at: 170_000 }), 10, 1);
  expect(items[0]).toMatchObject({ role: "status", kind: "notice", text: "Handed off at 171k tokens. Your next message starts a fresh conversation." });
  // The process ending for the handoff is not a crash: the row above already said what happened.
  expect(reduce(items, ev({ kind: "exit", code: null, reason: "handoff" }), 10, 2)).toBe(items);
});

test("a compaction is the divider the chat already draws", () => {
  const items = reduce([], ev({ kind: "compactBoundary", trigger: "auto", preTokens: 167000 }), 11, 1);
  const views = fold(items.map((i) => ({ ...i, row: "message" as const })), false);
  expect(views[0]).toMatchObject({ row: "message", kind: "compact" });
});

// Review P2 (2026-11-23): a handoff ends the conversation, so the pane and the kept record forget its id;
// a model or effort pick, or reopening the chat, then starts fresh instead of resuming the full one.
test("a handoff forgets the conversation; an init or a resumed start names it", () => {
  expect(sessionChange(ev({ kind: "init", sessionId: "s-1" }))).toBe("s-1");
  expect(sessionChange(ev({ kind: "started", resumed: "s-2" }))).toBe("s-2");
  expect(sessionChange(ev({ kind: "handoff", tokens: 171_240, at: 170_000 }))).toBeNull();
  expect(sessionChange(ev({ kind: "started" }))).toBeUndefined();
  expect(sessionChange(ev({ kind: "result" }))).toBeUndefined();
});

// Review P2 (2026-11-23): the first message after a handoff carries the note inside a system-reminder; a
// user line that comes back with it shows only what the user wrote.
test("a user line shows only the user's words, never the handoff note's envelope", () => {
  const sent = "<system-reminder>\nYour handoff note is at C:\n.md.\n\n- wire the readers\n</system-reminder>\n\nWhat is next?";
  const items = reduce([], ev({ kind: "user", text: [sent] }), 5, 1);
  expect(items.map((i) => i.text)).toEqual(["What is next?"]);
  expect(reduce([], ev({ kind: "user", text: ["<system-reminder>only the note</system-reminder>"] }), 5, 2)).toEqual([]);
});
