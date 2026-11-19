import { expect, test } from "vitest";
import { SETTLE_MS, settleDelay } from "./settledQuery";

test("EDIT-049: typing waits a short pause before the filter runs, and clearing the box does not wait", () => {
  expect(settleDelay("git")).toBe(SETTLE_MS);
  expect(settleDelay(" a")).toBe(SETTLE_MS);
  expect(settleDelay("")).toBe(0);
  expect(settleDelay("   ")).toBe(0);
  expect(SETTLE_MS).toBeLessThan(300);
});
