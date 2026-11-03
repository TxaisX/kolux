import { expect, it } from "vitest";
import { InFlight, SETTLE_MS } from "./inflight";

it("lets one click through and holds the second until it settles", () => {
  const later: (() => void)[] = [];
  const g = new InFlight((fn, ms) => (expect(ms).toBe(SETTLE_MS), later.push(fn)));
  expect(g.start("claude:a")).toBe(true);
  expect(g.start("claude:a")).toBe(false);
  expect(g.start("claude:b")).toBe(true); // another session is its own click
  g.done("claude:a");
  expect(g.start("claude:a")).toBe(false); // still settling
  later.forEach((f) => f());
  expect(g.start("claude:a")).toBe(true);
});
