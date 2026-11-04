// T-762 (DT-C198) and the C38-R3 review: the keyboard focus ring and the light-mode notice text must stay readable.
// Reads the colour each rule names out of the stylesheets and measures it on the tokens the app really draws with.
import { expect, test } from "vitest";
import { buildTheme, readAppearance, THEMES, type Theme } from "./theme";

// CSS imports are stubbed under vitest, so the sheets are read from disk (as railWidth.test.ts does).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): {
  readFileSync(p: URL, enc: string): string;
  readdirSync(p: URL, o: { recursive: true }): string[];
} } }).process.getBuiltinModule("node:fs");

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const slash = (f: string) => f.split("\\").join("/");
/** The sheet with @media / @supports preludes removed, so a rule inside one is scanned like any other. */
const flatten = (text: string) => text.replace(/@(?:media|supports)[^{]*\{/g, "");

const sheets = nodeFs.readdirSync(new URL("./", import.meta.url), { recursive: true })
  .filter((f) => f.endsWith(".css"))
  .map((f) => ({ file: slash(f), text: nodeFs.readFileSync(new URL("./" + slash(f), import.meta.url), "utf8") }));
const css = sheets.find((s) => s.file === "styles.css")!.text;

type Rule = { file: string; selector: string; body: string };
const rulesIn = (text: string, file: string): Rule[] =>
  flatten(text).split("}").flatMap((chunk): Rule[] => {
    const at = chunk.indexOf("{");
    const selector = at < 0 ? "" : strip(chunk.slice(0, at)).replace(/\s+/g, " ").trim();
    return selector ? [{ file, selector, body: chunk.slice(at + 1) }] : [];
  });
const rules = sheets.flatMap((s) => rulesIn(s.text, s.file));
const focusRules = rules.filter((r) => /:focus(?:-visible|-within)?(?![\w-])/.test(r.selector));

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = (h: string) => (h.startsWith("#") ? h : "#" + h.match(/\d+/g)!.slice(0, 3).map((n) => (+n).toString(16).padStart(2, "0")).join(""));

/** The token a declaration names, e.g. the `fg-muted` in `outline: 2px solid var(--fg-muted)`, or null. */
function tokenIn(selector: string, prop: string): string | null {
  // Anchored so "color" never matches inside "border-color".
  const decl = new RegExp("(?:^|[;{\\s])" + prop + "\\s*:[^;]*var\\(--([a-z-]+)\\)");
  const rule = css.split("}").find((r) => strip(r.split("{")[0]).trim().endsWith(selector) && decl.test(r));
  return rule?.match(decl)?.[1] ?? null;
}
function tokenOf(selector: string, prop: string): string {
  const t = tokenIn(selector, prop);
  if (!t) throw new Error(`no var(--token) for ${prop} in ${selector}`);
  return t;
}
// Every built-in theme in both modes, on the standard sidebar look (a user's own tint can put any colour behind it).
const modes: [string, Theme][] = THEMES.flatMap((name) =>
  [true, false].map((dark): [string, Theme] => [`${name} ${dark ? "dark" : "light"}`, buildTheme(readAppearance({ theme: name }), dark)]),
);

/** A theme token, following a CSS alias defined on :root (e.g. --focus-ring: var(--fg-muted)). */
const resolve = (t: Theme, token: string): string => (token in t ? t[token as keyof Theme]! : resolve(t, tokenOf(":root", "--" + token)));

/** The token a :root alias ends at (--focus-ring -> --fg-muted), or the token itself when it has no alias. */
function chain(token: string, seen: string[] = []): string {
  if (seen.includes(token)) throw new Error(`alias loop at --${token}`);
  const next = tokenIn(":root", "--" + token);
  return next ? chain(next, [...seen, token]) : token;
}
const RING = chain("focus-ring");
const ringish = (body: string) => [...body.matchAll(/var\(--([a-z-]+)/g)].some((m) => chain(m[1]) === RING);

test.each(modes)("--focus-ring reaches 3:1 on the sidebar (%s)", (_, t) => {
  expect(tokenOf(":where(:focus-visible)", "outline")).toBe("focus-ring");
  const ring = resolve(t, "focus-ring");
  for (const ground of [t.surface, t["app-bg"], t["row-selected"]]) expect(ratio(hex(ring), hex(ground))).toBeGreaterThanOrEqual(3);
});

/** Focus targets the app moves focus into by script: dialogs, menus, panes and the terminal. Their focus is
 *  shown by the element's own state or the pane border, never a ring, so the sweep below exempts them. The
 *  list is checked for stale entries, so a selector that stops existing fails instead of lingering. */
const SCRIPT_FOCUSED: [string, string][] = [
  ["styles.css", ".pane.chooser:focus"],
  ["styles.css", ".upd-card:focus-visible"],
  ["styles.css", ':where([tabindex="-1"]:focus-visible)'],
  ["styles.css", ".xterm :focus-visible, .xterm:focus-visible, .xterm-helper-textarea:focus-visible"],
  ["onboarding/onboarding.css", ".onb:focus"],
  ["ports/ports.css", ".ports-menu:focus"],
  ["update/update.css", ".upd-pop.upd-fixed:focus-visible"],
];

test("every keyboard-focus rule keeps a --focus-ring indicator (C38-R3)", () => {
  const exempt = new Set(SCRIPT_FOCUSED.map(([f, s]) => `${f} :: ${s}`));
  const used = new Set<string>();
  const bad: string[] = [];
  const suppresses = (body: string) => /outline\s*:\s*(?:none|0)\b/.test(body);
  for (const r of focusRules) {
    const key = `${r.file} :: ${r.selector}`;
    if (exempt.has(key)) { used.add(key); continue; }
    if (/var\(--accent/.test(r.body)) continue; // the product's own highlight colour, chosen by the user
    if (r.body.includes("var(--line-focus)")) bad.push(`${key} draws with --line-focus`);
    // A rule that kills the fallback outline has to draw the ring itself; a rule that keeps it needs nothing.
    const base = r.selector.split(",").map((s) => strip(s).replace(/:focus(?:-visible|-within)?/g, "").trim());
    const off = suppresses(r.body) || base.some((b) => rules.some((x) => x.selector === b && suppresses(x.body)));
    const outline = r.body.match(/outline(?:-color)?\s*:[^;]*var\(--([a-z-]+)/)?.[1];
    if (off && !ringish(r.body)) bad.push(`${key} suppresses the ring and draws no --focus-ring cue`);
    else if (outline && chain(outline) !== RING) bad.push(`${key} outline uses --${outline}, not --${RING}`);
  }
  expect(sheets.length).toBeGreaterThan(5);
  expect(focusRules.length).toBeGreaterThan(30);
  expect([...exempt].filter((k) => !used.has(k)), "stale exemptions").toEqual([]);
  expect([...new Set(bad)].sort()).toEqual([]);
});

test("the sweep sees a focus rule inside an @media block (the old scan could not)", () => {
  const found = rulesIn("@media (hover: none) { .x:focus-visible { outline: none; } }", "probe.css");
  expect(found.map((r) => r.selector)).toContain(".x:focus-visible");
});

/** The focus cues the C38-R3 review found under 3:1. T-762's sweep only looked for --line-focus, which none
 *  of these named, so they passed. The primary choice is here too: it shares the same `outline: none`. */
const REVIEWED: [string, string][] = [
  ["styles.css", ".review-send-item:focus-visible"],
  ["styles.css", ".add-choice:focus-visible"],
  ["styles.css", ".add-choice.primary:focus-visible"],
  ["tasks/tasks.css", ".projects-table td.editable:focus-visible"],
  ["update/update.css", ".upd-pop-actions .btn:focus-visible"],
];

test("the focus cues found in the C38-R3 review draw a 2 px --focus-ring outline", () => {
  const missing = REVIEWED.flatMap(([file, selector]) => {
    const body = rules.find((r) => r.file === file && r.selector === selector)?.body;
    return /outline:\s*2px solid var\(--focus-ring\)/.test(body ?? "") ? [] : [`${file}: ${selector}`];
  });
  expect(missing).toEqual([]);
});

test.each(modes.filter(([m]) => m.endsWith("light")))("light-mode notice text reaches 4.5:1 on the sidebar (%s)", (_, t) => {
  const fg = t[tokenOf('[data-mode="light"] .notice:not(.ex-note)', "color") as keyof Theme]!;
  expect(ratio(hex(fg), hex(t.surface))).toBeGreaterThanOrEqual(4.5);
});
