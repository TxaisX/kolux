import { expect, test } from "vitest";
import { appearanceVars, buildTheme, contrast, FIELD, glassInks, glassLights, readAppearance, THEMES, writeAppearance, type Theme } from "../theme";
import { CAST, castOf, DEFAULT_METAL, finishOf, GLASS_ICONS, GLASS_TEXT, glassFill, glassGround, glassGrounds, glassLevels, GLOW, ICON_BAR, POOL, SOLID, TEXT_BAR, WASH } from "./glass";
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
/** What a rule sets one property to (its last declaration of it, as CSS reads it). */
const decl = (rule: string, prop: string) => [...rule.slice(rule.indexOf("{") + 1).matchAll(new RegExp(`(?:^|;)\\s*${prop}:([^;]+)`, "g"))].pop()?.[1].replace(/\s+/g, " ").trim();
/** The rule that opens with this selector (written without the finish it sits under). */
const ruleFor = (selector: string) => rules.find((r) => r.startsWith(`:root[data-finish="glass"] ${selector} {`) || r.startsWith(`:root[data-finish="glass"] ${selector},`))!;
const selectorsOf = (rule: string) => rule.slice(0, rule.indexOf("{")).split(",").map((s) => s.trim().replace(':root[data-finish="glass"]', "").trim());
/** An edge line: one ink, one pixel thick, along the top, the left or the bottom of the box. */
const STRIP = /^linear-gradient\((var\(--glass-[a-z-]+\)), \1\) (0 0|0 100%) \/ (100% 1px|1px 100%) no-repeat$/;
const baseCss: string = nodeFs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("DT-C249: nothing saved, or an unknown finish, is the glass look; Flat is kept once chosen and writes none of the glass values", () => {
  expect(readAppearance({}).finish).toBe("glass");
  expect(readAppearance({ [FIELD.finish]: "chrome" }).finish).toBe("glass");
  expect(finishOf(undefined)).toBe("glass");
  expect(finishOf("flat")).toBe("flat");
  expect(Object.keys(vars({})).filter((k) => k.startsWith("--glass")).length, "the default draws the glass").toBeGreaterThan(0);
  const flat = readAppearance({ [FIELD.finish]: "flat" });
  expect(writeAppearance({}, flat)[FIELD.finish], "a chosen Flat is saved as Flat, so it survives every later save").toBe("flat");
  expect(readAppearance(writeAppearance({}, flat)).finish).toBe("flat");
  for (const s of [{ [FIELD.finish]: "flat" }, { [FIELD.finish]: "flat", [FIELD.finishTint]: "#d4a94a", [FIELD.finishStrength]: 100 }]) {
    const v = vars(s);
    expect(Object.keys(v).filter((k) => k.startsWith("--glass")), "no glass value while flat").toEqual([]);
    expect(Object.keys(v).filter((k) => k.startsWith("--fg") || k === "--mark" || k === "--link"), "no text colour is re-stated while flat").toEqual([]);
  }
});

