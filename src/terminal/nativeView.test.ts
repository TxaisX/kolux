import { expect, test, vi } from "vitest";
import { bindNative, rectOf, sameRect } from "./nativeView";

test("the pane body's spot goes to Rust in physical pixels; a zero-size body is nothing to show", () => {
  expect(rectOf({ left: 10, top: 20.4, width: 300, height: 200 }, 1.5)).toEqual({ x: 15, y: 31, w: 450, h: 300 });
  expect(rectOf({ left: 0, top: 0, width: 0, height: 200 }, 1)).toBeNull();
  expect(sameRect({ x: 1, y: 2, w: 3, h: 4 }, { x: 1, y: 2, w: 3, h: 4 })).toBe(true);
  expect(sameRect({ x: 1, y: 2, w: 3, h: 4 }, null)).toBe(false);
});

const body = (r = { left: 0, top: 0, width: 100, height: 50 }) => ({ getBoundingClientRect: () => r }) as unknown as HTMLElement;
const flush = () => new Promise((r) => setTimeout(r, 0));

test("attaches once the terminal has an id, moves on change, hides while hidden, detaches on stop", async () => {
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  const calls: [string, unknown][] = [];
  const call = async (cmd: string, args?: Record<string, unknown>) => void calls.push([cmd, args]);
  let id: number | null = null;
  let hidden = false;
  const box = { left: 0, top: 0, width: 100, height: 50 };
  const stop = bindNative(body(box), () => id, () => hidden, call, 5);
  await flush();
  expect(calls).toEqual([]); // no terminal yet
  id = 7;
  await new Promise((r) => setTimeout(r, 15));
  expect(calls[0]).toEqual(["native_term_attach", { id: 7, rect: { x: 0, y: 0, w: 100, h: 50 } }]);
  expect(calls).toHaveLength(1); // unchanged spot: no more calls
  box.left = 30;
  await new Promise((r) => setTimeout(r, 15));
  expect(calls[1]).toEqual(["native_term_place", { id: 7, rect: { x: 30, y: 0, w: 100, h: 50 } }]);
  hidden = true;
  await new Promise((r) => setTimeout(r, 15));
  expect(calls[2]).toEqual(["native_term_place", { id: 7, rect: null }]);
  stop();
  expect(calls[calls.length - 1]).toEqual(["native_term_detach", { id: 7 }]);
  vi.unstubAllGlobals();
});

test("a failed attach (no engine) leaves the pane on xterm and stops trying", async () => {
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  let n = 0;
  const stop = bindNative(body(), () => 3, () => false, async () => { n++; throw new Error("no engine"); }, 5);
  await new Promise((r) => setTimeout(r, 30));
  expect(n).toBe(1);
  stop();
  vi.unstubAllGlobals();
});
