// TERM-103 acceptance (decision half): with ten terminals open the window's pool hands the GPU path to six and the plain path to the
// other four, and a GPU load failure still leaves a working plain pane. Whether those panes draw text is the renderer's own job (live).
import { expect, test } from "vitest";
import { attachRenderer, gpuOn, gpuPool, type WebglLike } from "../renderer";

const gl = (): WebglLike => ({ dispose() {}, onContextLoss() {} });

test("fourteen terminals: the first twelve take the GPU path, the two beyond the cap are plain, none is left without a renderer choice", () => {
  const pool = { max: gpuPool.max, live: 0 };
  expect(gpuPool.max).toBe(12);
  const loaded: number[] = [];
  const choices = Array.from({ length: 14 }, (_, i) => attachRenderer({ loadAddon() { loaded.push(i); } }, gl, true, pool));
  expect(choices.map((c) => c.mode)).toEqual(["webgl", "webgl", "webgl", "webgl", "webgl", "webgl", "webgl", "webgl", "webgl", "webgl", "webgl", "webgl", "dom", "dom"]);
  expect(loaded).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]); // plain panes never touch the GPU addon
  expect(pool.live).toBe(12);
  expect(() => choices.forEach((c) => c.clearGlyphs())).not.toThrow();
});

test("a GPU that fails to load makes that pane plain and costs the next ones nothing", () => {
  const pool = { max: 6, live: 0 };
  const bad = attachRenderer({ loadAddon() { throw new Error("no gl"); } }, gl, true, pool);
  expect(bad.mode).toBe("dom");
  const later = Array.from({ length: 6 }, () => attachRenderer({ loadAddon() {} }, gl, true, pool));
  expect(later.every((c) => c.mode === "webgl")).toBe(true);
});

test("the GPU switch off draws every one of ten terminals plain", () => {
  const pool = { max: 6, live: 0 };
  expect(gpuOn({ terminalGpu: false })).toBe(false);
  const all = Array.from({ length: 10 }, () => attachRenderer({ loadAddon() {} }, gl, gpuOn({ terminalGpu: false }), pool));
  expect(all.every((c) => c.mode === "dom")).toBe(true);
  expect(pool.live).toBe(0);
});
