import { expect, test } from "vitest";
import { clearUndoable, redo } from "./draw";
import { focusAddress } from "./useBrowserChords";

test("Clear on the drawing can be undone, mark by mark, in the order they were drawn", () => {
  const a = { shapes: [{ k: 1 }, { k: 2 }] as never[], undone: [] as never[] };
  const cleared = clearUndoable(a as never);
  expect(cleared.shapes).toEqual([]);
  expect(cleared.undone).toHaveLength(2);
  expect(redo(redo(cleared)).shapes).toEqual(a.shapes);
});

test("Ctrl+L presses the preview chip when there is one, else focuses and selects the address bar", () => {
  let clicked = 0;
  const chip = { click: () => clicked++ } as unknown as HTMLElement;
  focusAddress((s) => (s === ".preview-open" ? chip : null));
  expect(clicked).toBe(1);
  const log: string[] = [];
  const bar = { focus: () => log.push("focus"), select: () => log.push("select") } as unknown as HTMLElement;
  focusAddress((s) => (s === ".address" ? bar : null));
  expect(log).toEqual(["focus", "select"]);
});
