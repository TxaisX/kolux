// T-762 (DT-C198): the keyboard focus ring and the light-mode notice text must stay readable on the sidebar.
// Reads the colour each rule names out of styles.css and measures it on the tokens the app really draws with.
import { expect, test } from "vitest";
import { buildTheme, readAppearance, THEMES, type Theme } from "./theme";

// CSS imports are stubbed under vitest, so the file is read from disk (as railWidth.test.ts does).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = (h: string) => (h.startsWith("#") ? h : "#" + h.match(/\d+/g)!.slice(0, 3).map((n) => (+n).toString(16).padStart(2, "0")).join(""));

/** The token a declaration names, e.g. the `fg-muted` in `outline: 2px solid var(--fg-muted)`. */
function tokenOf(selector: string, prop: string): string {
  // Anchored so "color" never matches inside "border-color".
  const decl = new RegExp("(?:^|[;{\\s])" + prop + "\\s*:[^;]*var\\(--([a-z-]+)\\)");
  const rule = css.split("}").find((r) => r.split("{")[0].trim().endsWith(selector) && decl.test(r));
  const m = rule?.match(decl);
  if (!m) throw new Error(`no var(--token) for ${prop} in ${selector}`);
  return m[1];
}
// Every built-in theme in both modes, on the standard sidebar look (a user's own tint can put any colour behind it).
const modes: [string, Theme][] = THEMES.flatMap((name) =>
  [true, false].map((dark): [string, Theme] => [`${name} ${dark ? "dark" : "light"}`, buildTheme(readAppearance({ theme: name }), dark)]),
);

/** A theme token, following a CSS alias defined on :root (e.g. --focus-ring: var(--fg-muted)). */
const resolve = (t: Theme, token: string): string => (token in t ? t[token as keyof Theme]! : resolve(t, tokenOf(":root", "--" + token)));

test.each(modes)("--focus-ring reaches 3:1 on the sidebar (%s)", (_, t) => {
  expect(tokenOf(":where(:focus-visible)", "outline")).toBe("focus-ring");
  const ring = resolve(t, "focus-ring");
  for (const ground of [t.surface, t["app-bg"], t["row-selected"]]) expect(ratio(hex(ring), hex(ground))).toBeGreaterThanOrEqual(3);
});

test("no keyboard-focus rule draws with the border grey --line-focus (1.3:1)", () => {
  const fs = nodeFs as unknown as { readdirSync(p: URL, o: { recursive: true }): string[]; readFileSync(p: URL, enc: string): string };
  const sheets = fs.readdirSync(new URL("./", import.meta.url), { recursive: true }).filter((f) => f.endsWith(".css"));
  const bad = sheets.flatMap((f) =>
    fs.readFileSync(new URL("./" + f.split("\\").join("/"), import.meta.url), "utf8").split("}")
      .filter((r) => /:focus/.test(r.split("{")[0].replace(/\/\*[\s\S]*?\*\//g, "")) && r.includes("var(--line-focus)"))
      .map((r) => `${f}: ${r.split("{")[0].trim()}`),
  );
  expect(sheets.length).toBeGreaterThan(5);
  expect(bad).toEqual([]);
});

test.each(modes.filter(([m]) => m.endsWith("light")))("light-mode notice text reaches 4.5:1 on the sidebar (%s)", (_, t) => {
  const fg = t[tokenOf('[data-mode="light"] .notice:not(.ex-note)', "color") as keyof Theme]!;
  expect(ratio(hex(fg), hex(t.surface))).toBeGreaterThanOrEqual(4.5);
});
