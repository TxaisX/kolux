// AUD-T5 repro (T5-F01): nextTick waits a whole extra unit when the time left is an exact
// multiple of its unit, so the reset countdown keeps its old words for up to an hour.
import { expect, test } from "vitest";
import { nextTick } from "./claude";

const now = Date.UTC(2026, 9, 13, 10, 0, 0);

test("[T5-F01] nextTick fires just after the countdown changes at an exact unit boundary", () => {
  // One minute away: countdown says "1m" now and "under 1m" one millisecond later.
  expect(nextTick([now + 60_000], now)).toBeLessThanOrEqual(1_000);
  // Two days away: countdown says "2d" now and "1d 23h" one millisecond later.
  expect(nextTick([now + 2 * 86_400_000], now)).toBeLessThanOrEqual(1_000);
});
