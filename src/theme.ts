// The Classic theme: the neutral palette measured in design/DESIGN.md section 2, as named tokens.
// They become CSS custom properties on the document root (styles.css reads them as var(--name))
// and feed the terminal theme, so every colour has one home. The 16 hued themes come with SET-001.

import type { ITheme } from "@xterm/xterm";
import { fontStack } from "./settings/fonts";
import { CATALOGUE, tidySchemes, type CustomScheme } from "./terminal/schemes";
import { customTokens, isDarkGround, mix, tidyThemes, type CustomTheme } from "./settings/customTheme";
import { DEFAULT_TINT, STRENGTH_SPAN, sidebarBackground, sidebarLookOf, type SidebarLook } from "./look/sidebar";

export const classic = {
  // surfaces and lines
  "app-bg": "#050405",
  "strip-bg": "#0a0a0a",
  "pane-bg": "#0d0d0d",
  "input-bg": "#0f0f0f",
  surface: "#171717",
  "chip-bg": "#1d1d1d",
  "kbd-bg": "#1f1f1f",
  "kbd-border": "#2c2c2c",
  "line-subtle": "#1b1b1b",
  "line-inner": "#161616",
  line: "#212121",
  "line-strong": "#272727",
  "line-focus": "#2f2f2f",
  "tab-track": "#232223",
  "tab-track-border": "#2e2d2e",
  "row-selected": "#262626",
  "button-border": "#232323",
  "seg-active": "#404040",
  "gauge-track": "#1e1e1e",
  // text
  fg: "#fafafa",
  "fg-row": "#d8d7d8",
  "fg-muted": "#a1a1a1",
  "fg-nav": "#9f9f9f",
  "fg-label": "#868686",
  "fg-faint": "#7e7d7e",
  "fg-icon-dim": "#565656",
  "fg-disabled": "#4a4a4a",
  mark: "#c5c5c5",
  // status
  working: "#03cce9",
  "working-icon": "#eeb000",
  done: "#01c88f",
  "done-icon": "#039567",
  "dot-live": "#00bb80",
  "dot-idle": "#3c3c3c",
  link: "#b2baf6", // links in markdown documents (DESIGN.md terminal colours)
  accent: "#b2baf6", // T-648: the highlight colour; a custom theme changes it
  gauge: "#8beeb0",
  "gauge-text": "#83e4a6",
  // warnings and danger (used as literals before SET-005; light mode needs them as tokens)
  warn: "#fdc030",
  danger: "#f0a07a",
  "danger-line": "#7a3b1e",
  /** Not measured (nothing in the capture was past 90%): the meter's red, USAGE-002. Its own name, as
   *  `danger` above is the error-text colour. */
  "meter-danger": "#e5484d",
  /** USAGE-034: the pane header's session-cost chip. A status colour, so light mode darkens it with the rest. */
  "cost-fg": "#1f9db0",
} as const;

export type Theme = Record<keyof typeof classic, string>;

/** The ten colours the whole chrome is built from; the test checks them against DESIGN.md. */
export const coreTokens = ["app-bg", "strip-bg", "pane-bg", "input-bg", "surface", "line-subtle", "line-strong", "line-focus", "fg", "fg-muted"] as const;

// System font stacks: no font files are bundled (Inter and Cascadia are OFL, which LOOP.md's license
// list does not include); the first installed face wins, Segoe UI on a plain Windows install.
export const uiFont = 'Inter, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
export const monoFont = '"Cascadia Mono", Consolas, monospace';

type StyleHost = { style: { setProperty(name: string, value: string): void } };

/** Writes every token as `--name` on the element (normally the document root). */
export function applyTheme(el: StyleHost, theme: Theme = classic): void {
  for (const [name, value] of Object.entries(theme)) el.style.setProperty(`--${name}`, value);
  el.style.setProperty("--ui-font", uiFont);
  el.style.setProperty("--mono-font", monoFont);
}

/** The terminal's colours, taken from the same tokens so the body matches the pane around it. */
export function terminalTheme(theme: Theme = classic) {
  return { background: theme["pane-bg"], foreground: theme.fg, cursor: theme.fg, cursorAccent: theme["pane-bg"] };
}

