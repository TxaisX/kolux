// DT-C264: the glass stage as one picture. The stylesheet's gradients are the definition; these tests hold
// the picture to them, and hold the hand-over (when the picture goes on the window and when it comes off).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { POOL, WASH } from "./glass";
import { applyAppearance, readAppearance } from "../theme";
import { forgetStage, STAGE_POOLS, STAGE_SIZE, stagePicture, stagePixels, stretch } from "./stage";

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: string, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync("src/look/glass.css", "utf8");
const LIGHTS = ["#4f7fe0", "#8a5fe0", "#4fb7e0"];
const GLASS = { "--glass-tint": LIGHTS[0], "--glass-mate": LIGHTS[1], "--glass-third": LIGHTS[2], "--glass-glow": "64%" };
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test("DT-C264: the picture's pools are the stylesheet's pools: the same ellipses, lights and stops", () => {
  const stage = css.match(/--glass-stage:([^;]+);/)![1];
  const drawn = [...stage.matchAll(/radial-gradient\(ellipse ([0-9.]+)vw ([0-9.]+)vh at ([0-9.]+)% ([0-9.]+)%, ([^]*?transparent [0-9.]+%)\)/g)].map((m) => {
    const light = "abc".indexOf(m[5].match(/--glass-([abc])\)/)![1]);
    // a stop is the pool's light whole or thinned to a share, at a place along the ellipse (the first at 0)
    const stops = [...m[5].matchAll(/(?:color-mix\(in srgb, var\(--glass-[abc]\) ([0-9.]+)%, transparent\)|var\(--glass-[abc]\)|(transparent))(?: ([0-9.]+)%)?/g)].map((s) => [s[2] ? 0 : s[1] ? Number(s[1]) / 100 : 1, s[3] ? Number(s[3]) / 100 : 0]);
    return { rx: Number(m[1]), ry: Number(m[2]), x: Number(m[3]), y: Number(m[4]), light, stops };
  });
  expect(drawn.length).toBe(4);
  expect(drawn).toEqual(STAGE_POOLS.map((p) => ({ ...p, stops: p.stops.map((s) => [...s]) })));
});

test("DT-C264: the picture is the wash everywhere, one pool's light over it at a pool's centre, and never more than that", () => {
  const [w, h] = [201, 101];
  const glow = 0.64;
  const px = stagePixels(w, h, LIGHTS, glow);
  // the cell whose centre is nearest a point of the window (cell centres run edge to edge)
  const at = (xPct: number, yPct: number) => {
    const i = Math.min(w - 1, Math.max(0, Math.round((xPct / 100) * (w - 1))));
    const j = Math.min(h - 1, Math.max(0, Math.round((yPct / 100) * (h - 1))));
    return [...px.slice((j * w + i) * 4, (j * w + i) * 4 + 4)];
  };
  // the middle of the window is outside every pool: the wash alone, in the metal's colour
  const mid = at(50, 50);
  expect(mid.slice(0, 3)).toEqual(rgb(LIGHTS[0]));
  expect(mid[3]).toBe(Math.round(glow * WASH * 255));
  // at a pool's centre: that pool's share of its light over the wash, as the stylesheet lays them down
  for (const p of STAGE_POOLS) {
    const got = at(p.x, p.y);
    const pa = glow * POOL * p.stops[0][0];
    const all = pa + glow * WASH * (1 - pa);
    expect(Math.abs(got[3] - all * 255), `opacity at ${p.x} ${p.y}`).toBeLessThanOrEqual(4);
    const want = rgb(LIGHTS[p.light]).map((c, k) => (c * pa + rgb(LIGHTS[0])[k] * glow * WASH * (1 - pa)) / all);
    for (let k = 0; k < 3; k++) expect(Math.abs(got[k] - want[k]), `colour at ${p.x} ${p.y}`).toBeLessThanOrEqual(4);
  }
  // nowhere is the stage stronger than the wash under one whole pool: what text is matched to (glassGrounds)
  const most = Math.ceil((glow * POOL + glow * WASH * (1 - glow * POOL)) * 255);
  for (let i = 3; i < px.length; i += 4) expect(px[i]).toBeLessThanOrEqual(most);
  // and a pool has gone by the end of its last stop
  const a = STAGE_POOLS[0];
  expect(at(a.x + a.rx * 0.72, a.y)[3]).toBe(Math.round(glow * WASH * 255));
});

