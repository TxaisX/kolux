// T-756 / DT-C192: tooltips name the chord the keymap holds (keyboard.md:17, visual.md:13), Show Artifacts
// toggles as Show Skills does (palette.md:19), and the Escape hint has one spelling (visual.md:14).
import { expect, test } from "vitest";
import { withChord } from "../terminal/PaneMenu";
import { defaultsOnly, labelOf, labelParts, resolve } from "../keys/keymap";
import { toggleSkills } from "../skills/nav";
import { screenRows } from "../chrome/reach";
import { paletteRows } from "../projects/WorktreePalette";
import type { Screen } from "../chrome/TopBar";
import actions from "../terminal/paneActions.ts?raw";

const src = import.meta.glob("../**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const app = Object.entries(src).filter(([p]) => !p.includes(".test."));

test("(a) no tooltip hard-codes the Close tab or change-step chords; each reads the keymap", () => {
  const hard = /title="(Close tab \(Ctrl\+W\)|Previous (change|conflict) \(Shift\+F7\)|Next (change|conflict) \(F7\)|Undo \(Ctrl\+Z\)|Redo \(Ctrl\+Shift\+Z\))"/;
  expect(app.filter(([, s]) => hard.test(s)).map(([p]) => p)).toEqual([]);
  for (const f of ["EditorPane", "DiffPane", "ImageView", "PdfView", "PreviewPane", "AllChangesPane"]) expect(src[`./${f}.tsx`], f).toMatch(/withChord\("Close tab", labelOf\(\w+, "tab\.close"\)\)/);
  expect(src["../scm/CheckPane.tsx"]).toContain('withChord("Close tab", labelOf(keymap, "tab.close"))');
  expect(src["./DiffPane.tsx"]).toContain('withChord("Previous change", labelOf(keys, "editor.previousChange"))');
  expect(src["./EditorPane.tsx"]).toContain('withChord("Next conflict", labelOf(keymap, "editor.nextChange"))');
  // a rebound Close tab shows the new chord; Undo and Redo say Cmd on macOS
  const custom = resolve({ "tab.close": "Ctrl+Q", "editor.previousChange": [] } as never, "win32");
  expect(withChord("Close tab", labelOf(custom, "tab.close"))).toBe("Close tab (Ctrl+Q)");
  expect(withChord("Previous change", labelOf(custom, "editor.previousChange"))).toBe("Previous change");
  expect(withChord("Next change", labelOf(defaultsOnly("win32"), "editor.nextChange"))).toBe("Next change (F7)");
  expect(labelParts("Mod+Shift+Z", "darwin").join("+")).toBe("Shift+Cmd+Z");
  expect(labelParts("Mod+Z", "win32").join("+")).toBe("Ctrl+Z");
});

test("(b) Show Artifacts closes Artifacts when it is already up, as Show Skills closes Skills", () => {
  // the palette's rule, as paneActions.ts wires it (the same source pin wave3.test.ts holds); C12-R5-01
  // passes the look, so the Classic layout keeps its one view
  const rule = '...screenRows((s) => (s === "skills" ? toggleSkills(screen, setScreen) : setScreen(s === screen ? "terminals" : s)), classic),';
  expect(actions).toContain(rule);
  let screen: Screen = "agents";
  const setScreen = (s: Screen) => void (screen = s);
  const show = (label: string) => paletteRows(screenRows((s) => (s === "skills" ? toggleSkills(screen, setScreen) : setScreen(s === screen ? "terminals" : s))), label)[0].run();
  show("Show Artifacts");
  expect(screen).toBe("artifacts");
  show("Show Artifacts");
  expect(screen).toBe("terminals"); // where the page's own x goes (Content.tsx)
  show("Show Skills");
  show("Show Skills");
  expect(screen).toBe("terminals");
  show("Show Terminals");
  expect(screen).toBe("terminals"); // Terminals is home: showing it there changes nothing
});

test('(c) every Escape hint in a tooltip says "Esc", the keycap the keymap draws', () => {
  expect(app.filter(([, s]) => /title="[^"]*\(Escape\)"/.test(s)).map(([p]) => p)).toEqual([]);
  expect(labelParts("Escape", "win32")).toEqual(["Esc"]);
  expect(src["../artifacts/ArtifactsPage.tsx"]).toContain('title="Close (Esc)"');
  expect(src["../browser/GrabSheet.tsx"]).toContain('title="Back to the page (Esc)"');
});