// ---- SET-001 / SET-002: Classic or one of 16 hued themes, with tint, saturation and depth ----

/** Classic first, then the hued themes in colour-wheel order (Graphite is the greyscale one). */
export const THEMES = ["classic", "ember", "copper", "sand", "moss", "fern", "jade", "teal", "lagoon", "sky", "cobalt", "indigo", "iris", "violet", "orchid", "rose", "graphite"] as const;
export type ThemeName = (typeof THEMES)[number];
const HUE: Record<Exclude<ThemeName, "classic">, number> = {
  ember: 12, copper: 26, sand: 40, moss: 75, fern: 105, jade: 150, teal: 174, lagoon: 188,
  sky: 202, cobalt: 218, indigo: 236, iris: 252, violet: 268, orchid: 290, rose: 340, graphite: 0,
};
export const themeLabel = (t: ThemeName) => t[0].toUpperCase() + t.slice(1);
/** The swatch colour shown for a theme in the picker. */
export const swatch = (t: ThemeName) => (t === "classic" ? classic["seg-active"] : t === "graphite" ? "#6b6b6b" : hsl(HUE[t], 0.55, 0.52));

/** SET-003: "default" is Kolux's own dark terminal scheme, "match" follows the app hue; SET-023:
 *  a catalogue id, or "custom:<name>" for one of the user's own schemes. */
export type TerminalScheme = string;
/** SET-005: System follows the operating system, also while running. */
export type Mode = "system" | "light" | "dark";
export const MODES: Mode[] = ["system", "light", "dark"];
/** `lightTerminal`: in light mode terminals use `lightScheme`; off keeps `terminal` for both. */
export type Appearance = { theme: ThemeName; tint: number; saturation: number; depth: number; terminal: TerminalScheme; mode: Mode; lightTerminal: boolean; lightScheme: TerminalScheme; custom: CustomScheme[]; appFont: string; editorFont: string; dividerWidth: number; dividerDark: string; dividerLight: string; paneDim: number; termFont: string; termSize: number; termLineHeight: number; termWeight: FontWeight; termWeightBold: FontWeight; screens: ScreenModes; sidebarLook: SidebarLook; sidebarTint: string; sidebarStrength: number; userThemes: CustomTheme[]; userTheme: string };
/** VIEW-006: a mode of its own for one of the three workspace screens; a screen not listed follows `mode`. */
export type ScreenModes = Partial<Record<"agents" | "board" | "terminals", Mode>>;
export const THEMED_SCREENS = ["agents", "board", "terminals"] as const;
const screenModesOf = (v: unknown): ScreenModes =>
  v && typeof v === "object" ? Object.fromEntries(THEMED_SCREENS.flatMap((k) => ((MODES as unknown[]).includes((v as Record<string, unknown>)[k]) ? [[k, (v as Record<string, Mode>)[k]]] : []))) : {};
/** TERM-097: the weights a terminal font can be drawn in (what xterm takes). */
export const WEIGHTS = ["normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"] as const;
export type FontWeight = (typeof WEIGHTS)[number];
const weightOr = (v: unknown, dflt: FontWeight): FontWeight => (typeof v === "string" && (WEIGHTS as readonly string[]).includes(v) ? (v as FontWeight) : typeof v === "number" && (WEIGHTS as readonly string[]).includes(String(v)) ? (String(v) as FontWeight) : dflt);
/** The settings fields the appearance lives in. */
export const FIELD = { theme: "appTheme", tint: "themeTint", saturation: "themeSaturation", depth: "themeDepth", terminal: "terminalScheme", mode: "appearanceMode", lightTerminal: "terminalLightScheme", lightScheme: "terminalSchemeLight", custom: "terminalCustomSchemes", appFont: "appFont", editorFont: "editorFont", dividerWidth: "paneDividerWidth", dividerDark: "paneDividerDark", dividerLight: "paneDividerLight", paneDim: "paneDim", termFont: "terminalFont", termSize: "terminalFontSize", termLineHeight: "terminalLineHeight", termWeight: "terminalFontWeight", termWeightBold: "terminalFontWeightBold", screens: "screenThemes", sidebarLook: "sidebarLook", sidebarTint: "sidebarTint", sidebarStrength: "sidebarTintStrength", userThemes: "customThemes", userTheme: "customThemeActive" } as const;
export const SPAN = { tint: [-180, 180, 0], saturation: [0, 160, 100], depth: [-3, 6, 0], dividerWidth: [2, 12, 6], paneDim: [30, 100, 100], termSize: [8, 32, 13], termLineHeight: [1, 2, 1], sidebarStrength: STRENGTH_SPAN } as const;
/** A divider colour is #rrggbb or empty (the window shows through, as DESIGN.md measured). */
const hexOrEmpty = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : "");

