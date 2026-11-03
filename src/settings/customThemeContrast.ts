// T-648: the contrast warning. WCAG 2 ratio between two colours; 4.5 is the AA bar for body text.
import { mix } from "../theme";
import { luminance } from "./customTheme";

export const AA = 4.5;
/** 1 (same colour) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** The ratio as shown to the user: one decimal, rounded down so 4.46 never reads as 4.5. */
export const ratioText = (r: number) => (Math.floor(r * 10) / 10).toFixed(1);

/** `fg` nudged toward white or black (whichever reads better on the grounds) in small steps until it
 *  reaches `target` on every ground; `fg` itself when it already does. */
export function nudgeToContrast(fg: string, grounds: readonly string[], target = AA): string {
  const ok = (c: string) => grounds.every((g) => contrast(c, g) >= target);
  if (ok(fg)) return fg;
  const end = grounds.reduce((n, g) => n + (luminance(g) > 0.18 ? -1 : 1), 0) > 0 ? "#ffffff" : "#000000";
  for (let t = 0.02; t < 1; t += 0.02) {
    const c = mix(fg, end, t);
    if (ok(c)) return c;
  }
  return end;
}

export type Pair = { id: string; label: string; fg: string; ground: string };
/** The pairs worth a chip: text on the background, text on panels, muted text on panels. */
export const pairsOf = (t: Record<string, string>): Pair[] => [
  { id: "fg", label: "Text on background", fg: t.fg, ground: t["app-bg"] },
  { id: "fg-surface", label: "Text on panels", fg: t.fg, ground: t.surface },
  { id: "fg-muted", label: "Muted text on panels", fg: t["fg-muted"], ground: t.surface },
];
