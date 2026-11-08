// VIEW-047 acceptance: the jump to the next pane waiting on the user, from the real status and keymap functions.
// MIRROR src/App.tsx terminals.focusNextNeedsYou: each pane's one status -> needsYou (DT-C52) -> nextNeedsYou over the grid-ordered panes; null returns without moving focus.
import { expect, test } from "vitest";
import { chordsOf, matchEvent, resolve, type KeyLike } from "../../keys/keymap";
import { nextNeedsYou } from "../status";
import { needsYou, paneStatus } from "../../board/chip";

type Seat = { key: number; hook?: "permission" | "waiting" | "working" | "done" };

// What one press does: the new focused pane key, which stays the same when nothing is waiting.
const press = (seats: Seat[], focused: number): number => {
  const needs = new Set(seats.filter((s) => needsYou(paneStatus("claude", s.hook, null, true))).map((s) => s.key));
  const k = nextNeedsYou(seats.map((s) => s.key), needs, focused);
  return k === null ? focused : k;
};

test("box 1: two panes waiting, pressing twice visits both", () => {
  const seats: Seat[] = [{ key: 1, hook: "working" }, { key: 2, hook: "waiting" }, { key: 3, hook: "done" }, { key: 4, hook: "permission" }];
  const first = press(seats, 1);
  const second = press(seats, first);
  expect([first, second]).toEqual([2, 4]);
});

test("box 2: no pane waiting, focus stays where it is", () => {
  const seats: Seat[] = [{ key: 1, hook: "working" }, { key: 2, hook: "done" }, { key: 3 }];
  for (const f of [1, 2, 3]) expect(press(seats, f)).toBe(f);
  expect(nextNeedsYou([1, 2, 3], new Set(), 2)).toBeNull();
});

test("rule: the default chord is the palette's chord swapped per platform", () => {
  const j = (k: Partial<KeyLike>): KeyLike => ({ key: "j", code: "KeyJ", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...k });
  const win = resolve(null, "win32");
  const mac = resolve(null, "darwin");
  expect(chordsOf(win, "terminals.focusNextNeedsYou")).toEqual(["Mod+J"]);
  expect(chordsOf(mac, "terminals.focusNextNeedsYou")).toEqual(["Mod+Shift+J"]);
  expect(chordsOf(win, "worktree.palette")).toEqual(["Mod+Shift+J", "Mod+Shift+P"]);
  expect(chordsOf(mac, "worktree.palette")).toEqual(["Mod+J", "Mod+Shift+P"]);
  expect(matchEvent(win, j({ ctrlKey: true }), ["global"])).toEqual({ id: "terminals.focusNextNeedsYou" });
  expect(matchEvent(mac, j({ metaKey: true, shiftKey: true, key: "J" }), ["global"])).toEqual({ id: "terminals.focusNextNeedsYou" });
});
