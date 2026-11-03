// Cycle 3 (the WindowView split): the source-test file list, guarded. The window's drawing is a folder
// (shell/window) and the source tests read it through shell/windowSource.ts; every module there must be
// in that text, so a surface moved out of WindowView.tsx joins by existing. The window's files outside
// the folder are one named list, with a count that fails when a rename drops one. This is the check that
// stops a module quietly leaving paneStatus, paneMark, commands, savedLaunch, noticeMount, explorerBar
// or main.slowStart after the next split.
import { expect, test } from "vitest";
import { windowFiles, windowSource } from "./windowSource";

/** The drawing folder as the source list globs it (the same pattern, so a file cannot hide from both). */
const DRAWING = import.meta.glob(["./window/*.{ts,tsx}", "!./window/*.test.ts", "!./window/*.test.tsx", "!./window/__cards__/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const rel = (k: string) => `./shell/${k.replace(/^\.\//, "")}`;

test("the window's drawing folder joins the source tests whole", () => {
  expect(Object.keys(DRAWING).length).toBeGreaterThanOrEqual(10);
  for (const [file, text] of Object.entries(DRAWING)) {
    expect(windowFiles[rel(file)], `${file} is in the window's source list`).toBe(text);
    expect(windowSource, `${file} reaches the text the source tests read`).toContain(text);
  }
});

test("the window's files outside the drawing folder are all present, so a rename cannot quietly drop one", () => {
  // App.tsx + WindowView.tsx + the 6 shell files beside it, the 5 the split's review found missing
  // from every source test, and the 14 hooks the App.tsx split made.
  expect(Object.keys(windowFiles).filter((f) => !f.startsWith("./shell/window/"))).toHaveLength(28);
  for (const f of ["./App.tsx", "./shell/WindowView.tsx", "./shell/windowStore.ts", "./shell/windowBag.ts", "./shell/useWindowSave.ts", "./settings/useSettingsPlumbing.ts"]) {
    expect(windowFiles[f], f).toBeTruthy();
  }
});

test("every import a window surface makes of a module under src/shell joins the scan", () => {
  // The folder glob covers shell/window/*; this covers the other half: a surface that imports a new
  // module under src/shell (a sibling file, a hook moved out) must be added to windowSource.ts, or the
  // seven source tests that read windowSource silently stop seeing that code.
  const specs: { file: string; spec: string }[] = [];
  for (const [file, text] of Object.entries(DRAWING)) {
    for (const m of text.matchAll(/from "(\.[^"]+)"/g)) specs.push({ file, spec: m[1] });
  }
  expect(specs.length).toBeGreaterThan(20);
  const missing: string[] = [];
  for (const { file, spec } of specs) {
    const parts = rel(file).split("/");
    parts.pop();
    for (const seg of spec.split("/")) {
      if (seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    const base = parts.join("/").replace(/\.(ts|tsx)$/, "");
    if (!base.startsWith("./shell/")) continue; // other folders are components, never window source text
    const hit = Object.keys(windowFiles).some((f) => f === `${base}.ts` || f === `${base}.tsx`);
    if (!hit) missing.push(`${file} imports ${spec} (${base})`);
  }
  expect(missing, "add these to shell/windowSource.ts OUTSIDE, or they leave the source tests").toEqual([]);
});
