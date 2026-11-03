import { expect, test } from "vitest";
import { add, canRedo, canUndo, clearUndoable, empty, redo, undo } from "./draw";
import { focusAddress } from "./useBrowserChords";

test("Clear on the drawing is one step: a single Undo brings every mark back, Redo clears them again", () => {
  const a = { shapes: [{ k: 1 }, { k: 2 }, { k: 3 }] as never[], undone: [] as never[] };
  const cleared = clearUndoable(a as never);
  expect(cleared.shapes).toEqual([]);
  expect(canUndo(cleared)).toBe(true);
  const back = undo(cleared);
  expect(back.shapes).toEqual(a.shapes);
  expect(canRedo(back)).toBe(true);
  const again = redo(back);
  expect(again.shapes).toEqual([]);
  expect(undo(again).shapes).toEqual(a.shapes);
  expect(canRedo(again)).toBe(false);
});

test("a new mark after Clear drops the way back, and clearing nothing changes nothing", () => {
  const a = { shapes: [{ tool: "rect", x: 0, y: 0, w: 1, h: 1 }] as never[], undone: [] as never[] };
  const next = add(clearUndoable(a as never), { tool: "rect", x: 2, y: 2, w: 3, h: 3 });
  expect(canUndo(undo(next))).toBe(false);
  expect(clearUndoable(empty())).toEqual(empty());
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
