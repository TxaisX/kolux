import { expect, test } from "vitest";
import { appearanceVars, buildTheme, contrast, FIELD, glassInks, readAppearance, THEMES, writeAppearance, type Theme } from "../theme";
import { CAST, castOf, DEFAULT_METAL, finishOf, GLASS_ICONS, GLASS_TEXT, glassFill, glassGround, glassLevels, GLOW, ICON_BAR, SOLID, TEXT_BAR } from "./glass";
import { METALS, metalName } from "./FinishSettings";
import { luminance } from "./sidebar";

const glass = (s: Record<string, unknown> = {}) => ({ [FIELD.finish]: "glass", ...s });
const vars = (s: Record<string, unknown>, dark = true) => appearanceVars(readAppearance(s), dark) as Record<string, string>;
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("./glass.css", import.meta.url), "utf8");
/** The stylesheet without its comments, one rule per entry. */
const rules: string[] = css
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("}")
  .map((r: string) => r.trim())
  .filter(Boolean);

test("DT-C249: nothing saved, or an unknown finish, is the flat look and writes none of the glass values", () => {
  expect(readAppearance({}).finish).toBe("flat");
  expect(readAppearance({ [FIELD.finish]: "chrome" }).finish).toBe("flat");
  expect(finishOf(undefined)).toBe("flat");
  for (const s of [{}, { [FIELD.finish]: "flat", [FIELD.finishTint]: "#d4a94a", [FIELD.finishStrength]: 100 }]) {
    const v = vars(s);
    expect(Object.keys(v).filter((k) => k.startsWith("--glass")), "no glass value while flat").toEqual([]);
    expect(Object.keys(v).filter((k) => k.startsWith("--fg") || k === "--mark" || k === "--link"), "no text colour is re-stated while flat").toEqual([]);
  }
});

test("DT-C249: the colour is #rrggbb or steel, the strength is pulled into 0 to 100, and both survive a save", () => {
  const a = readAppearance(glass({ [FIELD.finishTint]: "gold;}", [FIELD.finishStrength]: 900 }));
  expect([a.finish, a.finishTint, a.finishStrength]).toEqual(["glass", DEFAULT_METAL, 100]);
  expect(readAppearance(glass({ [FIELD.finishStrength]: -5 })).finishStrength).toBe(0);
  expect(readAppearance(glass()).finishStrength).toBe(60);
  const saved = writeAppearance({}, { ...a, finishTint: "#D4A94A", finishStrength: 35 });
  expect([saved[FIELD.finish], saved[FIELD.finishTint], saved[FIELD.finishStrength]]).toEqual(["glass", "#d4a94a", 35]);
});

test("DT-C249: more strength means a more see-through panel and a stronger glow, inside the stated ends", () => {
  expect(glassLevels(0)).toEqual({ solid: SOLID[0], glow: GLOW[0] });
  expect(glassLevels(100)).toEqual({ solid: SOLID[1], glow: GLOW[1] });
  expect(glassLevels(500), "past 100 counts as 100").toEqual(glassLevels(100));
  const mid = glassLevels(50);
  expect(mid.solid).toBeLessThan(SOLID[0]);
  expect(mid.solid).toBeGreaterThan(SOLID[1]);
  expect(mid.glow).toBeGreaterThan(GLOW[0]);
  expect(mid.glow).toBeLessThan(GLOW[1]);
  expect(SOLID[1], "a panel is always mostly its own fill").toBeGreaterThan(0.5);
});

test("DT-C249: a panel's fill takes the metal's hue, not its brightness", () => {
  for (const [name, hex] of METALS) {
    for (const surface of ["#171717", "#efefef"]) {
      const cast = castOf(hex, surface);
      // one step of the walk (1 % of the way to black or white) is the most it can miss by
      expect(Math.abs(luminance(cast) - luminance(surface)), `${name} on ${surface}`).toBeLessThan(0.03);
      const fill = glassFill(hex, surface);
      expect(Math.abs(luminance(fill) - luminance(surface)), `${name} fill on ${surface}`).toBeLessThan(0.03 * CAST + 0.005);
    }
  }
  expect(glassFill("#4f7fe0", "#171717"), "a blue metal leaves the fill bluer than the surface").not.toBe("#171717");
});