/** Out of span is pulled to the nearest end; anything not a number falls back to the default. */
function clampNum(v: unknown, [lo, hi, dflt]: readonly [number, number, number]): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

/** A saved scheme name this version can draw; anything else is `fallback`. */
function knownScheme(v: unknown, custom: CustomScheme[], fallback: string): string {
  if (typeof v !== "string") return fallback;
  if (v === "default" || v === "match" || CATALOGUE.some((c) => c.id === v)) return v;
  return v.startsWith("custom:") && custom.some((c) => c.name === v.slice(7)) ? v : fallback;
}

export function readAppearance(s: Record<string, unknown>): Appearance {
  const t = s[FIELD.theme];
  const custom = tidySchemes(s[FIELD.custom]);
  const terminal = knownScheme(s[FIELD.terminal], custom, "default");
  const userThemes = tidyThemes(s[FIELD.userThemes], THEMES, Object.keys(classic));
  return {
    theme: typeof t === "string" && (THEMES as readonly string[]).includes(t.toLowerCase()) ? (t.toLowerCase() as ThemeName) : "classic",
    tint: clampNum(s[FIELD.tint], SPAN.tint),
    saturation: clampNum(s[FIELD.saturation], SPAN.saturation),
    depth: clampNum(s[FIELD.depth], SPAN.depth),
    terminal,
    // T-418 (DECISIONS DT-L1, amending SET-005): no saved mode means Dark; a saved System is kept.
    mode: s[FIELD.mode] === "light" || s[FIELD.mode] === "dark" || s[FIELD.mode] === "system" ? (s[FIELD.mode] as Mode) : "dark",
    lightTerminal: s[FIELD.lightTerminal] !== false,
    // Match keeps following the app in light mode until a light scheme is picked.
    lightScheme: knownScheme(s[FIELD.lightScheme], custom, terminal === "match" ? "match" : "tango-light"),
    custom,
    appFont: typeof s[FIELD.appFont] === "string" ? (s[FIELD.appFont] as string).trim().slice(0, 100) : "",
    editorFont: typeof s[FIELD.editorFont] === "string" ? (s[FIELD.editorFont] as string).trim().slice(0, 100) : "",
    dividerWidth: Math.round(clampNum(s[FIELD.dividerWidth], SPAN.dividerWidth)),
    dividerDark: hexOrEmpty(s[FIELD.dividerDark]),
    dividerLight: hexOrEmpty(s[FIELD.dividerLight]),
    paneDim: Math.round(clampNum(s[FIELD.paneDim], SPAN.paneDim)),
    // TERM-097: size 14, line height 1, normal and bold weights unless saved otherwise.
    termFont: typeof s[FIELD.termFont] === "string" ? (s[FIELD.termFont] as string).trim().slice(0, 100) : "",
    termSize: Math.round(clampNum(s[FIELD.termSize], SPAN.termSize)),
    termLineHeight: Math.round(clampNum(s[FIELD.termLineHeight], SPAN.termLineHeight) * 10) / 10,
    termWeight: weightOr(s[FIELD.termWeight], "normal"),
    termWeightBold: weightOr(s[FIELD.termWeightBold], "bold"),
    screens: screenModesOf(s[FIELD.screens]),
    // VIEW-052: the sidebar stays untinted until a look is picked; a tint is #rrggbb or the default blue.
    sidebarLook: sidebarLookOf(s[FIELD.sidebarLook]),
    sidebarTint: hexOrEmpty(s[FIELD.sidebarTint]) || DEFAULT_TINT,
    sidebarStrength: Math.round(clampNum(s[FIELD.sidebarStrength], SPAN.sidebarStrength)),
    userThemes,
    // T-648: the custom theme in use, or "" for the built-in one; a name that no longer exists is "".
    userTheme: typeof s[FIELD.userTheme] === "string" && userThemes.some((c) => c.name === s[FIELD.userTheme]) ? (s[FIELD.userTheme] as string) : "",
  };
}

