import { expect, test } from "vitest";
import { startPanes } from "./workspaceStart";

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

test("T-664 (b): a prefill puts the picked AI in Seat 1 of the first chooser and the note in its task; other choosers stay empty", () => {
  let k = 1;
  const [first, second] = startPanes("d", "main", 2, () => k++, { agent: "claude", task: "fix the login bug" });
  expect(first.seats).toEqual([{ agent: "claude", model: null }]);
  expect(first.task).toBe("fix the login bug");
  expect(first.program, "nothing runs until Start").toBeNull();
  expect(second.seats).toEqual([{ agent: null, model: null }]);
  expect(second.task).toBeUndefined();
});

test("T-664 (b): an AI with no note leaves the task unset; a note with no AI leaves Seat 1 unpicked; no prefill is unchanged", () => {
  let k = 1;
  const [a] = startPanes("d", null, 1, () => k++, { agent: "codex", task: "" });
  expect([a.seats, a.task]).toEqual([[{ agent: "codex", model: null }], undefined]);
  const [b] = startPanes("d", null, 1, () => k++, { agent: null, task: "note" });
  expect([b.seats, b.task]).toEqual([[{ agent: null, model: null }], "note"]);
  const [c] = startPanes("d", null, 1, () => k++);
  expect("task" in c).toBe(false);
});
