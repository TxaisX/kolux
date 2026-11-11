// DT-C264: the stage picture, held to the stylesheet's gradients point by point. stage.test.ts checks the
// pools' numbers and the hand-over; this file works the gradients out a second time, straight from
// glass.css, and compares the picture with that along every pool's slope, so a pool that is cut short,
// squashed, shifted by half a cell or stepped cannot pass.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { POOL, WASH } from "./glass";
import { forgetStage, STAGE_SIZE, stagePicture, stagePixels } from "./stage";

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: string, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync("src/look/glass.css", "utf8");
const LIGHTS = ["#4f7fe0", "#8a5fe0", "#4fb7e0"];
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The stylesheet's pools, read here and not taken from stage.ts: ellipse, centre, light, and stops as [share, place]. */
const POOLS = [...css.match(/--glass-stage:([^;]+);/)![1].matchAll(/radial-gradient\(ellipse ([0-9.]+)vw ([0-9.]+)vh at ([0-9.]+)% ([0-9.]+)%, ([^]*?transparent [0-9.]+%)\)/g)].map((m) => ({
  rx: Number(m[1]), ry: Number(m[2]), x: Number(m[3]), y: Number(m[4]),
  light: "abc".indexOf(m[5].match(/--glass-([abc])\)/)![1]),
  stops: [...m[5].matchAll(/(?:color-mix\(in srgb, var\(--glass-[abc]\) ([0-9.]+)%, transparent\)|var\(--glass-[abc]\)|(transparent))(?: ([0-9.]+)%)?/g)].map((s) => [s[2] ? 0 : s[1] ? Number(s[1]) / 100 : 1, s[3] ? Number(s[3]) / 100 : 0]),
}));

/** What the gradients put at a point of the window (x and y in hundredths of its width and height), worked
 *  out the long way: the wash, then every pool that reaches the point laid over it, last listed first. */
function gradientsAt(x: number, y: number, glow: number): number[] {
  let [r, g, b] = rgb(LIGHTS[0]);
  let a = glow * WASH;
  for (const p of [...POOLS].reverse()) {
    const d = Math.sqrt(((x - p.x) / p.rx) ** 2 + ((y - p.y) / p.ry) ** 2);
    let share = 0;
    for (let k = 0; k < p.stops.length; k++) {
      const [to, at] = p.stops[k];
      if (k === 0 && d <= at) { share = to; break; }
      if (k > 0 && d <= at) { const [from, start] = p.stops[k - 1]; share = from + ((to - from) * (d - start)) / (at - start); break; }
    }
    const pa = glow * POOL * share;
    if (pa <= 0) continue;
    const ink = rgb(LIGHTS[p.light]);
    const all = pa + a * (1 - pa);
    r = (ink[0] * pa + r * a * (1 - pa)) / all;
    g = (ink[1] * pa + g * a * (1 - pa)) / all;
    b = (ink[2] * pa + b * a * (1 - pa)) / all;
    a = all;
  }
  return [r, g, b, a * 255];
}

test("DT-C264: four pools are read from the stylesheet, and they are the ones the picture draws", () => {
  expect(POOLS.length).toBe(4);
  for (const p of POOLS) expect(p.stops.length).toBeGreaterThanOrEqual(3);
});

test("DT-C264: the picture is the gradients at every cell, all along every pool's slope and in every direction", () => {
  const [w, h] = [401, 201];
  for (const glow of [0.25, 0.64, 0.9]) {
    const px = stagePixels(w, h, LIGHTS, glow);
    let checked = 0;
    for (const p of POOLS) {
      for (const d of [0, 0.13, 0.26, 0.38, 0.5, 0.6, 0.69, 0.71]) {
        for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.6, -0.8]]) {
          const [x, y] = [p.x + ux * d * p.rx, p.y + uy * d * p.ry];
          if (x < 0 || x > 100 || y < 0 || y > 100) continue;
          // the cell nearest that point, and the point of the window that cell's centre stands for
          const [i, j] = [Math.round((x / 100) * (w - 1)), Math.round((y / 100) * (h - 1))];
          const want = gradientsAt((i / (w - 1)) * 100, (j / (h - 1)) * 100, glow);
          const got = [...px.slice((j * w + i) * 4, (j * w + i) * 4 + 4)];
          expect(Math.abs(got[3] - want[3]), `opacity, pool at ${p.x} ${p.y}, d ${d}, toward ${ux} ${uy}, glow ${glow}`).toBeLessThanOrEqual(0.51);
          for (let k = 0; k < 3; k++) expect(Math.abs(got[k] - want[k]), `colour ${k}, pool at ${p.x} ${p.y}, d ${d}`).toBeLessThanOrEqual(0.51);
          checked++;
        }
      }
    }
    expect(checked, "enough of each slope lies inside the window to mean something").toBeGreaterThan(120);
  }
});

