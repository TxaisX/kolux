import { expect, test, vi } from "vitest";
import { leaveTabSearch } from "./tabSearchFocus";
import tabSearch from "./TabSearch.tsx?raw";

const now = (f: () => void) => f();

test("dismissing the box gives focus back to the element it came from", () => {
  const prev = { isConnected: true, focus: vi.fn() };
  leaveTabSearch(prev, false, () => null, now);
  expect(prev.focus).toHaveBeenCalledTimes(1);
});

test("an element that left the page falls back to a terminal", () => {
  const prev = { isConnected: false, focus: vi.fn() };
  const term = { isConnected: true, focus: vi.fn() };
  leaveTabSearch(prev, false, (s) => (s === ".xterm-helper-textarea" ? term : null), now);
  expect(prev.focus).not.toHaveBeenCalled();
  expect(term.focus).toHaveBeenCalledTimes(1);
});

test("picking a tab leaves focus to the jump", () => {
  const prev = { isConnected: true, focus: vi.fn() };
  leaveTabSearch(prev, true, () => null, now);
  expect(prev.focus).not.toHaveBeenCalled();
});

test("the focus is handed back after the box is gone, not before", () => {
  const prev = { isConnected: true, focus: vi.fn() };
  let queued: (() => void) | null = null;
  leaveTabSearch(prev, false, () => null, (f) => void (queued = f));
  expect(prev.focus).not.toHaveBeenCalled();
  (queued as unknown as () => void)();
  expect(prev.focus).toHaveBeenCalled();
});

test("the box remembers where it was opened from and hands focus back on Escape and on a click outside", () => {
  expect(tabSearch).toContain("leaveTabSearch(from.current, false");
  expect(tabSearch.split("close()").length - 1).toBe(2); // Escape and the backdrop
});
