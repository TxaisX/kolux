// T-694 (F13, F16, F17; DT-C130) and T-698 (DT-C134): the window-level overlays share one z-index scale (the --z-*
// variables in styles.css). The floating panel and its button sit over sheets and under every page overlay, menu, pop,
// dialog, notice and tip; the chooser footer's buttons wrap in a narrow pane instead of running past its edge.
import { expect, test } from "vitest";

// Vitest returns "" for a .css import, so the stylesheets are read from disk (the project carries no Node types).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const read = (p: string) => nodeFs.readFileSync(new URL(p, import.meta.url), "utf8");
const styles = read("../styles.css");
const css = [styles, ...["./floating.css", "../update/update.css", "../projects/sidebar.css", "../onboarding/onboarding.css", "../skills/skillNotice.css", "../shell/shell.css", "../setup/trust.css"].map(read)].join("\n");

const scale: Record<string, number> = {};
for (const m of css.matchAll(/--(z-[a-z]+):\s*(\d+)/g)) scale[m[1]] = Number(m[2]);

const rule = (sel: string): string => {
  const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  expect(m, sel).not.toBeNull();
  return m![1];
};
// Resolves "41", "var(--z-menu)" and "calc(var(--z-menu) + 1)" to a number.
const z = (sel: string): number => {
  const v = rule(sel).match(/z-index:\s*([^;]+);/)![1].trim();
  const m = v.match(/^(?:calc\()?(?:var\(--(z-[a-z]+)\)|(\d+))(?:\s*([+-])\s*(\d+)\))?$/);
  expect(m, `${sel}: ${v}`).not.toBeNull();
  const base = m![1] ? scale[m![1]] : Number(m![2]);
  expect(base, `${sel}: ${v}`).toBeTypeOf("number");
  return base + (m![3] ? (m![3] === "+" ? 1 : -1) * Number(m![4]) : 0);
};

test("T-698: the scale runs sheet < floating panel < page < menu < pop < dialog < notice < tip < tour < trust", () => {
  const order = ["z-sheet", "z-float", "z-page", "z-menu", "z-pop", "z-dialog", "z-notice", "z-top", "z-tour", "z-trust"];
  const values = order.map((k) => scale[k]);
  expect(values.every((n) => typeof n === "number")).toBe(true);
  expect([...values].sort((a, b) => a - b)).toEqual(values);
  expect(new Set(values).size).toBe(values.length);
});

test("T-694, T-698: every window-level overlay draws over the floating panel and its button; sheets draw under", () => {
  const top = Math.max(z(".float-panel"), z(".float-btn"));
  const bottom = Math.min(z(".float-panel"), z(".float-btn"));
  for (const sel of [".settings", ".menu-backdrop", ".menu", ".diff-note-pop", ".copy-hint", ".review-tray", ".review-pop", ".upd-pop.upd-fixed", ".sb-menu-back", ".sb-menu", ".scrim", ".star-card, .star-toast", ".tour-notice", ".skill-notice", ".ask-backdrop", ".tip", ".picker-tip", ".tab-switcher", ".tip-dock", ".about-panel", ".tour", ".trust-prompt .ask-backdrop"]) {
    expect(z(sel), sel).toBeGreaterThan(top);
  }
  for (const sel of [".sheet-wrap", ".plan-sheet"]) expect(z(sel), sel).toBeLessThan(bottom);
  expect(z(".float-btn")).toBeGreaterThan(z(".float-panel"));
});

test("T-698: styles.css puts every window-level layer (z-index 20 and up) on the scale, not a bare number", () => {
  const bare = [...styles.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1])).filter((n) => n >= 20);
  expect(bare).toEqual([]);
});

test("T-694: the chooser footer's buttons wrap rather than clip", () => {
  expect(rule(".chooser-foot .btn-row")).toMatch(/flex-wrap:\s*wrap/);
});
