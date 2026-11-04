// VIEW-052 / SET-021 (T-268): how the left sidebar is painted. Three looks: the standard surface,
// the terminal's background, or a chosen tint laid over the standard surface at a chosen strength.
// Pure: theme.ts hands in the two colours it already works out and writes the result as
// `--sidebar-bg`, which styles.css reads for the left sidebar only (the source-control sidebar on the
// right keeps the standard surface).

export const SIDEBAR_LOOKS = ["standard", "terminal", "tinted"] as const;
export type SidebarLook = (typeof SIDEBAR_LOOKS)[number];

export const SIDEBAR_LABEL: Record<SidebarLook, string> = { standard: "Standard", terminal: "Match terminal", tinted: "Tinted" };

/** Strength in per cent: [lowest, highest, default]. */
export const STRENGTH_SPAN = [0, 100, 20] as const;
/** The tint a first choice of Tinted starts from (a calm blue). */
export const DEFAULT_TINT = "#4f6bed";
/** At 100 % the tint covers this much of the surface, so row text always keeps a ground it reads on. */
export const MAX_WASH = 0.8;
/** C23-R3-02: no ink from either palette reaches 4.5:1 on a mid grey. With `--fg-row` (the darkest
 *  light ink) a dark ground is legal only at or below the first value and a light ground only at or
 *  above the second, so a ground inside the band is moved to the nearer edge. The edges carry a
 *  margin over the exact crossover because a hued theme's `--fg-row` is a shade darker than Classic's. */
export const DEAD_BAND = [0.105, 0.29] as const;

export const sidebarLookOf = (v: unknown): SidebarLook => (SIDEBAR_LOOKS as readonly string[]).includes(v as string) ? (v as SidebarLook) : "standard";

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

/** WCAG 2 relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Whether a ground sits where neither palette's ink can read on it. */
export const inDeadBand = (hex: string): boolean => {
  const l = luminance(hex);
  return l > DEAD_BAND[0] && l < DEAD_BAND[1];
};

/** The nearest band edge, reached by walking the colour toward black or white (so the hue survives). */
function toBandEdge(hex: string): string {
  const l = luminance(hex);
  if (l <= DEAD_BAND[0] || l >= DEAD_BAND[1]) return hex;
  const dark = l < (DEAD_BAND[0] + DEAD_BAND[1]) / 2;
  const toward = dark ? "#000000" : "#ffffff";
  for (let step = 1; step <= 100; step++) {
    const out = mix(hex, toward, step / 100);
    const n = luminance(out);
    if (dark ? n <= DEAD_BAND[0] : n >= DEAD_BAND[1]) return out;
  }
  return toward;
}

/** The sidebar's background. Standard (and any look that cannot be worked out) is the standard
 *  surface token, so an untinted sidebar carries no colour of its own. A terminal ground inside the
 *  dead band cannot carry either palette's ink, so it falls back to the surface too. */
export function sidebarBackground(look: SidebarLook, tint: string, strength: number, surface: string, terminalBg: string | undefined): string {
  if (look === "terminal" && isHex(terminalBg)) return inDeadBand(terminalBg.toLowerCase()) ? "var(--surface)" : terminalBg.toLowerCase();
  if (look === "tinted" && isHex(tint) && isHex(surface)) {
    const s = Math.min(STRENGTH_SPAN[1], Math.max(STRENGTH_SPAN[0], strength));
    return toBandEdge(mix(surface.toLowerCase(), tint.toLowerCase(), (s / 100) * MAX_WASH));
  }
  return "var(--surface)";
}
