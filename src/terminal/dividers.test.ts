// TERM-010: dragging the line between panes.
import { expect, test } from "vitest";
import { dragWeights, gapAt, templateOf, tracks } from "./dividers";

const r = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });
// a 2x2 grid of 300x200 cells with a 6px gap
const cells = [r(0, 0, 300, 200), r(306, 0, 300, 200), r(0, 206, 300, 200), r(306, 206, 300, 200)];

test("TERM-010: the column and row tracks come from the visible cells' edges, one per distinct start", () => {
  expect(tracks(cells, "x")).toEqual([
    { start: 0, end: 300 },
    { start: 306, end: 606 },
  ]);
  expect(tracks(cells, "y")).toEqual([
    { start: 0, end: 200 },
    { start: 206, end: 406 },
  ]);
  expect(tracks([], "x")).toEqual([]);
});

test("TERM-010: a point in a gap names the divider; a point inside a cell or outside names none", () => {
  const cols = tracks(cells, "x");
  const rows = tracks(cells, "y");
  expect(gapAt(303, 50, cols, rows)).toEqual({ axis: "col", i: 0 });
  expect(gapAt(50, 203, cols, rows)).toEqual({ axis: "row", i: 0 });
  // the crossing point counts as the column divider
  expect(gapAt(303, 203, cols, rows)).toEqual({ axis: "col", i: 0 });
  expect(gapAt(50, 50, cols, rows)).toBeNull();
  expect(gapAt(700, 50, cols, rows)).toBeNull();
});

test("TERM-010: moving a divider shifts weight between its two tracks, keeps the sum, and never shrinks a track under the minimum", () => {
  // two 300px tracks over 600px; 60px to the right is a tenth of the width = 0.2 of the 2 units
  expect(dragWeights([1, 1], 0, 60, 600, 120)).toEqual([1.2, 0.8]);
  expect(dragWeights([1, 1], 0, -60, 600, 120)).toEqual([0.8, 1.2]);
  // 120px minimum = 0.4 units: a 400px pull stops at the minimum, sum stays 2
  expect(dragWeights([1, 1], 0, 400, 600, 120)).toEqual([1.6, 0.4]);
  expect(dragWeights([1, 1], 0, -400, 600, 120)).toEqual([0.4, 1.6]);
  // other tracks are untouched
  expect(dragWeights([1, 1, 1], 1, 90, 900, 120)).toEqual([1, 1.3, 0.7]);
  // no room at all: unchanged
  expect(dragWeights([1, 1], 0, 50, 0, 120)).toEqual([1, 1]);
});

test("TERM-010: the grid template is one flexible track per weight", () => {
  expect(templateOf([1, 1])).toBe("minmax(0, 1fr) minmax(0, 1fr)");
  expect(templateOf([1.25, 0.75])).toBe("minmax(0, 1.25fr) minmax(0, 0.75fr)");
});

test("a divider dragged in a very small window never gives a track a negative size (TERM-010)", () => {
  // four columns in a 200 px grid: two neighbours hold 100 px, less than twice the 120 px minimum
  for (const delta of [-500, -10, 0, 10, 500]) {
    const w = dragWeights([1, 1, 1, 1], 1, delta, 200, 120);
    expect(w.every((x) => x >= 0)).toBe(true);
    expect(w[1] + w[2]).toBeCloseTo(2);
  }
  expect(templateOf(dragWeights([1, 1, 1, 1], 1, 500, 200, 120))).not.toContain("-");
});