test("DT-C264: a stronger glow is a stronger picture, and no glow is an empty one", () => {
  const sum = (glow: number) => stagePixels(40, 25, LIGHTS, glow).reduce((n, v, i) => (i % 4 === 3 ? n + v : n), 0);
  expect(sum(0)).toBe(0);
  expect(sum(0.9)).toBeGreaterThan(sum(0.25));
});

test("DT-C264: the Inbox's two sheets are the plainest glass: the fill, edge lines as strips of background in the inks the shadow lines use, no depth and no shadow", () => {
  const bare = css.replace(/\/\*[^]*?\*\//g, "");
  const dark = bare.match(/:root\[data-finish="glass"\] \{([^}]*)\}/)![1];
  const light = bare.match(/:root\[data-finish="glass"\]\[data-mode="light"\] \{([^}]*)\}/)![1];
  // one definition of each line's ink, read by the shadow form and by the strip form
  expect(dark).toMatch(/--glass-spec: inset 0 1px 0 var\(--glass-spec-top\), inset 1px 0 0 var\(--glass-spec-side\);/);
  expect(dark).toMatch(/--glass-shade: inset 0 -1px 0 var\(--glass-shade-ink\);/);
  const rim = dark.match(/--glass-rim:([^;]+);/)![1].replace(/\s+/g, " ").trim();
  expect(rim).toBe(
    "linear-gradient(var(--glass-spec-top), var(--glass-spec-top)) 0 0 / 100% 1px no-repeat, " +
      "linear-gradient(var(--glass-spec-side), var(--glass-spec-side)) 0 0 / 1px 100% no-repeat, " +
      "linear-gradient(var(--glass-shade-ink), var(--glass-shade-ink)) 0 100% / 100% 1px no-repeat",
  );
  // light mode changes the inks, never the two forms, so the two cannot drift apart
  for (const ink of ["--glass-spec-top", "--glass-spec-side", "--glass-shade-ink"]) expect(light, ink).toMatch(new RegExp(`${ink}: [^;]+;`));
  expect(light).not.toMatch(/--glass-(spec|shade|rim):/);
  const sheets = bare.split("}").map((r) => r.trim()).find((r) => /\.inbox \.list,\s*:root\[data-finish="glass"\] \.inbox \.detail \{/.test(r))!;
  expect(sheets).toMatch(/background: var\(--glass-rim\), var\(--glass-fill\);/);
  expect(sheets).toMatch(/box-shadow: none;/);
  // the text there stands on the fill over the stage, a ground it is already matched to (glassGrounds): nothing is laid over it
  expect(sheets).not.toMatch(/--glass-(depth|stage|a|b|c)\b|--metal-hi/);
});

test("DT-C265: a picker is too large to frost: the one blur rule leaves it out, and it is a solid sheet with the glass edges", () => {
  const bare = css.replace(/\/\*[^]*?\*\//g, "");
  const rules = bare.split("}").map((r) => r.trim()).filter(Boolean);
  const blurred = rules.filter((r) => /backdrop-filter/.test(r));
  expect(blurred.length, "still one blur rule, and the picker's own rule names no blur at all").toBe(1);
  const frosted = blurred[0].slice(0, blurred[0].indexOf("{")).split(",").map((x) => x.trim());
  expect(frosted, "a plain menu is frosted, a picker is not").toContain(':root[data-finish="glass"] .menu:not(.note-picker)');
  expect(frosted.some((x) => /\.menu$/.test(x) || /\.palette|\.note-picker$/.test(x))).toBe(false);
  const picker = rules.find((r) => r.startsWith(':root[data-finish="glass"] .menu.note-picker {'))!;
  // its ground is the fill itself, solid: the first of the grounds text is matched to
  expect(picker).toMatch(/background: var\(--glass-head\);/);
  expect(picker).toMatch(/box-shadow: var\(--glass-spec\), var\(--glass-float\);/);
});

// ---- the hand-over, with a canvas and a picture that can be waited for standing in (tests have no window) ----
type Waiting = { ok: () => void; fail: () => void };
let waiting: Waiting[] = [];
let encoded = 0;
let pen: { putImageData(): void } | null = { putImageData: () => {} };
let sized: number[] = [];
const root = () => {
  const set = new Map<string, string>();
  return { set, style: { setProperty: (k: string, v: string) => void set.set(k, v), removeProperty: (k: string) => (set.delete(k), "") } };
};
class Picture {
  src = "";
  decode(): Promise<void> {
    return new Promise<void>((ok, fail) => void waiting.push({ ok, fail }));
  }
}
const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};
const PIC = (n: number) => `url("data:image/png;base64,PIC${n}")`;
/** Stands in for "when the window is idle": at once, or (below) kept until the test lets it run. */
const now = (run: () => void) => run();

