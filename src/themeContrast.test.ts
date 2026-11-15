// T-801 (audit P4B-14, p4a-10): in light mode every text token reads at 4.5:1 and every icon or dot token at 3:1
// on each ground it is drawn on. The same pairs the audit measured (p4b-contrast): the six grounds below, every
// built-in theme, with the sliders at their default and at their ends. fg-disabled is exempt (a disabled control).
import { expect, test } from "vitest";
import { buildTheme, contrast, readAppearance, THEMES, type Theme } from "./theme";

const GROUNDS = ["app-bg", "pane-bg", "surface", "strip-bg", "chip-bg", "row-selected"] as const;
const TEXT = ["fg", "fg-row", "fg-muted", "fg-nav", "fg-label", "fg-faint", "mark", "link", "working", "done", "gauge-text", "warn", "danger", "status-bad", "cost-fg"] as const;
const ICON = ["fg-icon-dim", "working-icon", "done-icon"] as const;

const settings = [
  {},
  { themeSaturation: 160, themeDepth: -3 },
  { themeSaturation: 160, themeDepth: 6 },
  { themeSaturation: 0, themeDepth: 6, themeTint: 90 },
];

function failing(t: Theme): string[] {
  const out: string[] = [];
  for (const [names, need] of [[TEXT, 4.5], [ICON, 3]] as const) {
    for (const k of names) for (const g of GROUNDS) {
      const r = contrast(t[k], t[g]);
      if (r < need) out.push(`${k} ${t[k]} on ${g} ${t[g]}: ${r.toFixed(2)} (need ${need})`);
    }
  }
  return out;
}

test("light mode: no text or icon token falls under its floor on any ground, in any built-in theme", () => {
  const bad: string[] = [];
  for (const theme of THEMES) for (const s of settings) {
    const a = readAppearance({ appTheme: theme, appearanceMode: "light", ...s });
    for (const f of failing(buildTheme(a, false))) bad.push(`${theme} ${JSON.stringify(s)} | ${f}`);
  }
  expect(bad).toEqual([]);
});

test("light mode keeps the status colours recognisable: the hue of each token survives the floor", () => {
  const hueOf = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    return d === 0 ? 0 : (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  };
  const t = buildTheme(readAppearance({ appearanceMode: "light" }), false);
  const dark = buildTheme(readAppearance({}), true);
  for (const k of ["link", "working", "done", "warn", "danger"] as const) {
    const d = Math.abs(((hueOf(t[k]) - hueOf(dark[k]) + 540) % 360) - 180);
    expect(d, k).toBeLessThan(20);
  }
});
