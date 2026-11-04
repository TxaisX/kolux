import { expect, test } from "vitest";
import { appearanceVars, buildTheme, contrast, FIELD, readAppearance, terminalFor, THEMES, writeAppearance } from "../theme";
import { paletteIsDark } from "../terminal/queries";
import { DEAD_BAND, DEFAULT_TINT, inDeadBand, luminance, MAX_WASH, sidebarBackground, sidebarLookOf } from "./sidebar";

const vars = (s: Record<string, unknown>, dark = true) => appearanceVars(readAppearance(s), dark)["--sidebar-bg"];

test("VIEW-052: nothing saved, or an unknown look, leaves the sidebar on the standard surface", () => {
  expect(vars({})).toBe("var(--surface)");
  expect(vars({ [FIELD.sidebarLook]: "plaid" })).toBe("var(--surface)");
  expect(vars({ [FIELD.sidebarLook]: "standard", [FIELD.sidebarTint]: "#ff0000", [FIELD.sidebarStrength]: 90 }), "a saved tint does nothing in Standard").toBe("var(--surface)");
  expect(sidebarLookOf(undefined)).toBe("standard");
});

test("VIEW-052: Tinted at 50 % lays half of the wash over the surface; 0 % is the surface itself", () => {
  const half = vars({ [FIELD.sidebarLook]: "tinted", [FIELD.sidebarTint]: "#ff0000", [FIELD.sidebarStrength]: 50 });
  // Classic dark surface is #171717 (23): 23 + (255 - 23) * 0.5 * MAX_WASH
  expect(half).toBe("#" + [Math.round(23 + 232 * 0.5 * MAX_WASH), Math.round(23 - 23 * 0.5 * MAX_WASH), Math.round(23 - 23 * 0.5 * MAX_WASH)].map((v) => v.toString(16).padStart(2, "0")).join(""));
  expect(vars({ [FIELD.sidebarLook]: "tinted", [FIELD.sidebarTint]: "#ff0000", [FIELD.sidebarStrength]: 0 })).toBe("#171717");
  const faint = vars({ [FIELD.sidebarLook]: "tinted", [FIELD.sidebarTint]: "#ff0000", [FIELD.sidebarStrength]: 10 }) as string;
  expect(parseInt(faint.slice(1, 3), 16), "red at low strength: a faint wash").toBeGreaterThan(23);
  expect(parseInt(faint.slice(1, 3), 16)).toBeLessThan(parseInt(half!.slice(1, 3), 16));
});

test("VIEW-052: strength is pulled into 0 to 100; a bad tint falls back to the default blue; 100 % never fully covers the surface", () => {
  const a = readAppearance({ [FIELD.sidebarLook]: "tinted", [FIELD.sidebarTint]: "red;}", [FIELD.sidebarStrength]: 900 });
  expect([a.sidebarTint, a.sidebarStrength]).toEqual([DEFAULT_TINT, 100]);
  expect(readAppearance({ [FIELD.sidebarStrength]: -5 }).sidebarStrength).toBe(0);
  expect(readAppearance({}).sidebarStrength).toBe(20);
  const full = sidebarBackground("tinted", "#ffffff", 100, "#171717", undefined);
  expect(full).not.toBe("#ffffff");
  expect(sidebarBackground("tinted", "#ffffff", 500, "#171717", undefined), "past 100 counts as 100").toBe(full);
});

test("SET-021: Match terminal paints the terminal's own background, in dark and in light mode", () => {
  const s = { [FIELD.sidebarLook]: "terminal" };
  expect(vars(s)).toBe(terminalFor(readAppearance(s), true).background);
  expect(vars(s, false)).toBe(terminalFor(readAppearance(s), false).background);
  expect(vars({ ...s, terminalScheme: "match", appTheme: "violet" })).toBe(terminalFor(readAppearance({ ...s, terminalScheme: "match", appTheme: "violet" }), true).background);
  expect(sidebarBackground("terminal", DEFAULT_TINT, 20, "#171717", "rgba(0,0,0,0.5)"), "a colour it cannot mix falls back to Standard").toBe("var(--surface)");
});