test("DT-C249: the values the stylesheet reads are plain colours and percentages the first-frame script accepts", () => {
  const v = vars(glass({ [FIELD.finishTint]: "#d4a94a", [FIELD.finishStrength]: 100 }));
  expect(v["--glass-tint"]).toBe("#d4a94a");
  expect(v["--glass-glow"]).toBe(Math.round(GLOW[1] * 100) + "%");
  expect(v["--glass-fill"]).toMatch(/^color-mix\(in srgb, #[0-9a-f]{6} 62%, transparent\)$/);
  expect(v["--glass-well"]).toMatch(/^color-mix\(in srgb, #[0-9a-f]{6} 62%, transparent\)$/);
  // index.html puts the saved values on the root before anything draws, and drops any it does not trust
  for (const [k, value] of Object.entries(v)) {
    if (!k.startsWith("--glass")) continue;
    expect(k).toMatch(/^--[a-z0-9-]{1,40}$/);
    expect(value.length).toBeLessThanOrEqual(300);
    expect(value).not.toMatch(/[;{}<>\\]|\/\*|url\(|image-set|image\(|src\(|expression|@import/i);
  }
});

test("DT-C249: a left sidebar with a look of its own keeps its solid ground under the glass", () => {
  expect(vars(glass())["--glass-side"], "the standard sidebar is glass like the other panels").toBe(vars(glass())["--glass-fill"]);
  const tinted = vars(glass({ [FIELD.sidebarLook]: "tinted", [FIELD.sidebarTint]: "#ff0000", [FIELD.sidebarStrength]: 50 }));
  expect(tinted["--glass-side"]).toBe(tinted["--sidebar-bg"]);
  expect(tinted["--glass-side"]).toMatch(/^#[0-9a-f]{6}$/);
});

// The reading promise: on the worst ground the glass can put under a row of text (the panel's fill over the
// glow at its brightest), every text colour keeps the ratio it had on the flat surface, up to 4.5:1 (3:1 for
// icons). Checked for every theme, both modes, the offered metals plus the two extremes, at three strengths.
test("DT-C249: every text colour reads on the glass as it did on the flat surface, for every theme, mode, metal and strength", () => {
  const tints = [...METALS.map(([, h]) => h), "#000000", "#ffffff", "#ffff00", "#0000ff"];
  let moved = 0;
  for (const theme of THEMES) {
    for (const dark of [true, false]) {
      for (const tint of tints) {
        for (const strength of [0, 60, 100]) {
          const a = readAppearance(glass({ [FIELD.theme]: theme, [FIELD.finishTint]: tint, [FIELD.finishStrength]: strength }));
          const t = buildTheme(a, dark);
          const ground = glassGround(t, tint, strength);
          const v = appearanceVars(a, dark) as Record<string, string>;
          const where = `${theme} ${dark ? "dark" : "light"} ${tint} ${strength}%`;
          for (const [keys, bar] of [[GLASS_TEXT, TEXT_BAR], [GLASS_ICONS, ICON_BAR]] as const) {
            for (const k of keys) {
              const flat = contrast(t[k], t.surface);
              const drawn = v["--" + k] ?? t[k];
              if (drawn !== t[k]) moved++;
              // floorInk walks in 1 % steps and stops at the first that reaches the ratio, so it lands at or just over it
              expect(contrast(drawn, ground), `${k} on the glass, ${where}`).toBeGreaterThanOrEqual(Math.min(bar, flat) - 0.001);
              // and on the flat surface, where the solid parts of the window still are, it reads no worse than the bar it had
              expect(contrast(drawn, t.surface), `${k} on the surface, ${where}`).toBeGreaterThanOrEqual(Math.min(bar, flat) - 0.75);
            }
          }
          // the left sidebar's own four inks are matched to the glass as well
          for (const k of ["--sidebar-fg", "--sidebar-fg-row", "--sidebar-fg-muted", "--sidebar-fg-nav"]) {
            expect(contrast(v[k], ground), `${k}, ${where}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  }
  expect(moved, "the check is live: some colour did have to move").toBeGreaterThan(0);
});

test("DT-C249: a colour that already reads on the glass is left alone", () => {
  const t = buildTheme(readAppearance({}), true) as Theme;
  // on the flat surface itself nothing needs to move
  expect(glassInks(t, t.surface)).toEqual({});
});

test("DT-C249: the offered metals have names, and a colour from the picker says so", () => {
  expect(metalName(DEFAULT_METAL)).toBe("Steel");
  expect(metalName("#D4A94A")).toBe("Gold");
  expect(metalName("#123456")).toBe("Your own colour");
  expect(new Set(METALS.map(([, h]) => h)).size).toBe(METALS.length);
});

test("DT-C249: every rule of the stylesheet sits under the glass finish, so the flat look never reads it", () => {
  expect(rules.length).toBeGreaterThan(10);
  for (const r of rules) {
    const selectors = r.slice(0, r.indexOf("{")).split(",").map((s) => s.trim());
    for (const s of selectors) expect(s.startsWith(':root[data-finish="glass"]'), s).toBe(true);
  }
});

test("DT-C249: only what floats over live content is blurred; the big panels are not", () => {
  const blurred = rules.filter((r) => /backdrop-filter/.test(r));
  expect(blurred.length).toBe(1);
  const selectors = blurred[0].slice(0, blurred[0].indexOf("{"));
  for (const big of [".topbar", ".titlebar", ".statusbar", ".sidebar", ".explorer", ".strip", ".content", ".rside", ".pane", "body"]) {
    expect(new RegExp(`\\${big}(?![\\w-])`).test(selectors) || (big === "body" && /\bbody\b/.test(selectors)), `${big} is not blurred`).toBe(false);
  }
});

test("DT-C249: the glow never passes its stated strength, and no panel that carries text is lightened over its fill", () => {
  const body = rules.find((r) => r.startsWith(':root[data-finish="glass"] body'))!;
  // wash plus pool: 0.3 + 0.7 of the glow, laid over each other, stay under the whole
  const shares = [...body.matchAll(/calc\(var\(--glass-glow\) \* ([0-9.]+)\)/g)].map((m) => Number(m[1]));
  expect(shares.length).toBeGreaterThan(0);
  expect(Math.max(...shares) + Math.min(...shares)).toBeLessThanOrEqual(1);
  expect(body, "the glow is never drawn at more than its share").not.toMatch(/var\(--glass-tint\) var\(--glass-glow\)/);
  // the only layer put over a text-bearing panel's fill falls away toward the window's own ground
  const depth = css.match(/--glass-depth:([^;]+);/)![1];
  expect(depth).toMatch(/var\(--app-bg\)/);
  expect(depth).not.toMatch(/#fff|white|--metal-hi|--glass-tint/);
  const panel = /\s\.(topbar|titlebar|statusbar|sidebar|explorer|content|rside)(:not\([^)]*\))*$/;
  const panels = rules.filter((r) => r.slice(0, r.indexOf("{")).split(",").some((s) => panel.test(s.trim())));
  expect(panels.length).toBeGreaterThanOrEqual(4);
  for (const r of panels) {
    const bg = r.match(/background:([^;]+);/)?.[1] ?? "";
    expect(bg, r.slice(0, 60)).not.toMatch(/--metal-hi|#fff|white/);
  }
});

test("DT-C249: a pressed control's brushed metal keeps its label readable, at the bright end and the dark end", () => {
  const pressed = rules.find((r) => r.includes('.switcher button[aria-pressed="true"]'))!;
  const hi = Number(pressed.match(/var\(--metal-hi\) (\d+)%, var\(--seg-active\)/)![1]) / 100;
  const lo = Number(pressed.match(/var\(--metal-lo\) (\d+)%, var\(--seg-active\)/)![1]) / 100;
  const metalHi = Number(css.match(/--metal-hi: color-mix\(in srgb, var\(--glass-tint\) (\d+)%, #ffffff\)/)![1]) / 100;
  const metalLo = Number(css.match(/--metal-lo: color-mix\(in srgb, var\(--glass-tint\) (\d+)%, #000000\)/)![1]) / 100;
  const blend = (a: string, b: string, t: number) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) + (parseInt(b.slice(i, i + 2), 16) - parseInt(a.slice(i, i + 2), 16)) * t).toString(16).padStart(2, "0")).join("");
  for (const theme of THEMES) {
    for (const dark of [true, false]) {
      for (const tint of [...METALS.map(([, h]) => h), "#000000", "#ffffff", "#ffff00"]) {
        const t = buildTheme(readAppearance({ [FIELD.theme]: theme }), dark);
        const top = blend(t["seg-active"], blend("#ffffff", tint, metalHi), hi);
        const bottom = blend(t["seg-active"], blend("#000000", tint, metalLo), lo);
        for (const ground of [top, bottom]) expect(contrast(t.fg, ground), `${theme} ${dark ? "dark" : "light"} ${tint} on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});
