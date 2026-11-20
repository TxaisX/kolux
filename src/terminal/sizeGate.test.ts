// FT-4 (review 0.2.0, follow-up): a resize to the size already sent is not sent again, a newly bound terminal hears
// its size, and a send that failed is retried instead of being held back for good.
import { expect, test } from "vitest";
import { sizeGate } from "./sizeGate";

test("FT-4: the same size for the same terminal is sent once", () => {
  const g = sizeGate();
  expect(g.send(7, 80, 24)).toBe(true);
  expect(g.send(7, 80, 24)).toBe(false);
  expect(g.send(7, 100, 24)).toBe(true);
  expect(g.send(7, 80, 24)).toBe(true); // a different size in between: sent again
});

test("FT-4: another terminal id, or a reset after a new bind, hears the size again", () => {
  const g = sizeGate();
  g.send(7, 80, 24);
  expect(g.send(8, 80, 24)).toBe(true);
  g.reset();
  expect(g.send(8, 80, 24)).toBe(true);
});

test("FT-4: a send that failed is retried at the same size", () => {
  const g = sizeGate();
  expect(g.send(7, 80, 24)).toBe(true);
  g.failed(7, 80, 24);
  expect(g.send(7, 80, 24)).toBe(true);
  expect(g.send(7, 80, 24)).toBe(false);
});

test("FT-4: a late failure of an older size does not clear the newer one", () => {
  const g = sizeGate();
  g.send(7, 80, 24);
  g.send(7, 100, 30);
  g.failed(7, 80, 24);
  expect(g.send(7, 100, 30)).toBe(false);
});
