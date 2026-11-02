// T-648 (DT-C87): custom themes. Import validation, the contrast maths, and save / rename / duplicate /
// delete / reset, plus how a custom theme reaches the window's colours.
import { expect, test } from "vitest";
import { buildTheme, classic, isDark, readAppearance, terminalFor, themeVars, TOKEN_KEYS, writeAppearance } from "../theme";
import { customTokens, tidyThemes, type CustomTheme } from "./customTheme";
import { AA, contrast, nudgeToContrast, pairsOf, ratioText } from "./customThemeContrast";
import { byteLength, exportTheme, MAX_BYTES, parseThemeFile } from "./customThemeFile";
import { deleteTheme, duplicateTheme, freeName, nameProblem, newTheme, resetToDefault, saveTheme } from "./customThemeStore";
import { ADVANCED, MAIN } from "./CustomThemeEditor";

const file = (over: Record<string, unknown> = {}) => JSON.stringify({ format: "kolux-theme", version: 1, name: "Dusk", base: "classic", overrides: { accent: "#ff8800", fg: "#EEEEEE" }, terminal: { red: "#cc0000" }, ...over });
const look = (extra: Record<string, unknown> = {}) => readAppearance(extra);
/** Puts a saved theme in use (the Appearance page does this by writing `userTheme`). */
const activateTheme = (a: ReturnType<typeof look>, name: string) => ({ ...a, userTheme: name });
const dusk: CustomTheme = { name: "Dusk", base: "classic", overrides: { accent: "#ff8800" }, terminal: {} };

// ---- import validation ----

test("a good file is read, colours lower-cased", () => {
  const t = parseThemeFile(file());
  expect(t).toEqual({ name: "Dusk", base: "classic", tint: 0, saturation: 100, depth: 0, overrides: { accent: "#ff8800", fg: "#eeeeee" }, terminal: { red: "#cc0000" } });
});

test("export then import gives the same theme back", () => {
  const t: CustomTheme = { name: "Mine", base: "teal", tint: 40, saturation: 50, depth: 2, overrides: { "app-bg": "#101820" }, terminal: { cursor: "#ffffff" } };
  expect(parseThemeFile(exportTheme(t))).toEqual(t);
});

test("import refuses anything but the known keys, with a plain message", () => {
  expect(() => parseThemeFile(file({ extra: 1 }))).toThrow(/"extra" is not something a theme file can hold/);
  expect(() => parseThemeFile(file({ overrides: { "not-a-token": "#ffffff" } }))).toThrow(/"not-a-token" is not a colour/);
  expect(() => parseThemeFile(file({ terminal: { teal: "#ffffff" } }))).toThrow(/"teal" is not a colour/);
  expect(() => parseThemeFile(file({ base: "neon" }))).toThrow(/"base" must be one of/);
});

