// Audit N-21: the Artifacts page walked the workspace folder every 3 s whether or not anyone could see
// it, and a scan that failed was swallowed so a broken folder looked idle. `scanWhileShown` is the
// timing half: it scans now and on the timer while the page is shown, and not at all while hidden.
// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { scanWhileShown } = await import("./ArtifactsPage");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("a shown page scans at once and every three seconds", () => {
  const run = vi.fn();
  const loop = scanWhileShown(run);
  expect(run).toHaveBeenCalledTimes(1); // the first look happens before any timer
  vi.advanceTimersByTime(9000);
  expect(run).toHaveBeenCalledTimes(4);
  loop.stop();
  vi.advanceTimersByTime(9000);
  expect(run).toHaveBeenCalledTimes(4); // stopped means stopped
});

test("a hidden window scans nothing, and coming back scans at once", () => {
  const run = vi.fn();
  const loop = scanWhileShown(run);
  loop.setHidden(true);
  expect(run).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(30_000);
  expect(run).toHaveBeenCalledTimes(1); // 30 s behind another window: no folder walk
  loop.setHidden(false);
  expect(run).toHaveBeenCalledTimes(2); // no waiting for the next tick to catch up
  vi.advanceTimersByTime(3000);
  expect(run).toHaveBeenCalledTimes(3);
  loop.stop();
});

test("saying hidden twice starts no second timer", () => {
  const run = vi.fn();
  const loop = scanWhileShown(run);
  loop.setHidden(false);
  loop.setHidden(false);
  vi.advanceTimersByTime(3000);
  expect(run).toHaveBeenCalledTimes(2); // one scan and one tick, not two of each
  loop.stop();
});