test("the sidebar look round-trips through the saved settings and keeps other settings", () => {
  const a = readAppearance({ [FIELD.sidebarLook]: "tinted", [FIELD.sidebarTint]: "#AA3300", [FIELD.sidebarStrength]: 33.6 });
  expect(a).toMatchObject({ sidebarLook: "tinted", sidebarTint: "#aa3300", sidebarStrength: 34 });
  expect(writeAppearance({ other: 1 }, a)).toMatchObject({ other: 1, sidebarLook: "tinted", sidebarTint: "#aa3300", sidebarTintStrength: 34 });
});

// ---- C23-R3-02: the sidebar's ink follows the ground it is painted on ----

/** The four inks this finding guarantees at 4.5:1 on the ground, floored in `appearanceVars`. */
const READABLE = ["--sidebar-fg", "--sidebar-fg-row", "--sidebar-fg-muted", "--sidebar-fg-nav"] as const;
/** The two the sidebar also paints, left at the palette's own value: `--fg-label` (4.03:1) and
 *  `--fg-faint` (2.23:1) on the light surface are the C23-R3-06 token defect, not this one. */
const NOT_FLOORED = ["--sidebar-fg-label", "--sidebar-fg-faint"] as const;
const LOOKS = ["standard", "terminal", "tinted"] as const;
const STRENGTHS = [0, 20, 40, 50, 60, 80, 100] as const;
const TINTS = ["#000000", "#ffffff", DEFAULT_TINT] as const;

/** Every ground the sidebar can be given: 17 themes, both modes, every look, strength and tint. */
const grounds = THEMES.flatMap((theme) =>
  [true, false].flatMap((dark) =>
    LOOKS.flatMap((look) =>
      (look === "tinted" ? TINTS.flatMap((tint) => STRENGTHS.map((strength) => ({ tint, strength }))) : [{ tint: DEFAULT_TINT, strength: 20 }]).map(({ tint, strength }) => {
        const a = readAppearance({ [FIELD.theme]: theme, [FIELD.sidebarLook]: look, [FIELD.sidebarTint]: tint, [FIELD.sidebarStrength]: strength });
        return { label: `${theme} ${dark ? "dark" : "light"} ${look} ${tint} ${strength}%`, dark, a, vars: appearanceVars(a, dark) };
      }),
    ),
  ),
);

test("C23-R3-02: no computed sidebar ground sits where neither palette's ink can read", () => {
  const bad = grounds.filter((g) => g.vars["--sidebar-bg"].startsWith("#") && inDeadBand(g.vars["--sidebar-bg"]));
  expect(bad.map((g) => `${g.label} -> ${g.vars["--sidebar-bg"]}`)).toEqual([]);
  expect(DEAD_BAND[0]).toBeLessThan(DEAD_BAND[1]);
});

test("C23-R3-02: the sidebar's ink is the palette its ground supports, not the app's mode", () => {
  const bad: string[] = [];
  const side = (v: string, ground: string) => luminance(v) > luminance(ground);
  for (const g of grounds) {
    const ground = g.vars["--sidebar-bg"];
    const hex = ground.startsWith("#") ? ground : buildTheme(g.a, g.dark).surface;
    const want = buildTheme(g.a, paletteIsDark(ground) ?? g.dark);
    // label and faint are not floored, so they must be the palette's own value.
    for (const key of NOT_FLOORED) {
      const token = key.replace("--sidebar-", "");
      if (g.vars[key] !== want[token as keyof typeof want]) bad.push(`${g.label}: ${key} is ${g.vars[key]}, the ground wants ${want[token as keyof typeof want]}`);
    }
    // the four primary inks start from that palette and are only ever moved away from the ground.
    for (const key of READABLE) {
      const base = want[key.replace("--sidebar-", "") as keyof typeof want] as string;
      if (side(g.vars[key], hex) !== side(base, hex)) bad.push(`${g.label}: ${key} ${g.vars[key]} is on the wrong side of ${hex} (palette ${base})`);
      if (contrast(g.vars[key], hex) < contrast(base, hex)) bad.push(`${g.label}: ${key} ${g.vars[key]} is closer to ${hex} than the palette's ${base}`);
    }
  }
  expect(bad).toEqual([]);
});