test("import refuses any colour that is not #rrggbb", () => {
  for (const bad of ["red", "#fff", "#12345", "#1234567", "rgb(1,2,3)", "#gggggg", "ff8800", 5, null, ""]) {
    expect(() => parseThemeFile(file({ overrides: { accent: bad } })), String(bad)).toThrow(/must be a colour written like #1a2b3c/);
  }
});

test("import refuses wrong shapes, versions, sizes and names", () => {
  expect(() => parseThemeFile("not json")).toThrow(/not valid JSON/);
  expect(() => parseThemeFile("[1]")).toThrow(/not a Kolux theme file/);
  expect(() => parseThemeFile(file({ format: "other" }))).toThrow(/not a Kolux theme file/);
  expect(() => parseThemeFile(file({ version: 2 }))).toThrow(/different version/);
  expect(() => parseThemeFile(file({ name: "" }))).toThrow(/needs a name/);
  expect(() => parseThemeFile(file({ name: "x".repeat(41) }))).toThrow(/needs a name/);
  expect(() => parseThemeFile(file({ name: "a\nb" }))).toThrow(/needs a name/);
  expect(() => parseThemeFile(file({ overrides: [] }))).toThrow(/must be a list of colours/);
  expect(() => parseThemeFile(" ".repeat(20000))).toThrow(/too big/);
  expect(() => parseThemeFile('{"format":"kolux-theme","version":1,"name":"a","base":"classic","__proto__":{"x":1}}')).toThrow(/"__proto__"/);
});

// ---- the forgiving read of the saved list ----

test("the saved list drops bad entries and colours instead of failing", () => {
  const out = tidyThemes(
    [dusk, { ...dusk, name: "DUSK" }, { name: "" }, 7, null, { name: "B", base: "zzz", overrides: { accent: "red", fg: "#ABCDEF", nope: "#ffffff" }, terminal: { red: "#12" } }],
    look(),
  );
  expect(out.map((t) => t.name)).toEqual(["Dusk", "B"]);
  expect(out[1]).toMatchObject({ name: "B", base: "classic", overrides: { fg: "#abcdef" }, terminal: {} });
  expect(out[1].vars?.["--fg"]).toBe("#abcdef"); // tidied themes carry their resolved colours
  expect(tidyThemes("nope", look())).toEqual([]);
});

test("the active name must exist, and custom themes survive a write and read", () => {
  expect(look({ customThemes: [dusk], customThemeActive: "Gone" }).userTheme).toBe("");
  const a = look({ customThemes: [dusk], customThemeActive: "Dusk" });
  expect(a.userTheme).toBe("Dusk");
  const settings = writeAppearance({}, a);
  expect(settings.customThemes).toEqual([dusk]);
  expect(settings.customThemeActive).toBe("Dusk");
});

// ---- the contrast maths ----

test("contrast ratios match WCAG", () => {
  expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2); // the well-known just-failing grey
  expect(contrast("#767676", "#ffffff")).toBeGreaterThanOrEqual(AA);
  expect(contrast("#ffffff", "#000000")).toBe(contrast("#000000", "#ffffff"));
  expect(ratioText(4.4999)).toBe("4.4");
});

test("Fix nudges the text colour to 4.5:1 and leaves a good one alone", () => {
  expect(nudgeToContrast("#eeeeee", ["#050405"])).toBe("#eeeeee");
  const fixed = nudgeToContrast("#555555", ["#050405", "#171717"]);
  expect(contrast(fixed, "#050405")).toBeGreaterThanOrEqual(AA);
  expect(contrast(fixed, "#171717")).toBeGreaterThanOrEqual(AA);
  const onWhite = nudgeToContrast("#aaaaaa", ["#ffffff"]);
  expect(contrast(onWhite, "#ffffff")).toBeGreaterThanOrEqual(AA);
  expect(luminanceOf(onWhite)).toBeLessThan(luminanceOf("#aaaaaa")); // went darker on a light ground
});
const luminanceOf = (h: string) => parseInt(h.slice(1, 3), 16);

test("the classic theme passes its own text pairs", () => {
  for (const p of pairsOf(classic)) expect(contrast(p.fg, p.ground), p.id).toBeGreaterThanOrEqual(AA);
});

// ---- save / rename / duplicate / delete / reset ----

test("save adds, a rename keeps its place and stays in use", () => {
  let a = saveTheme(look(), dusk);
  a = { ...a, userTheme: "Dusk" };
  a = saveTheme(a, { ...dusk, name: "Dawn" }, "Dusk");
  expect(a.userThemes.map((t) => t.name)).toEqual(["Dawn"]);
  expect(a.userTheme).toBe("Dawn");
});

test("names must be new (any case), non-empty and short", () => {
  const a = saveTheme(look(), dusk);
  expect(nameProblem(a, "dusk")).toMatch(/already have a theme called dusk/);
  expect(nameProblem(a, "Dusk", "Dusk")).toBe("");
  expect(nameProblem(a, "  ")).toMatch(/Give the theme a name/);
  expect(nameProblem(a, "x".repeat(41))).toMatch(/40 characters/);
  expect(() => saveTheme(a, { ...dusk, name: "DUSK" })).toThrow(/already have/);
  expect(freeName(["Mine", "mine 2"], "Mine")).toBe("Mine 3");
});

test("the list is capped", () => {
  let a = look();
  for (let i = 0; i < 24; i++) a = saveTheme(a, { ...dusk, name: "T" + i });
  expect(() => saveTheme(a, { ...dusk, name: "one more" })).toThrow(/up to 24 themes/);
});

