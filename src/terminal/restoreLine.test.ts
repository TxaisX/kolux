// Review P1-B (2026-11-23): a restored tab's start-line ask was cut off at 2 s while a slow agent
// answers in about 3 s, so the tab mounted on a bare line and lost its resume. The deadline is now
// past that, and every miss leaves a mark on the start-up timeline.
import { afterEach, expect, test, vi } from "vitest";
import { RESTORE_ASK_MS, within } from "./restoreLine";
import main from "../main.tsx?raw";

afterEach(() => vi.useRealTimers());

test("P1-B: the deadline outlasts a slow agent's 3 s lookup with room to spare", () => {
  expect(RESTORE_ASK_MS).toBeGreaterThanOrEqual(15_000);
});

test("P1-B: an answer in time is the line; a 3 s answer is in time", async () => {
  vi.useFakeTimers();
  const missed = vi.fn();
  const got = within(new Promise<string>((r) => setTimeout(() => r("line"), 3_000)), RESTORE_ASK_MS, missed);
  await vi.advanceTimersByTimeAsync(3_000);
  await expect(got).resolves.toBe("line");
  expect(missed).not.toHaveBeenCalled();
});

test("P1-B: a late answer is a miss, reported once; a refusal is null but not a miss", async () => {
  vi.useFakeTimers();
  const missed = vi.fn();
  const late = within(new Promise<string>(() => {}), 100, missed);
  await vi.advanceTimersByTimeAsync(100);
  await expect(late).resolves.toBeNull();
  expect(missed).toHaveBeenCalledTimes(1);
  const refusedMiss = vi.fn();
  await expect(within(Promise.reject(new Error("no")), 100, refusedMiss)).resolves.toBeNull();
  await vi.advanceTimersByTimeAsync(200);
  expect(refusedMiss).not.toHaveBeenCalled();
});

test("P1-B: the restore asks go through the deadline and mark each miss", () => {
  expect(main).toContain('within(');
  expect(main).toContain("RESTORE_ASK_MS");
  expect(main).toContain('bootMark("restore:miss")');
  expect(main).not.toMatch(/const RESTORE_ASK_MS = /);
});
