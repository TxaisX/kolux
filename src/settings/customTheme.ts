// T-648 (DT-C87): the user's own themes. A custom theme is a built-in theme (`base`) plus the colours the
// user changed (`overrides`, token name to #rrggbb) and, optionally, terminal colours (`terminal`, xterm
// key to #rrggbb). Anything not listed falls back to the base, so a theme can never leave a colour
// undefined. This file is in the first-load bundle (theme.ts reads it), so it stays small: the editor,
// the file format with its strict checks, and the contrast helpers are in the files beside it.

export type CustomTheme = { name: string; base: string; overrides: Record<string, string>; terminal: Record<string, string> };

export const HEX = /^#[0-9a-f]{6}$/i;
export const NAME_MAX = 40;
export const MAX_THEMES = 24;
const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
/** The terminal colours a theme may set: text, ground, cursor, selection and the 16 palette slots. */
export const TERMINAL_KEYS = ["foreground", "background", "cursor", "selectionBackground", ...ANSI, ...ANSI.map((c) => "bright" + c[0].toUpperCase() + c.slice(1))];

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** `a` moved `t` (0 to 1) of the way to `b`. */
export const mix = (a: string, b: string, t: number): string => "#" + rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, "0")).join("");
/** WCAG relative luminance, 0 (black) to 1 (white). */
export const luminance = (h: string): number => {
  const [r, g, b] = rgb(h).map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** A ground this light or darker than the middle grey counts as dark (the colour scheme of the window). */
export const isDarkGround = (h: string) => luminance(h) < 0.18;

const pick = (v: unknown, keys: readonly string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v))
    for (const k of keys) {
      const c = (v as Record<string, unknown>)[k];
      if (typeof c === "string" && HEX.test(c.trim())) out[k] = c.trim().toLowerCase();
    }
  return out;
};

/** The saved list as a clean list: unknown keys and bad colours dropped, a name that repeats (any case) or
 *  is empty skipped, an unknown base is Classic, at most MAX_THEMES. Never throws. */
export function tidyThemes(v: unknown, bases: readonly string[], tokens: readonly string[]): CustomTheme[] {
  const out: CustomTheme[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, NAME_MAX) : "";
    if (!name || out.some((t) => t.name.toLowerCase() === name.toLowerCase()) || out.length >= MAX_THEMES) continue;
    const base = typeof r.base === "string" && bases.includes(r.base.toLowerCase()) ? r.base.toLowerCase() : "classic";
    out.push({ name, base, overrides: pick(r.overrides, tokens), terminal: pick(r.terminal, TERMINAL_KEYS) });
  }
  return out;
}

/** The ground, panel and text colours the rest of the chrome is mixed from. */
const family = (B: string, S: string, T: string, M: string): Record<string, string> => ({
  "app-bg": B, "strip-bg": B, "pane-bg": mix(B, S, 0.4), "input-bg": mix(B, S, 0.6), surface: S,
  "chip-bg": mix(S, T, 0.06), "kbd-bg": mix(S, T, 0.1), "kbd-border": mix(S, T, 0.18),
  "line-subtle": mix(S, T, 0.05), "line-inner": mix(S, T, 0.04), line: mix(S, T, 0.08), "line-strong": mix(S, T, 0.12), "line-focus": mix(S, T, 0.2),
  "tab-track": mix(S, T, 0.08), "tab-track-border": mix(S, T, 0.14), "row-selected": mix(S, T, 0.1), "button-border": mix(S, T, 0.1),
  "seg-active": mix(S, T, 0.25), "gauge-track": mix(S, T, 0.06),
  fg: T, "fg-row": mix(T, M, 0.3), mark: mix(T, M, 0.5), "fg-muted": M, "fg-nav": mix(M, B, 0.04), "fg-label": mix(M, B, 0.3),
  "fg-faint": mix(M, B, 0.4), "fg-icon-dim": mix(M, B, 0.6), "fg-disabled": mix(M, B, 0.7),
});

/** `base` (a built-in theme's tokens) with the user's changes on top. Changing the background, panel or
 *  text colour re-mixes the borders and the other greys from the new three, so one pick restyles the
 *  window; a token the user set itself always wins over the mix. Status colours stay as the base has them. */
export function customTokens<T extends Record<string, string>>(base: T, ov: Record<string, string>): T {
  const out: Record<string, string> = { ...base };
  if (ov["app-bg"] || ov.surface || ov.fg) {
    const B = ov["app-bg"] ?? base["app-bg"], T = ov.fg ?? base.fg;
    Object.assign(out, family(B, ov.surface ?? base.surface, T, ov["fg-muted"] ?? mix(T, B, 0.4)));
  }
  if (ov.accent) out.accent = out.link = ov.accent;
  return { ...out, ...ov } as T;
}