test("DT-C264: a cell's centre is a point of the window, the first on one edge and the last on the other", () => {
  // 11 by 51 cells put a cell's centre exactly on the first pool's own centre (10 %, 14 %): the whole pool
  // is there. Sampled half a cell off, it would be some eight levels short.
  const glow = 0.64;
  const px = stagePixels(11, 51, LIGHTS, glow);
  const at = (i: number, j: number) => px[(j * 11 + i) * 4 + 3];
  const whole = glow * POOL + glow * WASH * (1 - glow * POOL);
  expect(at(1, 7)).toBe(Math.round(whole * 255));
  // and the corners are the window's corners
  for (const [i, j, x, y] of [[0, 0, 0, 0], [10, 0, 100, 0], [0, 50, 0, 100], [10, 50, 100, 100]]) expect(Math.abs(at(i, j) - gradientsAt(x, y, glow)[3])).toBeLessThanOrEqual(0.51);
});

test("DT-C264: the picture has no steps or cut edges: neighbouring cells are never far apart", () => {
  const [w, h] = STAGE_SIZE;
  const px = stagePixels(w, h, LIGHTS, 0.9); // the strongest glow has the steepest slopes
  let worst = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const a = px[(j * w + i) * 4 + 3];
      if (i + 1 < w) worst = Math.max(worst, Math.abs(a - px[(j * w + i + 1) * 4 + 3]));
      if (j + 1 < h) worst = Math.max(worst, Math.abs(a - px[((j + 1) * w + i) * 4 + 3]));
    }
  }
  expect(worst, "a hard ring or a clipped side would be tens of levels").toBeLessThanOrEqual(6);
  expect(worst, "and the slopes are really there").toBeGreaterThanOrEqual(1);
});

// ---- a picture that fails is asked for again ----
type Waiting = { ok: () => void; fail: () => void };
let waiting: Waiting[] = [];
let encoded = 0;
let pen: { putImageData(): void } | null = { putImageData: () => {} };
const GLASS = { "--glass-tint": LIGHTS[0], "--glass-mate": LIGHTS[1], "--glass-third": LIGHTS[2], "--glass-glow": "64%" };
const root = () => {
  const set = new Map<string, string>();
  return { set, style: { setProperty: (k: string, v: string) => void set.set(k, v), removeProperty: (k: string) => (set.delete(k), "") } };
};
const now = (run: () => void) => run();
const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};
beforeEach(() => {
  waiting = [];
  encoded = 0;
  pen = { putImageData: () => {} };
  forgetStage();
  class Picture {
    src = "";
    decode(): Promise<void> {
      return new Promise<void>((ok, fail) => void waiting.push({ ok, fail }));
    }
  }
  vi.stubGlobal("HTMLImageElement", Picture);
  vi.stubGlobal("Image", Picture);
  vi.stubGlobal("ImageData", class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => pen, toDataURL: () => `data:image/png;base64,PIC${++encoded}` }) });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test("DT-C264: a picture that could not be read is asked for again when the same look is applied again", async () => {
  const r = root();
  stagePicture(r, GLASS, now);
  waiting[0].fail();
  await settle();
  expect(r.set.has("--glass-stage")).toBe(false);
  stagePicture(r, GLASS, now);
  expect(encoded, "the same look, a second try").toBe(2);
  waiting[1].ok();
  await settle();
  expect(r.set.get("--glass-stage")).toBe('url("data:image/png;base64,PIC2")');
  // once it is on, the same look is left alone
  stagePicture(r, GLASS, now);
  expect(encoded).toBe(2);
});

test("DT-C264: a picture that could not be made is asked for again too, and a failure for an old look forgets nothing", async () => {
  const r = root();
  pen = null; // no canvas this time
  stagePicture(r, GLASS, now);
  expect(waiting.length).toBe(0);
  pen = { putImageData: () => {} };
  stagePicture(r, GLASS, now);
  expect(waiting.length, "asked again once a canvas is there").toBe(1);
  // the look moves on while that picture is being read; its failure must not forget the newer look
  stagePicture(r, { ...GLASS, "--glass-glow": "90%" }, now);
  waiting[0].fail();
  await settle();
  stagePicture(r, { ...GLASS, "--glass-glow": "90%" }, now);
  expect(waiting.length, "the newer look is still remembered: nothing new is asked").toBe(2);
});
