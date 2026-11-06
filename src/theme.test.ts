import design from "../design/DESIGN.md?raw";
import { expect, test } from "vitest";
import { applyAppearance, applyTheme, buildTheme, classic, coreTokens, isDark, previewOf, readAppearance, terminalFor, terminalTheme, themeVars, THEMES, writeAppearance, appearanceVars, termFont, screenMode } from "./theme";

/** The `| \`--token\` | \`#hex\` |` rows of DESIGN.md section 2, as a name-to-hex map. */
function designPalette(): Record<string, string> {
  const text = design;
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/^\| `--([a-z-]+)` \| `(#[0-9a-f]{6})` \|/gm)) out[m[1]] = m[2];
  return out;
}

test("the ten core colours are the ones measured in DESIGN.md", () => {
  const measured = designPalette();
  expect(Object.keys(measured).length).toBeGreaterThanOrEqual(10);
  for (const name of coreTokens) expect(`${name}=${classic[name]}`).toBe(`${name}=${measured[name]}`);
});

test("tokens land on the root as custom properties, fonts included", () => {
  const set: Record<string, string> = {};
  applyTheme({ style: { setProperty: (n, v) => (set[n] = v) } });
  expect(set["--surface"]).toBe("#171717");
  expect(set["--ui-font"]).toContain("Segoe UI");
  expect(set["--mono-font"]).toContain("Cascadia Mono");
});

test("the terminal body uses the pane colours", () => {
  expect(terminalTheme()).toMatchObject({ background: "#0d0d0d", foreground: "#fafafa" });
});

const look = (o: Record<string, unknown> = {}) => readAppearance(o);
const grey = (hex: string) => hex.slice(1, 3) === hex.slice(3, 5) && hex.slice(3, 5) === hex.slice(5, 7);

test("Classic comes first, then the 16 hues in colour-wheel order", () => {
  expect(THEMES.join(" ")).toBe("classic ember copper sand moss fern jade teal lagoon sky cobalt indigo iris violet orchid rose graphite");
});

test("an absent or unknown theme is Classic, loading and saving", () => {
  expect(look().theme).toBe("classic");
  expect(look({ appTheme: "Neon" }).theme).toBe("classic");
  expect(look({ appTheme: "Teal" }).theme).toBe("teal");
  expect(writeAppearance({ other: 1 }, { ...look(), theme: "neon" as never })).toMatchObject({ other: 1, appTheme: "classic" });
  expect(buildTheme(look())).toEqual(classic);
});

test("sliders are pulled into their spans and words fall back to the default", () => {
  expect(look({ themeSaturation: 500 }).saturation).toBe(160);
  expect(look({ themeSaturation: "lots" }).saturation).toBe(100);
  expect(look({ themeTint: -999, themeDepth: 9 })).toMatchObject({ tint: -180, depth: 6 });
  expect(look({ themeDepth: "2" }).depth).toBe(2);
});

test("a hue recolours the greys but not the status colours", () => {
  const teal = buildTheme(look({ appTheme: "teal" }));
  expect(teal.surface).not.toBe(classic.surface);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(teal.surface.slice(i, i + 2), 16));
  expect(g > r && b > r).toBe(true); // teal: green and blue over red
  expect(teal.done).toBe(classic.done);
  expect(teal.working).toBe(classic.working);
});

test("saturation 0 or Graphite is greyscale; depth makes backgrounds lighter or darker", () => {
  expect(grey(buildTheme(look({ appTheme: "moss", themeSaturation: 0 })).surface)).toBe(true);
  expect(grey(buildTheme(look({ appTheme: "moss" })).surface)).toBe(false);
  expect(grey(buildTheme(look({ appTheme: "graphite" })).surface)).toBe(true);
  const at = (d: number) => parseInt(buildTheme(look({ appTheme: "sky", themeDepth: d }))["app-bg"].slice(1, 3), 16) + parseInt(buildTheme(look({ appTheme: "sky", themeDepth: d }))["app-bg"].slice(5, 7), 16);
  expect(at(6)).toBeGreaterThan(at(0));
  expect(at(-3)).toBeLessThanOrEqual(at(0));
});

