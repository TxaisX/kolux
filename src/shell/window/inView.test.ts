// FT-1 (review 0.2.0): a pane is hidden unless the terminals screen is shown, its cell is in the folder in front,
// it is the top tab and zoom leaves its cell on screen. Pane.tsx hands that one answer to every live pane body.
import { expect, test } from "vitest";
import { paneInView } from "./inView";
import pane from "./Pane.tsx?raw";

const here = "C:\\work\\a";
const there = "C:\\work\\b";
const w = { terminals: true, activeDir: here, zoomed: null };
const cellA = { group: 1, panes: [{ key: 1, cwd: here }, { key: 2, cwd: here }] };
const cellB = { group: 3, panes: [{ key: 3, cwd: there }] };

test("FT-1: the top tab of a cell in the folder in front is in view", () => {
  expect(paneInView(cellA, 2, 2, w)).toBe(true);
});

test("FT-1: a pane in another folder's grid is hidden, even as its cell's top tab", () => {
  expect(paneInView(cellB, 3, 3, w)).toBe(false);
});

test("FT-1: a tab under another tab, a cell zoomed away, and any pane off the terminals screen are hidden", () => {
  expect(paneInView(cellA, 1, 2, w)).toBe(false);
  expect(paneInView(cellA, 2, 2, { ...w, zoomed: 5 })).toBe(false);
  expect(paneInView(cellA, 2, 2, { ...w, zoomed: 1 })).toBe(true);
  expect(paneInView(cellA, 2, 2, { ...w, terminals: false })).toBe(false);
  expect(paneInView(undefined, 2, 2, w)).toBe(false);
});

test("FT-1: Pane.tsx gives the terminal, the seat chooser and the asleep pane the full in-view test", () => {
  expect(pane).toMatch(/paneInView\(/);
  expect(pane).not.toMatch(/hidden=\{p\.key !== active\}/);
  for (const tag of ["<TerminalPane", "<SeatChooser", "<AsleepPane"]) {
    const at = pane.indexOf(tag);
    expect(at, tag).toBeGreaterThan(-1);
    expect(pane.slice(at, at + 400), tag).toMatch(/hidden=\{hidden\}/);
  }
});
