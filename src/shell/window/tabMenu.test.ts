// TERM-044 / TERM-046 / TERM-049: the tab menu's close rows. What each row closes and when it is
// disabled is decided here; the menu only draws it (shell/window/TabMenuView.tsx).
import { expect, test } from "vitest";
import { closeRows } from "./tabMenu";
import { closeConfirmLabel, menuAnchor } from "./tabMenuStart";
import { stripOrderOf } from "../../terminal/pin";
import paneActions from "../../terminal/paneActions.ts?raw";

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

// C06-R1-01: with a pinned tab the strip is not the pane array. The rows must measure the strip as drawn,
// or the leftmost pinned tab's "Close to the left" closes a tab drawn on its right (and "Close to the
// right" leaves one open).
test("C06-R1-01: the close rows measure the drawn strip, pinned first, not the pane array", () => {
  // the pane array holds tab 1 last; the strip draws it first because it is pinned
  const panes = [
    { key: 2, group: 1 },
    { key: 3, group: 1 },
    { key: 1, group: 1 },
  ];
  const pinned = new Set([1]);
  const strip = stripOrderOf(panes, 1, pinned);
  expect(strip).toEqual([1, 2, 3]); // the order Grid.tsx draws
  const drawn = closeRows(strip, 1, pinned);
  expect(drawn[2].keys).toEqual([2, 3]); // Close to the right: the two drawn right of it
  expect(drawn[3]).toMatchObject({ keys: [], disabled: true }); // Close to the left: nothing is drawn there
  // the pane array is the defect: "Close to the left" would have closed the tabs drawn on its right
  expect(closeRows([2, 3, 1], 1, pinned)[3].keys).toEqual([2, 3]);
  // a strip with no pinned tab keeps its order, and the first tab still has nothing to its left
  expect(stripOrderOf(panes, 2, new Set())).toEqual([2, 3, 1]);
  expect(closeRows(stripOrderOf(panes, 3, new Set()), 3, new Set())[3].keys).toEqual([2]);
  // the window's own order (the one TabMenuView and Select Tab read) is the strip, not the pane array
  expect(paneActions).toMatch(/const orderOf = \(key: number\) => stripOrderOf\(panes, key, pinned\)/);
});