test("the preview shows violet while Classic is chosen", () => {
  expect(previewOf(look()).theme).toBe("violet");
  expect(previewOf(look({ appTheme: "rose" })).theme).toBe("rose");
  expect(themeVars(buildTheme(look()))["--surface"]).toBe("#171717");
});

test("terminal colours follow the app hue only on Match", () => {
  expect(terminalFor(look({ appTheme: "sky" }))).toMatchObject({ background: "#0d0d0d", foreground: "#fafafa" });
  const sky = terminalFor(look({ appTheme: "sky", terminalScheme: "match" }));
  const ember = terminalFor(look({ appTheme: "ember", terminalScheme: "match" }));
  expect(sky.background).toBe(buildTheme(look({ appTheme: "sky" }))["pane-bg"]);
  expect(sky.background).not.toBe(ember.background);
  expect(sky.blue).not.toBe(ember.blue);
  expect(Object.keys(sky)).toEqual(expect.arrayContaining(["black", "red", "brightCyan", "brightWhite"]));
});

test("SET-005 with T-418: Dark when nothing is saved, saved modes kept, light turns the greys over", () => {
  const system = look({ appearanceMode: "system" });
  expect(look().mode).toBe("dark");
  expect(system.mode).toBe("system");
  expect(look({ appearanceMode: "light" }).mode).toBe("light");
  expect(look({ appearanceMode: "dim" }).mode).toBe("dark");
  expect(writeAppearance({}, look({ appearanceMode: "dark" }))).toMatchObject({ appearanceMode: "dark", terminalLightScheme: true });
  expect(isDark(look(), false)).toBe(true);
  expect(isDark(system, false)).toBe(false);
  expect(isDark(system, true)).toBe(true);
  expect(isDark(look({ appearanceMode: "light" }), true)).toBe(false);
  const light = buildTheme(system, false);
  const lum = (h: string) => parseInt(h.slice(1, 3), 16);
  expect(lum(light["app-bg"])).toBeGreaterThan(240);
  expect(lum(light.fg)).toBeLessThan(16);
  expect(lum(light["pane-bg"])).toBeLessThan(lum(light["app-bg"]));
  expect(buildTheme(look(), true)).toEqual({ ...classic });
});

test("SET-005: light mode terminals use the light scheme unless it is turned off", () => {
  const on = terminalFor(look({ appearanceMode: "light" }), false);
  expect(parseInt(on.background!.slice(1, 3), 16)).toBeGreaterThan(200);
  expect(terminalFor(look({ appearanceMode: "light", terminalLightScheme: false }), false).background).toBe(classic["pane-bg"]);
  expect(terminalFor(look({ appearanceMode: "dark" }), true).background).toBe(classic["pane-bg"]);
});

test("TERM-098: Kolux dark by default, a Tango-style light scheme in light mode", () => {
  const light = terminalFor(look({ appearanceMode: "light" }), false);
  expect(light).toMatchObject({ background: "#ffffff", foreground: "#2e3436", red: "#cc0000", green: "#4e9a06", blue: "#3465a4", brightWhite: "#eeeeec" });
  expect(terminalFor(look(), true).background).toBe(classic["pane-bg"]);
  const match = terminalFor(look({ appearanceMode: "light", terminalScheme: "match", appTheme: "sky" }), false);
  expect(match.red, "Match app theme keeps following the app colours").not.toBe("#cc0000");
});

test("SET-023: one scheme for dark and one for light; flipping the mode swaps them", () => {
  const a = look({ terminalScheme: "dracula", terminalSchemeLight: "solarized-light" });
  expect(terminalFor(a, true).background).toBe("#282a36");
  expect(terminalFor(a, false).background).toBe("#fdf6e3");
  expect(terminalFor({ ...a, lightTerminal: false }, false).background, "separate light scheme off: one scheme").toBe("#282a36");
  expect(look({ terminalScheme: "nope", terminalSchemeLight: "nope" })).toMatchObject({ terminal: "default", lightScheme: "tango-light" });
});