const asFields = (a: Appearance): Record<string, unknown> => Object.fromEntries(Object.entries(FIELD).map(([k, f]) => [f, a[k as keyof Appearance]]));

/** The settings with the appearance written back in its saved form (always one of the known names). */
export function writeAppearance(s: Record<string, unknown>, a: Appearance): Record<string, unknown> {
  return { ...s, ...asFields(readAppearance(asFields(a))) };
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

export function hsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v + m)) * 255).toString(16).padStart(2, "0")).join("");
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** One depth step moves every background this much lightness. */
const DEPTH_STEP = 0.012;
/** How strongly a hued theme colours the backgrounds at 100 % saturation (text gets a third). */
const BASE_SAT = 0.3;

/** The theme's hue after tint, or null for Classic (no hue). */
export const themeHue = (a: Appearance) => (a.theme === "classic" ? null : (((HUE[a.theme] + a.tint) % 360) + 360) % 360);

/** Whether the operating system asks for dark (dark when there is no way to tell). */
export const systemDark = () => typeof matchMedia !== "function" || matchMedia("(prefers-color-scheme: dark)").matches;
/** T-648: the custom theme in use, if any. */
export const customOf = (a: Appearance) => a.userThemes.find((c) => c.name === a.userTheme);
const modeDark = (a: Appearance, system: boolean) => a.mode === "dark" || (a.mode === "system" && system);
/** A custom theme's window is dark when its background is, whatever the mode says. */
export const isDark = (a: Appearance, system = systemDark()) => {
  const c = customOf(a);
  return c ? isDarkGround(customTokens(builtIn({ ...a, theme: c.base as ThemeName }, modeDark(a, system)), c.overrides)["app-bg"]) : modeDark(a, system);
};

/** Every token for an appearance: Classic as measured; a hued theme recolours the neutral greys
 *  (backgrounds, lines, text) and leaves the status colours alone so their meaning holds. Light
 *  mode turns the greys over (backgrounds light, text dark) and darkens the status colours a
 *  quarter so they still read on a light ground. */
export function buildTheme(a: Appearance, dark = true): Theme {
  const c = customOf(a);
  return c ? customTokens(builtIn({ ...a, theme: c.base as ThemeName }, dark), c.overrides) : builtIn(a, dark);
}
function builtIn(a: Appearance, dark: boolean): Theme {
  const hue = themeHue(a);
  if (hue === null && dark) return { ...classic };
  const sat = hue === null || a.theme === "graphite" ? 0 : (BASE_SAT * a.saturation) / 100;
  const out = { ...classic } as Theme;
  for (const [k, hex] of Object.entries(classic) as [keyof Theme, string][]) {
    const [h, s, l] = toHsl(hex);
    if (s > 0.12) {
      if (!dark) out[k] = hsl(h, s, l * 0.75); // a status colour
      continue;
    }
    const bg = l < 0.5;
    const lit = bg && hue !== null ? clamp01(l + a.depth * DEPTH_STEP) : l;
    out[k] = hsl(hue ?? 0, clamp01(bg ? sat : sat / 3), dark ? lit : bg ? 1 - lit * 0.7 : 1 - lit);
  }
  return out;
}

