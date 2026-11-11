// DT-C249: the glass and metal finish. Off unless chosen (Settings > Appearance > Finish). With it on, the
// chrome's panels turn translucent over a soft glow in a colour the user picks, and edges get a metal lip;
// look/glass.css draws all of it from the values this file works out. Pure: theme.ts hands in the palette
// it already built and writes the result on the document root with the other look values.
//
// The one promise here is about reading. A panel's ground is its own fill over whatever the glow puts
// behind it, so it is no longer the flat surface the text colours were chosen for. `glassGround` is that
// ground where the glow is brightest, and theme.ts moves each text colour only as far as it must go to
// keep, on that ground, the ratio it had on the flat surface (up to 4.5:1; 3:1 for icons).
import { luminance } from "./sidebar";

export type Finish = "flat" | "glass";
export const finishOf = (v: unknown): Finish => (v === "glass" ? "glass" : "flat");

/** Strength in per cent: [lowest, highest, default]. */
export const GLASS_SPAN = [0, 100, 60] as const;
/** The metal a first choice of the finish starts from (steel). */
export const DEFAULT_METAL = "#8fa3bf";
/** How much of a panel is its own fill, at strength 0 and at 100. The rest is what shows through. */
export const SOLID = [0.92, 0.62] as const;
/** How strong the glow behind the panels is at its brightest point, at strength 0 and at 100. */
export const GLOW = [0.08, 0.45] as const;
/** How much of the metal's hue a panel's own fill takes. The hue is brought to the surface's own
 *  brightness first (`castOf`), so the fill changes colour, not how light it is. */
export const CAST = 0.4;
/** The text colours a panel can carry, and the icon and dot colours (which need 3:1, not 4.5:1). */
export const GLASS_TEXT = ["fg", "fg-row", "fg-muted", "fg-nav", "fg-label", "fg-faint", "fg-disabled", "mark", "link", "working", "done", "gauge-text", "warn", "danger", "cost-fg"] as const;
export const GLASS_ICONS = ["fg-icon-dim", "working-icon", "done-icon"] as const;
export const TEXT_BAR = 4.5;
export const ICON_BAR = 3;

type Palette = Record<"app-bg" | "surface", string>;

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

/** How solid a panel is and how strong the glow is, for a strength in per cent. */
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

/** The ground a row of text can land on: the panel's fill over the glow at its brightest. */
export function glassGround(t: Palette, tint: string, strength: number): string {
  const { solid, glow } = glassLevels(strength);
  return mix(mix(t["app-bg"], tint, glow), glassFill(tint, t.surface), solid);
}

const pct = (v: number) => Math.round(v * 100) + "%";

/** The values look/glass.css reads. `side` is the left sidebar's own ground: a sidebar with a look of its
 *  own (tinted, or the terminal's colour) keeps that ground solid, because its text was matched to it. */
export function glassVars(tint: string, strength: number, t: Palette, side: string): Record<string, string> {
  const { solid, glow } = glassLevels(strength);
  const fill = glassFill(tint, t.surface);
  return {
    "--glass-tint": tint,
    "--glass-glow": pct(glow),
    "--glass-fill": `color-mix(in srgb, ${fill} ${pct(solid)}, transparent)`,
    "--glass-side": side.startsWith("#") ? side : `color-mix(in srgb, ${fill} ${pct(solid)}, transparent)`,
    // Where text used to sit on the window's own ground (the work area, the right panel): the same share
    // of that ground, so text there is never on the bare glow.
    "--glass-well": `color-mix(in srgb, ${t["app-bg"]} ${pct(solid)}, transparent)`,
  };
}