beforeEach(() => {
  waiting = [];
  encoded = 0;
  sized = [];
  pen = { putImageData: () => {} };
  forgetStage();
  vi.stubGlobal("HTMLImageElement", Picture);
  vi.stubGlobal("Image", Picture);
  vi.stubGlobal("ImageData", class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) { sized.push(data.length, width, height); } });
  vi.stubGlobal("requestIdleCallback", (run: () => void) => run());
  vi.stubGlobal("document", { documentElement: { dataset: {} }, createElement: () => ({ width: 0, height: 0, getContext: () => pen, toDataURL: () => `data:image/png;base64,PIC${++encoded}` }) });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test("DT-C264: the picture goes on the window only once it can be drawn, as --glass-stage with its own size", async () => {
  const r = root();
  stagePicture(r, GLASS, now);
  expect([...r.set.keys()], "the gradients draw until then").toEqual([]);
  expect(waiting.length).toBe(1);
  waiting[0].ok();
  await settle();
  expect(r.set.get("--glass-stage")).toBe(PIC(1));
  // drawn a half cell past the window on every side, so its outermost cell centres are the window's edges
  expect(r.set.get("--glass-stage-size")).toBe(`calc(100vw * ${STAGE_SIZE[0]} / ${STAGE_SIZE[0] - 1}) calc(100vh * ${STAGE_SIZE[1]} / ${STAGE_SIZE[1] - 1})`);
  expect(stretch("100%", 5)).toBe("calc(100% * 5 / 4)");
  expect(sized, "the picture is drawn at its own small size").toEqual([STAGE_SIZE[0] * STAGE_SIZE[1] * 4, ...STAGE_SIZE]);
  expect(STAGE_SIZE[0] * STAGE_SIZE[1]).toBeLessThanOrEqual(60_000);
});

test("DT-C264: the same look again draws nothing again", async () => {
  const r = root();
  stagePicture(r, GLASS, now);
  waiting[0].ok();
  await settle();
  stagePicture(r, { ...GLASS }, now);
  expect(encoded).toBe(1);
  expect(r.set.get("--glass-stage")).toBe(PIC(1));
});

test("DT-C264: a change of colour or strength takes the old picture off at once, and a picture that arrives late is dropped", async () => {
  const r = root();
  stagePicture(r, GLASS, now);
  waiting[0].ok();
  await settle();
  stagePicture(r, { ...GLASS, "--glass-glow": "90%" }, now);
  expect([...r.set.keys()], "the gradients show the new light straight away").toEqual([]);
  stagePicture(r, { ...GLASS, "--glass-tint": "#d4a23a" }, now);
  expect(waiting.length).toBe(3);
  waiting[1].ok(); // the 90 % picture, now out of date
  await settle();
  expect([...r.set.keys()]).toEqual([]);
  waiting[2].ok();
  await settle();
  expect(r.set.get("--glass-stage")).toBe(PIC(3));
});

test("DT-C264: Flat takes the picture and its size off, and a picture that cannot be read leaves the gradients", async () => {
  const r = root();
  stagePicture(r, GLASS, now);
  waiting[0].ok();
  await settle();
  stagePicture(r, { "--app-bg": "#050405" }, now);
  expect([...r.set.keys()]).toEqual([]);
  expect(encoded).toBe(1);
  stagePicture(r, GLASS, now);
  waiting[1].fail();
  await settle();
  expect([...r.set.keys()]).toEqual([]);
});

