// The pane grid's arithmetic (TERM-001, TERM-004, TERM-006, TERM-040, VIEW-026), pure so it runs without a browser.
import { expect, test } from "vitest";
import { blocking, cellsOf, clampCount, columnsFor, insertBefore, MAX_PANES, neighbourTab, resizePlan, rowsFor, splitIndex, toggleCard, freeCell, PANE_COUNTS, seedCount, canExpand, toggleZoom, zoomedGroup } from "./grid";

const started = (key: number) => ({ key, started: true });
const empty = (key: number) => ({ key, started: false });

test("TERM-001: the count is clamped to 1..24; 25 panes yields 24", () => {
  expect(clampCount(25)).toBe(24);
  expect(clampCount(0)).toBe(1);
  expect(clampCount(-3)).toBe(1);
  expect(clampCount(6.7)).toBe(6);
  expect(clampCount(Number.NaN)).toBe(1);
  expect(MAX_PANES).toBe(24);
});

test("TERM-001: 4 to 6 adds 2 empty panes and leaves the 4 running sessions untouched", () => {
  const four = [1, 2, 3, 4].map(started);
  expect(resizePlan(four, 6)).toEqual({ add: 2, drop: [] });
});

test("TERM-001: 6 to 4 with 2 unstarted panes removes those 2, newest first, and never a started one", () => {
  const six = [started(1), empty(2), started(3), started(4), empty(5), started(6)];
  expect(resizePlan(six, 4)).toEqual({ add: 0, drop: [5, 2] });
  expect(resizePlan(six, 5)).toEqual({ add: 0, drop: [5] });
  // Only started sessions left: nothing is dropped (the ask comes with TERM-003).
  expect(resizePlan([1, 2, 3].map(started), 1)).toEqual({ add: 0, drop: [] });
  expect(resizePlan(six, 20)).toEqual({ add: 14, drop: [] });
  expect(resizePlan(six, 25)).toEqual({ add: 18, drop: [] });
  expect(resizePlan(six, 6)).toEqual({ add: 0, drop: [] });
});

test("TERM-001: the started sessions that keep a shrink from reaching its count, newest first (T-009-fix-b; asking first is T-151)", () => {
  const shown = [
    { key: 1, started: true },
    { key: 2, started: true },
    { key: 3, started: false },
  ];
  expect(blocking(shown, 1)).toEqual([2]);
  expect(blocking(shown, 2)).toEqual([]);
  expect(blocking(shown, 4)).toEqual([]);
  expect(blocking(shown.slice(0, 2), 1)).toEqual([2]);
});

test("TERM-004: balanced rows for one, two, four, six, nine, twelve and twenty-four panes", () => {
  const shape = (n: number) => [columnsFor(n), rowsFor(n)];
  expect(shape(1)).toEqual([1, 1]);
  expect(shape(2)).toEqual([2, 1]);
  expect(shape(3)).toEqual([2, 2]);
  expect(shape(4)).toEqual([2, 2]);
  expect(shape(6)).toEqual([3, 2]);
  expect(shape(9)).toEqual([3, 3]);
  expect(shape(12)).toEqual([4, 3]);
  expect(shape(24)).toEqual([4, 6]);
  expect(shape(0)).toEqual([1, 1]);
});

test("TERM-006: split right lands next to the pane, split down in the cell below", () => {
  const keys = [1, 2, 3, 4, 5, 6];
  expect(splitIndex(keys, 2, "right", 3)).toBe(2);
  expect(splitIndex(keys, 2, "down", 3)).toBe(4);
  expect(splitIndex(keys, 6, "right", 3)).toBe(6);
  expect(splitIndex(keys, 6, "down", 3)).toBe(6);
  expect(splitIndex(keys, 99, "right", 3)).toBe(6);
});

test("TERM-006: split down from one pane stacks two rows; from four panes the new pane lands below (T-009-fix-a)", () => {
  // one pane, split down: the grid turns into one column of two rows and the new pane is the lower one
  expect(columnsFor(2, true)).toBe(1);
  expect(rowsFor(2, true)).toBe(2);
  expect(splitIndex([1], 1, "down", columnsFor(2, true))).toBe(1);
  // split right from a stacked pair goes back to columns
  expect([columnsFor(2, false), columnsFor(3, true)]).toEqual([2, 2]);
  // four panes (2x2) become five (3 wide): the pane split down from the first lands in row 2, column 1
  expect(splitIndex([1, 2, 3, 4], 1, "down", columnsFor(5))).toBe(3);
  expect(splitIndex([1, 2, 3, 4], 4, "down", columnsFor(5))).toBe(4);
});

test("TERM-004/006: inserting before a pane keeps every other pane in place", () => {
  const panes = [
    { key: 1, cwd: null },
    { key: 2, cwd: "C:\\a" },
    { key: 3, cwd: "C:\\b" },
    { key: 4, cwd: "C:\\a" },
  ];
  const fresh = { key: 9, cwd: "C:\\a" };
  expect(insertBefore(panes, panes[3], fresh).map((p) => p.key)).toEqual([1, 2, 3, 9, 4]);
  expect(insertBefore(panes, undefined, fresh).map((p) => p.key)).toEqual([1, 2, 3, 4, 9]);
  expect(insertBefore(panes, panes[1], fresh).map((p) => p.key)).toEqual([1, 9, 2, 3, 4]);
});

