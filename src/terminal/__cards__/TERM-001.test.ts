// TERM-001 acceptance: the pane count follows the layout strip's request, 1..24, empty panes added,
// unstarted panes dropped first, no prompt while an unstarted pane can go instead.
import { expect, test } from "vitest";
import { blocking, cellsOf, clampCount, resizePlan, MAX_PANES } from "../grid";

type P = { key: number; cwd: string; seats?: unknown[] };
const dir = "C:\\w";
const running = (key: number): P => ({ key, cwd: dir });
const unstarted = (key: number): P => ({ key, cwd: dir, seats: [{}] });

// Mirrors App.tsx setCount: cells -> resizePlan -> drop whole cells, append fresh unstarted ones.
function setCount(panes: P[], n: number) {
  const shown = cellsOf(panes);
  const cells = shown.map((c) => ({ key: c.group, started: c.panes.some((p) => !p.seats) }));
  const { add, drop } = resizePlan(cells, n);
  const stuck = blocking(cells, n);
  let next = Math.max(0, ...panes.map((p) => p.key)) + 1;
  const fresh = Array.from({ length: add }, () => unstarted(next++));
  return { panes: [...panes.filter((p) => !drop.includes(p.key)), ...fresh], asked: stuck.length > 0, add, drop };
}

test("box 1: 4 -> 6 adds 2 empty panes and leaves the 4 running sessions untouched", () => {
  const four = [1, 2, 3, 4].map(running);
  const out = setCount(four, 6);
  expect(out.add).toBe(2);
  expect(out.drop).toEqual([]);
  expect(out.asked).toBe(false);
  expect(out.panes).toHaveLength(6);
  four.forEach((p, i) => expect(out.panes[i]).toBe(p)); // the same pane objects, same order
  expect(out.panes.slice(4).every((p) => p.seats !== undefined)).toBe(true); // both new panes are unstarted choosers
  expect(out.panes.slice(4).map((p) => p.key)).toEqual([5, 6]);
});

test("box 2: 6 -> 4 with 2 unstarted panes removes those 2 without any prompt", () => {
  const six = [running(1), unstarted(2), running(3), running(4), unstarted(5), running(6)];
  const out = setCount(six, 4);
  expect(out.asked).toBe(false); // no toast / question: nothing started is in the way
  expect(out.drop.slice().sort()).toEqual([2, 5]);
  expect(out.panes.map((p) => p.key)).toEqual([1, 3, 4, 6]);
  expect(out.panes.every((p) => p.seats === undefined)).toBe(true); // all four survivors are the running ones
});

test("box 3: asking for 25 panes yields 24", () => {
  expect(clampCount(25)).toBe(24);
  const four = [1, 2, 3, 4].map(running);
  const out = setCount(four, 25);
  expect(cellsOf(out.panes)).toHaveLength(24);
  expect(MAX_PANES).toBe(24);
  const full = Array.from({ length: 24 }, (_, i) => running(i + 1));
  const same = setCount(full, 25);
  expect(same.add).toBe(0);
  expect(same.panes).toHaveLength(24);
});
