// C23-R3-01: the light-mode syntax inks and the editor's dark/light facet. The old suite was green
// while every One Dark literal sat on a light ground at 1.08:1, because nothing measured an ink
// against a ground. These tests compute the real WCAG ratios from the tokens the app draws with.
import { expect, test } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { buildTheme, contrast, FIELD, mix, readAppearance, SYNTAX_KEYS, THEMES, type Theme } from "../theme";
import { codeHighlight, editorMode, SYNTAX_INK } from "./syntax";

// CSS imports are stubbed under vitest, so the sources are read from disk (as contrast.test.ts does).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const source = (file: string) => nodeFs.readFileSync(new URL("./" + file, import.meta.url), "utf8");

/** The One Dark hex each token replaces, keyed by token name. */
const ONE_DARK: Record<string, string> = Object.fromEntries(Object.entries(SYNTAX_INK).map(([hex, name]) => [name, hex]));
const nameOf = (key: string) => key.slice("syn-".length);

/** The ground under the caret line: `look` paints `row-selected` at 45 % over the pane. */
const caretLine = (t: Theme) => mix(t["pane-bg"], t["row-selected"], 0.45);

const DEPTHS = [-3, 0, 6] as const;
const lightThemes = THEMES.flatMap((theme) => DEPTHS.map((depth) => [`${theme} depth ${depth}`, buildTheme(readAppearance({ [FIELD.theme]: theme, [FIELD.depth]: depth }), false)] as const));

test.each(THEMES)("dark mode keeps One Dark's own syntax inks (%s)", (theme) => {
  const t = buildTheme(readAppearance({ [FIELD.theme]: theme }), true);
  for (const key of SYNTAX_KEYS) expect(t[key], key).toBe(ONE_DARK[nameOf(key)]);
});

test.each(lightThemes)("every light syntax ink reaches 4.5:1 on the pane and the caret line (%s)", (_, t) => {
  const ground = caretLine(t);
  for (const key of SYNTAX_KEYS) {
    expect(contrast(t[key], t["pane-bg"]), `${key} on --pane-bg ${t["pane-bg"]}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t[key], ground), `${key} on the caret line ${ground}`).toBeGreaterThanOrEqual(4.5);
  }
});

test("the highlight style points every One Dark colour at its token, not at a literal", () => {
  const colours = codeHighlight.specs.map((s) => s.color).filter((c): c is string => typeof c === "string");
  expect(colours.length).toBeGreaterThan(10);
  for (const c of colours) expect(c).toMatch(/^var\(--syn-[a-z]+(, #[0-9a-f]{6})?\)$/);
  expect(new Set(colours.map((c) => c.match(/--syn-([a-z]+)/)![1]))).toEqual(new Set(SYNTAX_KEYS.map(nameOf)));
});

test("the editor's darkTheme facet follows the mode", () => {
  expect(EditorState.create({ extensions: [editorMode(false)] }).facet(EditorView.darkTheme)).toBe(false);
  expect(EditorState.create({ extensions: [editorMode(true)] }).facet(EditorView.darkTheme)).toBe(true);
});

test("no editor call site pins One Dark or a dark-only theme", () => {
  for (const file of ["EditorPane.tsx", "DiffPane.tsx", "AllChangesPane.tsx", "DiskBanner.tsx"]) {
    const text = source(file);
    expect(text, `${file} still imports oneDarkHighlightStyle`).not.toContain("oneDarkHighlightStyle");
    expect(text, `${file} still marks its theme { dark: true }`).not.toContain("dark: true");
  }
});
