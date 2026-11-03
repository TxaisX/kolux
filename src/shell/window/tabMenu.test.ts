// TERM-044 / TERM-046 / TERM-049: the tab menu's close rows. What each row closes and when it is
// disabled is decided here; the menu only draws it (shell/window/TabMenuView.tsx).
import { expect, test } from "vitest";
import { closeRows } from "./tabMenu";
import { closeConfirmLabel, menuAnchor } from "./tabMenuStart";

const rows = (order: number[], key: number, pinned: number[] = []) => closeRows(order, key, new Set(pinned));

test("TERM-044: the tab menu's five close rows, in order, and what each would close", () => {
  expect(rows([1, 2, 3], 2)).toEqual([
    { label: "Close", which: "one", keys: [2], disabled: false },
    { label: "Close others", which: "others", keys: [1, 3], disabled: false },
    { label: "Close to the right", which: "right", keys: [3], disabled: false },
    { label: "Close to the left", which: "left", keys: [1], disabled: false },
    { label: "Close all", which: "all", keys: [1, 2, 3], disabled: false },
  ]);
});

test("TERM-046: a pinned tab's own row is disabled, the bulk rows skip pinned tabs, and a row with nothing to close is disabled", () => {
  const pinned = rows([1, 2, 3], 2, [2]);
  expect(pinned[0]).toMatchObject({ keys: [], disabled: true });
  expect(pinned[1].keys).toEqual([1, 3]);
  expect(pinned[4].keys).toEqual([1, 3]);
  // The first tab has nothing to its left; the last has nothing to its right.
  expect(rows([1, 2, 3], 1)[3]).toMatchObject({ keys: [], disabled: true });
  expect(rows([1, 2, 3], 3)[2]).toMatchObject({ keys: [], disabled: true });
  expect(rows([1, 2, 3], 1)[2].keys).toEqual([2, 3]);
  // A key that is not in the strip closes nothing at all.
  expect(rows([1, 2, 3], 9).every((r) => r.disabled)).toBe(true);
});

// UX lane A (shell.md row 14): a disabled close row says why.
test("a disabled close row carries the reason for its tooltip; an enabled row has none", () => {
  const pinned = rows([1, 2, 3], 2, [2]);
  expect(pinned[0].why).toMatch(/pinned tab stays open.*Unpin/);
  expect(pinned[1].why).toBeUndefined();
  const first = rows([1, 2, 3], 1);
  expect(first[3].disabled).toBe(true);
  expect(first[3].why).toMatch(/no tab to the left/);
  expect(rows([1], 1)[1].why).toMatch(/no other tab/);
  expect(rows([1, 2, 3], 2).every((r) => r.why === undefined)).toBe(true);
  expect(rows([1, 2], 9).every((r) => r.disabled && !!r.why)).toBe(true);
});

// UX lane A (destructive.md row 21): the close question's button says how many tabs go.
test("the close question's confirm button names the count", () => {
  expect(closeConfirmLabel(1)).toBe("Close tab");
  expect(closeConfirmLabel(3)).toBe("Close 3 tabs");
});

// UX lane A (shell.md row 7): the menu stays inside the window, also a small one.
test("the tab menu's corner is clamped to the window on every side", () => {
  expect(menuAnchor(100, 100, 1200, 800)).toEqual({ top: 100, left: 100 });
  expect(menuAnchor(1190, 790, 1200, 800)).toEqual({ top: 800 - 330 - 8, left: 1200 - 240 - 8 });
  // a window shorter than the menu: the top-left edge still wins, never a negative position
  expect(menuAnchor(5, 5, 200, 250)).toEqual({ top: 8, left: 8 });
  expect(menuAnchor(-20, -20, 1200, 800)).toEqual({ top: 8, left: 8 });
});
