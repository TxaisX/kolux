// DT-C249: the glass and metal finish. On unless Flat is chosen (Settings > Appearance > Finish). The
// chrome's panels are see-through over a still stage of light in a colour the user picks, and every edge
// catches that light; look/glass.css draws all of it from the values this file works out. Pure: theme.ts
// hands in the palette it already built and writes the result on the document root with the other look values.
//
// The one promise here is about reading. A panel's ground is its own fill over whatever the stage puts
// behind it, so it is no longer the flat surface the text colours were chosen for. `glassGrounds` lists
// every ground a row of text can land on, and theme.ts moves each text colour only as far as it must go to
// keep, on each of them, the best ratio it had on the flat look (up to 4.5:1; 3:1 for icons).
import { luminance } from "./sidebar";

export type Finish = "flat" | "glass";
/** Glass unless Flat was chosen: nothing saved, or a value this version does not know, is the glass look. */
export const finishOf = (v: unknown): Finish => (v === "flat" ? "flat" : "glass");

/** Strength in per cent: [lowest, highest, default]. */
export const GLASS_SPAN = [0, 100, 60] as const;
/** The metal a first start draws with (sapphire). */
export const DEFAULT_METAL = "#4f7fe0";
/** How much of a panel is its own fill, at strength 0 and at 100. The rest is what shows through. */
export const SOLID = [0.92, 0.52] as const;
/** How strong the stage's light is at its brightest point, at strength 0 and at 100. */
export const GLOW = [0.25, 0.9] as const;
/** How much of the metal's hue a panel's own fill takes. The hue is brought to the surface's own
 *  brightness first (`castOf`), so the fill changes colour, not how light it is. */
export const CAST = 0.4;
/** The stage's light at any point is a thin wash of the metal and at most one pool of light over it; these
 *  are their shares of the glow (glass.css draws them, glass.test.ts keeps the two in step). */
export const WASH = 0.2;
export const POOL = 0.8;
/** The text colours a panel can carry, and the icon and dot colours (which need 3:1, not 4.5:1). */
export const GLASS_TEXT = ["fg", "fg-row", "fg-muted", "fg-nav", "fg-label", "fg-faint", "fg-disabled", "mark", "link", "working", "done", "gauge-text", "warn", "danger", "status-bad", "cost-fg"] as const;
export const GLASS_ICONS = ["fg-icon-dim", "working-icon", "done-icon"] as const;
export const TEXT_BAR = 4.5;
export const ICON_BAR = 3;

type Palette = Record<"app-bg" | "surface", string>;

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

/** How solid a panel is and how strong the stage's light is, for a strength in per cent. */
export function glassLevels(strength: number): { solid: number; glow: number } {
  const k = Math.min(GLASS_SPAN[1], Math.max(GLASS_SPAN[0], strength)) / 100;
  return { solid: SOLID[0] + (SOLID[1] - SOLID[0]) * k, glow: GLOW[0] + (GLOW[1] - GLOW[0]) * k };
}

/** The metal's hue at the surface's own brightness: walked toward black or white until it gets there. */
export function castOf(tint: string, surface: string): string {
  const want = luminance(surface);
  const down = luminance(tint) > want;
  for (let step = 0; step <= 100; step++) {
    const out = mix(tint, down ? "#000000" : "#ffffff", step / 100);
    if (down ? luminance(out) <= want : luminance(out) >= want) return out;
  }
  return surface;
}

/** A panel's own fill: the surface with the metal's hue in it. */
export const glassFill = (tint: string, surface: string) => mix(surface, castOf(tint, surface), CAST);

/** The stage where one of its lights is brightest, as glass.css lays it down: the window's own ground,
 *  the wash of the metal, then that light's pool. */
function stageAt(t: Palette, tint: string, light: string, glow: number): string {
  return mix(mix(t["app-bg"], tint, glow * WASH), light, glow * POOL);
}

/** The ground a row of text lands on where the metal's own light is brightest: the panel's fill over it. */
export function glassGround(t: Palette, tint: string, strength: number): string {
  const { solid, glow } = glassLevels(strength);
  return mix(stageAt(t, tint, tint, glow), glassFill(tint, t.surface), solid);
}

/** Every ground the glass can put under text. `lights` are the stage's colours, the metal first. The stage
 *  is the window's own ground, bare or under one light at its brightest (the pools never overlap,
 *  glass.test.ts); over it lies a panel's fill, or the window's ground again where text used to sit on
 *  that (the work area, the tiles the panes sit in); and a pane's header is the fill itself, solid. */
export function glassGrounds(t: Palette, lights: readonly string[], strength: number): string[] {
  const { solid, glow } = glassLevels(strength);
  const fill = glassFill(lights[0], t.surface);
  return [fill, ...[t["app-bg"], ...lights.map((c) => stageAt(t, lights[0], c, glow))].flatMap((stage) => [mix(stage, fill, solid), mix(stage, t["app-bg"], solid)])];
}

const pct = (v: number) => Math.round(v * 100) + "%";

/** The values look/glass.css reads. `side` is the left sidebar's own ground: a sidebar with a look of its
 *  own (tinted, or the terminal's colour) keeps that ground solid, because its text was matched to it.
 *  `lights` are the stage's colours, the metal first, then its two neighbours. */
export function glassVars(strength: number, t: Palette, side: string, lights: readonly string[]): Record<string, string> {
  const { solid, glow } = glassLevels(strength);
  const fill = glassFill(lights[0], t.surface);
  const glass = `color-mix(in srgb, ${fill} ${pct(solid)}, transparent)`;
  return {
    "--glass-tint": lights[0],
    "--glass-mate": lights[1] ?? lights[0],
    "--glass-third": lights[2] ?? lights[0],
    "--glass-glow": pct(glow),
    "--glass-fill": glass,
    "--glass-side": side.startsWith("#") ? side : glass,
    // Where text used to sit on the window's own ground (the work area, the right panel): the same share
    // of that ground, so text there is never on the bare stage.
    "--glass-well": `color-mix(in srgb, ${t["app-bg"]} ${pct(solid)}, transparent)`,
    // A pane's header: the fill itself, solid, because a terminal's frame is never see-through.
    "--glass-head": fill,
  };
}
