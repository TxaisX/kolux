// SET-038 (T-323): editor and diff preference defaults and the delay.
import { describe, expect, it } from "vitest";
import { allChangesStart, delayFromText, prefPatch, readEditorPrefs } from "./editorPrefs";
import { appearanceVars, readAppearance } from "../theme";

describe("SET-038 editor and diff preferences", () => {
  it("defaults match the card", () => {
    expect(readEditorPrefs({})).toEqual({ autoSave: false, autoSaveDelay: 1000, minimap: false, wordWrap: true, spellcheck: true, diffView: "inline", diffWordWrap: false, diffWhitespace: false, diffTree: false });
  });

  it("editor and diff word wrap are separate, and the delay is clamped", () => {
    const s = { ...prefPatch("diffWordWrap", true) };
    expect(readEditorPrefs(s)).toMatchObject({ diffWordWrap: true, wordWrap: true });
    expect(prefPatch("autoSaveDelay", 5)).toEqual({ editorAutoSaveDelay: 200 });
  });

  it("T-323-b: All Changes starts from the diff preferences unless a layout was saved from a tab", () => {
    const K = { split: "ac-split", wrap: "ac-wrap", spaces: "ac-spaces", tree: "ac-tree" };
    expect(allChangesStart(null, K)).toEqual({ split: false, wrap: false, spaces: false, tree: false });
    const prefs = { diffView: "split", diffWordWrap: true, diffShowWhitespace: true, diffFileTree: true };
    expect(allChangesStart(prefs, K)).toEqual({ split: true, wrap: true, spaces: true, tree: true });
    expect(allChangesStart({ ...prefs, "ac-split": false, "ac-tree": false }, K)).toEqual({ split: false, wrap: true, spaces: true, tree: false });
  });

  it("SET-018: an empty editor font falls back to the terminal font", () => {
    const vars = appearanceVars(readAppearance({ terminalFont: "Cascadia Mono" })) as Record<string, string>;
    expect(vars["--editor-font"].startsWith('"Cascadia Mono"')).toBe(true);
  });
});

describe("auto-save delay as typed (UX-audit)", () => {
  it("3000 can be typed digit by digit: nothing is clamped until the box is left", () => {
    expect(delayFromText("3000")).toBe(3000);
    expect(delayFromText("30000")).toBe(10000);
    expect(delayFromText("5")).toBe(200);
  });
  it("an empty or unreadable box saves nothing", () => {
    expect(delayFromText("")).toBeNull();
    expect(delayFromText("  ")).toBeNull();
    expect(delayFromText("abc")).toBeNull();
  });
});