test("duplicate makes an independent copy under a free name and uses it", () => {
  const a = duplicateTheme(duplicateTheme(saveTheme(look(), dusk), "Dusk"), "Dusk");
  expect(a.userThemes.map((t) => t.name)).toEqual(["Dusk", "Dusk copy", "Dusk copy 2"]);
  expect(a.userTheme).toBe("Dusk copy 2");
  a.userThemes[1].overrides.accent = "#000000";
  expect(a.userThemes[0].overrides.accent).toBe("#ff8800");
});

test("delete removes it, and falls back to the built-in theme when it was in use", () => {
  const a = activateTheme(saveTheme(saveTheme(look({ appTheme: "teal" }), dusk), { ...dusk, name: "Other" }), "Dusk");
  expect(a.userTheme).toBe("Dusk");
  const b = deleteTheme(a, "Dusk");
  expect(b.userThemes.map((t) => t.name)).toEqual(["Other"]);
  expect(b.userTheme).toBe("");
  expect(b.theme).toBe("teal");
  expect(deleteTheme(activateTheme(a, "Other"), "Dusk").userTheme).toBe("Other");
});

test("reset goes back to Classic, plain sliders, no custom theme, and keeps the saved themes", () => {
  const a = { ...activateTheme(saveTheme(look({ appTheme: "teal", themeTint: 40, themeSaturation: 50, themeDepth: 2 }), dusk), "Dusk") };
  const r = resetToDefault(a);
  expect([r.theme, r.tint, r.saturation, r.depth, r.userTheme]).toEqual(["classic", 0, 100, 0, ""]);
  expect(r.userThemes).toHaveLength(1);
  expect(buildTheme(r, true)).toEqual(classic);
});

test("a new theme copies the custom theme in use, else starts from the built-in one", () => {
  expect(newTheme(look({ appTheme: "teal" }))).toEqual({ name: "My theme", base: "teal", overrides: {}, terminal: {}, tint: 0, saturation: 100, depth: 0 });
  const a = activateTheme(saveTheme(look(), dusk), "Dusk");
  const n = newTheme(a);
  expect(n.overrides).toEqual({ accent: "#ff8800" });
  expect(n.name).toBe("My theme");
});

// ---- how a custom theme reaches the window ----

test("only the changed colours differ from the base; one accent pick touches only accent and link", () => {
  const a = activateTheme(saveTheme(look(), dusk), "Dusk");
  const t = buildTheme(a, true);
  expect(t.accent).toBe("#ff8800");
  expect(t.link).toBe("#ff8800");
  const { accent: _a, ...rest } = t;
  expect({ ...rest, link: classic.link }).toEqual(classic);
});

test("changing the background, panel and text re-mixes the greys, and an explicit token still wins", () => {
  const c: CustomTheme = { name: "Paper", base: "classic", overrides: { "app-bg": "#ffffff", surface: "#f0f0f0", fg: "#111111", "line-focus": "#ff0000" }, terminal: {} };
  const a = activateTheme(saveTheme(look(), c), "Paper");
  const t = buildTheme(a, true);
  expect(t["app-bg"]).toBe("#ffffff");
  expect(t["line-focus"]).toBe("#ff0000");
  expect(t["fg-muted"]).not.toBe(classic["fg-muted"]);
  expect(t.done).toBe(buildTheme(look(), false).done); // status colours are the base theme's own, as for a light window
  expect(isDark(a)).toBe(false); // a light background is a light window whatever the mode
  expect(isDark(activateTheme(saveTheme(look(), dusk), "Dusk"))).toBe(true);
  expect(customTokens({ ...classic }, {})).toEqual(classic);
});

test("terminal colours: the theme's own win, the rest follow the app theme", () => {
  const c: CustomTheme = { ...dusk, terminal: { red: "#123456", background: "#000011" } };
  const a = { ...activateTheme(saveTheme(look({ terminalScheme: "match" }), c), "Dusk") };
  const term = terminalFor(a, true);
  expect(term.red).toBe("#123456");
  expect(term.background).toBe("#000011");
  expect(term.green).toBeTruthy();
  expect(terminalFor({ ...a, userTheme: "" }, true).red).not.toBe("#123456");
});

// ---- the editor's colour lists ----

