// TERM-030 acceptance box 1: with two waiting sessions, two presses of the shortcut visit both.
// Box 2 (the chords themselves moving focus on Windows and macOS) needs the window and a Mac.
import { expect, test } from "vitest";
import { chordsOf, matchEvent, resolve, type KeyLike } from "../../keys/keymap";
import { nextNeedsYou } from "../status";
import { needsYou, paneStatus } from "../../status/chip";

type Seat = { key: number; hook?: "permission" | "waiting" | "working" | "done" | "blocked" | "interrupted" };

// Mirrors App.tsx terminals.focusNextNeedsYou: each pane's one status (board/chip.ts paneStatus) -> needsYou -> Set ->
// nextNeedsYou. DT-C52: a permission or a question only, not the pane header's attention flag.
const press = (seats: Seat[], focused: number) =>
  nextNeedsYou(seats.map((s) => s.key), new Set(seats.filter((s) => needsYou(paneStatus("claude", s.hook, null, true))).map((s) => s.key)), focused);

test("box 1: two waiting sessions among four panes, two presses visit both and a third returns to the first", () => {
  const seats: Seat[] = [{ key: 1, hook: "working" }, { key: 2, hook: "permission" }, { key: 3, hook: "done" }, { key: 4, hook: "waiting" }];
  const first = press(seats, 1);
  const second = press(seats, first as number);
  expect(first).toBe(2);
  expect(second).toBe(4);
  expect(new Set([first, second])).toEqual(new Set([2, 4])); // both waiting sessions visited
  expect(press(seats, second as number)).toBe(2); // repeated presses cycle
  // sessions that are working or done are never a stop
  expect([first, second]).not.toContain(1);
  expect([first, second]).not.toContain(3);
});

test("DT-C52: a blocked or interrupted pane is not a stop for Ctrl+J", () => {
  const seats: Seat[] = [{ key: 1, hook: "blocked" }, { key: 2, hook: "waiting" }, { key: 3, hook: "interrupted" }];
  expect(press(seats, 2)).toBe(2); // the only waiting pane, again
  expect(press([{ key: 1, hook: "blocked" }, { key: 2, hook: "interrupted" }], 1)).toBeNull();
});

test("the chord table: Ctrl+J on Windows and Linux, Cmd+Shift+J on macOS", () => {
  const j = (k: Partial<KeyLike>): KeyLike => ({ key: "j", code: "KeyJ", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...k });
  const win = resolve(null, "win32");
  expect(chordsOf(win, "terminals.focusNextNeedsYou")).toEqual(["Mod+J"]);
  expect(matchEvent(win, j({ ctrlKey: true }), ["global"])).toEqual({ id: "terminals.focusNextNeedsYou" });
  const mac = resolve(null, "darwin");
  expect(chordsOf(mac, "terminals.focusNextNeedsYou")).toEqual(["Mod+Shift+J"]);
  expect(matchEvent(mac, j({ metaKey: true, shiftKey: true, key: "J" }), ["global"])).toEqual({ id: "terminals.focusNextNeedsYou" });
});
