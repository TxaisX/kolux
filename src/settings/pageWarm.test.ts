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

test("every page's code is read after Settings draws, one page per idle moment, not before, and never twice", async () => {
  const a = vi.fn(async () => ({}));
  const b = vi.fn(async () => ({}));
  const c = vi.fn(async () => ({}));
  const d = vi.fn(async () => ({}));
  const w = pageWarmer<"x" | "y" | "z">({ x: [a], y: [b, c], z: [d] });
  w.page("x");
  let idle: (() => void) | null = null;
  const tick = async () => {
    const f = idle;
    idle = null;
    f?.();
    await new Promise((r) => setTimeout(r, 0)); // the page asked for arrives
  };
  w.rest((f) => ((idle = f), () => (idle = null)));
  expect(b).not.toHaveBeenCalled();
  await tick(); // x: already read by the hover, nothing new
  expect([a, b, c, d].map((f) => f.mock.calls.length)).toEqual([1, 0, 0, 0]);
  await tick(); // y: both of its modules, and only its
  expect([a, b, c, d].map((f) => f.mock.calls.length)).toEqual([1, 1, 1, 0]);
  await tick(); // z
  expect([a, b, c, d].map((f) => f.mock.calls.length)).toEqual([1, 1, 1, 1]);
  expect(idle).toBeNull(); // nothing left to wait for
});

test("closing Settings stops the warm-up where it is", async () => {
  const a = vi.fn(async () => ({}));
  const b = vi.fn(async () => ({}));
  const w = pageWarmer<"x" | "y">({ x: [a], y: [b] });
  let idle: (() => void) | null = null;
  const stop = w.rest((f) => ((idle = f), () => (idle = null)));
  idle!();
  await new Promise((r) => setTimeout(r, 0));
  stop();
  expect(idle).toBeNull();
  expect(b).not.toHaveBeenCalled();
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

test("the read-ahead is told when the last page has arrived, and at once when there is nothing to read", async () => {
  const a = vi.fn(async () => ({}));
  const b = vi.fn(async () => ({}));
  const w = pageWarmer<"x" | "y">({ x: [a], y: [b] });
  let idle: (() => void) | null = null;
  const done = vi.fn();
  w.rest((f) => ((idle = f), () => (idle = null)), done);
  const tick = async () => {
    const f = idle;
    idle = null;
    f?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  await tick();
  expect(done).not.toHaveBeenCalled();
  await tick();
  expect(done).toHaveBeenCalledTimes(1);
  const none = vi.fn();
  pageWarmer<"x">({}).rest(() => () => {}, none);
  expect(none).toHaveBeenCalledTimes(1);
});