test("every colour of the classic palette has a picker, once", () => {
  const listed = [...MAIN.map((m) => m.key as string), ...ADVANCED.flatMap((g) => g.keys)];
  expect([...listed].sort()).toEqual([...TOKEN_KEYS].sort());
});

// ---- start-up reads only the saved, resolved colours ----

test("a saved theme can only lay #rrggbb colours over known tokens, whatever the file holds", () => {
  const evil = { name: "X", base: "nonsense", overrides: {}, terminal: { red: "url(x)", Blue: "#0000ff", "a b": "#ffffff" }, dark: true, vars: { "--app-bg": "#101010", "--fg": "red", "--nope": "#ffffff", bad: "#000000", "--accent": "#FF0000" } };
  const a = look({ terminalScheme: "match", customThemes: [evil], customThemeActive: "X" });
  const t = buildTheme(a, false);
  expect(t["app-bg"]).toBe("#101010");
  expect(t.fg).toBe(classic.fg);
  expect(t.accent).toBe("#FF0000");
  expect(Object.keys(t).sort()).toEqual([...TOKEN_KEYS].sort());
  const term = terminalFor(a, true) as Record<string, string>;
  expect(term.red).not.toBe("url(x)");
  expect(term.Blue).toBeUndefined();
  expect(term["a b"]).toBeUndefined();
  expect(isDark(a)).toBe(true);
});

test("saving a theme stores its resolved colours, so start-up needs no maths", () => {
  const light: CustomTheme = { name: "Paper", base: "classic", overrides: { "app-bg": "#ffffff", fg: "#111111" }, terminal: {} };
  const saved = saveTheme(look(), light).userThemes[0];
  expect(saved.dark).toBe(false);
  expect(saved.vars?.["--app-bg"]).toBe("#ffffff");
  expect(saved.vars?.["--fg-muted"]).toBeTruthy();
  expect(Object.keys(saved.vars ?? {}).every((k) => /^--[a-z0-9-]+$/.test(k))).toBe(true);
});

// ---- review fixes (wave UI lane D) ----

test("a built-in theme leaves --accent unset; only a custom theme that sets one defines it", () => {
  for (const theme of ["classic", "teal", "violet", "graphite"]) for (const dark of [true, false]) expect(Object.keys(themeVars(buildTheme(look({ appTheme: theme }), dark)))).not.toContain("--accent");
  const plain: CustomTheme = { name: "Plain", base: "classic", overrides: { fg: "#eeeeee" }, terminal: {} };
  expect(Object.keys(themeVars(buildTheme(activateTheme(saveTheme(look(), plain), "Plain"), true)))).not.toContain("--accent");
  expect(themeVars(buildTheme(activateTheme(saveTheme(look(), dusk), "Dusk"), true))["--accent"]).toBe("#ff8800");
});

test("a theme keeps its own tint, saturation and depth: moving the sliders while editing A leaves B alone", () => {
  let a = look({ appTheme: "teal", themeTint: 30, themeSaturation: 80, themeDepth: 1 });
  a = saveTheme(a, { ...newTheme(a), name: "A" });
  a = saveTheme(a, { ...newTheme(a), name: "B" });
  const bBefore = a.userThemes[1];
  expect([bBefore.tint, bBefore.saturation, bBefore.depth]).toEqual([30, 80, 1]);
  // sliders move, then A is edited the way the editor does it (the draft takes the sliders' values)
  const moved = { ...a, tint: -90, saturation: 140, depth: 5 };
  const next = saveTheme(moved, { ...moved.userThemes[0], overrides: { fg: "#eeeeee" }, tint: moved.tint, saturation: moved.saturation, depth: moved.depth }, "A");
  expect(next.userThemes[1]).toEqual(bBefore);
  expect(next.userThemes[0].tint).toBe(-90);
  // and a list read back (tidy) after the sliders moved resolves B to the same colours
  expect(tidyThemes(next.userThemes, { ...next, tint: 120 })[1].vars).toEqual(bBefore.vars);
});

