// TERM-014 acceptance: closing one pane leaves the others filling the grid; the last pane closes the tab.
import { expect, test } from "vitest";
import { chordsOf, resolve } from "../../keys/keymap";
import { focusIn, panesIn } from "../../workspaces";
import { cellsOf, columnsFor, neighbourTab, rowsFor } from "../grid";

type P = { key: number; cwd: string };
const pane = (key: number, cwd = "C:\\w"): P => ({ key, cwd });

// Mirrors App.tsx dropPanes: the closed keys leave the list, focus falls back inside the workspace.
const close = (panes: P[], keys: number[], dir: string, focused: number) => {
  const rest = panes.filter((p) => !keys.includes(p.key));
  return { rest, focus: keys.includes(focused) ? focusIn(rest, dir, focused) : focused };
};

test("box 1: closing the middle of three panes leaves two panes filling the area", () => {
  const three = [pane(1), pane(2), pane(3)];
  const { rest, focus } = close(three, [2], "C:\\w", 2);
  expect(rest.map((p) => p.key)).toEqual([1, 3]); // only the focused pane went, siblings untouched
  const cells = cellsOf(panesIn(rest, "C:\\w"));
  expect(cells).toHaveLength(2);
  expect(columnsFor(2) * rowsFor(2)).toBe(2); // 2 x 1: no empty slot, no ghost pane
  expect(focus).toBe(1); // focus moves to a pane that is still there
  expect(columnsFor(3) * rowsFor(3)).toBe(4); // three panes left a gap; two tile with none
});

test("box 2: closing the only pane in a tab closes that tab, other workspaces keep theirs", () => {
  const panes = [pane(1), pane(2, "C:\\other")];
  const { rest } = close(panes, [1], "C:\\w", 1);
  expect(panesIn(rest, "C:\\w")).toEqual([]);
  expect(cellsOf(panesIn(rest, "C:\\w"))).toEqual([]);
  expect(panesIn(rest, "C:\\other").map((p) => p.key)).toEqual([2]);
  // a lone tab in a cell: no neighbour to hand over to, the cell goes
  expect(neighbourTab([1], 1)).toBeNull();
});

test("Mod+W closes the focused pane on every platform", () => {
  // T-717 (DT-C153): tab.close owns Mod+W and the window runs it as the focused pane's close (useWindowKeys).
  for (const platform of ["win32", "linux", "darwin"] as const) expect(chordsOf(resolve(null, platform), "tab.close")).toEqual(["Mod+W"]);
});
