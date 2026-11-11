// DT-C264: the glass finish's stage, drawn once as a small picture.
//
// look/glass.css draws the stage as four pools of light and a wash: five see-through gradients the size of
// the window, laid over each other. A browser works that sum out again for every part of the window it
// redraws, and the stage is under all of it (and drawn a second time between the panes and in the Inbox),
// so every change of screen paid for it. The light never moves, so this file works the same sum out once,
// into a small picture the window stretches over itself, and hands glass.css that picture in place of the
// gradients. Showing a picture costs the same however it was made.
//
// The stylesheet's gradients stay the definition and the fallback: they are what draws until the picture is
// ready, where a picture cannot be made, and in the first frame of a start (index.html takes no url() from
// the saved look). STAGE_POOLS repeats their shapes; stage.test.ts keeps the two in step.
//
// Only the stage is a picture. A panel's depth (one more gradient, toward the window's own ground) was
// tried as one and is not: a web view that keeps pictures as eight bits per colour already multiplied by
// their opacity (WebKit) cannot hold a dark ground at a few per cent, and drew it in faint streaks.
import { POOL, WASH } from "./glass";

/** The pools as look/glass.css draws them: an ellipse (half-axes in hundredths of the window's width and
 *  height) about a point, which of the stage's lights it is (0 the metal, then its two neighbours), and its
 *  stops as [share of the pool's light, how far out along the ellipse]. The first is drawn over the rest. */
export const STAGE_POOLS: readonly { rx: number; ry: number; x: number; y: number; light: 0 | 1 | 2; stops: readonly (readonly [number, number])[] }[] = [
  { rx: 58, ry: 58, x: 10, y: 14, light: 0, stops: [[1, 0], [0.66, 0.26], [0.26, 0.5], [0, 0.7]] },
  { rx: 58, ry: 58, x: 92, y: 90, light: 1, stops: [[1, 0], [0.66, 0.26], [0.26, 0.5], [0, 0.7]] },
  { rx: 40, ry: 44, x: 92, y: 8, light: 2, stops: [[0.85, 0], [0.34, 0.4], [0, 0.7]] },
  { rx: 38, ry: 44, x: 6, y: 96, light: 2, stops: [[0.7, 0], [0.28, 0.4], [0, 0.7]] },
];

/** The picture's size. The stage is all slow slopes, so a small picture stretched over the window shows
 *  the same thing as the gradients (stage.test.ts compares the two sums). */
export const STAGE_SIZE = [240, 150] as const;

/** How a picture `n` cells across is stretched over a box of size `box` so that its first and last cells'
 *  centres land exactly on the box's edges: it is drawn a little larger than the box and centred, and the
 *  half cell that hangs over each side is cut off. A web view smooths between cell centres, and past the
 *  outermost centre some of them (WebKit) blend toward the opposite edge; drawn this way that part is never
 *  seen, and the picture's own edge values are the box's edge values. */
export const stretch = (box: string, n: number): string => `calc(${box} * ${n} / ${n - 1})`;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** How much of a pool's light there is `d` of the way out along its ellipse: straight lines between its
 *  stops, given flat as share, place, share, place and so on. */
function shareAt(stops: Float64Array, d: number): number {
  if (d <= stops[1]) return stops[0];
  for (let k = 2; k < stops.length; k += 2) {
    if (d <= stops[k + 1]) return stops[k - 2] + ((stops[k] - stops[k - 2]) * (d - stops[k - 1])) / (stops[k + 1] - stops[k - 1]);
  }
  return 0;
}

/** The stage as pixels (red, green, blue, opacity; not premultiplied), `w` by `h`, for the stage's lights
 *  (the metal first) and the glow (0 to 1). The same sum glass.css asks the browser for: the wash of the
 *  metal, then each pool over it. A cell's centre is a point of the window: the first cell's on its left
 *  (or top) edge, the last one's on the other (`stretch`). Each pool is worked out only over the cells it
 *  can reach, which is most of the saving: together the four reach under a whole window's worth. */