test("export then import gives identical colours; a version 1 file without the three numbers imports as neutral", () => {
  const a = saveTheme(look({ appTheme: "teal", themeTint: 25, themeSaturation: 70, themeDepth: 3 }), { ...newTheme(look({ appTheme: "teal", themeTint: 25, themeSaturation: 70, themeDepth: 3 })), name: "Mine", overrides: { accent: "#ff8800" } });
  const back = saveTheme(look(), parseThemeFile(exportTheme(a.userThemes[0])));
  expect(back.userThemes[0].vars).toEqual(a.userThemes[0].vars);
  const old = parseThemeFile(file());
  expect([old.tint, old.saturation, old.depth]).toEqual([0, 100, 0]);
  expect(() => parseThemeFile(file({ tint: 999 }))).toThrow(/"tint" must be a number from -180 to 180/);
});

test("the size cap counts bytes, not characters", () => {
  const wide = file({ name: "é" }) + "é".repeat(MAX_BYTES / 2 - 20);
  expect(wide.length).toBeLessThan(MAX_BYTES);
  expect(byteLength(wide)).toBeGreaterThan(MAX_BYTES);
  expect(() => parseThemeFile(wide)).toThrow(/too big/);
});

test("a token name from the prototype chain, or a terminal key xterm does not know, is ignored", () => {
  const evil = { name: "X", base: "classic", overrides: {}, terminal: { red: "#cc0000", fooBar: "#ffffff", foreground: "#101010" }, dark: true, vars: { "--constructor": "#ffffff", "--toString": "#ffffff", "--app-bg": "#101010" } };
  const a = look({ terminalScheme: "match", customThemes: [evil], customThemeActive: "X" });
  const t = buildTheme(a, true) as Record<string, string>;
  expect(Object.keys(t)).not.toContain("constructor");
  expect(typeof t.constructor).toBe("function");
  const term = terminalFor(a, true) as Record<string, string>;
  expect([term.red, term.foreground, term.fooBar]).toEqual(["#cc0000", "#101010", undefined]);
});

// ---- re-review fixes (wave UI lane D, round 2) ----

test("a saved theme keeps the light/dark it was made in when the window's mode changes and another theme is edited", () => {
  let a = look({ appTheme: "teal", appearanceMode: "dark" });
  a = saveTheme(a, { ...newTheme(a), name: "A" });
  a = saveTheme(a, { ...newTheme({ ...a, userTheme: "" }), name: "B" });
  const bBefore = a.userThemes[1];
  expect(bBefore.dark).toBe(true);
  // the window goes light, then A is edited the way the editor does it (the list is tidied first)
  const w = { ...a, mode: "light" as const, userTheme: "A" };
  const list = { ...w, userThemes: tidyThemes(w.userThemes, w) };
  const next = saveTheme(list, { ...list.userThemes[0], overrides: { accent: "#ff8800" } }, "A");
  expect(next.userThemes[1].dark).toBe(true);
  expect(next.userThemes[1].vars).toEqual(bBefore.vars);
  expect(next.userThemes[0].dark).toBe(true);
});

test("editing a theme with the sliders at rest elsewhere keeps the theme's own tint (the editor spreads the theme's own look)", () => {
  let a = look({ appTheme: "teal", themeTint: 60 });
  a = saveTheme(a, { ...newTheme(a), name: "A" });
  const before = a.userThemes[0];
  const w = { ...a, theme: "classic" as const, tint: 0, userTheme: "A" };
  const cur = w.userThemes[0];
  const next = saveTheme(w, { ...cur, overrides: { accent: "#ff8800" } }, "A");
  expect(next.userThemes[0].tint).toBe(60);
  expect(next.userThemes[0].vars!["--app-bg"]).toBe(before.vars!["--app-bg"]);
});

test("a free name is cut to the limit only when a number has to be added", () => {
  const long = "x".repeat(40);
  expect(freeName([], long)).toBe(long);
  expect(freeName([long], long).length).toBeLessThanOrEqual(40);
  expect(freeName([long], long)).not.toBe(long);
  expect(freeName(["Mine"], "Mine")).toBe("Mine 2");
});

test("the matching terminal palette of a custom theme uses the theme's own tint, not the window's sliders", () => {
  let a = look({ appTheme: "teal", themeTint: 60, terminalScheme: "match" });
  a = saveTheme(a, { ...newTheme(a), name: "A" });
  const on = { ...a, userTheme: "A" };
  expect(terminalFor({ ...on, tint: -120 }, true)).toEqual(terminalFor({ ...on, tint: 60 }, true));
});
