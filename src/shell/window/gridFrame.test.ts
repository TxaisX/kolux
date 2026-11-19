// TERM-013 / VIEW-026 / VIEW-011 / T-142: the pane grid's frame. Which look it wears and when it is
// hidden is decided here; the grid applies it (shell/window/Grid.tsx).
import { expect, test } from "vitest";
import { gridFrame } from "./gridFrame";

const frame = (o: Partial<Parameters<typeof gridFrame>[0]> = {}) =>
  gridFrame({ board: false, zoomed: null, classic: false, terminals: true, pageOpen: false, ...o });

test("TERM-013 / VIEW-026: the grid's class follows the screen, the zoomed cell and Classic", () => {
  expect(frame().className).toBe("grid");
  expect(frame({ zoomed: 3 }).className).toBe("grid zoomed");
  expect(frame({ classic: true }).className).toBe("grid classic");
  expect(frame({ zoomed: 3, classic: true }).className).toBe("grid zoomed classic");
  expect(frame({ board: true }).className).toBe("board");
});

test("VIEW-011 / T-142: the grid stays mounted (hidden) behind a page, or off-screen", () => {
  expect(frame().hidden).toBe(false);
  expect(frame({ pageOpen: true }).hidden).toBe(true);
  expect(frame({ terminals: false }).hidden).toBe(true);
});
