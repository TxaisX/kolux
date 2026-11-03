// T-694 (F13, F16, F17; DT-C130) and T-698 (DT-C134): every layer drawn over the page shares one z-index scale (the
// --z-* variables in styles.css). A pane is not a stacking context, so the pops inside panes are on the scale too. The
// floating panel and its button sit over pane pops, the review tray and the plan sheet, and under every page
// overlay, menu, pop, dialog, notice and tip; the chooser footer's buttons wrap in a narrow pane instead of running past its edge.
import { expect, test } from "vitest";

// Vitest returns "" for a .css import, so the stylesheets are read from disk (the project carries no Node types).
type Fs = { readFileSync(p: URL, enc: string): string; readdirSync(p: URL, o: { recursive: true }): string[] };
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): Fs } }).process.getBuiltinModule("node:fs");
const read = (p: string) => nodeFs.readFileSync(new URL(p, import.meta.url), "utf8");
const styles = read("../styles.css");
const css = [styles, ...["./floating.css", "../update/update.css", "../projects/sidebar.css", "../onboarding/onboarding.css", "../skills/skillNotice.css", "../shell/shell.css", "../setup/trust.css", "../editor/editor-extras.css", "../chat/chat.css"].map(read)].join("\n");

const scale: Record<string, number> = {};
for (const m of css.matchAll(/--(z-[a-z]+):\s*(\d+)/g)) scale[m[1]] = Number(m[2]);

const rule = (sel: string): string => {
  const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  expect(m, sel).not.toBeNull();
  return m![1];
};
// Resolves "41", "var(--z-menu)" and "calc(var(--z-menu) + 1)" to a number; anything else fails.
const z = (sel: string): number => {
  const v = rule(sel).match(/z-index:\s*([^;]+);/)![1].trim();
  const m = v.match(/^(?:(\d+)|var\(--(z-[a-z]+)\)|calc\(var\(--(z-[a-z]+)\)\s*([+-])\s*(\d+)\))$/);
  expect(m, `${sel}: ${v}`).not.toBeNull();
  if (m![1]) return Number(m![1]);
  const base = scale[m![2] ?? m![3]];
  expect(base, `${sel}: ${v}`).toBeTypeOf("number");
  return base + (m![4] ? (m![4] === "+" ? 1 : -1) * Number(m![5]) : 0);
};

const PANE_POPS = [".slash-menu", ".rich-draw", ".chat-composer .chat-full", ".table-ctl", ".code-label", ".table-ctx", ".search-pick-list"];

test("T-698, T-704: the scale runs pane < floating panel < sheet < page < menu < pop < dialog < notice < tip < tour < trust", () => {
  const order = ["z-pane", "z-float", "z-sheet", "z-page", "z-menu", "z-pop", "z-dialog", "z-notice", "z-top", "z-tour", "z-trust"];
  const values = order.map((k) => scale[k]);
  expect(values.every((n) => typeof n === "number")).toBe(true);
  expect([...values].sort((a, b) => a - b)).toEqual(values);
  expect(new Set(values).size).toBe(values.length);
});

test("T-694, T-698: every page overlay, menu, pop and dialog draws over the floating panel and its button", () => {
  const top = Math.max(z(".float-panel"), z(".float-btn"));
  for (const sel of [".settings", ".menu-backdrop", ".menu", ".diff-note-pop", ".copy-hint", ".review-pop", ".upd-pop.upd-fixed", ".sb-menu-back", ".sb-menu", ".scrim", ".star-card, .star-toast", ".tour-notice", ".skill-notice", ".ask-backdrop", ".tip", ".picker-tip", ".tab-switcher", ".tip-dock", ".about-panel", ".tour", ".trust-prompt .ask-backdrop", ".link-bubble"]) {
    expect(z(sel), sel).toBeGreaterThan(top);
  }
  expect(z(".float-btn")).toBeGreaterThan(z(".float-panel"));
});