test("DT-C249: the colour is #rrggbb or the default metal, the strength is pulled into 0 to 100, and both survive a save", () => {
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
  const share = new RegExp(`^color-mix\\(in srgb, #[0-9a-f]{6} ${Math.round(SOLID[1] * 100)}%, transparent\\)$`);
  expect(v["--glass-fill"]).toMatch(share);
  expect(v["--glass-well"]).toMatch(share);
  expect(v["--glass-head"], "a pane's header is the fill itself, solid").toMatch(/^#[0-9a-f]{6}$/);
  expect([v["--glass-mate"], v["--glass-third"]].every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
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

// The reading promise: on every ground the glass can put under a row of text (a panel's fill, the work area's
// own ground and a pane's header, each with the stage bare behind it and with each of the stage's three lights
// at its brightest), every text colour keeps the best ratio it had on the flat look, up to 4.5:1 (3:1 for
// icons). Checked for every theme, both modes, the offered metals plus the extremes, at three strengths.
test("DT-C249: every text colour reads on the glass as it did on the flat look, for every theme, mode, metal and strength", { timeout: 30_000 }, () => {
  const tints = [...METALS.map(([, h]) => h), "#000000", "#ffffff", "#ffff00", "#0000ff"];
  let moved = 0;
  // the same ratio theme.ts works out, with each colour's brightness worked out once (about 260,000 pairs are checked)
  const seen = new Map<string, number>();
  const lum = (hex: string) => seen.get(hex) ?? (seen.set(hex, luminance(hex)), seen.get(hex)!);
  const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  expect(ratio("#a1a1a1", "#171717")).toBeCloseTo(contrast("#a1a1a1", "#171717"), 9);
  for (const theme of THEMES) {
    for (const dark of [true, false]) {
      for (const tint of tints) {
        for (const strength of [0, 60, 100]) {
          const a = readAppearance(glass({ [FIELD.theme]: theme, [FIELD.finishTint]: tint, [FIELD.finishStrength]: strength }));
          const t = buildTheme(a, dark);
          const grounds = glassGrounds(t, glassLights(tint), strength);
          expect(grounds, "the panel under the metal's own light is one of them").toContain(glassGround(t, tint, strength));
          expect(grounds.length, "the fill, then a panel and a work-area ground for the bare stage and each light").toBe(1 + 2 * 4);
          const v = appearanceVars(a, dark) as Record<string, string>;
          const where = `${theme} ${dark ? "dark" : "light"} ${tint} ${strength}%`;
          for (const [keys, bar] of [[GLASS_TEXT, TEXT_BAR], [GLASS_ICONS, ICON_BAR]] as const) {
            for (const k of keys) {
              const flat = ratio(t[k], t.surface);
              // text that sat on the window's own ground (the work area, the right panel's lists) keeps that ratio too
              const best = Math.max(flat, ratio(t[k], t["app-bg"]));
              const drawn = v["--" + k] ?? t[k];
              if (drawn !== t[k]) moved++;
              // the colour walks in 1 % steps and stops at the first that reaches the ratio, so it lands at or just over it
              for (const ground of grounds) if (ratio(drawn, ground) < Math.min(bar, best) - 0.001) expect.fail(`${k} (${drawn}) on ${ground}, ${where}: ${ratio(drawn, ground).toFixed(3)} is under ${Math.min(bar, best).toFixed(3)}`);
              // and on the flat surface, where the solid parts of the window still are, it reads no worse than the bar it had
              expect(ratio(drawn, t.surface), `${k} on the surface, ${where}`).toBeGreaterThanOrEqual(Math.min(bar, flat) - 0.75);
            }
          }
          // the left sidebar's own four inks are matched to the glass as well
          for (const k of ["--sidebar-fg", "--sidebar-fg-row", "--sidebar-fg-muted", "--sidebar-fg-nav"]) {
            for (const ground of grounds) if (ratio(v[k], ground) < 4.5) expect.fail(`${k} (${v[k]}) on ${ground}, ${where}: ${ratio(v[k], ground).toFixed(3)} is under 4.5`);
          }
        }
      }
    }
  }
  expect(moved, "the check is live: some colour did have to move").toBeGreaterThan(0);
});

test("DT-C249: the stage's three lights are the metal and its neighbours on the colour wheel", () => {
  const hue = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    return d === 0 ? null : ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  };
  const turn = (a: number, b: number) => ((b - a + 540) % 360) - 180;
  for (const [name, hex] of METALS) {
    const lights = glassLights(hex);
    expect(lights.length).toBe(3);
    expect(lights[0], "the metal itself comes first").toBe(hex);
    const h = hue(hex)!;
    const cool = h >= 150 && h < 300;
    // a cool metal takes violet and cyan beside it, a warm one orange and rose: never the far side of the wheel
    expect(Math.abs(turn(h, hue(lights[1])!) - (cool ? 40 : -30)), `${name}'s second light`).toBeLessThan(8);
    expect(Math.abs(turn(h, hue(lights[2])!) - (cool ? -35 : -60)), `${name}'s third light`).toBeLessThan(8);
    // castOf walks in 1 % steps toward black or white and stops at the first that crosses the metal's brightness
    for (const l of lights) expect(Math.abs(luminance(l) - luminance(hex)), `${name}: a neighbour is as light as the metal`).toBeLessThan(0.03);
  }
  expect(glassLights("#808080"), "a grey has no hue to turn").toEqual(["#808080", "#808080", "#808080"]);
});

test("DT-C249: the stage shows between the panes, unless the gaps have a colour of their own", () => {
  // the lights over the window's own ground, solid: the same picture the body draws, whatever lies under the grid
  expect(vars(glass())["--glass-gap"]).toBe("var(--glass-stage), var(--glass-floor)");
  expect(vars(glass({ [FIELD.dividerDark]: "#334455" }))["--glass-gap"]).toBe("none");
  expect(vars(glass({ [FIELD.dividerDark]: "#334455" }), false)["--glass-gap"], "the light mode's own gap colour decides in light mode").toBe("var(--glass-stage), var(--glass-floor)");
  expect(css).toMatch(/--glass-floor: linear-gradient\(var\(--app-bg\), var\(--app-bg\)\);/);
  // wherever the stage is drawn again it stands on that floor, so it is never laid over itself (which would be brighter than text is matched to)
  for (const r of rules.filter((x) => /var\(--glass-(stage|gap)\)/.test(x) && !x.startsWith(':root[data-finish="glass"] {'))) {
    expect(/var\(--glass-gap\)|var\(--glass-stage\), var\(--glass-floor\)|var\(--glass-stage\), (var|color-mix)\(/.test(r), r.slice(0, 80)).toBe(true);
  }
});

test("DT-C249: a colour that already reads on the glass is left alone", () => {
  const t = buildTheme(readAppearance({}), true) as Theme;
  // on the flat surface itself nothing needs to move
  expect(glassInks(t, t.surface)).toEqual({});
});

test("DT-C249: the offered metals have names, and a colour from the picker says so", () => {
  expect(metalName(DEFAULT_METAL)).toBe("Sapphire");
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

test("DT-C249: only what floats over live content and is small is blurred; the big panels, the pages and the scrims are not", () => {
  const blurred = rules.filter((r) => /backdrop-filter/.test(r));
  expect(blurred.length).toBe(1);
  const selectors = blurred[0].slice(0, blurred[0].indexOf("{"));
  for (const big of [".topbar", ".titlebar", ".statusbar", ".sidebar", ".explorer", ".strip", ".content", ".rside", ".rside-body", ".pane", ".grid", ".cell", ".board", ".inbox", ".scrim", ".ask-backdrop", ".settings", ".settings-panel", ".onb", "body"]) {
    expect(new RegExp(`\\${big}(?![\\w-])`).test(selectors) || (big === "body" && /\bbody\b/.test(selectors)), `${big} is not blurred`).toBe(false);
  }
});

// A frosted pop is part see-through, so what lies behind it is part of its ground: at worst pure white under a
// dark menu (a PDF page) or pure black under a light one (a dark terminal). Its own share is large enough
// that the labels it carries still read at 4.5:1 there, for every theme and both modes.
test("DT-C249: a frosted pop keeps its labels readable whatever lies behind it", () => {
  const blurred = rules.find((r) => /backdrop-filter/.test(r))!;
  // its ground is that share of the fill; the only thing over it is the light along its top and left edge
  expect(decl(blurred, "background")).toBe("var(--glass-glint), color-mix(in srgb, var(--glass-head) var(--glass-pop), transparent)");
  const shares = [...css.matchAll(/--glass-pop: (\d+)%;/g)].map((m) => Number(m[1]) / 100);
  expect(shares.length, "one share for dark, one for light").toBe(2);
  const lightRule = rules.find((r) => r.startsWith(':root[data-finish="glass"][data-mode="light"]'))!;
  expect(lightRule).toContain(`--glass-pop: ${Math.round(shares[1] * 100)}%`);
  const blend = (a: string, b: string, t: number) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) + (parseInt(b.slice(i, i + 2), 16) - parseInt(a.slice(i, i + 2), 16)) * t).toString(16).padStart(2, "0")).join("");
  for (const theme of THEMES) {
    for (const dark of [true, false]) {
      for (const tint of [...METALS.map(([, h]) => h), "#000000", "#ffffff"]) {
        const a = readAppearance(glass({ [FIELD.theme]: theme, [FIELD.finishTint]: tint }));
        const t = buildTheme(a, dark);
        const v = appearanceVars(a, dark) as Record<string, string>;
        const ground = blend(dark ? "#ffffff" : "#000000", glassFill(tint, t.surface), shares[dark ? 0 : 1]);
        for (const k of ["fg", "fg-row", "fg-muted"] as const) {
          expect(contrast(v["--" + k] ?? t[k], ground), `${k} on a pop over ${dark ? "white" : "black"}, ${theme} ${dark ? "dark" : "light"} ${tint}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  }
});

test("DT-C249: nothing in the finish moves, so a click is answered in the frame it lands in", () => {
  expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/transition|animation|@keyframes/);
});

// The stage is the window's own ground, a thin wash of the metal and pools of light. Text is matched to the
// stage bare and to one pool at its brightest over the wash (glassGrounds), so the stylesheet may never draw
// more than that: the wash and a pool's share are the ones glass.ts works with, no pool is drawn past its
// share, and no two pools overlap (each has faded out by 70 % of its ellipse; the faded shapes are kept
// apart on at least one axis).
/** A comma-separated CSS list split at its top level only (commas inside brackets stay). */
function topLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) (out.push(list.slice(from, i).trim()), (from = i + 1));
  }
  return [...out, list.slice(from).trim()];
}

test("DT-C249: the stage is never brighter than what text is matched to, and no panel that carries text is lightened over its fill", () => {
  expect(WASH + POOL, "wash plus one pool is the whole glow").toBeLessThanOrEqual(1);
  const shareOf = (name: string) => Number(css.match(new RegExp(`--glass-${name}: color-mix\\(in srgb, var\\(--glass-[a-z]+\\) calc\\(var\\(--glass-glow\\) \\* ([0-9.]+)\\), transparent\\);`))![1]);
  for (const pool of ["a", "b", "c"]) expect(shareOf(pool), `pool ${pool}`).toBe(POOL);
  expect(shareOf("wash")).toBe(WASH);
  expect(css, "the glow is only ever drawn through a share").not.toMatch(/var\(--glass-(tint|mate|third)\) var\(--glass-glow\)/);
  expect([...css.matchAll(/calc\(var\(--glass-glow\)/g)].length, "four shares, no other use of the glow").toBe(4);
  const stage = css.match(/--glass-stage:([^;]+);/)![1];
  const pools = [...stage.matchAll(/radial-gradient\(ellipse ([0-9.]+)vw ([0-9.]+)vh at ([0-9.]+)% ([0-9.]+)%, ([^]*?), transparent ([0-9.]+)%\)/g)].map((m) => ({ rx: Number(m[1]), ry: Number(m[2]), x: Number(m[3]), y: Number(m[4]), stops: m[5], end: Number(m[6]) / 100 }));
  expect(pools.length).toBe(4);
  expect([...stage.matchAll(/gradient\(/g)].length, "four pools and the wash, nothing else").toBe(5);
  expect(stage).toMatch(/linear-gradient\(var\(--glass-wash\), var\(--glass-wash\)\)\s*$/);
  for (const p of pools) {
    // every stop is one of the three pool colours, whole or thinned, never strengthened
    for (const part of topLevel(p.stops)) {
      expect(part, part).toMatch(/^(var\(--glass-[abc]\)|color-mix\(in srgb, var\(--glass-[abc]\) [0-9]{1,2}%, transparent\)( [0-9]+%)?)$/);
    }
  }
  for (let i = 0; i < pools.length; i++) {
    for (let j = i + 1; j < pools.length; j++) {
      const [p, q] = [pools[i], pools[j]];
      const apartX = Math.abs(p.x - q.x) >= p.end * p.rx + q.end * q.rx;
      const apartY = Math.abs(p.y - q.y) >= p.end * p.ry + q.end * q.ry;
      expect(apartX || apartY, `pools ${i} and ${j} never overlap`).toBe(true);
    }
  }
  const body = rules.find((r) => r.startsWith(':root[data-finish="glass"] body'))!;
  expect(body.replace(/\s+/g, " ")).toContain("background: var(--glass-stage), var(--app-bg);");
  // the only layer put over a text-bearing panel's fill falls away toward the window's own ground
  const depth = css.match(/--glass-depth:([^;]+);/)![1];
  expect(depth).toMatch(/var\(--app-bg\)/);
  expect(depth).not.toMatch(/#fff|white|--metal-hi|--glass-tint/);
  const panel = /\s\.(topbar|titlebar|statusbar|sidebar|explorer|content|rside|cell)(:not\([^)]*\))*$/;
  const panels = rules.filter((r) => r.slice(0, r.indexOf("{")).split(",").some((s) => panel.test(s.trim())));
  expect(panels.length).toBeGreaterThanOrEqual(4);
  for (const r of panels) {
    // the ground is every layer but the one-pixel edge lines (DT-C266 draws those as strips of background)
    // (the light inks the strips are drawn in are named here too: as a strip they are an edge and are taken
    // off above; as a whole layer, or laid on through background-image, they would lighten the ground)
    const bg = [groundOf(r).join(", "), decl(r, "background-image") ?? ""].join(", ");
    expect(bg, r.slice(0, 60)).not.toMatch(/--metal-hi|#fff|white|--glass-(a|b|c|tint|mate|third|stage|spec-top|spec-side|bar-ink|foot-ink|key-ink)\b/);
  }
  // those inks are light, which is why they are named: each is the metal's highlight or white
  for (const ink of ["spec-top", "spec-side", "bar-ink", "foot-ink", "key-ink"]) expect(css, ink).toMatch(new RegExp(`--glass-${ink}: (color-mix\\(in srgb, var\\(--metal-hi\\)|rgba\\(255, 255, 255)`));
  // a pane's header runs from the fill to the pane's own ground: both grounds text is already matched to
  const head = rules.find((r) => /\.pane-head$/.test(r.slice(0, r.indexOf("{")).trim()))!;
  expect(decl(head, "background")).toBe("var(--glass-glint), linear-gradient(180deg, var(--glass-head), var(--pane-bg))");
  expect(groundOf(head)).toEqual(["linear-gradient(180deg, var(--glass-head), var(--pane-bg))"]);
});

/** The layers of a rule's background that are its ground: what is left once the edge lines are taken off. */
function groundOf(rule: string): string[] {
  return topLevel(decl(rule, "background") ?? "").filter((layer) => layer && !/^var\(--glass-(rim|glint)\)$/.test(layer) && !STRIP.test(layer));
}

// DT-C266. WebKit draws each box-shadow layer in a pass of its own the size of the box, and opening anything
// redraws the whole window, so the finish has no shadow on anything that is always on screen. These hold that,
// and hold what stands in for each shadow.
test("DT-C266: the finish throws one shadow, under a sheet that floats, and it is one layer", () => {
  const FLOATS = [".menu:not(.note-picker)", ".sb-menu", ".review-pop", ".tab-switcher", ".about-panel", ".ask", ".tip-card", ".upd-card", ".upd-pop", ".settings-panel", ".onb", ".menu.note-picker"];
  const shadowed = rules.filter((r) => /box-shadow:/.test(r) && decl(r, "box-shadow") !== "none");
  for (const r of shadowed) {
    expect(decl(r, "box-shadow"), r.slice(0, 70)).toBe("var(--glass-float)");
    for (const s of selectorsOf(r)) expect(FLOATS, s).toContain(s);
  }
  expect(shadowed.flatMap(selectorsOf).sort(), "and each sheet that floats does throw it").toEqual([...FLOATS].sort());
  const floats = [...css.matchAll(/--glass-float: ([^;]+);/g)].map((m) => m[1]);
  expect(floats.length, "one for dark, one for light").toBe(2);
  for (const f of floats) {
    expect(topLevel(f).length, f).toBe(1);
    expect(f).not.toMatch(/inset/);
  }
  // no other value in the stylesheet is a shadow under another name
  for (const [, name, value] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[a-z-]+):\s*([^;]+);/g)) {
    if (name !== "--glass-float") expect(value, name).not.toMatch(/^(inset\b|-?[0-9.]+(px)? -?[0-9.]+(px)? )/);
  }
  // a pane has the flat look's inner line (a shadow) to take off, and the Inbox's sheets take theirs off too
  expect(baseCss).toMatch(/\n\.pane \{[^}]*box-shadow: inset 0 0 0 1px var\(--line-inner\);/);
  expect(decl(ruleFor(".pane:not(.glow)"), "box-shadow")).toBe("none");
});

test("DT-C266: an edge line is a one-pixel strip of background in the edge's own inks", () => {
  const root = rules.find((r) => r.startsWith(':root[data-finish="glass"] {'))!;
  const strips = (name: string) => topLevel(root.match(new RegExp(`--glass-${name}:([^;]+);`))![1].replace(/\s+/g, " ").trim());
  const [rim, glint] = [strips("rim"), strips("glint")];
  for (const s of rim) expect(s, s).toMatch(STRIP);
  expect(rim.length).toBe(3);
  expect(glint, "the glint is the rim's light without its shade").toEqual(rim.slice(0, 2));
  // every sheet that had the lines as shadows has them as strips, in front of its ground
  for (const sel of [".grid > .empty", ".sidebar", ".sidebar-wrap:not(.right) > .sidebar:not(.scm)", '#root > [role="alert"]']) expect(topLevel(decl(ruleFor(sel), "background")!)[0], sel).toBe("var(--glass-rim)");
  for (const sel of [".pane-head", '.rside-tab[aria-selected="true"]', '.tab[aria-selected="true"]', ".menu:not(.note-picker)", ".settings-panel", ".menu.note-picker"]) expect(topLevel(decl(ruleFor(sel), "background")!)[0], sel).toBe("var(--glass-glint)");
  // the bars and the small controls draw their own single lines the same way
  for (const sel of [".topbar", ".statusbar"]) expect(STRIP.test(topLevel(decl(ruleFor(sel), "background")!)[0]), sel).toBe(true);
  for (const sel of [".switcher", ".btn"]) {
    const r = ruleFor(sel);
    expect(decl(r, "background-image"), sel).toMatch(/^linear-gradient\((var\(--glass-[a-z-]+\)), \1\)$/);
    expect([decl(r, "background-size"), decl(r, "background-repeat")], sel).toEqual(["100% 1px", "no-repeat"]);
  }
  // the top bar's dark underline is its own border, with the hairline a strip just inside it
  const bar = ruleFor(".topbar");
  expect(decl(bar, "border-bottom-color")).toBe("var(--glass-under)");
  expect(topLevel(decl(bar, "background")!)[1]).toBe("linear-gradient(var(--glass-line), var(--glass-line)) 0 100% / 100% 1px no-repeat");
});

test("DT-C266: the focused pane is lit by its border and a ring of the metal's light, not by a shadow", () => {
  const lit = ruleFor(".pane.focused:not(.glow)");
  expect(decl(lit, "border-color")).toMatch(/var\(--metal-hi\)/);
  const ring = decl(lit, "outline")!.match(/^([0-9]+)px solid color-mix\(in srgb, var\(--glass-tint\) ([0-9]+)%, transparent\)$/)!;
  expect(Number(ring[1])).toBeGreaterThanOrEqual(2);
  expect(Number(ring[1])).toBeLessThanOrEqual(3);
  expect(Number(ring[2])).toBeGreaterThanOrEqual(15);
  // DT-C271: drawn just inside the pane's edge, so a move of the focus changes nothing beyond the pane (outside it,
  // every move had the whole grid drawn again), and it can neither spill over a neighbour or the bars nor be cut off
  expect(decl(lit, "outline-offset")).toBe(`-${ring[1]}px`);
  // and no rule draws a pane's ring outside it
  for (const r of rules.filter((x) => /\.pane\.focused/.test(x.slice(0, x.indexOf("{"))) && /outline:\s*[1-9]/.test(x))) expect(decl(r, "outline-offset"), r.slice(0, 70)).toBe(`-${ring[1]}px`);
  expect(lit).not.toMatch(/box-shadow/);
  // every other pane has no ring, so only one is drawn
  expect(ruleFor(".pane:not(.glow)")).not.toMatch(/outline/);
  // a zoomed or classic grid runs edge to edge: the brighter border alone shows focus there, as in the flat look
  expect(baseCss).toMatch(/\n\.grid\.zoomed, \.grid\.classic \{ margin: 0;/);
  const edgeToEdge = ruleFor(".grid.zoomed .pane.focused:not(.glow)");
  expect(selectorsOf(edgeToEdge)).toEqual([".grid.zoomed .pane.focused:not(.glow)", ".grid.classic .pane.focused:not(.glow)"]);
  expect(decl(edgeToEdge, "outline")).toBe("none");
  // and the Board, whose sides clip what its cards draw outside themselves, needs no rule of its own any more
  expect(css).not.toMatch(/\.board \.pane\.focused/);
});

test("DT-C266: what a side card throws on the stage is a dark strip in the gutter under it", () => {
  // the gutter is the wrapper's own padding: 8px under the card, and 8px beside it on the window's side
  expect(baseCss).toMatch(/\n\.sidebar-wrap \{[^}]*padding: 8px 0 8px 8px;/);
  expect(baseCss).toMatch(/\n\.rside \{[^}]*padding: 8px 8px 8px 0;/);
  expect(baseCss).toMatch(/\n\.rail-wrap\.classic \{ padding: 0; \}/);
  expect(decl(ruleFor(".sidebar-wrap:not(.right):not(.classic)"), "background")).toBe("var(--glass-cast) 8px 100% / calc(100% - 8px) 8px no-repeat");
  // the right panel only while the Explorer shows: its other tabs' sheets are short, and a shade at the panel's foot would lie under nothing
  expect(decl(ruleFor(".rside:has(> .rside-body > .explorer:not([hidden]))"), "background")).toBe("var(--glass-cast) 0 100% / calc(100% - 8px) 8px no-repeat");
  expect(rules.filter((r) => /var\(--glass-cast\)/.test(r) && !r.startsWith(':root[data-finish="glass"] {')).length, "the two gutters and nowhere else").toBe(2);
  expect(selectorsOf(ruleFor(".rside:has(> .rside-body > .explorer:not([hidden]))"))).toEqual([".rside:has(> .rside-body > .explorer:not([hidden]))", ".rside:has(> .rside-body > .sidebar-wrap)"]);
  // those two are the cards that fill the panel's height
  expect(baseCss).toMatch(/\n\.rside-body > \.explorer \{ width: auto; flex: 1; margin: 0; \}/);
  expect(baseCss).toMatch(/\n\.rside-body > \.sidebar-wrap\.right \{ flex: 1;/);
  expect(css).toMatch(/--glass-cast: linear-gradient\(90deg, transparent, var\(--glass-cast-ink\) 36px, var\(--glass-cast-ink\) calc\(100% - 36px\), transparent\);/);
  const inks = [...css.matchAll(/--glass-cast-ink: rgba\(([0-9]+), ([0-9]+), ([0-9]+), ([0-9.]+)\);/g)];
  expect(inks.length, "one for dark, one for light").toBe(2);
  for (const m of inks) {
    expect(Math.max(Number(m[1]), Number(m[2]), Number(m[3])), "a shade, never a light").toBeLessThanOrEqual(40);
    expect(Number(m[4])).toBeLessThanOrEqual(0.3);
  }
});

test("DT-C266: the sheet that takes the click outside a menu is on a layer of its own and draws nothing, in both finishes", () => {
  // in the window's own stylesheet, so Flat has it too; nothing to draw, so the layer holds no picture
  expect(baseCss).toMatch(/\n\.menu-backdrop \{ position: fixed; inset: 0; z-index: var\(--z-page\); will-change: transform; \}/);
  expect(css, "the finish adds nothing to it").not.toMatch(/menu-backdrop/);
  // and it is always empty, so there are no children whose place a layer could move
  const files = import.meta.glob("../**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  let seen = 0;
  for (const [file, text] of Object.entries(files)) {
    if (/\.test\.tsx$/.test(file)) continue;
    for (const m of text.matchAll(/<div\b[^<>]*?menu-backdrop[^<>]*?(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^<>]*?)*(\/?)>/g)) {
      seen++;
      expect(m[1], `${file}: a backdrop with something inside it`).toBe("/");
    }
  }
  // The hand-rolled sheets go as their popups move onto src/ui, so the count falls; the scan must still read the source.
  expect(Object.keys(files).length).toBeGreaterThan(200);
  expect(seen).toBeGreaterThanOrEqual(0);
  // A src/ui Dialog that asks for the sheet (backdrop="menu-backdrop") gets Base UI's backdrop, empty as well.
  expect(files["../ui/base.tsx"]).toMatch(/\{backdrop && <Dialog\.Backdrop className=\{backdrop\} \/>\}/);
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