/** The preview beside the swatches: the chosen theme, or a violet sample while Classic is chosen. */
export const previewOf = (a: Appearance): Appearance => (a.theme === "classic" && !a.userTheme ? { ...a, theme: "violet" } : a);

const ANSI = { red: 0, green: 135, yellow: 45, blue: 215, magenta: 300, cyan: 185 } as const;

/** SET-003: the terminal colours for an appearance. "match" works background, text and the 16-colour
 *  palette out of the app hue; "default" is Kolux's own dark scheme whatever the app hue. SET-023: in
 *  light mode, with the separate light scheme on, the light pick is drawn instead (Tango Light by
 *  default); a catalogue or custom scheme is drawn as it is. */
export function terminalFor(a: Appearance, dark = isDark(a)): ITheme {
  const light = !dark && a.lightTerminal;
  const name = light ? a.lightScheme : a.terminal;
  const fixed = CATALOGUE.find((c) => c.id === name)?.colours ?? a.custom.find((c) => "custom:" + c.name === name);
  if (fixed) {
    const { name: _, ...colours } = fixed as CustomScheme;
    return colours;
  }
  if (name !== "match") return terminalTheme(classic);
  const ct = customOf(a);
  const base = ct ? { ...a, theme: ct.base as ThemeName } : a;
  const t = buildTheme(base, !light);
  const hue = themeHue(base);
  const pull = (h: number, l: number) => (hue === null || base.theme === "graphite" ? hsl(h, 0.6, l) : mix(hsl(h, 0.6, l), hsl(hue, 0.6, l), 0.2));
  const [lo, hi] = light ? [0.38, 0.3] : [0.55, 0.7];
  const colours: Record<string, string> = {};
  for (const [name, h] of Object.entries(ANSI)) {
    colours[name] = pull(h, lo);
    colours["bright" + name[0].toUpperCase() + name.slice(1)] = pull(h, hi);
  }
  const greys = light ? { black: t.fg, brightBlack: t["fg-muted"], white: t["seg-active"], brightWhite: t["line-strong"] } : { black: t.surface, brightBlack: t["fg-faint"], white: t["fg-row"], brightWhite: t.fg };
  return { ...terminalTheme(t), ...greys, ...colours, ...ct?.terminal };
}

// ---- SET-004: the first frame already has the saved look ----

/** index.html reads this before anything draws; keep the key in step with its inline script. */
export const CACHE_KEY = "kolux.look";
let terminal = terminalFor(readAppearance({}));
/** The terminal colours in force now; panes listen for TERMINAL_EVENT to follow changes. */
export const currentTerminal = () => terminal;
export const TERMINAL_EVENT = "kolux-terminal-theme";
/** TERM-098: whether the app is in dark mode now (what a program asking the terminal is told). */
export const currentDark = () => lastDark ?? true;

// ---- TERM-097 / TERM-078: the terminal font, and each pane's zoom on top of it ----

/** Pane key to points added by Zoom In / Zoom Out; Reset Size removes the entry. */
const zooms = new Map<number, number>();
/** ponytail: one point per step, 6 to 48 points; a saved per-pane zoom waits until someone asks. */
const ZOOM_LIMIT = [6, 48] as const;

/** The font options a terminal pane draws with now: the saved font (from the first frame, since
 *  main.tsx puts the cached appearance on before anything draws) plus that pane's zoom. Panes
 *  read it again on TERMINAL_EVENT. */
export function termFont(key?: number) {
  const a = last ?? readAppearance({});
  const size = Math.min(ZOOM_LIMIT[1], Math.max(ZOOM_LIMIT[0], a.termSize + (key === undefined ? 0 : zooms.get(key) ?? 0)));
  return { fontFamily: fontStack(a.termFont, monoFont), fontSize: size, lineHeight: a.termLineHeight, fontWeight: a.termWeight, fontWeightBold: a.termWeightBold };
}

/** TERM-078: Zoom In, Zoom Out or Reset Size on one pane (the focused one); the others keep their
 *  size. Returns the pane's size afterwards. */
