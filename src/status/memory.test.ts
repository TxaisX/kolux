import { expect, test } from "vitest";
import { formatMemory, pollWhileVisible } from "./memory";

test("working set reads like the status bar: one decimal in MB", () => {
  expect(formatMemory(717.9 * 1024 * 1024)).toBe("717.9 MB");
  expect(formatMemory(0)).toBe("0.0 MB");
  expect(formatMemory(52_428_800)).toBe("50.0 MB");
});

test("past a gigabyte it switches unit; unknown shows a dash", () => {
  expect(formatMemory(1.5 * 1024 * 1024 * 1024)).toBe("1.50 GB");
  expect(formatMemory(null)).toBe("– MB");
  expect(formatMemory(-1)).toBe("– MB");
});

test("the memory figure is asked for only while the window is visible, and at once when it is shown again", () => {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
  };
  const live = new Set<() => void>();
  const timers = { every: (fn: () => void) => (live.add(fn), fn), stop: (h: unknown) => void live.delete(h as () => void) };
  const fire = () => live.forEach((fn) => fn());
  const show = (state: DocumentVisibilityState) => ((doc.visibilityState = state), listeners.forEach((fn) => fn()));
  let asked = 0;
  const stop = pollWhileVisible(() => asked++, 2000, doc as unknown as Document, timers);
  expect([asked, live.size]).toEqual([1, 1]);
  fire();
  expect(asked).toBe(2);
  show("hidden");
  expect(live.size).toBe(0);
  fire();
  expect(asked).toBe(2);
  show("visible");
  expect([asked, live.size]).toEqual([3, 1]);
  show("visible"); // a repeat event starts nothing twice
  expect(live.size).toBe(1);
  stop();
  expect([live.size, listeners.size]).toEqual([0, 0]);
});
