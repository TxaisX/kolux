// requestFeedback lives in its own small file so the crash screen and Help can ask for the box without loading it;
// a request made before the box's code has arrived is kept for it, once, and not for long.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal("window", { dispatchEvent: () => true });
  vi.stubGlobal("CustomEvent", class { constructor(public type: string, public init: unknown) {} });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("a request nobody heard is handed to the box when it mounts, once", async () => {
  const { requestFeedback, takeParked } = await import("./request");
  takeParked();
  requestFeedback("it broke", true);
  expect(takeParked()).toEqual({ text: "it broke", crash: true });
  expect(takeParked()).toBeNull();
});

test("a request that waited longer than any read of the box is stale", async () => {
  const { requestFeedback, takeParked } = await import("./request");
  requestFeedback("old");
  vi.advanceTimersByTime(11_000);
  expect(takeParked()).toBeNull();
});
