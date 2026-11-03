// UX lane A (keyboard.md row 2, shell.md row 5): keyboard access to the tab strip.
import { expect, test } from "vitest";
import { tabKeyAction, tabKeyTarget, tabStop } from "./tabKeys";
import grid from "./Grid.tsx?raw";

const order = [4, 7, 9];

test("only the front tab is a tab stop; when the front pane is not in the strip the first one is", () => {
  expect(order.map((k) => tabStop(k, 7, order))).toEqual([-1, 0, -1]);
  expect(order.map((k) => tabStop(k, 99, order))).toEqual([0, -1, -1]);
});

test("Left and Right wrap along the strip; Home and End jump to the ends", () => {
  expect(tabKeyTarget("ArrowRight", order, 4)).toBe(7);
  expect(tabKeyTarget("ArrowRight", order, 9)).toBe(4);
  expect(tabKeyTarget("ArrowLeft", order, 4)).toBe(9);
  expect(tabKeyTarget("ArrowLeft", order, 7)).toBe(4);
  expect(tabKeyTarget("Home", order, 9)).toBe(4);
  expect(tabKeyTarget("End", order, 4)).toBe(9);
});

test("other keys and unknown tabs are left alone; Enter and Space bring the focused tab forward", () => {
  expect(tabKeyTarget("a", order, 4)).toBeNull();
  expect(tabKeyTarget("ArrowRight", order, 5)).toBeNull();
  expect(tabKeyAction("ArrowRight", order, 4)).toEqual({ focus: 7 });
  expect(tabKeyAction("Enter", order, 9)).toEqual({ activate: 9 });
  expect(tabKeyAction(" ", order, 9)).toEqual({ activate: 9 });
  expect(tabKeyAction("Enter", order, 5)).toBeNull();
  expect(tabKeyAction("Tab", order, 4)).toBeNull();
});

test("the grid draws the roving tabindex and the key handler, not tabIndex={0} on every tab", () => {
  expect(grid).toContain("tabStop(p.key, active, order)");
  expect(grid).toContain("tabKeyAction(");
  expect(grid).not.toMatch(/role="tab"[\s\S]{0,120}tabIndex=\{0\}/);
});