test("SET-023: a custom scheme can be picked for either mode; a removed one falls back", () => {
  const custom = [{ name: "Mine", background: "#123456", foreground: "#fedcba" }];
  const a = look({ terminalScheme: "custom:Mine", terminalCustomSchemes: custom });
  expect(terminalFor(a, true)).toMatchObject({ background: "#123456", foreground: "#fedcba" });
  expect(look({ terminalScheme: "custom:Mine" }).terminal, "not in the saved list").toBe("default");
  expect(writeAppearance({}, a)).toMatchObject({ terminalScheme: "custom:Mine", terminalSchemeLight: "tango-light", terminalCustomSchemes: custom });
});

// TERM-097 / TERM-078 (T-144-b)
test("terminal font defaults to size 13 (T-144-e: day one looks like today's 13 pt terminal), line height 1, normal and bold, and keeps saved values in range", () => {
  expect(readAppearance({})).toMatchObject({ termFont: "", termSize: 13, termLineHeight: 1, termWeight: "normal", termWeightBold: "bold" });
  const a = readAppearance({ terminalFont: " Fira Code ", terminalFontSize: 99, terminalLineHeight: 1.25, terminalFontWeight: 300, terminalFontWeightBold: "heavy" });
  expect(a).toMatchObject({ termFont: "Fira Code", termSize: 32, termLineHeight: 1.3, termWeight: "300", termWeightBold: "bold" });
  expect(writeAppearance({}, a)).toMatchObject({ terminalFont: "Fira Code", terminalFontSize: 32, terminalFontWeight: "300" });
});

test("the editor font follows the terminal font unless it has its own", () => {
  const vars = (s: Record<string, unknown>) => appearanceVars(readAppearance(s), true);
  expect(vars({ terminalFont: "Fira Code" })["--editor-font"]).toBe('"Fira Code", "Cascadia Mono", Consolas, monospace');
  expect(vars({ terminalFont: "Fira Code", editorFont: "Hack" })["--editor-font"]).toBe('"Hack", "Fira Code", "Cascadia Mono", Consolas, monospace');
});

test("one saved terminal size is the size of every pane; there is no per-pane zoom", () => {
  const had = "window" in globalThis;
  const was = (globalThis as { window?: unknown }).window;
  Object.assign(globalThis, { window: { dispatchEvent: () => true } });
  try {
    const root = { style: { setProperty: () => {} } };
    applyAppearance(readAppearance({}), root);
    expect(termFont()).toMatchObject({ fontSize: 13, lineHeight: 1, fontWeight: "normal", fontWeightBold: "bold" });
    applyAppearance(readAppearance({ terminalFontSize: 10 }), root);
    expect(termFont().fontSize, "the saved size reaches every pane").toBe(10);
    applyAppearance(readAppearance({}), root);
    expect(termFont().fontSize, "back to the default").toBe(13);
  } finally {
    if (had) Object.assign(globalThis, { window: was });
    else delete (globalThis as { window?: unknown }).window;
  }
});

// VIEW-006 (T-146-c)
test("a screen paints in its own mode; screens without one follow the app; Classic ignores Board and Agents", () => {
  const a = readAppearance({ appearanceMode: "light", screenThemes: { board: "dark", agents: "nope", inbox: "dark" } });
  expect(a.screens, "only the three screens and known modes are kept").toEqual({ board: "dark" });
  expect(screenMode(a, "board", false)).toBe("dark");
  expect(screenMode(a, "terminals", false)).toBe("light");
  expect(screenMode(a, "agents", false)).toBe("light");
  expect(screenMode(a, "board", true), "classic look").toBe("light");
  const t = readAppearance({ appearanceMode: "dark", screenThemes: { terminals: "light" } });
  expect(screenMode(t, "inbox", false), "no saved value counts as Terminals").toBe("light");
  expect(screenMode(t, "board", true), "classic uses the Terminals choice").toBe("light");
  expect(writeAppearance({}, a)).toMatchObject({ screenThemes: { board: "dark" } });
});