test("T-698: pane pops, the review tray and the plan sheet draw under the panel, in main's order", () => {
  const panel = Math.min(z(".float-panel"), z(".float-btn"));
  const pops = PANE_POPS.map(z);
  for (const sel of [".chat-browser-menu", ...PANE_POPS, ".review-tray", ".plan-sheet"]) expect(z(sel), sel).toBeLessThan(panel);
  expect(z(".chat-browser-menu")).toBeLessThan(Math.min(...pops));
  expect(Math.max(...pops)).toBeLessThan(z(".review-tray"));
  expect(z(".review-tray")).toBeLessThan(z(".plan-sheet"));
  // Inside the pane tier, main's order: slash menu < table buttons < table menu < PR picker list.
  expect(z(".slash-menu")).toBeLessThan(z(".table-ctl"));
  expect(z(".table-ctl")).toBeLessThan(z(".table-ctx"));
  expect(z(".table-ctx")).toBeLessThan(z(".search-pick-list"));
});

// T-704 (DT-C140, revising DT-C130/C134): the live verify (W3 row L1d) found the floating panel hiding the New-session
// sheet's Start button, so a sheet now draws over the floating panel and its button (and so over everything under
// them), and under every page overlay, menu and dialog. The sheet's parents (.app > .body > .content) must not form
// a stacking context, or the sheet's own z-index would stop counting against the panel (mounted outside them).
const TRAPS = /(?:^|[;{\s])(?:-webkit-)?((?:z-index|transform|filter|backdrop-filter|opacity|isolation|contain|content-visibility|will-change|perspective|mix-blend-mode|clip-path|mask(?:-[a-z-]+)?|view-transition-name|translate|rotate|scale)\s*:|position\s*:\s*(?:fixed|sticky))/;
test("T-704: sheets draw over the floating panel and its button, and under every page overlay, menu and dialog", () => {
  const sheet = z(".sheet-wrap");
  for (const sel of [".float-panel", ".float-btn", ".plan-sheet", ".review-tray", ".chat-browser-menu", ...PANE_POPS]) expect(sheet, sel).toBeGreaterThan(z(sel));
  for (const sel of [".settings", ".menu-backdrop", ".menu", ".diff-note-pop", ".review-pop", ".scrim", ".ask-backdrop", ".tip", ".tour"]) expect(z(sel), sel).toBeGreaterThan(sheet);
});

test("T-704: no rule in any stylesheet under src makes the sheet's parents a stacking context", () => {
  const src = new URL("../", import.meta.url);
  const hits: string[] = [];
  let seen = 0;
  for (const f of nodeFs.readdirSync(src, { recursive: true }).filter((p) => p.endsWith(".css"))) {
    const text = nodeFs.readFileSync(new URL(f.replace(/\\/g, "/"), src), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // :is() and :where() can hold the subject itself, so they are unwrapped before the other pseudo-classes are dropped.
      let sel = m[1].replace(/:(?:is|where)\(([^()]*)\)/g, "$1");
      while (/\([^()]*\)/.test(sel)) sel = sel.replace(/\([^()]*\)/g, "");
      // The subject is the last compound of each selector; the floating panel has its own .body, outside the sheet's tree.
      const parent = sel.split(",").some((s) => !/\.float-panel\b/.test(s) && /\.(app|body|content)(?![\w-])/.test(s.trim().split(/[\s>+~]+/).pop() ?? ""));
      if (!parent) continue;
      seen++;
      const t = m[2].match(TRAPS);
      if (t) hits.push(`${f}: ${m[1].trim()} sets ${t[1]}`);
    }
  }
  expect(seen).toBeGreaterThanOrEqual(4);
  expect(hits).toEqual([]);
});

test("T-698: no stylesheet in src sets a bare z-index of 20 or more; every layer over the page is on the scale", () => {
  const src = new URL("../", import.meta.url);
  const bare: string[] = [];
  const sheets = nodeFs.readdirSync(src, { recursive: true }).filter((p) => p.endsWith(".css"));
  expect(sheets).toContain("styles.css");
  expect(sheets.length).toBeGreaterThan(20);
  for (const f of sheets) {
    for (const m of nodeFs.readFileSync(new URL(f.replace(/\\/g, "/"), src), "utf8").matchAll(/z-index:\s*(\d+)/g)) {
      if (Number(m[1]) >= 20) bare.push(`${f}: ${m[1]}`);
    }
  }
  expect(bare).toEqual([]);
});

test("T-694: the chooser footer's buttons wrap rather than clip", () => {
  expect(rule(".chooser-foot .btn-row")).toMatch(/flex-wrap:\s*wrap/);
});
