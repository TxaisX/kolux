import { expect, test, vi } from "vitest";
import { pageWarmer } from "./pageWarm";

test("a page's code is read when the pointer or keyboard reaches its button, once", () => {
  const a = vi.fn(async () => ({}));
  const b = vi.fn(async () => ({}));
  const w = pageWarmer<"x" | "y">({ x: [a], y: [b] });
  w.page("x");
  w.page("x");
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).not.toHaveBeenCalled();
});

test("every page's code is read at the first idle moment after Settings draws, not before, and never twice", () => {
  const a = vi.fn(async () => ({}));
  const b = vi.fn(async () => ({}));
  const c = vi.fn(async () => ({}));
  const w = pageWarmer<"x" | "y">({ x: [a], y: [b, c] });
  w.page("x");
  let idle: (() => void) | null = null;
  w.rest((f) => ((idle = f), () => (idle = null)));
  expect(b).not.toHaveBeenCalled();
  idle!();
  expect([a, b, c].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
});

test("a read that failed is tried again by the next warm-up", async () => {
  let fail = true;
  const a = vi.fn(() => (fail ? Promise.reject(new Error("offline")) : Promise.resolve({})));
  const w = pageWarmer<"x">({ x: [a] });
  w.page("x");
  await new Promise((r) => setTimeout(r, 0));
  fail = false;
  w.page("x");
  expect(a).toHaveBeenCalledTimes(2);
});