test("DT-C264: applying a look hands its own values over, and the picture never reaches the saved look", async () => {
  const r = root();
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", { setItem: (k: string, v: string) => void saved.set(k, v), getItem: (k: string) => saved.get(k) ?? null });
  vi.stubGlobal("window", { dispatchEvent: () => true });
  vi.stubGlobal("Event", class { constructor(public type: string) {} });
  applyAppearance(readAppearance({}), r);
  expect(waiting.length, "the default look is glass").toBe(1);
  waiting[0].ok();
  await settle();
  expect(r.set.get("--glass-stage")).toBe(PIC(1));
  expect([...saved.values()].join(""), "index.html takes no url() from the saved look, and is never offered one").not.toMatch(/url\(|data:/);
  applyAppearance(readAppearance({ appFinish: "flat" }), r);
  expect([...r.set.keys()].filter((k) => k.startsWith("--glass-stage"))).toEqual([]);
});

test("DT-C264: the picture is made when the window is idle, and only for the look still wanted by then", async () => {
  const r = root();
  const idle: (() => void)[] = [];
  const later = (run: () => void) => void idle.push(run);
  // a drag of the strength slider: five looks before the window is idle once
  for (const glow of ["60%", "62%", "64%", "66%", "68%"]) stagePicture(r, { ...GLASS, "--glass-glow": glow }, later);
  expect(encoded, "nothing is drawn while the looks keep coming").toBe(0);
  expect(idle.length).toBe(5);
  for (const run of idle) run();
  expect(encoded, "one picture, for the last look").toBe(1);
  waiting[0].ok();
  await settle();
  expect(r.set.get("--glass-stage")).toBe(PIC(1));
  // with no idle callback in the web view, a short timer stands in
  vi.unstubAllGlobals();
  vi.stubGlobal("HTMLImageElement", Picture);
  vi.stubGlobal("Image", Picture);
  vi.stubGlobal("ImageData", class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => pen, toDataURL: () => `data:image/png;base64,PIC${++encoded}` }) });
  vi.useFakeTimers();
  try {
    stagePicture(r, { ...GLASS, "--glass-glow": "70%" });
    expect(encoded).toBe(1);
    vi.advanceTimersByTime(100);
    expect(encoded).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test("DT-C264: each window root is remembered on its own", async () => {
  const [a, b] = [root(), root()];
  stagePicture(a, GLASS, now);
  stagePicture(b, GLASS, now);
  expect(waiting.length, "the same look on another root is drawn for that root").toBe(2);
  waiting[0].ok();
  waiting[1].ok();
  await settle();
  expect(a.set.get("--glass-stage")).toBe(PIC(1));
  expect(b.set.get("--glass-stage")).toBe(PIC(2));
});

test("DT-C264: where no picture can be made the gradients stay (no canvas, a colour that is not a plain hex, no way to wait)", () => {
  const r = root();
  pen = null;
  stagePicture(r, GLASS, now);
  expect(waiting.length).toBe(0);
  expect(r.set.has("--glass-stage")).toBe(false);
  pen = { putImageData: () => {} };
  forgetStage();
  stagePicture(r, { ...GLASS, "--glass-mate": "rebeccapurple" }, now);
  expect(waiting.length).toBe(0);
  vi.stubGlobal("HTMLImageElement", class {});
  forgetStage();
  stagePicture(r, GLASS, now);
  expect(waiting.length).toBe(0);
  expect(r.set.has("--glass-stage"), "a window that cannot wait for a picture never gets one").toBe(false);
  vi.unstubAllGlobals();
  forgetStage();
  stagePicture(r, GLASS, now);
  expect(r.set.has("--glass-stage"), "and neither does a place with no window at all").toBe(false);
});

test("DT-C264: wherever the stylesheet draws the stage it is stretched over the window and never repeated", () => {
  const bare = css.replace(/\/\*[^]*?\*\//g, "");
  const rule = bare.match(/([^{}]+)\{\s*background-size: var\(--glass-stage-size, 100vw 100vh\); background-position: 50% 50%; background-repeat: no-repeat;\s*\}/)!;
  const on = rule[1].split(",").map((s) => s.trim());
  // every rule that draws the stage (by its own name or as the gap between panes) is one of these
  const rules = bare.split("}").map((r) => r.trim()).filter(Boolean);
  const draws = rules.filter((r) => /background(-image)?:[^;]*var\(--glass-(stage|gap)\)/.test(r)).flatMap((r) => r.slice(0, r.indexOf("{")).split(",").map((s) => s.trim()));
  expect(draws.length).toBeGreaterThanOrEqual(4);
  for (const sel of draws) expect(on, sel).toContain(sel);
});