export function zoomTerm(key: number, how: "in" | "out" | "reset"): number {
  const base = (last ?? readAppearance({})).termSize;
  const now = termFont(key).fontSize;
  const next = how === "reset" ? base : Math.min(ZOOM_LIMIT[1], Math.max(ZOOM_LIMIT[0], now + (how === "in" ? 1 : -1)));
  if (next === base) zooms.delete(key);
  else zooms.set(key, next - base);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TERMINAL_EVENT));
  return next;
}

/** SET-018: the chosen fonts with a safe fallback after each; an empty editor font is the terminal font.
 *  SET-023: the gap between panes, its colour in this mode, and how far panes not in focus fade. */
export const appearanceVars = (a: Appearance, dark = isDark(a)) => ({
  // VIEW-052 / SET-021: the left sidebar's ground (T-268).
  "--sidebar-bg": sidebarBackground(a.sidebarLook, a.sidebarTint, a.sidebarStrength, buildTheme(a, dark).surface, a.sidebarLook === "terminal" ? terminalFor(a, dark).background : undefined),
  "--ui-font": fontStack(a.appFont, uiFont),
  "--editor-font": fontStack(a.editorFont, fontStack(a.termFont, monoFont)),
  "--term-font": fontStack(a.termFont, monoFont),
  "--divider-width": a.dividerWidth + "px",
  "--divider": (dark ? a.dividerDark : a.dividerLight) || "transparent",
  "--pane-dim": String(a.paneDim / 100),
});

export function themeVars(t: Theme): Record<string, string> {
  const vars: Record<string, string> = { "--ui-font": uiFont, "--mono-font": monoFont };
  for (const [name, value] of Object.entries(t)) vars[`--${name}`] = value;
  return vars;
}

let last: Appearance | null = null;
/** VIEW-006: the screen in front and whether the Classic look is on (App.tsx tells, showScreen). */
let shown = { screen: "terminals", classic: false };

/** VIEW-006: the mode a screen paints in: its own override, else the app's. A screen with no saved
 *  value (Inbox, Artifacts, anything unknown) counts as Terminals; the Classic look ignores the
 *  Board and Agents overrides. */
export function screenMode(a: Appearance, screen: string, classic: boolean): Mode {
  const s = (screen === "agents" || screen === "board") && !classic ? screen : "terminals";
  return a.screens[s] ?? a.mode;
}

/** VIEW-006: the window moved to `screen`; repaint when that screen's mode differs. */
export function showScreen(screen: string, classic: boolean): void {
  shown = { screen, classic };
  if (last) applyAppearance(last);
}
let lastDark: boolean | null = null;

/** SET-004: a switch between light and dark shows at once; transitions are held off two frames. */
function holdTransitions() {
  const el = document.documentElement;
  el.classList.add("no-anim");
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("no-anim")));
}

/** SET-005: on System the window follows the operating system while it runs. Call once. */
export function followSystemMode(): void {
  if (typeof matchMedia !== "function") return;
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (last) applyAppearance(last); // the screen in front may be on System even when the app is not
  });
}

/** Puts an appearance on the window now and remembers it for the next start's first frame. */
export function applyAppearance(a: Appearance, root: StyleHost = document.documentElement): void {
  const dark = isDark({ ...a, mode: screenMode(a, shown.screen, shown.classic) });
  if (lastDark !== null && lastDark !== dark && typeof document !== "undefined") holdTransitions();
  last = a;
  lastDark = dark;
  const vars = { ...themeVars(buildTheme(a, dark)), ...appearanceVars(a, dark), "color-scheme": dark ? "dark" : "light" };
  if (typeof document !== "undefined") document.documentElement.dataset.mode = dark ? "dark" : "light";
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ vars, appearance: a }));
  } catch {
    /* no storage: the next start shows Classic until settings load */
  }
  terminal = terminalFor(a, dark);
  window.dispatchEvent(new Event(TERMINAL_EVENT));
}

/** The appearance remembered from the last run (Classic when there is none). */
export function cachedAppearance(): Appearance {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (c?.appearance) return readAppearance(asFields(c.appearance));
  } catch {
    /* fall through */
  }
  return readAppearance({});
}
