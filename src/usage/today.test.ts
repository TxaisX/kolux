import { afterEach, expect, test, vi } from "vitest";
import { localDay } from "./tokens";
import { watchDay } from "./today";

afterEach(() => vi.useRealTimers());

// Settings > Usage left open across midnight: the day bars and the grid must move on to the new day.
test("watchDay tells the panel each new local day, at midnight, and stops when asked", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 23, 58, 0));
  const days: string[] = [];
  const stop = watchDay((d) => days.push(localDay(d)));
  vi.advanceTimersByTime(60_000);
  expect(days).toEqual([]);
  vi.advanceTimersByTime(2 * 60_000);
  expect(days).toEqual(["2026-11-12"]);
  vi.advanceTimersByTime(24 * 3_600_000);
  expect(days).toEqual(["2026-11-12", "2026-11-13"]);
  stop();
  vi.advanceTimersByTime(48 * 3_600_000);
  expect(days).toHaveLength(2);
});