export function stagePixels(w: number, h: number, lights: readonly string[], glow: number): Uint8ClampedArray {
  const inks = [0, 1, 2].map((i) => rgb(lights[i] ?? lights[0]));
  // every cell starts as the wash (opacity is kept in levels, 0 to 255): one cell written, then copied over the rest
  const sum = new Float64Array(w * h * 4);
  sum.set([...inks[0], glow * WASH * 255]);
  for (let done = 4; done < sum.length; done *= 2) sum.copyWithin(done, 0, Math.min(done, sum.length - done));
  const clamp = (n: number, top: number) => Math.min(top, Math.max(0, n));
  // the last pool listed lies lowest, so it goes down first
  for (const p of [...STAGE_POOLS].reverse()) {
    const [r, g, b] = inks[p.light];
    const stops = Float64Array.from(p.stops.flat());
    const reach = stops[stops.length - 1];
    const i0 = clamp(Math.floor(((p.x - reach * p.rx) / 100) * (w - 1)), w - 1);
    const i1 = clamp(Math.ceil(((p.x + reach * p.rx) / 100) * (w - 1)), w - 1);
    const j0 = clamp(Math.floor(((p.y - reach * p.ry) / 100) * (h - 1)), h - 1);
    const j1 = clamp(Math.ceil(((p.y + reach * p.ry) / 100) * (h - 1)), h - 1);
    for (let j = j0; j <= j1; j++) {
      const dy = ((j / (h - 1)) * 100 - p.y) / p.ry;
      for (let i = i0; i <= i1; i++) {
        const dx = ((i / (w - 1)) * 100 - p.x) / p.rx;
        const d2 = dx * dx + dy * dy;
        if (d2 >= reach * reach) continue;
        const share = glow * POOL * shareAt(stops, Math.sqrt(d2));
        const at = (j * w + i) * 4;
        const over = share * 255;
        const under = sum[at + 3] * (1 - share);
        const all = over + under;
        if (all <= 0) continue;
        sum[at] = (r * over + sum[at] * under) / all;
        sum[at + 1] = (g * over + sum[at + 1] * under) / all;
        sum[at + 2] = (b * over + sum[at + 2] * under) / all;
        sum[at + 3] = all;
      }
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  out.set(sum); // rounds each value to the nearest whole level
  return out;
}

type Root = { style: { setProperty(name: string, value: string): void; removeProperty?(name: string): string } };

/** A picture can be made and shown only where there is a canvas to encode it and a way to wait until the
 *  picture can be drawn at once (no test window has either). */
const able = (): boolean =>
  typeof document !== "undefined" && typeof HTMLImageElement !== "undefined" && typeof HTMLImageElement.prototype.decode === "function" && typeof ImageData !== "undefined";

function encode(pixels: Uint8ClampedArray, w: number, h: number): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const pen = canvas.getContext("2d");
  if (!pen) return null;
  pen.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  const url = canvas.toDataURL("image/png");
  return url.startsWith("data:image/png") ? url : null;
}

const HEX = /^#[0-9a-f]{6}$/i;
const NAMES = ["--glass-stage", "--glass-stage-size"] as const;
let wanted = new WeakMap<object, string>(); // per root: the lights and glow its newest picture is for ("" while flat)

/** When the picture is made: once the window has nothing better to do, so that a start, or a drag of the
 *  strength slider, never waits on it. The gradients draw until then. */
const whenIdle = (run: () => void): void => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 400 });
  else setTimeout(run, 60);
};

/** Puts the stage's picture on `root` for the look values just written there (`vars`), or takes it off when
 *  those hold no glass. A change of colour or strength takes the old picture off at once, so the
 *  stylesheet's gradients draw the new light straight away; the new picture is made when the window is
 *  idle (`later`), only for the look that is still wanted by then, and replaces the gradients once it can
 *  be drawn. Its size goes in a value of its own, because glass.css also names the stage inside a list of
 *  pictures, where a size cannot travel with it. */
export function stagePicture(root: Root, vars: Record<string, string>, later: (run: () => void) => void = whenIdle): void {
  const lights = [vars["--glass-tint"], vars["--glass-mate"], vars["--glass-third"]];
  const key = lights[0] ? [...lights, vars["--glass-glow"]].join(" ") : "";
  if (key === (wanted.get(root) ?? "")) return;
  wanted.set(root, key);
  for (const name of NAMES) root.style.removeProperty?.(name);
  if (!key || !able() || !lights.every((c) => HEX.test(c ?? ""))) return;
  const glow = parseFloat(vars["--glass-glow"]) / 100;
  // A picture that could not be made or read is forgotten, so the same look asks again the next time it is
  // applied; otherwise one failure would leave that look on the gradients for as long as the window lives.
  const failed = () => void (wanted.get(root) === key && wanted.delete(root));
  later(() => {
    if (wanted.get(root) !== key) return; // the look moved on before the window was idle: nothing is made for this one
    const [w, h] = STAGE_SIZE;
    let url: string | null = null;
    try {
      url = encode(stagePixels(w, h, lights, glow), w, h);
    } catch {
      /* no picture: the gradients stay */
    }
    if (!url) return failed();
    const src = url;
    const img = new Image();
    img.src = src;
    void img.decode().then(() => {
      if (wanted.get(root) !== key) return; // the look changed while this one was being read
      root.style.setProperty("--glass-stage", `url("${src}")`);
      root.style.setProperty("--glass-stage-size", `${stretch("100vw", w)} ${stretch("100vh", h)}`);
    }, failed);
  });
}

/** For tests: forget what was last drawn. */
export const forgetStage = (): void => void (wanted = new WeakMap());