test("TERM-040: panes sharing a group make one cell of tabs, in first-seen order", () => {
  const panes = [
    { key: 1, cwd: null },
    { key: 2, cwd: null, group: 1 },
    { key: 3, cwd: null },
    { key: 4, cwd: null, group: 3 },
    { key: 5, cwd: null, group: 1 },
  ];
  const cells = cellsOf(panes);
  expect(cells.map((c) => c.group)).toEqual([1, 3]);
  expect(cells[0].panes.map((p) => p.key)).toEqual([1, 2, 5]);
  expect(cells[1].panes.map((p) => p.key)).toEqual([3, 4]);
});

test("TERM-040/014: closing a tab hands over to the next one, else the previous, and the last closes the cell", () => {
  expect(neighbourTab([1, 2, 3], 2)).toBe(3);
  expect(neighbourTab([1, 2, 3], 3)).toBe(2);
  expect(neighbourTab([1, 2, 3], 1)).toBe(2);
  expect(neighbourTab([7], 7)).toBeNull();
  expect(neighbourTab([1, 2], 9)).toBeNull();
});

test("VIEW-026: expanding a Board card shows its terminal, expanding it again or another card collapses it", () => {
  expect(toggleCard(null, 2)).toBe(2);
  expect(toggleCard(2, 2)).toBeNull();
  expect(toggleCard(2, 5)).toBe(5);
});

// TERM-017 (T-067): a split never touches an existing pane. The window keys each cell by its group and
// each pane by its key, so the same pane object in the same cell means React keeps the same terminal.
test("TERM-017: ten random splits keep every pane object in its own cell, in order", () => {
  let seed = 17;
  const rnd = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
  let panes = [{ key: 1, cwd: "C:\a" }, { key: 2, cwd: "C:\a" }];
  let next = 3;
  for (let i = 0; i < 10; i++) {
    const before = cellsOf(panes).map((c) => ({ group: c.group, panes: [...c.panes] }));
    const src = panes[rnd(panes.length)];
    const dir = rnd(2) ? "right" : "down";
    const shown = cellsOf(panes);
    const at = splitIndex(shown.map((c) => c.group), src.key, dir, columnsFor(shown.length + 1));
    panes = insertBefore(panes, shown[at]?.panes[0], { key: next++, cwd: "C:\a" });
    const after = cellsOf(panes);
    for (const cell of before) {
      const same = after.find((c) => c.group === cell.group);
      expect(same, `cell ${cell.group} survives split ${i}`).toBeDefined();
      expect(same!.panes.length).toBe(cell.panes.length);
      cell.panes.forEach((p, k) => expect(same!.panes[k]).toBe(p));
    }
  }
  expect(panes).toHaveLength(12);
});

test("TERM-005: a new workspace starts with the saved pane count, 1 when unset or in the classic look", () => {
  expect(PANE_COUNTS).toEqual([1, 2, 4, 6, 9, 12]);
  expect(seedCount(undefined, false)).toBe(1);
  expect(seedCount(4, false)).toBe(4);
  expect(seedCount("9", false)).toBe(9);
  expect(seedCount(5, false)).toBe(1);
  expect(seedCount(12, true)).toBe(1);
});

test("TERM-007: a new session fills the first empty pane, and none when every cell has a session", () => {
  const shell = { key: 1, cwd: "a" };
  const chooser = { key: 2, cwd: "a", seats: [] };
  const tabbed = [{ key: 3, cwd: "a", group: 3, seats: [] }, { key: 4, cwd: "a", group: 3 }];
  expect(freeCell(cellsOf([shell, chooser]))).toBe(chooser);
  expect(freeCell(cellsOf([shell, ...tabbed]))).toBeUndefined();
  expect(freeCell(cellsOf([shell]))).toBeUndefined();
});

test("TERM-013: expanding a cell fills the grid, the same cell again restores, one per workspace", () => {
  let z = toggleZoom({}, "C:/w", 4, 3);
  expect(zoomedGroup(z, [1, 4, 7])).toBe(4);
  z = toggleZoom(z, "C:/w", 7, 3);
  expect(zoomedGroup(z, [1, 4, 7])).toBe(7);
  expect(toggleZoom(z, "C:/w", 7, 3)).toEqual({});
  // Another workspace keeps its own expanded cell.
  z = toggleZoom(toggleZoom({}, "C:/w", 4, 3), "C:/v", 9, 2);
  expect(zoomedGroup(z, [9, 10])).toBe(9);
  expect(zoomedGroup(z, [1, 4, 7])).toBe(4);
  // A pane added or closed since restores the layout; expanding again expands rather than restores.
  expect(zoomedGroup(z, [1, 4, 7, 8])).toBeNull();
  expect(zoomedGroup(toggleZoom(z, "C:/w", 4, 4), [1, 4, 7, 8])).toBe(4);
});

test("TERM-025: a lone pane cannot expand in the classic look; the clean look expands its window", () => {
  expect(canExpand(1, true)).toBe(false);
  expect(canExpand(1, false)).toBe(true);
  expect(canExpand(2, true)).toBe(true);
});