test("C23-R3-02: the sidebar's four primary inks reach 4.5:1 on every ground it can be given", () => {
  const bad: string[] = [];
  for (const g of grounds) {
    const ground = g.vars["--sidebar-bg"];
    const hex = ground.startsWith("#") ? ground : buildTheme(g.a, g.dark).surface;
    for (const key of READABLE) {
      const r = contrast(g.vars[key], hex);
      if (r < 4.5) bad.push(`${g.label}: ${key} ${g.vars[key]} on ${hex} = ${r.toFixed(2)}`);
    }
  }
  expect(bad).toEqual([]);
});

// CSS imports are stubbed under vitest, so the sheet is read from disk (as contrast.test.ts does).
const readSheet = () => {
  const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
  return nodeFs.readFileSync(new URL("../styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
};
const ruleIn = (css: string, selector: string) => css.split("}").find((r) => r.split("{")[0].trim() === selector);

/** The two configs the finding names, with the ground each one actually paints. */
const CONFIGS: [string, Record<string, unknown>, boolean, string][] = [
  ["light + Match terminal, light scheme off", { [FIELD.sidebarLook]: "terminal", [FIELD.terminal]: "default", [FIELD.lightTerminal]: false }, false, "#0d0d0d"],
  ["dark + tango-light", { [FIELD.sidebarLook]: "terminal", [FIELD.terminal]: "tango-light" }, true, "#ffffff"],
];

test.each(CONFIGS)("C23-R3-02: every sidebar ink reads on its own painted surface (%s)", (_, s, dark, ground) => {
  const a = readAppearance(s);
  const v = appearanceVars(a, dark);
  expect(v["--sidebar-bg"]).toBe(ground);
  for (const key of READABLE) expect(contrast(v[key], ground), key).toBeGreaterThanOrEqual(4.5);
  // Selected rows, inputs and the tab control are painted on their own surfaces, not on the ground.
  expect(contrast(v["--sidebar-fg"], v["--sidebar-row-selected"]), "selected row").toBeGreaterThanOrEqual(4.5);
  expect(contrast(v["--sidebar-fg-row"], v["--sidebar-kbd-bg"]), "hovered row").toBeGreaterThanOrEqual(4.5);
  expect(contrast(v["--sidebar-fg"], v["--sidebar-input-bg"]), "input text").toBeGreaterThanOrEqual(4.5);
  expect(contrast(v["--sidebar-fg-nav"], v["--sidebar-tab-track"]), "tab text").toBeGreaterThanOrEqual(4.5);
  // and those surfaces are the palette the ground supports, never the app mode's.
  const want = buildTheme(a, paletteIsDark(ground) ?? dark);
  expect(v["--sidebar-row-selected"]).toBe(want["row-selected"]);
  expect(v["--sidebar-input-bg"]).toBe(want["input-bg"]);
  expect(v["--sidebar-tab-track"]).toBe(want["tab-track"]);
});

test("C23-R3-02: selected rows, inputs, hovers and tabs clear 4.5:1 on their own surface for every ground", () => {
  const bad: string[] = [];
  for (const g of grounds) {
    for (const [what, ink, surface] of [["selected row", "--sidebar-fg", "--sidebar-row-selected"], ["hovered row", "--sidebar-fg-row", "--sidebar-kbd-bg"], ["input", "--sidebar-fg", "--sidebar-input-bg"], ["tab", "--sidebar-fg-nav", "--sidebar-tab-track"]] as const) {
      const r = contrast(g.vars[ink], g.vars[surface]);
      if (r < 4.5) bad.push(`${g.label}: ${what} ${g.vars[ink]} on ${surface} ${g.vars[surface]} = ${r.toFixed(2)}`);
    }
  }
  expect(bad).toEqual([]);
});

test("C23-R3-02: the row hover ground is the token, not a dark-mode literal", () => {
  // `#1f1f1f` is the dark palette's `--kbd-bg`. Hard-coded, it stayed dark on a light terminal ground
  // and painted `#282828` on `#1f1f1f` (1.12:1) in dark mode with `tango-light`.
  const css = readSheet();
  for (const selector of [".branch:hover", ".sess:hover"]) {
    const rule = ruleIn(css, selector);
    expect(rule, `${selector} rule`).toBeDefined();
    expect(rule!.match(/background:\s*([^;]+)/)?.[1].trim(), selector).toBe("var(--kbd-bg)");
  }
  const v = appearanceVars(readAppearance(CONFIGS[1][1]), true);
  expect(contrast(v["--sidebar-fg-row"], v["--sidebar-kbd-bg"])).toBeGreaterThanOrEqual(4.5);
});

test("C23-R3-02: the sidebar scope remaps the surfaces its own controls paint on", () => {
  const rule = ruleIn(readSheet(), ".sidebar-wrap:not(.right) > .sidebar:not(.scm)");
  expect(rule, "the sidebar ground rule").toBeDefined();
  for (const [prop, token] of [["--row-selected", "--sidebar-row-selected"], ["--input-bg", "--sidebar-input-bg"], ["--tab-track", "--sidebar-tab-track"], ["--tab-track-border", "--sidebar-tab-track-border"], ["--kbd-bg", "--sidebar-kbd-bg"]] as const) {
    expect(rule!.includes(`${prop}: var(${token})`), `${prop} reads ${token}`).toBe(true);
  }
});

test("C23-R3-02: the sidebar's tab and next-row ink follows the ground, not a literal", () => {
  // The mirrored case (dark mode on a light terminal ground) never matches `[data-mode="light"]`, so a
  // literal here stayed at 2.83:1 on white. Both rules now read the remapped token.
  const css = readSheet();
  for (const selector of [".sb-tabs button", ".sb-next"]) {
    const rule = ruleIn(css, selector);
    expect(rule, `${selector} rule`).toBeDefined();
    expect(rule!.match(/color:\s*([^;]+)/)?.[1].trim(), selector).toBe("var(--fg-nav)");
  }
  // On the track it is really painted on, not on the raw terminal ground.
  const v = appearanceVars(readAppearance(CONFIGS[1][1]), true);
  expect(contrast(v["--sidebar-fg-nav"], v["--sidebar-tab-track"])).toBeGreaterThanOrEqual(4.5);
});

test("C23-R3-02: a custom theme keeps its own surface when the tint would cross it", () => {
  // One palette only, so a ground on the other side of it has no ink to inherit.
  const a = readAppearance({ [FIELD.userThemes]: [{ name: "mine", base: "classic", dark: false, vars: { "--surface": "#f4f4f4" } }], [FIELD.userTheme]: "mine", [FIELD.sidebarLook]: "terminal", [FIELD.terminal]: "default", [FIELD.lightTerminal]: false });
  expect(appearanceVars(a, false)["--sidebar-bg"]).toBe("var(--surface)");
});

test("C23-R3-02: a tint that would land in the dead band is moved to the nearer edge", () => {
  // Classic light surface #efefef, 100 % black: the raw mix is #303030, already past the dark edge.
  expect(sidebarBackground("tinted", "#000000", 100, "#efefef", undefined)).toBe("#303030");
  // 60 % black lands inside the band, so it is walked out to whichever edge is nearer.
  const mid = sidebarBackground("tinted", "#000000", 60, "#efefef", undefined);
  expect(inDeadBand(mid)).toBe(false);
  const l = luminance(mid);
  expect([DEAD_BAND[0], DEAD_BAND[1]].some((edge) => Math.abs(edge - l) < 0.02), `${mid} is not at a band edge`).toBe(true);
  // A terminal ground inside the band cannot carry either palette, so it falls back to the surface.
  expect(sidebarBackground("terminal", DEFAULT_TINT, 20, "#efefef", "#808080")).toBe("var(--surface)");
});
