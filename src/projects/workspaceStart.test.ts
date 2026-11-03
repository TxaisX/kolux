import { expect, test } from "vitest";
import { emptySeat } from "../launch/seats";
import { createStart, startPanes } from "./workspaceStart";

test("T-569: a workspace with no pane starts with one chooser (seats, no program), not a terminal", () => {
  let k = 5;
  const [only, ...rest] = startPanes("G:\Dev\demo", "main", 1, () => k++);
  expect(rest).toEqual([]);
  expect([only.key, only.cwd, only.branch, only.program]).toEqual([5, "G:\Dev\demo", "main", null]);
  expect(only.seats).toHaveLength(1);
  expect(only.seats![0]).toEqual({ agent: null, model: null });
});

test("T-569: a fresh workspace gets one chooser per default pane, each with its own key; a count under one still gives one", () => {
  let k = 1;
  expect(startPanes("d", null, 3, () => k++).map((p) => p.key)).toEqual([1, 2, 3]);
  expect(startPanes("d", null, 0, () => k++)).toHaveLength(1);
});

test("T-664 (b): a prefill puts its seat in Seat 1 of the first chooser and the note in its task; other choosers stay empty", () => {
  let k = 1;
  const seat = { agent: "claude", model: "opus", effort: "high" };
  const [first, second] = startPanes("d", "main", 2, () => k++, { seat, task: "fix the login bug" });
  expect(first.seats).toEqual([seat]);
  expect(first.task).toBe("fix the login bug");
  expect(first.program, "nothing runs until Start").toBeNull();
  expect(second.seats).toEqual([{ agent: null, model: null }]);
  expect(second.task).toBeUndefined();
});

test("T-664 (b): no note leaves the task unset; a note with an empty seat leaves Seat 1 unpicked; no prefill is unchanged", () => {
  let k = 1;
  const [a] = startPanes("d", null, 1, () => k++, { seat: { agent: "codex", model: null }, task: "" });
  expect([a.seats, a.task]).toEqual([[{ agent: "codex", model: null }], undefined]);
  const [b] = startPanes("d", null, 1, () => k++, { seat: emptySeat(), task: "note" });
  expect([b.seats, b.task]).toEqual([[{ agent: null, model: null }], "note"]);
  const [c] = startPanes("d", null, 1, () => k++);
  expect("task" in c).toBe(false);
});

// T-664 (b): every row of the create decision. No front create may start an agent; a background create keeps its auto-start.
test("T-664 (b): createStart: hasAgent, hasNote, front, waits -> what happens", () => {
  const rows: [boolean, boolean, boolean, boolean, string][] = [
    [true, false, true, false, "select-prefill"],
    [true, true, true, true, "select-prefill"],
    [true, false, true, true, "select-prefill"],
    [false, true, true, false, "select-prefill"], // a note with no AI installed still reaches the task
    [false, false, true, false, "select"],
    [false, false, true, true, "select"],
    [true, false, false, false, "start"],
    [true, true, false, false, "start"],
    [true, true, false, true, "setup-then-start"],
    [false, true, false, false, "none"],
    [false, false, false, true, "none"],
  ];
  for (const [agent, note, front, waits, want] of rows) {
    const got = createStart(agent, note, front, waits);
    expect(got, JSON.stringify({ agent, note, front, waits })).toBe(want);
    if (front) expect(["start", "setup-then-start"]).not.toContain(got);
  }
});
